import { OrderChargePaymentService } from './order-charge-payment.service';
import { PaymentFinalizationService } from './payment-finalization.service';
import { PaymentRefundService } from './payment-refund.service';
import { PaymentsService } from './payments.service';
import { PortoneError } from './portone.client';

type Data = Record<string, any>;

function makeSnap(data: Data | null, ref?: Data) {
  return { exists: data !== null, data: () => data, ref };
}

function makeFirestore(initial: Record<string, Data>) {
  const records = new Map(Object.entries(initial));
  const refs = new Map<string, Data>();
  const doc = jest.fn((path: string) => {
    if (!refs.has(path)) {
      refs.set(path, {
        path,
        get: jest.fn(async () => makeSnap(records.get(path) ?? null, refs.get(path))),
        set: jest.fn(async (data: Data) => records.set(path, data)),
        update: jest.fn(async (data: Data) =>
          records.set(path, { ...(records.get(path) ?? {}), ...data }),
        ),
      });
    }
    return refs.get(path);
  });
  const transaction = {
    get: jest.fn((ref: Data) => ref.get()),
    set: jest.fn((ref: Data, data: Data) => ref.set(data)),
    update: jest.fn((ref: Data, data: Data) => ref.update(data)),
  };
  const collection = jest.fn((name: string) => {
    const filters: Array<[string, string, any]> = [];
    const query: Data = {
      where(field: string, op: string, value: any) {
        filters.push([field, op, value]);
        return query;
      },
      limit() {
        return query;
      },
      async get() {
        const docs = Array.from(records.entries())
          .filter(([path, data]) => {
            if (!path.startsWith(`${name}/`)) return false;
            return filters.every(([field, op, value]) =>
              op === '<' ? true : data[field] === value,
            );
          })
          .map(([path, data]) => ({
            id: path.split('/')[1],
            data: () => data,
            ref: doc(path),
          }));
        return { empty: docs.length === 0, size: docs.length, docs };
      },
    };
    return query;
  });
  let transactionQueue = Promise.resolve();
  const firestore = {
    doc,
    collection,
    runTransaction: jest.fn((callback: (tx: Data) => Promise<void>) => {
      const result = transactionQueue.then(() => callback(transaction));
      transactionQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    }),
    Timestamp: {
      now: jest.fn(() => new Date('2026-07-17T00:00:00.000Z')),
      fromDate: jest.fn((date: Date) => date),
    },
  };
  return { firestore, records };
}

const paymentData = {
  amount: { total: 100000 },
  status: 'PAID',
  method: { type: 'CARD' },
  transactionId: 'tx-1',
} as never;

function makeFinalization(overrides: Data = {}) {
  const order = {
    id: 'order-1',
    storeId: 'store-1',
    userId: 'user-1',
    status: 'PENDING',
    saleType: 'normal',
    schemaVersion: 2,
    roundId: 'round-1',
    reservationId: 'reservation-1',
    deliveryAddress: { address: '경기도 이천시 중리천로 1' },
    orderItems: [{ roundItemId: 'round-item-1', quantity: 2 }],
    totalAmount: 100000,
    ...overrides,
  };
  const { firestore, records } = makeFirestore({ 'orders/order-1': order });
  const portone = { refund: jest.fn(), getPayment: jest.fn() };
  const notifications = { sendToUser: jest.fn() };
  const audit = { log: jest.fn() };
  const capacity = {
    reserveCheckout: jest.fn().mockResolvedValue({ id: 'late-reservation-1' }),
    consumeReservationInTransaction: jest.fn(async () => ({ status: 'CONSUMED' })),
    releaseReservationInTransaction: jest.fn(async () => ({ status: 'EXPIRED' })),
  };
  const service = new PaymentFinalizationService(
    firestore as never,
    portone as never,
    notifications as never,
    audit as never,
    capacity as never,
  );
  return { service, firestore, records, portone, notifications, capacity };
}

