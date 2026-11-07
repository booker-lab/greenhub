import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FirestoreService } from '../firestore/firestore.service';
import { OperationIssueWriterService } from '../operations/operation-issue-writer.service';
import { isOrderCancelledOrCancelling } from '../orders/order-cancellation-state';
import {
  isChargeForCurrentHold,
  isCurrentRedeliveryChargeLinked,
  isCurrentRedeliveryPaymentRequired,
} from '../orders/redelivery-resume-gate';
import {
  PortoneClient,
  PortoneError,
  createPortoneRefundIdempotencyKey,
} from './portone.client';
import {
  findPortonePaymentContextMismatch,
  type PortonePaymentContextPolicy,
  resolvePortonePaymentContextPolicyFromConfig,
} from './portone-payment-context';

type PaymentData = Awaited<ReturnType<PortoneClient['getPayment']>>;

const PAYMENT_ID_PREFIX = 'order-charge-';
const REFUND_CLAIM_MS = 5 * 60 * 1000;
const REFUND_OWNER = 'order-charge-refund';
const CANCELLED_ORDER_CHARGE_REFUND_REASON = '주문 취소에 따른 재배송비 환불';
const UNNEEDED_CHARGE_REFUND_REASON = '재배송이 필요 없어진 재배송비 결제 환불';
// 재배송비 결제가 실제로 필요한 주문 상태(보류 중이거나 결제 후 재개 대기).
const CHARGE_PAYABLE_ORDER_STATUSES = ['DELIVERY_HELD', 'PREPARING'];

// 웹훅 밖 수렴: 오래된 PENDING 재배송비를 PortOne에 직접 물어 확정한다(본 결제 15분 정리와 같은 관례).
const PENDING_CHARGE_MIN_AGE_MS = 15 * 60 * 1000;
// 매분 실행의 PortOne 동시 호출 수와 한 번에 조회할 청구 수 상한.
const PENDING_CHARGE_CONCURRENCY = 4;
const PENDING_CHARGE_BATCH_LIMIT = 50;
// 같은 청구를 다시 조회하는 간격. 결제창을 다시 열 수 있는 PENDING이 오래 남아도 PortOne 호출이
// 매분 쌓이지 않게, 만든 지 하루가 지난 청구는 한 시간에 한 번만 본다.
const PENDING_CHARGE_RECHECK_MS = 5 * 60 * 1000;
const PENDING_CHARGE_SLOW_RECHECK_AFTER_MS = 24 * 60 * 60 * 1000;
const PENDING_CHARGE_SLOW_RECHECK_MS = 60 * 60 * 1000;
// 필요 없어진 청구를 FAILED로 닫기 전에 기다리는 최소 나이. 막 열린 결제창이 끝날 시간을 남긴다.
const UNNEEDED_CHARGE_FAIL_MIN_AGE_MS = 24 * 60 * 60 * 1000;
// 조회 시각(epoch ms). 여러 서버·겹친 실행이 같은 청구를 간격 안에 다시 조회하지 않게 트랜잭션으로 남긴다.
const PROVIDER_CHECK_FIELD = 'providerCheckedAtMs';
// 돈이 PortOne에 잡혀 있지 않은 원격 상태. 이때만 필요 없어진 청구를 FAILED로 닫는다.
// CANCELLED(결제 뒤 결제사 쪽 취소)·가상계좌 발급·결제 대기 등은 바꾸지 않고 다음 조회로 남긴다.
const PROVIDER_NO_MONEY_STATUSES = new Set(['READY', 'FAILED']);

type MarkFailedOptions = {
  // 웹훅 밖 수렴 전용: 만든 지 충분히 지났고 주문에 더는 필요 없는 청구만 FAILED로 닫는다.
  onlyIfUnneededCreatedBeforeMs?: number;
};

/**
 * 웹훅 밖 재배송비 확인 한 건의 결과.
 * - skipped: 이미 확정됐거나 간격 안에 다른 실행이 조회해 이번에는 조회하지 않았다.
 * - finalized: PortOne이 PAID라 웹훅과 같은 finalizePaid를 거쳤다.
 * - failed: 주문에 필요 없어진 오래된 청구이고 PortOne에 돈이 없어 기존 markFailed로 닫았다.
 * - left_pending: PAID가 아니어서 그대로 두었다(손님이 같은 결제를 다시 시도할 수 있다).
 * - lookup_failed: PortOne 조회 실패·시간 초과. 상태를 바꾸지 않았다.
 * - finalize_failed: 확정·환불 경로가 오류로 끝났다(검증 불일치·환불 진행 중 등).
 */
