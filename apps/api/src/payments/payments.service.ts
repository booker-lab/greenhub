import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { AuditService } from '../common/audit/audit.service';
import type { FirestoreService } from '../firestore/firestore.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { PortoneWebhookDto } from './dto/portone-webhook.dto';
import type { PortoneClient } from './portone.client';

// 환불 가능 상태
const REFUNDABLE_STATUSES = ['ACCEPTED', 'RECRUITING', 'CONFIRMED', 'PREPARING'];

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly firestore: FirestoreService,
    private readonly portone: PortoneClient,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async handleWebhook(dto: PortoneWebhookDto) {
    const orderId = dto.data.paymentId;

    const orderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!orderSnap.exists) return { ok: false, reason: 'order_not_found' };

    const order = orderSnap.data();
    if (!order) return { ok: false, reason: 'order_not_found' };
    // 멱등성: 이미 처리된 경우 스킵
    if (order['status'] !== 'PENDING') {
      return { ok: true, reason: 'already_processed' };
    }

    // Transaction.Ready: 결제창 오픈 이벤트 — 주문 상태 변경 없이 무시
    if (dto.type === 'Transaction.Ready') {
      return { ok: true, reason: 'transaction_ready_ignored' };
    }

    if (dto.type !== 'Transaction.Paid') {
      await this.cancelOrderWithSlotRecovery(orderId, order, 'payment_failed');
      return { ok: true };
    }

    // 금액 검증 (위변조 방지)
    const paymentData = await this.portone.getPayment(orderId);
    if (paymentData.amount.total !== order['totalAmount']) {
      await this.audit.log('payment.amount_tampered', {
        userId: order['userId'] as string,
        detail: { orderId, expected: order['totalAmount'], actual: paymentData.amount.total },
      });
      await this.portone.refund(orderId, paymentData.amount.total, '금액 위변조 감지');
      await this.cancelOrderWithSlotRecovery(orderId, order, 'amount_mismatch');
      return { ok: false, reason: 'amount_mismatch' };
    }

    const newStatus = order['saleType'] === 'group' ? 'RECRUITING' : 'ACCEPTED';

    const now = this.firestore.Timestamp.now();

    await this.firestore.doc(`orders/${orderId}`).update({
      status: newStatus,
      updatedAt: now,
    });

    // 결제 기록 저장
    await this.firestore.doc(`payments/${orderId}`).set({
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
    });

    // 소비자 알림: 일반 결제 완료 / 공동구매 참여 완료
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

  async getPayment(paymentId: string, requesterId: string) {
    const snap = await this.firestore.doc(`payments/${paymentId}`).get();
    if (!snap.exists) throw new BadRequestException('결제 내역을 찾을 수 없습니다.');
    const payment = snap.data();
    if (!payment) throw new BadRequestException('결제 내역을 찾을 수 없습니다.');

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
    const order = orderSnap.data();
    if (!orderSnap.exists || !order || order['storeId'] !== storeId) {
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
    const order = orderSnap.data();
    if (!orderSnap.exists || !order || order['storeId'] !== storeId) {
      throw new BadRequestException('주문을 찾을 수 없습니다.');
    }

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

    const promises = snap.docs.map((doc) =>
      this.cancelOrderWithSlotRecovery(doc.id, doc.data(), 'timeout'),
    );
    await Promise.all(promises);
    console.log(`[PaymentsScheduler] PENDING 타임아웃 처리 ${snap.size}건`);
  }

  private async cancelOrderWithSlotRecovery(
    orderId: string,
    order: Record<string, unknown>,
    reason: string,
  ) {
    const now = this.firestore.Timestamp.now();
    const updates: Promise<unknown>[] = [
      this.firestore.doc(`orders/${orderId}`).update({
        status: 'CANCELLED',
        cancelReason: reason,
        updatedAt: now,
      }),
    ];

    if (
      order['saleType'] === 'normal' &&
      order['deliveryMethod'] !== 'parcel' &&
      typeof order['requestedDeliveryDate'] === 'string'
    ) {
      const dateStr = order['requestedDeliveryDate'];
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
