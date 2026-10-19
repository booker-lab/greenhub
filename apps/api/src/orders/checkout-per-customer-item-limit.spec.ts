import { ConflictException } from '@nestjs/common';
import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { createInMemoryFirestore } from '../../test/helpers/in-memory-firestore';
import type { CreateOrderDto } from './dto/create-order.dto';
import {
  MAX_ACTIVE_CHECKOUT_HOLDS_PER_USER_ROUND,
  OrderCapacityService,
  resolvePerCustomerItemLimit,
} from './order-capacity.service';
import { RoundOrderCreateService } from './round-order-create.service';

type Data = Record<string, any>;
type Memory = ReturnType<typeof createInMemoryFirestore>;
type Item = { roundItemId: string; quantity: number };
type Created = { orderId: string; reservationId: string };

// 같은 고객이 같은 회차의 한 품목을 결제 중(만료 전 HELD 예약)과 결제 완료(CONSUMED 예약)로
// 합쳐 가질 수 있는 수량에 1인 상한을 둔다. 품목에 maxQuantityPerCustomer가 없으면 판매 한도의
// 절반(올림)이다. 파일럿 회차(품목 3개, 품목당 10개, 회차 30개)에서는 품목마다 5개다.

const PER_CUSTOMER_MESSAGE = '이번 회차에 한 분당';
const HOLD_LIMIT_MESSAGE = '이전 결제 시도를 아직 처리하고 있어요.';
const ITEM_STATE_MESSAGE = '회차 상품 수량 상태가 올바르지 않아 처리할 수 없습니다.';
const SOLD_OUT_MESSAGE = '회차 상품 수량이 마감되었습니다.';
const HELD_HINT = '결제를 마치지 않은 이전 결제 시도는 15분 안에 자동으로 풀려요.';

const ADDRESS = {
  address: '경기도 이천시 중리천로 1',
  addressDetail: '201호',
  zipCode: '17373',
};

function round(id: string): Data {
  return {
    id,
    storeId: 'store-1',
    status: 'OPEN',
    schedule: {
      orderOpenAt: '2026-07-14T00:00:00.000+09:00',
      orderCloseAt: '2099-07-20T00:00:00.000+09:00',
      timezone: 'Asia/Seoul',
    },
    deliveryRegion: { city: '이천시', enabled: true },
    limits: { maxDeliveryAddresses: 30, maxItemQuantity: 30 },
    counters: {
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 0,
      orderedItemQuantity: 0,
      heldOrderCount: 0,
    },
  };
}

function roundItem(id: string, roundId: string, productId: string, overrides: Data = {}): Data {
  return {
    id,
    roundId,
    storeId: 'store-1',
    productId,
    productNameSnapshot: `상품 ${productId}`,
    productImageUrlSnapshot: null,
    roundPrice: 30000,
    saleLimitQuantity: 10,
    reservedQuantity: 0,
    orderedQuantity: 0,
    status: 'ACTIVE',
    ...overrides,
  };
}

function seed(item1: Data = {}): Record<string, Data> {
  return {
    'stores/store-1': { id: 'store-1', salesMode: 'round_direct', ownerId: 'seller-1' },
    'users/user-1': { id: 'user-1', name: '고객', email: 'buyer@example.com' },
    'users/user-2': { id: 'user-2', name: '다른 고객', email: 'other@example.com' },
    'users/user-3': { id: 'user-3', name: '세 번째 고객', email: 'third@example.com' },
    'saleRounds/round-1': round('round-1'),
    'saleRounds/round-2': round('round-2'),
    'saleRoundItems/round-item-1': roundItem('round-item-1', 'round-1', 'product-1', item1),
    'saleRoundItems/round-item-2': roundItem('round-item-2', 'round-1', 'product-2'),
    'saleRoundItems/round-item-3': roundItem('round-item-3', 'round-1', 'product-3'),
    'saleRoundItems/round-item-9': roundItem('round-item-9', 'round-2', 'product-1'),
  };
}

