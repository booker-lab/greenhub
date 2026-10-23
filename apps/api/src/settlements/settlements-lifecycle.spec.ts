import { SettlementsService } from './settlements.service';
import { createSettledOrdersLifecycle } from '../../test/helpers/settled-orders-lifecycle';

type TestRecord = Record<string, unknown>;
type TransactionCallback = (transaction: TestTransaction) => Promise<unknown>;
type TransactionWrite = {
  kind: 'set' | 'update';
  path: string;
  data: TestRecord;
};
type TestSnapshot = {
  id: string;
  exists: boolean;
  data: () => TestRecord | undefined;
  ref: TestDocumentReference;
};
type TestDocumentReference = {
  path: string;
  get: () => Promise<TestSnapshot>;
  update: (data: TestRecord) => Promise<void>;
};
type TestQuerySnapshot = { empty: boolean; size: number; docs: TestSnapshot[] };
type TestTransaction = {
  get(reference: TestDocumentReference): Promise<TestSnapshot>;
  get(query: TestQuery): Promise<TestQuerySnapshot>;
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
  limit: jest.Mock;
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
      id: path.slice(path.lastIndexOf('/') + 1),
      exists: document !== undefined,
      data: () => data,
      ref: reference,
    };
  }

  private createQuery(
    collectionName: string,
    filters: QueryFilter[],
    orderBy?: string,
    maximum?: number,
  ): TestQuery {
    const query = {
      where: jest.fn((field: string, operator: QueryFilter['operator'], expected: unknown) =>
        this.createQuery(
          collectionName,
          [...filters, { field, operator, expected }],
          orderBy,
          maximum,
        ),
      ),
      orderBy: jest.fn((field: string) =>
        this.createQuery(collectionName, filters, field, maximum),
      ),
      limit: jest.fn((value: number) => this.createQuery(collectionName, filters, orderBy, value)),
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
          .slice(0, maximum)
          .map(([path]) => this.readSnapshot(path));
        return Promise.resolve({
          empty: documents.length === 0,
          size: documents.length,
          docs: documents,
        });
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
      const transaction = {
        get: (target: TestDocumentReference | TestQuery) => {
          if (!('path' in target)) return target.get();
          const reference = target;
          const document = this.documents.get(reference.path);
          readVersions.set(reference.path, document?.version ?? 0);
          const data = document ? copyRecord(document.data) : undefined;
          return Promise.resolve({
            id: reference.path.slice(reference.path.lastIndexOf('/') + 1),
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
      } as TestTransaction;

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
  const service = createSettledOrdersLifecycle(
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

    it('가게에 수수료율이 있으면 그 요율로 계산하고 platformFeeRate에 남긴다', async () => {
      const { firestore, service } = makeSettlementsService({ PLATFORM_FEE_RATE: '0.05' });
      firestore.seed('stores/store-1', { ownerId: 'seller-1', commissionRate: 0.1 });

      await service.createSettlement(
        { id: 'order-store-rate-1', storeId: 'store-1', status: 'DELIVERED', totalAmount: 12345 },
        'DELIVERED',
      );

      expect(firestore.getData('settlements/order-store-rate-1')).toEqual(
        expect.objectContaining({
          totalAmount: 12345,
          platformFeeRate: 0.1,
          platformFee: 1234,
          netAmount: 11111,
        }),
      );
    });

    it('가게 수수료율 0은 수수료 없이 전액을 판매자 지급액으로 남긴다', async () => {
      const { firestore, service } = makeSettlementsService({ PLATFORM_FEE_RATE: '0.05' });
      firestore.seed('stores/store-1', { ownerId: 'seller-1', commissionRate: 0 });

      await service.createSettlement(
        { id: 'order-store-rate-0', storeId: 'store-1', status: 'DELIVERED', totalAmount: 10000 },
        'DELIVERED',
      );

      expect(firestore.getData('settlements/order-store-rate-0')).toEqual(
        expect.objectContaining({ platformFeeRate: 0, platformFee: 0, netAmount: 10000 }),
      );
    });

    it.each([
      ['요율 미설정', {}],
      ['범위를 벗어난 요율', { commissionRate: 1.5 }],
      ['음수 요율', { commissionRate: -0.1 }],
      ['문자열 요율', { commissionRate: '0.1' }],
      ['null 요율', { commissionRate: null }],
    ])('%s 가게는 서버 기본 수수료율로 계산한다', async (_label, store) => {
      const { firestore, service } = makeSettlementsService({ PLATFORM_FEE_RATE: '0.075' });
      firestore.seed('stores/store-1', { ownerId: 'seller-1', ...store });

      await service.createSettlement(
        { id: 'order-default-rate-1', storeId: 'store-1', status: 'DELIVERED', totalAmount: 10001 },
        'DELIVERED',
      );

      expect(firestore.getData('settlements/order-default-rate-1')).toEqual(
        expect.objectContaining({ platformFeeRate: 0.075, platformFee: 750, netAmount: 9251 }),
      );
    });

    it('PLATFORM_FEE_RATE도 없고 가게 요율도 없으면 5%로 계산한다', async () => {
      const { firestore, service } = makeSettlementsService();
      firestore.seed('stores/store-1', { ownerId: 'seller-1' });

      await service.createSettlement(
        { id: 'order-default-5-1', storeId: 'store-1', status: 'DELIVERED', totalAmount: 20000 },
        'DELIVERED',
      );

      expect(firestore.getData('settlements/order-default-5-1')).toEqual(
        expect.objectContaining({ platformFeeRate: 0.05, platformFee: 1000, netAmount: 19000 }),
      );
    });

    it('이미 만든 정산은 가게 수수료율이 바뀌어도 다시 계산하지 않는다', async () => {
      const { firestore, service } = makeSettlementsService({ PLATFORM_FEE_RATE: '0.05' });
      firestore.seed('stores/store-1', { ownerId: 'seller-1', commissionRate: 0.05 });
      const order = {
        id: 'order-rate-change-1',
        storeId: 'store-1',
        status: 'DELIVERED',
        totalAmount: 10000,
      };

      await service.createSettlement(order, 'DELIVERED');
      const first = firestore.getData('settlements/order-rate-change-1');
      firestore.updateOutsideTransaction('stores/store-1', { commissionRate: 0.2 });
      await service.createSettlement({ ...order, status: 'REVIEWED' }, 'REVIEWED');

      expect(firestore.getData('settlements/order-rate-change-1')).toEqual(first);
      expect(first).toEqual(
        expect.objectContaining({ platformFeeRate: 0.05, platformFee: 500, netAmount: 9500 }),
      );
    });

    it('정산을 만드는 사이 가게 수수료율이 바뀌면 트랜잭션을 다시 시도해 바뀐 요율을 쓴다', async () => {
      const { firestore, service } = makeSettlementsService({ PLATFORM_FEE_RATE: '0.05' });
      firestore.seed('stores/store-1', { ownerId: 'seller-1', commissionRate: 0.05 });
      firestore.setBeforeCommit(({ readPaths }) => {
        expect(readPaths).toContain('stores/store-1');
        firestore.updateOutsideTransaction('stores/store-1', { commissionRate: 0.08 });
      });

      await service.createSettlement(
        { id: 'order-rate-race-1', storeId: 'store-1', status: 'DELIVERED', totalAmount: 10000 },
        'DELIVERED',
      );

      expect(firestore.getData('settlements/order-rate-race-1')).toEqual(
        expect.objectContaining({ platformFeeRate: 0.08, platformFee: 800, netAmount: 9200 }),
      );
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

    // 확정은 주문 문서를 읽어 판단하므로, 확정을 기대하는 정산에는 배송 완료 주문을 함께 둔다.
    function seedDeliveredOrder(firestore: FakeFirestore, orderId: string) {
      firestore.seed(`orders/${orderId}`, { id: orderId, storeId: 'store-1', status: 'DELIVERED' });
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
      seedDeliveredOrder(firestore, 'order-due-1');

      await withFixedClock(() => service.confirmDueSettlements());

      expect(firestore.getData('settlements/order-due-1')).toEqual(
        expect.objectContaining({ status: 'confirmed', confirmedAt: FIXED_NOW }),
      );
      expect(firestore.transactionUpdates).toHaveLength(1);
    });

    it('지연 일수 미설정 시 기본 7일: 6일 지난 pending은 유지하고 7일 지난 pending만 확정한다', async () => {
      const { firestore, service } = makeSettlementsService({});
      firestore.seed(
        'settlements/order-default-6d',
        makeSettlement('order-default-6d', 'pending', {
          settledAt: new Date('2026-08-21T00:00:00.000Z'),
        }),
      );
      firestore.seed(
        'settlements/order-default-7d',
        makeSettlement('order-default-7d', 'pending', {
          settledAt: new Date('2026-08-19T23:59:59.999Z'),
        }),
      );
      seedDeliveredOrder(firestore, 'order-default-6d');
      seedDeliveredOrder(firestore, 'order-default-7d');

      await withFixedClock(() => service.confirmDueSettlements());

      expect(firestore.getData('settlements/order-default-6d')?.['status']).toBe('pending');
      expect(firestore.getData('settlements/order-default-7d')).toEqual(
        expect.objectContaining({ status: 'confirmed', confirmedAt: FIXED_NOW }),
      );
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

    it('한 건의 confirm 트랜잭션이 실패해도 나머지는 확정하고 실패 건은 pending으로 남긴다', async () => {
      const { firestore, service } = makeSettlementsService({
        SETTLEMENT_CONFIRM_DELAY_DAYS: '1',
      });
      for (const orderId of ['order-batch-1', 'order-batch-2']) {
        firestore.seed(
          `settlements/${orderId}`,
          makeSettlement(orderId, 'pending', {
            settledAt: new Date('2026-08-25T00:00:00.000Z'),
          }),
        );
        seedDeliveredOrder(firestore, orderId);
      }
      firestore.runTransaction.mockImplementationOnce(() =>
        Promise.reject(new Error('transaction contention')),
      );

      await expect(withFixedClock(() => service.confirmDueSettlements())).resolves.toBeUndefined();

      const statuses = ['order-batch-1', 'order-batch-2']
        .map((orderId) => firestore.getData(`settlements/${orderId}`)?.['status'])
        .sort();
      expect(statuses).toEqual(['confirmed', 'pending']);
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
      seedDeliveredOrder(firestore, 'order-fresh-1');
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
      seedDeliveredOrder(firestore, orderId);
      firestore.setBeforeCommit(async () => {
        await service.cancelSettlement(orderId);
      });

      await withFixedClock(() => service.confirmDueSettlements());

      expect(firestore.getData(`settlements/${orderId}`)?.['status']).toBe('cancelled');
    });

    describe('결제사 취소·분쟁 운영 기록', () => {
      function seedReversalIssue(
        firestore: FakeFirestore,
        issueId: string,
        orderId: string,
        status: 'OPEN' | 'RESOLVED' | 'DISMISSED',
        type = 'PROVIDER_REVERSAL_DETECTED',
      ) {
        firestore.seed(`operationIssues/${issueId}`, {
          id: issueId,
          storeId: 'store-1',
          orderId,
          type,
          status,
          severity: 'critical',
        });
      }

      function seedDuePending(firestore: FakeFirestore, orderId: string) {
        firestore.seed(
          `settlements/${orderId}`,
          makeSettlement(orderId, 'pending', {
            settledAt: new Date('2026-08-25T00:00:00.000Z'),
          }),
        );
        seedDeliveredOrder(firestore, orderId);
      }

      it('OPEN 기록이 있는 주문은 확정하지 않고 pending으로 두며 나머지는 확정한다', async () => {
        const { firestore, service } = makeSettlementsService({
          SETTLEMENT_CONFIRM_DELAY_DAYS: '1',
        });
        seedDuePending(firestore, 'order-reversal-1');
        seedDuePending(firestore, 'order-clean-1');
        seedReversalIssue(firestore, 'issue-1', 'order-reversal-1', 'OPEN');
        const warn = jest
          .spyOn((service as unknown as { logger: { warn: () => void } }).logger, 'warn')
          .mockImplementation(() => undefined);

        await withFixedClock(() => service.confirmDueSettlements());

        expect(firestore.getData('settlements/order-reversal-1')?.['status']).toBe('pending');
        expect(firestore.getData('settlements/order-clean-1')?.['status']).toBe('confirmed');
        expect(firestore.transactionUpdates.map((update) => update.path)).toEqual([
          'settlements/order-clean-1',
        ]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('order-reversal-1'));
        // 기존 기록만 활용하고 새 운영 기록은 만들지 않는다.
        expect(firestore.listData('operationIssues/')).toHaveLength(1);
      });

      it.each([
        ['RESOLVED', 'RESOLVED', 'PROVIDER_REVERSAL_DETECTED'],
        ['DISMISSED', 'DISMISSED', 'PROVIDER_REVERSAL_DETECTED'],
        ['다른 유형의 OPEN', 'OPEN', 'PAYMENT_LOOKUP_FAILED'],
      ] as const)('%s 기록은 확정을 막지 않는다', async (_label, status, type) => {
        const { firestore, service } = makeSettlementsService({
          SETTLEMENT_CONFIRM_DELAY_DAYS: '1',
        });
        seedDuePending(firestore, 'order-reversal-2');
        seedReversalIssue(firestore, 'issue-2', 'order-reversal-2', status, type);

        await withFixedClock(() => service.confirmDueSettlements());

        expect(firestore.getData('settlements/order-reversal-2')?.['status']).toBe('confirmed');
      });

      it('다른 주문의 OPEN 기록은 확정을 막지 않는다', async () => {
        const { firestore, service } = makeSettlementsService({
          SETTLEMENT_CONFIRM_DELAY_DAYS: '1',
        });
        seedDuePending(firestore, 'order-reversal-3');
        seedReversalIssue(firestore, 'issue-3', 'order-other', 'OPEN');

        await withFixedClock(() => service.confirmDueSettlements());

        expect(firestore.getData('settlements/order-reversal-3')?.['status']).toBe('confirmed');
      });

      it('확정 트랜잭션 재시도에서 새로 열린 기록을 다시 읽어 확정하지 않는다', async () => {
        const { firestore, service } = makeSettlementsService({
          SETTLEMENT_CONFIRM_DELAY_DAYS: '1',
        });
        const orderId = 'order-reversal-race-1';
        seedDuePending(firestore, orderId);
        // 첫 시도 commit 직전에 웹훅 기록이 열리고 정산 문서도 바뀌어 트랜잭션이 재시도된다.
        firestore.setBeforeCommit(() => {
          seedReversalIssue(firestore, 'issue-race-1', orderId, 'OPEN');
          firestore.updateOutsideTransaction(`settlements/${orderId}`, {
            updatedAt: new Date('2026-08-26T12:00:00.000Z'),
          });
        });

        await withFixedClock(() => service.confirmDueSettlements());

        expect(firestore.getData(`settlements/${orderId}`)?.['status']).toBe('pending');
        expect(firestore.transactionUpdates).toHaveLength(0);
      });
    });

    describe('주문 상태 보류', () => {
      function seedDue(firestore: FakeFirestore, orderId: string, order: Record<string, unknown> | null) {
        firestore.seed(
          `settlements/${orderId}`,
          makeSettlement(orderId, 'pending', {
            settledAt: new Date('2026-08-25T00:00:00.000Z'),
          }),
        );
        if (order) firestore.seed(`orders/${orderId}`, { id: orderId, storeId: 'store-1', ...order });
      }

      function spyWarn(service: SettlementsService) {
        return jest
          .spyOn((service as unknown as { logger: { warn: () => void } }).logger, 'warn')
          .mockImplementation(() => undefined);
      }

      it.each([
        ['취소된 주문', { status: 'CANCELLED', cancellation: { status: 'COMPLETED' } }],
        ['환불 중인 주문', { status: 'DELIVERED', cancellation: { status: 'REFUNDING' } }],
        ['환불 실패로 멈춘 주문', { status: 'DELIVERED', cancellation: { status: 'REFUND_FAILED' } }],
        ['마무리 대기 주문', { status: 'DELIVERED', cancellation: { status: 'LOCAL_PENDING' } }],
        ['마무리 실패 주문', { status: 'CANCELLED', cancellation: { status: 'LOCAL_FAILED' } }],
      ] as const)('%s의 정산은 확정하지 않고 pending으로 두며 나머지는 확정한다', async (_label, order) => {
        const { firestore, service } = makeSettlementsService({
          SETTLEMENT_CONFIRM_DELAY_DAYS: '1',
        });
        seedDue(firestore, 'order-hold-1', { ...order });
        seedDue(firestore, 'order-clean-2', { status: 'REVIEWED' });
        const warn = spyWarn(service);

        await withFixedClock(() => service.confirmDueSettlements());

        expect(firestore.getData('settlements/order-hold-1')?.['status']).toBe('pending');
        expect(firestore.getData('settlements/order-clean-2')?.['status']).toBe('confirmed');
        expect(firestore.transactionUpdates.map((update) => update.path)).toEqual([
          'settlements/order-clean-2',
        ]);
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('취소·환불이 진행 중이라 확정 보류한 정산: order-hold-1'),
        );
        // 정산 취소나 새 운영 기록은 이 배치가 만들지 않는다.
        expect(firestore.listData('operationIssues/')).toHaveLength(0);
      });

      it('주문 문서가 없는 정산은 판단 근거가 없으므로 확정하지 않는다', async () => {
        const { firestore, service } = makeSettlementsService({
          SETTLEMENT_CONFIRM_DELAY_DAYS: '1',
        });
        seedDue(firestore, 'order-missing-2', null);
        const warn = spyWarn(service);

        await withFixedClock(() => service.confirmDueSettlements());

        expect(firestore.getData('settlements/order-missing-2')?.['status']).toBe('pending');
        expect(firestore.transactionUpdates).toHaveLength(0);
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('주문 문서가 없어 확정 보류한 정산: order-missing-2'),
        );
      });

      it('확정 트랜잭션 재시도에서 새로 시작된 환불을 다시 읽어 확정하지 않는다', async () => {
        const { firestore, service } = makeSettlementsService({
          SETTLEMENT_CONFIRM_DELAY_DAYS: '1',
        });
        const orderId = 'order-hold-race-1';
        seedDue(firestore, orderId, { status: 'DELIVERED' });
        // 첫 시도 commit 직전에 배송 후 환불이 시작돼 주문 문서가 바뀌고 트랜잭션이 재시도된다.
        firestore.setBeforeCommit(() => {
          firestore.updateOutsideTransaction(`orders/${orderId}`, {
            cancellation: { status: 'REFUNDING' },
          });
        });

        await withFixedClock(() => service.confirmDueSettlements());

        expect(firestore.getData(`settlements/${orderId}`)?.['status']).toBe('pending');
        expect(firestore.transactionUpdates).toHaveLength(0);
      });
    });
  });

  describe('cancel 계약', () => {
    it('missing settlement는 no-op이다', async () => {
      const { firestore, service } = makeSettlementsService();

      await expect(service.cancelSettlement('order-missing-1')).resolves.toEqual({
        recoveryRequired: false,
        recoveryAmount: 0,
      });

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

    it.each(['pending', 'confirmed'] as const)(
      '%s 취소는 회수 필요가 아니라고 돌려준다',
      async (status) => {
        const { firestore, service } = makeSettlementsService();
        const orderId = `order-${status}-no-recovery-1`;
        firestore.seed(`settlements/${orderId}`, makeSettlement(orderId, status));

        await expect(service.cancelSettlement(orderId)).resolves.toEqual({
          recoveryRequired: false,
          recoveryAmount: 0,
        });
        expect(firestore.listData('operationIssues/')).toHaveLength(0);
      },
    );

    it('paid는 cancelled로 바꾸지 않고, 회수 필요와 금액을 남기고 관리자 운영 기록을 연다', async () => {
      const { firestore, service } = makeSettlementsService();
      const orderId = 'order-paid-cancel-1';
      const original = makeSettlement(orderId, 'paid', {
        paidAt: new Date('2026-08-26T01:00:00.000Z'),
        updatedAt: new Date('2026-08-26T01:00:00.000Z'),
        netAmount: 9500,
      });
      firestore.seed(`settlements/${orderId}`, original);

      await expect(service.cancelSettlement(orderId)).resolves.toEqual({
        recoveryRequired: true,
        recoveryAmount: 9500,
      });

      expect(firestore.getData(`settlements/${orderId}`)).toEqual({
        ...original,
        recoveryRequired: true,
        recoveryAmount: 9500,
        recoveryRequiredAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      });
      const issues = firestore.listData('operationIssues/');
      expect(issues).toHaveLength(1);
      expect(issues[0]).toEqual(
        expect.objectContaining({
          storeId: 'store-1',
          orderId,
          paymentId: null,
          type: 'SETTLEMENT_RECOVERY_REQUIRED',
          severity: 'critical',
          status: 'OPEN',
          idempotencyKey: `settlement-recovery:${orderId}`,
        }),
      );
      expect(String(issues[0]['message'])).toContain('돌려받아야');
      // 정산 갱신과 운영 기록 생성이 한 트랜잭션에서 함께 커밋된다.
      expect(firestore.transactionUpdates.map((write) => write.path)).toEqual([
        `settlements/${orderId}`,
      ]);
      expect(firestore.transactionSets).toEqual([
        expect.stringMatching(/^operationIssues\//),
      ]);
    });

    it('이미 회수 표시된 paid 정산은 다시 쓰지 않고, 관리자가 닫은 기록을 다시 열지 않는다', async () => {
      const { firestore, service } = makeSettlementsService();
      const orderId = 'order-paid-recovery-again-1';
      firestore.seed(`settlements/${orderId}`, makeSettlement(orderId, 'paid'));

      await service.cancelSettlement(orderId);
      const [issuePath] = firestore.transactionSets;
      firestore.updateOutsideTransaction(issuePath, { status: 'RESOLVED' });
      const settled = firestore.getData(`settlements/${orderId}`);
      const writesBefore =
        firestore.transactionSets.length + firestore.transactionUpdates.length;

      await expect(service.cancelSettlement(orderId)).resolves.toEqual({
        recoveryRequired: true,
        recoveryAmount: 9500,
      });

      expect(firestore.transactionSets.length + firestore.transactionUpdates.length).toBe(
        writesBefore,
      );
      expect(firestore.getData(`settlements/${orderId}`)).toEqual(settled);
      expect(firestore.getData(issuePath)?.['status']).toBe('RESOLVED');
    });

    it('회수 기록 쓰기가 실패하면 정산도 바뀌지 않는다(같은 트랜잭션)', async () => {
      const firestore = new FakeFirestore();
      const configService = { get: jest.fn(() => undefined) };
      const issueWriter = {
        createOrMergeIssue: jest.fn().mockRejectedValue(new Error('운영 기록 실패')),
      };
      const service = new SettlementsService(
        firestore as never,
        configService as never,
        issueWriter as never,
      );
      const orderId = 'order-paid-issue-fail-1';
      const original = makeSettlement(orderId, 'paid');
      firestore.seed(`settlements/${orderId}`, original);

      await expect(service.cancelSettlement(orderId)).rejects.toThrow('운영 기록 실패');

      expect(firestore.getData(`settlements/${orderId}`)).toEqual(original);
      expect(issueWriter.createOrMergeIssue).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SETTLEMENT_RECOVERY_REQUIRED' }),
        expect.anything(),
      );
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
