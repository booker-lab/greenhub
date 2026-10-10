import { ConflictException } from '@nestjs/common';
import { createInMemoryFirestore } from '../../test/helpers/in-memory-firestore';
import { PaymentFinalizationService } from '../payments/payment-finalization.service';
import type { CreateOrderDto } from './dto/create-order.dto';
import {
  MAX_ACTIVE_CHECKOUT_HOLDS_PER_USER_ROUND,
  OrderCapacityService,
} from './order-capacity.service';
import { RoundOrderCreateService } from './round-order-create.service';

type Data = Record<string, any>;
type Memory = ReturnType<typeof createInMemoryFirestore>;
type Item = { roundItemId: string; quantity: number };

// 같은 고객이 같은 회차에서 결제를 다시 시도해도 이전 시도의 결제 전 주문·예약은 그대로 둔다
// (2026-10-04 결정). 대신 만료 전 결제 예약(HELD)은 고객·회차마다 3건까지만 잡는다.

const LIMIT_MESSAGE = '이전 결제 시도를 아직 처리하고 있어요.';

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
    limits: { maxDeliveryAddresses: 30, maxItemQuantity: 60 },
    counters: {
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 0,
      orderedItemQuantity: 0,
      heldOrderCount: 0,
    },
  };
}

function roundItem(id: string, roundId: string, productId: string, price: number): Data {
  return {
    id,
    roundId,
    storeId: 'store-1',
    productId,
    productNameSnapshot: `상품 ${productId}`,
    productImageUrlSnapshot: null,
    roundPrice: price,
    saleLimitQuantity: 30,
    reservedQuantity: 0,
    orderedQuantity: 0,
    status: 'ACTIVE',
  };
}

function seed(): Record<string, Data> {
  return {
    'stores/store-1': { id: 'store-1', salesMode: 'round_direct', ownerId: 'seller-1' },
    'users/user-1': { id: 'user-1', name: '고객', email: 'buyer@example.com' },
    'users/user-2': { id: 'user-2', name: '다른 고객', email: 'other@example.com' },
    'saleRounds/round-1': round('round-1'),
    'saleRounds/round-2': round('round-2'),
    'saleRoundItems/round-item-1': roundItem('round-item-1', 'round-1', 'product-1', 50000),
    'saleRoundItems/round-item-2': roundItem('round-item-2', 'round-1', 'product-2', 30000),
    'saleRoundItems/round-item-3': roundItem('round-item-3', 'round-2', 'product-1', 50000),
  };
}

const ADDRESS = {
  address: '경기도 이천시 중리천로 1',
  addressDetail: '201호',
  zipCode: '17373',
};

