// Operations action-claim fencing OCC regression.
// Task: PILOT-OPERATIONS-ACTION-CLAIM-FENCING-27A
//
// Proves on the canonical harness (apps/api/test/helpers/firestore-occ-fake):
//   A. aborted first owner must not authorize provider/action (committed-return)
//   B. committed owner runs action exactly once, resolves, clears claim
//   C. stale success after takeover preserves B claim, no false RESOLVED
//   D. stale failure after takeover preserves B claim, no fresh-state overwrite
//   E. RETRY_REFUND non-owner claim result cannot call processRefundByOrderId
//
// No real provider/Firebase calls. Uses only createOccFirestore as dependency.

import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { OperationsService } from './operations.service';

type Occ = ReturnType<typeof createOccFirestore>;

function makeService(occ: Occ) {
  const payments = {
    processRefundByOrderId: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = {
    resendSms: jest.fn().mockResolvedValue({ success: true }),
  };
  const service = new OperationsService(
    occ.firestore as never,
    payments as never,
    notifications as never,
  );
  return { service, payments, notifications };
}

function seedRefundIssue(occ: Occ, issueId = 'issue-1') {
  occ.seed(`operationIssues/${issueId}`, {
    id: issueId,
    storeId: 'store-1',
    orderId: 'order-1',
    paymentId: 'payment-1',
    type: 'AUTO_REFUND_FAILED',
    severity: 'warning',
    status: 'OPEN',
    actions: [],
    createdAt: '2026-09-01T00:00:00.000Z',
  });
  occ.seed('orders/order-1', { id: 'order-1', status: 'CANCELLED' });
  occ.seed('payments/payment-1', {
    id: 'payment-1',
    orderId: 'order-1',
    status: 'PAID',
  });
}

describe('Operations action claim fencing (OCC retry)', () => {
  it('CASE A — aborted first owner: provider 0, tokenB preserved', async () => {
    const occ = createOccFirestore();
    seedRefundIssue(occ);
    const { service, payments } = makeService(occ);

    const commits: Array<{ writeCount: number }> = [];
    const arm = (): void => {
      occ.setBeforeCommit((ctx) => {
        commits.push({ writeCount: ctx.writes.length });
        if (commits.length === 1) {
          // B commits tokenB after A attempt-1 read but before its validation.
          // A attempt-1 must abort; A retry must observe active tokenB.
          occ.updateOutsideTransaction('operationIssues/issue-1', {
            actionClaim: {
              token: 'tokenB',
              actionType: 'RETRY_REFUND',
              expiresAt: Date.now() + 300_000,
            },
          });
        }
        arm();
      });
    };
    arm();

    await service.executeAction({
      issueId: 'issue-1',
      actorId: 'seller-A',
      actionType: 'RETRY_REFUND',
    });
    occ.clearHooks();

    // Attempt-1 staged own claim (1 write, aborted), retry observed tokenB (0 writes).
    expect(commits).toHaveLength(2);
    expect(commits[0].writeCount).toBe(1);
    expect(commits[1].writeCount).toBe(0);
    // Aborted attempt must not authorize provider/action execution.
    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(occ.getData('operationIssues/issue-1')).toMatchObject({
      status: 'OPEN',
      actionClaim: { token: 'tokenB' },
    });
    expect(occ.getData('operationIssues/issue-1')?.['actions']).toEqual([]);
  });

  it('CASE B — committed owner: action once, resolves, claim cleared', async () => {
    const occ = createOccFirestore();
    seedRefundIssue(occ);
    const { service, payments } = makeService(occ);

    await service.executeAction({
      issueId: 'issue-1',
      actorId: 'seller-A',
      actionType: 'RETRY_REFUND',
    });

    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(payments.processRefundByOrderId).toHaveBeenCalledWith(
      'order-1',
      '운영 예외 환불 재시도',
    );
    const final = occ.getData('operationIssues/issue-1') as Record<string, unknown>;
    expect(final).toMatchObject({ status: 'RESOLVED', actionClaim: null });
    const actions = final['actions'] as Array<Record<string, unknown>>;
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      actorId: 'seller-A',
      actionType: 'RETRY_REFUND',
      status: 'SUCCEEDED',
    });
  });

  it('CASE C — stale success after takeover: B preserved, no false RESOLVED', async () => {
    const occ = createOccFirestore();
    seedRefundIssue(occ);
    const { service, payments } = makeService(occ);

    payments.processRefundByOrderId.mockImplementationOnce(async () => {
      // A held tokenA while running provider; B takeovers before A completes.
      occ.updateOutsideTransaction('operationIssues/issue-1', {
        actionClaim: {
          token: 'tokenB',
          actionType: 'RETRY_REFUND',
          expiresAt: Date.now() + 300_000,
        },
      });
    });

    const result = await service.executeAction({
      issueId: 'issue-1',
      actorId: 'seller-A',
      actionType: 'RETRY_REFUND',
    });

    // A did run the provider as the owner at execution time.
    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    // But stale success must not clear/resolve the takeover claim.
    const final = occ.getData('operationIssues/issue-1') as Record<string, unknown>;
    expect(final).toMatchObject({
      status: 'OPEN',
      actionClaim: { token: 'tokenB' },
    });
    expect(final['actions']).toEqual([]);
    // Stale completion returns current fresh state, not a false RESOLVED.
    expect(result).toMatchObject({ status: 'OPEN' });
  });

  it('CASE D — stale failure after takeover: B preserved, fresh state kept', async () => {
    const occ = createOccFirestore();
    seedRefundIssue(occ);
    const { service, payments } = makeService(occ);

    payments.processRefundByOrderId.mockImplementationOnce(async () => {
      occ.updateOutsideTransaction('operationIssues/issue-1', {
        status: 'OPEN',
        actionClaim: {
          token: 'tokenB',
          actionType: 'RETRY_REFUND',
          expiresAt: Date.now() + 300_000,
        },
      });
      throw new Error('provider down');
    });

    await expect(
      service.executeAction({
        issueId: 'issue-1',
        actorId: 'seller-A',
        actionType: 'RETRY_REFUND',
      }),
    ).rejects.toThrow('provider down');

    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    const final = occ.getData('operationIssues/issue-1') as Record<string, unknown>;
    // Takeover claim survives the stale failure completion.
    expect(final).toMatchObject({
      status: 'OPEN',
      actionClaim: { token: 'tokenB' },
    });
    // Stale FAILED action must not overwrite fresh state.
    expect(final['actions']).toEqual([]);
  });

  it('CASE E — RETRY_REFUND non-owner cannot call processRefundByOrderId', async () => {
    const occ = createOccFirestore();
    seedRefundIssue(occ);
    occ.updateOutsideTransaction('operationIssues/issue-1', {
      actionClaim: {
        token: 'tokenB',
        actionType: 'RETRY_REFUND',
        expiresAt: Date.now() + 300_000,
      },
    });
    const { service, payments } = makeService(occ);

    await service.executeAction({
      issueId: 'issue-1',
      actorId: 'seller-A',
      actionType: 'RETRY_REFUND',
    });

    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(occ.getData('operationIssues/issue-1')).toMatchObject({
      status: 'OPEN',
      actionClaim: { token: 'tokenB' },
    });
    expect(occ.getData('operationIssues/issue-1')?.['actions']).toEqual([]);
  });

  it('RESEND_SMS non-owner cannot call resendSms', async () => {
    const occ = createOccFirestore();
    occ.seed('operationIssues/issue-sms', {
      id: 'issue-sms',
      storeId: 'store-1',
      orderId: 'order-1',
      paymentId: 'payment-1',
      type: 'CUSTOMER_NOTICE_FAILED',
      severity: 'warning',
      status: 'OPEN',
      actions: [],
      createdAt: '2026-09-01T00:00:00.000Z',
      actionClaim: {
        token: 'tokenB',
        actionType: 'RESEND_SMS',
        expiresAt: Date.now() + 300_000,
      },
    });
    occ.seed('orders/order-1', { id: 'order-1', status: 'ORDER_DELIVERING' });
    const { service, notifications } = makeService(occ);

    await service.executeAction({
      issueId: 'issue-sms',
      actorId: 'seller-A',
      actionType: 'RESEND_SMS',
    });

    expect(notifications.resendSms).not.toHaveBeenCalled();
    expect(occ.getData('operationIssues/issue-sms')).toMatchObject({
      status: 'OPEN',
      actionClaim: { token: 'tokenB' },
    });
  });
});
