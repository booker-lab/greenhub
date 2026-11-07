import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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

// 손님 결제 확인 요청: 같은 주문의 PortOne 조회 간격 하한. PortOne 조회 시간 상한(10초)과 같게 두어
// 앞선 조회가 끝나기 전에 같은 주문을 또 조회하지 않게 한다.
export const ORDER_PAYMENT_CHECK_MIN_INTERVAL_MS = 10_000;
const ORDER_PAYMENT_CHECK_FIELD = 'paymentCheckRequestedAtMs';
const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * 손님 결제 확인 요청 결과.
 * - not_pending: 이미 확정·취소된 주문이라 PortOne을 조회하지 않았다.
 * - throttled: 같은 주문을 방금 조회해 이번에는 조회하지 않았다.
 * - not_paid: PortOne이 아직 결제 완료가 아니라고 답해 아무것도 바꾸지 않았다.
 * - lookup_failed: PortOne 조회가 실패·시간 초과돼 아무것도 바꾸지 않았다.
 * - finalized: PortOne이 PAID라 기존 결제 확정 경로를 거쳤다.
 */
export type OrderPaymentCheckResult =
  | 'not_pending'
  | 'throttled'
  | 'not_paid'
  | 'lookup_failed'
  | 'finalized';

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

  /**
   * 결제 완료 화면이 기다리는 동안 손님(주문 당사자)이 부르는 결제 확인.
   * 웹훅이 늦거나 빠져도 PortOne이 이미 PAID라고 답하면 웹훅·scheduler와 같은
   * finalizePaidOrder로 확정한다. PAID가 아니면 아무것도 바꾸지 않는다(취소는 15분 scheduler만 한다).
   */
  async checkOrderPayment(
    orderId: string,
    requesterId: string,
  ): Promise<{ status: string; result: OrderPaymentCheckResult }> {
    if (!ORDER_ID_PATTERN.test(orderId)) throw new NotFoundException('주문을 찾을 수 없습니다.');
    const orderRef = this.firestore.doc(`orders/${orderId}`);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) throw new NotFoundException('주문을 찾을 수 없습니다.');
    const order = orderSnap.data() as Record<string, any>;
    if (!requesterId || order['userId'] !== requesterId) throw new ForbiddenException();
    if (order['status'] !== 'PENDING') {
      return { status: String(order['status']), result: 'not_pending' };
    }

    // PENDING 확인과 조회 시각 기록을 한 트랜잭션에서 해 간격 하한을 여러 요청·여러 서버에서 지킨다.
    const claim = await this.firestore.runTransaction(
      async (tx): Promise<{ status: string; result?: OrderPaymentCheckResult }> => {
        const freshSnap = await tx.get(orderRef);
        const fresh = freshSnap.exists ? (freshSnap.data() as Record<string, any>) : null;
        if (!fresh || fresh['status'] !== 'PENDING') {
          return { status: String(fresh?.['status'] ?? 'PENDING'), result: 'not_pending' };
        }
        const now = Date.now();
        const lastRequestedAt = fresh[ORDER_PAYMENT_CHECK_FIELD];
        if (
          typeof lastRequestedAt === 'number' &&
          now - lastRequestedAt >= 0 &&
          now - lastRequestedAt < ORDER_PAYMENT_CHECK_MIN_INTERVAL_MS
        ) {
          return { status: 'PENDING', result: 'throttled' };
        }
        tx.update(orderRef, { [ORDER_PAYMENT_CHECK_FIELD]: now });
        return { status: 'PENDING' };
      },
    );
    if (claim.result) return { status: claim.status, result: claim.result };

    let paymentData: Awaited<ReturnType<PortoneClient['getPayment']>>;
    try {
      paymentData = await this.portone.getPayment(orderId);
    } catch (error) {
      // 결제창이 아직 진행 중이면 PortOne에 결제가 없을 수 있다. 일시 오류·시간 초과도 주문을 바꾸지 않는다.
      // 운영 확인 기록(PAYMENT_LOOKUP_FAILED)은 15분 scheduler의 최종 조회만 남긴다.
      if (
        error instanceof PortoneError &&
        error.status === 404 &&
        error.type === 'PAYMENT_NOT_FOUND'
      ) {
        return { status: 'PENDING', result: 'not_paid' };
      }
      this.logPaymentCheckError(orderId, error);
      return { status: 'PENDING', result: 'lookup_failed' };
    }
    if (paymentData.status !== 'PAID') return { status: 'PENDING', result: 'not_paid' };

    await this.finalization.finalizePaidOrder(orderId, paymentData);
    const latest = (await orderRef.get()).data() as Record<string, any> | undefined;
    return { status: String(latest?.['status'] ?? 'PENDING'), result: 'finalized' };
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

  async processRefundByOrderId(
    orderId: string,
    reason: string,
    options?: { verifyProviderFirst?: boolean },
  ): Promise<void> {
    await this.refunds.refundByOrderId(orderId, reason, options);
  }

  /** 주문 상세 화면의 재배송비 결제 확인(주문 당사자만). */
  async checkOrderChargePayment(orderId: string, requesterId: string) {
    return this.orderChargePayments.checkOrderChargePayment(orderId, requesterId);
  }

  /** 주문의 재배송비를 환불하고 아직 PAID로 남은 재배송비 수를 돌려준다(0이어야 취소 완료 가능). */
  async refundOrderChargesByOrderId(
    orderId: string,
    reason: string,
  ): Promise<{ unsettledCount: number }> {
    return this.orderChargePayments.refundByOrderId(orderId, reason);
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

    await this.issueWriter.createOrMergeIssue(
      {
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
      },
      undefined,
      // 같은 결제사 이벤트의 재전송은 새 사건이 아니다. 관리자가 확인하고 닫은 기록을 다시 열면
      // 정산 확정·지급이 다시 보류되고 알림이 또 간다. 새 취소·분쟁은 cancellationId·이벤트 유형이
      // 달라 다른 기록이 된다.
      { keepClosed: true },
    );
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

  private logPaymentCheckError(orderId: string, error: unknown) {
    const label =
      error instanceof PortoneError
        ? `status=${error.status} type=${error.type}`
        : `networkError=${error instanceof Error ? error.message.replace(/[\r\n\t]/g, ' ').slice(0, 200) : 'unknown'}`;
    this.logger.warn(`[PaymentCheck] 손님 결제 확인 조회 보류 orderId=${orderId} ${label}`);
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
