import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { OrdersLifecycleService } from './orders-lifecycle.service';
import { RoundOrderLifecycleService } from './round-order-lifecycle.service';
import { SettlementsService } from '../settlements/settlements.service';

type TestRecord = Record<string, unknown>;
type TransactionCallback = (transaction: TestTransaction) => Promise<unknown>;
type TransactionWrite = {
  kind: 'set' | 'update';
  path: string;
  data: TestRecord;
};
type TestSnapshot = {
  exists: boolean;
  data: () => TestRecord | undefined;
  ref: TestDocumentReference;
};
type TestDocumentReference = {
  path: string;
  get: () => Promise<TestSnapshot>;
  update: (data: TestRecord) => Promise<void>;
};
type TestTransaction = {
  get: (reference: TestDocumentReference) => Promise<TestSnapshot>;
  set: (reference: TestDocumentReference, data: TestRecord) => void;
  update: (reference: TestDocumentReference, data: TestRecord) => void;
};

const FIXED_NOW = new Date('2026-08-27T00:00:00.000Z');

function copyRecord(record: TestRecord): TestRecord {
  return { ...record };
}

function applyPatch(target: TestRecord, patch: TestRecord): TestRecord {
  const next = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    next[key] = value;
  }
  return next;
}

class FakeFirestore {
  private readonly documents = new Map<string, { data: TestRecord; version: number }>();
  private readonly references = new Map<string, TestDocumentReference>();
  private beforeTransactionAttempt?: () => Promise<void> | void;

  readonly transactionSets: string[] = [];
  readonly transactionUpdates: Array<{ path: string; data: TestRecord }> = [];
  readonly directUpdates: string[] = [];
  readonly Timestamp = {
    now: jest.fn(() => new Date(FIXED_NOW)),
    fromDate: jest.fn((date: Date) => date),
  };
  readonly FieldValue = {
    increment: jest.fn((amount: number) => ({ __increment: amount })),
  };
  readonly doc = jest.fn((path: string) => this.getReference(path));
  readonly collection = jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    get: jest.fn(async () => ({ empty: true, docs: [] })),
  }));
  readonly runTransaction = jest.fn((callback: TransactionCallback): Promise<unknown> =>
    this.executeTransaction(callback),
  );

  seed(path: string, data: TestRecord) {
    this.documents.set(path, { data: copyRecord(data), version: 0 });
  }

  updateOutsideTransaction(path: string, data: TestRecord) {
    this.writeUpdate(path, data, false);
  }

  setBeforeTransactionAttempt(hook: (() => Promise<void> | void) | undefined) {
    this.beforeTransactionAttempt = hook;
  }

  getData(path: string): TestRecord | undefined {
    const document = this.documents.get(path);
    return document ? copyRecord(document.data) : undefined;
  }

  listData(prefix: string): TestRecord[] {
    return [...this.documents.entries()]
      .filter(([path]) => path.startsWith(prefix))
      .map(([, document]) => copyRecord(document.data));
  }

  orderTransactionUpdates(path: string) {
    return this.transactionUpdates.filter((write) => write.path === path);
  }

  private getReference(path: string): TestDocumentReference {
    const existing = this.references.get(path);
    if (existing) return existing;
    const reference: TestDocumentReference = {
      path,
      get: () => Promise.resolve(this.readSnapshot(path, reference)),
      update: (data) => Promise.resolve().then(() => this.writeUpdate(path, data, false)),
    };
    this.references.set(path, reference);
    return reference;
  }

  private readSnapshot(path: string, reference = this.getReference(path)): TestSnapshot {
    const document = this.documents.get(path);
    const data = document ? copyRecord(document.data) : undefined;
    return {
      exists: document !== undefined,
      data: () => data,
      ref: reference,
    };
  }

  private async executeTransaction(callback: TransactionCallback): Promise<unknown> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (this.beforeTransactionAttempt) {
        const hook = this.beforeTransactionAttempt;
        this.beforeTransactionAttempt = undefined;
        await hook();
      }

      const readVersions = new Map<string, number>();
      const writes: TransactionWrite[] = [];
      const transaction: TestTransaction = {
        get: (reference) => {
          const document = this.documents.get(reference.path);
          readVersions.set(reference.path, document?.version ?? 0);
          const data = document ? copyRecord(document.data) : undefined;
          return Promise.resolve({
            exists: document !== undefined,
            data: () => data,
            ref: reference,
          });
        },
        set: (reference, data) => {
          writes.push({ kind: 'set', path: reference.path, data: copyRecord(data) });
        },
        update: (reference, data) => {
          writes.push({ kind: 'update', path: reference.path, data: copyRecord(data) });
        },
      };

      const result = await callback(transaction);
      await new Promise<void>((resolve) => setImmediate(resolve));

      const conflicted = [...readVersions.entries()].some(
        ([path, version]) => (this.documents.get(path)?.version ?? 0) !== version,
      );
      if (conflicted) continue;

      for (const write of writes) {
        if (write.kind === 'set') {
          const previous = this.documents.get(write.path);
          this.documents.set(write.path, {
            data: copyRecord(write.data),
            version: (previous?.version ?? 0) + 1,
          });
          this.transactionSets.push(write.path);
          continue;
        }
        this.writeUpdate(write.path, write.data, true);
      }
      return result;
    }
    throw new Error('transaction retry limit exceeded');
  }

  private writeUpdate(path: string, data: TestRecord, fromTransaction: boolean) {
    const document = this.documents.get(path);
    if (!document) throw new Error(`missing document: ${path}`);
    const nextData = applyPatch(document.data, data);
    this.documents.set(path, { data: nextData, version: document.version + 1 });
    if (fromTransaction) this.transactionUpdates.push({ path, data: copyRecord(data) });
    else this.directUpdates.push(path);
  }
}

