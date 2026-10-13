// 매일 새벽 최근 PAID 결제를 PortOne에서 다시 읽는 대사.
// - 결제사 상태가 PAID가 아니면 결제사 되돌림 운영 기록만 남기고 주문·결제·청구·정산은 바꾸지 않는다.
// - 우리 쪽 환불·취소가 소유한 건, 이미 기록이 있는 건(처리된 기록 포함)은 다시 남기지 않는다.
// - PortOne 조회는 한 건씩 순서대로 보내고, job lease로 하루 한 번만 돈다.

import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { OperationIssueWriterService } from '../operations/operation-issue-writer.service';
import { PaymentProviderReconcileService } from './payment-provider-reconcile.service';
import { PortoneError } from './portone.client';

type Occ = ReturnType<typeof createOccFirestore>;

const NOW = new Date('2026-10-13T18:30:00.000Z'); // 2026-10-14 03:30 KST
const HOUR = 60 * 60 * 1000;
const RECENT = new Date(NOW.getTime() - 20 * HOUR);
const STALE = new Date(NOW.getTime() - 4 * 24 * HOUR);

function seedOrderPayment(
  occ: Occ,
  orderId: string,
  options: {
    orderStatus?: string;
    payment?: Record<string, unknown>;
    order?: Record<string, unknown>;
  } = {},
) {
  occ.seed(`orders/${orderId}`, {
    id: orderId,
    storeId: 'store-1',
    status: options.orderStatus ?? 'ACCEPTED',
    ...options.order,
  });
  occ.seed(`payments/${orderId}`, {
    id: orderId,
    orderId,
    storeId: 'store-1',
    status: 'PAID',
    amount: 10000,
    portonePaymentId: orderId,
    refundClaim: null,
    refundedAt: null,
    createdAt: RECENT,
    ...options.payment,
  });
}

function seedCharge(occ: Occ, chargeId: string, overrides: Record<string, unknown> = {}) {
  occ.seed(`orderCharges/${chargeId}`, {
    id: chargeId,
    orderId: 'order-c',
    storeId: 'store-2',
    type: 'REDELIVERY_FEE',
    status: 'PAID',
    amount: 5000,
    portonePaymentId: `order-charge-${chargeId}`,
    paidAt: RECENT,
    refundedAt: null,
    ...overrides,
  });
}

function makeService(occ: Occ, statuses: Record<string, string | Error>) {
  let inFlight = 0;
  let maxInFlight = 0;
  const portone = {
    getPayment: jest.fn(async (paymentId: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => setImmediate(resolve));
      inFlight -= 1;
      const status = statuses[paymentId] ?? 'PAID';
      if (status instanceof Error) throw status;
      return { id: paymentId, status, amount: { total: 10000 } };
    }),
    refund: jest.fn(),
  };
  const issueWriter = new OperationIssueWriterService(occ.firestore as never);
  const createOrMergeIssue = jest.spyOn(issueWriter, 'createOrMergeIssue');
  const service = new PaymentProviderReconcileService(
    occ.firestore as never,
    portone as never,
    issueWriter,
  );
  return { service, portone, createOrMergeIssue, maxInFlight: () => maxInFlight };
}

function snapshotDomain(occ: Occ) {
  return {
    orders: occ.listData('orders/'),
    payments: occ.listData('payments/'),
    orderCharges: occ.listData('orderCharges/'),
    settlements: occ.listData('settlements/'),
  };
}