export type PendingChargeCheckResult =
  | 'skipped'
  | 'finalized'
  | 'failed'
  | 'left_pending'
  | 'lookup_failed'
  | 'finalize_failed';

type ChargeRefundClaimStatus = 'CLAIMED' | 'UNKNOWN';

type ChargeRefundPayload = {
  chargeId: string;
  orderId: string;
  storeId: string;
  portonePaymentId: string;
  amount: number;
};

type ChargeRefundClaimOutcome =
  | { outcome: 'claimed_fresh'; token: string; providerKey: string; payload: ChargeRefundPayload }
  | { outcome: 'claimed_retry'; token: string; providerKey: string; payload: ChargeRefundPayload }
  | { outcome: 'already_handled' }
  // 다른 시도가 아직 만료되지 않은 CLAIMED claim을 쥐고 있고 환불은 끝나지 않았다.
  | { outcome: 'claim_in_flight' }
  | { outcome: 'doc_missing' };

// 환불 시도 결과. claim_in_flight는 다른 시도가 claim을 쥔 채 환불을 끝내지 않은 상태다.
type ChargeRefundRunResult = 'handled' | 'claim_in_flight';

@Injectable()
export class OrderChargePaymentService {
  private readonly logger = new Logger(OrderChargePaymentService.name);
  private readonly paymentContextPolicy: PortonePaymentContextPolicy;
  // 같은 프로세스 안에서 이전 확인 실행이 끝나기 전에 다음 실행이 겹치지 않게 막는다.
  private pendingChargeCheckInFlight = false;

  constructor(
    private readonly firestore: FirestoreService,
    private readonly portone: PortoneClient,
    @Optional() private readonly issueWriter?: OperationIssueWriterService,
    // Nest DI는 전역 ConfigService를 항상 주입한다. 직접 생성하는 테스트만 process.env를 쓴다.
    @Inject(ConfigService) config?: ConfigService,
  ) {
    this.paymentContextPolicy = resolvePortonePaymentContextPolicyFromConfig(config);
  }

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

