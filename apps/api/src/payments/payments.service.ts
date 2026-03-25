import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FirestoreService } from '../firestore/firestore.service';
import { PortoneClient } from './portone.client';
import { PortoneWebhookDto } from './dto/portone-webhook.dto';

// 환불 가능 상태
const REFUNDABLE_STATUSES = [
  'ACCEPTED',
  'RECRUITING',
  'CONFIRMED',
  'PREPARING',
];

@Injectable()
export class PaymentsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly portone: PortoneClient,
  ) {}

  async handleWebhook(dto: PortoneWebhookDto) {
    const orderId = dto.merchant_uid;

    const orderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!orderSnap.exists) return { ok: false, reason: 'order_not_found' };

    const order = orderSnap.data()!;
    // 멱등성: 이미 처리된 경우 스킵
    if (order['status'] !== 'PENDING') {
      return { ok: true, reason: 'already_processed' };
    }

    if (dto.status !== 'paid') {
      await this.cancelOrderWithSlotRecovery(orderId, order, 'payment_failed');
      return { ok: true };
    }

    // 금액 검증 (위변조 방지)
    const paymentData = await this.portone.getPayment(dto.imp_uid);
    if (paymentData.amount !== order['totalAmount']) {
      await this.portone.refund(dto.imp_uid, paymentData.amount, '금액 위변조 감지');
      await this.cancelOrderWithSlotRecovery(orderId, order, 'amount_mismatch');
      return { ok: false, reason: 'amount_mismatch' };
    }

    const newStatus =
      order['saleType'] === 'group' ? 'RECRUITING' : 'ACCEPTED';

    const now = this.firestore.Timestamp.now();

    await this.firestore.doc(`orders/${orderId}`).update({
      status: newStatus,
      updatedAt: now,
    });

    // 결제 기록 저장
    await this.firestore.doc(`payments/${dto.imp_uid}`).set({
      id: dto.imp_uid,
      orderId,
      userId: order['userId'],
      storeId: order['storeId'],
      amount: paymentData.amount,
      payMethod: paymentData.pay_method,
      status: 'PAID',
      portoneImpUid: dto.imp_uid,
      portoneMerchantUid: orderId,
      refundAmount: null,
      refundedAt: null,
      refundReason: null,
      createdAt: now,
      updatedAt: now,
    });

    return { ok: true, status: newStatus };
  }

  /**
   * 판매자 환불 엔드포인트용 — 상태 검증 포함
   */
  async refundOrder(
    storeId: string,
    orderId: string,
    requesterId: string,
    reason?: string,
  ) {
    const orderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!orderSnap.exists || orderSnap.data()!['storeId'] !== storeId) {
      throw new BadRequestException('주문을 찾을 수 없습니다.');
    }
    const order = orderSnap.data()!;

    // 환불 가능 상태 검증
    if (!REFUNDABLE_STATUSES.includes(order['status'])) {
      throw new ForbiddenException(
        `${order['status']} 상태에서는 환불할 수 없습니다.`,
      );
    }

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
    await this.portone.refund(
      payment['portoneImpUid'],
      payment['amount'],
      reason,
    );

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

    if (order['deliveryMethod'] !== 'parcel') {
      const dateStr = (order['createdAt'] as any)
        .toDate()
        .toISOString()
        .split('T')[0];
      const capId = `${order['storeId']}_${dateStr}`;
      updates.push(
        this.firestore.doc(`dailyCaps/${capId}`).update({
          usedSlots: this.firestore.FieldValue.increment(
            -(order['quantity'] as number),
          ),
        }),
      );
    }

    await Promise.all(updates);
  }
}
