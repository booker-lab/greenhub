import { ConflictException } from '@nestjs/common';
import { LatePaymentCapacityError, OrderCapacityService } from './order-capacity.service';
import { RoundOrderCreateService } from './round-order-create.service';

// 화분처럼 판매자가 직접 만들어 수량을 관리하는 옵션 재고(optionStocks)가 회차 예약과 같은
// 전이로 움직이는지 본다. 이 가짜 Firestore 트랜잭션은 실제처럼 쓰기를 시작한 뒤의 읽기를 거부한다.

type RecordData = Record<string, any>;
const snap = (data: RecordData | null) => ({ exists: data !== null, data: () => data, id: data?.['id'] });

function makeFirestore(initial: Record<string, RecordData>) {
  const records = new Map<string, RecordData>(Object.entries(initial));
  const doc = (path: string) => ({
    path,
    get: async () => snap(records.get(path) ?? null),
    set: async (data: RecordData) => void records.set(path, data),
    update: async (data: RecordData) => void records.set(path, { ...(records.get(path) ?? {}), ...data }),
  });
  const collection = (name: string) => {
    const filters: Array<[string, unknown]> = [];
    const query = {
      where(field: string, _op: string, value: unknown) {
        filters.push([field, value]);
        return query;
      },
      async get() {
        const docs = Array.from(records.entries())
          .filter(([path]) => path.startsWith(`${name}/`) && path.split('/').length === 2)
          .map(([path, data]) => ({ id: path.split('/')[1], data: () => data }))
          .filter((s) => filters.every(([field, value]) => s.data()[field] === value));
        return { docs };
      },
    };
    return query;
  };
  const firestore = {
    doc,
    collection,
    runTransaction: async (callback: (tx: any) => Promise<unknown>) => {
      const pending = new Map<string, RecordData>();
      let wrote = false;
      const tx = {
        get: async (ref: { path?: string; get: () => Promise<unknown> }) => {
          if (wrote) throw new Error('Firestore transactions require all reads before all writes');
          return typeof ref.path === 'string'
            ? snap(pending.get(ref.path) ?? records.get(ref.path) ?? null)
            : ref.get();
        },
        set: (ref: { path: string }, data: RecordData, options?: { merge?: boolean }) => {
          wrote = true;
          const current = pending.get(ref.path) ?? records.get(ref.path) ?? {};
          pending.set(ref.path, options?.merge ? { ...current, ...data } : data);
        },
        update: (ref: { path: string }, data: RecordData) => {
          wrote = true;
          pending.set(ref.path, { ...(pending.get(ref.path) ?? records.get(ref.path) ?? {}), ...data });
        },
      };
      const value = await callback(tx);
      for (const [path, data] of pending) records.set(path, data);
      return value;
    },
    Timestamp: { now: () => new Date('2026-07-15T03:00:00.000+09:00'), fromDate: (d: Date) => d },
    FieldValue: { increment: (value: number) => ({ __increment: value }) },
  };
  return { firestore, records };
}

const ROUND = {
  id: 'round-1',
  storeId: 'store-round',
  status: 'OPEN',
  schedule: {
    orderOpenAt: '2026-07-14T00:00:00.000+09:00',
    orderCloseAt: '2099-07-20T00:00:00.000+09:00',
    timezone: 'Asia/Seoul',
  },
  deliveryRegion: { city: '이천시', enabled: true },
  limits: { maxDeliveryAddresses: 15, maxItemQuantity: 30 },
  counters: {
    reservedDeliveryAddresses: 0,
    reservedItemQuantity: 0,
    orderedDeliveryAddresses: 0,
    orderedItemQuantity: 0,
    heldOrderCount: 0,
  },
};

const POT_OPTIONS = [
  {
    id: 'pot',
    name: '화분',
    choices: [
      { id: 'plastic', label: '기본 화분', priceDelta: 0 },
      { id: 'printed', label: '출력 화분', priceDelta: 7000, stockId: 'stock-pot' },
    ],
  },
];