function makeContext(options: {
  order?: TestRecord;
  store?: TestRecord;
} = {}) {
  const firestore = new FakeFirestore();
  firestore.seed('stores/store-1', { id: 'store-1', ownerId: 'seller-1', ...(options.store ?? {}) });
  firestore.seed('orders/order-1', {
    id: 'order-1',
    storeId: 'store-1',
    userId: 'consumer-1',
    status: 'HUB_ARRIVED',
    pickupCode: '123456',
    totalAmount: 50000,
    ...(options.order ?? {}),
  });
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'PLATFORM_FEE_RATE') return '0.05';
      if (key === 'SETTLEMENT_CONFIRM_DELAY_DAYS') return '1';
      return undefined;
    }),
  };
  const settlements = new SettlementsService(firestore as never, configService as never);
  const notifications = {
    sendToUser: jest.fn().mockResolvedValue(undefined),
    sendToGroupParticipants: jest.fn().mockResolvedValue(undefined),
  };
  const payments = {
    processRefundByOrderId: jest.fn().mockResolvedValue(undefined),
    refundOrderChargesByOrderId: jest.fn().mockResolvedValue(undefined),
  };
  const capacity = {
    releaseReservation: jest.fn().mockResolvedValue(undefined),
    releaseReservationInTransaction: jest.fn().mockResolvedValue(undefined),
  };
  const roundLifecycle = new RoundOrderLifecycleService(
    firestore as never,
    payments as never,
    settlements as never,
    capacity as never,
  );
  const lifecycle = new OrdersLifecycleService(
    firestore as never,
    notifications as never,
    payments as never,
    settlements as never,
    capacity as never,
    roundLifecycle,
  );
  return { firestore, lifecycle, settlements };
}

