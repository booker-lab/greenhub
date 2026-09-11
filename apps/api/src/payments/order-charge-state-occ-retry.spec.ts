// OrderCharge state retry-purity closure proofs on the canonical OCC harness.
// Task: PAYMENT-ORDER-CHARGE-STATE-OCC-RETRY-PURITY-CLOSURE-01
//
// Owned surface: OrderChargePaymentService.finalizePaid() + markFailed().
// Invariant: post-transaction return decision comes ONLY from the committed
// attempt's return value (ABORTED_ATTEMPT_DECISION_DOES_NOT_ESCAPE).
//
// Uses only the canonical harness at ../../test/helpers/firestore-occ-fake
// (per-doc versions, conflict detection, bounded retry, staged-write discard,
// beforeCommit deterministic interleaving). No real PortOne, no production
// Firestore.

import { BadRequestException } from '@nestjs/common';
import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { OrderChargePaymentService } from './order-charge-payment.service';

type Occ = ReturnType<typeof createOccFirestore>;

const HOLD_AT = '2026-08-26T00:00:00.000Z';
const FEE = 5000;

function chargeIdOf(paymentId: string): string {
  return paymentId.slice('order-charge-'.length);
}

function makeService(occ: Occ, getPayment: jest.Mock) {
  const portone = { getPayment, refund: jest.fn() } as never;
  return new OrderChargePaymentService(occ.firestore as never, portone);
}

function paidPaymentData(amountTotal: number, status = 'PAID') {
  return {
    status,
    amount: { total: amountTotal },
    method: { type: 'CARD' },
    transactionId: 'tx-1',
  } as never;
}

function seedLinkedOrder(
  occ: Occ,
  orderId: string,
  chargeId: string,
  orderOverrides: Record<string, unknown> = {},
) {
  occ.seed(`orders/${orderId}`, {
    id: orderId,
    storeId: 'store-1',
    userId: 'consumer-1',
    status: 'DELIVERY_HELD',
    deliveryHold: {
      heldAt: HOLD_AT,
      reasonCode: 'ACCESS_UNAVAILABLE',
      reasonMessage: '배송지 출입 불가',
      customerResponsible: true,
      redeliveryFee: FEE,
      nextContactAt: null,
      nextDeliveryAt: null,
      resolvedAt: null,
    },
    redeliveryChargeId: chargeId,
    redeliveryChargeHoldAt: HOLD_AT,
    ...orderOverrides,
  });
}

function seedCharge(
  occ: Occ,
  chargeId: string,
  orderId: string,
  overrides: Record<string, unknown> = {},
) {
  occ.seed(`orderCharges/${chargeId}`, {
    id: chargeId,
    orderId,
    storeId: 'store-1',
    userId: 'consumer-1',
    type: 'REDELIVERY_FEE',
    status: 'PENDING',
    amount: FEE,
    customerResponsible: true,
    holdAt: HOLD_AT,
    portonePaymentId: `order-charge-${chargeId}`,
    ...overrides,
  });
}

function seedLinkedPending(occ: Occ, chargeId: string, orderId: string) {
  seedLinkedOrder(occ, orderId, chargeId);
  seedCharge(occ, chargeId, orderId);
}

