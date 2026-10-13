import { createInMemoryFirestore } from '../../test/helpers/in-memory-firestore';
import { OrderCapacityService } from '../orders/order-capacity.service';
import { PaymentFinalizationService } from './payment-finalization.service';
import { PaymentsService } from './payments.service';

type Data = Record<string, any>;

// PENDING 회차 주문의 결제가 PortOne에서 PAID인데 결제 예약(15분)이 이미 만료된 경우.
// 웹훅이 15분 안에 처리되지 못하면 1분 scheduler가 이 상태를 만난다(주문 생성 15분 뒤만
// 조회하므로 예약은 항상 만료돼 있다). 만료됐어도 HELD 예약은 한도를 계속 차지하고 있으므로
// 같은 예약을 그대로 소비해 ACCEPTED로 확정한다(해제 뒤 재확보하면 그 사이 자리를 잃는다).

function seedBase(
  limits = { maxDeliveryAddresses: 15, maxItemQuantity: 30 },
): Record<string, Data> {
  return {
    'stores/store-1': { id: 'store-1', salesMode: 'round_direct', ownerId: 'seller-1' },
    'users/user-1': { id: 'user-1', name: '고객', email: 'buyer@example.com' },
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
  };
}

const deliveryAddress = {
  address: '경기도 이천시 중리천로 1',
  addressDetail: '201호',
  zipCode: '17373',
};

const paymentData = {
  amount: { total: 100000 },
  status: 'PAID',
  method: { type: 'CARD' },
  transactionId: 'tx-expired-1',
} as never;

async function setup(limits?: { maxDeliveryAddresses: number; maxItemQuantity: number }) {
  const memory = createInMemoryFirestore(seedBase(limits));
  const firestore = memory.firestore as never;
  const capacity = new OrderCapacityService(firestore);
  const reservation = await capacity.reserveCheckout({
    storeId: 'store-1',
    roundId: 'round-1',
    userId: 'user-1',
    idempotencyKey: 'checkout-expired-1',
    deliveryAddress,
    items: [{ roundItemId: 'round-item-1', quantity: 2 }],
  });
  // 결제 예약 만료: 생성 15분이 지난 상태.
  const expiredAt = new Date(Date.now() - 60_000).toISOString();
  memory.records.set(`checkoutReservations/${reservation.id}`, {
    ...memory.read(`checkoutReservations/${reservation.id}`),
    expiresAt: expiredAt,
  });
  memory.records.set('orders/order-1', {
    id: 'order-1',
    storeId: 'store-1',
    userId: 'user-1',
    status: 'PENDING',
    schemaVersion: 2,
    roundId: 'round-1',
    saleType: 'normal',
    reservationId: reservation.id,
    totalAmount: 100000,
    deliveryAddress,
    orderItems: [{ roundItemId: 'round-item-1', quantity: 2 }],
    createdAt: new Date(Date.now() - 16 * 60_000),
  });
  const portone = {
    refund: jest.fn().mockResolvedValue(undefined),
    getPayment: jest.fn().mockResolvedValue(paymentData),
  };
  const notifications = { sendToUser: jest.fn() };
  const issueWriter = { createOrMergeIssue: jest.fn().mockResolvedValue({ id: 'issue-1' }) };
  const finalization = new PaymentFinalizationService(
    firestore,
    portone as never,
    notifications as never,
    { log: jest.fn() } as never,
    capacity as never,
    issueWriter as never,
    { saveRecord: jest.fn().mockResolvedValue({}) } as never,
    { refundByOrderId: jest.fn() } as never,
  );
  return { memory, capacity, reservation, portone, notifications, issueWriter, finalization };
}

function reservationKeys(memory: ReturnType<typeof createInMemoryFirestore>) {
  return [...memory.records.keys()].filter((key) => key.startsWith('checkoutReservations/'));
}

