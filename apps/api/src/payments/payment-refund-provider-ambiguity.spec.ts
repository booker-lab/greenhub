// PILOT-REFUND-PROVIDER-AMBIGUITY-RECOVERY-28A focused proofs.
// PaymentRefundService: R1-R7.
//
// Invariants:
// - provider refund POST starts only with persisted ownership (CLAIMED fresh
//   or UNKNOWN retry after readback + recheck).
// - Once a POST has started, any unclear result persists UNKNOWN, never
//   blind-releases to null, and never blind-retries a second POST.
// - Retry reconciles via portone.getPayment before any POST.
// - Terminal CANCELLED readback converges locally with zero additional POST.
// - Still-PAID readback proceeds only after fresh ownership recheck.
// - Ambiguous readback fails closed with zero POST.
// - Stale tokens never authorize a POST.
// - Retry purity: aborted attempts never authorize a POST.
//
// Real provider is never used; PortOne is fully mocked.
// Proven vocabulary (PortoneClient/e2e/finalization): terminal = CANCELLED,
// still-paid = PAID. All other statuses fail closed.

import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { PaymentRefundService } from './payment-refund.service';

type Occ = ReturnType<typeof createOccFirestore>;

function seedPaid(occ: Occ, paymentPath: string, orderId: string) {
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

function makeService(occ: Occ, portone: { refund: jest.Mock; getPayment: jest.Mock }) {
  const issueWriter = { createOrMergeIssue: jest.fn().mockResolvedValue({ id: 'issue-1' }) };
  const retention = { saveRecord: jest.fn().mockResolvedValue({}) };
  const service = new PaymentRefundService(
    occ.firestore as never,
    portone as never,
    issueWriter as never,
    retention as never,
  );
  return { service, issueWriter, retention };
}

function paidReadback(providerPaymentId: string, total = 100000) {
  return {
    id: providerPaymentId,
    transactionId: 'tx-1',
    amount: { total },
    status: 'PAID',
    method: { type: 'CARD' },
  };
}

function cancelledReadback(providerPaymentId: string, total = 100000) {
  return {
    id: providerPaymentId,
    transactionId: 'tx-1',
    amount: { total },
    status: 'CANCELLED',
    method: { type: 'CARD' },
  };
}

describe('PaymentRefund provider ambiguity 28A (R1-R7)', () => {
  it('R1. normal refund issues exactly one POST and converges to CANCELLED', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-r1', 'order-r1');
    const portone = { refund: jest.fn().mockResolvedValue(undefined), getPayment: jest.fn() };
    const { service, retention } = makeService(occ, portone);

    await service.refundByOrderId('order-r1', '고객 요청');

    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(portone.refund).toHaveBeenCalledWith('portone-order-r1', 100000, '고객 요청');
    expect(portone.getPayment).not.toHaveBeenCalled();
    expect(occ.getData('payments/pay-r1')).toMatchObject({
      status: 'CANCELLED',
      refundAmount: 100000,
      refundClaim: null,
    });
    expect(retention.saveRecord).toHaveBeenCalledTimes(1);
  });

  it('R2. provider timeout persists UNKNOWN; retry readbacks before any second POST (blind POST 0)', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-r2', 'order-r2');
    const portone = {
      refund: jest
        .fn()
        .mockRejectedValueOnce(new Error('provider timeout'))
        .mockResolvedValue(undefined),
      getPayment: jest.fn().mockRejectedValue(new Error('readback down')),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-r2', 'r')).rejects.toThrow('provider timeout');
    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(portone.getPayment).not.toHaveBeenCalled();
    expect(occ.getData('payments/pay-r2')).toMatchObject({
      status: 'PAID',
      refundClaim: expect.objectContaining({ owner: 'payment-refund', status: 'UNKNOWN' }),
    });

    await expect(service.refundByOrderId('order-r2', 'r')).rejects.toThrow('readback down');
    // Retry performed readback first and issued no blind second POST.
    expect(portone.getPayment).toHaveBeenCalledTimes(1);
    expect(portone.getPayment).toHaveBeenCalledWith('portone-order-r2');
    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('payments/pay-r2')).toMatchObject({
      status: 'PAID',
      refundClaim: expect.objectContaining({ status: 'UNKNOWN' }),
    });
  });

  it('R3. provider success + local completion failure persists UNKNOWN; retry blind POST 0', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-r3', 'order-r3');
    const portone = {
      refund: jest.fn().mockResolvedValue(undefined),
      getPayment: jest.fn().mockRejectedValue(new Error('readback down')),
    };
    const issueWriter = { createOrMergeIssue: jest.fn().mockResolvedValue({ id: 'issue-1' }) };
    const retention = {
      saveRecord: jest
        .fn()
        .mockRejectedValueOnce(new Error('local commit failed'))
        .mockResolvedValue({}),
    };
    const service = new PaymentRefundService(
      occ.firestore as never,
      portone as never,
      issueWriter as never,
      retention as never,
    );

    await expect(service.refundByOrderId('order-r3', 'r')).rejects.toThrow('local commit failed');
    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('payments/pay-r3')).toMatchObject({
      status: 'PAID',
      refundClaim: expect.objectContaining({ status: 'UNKNOWN' }),
    });

    await expect(service.refundByOrderId('order-r3', 'r')).rejects.toThrow('readback down');
    expect(portone.getPayment).toHaveBeenCalledTimes(1);
    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('payments/pay-r3')).toMatchObject({ status: 'PAID' });
  });

  it('R4. UNKNOWN readback terminal CANCELLED converges locally with zero additional POST', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-r4', 'order-r4');
    const portone = {
      refund: jest
        .fn()
        .mockRejectedValueOnce(new Error('provider timeout'))
        .mockResolvedValue(undefined),
      getPayment: jest.fn().mockResolvedValue(cancelledReadback('portone-order-r4')),
    };
    const { service, retention } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-r4', 'r')).rejects.toThrow('provider timeout');
    expect(portone.refund).toHaveBeenCalledTimes(1);

    await service.refundByOrderId('order-r4', 'r');

    expect(portone.getPayment).toHaveBeenCalledTimes(1);
    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('payments/pay-r4')).toMatchObject({
      status: 'CANCELLED',
      refundAmount: 100000,
      refundClaim: null,
    });
    expect(retention.saveRecord).toHaveBeenCalledTimes(1);
  });

  it('R5. UNKNOWN readback still-PAID rechecks ownership then allows at most one POST', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-r5', 'order-r5');
    const portone = {
      refund: jest
        .fn()
        .mockRejectedValueOnce(new Error('provider timeout'))
        .mockResolvedValue(undefined),
      getPayment: jest.fn().mockResolvedValue(paidReadback('portone-order-r5')),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-r5', 'r')).rejects.toThrow('provider timeout');
    expect(portone.refund).toHaveBeenCalledTimes(1);

    await service.refundByOrderId('order-r5', 'r');

    expect(portone.getPayment).toHaveBeenCalledTimes(1);
    expect(portone.refund).toHaveBeenCalledTimes(2);
    expect(occ.getData('payments/pay-r5')).toMatchObject({
      status: 'CANCELLED',
      refundClaim: null,
    });

    // Converged: further retry issues no additional POST.
    await service.refundByOrderId('order-r5', 'r');
    expect(portone.refund).toHaveBeenCalledTimes(2);
  });

  it('R6a. UNKNOWN readback throw fails closed with POST 0', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-r6a', 'order-r6a');
    const portone = {
      refund: jest.fn().mockRejectedValueOnce(new Error('provider timeout')),
      getPayment: jest.fn().mockRejectedValue(new Error('readback down')),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-r6a', 'r')).rejects.toThrow('provider timeout');
    await expect(service.refundByOrderId('order-r6a', 'r')).rejects.toThrow('readback down');

    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(portone.getPayment).toHaveBeenCalledTimes(1);
    expect(occ.getData('payments/pay-r6a')).toMatchObject({ status: 'PAID' });
  });

  it('R6b. UNKNOWN readback unknown status (PENDING) fails closed with POST 0', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-r6b', 'order-r6b');
    const portone = {
      refund: jest.fn().mockRejectedValueOnce(new Error('provider timeout')),
      getPayment: jest.fn().mockResolvedValue({
        id: 'portone-order-r6b',
        transactionId: 'tx-1',
        amount: { total: 100000 },
        status: 'PENDING',
        method: { type: 'CARD' },
      }),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-r6b', 'r')).rejects.toThrow('provider timeout');
    await expect(service.refundByOrderId('order-r6b', 'r')).rejects.toThrow(
      'PortOne 결제 상태를 확정할 수 없어 환불을 중단합니다.',
    );

    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('payments/pay-r6b')).toMatchObject({ status: 'PAID' });
  });

  it('R6c. UNKNOWN readback amount mismatch fails closed with POST 0', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-r6c', 'order-r6c');
    const portone = {
      refund: jest.fn().mockRejectedValueOnce(new Error('provider timeout')),
      getPayment: jest.fn().mockResolvedValue(paidReadback('portone-order-r6c', 99999)),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-r6c', 'r')).rejects.toThrow('provider timeout');
    await expect(service.refundByOrderId('order-r6c', 'r')).rejects.toThrow(
      'PortOne 결제 상태를 확정할 수 없어 환불을 중단합니다.',
    );

    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('payments/pay-r6c')).toMatchObject({ status: 'PAID' });
  });

  it('R6d. UNKNOWN readback payment identity mismatch fails closed with POST 0', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-r6d', 'order-r6d');
    const portone = {
      refund: jest.fn().mockRejectedValueOnce(new Error('provider timeout')),
      getPayment: jest.fn().mockResolvedValue(paidReadback('portone-OTHER', 100000)),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-r6d', 'r')).rejects.toThrow('provider timeout');
    await expect(service.refundByOrderId('order-r6d', 'r')).rejects.toThrow(
      'PortOne 결제 상태를 확정할 수 없어 환불을 중단합니다.',
    );

    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('payments/pay-r6d')).toMatchObject({ status: 'PAID' });
  });

  it('R7a. concurrent fresh claimers converge: exactly one owner, POST 1', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-r7a', 'order-r7a');
    const portone = { refund: jest.fn().mockResolvedValue(undefined), getPayment: jest.fn() };
    const { service } = makeService(occ, portone);

    await Promise.all([
      service.refundByOrderId('order-r7a', 'r'),
      service.refundByOrderId('order-r7a', 'r'),
    ]);

    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('payments/pay-r7a')).toMatchObject({
      status: 'CANCELLED',
      refundClaim: null,
    });
  });

  it('R7b. stale token loses ownership recheck: loser POST 0', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-r7b', 'order-r7b');
    const portone = {
      refund: jest
        .fn()
        .mockRejectedValueOnce(new Error('provider timeout'))
        .mockResolvedValue(undefined),
      getPayment: jest.fn().mockImplementation(async () => {
        // Concurrent taker steals ownership between readback and recheck.
        occ.updateOutsideTransaction('payments/pay-r7b', {
          refundClaim: { token: 'foreign-steal', owner: 'payment-refund', status: 'UNKNOWN', expiresAt: Date.now() + 300000 },
        });
        return paidReadback('portone-order-r7b');
      }),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-r7b', 'r')).rejects.toThrow('provider timeout');
    expect(portone.refund).toHaveBeenCalledTimes(1);

    await service.refundByOrderId('order-r7b', 'r');

    expect(portone.getPayment).toHaveBeenCalledTimes(1);
    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('payments/pay-r7b')?.['refundClaim']).toMatchObject({
      token: 'foreign-steal',
    });
  });

  it('R7c. aborted claim attempt never authorizes a POST (retry purity)', async () => {
    const occ = createOccFirestore();
    const paymentPath = 'payments/pay-r7c';
    seedPaid(occ, paymentPath, 'order-r7c');
    const portone = { refund: jest.fn().mockResolvedValue(undefined), getPayment: jest.fn() };
    const { service } = makeService(occ, portone);

    let commits = 0;
    const arm = (): void => {
      occ.setBeforeCommit(() => {
        commits += 1;
        if (commits === 1) {
          occ.updateOutsideTransaction(paymentPath, {
            refundClaim: { token: 'foreign-token', owner: 'payment-refund', status: 'CLAIMED', expiresAt: Date.now() + 300000 },
          });
        }
        arm();
      });
    };
    arm();

    await service.refundByOrderId('order-r7c', 'r');
    occ.clearHooks();

    expect(commits).toBe(2);
    expect(portone.refund).not.toHaveBeenCalled();
    expect(occ.getData(paymentPath)).toMatchObject({
      status: 'PAID',
      refundClaim: { token: 'foreign-token' },
    });
  });
});
