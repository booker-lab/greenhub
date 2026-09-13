import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import { OperationIssueWriterService } from '../operations/operation-issue-writer.service';
import {
  isCurrentRedeliveryChargeLinked,
  isCurrentRedeliveryPaymentRequired,
} from '../orders/redelivery-resume-gate';
import { PortoneClient } from './portone.client';

type PaymentData = Awaited<ReturnType<PortoneClient['getPayment']>>;

const PAYMENT_ID_PREFIX = 'order-charge-';
const REFUND_CLAIM_MS = 5 * 60 * 1000;
const REFUND_OWNER = 'order-charge-refund';

type ChargeRefundClaimStatus = 'CLAIMED' | 'UNKNOWN';

type ChargeRefundPayload = {
  chargeId: string;
  orderId: string;
  portonePaymentId: string;
  amount: number;
};

type ChargeRefundClaimOutcome =
  | { outcome: 'claimed_fresh'; token: string; payload: ChargeRefundPayload }
  | { outcome: 'claimed_retry'; token: string; payload: ChargeRefundPayload }
  | { outcome: 'already_handled' }
  | { outcome: 'doc_missing' };

@Injectable()
export class OrderChargePaymentService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly portone: PortoneClient,
    @Optional() private readonly issueWriter?: OperationIssueWriterService,
  ) {}

  isOrderChargePaymentId(paymentId: string) {
    return paymentId.startsWith(PAYMENT_ID_PREFIX);
  }

  async handleWebhook(type: string, paymentId: string) {
    const chargeId = this.chargeIdFromPaymentId(paymentId);
    if (type === 'Transaction.Ready') {
      return { ok: true, reason: 'transaction_ready_ignored' };
    }
    if (type !== 'Transaction.Paid') {
      return this.markFailed(chargeId, paymentId);
    }

    const paymentData = await this.portone.getPayment(paymentId);
    return this.finalizePaid(chargeId, paymentId, paymentData);
  }

  async refundByOrderId(orderId: string, reason: string) {
    const snap = await this.firestore
      .collection('orderCharges')
      .where('orderId', '==', orderId)
      .where('status', '==', 'PAID')
      .get();
    await Promise.all(snap.docs.map((doc) => this.refundCharge(doc.ref, reason)));
  }

  private async finalizePaid(chargeId: string, paymentId: string, paymentData: PaymentData) {
    // Retry purity: the post-transaction decision must come only from the
    // committed attempt's return value. An outer `let result` would leak an
    // aborted attempt's decision across OCC retry.
    const result: Record<string, unknown> =
      await this.firestore.runTransaction(async (tx) => {
        const chargeRef = this.firestore.doc(`orderCharges/${chargeId}`);
        const chargeSnap = await tx.get(chargeRef);
        if (!chargeSnap.exists) return { ok: false, reason: 'charge_not_found' };
        const charge = chargeSnap.data() as Record<string, any>;
        if (charge['status'] === 'PAID') {
          return { ok: true, reason: 'already_processed' };
        }
        if (
          charge['status'] !== 'PENDING' ||
          charge['type'] !== 'REDELIVERY_FEE' ||
          charge['portonePaymentId'] !== paymentId ||
          paymentData.status !== 'PAID' ||
          paymentData.amount.total !== charge['amount']
        ) {
          throw new BadRequestException('재배송비 결제 정보가 일치하지 않습니다.');
        }

        const orderSnap = await tx.get(this.firestore.doc(`orders/${charge['orderId']}`));
        const order = orderSnap.data() as Record<string, any> | undefined;
        if (
          !orderSnap.exists ||
          !isCurrentRedeliveryPaymentRequired({ ...order, id: charge['orderId'] }) ||
          !isCurrentRedeliveryChargeLinked(
            { ...order, id: charge['orderId'] },
            charge,
            chargeId,
          )
        ) {
          throw new BadRequestException('재배송비 결제 정보가 일치하지 않습니다.');
        }
        const now = this.firestore.Timestamp.now();
        tx.update(chargeRef, {
          status: 'PAID',
          portoneTransactionId: paymentData.transactionId,
          payMethod: paymentData.method?.type ?? null,
          paidAt: now,
          failedAt: null,
          updatedAt: now,
        });
        return { ok: true, status: 'PAID' };
      });
    return result;
  }

  private async markFailed(chargeId: string, paymentId: string) {
    // Retry purity: the post-transaction decision must come only from the
    // committed attempt's return value. An outer `let result` would leak an
    // aborted attempt's decision across OCC retry.
    const result: Record<string, unknown> =
      await this.firestore.runTransaction(async (tx) => {
        const chargeRef = this.firestore.doc(`orderCharges/${chargeId}`);
        const chargeSnap = await tx.get(chargeRef);
        if (!chargeSnap.exists) return { ok: false, reason: 'charge_not_found' };
        const charge = chargeSnap.data() as Record<string, any>;
        if (charge['portonePaymentId'] !== paymentId) {
          throw new BadRequestException('재배송비 결제 정보가 일치하지 않습니다.');
        }
        if (charge['status'] !== 'PENDING') {
          return { ok: true, reason: 'already_processed' };
        }
        const now = this.firestore.Timestamp.now();
        tx.update(chargeRef, { status: 'FAILED', failedAt: now, updatedAt: now });
        return { ok: true, status: 'FAILED' };
      });
    return result;
  }

  private async refundCharge(chargeRef: any, reason: string) {
    const token = randomUUID();
    // Retry purity: only the committed attempt's return value may authorize
    // the provider refund. An outer `let claimed` would leak an aborted
    // attempt's decision across OCC retry. See
    // PAYMENT-REFUND-OCC-RETRY-PURITY-CLOSURE-01.
    const claimResult: ChargeRefundClaimOutcome = await this.firestore.runTransaction(
      async (tx): Promise<ChargeRefundClaimOutcome> => {
        const snap: any = await tx.get(chargeRef);
        if (!snap.exists) return { outcome: 'doc_missing' };
        const charge = snap.data() as Record<string, any>;
        if (charge['status'] === 'REFUNDED' || charge['refundedAt']) {
          return { outcome: 'already_handled' };
        }
        if (charge['status'] !== 'PAID') return { outcome: 'already_handled' };
        const marker = this.readRefundMarker(charge);
        const now = this.firestore.Timestamp.now();
        if (!marker) {
          tx.update(chargeRef, {
            refundClaim: {
              token,
              owner: REFUND_OWNER,
              status: 'CLAIMED' satisfies ChargeRefundClaimStatus,
              expiresAt: Date.now() + REFUND_CLAIM_MS,
              updatedAt: now,
            },
            updatedAt: now,
          });
          // Immutable payload for the external side effect.
          return {
            outcome: 'claimed_fresh',
            token,
            payload: {
              chargeId: String(charge['id'] ?? chargeRef.id ?? chargeRef.path ?? ''),
              orderId: String(charge['orderId'] ?? ''),
              portonePaymentId: charge['portonePaymentId'],
              amount: charge['amount'],
            },
          };
        }
        if (marker.owner !== REFUND_OWNER) return { outcome: 'already_handled' };
        if (marker.status === 'CLAIMED' && marker.expiresAt > Date.now()) {
          return { outcome: 'already_handled' };
        }
        // Expired CLAIMED or any UNKNOWN: a prior attempt may already have
        // reached the provider. Take over as uncertain so a getPayment
        // readback is mandatory before any refund POST.
        tx.update(chargeRef, {
          refundClaim: {
            token,
            owner: REFUND_OWNER,
            status: 'UNKNOWN' satisfies ChargeRefundClaimStatus,
            expiresAt: Date.now() + REFUND_CLAIM_MS,
            updatedAt: now,
          },
          updatedAt: now,
        });
        return {
          outcome: 'claimed_retry',
          token,
          payload: {
            chargeId: String(charge['id'] ?? chargeRef.id ?? chargeRef.path ?? ''),
            orderId: String(charge['orderId'] ?? ''),
            portonePaymentId: charge['portonePaymentId'],
            amount: charge['amount'],
          },
        };
      },
    );
    if (claimResult.outcome === 'already_handled' || claimResult.outcome === 'doc_missing') {
      return;
    }

    const charge = claimResult.payload;
    const claimToken = claimResult.token;
    if (claimResult.outcome === 'claimed_retry') {
      const reconciled = await this.reconcileUncertainRefund(chargeRef, charge, reason, claimToken);
      if (reconciled !== 'proceed') return;
    }

    try {
      await this.portone.refund(charge.portonePaymentId, charge.amount, reason);
    } catch (error) {
      // Provider result UNKNOWN: never blind-release; persist uncertainty and
      // fail closed so the next attempt must read back provider state first.
      await this.persistUncertainRefund(chargeRef, charge, claimToken, 'provider_refund');
      throw error;
    }
    try {
      await this.completeRefund(chargeRef, claimToken, reason);
    } catch (error) {
      // Provider POST already started; local persistence failure leaves the
      // outcome uncertain. Never blind-release.
      await this.persistUncertainRefund(chargeRef, charge, claimToken, 'local_completion');
      throw error;
    }
  }

  /**
   * UNKNOWN retry must reconcile via provider readback before any refund POST.
   * Terminal CANCELLED converges locally with zero additional POST.
   * Still-PAID proceeds only after a fresh ownership recheck.
   * Anything else fails closed with zero POST.
   */
  private async reconcileUncertainRefund(
    chargeRef: any,
    charge: ChargeRefundPayload,
    reason: string,
    token: string,
  ): Promise<'proceed' | 'already_handled'> {
    let providerState: Record<string, any>;
    try {
      providerState = (await this.portone.getPayment(charge.portonePaymentId)) as Record<
        string,
        any
      >;
    } catch (error) {
      await this.persistUncertainRefund(chargeRef, charge, token, 'provider_readback');
      throw error;
    }
    if (providerState?.['status'] === 'CANCELLED') {
      // Provider already terminal: converge locally, never re-POST.
      await this.completeRefund(chargeRef, token, reason);
      return 'already_handled';
    }
    const providerTotal = (providerState?.['amount'] as { total?: unknown } | undefined)?.[
      'total'
    ];
    const providerId = providerState?.['id'];
    if (
      providerState?.['status'] !== 'PAID' ||
      providerTotal !== charge.amount ||
      (providerId !== undefined && providerId !== charge.portonePaymentId)
    ) {
      const error = new Error('PortOne 결제 상태를 확정할 수 없어 환불을 중단합니다.');
      await this.persistUncertainRefund(chargeRef, charge, token, 'provider_readback');
      throw error;
    }
    // Fresh ownership recheck: only the current token holder may POST.
    const stillOwner: boolean = await this.firestore.runTransaction(async (tx) => {
      const snap: any = await tx.get(chargeRef);
      if (!snap.exists) return false;
      const marker = this.readRefundMarker(snap.data() as Record<string, any>);
      return marker?.token === token && marker?.owner === REFUND_OWNER;
    });
    if (!stillOwner) return 'already_handled';
    return 'proceed';
  }

  private async completeRefund(chargeRef: any, token: string, reason: string) {
    await this.firestore.runTransaction(async (tx) => {
      const snap: any = await tx.get(chargeRef);
      if (this.readRefundMarker(snap.data() as Record<string, any>)?.token !== token) return;
      // Ownership re-verified inside the committing transaction; a stale
      // token (loser) writes nothing and authorizes no side effect.
      if ((snap.data() as Record<string, any>)?.['refundClaim']?.['token'] !== token) return;
      const now = this.firestore.Timestamp.now();
      tx.update(chargeRef, {
        status: 'REFUNDED',
        refundedAt: now,
        refundReason: reason,
        refundClaim: null,
        updatedAt: now,
      });
    });
  }

  private async persistUncertainRefund(
    chargeRef: any,
    charge: ChargeRefundPayload,
    token: string,
    failureStage: 'provider_refund' | 'provider_readback' | 'local_completion',
  ): Promise<void> {
    const now = this.firestore.Timestamp.now();
    await this.firestore.runTransaction(async (tx) => {
      const snap: any = await tx.get(chargeRef);
      if (!snap.exists) return;
      const marker = this.readRefundMarker(snap.data() as Record<string, any>);
      if (marker?.token !== token) return;
      tx.update(chargeRef, {
        refundClaim: {
          token,
          owner: REFUND_OWNER,
          status: 'UNKNOWN' satisfies ChargeRefundClaimStatus,
          expiresAt: Date.now() + REFUND_CLAIM_MS,
          updatedAt: now,
        },
        updatedAt: now,
      });
    });
    if (!this.issueWriter) return;
    await this.issueWriter.createOrMergeIssue({
      storeId: '',
      orderId: charge.orderId,
      paymentId: charge.chargeId,
      type: 'AUTO_REFUND_FAILED',
      severity: 'critical',
      title: '재배송비 환불 결과 불명확',
      message: '재배송비 환불 요청 결과를 확정하지 못해 blind 재시도 없이 운영 확인이 필요합니다.',
      idempotencyKey: `auto-charge-refund-failed:${charge.orderId}:${charge.chargeId}`,
      latestSnapshot: {
        chargeStatus: 'UNKNOWN',
        failureStage,
      },
    });
  }

  private readRefundMarker(charge: Record<string, any>): {
    token: string;
    owner: string;
    status: ChargeRefundClaimStatus;
    expiresAt: number;
  } | null {
    const marker = charge['refundClaim'] as Record<string, any> | null | undefined;
    if (!marker || typeof marker !== 'object') return null;
    if (typeof marker['token'] !== 'string' || marker['token'].length === 0) return null;
    const status: ChargeRefundClaimStatus =
      marker['status'] === 'UNKNOWN' ? 'UNKNOWN' : 'CLAIMED';
    const owner = typeof marker['owner'] === 'string' ? marker['owner'] : REFUND_OWNER;
    const expiresAt = typeof marker['expiresAt'] === 'number' ? marker['expiresAt'] : 0;
    return { token: marker['token'], owner, status, expiresAt };
  }

  private chargeIdFromPaymentId(paymentId: string) {
    if (!this.isOrderChargePaymentId(paymentId)) {
      throw new BadRequestException('재배송비 결제 식별자가 올바르지 않습니다.');
    }
    return paymentId.slice(PAYMENT_ID_PREFIX.length);
  }
}
