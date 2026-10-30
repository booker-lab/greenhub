import { BadRequestException } from '@nestjs/common';
import { OrderCapacityService } from './order-capacity.service';
import { OrdersCreateService } from './orders-create.service';
import { RoundOrderCreateService } from './round-order-create.service';

// 팔도감 벤치마킹 비교 기능(옵션·문구·선물)을 실은 회차 주문 흐름.
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
        {
          id: 'msg',
          name: '축하 토퍼',
          choices: [
            { id: 'none', label: '토퍼 없음', priceDelta: 0 },
            { id: 'topper', label: '祝 開業', priceDelta: 5000 },
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

function request(overrides: RecordData = {}) {
  return {
    clientOrderRequestId: 'payment-attempt-extras',
    productId: 'product-1',
    quantity: 2,
    saleType: 'normal',
    deliveryMethod: 'direct',
    requestedDeliveryDate: '2026-07-21',
    roundId: 'round-1',
    roundItems: [
      { roundItemId: 'round-item-1', quantity: 2, optionChoiceIds: ['ceramic', 'topper'] },
    ],
    deliveryPhone: '010-9999-0000',
    deliveryAddress: { address: '경기도 이천시 중리천로 1', addressDetail: '201호', zipCode: '17373' },
    ...overrides,
  };
}

// features가 undefined면 설정 없이 만든다(테스트·옛 생성부와 같은 기본값 = 모두 꺼짐).
function makeService(firestore: any, features?: string) {
  const capacity = new OrderCapacityService(firestore);
  const retention = { saveRecord: jest.fn().mockResolvedValue({}) };
  const config =
    features === undefined
      ? undefined
      : { get: (key: string) => (key === 'GREENHUB_FEATURES' ? features : undefined) };
  return new RoundOrderCreateService(firestore, capacity, retention as never, config as never);
}

describe('회차 주문 옵션·포장 라벨·선물(벤치마킹 비교 기능)', () => {
  const GIFT = { recipientName: '박꽃님', recipientPhone: '01098765432', senderName: '김그린', cardMessage: '개업 축하해요' };

  it('옵션 금액을 단가에 더하고, 선물 정보와 보내는 분 포장 라벨을 주문서에 남긴다', async () => {
    const { firestore, records } = makeFirestore(seed());
    const result = await makeService(firestore, 'gift').create('store-round', 'user-1', request({ gift: GIFT }));
    const order = records.get(`orders/${(result as any).orderId}`)!;
    expect(order['orderItems'][0]).toMatchObject({
      unitPrice: 43000,
      subtotalAmount: 86000,
      selectedOptions: [
        { groupId: 'pot', groupName: '화분', choiceId: 'ceramic', choiceLabel: '도자기 화분', priceDelta: 8000 },
        { groupId: 'msg', groupName: '축하 토퍼', choiceId: 'topper', choiceLabel: '祝 開業', priceDelta: 5000 },
      ],
    });
    expect(order['totalAmount']).toBe(86000);
    expect(order['gift']).toEqual({ ...GIFT, recipientPhone: '010-9876-5432' });
    expect(order['packageLabel']).toBe('김그린');
    expect((result as any).portonePaymentParams.amount).toBe(86000);
  });

  it('옵션·선물이 없으면 주문서에 새 필드를 만들지 않는다', async () => {
    const { firestore, records } = makeFirestore(
      seed({ 'products/product-1': { id: 'product-1', storeId: 'store-round', name: '호접란', price: 30000 } }),
    );
    const result = await makeService(firestore).create(
      'store-round',
      'user-1',
      request({ roundItems: [{ roundItemId: 'round-item-1', quantity: 1 }] }),
    );
    const order = records.get(`orders/${(result as any).orderId}`)!;
    expect(order['totalAmount']).toBe(30000);
    expect(order).not.toHaveProperty('gift');
    expect(order).not.toHaveProperty('packageLabel');
    expect(order['orderItems'][0]).not.toHaveProperty('selectedOptions');
  });

  it('선물이 아니면 고객이 넣은 포장 라벨 문구를 한 줄로 정리해 남긴다(선물 토글과 무관)', async () => {
    const { firestore, records } = makeFirestore(seed());
    const result = await makeService(firestore).create(
      'store-round',
      'user-1',
      request({ packageLabel: ' 그린\n플라워 ' }),
    );
    const order = records.get(`orders/${(result as any).orderId}`)!;
    expect(order['packageLabel']).toBe('그린 플라워');
    expect(order).not.toHaveProperty('gift');
  });

  it('포장 라벨 문구가 20자를 넘으면 거부하고 아무것도 쓰지 않는다', async () => {
    const { firestore, records } = makeFirestore(seed());
    const before = new Map(records);
    await expect(
      makeService(firestore).create('store-round', 'user-1', request({ packageLabel: '가'.repeat(21) }) as never),
    ).rejects.toThrow('포장 라벨 문구는 20자까지 쓸 수 있어요.');
    expect(records).toEqual(before);
  });

  it('선물과 포장 라벨 문구를 함께 보내면 거부한다(보내는 분 이름이 라벨이다)', async () => {
    const { firestore } = makeFirestore(seed());
    await expect(
      makeService(firestore, 'gift').create(
        'store-round',
        'user-1',
        request({ gift: GIFT, packageLabel: '다른 이름' }) as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('옛 앱이 보낸 상품별 문구(optionText)는 받기만 하고 저장하지 않는다', async () => {
    const { firestore, records } = makeFirestore(seed());
    const result = await makeService(firestore).create(
      'store-round',
      'user-1',
      request({
        roundItems: [
          { roundItemId: 'round-item-1', quantity: 1, optionChoiceIds: ['basic', 'topper'], optionText: '개업 축하' },
        ],
      }),
    );
    const order = records.get(`orders/${(result as any).orderId}`)!;
    expect(JSON.stringify(order)).not.toContain('개업 축하');
    expect(order).not.toHaveProperty('packageLabel');
  });

  it('선물이 켜져 있을 때 받는 분 연락처가 없으면 거부한다', async () => {
    const { firestore } = makeFirestore(seed());
    await expect(
      makeService(firestore, 'gift').create(
        'store-round',
        'user-1',
        request({ gift: { ...GIFT, recipientPhone: '' } }) as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('옵션이 있는 상품을 옵션 없이 주문하면 거부하고 아무것도 쓰지 않는다(화분 옵션 필수)', async () => {
    const { firestore, records } = makeFirestore(seed());
    const before = new Map(records);
    await expect(
      makeService(firestore).create(
        'store-round',
        'user-1',
        request({ roundItems: [{ roundItemId: 'round-item-1', quantity: 1 }] }) as never,
      ),
    ).rejects.toThrow('옵션을 묶음마다 하나씩 골라 주세요.');
    expect(records).toEqual(before);
  });

  it('옵션 묶음 일부만 고르면 거부한다', async () => {
    const { firestore } = makeFirestore(seed());
    await expect(
      makeService(firestore).create(
        'store-round',
        'user-1',
        request({ roundItems: [{ roundItemId: 'round-item-1', quantity: 1, optionChoiceIds: ['basic'] }] }) as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('없는 옵션 선택지는 거부한다', async () => {
    const { firestore } = makeFirestore(seed());
    await expect(
      makeService(firestore).create(
        'store-round',
        'user-1',
        request({ roundItems: [{ roundItemId: 'round-item-1', quantity: 1, optionChoiceIds: ['gold', 'none'] }] }) as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('선물 정보 저장 토글(GREENHUB_FEATURES의 gift)', () => {
  const GIFT = { recipientName: '박꽃님', recipientPhone: '01098765432', senderName: '김그린', cardMessage: '개업 축하해요' };

  async function createWithGift(features: string | undefined, gift: RecordData = GIFT) {
    const { firestore, records } = makeFirestore(seed());
    const result = await makeService(firestore, features).create(
      'store-round',
      'user-1',
      request({ gift }),
    );
    return records.get(`orders/${(result as any).orderId}`)!;
  }

  it.each([
    ['설정 없음', undefined],
    ['빈 값', ''],
    ['공백만', '   '],
    ['다른 키만 켜짐', 'reviews,guest-cart'],
  ])('%s이면 선물 정보를 버리고 주문은 만든다', async (_label, features) => {
    const order = await createWithGift(features);
    expect(order['status']).toBe('PENDING');
    expect(order['totalAmount']).toBe(86000);
    expect(order).not.toHaveProperty('gift');
    expect(order).not.toHaveProperty('packageLabel');
    expect(JSON.stringify(order)).not.toContain('박꽃님');
  });

  it('꺼져 있으면 형식이 틀린 선물 정보도 거부하지 않고 버린다(옛 앱 호환)', async () => {
    const order = await createWithGift('', { ...GIFT, recipientPhone: '' });
    expect(order).not.toHaveProperty('gift');
  });

  it.each([
    ['gift', 'gift'],
    ['all', 'all'],
    ['쉼표 목록', 'reviews, gift'],
  ])('%s이면 선물 정보를 저장한다', async (_label, features) => {
    const order = await createWithGift(features);
    expect(order['gift']).toEqual({ ...GIFT, recipientPhone: '010-9876-5432' });
  });
});

describe('장바구니 확인도 옵션 필수를 같은 판정으로 막는다', () => {
  function makeCartService(firestore: any) {
    const capacity = new OrderCapacityService(firestore);
    const roundCreate = makeService(firestore);
    return new OrdersCreateService(firestore, {} as never, capacity, roundCreate);
  }
  const cart = (roundItems: RecordData[]) =>
    ({
      productId: 'product-1',
      quantity: 1,
      saleType: 'normal',
      deliveryMethod: 'direct',
      roundId: 'round-1',
      roundItems,
      deliveryAddress: { address: '경기도 이천시 중리천로 1', addressDetail: '201호', zipCode: '17373' },
    }) as never;

  it('옵션이 있는 상품을 옵션 없이 담았으면 거부한다', async () => {
    const { firestore } = makeFirestore(seed());
    await expect(
      makeCartService(firestore).validateCart('store-round', 'user-1', cart([{ roundItemId: 'round-item-1', quantity: 1 }])),
    ).rejects.toThrow('옵션을 묶음마다 하나씩 골라 주세요.');
  });

  it('옵션을 묶음마다 골랐으면 통과한다', async () => {
    const { firestore } = makeFirestore(seed());
    await expect(
      makeCartService(firestore).validateCart(
        'store-round',
        'user-1',
        cart([{ roundItemId: 'round-item-1', quantity: 1, optionChoiceIds: ['basic', 'none'] }]),
      ),
    ).resolves.toMatchObject({ ok: true });
  });
});
