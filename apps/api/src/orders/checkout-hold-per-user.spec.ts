import { ConflictException } from '@nestjs/common';
import { createInMemoryFirestore } from '../../test/helpers/in-memory-firestore';
import { PaymentFinalizationService } from '../payments/payment-finalization.service';
import type { CreateOrderDto } from './dto/create-order.dto';
import { OrderCapacityService, SUPERSEDED_CHECKOUT_CANCEL_REASON } from './order-capacity.service';
import { RoundOrderCreateService } from './round-order-create.service';

type Data = Record<string, any>;

// 같은 고객의 같은 회차 결제 예약(HELD, 만료 전)은 1건만 유지한다. 결제창을 닫고 새로
// 시도하면 이전 결제 전 주문의 예약을 같은 트랜잭션에서 반환하고 새 예약을 잡는다.

function seed(limits = { maxDeliveryAddresses: 15, maxItemQuantity: 30 }): Record<string, Data> {
  return {
    'stores/store-1': { id: 'store-1', salesMode: 'round_direct', ownerId: 'seller-1' },
    'users/user-1': { id: 'user-1', name: '고객', email: 'buyer@example.com' },
    'users/user-2': { id: 'user-2', name: '다른 고객', email: 'other@example.com' },
    'saleRounds/round-1': {
      id: 'round-1',
      storeId: 'store-1',
      status: 'OPEN',
      schedule: {
        orderOpenAt: '2026-07-14T00:00:00.000+09:00',
        orderCloseAt: '2099-07-20T00:00:00.000+09:00',
        timezone: 'Asia/Seoul',
      },
      deliveryRegion: { city: '이천시', enabled: true },
      limits,
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
      storeId: 'store-1',
      productId: 'product-1',
      productNameSnapshot: '미니 호접란',
      productImageUrlSnapshot: null,
      roundPrice: 50000,
      saleLimitQuantity: 20,
      reservedQuantity: 0,
      orderedQuantity: 0,
      status: 'ACTIVE',
    },
    'saleRoundItems/round-item-2': {
      id: 'round-item-2',
      roundId: 'round-1',
      storeId: 'store-1',
      productId: 'product-2',
      productNameSnapshot: '덴드로비움',
      productImageUrlSnapshot: null,
      roundPrice: 30000,
      saleLimitQuantity: 10,
      reservedQuantity: 0,
      orderedQuantity: 0,
      status: 'ACTIVE',
    },
  };
}

function dto(requestId: string, items = [{ roundItemId: 'round-item-1', quantity: 2 }]) {
  return {
    productId: 'product-1',
    quantity: items[0].quantity,
    saleType: 'normal',
    deliveryMethod: 'direct',
    deliveryAddress: {
      address: '경기도 이천시 중리천로 1',
      addressDetail: '201호',
      zipCode: '17373',
    },
    deliveryPhone: '010-1234-5678',
    roundId: 'round-1',
    roundItems: items,
    clientOrderRequestId: requestId,
  } as unknown as CreateOrderDto;
}

function setup(limits?: { maxDeliveryAddresses: number; maxItemQuantity: number }) {
  const memory = createInMemoryFirestore(seed(limits));
  const firestore = memory.firestore as never;
  const capacity = new OrderCapacityService(firestore);
  const orders = new RoundOrderCreateService(firestore, capacity, {
    saveRecord: jest.fn().mockResolvedValue({}),
  } as never);
  return { memory, capacity, orders };
}

function counters(memory: ReturnType<typeof createInMemoryFirestore>) {
  return memory.read('saleRounds/round-1')?.counters;
}

function reservedQuantity(memory: ReturnType<typeof createInMemoryFirestore>, itemId: string) {
  return memory.read(`saleRoundItems/${itemId}`)?.reservedQuantity;
}

function heldReservations(memory: ReturnType<typeof createInMemoryFirestore>) {
  return [...memory.records.entries()]
    .filter(([path, data]) => path.startsWith('checkoutReservations/') && data.status === 'HELD')
    .map(([, data]) => data);
}

