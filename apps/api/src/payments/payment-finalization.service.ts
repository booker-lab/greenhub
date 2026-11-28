import { randomUUID } from 'node:crypto';
import { forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../common/audit/audit.service';
import { FirestoreService } from '../firestore/firestore.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  REFUND_NOTICE_REASONS,
  refundNoticeIdempotencyKey,
} from '../notifications/refund-notice-reasons';
import { OperationIssueWriterService } from '../operations/operation-issue-writer.service';
import { OpsAlertService } from '../ops-alerts/ops-alert.service';
import {
  LatePaymentCapacityError,
  OrderCapacityService,
} from '../orders/order-capacity.service';
import { collectOptionStockLines } from '../orders/_lib/round-order-extras';
import { RetentionService } from '../retention/retention.service';
import { PortoneClient } from './portone.client';
import { PaymentRefundService } from './payment-refund.service';
import {
  findPortonePaymentContextMismatch,
  type PortonePaymentContextPolicy,
  resolvePortonePaymentContextPolicyFromConfig,
} from './portone-payment-context';
import {
  isLegacyDailyCapacityEligible,
  LegacyDailyCapacityError,
  reacquireLegacyDailyCapacityInTransaction,
  releaseLegacyDailyCapacityInTransaction,
} from './_lib/legacy-daily-capacity';
import { customerOrderLabel } from '../notifications/customer-order-label';

type PaymentData = Awaited<ReturnType<PortoneClient['getPayment']>>;
const LATE_PAYMENT_REFUND_REASON = '결제 만료 후 회차 한도 마감';
const LEGACY_LATE_PAYMENT_REFUND_REASON = '결제 만료 후 일일 배송 용량 재확보 실패';
// 새 주문 알림에 상품 줄을 이만큼까지만 싣는다(나머지는 "외 N개").
const NEW_ORDER_ALERT_MAX_ITEMS = 10;

// Payment-finalization-owned refund ownership (local to this service).
// A direct provider cancel is authorized only by a persisted claim written
// BEFORE the provider call. The claim lives on the order document because the
// internal payment document may not exist yet on these paths (provider says
// PAID, internal PAID commit never happened), so PaymentRefundService's
// `status === PAID` claim condition cannot cover them.
const FINALIZATION_REFUND_OWNER = 'payment-finalization';
const FINALIZATION_REFUND_CLAIM_MS = 5 * 60 * 1000;

type FinalizationRefundReasonClass =
  | 'amount_mismatch'
  | 'payment_context_mismatch'
  | 'late_capacity_round'
  | 'late_capacity_legacy';

type FinalizationRefundMarkerStatus = 'CLAIMED' | 'UNKNOWN' | 'REFUNDED';

type FinalizationRefundMarker = {
  token: string;
  owner: typeof FINALIZATION_REFUND_OWNER;
  reason: FinalizationRefundReasonClass;
  status: FinalizationRefundMarkerStatus;
  claimedAt: unknown;
  expiresAt: number;
  updatedAt: unknown;
};

// Retry purity: the settle decision is the COMMITTED attempt's return value.
// Outer `let` mutation inside the callback would leak an aborted attempt's
// decision to the caller (F1).
type FinalizeSettleDecision =
  | { kind: 'applied' }
  | { kind: 'refund_cancelled_order' }
  | { kind: 'noop' };

type FinalizationRefundClaimOutcome =
  | { outcome: 'claimed_fresh'; token: string }
  | { outcome: 'claimed_retry'; token: string }
  | { outcome: 'already_handled' }
  | { outcome: 'order_missing' };

