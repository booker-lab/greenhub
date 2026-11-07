// 웹훅 밖 재배송비 확인(OrderChargePaymentService.reconcilePendingCharges) 계약.
// 웹훅이 빠져도 오래된 PENDING 재배송비를 PortOne에 직접 물어 PAID면 기존 finalizePaid로만 확정하고,
// PAID가 아니면 손님 재시도를 막지 않도록 그대로 둔다(주문에 필요 없어진 오래된 청구만 기존 markFailed로 닫는다).
// canonical OCC harness로 웹훅과의 동시 실행을 실제 트랜잭션 충돌·재시도로 확인한다. 실제 PortOne 호출 없음.

import { ConfigService } from '@nestjs/config';
import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { E2EPortoneClient } from './e2e-portone.client';
import { OrderChargePaymentService } from './order-charge-payment.service';
import {
  PORTONE_TIMEOUT_ERROR_STATUS,
  PORTONE_TIMEOUT_ERROR_TYPE,
  PortoneError,
} from './portone.client';

type Occ = ReturnType<typeof createOccFirestore>;

const HOLD_AT = '2026-08-26T00:00:00.000Z';
const FEE = 5000;
const NOW = Date.parse('2026-11-07T03:00:00.000Z');
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function paymentData(status: string, amount = FEE) {
  return {
    id: 'ignored',
    status,
    amount: { total: amount },
    method: { type: 'CARD' },
    transactionId: 'tx-1',
  };
}

function notFound() {
  return new PortoneError(404, 'PAYMENT_NOT_FOUND', '결제 건이 존재하지 않습니다.');
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
  return { service, issueWriter, getPayment, refund };
}

function seedOrder(
  occ: Occ,
  orderId: string,
  chargeId: string,
  overrides: Record<string, unknown> = {},
) {
  occ.seed(`orders/${orderId}`, {
    id: orderId,
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
    redeliveryChargeId: chargeId,
    redeliveryChargeHoldAt: HOLD_AT,
    ...overrides,
  });
}

function seedCharge(
  occ: Occ,
  chargeId: string,
  orderId: string,
  overrides: Record<string, unknown> = {},
) {
  occ.seed(`orderCharges/${chargeId}`, {
    id: chargeId,
    orderId,
    storeId: 'store-1',
    userId: 'consumer-1',
    type: 'REDELIVERY_FEE',
    status: 'PENDING',
    amount: FEE,
    customerResponsible: true,
    holdAt: HOLD_AT,
    portonePaymentId: `order-charge-${chargeId}`,
    paidAt: null,
    failedAt: null,
    refundedAt: null,
    createdAt: new Date(NOW - 20 * MINUTE),
    updatedAt: new Date(NOW - 20 * MINUTE),
    ...overrides,
  });
}

function seedLinked(
  occ: Occ,
  chargeId: string,
  orderId: string,
  chargeOverrides: Record<string, unknown> = {},
  orderOverrides: Record<string, unknown> = {},
) {
  seedOrder(occ, orderId, chargeId, orderOverrides);
  seedCharge(occ, chargeId, orderId, chargeOverrides);
}

const RESOLVED_HOLD = {
  deliveryHold: {
    heldAt: HOLD_AT,
    reasonCode: 'ACCESS_UNAVAILABLE',
    reasonMessage: '배송지 출입 불가',
    customerResponsible: true,
    redeliveryFee: FEE,
    nextContactAt: null,
    nextDeliveryAt: null,
    resolvedAt: '2026-11-06T00:00:00.000Z',
  },
};