describe('같은 고객·같은 회차 결제 예약 1건 유지', () => {
  it('새 결제 시도는 이전 결제 전 주문의 예약을 반환하고 새 예약을 잡는다', async () => {
    const { memory, orders } = setup();
    const first = await orders.create('store-1', 'user-1', dto('attempt-1'));
    expect(counters(memory)).toMatchObject({
      reservedDeliveryAddresses: 1,
      reservedItemQuantity: 2,
    });

    const second = await orders.create(
      'store-1',
      'user-1',
      dto('attempt-2', [
        { roundItemId: 'round-item-1', quantity: 1 },
        { roundItemId: 'round-item-2', quantity: 3 },
      ]),
    );

    expect(second.orderId).not.toBe(first.orderId);
    expect(memory.read(`checkoutReservations/${first.reservationId}`)).toMatchObject({
      status: 'RELEASED',
    });
    expect(memory.read(`checkoutReservations/${first.reservationId}`)?.releasedAt).toEqual(
      expect.any(String),
    );
    expect(memory.read(`orders/${first.orderId}`)).toMatchObject({
      status: 'CANCELLED',
      cancelReason: SUPERSEDED_CHECKOUT_CANCEL_REASON,
    });
    expect(memory.read(`checkoutReservations/${second.reservationId}`)).toMatchObject({
      status: 'HELD',
    });
    expect(memory.read(`orders/${second.orderId}`)).toMatchObject({ status: 'PENDING' });
    // 이전 예약 2개 반환 + 새 예약 1+3개 확보. 배송지는 1건만 남는다.
    expect(counters(memory)).toMatchObject({
      reservedDeliveryAddresses: 1,
      reservedItemQuantity: 4,
      orderedDeliveryAddresses: 0,
      orderedItemQuantity: 0,
    });
    expect(reservedQuantity(memory, 'round-item-1')).toBe(1);
    expect(reservedQuantity(memory, 'round-item-2')).toBe(3);
    expect(heldReservations(memory)).toHaveLength(1);
  });

  it('회차 한도가 이전 시도로 가득 차 있어도 같은 고객의 재시도는 성공한다', async () => {
    const { memory, orders } = setup({ maxDeliveryAddresses: 1, maxItemQuantity: 2 });
    await orders.create('store-1', 'user-1', dto('attempt-1'));

    await expect(orders.create('store-1', 'user-1', dto('attempt-2'))).resolves.toMatchObject({
      orderId: expect.any(String),
    });
    expect(counters(memory)).toMatchObject({
      reservedDeliveryAddresses: 1,
      reservedItemQuantity: 2,
    });
    expect(reservedQuantity(memory, 'round-item-1')).toBe(2);

    // 다른 고객은 그대로 한도 마감(회차 자동 마감)이다.
    await expect(orders.create('store-1', 'user-2', dto('other-1'))).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(heldReservations(memory)).toHaveLength(1);
  });

  it('같은 결제 시도 ID 재요청은 같은 주문을 돌려주고 자기 예약을 반환하지 않는다', async () => {
    const { memory, orders, capacity } = setup();
    const first = await orders.create('store-1', 'user-1', dto('attempt-1'));
    const retry = await orders.create('store-1', 'user-1', dto('attempt-1'));

    expect(retry).toEqual(first);
    expect(memory.read(`orders/${first.orderId}`)).toMatchObject({ status: 'PENDING' });
    expect(memory.read(`checkoutReservations/${first.reservationId}`)).toMatchObject({
      status: 'HELD',
    });
    expect(counters(memory)).toMatchObject({
      reservedDeliveryAddresses: 1,
      reservedItemQuantity: 2,
    });

    // 예약 단계에서 같은 idempotencyKey를 다시 받아도 자기 예약을 그대로 돌려준다.
    const again = await capacity.reserveCheckout({
      storeId: 'store-1',
      roundId: 'round-1',
      userId: 'user-1',
      idempotencyKey: 'checkout:attempt-1',
      deliveryAddress: dto('attempt-1').deliveryAddress,
      items: [{ roundItemId: 'round-item-1', quantity: 2 }],
    });
    expect(again.id).toBe(first.reservationId);
    expect(again.status).toBe('HELD');
    expect(counters(memory)).toMatchObject({
      reservedDeliveryAddresses: 1,
      reservedItemQuantity: 2,
    });
  });

  it('다른 고객의 예약은 서로 영향을 주지 않는다', async () => {
    const { memory, orders } = setup();
    const mine = await orders.create('store-1', 'user-1', dto('attempt-1'));
    const theirs = await orders.create('store-1', 'user-2', dto('other-1'));

    expect(memory.read(`checkoutReservations/${mine.reservationId}`)?.status).toBe('HELD');
    expect(memory.read(`checkoutReservations/${theirs.reservationId}`)?.status).toBe('HELD');
    expect(memory.read(`orders/${mine.orderId}`)?.status).toBe('PENDING');
    expect(counters(memory)).toMatchObject({
      reservedDeliveryAddresses: 2,
      reservedItemQuantity: 4,
    });
  });

  it.each([
    [
      '결제 기록이 있는 주문',
      (memory: ReturnType<typeof createInMemoryFirestore>, orderId: string) => {
        memory.records.set(`payments/${orderId}`, { id: orderId, orderId, status: 'PAID' });
      },
    ],
    [
      '취소가 진행 중인 주문',
      (memory: ReturnType<typeof createInMemoryFirestore>, orderId: string) => {
        memory.records.set(`orders/${orderId}`, {
          ...memory.read(`orders/${orderId}`),
          cancellation: { status: 'LOCAL_PENDING', reason: '소비자 취소' },
        });
      },
    ],
    [
      '이미 결제 전 상태가 아닌 주문',
      (memory: ReturnType<typeof createInMemoryFirestore>, orderId: string) => {
        memory.records.set(`orders/${orderId}`, {
          ...memory.read(`orders/${orderId}`),
          status: 'ACCEPTED',
        });
      },
    ],
  ])('이전 예약이 %s에 연결돼 있으면 반환하지 않고 409로 거절한다', async (_label, mutate) => {
    const { memory, orders } = setup();
    const first = await orders.create('store-1', 'user-1', dto('attempt-1'));
    mutate(memory, first.orderId as string);
    const orderBefore = memory.read(`orders/${first.orderId}`);
    const roundBefore = memory.read('saleRounds/round-1');
    const itemBefore = memory.read('saleRoundItems/round-item-1');

    const attempt = orders.create('store-1', 'user-1', dto('attempt-2'));
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(orders.create('store-1', 'user-1', dto('attempt-2'))).rejects.toThrow(
      '이전 결제를 처리하고 있습니다.',
    );

    expect(memory.read(`checkoutReservations/${first.reservationId}`)?.status).toBe('HELD');
    expect(memory.read(`orders/${first.orderId}`)).toEqual(orderBefore);
    expect(memory.read('saleRounds/round-1')).toEqual(roundBefore);
    expect(memory.read('saleRoundItems/round-item-1')).toEqual(itemBefore);
    expect(heldReservations(memory)).toHaveLength(1);
  });

  it('만료 시각이 지난 HELD는 결제 조회 뒤 정리하는 scheduler에 맡기고 건드리지 않는다', async () => {
    const { memory, orders } = setup();
    const first = await orders.create('store-1', 'user-1', dto('attempt-1'));
    memory.records.set(`checkoutReservations/${first.reservationId}`, {
      ...memory.read(`checkoutReservations/${first.reservationId}`),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await orders.create('store-1', 'user-1', dto('attempt-2'));

    expect(memory.read(`checkoutReservations/${first.reservationId}`)?.status).toBe('HELD');
    expect(memory.read(`orders/${first.orderId}`)?.status).toBe('PENDING');
    expect(counters(memory)).toMatchObject({
      reservedDeliveryAddresses: 2,
      reservedItemQuantity: 4,
    });
  });

  it('대체된 주문에 결제가 뒤늦게 확인되면 확정하지 않고 환불 경로로 정리한다', async () => {
    const { memory, orders, capacity } = setup();
    const first = await orders.create('store-1', 'user-1', dto('attempt-1'));
    const second = await orders.create('store-1', 'user-1', dto('attempt-2'));
    const roundBefore = memory.read('saleRounds/round-1');

    const refunds = { refundByOrderId: jest.fn().mockResolvedValue(undefined) };
    const notifications = { sendToUser: jest.fn() };
    const finalization = new PaymentFinalizationService(
      memory.firestore as never,
      { refund: jest.fn(), getPayment: jest.fn() } as never,
      notifications as never,
      { log: jest.fn() } as never,
      capacity as never,
      { createOrMergeIssue: jest.fn() } as never,
      { saveRecord: jest.fn().mockResolvedValue({}) } as never,
      refunds as never,
    );

    await expect(
      finalization.finalizePaidOrder(
        first.orderId as string,
        {
          amount: { total: 100000 },
          status: 'PAID',
          method: { type: 'CARD' },
          transactionId: 'tx-late-1',
        } as never,
      ),
    ).resolves.toEqual({ ok: false, reason: 'cancelled_paid_refunded' });

    expect(refunds.refundByOrderId).toHaveBeenCalledWith(first.orderId, expect.any(String));
    expect(notifications.sendToUser).not.toHaveBeenCalled();
    expect(memory.read(`orders/${first.orderId}`)?.status).toBe('CANCELLED');
    expect(memory.read(`checkoutReservations/${first.reservationId}`)?.status).toBe('RELEASED');
    expect(memory.read(`checkoutReservations/${second.reservationId}`)?.status).toBe('HELD');
    expect(memory.read('saleRounds/round-1')).toEqual(roundBefore);
  });
});