describe('결제 최종화 경쟁 조건', () => {
  it('중복 웹훅은 예약과 주문을 정확히 한 번만 확정한다', async () => {
    const fixture = makeFinalization();
    const results = await Promise.all([
      fixture.service.finalizePaidOrder('order-1', paymentData),
      fixture.service.finalizePaidOrder('order-1', paymentData),
    ]);

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'ACCEPTED' }),
        expect.objectContaining({ reason: 'already_processed' }),
      ]),
    );
    expect(fixture.capacity.consumeReservationInTransaction).toHaveBeenCalledTimes(1);
    expect(fixture.records.get('orders/order-1')?.status).toBe('ACCEPTED');
    expect(fixture.records.get('payments/order-1')?.status).toBe('PAID');
    expect(fixture.notifications.sendToUser).toHaveBeenCalledTimes(1);
  });

  it('scheduler timeout과 결제 확정 경쟁은 최신 주문 상태 하나로 수렴한다', async () => {
    const fixture = makeFinalization();
    await Promise.all([
      fixture.service.cancelPendingOrder('order-1', 'timeout'),
      fixture.service.finalizePaidOrder('order-1', paymentData),
    ]);

    const order = fixture.records.get('orders/order-1')!;
    expect(['CANCELLED', 'ACCEPTED']).toContain(order.status);
    if (order.status === 'ACCEPTED') {
      expect(fixture.records.get('payments/order-1')?.status).toBe('PAID');
      expect(fixture.capacity.consumeReservationInTransaction).toHaveBeenCalledTimes(1);
    } else {
      expect(order.cancelReason).toBe('timeout');
      expect(fixture.capacity.releaseReservationInTransaction).toHaveBeenCalledTimes(1);
    }
  });

  it('timeout 뒤 늦은 결제는 새 예약을 소비하고 주문을 확정한다', async () => {
    const fixture = makeFinalization({ status: 'CANCELLED', cancelReason: 'timeout' });
    await expect(fixture.service.finalizePaidOrder('order-1', paymentData)).resolves.toMatchObject({
      status: 'ACCEPTED',
    });
    expect(fixture.capacity.reserveCheckout).toHaveBeenCalledTimes(1);
    expect(fixture.capacity.consumeReservationInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reservationId: 'late-reservation-1' }),
    );
    expect(fixture.records.get('orders/order-1')?.reservationId).toBe('late-reservation-1');
  });

  it('늦은 결제 한도 재확보 실패는 전액 환불 기록으로 수렴한다', async () => {
    const fixture = makeFinalization({ status: 'CANCELLED', cancelReason: 'timeout' });
    fixture.capacity.reserveCheckout.mockRejectedValue(new Error('회차 마감'));
    await expect(fixture.service.finalizePaidOrder('order-1', paymentData)).resolves.toMatchObject({
      reason: 'late_payment_refunded',
    });
    expect(fixture.portone.refund).toHaveBeenCalledTimes(1);
    expect(fixture.records.get('payments/order-1')).toMatchObject({
      status: 'CANCELLED',
      refundAmount: 100000,
    });
  });
});

describe('환불 멱등 claim', () => {
  it('동일 환불의 동시 호출과 완료 뒤 재시도는 외부 환불을 한 번만 호출한다', async () => {
    const { firestore, records } = makeFirestore({
      'payments/order-1': {
        id: 'order-1',
        orderId: 'order-1',
        status: 'PAID',
        amount: 100000,
        portonePaymentId: 'order-1',
      },
    });
    const portone = { refund: jest.fn().mockResolvedValue(undefined) };
    const service = new PaymentRefundService(firestore as never, portone as never);

    await Promise.all([
      service.refundByOrderId('order-1', '고객 요청'),
      service.refundByOrderId('order-1', '고객 요청'),
    ]);
    await service.refundByOrderId('order-1', '고객 요청');

    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(records.get('payments/order-1')).toMatchObject({
      status: 'CANCELLED',
      refundAmount: 100000,
      refundClaim: null,
    });
  });
});

describe('결제 facade 위임', () => {
  it('웹훅과 scheduler는 최종화 서비스에 위임하고 조회 오류를 격리한다', async () => {
    const order = { id: 'order-1', status: 'PENDING' };
    const { firestore } = makeFirestore({ 'orders/order-1': order });
    const portone = {
      getPayment: jest
        .fn()
        .mockResolvedValueOnce(paymentData)
        .mockRejectedValueOnce(new PortoneError(404, 'PAYMENT_NOT_FOUND', '없음')),
    };
    const finalization = {
      finalizePaidOrder: jest.fn().mockResolvedValue({ ok: true, status: 'ACCEPTED' }),
      cancelPendingOrder: jest.fn().mockResolvedValue(true),
    };
    const service = new PaymentsService(
      firestore as never,
      portone as never,
      finalization as never,
      { refundByOrderId: jest.fn() } as never,
      {
        isOrderChargePaymentId: jest.fn().mockReturnValue(false),
      } as never,
    );

    await service.handleWebhook({
      type: 'Transaction.Paid',
      data: { paymentId: 'order-1' },
    } as never);
    await service.cleanupPendingOrders();

    expect(finalization.finalizePaidOrder).toHaveBeenCalledTimes(1);
    expect(finalization.cancelPendingOrder).toHaveBeenCalledWith('order-1', 'timeout');
  });
});