  /**
   * 웹훅이 빠져도 재배송비 결제가 PENDING에 남지 않게 하는 매분 확인.
   * 15분보다 오래된 PENDING 청구를 PortOne에 직접 조회해 PAID면 웹훅과 같은 finalizePaid로 확정한다
   * (필요 없어진 결제면 기존 로직대로 기록 뒤 환불). PAID가 아니면 손님이 같은 결제를 다시 시도할 수
   * 있게 그대로 두고, 주문에 더는 필요 없는 오래된 청구만 기존 markFailed로 닫는다.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async reconcilePendingCharges() {
    if (this.pendingChargeCheckInFlight) {
      this.logger.warn(
        '[OrderChargeScheduler] 이전 재배송비 확인이 아직 진행 중이라 이번 실행을 건너뜁니다.',
      );
      return;
    }
    this.pendingChargeCheckInFlight = true;
    try {
      await this.runReconcilePendingCharges();
    } finally {
      this.pendingChargeCheckInFlight = false;
    }
  }

  private async runReconcilePendingCharges() {
    const nowMs = Date.now();
    const cutoff = new Date(nowMs - PENDING_CHARGE_MIN_AGE_MS);
    const snap = await this.firestore
      .collection('orderCharges')
      .where('status', '==', 'PENDING')
      .where('createdAt', '<', this.firestore.Timestamp.fromDate(cutoff))
      .get();
    if (snap.empty) return;

    // 조회한 적 없는 청구부터, 그다음 오래전에 조회한 청구 순으로 상한만큼만 본다.
    const due = snap.docs
      .map((doc: any) => ({ id: String(doc.id), data: doc.data() as Record<string, any> }))
      .filter(({ id, data }) => this.isPendingChargeDue(id, data, nowMs))
      .sort((a, b) => this.providerCheckedAtMs(a.data) - this.providerCheckedAtMs(b.data))
      .slice(0, PENDING_CHARGE_BATCH_LIMIT);
    if (due.length === 0) return;

    const results = await mapWithConcurrency(due, PENDING_CHARGE_CONCURRENCY, ({ id }) =>
      this.reconcilePendingCharge(id),
    );
    const counts = results.reduce<Record<string, number>>((acc, result) => {
      acc[result] = (acc[result] ?? 0) + 1;
      return acc;
    }, {});
    this.logger.log(
      `[OrderChargeScheduler] 재배송비 PENDING 확인 ${due.length}건(대상 ${snap.size}건) ${Object.entries(
        counts,
      )
        .map(([key, value]) => `${key}=${value}`)
        .join(' ')}`,
    );
  }

  /** 오래된 PENDING 청구 한 건을 PortOne 조회로 수렴시킨다. 오류를 밖으로 던지지 않는다. */
  async reconcilePendingCharge(chargeId: string): Promise<PendingChargeCheckResult> {
    const paymentId = `${PAYMENT_ID_PREFIX}${chargeId}`;
    const chargeRef = this.firestore.doc(`orderCharges/${chargeId}`);
    // PENDING 확인과 조회 시각 기록을 한 트랜잭션에서 해 겹친 실행·여러 서버가 같은 청구를
    // 간격 안에 다시 조회하지 않게 한다. status·updatedAt은 건드리지 않는다.
    const claim: { charge: Record<string, any> } | null = await this.firestore.runTransaction(
      async (tx) => {
        const snap = await tx.get(chargeRef);
        if (!snap.exists) return null;
        const charge = snap.data() as Record<string, any>;
        const nowMs = Date.now();
        if (!this.isPendingChargeDue(chargeId, charge, nowMs)) return null;
        tx.update(chargeRef, { [PROVIDER_CHECK_FIELD]: nowMs });
        return { charge };
      },
    );
    if (!claim) return 'skipped';

    let paymentData: PaymentData;
    try {
      paymentData = await this.portone.getPayment(paymentId);
    } catch (error) {
      if (
        error instanceof PortoneError &&
        error.status === 404 &&
        error.type === 'PAYMENT_NOT_FOUND'
      ) {
        // 결제창을 연 적이 없는 청구다. 돈이 없으므로 PAID가 아닌 경우와 같게 다룬다.
        return this.settleUnpaidPendingCharge(chargeId, paymentId, 'NOT_FOUND');
      }
      this.logPendingChargeError('결제 조회 보류', chargeId, error);
      await this.recordChargeLookupFailure(chargeId, claim.charge, error);
      return 'lookup_failed';
    }

    if (paymentData.status !== 'PAID') {
      return this.settleUnpaidPendingCharge(chargeId, paymentId, paymentData.status);
    }
    try {
      // 웹훅과 같은 확정 경로다. 상태·식별자·금액 검증, 필요 없는 결제의 기록 뒤 환불,
      // 그리고 상점·통화·채널 검증이 그대로 적용되고 웹훅과 겹쳐도 트랜잭션 상태 확인으로 한 번만 반영된다.
      await this.finalizePaid(chargeId, paymentId, paymentData);
      return 'finalized';
    } catch (error) {
      this.logPendingChargeError('확정 보류', chargeId, error);
      return 'finalize_failed';
    }
  }

  private async settleUnpaidPendingCharge(
    chargeId: string,
    paymentId: string,
    providerStatus: string,
  ): Promise<PendingChargeCheckResult> {
    if (providerStatus !== 'NOT_FOUND' && !PROVIDER_NO_MONEY_STATUSES.has(providerStatus)) {
      return 'left_pending';
    }
    try {
      const result = await this.markFailed(chargeId, paymentId, {
        onlyIfUnneededCreatedBeforeMs: Date.now() - UNNEEDED_CHARGE_FAIL_MIN_AGE_MS,
      });
      return result['status'] === 'FAILED' ? 'failed' : 'left_pending';
    } catch (error) {
      this.logPendingChargeError('실패 기록 보류', chargeId, error);
      return 'left_pending';
    }
  }

  private isPendingChargeDue(chargeId: string, charge: Record<string, any>, nowMs: number) {
    if (
      charge['status'] !== 'PENDING' ||
      charge['type'] !== 'REDELIVERY_FEE' ||
      charge['portonePaymentId'] !== `${PAYMENT_ID_PREFIX}${chargeId}`
    ) {
      return false;
    }
    const createdAtMs = toMillis(charge['createdAt']);
    if (createdAtMs === null || nowMs - createdAtMs < PENDING_CHARGE_MIN_AGE_MS) return false;
    const interval =
      nowMs - createdAtMs >= PENDING_CHARGE_SLOW_RECHECK_AFTER_MS
        ? PENDING_CHARGE_SLOW_RECHECK_MS
        : PENDING_CHARGE_RECHECK_MS;
    return nowMs - this.providerCheckedAtMs(charge) >= interval;
  }

