import { BadRequestException, ConflictException } from '@nestjs/common';
import { CouponsService } from '../coupons/coupons.service';
import { OrderCapacityService } from './order-capacity.service';
import { RoundOrderCreateService } from './round-order-create.service';

// 팔도감 벤치마킹 비교 기능(옵션·쿠폰·선물)을 실은 회차 주문 흐름.
// 이 가짜 Firestore 트랜잭션은 실제처럼 쓰기를 시작한 뒤의 읽기를 거부한다.

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

function seed(extra: Record<string, RecordData> = {}) {
  return {
    'stores/store-round': { id: 'store-round', salesMode: 'round_direct', ownerId: 'seller-1', phone: '010-1111-2222' },
    'users/user-1': { id: 'user-1', name: '고객', phone: '010-3333-4444' },
    'products/product-1': {
      id: 'product-1',
      storeId: 'store-round',
      name: '호접란',
      price: 30000,
      options: [
        {
          id: 'pot',
          name: '화분',
          choices: [
            { id: 'basic', label: '기본 화분', priceDelta: 0 },
            { id: 'ceramic', label: '도자기 화분', priceDelta: 8000 },
          ],
        },
      ],
    },
    'saleRounds/round-1': {
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
    },
    'saleRoundItems/round-item-1': {
      id: 'round-item-1',
      roundId: 'round-1',
      storeId: 'store-round',
      productId: 'product-1',
      productNameSnapshot: '호접란',
      productImageUrlSnapshot: null,
      roundPrice: 30000,
      saleLimitQuantity: 20,
      reservedQuantity: 0,
      orderedQuantity: 0,
      status: 'ACTIVE',
    },
    ...extra,
  };
}

const COUPON = {
  id: 'user-1_coupon-1',
  userId: 'user-1',
  storeId: 'store-round',
  source: 'claim',
  name: '3천원 할인',
  discountType: 'amount',
  value: 3000,
  maxDiscount: null,
  minOrderAmount: 20000,
  endsAt: null,
  status: 'available',
  usedOrderId: null,
  claimedAt: '2026-07-14T00:00:00.000Z',
};

function request(overrides: RecordData = {}) {
  return {
    clientOrderRequestId: 'payment-attempt-extras',
    productId: 'product-1',
    quantity: 2,
    saleType: 'normal',
    deliveryMethod: 'direct',
    requestedDeliveryDate: '2026-07-21',
    roundId: 'round-1',
    roundItems: [{ roundItemId: 'round-item-1', quantity: 2, optionChoiceIds: ['ceramic'] }],
    deliveryPhone: '010-9999-0000',
    deliveryAddress: { address: '경기도 이천시 중리천로 1', addressDetail: '201호', zipCode: '17373' },
    ...overrides,
  };
}

function makeService(firestore: any) {
  const capacity = new OrderCapacityService(firestore);
  const retention = { saveRecord: jest.fn().mockResolvedValue({}) };
  return new RoundOrderCreateService(firestore, capacity, retention as never, new CouponsService(firestore));
}

describe('회차 주문 옵션·쿠폰·선물(벤치마킹 비교 기능)', () => {
  it('옵션 금액을 단가에 더하고, 쿠폰을 빼서 결제 금액을 만들고, 쿠폰을 사용 처리한다', async () => {
    const { firestore, records } = makeFirestore(seed({ 'userCoupons/user-1_coupon-1': COUPON }));
    const result = await makeService(firestore).create(
      'store-round',
      'user-1',
      request({
        couponId: 'user-1_coupon-1',
        gift: { recipientName: '박꽃님', senderName: '김그린', cardMessage: '개업 축하해요' },
      }) as never,
    );
    const order = records.get(`orders/${(result as any).orderId}`)!;
    expect(order['orderItems'][0]).toMatchObject({
      unitPrice: 38000,
      subtotalAmount: 76000,
      selectedOptions: [
        { groupId: 'pot', groupName: '화분', choiceId: 'ceramic', choiceLabel: '도자기 화분', priceDelta: 8000 },
      ],
    });
    expect(order['discountAmount']).toBe(3000);
    expect(order['totalAmount']).toBe(73000);
    expect(order['couponName']).toBe('3천원 할인');
    expect(order['gift']).toEqual({ recipientName: '박꽃님', senderName: '김그린', cardMessage: '개업 축하해요' });
    expect((result as any).portonePaymentParams.amount).toBe(73000);
    expect(records.get('userCoupons/user-1_coupon-1')).toMatchObject({
      status: 'used',
      usedOrderId: (result as any).orderId,
    });
  });

  it('옵션·쿠폰·선물이 없으면 주문서에 새 필드를 만들지 않는다', async () => {
    const { firestore, records } = makeFirestore(seed());
    const result = await makeService(firestore).create(
      'store-round',
      'user-1',
      request({ roundItems: [{ roundItemId: 'round-item-1', quantity: 1 }] }) as never,
    );
    const order = records.get(`orders/${(result as any).orderId}`)!;
    expect(order['totalAmount']).toBe(30000);
    expect(order).not.toHaveProperty('discountAmount');
    expect(order).not.toHaveProperty('gift');
    expect(order['orderItems'][0]).not.toHaveProperty('selectedOptions');
  });

  it('이미 쓴 쿠폰(취소되지 않은 주문)은 거부한다', async () => {
    const { firestore } = makeFirestore(
      seed({
        'userCoupons/user-1_coupon-1': { ...COUPON, status: 'used', usedOrderId: 'order-paid' },
        'orders/order-paid': { id: 'order-paid', status: 'ACCEPTED' },
      }),
    );
    await expect(
      makeService(firestore).create('store-round', 'user-1', request({ couponId: 'user-1_coupon-1' }) as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('취소된 주문에 쓰였던 쿠폰은 다시 쓸 수 있다', async () => {
    const { firestore } = makeFirestore(
      seed({
        'userCoupons/user-1_coupon-1': { ...COUPON, status: 'used', usedOrderId: 'order-cancelled' },
        'orders/order-cancelled': { id: 'order-cancelled', status: 'CANCELLED' },
      }),
    );
    await expect(
      makeService(firestore).create('store-round', 'user-1', request({ couponId: 'user-1_coupon-1' }) as never),
    ).resolves.toBeDefined();
  });

  it('최소 주문 금액에 못 미치면 쿠폰을 거부한다', async () => {
    const { firestore } = makeFirestore(
      seed({ 'userCoupons/user-1_coupon-1': { ...COUPON, minOrderAmount: 100000 } }),
    );
    await expect(
      makeService(firestore).create('store-round', 'user-1', request({ couponId: 'user-1_coupon-1' }) as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('없는 옵션 선택지는 거부한다', async () => {
    const { firestore } = makeFirestore(seed());
    await expect(
      makeService(firestore).create(
        'store-round',
        'user-1',
        request({ roundItems: [{ roundItemId: 'round-item-1', quantity: 1, optionChoiceIds: ['gold'] }] }) as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