describe('재배송비 결제 수명주기', () => {
  function makeChargePayment() {
    const { firestore, records } = makeFirestore({
      'orders/order-1': {
        id: 'order-1',
        storeId: 'store-1',
        userId: 'user-1',
        status: 'DELIVERY_HELD',
        redeliveryChargeId: 'charge-1',
      },
      'orderCharges/charge-1': {
        id: 'charge-1',
        orderId: 'order-1',
        storeId: 'store-1',
        userId: 'user-1',
        type: 'REDELIVERY_FEE',
        status: 'PENDING',
        amount: 5000,
        portonePaymentId: 'order-charge-charge-1',
        paidAt: null,
        failedAt: null,
        refundedAt: null,
      },
    });
    const portone = {
      getPayment: jest.fn().mockResolvedValue({
        amount: { total: 5000 },
        status: 'PAID',
        method: { type: 'CARD' },
        transactionId: 'charge-tx-1',
      }),
      refund: jest.fn().mockResolvedValue(undefined),
    };
    const service = new OrderChargePaymentService(firestore as never, portone as never);
    return { service, firestore, records, portone };
  }

  it('재배송비 결제 웹훅은 서버 검증 뒤 PENDING 청구를 PAID로 확정한다', async () => {
    const fixture = makeChargePayment();
    const facade = new PaymentsService(
      fixture.firestore as never,
      fixture.portone as never,
      {} as never,
      {} as never,
      fixture.service,
    );

    await expect(
      facade.handleWebhook({
        type: 'Transaction.Paid',
        data: { paymentId: 'order-charge-charge-1' },
      } as never),
    ).resolves.toMatchObject({ ok: true, status: 'PAID' });

    expect(fixture.records.get('orderCharges/charge-1')).toMatchObject({
      status: 'PAID',
      portoneTransactionId: 'charge-tx-1',
      paidAt: expect.anything(),
    });
  });

  it('재배송비 실패 웹훅과 중복 웹훅은 FAILED 상태로 한 번만 수렴한다', async () => {
    const fixture = makeChargePayment();
    const facade = new PaymentsService(
      fixture.firestore as never,
      fixture.portone as never,
      {} as never,
      {} as never,
      fixture.service,
    );

    await facade.handleWebhook({
      type: 'Transaction.Failed',
      data: { paymentId: 'order-charge-charge-1' },
    } as never);
    await facade.handleWebhook({
      type: 'Transaction.Failed',
      data: { paymentId: 'order-charge-charge-1' },
    } as never);

    expect(fixture.records.get('orderCharges/charge-1')).toMatchObject({
      status: 'FAILED',
      failedAt: expect.anything(),
    });
    expect(fixture.portone.getPayment).not.toHaveBeenCalled();
  });

  it('재배송비 결제 금액이나 주문 관계가 다르면 확정하지 않는다', async () => {
    const fixture = makeChargePayment();
    fixture.portone.getPayment.mockResolvedValue({
      amount: { total: 4000 },
      status: 'PAID',
      method: { type: 'CARD' },
      transactionId: 'charge-tx-1',
    });

    await expect(
      fixture.service.handleWebhook('Transaction.Paid', 'order-charge-charge-1'),
    ).rejects.toThrow('재배송비 결제 정보가 일치하지 않습니다.');

    expect(fixture.records.get('orderCharges/charge-1')?.status).toBe('PENDING');
  });

  it('재배송비 환불의 동시 호출과 완료 뒤 재시도는 PortOne을 한 번만 호출한다', async () => {
    const fixture = makeChargePayment();
    fixture.records.set('orderCharges/charge-1', {
      ...fixture.records.get('orderCharges/charge-1')!,
      status: 'PAID',
      paidAt: new Date('2026-07-17T00:00:00.000Z'),
    });

    await Promise.all([
      fixture.service.refundByOrderId('order-1', '주문 취소'),
      fixture.service.refundByOrderId('order-1', '주문 취소'),
    ]);
    await fixture.service.refundByOrderId('order-1', '주문 취소');

    expect(fixture.portone.refund).toHaveBeenCalledTimes(1);
    expect(fixture.portone.refund).toHaveBeenCalledWith('order-charge-charge-1', 5000, '주문 취소');
    expect(fixture.records.get('orderCharges/charge-1')).toMatchObject({
      status: 'REFUNDED',
      refundedAt: expect.anything(),
      refundClaim: null,
    });
  });
});
