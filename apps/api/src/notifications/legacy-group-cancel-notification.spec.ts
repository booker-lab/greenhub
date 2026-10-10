import { NotificationsService } from './notifications.service';

type Data = Record<string, any>;

function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Data).map(([key, item]) => [key, clone(item)]),
    ) as T;
  }
  return value;
}

function makeFirestore(initial: Record<string, Data>) {
  const records = new Map<string, Data>(
    Object.entries(initial).map(([path, data]) => [path, clone(data)]),
  );
  const refs = new Map<string, any>();
  let transactionQueue = Promise.resolve();

  function snapshot(path: string, source: Map<string, Data>) {
    const data = source.get(path);
    return {
      exists: data !== undefined,
      id: path.split('/').at(-1),
      data: () => (data === undefined ? undefined : clone(data)),
    };
  }

  function ref(path: string) {
    if (!refs.has(path)) {
      refs.set(path, {
        path,
        id: path.split('/').at(-1),
        get: jest.fn(async () => snapshot(path, records)),
        set: jest.fn(async (data: Data) => {
          records.set(path, clone(data));
        }),
        update: jest.fn(async (data: Data) => {
          records.set(path, { ...(records.get(path) ?? {}), ...clone(data) });
        }),
      });
    }
    return refs.get(path);
  }

  function collection(name: string) {
    const filters: Array<[string, unknown]> = [];
    const query: any = {
      where: jest.fn((field: string, _operator: string, value: unknown) => {
        filters.push([field, value]);
        return query;
      }),
      get: jest.fn(async () => {
        const prefix = `${name}/`;
        const docs = Array.from(records.entries())
          .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
          .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
          .map(([path, data]) => ({
            id: path.slice(prefix.length),
            data: () => clone(data),
            ref: ref(path),
          }));
        return { empty: docs.length === 0, docs };
      }),
    };
    return query;
  }

  const firestore = {
    collection: jest.fn((name: string) => collection(name)),
    doc: jest.fn((path: string) => ref(path)),
    runTransaction: jest.fn((callback: (tx: any) => Promise<unknown>) => {
      const result = transactionQueue.then(async () => {
        const staged = new Map<string, Data>(
          Array.from(records.entries()).map(([path, data]) => [path, clone(data)]),
        );
        const transaction = {
          get: jest.fn(async (document: { path: string }) => snapshot(document.path, staged)),
          set: jest.fn((document: { path: string }, data: Data) => {
            staged.set(document.path, clone(data));
          }),
          update: jest.fn((document: { path: string }, data: Data) => {
            const current = staged.get(document.path);
            if (!current) throw new Error(`존재하지 않는 문서입니다: ${document.path}`);
            staged.set(document.path, { ...current, ...clone(data) });
          }),
        };
        const value = await callback(transaction);
        records.clear();
        for (const [path, data] of staged) records.set(path, data);
        return value;
      });
      transactionQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    }),
    Timestamp: {
      now: jest.fn(() => new Date('2026-09-24T00:00:00.000Z')),
      fromDate: jest.fn((date: Date) => new Date(date.getTime())),
    },
  };

  return { firestore, read: (path: string) => clone(records.get(path)) };
}

const productName = '테스트 공동구매';
const reason = '목표 수량 미달성으로 취소';

function order(id: string, userId: string, overrides: Data = {}): Data {
  return { id, productId: 'product-1', userId, status: 'RECRUITING', ...overrides };
}

function baseRecords(orders: Data[]): Record<string, Data> {
  const records: Record<string, Data> = {
    'products/product-1': { id: 'product-1', name: productName, storeId: 'store-1' },
    'stores/store-1': { id: 'store-1', ownerId: 'seller-1' },
  };
  for (const item of orders) records[`orders/${item.id}`] = item;
  return records;
}

function makeService(initial: Record<string, Data>) {
  const memory = makeFirestore(initial);
  const payments = { processRefundByOrderId: jest.fn().mockResolvedValue(undefined) };
  const service = new (NotificationsService as any)(memory.firestore, {}, payments, {
    createOrMergeIssue: jest.fn(),
  }) as NotificationsService;
  const sendToUser = jest.spyOn(service, 'sendToUser').mockResolvedValue(undefined);
  return { service, memory, payments, sendToUser };
}

