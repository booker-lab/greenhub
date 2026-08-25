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

function paymentDataWithStatus(status: string, overrides: Data = {}) {
  return { ...paymentData, status, ...overrides } as never;
}

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
  const issueWriter = { createOrMergeIssue: jest.fn().mockResolvedValue({ id: 'issue-1' }) };
  const retention = { saveRecord: jest.fn().mockResolvedValue({}) };
  const refunds = { refundByOrderId: jest.fn().mockResolvedValue(undefined) };
  const service = new PaymentFinalizationService(
    firestore as never,
    portone as never,
    notifications as never,
    audit as never,
    capacity as never,
    issueWriter as never,
    retention as never,
    refunds as never,
  );
  return {
    service,
    firestore,
    records,
    portone,
    notifications,
    capacity,
    issueWriter,
    retention,
    refunds,
  };
}

describe('결제 최종화 경쟁 조건', () => {
  it.each(['PENDING', 'FAILED', 'CANCELLED'])(
    'PortOne 상태가 %s이면 정상 주문 finalization을 수행하지 않는다',
    async (status) => {
      const fixture = makeFinalization(
        status === 'CANCELLED' ? { status: 'CANCELLED', cancelReason: '소비자 취소' } : {},
      );

      await expect(
        fixture.service.finalizePaidOrder('order-1', paymentDataWithStatus(status)),
      ).resolves.toEqual({ ok: true, reason: 'payment_not_paid' });

      expect(fixture.records.get('orders/order-1')?.status).toBe(
        status === 'CANCELLED' ? 'CANCELLED' : 'PENDING',
      );
      expect(fixture.records.has('payments/order-1')).toBe(false);
      expect(fixture.capacity.consumeReservationInTransaction).not.toHaveBeenCalled();
      expect(fixture.portone.refund).not.toHaveBeenCalled();
    },
  );

  it('PAID group 결제는 기존 RECRUITING finalization을 유지한다', async () => {
    const fixture = makeFinalization({ saleType: 'group' });

    await expect(fixture.service.finalizePaidOrder('order-1', paymentData)).resolves.toEqual({
      ok: true,
      status: 'RECRUITING',
    });

    expect(fixture.records.get('orders/order-1')?.status).toBe('RECRUITING');
    expect(fixture.records.get('payments/order-1')?.status).toBe('PAID');
  });

  it('PAID 금액이 주문 금액과 다르면 기존 환불 방어를 유지한다', async () => {
    const fixture = makeFinalization();

    await expect(
      fixture.service.finalizePaidOrder(
        'order-1',
        paymentDataWithStatus('PAID', { amount: { total: 99999 } }),
      ),
    ).resolves.toEqual({ ok: false, reason: 'amount_mismatch' });

    expect(fixture.portone.refund).toHaveBeenCalledWith(
      'order-1',
      99999,
      '금액 위변조 감지',
    );
    expect(fixture.records.get('orders/order-1')?.status).toBe('CANCELLED');
    expect(fixture.records.has('payments/order-1')).toBe(false);
  });

  it('결제 조회 최종 실패를 허용된 상태 정보만 담아 운영 예외로 기록한다', async () => {
    const fixture = makeFinalization();

    await fixture.service.recordPaymentLookupFailure(
      'order-1',
      new PortoneError(503, 'TEMPORARY_ERROR', 'authorization=민감값'),
    );

    expect(fixture.issueWriter.createOrMergeIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PAYMENT_LOOKUP_FAILED',
        idempotencyKey: 'payment-lookup-failed:order-1',
        latestSnapshot: expect.objectContaining({
          orderStatus: 'PENDING',
          providerStatus: 503,
          providerType: 'TEMPORARY_ERROR',
        }),
      }),
    );
    expect(JSON.stringify(fixture.issueWriter.createOrMergeIssue.mock.calls[0][0])).not.toMatch(
      /authorization|민감값/i,
    );
  });

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

  it.each([
    ['주문 snapshot 이름', '  홍길동  ', 'user-1', '홍길동'],
    ['빈 이름 기본값', '   ', 'user-1', '고객'],
    ['사용자 식별자와 같은 이름 기본값', 'user-1', 'user-1', '고객'],
  ])('ORDER_ACCEPTED에는 %s을 전달한다', async (_name, buyerName, userId, expectedName) => {
    const fixture = makeFinalization({ buyerName, userId });

    await fixture.service.finalizePaidOrder('order-1', paymentData);

    expect(fixture.notifications.sendToUser).toHaveBeenCalledWith(
      userId,
      'ORDER_ACCEPTED',
      { orderId: 'order-1', name: expectedName },
      'order-1',
    );
  });

  it('결제 확정 트랜잭션에 원문 제공자 응답 없는 법정 결제 기록을 남긴다', async () => {
    const fixture = makeFinalization();

    await fixture.service.finalizePaidOrder('order-1', paymentData);

    expect(fixture.retention.saveRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'order-1:payment',
        purpose: 'LEGAL_ORDER',
        metadata: {
          amount: 100000,
          orderId: 'order-1',
          orderStatus: 'ACCEPTED',
          payMethod: 'CARD',
          paymentId: 'order-1',
          paymentStatus: 'PAID',
          recordTypes: ['PAYMENT'],
          storeId: 'store-1',
          userId: 'user-1',
        },
        transaction: expect.anything(),
      }),
    );
    expect(JSON.stringify(fixture.retention.saveRecord.mock.calls)).not.toMatch(
      /transactionId|authorization|token|secret/i,
    );
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
    const issueWriter = { createOrMergeIssue: jest.fn() };
    const service = new PaymentRefundService(
      firestore as never,
      portone as never,
      issueWriter as never,
      { saveRecord: jest.fn().mockResolvedValue({}) } as never,
    );

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

  it('자동 환불 최종 실패를 민감정보 없이 운영 예외로 기록한다', async () => {
    const { firestore } = makeFirestore({
      'payments/payment-1': {
        id: 'payment-1',
        orderId: 'order-1',
        storeId: 'store-1',
        status: 'PAID',
        amount: 100000,
        portonePaymentId: 'provider-payment-1',
      },
    });
    const portone = { refund: jest.fn().mockRejectedValue(new Error('provider token=secret')) };
    const issueWriter = { createOrMergeIssue: jest.fn().mockResolvedValue({ id: 'issue-1' }) };
    const service = new PaymentRefundService(
      firestore as never,
      portone as never,
      issueWriter as never,
      { saveRecord: jest.fn().mockResolvedValue({}) } as never,
    );

    await expect(service.refundByOrderId('order-1', '자동 취소')).rejects.toThrow();

    expect(issueWriter.createOrMergeIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'AUTO_REFUND_FAILED',
        idempotencyKey: 'auto-refund-failed:order-1:payment-1',
      }),
    );
    expect(JSON.stringify(issueWriter.createOrMergeIssue.mock.calls[0][0])).not.toMatch(
      /token|secret|provider-payment-1/i,
    );
  });

  it('환불 완료 트랜잭션에 분쟁·고객응대 법정 기록을 남긴다', async () => {
    const { firestore } = makeFirestore({
      'payments/payment-1': {
        id: 'payment-1',
        orderId: 'order-1',
        storeId: 'store-1',
        userId: 'user-1',
        status: 'PAID',
        amount: 100000,
        portonePaymentId: 'provider-payment-1',
      },
    });
    const retention = { saveRecord: jest.fn().mockResolvedValue({}) };
    const service = new PaymentRefundService(
      firestore as never,
      { refund: jest.fn().mockResolvedValue(undefined) } as never,
      { createOrMergeIssue: jest.fn() } as never,
      retention as never,
    );

    await service.refundByOrderId('order-1', '고객 요청 원문은 보관하지 않음');

    expect(retention.saveRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'payment-1:refund',
        purpose: 'LEGAL_DISPUTE',
        metadata: {
          amount: 100000,
          orderId: 'order-1',
          orderStatus: 'CANCELLED',
          paymentId: 'payment-1',
          paymentStatus: 'CANCELLED',
          recordTypes: ['REFUND', 'DISPUTE', 'SUPPORT'],
          storeId: 'store-1',
          userId: 'user-1',
        },
        transaction: expect.anything(),
      }),
    );
    expect(JSON.stringify(retention.saveRecord.mock.calls)).not.toMatch(
      /고객 요청 원문|provider-payment-1/i,
    );
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
      recordPaymentLookupFailure: jest.fn(),
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
    expect(finalization.recordPaymentLookupFailure).not.toHaveBeenCalled();
  });

  it('scheduler의 결제 조회 최종 실패를 운영 예외 기록에 위임한다', async () => {
    const { firestore } = makeFirestore({ 'orders/order-1': { id: 'order-1', status: 'PENDING' } });
    const error = new PortoneError(503, 'TEMPORARY_ERROR', '민감값 없는 일시 오류');
    const finalization = {
      finalizePaidOrder: jest.fn(),
      cancelPendingOrder: jest.fn(),
      recordPaymentLookupFailure: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PaymentsService(
      firestore as never,
      { getPayment: jest.fn().mockRejectedValue(error) } as never,
      finalization as never,
      {} as never,
      {} as never,
    );

    await service.cleanupPendingOrders();

    expect(finalization.recordPaymentLookupFailure).toHaveBeenCalledWith('order-1', error);
    expect(finalization.cancelPendingOrder).not.toHaveBeenCalled();
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
