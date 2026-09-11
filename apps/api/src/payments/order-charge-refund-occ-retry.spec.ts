// OrderCharge refund retry-purity regression proofs on the canonical OCC harness.
// Task: PAYMENT-REFUND-OCC-RETRY-PURITY-CLOSURE-01
//
// Same invariant as PaymentRefundService but for
// OrderChargePaymentService.refundCharge via the public refundByOrderId path:
//   1. normal claim -> provider exactly once
//   2. first-attempt conflict -> retry loser provider 0
//   3. concurrent claimers -> provider <= 1
//   4. exhaustion -> side effect 0
//   5. provider failure -> own claim release only
//   6. successful refund -> REFUNDED convergence
//   7. already REFUNDED/refundedAt -> side effect 0
//
// markFailed/finalizePaid semantics are intentionally untouched here.

import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { OrderChargePaymentService } from './order-charge-payment.service';

function makeService(occ: ReturnType<typeof createOccFirestore>, portoneRefund: jest.Mock) {
  const portone = { getPayment: jest.fn(), refund: portoneRefund } as never;
  return new OrderChargePaymentService(occ.firestore as never, portone);
}

function seedPaidCharge(
  occ: ReturnType<typeof createOccFirestore>,
  chargeId: string,
  orderId: string,
) {
  occ.seed(`orderCharges/${chargeId}`, {
    id: chargeId,
    orderId,
    status: 'PAID',
    type: 'REDELIVERY_FEE',
    amount: 3000,
    portonePaymentId: `order-charge-${chargeId}`,
  });
}