@Injectable()
export class PaymentFinalizationService {
  private readonly logger = new Logger(PaymentFinalizationService.name);
  private readonly paymentContextPolicy: PortonePaymentContextPolicy;

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
    @Optional() @Inject(OpsAlertService) private readonly opsAlert?: OpsAlertService,
    // Nest DI는 전역 ConfigService를 항상 주입한다. 직접 생성하는 테스트만 process.env를 쓴다.
    @Inject(ConfigService) config?: ConfigService,
  ) {
    this.paymentContextPolicy = resolvePortonePaymentContextPolicyFromConfig(config);
    const policy = this.paymentContextPolicy;
    if (policy.requireLiveChannel && !policy.expectedStoreId) {
      this.logger.warn('PORTONE_STORE_ID가 없어 결제 확정 시 PortOne 상점 비교를 건너뜁니다.');
    }
  }

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

    const contextMismatch = findPortonePaymentContextMismatch(
      paymentData,
      this.paymentContextPolicy,
    );
    if (contextMismatch) {
      // 금액 불일치와 같은 환불·취소 경로를 그대로 쓴다.
      await this.audit.log('payment.context_mismatch', {
        userId: order['userId'] as string,
        detail: {
          orderId,
          field: contextMismatch.field,
          expected: contextMismatch.expected,
          actual: contextMismatch.actual,
        },
      });
      const refundOutcome = await this.refundWithFinalizationOwnership(
        orderId,
        paymentData,
        'payment_context_mismatch',
        '결제 상점·통화·채널 불일치',
      );
      if (refundOutcome === 'order_missing') return { ok: false, reason: 'order_not_found' };
      await this.cancelPendingOrder(orderId, 'payment_context_mismatch');
      return { ok: false, reason: 'payment_context_mismatch' };
    }

    if (paymentData.amount.total !== order['totalAmount']) {
      await this.audit.log('payment.amount_tampered', {
        userId: order['userId'] as string,
        detail: { orderId, expected: order['totalAmount'], actual: paymentData.amount.total },
      });
      const refundOutcome = await this.refundWithFinalizationOwnership(
        orderId,
        paymentData,
        'amount_mismatch',
        '금액 위변조 감지',
      );
      if (refundOutcome === 'order_missing') return { ok: false, reason: 'order_not_found' };
      await this.cancelPendingOrder(orderId, 'amount_mismatch');
      return { ok: false, reason: 'amount_mismatch' };
    }

    // Late-payment reacquisition is atomic inside the finalize transaction
    // below (reacquireAndConsumeLatePaymentInTransaction). No separate
    // reserveCheckout transaction exists here, so no intermediate external
    // HELD leak is possible on crash between reserve and consume.
    const newStatus = order['saleType'] === 'group' ? 'RECRUITING' : 'ACCEPTED';
    const now = this.firestore.Timestamp.now();
    let decision: FinalizeSettleDecision;
    try {
      decision = await this.firestore.runTransaction(async (tx): Promise<FinalizeSettleDecision> => {
        const orderRef = this.firestore.doc(`orders/${orderId}`);
        const paymentRef = this.firestore.doc(`payments/${orderId}`);
        const freshSnap = await tx.get(orderRef);
        if (!freshSnap.exists) return { kind: 'noop' };
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
            return { kind: 'refund_cancelled_order' };
          }
          return { kind: 'noop' };
        }
        if (!this.canFinalize(freshOrder)) return { kind: 'noop' };

        if (this.isLegacyTimeoutPaymentCandidate(freshOrder)) {
          await reacquireLegacyDailyCapacityInTransaction(this.firestore, tx, orderId, freshOrder);
        }
        let reservationId: string | undefined;
        if (freshOrder['schemaVersion'] === 2) {
          if (this.isRoundLatePaymentCandidate(freshOrder)) {
            // Single-commit reacquire + CONSUMED (no orphan HELD).
            // All capacity reads happen before any write in this tx.
            const lateItems = (
              freshOrder['orderItems'] as Array<Record<string, any>> | undefined
            )?.map((item) => ({
              roundItemId: item['roundItemId'],
              quantity: item['quantity'],
            }));
            if (!freshOrder['deliveryAddress'] || !lateItems?.length) {
              throw new LatePaymentCapacityError('결제 만료 후 회차 한도 마감');
            }
            const reacquired =
              await this.capacity.reacquireAndConsumeLatePaymentInTransaction(tx, {
                storeId: freshOrder['storeId'],
                roundId: freshOrder['roundId'],
                userId: freshOrder['userId'],
                orderId,
                paymentId: orderId,
                deliveryAddress: freshOrder['deliveryAddress'],
                items: lateItems,
                // 주문 스냅샷의 옵션 재고를 다시 잡는다(부족하면 회차 한도처럼 늦은 결제 환불).
                optionStock: collectOptionStockLines(
                  (freshOrder['orderItems'] as Array<Record<string, any>>).map((item) => ({
                    quantity: item['quantity'],
                    selectedOptions: item['selectedOptions'],
                  })),
                ),
              });
            reservationId = reacquired.id;
          } else {
            reservationId = freshOrder['reservationId'] as string | undefined;
            if (!reservationId) throw new Error('결제 예약 식별자가 없습니다.');
            // PortOne이 PAID를 확인했다. 웹훅이 늦거나 빠져 15분 scheduler가 확정하는 경우
            // 예약은 이미 만료 시각이 지났지만 HELD로 한도를 계속 차지하고 있으므로 그대로
            // 소비한다(해제 후 재확보하면 그 사이 다른 주문이 자리를 가져가 결제 고객이 환불된다).
            await this.capacity.consumeReservationInTransaction(tx, {
              reservationId,
              orderId,
              paymentId: orderId,
              allowLapsedHold: true,
            });
          }
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
        return { kind: 'applied' };
      });
    } catch (error) {
      if (error instanceof LatePaymentCapacityError) {
        const refundOutcome = await this.refundWithFinalizationOwnership(
          orderId,
          paymentData,
          'late_capacity_round',
          LATE_PAYMENT_REFUND_REASON,
        );
        if (refundOutcome === 'order_missing') return { ok: false, reason: 'order_not_found' };
        await this.sendLatePaymentRefundNotice(order, orderId);
        return { ok: false, reason: 'late_payment_refunded' };
      }
      if (error instanceof LegacyDailyCapacityError) {
        const refundOutcome = await this.refundWithFinalizationOwnership(
          orderId,
          paymentData,
          'late_capacity_legacy',
          LEGACY_LATE_PAYMENT_REFUND_REASON,
        );
        if (refundOutcome === 'order_missing') return { ok: false, reason: 'order_not_found' };
        await this.sendLatePaymentRefundNotice(order, orderId);
        return { ok: false, reason: 'late_payment_refunded' };
      }
      throw error;
    }
    if (decision.kind === 'refund_cancelled_order') {
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
    if (decision.kind !== 'applied') return { ok: true, reason: 'already_processed' };

    // 결제가 확정된 주문 한 건에 한 번만 오는 자리. 손님 알림을 늦추지 않게 기다리지 않는다.
    void this.sendNewOrderAlert(order, paymentData, newStatus);
    await this.notifications.sendToUser(
      order['userId'],
      newStatus === 'ACCEPTED' ? 'ORDER_ACCEPTED' : 'GROUP_JOINED',
      newStatus === 'ACCEPTED'
        ? {
            orderId: customerOrderLabel(order, orderId),
            name: this.resolveBuyerDisplayName(order),
          }
        : { orderId: customerOrderLabel(order, orderId) },
      orderId,
    );
    return { ok: true, status: newStatus };
  }

  /**
   * 운영자 텔레그램에 새 주문을 알린다. 회차 이름·상품명과 수량·결제 금액만 싣는다.
   * 주문·결제 ID, storeId, 주문번호, 손님 이름·전화·주소, 요청사항, 옵션은 싣지 않는다.
   * 알림 실패는 결제 확정 결과를 바꾸지 않는다(절대 throw하지 않음).
   */
  private async sendNewOrderAlert(
    order: Record<string, any>,
    paymentData: PaymentData,
    status: 'ACCEPTED' | 'RECRUITING',
  ) {
    if (!this.opsAlert?.enabled) return;
    try {
      const lines: string[] = [];
      const roundName = await this.readRoundName(order['roundId']);
      if (roundName) lines.push(`회차: ${roundName}`);
      const items = this.newOrderAlertItems(order);
      for (const item of items.slice(0, NEW_ORDER_ALERT_MAX_ITEMS)) {
        lines.push(`· ${item.name} × ${item.quantity}`);
      }
      if (items.length > NEW_ORDER_ALERT_MAX_ITEMS) {
        lines.push(`· 외 ${items.length - NEW_ORDER_ALERT_MAX_ITEMS}개`);
      }
      const amount = paymentData.amount.total;
      if (typeof amount === 'number') lines.push(`결제 금액: ${amount.toLocaleString('ko-KR')}원`);
      await this.opsAlert.send({
        level: 'info',
        title: status === 'RECRUITING' ? '공동구매 참여' : '새 주문',
        lines,
      });
    } catch (error) {
      this.logger.warn(
        `[NewOrderAlert] 알림 준비 실패: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }

  // 회차 이름을 읽지 못하면 이름 줄만 빼고 알린다.
  private async readRoundName(roundId: unknown): Promise<string | null> {
    if (typeof roundId !== 'string' || !roundId) return null;
    try {
      const snap = await this.firestore.doc(`saleRounds/${roundId}`).get();
      const name = snap.exists ? snap.data()?.['name'] : null;
      return typeof name === 'string' && name.trim() ? name.trim() : null;
    } catch {
      return null;
    }
  }

  // 회차 주문은 orderItems, 옛 단일 상품 주문(공동구매 포함)은 productName·quantity를 쓴다.
  // 옵션(selectedOptions)은 손님이 고른 값이 섞일 수 있어 싣지 않는다.
  private newOrderAlertItems(
    order: Record<string, any>,
  ): Array<{ name: string; quantity: number }> {
    const source: Array<Record<string, any>> =
      Array.isArray(order['orderItems']) && order['orderItems'].length > 0
        ? order['orderItems']
        : [{ productName: order['productName'], quantity: order['quantity'] }];
    return source.map((item) => ({
      name:
        typeof item['productName'] === 'string' && item['productName'].trim()
          ? item['productName'].trim()
          : '상품',
      quantity: typeof item['quantity'] === 'number' ? item['quantity'] : 1,
    }));
  }

  // 결제는 됐지만 회차 한도가 없어 자동 환불한 주문. 고객은 접수 알림을 받지 못했으므로
  // 왜 돈이 돌아왔는지 알려 준다. 안내 실패는 환불 결과를 바꾸지 않는다.
  private async sendLatePaymentRefundNotice(order: Record<string, any>, orderId: string) {
    if (typeof order['userId'] !== 'string') return;
    try {
      await this.notifications.sendToUser(
        order['userId'],
        'ORDER_CANCELLED',
        {
          orderId: customerOrderLabel(order, orderId),
          reason: REFUND_NOTICE_REASONS.LATE_PAYMENT,
        },
        orderId,
        refundNoticeIdempotencyKey('LATE_PAYMENT', orderId),
      );
    } catch {
      // 발송 실패는 알림 서비스가 운영 이슈로 남긴다.
    }
  }

  async cancelPendingOrder(orderId: string, reason: string) {
    const now = this.firestore.Timestamp.now();
    return this.firestore.runTransaction(async (tx): Promise<boolean> => {
      const orderRef = this.firestore.doc(`orders/${orderId}`);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists || orderSnap.data()?.['status'] !== 'PENDING') return false;
      const order = orderSnap.data() as Record<string, any>;
      if (order['schemaVersion'] === 2) {
        if (order['reservationId']) {
          await this.capacity.releaseReservationInTransaction(
            tx,
            order['reservationId'],
            reason === 'timeout' ? 'EXPIRED' : 'RELEASED',
          );
        }
      } else {
        await releaseLegacyDailyCapacityInTransaction(this.firestore, tx, orderId, reason);
      }
      tx.update(orderRef, { status: 'CANCELLED', cancelReason: reason, updatedAt: now });
      return true;
    });
  }

  /**
   * Direct provider-cancel entry point shared by the three finalization refund
   * paths (amount mismatch, round late-capacity, legacy late-capacity).
   * F2: no provider cancel without persisted ownership recorded BEFORE the
   * provider call. F4/F5: any attempt that follows an unclear provider result
   * reconciles via getPayment readback before any cancel POST, and never
   * blind-retries when the provider state cannot be confirmed.
   */
  private async refundWithFinalizationOwnership(
    orderId: string,
    paymentData: PaymentData,
    reason: FinalizationRefundReasonClass,
    providerReason: string,
  ): Promise<'refunded' | 'already_handled' | 'order_missing'> {
    const claim = await this.claimFinalizationRefund(orderId, reason);
    if (claim.outcome === 'already_handled' || claim.outcome === 'order_missing') {
      return claim.outcome;
    }
    if (claim.outcome === 'claimed_retry') {
      const reconciled = await this.reconcileUncertainFinalizationRefund(
        orderId,
        paymentData,
        reason,
        providerReason,
        claim.token,
      );
      if (reconciled !== 'proceed') return reconciled;
    }
    try {
      await this.portone.refund(orderId, paymentData.amount.total, providerReason);
    } catch (error) {
      // The provider result is UNKNOWN (timeout included): the cancel may or
      // may not have landed. Never blind-retry; persist the uncertainty and
      // fail closed so the next attempt must read back provider state first.
      await this.persistUncertainFinalizationRefund(
        orderId,
        claim.token,
        reason,
        error,
        'provider_refund',
      );
      throw error;
    }
    await this.completeFinalizationRefund(
      orderId,
      paymentData,
      reason,
      providerReason,
      claim.token,
    );
    return 'refunded';
  }

  private async claimFinalizationRefund(
    orderId: string,
    reason: FinalizationRefundReasonClass,
  ): Promise<FinalizationRefundClaimOutcome> {
    const token = randomUUID();
    const now = this.firestore.Timestamp.now();
    const expiresAt = Date.now() + FINALIZATION_REFUND_CLAIM_MS;
    return this.firestore.runTransaction(async (tx): Promise<FinalizationRefundClaimOutcome> => {
      const orderRef = this.firestore.doc(`orders/${orderId}`);
      const paymentRef = this.firestore.doc(`payments/${orderId}`);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) return { outcome: 'order_missing' };
      const freshOrder = orderSnap.data() as Record<string, any>;
      const marker = this.readFinalizationRefundMarker(freshOrder);
      if (marker?.status === 'REFUNDED') return { outcome: 'already_handled' };
      if (freshOrder['latePaymentRefundedAt']) return { outcome: 'already_handled' };
      const paymentSnap = await tx.get(paymentRef);
      const payment = paymentSnap.exists ? (paymentSnap.data() as Record<string, any>) : null;
      if (payment && (payment['status'] === 'CANCELLED' || payment['refundedAt'])) {
        return { outcome: 'already_handled' };
      }
      const paymentClaim = payment?.['refundClaim'] as { expiresAt?: unknown } | null | undefined;
      if (
        paymentClaim &&
        typeof paymentClaim === 'object' &&
        typeof paymentClaim['expiresAt'] === 'number' &&
        paymentClaim['expiresAt'] > Date.now()
      ) {
        // A PaymentRefundService claim is in flight for the same money.
        return { outcome: 'already_handled' };
      }
      if (!marker) {
        // A foreign owner holds this order's finalization money (a live
        // token this service did not issue). Never overwrite its
        // token/status and never authorize a provider call (CASE C/E).
        const rawRefund = freshOrder['finalizationRefund'] as Record<string, any> | null | undefined;
        if (
          rawRefund &&
          typeof rawRefund === 'object' &&
          typeof rawRefund['token'] === 'string' &&
          rawRefund['token'].length > 0 &&
          rawRefund['owner'] !== FINALIZATION_REFUND_OWNER
        ) {
          return { outcome: 'already_handled' };
        }
        tx.update(orderRef, {
          finalizationRefund: {
            token,
            owner: FINALIZATION_REFUND_OWNER,
            reason,
            status: 'CLAIMED',
            claimedAt: now,
            expiresAt,
            updatedAt: now,
          },
          updatedAt: now,
        });
        return { outcome: 'claimed_fresh', token };
      }
      if (marker.status === 'CLAIMED' && marker.expiresAt > Date.now()) {
        return { outcome: 'already_handled' };
      }
      // Expired CLAIMED or any UNKNOWN: a prior attempt may already have
      // reached the provider. Take over as uncertain so a getPayment
      // readback is mandatory before any cancel POST.
      tx.update(orderRef, {
        finalizationRefund: {
          token,
          owner: FINALIZATION_REFUND_OWNER,
          reason,
          status: 'UNKNOWN',
          claimedAt: now,
          expiresAt,
          updatedAt: now,
        },
        updatedAt: now,
      });
      return { outcome: 'claimed_retry', token };
    });
  }

  private async reconcileUncertainFinalizationRefund(
    orderId: string,
    paymentData: PaymentData,
    reason: FinalizationRefundReasonClass,
    providerReason: string,
    token: string,
  ): Promise<'proceed' | 'already_handled' | 'order_missing'> {
    let providerState: Record<string, any>;
    try {
      providerState = (await this.portone.getPayment(orderId)) as Record<string, any>;
    } catch (error) {
      await this.persistUncertainFinalizationRefund(
        orderId,
        token,
        reason,
        error,
        'provider_readback',
      );
      throw error;
    }
    if (providerState?.['status'] === 'CANCELLED') {
      // Provider already terminal: converge locally, never re-POST.
      await this.completeFinalizationRefund(
        orderId,
        paymentData,
        reason,
        providerReason,
        token,
      );
      return 'already_handled';
    }
    const providerTotal = (providerState?.['amount'] as { total?: unknown } | undefined)?.[
      'total'
    ];
    if (providerState?.['status'] !== 'PAID' || providerTotal !== paymentData.amount.total) {
      const error = new Error('PortOne 결제 상태를 확정할 수 없어 환불을 중단합니다.');
      await this.persistUncertainFinalizationRefund(
        orderId,
        token,
        reason,
        error,
        'provider_readback',
      );
      throw error;
    }
    const orderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!orderSnap.exists) return 'order_missing';
    const marker = this.readFinalizationRefundMarker(orderSnap.data() as Record<string, any>);
    if (marker?.token !== token) return 'already_handled';
    return 'proceed';
  }

  private async completeFinalizationRefund(
    orderId: string,
    paymentData: PaymentData,
    reason: FinalizationRefundReasonClass,
    providerReason: string,
    token: string,
  ): Promise<void> {
    if (reason === 'late_capacity_round' || reason === 'late_capacity_legacy') {
      await this.recordLateRefund(orderId, paymentData, providerReason, token);
    }
    const now = this.firestore.Timestamp.now();
    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${orderId}`);
      const snap = await tx.get(orderRef);
      if (!snap.exists) return;
      const marker = this.readFinalizationRefundMarker(snap.data() as Record<string, any>);
      if (marker?.token !== token) return;
      tx.update(orderRef, {
        finalizationRefund: {
          token: marker.token,
          owner: FINALIZATION_REFUND_OWNER,
          reason: marker.reason,
          status: 'REFUNDED',
          claimedAt: marker.claimedAt,
          expiresAt: marker.expiresAt,
          updatedAt: now,
        },
        updatedAt: now,
      });
    });
  }

  private async persistUncertainFinalizationRefund(
    orderId: string,
    token: string,
    reason: FinalizationRefundReasonClass,
    error: unknown,
    failureStage: 'provider_refund' | 'provider_readback',
  ): Promise<void> {
    const now = this.firestore.Timestamp.now();
    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${orderId}`);
      const snap = await tx.get(orderRef);
      if (!snap.exists) return;
      const marker = this.readFinalizationRefundMarker(snap.data() as Record<string, any>);
      if (marker?.token !== token) return;
      tx.update(orderRef, {
        finalizationRefund: {
          token,
          owner: FINALIZATION_REFUND_OWNER,
          reason,
          status: 'UNKNOWN',
          claimedAt: marker.claimedAt ?? now,
          expiresAt: Date.now() + FINALIZATION_REFUND_CLAIM_MS,
          updatedAt: now,
        },
        updatedAt: now,
      });
    });
    const failure = this.safeLookupFailure(error);
    const orderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    const freshOrder = orderSnap.exists ? (orderSnap.data() as Record<string, any>) : null;
    await this.issueWriter.createOrMergeIssue({
      storeId: String(freshOrder?.['storeId'] ?? ''),
      orderId,
      paymentId: orderId,
      type: 'FINALIZATION_REFUND_FAILED',
      severity: 'critical',
      title: '확정 환불 결과 불명확',
      message: '환불 요청 결과를 확정하지 못해 blind 재시도 없이 운영 확인이 필요합니다.',
      idempotencyKey: `finalization-refund-uncertain:${orderId}:${reason}`,
      latestSnapshot: {
        orderStatus: freshOrder?.['status'] ?? null,
        paymentStatus: 'UNKNOWN',
        failureStage,
        providerStatus: failure.status,
        providerType: failure.type,
      },
    });
  }

  private readFinalizationRefundMarker(order: Record<string, any>): FinalizationRefundMarker | null {
    const marker = order['finalizationRefund'] as Record<string, any> | null | undefined;
    if (!marker || typeof marker !== 'object') return null;
    if (marker['owner'] !== FINALIZATION_REFUND_OWNER) return null;
    if (
      marker['status'] !== 'CLAIMED' &&
      marker['status'] !== 'UNKNOWN' &&
      marker['status'] !== 'REFUNDED'
    ) {
      return null;
    }
    if (typeof marker['token'] !== 'string' || marker['token'].length === 0) return null;
    if (
      marker['reason'] !== 'amount_mismatch' &&
      marker['reason'] !== 'payment_context_mismatch' &&
      marker['reason'] !== 'late_capacity_round' &&
      marker['reason'] !== 'late_capacity_legacy'
    ) {
      return null;
    }
    return {
      token: marker['token'],
      owner: FINALIZATION_REFUND_OWNER,
      reason: marker['reason'],
      status: marker['status'],
      claimedAt: marker['claimedAt'] ?? null,
      expiresAt: typeof marker['expiresAt'] === 'number' ? marker['expiresAt'] : 0,
      updatedAt: marker['updatedAt'] ?? null,
    };
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

  private isLegacyTimeoutPaymentCandidate(order: Record<string, any>) {
    return (
      order['status'] === 'CANCELLED' &&
      order['cancelReason'] === 'timeout' &&
      isLegacyDailyCapacityEligible(order)
    );
  }

  private isRoundLatePaymentCandidate(order: Record<string, any>) {
    return (
      order['schemaVersion'] === 2 &&
      order['status'] === 'CANCELLED' &&
      order['cancelReason'] === 'timeout' &&
      !order['latePaymentRefundedAt']
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

  // STALE_SUCCESS_MUST_NOT_WRITE_FOREIGN_OUTCOME: the late marker and its
  // payment document are written only by the currently authoritative owner
  // (matching token) and only from the transaction's fresh order fields.
  // A stale caller that lost ownership between the provider success and
  // persistence writes nothing, and no captured outer snapshot can
  // overwrite newer document fields.
  private async recordLateRefund(
    orderId: string,
    paymentData: PaymentData,
    refundReason: string,
    token: string,
  ) {
    const now = this.firestore.Timestamp.now();
    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${orderId}`);
      const freshSnap = await tx.get(orderRef);
      if (!freshSnap.exists || freshSnap.data()?.['latePaymentRefundedAt']) return;
      const freshOrder = freshSnap.data() as Record<string, any>;
      const marker = this.readFinalizationRefundMarker(freshOrder);
      if (marker?.token !== token) return;
      tx.update(orderRef, { latePaymentRefundedAt: now, updatedAt: now });
      tx.set(this.firestore.doc(`payments/${orderId}`), {
        id: orderId,
        orderId,
        userId: freshOrder['userId'],
        storeId: freshOrder['storeId'],
        amount: paymentData.amount.total,
        payMethod: paymentData.method?.type ?? null,
        status: 'CANCELLED',
        portonePaymentId: orderId,
        portoneTransactionId: paymentData.transactionId,
        refundAmount: paymentData.amount.total,
        refundedAt: now,
        refundReason,
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
