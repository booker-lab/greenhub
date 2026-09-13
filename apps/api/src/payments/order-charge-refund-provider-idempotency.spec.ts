// PILOT-REFUND-PROVIDER-IDEMPOTENCY-BINDING-28B focused proofs.
// OrderChargePaymentService: I1-I10 + I12 with the order-charge-refund
// namespace (I11 lives in portone.client-idempotency.spec.ts).
//
// Same invariant as payment-refund, with a disjoint provider-key namespace so
// a charge refund operation can never collide with a payment refund operation
// even if order/payment identifiers coincide.
//
// - Real provider is never used; PortOne is fully mocked.

import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { OrderChargePaymentService } from './order-charge-payment.service';
import { PortoneError } from './portone.client';

type Occ = ReturnType<typeof createOccFirestore>;

const NAMESPACE = 'order-charge-refund';
const REASON = '주문 취소';

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

function expectStableKeyShape(key: unknown, ownPortonePaymentId: string) {
  expect(typeof key).toBe('string');
  const value = key as string;
  expect(value.length).toBeGreaterThanOrEqual(16);
  expect(value.length).toBeLessThanOrEqual(256);
  expect(value).toMatch(/^[\x21-\x7E]+$/);
  expect(value.startsWith(`ghr-${NAMESPACE}-`)).toBe(true);
  // No secret/PII: the raw user reason and the provider payment id must
  // never leak into the key.
  expect(value).not.toContain(REASON);
  expect(value).not.toContain(ownPortonePaymentId);
}

function paidReadback(providerPaymentId: string) {
  return {
    id: providerPaymentId,
    transactionId: 'tx-1',
    amount: { total: 3000 },
    status: 'PAID',
    method: { type: 'CARD' },
  };
}

function cancelledReadback(providerPaymentId: string) {
  return {
    id: providerPaymentId,
    transactionId: 'tx-1',
    amount: { total: 3000 },
    status: 'CANCELLED',
    method: { type: 'CARD' },
  };
}