describe('OrderCharge refund OCC retry purity', () => {
  it('1. normal claim refunds exactly once and converges to REFUNDED', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-normal-1', 'order-oc-normal-1');
    const refund = jest.fn().mockResolvedValue(undefined);
    const service = makeService(occ, refund);

    const commits: Array<{ writeCount: number }> = [];
    const arm = (): void => {
      occ.setBeforeCommit((ctx) => {
        commits.push({ writeCount: ctx.writes.length });
        arm();
      });
    };
    arm();

    await service.refundByOrderId('order-oc-normal-1', '주문 취소');
    occ.clearHooks();

    expect(refund).toHaveBeenCalledTimes(1);
    expect(refund).toHaveBeenCalledWith('order-charge-c-normal-1', 3000, '주문 취소');
    // Claim + completeRefund, each one committed attempt.
    expect(commits).toHaveLength(2);
    expect(occ.getData('orderCharges/c-normal-1')).toMatchObject({
      status: 'REFUNDED',
      refundClaim: null,
    });
    expect(occ.getData('orderCharges/c-normal-1')?.['refundedAt']).toBeDefined();
  });

  it('2. first-attempt conflict retries to loser: provider 0, foreign claim preserved', async () => {
    const occ = createOccFirestore();
    const chargePath = 'orderCharges/c-conflict-1';
    seedPaidCharge(occ, 'c-conflict-1', 'order-oc-conflict-1');
    const refund = jest.fn().mockResolvedValue(undefined);
    const service = makeService(occ, refund);

    const commits: Array<{ writeCount: number }> = [];
    const arm = (): void => {
      occ.setBeforeCommit((ctx) => {
        commits.push({ writeCount: ctx.writes.length });
        if (commits.length === 1) {
          occ.updateOutsideTransaction(chargePath, {
            refundClaim: { token: 'foreign-token', expiresAt: Date.now() + 300000 },
          });
        }
        arm();
      });
    };
    arm();

    await service.refundByOrderId('order-oc-conflict-1', '주문 취소');
    occ.clearHooks();

    expect(commits).toHaveLength(2);
    expect(commits[0].writeCount).toBe(1);
    expect(commits[1].writeCount).toBe(0);
    expect(refund).not.toHaveBeenCalled();
    expect(occ.getData(chargePath)).toMatchObject({
      status: 'PAID',
      refundClaim: { token: 'foreign-token' },
    });
  });

  it('3. concurrent claimers converge with provider <= 1', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-race-1', 'order-oc-race-1');
    const refund = jest.fn().mockResolvedValue(undefined);
    const service = makeService(occ, refund);

    const commits: unknown[] = [];
    const arm = (): void => {
      occ.setBeforeCommit((ctx) => {
        commits.push(ctx);
        arm();
      });
    };
    arm();

    await Promise.all([
      service.refundByOrderId('order-oc-race-1', '주문 취소'),
      service.refundByOrderId('order-oc-race-1', '주문 취소'),
    ]);
    occ.clearHooks();

    expect(refund).toHaveBeenCalledTimes(1);
    expect(commits.length).toBeGreaterThanOrEqual(3);
    expect(occ.getData('orderCharges/c-race-1')).toMatchObject({
      status: 'REFUNDED',
      refundClaim: null,
    });
  });

  it('4. retry exhaustion fails bounded with provider 0 and no staged claim', async () => {
    const occ = createOccFirestore({ maxAttempts: 2 });
    const chargePath = 'orderCharges/c-hot-1';
    seedPaidCharge(occ, 'c-hot-1', 'order-oc-hot-1');
    const refund = jest.fn().mockResolvedValue(undefined);
    const service = makeService(occ, refund);

    let bumps = 0;
    const rearm = (): void => {
      occ.setBeforeCommit(() => {
        bumps += 1;
        occ.updateOutsideTransaction(chargePath, { probe: bumps });
        rearm();
      });
    };
    rearm();

    await expect(service.refundByOrderId('order-oc-hot-1', '주문 취소')).rejects.toThrow(
      'transaction retry limit exceeded',
    );
    occ.clearHooks();

    expect(refund).not.toHaveBeenCalled();
    expect(bumps).toBe(2);
    expect(occ.getData(chargePath)).toMatchObject({ status: 'PAID', probe: 2 });
    expect(
      (occ.getData(chargePath) as Record<string, unknown>)['refundClaim'],
    ).toBeUndefined();
  });

  it('5a. provider failure releases own claim without changing status', async () => {
    const occ = createOccFirestore();
    const chargePath = 'orderCharges/c-fail-1';
    seedPaidCharge(occ, 'c-fail-1', 'order-oc-fail-1');
    const refund = jest.fn().mockRejectedValue(new Error('provider down'));
    const service = makeService(occ, refund);

    await expect(service.refundByOrderId('order-oc-fail-1', '주문 취소')).rejects.toThrow(
      'provider down',
    );

    expect(refund).toHaveBeenCalledTimes(1);
    expect(occ.getData(chargePath)).toMatchObject({ status: 'PAID', refundClaim: null });
  });

  it('5b. provider-failure release never removes a foreign/newer claim', async () => {
    const occ = createOccFirestore();
    const chargePath = 'orderCharges/c-fail-foreign-1';
    seedPaidCharge(occ, 'c-fail-foreign-1', 'order-oc-fail-foreign-1');
    const refund = jest.fn().mockRejectedValue(new Error('provider down'));
    const service = makeService(occ, refund);

    const commits: string[] = [];
    const arm = (): void => {
      occ.setBeforeCommit(() => {
        commits.push('commit');
        if (commits.length === 2) {
          occ.updateOutsideTransaction(chargePath, {
            refundClaim: { token: 'newer-foreign', expiresAt: Date.now() + 300000 },
          });
        }
        arm();
      });
    };
    arm();

    await expect(
      service.refundByOrderId('order-oc-fail-foreign-1', '주문 취소'),
    ).rejects.toThrow('provider down');
    occ.clearHooks();

    expect(refund).toHaveBeenCalledTimes(1);
    expect(commits).toHaveLength(3);
    expect(occ.getData(chargePath)?.['refundClaim']).toEqual({
      token: 'newer-foreign',
      expiresAt: expect.any(Number),
    });
    expect(occ.getData(chargePath)).toMatchObject({ status: 'PAID' });
  });

  it('6+7. REFUNDED convergence is idempotent; already REFUNDED has no side effect', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-final-1', 'order-oc-final-1');
    const refund = jest.fn().mockResolvedValue(undefined);
    const service = makeService(occ, refund);

    await service.refundByOrderId('order-oc-final-1', '주문 취소');
    expect(refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('orderCharges/c-final-1')).toMatchObject({
      status: 'REFUNDED',
      refundClaim: null,
    });

    // Completed refund followed by a retry must not call the provider again.
    await service.refundByOrderId('order-oc-final-1', '주문 취소');
    expect(refund).toHaveBeenCalledTimes(1);

    // A document that is already REFUNDED/refundedAt never authorizes a refund.
    occ.seed('orderCharges/c-done-1', {
      id: 'c-done-1',
      orderId: 'order-oc-done-1',
      status: 'REFUNDED',
      type: 'REDELIVERY_FEE',
      amount: 3000,
      portonePaymentId: 'order-charge-c-done-1',
      refundedAt: new Date('2026-09-01T00:00:00.000Z'),
      refundClaim: null,
    });
    await service.refundByOrderId('order-oc-done-1', '주문 취소');
    expect(refund).toHaveBeenCalledTimes(1);
  });
});
