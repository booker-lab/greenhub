// PILOT-REFUND-PROVIDER-IDEMPOTENCY-BINDING-28B focused proofs.
// PaymentRefundService: I1-I10 + I12 (I11 lives in portone.client-idempotency.spec.ts).
//
// Invariant under proof:
// "The first POST of one Greenhub refund operation and every retry POST after
// UNKNOWN must reach PortOne with the SAME Idempotency-Key, so the provider
// treats them as one refund operation."
//
// - Local ownership token and provider idempotency identity are separate:
//   UNKNOWN takeover may reissue the token but must preserve the key.
// - Real provider is never used; PortOne is fully mocked.

import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { PaymentRefundService } from './payment-refund.service';
import { PortoneError } from './portone.client';

type Occ = ReturnType<typeof createOccFirestore>;

const NAMESPACE = 'payment-refund';
const REASON = '고객 요청';

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

function expectStableKeyShape(key: unknown, ownPortonePaymentId: string) {
  expect(typeof key).toBe('string');
  const value = key as string;
  expect(value.length).toBeGreaterThanOrEqual(16);
  expect(value.length).toBeLessThanOrEqual(256);
  expect(value).toMatch(/^[\x21-\x7E]+$/);
  expect(value.startsWith(`ghr-${NAMESPACE}-`)).toBe(true);
  // No secret/PII: the raw user reason, the provider payment id, and the
  // seeded user/store ids must never leak into the key.
  expect(value).not.toContain(REASON);
  expect(value).not.toContain(ownPortonePaymentId);
  expect(value).not.toContain('user-1');
  expect(value).not.toContain('store-1');
}

function paidReadback(providerPaymentId: string) {
  return {
    id: providerPaymentId,
    transactionId: 'tx-1',
    amount: { total: 100000 },
    status: 'PAID',
    method: { type: 'CARD' },
  };
}

function cancelledReadback(providerPaymentId: string) {
  return {
    id: providerPaymentId,
    transactionId: 'tx-1',
    amount: { total: 100000 },
    status: 'CANCELLED',
    method: { type: 'CARD' },
  };
}

