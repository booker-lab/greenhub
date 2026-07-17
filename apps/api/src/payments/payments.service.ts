import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FirestoreService } from '../firestore/firestore.service';
import type { PortoneWebhookDto } from './dto/portone-webhook.dto';
import { OrderChargePaymentService } from './order-charge-payment.service';
import { PaymentFinalizationService } from './payment-finalization.service';
import { PaymentRefundService } from './payment-refund.service';
import { PortoneClient, PortoneError } from './portone.client';

const REFUNDABLE_STATUSES = ['ACCEPTED', 'RECRUITING', 'CONFIRMED', 'PREPARING'];

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly firestore: FirestoreService,
    private readonly portone: PortoneClient,
    private readonly finalization: PaymentFinalizationService,
    private readonly refunds: PaymentRefundService,
    private readonly orderChargePayments: OrderChargePaymentService,
  ) {}

  async handleWebhook(dto: PortoneWebhookDto) {
    const orderId = dto.data.paymentId;
    if (this.orderChargePayments.isOrderChargePaymentId(orderId)) {
      return this.orderChargePayments.handleWebhook(dto.type, orderId);
    }
    const orderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!orderSnap.exists) return { ok: false, reason: 'order_not_found' };
    const order = orderSnap.data() as Record<string, any>;

    if (dto.type === 'Transaction.Ready') {
      return { ok: true, reason: 'transaction_ready_ignored' };
    }
    if (dto.type !== 'Transaction.Paid') {
      await this.finalization.cancelPendingOrder(orderId, 'payment_failed');
      return { ok: true };
    }

    const paymentData = await this.portone.getPayment(orderId);
    if (order['status'] === 'CANCELLED' && paymentData.status !== 'PAID') {
      return { ok: true, reason: 'payment_not_paid' };
    }
    return this.finalization.finalizePaidOrder(orderId, paymentData);
  }

  async getPayment(paymentId: string, requesterId: string) {
    const snap = await this.firestore.doc(`payments/${paymentId}`).get();
    if (!snap.exists) throw new BadRequestException('결제 내역을 찾을 수 없습니다.');
    const payment = snap.data()!;
    if (payment['userId'] === requesterId) return payment;

    const userData = (await this.firestore.doc(`users/${requesterId}`).get()).data();
    if (userData?.['role'] === 'admin') return payment;
    if (userData?.['role'] === 'seller' && userData?.['storeId'] === payment['storeId']) {
      return payment;
    }
    throw new ForbiddenException();
  }

  async getPaymentByOrder(storeId: string, orderId: string, requesterId: string) {
    const orderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!orderSnap.exists || orderSnap.data()!['storeId'] !== storeId) {
      throw new BadRequestException('주문을 찾을 수 없습니다.');
    }
    const userData = (await this.firestore.doc(`users/${requesterId}`).get()).data();
    if (userData?.['role'] !== 'admin' && userData?.['storeId'] !== storeId) {
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

  async refundOrder(storeId: string, orderId: string, requesterId: string, reason?: string) {
    const orderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!orderSnap.exists || orderSnap.data()!['storeId'] !== storeId) {
      throw new BadRequestException('주문을 찾을 수 없습니다.');
    }
    const order = orderSnap.data()!;
    if (!REFUNDABLE_STATUSES.includes(order['status'])) {
      throw new ForbiddenException(`${order['status']} 상태에서는 환불할 수 없습니다.`);
    }
    this.logger.log(
      `payment.refunded orderId=${orderId} storeId=${storeId} requesterId=${requesterId} reason=${reason ?? '판매자 취소'}`,
    );
    await this.refunds.refundByOrderId(orderId, reason ?? '판매자 취소');
    return { ok: true };
  }

  async processRefundByOrderId(orderId: string, reason: string): Promise<void> {
    await this.refunds.refundByOrderId(orderId, reason);
  }

  async refundOrderChargesByOrderId(orderId: string, reason: string): Promise<void> {
    await this.orderChargePayments.refundByOrderId(orderId, reason);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async cleanupPendingOrders() {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
    const snap = await this.firestore
      .collection('orders')
      .where('status', '==', 'PENDING')
      .where('createdAt', '<', this.firestore.Timestamp.fromDate(cutoff))
      .get();
    if (snap.empty) return;

    await Promise.all(
      snap.docs.map(async (doc) => {
        try {
          const paymentData = await this.portone.getPayment(doc.id);
          if (paymentData.status === 'PAID') {
            await this.finalization.finalizePaidOrder(doc.id, paymentData);
            return;
          }
          await this.finalization.cancelPendingOrder(doc.id, 'timeout');
        } catch (error) {
          if (
            error instanceof PortoneError &&
            error.status === 404 &&
            error.type === 'PAYMENT_NOT_FOUND'
          ) {
            await this.finalization.cancelPendingOrder(doc.id, 'timeout');
            return;
          }
          await this.finalization.recordPaymentLookupFailure(doc.id, error);
          this.logCleanupError(doc.id, error);
        }
      }),
    );
    this.logger.log(`[PaymentsScheduler] PENDING 타임아웃 확인 ${snap.size}건`);
  }

  private logCleanupError(orderId: string, error: unknown) {
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
}