describe('legacy 목표 미달 공동구매 취소 알림', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('취소 대상 participant snapshot을 기준으로 consumer GROUP_CANCELLED_LACK를 정확히 1회 전달한다', async () => {
    const { service, memory, payments, sendToUser } = makeService(
      baseRecords([order('order-1', 'consumer-1'), order('order-2', 'consumer-2')]),
    );

    await (service as any).cancelGroupBuyLack('product-1', {
      currentQuantity: 1,
      minQuantity: 2,
    });

    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(2);

    const consumerCalls = sendToUser.mock.calls.filter(
      ([, template]) => template === 'GROUP_CANCELLED_LACK',
    );
    expect(consumerCalls).toHaveLength(2);
    expect(consumerCalls).toEqual(
      expect.arrayContaining([
        [
          'consumer-1',
          'GROUP_CANCELLED_LACK',
          { productName },
          'order-1',
          'group-buy:product-1:GROUP_CANCELLED_LACK:order-1',
        ],
        [
          'consumer-2',
          'GROUP_CANCELLED_LACK',
          { productName },
          'order-2',
          'group-buy:product-1:GROUP_CANCELLED_LACK:order-2',
        ],
      ]),
    );

    const sellerCalls = sendToUser.mock.calls.filter(
      ([, template]) => template === 'SELLER_GROUP_CANCELLED_LACK',
    );
    expect(sellerCalls).toEqual([
      [
        'seller-1',
        'SELLER_GROUP_CANCELLED_LACK',
        { productName, currentQuantity: '1', minQuantity: '2' },
        undefined,
        'group-buy:product-1:SELLER_GROUP_CANCELLED_LACK',
      ],
    ]);

    expect(memory.read('orders/order-1')).toMatchObject({
      status: 'CANCELLED',
      cancelReason: reason,
    });
    expect(memory.read('orders/order-2')).toMatchObject({
      status: 'CANCELLED',
      cancelReason: reason,
    });
  });

  it('consumer exclusive ownership 주문은 취소 대상에서 제외하고 알림도 보내지 않는다', async () => {
    const { service, memory, payments, sendToUser } = makeService(
      baseRecords([
        order('order-1', 'consumer-1', { cancellation: { status: 'REFUNDING' } }),
        order('order-2', 'consumer-2'),
      ]),
    );

    await (service as any).cancelGroupBuyLack('product-1', {
      currentQuantity: 1,
      minQuantity: 2,
    });

    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(payments.processRefundByOrderId).toHaveBeenCalledWith('order-2', reason);

    const consumerCalls = sendToUser.mock.calls.filter(
      ([, template]) => template === 'GROUP_CANCELLED_LACK',
    );
    expect(consumerCalls).toHaveLength(1);
    expect(consumerCalls[0][0]).toBe('consumer-2');
    expect(memory.read('orders/order-1')).toMatchObject({ status: 'RECRUITING' });
  });

  it('다른 template의 sendToGroupParticipants terminal filtering은 그대로 유지된다', async () => {
    const { service, sendToUser } = makeService(
      baseRecords([
        order('order-1', 'consumer-1', { status: 'RECRUITING' }),
        order('order-2', 'consumer-2', { status: 'CANCELLED' }),
        order('order-3', 'consumer-3', { status: 'PENDING' }),
        order('order-4', 'consumer-4', { status: 'REVIEWED' }),
        order('order-5', 'consumer-5', { status: 'PREPARING' }),
      ]),
    );

    await service.sendToGroupParticipants('product-1', 'GROUP_DEADLINE_SOON', {
      productName,
      remaining: '1',
    });

    expect(
      sendToUser.mock.calls
        .filter(([, template]) => template === 'GROUP_DEADLINE_SOON')
        .map(([userId]) => userId)
        .sort(),
    ).toEqual(['consumer-1', 'consumer-5']);
  });
});

