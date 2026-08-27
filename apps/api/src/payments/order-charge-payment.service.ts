import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import {
  isCurrentRedeliveryChargeLinked,
  isCurrentRedeliveryPaymentRequired,
} from '../orders/redelivery-resume-gate';
import { PortoneClient } from './portone.client';

type PaymentData = Awaited<ReturnType<PortoneClient['getPayment']>>;

const PAYMENT_ID_PREFIX = 'order-charge-';
const REFUND_CLAIM_MS = 5 * 60 * 1000;

@Injectable()
export class OrderChargePaymentService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly portone: PortoneClient,
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
    let result: Record<string, unknown> = { ok: false, reason: 'charge_not_found' };
    await this.firestore.runTransaction(async (tx) => {
      const chargeRef = this.firestore.doc(`orderCharges/${chargeId}`);
      const chargeSnap = await tx.get(chargeRef);
      if (!chargeSnap.exists) return;
      const charge = chargeSnap.data() as Record<string, any>;
      if (charge['status'] === 'PAID') {
        result = { ok: true, reason: 'already_processed' };
        return;
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
      result = { ok: true, status: 'PAID' };
    });
    return result;
  }

  private async markFailed(chargeId: string, paymentId: string) {
    let result: Record<string, unknown> = { ok: false, reason: 'charge_not_found' };
    await this.firestore.runTransaction(async (tx) => {
      const chargeRef = this.firestore.doc(`orderCharges/${chargeId}`);
      const chargeSnap = await tx.get(chargeRef);
      if (!chargeSnap.exists) return;
      const charge = chargeSnap.data() as Record<string, any>;
      if (charge['portonePaymentId'] !== paymentId) {
        throw new BadRequestException('재배송비 결제 정보가 일치하지 않습니다.');
      }
      if (charge['status'] !== 'PENDING') {
        result = { ok: true, reason: 'already_processed' };
        return;
      }
      const now = this.firestore.Timestamp.now();
      tx.update(chargeRef, { status: 'FAILED', failedAt: now, updatedAt: now });
      result = { ok: true, status: 'FAILED' };
    });
    return result;
  }

  private async refundCharge(chargeRef: any, reason: string) {
    const token = randomUUID();
    let claimed: Record<string, any> | null = null;
    await this.firestore.runTransaction(async (tx) => {
      const snap: any = await tx.get(chargeRef);
      if (!snap.exists) return;
      const charge = snap.data() as Record<string, any>;
      if (charge['status'] === 'REFUNDED' || charge['refundedAt']) return;
      if (charge['status'] !== 'PAID') return;
      const currentClaim = charge['refundClaim'] as { expiresAt?: number } | null;
      if (currentClaim && (currentClaim.expiresAt ?? 0) > Date.now()) return;
      tx.update(chargeRef, {
        refundClaim: { token, expiresAt: Date.now() + REFUND_CLAIM_MS },
        updatedAt: this.firestore.Timestamp.now(),
      });
      claimed = charge;
    });
    if (!claimed) return;

    const charge = claimed as Record<string, any>;
    try {
      await this.portone.refund(charge['portonePaymentId'], charge['amount'], reason);
      await this.completeRefund(chargeRef, token, reason);
    } catch (error) {
      await this.releaseRefundClaim(chargeRef, token);
      throw error;
    }
  }

  private async completeRefund(chargeRef: any, token: string, reason: string) {
    await this.firestore.runTransaction(async (tx) => {
      const snap: any = await tx.get(chargeRef);
      if (snap.data()?.['refundClaim']?.['token'] !== token) return;
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

  private async releaseRefundClaim(chargeRef: any, token: string) {
    await this.firestore.runTransaction(async (tx) => {
      const snap: any = await tx.get(chargeRef);
      if (snap.data()?.['refundClaim']?.['token'] !== token) return;
      tx.update(chargeRef, {
        refundClaim: null,
        updatedAt: this.firestore.Timestamp.now(),
      });
    });
  }

  private chargeIdFromPaymentId(paymentId: string) {
    if (!this.isOrderChargePaymentId(paymentId)) {
      throw new BadRequestException('재배송비 결제 식별자가 올바르지 않습니다.');
    }
    return paymentId.slice(PAYMENT_ID_PREFIX.length);
  }
}