describe('만료된 결제 예약의 PENDING 회차 주문 결제 확정', () => {
  it('만료됐지만 HELD인 예약을 그대로 소비해 ACCEPTED로 확정하고 재시도는 0 move다', async () => {
    const fixture = await setup();

    await expect(
      fixture.finalization.finalizePaidOrder('order-1', paymentData),
    ).resolves.toMatchObject({ ok: true, status: 'ACCEPTED' });

    const order = fixture.memory.read('orders/order-1');
    expect(order?.status).toBe('ACCEPTED');
    expect(order?.reservationId).toBe(fixture.reservation.id);
    expect(fixture.memory.read(`checkoutReservations/${fixture.reservation.id}`)?.status).toBe(
      'CONSUMED',
    );
    expect(fixture.memory.read('saleRounds/round-1')?.counters).toMatchObject({
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 1,
      orderedItemQuantity: 2,
    });
    expect(fixture.memory.read('saleRoundItems/round-item-1')).toMatchObject({
      reservedQuantity: 0,
      orderedQuantity: 2,
    });
    expect(fixture.memory.read('payments/order-1')?.status).toBe('PAID');
    expect(fixture.notifications.sendToUser).toHaveBeenCalledWith(
      'user-1',
      'ORDER_ACCEPTED',
      expect.anything(),
      'order-1',
    );
    expect(fixture.portone.refund).not.toHaveBeenCalled();
    expect(reservationKeys(fixture.memory)).toHaveLength(1);

    // 같은 결제의 재시도(웹훅 재전송·다음 scheduler)는 0 move로 끝난다.
    await expect(
      fixture.finalization.finalizePaidOrder('order-1', paymentData),
    ).resolves.toMatchObject({ reason: 'already_processed' });
    expect(fixture.memory.read('saleRounds/round-1')?.counters).toMatchObject({
      reservedDeliveryAddresses: 0,
      orderedDeliveryAddresses: 1,
      orderedItemQuantity: 2,
    });
  });

  it('만료 예약이 마지막 자리를 차지하고 있어도 그 자리로 확정한다(환불하지 않는다)', async () => {
    const fixture = await setup({ maxDeliveryAddresses: 1, maxItemQuantity: 2 });

    await expect(
      fixture.finalization.finalizePaidOrder('order-1', paymentData),
    ).resolves.toMatchObject({ ok: true, status: 'ACCEPTED' });
    expect(fixture.portone.refund).not.toHaveBeenCalled();
    expect(fixture.memory.read('saleRounds/round-1')?.counters).toMatchObject({
      reservedDeliveryAddresses: 0,
      orderedDeliveryAddresses: 1,
      orderedItemQuantity: 2,
    });
  });

  it('결제 확인이 없는 일반 consume은 여전히 만료 예약을 거부한다', async () => {
    const fixture = await setup();
    await expect(
      fixture.capacity.consumeReservation({
        reservationId: fixture.reservation.id,
        orderId: 'order-1',
      }),
    ).rejects.toThrow('만료된 결제 예약입니다.');
    expect(fixture.memory.read(`checkoutReservations/${fixture.reservation.id}`)?.status).toBe(
      'HELD',
    );
  });

  it('scheduler가 만난 만료 예약 결제도 운영 예외 없이 확정한다', async () => {
    const fixture = await setup();
    const service = new PaymentsService(
      fixture.memory.firestore as never,
      fixture.portone as never,
      fixture.finalization,
      { refundByOrderId: jest.fn() } as never,
      { isOrderChargePaymentId: jest.fn().mockReturnValue(false) } as never,
      { createOrMergeIssue: jest.fn() } as never,
    );

    await service.cleanupPendingOrders();

    expect(fixture.memory.read('orders/order-1')?.status).toBe('ACCEPTED');
    expect(fixture.issueWriter.createOrMergeIssue).not.toHaveBeenCalled();
  });

  it('PortOne 웹훅이 예약 만료 뒤 도착해도 같은 규칙으로 확정한다', async () => {
    const fixture = await setup();
    const service = new PaymentsService(
      fixture.memory.firestore as never,
      fixture.portone as never,
      fixture.finalization,
      { refundByOrderId: jest.fn() } as never,
      { isOrderChargePaymentId: jest.fn().mockReturnValue(false) } as never,
      { createOrMergeIssue: jest.fn() } as never,
    );

    await expect(
      service.handleWebhook({ type: 'Transaction.Paid', data: { paymentId: 'order-1' } } as never),
    ).resolves.toMatchObject({ status: 'ACCEPTED' });
    expect(fixture.memory.read('orders/order-1')?.status).toBe('ACCEPTED');
  });
});