function roundItem(id: string, productId: string) {
  return {
    id,
    roundId: 'round-1',
    storeId: 'store-round',
    productId,
    productNameSnapshot: productId === 'product-1' ? '호접란' : '몬스테라',
    productImageUrlSnapshot: null,
    roundPrice: 30000,
    saleLimitQuantity: 20,
    maxQuantityPerCustomer: 10,
    reservedQuantity: 0,
    orderedQuantity: 0,
    status: 'ACTIVE',
  };
}

function seed(stockQuantity = 5, extra: Record<string, RecordData> = {}) {
  return {
    'stores/store-round': { id: 'store-round', salesMode: 'round_direct', ownerId: 'seller-1', phone: '010-1111-2222' },
    'users/user-1': { id: 'user-1', name: '고객', phone: '010-3333-4444' },
    // 같은 화분 재고를 두 상품이 함께 쓴다.
    'products/product-1': { id: 'product-1', storeId: 'store-round', name: '호접란', options: POT_OPTIONS },
    'products/product-2': { id: 'product-2', storeId: 'store-round', name: '몬스테라', options: POT_OPTIONS },
    'saleRounds/round-1': ROUND,
    'saleRoundItems/round-item-1': roundItem('round-item-1', 'product-1'),
    'saleRoundItems/round-item-2': roundItem('round-item-2', 'product-2'),
    'optionStocks/stock-pot': {
      id: 'stock-pot',
      storeId: 'store-round',
      name: '흰색 출력 화분',
      stockQuantity,
      reservedQuantity: 0,
      orderedQuantity: 0,
    },
    ...extra,
  };
}

function request(roundItems: RecordData[], requestId = 'attempt-1') {
  return {
    clientOrderRequestId: requestId,
    productId: 'product-1',
    quantity: 1,
    saleType: 'normal',
    deliveryMethod: 'direct',
    requestedDeliveryDate: '2026-07-21',
    roundId: 'round-1',
    roundItems,
    deliveryPhone: '010-9999-0000',
    deliveryAddress: { address: '경기도 이천시 중리천로 1', addressDetail: '201호', zipCode: '17373' },
  } as any;
}

function setup(stockQuantity = 5, extra: Record<string, RecordData> = {}) {
  const { firestore, records } = makeFirestore(seed(stockQuantity, extra));
  const capacity = new OrderCapacityService(firestore as any);
  const retention = { saveRecord: jest.fn().mockResolvedValue({}) };
  const service = new RoundOrderCreateService(firestore as any, capacity, retention as never);
  const stock = () => records.get('optionStocks/stock-pot')!;
  const order = (orderId: string) => records.get(`orders/${orderId}`)!;
  return { firestore, records, capacity, service, stock, order };
}

const printed = (roundItemId: string, quantity: number) => ({
  roundItemId,
  quantity,
  optionChoiceIds: ['printed'],
});