describe('결제사 상태 일일 대사', () => {
  it('결제사에서 취소·부분 취소된 주문과 재배송비만 기록하고 다른 문서는 바꾸지 않는다', async () => {
    const occ = createOccFirestore();
    seedOrderPayment(occ, 'order-cancelled');
    seedOrderPayment(occ, 'order-partial', { orderStatus: 'DELIVERED' });
    seedOrderPayment(occ, 'order-paid');
    occ.seed('settlements/order-cancelled', { id: 'order-cancelled', status: 'pending' });
    seedCharge(occ, 'charge-cancelled');
    seedCharge(occ, 'charge-paid');
    const fixture = makeService(occ, {
      'order-cancelled': 'CANCELLED',
      'order-partial': 'PARTIAL_CANCELLED',
      'order-charge-charge-cancelled': 'CANCELLED',
    });
    const before = snapshotDomain(occ);

    const summary = await fixture.service.reconcileRecentPayments({ now: NOW, callIntervalMs: 0 });

    expect(summary).toEqual({ checked: 5, recorded: 3, lookupFailed: 0, failed: 0 });
    expect(snapshotDomain(occ)).toEqual(before);
    expect(fixture.createOrMergeIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 'store-1',
        orderId: 'order-cancelled',
        paymentId: 'order-cancelled',
        type: 'PROVIDER_REVERSAL_DETECTED',
        severity: 'critical',
        idempotencyKey: 'provider-reversal-reconcile:order:order-cancelled',
        latestSnapshot: {
          orderStatus: 'ACCEPTED',
          paymentStatus: 'PAID',
          providerStatus: 'CANCELLED',
          providerEvent: 'DAILY_RECONCILE',
          settlementStatus: 'pending',
          failureStage: 'provider_reconcile',
        },
      }),
    );
    expect(fixture.createOrMergeIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-partial',
        latestSnapshot: expect.objectContaining({ providerStatus: 'PARTIAL_CANCELLED' }),
      }),
    );
    expect(fixture.createOrMergeIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 'store-2',
        orderId: 'order-c',
        paymentId: null,
        chargeId: 'charge-cancelled',
        type: 'PROVIDER_REVERSAL_DETECTED',
        idempotencyKey: 'provider-reversal-reconcile:charge:charge-cancelled',
      }),
    );
    expect(occ.listData('operationIssues/')).toHaveLength(3);
    expect(fixture.portone.refund).not.toHaveBeenCalled();
  });

  it('PortOne 조회는 한 번에 한 건씩만 보낸다', async () => {
    const occ = createOccFirestore();
    for (const id of ['order-a', 'order-b', 'order-c', 'order-d']) seedOrderPayment(occ, id);
    seedCharge(occ, 'charge-a');
    const fixture = makeService(occ, {});

    await fixture.service.reconcileRecentPayments({ now: NOW, callIntervalMs: 1 });

    expect(fixture.portone.getPayment).toHaveBeenCalledTimes(5);
    expect(fixture.maxInFlight()).toBe(1);
  });

  it('기간 밖·PAID가 아닌 결제와 우리 쪽 환불·취소가 소유한 건은 조회하지 않는다', async () => {
    const occ = createOccFirestore();
    seedOrderPayment(occ, 'order-old', { payment: { createdAt: STALE } });
    seedOrderPayment(occ, 'order-refunded', {
      payment: { status: 'CANCELLED', refundedAt: RECENT },
    });
    seedOrderPayment(occ, 'order-claimed', {
      payment: { refundClaim: { owner: 'payment-refund', status: 'CLAIMED' } },
    });
    seedOrderPayment(occ, 'order-finalization-refund', {
      order: { finalizationRefund: { status: 'CLAIMED' } },
    });
    seedOrderPayment(occ, 'order-local-cancel', { orderStatus: 'CANCELLED' });
    seedOrderPayment(occ, 'order-pending', { orderStatus: 'PENDING' });
    seedCharge(occ, 'charge-old', { paidAt: STALE });
    seedCharge(occ, 'charge-refunded', { status: 'REFUNDED', refundedAt: RECENT });
    seedCharge(occ, 'charge-claimed', { refundClaim: { owner: 'order-charge-refund' } });
    seedCharge(occ, 'charge-unpaid', { status: 'PENDING', paidAt: null });
    const fixture = makeService(occ, {});

    const summary = await fixture.service.reconcileRecentPayments({ now: NOW, callIntervalMs: 0 });

    expect(summary).toEqual({ checked: 0, recorded: 0, lookupFailed: 0, failed: 0 });
    expect(fixture.portone.getPayment).not.toHaveBeenCalled();
    expect(fixture.createOrMergeIssue).not.toHaveBeenCalled();
  });

  it('이미 결제사 되돌림 기록이 있으면(처리된 기록 포함) 다시 열지 않는다', async () => {
    const occ = createOccFirestore();
    seedOrderPayment(occ, 'order-1');
    seedCharge(occ, 'charge-1', { orderId: 'order-1' });
    occ.seed('operationIssues/existing-order', {
      id: 'existing-order',
      orderId: 'order-1',
      type: 'PROVIDER_REVERSAL_DETECTED',
      status: 'RESOLVED',
    });
    occ.seed('operationIssues/existing-charge', {
      id: 'existing-charge',
      orderId: 'order-1',
      chargeId: 'charge-1',
      type: 'PROVIDER_REVERSAL_DETECTED',
      status: 'DISMISSED',
    });
    const fixture = makeService(occ, {
      'order-1': 'CANCELLED',
      'order-charge-charge-1': 'CANCELLED',
    });

    await fixture.service.reconcileRecentPayments({ now: NOW, callIntervalMs: 0 });

    expect(fixture.portone.getPayment).not.toHaveBeenCalled();
    expect(fixture.createOrMergeIssue).not.toHaveBeenCalled();
    expect(occ.getData('operationIssues/existing-order')?.['status']).toBe('RESOLVED');
  });

  it('재배송비 기록만 있는 주문은 주문 결제 자체를 계속 확인한다', async () => {
    const occ = createOccFirestore();
    seedOrderPayment(occ, 'order-1');
    occ.seed('operationIssues/charge-only', {
      id: 'charge-only',
      orderId: 'order-1',
      chargeId: 'charge-9',
      type: 'PROVIDER_REVERSAL_DETECTED',
      status: 'OPEN',
    });
    const fixture = makeService(occ, { 'order-1': 'CANCELLED' });

    await fixture.service.reconcileRecentPayments({ now: NOW, callIntervalMs: 0 });

    expect(fixture.createOrMergeIssue).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', paymentId: 'order-1' }),
    );
  });

  it('조회 실패는 기록하지 않고 나머지를 계속 확인한다', async () => {
    const occ = createOccFirestore();
    seedOrderPayment(occ, 'order-a');
    seedOrderPayment(occ, 'order-b', { payment: { createdAt: new Date(RECENT.getTime() + 1) } });
    const fixture = makeService(occ, {
      'order-a': new PortoneError(503, 'TEMPORARY_ERROR', '일시 오류'),
      'order-b': 'CANCELLED',
    });

    const summary = await fixture.service.reconcileRecentPayments({ now: NOW, callIntervalMs: 0 });

    expect(summary).toEqual({ checked: 2, recorded: 1, lookupFailed: 1, failed: 0 });
    expect(fixture.createOrMergeIssue).toHaveBeenCalledTimes(1);
    expect(fixture.createOrMergeIssue).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-b' }),
    );
  });

  it('한 건의 기록 실패는 나머지를 막지 않는다', async () => {
    const occ = createOccFirestore();
    seedOrderPayment(occ, 'order-a');
    seedOrderPayment(occ, 'order-b', { payment: { createdAt: new Date(RECENT.getTime() + 1) } });
    const fixture = makeService(occ, { 'order-a': 'CANCELLED', 'order-b': 'CANCELLED' });
    fixture.createOrMergeIssue.mockRejectedValueOnce(new Error('저장 실패'));

    const summary = await fixture.service.reconcileRecentPayments({ now: NOW, callIntervalMs: 0 });

    expect(summary).toEqual({ checked: 1, recorded: 1, lookupFailed: 0, failed: 1 });
    expect(occ.listData('operationIssues/')).toHaveLength(1);
  });
});

