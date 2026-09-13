// PILOT-REFUND-PROVIDER-AMBIGUITY-RECOVERY-28A focused proofs.
// OrderChargePaymentService: C1-C7 (same meaning as R1-R7).
//
// Terminal local state is REFUNDED (not CANCELLED). Proven provider
// vocabulary is identical: terminal = CANCELLED, still-paid = PAID.

import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { OrderChargePaymentService } from './order-charge-payment.service';

type Occ = ReturnType<typeof createOccFirestore>;

function seedPaidCharge(occ: Occ, chargeId: string, orderId: string) {
  occ.seed(`orderCharges/${chargeId}`, {
    id: chargeId,
    orderId,
    status: 'PAID',
    type: 'REDELIVERY_FEE',
    amount: 3000,
    portonePaymentId: `order-charge-${chargeId}`,
  });
}

function makeService(occ: Occ, portone: { refund: jest.Mock; getPayment: jest.Mock }) {
  const issueWriter = { createOrMergeIssue: jest.fn().mockResolvedValue({ id: 'issue-1' }) };
  const service = new OrderChargePaymentService(
    occ.firestore as never,
    portone as never,
    issueWriter as never,
  );
  return { service, issueWriter };
}

function paidReadback(providerPaymentId: string, total = 3000) {
  return {
    id: providerPaymentId,
    transactionId: 'tx-1',
    amount: { total },
    status: 'PAID',
    method: { type: 'CARD' },
  };
}

function cancelledReadback(providerPaymentId: string, total = 3000) {
  return {
    id: providerPaymentId,
    transactionId: 'tx-1',
    amount: { total },
    status: 'CANCELLED',
    method: { type: 'CARD' },
  };
}