describe('legacy 공동구매 확정·취소 처리 lease', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function groupConfig(overrides: Data = {}): Data {
    return {
      productId: 'product-1',
      currentQuantity: 2,
      minQuantity: 2,
      targetQuantity: 2,
      groupDeliveryDate: '2026-10-20',
      isProcessed: false,
      ...overrides,
    };
  }

  // 메모리 mock의 where는 동등 비교만 지원하므로, 마감·임박 쿼리는 미처리 설정 문서를 그대로 돌려준다.
  function withGroupConfigQuery(memory: ReturnType<typeof makeFirestore>) {
    const original = memory.firestore.collection.getMockImplementation()!;
    memory.firestore.collection.mockImplementation((name: string) => {
      if (name !== 'groupProductConfig') return original(name);
      const query: any = {
        where: jest.fn(() => query),
        get: jest.fn(async () => {
          const data = memory.read('groupProductConfig/product-1');
          const docs =
            data && data['isProcessed'] === false
              ? [
                  {
                    id: 'product-1',
                    data: () => data,
                    ref: memory.firestore.doc('groupProductConfig/product-1'),
                  },
                ]
              : [];
          return { empty: docs.length === 0, docs };
        }),
      };
      return query;
    });
  }

  it('cron이 겹쳐 실행돼도 확정 처리와 확정 알림은 주문당 1회이고 멱등 키를 붙인다', async () => {
    const { service, memory, sendToUser } = makeService({
      ...baseRecords([order('order-1', 'consumer-1'), order('order-2', 'consumer-2')]),
      'groupProductConfig/product-1': groupConfig(),
    });
    withGroupConfigQuery(memory);

    await Promise.all([service.processGroupBuyDeadlines(), service.processGroupBuyDeadlines()]);
    await service.processGroupBuyDeadlines();

    const confirmedCalls = sendToUser.mock.calls.filter(
      ([, template]) => template === 'GROUP_CONFIRMED',
    );
    expect(confirmedCalls).toHaveLength(2);
    expect(confirmedCalls.map((call) => call[4]).sort()).toEqual([
      'group-buy:product-1:GROUP_CONFIRMED:order-1',
      'group-buy:product-1:GROUP_CONFIRMED:order-2',
    ]);
    expect(
      sendToUser.mock.calls.filter(([, template]) => template === 'SELLER_GROUP_CONFIRMED'),
    ).toEqual([
      [
        'seller-1',
        'SELLER_GROUP_CONFIRMED',
        { productName, currentQuantity: '2' },
        undefined,
        'group-buy:product-1:SELLER_GROUP_CONFIRMED',
      ],
    ]);
    expect(memory.read('groupProductConfig/product-1')).toMatchObject({
      isProcessed: true,
      processingLease: null,
    });
    expect(memory.read('orders/order-1')).toMatchObject({ status: 'CONFIRMED' });
  });

  it('조기 확정이 먼저 처리하면 마감 cron은 같은 상품을 다시 처리하지 않는다', async () => {
    const { service, memory, sendToUser } = makeService({
      ...baseRecords([order('order-1', 'consumer-1')]),
      'groupProductConfig/product-1': groupConfig(),
    });
    withGroupConfigQuery(memory);

    await Promise.all([
      service.processGroupBuyEarlyConfirm('product-1'),
      service.processGroupBuyDeadlines(),
    ]);

    expect(
      sendToUser.mock.calls.filter(([, template]) => template === 'GROUP_CONFIRMED'),
    ).toHaveLength(1);
    expect(memory.read('groupProductConfig/product-1')).toMatchObject({ isProcessed: true });
  });

  it('다른 실행이 유효한 lease를 가지고 있으면 처리하지 않는다', async () => {
    const { service, memory, sendToUser } = makeService({
      ...baseRecords([order('order-1', 'consumer-1')]),
      'groupProductConfig/product-1': groupConfig({
        processingLease: { id: 'other-run', expiresAt: Date.now() + 60_000 },
      }),
    });
    withGroupConfigQuery(memory);

    await service.processGroupBuyDeadlines();

    expect(sendToUser).not.toHaveBeenCalled();
    expect(memory.read('orders/order-1')).toMatchObject({ status: 'RECRUITING' });
    expect(memory.read('groupProductConfig/product-1')).toMatchObject({
      isProcessed: false,
      processingLease: { id: 'other-run' },
    });
  });

  it('만료된 lease는 다시 잡아 처리한다', async () => {
    const { service, memory, sendToUser } = makeService({
      ...baseRecords([order('order-1', 'consumer-1')]),
      'groupProductConfig/product-1': groupConfig({
        processingLease: { id: 'crashed-run', expiresAt: Date.now() - 1 },
      }),
    });
    withGroupConfigQuery(memory);

    await service.processGroupBuyDeadlines();

    expect(
      sendToUser.mock.calls.filter(([, template]) => template === 'GROUP_CONFIRMED'),
    ).toHaveLength(1);
    expect(memory.read('groupProductConfig/product-1')).toMatchObject({
      isProcessed: true,
      processingLease: null,
    });
  });

  it('처리 중 실패하면 lease를 풀고 isProcessed를 남기지 않아 다음 실행이 다시 처리한다', async () => {
    const { service, memory, payments, sendToUser } = makeService({
      ...baseRecords([order('order-1', 'consumer-1')]),
      'groupProductConfig/product-1': groupConfig({ currentQuantity: 1 }),
    });
    withGroupConfigQuery(memory);
    payments.processRefundByOrderId.mockRejectedValueOnce(new Error('refund infra down'));

    await expect(service.processGroupBuyDeadlines()).rejects.toThrow('refund infra down');
    expect(memory.read('groupProductConfig/product-1')).toMatchObject({
      isProcessed: false,
      processingLease: null,
    });
    expect(sendToUser).not.toHaveBeenCalled();

    await service.processGroupBuyDeadlines();

    expect(memory.read('orders/order-1')).toMatchObject({ status: 'CANCELLED' });
    expect(memory.read('groupProductConfig/product-1')).toMatchObject({ isProcessed: true });
    expect(
      sendToUser.mock.calls.filter(([, template]) => template === 'GROUP_CANCELLED_LACK'),
    ).toHaveLength(1);
  });

  it('마감 임박 알림은 상품·주문 단위 멱등 키로 보낸다', async () => {
    const { service, memory, sendToUser } = makeService({
      ...baseRecords([order('order-1', 'consumer-1')]),
      'groupProductConfig/product-1': groupConfig({ currentQuantity: 1 }),
    });
    withGroupConfigQuery(memory);

    await service.notifyDeadlineSoon();

    expect(sendToUser).toHaveBeenCalledWith(
      'consumer-1',
      'GROUP_DEADLINE_SOON',
      expect.objectContaining({ productName, remaining: '1' }),
      'order-1',
      'group-deadline-soon:product-1:order-1',
    );
  });
});
