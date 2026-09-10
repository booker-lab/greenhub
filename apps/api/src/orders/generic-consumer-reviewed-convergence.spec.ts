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
type TransactionWrite = { kind: 'set' | 'update'; path: string; data: TestRecord };
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
    return { exists: document !== undefined, data: () => data, ref: reference };
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

function makeContext(options: { order?: TestRecord } = {}) {
  const firestore = new FakeFirestore();
  firestore.seed('stores/store-1', { id: 'store-1', ownerId: 'seller-1' });
  firestore.seed('orders/order-1', {
    id: 'order-1',
    storeId: 'store-1',
    userId: 'consumer-1',
    status: 'DELIVERED',
    totalAmount: 50000,
    saleType: 'group',
    deliveryMethod: 'parcel',
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
  const payments = { processRefundByOrderId: jest.fn().mockResolvedValue(undefined) };
  const capacity = { releaseReservation: jest.fn().mockResolvedValue(undefined) };
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
  return { firestore, lifecycle, settlements, notifications, payments };
}

describe('generic consumer REVIEWED convergence (single semantic owner)', () => {
  it('A. generic DELIVERED -> REVIEWED converges order + settlement', async () => {
    const context = makeContext({ order: { status: 'DELIVERED' } });

    await expect(
      context.lifecycle.updateStatus('store-1', 'order-1', 'consumer-1', {
        status: 'REVIEWED',
      } as never, 'consumer'),
    ).resolves.toEqual({ orderId: 'order-1', status: 'REVIEWED' });

    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'REVIEWED' });
    expect(context.firestore.orderTransactionUpdates('orders/order-1')).toHaveLength(1);
    expect(context.firestore.listData('settlements/')).toHaveLength(1);
    expect(context.firestore.getData('settlements/order-1')).toMatchObject({
      orderId: 'order-1',
      status: 'pending',
      completedStatus: 'REVIEWED',
    });
  });

  it('B. generic PICKED_UP -> REVIEWED converges order + settlement', async () => {
    const context = makeContext({ order: { status: 'PICKED_UP' } });

    await expect(
      context.lifecycle.updateStatus('store-1', 'order-1', 'consumer-1', {
        status: 'REVIEWED',
      } as never, 'consumer'),
    ).resolves.toEqual({ orderId: 'order-1', status: 'REVIEWED' });

    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'REVIEWED' });
    expect(context.firestore.orderTransactionUpdates('orders/order-1')).toHaveLength(1);
    expect(context.firestore.listData('settlements/')).toHaveLength(1);
    expect(context.firestore.getData('settlements/order-1')).toMatchObject({
      completedStatus: 'REVIEWED',
    });
  });

  it('C. ownership violation: order write 0 + settlement 0', async () => {
    const context = makeContext({ order: { status: 'DELIVERED' } });

    await expect(
      context.lifecycle.updateStatus('store-1', 'order-1', 'consumer-other', {
        status: 'REVIEWED',
      } as never, 'consumer'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'DELIVERED' });
    expect(context.firestore.orderTransactionUpdates('orders/order-1')).toHaveLength(0);
    expect(context.firestore.listData('settlements/')).toHaveLength(0);
  });

  it('D. same-command concurrency: winner 1 + settlement exactly-once + loser 409', async () => {
    const context = makeContext({ order: { status: 'DELIVERED' } });

    const results = await Promise.allSettled([
      context.lifecycle.updateStatus('store-1', 'order-1', 'consumer-1', {
        status: 'REVIEWED',
      } as never, 'consumer'),
      context.lifecycle.updateStatus('store-1', 'order-1', 'consumer-1', {
        status: 'REVIEWED',
      } as never, 'consumer'),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(ConflictException);
    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'REVIEWED' });
    expect(context.firestore.orderTransactionUpdates('orders/order-1')).toHaveLength(1);
    expect(context.firestore.listData('settlements/')).toHaveLength(1);
  });

  it('E. generic vs specialized cross-path race: no double transition + no missing settlement', async () => {
    const context = makeContext({ order: { status: 'DELIVERED' } });

    const results = await Promise.allSettled([
      context.lifecycle.updateStatus('store-1', 'order-1', 'consumer-1', {
        status: 'REVIEWED',
      } as never, 'consumer'),
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
    expect(context.firestore.getData('settlements/order-1')).toMatchObject({ status: 'pending' });
  });

  it('F. post-transition settlement failure converges on generic retry preserving 403', async () => {
    const context = makeContext({ order: { status: 'DELIVERED' } });
    const spy = jest
      .spyOn(context.settlements, 'createSettlement')
      .mockRejectedValueOnce(new Error('settlement infra down'));

    await expect(
      context.lifecycle.updateStatus('store-1', 'order-1', 'consumer-1', {
        status: 'REVIEWED',
      } as never, 'consumer'),
    ).rejects.toThrow('settlement infra down');
    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'REVIEWED' });
    expect(context.firestore.listData('settlements/')).toHaveLength(0);
    spy.mockRestore();

    await expect(
      context.lifecycle.updateStatus('store-1', 'order-1', 'consumer-1', {
        status: 'REVIEWED',
      } as never, 'consumer'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'REVIEWED' });
    expect(context.firestore.listData('settlements/')).toHaveLength(1);
    expect(context.firestore.getData('settlements/order-1')).toMatchObject({
      status: 'pending',
      completedStatus: 'REVIEWED',
    });
  });

  it('G. specialized retry regression: failure then 400 convergence', async () => {
    const context = makeContext({ order: { status: 'DELIVERED' } });
    const spy = jest
      .spyOn(context.settlements, 'createSettlement')
      .mockRejectedValueOnce(new Error('settlement infra down'));

    await expect(
      context.lifecycle.reviewOrder('store-1', 'order-1', 'consumer-1'),
    ).rejects.toThrow('settlement infra down');
    expect(context.firestore.getData('orders/order-1')).toMatchObject({ status: 'REVIEWED' });
    spy.mockRestore();

    await expect(
      context.lifecycle.reviewOrder('store-1', 'order-1', 'consumer-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(context.firestore.listData('settlements/')).toHaveLength(1);
  });

  it('H. already REVIEWED with existing settlement: duplicate preserves snapshot + contract', async () => {
    const context = makeContext({ order: { status: 'DELIVERED' } });
    await context.settlements.createSettlement(
      { id: 'order-1', storeId: 'store-1', status: 'DELIVERED', totalAmount: 50000 },
      'DELIVERED',
    );
    const first = context.firestore.getData('settlements/order-1');
    expect(first).toMatchObject({ completedStatus: 'DELIVERED' });

    await expect(
      context.lifecycle.updateStatus('store-1', 'order-1', 'consumer-1', {
        status: 'REVIEWED',
      } as never, 'consumer'),
    ).resolves.toEqual({ orderId: 'order-1', status: 'REVIEWED' });
    expect(context.firestore.getData('settlements/order-1')).toEqual(first);

    await expect(
      context.lifecycle.updateStatus('store-1', 'order-1', 'consumer-1', {
        status: 'REVIEWED',
      } as never, 'consumer'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(context.firestore.getData('settlements/order-1')).toEqual(first);

    await expect(
      context.lifecycle.reviewOrder('store-1', 'order-1', 'consumer-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(context.firestore.getData('settlements/order-1')).toEqual(first);
    expect(context.firestore.listData('settlements/')).toHaveLength(1);
  });

  it('I. unrelated generic transitions keep side effects (DELIVERED + CANCELLED)', async () => {
    const delivered = makeContext({
      order: { status: 'PREPARING', deliveryMethod: 'parcel' },
    });
    await expect(
      delivered.lifecycle.updateStatus('store-1', 'order-1', 'seller-1', {
        status: 'DELIVERED',
      } as never, 'seller'),
    ).resolves.toEqual({ orderId: 'order-1', status: 'DELIVERED' });
    expect(delivered.firestore.listData('settlements/')).toHaveLength(1);
    expect(delivered.firestore.getData('settlements/order-1')).toMatchObject({
      completedStatus: 'DELIVERED',
    });

    const cancelled = makeContext({ order: { status: 'ACCEPTED' } });
    await expect(
      cancelled.lifecycle.updateStatus('store-1', 'order-1', 'seller-1', {
        status: 'CANCELLED',
        reason: '판매자 취소',
      } as never, 'seller'),
    ).resolves.toEqual({ orderId: 'order-1', status: 'CANCELLED' });
    expect(cancelled.firestore.getData('orders/order-1')).toMatchObject({ status: 'CANCELLED' });
  });
});
