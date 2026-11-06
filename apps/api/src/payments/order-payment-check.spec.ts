import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { E2EPortoneClient } from './e2e-portone.client';
import { PaymentFinalizationService } from './payment-finalization.service';
import { PaymentsController } from './payments.controller';
import { ORDER_PAYMENT_CHECK_MIN_INTERVAL_MS, PaymentsService } from './payments.service';
import {
  PORTONE_TIMEOUT_ERROR_STATUS,
  PORTONE_TIMEOUT_ERROR_TYPE,
  PortoneError,
} from './portone.client';

// 결제 완료 화면의 결제 확인(POST /payments/orders/:orderId/check) 계약.
// 웹훅이 늦거나 빠져도 PortOne이 PAID라고 답하면 기존 finalizePaidOrder로만 확정하고,
// PAID가 아니면 주문을 바꾸지 않는다.

type Data = Record<string, any>;

function makeSnap(data: Data | null) {
  return { exists: data !== null, data: () => data };
}

function makeFirestore(initial: Record<string, Data>) {
  const records = new Map(Object.entries(initial));
  const refs = new Map<string, Data>();
  const doc = jest.fn((path: string) => {
    if (!refs.has(path)) {
      refs.set(path, {
        path,
        get: jest.fn(async () => makeSnap(records.get(path) ?? null)),
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
          .map(([path, data]) => ({ id: path.split('/')[1], data: () => data, ref: doc(path) }));
        return { empty: docs.length === 0, size: docs.length, docs };
      },
    };
    return query;
  });
  // Firestore 트랜잭션처럼 한 번에 하나씩 커밋한다(동시에 들어온 요청도 직렬화된다).
  let transactionQueue = Promise.resolve();
  const firestore = {
    doc,
    collection,
    runTransaction: jest.fn((callback: (tx: Data) => Promise<unknown>) => {
      const result = transactionQueue.then(() => callback(transaction));
      transactionQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    }),
    Timestamp: {
      now: jest.fn(() => new Date('2026-11-06T00:00:00.000Z')),
      fromDate: jest.fn((date: Date) => date),
    },
  };
  return { firestore, records };
}

function paidData(overrides: Data = {}) {
  return {
    id: 'order-1',
    transactionId: 'tx-1',
    amount: { total: 100000 },
    status: 'PAID',
    method: { type: 'CARD' },
    ...overrides,
  };
}

function baseOrder(overrides: Data = {}) {
  return {
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
}

// finalization을 가짜로 두고 결제 확인 경로만 본다.
function makeServiceWithMockFinalization(order: Data | null, portone: Data) {
  const { firestore, records } = makeFirestore(order ? { 'orders/order-1': order } : {});
  const finalization = {
    finalizePaidOrder: jest.fn(async () => {
      records.set('orders/order-1', { ...records.get('orders/order-1'), status: 'ACCEPTED' });
      return { ok: true, status: 'ACCEPTED' };
    }),
    cancelPendingOrder: jest.fn(),
    recordPaymentLookupFailure: jest.fn(),
  };
  const service = new PaymentsService(
    firestore as never,
    portone as never,
    finalization as never,
    { refundByOrderId: jest.fn() } as never,
    { isOrderChargePaymentId: jest.fn().mockReturnValue(false) } as never,
    { createOrMergeIssue: jest.fn() } as never,
  );
  return { service, firestore, records, finalization };
}

// 실제 PaymentFinalizationService로 웹훅·scheduler·결제 확인이 한 번만 확정하는지 본다.
function makeServiceWithRealFinalization(portone: Data) {
  const { firestore, records } = makeFirestore({ 'orders/order-1': baseOrder() });
  const notifications = { sendToUser: jest.fn() };
  const capacity = {
    consumeReservationInTransaction: jest.fn(async () => ({ status: 'CONSUMED' })),
    releaseReservationInTransaction: jest.fn(async () => ({ status: 'EXPIRED' })),
    reacquireAndConsumeLatePaymentInTransaction: jest.fn(),
  };
  const finalization = new PaymentFinalizationService(
    firestore as never,
    portone as never,
    notifications as never,
    { log: jest.fn() } as never,
    capacity as never,
    { createOrMergeIssue: jest.fn() } as never,
    { saveRecord: jest.fn().mockResolvedValue({}) } as never,
    { refundByOrderId: jest.fn() } as never,
  );
  const service = new PaymentsService(
    firestore as never,
    portone as never,
    finalization,
    { refundByOrderId: jest.fn() } as never,
    { isOrderChargePaymentId: jest.fn().mockReturnValue(false) } as never,
    { createOrMergeIssue: jest.fn() } as never,
  );
  return { service, records, notifications, capacity };
}

describe('결제 완료 화면의 결제 확인', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('로그인 사용자만 부를 수 있는 POST 경로로 열린다', () => {
    const handler = PaymentsController.prototype.checkOrderPayment;
    expect(Reflect.getMetadata('path', handler)).toBe('orders/:orderId/check');
    expect(Reflect.getMetadata('method', handler)).toBe(1); // RequestMethod.POST
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard]);
  });

  describe('권한', () => {
    it('주문 당사자는 확인할 수 있다', async () => {
      const portone = { getPayment: jest.fn().mockResolvedValue(paidData()) };
      const { service, finalization } = makeServiceWithMockFinalization(baseOrder(), portone);

      await expect(service.checkOrderPayment('order-1', 'user-1')).resolves.toEqual({
        status: 'ACCEPTED',
        result: 'finalized',
      });
      expect(finalization.finalizePaidOrder).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['다른 손님', 'user-2'],
      ['관리자', 'admin-1'],
      ['빈 사용자', ''],
    ])('%s의 요청은 거절하고 PortOne을 조회하지 않는다', async (_label, requesterId) => {
      const portone = { getPayment: jest.fn().mockResolvedValue(paidData()) };
      const { service, records, finalization } = makeServiceWithMockFinalization(
        baseOrder(),
        portone,
      );

      await expect(service.checkOrderPayment('order-1', requesterId)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(portone.getPayment).not.toHaveBeenCalled();
      expect(finalization.finalizePaidOrder).not.toHaveBeenCalled();
      expect(records.get('orders/order-1')).toEqual(baseOrder());
    });

    it.each([
      ['없는 주문', 'order-1'],
      ['경로 문자가 섞인 주문 ID', 'orders/order-1'],
    ])('%s은 찾을 수 없다고 답한다', async (_label, orderId) => {
      const portone = { getPayment: jest.fn() };
      const { service } = makeServiceWithMockFinalization(null, portone);

      await expect(service.checkOrderPayment(orderId, 'user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(portone.getPayment).not.toHaveBeenCalled();
    });
  });

  describe('주문 상태와 PortOne 상태', () => {
    it('PENDING 주문이 PortOne에서 PAID면 기존 확정 경로로 넘긴다', async () => {
      const payment = paidData();
      const portone = { getPayment: jest.fn().mockResolvedValue(payment) };
      const { service, finalization } = makeServiceWithMockFinalization(baseOrder(), portone);

      await expect(service.checkOrderPayment('order-1', 'user-1')).resolves.toEqual({
        status: 'ACCEPTED',
        result: 'finalized',
      });
      expect(portone.getPayment).toHaveBeenCalledWith('order-1');
      expect(finalization.finalizePaidOrder).toHaveBeenCalledWith('order-1', payment);
    });

    it.each(['READY', 'FAILED', 'PENDING', 'CANCELLED', 'VIRTUAL_ACCOUNT_ISSUED'])(
      'PortOne 상태가 %s면 주문을 바꾸지도 취소하지도 않는다',
      async (providerStatus) => {
        const portone = {
          getPayment: jest.fn().mockResolvedValue(paidData({ status: providerStatus })),
        };
        const { service, records, finalization } = makeServiceWithMockFinalization(
          baseOrder(),
          portone,
        );

        await expect(service.checkOrderPayment('order-1', 'user-1')).resolves.toEqual({
          status: 'PENDING',
          result: 'not_paid',
        });
        expect(finalization.finalizePaidOrder).not.toHaveBeenCalled();
        expect(finalization.cancelPendingOrder).not.toHaveBeenCalled();
        expect(records.get('orders/order-1')?.status).toBe('PENDING');
      },
    );

    it('PortOne에 아직 결제가 없으면(404 PAYMENT_NOT_FOUND) 주문을 바꾸지 않는다', async () => {
      const portone = {
        getPayment: jest.fn().mockRejectedValue(new PortoneError(404, 'PAYMENT_NOT_FOUND', '없음')),
      };
      const { service, records, finalization } = makeServiceWithMockFinalization(
        baseOrder(),
        portone,
      );

      await expect(service.checkOrderPayment('order-1', 'user-1')).resolves.toEqual({
        status: 'PENDING',
        result: 'not_paid',
      });
      expect(finalization.cancelPendingOrder).not.toHaveBeenCalled();
      expect(records.get('orders/order-1')?.status).toBe('PENDING');
    });

    it.each([
      ['ACCEPTED', {}],
      ['RECRUITING', {}],
      ['CANCELLED', { cancelReason: 'timeout' }],
    ])('이미 %s인 주문은 PortOne을 조회하지 않고 현재 상태만 돌려준다', async (status, extra) => {
      const portone = { getPayment: jest.fn() };
      const { service, firestore, finalization } = makeServiceWithMockFinalization(
        baseOrder({ status, ...extra }),
        portone,
      );

      await expect(service.checkOrderPayment('order-1', 'user-1')).resolves.toEqual({
        status,
        result: 'not_pending',
      });
      expect(portone.getPayment).not.toHaveBeenCalled();
      expect(finalization.finalizePaidOrder).not.toHaveBeenCalled();
      expect(firestore.runTransaction).not.toHaveBeenCalled();
    });
  });

  describe('조회 간격 하한', () => {
    it('같은 주문을 간격 안에 다시 확인하면 PortOne을 다시 조회하지 않는다', async () => {
      let now = 1_800_000_000_000;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      const portone = {
        getPayment: jest.fn().mockResolvedValue(paidData({ status: 'READY' })),
      };
      const { service, records } = makeServiceWithMockFinalization(baseOrder(), portone);

      await expect(service.checkOrderPayment('order-1', 'user-1')).resolves.toEqual({
        status: 'PENDING',
        result: 'not_paid',
      });
      expect(records.get('orders/order-1')?.paymentCheckRequestedAtMs).toBe(now);

      now += ORDER_PAYMENT_CHECK_MIN_INTERVAL_MS - 1;
      await expect(service.checkOrderPayment('order-1', 'user-1')).resolves.toEqual({
        status: 'PENDING',
        result: 'throttled',
      });
      expect(portone.getPayment).toHaveBeenCalledTimes(1);

      now += 1;
      await expect(service.checkOrderPayment('order-1', 'user-1')).resolves.toEqual({
        status: 'PENDING',
        result: 'not_paid',
      });
      expect(portone.getPayment).toHaveBeenCalledTimes(2);
    });

    it('동시에 들어온 같은 주문의 확인 요청은 PortOne을 한 번만 조회한다', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
      const portone = {
        getPayment: jest.fn().mockResolvedValue(paidData({ status: 'READY' })),
      };
      const { service } = makeServiceWithMockFinalization(baseOrder(), portone);

      const results = await Promise.all([
        service.checkOrderPayment('order-1', 'user-1'),
        service.checkOrderPayment('order-1', 'user-1'),
        service.checkOrderPayment('order-1', 'user-1'),
      ]);

      expect(results.map((r) => r.result).sort()).toEqual(['not_paid', 'throttled', 'throttled']);
      expect(portone.getPayment).toHaveBeenCalledTimes(1);
    });
  });

  describe('PortOne 오류', () => {
    it.each([
      [
        '시간 초과',
        new PortoneError(PORTONE_TIMEOUT_ERROR_STATUS, PORTONE_TIMEOUT_ERROR_TYPE, 'x'),
      ],
      ['일시 오류', new PortoneError(503, 'TEMPORARY_ERROR', 'authorization=민감값')],
      ['네트워크 오류', new TypeError('fetch failed')],
    ])('%s는 주문을 바꾸지 않고 일반 결과만 돌려준다', async (_label, error) => {
      const portone = { getPayment: jest.fn().mockRejectedValue(error) };
      const { service, records, finalization } = makeServiceWithMockFinalization(
        baseOrder(),
        portone,
      );

      const response = await service.checkOrderPayment('order-1', 'user-1');

      expect(response).toEqual({ status: 'PENDING', result: 'lookup_failed' });
      expect(JSON.stringify(response)).not.toMatch(/authorization|민감값|fetch failed/);
      expect(finalization.cancelPendingOrder).not.toHaveBeenCalled();
      expect(finalization.finalizePaidOrder).not.toHaveBeenCalled();
      // 운영 확인 기록은 15분 scheduler의 최종 조회만 남긴다.
      expect(finalization.recordPaymentLookupFailure).not.toHaveBeenCalled();
      expect(records.get('orders/order-1')?.status).toBe('PENDING');
    });
  });

  describe('웹훅·scheduler와 동시 실행', () => {
    it('웹훅·scheduler·결제 확인이 겹쳐도 주문을 한 번만 확정한다', async () => {
      const portone = { getPayment: jest.fn().mockResolvedValue(paidData()), refund: jest.fn() };
      const { service, records, notifications, capacity } =
        makeServiceWithRealFinalization(portone);

      const results = await Promise.all([
        service.checkOrderPayment('order-1', 'user-1'),
        service.handleWebhook({
          type: 'Transaction.Paid',
          data: { paymentId: 'order-1' },
        } as never),
        service.checkOrderPayment('order-1', 'user-1'),
        service.cleanupPendingOrders(),
      ]);

      expect(records.get('orders/order-1')?.status).toBe('ACCEPTED');
      expect(records.get('payments/order-1')?.status).toBe('PAID');
      expect(capacity.consumeReservationInTransaction).toHaveBeenCalledTimes(1);
      expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
      expect(portone.refund).not.toHaveBeenCalled();
      expect(results[0]).toEqual(expect.objectContaining({ status: 'ACCEPTED' }));
    });

    it('웹훅이 먼저 확정한 주문은 결제 확인이 다시 조회·확정하지 않는다', async () => {
      const portone = { getPayment: jest.fn().mockResolvedValue(paidData()), refund: jest.fn() };
      const { service, records, notifications } = makeServiceWithRealFinalization(portone);

      await service.handleWebhook({
        type: 'Transaction.Paid',
        data: { paymentId: 'order-1' },
      } as never);
      await expect(service.checkOrderPayment('order-1', 'user-1')).resolves.toEqual({
        status: 'ACCEPTED',
        result: 'not_pending',
      });

      expect(portone.getPayment).toHaveBeenCalledTimes(1);
      expect(records.get('orders/order-1')?.status).toBe('ACCEPTED');
      expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
    });
  });

  describe('E2E PortOne 대역', () => {
    const runId = 'payment-check-run-001';
    const paymentId = `round-direct-e2e-${runId}-order-check`;

    function makeE2EService(fixture: Data) {
      const portone = new E2EPortoneClient(
        new ConfigService({
          NODE_ENV: 'test',
          RAILWAY_ENVIRONMENT_NAME: 'staging',
          ROUND_DIRECT_E2E_ENABLED: 'true',
          ROUND_DIRECT_E2E_ENV: 'preview',
          ROUND_DIRECT_E2E_PROVIDER_MODE: 'stub',
          ROUND_DIRECT_E2E_SHARED_SECRET: '비공개',
          FIREBASE_PROJECT_ID: 'green-staging-74557',
          ROUND_DIRECT_E2E_ALLOWED_FIREBASE_PROJECTS: 'green-staging-74557',
          ROUND_DIRECT_E2E_RUN_ID: runId,
          ROUND_DIRECT_E2E_PORTONE_FIXTURES_JSON: JSON.stringify({ [paymentId]: fixture }),
        }),
      );
      const { firestore, records } = makeFirestore({
        [`orders/${paymentId}`]: baseOrder({ id: paymentId }),
        [`orders/round-direct-e2e-other-run-order`]: baseOrder({ id: 'other' }),
      });
      const finalization = {
        finalizePaidOrder: jest.fn(async (orderId: string) => {
          records.set(`orders/${orderId}`, {
            ...records.get(`orders/${orderId}`),
            status: 'ACCEPTED',
          });
          return { ok: true, status: 'ACCEPTED' };
        }),
        cancelPendingOrder: jest.fn(),
        recordPaymentLookupFailure: jest.fn(),
      };
      const service = new PaymentsService(
        firestore as never,
        portone as never,
        finalization as never,
        {} as never,
        {} as never,
        {} as never,
      );
      return { service, portone, records, finalization };
    }

    it('대역의 조회 순서(READY 뒤 PAID)대로 확인하고 PAID에서만 확정한다', async () => {
      let now = 1_800_000_000_000;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      const { service, portone, records, finalization } = makeE2EService({
        amount: 100000,
        lookupStatuses: ['READY', 'PAID'],
      });

      await expect(service.checkOrderPayment(paymentId, 'user-1')).resolves.toEqual({
        status: 'PENDING',
        result: 'not_paid',
      });
      expect(records.get(`orders/${paymentId}`)?.status).toBe('PENDING');

      now += ORDER_PAYMENT_CHECK_MIN_INTERVAL_MS;
      await expect(service.checkOrderPayment(paymentId, 'user-1')).resolves.toEqual({
        status: 'ACCEPTED',
        result: 'finalized',
      });
      expect(finalization.finalizePaidOrder).toHaveBeenCalledWith(
        paymentId,
        expect.objectContaining({ status: 'PAID', amount: { total: 100000 } }),
      );
      expect(portone.getCallEvidence().map((call) => call.result)).toEqual(['READY', 'PAID']);
    });

    it('대역 실행 범위 밖 주문은 조회 실패로만 답하고 주문을 바꾸지 않는다', async () => {
      const { service, records, finalization } = makeE2EService({ amount: 100000 });

      await expect(
        service.checkOrderPayment('round-direct-e2e-other-run-order', 'user-1'),
      ).resolves.toEqual({ status: 'PENDING', result: 'lookup_failed' });
      expect(records.get('orders/round-direct-e2e-other-run-order')?.status).toBe('PENDING');
      expect(finalization.finalizePaidOrder).not.toHaveBeenCalled();
      expect(finalization.cancelPendingOrder).not.toHaveBeenCalled();
    });
  });
});
