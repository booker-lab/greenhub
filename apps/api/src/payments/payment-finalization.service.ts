import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service';
import { FirestoreService } from '../firestore/firestore.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OperationIssueWriterService } from '../operations/operation-issue-writer.service';
import { OrderCapacityService } from '../orders/order-capacity.service';
import { RetentionService } from '../retention/retention.service';
import { PortoneClient } from './portone.client';
import { PaymentRefundService } from './payment-refund.service';

type PaymentData = Awaited<ReturnType<PortoneClient['getPayment']>>;
const LATE_PAYMENT_REFUND_REASON = '결제 만료 후 회차 한도 마감';

@Injectable()
export class PaymentFinalizationService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly portone: PortoneClient,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly capacity: OrderCapacityService,
    private readonly issueWriter: OperationIssueWriterService,
    private readonly retention: RetentionService,
    private readonly refunds: PaymentRefundService,
  ) {}

  async recordPaymentLookupFailure(orderId: string, error: unknown) {
    const orderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!orderSnap.exists) return;
    const order = orderSnap.data() as Record<string, unknown>;
    const failure = this.safeLookupFailure(error);
    await this.issueWriter.createOrMergeIssue({
      storeId: String(order['storeId'] ?? ''),
      orderId,
      paymentId: orderId,
      type: 'PAYMENT_LOOKUP_FAILED',
      severity: 'critical',
      title: '결제 조회 최종 실패',
      message: '결제 상태를 확인하지 못해 운영 확인이 필요합니다.',
      idempotencyKey: `payment-lookup-failed:${orderId}`,
      latestSnapshot: {
        orderStatus: order['status'] ?? null,
        failureStage: 'payment_lookup',
        providerStatus: failure.status,
        providerType: failure.type,
      },
    });
  }

  async finalizePaidOrder(orderId: string, paymentData: PaymentData) {
    const orderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!orderSnap.exists) return { ok: false, reason: 'order_not_found' };
    const order = orderSnap.data() as Record<string, any>;
    if (paymentData.status !== 'PAID') {
      return { ok: true, reason: 'payment_not_paid' };
    }
    if (!this.canFinalize(order) && !this.isCancellationSettlementCandidate(order)) {
      return { ok: true, reason: 'already_processed' };
    }

    if (paymentData.amount.total !== order['totalAmount']) {
      await this.audit.log('payment.amount_tampered', {
        userId: order['userId'] as string,
        detail: { orderId, expected: order['totalAmount'], actual: paymentData.amount.total },
      });
      await this.portone.refund(orderId, paymentData.amount.total, '금액 위변조 감지');
      await this.cancelPendingOrder(orderId, 'amount_mismatch');
      return { ok: false, reason: 'amount_mismatch' };
    }

    let reservationId = order['reservationId'] as string | undefined;
    if (
      order['schemaVersion'] === 2 &&
      order['status'] === 'CANCELLED' &&
      order['cancelReason'] === 'timeout'
    ) {
      try {
        const reservation = await this.capacity.reserveCheckout({
          storeId: order['storeId'],
          roundId: order['roundId'],
          userId: order['userId'],
          idempotencyKey: `late-payment:${orderId}`,
          deliveryAddress: order['deliveryAddress'],
          items: (order['orderItems'] as Array<Record<string, any>>).map((item) => ({
            roundItemId: item['roundItemId'],
            quantity: item['quantity'],
          })),
        });
        reservationId = reservation.id;
      } catch {
        await this.portone.refund(orderId, paymentData.amount.total, LATE_PAYMENT_REFUND_REASON);
        await this.recordLateRefund(orderId, order, paymentData);
        return { ok: false, reason: 'late_payment_refunded' };
      }
    }

    const newStatus = order['saleType'] === 'group' ? 'RECRUITING' : 'ACCEPTED';
    const now = this.firestore.Timestamp.now();
    let applied = false;
    let cancellationOutcome: 'REFUND' | null = null;
    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${orderId}`);
      const paymentRef = this.firestore.doc(`payments/${orderId}`);
      const freshSnap = await tx.get(orderRef);
      if (!freshSnap.exists) return;
      const freshOrder = freshSnap.data() as Record<string, any>;
      if (this.isCancellationSettlementCandidate(freshOrder)) {
        const paymentSnap = await tx.get(paymentRef);
        const payment = paymentSnap.exists ? (paymentSnap.data() as Record<string, any>) : null;
        if (payment?.['status'] !== 'CANCELLED' && !payment?.['refundedAt']) {
          if (payment?.['status'] !== 'PAID') {
            await this.writePaidPaymentInTransaction(
              tx,
              orderId,
              freshOrder,
              paymentData,
              now,
              freshOrder['status'],
            );
          }
          cancellationOutcome = 'REFUND';
        }
        return;
      }
      if (!this.canFinalize(freshOrder)) return;

      if (freshOrder['schemaVersion'] === 2) {
        if (!reservationId) throw new Error('결제 예약 식별자가 없습니다.');
        await this.capacity.consumeReservationInTransaction(tx, {
          reservationId,
          orderId,
          paymentId: orderId,
        });
      }
      tx.update(orderRef, {
        status: freshOrder['saleType'] === 'group' ? 'RECRUITING' : 'ACCEPTED',
        ...(reservationId ? { reservationId } : {}),
        updatedAt: now,
      });
      const finalStatus = freshOrder['saleType'] === 'group' ? 'RECRUITING' : 'ACCEPTED';
      await this.writePaidPaymentInTransaction(
        tx,
        orderId,
        freshOrder,
        paymentData,
        now,
        finalStatus,
      );
      applied = true;
    });
    if (cancellationOutcome === 'REFUND') {
      try {
        await this.refunds.refundByOrderId(
          orderId,
          order['cancelReason'] ?? '취소 후 확인된 결제 환불',
        );
      } catch (error) {
        await this.firestore.doc(`orders/${orderId}`).update({
          cancellation: {
            status: 'REFUND_FAILED',
            reason: order['cancelReason'] ?? '취소 후 확인된 결제 환불',
            updatedAt: this.firestore.Timestamp.now(),
          },
          updatedAt: this.firestore.Timestamp.now(),
        });
        throw error;
      }
      return { ok: false, reason: 'cancelled_paid_refunded' };
    }
    if (!applied) return { ok: true, reason: 'already_processed' };

    await this.notifications.sendToUser(
      order['userId'],
      newStatus === 'ACCEPTED' ? 'ORDER_ACCEPTED' : 'GROUP_JOINED',
      newStatus === 'ACCEPTED'
        ? { orderId, name: this.resolveBuyerDisplayName(order) }
        : { orderId },
      orderId,
    );
    return { ok: true, status: newStatus };
  }

  async cancelPendingOrder(orderId: string, reason: string) {
    const now = this.firestore.Timestamp.now();
    let applied = false;
    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${orderId}`);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists || orderSnap.data()?.['status'] !== 'PENDING') return;
      const order = orderSnap.data() as Record<string, any>;
      if (order['schemaVersion'] === 2 && order['reservationId']) {
        await this.capacity.releaseReservationInTransaction(
          tx,
          order['reservationId'],
          reason === 'timeout' ? 'EXPIRED' : 'RELEASED',
        );
      } else if (order['deliveryMethod'] !== 'parcel') {
        const createdAt = order['createdAt'];
        const date =
          order['requestedDeliveryDate'] ??
          (typeof createdAt?.toDate === 'function'
            ? createdAt.toDate().toISOString().split('T')[0]
            : new Date(createdAt).toISOString().split('T')[0]);
        tx.update(this.firestore.doc(`dailyCaps/${order['storeId']}_${date}`), {
          usedSlots: this.firestore.FieldValue.increment(-(order['quantity'] ?? 0)),
        });
      }
      tx.update(orderRef, { status: 'CANCELLED', cancelReason: reason, updatedAt: now });
      applied = true;
    });
    return applied;
  }

  private canFinalize(order: Record<string, any>) {
    return (
      order['status'] === 'PENDING' ||
      (order['status'] === 'CANCELLED' &&
        order['cancelReason'] === 'timeout' &&
        !order['latePaymentRefundedAt'])
    );
  }

  private isCancellationSettlementCandidate(order: Record<string, any>) {
    return (
      (order['status'] === 'CANCELLED' && order['cancelReason'] !== 'timeout') ||
      ['LOCAL_PENDING', 'LOCAL_FAILED', 'REFUNDING'].includes(order['cancellation']?.['status'])
    );
  }

  private async writePaidPaymentInTransaction(
    tx: any,
    orderId: string,
    order: Record<string, any>,
    paymentData: PaymentData,
    now: any,
    orderStatus: string,
  ) {
    const paymentRef = this.firestore.doc(`payments/${orderId}`);
    tx.set(paymentRef, {
      id: orderId,
      orderId,
      userId: order['userId'],
      storeId: order['storeId'],
      amount: paymentData.amount.total,
      payMethod: paymentData.method?.type ?? null,
      status: 'PAID',
      portonePaymentId: orderId,
      portoneTransactionId: paymentData.transactionId,
      refundAmount: null,
      refundedAt: null,
      refundReason: null,
      refundClaim: null,
      createdAt: now,
      updatedAt: now,
    });
    await this.retention.saveRecord({
      id: `${orderId}:payment`,
      purpose: 'LEGAL_ORDER',
      basisAt: this.toDate(now),
      metadata: {
        orderId,
        paymentId: orderId,
        storeId: order['storeId'],
        userId: order['userId'],
        recordTypes: ['PAYMENT'],
        amount: paymentData.amount.total,
        payMethod: paymentData.method?.type ?? null,
        orderStatus,
        paymentStatus: 'PAID',
      },
      transaction: tx,
    });
  }

  private resolveBuyerDisplayName(order: Record<string, any>): string {
    const userId = String(order['userId'] ?? '');
    const buyerName = typeof order['buyerName'] === 'string' ? order['buyerName'].trim() : '';
    return buyerName && buyerName !== userId ? buyerName : '고객';
  }

  private async recordLateRefund(
    orderId: string,
    order: Record<string, any>,
    paymentData: PaymentData,
  ) {
    const now = this.firestore.Timestamp.now();
    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${orderId}`);
      const freshSnap = await tx.get(orderRef);
      if (!freshSnap.exists || freshSnap.data()?.['latePaymentRefundedAt']) return;
      tx.update(orderRef, { latePaymentRefundedAt: now, updatedAt: now });
      tx.set(this.firestore.doc(`payments/${orderId}`), {
        id: orderId,
        orderId,
        userId: order['userId'],
        storeId: order['storeId'],
        amount: paymentData.amount.total,
        payMethod: paymentData.method?.type ?? null,
        status: 'CANCELLED',
        portonePaymentId: orderId,
        portoneTransactionId: paymentData.transactionId,
        refundAmount: paymentData.amount.total,
        refundedAt: now,
        refundReason: LATE_PAYMENT_REFUND_REASON,
        refundClaim: null,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  private safeLookupFailure(error: unknown) {
    const candidate = error as { status?: unknown; type?: unknown };
    return {
      status: typeof candidate?.status === 'number' ? candidate.status : null,
      type:
        typeof candidate?.type === 'string'
          ? candidate.type.replace(/[^A-Z0-9_]/g, '').slice(0, 80)
          : null,
    };
  }

  private toDate(value: { toDate?: () => Date } | Date): Date {
    return value instanceof Date ? value : value.toDate!();
  }
}
