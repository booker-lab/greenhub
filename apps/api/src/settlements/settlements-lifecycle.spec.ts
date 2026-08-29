import { OrdersLifecycleService } from '../orders/orders-lifecycle.service';
import { SettlementsService } from './settlements.service';

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
type QueryFilter = {
  field: string;
  operator: '==' | '>=' | '<';
  expected: unknown;
};
type TestQuery = {
  where: jest.Mock;
  orderBy: jest.Mock;
  get: jest.Mock;
};
type CommitHookContext = {
  readPaths: string[];
  writes: TransactionWrite[];
};

const FIXED_NOW = new Date('2026-08-27T00:00:00.000Z');

function copyRecord(record: TestRecord): TestRecord {
  return { ...record };
}

function comparable(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return value;
}

function applyPatch(target: TestRecord, patch: TestRecord): TestRecord {
  const next = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (key.includes('.')) {
      const [parent, child] = key.split('.', 2);
      const currentParent =
        next[parent] && typeof next[parent] === 'object'
          ? { ...(next[parent] as TestRecord) }
          : {};
      currentParent[child] = value;
      next[parent] = currentParent;
      continue;
    }
    if (
      value &&
      typeof value === 'object' &&
      '__increment' in (value as TestRecord) &&
      typeof (value as TestRecord)['__increment'] === 'number'
    ) {
      const increment = (value as TestRecord)['__increment'] as number;
      next[key] = (typeof next[key] === 'number' ? next[key] : 0) + increment;
      continue;
    }
    next[key] = value;
  }
  return next;
}

class FakeFirestore {
  private readonly documents = new Map<string, { data: TestRecord; version: number }>();
  private readonly references = new Map<string, TestDocumentReference>();
  private beforeTransactionAttempt?: () => Promise<void> | void;
  private beforeCommit?: (context: CommitHookContext) => Promise<void> | void;

  readonly transactionSets: string[] = [];
  readonly transactionUpdates: Array<{ path: string; data: TestRecord }> = [];
  readonly Timestamp = {
    now: jest.fn(() => new Date(FIXED_NOW)),
    fromDate: jest.fn((date: Date) => date),
  };
  readonly FieldValue = {
    increment: jest.fn((amount: number) => ({ __increment: amount })),
  };
  readonly doc = jest.fn((path: string) => this.getReference(path));
  readonly collection = jest.fn((collectionName: string): TestQuery =>
    this.createQuery(collectionName, []),
  );
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