  private providerCheckedAtMs(charge: Record<string, any>) {
    const value = charge[PROVIDER_CHECK_FIELD];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  /**
   * 본 결제 scheduler와 같은 PAYMENT_LOOKUP_FAILED 운영 기록. 청구마다 같은 키로 합쳐지고,
   * 새로 열릴 때만 알린다. 같은 청구는 조회 간격(5분·1시간)마다만 다시 조회하므로 매분 쌓이지 않는다.
   */
  private async recordChargeLookupFailure(
    chargeId: string,
    charge: Record<string, any>,
    error: unknown,
  ) {
    if (!this.issueWriter) return;
    try {
      await this.issueWriter.createOrMergeIssue({
        storeId: String(charge['storeId'] ?? ''),
        orderId: String(charge['orderId'] ?? ''),
        paymentId: null,
        chargeId,
        type: 'PAYMENT_LOOKUP_FAILED',
        severity: 'critical',
        title: '재배송비 결제 조회 실패',
        message: '재배송비 결제 상태를 확인하지 못해 운영 확인이 필요합니다.',
        idempotencyKey: `charge-payment-lookup-failed:${chargeId}`,
        latestSnapshot: {
          chargeStatus: 'PENDING',
          failureStage: 'charge_payment_lookup',
          providerStatus: error instanceof PortoneError ? error.status : null,
          providerType:
            error instanceof PortoneError ? String(error.type).slice(0, 80) : 'networkError',
        },
      });
    } catch (recordError) {
      this.logPendingChargeError('운영 기록 실패', chargeId, recordError);
    }
  }

  private logPendingChargeError(stage: string, chargeId: string, error: unknown) {
    const label =
      error instanceof PortoneError
        ? `status=${error.status} type=${error.type}`
        : `error=${error instanceof Error ? error.message.replace(/[\r\n\t]/g, ' ').slice(0, 300) : 'unknown'}`;
    this.logger.error(`[OrderChargeScheduler] ${stage} chargeId=${chargeId} ${label}`);
  }

  /**
   * 주문의 PAID 재배송비를 환불하고, 끝난 뒤에도 PAID로 남은 재배송비 수를 돌려준다.
   * 다른 시도가 환불 중(claim_in_flight)이거나 결과가 불확실해 멈춘(UNKNOWN) 청구는 PAID로 남으므로,
   * 호출 측은 이 값이 0일 때만 주문 취소를 완료한다.
   */
  async refundByOrderId(orderId: string, reason: string): Promise<{ unsettledCount: number }> {
    const paidCharges = () =>
      this.firestore
        .collection('orderCharges')
        .where('orderId', '==', orderId)
        .where('status', '==', 'PAID')
        .get();
    const snap = await paidCharges();
    if (snap.docs.length === 0) return { unsettledCount: 0 };
    await Promise.all(snap.docs.map((doc) => this.refundCharge(doc.ref, reason)));
    const remaining = await paidCharges();
    return { unsettledCount: remaining.docs.length };
  }

  private async finalizePaid(chargeId: string, paymentId: string, paymentData: PaymentData) {
    const chargeRef = this.firestore.doc(`orderCharges/${chargeId}`);
    // 운영에서 LIVE 채널·KRW가 아닌 결제는 금액 불일치와 같이 확정하지 않고 청구를 그대로 둔다.
    const contextMismatch = findPortonePaymentContextMismatch(
      paymentData,
      this.paymentContextPolicy,
    );
    if (contextMismatch) {
      this.logger.warn(
        `재배송비 결제 상점·통화·채널 불일치 paymentId=${paymentId} field=${contextMismatch.field} actual=${contextMismatch.actual ?? 'none'}`,
      );
    }
    // Retry purity: the post-transaction decision must come only from the
    // committed attempt's return value. An outer `let result` would leak an
    // aborted attempt's decision across OCC retry.
    const result: Record<string, unknown> & { refundReason?: string } =
      await this.firestore.runTransaction(async (tx) => {
        const chargeSnap = await tx.get(chargeRef);
        if (!chargeSnap.exists) return { ok: false, reason: 'charge_not_found' };
        const charge = chargeSnap.data() as Record<string, any>;
        // 이미 환불까지 끝난 결제의 Transaction.Paid 재전송은 처리 완료로 답해
        // PortOne이 재시도를 멈추게 한다.
        if (charge['status'] === 'REFUNDED' || charge['refundedAt']) {
          return { ok: true, reason: 'already_processed' };
        }
        if (charge['status'] === 'PAID') {
          // A PAID charge on a cancelled/cancelling order must not stay
          // captured; a redelivered webhook resumes the claim-based refund.
          const paidOrderSnap = await tx.get(this.firestore.doc(`orders/${charge['orderId']}`));
          const paidOrder = paidOrderSnap.exists
            ? (paidOrderSnap.data() as Record<string, any>)
            : undefined;
          // 필요 없어진 결제로 기록된 청구도 환불이 끝날 때까지 웹훅 재전송이 환불을 이어 간다.
          if (isOrderCancelledOrCancelling(paidOrder)) {
            return {
              ok: true,
              reason: 'already_processed',
              refundReason: CANCELLED_ORDER_CHARGE_REFUND_REASON,
            };
          }
          return charge['unneededPaidAt']
            ? { ok: true, reason: 'already_processed', refundReason: UNNEEDED_CHARGE_REFUND_REASON }
            : { ok: true, reason: 'already_processed' };
        }
        // 실패 웹훅이 먼저 와 FAILED가 된 청구도 PortOne이 PAID를 확정하면 실제 결제다.
        if (
          !['PENDING', 'FAILED'].includes(charge['status']) ||
          charge['type'] !== 'REDELIVERY_FEE' ||
          charge['portonePaymentId'] !== paymentId ||
          paymentData.status !== 'PAID' ||
          paymentData.amount.total !== charge['amount'] ||
          contextMismatch !== null
        ) {
          throw new BadRequestException('재배송비 결제 정보가 일치하지 않습니다.');
        }

        const orderSnap = await tx.get(this.firestore.doc(`orders/${charge['orderId']}`));
        const order = orderSnap.data() as Record<string, any> | undefined;
        if (orderSnap.exists && order?.['storeId'] !== charge['storeId']) {
          throw new BadRequestException('재배송비 결제 정보가 일치하지 않습니다.');
        }
        const now = this.firestore.Timestamp.now();
        const paidUpdate = {
          status: 'PAID',
          portoneTransactionId: paymentData.transactionId,
          payMethod: paymentData.method?.type ?? null,
          paidAt: now,
          failedAt: null,
          updatedAt: now,
        };
        if (isOrderCancelledOrCancelling(order)) {
          // The customer completed payment after the order was cancelled (or
          // while cancellation is in progress). Record the provider-confirmed
          // payment and refund it instead of applying it to a cancelled order.
          tx.update(chargeRef, paidUpdate);
          return {
            ok: true,
            status: 'PAID',
            reason: 'cancelled_order_refund',
            refundReason: CANCELLED_ORDER_CHARGE_REFUND_REASON,
          };
        }
        if (
          !orderSnap.exists ||
          !CHARGE_PAYABLE_ORDER_STATUSES.includes(order?.['status']) ||
          !isCurrentRedeliveryPaymentRequired({ ...order, id: charge['orderId'] }) ||
          !isCurrentRedeliveryChargeLinked(
            { ...order, id: charge['orderId'] },
            charge,
            chargeId,
          )
        ) {
          // 승인된 돈인데 현재 보류에 필요 없는 결제다(주문 없음·보류 해소·다른 보류로 교체·배송 재개 뒤).
          // 400으로 끝내면 결제만 되고 기록·환불이 남지 않으므로 결제를 기록하고 환불한다.
          tx.update(chargeRef, { ...paidUpdate, unneededPaidAt: now });
          return {
            ok: true,
            status: 'PAID',
            reason: 'unneeded_charge_refund',
            refundReason: UNNEEDED_CHARGE_REFUND_REASON,
          };
        }
        tx.update(chargeRef, paidUpdate);
        return { ok: true, status: 'PAID' };
      });
    const { refundReason, ...response } = result;
    if (refundReason) {
      const refund = await this.refundCharge(chargeRef, refundReason);
      if (refund === 'claim_in_flight') {
        // 다른 시도가 claim을 잡은 뒤 환불 POST나 UNKNOWN 기록 전에 멈췄을 수 있다.
        // 취소 주문·필요 없어진 PAID 재배송비를 다시 훑는 다른 경로는 없으므로 200으로 끝내지 않고
        // 재시도 가능한 응답을 준다. PortOne 재전송이 claim 만료 뒤 takeover로 환불을 끝낸다.
        throw new ServiceUnavailableException(
          '재배송비 환불이 아직 끝나지 않았습니다. 잠시 후 다시 시도해 주세요.',
        );
      }
    }
    return response;
  }

  private async markFailed(chargeId: string, paymentId: string, options: MarkFailedOptions = {}) {
    // Retry purity: the post-transaction decision must come only from the
    // committed attempt's return value. An outer `let result` would leak an
    // aborted attempt's decision across OCC retry.
    const result: Record<string, unknown> =
      await this.firestore.runTransaction(async (tx) => {
        const chargeRef = this.firestore.doc(`orderCharges/${chargeId}`);
        const chargeSnap = await tx.get(chargeRef);
        if (!chargeSnap.exists) return { ok: false, reason: 'charge_not_found' };
        const charge = chargeSnap.data() as Record<string, any>;
        if (charge['portonePaymentId'] !== paymentId) {
          throw new BadRequestException('재배송비 결제 정보가 일치하지 않습니다.');
        }
        if (charge['status'] !== 'PENDING') {
          return { ok: true, reason: 'already_processed' };
        }
        if (options.onlyIfUnneededCreatedBeforeMs !== undefined) {
          // FAILED는 손님 화면에서 결제 버튼을 닫으므로(복구 필요) 현재 보류에 필요한 청구는 닫지 않는다.
          const createdAtMs = toMillis(charge['createdAt']);
          if (createdAtMs === null || createdAtMs >= options.onlyIfUnneededCreatedBeforeMs) {
            return { ok: true, reason: 'charge_too_recent' };
          }
          const orderSnap = await tx.get(this.firestore.doc(`orders/${charge['orderId']}`));
          const order = orderSnap.exists ? (orderSnap.data() as Record<string, any>) : undefined;
          if (!this.isChargePermanentlyUnneeded(order, charge, chargeId)) {
            return { ok: true, reason: 'charge_still_needed' };
          }
        }
        const now = this.firestore.Timestamp.now();
        tx.update(chargeRef, { status: 'FAILED', failedAt: now, updatedAt: now });
        return { ok: true, status: 'FAILED' };
      });
    return result;
  }

  /**
   * 다시 필요해질 수 없는 청구인지: 주문이 없거나 취소 완료됐거나, 현재 보류(해소·교체 포함)와
   * 더는 맞지 않는다. 보류 식별자(heldAt)가 바뀌거나 해소된 보류는 되돌아오지 않는다.
   */
  private isChargePermanentlyUnneeded(
    order: Record<string, any> | undefined,
    charge: Record<string, any>,
    chargeId: string,
  ) {
    if (!order) return true;
    if (order['status'] === 'CANCELLED') return true;
    return !isChargeForCurrentHold({ ...order, id: charge['orderId'] }, charge, chargeId);
  }

  private async refundCharge(chargeRef: any, reason: string): Promise<ChargeRefundRunResult> {
    const token = randomUUID();
    // Retry purity: only the committed attempt's return value may authorize
    // the provider refund. An outer `let claimed` would leak an aborted
    // attempt's decision across OCC retry. See
    // PAYMENT-REFUND-OCC-RETRY-PURITY-CLOSURE-01.
    const claimResult: ChargeRefundClaimOutcome = await this.firestore.runTransaction(
      async (tx): Promise<ChargeRefundClaimOutcome> => {
        const snap: any = await tx.get(chargeRef);
        if (!snap.exists) return { outcome: 'doc_missing' };
        const charge = snap.data() as Record<string, any>;
        if (charge['status'] === 'REFUNDED' || charge['refundedAt']) {
          return { outcome: 'already_handled' };
        }
        if (charge['status'] !== 'PAID') return { outcome: 'already_handled' };
        const marker = this.readRefundMarker(charge);
        const now = this.firestore.Timestamp.now();
        if (!marker) {
          // Fresh charge refund operation: fix the stable provider
          // idempotency identity now (charge namespace, disjoint from
          // payment-refund). Persisted with the claim; every UNKNOWN retry
          // POST of this operation reuses it while the local token may rotate.
          const providerKey = createPortoneRefundIdempotencyKey('order-charge-refund');
          tx.update(chargeRef, {
            refundClaim: {
              token,
              owner: REFUND_OWNER,
              status: 'CLAIMED' satisfies ChargeRefundClaimStatus,
              providerKey,
              expiresAt: Date.now() + REFUND_CLAIM_MS,
              updatedAt: now,
            },
            updatedAt: now,
          });
          // Immutable payload for the external side effect.
          return {
            outcome: 'claimed_fresh',
            token,
            providerKey,
            payload: {
              chargeId: String(charge['id'] ?? chargeRef.id ?? chargeRef.path ?? ''),
              orderId: String(charge['orderId'] ?? ''),
              storeId: String(charge['storeId'] ?? ''),
              portonePaymentId: charge['portonePaymentId'],
              amount: charge['amount'],
            },
          };
        }
        if (marker.owner !== REFUND_OWNER) return { outcome: 'already_handled' };
        if (marker.status === 'CLAIMED' && marker.expiresAt > Date.now()) {
          return { outcome: 'claim_in_flight' };
        }
        // Expired CLAIMED or any UNKNOWN: a prior attempt may already have
        // reached the provider. Take over as uncertain so a getPayment
        // readback is mandatory before any refund POST. The local token is
        // reissued, but the provider idempotency identity is preserved.
        // (Legacy claims without a key predate 28B and their prior POST, if
        // any, was unkeyed, so minting one at takeover is safe.)
        const providerKey =
          marker.providerKey ?? createPortoneRefundIdempotencyKey('order-charge-refund');
        tx.update(chargeRef, {
          refundClaim: {
            token,
            owner: REFUND_OWNER,
            status: 'UNKNOWN' satisfies ChargeRefundClaimStatus,
            providerKey,
            expiresAt: Date.now() + REFUND_CLAIM_MS,
            updatedAt: now,
          },
          updatedAt: now,
        });
        return {
          outcome: 'claimed_retry',
          token,
          providerKey,
          payload: {
            chargeId: String(charge['id'] ?? chargeRef.id ?? chargeRef.path ?? ''),
            orderId: String(charge['orderId'] ?? ''),
            storeId: String(charge['storeId'] ?? ''),
            portonePaymentId: charge['portonePaymentId'],
            amount: charge['amount'],
          },
        };
      },
    );
    if (claimResult.outcome === 'claim_in_flight') return 'claim_in_flight';
    if (claimResult.outcome === 'already_handled' || claimResult.outcome === 'doc_missing') {
      return 'handled';
    }

    const charge = claimResult.payload;
    const claimToken = claimResult.token;
    const providerKey = claimResult.providerKey;
    if (claimResult.outcome === 'claimed_retry') {
      const reconciled = await this.reconcileUncertainRefund(
        chargeRef,
        charge,
        reason,
        claimToken,
        providerKey,
      );
      if (reconciled !== 'proceed') return 'handled';
    }

    try {
      await this.portone.refund(charge.portonePaymentId, charge.amount, reason, providerKey);
    } catch (error) {
      // Provider result UNKNOWN: never blind-release; persist uncertainty and
      // fail closed so the next attempt must read back provider state first.
      await this.persistUncertainRefund(chargeRef, charge, claimToken, providerKey, 'provider_refund');
      throw error;
    }
    try {
      await this.completeRefund(chargeRef, claimToken, reason);
    } catch (error) {
      // Provider POST already started; local persistence failure leaves the
      // outcome uncertain. Never blind-release.
      await this.persistUncertainRefund(
        chargeRef,
        charge,
        claimToken,
        providerKey,
        'local_completion',
      );
      throw error;
    }
    return 'handled';
  }

  /**
   * UNKNOWN retry must reconcile via provider readback before any refund POST.
   * Terminal CANCELLED converges locally with zero additional POST.
   * Still-PAID proceeds only after a fresh ownership recheck.
   * Anything else fails closed with zero POST.
   */
  private async reconcileUncertainRefund(
    chargeRef: any,
    charge: ChargeRefundPayload,
    reason: string,
    token: string,
    providerKey: string,
  ): Promise<'proceed' | 'already_handled'> {
    let providerState: Record<string, any>;
    try {
      providerState = (await this.portone.getPayment(charge.portonePaymentId)) as Record<
        string,
        any
      >;
    } catch (error) {
      await this.persistUncertainRefund(chargeRef, charge, token, providerKey, 'provider_readback');
      throw error;
    }
    if (providerState?.['status'] === 'CANCELLED') {
      // Provider already terminal: converge locally, never re-POST.
      await this.completeRefund(chargeRef, token, reason);
      return 'already_handled';
    }
    const providerTotal = (providerState?.['amount'] as { total?: unknown } | undefined)?.[
      'total'
    ];
    const providerId = providerState?.['id'];
    if (
      providerState?.['status'] !== 'PAID' ||
      providerTotal !== charge.amount ||
      (providerId !== undefined && providerId !== charge.portonePaymentId)
    ) {
      const error = new Error('PortOne 결제 상태를 확정할 수 없어 환불을 중단합니다.');
      await this.persistUncertainRefund(chargeRef, charge, token, providerKey, 'provider_readback');
      throw error;
    }
    // Fresh ownership recheck: only the current token holder may POST.
    const stillOwner: boolean = await this.firestore.runTransaction(async (tx) => {
      const snap: any = await tx.get(chargeRef);
      if (!snap.exists) return false;
      const marker = this.readRefundMarker(snap.data() as Record<string, any>);
      return marker?.token === token && marker?.owner === REFUND_OWNER;
    });
    if (!stillOwner) return 'already_handled';
    return 'proceed';
  }

  private async completeRefund(chargeRef: any, token: string, reason: string) {
    await this.firestore.runTransaction(async (tx) => {
      const snap: any = await tx.get(chargeRef);
      if (this.readRefundMarker(snap.data() as Record<string, any>)?.token !== token) return;
      // Ownership re-verified inside the committing transaction; a stale
      // token (loser) writes nothing and authorizes no side effect.
      if ((snap.data() as Record<string, any>)?.['refundClaim']?.['token'] !== token) return;
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

  private async persistUncertainRefund(
    chargeRef: any,
    charge: ChargeRefundPayload,
    token: string,
    providerKey: string,
    failureStage: 'provider_refund' | 'provider_readback' | 'local_completion',
  ): Promise<void> {
    const now = this.firestore.Timestamp.now();
    await this.firestore.runTransaction(async (tx) => {
      const snap: any = await tx.get(chargeRef);
      if (!snap.exists) return;
      const marker = this.readRefundMarker(snap.data() as Record<string, any>);
      if (marker?.token !== token) return;
      tx.update(chargeRef, {
        refundClaim: {
          token,
          owner: REFUND_OWNER,
          status: 'UNKNOWN' satisfies ChargeRefundClaimStatus,
          // Preserve the operation's provider identity across UNKNOWN
          // persistence so every retry POST reuses the first POST's key.
          providerKey: marker?.providerKey ?? providerKey,
          expiresAt: Date.now() + REFUND_CLAIM_MS,
          updatedAt: now,
        },
        updatedAt: now,
      });
    });
    if (!this.issueWriter) return;
    // 판매자 운영 화면은 매장 범위로 기록을 보여 주므로 charge의 storeId로 남긴다.
    // 본 결제(payments) 문서가 아니므로 paymentId는 비우고 chargeId로 재시도 대상을 가리킨다.
    await this.issueWriter.createOrMergeIssue({
      storeId: charge.storeId,
      orderId: charge.orderId,
      paymentId: null,
      chargeId: charge.chargeId,
      type: 'AUTO_REFUND_FAILED',
      severity: 'critical',
      title: '재배송비 환불 결과 불명확',
      message: '재배송비 환불 요청 결과를 확정하지 못해 blind 재시도 없이 운영 확인이 필요합니다.',
      idempotencyKey: `auto-charge-refund-failed:${charge.orderId}:${charge.chargeId}`,
      latestSnapshot: {
        chargeStatus: 'UNKNOWN',
        failureStage,
      },
    });
  }

  private readRefundMarker(charge: Record<string, any>): {
    token: string;
    owner: string;
    status: ChargeRefundClaimStatus;
    providerKey: string | null;
    expiresAt: number;
  } | null {
    const marker = charge['refundClaim'] as Record<string, any> | null | undefined;
    if (!marker || typeof marker !== 'object') return null;
    if (typeof marker['token'] !== 'string' || marker['token'].length === 0) return null;
    const status: ChargeRefundClaimStatus =
      marker['status'] === 'UNKNOWN' ? 'UNKNOWN' : 'CLAIMED';
    const owner = typeof marker['owner'] === 'string' ? marker['owner'] : REFUND_OWNER;
    const providerKey =
      typeof marker['providerKey'] === 'string' && marker['providerKey'].length > 0
        ? marker['providerKey']
        : null;
    const expiresAt = typeof marker['expiresAt'] === 'number' ? marker['expiresAt'] : 0;
    return { token: marker['token'], owner, status, providerKey, expiresAt };
  }

  private chargeIdFromPaymentId(paymentId: string) {
    if (!this.isOrderChargePaymentId(paymentId)) {
      throw new BadRequestException('재배송비 결제 식별자가 올바르지 않습니다.');
    }
    return paymentId.slice(PAYMENT_ID_PREFIX.length);
  }
}

function toMillis(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis(): number }).toMillis();
  }
  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

// 고정 개수 worker가 items를 순서대로 나눠 처리하고 결과를 같은 순서로 돌려준다.
// handler는 오류를 던지지 않는다(한 건의 실패가 나머지를 막지 않게 호출부가 결과로 바꾼다).
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  handler: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await handler(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