describe('PaymentRefund provider idempotency binding 28B', () => {
  it('I1. fresh refund: POST 1 with a namespaced Idempotency-Key', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-k1', 'order-k1');
    const portone = { refund: jest.fn().mockResolvedValue(undefined), getPayment: jest.fn() };
    const { service } = makeService(occ, portone);

    await service.refundByOrderId('order-k1', '고객 요청');

    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(portone.refund).toHaveBeenCalledWith(
      'portone-order-k1',
      100000,
      '고객 요청',
      expect.any(String),
    );
    expectStableKeyShape(portone.refund.mock.calls[0][3], 'portone-order-k1');
  });

  it('I2. POST timeout stores UNKNOWN; retry preserves the same key with POST 0 on readback failure', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-k2', 'order-k2');
    const portone = {
      refund: jest.fn().mockRejectedValueOnce(new Error('provider timeout')),
      getPayment: jest.fn().mockRejectedValue(new Error('readback down')),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-k2', REASON)).rejects.toThrow('provider timeout');
    const firstKey = portone.refund.mock.calls[0][3];
    expectStableKeyShape(firstKey, 'portone-order-k2');

    await expect(service.refundByOrderId('order-k2', REASON)).rejects.toThrow('readback down');
    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('payments/pay-k2')).toMatchObject({
      status: 'PAID',
      refundClaim: expect.objectContaining({ status: 'UNKNOWN', providerKey: firstKey }),
    });
  });

  it('I3. POST success + local completion throw stores UNKNOWN; PAID retry reuses the same key', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-k3', 'order-k3');
    const portone = {
      refund: jest.fn().mockResolvedValue(undefined),
      getPayment: jest.fn().mockResolvedValue(paidReadback('portone-order-k3')),
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

    await expect(service.refundByOrderId('order-k3', REASON)).rejects.toThrow('local commit failed');
    const firstKey = portone.refund.mock.calls[0][3];
    expectStableKeyShape(firstKey, 'portone-order-k3');
    expect(occ.getData('payments/pay-k3')).toMatchObject({
      refundClaim: expect.objectContaining({ status: 'UNKNOWN', providerKey: firstKey }),
    });

    await service.refundByOrderId('order-k3', REASON);

    expect(portone.refund).toHaveBeenCalledTimes(2);
    expect(portone.refund.mock.calls[1][3]).toBe(firstKey);
    expect(occ.getData('payments/pay-k3')).toMatchObject({
      status: 'CANCELLED',
      refundClaim: null,
    });
  });

  it('I4. UNKNOWN readback CANCELLED converges locally with zero additional POST', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-k4', 'order-k4');
    const portone = {
      refund: jest
        .fn()
        .mockRejectedValueOnce(new Error('provider timeout'))
        .mockResolvedValue(undefined),
      getPayment: jest.fn().mockResolvedValue(cancelledReadback('portone-order-k4')),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-k4', REASON)).rejects.toThrow('provider timeout');
    await service.refundByOrderId('order-k4', REASON);

    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData('payments/pay-k4')).toMatchObject({
      status: 'CANCELLED',
      refundClaim: null,
    });
  });

  it('I5. UNKNOWN readback PAID retries with the same key: one logical provider operation', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-k5', 'order-k5');
    const portone = {
      refund: jest
        .fn()
        .mockRejectedValueOnce(new Error('provider timeout'))
        .mockResolvedValue(undefined),
      getPayment: jest.fn().mockResolvedValue(paidReadback('portone-order-k5')),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-k5', REASON)).rejects.toThrow('provider timeout');
    const firstKey = portone.refund.mock.calls[0][3];

    await service.refundByOrderId('order-k5', REASON);

    expect(portone.getPayment).toHaveBeenCalledTimes(1);
    expect(portone.refund).toHaveBeenCalledTimes(2);
    expect(portone.refund.mock.calls[1][3]).toBe(firstKey);
    expect(occ.getData('payments/pay-k5')).toMatchObject({
      status: 'CANCELLED',
      refundClaim: null,
    });
  });

  it.each(['PENDING', 'FAILED', 'SOME_FUTURE_STATUS'])(
    'I6. UNKNOWN readback %s fails closed with POST 0',
    async (status) => {
      const occ = createOccFirestore();
      seedPaid(occ, 'payments/pay-k6', 'order-k6');
      const portone = {
        refund: jest.fn().mockRejectedValueOnce(new Error('provider timeout')),
        getPayment: jest.fn().mockResolvedValue({
          id: 'portone-order-k6',
          transactionId: 'tx-1',
          amount: { total: 100000 },
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
      expect(occ.getData('payments/pay-k6')).toMatchObject({
        status: 'PAID',
        refundClaim: expect.objectContaining({ status: 'UNKNOWN', providerKey: firstKey }),
      });
    },
  );

  it('I7. readback throw keeps UNKNOWN with POST 0', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-k7', 'order-k7');
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
    expect(occ.getData('payments/pay-k7')).toMatchObject({
      status: 'PAID',
      refundClaim: expect.objectContaining({ status: 'UNKNOWN', providerKey: firstKey }),
    });
  });

  it('I8. UNKNOWN takeover may rotate the local token but never the provider key', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-k8', 'order-k8');
    const portone = {
      refund: jest.fn().mockRejectedValueOnce(new Error('provider timeout')),
      getPayment: jest.fn().mockRejectedValue(new Error('readback down')),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-k8', REASON)).rejects.toThrow('provider timeout');
    const firstClaim = occ.getData('payments/pay-k8')?.['refundClaim'] as Record<string, unknown>;
    const firstKey = portone.refund.mock.calls[0][3];
    expect(firstClaim['providerKey']).toBe(firstKey);

    await expect(service.refundByOrderId('order-k8', REASON)).rejects.toThrow('readback down');

    const secondClaim = occ.getData('payments/pay-k8')?.['refundClaim'] as Record<string, unknown>;
    // Takeover reissued the local token...
    expect(secondClaim['token']).not.toBe(firstClaim['token']);
    // ...but the provider operation identity is unchanged.
    expect(secondClaim['providerKey']).toBe(firstKey);
    expect(portone.refund).toHaveBeenCalledTimes(1);
  });

  it('I9. stale ownership loser issues POST 0', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-k9', 'order-k9');
    const portone = {
      refund: jest
        .fn()
        .mockRejectedValueOnce(new Error('provider timeout'))
        .mockResolvedValue(undefined),
      getPayment: jest.fn().mockImplementation(async () => {
        occ.updateOutsideTransaction('payments/pay-k9', {
          refundClaim: {
            token: 'foreign-steal',
            owner: 'payment-refund',
            status: 'UNKNOWN',
            expiresAt: Date.now() + 300000,
          },
        });
        return paidReadback('portone-order-k9');
      }),
    };
    const { service } = makeService(occ, portone);

    await expect(service.refundByOrderId('order-k9', REASON)).rejects.toThrow('provider timeout');
    await service.refundByOrderId('order-k9', REASON);

    expect(portone.getPayment).toHaveBeenCalledTimes(1);
    expect(portone.refund).toHaveBeenCalledTimes(1);
  });

  it('I10. two distinct refund operations use distinct provider keys', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-k10a', 'order-k10a');
    seedPaid(occ, 'payments/pay-k10b', 'order-k10b');
    const portone = { refund: jest.fn().mockResolvedValue(undefined), getPayment: jest.fn() };
    const { service } = makeService(occ, portone);

    await service.refundByOrderId('order-k10a', REASON);
    await service.refundByOrderId('order-k10b', REASON);

    const keyA = portone.refund.mock.calls[0][3];
    const keyB = portone.refund.mock.calls[1][3];
    expectStableKeyShape(keyA, 'portone-order-k10a');
    expectStableKeyShape(keyB, 'portone-order-k10b');
    expect(keyA).not.toBe(keyB);
  });

  it('I12. IDEMPOTENCY_OUTSTANDING_REQUEST keeps UNKNOWN: no blind release, no new-key POST', async () => {
    const occ = createOccFirestore();
    seedPaid(occ, 'payments/pay-k12', 'order-k12');
    const outstanding = new PortoneError(
      409,
      'IDEMPOTENCY_OUTSTANDING_REQUEST',
      'idempotency outstanding request',
    );
    const portone = {
      refund: jest.fn().mockRejectedValueOnce(outstanding).mockResolvedValue(undefined),
      getPayment: jest.fn().mockResolvedValue(paidReadback('portone-order-k12')),
    };
    const { service } = makeService(occ, portone);

    // The 409 is reconciliation-shaped, not a terminal failure: the claim
    // must stay UNKNOWN (never blind-released to null).
    await expect(service.refundByOrderId('order-k12', REASON)).rejects.toMatchObject({
      status: 409,
      type: 'IDEMPOTENCY_OUTSTANDING_REQUEST',
    });
    const firstKey = portone.refund.mock.calls[0][3];
    expectStableKeyShape(firstKey, 'portone-order-k12');
    expect(occ.getData('payments/pay-k12')).toMatchObject({
      status: 'PAID',
      refundClaim: expect.objectContaining({ status: 'UNKNOWN', providerKey: firstKey }),
    });

    // Next cycle reconciles via readback and reuses the SAME key blindly
    // retrying with a fresh key is forbidden.
    await service.refundByOrderId('order-k12', REASON);

    expect(portone.getPayment).toHaveBeenCalledTimes(1);
    expect(portone.refund).toHaveBeenCalledTimes(2);
    expect(portone.refund.mock.calls[1][3]).toBe(firstKey);
    expect(occ.getData('payments/pay-k12')).toMatchObject({
      status: 'CANCELLED',
      refundClaim: null,
    });
  });
});