describe('OrderCharge refund provider idempotency binding 28B', () => {
  it('I1. fresh refund: POST 1 with a namespaced Idempotency-Key', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-k1', 'order-k1');
    const portone = { refund: jest.fn().mockResolvedValue(undefined), getPayment: jest.fn() };
    const { service } = makeService(occ, portone);

    await service.refundByOrderId('order-k1', '주문 취소');

    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(portone.refund).toHaveBeenCalledWith(
      'order-charge-c-k1',
      3000,
      '주문 취소',
      expect.any(String),
    );
    expectStableKeyShape(portone.refund.mock.calls[0][3], 'order-charge-c-k1');
  });

  it('I2. POST timeout stores UNKNOWN; retry preserves the same key with POST 0 on readback failure', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-k2', 'order-k2');
    const portone = {
      refund: jest.fn().mockRejectedValueOnce(new Error('provider timeout')),
      getPayment: jest.fn().mockRejectedValue(new Error('readback down')),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-k2', REASON)).rejects.toThrow('provider timeout');
    const firstKey = portone.refund.mock.calls[0][3];
    expectStableKeyShape(firstKey, 'order-charge-c-k2');

    await expect(service.refundByOrderId('order-k2', REASON)).rejects.toThrow('readback down');
    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('orderCharges/c-k2')).toMatchObject({
      status: 'PAID',
      refundClaim: expect.objectContaining({ status: 'UNKNOWN', providerKey: firstKey }),
    });
  });

  it('I3. POST success + local completion throw stores UNKNOWN; PAID retry reuses the same key', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-k3', 'order-k3');
    const portone = {
      refund: jest.fn().mockResolvedValue(undefined),
      getPayment: jest.fn().mockResolvedValue(paidReadback('order-charge-c-k3')),
    };
    const { service } = makeService(occ, portone);
    // Fail exactly the completion commit (claim=1 ok, complete=2 throws,
    // persist=3 clean): the POST already started, so the outcome is UNKNOWN.
    let commits = 0;
    const arm = (): void => {
      occ.setBeforeCommit(() => {
        commits += 1;
        if (commits === 2) throw new Error('local commit failed');
        arm();
      });
    };
    arm();

    await expect(service.refundByOrderId('order-k3', REASON)).rejects.toThrow('local commit failed');
    occ.clearHooks();

    expect(commits).toBe(2);
    expect(portone.refund).toHaveBeenCalledTimes(1);
    const firstKey = portone.refund.mock.calls[0][3];
    expectStableKeyShape(firstKey, 'order-charge-c-k3');
    expect(occ.getData('orderCharges/c-k3')).toMatchObject({
      status: 'PAID',
      refundClaim: expect.objectContaining({ status: 'UNKNOWN', providerKey: firstKey }),
    });

    await service.refundByOrderId('order-k3', REASON);

    expect(portone.refund).toHaveBeenCalledTimes(2);
    expect(portone.refund.mock.calls[1][3]).toBe(firstKey);
    expect(occ.getData('orderCharges/c-k3')).toMatchObject({
      status: 'REFUNDED',
      refundClaim: null,
    });
  });

  it('I4. UNKNOWN readback CANCELLED converges locally with zero additional POST', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-k4', 'order-k4');
    const portone = {
      refund: jest
        .fn()
        .mockRejectedValueOnce(new Error('provider timeout'))
        .mockResolvedValue(undefined),
      getPayment: jest.fn().mockResolvedValue(cancelledReadback('order-charge-c-k4')),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-k4', REASON)).rejects.toThrow('provider timeout');
    await service.refundByOrderId('order-k4', REASON);

    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('orderCharges/c-k4')).toMatchObject({
      status: 'REFUNDED',
      refundClaim: null,
    });
  });

  it('I5. UNKNOWN readback PAID retries with the same key: one logical provider operation', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-k5', 'order-k5');
    const portone = {
      refund: jest
        .fn()
        .mockRejectedValueOnce(new Error('provider timeout'))
        .mockResolvedValue(undefined),
      getPayment: jest.fn().mockResolvedValue(paidReadback('order-charge-c-k5')),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-k5', REASON)).rejects.toThrow('provider timeout');
    const firstKey = portone.refund.mock.calls[0][3];

    await service.refundByOrderId('order-k5', REASON);

    expect(portone.getPayment).toHaveBeenCalledTimes(1);
    expect(portone.refund).toHaveBeenCalledTimes(2);
    expect(portone.refund.mock.calls[1][3]).toBe(firstKey);
    expect(occ.getData('orderCharges/c-k5')).toMatchObject({
      status: 'REFUNDED',
      refundClaim: null,
    });
  });

  it.each(['PENDING', 'FAILED', 'SOME_FUTURE_STATUS'])(
    'I6. UNKNOWN readback %s fails closed with POST 0',
    async (status) => {
      const occ = createOccFirestore();
      seedPaidCharge(occ, 'c-k6', 'order-k6');
      const portone = {
        refund: jest.fn().mockRejectedValueOnce(new Error('provider timeout')),
        getPayment: jest.fn().mockResolvedValue({
          id: 'order-charge-c-k6',
          transactionId: 'tx-1',
          amount: { total: 3000 },
          status,
          method: { type: 'CARD' },
        }),
      };
      const { service } = makeService(occ, portone);

      await expect(service.refundByOrderId('order-k6', REASON)).rejects.toThrow('provider timeout');
      const firstKey = portone.refund.mock.calls[0][3];
      await expect(service.refundByOrderId('order-k6', REASON)).rejects.toThrow(
        'PortOne 결제 상태를 확정할 수 없어 환불을 중단합니다.',
      );

      expect(portone.refund).toHaveBeenCalledTimes(1);
      expect(occ.getData('orderCharges/c-k6')).toMatchObject({
        status: 'PAID',
        refundClaim: expect.objectContaining({ status: 'UNKNOWN', providerKey: firstKey }),
      });
    },
  );

  it('I7. readback throw keeps UNKNOWN with POST 0', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-k7', 'order-k7');
    const portone = {
      refund: jest.fn().mockRejectedValueOnce(new Error('provider timeout')),
      getPayment: jest.fn().mockRejectedValue(new Error('readback down')),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-k7', REASON)).rejects.toThrow('provider timeout');
    const firstKey = portone.refund.mock.calls[0][3];
    await expect(service.refundByOrderId('order-k7', REASON)).rejects.toThrow('readback down');

    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(portone.getPayment).toHaveBeenCalledTimes(1);
    expect(occ.getData('orderCharges/c-k7')).toMatchObject({
      status: 'PAID',
      refundClaim: expect.objectContaining({ status: 'UNKNOWN', providerKey: firstKey }),
    });
  });

  it('I8. UNKNOWN takeover may rotate the local token but never the provider key', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-k8', 'order-k8');
    const portone = {
      refund: jest.fn().mockRejectedValueOnce(new Error('provider timeout')),
      getPayment: jest.fn().mockRejectedValue(new Error('readback down')),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-k8', REASON)).rejects.toThrow('provider timeout');
    const firstClaim = occ.getData('orderCharges/c-k8')?.['refundClaim'] as Record<string, unknown>;
    const firstKey = portone.refund.mock.calls[0][3];
    expect(firstClaim['providerKey']).toBe(firstKey);

    await expect(service.refundByOrderId('order-k8', REASON)).rejects.toThrow('readback down');

    const secondClaim = occ.getData('orderCharges/c-k8')?.['refundClaim'] as Record<string, unknown>;
    expect(secondClaim['token']).not.toBe(firstClaim['token']);
    expect(secondClaim['providerKey']).toBe(firstKey);
    expect(portone.refund).toHaveBeenCalledTimes(1);
  });

  it('I9. stale ownership loser issues POST 0', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-k9', 'order-k9');
    const portone = {
      refund: jest
        .fn()
        .mockRejectedValueOnce(new Error('provider timeout'))
        .mockResolvedValue(undefined),
      getPayment: jest.fn().mockImplementation(async () => {
        occ.updateOutsideTransaction('orderCharges/c-k9', {
          refundClaim: {
            token: 'foreign-steal',
            owner: 'order-charge-refund',
            status: 'UNKNOWN',
            expiresAt: Date.now() + 300000,
          },
        });
        return paidReadback('order-charge-c-k9');
      }),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-k9', REASON)).rejects.toThrow('provider timeout');
    await service.refundByOrderId('order-k9', REASON);

    expect(portone.getPayment).toHaveBeenCalledTimes(1);
    expect(portone.refund).toHaveBeenCalledTimes(1);
  });

  it('I10. two distinct charge refund operations use distinct provider keys', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-k10a', 'order-k10a');
    seedPaidCharge(occ, 'c-k10b', 'order-k10b');
    const portone = { refund: jest.fn().mockResolvedValue(undefined), getPayment: jest.fn() };
    const { service } = makeService(occ, portone);

    await service.refundByOrderId('order-k10a', REASON);
    await service.refundByOrderId('order-k10b', REASON);

    const keyA = portone.refund.mock.calls[0][3];
    const keyB = portone.refund.mock.calls[1][3];
    expectStableKeyShape(keyA, 'order-charge-c-k10a');
    expectStableKeyShape(keyB, 'order-charge-c-k10b');
    expect(keyA).not.toBe(keyB);
  });

  it('I12. IDEMPOTENCY_OUTSTANDING_REQUEST keeps UNKNOWN: no blind release, no new-key POST', async () => {
    const occ = createOccFirestore();
    seedPaidCharge(occ, 'c-k12', 'order-k12');
    const outstanding = new PortoneError(
      409,
      'IDEMPOTENCY_OUTSTANDING_REQUEST',
      'idempotency outstanding request',
    );
    const portone = {
      refund: jest.fn().mockRejectedValueOnce(outstanding).mockResolvedValue(undefined),
      getPayment: jest.fn().mockResolvedValue(paidReadback('order-charge-c-k12')),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-k12', REASON)).rejects.toMatchObject({
      status: 409,
      type: 'IDEMPOTENCY_OUTSTANDING_REQUEST',
    });
    const firstKey = portone.refund.mock.calls[0][3];
    expectStableKeyShape(firstKey, 'order-charge-c-k12');
    expect(occ.getData('orderCharges/c-k12')).toMatchObject({
      status: 'PAID',
      refundClaim: expect.objectContaining({ status: 'UNKNOWN', providerKey: firstKey }),
    });

    await service.refundByOrderId('order-k12', REASON);

    expect(portone.getPayment).toHaveBeenCalledTimes(1);
    expect(portone.refund).toHaveBeenCalledTimes(2);
    expect(portone.refund.mock.calls[1][3]).toBe(firstKey);
    expect(occ.getData('orderCharges/c-k12')).toMatchObject({
      status: 'REFUNDED',
      refundClaim: null,
    });
  });
});
