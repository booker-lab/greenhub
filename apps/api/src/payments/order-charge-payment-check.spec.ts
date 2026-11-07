// 주문 상세 화면의 재배송비 결제 확인(POST /payments/orders/:orderId/redelivery-charge/check) 계약.
// 웹훅이 늦거나 빠져도 PortOne이 PAID라고 답하면 기존 finalizePaid로만 확정하고,
// PAID가 아니면 청구를 바꾸지 않는다(FAILED로 닫지 않는다). canonical OCC harness, 실제 PortOne 호출 없음.

import 'reflect-metadata';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  ORDER_CHARGE_PAYMENT_CHECK_MIN_INTERVAL_MS,
  OrderChargePaymentService,
} from './order-charge-payment.service';
import { PaymentsController } from './payments.controller';
import {
  PORTONE_TIMEOUT_ERROR_STATUS,
  PORTONE_TIMEOUT_ERROR_TYPE,
  PortoneError,
} from './portone.client';

type Occ = ReturnType<typeof createOccFirestore>;

const HOLD_AT = '2026-08-26T00:00:00.000Z';
const FEE = 5000;
const NOW = Date.parse('2026-11-07T03:00:00.000Z');
const ORDER_ID = 'order-1';
const CHARGE_ID = 'charge-1';
const PAYMENT_ID = `order-charge-${CHARGE_ID}`;

function paymentData(status: string, amount = FEE) {
  return {
    id: PAYMENT_ID,
    status,
    amount: { total: amount },
    method: { type: 'CARD' },
    transactionId: 'tx-1',
  };
}

function seed(
  occ: Occ,
  chargeOverrides: Record<string, unknown> = {},
  orderOverrides: Record<string, unknown> = {},
) {
  occ.seed(`orders/${ORDER_ID}`, {
    id: ORDER_ID,
    storeId: 'store-1',
    userId: 'consumer-1',
    status: 'DELIVERY_HELD',
    deliveryHold: {
      heldAt: HOLD_AT,
      reasonCode: 'ACCESS_UNAVAILABLE',
      reasonMessage: '배송지 출입 불가',
      customerResponsible: true,
      redeliveryFee: FEE,
      nextContactAt: null,
      nextDeliveryAt: null,
      resolvedAt: null,
    },
    redeliveryChargeId: CHARGE_ID,
    redeliveryChargeHoldAt: HOLD_AT,
    ...orderOverrides,
  });
  occ.seed(`orderCharges/${CHARGE_ID}`, {
    id: CHARGE_ID,
    orderId: ORDER_ID,
    storeId: 'store-1',
    userId: 'consumer-1',
    type: 'REDELIVERY_FEE',
    status: 'PENDING',
    amount: FEE,
    customerResponsible: true,
    holdAt: HOLD_AT,
    portonePaymentId: PAYMENT_ID,
    paidAt: null,
    failedAt: null,
    refundedAt: null,
    createdAt: new Date(NOW - 60_000),
    updatedAt: new Date(NOW - 60_000),
    ...chargeOverrides,
  });
}

function makeService(
  occ: Occ,
  getPayment: jest.Mock,
  refund: jest.Mock = jest.fn().mockResolvedValue(undefined),
) {
  const issueWriter = { createOrMergeIssue: jest.fn().mockResolvedValue({ id: 'issue-1' }) };
  const service = new OrderChargePaymentService(
    occ.firestore as never,
    { getPayment, refund } as never,
    issueWriter as never,
  );
  return { service, getPayment, refund, issueWriter };
}