function one(quantity: number, roundItemId = 'round-item-1'): Item[] {
  return [{ roundItemId, quantity }];
}

function dto(requestId: string, items: Item[], roundId: string) {
  return {
    productId: 'product-1',
    quantity: items[0].quantity,
    saleType: 'normal',
    deliveryMethod: 'direct',
    deliveryAddress: ADDRESS,
    deliveryPhone: '010-1234-5678',
    roundId,
    roundItems: items,
    clientOrderRequestId: requestId,
  } as unknown as CreateOrderDto;
}

function creator(firestore: never, capacity: OrderCapacityService) {
  const orders = new RoundOrderCreateService(firestore, capacity, {
    saveRecord: jest.fn().mockResolvedValue({}),
  } as never);
  return (requestId: string, items: Item[] = one(1), userId = 'user-1', roundId = 'round-1') =>
    orders.create('store-1', userId, dto(requestId, items, roundId)) as Promise<Created>;
}

function setup(item1: Data = {}) {
  const memory = createInMemoryFirestore(seed(item1));
  const firestore = memory.firestore as never;
  const capacity = new OrderCapacityService(firestore);
  return { memory, capacity, create: creator(firestore, capacity) };
}

function setupOcc() {
  const occ = createOccFirestore();
  for (const [path, data] of Object.entries(seed())) occ.seed(path, data);
  const firestore = occ.firestore as never;
  const capacity = new OrderCapacityService(firestore);
  const reserve = jest.spyOn(capacity, 'reserveCheckoutInTransaction');
  return { occ, reserve, create: creator(firestore, capacity) };
}

function snapshotAll(memory: Memory) {
  return new Map(
    [...memory.records.entries()].map(([path, data]) => [path, structuredClone(data)]),
  );
}

