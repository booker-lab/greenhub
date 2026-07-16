import { PaymentsService } from './payments.service';
import { PortoneError } from './portone.client';

type Data = Record<string, any>;

describe('PaymentsService 회차 예약 연결', () => {
  function makeService(overrides: Data = {}) {
    const order: Data = {
      id: 'order-1',
      storeId: 'store-1',
      userId: 'user-1',
      status: 'PENDING',
      saleType: 'normal',
      schemaVersion: 2,
      roundId: 'round-1',
      reservationId: 'reservation-1',
      deliveryMethod: 'direct',
      deliveryAddress: {
        address: '경기도 이천시 부발읍 경충대로 1',
        addressDetail: '101호',
        zipCode: '17332',
      },
      orderItems: [
        {
          roundItemId: 'round-item-1',
          productId: 'product-1',
          quantity: 2,
          unitPrice: 50000,
          subtotalAmount: 100000,
        },
      ],
      quantity: 2,
      totalAmount: 100000,
      createdAt: { toDate: () => new Date('2026-07-15T00:00:00.000Z') },
      ...overrides,
    };
    const paymentWrites: Data[] = [];
    const orderRef = {
      get: jest.fn(async () => ({ exists: true, data: () => order })),
      update: jest.fn(async (update: Data) => Object.assign(order, update)),
    };
    const doc = jest.fn((path: string) => {
      if (path === 'orders/order-1') return orderRef;
      if (path === 'payments/order-1') {
        return { set: jest.fn(async (data: Data) => paymentWrites.push(data)) };
      }
      return { update: jest.fn().mockResolvedValue(undefined), get: jest.fn() };
    });
    const orderQuery = {
      where: jest.fn().mockReturnThis(),
      get: jest.fn(async () => ({
        empty: false,
        size: 1,
        docs: [{ id: 'order-1', data: () => order }],
      })),
    };
    const firestore = {
      doc,
      runTransaction: jest.fn(async (callback: (tx: Data) => Promise<void>) =>
        callback({
          get: (ref: Data) => ref.get(),
          update: (ref: Data, data: Data) => ref.update(data),
          set: (ref: Data, data: Data) => ref.set(data),
        }),
      ),
      collection: jest.fn((name: string) =>
        name === 'orders'
          ? orderQuery
          : {
              where: jest.fn().mockReturnThis(),
              limit: jest.fn().mockReturnThis(),
              get: jest.fn(),
            },
      ),
      Timestamp: {
        now: jest.fn(() => new Date('2026-07-15T03:00:00.000+09:00')),
        fromDate: jest.fn((date: Date) => date),
      },
      FieldValue: { increment: jest.fn((value: number) => value) },
    };
    const portone = {
      getPayment: jest.fn().mockResolvedValue({
        amount: { total: 100000 },
        status: 'PAID',
        method: { type: 'CARD' },
        transactionId: 'tx-1',
      }),
      refund: jest.fn(),
    };
    const notifications = { sendToUser: jest.fn().mockResolvedValue(undefined) };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const capacity = {
      reserveCheckout: jest.fn().mockResolvedValue({
        id: 'late-reservation-1',
        status: 'HELD',
      }),
      consumeReservation: jest.fn().mockResolvedValue({ status: 'CONSUMED' }),
      releaseReservation: jest.fn().mockResolvedValue({ status: 'RELEASED' }),
    };
    const service = new (PaymentsService as any)(
      firestore,
      portone,
      notifications,
      audit,
      capacity,
    ) as PaymentsService;
    return {
      service,
      order,
      orderRef,
      doc,
      paymentWrites,
      portone,
      notifications,
      capacity,
    };
  }

  const paidWebhook = {
    type: 'Transaction.Paid',
    data: { paymentId: 'order-1', storeId: 'store-1' },
  } as never;

  it('결제 성공은 예약을 한 번 소비하고 중복 웹훅은 다시 반영하지 않는다', async () => {
    const { service, capacity, order, paymentWrites, portone, notifications } = makeService();

    await expect(service.handleWebhook(paidWebhook)).resolves.toMatchObject({
      ok: true,
      status: 'ACCEPTED',
    });
    await expect(service.handleWebhook(paidWebhook)).resolves.toMatchObject({
      reason: 'already_processed',
    });

    expect(capacity.consumeReservation).toHaveBeenCalledTimes(1);
    expect(capacity.consumeReservation).toHaveBeenCalledWith({
      reservationId: 'reservation-1',
      orderId: 'order-1',
      paymentId: 'order-1',
    });
    expect(order.status).toBe('ACCEPTED');
    expect(paymentWrites).toHaveLength(1);
    expect(portone.getPayment).toHaveBeenCalledTimes(1);
    expect(portone.refund).not.toHaveBeenCalled();
    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
  });

  it('결제 실패와 금액 불일치는 HELD 예약을 반환한다', async () => {
    const failed = makeService();
    await failed.service.handleWebhook({
      type: 'Transaction.Failed',
      data: { paymentId: 'order-1', storeId: 'store-1' },
    } as never);
    expect(failed.capacity.releaseReservation).toHaveBeenCalledWith('reservation-1');
    expect(failed.order.status).toBe('CANCELLED');

    const mismatch = makeService();
    mismatch.portone.getPayment.mockResolvedValue({ amount: { total: 90000 } });
    await expect(mismatch.service.handleWebhook(paidWebhook)).resolves.toMatchObject({
      reason: 'amount_mismatch',
    });
    expect(mismatch.capacity.releaseReservation).toHaveBeenCalledWith('reservation-1');
  });

  it('결제 시간 초과는 예약을 반환하고 주문을 한 번만 취소한다', async () => {
    const { service, capacity, orderRef, order, portone } = makeService();
    portone.getPayment.mockResolvedValue({
      amount: { total: 100000 },
      status: 'READY',
    });

    await service.cleanupPendingOrders();

    expect(portone.getPayment).toHaveBeenCalledWith('order-1');
    expect(capacity.releaseReservation).toHaveBeenCalledTimes(1);
    expect(capacity.releaseReservation).toHaveBeenCalledWith('reservation-1', 'EXPIRED');
    expect(orderRef.update).toHaveBeenCalledTimes(1);
    expect(order.status).toBe('CANCELLED');
  });

  it('결제 시간 초과 정리 중 결제 완료가 확인되면 기존 예약을 소비해 주문을 확정한다', async () => {
    const { service, capacity, order, portone } = makeService();

    await service.cleanupPendingOrders();

    expect(portone.getPayment).toHaveBeenCalledWith('order-1');
    expect(capacity.consumeReservation).toHaveBeenCalledWith({
      reservationId: 'reservation-1',
      orderId: 'order-1',
      paymentId: 'order-1',
    });
    expect(capacity.releaseReservation).not.toHaveBeenCalled();
    expect(portone.refund).not.toHaveBeenCalled();
    expect(order.status).toBe('ACCEPTED');
  });

  it('404 PAYMENT_NOT_FOUND 주문은 timeout 취소하고 회차 예약을 EXPIRED로 반환한다', async () => {
    const { service, capacity, order, portone } = makeService();
    portone.getPayment.mockRejectedValue(
      new PortoneError(404, 'PAYMENT_NOT_FOUND', 'payment not found'),
    );

    await expect(service.cleanupPendingOrders()).resolves.toBeUndefined();

    expect(capacity.releaseReservation).toHaveBeenCalledWith('reservation-1', 'EXPIRED');
    expect(order).toMatchObject({ status: 'CANCELLED', cancelReason: 'timeout' });
    expect(portone.refund).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'UNKNOWN_RESOURCE'],
    [429, 'TOO_MANY_REQUESTS'],
    [500, 'INTERNAL_SERVER_ERROR'],
  ])('%i %s 조회 오류에서는 주문과 예약을 변경하지 않는다', async (status, type) => {
    const { service, capacity, order, orderRef, portone } = makeService();
    portone.getPayment.mockRejectedValue(new PortoneError(status, type, 'remote failure'));

    await expect(service.cleanupPendingOrders()).resolves.toBeUndefined();

    expect(order.status).toBe('PENDING');
    expect(orderRef.update).not.toHaveBeenCalled();
    expect(capacity.releaseReservation).not.toHaveBeenCalled();
    expect(capacity.consumeReservation).not.toHaveBeenCalled();
  });

  it('네트워크 조회 오류에서는 주문과 예약을 변경하지 않는다', async () => {
    const { service, capacity, order, orderRef, portone } = makeService();
    portone.getPayment.mockRejectedValue(new TypeError('fetch failed'));

    await expect(service.cleanupPendingOrders()).resolves.toBeUndefined();

    expect(order.status).toBe('PENDING');
    expect(orderRef.update).not.toHaveBeenCalled();
    expect(capacity.releaseReservation).not.toHaveBeenCalled();
  });

  it('한 주문의 조회 실패를 격리하고 다른 PAYMENT_NOT_FOUND 주문을 계속 처리한다', async () => {
    const firstOrder = {
      id: 'order-failed',
      status: 'PENDING',
      schemaVersion: 2,
      reservationId: 'reservation-failed',
    };
    const secondOrder = {
      id: 'order-timeout',
      status: 'PENDING',
      schemaVersion: 2,
      reservationId: 'reservation-timeout',
    };
    const orderRefs = new Map(
      [firstOrder, secondOrder].map((order) => [
        order.id,
        {
          get: jest.fn(async () => ({ exists: true, data: () => order })),
          update: jest.fn(async (update: Data) => Object.assign(order, update)),
        },
      ]),
    );
    const firestore = {
      collection: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        get: jest.fn(async () => ({
          empty: false,
          size: 2,
          docs: [
            { id: firstOrder.id, data: () => firstOrder },
            { id: secondOrder.id, data: () => secondOrder },
          ],
        })),
      })),
      doc: jest.fn((path: string) => orderRefs.get(path.replace('orders/', ''))),
      Timestamp: {
        now: jest.fn(() => new Date('2026-07-15T03:00:00.000+09:00')),
        fromDate: jest.fn((date: Date) => date),
      },
      FieldValue: { increment: jest.fn((value: number) => value) },
    };
    const portone = {
      getPayment: jest
        .fn()
        .mockRejectedValueOnce(new PortoneError(503, 'UNAVAILABLE', 'temporary failure'))
        .mockRejectedValueOnce(new PortoneError(404, 'PAYMENT_NOT_FOUND', 'payment not found')),
    };
    const capacity = {
      releaseReservation: jest.fn().mockResolvedValue({ status: 'EXPIRED' }),
    };
    const service = new (PaymentsService as any)(
      firestore,
      portone,
      { sendToUser: jest.fn() },
      { log: jest.fn() },
      capacity,
    ) as PaymentsService;

    await expect(service.cleanupPendingOrders()).resolves.toBeUndefined();

    expect(firstOrder.status).toBe('PENDING');
    expect(secondOrder).toMatchObject({ status: 'CANCELLED', cancelReason: 'timeout' });
    expect(capacity.releaseReservation).toHaveBeenCalledTimes(1);
    expect(capacity.releaseReservation).toHaveBeenCalledWith('reservation-timeout', 'EXPIRED');
  });

  it('scheduler 재실행 시 이미 취소된 주문의 예약 한도를 중복 반환하지 않는다', async () => {
    const fixture = makeService();
    fixture.portone.getPayment.mockRejectedValue(
      new PortoneError(404, 'PAYMENT_NOT_FOUND', 'payment not found'),
    );

    await fixture.service.cleanupPendingOrders();
    await fixture.service.cleanupPendingOrders();

    expect(fixture.capacity.releaseReservation).toHaveBeenCalledTimes(1);
    expect(fixture.orderRef.update).toHaveBeenCalledTimes(1);
  });

  it('legacy 직접배송 timeout은 requestedDeliveryDate 기준 dailyCaps를 반환한다', async () => {
    const fixture = makeService({
      schemaVersion: 1,
      reservationId: undefined,
      requestedDeliveryDate: '2026-07-21',
      createdAt: { toDate: () => new Date('2026-07-15T00:00:00.000Z') },
    });
    fixture.portone.getPayment.mockRejectedValue(
      new PortoneError(404, 'PAYMENT_NOT_FOUND', 'payment not found'),
    );

    await fixture.service.cleanupPendingOrders();

    expect(fixture.doc).toHaveBeenCalledWith('dailyCaps/store-1_2026-07-21');
    expect(fixture.order).toMatchObject({ status: 'CANCELLED', cancelReason: 'timeout' });
  });

  it('만료 취소 뒤 늦은 결제는 한도를 새로 확보하고 주문을 한 번만 확정한다', async () => {
    const { service, capacity, order, portone, notifications, paymentWrites } = makeService({
      status: 'CANCELLED',
      cancelReason: 'timeout',
    });

    await expect(service.handleWebhook(paidWebhook)).resolves.toMatchObject({
      ok: true,
      status: 'ACCEPTED',
    });

    expect(capacity.reserveCheckout).toHaveBeenCalledWith({
      storeId: 'store-1',
      roundId: 'round-1',
      userId: 'user-1',
      idempotencyKey: 'late-payment:order-1',
      deliveryAddress: order.deliveryAddress,
      items: [{ roundItemId: 'round-item-1', quantity: 2 }],
    });
    expect(capacity.consumeReservation).toHaveBeenCalledWith({
      reservationId: 'late-reservation-1',
      orderId: 'order-1',
      paymentId: 'order-1',
    });
    expect(order.reservationId).toBe('late-reservation-1');
    expect(order.status).toBe('ACCEPTED');
    expect(paymentWrites).toHaveLength(1);
    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(portone.refund).not.toHaveBeenCalled();
  });

  it('늦은 결제의 한도 재확보가 실패하면 결제액 전부를 자동 환불한다', async () => {
    const { service, capacity, order, portone, notifications, paymentWrites } = makeService({
      status: 'CANCELLED',
      cancelReason: 'timeout',
    });
    capacity.reserveCheckout.mockRejectedValue(new Error('회차 한도 마감'));

    await expect(service.handleWebhook(paidWebhook)).resolves.toMatchObject({
      ok: false,
      reason: 'late_payment_refunded',
    });

    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(portone.refund).toHaveBeenCalledWith('order-1', 100000, expect.any(String));
    expect(capacity.consumeReservation).not.toHaveBeenCalled();
    expect(order.status).toBe('CANCELLED');
    expect(paymentWrites).toHaveLength(1);
    expect(paymentWrites[0]).toMatchObject({
      id: 'order-1',
      orderId: 'order-1',
      amount: 100000,
      status: 'CANCELLED',
      portonePaymentId: 'order-1',
      portoneTransactionId: 'tx-1',
      refundAmount: 100000,
      refundReason: '결제 만료 후 회차 한도 마감',
    });
    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });
});