describe('옵션 재고(직접 출력한 화분)와 회차 예약', () => {
  it('재고에 연결된 옵션을 고르면 예약이 그 수량을 잡고 주문 스냅샷에 품목 id를 남긴다', async () => {
    const { service, stock, order, records } = setup(5);
    const result: any = await service.create('store-round', 'user-1', request([printed('round-item-1', 2)]));

    expect(stock()).toMatchObject({ reservedQuantity: 2, orderedQuantity: 0, stockQuantity: 5 });
    expect(order(result.orderId)['orderItems'][0]['selectedOptions'][0]).toMatchObject({
      choiceId: 'printed',
      stockId: 'stock-pot',
    });
    expect(records.get(`checkoutReservations/${result.reservationId}`)!['optionStock']).toEqual([
      { stockId: 'stock-pot', quantity: 2 },
    ]);
  });

  it('두 상품이 같은 재고를 쓰면 합쳐서 한 줄로 잡는다', async () => {
    const { service, stock, records } = setup(3);
    const result: any = await service.create(
      'store-round',
      'user-1',
      request([printed('round-item-1', 1), printed('round-item-2', 2)]),
    );
    expect(stock()['reservedQuantity']).toBe(3);
    expect(records.get(`checkoutReservations/${result.reservationId}`)!['optionStock']).toEqual([
      { stockId: 'stock-pot', quantity: 3 },
    ]);
  });

  it('남은 수량보다 많이 고르면 남은 개수를 알려 주고 아무것도 쓰지 않는다', async () => {
    const { service, stock, records } = setup(3, {
      'optionStocks/stock-pot': {
        id: 'stock-pot',
        storeId: 'store-round',
        name: '흰색 출력 화분',
        stockQuantity: 3,
        reservedQuantity: 1,
        orderedQuantity: 1,
      },
    });
    const attempt = service.create('store-round', 'user-1', request([printed('round-item-1', 2)]));
    await expect(attempt).rejects.toThrow(ConflictException);
    await expect(attempt).rejects.toThrow("'흰색 출력 화분' 옵션은 1개만 남았어요.");
    expect(stock()).toMatchObject({ reservedQuantity: 1, orderedQuantity: 1 });
    expect(records.get('saleRoundItems/round-item-1')!['reservedQuantity']).toBe(0);
    expect([...records.keys()].some((path) => path.startsWith('orders/'))).toBe(false);
  });

  it('다 팔리면 다 팔렸다고 알린다', async () => {
    const { service } = setup(0);
    await expect(
      service.create('store-round', 'user-1', request([printed('round-item-1', 1)])),
    ).rejects.toThrow("'흰색 출력 화분' 옵션은 다 팔렸어요.");
  });

  it('재고에 연결되지 않은 선택지는 재고를 건드리지 않는다', async () => {
    const { service, stock, records } = setup(0);
    const result: any = await service.create(
      'store-round',
      'user-1',
      request([{ roundItemId: 'round-item-1', quantity: 1, optionChoiceIds: ['plastic'] }]),
    );
    expect(stock()['reservedQuantity']).toBe(0);
    expect(records.get(`checkoutReservations/${result.reservationId}`)).not.toHaveProperty('optionStock');
  });

  it('다른 매장의 재고 품목을 가리키면 주문을 받지 않는다', async () => {
    const { service } = setup(5, {
      'optionStocks/stock-pot': {
        id: 'stock-pot',
        storeId: 'store-other',
        name: '다른 가게 화분',
        stockQuantity: 5,
        reservedQuantity: 0,
        orderedQuantity: 0,
      },
    });
    await expect(
      service.create('store-round', 'user-1', request([printed('round-item-1', 1)])),
    ).rejects.toThrow('옵션 재고 품목을 찾을 수 없습니다.');
  });

  it('결제가 확정되면 결제 중 수량을 판매 수량으로 옮긴다', async () => {
    const { service, capacity, stock } = setup(5);
    const result: any = await service.create('store-round', 'user-1', request([printed('round-item-1', 2)]));
    await capacity.consumeReservation({ reservationId: result.reservationId, orderId: result.orderId });
    expect(stock()).toMatchObject({ reservedQuantity: 0, orderedQuantity: 2 });
  });

  it('결제 전 만료·취소는 잡았던 수량을 돌려준다', async () => {
    const { service, capacity, stock } = setup(5);
    const first: any = await service.create('store-round', 'user-1', request([printed('round-item-1', 2)], 'a-1'));
    const second: any = await service.create('store-round', 'user-1', request([printed('round-item-1', 1)], 'a-2'));
    expect(stock()['reservedQuantity']).toBe(3);

    await capacity.releaseReservation(first.reservationId, 'EXPIRED');
    expect(stock()['reservedQuantity']).toBe(1);
    await capacity.releaseReservation(second.reservationId, 'RELEASED');
    expect(stock()['reservedQuantity']).toBe(0);
    // 같은 해제를 다시 불러도 두 번 돌려주지 않는다.
    await capacity.releaseReservation(second.reservationId, 'EXPIRED');
    expect(stock()).toMatchObject({ reservedQuantity: 0, orderedQuantity: 0 });
  });

  it('결제 뒤 환불·취소는 판매 수량을 돌려준다', async () => {
    const { service, capacity, stock, firestore } = setup(5);
    const refunded: any = await service.create('store-round', 'user-1', request([printed('round-item-1', 2)], 'a-1'));
    const cancelled: any = await service.create('store-round', 'user-1', request([printed('round-item-1', 1)], 'a-2'));
    await capacity.consumeReservation({ reservationId: refunded.reservationId, orderId: refunded.orderId });
    await capacity.consumeReservation({ reservationId: cancelled.reservationId, orderId: cancelled.orderId });
    expect(stock()['orderedQuantity']).toBe(3);

    await capacity.releaseReservation(refunded.reservationId, 'RELEASED');
    expect(stock()['orderedQuantity']).toBe(1);

    await firestore.runTransaction((tx: any) =>
      capacity.releaseForOrderCancellationInTransaction(tx, {
        reservationId: cancelled.reservationId,
        storeId: 'store-round',
        roundId: 'round-1',
        decrementHeld: false,
      }),
    );
    expect(stock()).toMatchObject({ reservedQuantity: 0, orderedQuantity: 0 });
  });

  it('재고 카운터가 0 아래로 내려가야 하면 해제를 막는다(조용히 0으로 맞추지 않는다)', async () => {
    const { service, capacity, records } = setup(5);
    const result: any = await service.create('store-round', 'user-1', request([printed('round-item-1', 2)]));
    records.set('optionStocks/stock-pot', { ...records.get('optionStocks/stock-pot')!, reservedQuantity: 1 });
    await expect(capacity.releaseReservation(result.reservationId, 'RELEASED')).rejects.toThrow(
      '옵션 재고 수량 상태가 올바르지 않아 처리할 수 없습니다.',
    );
    expect(records.get(`checkoutReservations/${result.reservationId}`)!['status']).toBe('HELD');
    expect(records.get('saleRoundItems/round-item-1')!['reservedQuantity']).toBe(2);
  });

  describe('늦은 결제 재확보', () => {
    const late = (optionStock: Array<{ stockId: string; quantity: number }>) => ({
      storeId: 'store-round',
      roundId: 'round-1',
      userId: 'user-1',
      orderId: 'order-late',
      paymentId: 'order-late',
      deliveryAddress: { address: '경기도 이천시 중리천로 1', addressDetail: '201호', zipCode: '17373' },
      items: [{ roundItemId: 'round-item-1', quantity: 2 }],
      optionStock,
    });

    it('남은 재고가 있으면 판매 수량으로 바로 잡는다', async () => {
      const { capacity, stock, firestore } = setup(5);
      const reservation: any = await firestore.runTransaction((tx: any) =>
        capacity.reacquireAndConsumeLatePaymentInTransaction(tx, late([{ stockId: 'stock-pot', quantity: 2 }])),
      );
      expect(reservation.optionStock).toEqual([{ stockId: 'stock-pot', quantity: 2 }]);
      expect(stock()).toMatchObject({ reservedQuantity: 0, orderedQuantity: 2 });
    });

    it('재고가 모자라면 늦은 결제 환불로 보내고 아무것도 쓰지 않는다', async () => {
      const { capacity, stock, firestore, records } = setup(1);
      await expect(
        firestore.runTransaction((tx: any) =>
          capacity.reacquireAndConsumeLatePaymentInTransaction(tx, late([{ stockId: 'stock-pot', quantity: 2 }])),
        ),
      ).rejects.toThrow(LatePaymentCapacityError);
      expect(stock()).toMatchObject({ reservedQuantity: 0, orderedQuantity: 0 });
      expect(records.get('saleRoundItems/round-item-1')!['orderedQuantity']).toBe(0);
    });
  });
});
