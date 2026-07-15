import { PaymentsService } from './payments.service';

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
      runTransaction: jest.fn(async (callback: (tx: Data) => Promise<void>) => callback({
        get: (ref: Data) => ref.get(),
        update: (ref: Data, data: Data) => ref.update(data),
        set: (ref: Data, data: Data) => ref.set(data),
      })),
      collection: jest.fn((name: string) => name === 'orders' ? orderQuery : ({ where: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), get: jest.fn() })),
      Timestamp: {
        now: jest.fn(() => new Date('2026-07-15T03:00:00.000+09:00')),
        fromDate: jest.fn((date: Date) => date),
      },
      FieldValue: { increment: jest.fn((value: number) => value) },
    };
    const portone = {
      getPayment: jest.fn().mockResolvedValue({
        amount: { total: 100000 },
        method: { type: 'CARD' },
        transactionId: 'tx-1',
      }),
      refund: jest.fn(),
    };
    const notifications = { sendToUser: jest.fn().mockResolvedValue(undefined) };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const capacity = {
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
    return { service, order, orderRef, paymentWrites, portone, capacity };
  }

  const paidWebhook = {
    type: 'Transaction.Paid',
    data: { paymentId: 'order-1', storeId: 'store-1' },
  } as never;

  it('결제 성공은 예약을 한 번 소비하고 중복 웹훅은 다시 반영하지 않는다', async () => {
    const { service, capacity, order, paymentWrites } = makeService();

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
    const { service, capacity, orderRef, order } = makeService();

    await service.cleanupPendingOrders();

    expect(capacity.releaseReservation).toHaveBeenCalledTimes(1);
    expect(capacity.releaseReservation).toHaveBeenCalledWith('reservation-1', 'EXPIRED');
    expect(orderRef.update).toHaveBeenCalledTimes(1);
    expect(order.status).toBe('CANCELLED');
  });
});
