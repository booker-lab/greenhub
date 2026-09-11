import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import { OperationIssueWriterService } from '../operations/operation-issue-writer.service';
import { RetentionService } from '../retention/retention.service';
import { PortoneClient } from './portone.client';

const REFUND_CLAIM_MS = 5 * 60 * 1000;

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
    const claimResult = await this.firestore.runTransaction(async (tx) => {
      const freshSnap = await tx.get(paymentRef);
      if (!freshSnap.exists) return null;
      const payment = freshSnap.data() as Record<string, any>;
      if (payment['status'] === 'CANCELLED' || payment['refundedAt']) return null;
      if (payment['status'] !== 'PAID') return null;
      const currentClaim = payment['refundClaim'] as { expiresAt?: number } | null;
      if (currentClaim && (currentClaim.expiresAt ?? 0) > Date.now()) return null;

      tx.update(paymentRef, {
        refundClaim: { token, expiresAt: Date.now() + REFUND_CLAIM_MS },
        updatedAt: this.firestore.Timestamp.now(),
      });
      // Immutable payload for the external side effect. A fresh copy, never
      // the live snapshot object, so a later retry cannot mutate it.
      return {
        id: payment['id'],
        portonePaymentId: payment['portonePaymentId'],
        amount: payment['amount'],
        storeId: payment['storeId'],
        userId: payment['userId'],
        status: payment['status'],
      };
    });
    if (!claimResult) return;

    const payment = claimResult as Record<string, any>;
    try {
      await this.portone.refund(payment['portonePaymentId'], payment['amount'], reason);
      const now = this.firestore.Timestamp.now();
      await this.firestore.runTransaction(async (tx) => {
        const freshSnap = await tx.get(paymentRef);
        if (freshSnap.data()?.['refundClaim']?.['token'] !== token) return;
        tx.update(paymentRef, {
          status: 'CANCELLED',
          refundAmount: payment['amount'],
          refundedAt: now,
          refundReason: reason,
          refundClaim: null,
          updatedAt: now,
        });
        await this.retention.saveRecord({
          id: `${String(payment['id'] ?? orderId)}:refund`,
          purpose: 'LEGAL_DISPUTE',
          basisAt: this.toDate(now),
          metadata: {
            orderId,
            paymentId: String(payment['id'] ?? orderId),
            storeId: String(payment['storeId'] ?? ''),
            userId: String(payment['userId'] ?? ''),
            recordTypes: ['REFUND', 'DISPUTE', 'SUPPORT'],
            amount: payment['amount'],
            orderStatus: 'CANCELLED',
            paymentStatus: 'CANCELLED',
          },
          transaction: tx,
        });
      });
    } catch (error) {
      await this.firestore.runTransaction(async (tx) => {
        const freshSnap = await tx.get(paymentRef);
        if (freshSnap.data()?.['refundClaim']?.['token'] !== token) return;
        tx.update(paymentRef, {
          refundClaim: null,
          updatedAt: this.firestore.Timestamp.now(),
        });
      });
      await this.issueWriter.createOrMergeIssue({
        storeId: String(payment['storeId'] ?? ''),
        orderId,
        paymentId: String(payment['id'] ?? payment['portonePaymentId'] ?? ''),
        type: 'AUTO_REFUND_FAILED',
        severity: 'critical',
        title: '자동 환불 최종 실패',
        message: '자동 환불에 실패하여 운영 확인이 필요합니다.',
        idempotencyKey: `auto-refund-failed:${orderId}:${String(payment['id'] ?? '')}`,
        latestSnapshot: {
          orderStatus: 'CANCELLED',
          paymentStatus: payment['status'] ?? null,
          failureStage: 'provider_refund',
        },
      });
      throw error;
    }
  }

  private toDate(value: { toDate?: () => Date } | Date): Date {
    return value instanceof Date ? value : value.toDate!();
  }
}