describe('웹훅 밖 재배송비 확인(reconcilePendingCharges)', () => {
  let now = NOW;

  beforeEach(() => {
    now = NOW;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('오래된 PENDING이고 PortOne이 PAID면 웹훅 없이 PAID로 반영한다', async () => {
    const occ = createOccFirestore();
    seedLinked(occ, 'c-paid', 'order-paid');
    const { service, getPayment, refund } = makeService(
      occ,
      jest.fn().mockResolvedValue(paymentData('PAID')),
    );

    await service.reconcilePendingCharges();

    expect(getPayment).toHaveBeenCalledTimes(1);
    expect(getPayment).toHaveBeenCalledWith('order-charge-c-paid');
    expect(refund).not.toHaveBeenCalled();
    expect(occ.getData('orderCharges/c-paid')).toMatchObject({
      status: 'PAID',
      portoneTransactionId: 'tx-1',
      payMethod: 'CARD',
      providerCheckedAtMs: NOW,
    });
    expect(occ.getData('orderCharges/c-paid')?.['unneededPaidAt']).toBeUndefined();
  });

  it.each([
    ['보류 해소', {}, RESOLVED_HOLD, '재배송이 필요 없어진 재배송비 결제 환불'],
    ['주문 취소', {}, { status: 'CANCELLED' }, '주문 취소에 따른 재배송비 환불'],
  ])(
    '%s 뒤 PortOne이 PAID면 기록한 뒤 한 번 환불한다',
    async (_label, chargeOverrides, orderOverrides, reason) => {
      const occ = createOccFirestore();
      seedLinked(occ, 'c-unneeded', 'order-unneeded', chargeOverrides, orderOverrides);
      const { service, refund } = makeService(
        occ,
        jest.fn().mockResolvedValue(paymentData('PAID')),
      );

      await service.reconcilePendingCharges();

      expect(refund).toHaveBeenCalledTimes(1);
      expect(refund).toHaveBeenCalledWith(
        'order-charge-c-unneeded',
        FEE,
        reason,
        expect.any(String),
      );
      expect(occ.getData('orderCharges/c-unneeded')).toMatchObject({
        status: 'REFUNDED',
        refundReason: reason,
        refundClaim: null,
      });
      expect(occ.getData('orderCharges/c-unneeded')?.['paidAt']).toBeTruthy();
    },
  );

  it.each([
    ['READY', () => Promise.resolve(paymentData('READY'))],
    ['FAILED', () => Promise.resolve(paymentData('FAILED'))],
    ['404 PAYMENT_NOT_FOUND', () => Promise.reject(notFound())],
  ])(
    '현재 보류에 필요한 청구는 원격 %s여도 PENDING으로 둔다(손님 재시도 유지)',
    async (_label, lookup) => {
      const occ = createOccFirestore();
      // 만든 지 이틀 된 청구여도 현재 보류에 필요하면 FAILED로 닫지 않는다.
      seedLinked(occ, 'c-needed', 'order-needed', { createdAt: new Date(NOW - 48 * HOUR) });
      const { service, getPayment, issueWriter } = makeService(occ, jest.fn(lookup));

      await expect(service.reconcilePendingCharge('c-needed')).resolves.toBe('left_pending');

      expect(getPayment).toHaveBeenCalledTimes(1);
      expect(occ.getData('orderCharges/c-needed')).toMatchObject({
        status: 'PENDING',
        failedAt: null,
        providerCheckedAtMs: NOW,
      });
      expect(issueWriter.createOrMergeIssue).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['READY', () => Promise.resolve(paymentData('READY'))],
    ['FAILED', () => Promise.resolve(paymentData('FAILED'))],
    ['404 PAYMENT_NOT_FOUND', () => Promise.reject(notFound())],
  ])(
    '필요 없어진 지 오래된 청구는 원격 %s면 기존 markFailed로 FAILED가 된다',
    async (_label, lookup) => {
      const occ = createOccFirestore();
      seedLinked(
        occ,
        'c-stale',
        'order-stale',
        { createdAt: new Date(NOW - 25 * HOUR) },
        RESOLVED_HOLD,
      );
      const { service, refund } = makeService(occ, jest.fn(lookup));

      await expect(service.reconcilePendingCharge('c-stale')).resolves.toBe('failed');

      expect(refund).not.toHaveBeenCalled();
      expect(occ.getData('orderCharges/c-stale')).toMatchObject({ status: 'FAILED' });
      expect(occ.getData('orderCharges/c-stale')?.['failedAt']).toBeTruthy();
    },
  );

  it('주문이 없거나 다른 보류로 교체된 오래된 청구도 FAILED가 된다', async () => {
    const occ = createOccFirestore();
    seedCharge(occ, 'c-orphan', 'order-missing', { createdAt: new Date(NOW - 25 * HOUR) });
    seedLinked(
      occ,
      'c-replaced',
      'order-replaced',
      { createdAt: new Date(NOW - 25 * HOUR) },
      {
        deliveryHold: {
          ...RESOLVED_HOLD.deliveryHold,
          heldAt: '2026-11-05T00:00:00.000Z',
          resolvedAt: null,
        },
      },
    );
    const { service } = makeService(occ, jest.fn().mockResolvedValue(paymentData('FAILED')));

    await service.reconcilePendingCharges();

    expect(occ.getData('orderCharges/c-orphan')).toMatchObject({ status: 'FAILED' });
    expect(occ.getData('orderCharges/c-replaced')).toMatchObject({ status: 'FAILED' });
  });

  it('필요 없어졌어도 만든 지 하루가 안 된 청구는 PENDING으로 둔다(열린 결제창 보호)', async () => {
    const occ = createOccFirestore();
    seedLinked(
      occ,
      'c-young',
      'order-young',
      { createdAt: new Date(NOW - 2 * HOUR) },
      RESOLVED_HOLD,
    );
    const { service } = makeService(occ, jest.fn().mockResolvedValue(paymentData('READY')));

    await expect(service.reconcilePendingCharge('c-young')).resolves.toBe('left_pending');
    expect(occ.getData('orderCharges/c-young')).toMatchObject({ status: 'PENDING' });
  });

  it.each(['CANCELLED', 'PARTIAL_CANCELLED', 'VIRTUAL_ACCOUNT_ISSUED', 'PAY_PENDING'])(
    '돈이 움직였거나 진행 중인 원격 %s는 필요 없는 청구여도 바꾸지 않는다',
    async (status) => {
      const occ = createOccFirestore();
      seedLinked(
        occ,
        'c-moving',
        'order-moving',
        { createdAt: new Date(NOW - 25 * HOUR) },
        RESOLVED_HOLD,
      );
      const { service, refund } = makeService(
        occ,
        jest.fn().mockResolvedValue(paymentData(status)),
      );

      await expect(service.reconcilePendingCharge('c-moving')).resolves.toBe('left_pending');
      expect(refund).not.toHaveBeenCalled();
      expect(occ.getData('orderCharges/c-moving')).toMatchObject({ status: 'PENDING' });
    },
  );

  it('15분이 안 된 PENDING과 확정된 청구·형식이 다른 청구는 조회하지 않는다', async () => {
    const occ = createOccFirestore();
    seedLinked(occ, 'c-recent', 'order-recent', { createdAt: new Date(NOW - 14 * MINUTE) });
    seedLinked(occ, 'c-done-paid', 'order-done-paid', { status: 'PAID' });
    seedLinked(occ, 'c-done-failed', 'order-done-failed', { status: 'FAILED' });
    seedLinked(occ, 'c-done-refunded', 'order-done-refunded', { status: 'REFUNDED' });
    seedLinked(occ, 'c-foreign-id', 'order-foreign-id', { portonePaymentId: 'round-direct-e2e-x' });
    seedLinked(occ, 'c-other-type', 'order-other-type', { type: 'OTHER' });
    seedLinked(occ, 'c-no-created', 'order-no-created', { createdAt: undefined });
    const { service, getPayment } = makeService(
      occ,
      jest.fn().mockResolvedValue(paymentData('PAID')),
    );

    await service.reconcilePendingCharges();

    expect(getPayment).not.toHaveBeenCalled();
    expect(occ.getData('orderCharges/c-recent')).toMatchObject({ status: 'PENDING' });
    expect(occ.getData('orderCharges/c-recent')?.['providerCheckedAtMs']).toBeUndefined();
    expect(occ.getData('orderCharges/c-done-failed')).toMatchObject({ status: 'FAILED' });
  });

  it('웹훅과 동시에 돌아도 PAID 반영은 한 번이다', async () => {
    const occ = createOccFirestore();
    seedLinked(occ, 'c-race', 'order-race');
    const { service, getPayment, refund } = makeService(
      occ,
      jest.fn().mockResolvedValue(paymentData('PAID')),
    );

    const [webhook] = await Promise.all([
      service.handleWebhook('Transaction.Paid', 'order-charge-c-race'),
      service.reconcilePendingCharges(),
    ]);

    expect(getPayment).toHaveBeenCalledTimes(2);
    expect(refund).not.toHaveBeenCalled();
    expect(webhook).toEqual(expect.objectContaining({ ok: true }));
    expect(occ.getData('orderCharges/c-race')).toMatchObject({ status: 'PAID' });
  });

  it('필요 없어진 결제를 웹훅과 동시에 확정해도 PortOne 환불은 한 번이다', async () => {
    const occ = createOccFirestore();
    seedLinked(occ, 'c-race-refund', 'order-race-refund', {}, { status: 'CANCELLED' });
    const { service, refund } = makeService(occ, jest.fn().mockResolvedValue(paymentData('PAID')));

    const settled = await Promise.allSettled([
      service.handleWebhook('Transaction.Paid', 'order-charge-c-race-refund'),
      service.reconcilePendingCharges(),
    ]);

    expect(refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('orderCharges/c-race-refund')).toMatchObject({ status: 'REFUNDED' });
    // scheduler는 오류를 던지지 않는다. 웹훅은 성공하거나 503(다른 시도가 환불 중)이다.
    expect(settled[1].status).toBe('fulfilled');
  });

  it.each([
    ['PortOne 500', () => new PortoneError(500, 'INTERNAL', '서버 오류')],
    ['PortOne 401', () => new PortoneError(401, 'UNAUTHORIZED', '인증 실패')],
    [
      '시간 초과',
      () => new PortoneError(PORTONE_TIMEOUT_ERROR_STATUS, PORTONE_TIMEOUT_ERROR_TYPE, '시간 초과'),
    ],
    ['네트워크 오류', () => new Error('socket hang up')],
  ])(
    '%s면 상태를 바꾸지 않고 청구별로 합쳐지는 조회 실패 기록을 남긴다',
    async (_label, makeError) => {
      const occ = createOccFirestore();
      seedLinked(occ, 'c-error', 'order-error');
      const { service, issueWriter, refund } = makeService(
        occ,
        jest.fn().mockRejectedValue(makeError()),
      );

      await expect(service.reconcilePendingCharges()).resolves.toBeUndefined();

      expect(refund).not.toHaveBeenCalled();
      expect(occ.getData('orderCharges/c-error')).toMatchObject({
        status: 'PENDING',
        failedAt: null,
      });
      expect(issueWriter.createOrMergeIssue).toHaveBeenCalledTimes(1);
      expect(issueWriter.createOrMergeIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PAYMENT_LOOKUP_FAILED',
          storeId: 'store-1',
          orderId: 'order-error',
          paymentId: null,
          chargeId: 'c-error',
          idempotencyKey: 'charge-payment-lookup-failed:c-error',
        }),
      );
    },
  );

  it('조회 실패가 이어져도 매분 다시 조회·기록하지 않고 간격(5분)마다만 본다', async () => {
    const occ = createOccFirestore();
    seedLinked(occ, 'c-backoff', 'order-backoff');
    const { service, getPayment, issueWriter } = makeService(
      occ,
      jest.fn().mockRejectedValue(new PortoneError(500, 'INTERNAL', '서버 오류')),
    );

    await service.reconcilePendingCharges();
    for (let minute = 1; minute < 5; minute += 1) {
      now = NOW + minute * MINUTE;
      await service.reconcilePendingCharges();
    }
    expect(getPayment).toHaveBeenCalledTimes(1);
    expect(issueWriter.createOrMergeIssue).toHaveBeenCalledTimes(1);

    now = NOW + 5 * MINUTE;
    await service.reconcilePendingCharges();
    expect(getPayment).toHaveBeenCalledTimes(2);
    expect(issueWriter.createOrMergeIssue).toHaveBeenCalledTimes(2);
  });

  it('만든 지 하루가 지난 PENDING은 한 시간에 한 번만 조회한다', async () => {
    const occ = createOccFirestore();
    seedLinked(occ, 'c-slow', 'order-slow', { createdAt: new Date(NOW - 30 * HOUR) });
    const { service, getPayment } = makeService(
      occ,
      jest.fn().mockResolvedValue(paymentData('READY')),
    );

    await service.reconcilePendingCharges();
    now = NOW + 59 * MINUTE;
    await service.reconcilePendingCharges();
    expect(getPayment).toHaveBeenCalledTimes(1);

    now = NOW + 60 * MINUTE;
    await service.reconcilePendingCharges();
    expect(getPayment).toHaveBeenCalledTimes(2);
    expect(occ.getData('orderCharges/c-slow')).toMatchObject({ status: 'PENDING' });
  });

  it('이전 실행이 끝나기 전의 다음 실행은 건너뛴다', async () => {
    const occ = createOccFirestore();
    seedLinked(occ, 'c-inflight', 'order-inflight');
    let release!: (value: unknown) => void;
    const getPayment = jest.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { service } = makeService(occ, getPayment);

    const first = service.reconcilePendingCharges();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await service.reconcilePendingCharges();
    expect(getPayment).toHaveBeenCalledTimes(1);

    release(paymentData('PAID'));
    await first;
    expect(occ.getData('orderCharges/c-inflight')).toMatchObject({ status: 'PAID' });
  });

  it('겹친 실행·다른 서버가 같은 청구를 간격 안에 다시 조회하지 않는다', async () => {
    const occ = createOccFirestore();
    seedLinked(occ, 'c-two-servers', 'order-two-servers');
    const getPayment = jest.fn().mockResolvedValue(paymentData('READY'));
    const serverA = makeService(occ, getPayment).service;
    const serverB = makeService(occ, getPayment).service;

    const results = await Promise.all([
      serverA.reconcilePendingCharge('c-two-servers'),
      serverB.reconcilePendingCharge('c-two-servers'),
    ]);

    expect(results.sort()).toEqual(['left_pending', 'skipped']);
    expect(getPayment).toHaveBeenCalledTimes(1);
  });

  it('한 번에 50건까지만, 조회한 적 없는 청구부터, 동시 4건 이하로 조회한다', async () => {
    const occ = createOccFirestore();
    for (let index = 0; index < 60; index += 1) {
      const id = `c-batch-${String(index).padStart(2, '0')}`;
      seedLinked(occ, id, `order-batch-${index}`, {
        // 앞의 10건은 10분 전에 조회한 적이 있다.
        ...(index < 10 ? { providerCheckedAtMs: NOW - 10 * MINUTE } : {}),
      });
    }
    let active = 0;
    let maxActive = 0;
    const getPayment = jest.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return paymentData('READY');
    });
    const { service } = makeService(occ, getPayment);

    await service.reconcilePendingCharges();

    expect(getPayment).toHaveBeenCalledTimes(50);
    expect(maxActive).toBeLessThanOrEqual(4);
    const queried = new Set(getPayment.mock.calls.map((call) => (call as unknown[])[0]));
    for (let index = 10; index < 60; index += 1) {
      expect(queried.has(`order-charge-c-batch-${String(index).padStart(2, '0')}`)).toBe(true);
    }
  });

  it('PAID인데 금액이 다르면 확정하지 않고 PENDING으로 둔다', async () => {
    const occ = createOccFirestore();
    seedLinked(occ, 'c-amount', 'order-amount');
    const { service, refund } = makeService(
      occ,
      jest.fn().mockResolvedValue(paymentData('PAID', 1)),
    );

    await expect(service.reconcilePendingCharge('c-amount')).resolves.toBe('finalize_failed');
    expect(refund).not.toHaveBeenCalled();
    expect(occ.getData('orderCharges/c-amount')).toMatchObject({ status: 'PENDING' });
  });

  it('조회 사이에 웹훅이 먼저 확정하면 다시 반영하지 않는다', async () => {
    const occ = createOccFirestore();
    seedLinked(occ, 'c-late', 'order-late');
    const getPayment = jest.fn(async () => {
      // PortOne 조회 중 웹훅이 먼저 PAID로 반영했다.
      occ.updateOutsideTransaction('orderCharges/c-late', {
        status: 'PAID',
        paidAt: new Date(NOW),
      });
      return paymentData('PAID');
    });
    const { service, refund } = makeService(occ, getPayment);

    await expect(service.reconcilePendingCharge('c-late')).resolves.toBe('finalized');
    expect(refund).not.toHaveBeenCalled();
    expect(occ.getData('orderCharges/c-late')).toMatchObject({ status: 'PAID' });
    expect(occ.getData('orderCharges/c-late')?.['portoneTransactionId']).toBeUndefined();
  });
});

