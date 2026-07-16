import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditService } from '../common/audit/audit.service';
import { FirestoreService } from '../firestore/firestore.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrderCapacityService } from '../orders/order-capacity.service';
import { PortoneWebhookDto } from './dto/portone-webhook.dto';
import { PortoneClient, PortoneError } from './portone.client';

// 환불 가능 상태
const REFUNDABLE_STATUSES = ['ACCEPTED', 'RECRUITING', 'CONFIRMED', 'PREPARING'];
const PAYMENT_FINALIZATION_LOCK_MS = 5 * 60 * 1000;
const LATE_PAYMENT_REFUND_REASON = '결제 만료 후 회차 한도 마감';

type PaymentData = Awaited<ReturnType<PortoneClient['getPayment']>>;

type PaymentClaim = {
  order: Record<string, any>;
  token: string;
  latePayment: boolean;
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly firestore: FirestoreService,
    private readonly portone: PortoneClient,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly capacity: OrderCapacityService,
  ) {}

  async handleWebhook(dto: PortoneWebhookDto) {
    const orderId = dto.data.paymentId;

    const orderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!orderSnap.exists) return { ok: false, reason: 'order_not_found' };

    const order = orderSnap.data()!;
    if (!this.canFinalizePayment(order)) {
      return { ok: true, reason: 'already_processed' };
    }

    // Transaction.Ready: 결제창 오픈 이벤트 — 주문 상태 변경 없이 무시
    if (dto.type === 'Transaction.Ready') {
      return { ok: true, reason: 'transaction_ready_ignored' };
    }

    if (dto.type !== 'Transaction.Paid') {
      if (order['status'] === 'PENDING') {
        await this.cancelOrderWithSlotRecovery(orderId, order, 'payment_failed');
      }
      return { ok: true };
    }

    const paymentData = await this.portone.getPayment(orderId);
    if (order['status'] === 'CANCELLED' && paymentData.status !== 'PAID') {
      return { ok: true, reason: 'payment_not_paid' };
    }
    return this.finalizePaidOrder(orderId, paymentData);
  }

  async getPayment(paymentId: string, requesterId: string) {
    const snap = await this.firestore.doc(`payments/${paymentId}`).get();
    if (!snap.exists) throw new BadRequestException('결제 내역을 찾을 수 없습니다.');
    const payment = snap.data()!;

    // 본인 결제이면 허용
    if (payment['userId'] === requesterId) return payment;

    // 아니면 해당 주문의 storeId 소유 seller 또는 admin만 허용
    const userSnap = await this.firestore.doc(`users/${requesterId}`).get();
    const userData = userSnap.data();
    const role = userData?.['role'];

    if (role === 'admin') return payment;
    if (role === 'seller' && userData?.['storeId'] === payment['storeId']) return payment;

    throw new ForbiddenException();
  }

  async getPaymentByOrder(storeId: string, orderId: string, requesterId: string) {
    const orderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!orderSnap.exists || orderSnap.data()!['storeId'] !== storeId) {
      throw new BadRequestException('주문을 찾을 수 없습니다.');
    }

    // 요청자가 해당 storeId 소유자이거나 admin인지 검증
    const userSnap = await this.firestore.doc(`users/${requesterId}`).get();
    const userData = userSnap.data();
    const role = userData?.['role'];
    if (role !== 'admin' && userData?.['storeId'] !== storeId) {
      throw new ForbiddenException();
    }

    const snap = await this.firestore
      .collection('payments')
      .where('orderId', '==', orderId)
      .limit(1)
      .get();

    if (snap.empty) throw new BadRequestException('결제 내역을 찾을 수 없습니다.');
    return snap.docs[0].data();
  }

  /**
   * 판매자 환불 엔드포인트용 — 상태 검증 포함
   */
  async refundOrder(storeId: string, orderId: string, requesterId: string, reason?: string) {
    const orderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!orderSnap.exists || orderSnap.data()!['storeId'] !== storeId) {
      throw new BadRequestException('주문을 찾을 수 없습니다.');
    }
    const order = orderSnap.data()!;

    // 환불 가능 상태 검증
    if (!REFUNDABLE_STATUSES.includes(order['status'])) {
      throw new ForbiddenException(`${order['status']} 상태에서는 환불할 수 없습니다.`);
    }

    this.logger.log(
      `payment.refunded orderId=${orderId} storeId=${storeId} requesterId=${requesterId} reason=${reason ?? '판매자 취소'}`,
    );
    await this.processRefundByOrderId(orderId, reason ?? '판매자 취소');
    return { ok: true };
  }

  /**
   * 내부 공통 환불 처리 — 상태 검증 없이 결제 기록만 처리
   * OrdersService.cancelOrder(), NotificationsService.cancelGroupBuyLack()에서 호출
   */
  async processRefundByOrderId(orderId: string, reason: string): Promise<void> {
    const paySnap = await this.firestore
      .collection('payments')
      .where('orderId', '==', orderId)
      .where('status', '==', 'PAID')
      .limit(1)
      .get();

    if (paySnap.empty) return; // 결제 기록 없으면 스킵 (PENDING 상태 등)

    const payment = paySnap.docs[0].data();
    await this.portone.refund(payment['portonePaymentId'], payment['amount'], reason);

    const now = this.firestore.Timestamp.now();
    await paySnap.docs[0].ref.update({
      status: 'CANCELLED',
      refundAmount: payment['amount'],
      refundedAt: now,
      refundReason: reason,
      updatedAt: now,
    });
  }

  // ── 스케줄러: PENDING 주문 15분 타임아웃 처리 ──
  @Cron(CronExpression.EVERY_MINUTE)
  async cleanupPendingOrders() {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
    const snap = await this.firestore
      .collection('orders')
      .where('status', '==', 'PENDING')
      .where('createdAt', '<', this.firestore.Timestamp.fromDate(cutoff))
      .get();

    if (snap.empty) return;

    const promises = snap.docs.map(async (doc) => {
      try {
        const paymentData = await this.portone.getPayment(doc.id);
        if (paymentData.status === 'PAID') {
          await this.finalizePaidOrder(doc.id, paymentData);
          return;
        }
        await this.cancelOrderWithSlotRecovery(doc.id, doc.data(), 'timeout');
      } catch (error) {
        if (
          error instanceof PortoneError &&
          error.status === 404 &&
          error.type === 'PAYMENT_NOT_FOUND'
        ) {
          await this.cancelOrderWithSlotRecovery(doc.id, doc.data(), 'timeout');
          return;
        }
        this.logPendingOrderCleanupError(doc.id, error);
      }
    });
    await Promise.all(promises);
    this.logger.log(`[PaymentsScheduler] PENDING 타임아웃 확인 ${snap.size}건`);
  }

  private logPendingOrderCleanupError(orderId: string, error: unknown) {
    if (error instanceof PortoneError) {
      this.logger.error(
        `[PaymentsScheduler] 결제 조회 보류 orderId=${orderId} status=${error.status} type=${error.type} message=${error.message}`,
      );
      return;
    }
    const message =
      error instanceof Error ? error.message.replace(/[\r\n\t]/g, ' ').slice(0, 500) : 'unknown';
    this.logger.error(
      `[PaymentsScheduler] 결제 조회 보류 orderId=${orderId} networkError=${message}`,
    );
  }

  private async finalizePaidOrder(orderId: string, paymentData: PaymentData) {
    const claim = await this.claimPaymentFinalization(orderId);
    if (!claim) return { ok: true, reason: 'already_processed' };

    const { order, token, latePayment } = claim;
    if (paymentData.amount.total !== order['totalAmount']) {
      await this.audit.log('payment.amount_tampered', {
        userId: order['userId'] as string,
        detail: { orderId, expected: order['totalAmount'], actual: paymentData.amount.total },
      });
      await this.portone.refund(orderId, paymentData.amount.total, '금액 위변조 감지');
      await this.cancelOrderWithSlotRecovery(orderId, order, 'amount_mismatch');
      return { ok: false, reason: 'amount_mismatch' };
    }

    let reservationId = order['reservationId'] as string | undefined;
    if (order['schemaVersion'] === 2 && latePayment) {
      try {
        const reservation = await this.capacity.reserveCheckout({
          storeId: order['storeId'] as string,
          roundId: order['roundId'] as string,
          userId: order['userId'] as string,
          idempotencyKey: `late-payment:${orderId}`,
          deliveryAddress: order['deliveryAddress'] as {
            address: string;
            addressDetail?: string | null;
            zipCode?: string | null;
          },
          items: (order['orderItems'] as Array<Record<string, any>>).map((item) => ({
            roundItemId: item['roundItemId'] as string,
            quantity: item['quantity'] as number,
          })),
        });
        reservationId = reservation.id;
      } catch {
        await this.portone.refund(orderId, paymentData.amount.total, LATE_PAYMENT_REFUND_REASON);
        await this.markLatePaymentRefunded(
          orderId,
          token,
          order,
          paymentData,
          LATE_PAYMENT_REFUND_REASON,
        );
        return { ok: false, reason: 'late_payment_refunded' };
      }
    }

    try {
      if (order['schemaVersion'] === 2 && reservationId) {
        await this.capacity.consumeReservation({
          reservationId,
          orderId,
          paymentId: orderId,
        });
      }
      return await this.commitPaidOrder(orderId, paymentData, claim, reservationId);
    } catch (error) {
      await this.releasePaymentFinalization(orderId, token);
      throw error;
    }
  }

  private async claimPaymentFinalization(orderId: string): Promise<PaymentClaim | null> {
    const token = randomUUID();
    let claim: PaymentClaim | null = null;

    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${orderId}`);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) return;

      const order = orderSnap.data() as Record<string, any>;
      if (!this.canFinalizePayment(order)) return;
      const currentLock = order['paymentFinalization'] as { expiresAt?: number } | null;
      if (currentLock && (currentLock.expiresAt ?? 0) > Date.now()) return;

      tx.update(orderRef, {
        paymentFinalization: {
          token,
          expiresAt: Date.now() + PAYMENT_FINALIZATION_LOCK_MS,
        },
      });
      claim = {
        order,
        token,
        latePayment: order['status'] === 'CANCELLED',
      };
    });

    return claim;
  }

  private async commitPaidOrder(
    orderId: string,
    paymentData: PaymentData,
    claim: PaymentClaim,
    reservationId?: string,
  ) {
    const { order, token } = claim;
    const newStatus = order['saleType'] === 'group' ? 'RECRUITING' : 'ACCEPTED';
    const now = this.firestore.Timestamp.now();
    const paymentRecord = {
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
      createdAt: now,
      updatedAt: now,
    };
    let applied = false;

    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${orderId}`);
      const freshOrder = await tx.get(orderRef);
      const freshData = freshOrder.data() as Record<string, any> | undefined;
      if (!freshOrder.exists || freshData?.['paymentFinalization']?.['token'] !== token) return;

      tx.update(orderRef, {
        status: newStatus,
        ...(reservationId ? { reservationId } : {}),
        paymentFinalization: null,
        updatedAt: now,
      });
      tx.set(this.firestore.doc(`payments/${orderId}`), paymentRecord);
      applied = true;
    });
    if (!applied) return { ok: true, reason: 'already_processed' };

    const buyerTemplateCode = newStatus === 'ACCEPTED' ? 'ORDER_ACCEPTED' : 'GROUP_JOINED';
    await this.notifications.sendToUser(
      order['userId'] as string,
      buyerTemplateCode,
      { orderId },
      orderId,
    );
    this.logger.log(
      `payment.completed orderId=${orderId} userId=${order['userId']} amount=${paymentData.amount.total} status=${newStatus}`,
    );

    return { ok: true, status: newStatus };
  }

  private canFinalizePayment(order: Record<string, any>) {
    return (
      order['status'] === 'PENDING' ||
      (order['status'] === 'CANCELLED' &&
        order['cancelReason'] === 'timeout' &&
        !order['latePaymentRefundedAt'])
    );
  }

  private async markLatePaymentRefunded(
    orderId: string,
    token: string,
    order: Record<string, any>,
    paymentData: PaymentData,
    reason: string,
  ) {
    const now = this.firestore.Timestamp.now();
    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${orderId}`);
      const orderSnap = await tx.get(orderRef);
      if (orderSnap.data()?.['paymentFinalization']?.['token'] !== token) return;
      tx.update(orderRef, {
        latePaymentRefundedAt: now,
        paymentFinalization: null,
        updatedAt: now,
      });
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
        refundReason: reason,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  private async releasePaymentFinalization(orderId: string, token: string) {
    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${orderId}`);
      const orderSnap = await tx.get(orderRef);
      if (orderSnap.data()?.['paymentFinalization']?.['token'] !== token) return;
      tx.update(orderRef, { paymentFinalization: null });
    });
  }

  private async cancelOrderWithSlotRecovery(
    orderId: string,
    order: Record<string, unknown>,
    reason: string,
  ) {
    const latestOrderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!latestOrderSnap.exists || latestOrderSnap.data()?.['status'] !== 'PENDING') return;

    const now = this.firestore.Timestamp.now();
    if (order['schemaVersion'] === 2 && order['reservationId']) {
      if (reason === 'timeout') {
        await this.capacity.releaseReservation(order['reservationId'] as string, 'EXPIRED');
      } else {
        await this.capacity.releaseReservation(order['reservationId'] as string);
      }
      await this.firestore.doc(`orders/${orderId}`).update({
        status: 'CANCELLED',
        cancelReason: reason,
        updatedAt: now,
      });
      return;
    }
    const updates: Promise<unknown>[] = [
      this.firestore.doc(`orders/${orderId}`).update({
        status: 'CANCELLED',
        cancelReason: reason,
        updatedAt: now,
      }),
    ];

    if (order['deliveryMethod'] !== 'parcel') {
      const dateStr =
        (order['requestedDeliveryDate'] as string | undefined) ??
        (order['createdAt'] as any).toDate().toISOString().split('T')[0];
      const capId = `${order['storeId']}_${dateStr}`;
      updates.push(
        this.firestore.doc(`dailyCaps/${capId}`).update({
          usedSlots: this.firestore.FieldValue.increment(-(order['quantity'] as number)),
        }),
      );
    }

    await Promise.all(updates);
  }
}