describe('주문 상세 화면의 재배송비 결제 확인', () => {
  let now = NOW;

  beforeEach(() => {
    now = NOW;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('로그인 사용자만 부를 수 있는 POST 경로로 열린다', () => {
    const handler = PaymentsController.prototype.checkOrderChargePayment;
    expect(Reflect.getMetadata('path', handler)).toBe('orders/:orderId/redelivery-charge/check');
    expect(Reflect.getMetadata('method', handler)).toBe(1); // RequestMethod.POST
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard]);
  });

  describe('권한', () => {
    it('다른 손님은 403이고 PortOne을 조회하지 않는다', async () => {
      const occ = createOccFirestore();
      seed(occ);
      const { service, getPayment } = makeService(occ, jest.fn());

      await expect(service.checkOrderChargePayment(ORDER_ID, 'consumer-2')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.checkOrderChargePayment(ORDER_ID, '')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(getPayment).not.toHaveBeenCalled();
    });

    it.each(['missing-order', '../orders/x', 'a'.repeat(129)])(
      '없는 주문·형식이 다른 주문 ID(%s)는 404다',
      async (orderId) => {
        const occ = createOccFirestore();
        seed(occ);
        const { service, getPayment } = makeService(occ, jest.fn());
        await expect(service.checkOrderChargePayment(orderId, 'consumer-1')).rejects.toBeInstanceOf(
          NotFoundException,
        );
        expect(getPayment).not.toHaveBeenCalled();
      },
    );
  });

  describe('청구 상태와 PortOne 상태', () => {
    it('PENDING 재배송비가 PortOne에서 PAID면 웹훅 없이 PAID로 확정한다', async () => {
      const occ = createOccFirestore();
      seed(occ);
      const { service, getPayment, refund } = makeService(
        occ,
        jest.fn().mockResolvedValue(paymentData('PAID')),
      );

      await expect(service.checkOrderChargePayment(ORDER_ID, 'consumer-1')).resolves.toEqual({
        status: 'PAID',
        result: 'finalized',
      });
      expect(getPayment).toHaveBeenCalledWith(PAYMENT_ID);
      expect(refund).not.toHaveBeenCalled();
      expect(occ.getData(`orderCharges/${CHARGE_ID}`)).toMatchObject({
        status: 'PAID',
        portoneTransactionId: 'tx-1',
        paymentCheckRequestedAtMs: NOW,
      });
    });

    it('주문이 취소된 뒤 PAID면 기존 경로대로 기록 뒤 한 번 환불한다', async () => {
      const occ = createOccFirestore();
      seed(occ, {}, { status: 'CANCELLED' });
      const { service, refund } = makeService(occ, jest.fn().mockResolvedValue(paymentData('PAID')));

      await expect(service.checkOrderChargePayment(ORDER_ID, 'consumer-1')).resolves.toEqual({
        status: 'REFUNDED',
        result: 'finalized',
      });
      expect(refund).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['READY', () => Promise.resolve(paymentData('READY'))],
      ['FAILED', () => Promise.resolve(paymentData('FAILED'))],
      [
        '404 PAYMENT_NOT_FOUND',
        () => Promise.reject(new PortoneError(404, 'PAYMENT_NOT_FOUND', '없음')),
      ],
    ])('PortOne이 %s면 청구를 바꾸지 않는다(손님 재시도 유지)', async (_label, lookup) => {
      const occ = createOccFirestore();
      seed(occ);
      const { service } = makeService(occ, jest.fn(lookup));

      await expect(service.checkOrderChargePayment(ORDER_ID, 'consumer-1')).resolves.toEqual({
        status: 'PENDING',
        result: 'not_paid',
      });
      expect(occ.getData(`orderCharges/${CHARGE_ID}`)).toMatchObject({
        status: 'PENDING',
        failedAt: null,
      });
    });

    it.each(['PAID', 'FAILED', 'REFUNDED'])(
      '이미 %s인 청구는 PortOne을 조회하지 않는다',
      async (status) => {
        const occ = createOccFirestore();
        seed(occ, { status });
        const { service, getPayment } = makeService(occ, jest.fn());

        await expect(service.checkOrderChargePayment(ORDER_ID, 'consumer-1')).resolves.toEqual({
          status,
          result: 'not_pending',
        });
        expect(getPayment).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['연결된 재배송비 없음', {}, { redeliveryChargeId: null }],
      ['청구 문서 없음', {}, { redeliveryChargeId: 'charge-missing' }],
      ['다른 주문의 청구', { orderId: 'order-2' }, {}],
      ['다른 손님의 청구', { userId: 'consumer-2' }, {}],
      ['다른 결제 ID', { portonePaymentId: 'order-charge-other' }, {}],
    ])('%s면 PortOne을 조회하지 않는다', async (_label, chargeOverrides, orderOverrides) => {
      const occ = createOccFirestore();
      seed(occ, chargeOverrides, orderOverrides);
      const { service, getPayment } = makeService(occ, jest.fn());

      await expect(service.checkOrderChargePayment(ORDER_ID, 'consumer-1')).resolves.toMatchObject({
        result: 'not_pending',
      });
      expect(getPayment).not.toHaveBeenCalled();
    });
  });

  describe('조회 간격 하한', () => {
    it('같은 청구를 10초 안에 다시 확인하면 PortOne을 다시 조회하지 않는다', async () => {
      const occ = createOccFirestore();
      seed(occ);
      const { service, getPayment } = makeService(
        occ,
        jest.fn().mockResolvedValue(paymentData('READY')),
      );

      await service.checkOrderChargePayment(ORDER_ID, 'consumer-1');
      now = NOW + ORDER_CHARGE_PAYMENT_CHECK_MIN_INTERVAL_MS - 1;
      await expect(service.checkOrderChargePayment(ORDER_ID, 'consumer-1')).resolves.toEqual({
        status: 'PENDING',
        result: 'throttled',
      });
      expect(getPayment).toHaveBeenCalledTimes(1);

      now = NOW + ORDER_CHARGE_PAYMENT_CHECK_MIN_INTERVAL_MS;
      await service.checkOrderChargePayment(ORDER_ID, 'consumer-1');
      expect(getPayment).toHaveBeenCalledTimes(2);
    });

    it('동시에 들어온 같은 청구의 확인 요청은 PortOne을 한 번만 조회한다', async () => {
      const occ = createOccFirestore();
      seed(occ);
      const { service, getPayment } = makeService(
        occ,
        jest.fn().mockResolvedValue(paymentData('READY')),
      );

      const results = await Promise.all([
        service.checkOrderChargePayment(ORDER_ID, 'consumer-1'),
        service.checkOrderChargePayment(ORDER_ID, 'consumer-1'),
      ]);
      expect(results.map((r) => r.result).sort()).toEqual(['not_paid', 'throttled']);
      expect(getPayment).toHaveBeenCalledTimes(1);
    });
  });

  describe('PortOne 오류', () => {
    it.each([
      ['PortOne 500', () => new PortoneError(500, 'INTERNAL', '서버 오류')],
      [
        '시간 초과',
        () => new PortoneError(PORTONE_TIMEOUT_ERROR_STATUS, PORTONE_TIMEOUT_ERROR_TYPE, '초과'),
      ],
      ['네트워크 오류', () => new Error('socket hang up')],
    ])('%s면 청구를 바꾸지 않고 운영 기록도 남기지 않는다', async (_label, makeError) => {
      const occ = createOccFirestore();
      seed(occ);
      const { service, issueWriter } = makeService(occ, jest.fn().mockRejectedValue(makeError()));

      await expect(service.checkOrderChargePayment(ORDER_ID, 'consumer-1')).resolves.toEqual({
        status: 'PENDING',
        result: 'lookup_failed',
      });
      expect(occ.getData(`orderCharges/${CHARGE_ID}`)).toMatchObject({ status: 'PENDING' });
      expect(issueWriter.createOrMergeIssue).not.toHaveBeenCalled();
    });
  });

  describe('웹훅·scheduler와 동시 실행', () => {
    it('웹훅·scheduler·손님 확인이 겹쳐도 한 번만 확정한다', async () => {
      const occ = createOccFirestore();
      seed(occ, { createdAt: new Date(NOW - 20 * 60_000) });
      const { service, getPayment, refund } = makeService(
        occ,
        jest.fn().mockResolvedValue(paymentData('PAID')),
      );

      await Promise.all([
        service.handleWebhook('Transaction.Paid', PAYMENT_ID),
        service.reconcilePendingCharges(),
        service.checkOrderChargePayment(ORDER_ID, 'consumer-1'),
      ]);

      expect(getPayment.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(refund).not.toHaveBeenCalled();
      expect(occ.getData(`orderCharges/${CHARGE_ID}`)).toMatchObject({ status: 'PAID' });
    });

    it('필요 없어진 결제를 웹훅과 손님 확인이 함께 확정해도 환불은 한 번이다', async () => {
      const occ = createOccFirestore();
      seed(occ, {}, { status: 'CANCELLED' });
      const { service, refund } = makeService(occ, jest.fn().mockResolvedValue(paymentData('PAID')));

      await Promise.allSettled([
        service.handleWebhook('Transaction.Paid', PAYMENT_ID),
        service.checkOrderChargePayment(ORDER_ID, 'consumer-1'),
      ]);

      expect(refund).toHaveBeenCalledTimes(1);
      expect(occ.getData(`orderCharges/${CHARGE_ID}`)).toMatchObject({ status: 'REFUNDED' });
    });
  });
});