describe('OrderCharge state OCC retry purity', () => {
  describe('finalizePaid', () => {
    it('1. charge missing returns committed charge_not_found', async () => {
      const occ = createOccFirestore();
      const getPayment = jest.fn().mockResolvedValue(paidPaymentData(FEE));
      const service = makeService(occ, getPayment);

      await expect(
        service.handleWebhook('Transaction.Paid', 'order-charge-missing-1'),
      ).resolves.toEqual({ ok: false, reason: 'charge_not_found' });
      expect(getPayment).toHaveBeenCalledTimes(1);
      expect(occ.getData('orderCharges/missing-1')).toBeUndefined();
    });

    it('2. already PAID returns already_processed without rewrite', async () => {
      const occ = createOccFirestore();
      seedLinkedPending(occ, 'c-paid-1', 'order-paid-1');
      occ.updateOutsideTransaction('orderCharges/c-paid-1', { status: 'PAID' });
      const getPayment = jest.fn().mockResolvedValue(paidPaymentData(FEE));
      const service = makeService(occ, getPayment);

      await expect(
        service.handleWebhook('Transaction.Paid', 'order-charge-c-paid-1'),
      ).resolves.toEqual({ ok: true, reason: 'already_processed' });
      expect(occ.getData('orderCharges/c-paid-1')).toMatchObject({ status: 'PAID' });
    });

    it.each([
      ['wrong status', { status: 'FAILED' }],
      ['wrong type', { type: 'OTHER' }],
      ['wrong paymentId', { portonePaymentId: 'order-charge-other' }],
    ])('3a. charge %s keeps BadRequestException', async (_label, overrides) => {
      const occ = createOccFirestore();
      seedLinkedPending(occ, 'c-mm-1', 'order-mm-1');
      occ.updateOutsideTransaction('orderCharges/c-mm-1', overrides);
      const getPayment = jest.fn().mockResolvedValue(paidPaymentData(FEE));
      const service = makeService(occ, getPayment);

      await expect(
        service.handleWebhook('Transaction.Paid', 'order-charge-c-mm-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(occ.getData('orderCharges/c-mm-1')).toMatchObject({ status: (overrides as Record<string, unknown>)['status'] ?? 'PENDING' });
    });

    it.each([
      ['provider not PAID', paidPaymentData(FEE, 'FAILED')],
      ['amount mismatch', paidPaymentData(1)],
    ])('3b. payment %s keeps BadRequestException', async (_label, paymentData) => {
      const occ = createOccFirestore();
      seedLinkedPending(occ, 'c-pm-1', 'order-pm-1');
      const getPayment = jest.fn().mockResolvedValue(paymentData);
      const service = makeService(occ, getPayment);

      await expect(
        service.handleWebhook('Transaction.Paid', 'order-charge-c-pm-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(occ.getData('orderCharges/c-pm-1')).toMatchObject({ status: 'PENDING' });
    });

    it('4a. order missing keeps BadRequestException', async () => {
      const occ = createOccFirestore();
      seedCharge(occ, 'c-no-order-1', 'order-no-order-1');
      const getPayment = jest.fn().mockResolvedValue(paidPaymentData(FEE));
      const service = makeService(occ, getPayment);

      await expect(
        service.handleWebhook('Transaction.Paid', 'order-charge-c-no-order-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(occ.getData('orderCharges/c-no-order-1')).toMatchObject({ status: 'PENDING' });
    });

    it('4b. linkage mismatch keeps BadRequestException', async () => {
      const occ = createOccFirestore();
      seedLinkedPending(occ, 'c-link-1', 'order-link-1');
      occ.updateOutsideTransaction('orders/order-link-1', { redeliveryChargeId: 'other' });
      const getPayment = jest.fn().mockResolvedValue(paidPaymentData(FEE));
      const service = makeService(occ, getPayment);

      await expect(
        service.handleWebhook('Transaction.Paid', 'order-charge-c-link-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(occ.getData('orderCharges/c-link-1')).toMatchObject({ status: 'PENDING' });
    });

    it('5. normal PENDING commits PAID and returns PAID', async () => {
      const occ = createOccFirestore();
      seedLinkedPending(occ, 'c-ok-1', 'order-ok-1');
      const getPayment = jest.fn().mockResolvedValue(paidPaymentData(FEE));
      const service = makeService(occ, getPayment);

      await expect(
        service.handleWebhook('Transaction.Paid', 'order-charge-c-ok-1'),
      ).resolves.toEqual({ ok: true, status: 'PAID' });
      expect(occ.getData('orderCharges/c-ok-1')).toMatchObject({
        status: 'PAID',
        portoneTransactionId: 'tx-1',
        payMethod: 'CARD',
      });
      expect(occ.getData('orderCharges/c-ok-1')?.['paidAt']).toBeDefined();
    });

    it('6. aborted PAID attempt must not escape: committed missing wins', async () => {
      const occ = createOccFirestore();
      const chargeId = 'c-retry-1';
      const orderId = 'order-retry-1';
      seedLinkedPending(occ, chargeId, orderId);
      const getPayment = jest.fn().mockResolvedValue(paidPaymentData(FEE));
      const service = makeService(occ, getPayment);

      const commits: Array<{ writeCount: number }> = [];
      const arm = (): void => {
        occ.setBeforeCommit((ctx) => {
          commits.push({ writeCount: ctx.writes.length });
          if (commits.length === 1) {
            // Attempt 1 staged PAID (1 write). Delete the charge before its
            // commit validation so attempt 1 aborts and the retry observes a
            // missing document. Old outer-`let result` code would leak the
            // aborted PAID decision because the missing branch never
            // overwrote it.
            occ.deleteOutsideTransaction(`orderCharges/${chargeId}`);
          }
          arm();
        });
      };
      arm();

      await expect(
        service.handleWebhook('Transaction.Paid', `order-charge-${chargeId}`),
      ).resolves.toEqual({ ok: false, reason: 'charge_not_found' });
      occ.clearHooks();

      expect(commits).toHaveLength(2);
      expect(commits[0].writeCount).toBe(1);
      expect(commits[1].writeCount).toBe(0);
      expect(occ.getData(`orderCharges/${chargeId}`)).toBeUndefined();
      expect(chargeIdOf(`order-charge-${chargeId}`)).toBe(chargeId);
    });
  });

  describe('markFailed', () => {
    it('1. charge missing returns charge_not_found', async () => {
      const occ = createOccFirestore();
      const service = makeService(occ, jest.fn());

      await expect(
        service.handleWebhook('Transaction.Failed', 'order-charge-missing-2'),
      ).resolves.toEqual({ ok: false, reason: 'charge_not_found' });
    });

    it('2. paymentId mismatch keeps BadRequestException', async () => {
      const occ = createOccFirestore();
      seedCharge(occ, 'c-mis-1', 'order-mis-1', {
        portonePaymentId: 'order-charge-other',
      });
      const service = makeService(occ, jest.fn());

      await expect(
        service.handleWebhook('Transaction.Failed', 'order-charge-c-mis-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each(['PAID', 'FAILED'] as const)(
      '3. status %s returns already_processed',
      async (status) => {
        const occ = createOccFirestore();
        seedCharge(occ, 'c-done-2', 'order-done-2', { status });
        const service = makeService(occ, jest.fn());

        await expect(
          service.handleWebhook('Transaction.Failed', 'order-charge-c-done-2'),
        ).resolves.toEqual({ ok: true, reason: 'already_processed' });
        expect(occ.getData('orderCharges/c-done-2')).toMatchObject({ status });
      },
    );

    it('4. normal PENDING commits FAILED and returns FAILED', async () => {
      const occ = createOccFirestore();
      seedCharge(occ, 'c-fail-ok-1', 'order-fail-ok-1');
      const service = makeService(occ, jest.fn());

      await expect(
        service.handleWebhook('Transaction.Failed', 'order-charge-c-fail-ok-1'),
      ).resolves.toEqual({ ok: true, status: 'FAILED' });
      expect(occ.getData('orderCharges/c-fail-ok-1')).toMatchObject({ status: 'FAILED' });
      expect(occ.getData('orderCharges/c-fail-ok-1')?.['failedAt']).toBeDefined();
    });

    it('5. aborted FAILED attempt must not escape: committed missing wins', async () => {
      const occ = createOccFirestore();
      const chargeId = 'c-fail-retry-1';
      seedCharge(occ, chargeId, 'order-fail-retry-1');
      const service = makeService(occ, jest.fn());

      const commits: Array<{ writeCount: number }> = [];
      const arm = (): void => {
        occ.setBeforeCommit((ctx) => {
          commits.push({ writeCount: ctx.writes.length });
          if (commits.length === 1) {
            // Attempt 1 staged FAILED (1 write). Delete before validation so
            // it aborts; the retry observes missing. Old outer-`let result`
            // code leaked the aborted FAILED decision here.
            occ.deleteOutsideTransaction(`orderCharges/${chargeId}`);
          }
          arm();
        });
      };
      arm();

      await expect(
        service.handleWebhook('Transaction.Failed', `order-charge-${chargeId}`),
      ).resolves.toEqual({ ok: false, reason: 'charge_not_found' });
      occ.clearHooks();

      expect(commits).toHaveLength(2);
      expect(commits[0].writeCount).toBe(1);
      expect(commits[1].writeCount).toBe(0);
      expect(occ.getData(`orderCharges/${chargeId}`)).toBeUndefined();
    });
  });
});