  setBeforeCommit(hook: ((context: CommitHookContext) => Promise<void> | void) | undefined) {
    this.beforeCommit = hook;
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

  private createQuery(
    collectionName: string,
    filters: QueryFilter[],
    orderBy?: string,
  ): TestQuery {
    const query = {
      where: jest.fn((field: string, operator: QueryFilter['operator'], expected: unknown) =>
        this.createQuery(collectionName, [...filters, { field, operator, expected }], orderBy),
      ),
      orderBy: jest.fn((field: string) => this.createQuery(collectionName, filters, field)),
      get: jest.fn(() => {
        const documents = [...this.documents.entries()]
          .filter(([path]) => path.startsWith(`${collectionName}/`))
          .filter(([, document]) =>
            filters.every(({ field, operator, expected }) => {
              const actual = comparable(document.data[field]);
              const target = comparable(expected);
              if (operator === '==') return actual === target;
              if (operator === '>=') return (actual as number) >= (target as number);
              return (actual as number) < (target as number);
            }),
          )
          .sort(([, left], [, right]) => {
            if (!orderBy) return 0;
            const leftValue = comparable(left.data[orderBy]);
            const rightValue = comparable(right.data[orderBy]);
            return (rightValue as number) - (leftValue as number);
          })
          .map(([path]) => this.readSnapshot(path));
        return Promise.resolve({ empty: documents.length === 0, docs: documents });
      }),
    };
    return query;
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

      if (this.beforeCommit) {
        const hook = this.beforeCommit;
        this.beforeCommit = undefined;
        await hook({ readPaths: [...readVersions.keys()], writes });
      }

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
  }
}

function makeSettlementsService(config: Record<string, string | undefined> = {}) {
  const firestore = new FakeFirestore();
  const configService = { get: jest.fn((key: string) => config[key]) };
  const service = new SettlementsService(firestore as never, configService as never);
  return { firestore, service };
}

function makeOrderLifecycleService(
  firestore: FakeFirestore,
  settlements: SettlementsService,
) {
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
  const roundLifecycle = { updateStatus: jest.fn() };
  const service = new OrdersLifecycleService(
    firestore as never,
    notifications as never,
    payments as never,
    settlements as never,
    capacity as never,
    roundLifecycle as never,
  );
  return { notifications, payments, service };
}

function makeSettlement(
  orderId: string,
  status: 'pending' | 'confirmed' | 'paid' | 'cancelled',
  overrides: TestRecord = {},
): TestRecord {
  const settledAt = new Date('2026-08-24T00:00:00.000Z');
  return {
    id: orderId,
    storeId: 'store-1',
    orderId,
    totalAmount: 10000,
    platformFeeRate: 0.05,
    platformFee: 500,
    netAmount: 9500,
    status,
    completedStatus: 'DELIVERED',
    settledAt,
    confirmedAt: status === 'confirmed' ? new Date('2026-08-26T00:00:00.000Z') : null,
    paidAt: status === 'paid' ? new Date('2026-08-26T00:00:00.000Z') : null,
    createdAt: settledAt,
    updatedAt: settledAt,
    ...overrides,
  };
}

describe('SettlementsService 정산 lifecycle 회귀', () => {
  describe('생성 계약', () => {
    it('완료 주문을 한 건 생성하고 fee/net/status snapshot을 고정한다', async () => {
      const { firestore, service } = makeSettlementsService({ PLATFORM_FEE_RATE: '0.075' });
      const order = {
        id: 'order-create-1',
        storeId: 'store-1',
        status: 'DELIVERED',
        totalAmount: 10001,
      };

      await service.createSettlement(order, 'DELIVERED');

      const settlement = firestore.getData('settlements/order-create-1');
      expect(firestore.listData('settlements/')).toHaveLength(1);
      expect(settlement).toEqual(
        expect.objectContaining({
          id: 'order-create-1',
          storeId: 'store-1',
          orderId: 'order-create-1',
          totalAmount: 10001,
          platformFeeRate: 0.075,
          platformFee: 750,
          netAmount: 9251,
          status: 'pending',
          completedStatus: 'DELIVERED',
          confirmedAt: null,
          paidAt: null,
        }),
      );
      expect(settlement?.['settledAt']).toEqual(FIXED_NOW);
      expect(settlement?.['createdAt']).toEqual(FIXED_NOW);
      expect(settlement?.['updatedAt']).toEqual(FIXED_NOW);
    });

    it('같은 주문의 중복 호출은 추가 생성이나 최초 snapshot 변경을 일으키지 않는다', async () => {
      const { firestore, service } = makeSettlementsService({ PLATFORM_FEE_RATE: '0.05' });
      const order = {
        id: 'order-duplicate-1',
        storeId: 'store-1',
        status: 'DELIVERED',
        totalAmount: 20000,
      };

      await service.createSettlement(order, 'DELIVERED');
      const first = firestore.getData('settlements/order-duplicate-1');
      await service.createSettlement({ ...order, status: 'REVIEWED', totalAmount: 99999 }, 'REVIEWED');

      expect(firestore.transactionSets).toEqual(['settlements/order-duplicate-1']);
      expect(firestore.listData('settlements/')).toHaveLength(1);
      expect(firestore.getData('settlements/order-duplicate-1')).toEqual(first);
    });

    it('동시 완료 호출도 transaction 재시도로 한 건에만 수렴한다', async () => {
      const { firestore, service } = makeSettlementsService();
      const order = {
        id: 'order-concurrent-1',
        storeId: 'store-1',
        status: 'DELIVERED',
        totalAmount: 30000,
      };

      await Promise.all(
        Array.from({ length: 8 }, () => service.createSettlement(order, 'DELIVERED')),
      );

      expect(firestore.listData('settlements/')).toHaveLength(1);
      expect(firestore.transactionSets).toEqual(['settlements/order-concurrent-1']);
    });

    it('DELIVERED 후 REVIEWED에서도 기존 settlement 한 건과 최초 snapshot을 보존한다', async () => {
      const { firestore, service: settlements } = makeSettlementsService();
      const orderId = 'order-reviewed-1';
      firestore.seed(`orders/${orderId}`, {
        id: orderId,
        storeId: 'store-1',
        userId: 'consumer-1',
        status: 'DELIVERED',
        totalAmount: 40000,
      });
      const lifecycle = makeOrderLifecycleService(firestore, settlements).service;

      await lifecycle.reconcileDeliveryCompletion('store-1', orderId);
      const first = firestore.getData(`settlements/${orderId}`);
      await lifecycle.reviewOrder('store-1', orderId, 'consumer-1');

      expect(firestore.listData('settlements/')).toHaveLength(1);
      expect(firestore.getData(`settlements/${orderId}`)).toEqual(first);
      expect(firestore.getData(`settlements/${orderId}`)).toEqual(
        expect.objectContaining({ status: 'pending', completedStatus: 'DELIVERED' }),
      );
    });
  });

  describe('confirm 계약', () => {
    function withFixedClock<T>(callback: () => Promise<T>): Promise<T> {
      const dateNow = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW.getTime());
      return callback().finally(() => dateNow.mockRestore());
    }

    it('cutoff 이전이 아닌 pending은 그대로 유지한다', async () => {
      const { firestore, service } = makeSettlementsService({
        SETTLEMENT_CONFIRM_DELAY_DAYS: '1',
      });
      firestore.seed(
        'settlements/order-cutoff-1',
        makeSettlement('order-cutoff-1', 'pending', {
          settledAt: new Date('2026-08-26T00:00:00.000Z'),
        }),
      );

      await withFixedClock(() => service.confirmDueSettlements());

      expect(firestore.getData('settlements/order-cutoff-1')?.['status']).toBe('pending');
      expect(firestore.transactionUpdates).toHaveLength(0);
    });

    it('cutoff 이후 pending을 confirmed로 전환하고 confirm timestamp를 기록한다', async () => {
      const { firestore, service } = makeSettlementsService({
        SETTLEMENT_CONFIRM_DELAY_DAYS: '1',
      });
      firestore.seed(
        'settlements/order-due-1',
        makeSettlement('order-due-1', 'pending', {
          settledAt: new Date('2026-08-25T23:59:59.999Z'),
        }),
      );

      await withFixedClock(() => service.confirmDueSettlements());

      expect(firestore.getData('settlements/order-due-1')).toEqual(
        expect.objectContaining({ status: 'confirmed', confirmedAt: FIXED_NOW }),
      );
      expect(firestore.transactionUpdates).toHaveLength(1);
    });

    it('이미 confirmed인 settlement는 다시 쓰지 않는다', async () => {
      const { firestore, service } = makeSettlementsService({
        SETTLEMENT_CONFIRM_DELAY_DAYS: '1',
      });
      const confirmedAt = new Date('2026-08-26T01:00:00.000Z');
      firestore.seed(
        'settlements/order-confirmed-1',
        makeSettlement('order-confirmed-1', 'confirmed', {
          settledAt: new Date('2026-08-25T00:00:00.000Z'),
          confirmedAt,
          updatedAt: confirmedAt,
        }),
      );

      await withFixedClock(() => service.confirmDueSettlements());

      expect(firestore.getData('settlements/order-confirmed-1')).toEqual(
        makeSettlement('order-confirmed-1', 'confirmed', {
          settledAt: new Date('2026-08-25T00:00:00.000Z'),
          confirmedAt,
          updatedAt: confirmedAt,
        }),
      );
      expect(firestore.transactionUpdates).toHaveLength(0);
    });

    it('query 결과가 stale여도 transaction의 fresh status가 우선된다', async () => {
      const { firestore, service } = makeSettlementsService({
        SETTLEMENT_CONFIRM_DELAY_DAYS: '1',
      });
      firestore.seed(
        'settlements/order-fresh-1',
        makeSettlement('order-fresh-1', 'pending', {
          settledAt: new Date('2026-08-25T00:00:00.000Z'),
        }),
      );
      firestore.setBeforeTransactionAttempt(() => {
        firestore.updateOutsideTransaction('settlements/order-fresh-1', {
          status: 'confirmed',
        });
      });

      await withFixedClock(() => service.confirmDueSettlements());

      expect(firestore.getData('settlements/order-fresh-1')?.['status']).toBe('confirmed');
      expect(firestore.transactionUpdates).toHaveLength(0);
    });

    it('confirm commit 직전 취소 경합에서도 cancelled를 confirmed로 되살리지 않는다', async () => {
      const { firestore, service } = makeSettlementsService({
        SETTLEMENT_CONFIRM_DELAY_DAYS: '1',
      });
      const orderId = 'order-confirm-cancel-race-1';
      firestore.seed(
        `settlements/${orderId}`,
        makeSettlement(orderId, 'pending', {
          settledAt: new Date('2026-08-25T00:00:00.000Z'),
        }),
      );
      firestore.setBeforeCommit(async () => {
        await service.cancelSettlement(orderId);
      });

      await withFixedClock(() => service.confirmDueSettlements());

      expect(firestore.getData(`settlements/${orderId}`)?.['status']).toBe('cancelled');
    });
  });

  describe('cancel 계약', () => {
    it('missing settlement는 no-op이다', async () => {
      const { firestore, service } = makeSettlementsService();

      await expect(service.cancelSettlement('order-missing-1')).resolves.toBeUndefined();

      expect(firestore.getData('settlements/order-missing-1')).toBeUndefined();
      expect(firestore.transactionUpdates).toHaveLength(0);
    });

    it.each(['pending', 'confirmed'] as const)('%s는 cancelled로 수렴한다', async (status) => {
      const { firestore, service } = makeSettlementsService();
      const orderId = `order-${status}-cancel-1`;
      firestore.seed(`settlements/${orderId}`, makeSettlement(orderId, status));

      await service.cancelSettlement(orderId);

      expect(firestore.getData(`settlements/${orderId}`)?.['status']).toBe('cancelled');
      expect(firestore.transactionUpdates).toHaveLength(1);
    });

    it('cancelled는 멱등 no-op이고 두 번째 write를 만들지 않는다', async () => {
      const { firestore, service } = makeSettlementsService();
      const orderId = 'order-cancelled-cancel-1';
      const original = makeSettlement(orderId, 'cancelled', {
        updatedAt: new Date('2026-08-26T01:00:00.000Z'),
      });
      firestore.seed(`settlements/${orderId}`, original);

      await service.cancelSettlement(orderId);
      await service.cancelSettlement(orderId);

      expect(firestore.getData(`settlements/${orderId}`)).toEqual(original);
      expect(firestore.transactionUpdates).toHaveLength(0);
    });

    it('paid는 cancellation/reversal을 거부하고 paid를 보존한다', async () => {
      const { firestore, service } = makeSettlementsService();
      const orderId = 'order-paid-cancel-1';
      const original = makeSettlement(orderId, 'paid', {
        paidAt: new Date('2026-08-26T01:00:00.000Z'),
        updatedAt: new Date('2026-08-26T01:00:00.000Z'),
      });
      firestore.seed(`settlements/${orderId}`, original);

      await service.cancelSettlement(orderId);

      expect(firestore.getData(`settlements/${orderId}`)).toEqual(original);
      expect(firestore.transactionUpdates).toHaveLength(0);
    });

    it('confirm과 cancel이 동시에 실행되어도 최종 상태는 cancelled이다', async () => {
      const { firestore, service } = makeSettlementsService({
        SETTLEMENT_CONFIRM_DELAY_DAYS: '1',
      });
      const orderId = 'order-cancel-race-1';
      firestore.seed(
        `settlements/${orderId}`,
        makeSettlement(orderId, 'pending', {
          settledAt: new Date('2026-08-25T00:00:00.000Z'),
        }),
      );

      const dateNow = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW.getTime());
      try {
        await Promise.all([service.confirmDueSettlements(), service.cancelSettlement(orderId)]);
      } finally {
        dateNow.mockRestore();
      }

      expect(firestore.getData(`settlements/${orderId}`)?.['status']).toBe('cancelled');
    });
  });