describe('결제사 상태 일일 대사 실행 lease', () => {
  it('같은 서울 날짜에는 한 번만 돌고 lease 문서에 완료 회차를 남긴다', async () => {
    const occ = createOccFirestore();
    seedOrderPayment(occ, 'order-1');
    const fixture = makeService(occ, { 'order-1': 'CANCELLED' });

    const first = await fixture.service.runDailyReconcile({ now: NOW, callIntervalMs: 0 });
    const second = await fixture.service.runDailyReconcile({ now: NOW, callIntervalMs: 0 });

    expect(first).toMatchObject({ recorded: 1 });
    expect(second).toBeNull();
    expect(fixture.portone.getPayment).toHaveBeenCalledTimes(1);
    expect(occ.getData('jobLeases/payment-provider-reconcile')).toMatchObject({
      lastCompletedSlot: '2026-10-14',
      holderId: null,
    });
  });

  it('다른 실행이 lease를 잡고 있으면 건너뛴다', async () => {
    const occ = createOccFirestore();
    seedOrderPayment(occ, 'order-1');
    occ.seed('jobLeases/payment-provider-reconcile', {
      holderId: 'other-instance',
      expiresAt: Date.now() + 60_000,
    });
    const fixture = makeService(occ, { 'order-1': 'CANCELLED' });

    await expect(
      fixture.service.runDailyReconcile({ now: NOW, callIntervalMs: 0 }),
    ).resolves.toBeNull();
    expect(fixture.portone.getPayment).not.toHaveBeenCalled();
  });

  it('대상 조회가 실패하면 회차를 완료로 남기지 않고 lease만 푼다', async () => {
    const occ = createOccFirestore();
    const fixture = makeService(occ, {});
    const collection = occ.firestore.collection;
    jest.spyOn(occ.firestore, 'collection').mockImplementation((path: string) => {
      if (path === 'payments') throw new Error('query failed');
      return collection(path);
    });

    await expect(
      fixture.service.runDailyReconcile({ now: NOW, callIntervalMs: 0 }),
    ).resolves.toBeNull();
    const lease = occ.getData('jobLeases/payment-provider-reconcile');
    expect(lease).toMatchObject({ holderId: null, expiresAt: null });
    expect(lease?.['lastCompletedSlot']).toBeUndefined();
  });
});