function heldReservation(id: string, quantity: number, overrides: Data = {}): Data {
  const now = new Date().toISOString();
  return {
    id,
    roundId: 'round-1',
    storeId: 'store-1',
    userId: 'user-1',
    orderId: null,
    paymentId: null,
    status: 'HELD',
    addressKey: 'address-key',
    deliveryAddressCount: 1,
    itemQuantityTotal: quantity,
    items: [
      {
        roundItemId: 'round-item-1',
        productId: 'product-1',
        productName: '상품 product-1',
        productImageUrl: null,
        quantity,
        unitPrice: 30000,
      },
    ],
    idempotencyKey: `checkout:${id}`,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    consumedAt: null,
    releasedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('거절되어야 하는 요청이 성공했습니다.');
}

function expectConflictError(error: unknown, ...texts: string[]) {
  expect(error).toBeInstanceOf(ConflictException);
  const conflict = error as ConflictException;
  expect(conflict.getStatus()).toBe(409);
  for (const text of texts) expect(conflict.message).toContain(text);
}

async function expectConflict(promise: Promise<unknown>, ...texts: string[]) {
  expectConflictError(await rejection(promise), ...texts);
}

function expectPerCustomerLimit(promise: Promise<unknown>, ...texts: string[]) {
  return expectConflict(promise, PER_CUSTOMER_MESSAGE, ...texts);
}

describe('1인 상한 값', () => {
  it('품목에 값이 없으면 판매 한도의 절반을 올림한다(최소 1)', () => {
    expect(resolvePerCustomerItemLimit({ saleLimitQuantity: 10 })).toBe(5);
    expect(resolvePerCustomerItemLimit({ saleLimitQuantity: 11 })).toBe(6);
    expect(resolvePerCustomerItemLimit({ saleLimitQuantity: 3 })).toBe(2);
    expect(resolvePerCustomerItemLimit({ saleLimitQuantity: 2 })).toBe(1);
    expect(resolvePerCustomerItemLimit({ saleLimitQuantity: 1 })).toBe(1);
    expect(
      resolvePerCustomerItemLimit({ saleLimitQuantity: 10, maxQuantityPerCustomer: null }),
    ).toBe(5);
  });

  it('품목의 maxQuantityPerCustomer가 1 이상 정수면 기본 규칙보다 낮든 높든 그 값을 쓴다', () => {
    expect(resolvePerCustomerItemLimit({ saleLimitQuantity: 10, maxQuantityPerCustomer: 2 })).toBe(
      2,
    );
    expect(resolvePerCustomerItemLimit({ saleLimitQuantity: 10, maxQuantityPerCustomer: 10 })).toBe(
      10,
    );
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    '3',
    true,
  ])('maxQuantityPerCustomer가 잘못된 값(%p)이면 판정할 수 없다', (value) => {
    expect(
      resolvePerCustomerItemLimit({ saleLimitQuantity: 10, maxQuantityPerCustomer: value }),
    ).toBeNull();
  });

  it.each([
    undefined,
    0,
    -3,
    Number.POSITIVE_INFINITY,
    '10',
  ])('판매 한도(%p)를 읽을 수 없으면 판정할 수 없다', (value) => {
    expect(resolvePerCustomerItemLimit({ saleLimitQuantity: value })).toBeNull();
  });
});

describe('같은 고객·같은 회차 품목별 1인 수량 상한', () => {
  describe('상한 초과 거부', () => {
    it('한 번에 상한까지는 잡고, 상한을 넘으면 409로 거절하며 아무것도 쓰지 않는다', async () => {
      const { memory, capacity, create } = setup();
      const before = snapshotAll(memory);
      await expectPerCustomerLimit(
        create('attempt-over', one(6)),
        "'상품 product-1' 상품은 이번 회차에 한 분당 5개까지 주문할 수 있어요.",
        '수량을 줄여 다시 시도해 주세요.',
      );
      expect(snapshotAll(memory)).toEqual(before);

      // 예약 단계에서 거절할 때 트랜잭션에 쓰기를 하나도 보내지 않는다(롤백에 기대지 않는다).
      const writes = { set: jest.fn(), update: jest.fn(), delete: jest.fn() };
      await memory.firestore.runTransaction(async (tx: any) => {
        await expectPerCustomerLimit(
          capacity.reserveCheckoutInTransaction(
            { get: tx.get, ...writes },
            {
              storeId: 'store-1',
              roundId: 'round-1',
              userId: 'user-1',
              idempotencyKey: 'checkout:attempt-over',
              deliveryAddress: ADDRESS,
              items: one(6),
            },
          ),
        );
      });
      expect(writes.set).not.toHaveBeenCalled();
      expect(writes.update).not.toHaveBeenCalled();
      expect(writes.delete).not.toHaveBeenCalled();

      const created = await create('attempt-max', one(5));
      expect(memory.read(`checkoutReservations/${created.reservationId}`)).toMatchObject({
        status: 'HELD',
        itemQuantityTotal: 5,
      });
      expect(memory.read('saleRoundItems/round-item-1')?.reservedQuantity).toBe(5);
    });

    it('여러 결제 시도의 결제 중(HELD) 수량을 합산하고, 결제 전 예약이 풀리는 때를 알려 준다', async () => {
      const { memory, create } = setup();
      await create('attempt-1', one(3));
      // 결제창을 닫고 새 결제 시도로 다시 결제해도 이전 시도의 결제 전 예약은 남아 합산된다.
      await expectPerCustomerLimit(
        create('attempt-2', one(3)),
        '결제 중이거나 이미 주문한 수량(3개)이 있어 2개까지만 더 주문할 수 있어요.',
        HELD_HINT,
      );
      await create('attempt-3', one(2));
      await expectPerCustomerLimit(
        create('attempt-4', one(1)),
        '결제 중이거나 이미 주문한 수량(5개)이 있어 더 주문할 수 없어요.',
        HELD_HINT,
      );
      expect(memory.read('saleRoundItems/round-item-1')?.reservedQuantity).toBe(5);
      expect(memory.read('saleRounds/round-1')?.counters).toMatchObject({
        reservedDeliveryAddresses: 2,
        reservedItemQuantity: 5,
      });
    });

    it('결제 완료(CONSUMED) 수량도 합산한다', async () => {
      const { memory, capacity, create } = setup();
      const paid = await create('attempt-1', one(4));
      await capacity.consumeReservation({
        reservationId: paid.reservationId,
        orderId: paid.orderId,
      });
      expect(memory.read(`checkoutReservations/${paid.reservationId}`)?.status).toBe('CONSUMED');

      const error = await rejection(create('attempt-2', one(2)));
      expectConflictError(
        error,
        PER_CUSTOMER_MESSAGE,
        '이미 주문한 수량(4개)이 있어 1개까지만 더 주문할 수 있어요.',
      );
      // 결제가 끝난 수량만 있으면 결제 전 예약 안내는 붙이지 않는다.
      expect((error as Error).message).not.toContain(HELD_HINT);
      await expect(create('attempt-3', one(1))).resolves.toMatchObject({
        orderId: expect.any(String),
      });
    });

    it('늦은 결제로 다시 확보한 예약(CONSUMED)도 결제된 주문이라 합산한다', async () => {
      const { memory, capacity, create } = setup();
      await memory.firestore.runTransaction((tx: any) =>
        capacity.reacquireAndConsumeLatePaymentInTransaction(tx, {
          storeId: 'store-1',
          roundId: 'round-1',
          userId: 'user-1',
          orderId: 'late-order-1',
          paymentId: 'late-order-1',
          deliveryAddress: ADDRESS,
          items: one(4),
        }),
      );

      await expectPerCustomerLimit(create('attempt-1', one(2)), '수량(4개)');
      await expect(create('attempt-2', one(1))).resolves.toMatchObject({
        orderId: expect.any(String),
      });
    });

    it('품목마다 따로 세고, 요청 중 한 품목이라도 넘으면 요청 전체를 거절한다', async () => {
      const { memory, create } = setup();
      await create('attempt-1', one(5, 'round-item-1'));
      await create('attempt-2', [
        { roundItemId: 'round-item-2', quantity: 5 },
        { roundItemId: 'round-item-3', quantity: 4 },
      ]);
      const before = snapshotAll(memory);

      await expectPerCustomerLimit(
        create('attempt-3', [
          { roundItemId: 'round-item-3', quantity: 1 },
          { roundItemId: 'round-item-2', quantity: 1 },
        ]),
        "'상품 product-2' 상품은",
      );
      expect(snapshotAll(memory)).toEqual(before);
      expect(memory.read('saleRoundItems/round-item-3')?.reservedQuantity).toBe(4);
    });

    it('다른 고객·다른 회차·다른 가게의 예약은 세지 않는다', async () => {
      const { memory, create } = setup();
      await create('other-user', one(5), 'user-2');
      await create('other-round', one(5, 'round-item-9'), 'user-1', 'round-2');
      memory.records.set(
        'checkoutReservations/foreign-store',
        heldReservation('foreign-store', 5, { storeId: 'store-2' }),
      );

      await expect(create('attempt-1', one(5))).resolves.toMatchObject({
        orderId: expect.any(String),
      });
      expect(memory.read('saleRoundItems/round-item-1')?.reservedQuantity).toBe(10);
      await expectPerCustomerLimit(
        create('attempt-2', one(1, 'round-item-9'), 'user-1', 'round-2'),
      );
    });

    it('전체 한도가 먼저 마감되면 기존 마감 안내를 그대로 보여 준다', async () => {
      const { create } = setup();
      await create('user-2-attempt', one(5), 'user-2');
      await create('user-3-attempt', one(4), 'user-3');

      await expectConflict(create('attempt-1', one(6)), SOLD_OUT_MESSAGE);
      await expect(create('attempt-2', one(1))).resolves.toMatchObject({
        orderId: expect.any(String),
      });
    });
  });

  describe('품목의 maxQuantityPerCustomer', () => {
    it('값이 있으면 기본 규칙 대신 그 값을 쓴다(낮춤)', async () => {
      const { create } = setup({ maxQuantityPerCustomer: 2 });
      await expectPerCustomerLimit(create('attempt-1', one(3)), '한 분당 2개까지');
      await create('attempt-2', one(2));
      await expectPerCustomerLimit(create('attempt-3', one(1)), '수량(2개)');
    });

    it('값이 있으면 기본 규칙 대신 그 값을 쓴다(높임)', async () => {
      const { memory, create } = setup({ maxQuantityPerCustomer: 10 });
      await create('attempt-1', one(10));
      expect(memory.read('saleRoundItems/round-item-1')?.reservedQuantity).toBe(10);
    });

    it.each([
      0,
      -1,
      1.5,
      '3',
    ])('값(%p)이 1 이상 정수가 아니면 설정 오류로 보고 아무것도 쓰지 않고 거절한다', async (value) => {
      const { memory, create } = setup({ maxQuantityPerCustomer: value });
      const before = snapshotAll(memory);
      await expectConflict(create('attempt-1', one(1)), ITEM_STATE_MESSAGE);
      expect(snapshotAll(memory)).toEqual(before);
    });
  });

  describe('합산에서 빼는 예약', () => {
    it('만료 시각이 지난 HELD는 세지 않고, 그 예약은 만료 정리 작업에 남겨 둔다', async () => {
      const { memory, create } = setup();
      const lapsed = await create('attempt-1', one(3));
      memory.records.set(`checkoutReservations/${lapsed.reservationId}`, {
        ...memory.read(`checkoutReservations/${lapsed.reservationId}`),
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });

      // 만료된 3개를 셌다면 3 + 5 = 8로 거절됐을 요청이다.
      await expect(create('attempt-2', one(5))).resolves.toMatchObject({
        orderId: expect.any(String),
      });
      // 만료된 HELD는 만료 정리 작업이 맡는다. 새 시도가 반환하지 않고, 정리 전까지 품목 한도는 차지한다.
      expect(memory.read(`checkoutReservations/${lapsed.reservationId}`)?.status).toBe('HELD');
      expect(memory.read('saleRoundItems/round-item-1')?.reservedQuantity).toBe(8);
      await expectPerCustomerLimit(create('attempt-3', one(1)), '수량(5개)');
    });

    it('만료(EXPIRED)·해제(RELEASED)된 예약은 세지 않는다', async () => {
      const { memory, capacity, create } = setup();
      const expired = await create('attempt-1', one(5));
      await capacity.releaseReservation(expired.reservationId, 'EXPIRED');
      const released = await create('attempt-2', one(5));
      await capacity.releaseReservation(released.reservationId, 'RELEASED');
      expect(
        [expired, released].map(
          ({ reservationId }) => memory.read(`checkoutReservations/${reservationId}`)?.status,
        ),
      ).toEqual(['EXPIRED', 'RELEASED']);

      await expect(create('attempt-3', one(5))).resolves.toMatchObject({
        orderId: expect.any(String),
      });
    });

    it('결제 뒤 취소된 주문의 수량은 세지 않는다', async () => {
      const { memory, capacity, create } = setup();
      const paid = await create('attempt-1', one(5));
      await capacity.consumeReservation({
        reservationId: paid.reservationId,
        orderId: paid.orderId,
      });
      await expectPerCustomerLimit(create('attempt-2', one(1)), '수량(5개)');

      // 주문 취소는 같은 트랜잭션에서 예약을 CONSUMED → RELEASED로 돌려 한도를 반환한다.
      await memory.firestore.runTransaction((tx: any) =>
        capacity.releaseForOrderCancellationInTransaction(tx, {
          reservationId: paid.reservationId,
          storeId: 'store-1',
          roundId: 'round-1',
          decrementHeld: false,
        }),
      );
      expect(memory.read(`checkoutReservations/${paid.reservationId}`)?.status).toBe('RELEASED');

      await expect(create('attempt-3', one(5))).resolves.toMatchObject({
        orderId: expect.any(String),
      });
    });
  });

  describe('동시 요청 경쟁', () => {
    it('같은 고객이 동시에 낸 두 결제는 한쪽만 예약하고 다른 쪽은 재시도에서 상한으로 거절된다', async () => {
      const { occ, reserve, create } = setupOcc();
      const results = await Promise.allSettled([
        create('race-a', one(3)),
        create('race-b', one(3)),
      ]);

      // 두 결제가 같은 상태를 읽고 다툰 뒤, 진 쪽이 먼저 끝난 예약을 보고 다시 판정했다.
      expect(reserve).toHaveBeenCalledTimes(3);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      expect(rejected).toHaveLength(1);
      expectConflictError(rejected[0].reason, PER_CUSTOMER_MESSAGE, '2개까지만');

      const reservations = occ.listData('checkoutReservations/');
      expect(reservations).toHaveLength(1);
      expect(reservations[0]).toMatchObject({ status: 'HELD', itemQuantityTotal: 3 });
      expect(occ.listData('orders/')).toHaveLength(1);
      expect(occ.getData('saleRoundItems/round-item-1')?.['reservedQuantity']).toBe(3);
      expect(occ.getData('saleRounds/round-1')?.['counters']).toMatchObject({
        reservedDeliveryAddresses: 1,
        reservedItemQuantity: 3,
      });
    });

    it('같은 고객의 동시 결제라도 합이 상한 이내면 둘 다 예약한다', async () => {
      const { occ, reserve, create } = setupOcc();
      const results = await Promise.allSettled([
        create('race-a', one(3)),
        create('race-b', one(2)),
      ]);

      expect(reserve).toHaveBeenCalledTimes(3);
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(occ.listData('checkoutReservations/')).toHaveLength(2);
      expect(occ.getData('saleRoundItems/round-item-1')?.['reservedQuantity']).toBe(5);
    });

    it('서로 다른 고객은 동시에 각자 상한까지 예약한다', async () => {
      const { occ, create } = setupOcc();
      const results = await Promise.allSettled([
        create('race-a', one(5), 'user-1'),
        create('race-b', one(5), 'user-2'),
      ]);

      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(occ.getData('saleRoundItems/round-item-1')?.['reservedQuantity']).toBe(10);
    });
  });

  describe('기존 활성 예약 3건 제한과 함께 동작', () => {
    it('수량 여유가 있어도 4번째 결제 시도는 3건 제한으로 거절한다', async () => {
      const { create } = setup();
      expect(MAX_ACTIVE_CHECKOUT_HOLDS_PER_USER_ROUND).toBe(3);
      await create('attempt-1', one(1));
      await create('attempt-2', one(1));
      await create('attempt-3', one(1));
      await expectConflict(create('attempt-4', one(1)), HOLD_LIMIT_MESSAGE);
    });

    it('3건 전이라도 수량 상한을 채우면 1인 상한으로 거절한다', async () => {
      const { create } = setup();
      await create('attempt-1', one(3));
      await create('attempt-2', one(2));
      await expectPerCustomerLimit(create('attempt-3', one(1)), '수량(5개)');
    });

    it('둘 다 넘으면 3건 제한 안내가 먼저다', async () => {
      const { create } = setup();
      await create('attempt-1', one(2));
      await create('attempt-2', one(2));
      await create('attempt-3', one(1));
      await expectConflict(create('attempt-4', one(1)), HOLD_LIMIT_MESSAGE);
    });

    it('상한에 도달해도 같은 결제 시도 ID 재요청은 기존 주문·예약을 그대로 돌려준다', async () => {
      const { memory, capacity, create } = setup();
      const first = await create('attempt-1', one(3));
      const second = await create('attempt-2', one(2));
      const before = snapshotAll(memory);

      await expect(create('attempt-1', one(3))).resolves.toEqual(first);
      const replayed = await capacity.reserveCheckout({
        storeId: 'store-1',
        roundId: 'round-1',
        userId: 'user-1',
        idempotencyKey: 'checkout:attempt-2',
        deliveryAddress: ADDRESS,
        items: one(2),
      });
      expect(replayed).toEqual(memory.read(`checkoutReservations/${second.reservationId}`));
      expect(snapshotAll(memory)).toEqual(before);
    });
  });
});