  describe('주문 lifecycle 통합 의미', () => {
    it.each(['pending', 'confirmed'] as const)('정상 취소가 %s settlement를 cancelled로 수렴시킨다', async (status) => {
      const { firestore, service: settlements } = makeSettlementsService();
      const orderId = `order-lifecycle-${status}-1`;
      firestore.seed('stores/store-1', { ownerId: 'seller-1' });
      firestore.seed(`orders/${orderId}`, {
        id: orderId,
        storeId: 'store-1',
        userId: 'consumer-1',
        status: 'PREPARING',
        schemaVersion: 1,
        deliveryMethod: 'parcel',
        totalAmount: 10000,
      });
      firestore.seed(`settlements/${orderId}`, makeSettlement(orderId, status));
      const lifecycle = makeOrderLifecycleService(firestore, settlements).service;

      await expect(
        lifecycle.updateStatus(
          'store-1',
          orderId,
          'seller-1',
          { status: 'CANCELLED', reason: '판매자 취소' },
          'seller',
        ),
      ).resolves.toEqual({ orderId, status: 'CANCELLED' });

      expect(firestore.getData(`orders/${orderId}`)?.['status']).toBe('CANCELLED');
      expect(firestore.getData(`settlements/${orderId}`)?.['status']).toBe('cancelled');
    });

    it('DELIVERED 후 REVIEWED 정상 흐름은 정산을 중복 생성하지 않는다', async () => {
      const { firestore, service: settlements } = makeSettlementsService();
      const orderId = 'order-delivered-reviewed-1';
      firestore.seed(`orders/${orderId}`, {
        id: orderId,
        storeId: 'store-1',
        userId: 'consumer-1',
        status: 'DELIVERED',
        totalAmount: 50000,
      });
      const lifecycle = makeOrderLifecycleService(firestore, settlements).service;

      await lifecycle.reconcileDeliveryCompletion('store-1', orderId);
      await lifecycle.reviewOrder('store-1', orderId, 'consumer-1');

      expect(firestore.listData('settlements/')).toHaveLength(1);
      expect(firestore.transactionSets).toEqual(['settlements/order-delivered-reviewed-1']);
      expect(firestore.getData(`settlements/${orderId}`)).toEqual(
        expect.objectContaining({
          status: 'pending',
          completedStatus: 'DELIVERED',
          totalAmount: 50000,
        }),
      );
    });
  });
});