describe('OrderCharge refund provider ambiguity 28A (C1-C7)', () => {
  it('C1. normal refund issues exactly one POST and converges to REFUNDED', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-c1', 'order-c1');
    const portone = { refund: jest.fn().mockResolvedValue(undefined), getPayment: jest.fn() };
    const { service } = makeService(occ, portone);

    await service.refundByOrderId('order-c1', '주문 취소');

    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(portone.refund).toHaveBeenCalledWith('order-charge-c-c1', 3000, '주문 취소');
    expect(portone.getPayment).not.toHaveBeenCalled();
    expect(occ.getData('orderCharges/c-c1')).toMatchObject({
      status: 'REFUNDED',
      refundClaim: null,
    });
  });

  it('C2. provider timeout persists UNKNOWN; retry readbacks before any second POST', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-c2', 'order-c2');
    const portone = {
      refund: jest
        .fn()
        .mockRejectedValueOnce(new Error('provider timeout'))
        .mockResolvedValue(undefined),
      getPayment: jest.fn().mockRejectedValue(new Error('readback down')),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-c2', 'r')).rejects.toThrow('provider timeout');
    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('orderCharges/c-c2')).toMatchObject({
      status: 'PAID',
      refundClaim: expect.objectContaining({ owner: 'order-charge-refund', status: 'UNKNOWN' }),
    });

    await expect(service.refundByOrderId('order-c2', 'r')).rejects.toThrow('readback down');
    expect(portone.getPayment).toHaveBeenCalledTimes(1);
    expect(portone.getPayment).toHaveBeenCalledWith('order-charge-c-c2');
    expect(portone.refund).toHaveBeenCalledTimes(1);
  });

  it('C3. provider success + local completion failure persists UNKNOWN; retry blind POST 0', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-c3', 'order-c3');
    const portone = {
      refund: jest.fn().mockResolvedValue(undefined),
      getPayment: jest.fn().mockRejectedValue(new Error('readback down')),
    };
    const { service } = makeService(occ, portone);
    const originalComplete = (service as unknown as { completeRefund: (...a: never[]) => Promise<void> }).completeRefund.bind(service);
    let failOnce = true;
    (service as unknown as { completeRefund: (...a: never[]) => Promise<void> }).completeRefund =
      async (...args: never[]) => {
        if (failOnce) {
          failOnce = false;
          throw new Error('local commit failed');
        }
        return originalComplete(...args);
      };

    await expect(service.refundByOrderId('order-c3', 'r')).rejects.toThrow('local commit failed');
    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('orderCharges/c-c3')).toMatchObject({
      status: 'PAID',
      refundClaim: expect.objectContaining({ status: 'UNKNOWN' }),
    });

    await expect(service.refundByOrderId('order-c3', 'r')).rejects.toThrow('readback down');
    expect(portone.getPayment).toHaveBeenCalledTimes(1);
    expect(portone.refund).toHaveBeenCalledTimes(1);
  });

  it('C4. UNKNOWN readback terminal CANCELLED converges to REFUNDED with zero additional POST', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-c4', 'order-c4');
    const portone = {
      refund: jest
        .fn()
        .mockRejectedValueOnce(new Error('provider timeout'))
        .mockResolvedValue(undefined),
      getPayment: jest.fn().mockResolvedValue(cancelledReadback('order-charge-c-c4')),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-c4', 'r')).rejects.toThrow('provider timeout');
    await service.refundByOrderId('order-c4', 'r');

    expect(portone.getPayment).toHaveBeenCalledTimes(1);
    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('orderCharges/c-c4')).toMatchObject({
      status: 'REFUNDED',
      refundClaim: null,
    });
  });

  it('C5. UNKNOWN readback still-PAID rechecks ownership then allows at most one POST', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-c5', 'order-c5');
    const portone = {
      refund: jest
        .fn()
        .mockRejectedValueOnce(new Error('provider timeout'))
        .mockResolvedValue(undefined),
      getPayment: jest.fn().mockResolvedValue(paidReadback('order-charge-c-c5')),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-c5', 'r')).rejects.toThrow('provider timeout');
    await service.refundByOrderId('order-c5', 'r');

    expect(portone.getPayment).toHaveBeenCalledTimes(1);
    expect(portone.refund).toHaveBeenCalledTimes(2);
    expect(occ.getData('orderCharges/c-c5')).toMatchObject({
      status: 'REFUNDED',
      refundClaim: null,
    });

    await service.refundByOrderId('order-c5', 'r');
    expect(portone.refund).toHaveBeenCalledTimes(2);
  });

  it('C6a. UNKNOWN readback throw fails closed with POST 0', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-c6a', 'order-c6a');
    const portone = {
      refund: jest.fn().mockRejectedValueOnce(new Error('provider timeout')),
      getPayment: jest.fn().mockRejectedValue(new Error('readback down')),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-c6a', 'r')).rejects.toThrow('provider timeout');
    await expect(service.refundByOrderId('order-c6a', 'r')).rejects.toThrow('readback down');

    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('orderCharges/c-c6a')).toMatchObject({ status: 'PAID' });
  });

  it('C6b. UNKNOWN readback unknown status (FAILED) fails closed with POST 0', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-c6b', 'order-c6b');
    const portone = {
      refund: jest.fn().mockRejectedValueOnce(new Error('provider timeout')),
      getPayment: jest.fn().mockResolvedValue({
        id: 'order-charge-c-c6b',
        transactionId: 'tx-1',
        amount: { total: 3000 },
        status: 'FAILED',
        method: { type: 'CARD' },
      }),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-c6b', 'r')).rejects.toThrow('provider timeout');
    await expect(service.refundByOrderId('order-c6b', 'r')).rejects.toThrow(
      'PortOne 결제 상태를 확정할 수 없어 환불을 중단합니다.',
    );

    expect(portone.refund).toHaveBeenCalledTimes(1);
  });

  it('C6c. UNKNOWN readback amount mismatch fails closed with POST 0', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-c6c', 'order-c6c');
    const portone = {
      refund: jest.fn().mockRejectedValueOnce(new Error('provider timeout')),
      getPayment: jest.fn().mockResolvedValue(paidReadback('order-charge-c-c6c', 9999)),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-c6c', 'r')).rejects.toThrow('provider timeout');
    await expect(service.refundByOrderId('order-c6c', 'r')).rejects.toThrow(
      'PortOne 결제 상태를 확정할 수 없어 환불을 중단합니다.',
    );

    expect(portone.refund).toHaveBeenCalledTimes(1);
  });

  it('C6d. UNKNOWN readback identity mismatch fails closed with POST 0', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-c6d', 'order-c6d');
    const portone = {
      refund: jest.fn().mockRejectedValueOnce(new Error('provider timeout')),
      getPayment: jest.fn().mockResolvedValue(paidReadback('order-charge-OTHER', 3000)),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-c6d', 'r')).rejects.toThrow('provider timeout');
    await expect(service.refundByOrderId('order-c6d', 'r')).rejects.toThrow(
      'PortOne 결제 상태를 확정할 수 없어 환불을 중단합니다.',
    );

    expect(portone.refund).toHaveBeenCalledTimes(1);
  });

  it('C7a. concurrent fresh claimers converge with POST <= 1', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-c7a', 'order-c7a');
    const portone = { refund: jest.fn().mockResolvedValue(undefined), getPayment: jest.fn() };
    const { service } = makeService(occ, portone);

    await Promise.all([
      service.refundByOrderId('order-c7a', 'r'),
      service.refundByOrderId('order-c7a', 'r'),
    ]);

    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('orderCharges/c-c7a')).toMatchObject({
      status: 'REFUNDED',
      refundClaim: null,
    });
  });

  it('C7b. stale token loses ownership recheck: loser POST 0', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-c7b', 'order-c7b');
    const portone = {
      refund: jest
        .fn()
        .mockRejectedValueOnce(new Error('provider timeout'))
        .mockResolvedValue(undefined),
      getPayment: jest.fn().mockImplementation(async () => {
        occ.updateOutsideTransaction('orderCharges/c-c7b', {
          refundClaim: { token: 'foreign-steal', owner: 'order-charge-refund', status: 'UNKNOWN', expiresAt: Date.now() + 300000 },
        });
        return paidReadback('order-charge-c-c7b');
      }),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-c7b', 'r')).rejects.toThrow('provider timeout');
    await service.refundByOrderId('order-c7b', 'r');

    expect(portone.getPayment).toHaveBeenCalledTimes(1);
    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('orderCharges/c-c7b')?.['refundClaim']).toMatchObject({
      token: 'foreign-steal',
    });
  });

  it('C7c. aborted claim attempt never authorizes a POST (retry purity)', async () => {
    const occ = createOccFirestore();
    const chargePath = 'orderCharges/c-c7c';
    seedPaidCharge(occ, 'c-c7c', 'order-c7c');
    const portone = { refund: jest.fn().mockResolvedValue(undefined), getPayment: jest.fn() };
    const { service } = makeService(occ, portone);

    let commits = 0;
    const arm = (): void => {
      occ.setBeforeCommit(() => {
        commits += 1;
        if (commits === 1) {
          occ.updateOutsideTransaction(chargePath, {
            refundClaim: { token: 'foreign-token', owner: 'order-charge-refund', status: 'CLAIMED', expiresAt: Date.now() + 300000 },
          });
        }
        arm();
      });
    };
    arm();

    await service.refundByOrderId('order-c7c', 'r');
    occ.clearHooks();

    expect(commits).toBe(2);
    expect(portone.refund).not.toHaveBeenCalled();
    expect(occ.getData(chargePath)).toMatchObject({
      status: 'PAID',
      refundClaim: { token: 'foreign-token' },
    });
  });
});