function dto(
  requestId: string,
  items: Item[] = [{ roundItemId: 'round-item-1', quantity: 1 }],
  roundId = 'round-1',
) {
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

function setup() {
  const memory = createInMemoryFirestore(seed());
  const firestore = memory.firestore as never;
  const capacity = new OrderCapacityService(firestore);
  const orders = new RoundOrderCreateService(firestore, capacity, {
    saveRecord: jest.fn().mockResolvedValue({}),
  } as never);
  const create = (requestId: string, items?: Item[], userId = 'user-1', roundId = 'round-1') =>
    orders.create('store-1', userId, dto(requestId, items, roundId)) as Promise<{
      orderId: string;
      reservationId: string;
    }>;
  return { memory, capacity, orders, create };
}

function snapshotAll(memory: Memory) {
  return new Map(
    [...memory.records.entries()].map(([path, data]) => [path, structuredClone(data)]),
  );
}

function heldReservation(id: string, overrides: Data = {}): Data {
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
    itemQuantityTotal: 1,
    items: [
      {
        roundItemId: 'round-item-1',
        productId: 'product-1',
        productName: '상품 product-1',
        productImageUrl: null,
        quantity: 1,
        unitPrice: 50000,
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

async function rejection(promise: Promise<unknown>): Promise<ConflictException> {
  try {
    await promise;
  } catch (error) {
    return error as ConflictException;
  }
  throw new Error('거절되어야 하는 요청이 성공했습니다.');
}

async function expectHoldLimit(promise: Promise<unknown>) {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(ConflictException);
  expect(error.getStatus()).toBe(409);
  expect(error.message).toContain(LIMIT_MESSAGE);
}

describe('같은 고객·같은 회차 활성 결제 예약 상한', () => {
  it('상한은 3건이다', () => {
    expect(MAX_ACTIVE_CHECKOUT_HOLDS_PER_USER_ROUND).toBe(3);
  });

  it('1~3번째 결제 시도는 각자 결제 전 주문과 HELD 예약을 잡는다', async () => {
    const { memory, create } = setup();
    const attempts = [
      await create('attempt-1', [{ roundItemId: 'round-item-1', quantity: 2 }]),
      await create('attempt-2', [
        { roundItemId: 'round-item-1', quantity: 1 },
        { roundItemId: 'round-item-2', quantity: 3 },
      ]),
      await create('attempt-3', [{ roundItemId: 'round-item-2', quantity: 1 }]),
    ];

    expect(new Set(attempts.map((attempt) => attempt.orderId)).size).toBe(3);
    attempts.forEach((attempt) => {
      expect(memory.read(`orders/${attempt.orderId}`)?.status).toBe('PENDING');
      expect(memory.read(`checkoutReservations/${attempt.reservationId}`)?.status).toBe('HELD');
    });
    expect(memory.read('saleRounds/round-1')?.counters).toMatchObject({
      reservedDeliveryAddresses: 3,
      reservedItemQuantity: 7,
    });
    expect(memory.read('saleRoundItems/round-item-1')?.reservedQuantity).toBe(3);
    expect(memory.read('saleRoundItems/round-item-2')?.reservedQuantity).toBe(4);
  });

  it('4번째 결제 시도는 409로 거절하고 아무것도 쓰지 않는다', async () => {
    const { memory, capacity, create } = setup();
    await create('attempt-1');
    await create('attempt-2');
    await create('attempt-3');
    const before = snapshotAll(memory);

    await expectHoldLimit(create('attempt-4'));
    expect(snapshotAll(memory)).toEqual(before);

    // 예약 단계에서 거절할 때 트랜잭션에 쓰기를 하나도 보내지 않는다(롤백에 기대지 않는다).
    const writes = { set: jest.fn(), update: jest.fn(), delete: jest.fn() };
    await memory.firestore.runTransaction(async (tx: any) => {
      await expectHoldLimit(
        capacity.reserveCheckoutInTransaction(
          { get: tx.get, ...writes },
          {
            storeId: 'store-1',
            roundId: 'round-1',
            userId: 'user-1',
            idempotencyKey: 'checkout:attempt-4',
            deliveryAddress: ADDRESS,
            items: [{ roundItemId: 'round-item-1', quantity: 1 }],
          },
        ),
      );
    });
    expect(writes.set).not.toHaveBeenCalled();
    expect(writes.update).not.toHaveBeenCalled();
    expect(writes.delete).not.toHaveBeenCalled();
    expect(snapshotAll(memory)).toEqual(before);
  });

  it('만료 시각이 지난 HELD는 세지 않는다', async () => {
    const { memory, create } = setup();
    const first = await create('attempt-1');
    await create('attempt-2');
    await create('attempt-3');
    memory.records.set(`checkoutReservations/${first.reservationId}`, {
      ...memory.read(`checkoutReservations/${first.reservationId}`),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await expect(create('attempt-4')).resolves.toMatchObject({ orderId: expect.any(String) });
    // 만료된 HELD는 만료 정리 작업이 맡는다. 새 시도가 반환하지 않는다.
    expect(memory.read(`checkoutReservations/${first.reservationId}`)?.status).toBe('HELD');
    await expectHoldLimit(create('attempt-5'));
  });

  it('늦은 결제 예약은 세지 않는다', async () => {
    const { memory, create } = setup();
    for (const orderId of ['late-order-1', 'late-order-2', 'late-order-3']) {
      memory.records.set(
        `checkoutReservations/${orderId}`,
        heldReservation(orderId, { idempotencyKey: `late-payment:${orderId}` }),
      );
    }

    await create('attempt-1');
    await create('attempt-2');
    await create('attempt-3');
    await expectHoldLimit(create('attempt-4'));
  });

  it('RELEASED·CONSUMED·EXPIRED 예약은 세지 않는다', async () => {
    const { memory, capacity, create } = setup();
    const first = await create('attempt-1');
    const second = await create('attempt-2');
    const third = await create('attempt-3');

    await capacity.releaseReservation(first.reservationId, 'RELEASED');
    await capacity.consumeReservation({
      reservationId: second.reservationId,
      orderId: second.orderId,
    });
    await capacity.releaseReservation(third.reservationId, 'EXPIRED');
    expect(
      [first, second, third].map(
        ({ reservationId }) => memory.read(`checkoutReservations/${reservationId}`)?.status,
      ),
    ).toEqual(['RELEASED', 'CONSUMED', 'EXPIRED']);

    await create('attempt-4');
    await create('attempt-5');
    await create('attempt-6');
    await expectHoldLimit(create('attempt-7'));
  });

  it('다른 고객이나 다른 회차의 예약은 세지 않는다', async () => {
    const { memory, create } = setup();
    for (const requestId of ['other-1', 'other-2', 'other-3']) {
      await create(requestId, undefined, 'user-2');
    }
    for (const requestId of ['round2-1', 'round2-2', 'round2-3']) {
      await create(requestId, [{ roundItemId: 'round-item-3', quantity: 1 }], 'user-1', 'round-2');
    }
    // 다른 가게의 같은 회차 ID 예약도 세지 않는다.
    memory.records.set(
      'checkoutReservations/foreign-store',
      heldReservation('foreign-store', { storeId: 'store-2' }),
    );

    await create('attempt-1');
    await create('attempt-2');
    await create('attempt-3');
    await expectHoldLimit(create('attempt-4'));

    // 다른 고객·다른 회차도 각자 상한에 걸린다.
    await expectHoldLimit(create('other-4', undefined, 'user-2'));
    await expectHoldLimit(
      create('round2-4', [{ roundItemId: 'round-item-3', quantity: 1 }], 'user-1', 'round-2'),
    );
  });

  it('상한에 도달해도 같은 결제 시도 ID 재요청은 기존 주문·예약을 그대로 돌려준다', async () => {
    const { memory, capacity, create } = setup();
    const first = await create('attempt-1');
    await create('attempt-2');
    const third = await create('attempt-3');
    const before = snapshotAll(memory);

    await expect(create('attempt-1')).resolves.toEqual(first);

    const replayed = await capacity.reserveCheckout({
      storeId: 'store-1',
      roundId: 'round-1',
      userId: 'user-1',
      idempotencyKey: 'checkout:attempt-3',
      deliveryAddress: ADDRESS,
      items: [{ roundItemId: 'round-item-1', quantity: 1 }],
    });
    expect(replayed).toEqual(memory.read(`checkoutReservations/${third.reservationId}`));
    expect(replayed).toMatchObject({ id: third.reservationId, status: 'HELD' });
    expect(snapshotAll(memory)).toEqual(before);
  });

  it('새 결제 시도는 이전 HELD 예약과 결제 전 주문을 건드리지 않고 한도도 돌려주지 않는다', async () => {
    const { memory, create } = setup();
    const first = await create('attempt-1', [{ roundItemId: 'round-item-1', quantity: 2 }]);
    const firstOrder = memory.read(`orders/${first.orderId}`);
    const firstReservation = memory.read(`checkoutReservations/${first.reservationId}`);
    const second = await create('attempt-2', [{ roundItemId: 'round-item-1', quantity: 2 }]);
    const secondOrder = memory.read(`orders/${second.orderId}`);
    const secondReservation = memory.read(`checkoutReservations/${second.reservationId}`);
    await create('attempt-3', [{ roundItemId: 'round-item-1', quantity: 2 }]);
    await expectHoldLimit(create('attempt-4', [{ roundItemId: 'round-item-1', quantity: 2 }]));

    expect(memory.read(`orders/${first.orderId}`)).toEqual(firstOrder);
    expect(memory.read(`checkoutReservations/${first.reservationId}`)).toEqual(firstReservation);
    expect(memory.read(`orders/${second.orderId}`)).toEqual(secondOrder);
    expect(memory.read(`checkoutReservations/${second.reservationId}`)).toEqual(secondReservation);
    expect(firstOrder).toMatchObject({ status: 'PENDING' });
    expect(firstOrder).not.toHaveProperty('cancelReason');
    expect(firstReservation).toMatchObject({ status: 'HELD', releasedAt: null });
    expect(memory.read('saleRounds/round-1')?.counters).toMatchObject({
      reservedDeliveryAddresses: 3,
      reservedItemQuantity: 6,
      orderedDeliveryAddresses: 0,
      orderedItemQuantity: 0,
    });
    expect(memory.read('saleRoundItems/round-item-1')?.reservedQuantity).toBe(6);
  });

  it('이전 결제 시도에 결제가 확인되면 그 예약을 그대로 확정하고 다른 시도의 예약은 남긴다', async () => {
    const { memory, capacity, create } = setup();
    const first = await create('attempt-1', [{ roundItemId: 'round-item-1', quantity: 2 }]);
    const second = await create('attempt-2', [{ roundItemId: 'round-item-1', quantity: 2 }]);

    const notifications = { sendToUser: jest.fn().mockResolvedValue(undefined) };
    const finalization = new PaymentFinalizationService(
      memory.firestore as never,
      { refund: jest.fn(), getPayment: jest.fn() } as never,
      notifications as never,
      { log: jest.fn() } as never,
      capacity as never,
      { createOrMergeIssue: jest.fn() } as never,
      { saveRecord: jest.fn().mockResolvedValue({}) } as never,
      { refundByOrderId: jest.fn() } as never,
    );

    await expect(
      finalization.finalizePaidOrder(first.orderId, {
        amount: { total: 100000 },
        status: 'PAID',
        method: { type: 'CARD' },
        transactionId: 'tx-1',
      } as never),
    ).resolves.toEqual({ ok: true, status: 'ACCEPTED' });

    expect(memory.read(`orders/${first.orderId}`)?.status).toBe('ACCEPTED');
    expect(memory.read(`checkoutReservations/${first.reservationId}`)?.status).toBe('CONSUMED');
    expect(memory.read(`orders/${second.orderId}`)?.status).toBe('PENDING');
    expect(memory.read(`checkoutReservations/${second.reservationId}`)?.status).toBe('HELD');
    expect(memory.read('saleRounds/round-1')?.counters).toMatchObject({
      reservedDeliveryAddresses: 1,
      reservedItemQuantity: 2,
      orderedDeliveryAddresses: 1,
      orderedItemQuantity: 2,
    });
  });
});