describe('specialized command race convergence (review/confirm/hub-confirm)', () => {
  it('A. reviewOrder normal success: DELIVERED → REVIEWED + settlement 1', async () => {
    const context = makeContext({ order: { status: 'DELIVERED' } });

    await expect(
      context.lifecycle.reviewOrder('store-1', 'order-1', 'consumer-1'),
    ).resolves.toEqual({ orderId: 'order-1', status: 'REVIEWED' });

    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'REVIEWED' });
    expect(context.firestore.orderTransactionUpdates('orders/order-1')).toHaveLength(1);
    expect(context.firestore.directUpdates.filter((path) => path === 'orders/order-1')).toHaveLength(
      0,
    );
    expect(context.firestore.listData('settlements/')).toHaveLength(1);
    expect(context.firestore.getData('settlements/order-1')).toMatchObject({
      orderId: 'order-1',
      status: 'pending',
      completedStatus: 'REVIEWED',
    });
  });

  it('B. reviewOrder unauthorized consumer: 403 + side-effect 0', async () => {
    const context = makeContext({ order: { status: 'DELIVERED' } });

    await expect(
      context.lifecycle.reviewOrder('store-1', 'order-1', 'consumer-other'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'DELIVERED' });
    expect(context.firestore.orderTransactionUpdates('orders/order-1')).toHaveLength(0);
    expect(context.firestore.listData('settlements/')).toHaveLength(0);
  });

  it('C. reviewOrder stale-state race: loser 409 + stale overwrite 없음', async () => {
    const context = makeContext({ order: { status: 'DELIVERED' } });
    context.firestore.setBeforeTransactionAttempt(() => {
      context.firestore.updateOutsideTransaction('orders/order-1', { status: 'REVIEWED' });
    });

    await expect(
      context.lifecycle.reviewOrder('store-1', 'order-1', 'consumer-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'REVIEWED' });
    expect(context.firestore.orderTransactionUpdates('orders/order-1')).toHaveLength(0);
    expect(context.firestore.listData('settlements/')).toHaveLength(0);
  });

  it('D. concurrent reviewOrder: winner 1 x 200 + loser 409 + settlement 1', async () => {
    const context = makeContext({ order: { status: 'DELIVERED' } });

    const results = await Promise.allSettled([
      context.lifecycle.reviewOrder('store-1', 'order-1', 'consumer-1'),
      context.lifecycle.reviewOrder('store-1', 'order-1', 'consumer-1'),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'REVIEWED' });
    expect(context.firestore.orderTransactionUpdates('orders/order-1')).toHaveLength(1);
    expect(context.firestore.listData('settlements/')).toHaveLength(1);
  });

  it('E. reviewOrder transition-success + settlement-failure + retry convergence', async () => {
    const context = makeContext({ order: { status: 'DELIVERED' } });
    const spy = jest
      .spyOn(context.settlements, 'createSettlement')
      .mockRejectedValueOnce(new Error('settlement infra down'));

    await expect(
      context.lifecycle.reviewOrder('store-1', 'order-1', 'consumer-1'),
    ).rejects.toThrow('settlement infra down');
    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'REVIEWED' });
    expect(context.firestore.listData('settlements/')).toHaveLength(0);
    spy.mockRestore();

    await expect(
      context.lifecycle.reviewOrder('store-1', 'order-1', 'consumer-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'REVIEWED' });
    expect(context.firestore.listData('settlements/')).toHaveLength(1);
    expect(context.firestore.getData('settlements/order-1')).toMatchObject({
      status: 'pending',
      completedStatus: 'REVIEWED',
    });
  });

  it('F. confirmPickup normal success: HUB_ARRIVED → PICKED_UP + settlement 1', async () => {
    const context = makeContext();

    await expect(
      context.lifecycle.confirmPickup('store-1', 'order-1', 'consumer-1', '123456'),
    ).resolves.toEqual({ orderId: 'order-1', status: 'PICKED_UP' });

    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'PICKED_UP' });
    expect(context.firestore.orderTransactionUpdates('orders/order-1')).toHaveLength(1);
    expect(context.firestore.directUpdates.filter((path) => path === 'orders/order-1')).toHaveLength(
      0,
    );
    expect(context.firestore.listData('settlements/')).toHaveLength(1);
    expect(context.firestore.getData('settlements/order-1')).toMatchObject({
      completedStatus: 'PICKED_UP',
    });
  });

  it('G. confirmPickup wrong pickupCode: 400 + side-effect 0', async () => {
    const context = makeContext();

    await expect(
      context.lifecycle.confirmPickup('store-1', 'order-1', 'consumer-1', '000000'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'HUB_ARRIVED' });
    expect(context.firestore.orderTransactionUpdates('orders/order-1')).toHaveLength(0);
    expect(context.firestore.listData('settlements/')).toHaveLength(0);
  });

  it('H. confirmPickup wrong consumer: 403 + side-effect 0', async () => {
    const context = makeContext();

    await expect(
      context.lifecycle.confirmPickup('store-1', 'order-1', 'consumer-other', '123456'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'HUB_ARRIVED' });
    expect(context.firestore.orderTransactionUpdates('orders/order-1')).toHaveLength(0);
    expect(context.firestore.listData('settlements/')).toHaveLength(0);
  });

  it('I. confirmPickup stale HUB_ARRIVED race: loser 409', async () => {
    const context = makeContext();
    context.firestore.setBeforeTransactionAttempt(() => {
      context.firestore.updateOutsideTransaction('orders/order-1', { status: 'PICKED_UP' });
    });

    await expect(
      context.lifecycle.confirmPickup('store-1', 'order-1', 'consumer-1', '123456'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'PICKED_UP' });
    expect(context.firestore.orderTransactionUpdates('orders/order-1')).toHaveLength(0);
    expect(context.firestore.listData('settlements/')).toHaveLength(0);
  });

  it('J. concurrent confirmPickup: winner 1 x 200 + loser 409 + settlement 1', async () => {
    const context = makeContext();

    const results = await Promise.allSettled([
      context.lifecycle.confirmPickup('store-1', 'order-1', 'consumer-1', '123456'),
      context.lifecycle.confirmPickup('store-1', 'order-1', 'consumer-1', '123456'),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'PICKED_UP' });
    expect(context.firestore.orderTransactionUpdates('orders/order-1')).toHaveLength(1);
    expect(context.firestore.listData('settlements/')).toHaveLength(1);
  });

  it('K. hubConfirmPickup normal success: seller owner HUB_ARRIVED → PICKED_UP', async () => {
    const context = makeContext();

    await expect(
      context.lifecycle.hubConfirmPickup('store-1', 'order-1', 'seller-1', '123456'),
    ).resolves.toEqual({ orderId: 'order-1', status: 'PICKED_UP' });

    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'PICKED_UP' });
    expect(context.firestore.orderTransactionUpdates('orders/order-1')).toHaveLength(1);
    expect(context.firestore.listData('settlements/')).toHaveLength(1);
  });

  it('L. hubConfirmPickup non-owner seller: 403 + side-effect 0', async () => {
    const context = makeContext();

    await expect(
      context.lifecycle.hubConfirmPickup('store-1', 'order-1', 'seller-other', '123456'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'HUB_ARRIVED' });
    expect(context.firestore.orderTransactionUpdates('orders/order-1')).toHaveLength(0);
    expect(context.firestore.listData('settlements/')).toHaveLength(0);
  });

  it('M. hubConfirmPickup wrong pickupCode: 400 + side-effect 0', async () => {
    const context = makeContext();

    await expect(
      context.lifecycle.hubConfirmPickup('store-1', 'order-1', 'seller-1', '000000'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'HUB_ARRIVED' });
    expect(context.firestore.orderTransactionUpdates('orders/order-1')).toHaveLength(0);
    expect(context.firestore.listData('settlements/')).toHaveLength(0);
  });

  it('N. hubConfirmPickup stale HUB_ARRIVED race: loser 409', async () => {
    const context = makeContext();
    context.firestore.setBeforeTransactionAttempt(() => {
      context.firestore.updateOutsideTransaction('orders/order-1', { status: 'PICKED_UP' });
    });

    await expect(
      context.lifecycle.hubConfirmPickup('store-1', 'order-1', 'seller-1', '123456'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'PICKED_UP' });
    expect(context.firestore.orderTransactionUpdates('orders/order-1')).toHaveLength(0);
    expect(context.firestore.listData('settlements/')).toHaveLength(0);
  });

  it('O. confirmPickup vs hubConfirmPickup concurrent race: PICKED_UP 1회 + settlement 1', async () => {
    const context = makeContext();

    const results = await Promise.allSettled([
      context.lifecycle.confirmPickup('store-1', 'order-1', 'consumer-1', '123456'),
      context.lifecycle.hubConfirmPickup('store-1', 'order-1', 'seller-1', '123456'),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'PICKED_UP' });
    expect(context.firestore.orderTransactionUpdates('orders/order-1')).toHaveLength(1);
    expect(context.firestore.listData('settlements/')).toHaveLength(1);
  });

  it('P. PICKED_UP sequential duplicate converges settlement once without overwrite', async () => {
    const context = makeContext();

    await expect(
      context.lifecycle.confirmPickup('store-1', 'order-1', 'consumer-1', '123456'),
    ).resolves.toEqual({ orderId: 'order-1', status: 'PICKED_UP' });
    const first = context.firestore.getData('settlements/order-1');

    await expect(
      context.lifecycle.hubConfirmPickup('store-1', 'order-1', 'seller-1', '123456'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'PICKED_UP' });
    expect(context.firestore.orderTransactionUpdates('orders/order-1')).toHaveLength(1);
    expect(context.firestore.listData('settlements/')).toHaveLength(1);
    expect(context.firestore.getData('settlements/order-1')).toEqual(first);
  });

  it('Q. pickup settlement post-effect failure retry converges', async () => {
    const context = makeContext();
    const spy = jest
      .spyOn(context.settlements, 'createSettlement')
      .mockRejectedValueOnce(new Error('settlement infra down'));

    await expect(
      context.lifecycle.confirmPickup('store-1', 'order-1', 'consumer-1', '123456'),
    ).rejects.toThrow('settlement infra down');
    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'PICKED_UP' });
    expect(context.firestore.listData('settlements/')).toHaveLength(0);
    spy.mockRestore();

    await expect(
      context.lifecycle.confirmPickup('store-1', 'order-1', 'consumer-1', '123456'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(context.firestore.listData('settlements/')).toHaveLength(1);
    expect(context.firestore.getData('settlements/order-1')).toMatchObject({
      status: 'pending',
      completedStatus: 'PICKED_UP',
    });
  });

  it('S6. REVIEWED retry does not overwrite DELIVERED-stage settlement snapshot', async () => {
    const context = makeContext({ order: { status: 'PICKED_UP' } });
    await context.settlements.createSettlement(
      { id: 'order-1', storeId: 'store-1', status: 'DELIVERED', totalAmount: 50000 },
      'DELIVERED',
    );
    const first = context.firestore.getData('settlements/order-1');
    expect(first).toMatchObject({ completedStatus: 'DELIVERED' });

    await expect(
      context.lifecycle.reviewOrder('store-1', 'order-1', 'consumer-1'),
    ).resolves.toEqual({ orderId: 'order-1', status: 'REVIEWED' });

    expect(context.firestore.listData('settlements/')).toHaveLength(1);
    expect(context.firestore.getData('settlements/order-1')).toEqual(first);
  });
});
