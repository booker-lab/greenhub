import { Injectable, BadRequestException } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import { PortoneClient } from './portone.client';
import { PortoneWebhookDto } from './dto/portone-webhook.dto';

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
    if (order['status'] !== 'PENDING') return { ok: true, reason: 'already_processed' };

    if (dto.status !== 'paid') {
      await this.cancelOrderWithSlotRecovery(orderId, order, 'payment_failed');
      return { ok: true };
    }

    // 금액 검증
    const paymentData = await this.portone.getPayment(dto.imp_uid);
    if (paymentData.amount !== order['totalAmount']) {
      // 위변조 — 즉시 환불
      await this.portone.refund(dto.imp_uid, paymentData.amount, '금액 위변조 감지');
      await this.cancelOrderWithSlotRecovery(orderId, order, 'amount_mismatch');
      return { ok: false, reason: 'amount_mismatch' };
    }

    // 결제 성공 — 주문 상태 전환
    const newStatus =
      order['saleType'] === 'group' ? 'RECRUITING' : 'ACCEPTED';

    await this.firestore.doc(`orders/${orderId}`).update({
      status: newStatus,
      updatedAt: this.firestore.Timestamp.now(),
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
      createdAt: this.firestore.Timestamp.now(),
      updatedAt: this.firestore.Timestamp.now(),
    });

    return { ok: true, status: newStatus };
  }

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

    // 결제 기록 조회
    const paySnap = await this.firestore
      .collection('payments')
      .where('orderId', '==', orderId)
      .where('status', '==', 'PAID')
      .limit(1)
      .get();

    if (paySnap.empty) {
      throw new BadRequestException('결제 내역을 찾을 수 없습니다.');
    }

    const payment = paySnap.docs[0].data();
    const refundReason = reason ?? '판매자 취소';

    await this.portone.refund(
      payment['portoneImpUid'],
      payment['amount'],
      refundReason,
    );

    const now = this.firestore.Timestamp.now();

    await paySnap.docs[0].ref.update({
      status: 'CANCELLED',
      refundAmount: payment['amount'],
      refundedAt: now,
      refundReason,
      updatedAt: now,
    });

    await this.firestore.doc(`orders/${orderId}`).update({
      status: 'CANCELLED',
      cancelReason: refundReason,
      updatedAt: now,
    });

    return { ok: true };
  }

  async cleanupPendingOrders() {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000); // 15분
    const snap = await this.firestore
      .collection('orders')
      .where('status', '==', 'PENDING')
      .where('createdAt', '<', this.firestore.Timestamp.fromDate(cutoff))
      .get();

    const promises = snap.docs.map(async (doc) => {
      const order = doc.data();
      await this.cancelOrderWithSlotRecovery(doc.id, order, 'timeout');
    });

    await Promise.all(promises);
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

    // usedSlots 복구
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
