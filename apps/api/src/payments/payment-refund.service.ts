import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import { OperationIssueWriterService } from '../operations/operation-issue-writer.service';
import { RetentionService } from '../retention/retention.service';
import { PortoneClient } from './portone.client';

const REFUND_CLAIM_MS = 5 * 60 * 1000;
const REFUND_OWNER = 'payment-refund';

type RefundClaimStatus = 'CLAIMED' | 'UNKNOWN';

type RefundPayload = {
  id: unknown;
  portonePaymentId: string;
  amount: number;
  storeId: unknown;
  userId: unknown;
  status: unknown;
};

type RefundClaimOutcome =
  | { outcome: 'claimed_fresh'; token: string; payload: RefundPayload }
  | { outcome: 'claimed_retry'; token: string; payload: RefundPayload }
  | { outcome: 'already_handled' }
  | { outcome: 'doc_missing' };

@Injectable()
export class PaymentRefundService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly portone: PortoneClient,
    private readonly issueWriter: OperationIssueWriterService,
    private readonly retention: RetentionService,
  ) {}

  async refundByOrderId(orderId: string, reason: string): Promise<void> {
    const paymentSnap = await this.firestore
      .collection('payments')
      .where('orderId', '==', orderId)
      .limit(1)
      .get();
    if (paymentSnap.empty) return;

    const paymentRef = paymentSnap.docs[0].ref;
    const token = randomUUID();

    // Retry purity: the claim decision must come from the committed attempt's
    // return value only. An outer `let claimed` mutated inside the callback
    // would leak an aborted attempt's decision and authorize a duplicate
    // provider refund after retry. See PAYMENT-REFUND-OCC-RETRY-PURITY-CLOSURE-01.
    const claimResult: RefundClaimOutcome = await this.firestore.runTransaction(
      async (tx): Promise<RefundClaimOutcome> => {
        const freshSnap = await tx.get(paymentRef);
        if (!freshSnap.exists) return { outcome: 'doc_missing' };
        const payment = freshSnap.data() as Record<string, any>;
        if (payment['status'] === 'CANCELLED' || payment['refundedAt']) {
          return { outcome: 'already_handled' };
        }
        if (payment['status'] !== 'PAID') return { outcome: 'already_handled' };
        const marker = this.readRefundMarker(payment);
        const now = this.firestore.Timestamp.now();
        if (!marker) {
          tx.update(paymentRef, {
            refundClaim: {
              token,
              owner: REFUND_OWNER,
              status: 'CLAIMED' satisfies RefundClaimStatus,
              expiresAt: Date.now() + REFUND_CLAIM_MS,
              updatedAt: now,
            },
            updatedAt: now,
          });
          // Immutable payload for the external side effect. A fresh copy, never
          // the live snapshot object, so a later retry cannot mutate it.
          return {
            outcome: 'claimed_fresh',
            token,
            payload: {
              id: payment['id'],
              portonePaymentId: payment['portonePaymentId'],
              amount: payment['amount'],
              storeId: payment['storeId'],
              userId: payment['userId'],
              status: payment['status'],
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
        tx.update(paymentRef, {
          refundClaim: {
            token,
            owner: REFUND_OWNER,
            status: 'UNKNOWN' satisfies RefundClaimStatus,
            expiresAt: Date.now() + REFUND_CLAIM_MS,
            updatedAt: now,
          },
          updatedAt: now,
        });
        return {
          outcome: 'claimed_retry',
          token,
          payload: {
            id: payment['id'],
            portonePaymentId: payment['portonePaymentId'],
            amount: payment['amount'],
            storeId: payment['storeId'],
            userId: payment['userId'],
            status: payment['status'],
          },
        };
      },
    );
    if (claimResult.outcome === 'already_handled' || claimResult.outcome === 'doc_missing') {
      return;
    }

    const payment = claimResult.payload;
    const claimToken = claimResult.token;
    if (claimResult.outcome === 'claimed_retry') {
      const reconciled = await this.reconcileUncertainRefund(
        paymentRef,
        orderId,
        payment,
        reason,
        claimToken,
      );
      if (reconciled !== 'proceed') return;
    }

    try {
      await this.portone.refund(payment.portonePaymentId, payment.amount, reason);
    } catch (error) {
      // Provider result UNKNOWN (throw/timeout included): the cancel may or
      // may not have landed. Never blind-release; persist uncertainty and
      // fail closed so the next attempt must read back provider state first.
      await this.persistUncertainRefund(
        paymentRef,
        orderId,
        payment,
        claimToken,
        'provider_refund',
      );
      throw error;
    }
    try {
      await this.completeRefund(paymentRef, orderId, payment, reason, claimToken);
    } catch (error) {
      // Provider POST already started; local persistence failure leaves the
      // provider outcome uncertain. Never blind-release.
      await this.persistUncertainRefund(
        paymentRef,
        orderId,
        payment,
        claimToken,
        'local_completion',
      );
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
    paymentRef: any,
    orderId: string,
    payment: RefundPayload,
    reason: string,
    token: string,
  ): Promise<'proceed' | 'already_handled'> {
    let providerState: Record<string, any>;
    try {
      providerState = (await this.portone.getPayment(payment.portonePaymentId)) as Record<
        string,
        any
      >;
    } catch (error) {
      await this.persistUncertainRefund(paymentRef, orderId, payment, token, 'provider_readback');
      throw error;
    }
    if (providerState?.['status'] === 'CANCELLED') {
      // Provider already terminal: converge locally, never re-POST.
      await this.completeRefund(paymentRef, orderId, payment, reason, token);
      return 'already_handled';
    }
    const providerTotal = (providerState?.['amount'] as { total?: unknown } | undefined)?.[
      'total'
    ];
    const providerId = providerState?.['id'];
    if (
      providerState?.['status'] !== 'PAID' ||
      providerTotal !== payment.amount ||
      (providerId !== undefined && providerId !== payment.portonePaymentId)
    ) {
      const error = new Error('PortOne 결제 상태를 확정할 수 없어 환불을 중단합니다.');
      await this.persistUncertainRefund(paymentRef, orderId, payment, token, 'provider_readback');
      throw error;
    }
    // Fresh ownership recheck: only the current token holder may POST.
    const stillOwner: boolean = await this.firestore.runTransaction(async (tx: any) => {
      const snap: any = await tx.get(paymentRef);
      if (!snap.exists) return false;
      const marker = this.readRefundMarker(snap.data() as Record<string, any>);
      return marker?.token === token && marker?.owner === REFUND_OWNER;
    });
    if (!stillOwner) return 'already_handled';
    return 'proceed';
  }

  private async completeRefund(
    paymentRef: any,
    orderId: string,
    payment: RefundPayload,
    reason: string,
    token: string,
  ): Promise<void> {
    const now = this.firestore.Timestamp.now();
    await this.firestore.runTransaction(async (tx: any) => {
      const freshSnap: any = await tx.get(paymentRef);
      if (this.readRefundMarker(freshSnap.data() as Record<string, any>)?.token !== token) return;
      // Ownership re-verified inside the committing transaction; a stale
      // token (loser) writes nothing and authorizes no side effect.
      if ((freshSnap.data() as Record<string, any>)?.['refundClaim']?.['token'] !== token) return;
      tx.update(paymentRef, {
        status: 'CANCELLED',
        refundAmount: payment.amount,
        refundedAt: now,
        refundReason: reason,
        refundClaim: null,
        updatedAt: now,
      });
      await this.retention.saveRecord({
        id: `${String(payment.id ?? orderId)}:refund`,
        purpose: 'LEGAL_DISPUTE',
        basisAt: this.toDate(now),
        metadata: {
          orderId,
          paymentId: String(payment.id ?? orderId),
          storeId: String(payment.storeId ?? ''),
          userId: String(payment.userId ?? ''),
          recordTypes: ['REFUND', 'DISPUTE', 'SUPPORT'],
          amount: payment.amount,
          orderStatus: 'CANCELLED',
          paymentStatus: 'CANCELLED',
        },
        transaction: tx,
      });
    });
  }

  private async persistUncertainRefund(
    paymentRef: any,
    orderId: string,
    payment: RefundPayload,
    token: string,
    failureStage: 'provider_refund' | 'provider_readback' | 'local_completion',
  ): Promise<void> {
    const now = this.firestore.Timestamp.now();
    await this.firestore.runTransaction(async (tx: any) => {
      const freshSnap: any = await tx.get(paymentRef);
      if (!freshSnap.exists) return;
      const marker = this.readRefundMarker(freshSnap.data() as Record<string, any>);
      if (marker?.token !== token) return;
      tx.update(paymentRef, {
        refundClaim: {
          token,
          owner: REFUND_OWNER,
          status: 'UNKNOWN' satisfies RefundClaimStatus,
          expiresAt: Date.now() + REFUND_CLAIM_MS,
          updatedAt: now,
        },
        updatedAt: now,
      });
    });
    await this.issueWriter.createOrMergeIssue({
      storeId: String(payment.storeId ?? ''),
      orderId,
      paymentId: String(payment.id ?? ''),
      type: 'AUTO_REFUND_FAILED',
      severity: 'critical',
      title: '자동 환불 결과 불명확',
      message: '자동 환불 요청 결과를 확정하지 못해 blind 재시도 없이 운영 확인이 필요합니다.',
      idempotencyKey: `auto-refund-failed:${orderId}:${String(payment.id ?? '')}`,
      latestSnapshot: {
        orderStatus: 'CANCELLED',
        paymentStatus: 'UNKNOWN',
        failureStage,
      },
    });
  }

  private readRefundMarker(payment: Record<string, any>): {
    token: string;
    owner: string;
    status: RefundClaimStatus;
    expiresAt: number;
  } | null {
    const marker = payment['refundClaim'] as Record<string, any> | null | undefined;
    if (!marker || typeof marker !== 'object') return null;
    if (typeof marker['token'] !== 'string' || marker['token'].length === 0) return null;
    const status: RefundClaimStatus = marker['status'] === 'UNKNOWN' ? 'UNKNOWN' : 'CLAIMED';
    const owner = typeof marker['owner'] === 'string' ? marker['owner'] : REFUND_OWNER;
    const expiresAt = typeof marker['expiresAt'] === 'number' ? marker['expiresAt'] : 0;
    return { token: marker['token'], owner, status, expiresAt };
  }

  private toDate(value: { toDate?: () => Date } | Date): Date {
    return value instanceof Date ? value : value.toDate!();
  }
}
