// PaymentRefund retry-purity regression proofs on the canonical OCC harness.
// Task: PAYMENT-REFUND-OCC-RETRY-PURITY-CLOSURE-01
//
// Proves UNCOMMITTED_TRANSACTION_ATTEMPT MUST_NOT_AUTHORIZE_EXTERNAL_SIDE_EFFECT
// for PaymentRefundService.refundByOrderId:
//   A. normal claim -> provider exactly once
//   B. first-attempt conflict -> retry loser provider 0 (no stale decision leak)
//   C. concurrent claimers -> exactly one owner, provider <= 1
//   D. retry exhaustion -> provider 0, no partial committed state
//   E. provider failure -> own claim release only, foreign claim preserved
//   F. success finalization -> token owner only, duplicate finalize side-effect 0
//
// Uses only the canonical harness (per-doc version, conflict detection, retry
// re-execution, staged writes, failed-attempt discard, beforeCommit
// deterministic interleaving). Serial fakes are not used.

import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { PaymentRefundService } from './payment-refund.service';

function makeService(occ: ReturnType<typeof createOccFirestore>, portoneRefund: jest.Mock) {
  const portone = { refund: portoneRefund } as never;
  const issueWriter = { createOrMergeIssue: jest.fn().mockResolvedValue({ id: 'issue-1' }) };
  const retention = { saveRecord: jest.fn().mockResolvedValue({}) };
  const service = new PaymentRefundService(
    occ.firestore as never,
    portone,
    issueWriter as never,
    retention as never,
  );
  return { service, issueWriter, retention };
}

function seedPaid(occ: ReturnType<typeof createOccFirestore>, paymentPath: string, orderId: string) {
  occ.seed(paymentPath, {
    id: paymentPath.split('/')[1],
    orderId,
    storeId: 'store-1',
    userId: 'user-1',
    status: 'PAID',
    amount: 100000,
    portonePaymentId: `portone-${orderId}`,
  });
}

