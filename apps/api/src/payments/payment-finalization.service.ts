import { randomUUID } from 'node:crypto';
import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service';
import { FirestoreService } from '../firestore/firestore.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OperationIssueWriterService } from '../operations/operation-issue-writer.service';
import {
  LatePaymentCapacityError,
  OrderCapacityService,
} from '../orders/order-capacity.service';
import { RetentionService } from '../retention/retention.service';
import { PortoneClient } from './portone.client';
import { PaymentRefundService } from './payment-refund.service';
import {
  isLegacyDailyCapacityEligible,
  LegacyDailyCapacityError,
  reacquireLegacyDailyCapacityInTransaction,
  releaseLegacyDailyCapacityInTransaction,
} from './_lib/legacy-daily-capacity';

type PaymentData = Awaited<ReturnType<PortoneClient['getPayment']>>;
const LATE_PAYMENT_REFUND_REASON = '결제 만료 후 회차 한도 마감';
const LEGACY_LATE_PAYMENT_REFUND_REASON = '결제 만료 후 일일 배송 용량 재확보 실패';

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
      const refundOutcome = await this.refundWithFinalizationOwnership(
        orderId,
        order,
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
              });
            reservationId = reacquired.id;
          } else {
            reservationId = freshOrder['reservationId'] as string | undefined;
            if (!reservationId) throw new Error('결제 예약 식별자가 없습니다.');
            await this.capacity.consumeReservationInTransaction(tx, {
              reservationId,
              orderId,
              paymentId: orderId,
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
          order,
          paymentData,
          'late_capacity_round',
          LATE_PAYMENT_REFUND_REASON,
        );
        if (refundOutcome === 'order_missing') return { ok: false, reason: 'order_not_found' };
        return { ok: false, reason: 'late_payment_refunded' };
      }
      if (error instanceof LegacyDailyCapacityError) {
        const refundOutcome = await this.refundWithFinalizationOwnership(
          orderId,
          order,
          paymentData,
          'late_capacity_legacy',
          LEGACY_LATE_PAYMENT_REFUND_REASON,
        );
        if (refundOutcome === 'order_missing') return { ok: false, reason: 'order_not_found' };
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
    order: Record<string, any>,
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
        order,
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
      order,
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
    order: Record<string, any>,
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
        order,
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
    order: Record<string, any>,
    paymentData: PaymentData,
    reason: FinalizationRefundReasonClass,
    providerReason: string,
    token: string,
  ): Promise<void> {
    if (reason === 'late_capacity_round' || reason === 'late_capacity_legacy') {
      await this.recordLateRefund(orderId, order, paymentData, providerReason);
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

  private async recordLateRefund(
    orderId: string,
    order: Record<string, any>,
    paymentData: PaymentData,
    refundReason = LATE_PAYMENT_REFUND_REASON,
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
