// Operations action-claim lease-expiry regression.
//
// Directly pins the OPERATION-ACTION-CLAIM-FENCING contract on the canonical
// OCC harness (apps/api/test/helpers/firestore-occ-fake):
//   A. lease expiry + takeover before the external call -> stale owner performs
//      no refund/SMS side effect, no status write, no claim clear
//   B. same fencing for the RESEND_SMS external side effect
//   C. stale success after takeover preserves B claim/status/audit
//   D. stale failure after takeover preserves B claim/status/audit
//
// The 5-minute lease and the takeover condition are unchanged; only the
// freshness of the owner token at the external-action and completion/failure
// writes is exercised. No real provider/Firebase calls.

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

function seedSmsIssue(occ: Occ, issueId = 'issue-sms') {
  occ.seed(`operationIssues/${issueId}`, {
    id: issueId,
    storeId: 'store-1',
    orderId: 'order-1',
    paymentId: 'payment-1',
    type: 'CUSTOMER_NOTICE_FAILED',
    severity: 'warning',
    status: 'OPEN',
    actions: [],
    createdAt: '2026-09-01T00:00:00.000Z',
  });
  occ.seed('orders/order-1', { id: 'order-1', status: 'ORDER_DELIVERING' });
}

// A owns tokenA. Its lease expires and B takes over before A's external call.
// The takeover is injected at the fresh-owner read inside runAction, so A must
// observe tokenB and abort without touching the provider or the issue document.
function armTakeoverBeforeExternalCall(occ: Occ, issuePath: string, actionType: string) {
  occ.setBeforeCommit(() => {
    occ.setBeforeAttempt(() => {
      occ.updateOutsideTransaction(issuePath, {
        actionClaim: {
          token: 'tokenB',
          actionType,
          expiresAt: Date.now() + 300_000,
        },
      });
    });
  });
}

describe('Operations action claim fencing (lease expiry)', () => {
  it('CASE A — lease expiry takeover: RETRY_REFUND performs no refund side effect', async () => {
    const occ = createOccFirestore();
    seedRefundIssue(occ);
    const { service, payments } = makeService(occ);
    armTakeoverBeforeExternalCall(occ, 'operationIssues/issue-1', 'RETRY_REFUND');

    const result = await service.executeAction({
      issueId: 'issue-1',
      actorId: 'seller-A',
      actionType: 'RETRY_REFUND',
    });

    // Stale owner A must not reach the provider after losing the lease.
    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
    const final = occ.getData('operationIssues/issue-1') as Record<string, unknown>;
    expect(final).toMatchObject({
      status: 'OPEN',
      actionClaim: { token: 'tokenB' },
    });
    // No status/audit write and no claim clear by the stale owner.
    expect(final['actions']).toEqual([]);
    expect(result).toMatchObject({ status: 'OPEN' });
  });

  it('CASE B — lease expiry takeover: RESEND_SMS performs no SMS side effect', async () => {
    const occ = createOccFirestore();
    seedSmsIssue(occ);
    const { service, notifications } = makeService(occ);
    armTakeoverBeforeExternalCall(occ, 'operationIssues/issue-sms', 'RESEND_SMS');

    const result = await service.executeAction({
      issueId: 'issue-sms',
      actorId: 'seller-A',
      actionType: 'RESEND_SMS',
    });

    expect(notifications.resendSms).not.toHaveBeenCalled();
    const final = occ.getData('operationIssues/issue-sms') as Record<string, unknown>;
    expect(final).toMatchObject({
      status: 'OPEN',
      actionClaim: { token: 'tokenB' },
    });
    expect(final['actions']).toEqual([]);
    expect(result).toMatchObject({ status: 'OPEN' });
  });

  it('CASE C — stale success after takeover preserves B claim, status, and audit', async () => {
    const occ = createOccFirestore();
    seedRefundIssue(occ);
    const { service, payments } = makeService(occ);

    payments.processRefundByOrderId.mockImplementationOnce(() => {
      // A held tokenA through its fresh-owner read, but its lease expired while
      // the provider call was in flight; B took over with tokenB.
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

    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    const final = occ.getData('operationIssues/issue-1') as Record<string, unknown>;
    // Stale success must not clear B's claim, resolve the issue, or append audit.
    expect(final).toMatchObject({
      status: 'OPEN',
      actionClaim: { token: 'tokenB' },
    });
    expect(final['actions']).toEqual([]);
    expect(result).toMatchObject({ status: 'OPEN' });
  });

  it('CASE D — stale failure after takeover preserves B claim, status, and audit', async () => {
    const occ = createOccFirestore();
    seedRefundIssue(occ);
    const { service, payments } = makeService(occ);

    payments.processRefundByOrderId.mockImplementationOnce(() => {
      occ.updateOutsideTransaction('operationIssues/issue-1', {
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
    // Stale failure must not clear B's claim or append a FAILED audit entry.
    expect(final).toMatchObject({
      status: 'OPEN',
      actionClaim: { token: 'tokenB' },
    });
    expect(final['actions']).toEqual([]);
  });
});