describe('PaymentRefund OCC retry purity', () => {
  it('A. normal claim commits and refunds exactly once with retention metadata', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-normal-1', 'order-normal-1');
    const refund = jest.fn().mockResolvedValue(undefined);
    const { service, retention } = makeService(occ, refund);

    const commits: Array<{ readPaths: string[]; writeCount: number }> = [];
    const arm = (): void => {
      occ.setBeforeCommit((ctx) => {
        commits.push({ readPaths: [...ctx.readPaths], writeCount: ctx.writes.length });
        arm();
      });
    };
    arm();

    await service.refundByOrderId('order-normal-1', '고객 요청');
    occ.clearHooks();

    expect(refund).toHaveBeenCalledTimes(1);
    expect(refund).toHaveBeenCalledWith('portone-order-normal-1', 100000, '고객 요청');
    // Claim transaction + finalize transaction, each committed once.
    expect(commits).toHaveLength(2);
    expect(commits[0].writeCount).toBe(1);
    expect(commits[1].writeCount).toBe(1);
    expect(occ.getData('payments/pay-normal-1')).toMatchObject({
      status: 'CANCELLED',
      refundAmount: 100000,
      refundClaim: null,
    });
    expect(occ.getData('payments/pay-normal-1')?.['refundedAt']).toBeDefined();
    expect(retention.saveRecord).toHaveBeenCalledTimes(1);
    expect(retention.saveRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'pay-normal-1:refund',
        purpose: 'LEGAL_DISPUTE',
        metadata: expect.objectContaining({
          orderId: 'order-normal-1',
          paymentStatus: 'CANCELLED',
          amount: 100000,
        }),
      }),
    );
  });

  it('B. first-attempt conflict retries to loser: provider 0, foreign claim preserved', async () => {
    const occ = createOccFirestore();
    const paymentPath = 'payments/pay-conflict-1';
    seedPaid(occ, paymentPath, 'order-conflict-1');
    const refund = jest.fn().mockResolvedValue(undefined);
    const { service } = makeService(occ, refund);

    const commits: Array<{ writes: Array<{ kind: string; path: string }> }> = [];
    const arm = (): void => {
      occ.setBeforeCommit((ctx) => {
        commits.push({
          writes: ctx.writes.map((w) => ({
            kind: w.kind,
            path: (w as { path: string }).path,
          })),
        });
        if (commits.length === 1) {
          // Competing claim lands after attempt 1 read but before its commit.
          occ.updateOutsideTransaction(paymentPath, {
            refundClaim: { token: 'foreign-token', expiresAt: Date.now() + 300000 },
          });
        }
        arm();
      });
    };
    arm();

    await service.refundByOrderId('order-conflict-1', '고객 요청');
    occ.clearHooks();

    // Two commit validations: attempt 1 aborted, attempt 2 observed the
    // foreign active claim and staged nothing.
    expect(commits).toHaveLength(2);
    expect(commits[0].writes).toHaveLength(1);
    expect(commits[1].writes).toHaveLength(0);
    // The aborted attempt's decision must not authorize the provider.
    expect(refund).not.toHaveBeenCalled();
    expect(occ.getData(paymentPath)).toMatchObject({
      status: 'PAID',
      refundClaim: { token: 'foreign-token' },
    });
  });

  it('C. concurrent claimers converge: exactly one owner, provider <= 1', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-race-1', 'order-race-1');
    const refund = jest.fn().mockResolvedValue(undefined);
    const { service } = makeService(occ, refund);

    const commits: unknown[] = [];
    const arm = (): void => {
      occ.setBeforeCommit((ctx) => {
        commits.push(ctx);
        arm();
      });
    };
    arm();

    await Promise.all([
      service.refundByOrderId('order-race-1', '고객 요청'),
      service.refundByOrderId('order-race-1', '고객 요청'),
    ]);
    occ.clearHooks();

    expect(refund).toHaveBeenCalledTimes(1);
    // Retry happened: 2 claim validations for the loser path + winner + finalize.
    expect(commits.length).toBeGreaterThanOrEqual(3);
    expect(occ.getData('payments/pay-race-1')).toMatchObject({
      status: 'CANCELLED',
      refundClaim: null,
    });
  });

  it('D. retry exhaustion fails bounded with provider 0 and no staged claim', async () => {
    const occ = createOccFirestore({ maxAttempts: 2 });
    const paymentPath = 'payments/pay-hot-1';
    seedPaid(occ, paymentPath, 'order-hot-1');
    const refund = jest.fn().mockResolvedValue(undefined);
    const { service } = makeService(occ, refund);

    let bumps = 0;
    const rearm = (): void => {
      occ.setBeforeCommit(() => {
        bumps += 1;
        // Neutral version bump: forces conflict without itself claiming.
        occ.updateOutsideTransaction(paymentPath, { probe: bumps });
        rearm();
      });
    };
    rearm();

    await expect(service.refundByOrderId('order-hot-1', '고객 요청')).rejects.toThrow(
      'transaction retry limit exceeded',
    );
    occ.clearHooks();

    expect(refund).not.toHaveBeenCalled();
    expect(bumps).toBe(2);
    // Only the external probe writes landed; the transaction's staged claim
    // was discarded on every aborted attempt.
    expect(occ.getData(paymentPath)).toMatchObject({ status: 'PAID', probe: 2 });
    expect(
      (occ.getData(paymentPath) as Record<string, unknown>)['refundClaim'],
    ).toBeUndefined();
  });

  it('E1. provider failure releases own claim and records the operational issue', async () => {
    const occ = createOccFirestore();
    const paymentPath = 'payments/pay-fail-1';
    seedPaid(occ, paymentPath, 'order-fail-1');
    const refund = jest.fn().mockRejectedValue(new Error('provider down'));
    const { service, issueWriter } = makeService(occ, refund);

    await expect(service.refundByOrderId('order-fail-1', '자동 취소')).rejects.toThrow(
      'provider down',
    );

    expect(refund).toHaveBeenCalledTimes(1);
    expect(occ.getData(paymentPath)).toMatchObject({ status: 'PAID', refundClaim: null });
    expect(issueWriter.createOrMergeIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'AUTO_REFUND_FAILED',
        idempotencyKey: 'auto-refund-failed:order-fail-1:pay-fail-1',
      }),
    );
  });

  it('E2. provider-failure release never removes a foreign/newer claim', async () => {
    const occ = createOccFirestore();
    const paymentPath = 'payments/pay-fail-foreign-1';
    seedPaid(occ, paymentPath, 'order-fail-foreign-1');
    const refund = jest.fn().mockRejectedValue(new Error('provider down'));
    const { service } = makeService(occ, refund);

    const commits: string[] = [];
    const arm = (): void => {
      occ.setBeforeCommit(() => {
        commits.push('commit');
        if (commits.length === 2) {
          // Release attempt 0 has read the own claim; a newer foreign claim
          // lands before its commit validation, forcing a retry.
          occ.updateOutsideTransaction(paymentPath, {
            refundClaim: { token: 'newer-foreign', expiresAt: Date.now() + 300000 },
          });
        }
        arm();
      });
    };
    arm();

    await expect(service.refundByOrderId('order-fail-foreign-1', '자동 취소')).rejects.toThrow(
      'provider down',
    );
    occ.clearHooks();

    expect(refund).toHaveBeenCalledTimes(1);
    // Claim + release attempt (aborted) + release retry (empty commit).
    expect(commits).toHaveLength(3);
    expect(occ.getData(paymentPath)?.['refundClaim']).toEqual({
      token: 'newer-foreign',
      expiresAt: expect.any(Number),
    });
    expect(occ.getData(paymentPath)).toMatchObject({ status: 'PAID' });
  });

  it('F. success finalization is token-owned; duplicate finalize has no side effect', async () => {
    const occ = createOccFirestore();
    const paymentPath = 'payments/pay-final-1';
    seedPaid(occ, paymentPath, 'order-final-1');
    const refund = jest.fn().mockResolvedValue(undefined);
    const { service, retention } = makeService(occ, refund);

    await service.refundByOrderId('order-final-1', '고객 요청');
    expect(refund).toHaveBeenCalledTimes(1);
    expect(retention.saveRecord).toHaveBeenCalledTimes(1);

    // Duplicate finalize after CANCELLED/refundedAt must not refund again.
    await service.refundByOrderId('order-final-1', '고객 요청');
    expect(refund).toHaveBeenCalledTimes(1);
    expect(retention.saveRecord).toHaveBeenCalledTimes(1);
    expect(occ.getData(paymentPath)).toMatchObject({
      status: 'CANCELLED',
      refundAmount: 100000,
      refundClaim: null,
    });
  });

  it('G. already CANCELLED payment never authorizes the provider', async () => {
    const occ = createOccFirestore();
    occ.seed('payments/pay-done-1', {
      id: 'pay-done-1',
      orderId: 'order-done-1',
      storeId: 'store-1',
      userId: 'user-1',
      status: 'CANCELLED',
      amount: 100000,
      portonePaymentId: 'portone-order-done-1',
      refundedAt: new Date('2026-09-01T00:00:00.000Z'),
      refundClaim: null,
    });
    const refund = jest.fn().mockResolvedValue(undefined);
    const { service } = makeService(occ, refund);

    await service.refundByOrderId('order-done-1', '고객 요청');

    expect(refund).not.toHaveBeenCalled();
  });
});