describe('E2E 가짜 PortOne의 재배송비 결제 ID', () => {
  const runId = 'run-20261107-charge';
  const makeClient = (fixtures: Record<string, unknown>) =>
    new E2EPortoneClient(
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
        ROUND_DIRECT_E2E_PORTONE_FIXTURES_JSON: JSON.stringify(fixtures),
      }),
    );

  it('이번 실행 범위의 chargeId면 fixture대로 답하고 환불도 받는다', async () => {
    const paymentId = `order-charge-round-direct-e2e-${runId}-held-charge`;
    const client = makeClient({ [paymentId]: { amount: FEE, status: 'PAID' } });

    await expect(client.getPayment(paymentId)).resolves.toMatchObject({
      id: paymentId,
      status: 'PAID',
      amount: { total: FEE },
    });
    await client.refund(paymentId, FEE, '환불');
    await expect(client.getPayment(paymentId)).resolves.toMatchObject({ status: 'CANCELLED' });
  });

  it('fixture가 없으면 결제 없음(404 PAYMENT_NOT_FOUND)으로 답한다', async () => {
    const client = makeClient({});
    await expect(
      client.getPayment(`order-charge-round-direct-e2e-${runId}-no-fixture`),
    ).rejects.toMatchObject({ status: 404, type: 'PAYMENT_NOT_FOUND' });
  });

  it('실행 범위 밖 재배송비 결제에는 닿지 않는다', async () => {
    const outside = 'order-charge-0123456789abcdef0123456789abcdef';
    const client = makeClient({ [outside]: { amount: FEE, status: 'PAID' } });
    await expect(client.getPayment(outside)).rejects.toMatchObject({
      status: 404,
      type: 'E2E_PAYMENT_OUT_OF_SCOPE',
    });
  });
});
