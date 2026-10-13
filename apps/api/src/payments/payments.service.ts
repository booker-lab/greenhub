import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FirestoreService } from '../firestore/firestore.service';
import { OperationIssueWriterService } from '../operations/operation-issue-writer.service';
import type { PortoneWebhookDto } from './dto/portone-webhook.dto';
import { OrderChargePaymentService } from './order-charge-payment.service';
import { PaymentFinalizationService } from './payment-finalization.service';
import { PaymentRefundService } from './payment-refund.service';
import { PortoneClient, PortoneError } from './portone.client';

const REFUNDABLE_STATUSES = ['ACCEPTED', 'RECRUITING', 'CONFIRMED', 'PREPARING'];

// 결제가 확정된 주문에 결제사 쪽에서 생긴 되돌림(콘솔 직접 취소·부분 취소·분쟁)을 알리는 웹훅.
// PENDING이 아닌 주문에서는 조용히 무시하지 않고 운영 확인 기록으로 남긴다.
const PROVIDER_CANCELLATION_EVENTS = new Set([
  'Transaction.Cancelled',
  'Transaction.PartialCancelled',
  'Transaction.CancelPending',
]);
const PROVIDER_DISPUTE_EVENTS = new Set(['Transaction.DisputeCreated']);
const PROVIDER_REVERSAL_ISSUE_TYPE = 'PROVIDER_REVERSAL_DETECTED';

// 매분 도는 PENDING 정리 cron의 PortOne 동시 호출 수.
const CLEANUP_CONCURRENCY = 4;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly firestore: FirestoreService,
    private readonly portone: PortoneClient,
    private readonly finalization: PaymentFinalizationService,
    private readonly refunds: PaymentRefundService,
    private readonly orderChargePayments: OrderChargePaymentService,
    private readonly issueWriter: OperationIssueWriterService,
  ) {}

  // 같은 프로세스 안에서 이전 cleanup 실행이 끝나기 전에 다음 실행이 겹치지 않게 막는다.
  private cleanupInFlight = false;

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
      if (
        order['status'] !== 'PENDING' &&
        (PROVIDER_CANCELLATION_EVENTS.has(dto.type) || PROVIDER_DISPUTE_EVENTS.has(dto.type))
      ) {
        return this.reconcileProviderReversal(orderId, dto);
      }
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
    if (this.cleanupInFlight) {
      this.logger.warn(
        '[PaymentsScheduler] 이전 PENDING 정리가 아직 진행 중이라 이번 실행을 건너뜁니다.',
      );
      return;
    }
    this.cleanupInFlight = true;
    try {
      await this.runCleanupPendingOrders();
    } finally {
      this.cleanupInFlight = false;
    }
  }

  private async runCleanupPendingOrders() {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
    const snap = await this.firestore
      .collection('orders')
      .where('status', '==', 'PENDING')
      .where('createdAt', '<', this.firestore.Timestamp.fromDate(cutoff))
      .get();
    if (snap.empty) return;

    await runWithConcurrency(snap.docs, CLEANUP_CONCURRENCY, async (doc) => {
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
    });
    this.logger.log(`[PaymentsScheduler] PENDING 타임아웃 확인 ${snap.size}건`);
  }

  /**
   * 결제가 확정된(PENDING이 아닌) 주문에 결제사 쪽 취소·부분 취소·분쟁 웹훅이 오면
   * 운영 확인 기록을 남긴다. 주문·결제·정산 문서는 바꾸지 않는다(정산 보류 상태가 아직 없다).
   * 같은 웹훅이 다시 와도 같은 idempotencyKey로 하나의 기록에 합쳐진다.
   */
  private async reconcileProviderReversal(orderId: string, dto: PortoneWebhookDto) {
    const orderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!orderSnap.exists) return { ok: true };
    const order = orderSnap.data() as Record<string, any>;
    const orderStatus = typeof order['status'] === 'string' ? order['status'] : null;
    // PENDING은 기존 결제 실패 정리가 맡는다.
    if (!orderStatus || orderStatus === 'PENDING') return { ok: true };

    const isDispute = PROVIDER_DISPUTE_EVENTS.has(dto.type);
    const paymentSnap = await this.firestore.doc(`payments/${orderId}`).get();
    const payment = paymentSnap.exists ? (paymentSnap.data() as Record<string, any>) : null;
    if (!isDispute) {
      // 우리 쪽 취소·환불 흐름이 만든 취소 웹훅은 정상 결과이므로 기록하지 않는다.
      if (orderStatus === 'CANCELLED') return { ok: true, reason: 'order_cancelled' };
      if (
        payment?.['status'] === 'CANCELLED' ||
        payment?.['refundedAt'] ||
        payment?.['refundClaim'] ||
        order['finalizationRefund']
      ) {
        return { ok: true, reason: 'refund_owned_locally' };
      }
    }

    const providerStatus = await this.lookupProviderStatus(orderId);
    const settlementSnap = await this.firestore.doc(`settlements/${orderId}`).get();
    const settlementStatus = settlementSnap.exists
      ? ((settlementSnap.data() as Record<string, unknown>)['status'] ?? null)
      : null;
    const cancellationId = dto.data.cancellationId ?? null;

    await this.issueWriter.createOrMergeIssue({
      storeId: String(order['storeId'] ?? ''),
      orderId,
      paymentId: orderId,
      type: PROVIDER_REVERSAL_ISSUE_TYPE,
      severity: 'critical',
      title: isDispute ? '결제사 분쟁 접수' : '결제사 쪽 결제 취소 감지',
      message: isDispute
        ? '결제가 확정된 주문에 결제사 분쟁이 접수됐습니다. 정산 지급 전에 PortOne 콘솔에서 확인하세요.'
        : '결제가 확정된 주문이 결제사 쪽에서 취소됐습니다. 정산 지급 전에 PortOne 콘솔에서 확인하세요.',
      idempotencyKey: `provider-reversal:${orderId}:${dto.type}:${cancellationId ?? '-'}`,
      latestSnapshot: {
        orderStatus,
        paymentStatus: typeof payment?.['status'] === 'string' ? payment['status'] : null,
        providerStatus,
        providerEvent: dto.type,
        settlementStatus,
        failureStage: 'provider_reversal',
      },
    });
    this.logger.warn(
      `[PaymentsWebhook] 결제사 되돌림 감지 orderId=${orderId} event=${dto.type} orderStatus=${orderStatus} providerStatus=${providerStatus} settlementStatus=${String(settlementStatus)}`,
    );
    return { ok: true, reason: 'provider_reversal_recorded' };
  }

  private async lookupProviderStatus(orderId: string): Promise<string> {
    try {
      const paymentData = await this.portone.getPayment(orderId);
      return typeof paymentData.status === 'string' ? paymentData.status.slice(0, 40) : 'UNKNOWN';
    } catch (error) {
      const label =
        error instanceof PortoneError
          ? `status=${error.status} type=${error.type}`
          : 'networkError';
      this.logger.error(`[PaymentsWebhook] 되돌림 확인 결제 조회 실패 orderId=${orderId} ${label}`);
      return 'LOOKUP_FAILED';
    }
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

// 고정 개수 worker가 items를 순서대로 나눠 처리한다. 한 건이 실패해도 나머지는 끝까지 처리하고,
// 모든 worker가 끝난 뒤 첫 오류를 다시 던진다(실행 중 겹침 방지 guard가 일찍 풀리지 않게).
async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  handler: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let firstError: { error: unknown } | null = null;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      try {
        await handler(item);
      } catch (error) {
        firstError ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (firstError) throw (firstError as { error: unknown }).error;
}
