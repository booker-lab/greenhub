// PILOT-PAYMENT-FINALIZATION-REFUND-OWNERSHIP-27C focused proofs.
//
// F1: uncommitted transaction attempts must not authorize finalization side
//     effects (retry purity via committed return object).
// F2: provider refund requires persisted ownership (order-level claim marker).
// F3: duplicate PAID webhooks must not blindly refund twice.
// F4: UNKNOWN results must reconcile provider state before retry.
// F5: crash-after-success must not reissue cancel without readback.
//
// Real provider is never used; PortOne is fully mocked.

import { LatePaymentCapacityError } from '../orders/order-capacity.service';
import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { PaymentFinalizationService } from './payment-finalization.service';

type Occ = ReturnType<typeof createOccFirestore>;

function makeOrder(overrides: Record<string, unknown> = {}) {
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

function paidPayment(total = 100000) {
  return {
    amount: { total },
    status: 'PAID',
    method: { type: 'CARD' },
    transactionId: 'tx-1',
  } as never;
}

function makeFixture(occ: Occ, orderOverrides: Record<string, unknown> = {}) {
  occ.seed('orders/order-1', makeOrder(orderOverrides));
  const portone = {
    refund: jest.fn().mockResolvedValue(undefined),
    getPayment: jest.fn(),
  };
  const service = new PaymentFinalizationService(
    occ.firestore as never,
    portone as never,
    { sendToUser: jest.fn().mockResolvedValue(undefined) } as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    {
      consumeReservationInTransaction: jest.fn().mockResolvedValue({ status: 'CONSUMED' }),
      releaseReservationInTransaction: jest.fn().mockResolvedValue({ status: 'RELEASED' }),
      reacquireAndConsumeLatePaymentInTransaction: jest
        .fn()
        .mockResolvedValue({ id: 'late-reservation-1', status: 'CONSUMED' }),
    } as never,
    { createOrMergeIssue: jest.fn().mockResolvedValue({ id: 'issue-1' }) } as never,
    { saveRecord: jest.fn().mockResolvedValue({}) } as never,
    { refundByOrderId: jest.fn().mockResolvedValue(undefined) } as never,
  );
  return { service, portone, occ };
}

function issueWriterOf(fixture: ReturnType<typeof makeFixture>) {
  return (fixture.service as unknown as { issueWriter: { createOrMergeIssue: jest.Mock } })
    .issueWriter;
}

describe('PILOT-PAYMENT-FINALIZATION-REFUND-OWNERSHIP-27C', () => {
  it('P1a. aborted attempt refund decision must not leak: provider 0, already_processed', async () => {
    const occ = createOccFirestore();
    occ.seed('payments/order-1', {
      id: 'order-1',
      orderId: 'order-1',
      storeId: 'store-1',
      userId: 'user-1',
      status: 'PAID',
      amount: 100000,
      portonePaymentId: 'order-1',
    });
    const fixture = makeFixture(occ, { status: 'CANCELLED', cancelReason: '소비자 취소' });
    const refunds = { refundByOrderId: jest.fn().mockResolvedValue(undefined) };
    (fixture.service as unknown as { refunds: unknown }).refunds = refunds;

    occ.setBeforeCommit(() => {
      occ.updateOutsideTransaction('payments/order-1', {
        status: 'CANCELLED',
        refundedAt: new Date('2026-09-01T00:00:00.000Z'),
      });
    });

    await expect(fixture.service.finalizePaidOrder('order-1', paidPayment())).resolves.toEqual({
      ok: true,
      reason: 'already_processed',
    });
    occ.clearHooks();

    expect(refunds.refundByOrderId).not.toHaveBeenCalled();
    expect(fixture.portone.refund).not.toHaveBeenCalled();
  });

  it('P1b. aborted attempt staged PAID write is discarded: provider 0, seeded terminal doc intact', async () => {
    const occ = createOccFirestore();
    const fixture = makeFixture(occ, { status: 'CANCELLED', cancelReason: '소비자 취소' });

    occ.setBeforeCommit(() => {
      occ.updateOutsideTransaction('orders/order-1', { probe: 1 });
      occ.seed('payments/order-1', {
        id: 'order-1',
        orderId: 'order-1',
        storeId: 'store-1',
        userId: 'user-1',
        status: 'CANCELLED',
        refundedAt: new Date('2026-09-01T00:00:00.000Z'),
        refundClaim: null,
      });
    });

    await expect(fixture.service.finalizePaidOrder('order-1', paidPayment())).resolves.toEqual({
      ok: true,
      reason: 'already_processed',
    });
    occ.clearHooks();

    expect(fixture.portone.refund).not.toHaveBeenCalled();
    expect(occ.getData('payments/order-1')).toMatchObject({ status: 'CANCELLED' });
    expect(occ.getData('payments/order-1')).not.toMatchObject({ status: 'PAID' });
  });

  it('P2. duplicate amount-mismatch webhook refunds at most once with ownership marker', async () => {
    const occ = createOccFirestore();
    const fixture = makeFixture(occ);

    await expect(
      fixture.service.finalizePaidOrder('order-1', paidPayment(99999)),
    ).resolves.toEqual({ ok: false, reason: 'amount_mismatch' });
    await expect(
      fixture.service.finalizePaidOrder('order-1', paidPayment(99999)),
    ).resolves.toEqual({ ok: false, reason: 'amount_mismatch' });

    expect(fixture.portone.refund).toHaveBeenCalledTimes(1);
    expect(fixture.portone.refund).toHaveBeenCalledWith('order-1', 99999, '금액 위변조 감지');
    expect(fixture.portone.getPayment).not.toHaveBeenCalled();
    expect(occ.getData('orders/order-1')).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'amount_mismatch',
    });
    expect(occ.getData('orders/order-1')?.['finalizationRefund']).toMatchObject({
      owner: 'payment-finalization',
      reason: 'amount_mismatch',
      status: 'REFUNDED',
    });
    expect(typeof occ.getData('orders/order-1')?.['finalizationRefund']?.['token']).toBe('string');
    expect(typeof occ.getData('orders/order-1')?.['finalizationRefund']?.['expiresAt']).toBe(
      'number',
    );
    expect(occ.getData('payments/order-1')).toBeUndefined();
  });

  it('P3. duplicate round late-payment PAID never blindly refunds twice', async () => {
    const occ = createOccFirestore();
    const fixture = makeFixture(occ, { status: 'CANCELLED', cancelReason: 'timeout' });
    const capacity = (
      fixture.service as unknown as {
        capacity: { reacquireAndConsumeLatePaymentInTransaction: jest.Mock };
      }
    ).capacity;
    capacity.reacquireAndConsumeLatePaymentInTransaction.mockRejectedValue(
      new LatePaymentCapacityError('결제 만료 후 회차 한도 마감'),
    );

    await expect(fixture.service.finalizePaidOrder('order-1', paidPayment())).resolves.toEqual({
      ok: false,
      reason: 'late_payment_refunded',
    });
    await expect(fixture.service.finalizePaidOrder('order-1', paidPayment())).resolves.toEqual({
      ok: true,
      reason: 'already_processed',
    });

    expect(fixture.portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('orders/order-1')?.['latePaymentRefundedAt']).toBeDefined();
    expect(occ.getData('payments/order-1')).toMatchObject({
      status: 'CANCELLED',
      refundAmount: 100000,
    });
  });

  it('P4. duplicate legacy late-payment PAID never blindly refunds twice', async () => {
    const occ = createOccFirestore();
    occ.seed('dailyCaps/store-1_2026-08-25', {
      storeId: 'store-1',
      date: '2026-08-25',
      totalCap: 10,
      usedSlots: 10,
    });
    const fixture = makeFixture(occ, {
      schemaVersion: 1,
      deliveryMethod: 'direct',
      quantity: 2,
      requestedDeliveryDate: '2026-08-25',
      status: 'CANCELLED',
      cancelReason: 'timeout',
      legacyDailyCapacity: { status: 'RELEASED', date: '2026-08-25', quantity: 2 },
    });

    await expect(fixture.service.finalizePaidOrder('order-1', paidPayment())).resolves.toEqual({
      ok: false,
      reason: 'late_payment_refunded',
    });
    await expect(fixture.service.finalizePaidOrder('order-1', paidPayment())).resolves.toEqual({
      ok: true,
      reason: 'already_processed',
    });

    expect(fixture.portone.refund).toHaveBeenCalledTimes(1);
    expect(fixture.portone.refund).toHaveBeenCalledWith(
      'order-1',
      100000,
      '결제 만료 후 일일 배송 용량 재확보 실패',
    );
    expect(occ.getData('dailyCaps/store-1_2026-08-25')?.['usedSlots']).toBe(10);
  });

  it('P5. UNKNOWN cancel reconciles via readback: terminal proof issues no second POST', async () => {
    const occ = createOccFirestore();
    const fixture = makeFixture(occ);
    fixture.portone.refund.mockRejectedValueOnce(new Error('provider timeout'));
    fixture.portone.getPayment.mockResolvedValue({
      id: 'order-1',
      transactionId: 'tx-1',
      amount: { total: 99999 },
      status: 'CANCELLED',
      method: { type: 'CARD' },
    });

    await expect(
      fixture.service.finalizePaidOrder('order-1', paidPayment(99999)),
    ).rejects.toThrow('provider timeout');
    expect(fixture.portone.refund).toHaveBeenCalledTimes(1);
    expect(issueWriterOf(fixture).createOrMergeIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'FINALIZATION_REFUND_FAILED',
        idempotencyKey: 'finalization-refund-uncertain:order-1:amount_mismatch',
        latestSnapshot: expect.objectContaining({ failureStage: 'provider_refund' }),
      }),
    );
    expect(occ.getData('orders/order-1')?.['finalizationRefund']).toMatchObject({
      status: 'UNKNOWN',
    });

    await expect(
      fixture.service.finalizePaidOrder('order-1', paidPayment(99999)),
    ).resolves.toEqual({ ok: false, reason: 'amount_mismatch' });

    expect(fixture.portone.getPayment).toHaveBeenCalledWith('order-1');
    expect(fixture.portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('orders/order-1')).toMatchObject({
      status: 'CANCELLED',
      finalizationRefund: expect.objectContaining({ status: 'REFUNDED' }),
    });
  });

  it('P6a. readback failure fails closed: no cancel POST, recovery issue recorded', async () => {
    const occ = createOccFirestore();
    const fixture = makeFixture(occ, {
      finalizationRefund: {
        token: 'prior-token',
        owner: 'payment-finalization',
        reason: 'amount_mismatch',
        status: 'UNKNOWN',
        claimedAt: new Date('2026-09-01T00:00:00.000Z'),
        expiresAt: Date.now() + 300000,
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    });
    fixture.portone.getPayment.mockRejectedValue(new Error('readback down'));

    await expect(
      fixture.service.finalizePaidOrder('order-1', paidPayment(99999)),
    ).rejects.toThrow('readback down');

    expect(fixture.portone.refund).not.toHaveBeenCalled();
    expect(issueWriterOf(fixture).createOrMergeIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'FINALIZATION_REFUND_FAILED',
        latestSnapshot: expect.objectContaining({ failureStage: 'provider_readback' }),
      }),
    );
    expect(occ.getData('orders/order-1')?.['finalizationRefund']).toMatchObject({
      status: 'UNKNOWN',
    });
  });

  it('P6b. ambiguous provider status fails closed: no cancel POST, recovery issue recorded', async () => {
    const occ = createOccFirestore();
    const fixture = makeFixture(occ, {
      finalizationRefund: {
        token: 'prior-token',
        owner: 'payment-finalization',
        reason: 'amount_mismatch',
        status: 'UNKNOWN',
        claimedAt: new Date('2026-09-01T00:00:00.000Z'),
        expiresAt: Date.now() + 300000,
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    });
    fixture.portone.getPayment.mockResolvedValue({
      id: 'order-1',
      transactionId: 'tx-1',
      amount: { total: 99999 },
      status: 'PENDING',
      method: { type: 'CARD' },
    });

    await expect(
      fixture.service.finalizePaidOrder('order-1', paidPayment(99999)),
    ).rejects.toThrow('PortOne 결제 상태를 확정할 수 없어 환불을 중단합니다.');

    expect(fixture.portone.refund).not.toHaveBeenCalled();
    expect(issueWriterOf(fixture).createOrMergeIssue).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'FINALIZATION_REFUND_FAILED' }),
    );
  });

  it('P7. normal finalize happy path is preserved with zero provider calls', async () => {
    const occ = createOccFirestore();
    const fixture = makeFixture(occ);
    const notifications = (
      fixture.service as unknown as { notifications: { sendToUser: jest.Mock } }
    ).notifications;

    await expect(fixture.service.finalizePaidOrder('order-1', paidPayment())).resolves.toEqual({
      ok: true,
      status: 'ACCEPTED',
    });

    expect(occ.getData('orders/order-1')).toMatchObject({ status: 'ACCEPTED' });
    expect(occ.getData('payments/order-1')).toMatchObject({ status: 'PAID' });
    expect(fixture.portone.refund).not.toHaveBeenCalled();
    expect(fixture.portone.getPayment).not.toHaveBeenCalled();
    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
  });
});
