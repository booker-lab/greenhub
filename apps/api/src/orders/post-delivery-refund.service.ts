import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  isWithinSellerRefundWindow,
  POST_DELIVERY_REFUND_REASON_LABEL,
  POST_DELIVERY_REFUND_SELLER_WINDOW_DAYS,
  POST_DELIVERY_REFUNDABLE_STATUSES,
  type OrderStatus,
  type PostDeliveryRefundActorRole,
  type PostDeliveryRefundReasonCode,
  type PostDeliveryRefundRecord,
} from '@greenhub/shared';
import { FirestoreService } from '../firestore/firestore.service';
import { customerOrderLabel } from '../notifications/customer-order-label';
import { NotificationsService } from '../notifications/notifications.service';
import {
  REFUND_NOTICE_REASONS,
  type RefundNoticeKind,
  refundNoticeIdempotencyKey,
} from '../notifications/refund-notice-reasons';
import { PaymentsService } from '../payments/payments.service';
import { timestampMillis } from '../sale-rounds/sale-round-state.contract';
import { SettlementsService } from '../settlements/settlements.service';
import { isOrderCancellationInProgress } from './order-cancellation-state';

type OrderRecord = Record<string, any>;

const DAY_MS = 24 * 60 * 60 * 1000;

const NOTICE_KIND: Record<PostDeliveryRefundReasonCode, RefundNoticeKind> = {
  QUALITY_DAMAGED: 'POST_DELIVERY_QUALITY_DAMAGED',
  BROKEN: 'POST_DELIVERY_BROKEN',
  WRONG_DELIVERY: 'POST_DELIVERY_WRONG_DELIVERY',
  OTHER: 'POST_DELIVERY_OTHER',
};

export interface PostDeliveryRefundInput {
  storeId: string;
  orderId: string;
  actorRole: PostDeliveryRefundActorRole;
  actorId: string;
  reasonCode: PostDeliveryRefundReasonCode;
  memo: string;
}

/** 판매자 화면이 버튼을 보여 줄지 정하는 판정. 서버가 실제 환불 때 같은 규칙으로 다시 확인한다. */
export type SellerRefundEligibilityReason =
  | 'OK'
  | 'NOT_ROUND_ORDER'
  | 'NOT_DELIVERED'
  | 'ALREADY_REFUNDED'
  | 'CANCELLATION_IN_PROGRESS'
  | 'NO_SETTLEMENT'
  | 'SETTLEMENT_PAID'
  | 'WINDOW_EXPIRED'
  | 'NO_PAYMENT';

export interface SellerRefundEligibility {
  eligible: boolean;
  reason: SellerRefundEligibilityReason;
  /** 판매자 직접 환불 마감 시각(ISO). 정산이 없으면 null */
  deadline: string | null;
  /** 환불될 금액(본 결제 전액). 결제가 없으면 null */
  amount: number | null;
}

/**
 * 배송 후 환불 — 배송 완료로 표시된 회차 주문의 전액 환불(계획서 post-delivery-refund-plan.md §2).
 *
 * 흐름: ① 시작 기록(주문 postDeliveryRefund + cancellation REFUNDING, 같은 트랜잭션에서 상태·정산·결제 확인)
 * → ② 본 결제·재배송비 환불(PortOne 상태를 먼저 읽어 콘솔 수동 환불과 중복을 막는다)
 * → ③ 주문 CANCELLED 확정 → ④ 정산 취소(지급 완료면 회수 기록) → ⑤ 손님 알림(ORDER_CANCELLED, 고정 사유).
 * 배송이 끝난 주문이므로 회차 수량·예약은 되돌리지 않는다.
 * 중간에 실패하면 같은 요청을 다시 보내 이어서 끝낸다(시작 기록이 있으면 기간·정산 조건을 다시 묻지 않는다).
 */
@Injectable()
export class PostDeliveryRefundService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly payments: PaymentsService,
    private readonly settlements: SettlementsService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async getSellerEligibility(storeId: string, orderId: string): Promise<SellerRefundEligibility> {
    const order = await this.readOrder(storeId, orderId);
    const settlementSnap = await this.firestore.doc(`settlements/${orderId}`).get();
    const settlement = settlementSnap.exists ? (settlementSnap.data() as OrderRecord) : null;
    const paymentSnap = await this.firestore.doc(`payments/${orderId}`).get();
    const payment = paymentSnap.exists ? (paymentSnap.data() as OrderRecord) : null;
    const reason = this.sellerBlockReason(order, settlement, payment, Date.now());
    const settledAtMs = timestampMillis(settlement?.['settledAt']);
    return {
      eligible: reason === 'OK',
      reason,
      deadline: Number.isFinite(settledAtMs)
        ? new Date(settledAtMs + POST_DELIVERY_REFUND_SELLER_WINDOW_DAYS * DAY_MS).toISOString()
        : null,
      amount: typeof payment?.['amount'] === 'number' ? payment['amount'] : null,
    };
  }

  async refund(input: PostDeliveryRefundInput) {
    const memo = input.memo.trim();
    if (!memo) throw new BadRequestException('환불 메모를 적어 주세요.');
    const label = POST_DELIVERY_REFUND_REASON_LABEL[input.reasonCode];
    if (!label) throw new BadRequestException('환불 사유가 올바르지 않습니다.');
    const providerReason = `배송 후 환불(${label})`;

    const claim = await this.claim({ ...input, memo }, providerReason);
    if (claim.needsRefund) {
      try {
        await this.payments.processRefundByOrderId(input.orderId, providerReason, {
          verifyProviderFirst: true,
        });
        await this.payments.refundOrderChargesByOrderId(input.orderId, providerReason);
      } catch (error) {
        await this.recordCancellationState(input, providerReason, 'REFUND_FAILED');
        throw error;
      }
    }

    try {
      await this.completeLocally(input, providerReason);
    } catch (error) {
      await this.recordCancellationState(input, providerReason, 'LOCAL_FAILED');
      throw error;
    }
    // 주문은 이미 CANCELLED다. 정산 취소가 실패해도 같은 요청을 다시 보내면 이 단계부터 이어 간다.
    // 지급 완료 정산이면 paid를 유지하고 판매자 회수 필요(관리자만 닫는 운영 기록)를 남긴다.
    const recovery = await this.settlements.cancelSettlement(input.orderId);
    await this.sendNotice(input.orderId, claim.reasonCode);
    return { orderId: input.orderId, status: 'CANCELLED' as const, ...recovery };
  }

  private async claim(
    input: PostDeliveryRefundInput,
    providerReason: string,
  ): Promise<{ needsRefund: boolean; reasonCode: PostDeliveryRefundReasonCode }> {
    // Retry purity: 결정은 커밋된 시도의 반환값으로만 내린다.
    return this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${input.orderId}`);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists || orderSnap.data()?.['storeId'] !== input.storeId) {
        throw new NotFoundException();
      }
      const order = orderSnap.data() as OrderRecord;
      const settlementSnap = await tx.get(this.firestore.doc(`settlements/${input.orderId}`));
      const settlement = settlementSnap.exists ? (settlementSnap.data() as OrderRecord) : null;
      const paymentSnap = await tx.get(this.firestore.doc(`payments/${input.orderId}`));
      const payment = paymentSnap.exists ? (paymentSnap.data() as OrderRecord) : null;
      const paymentIsPaid = payment?.['status'] === 'PAID' && !payment['refundedAt'];

      const existing = order['postDeliveryRefund'] as PostDeliveryRefundRecord | null | undefined;
      if (existing) {
        // 이미 시작된 배송 후 환불을 이어서 끝낸다. 처음 기록한 사유·처리자를 그대로 쓴다.
        return { needsRefund: paymentIsPaid, reasonCode: existing.reasonCode };
      }
      if (order['status'] === 'CANCELLED') {
        throw new ConflictException('이미 취소된 주문입니다.');
      }
      if (order['schemaVersion'] !== 2 || !order['roundId']) {
        throw new BadRequestException('배송 후 환불은 회차 주문만 할 수 있습니다.');
      }
      if (isOrderCancellationInProgress(order)) {
        throw new ConflictException('주문 취소가 이미 처리 중입니다.');
      }
      if (!POST_DELIVERY_REFUNDABLE_STATUSES.includes(order['status'])) {
        throw new ForbiddenException('배송이 완료된 주문만 배송 후 환불할 수 있습니다.');
      }
      if (input.actorRole === 'seller') {
        const blocked = this.sellerBlockReason(order, settlement, payment, Date.now());
        if (blocked !== 'OK') throw new ForbiddenException(this.sellerBlockMessage(blocked));
      }
      if (!paymentIsPaid) {
        throw new ConflictException('환불할 결제를 찾을 수 없습니다. 결제 상태를 확인해 주세요.');
      }

      const nowIso = new Date(timestampMillis(this.firestore.Timestamp.now())).toISOString();
      const record: PostDeliveryRefundRecord = {
        reasonCode: input.reasonCode,
        memo: input.memo,
        actorRole: input.actorRole,
        actorId: input.actorId,
        previousStatus: order['status'] as OrderStatus,
        amount: payment['amount'],
        requestedAt: nowIso,
        completedAt: null,
      };
      tx.update(orderRef, {
        postDeliveryRefund: record,
        cancellation: { status: 'REFUNDING', reason: providerReason, updatedAt: nowIso },
        updatedAt: this.firestore.Timestamp.now(),
      });
      return { needsRefund: true, reasonCode: input.reasonCode };
    });
  }

  private async completeLocally(input: PostDeliveryRefundInput, providerReason: string) {
    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${input.orderId}`);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists || orderSnap.data()?.['storeId'] !== input.storeId) {
        throw new NotFoundException();
      }
      const order = orderSnap.data() as OrderRecord;
      const record = order['postDeliveryRefund'] as PostDeliveryRefundRecord | undefined;
      if (!record) throw new ConflictException('배송 후 환불 시작 기록이 없습니다.');
      if (order['status'] === 'CANCELLED' && order['cancellation']?.['status'] === 'COMPLETED') {
        return;
      }
      const paymentSnap = await tx.get(this.firestore.doc(`payments/${input.orderId}`));
      const payment = paymentSnap.exists ? (paymentSnap.data() as OrderRecord) : null;
      if (payment?.['status'] === 'PAID' && !payment['refundedAt']) {
        throw new ConflictException('환불 결과를 확인할 수 없어 주문 취소를 완료하지 못했습니다.');
      }
      const now = this.firestore.Timestamp.now();
      const nowIso = new Date(timestampMillis(now)).toISOString();
      tx.update(orderRef, {
        status: 'CANCELLED',
        cancelReason: providerReason,
        cancellation: {
          status: 'COMPLETED',
          reason: providerReason,
          completedAt: nowIso,
          updatedAt: nowIso,
        },
        postDeliveryRefund: { ...record, completedAt: nowIso },
        updatedAt: now,
      });
    });
  }

  private async recordCancellationState(
    input: PostDeliveryRefundInput,
    providerReason: string,
    status: 'REFUND_FAILED' | 'LOCAL_FAILED',
  ) {
    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${input.orderId}`);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) return;
      const order = orderSnap.data() as OrderRecord;
      if (order['status'] === 'CANCELLED' && order['cancellation']?.['status'] === 'COMPLETED') {
        return;
      }
      const nowIso = new Date(timestampMillis(this.firestore.Timestamp.now())).toISOString();
      tx.update(orderRef, {
        cancellation: { status, reason: providerReason, updatedAt: nowIso },
        updatedAt: this.firestore.Timestamp.now(),
      });
    });
  }

  private async sendNotice(orderId: string, reasonCode: PostDeliveryRefundReasonCode) {
    if (!this.notifications) return;
    const snap = await this.firestore.doc(`orders/${orderId}`).get();
    const order = snap.data();
    if (!order || typeof order['userId'] !== 'string') return;
    const kind = NOTICE_KIND[reasonCode];
    try {
      await this.notifications.sendToUser(
        order['userId'],
        'ORDER_CANCELLED',
        { orderId: customerOrderLabel(order, orderId), reason: REFUND_NOTICE_REASONS[kind] },
        orderId,
        // 사유는 시작 기록에서 고정되므로 주문당 한 번만 안내된다(재시도·중복 호출 대비).
        refundNoticeIdempotencyKey(kind, orderId),
      );
    } catch {
      // 안내 실패가 이미 끝난 환불을 되돌리지 않는다. 발송 실패는 알림 서비스가 운영 이슈로 남긴다.
    }
  }

  private sellerBlockReason(
    order: OrderRecord,
    settlement: OrderRecord | null,
    payment: OrderRecord | null,
    nowMs: number,
  ): SellerRefundEligibilityReason {
    if (order['postDeliveryRefund'] || order['status'] === 'CANCELLED') return 'ALREADY_REFUNDED';
    if (order['schemaVersion'] !== 2 || !order['roundId']) return 'NOT_ROUND_ORDER';
    if (isOrderCancellationInProgress(order)) return 'CANCELLATION_IN_PROGRESS';
    if (!POST_DELIVERY_REFUNDABLE_STATUSES.includes(order['status'])) return 'NOT_DELIVERED';
    if (!settlement) return 'NO_SETTLEMENT';
    if (settlement['status'] === 'paid') return 'SETTLEMENT_PAID';
    if (!isWithinSellerRefundWindow(timestampMillis(settlement['settledAt']), nowMs)) {
      return 'WINDOW_EXPIRED';
    }
    if (payment?.['status'] !== 'PAID' || payment['refundedAt']) return 'NO_PAYMENT';
    return 'OK';
  }

  private sellerBlockMessage(reason: SellerRefundEligibilityReason): string {
    switch (reason) {
      case 'WINDOW_EXPIRED':
        return `배송 완료 ${POST_DELIVERY_REFUND_SELLER_WINDOW_DAYS}일이 지나 판매자가 직접 환불할 수 없습니다. 관리자에게 문의해 주세요.`;
      case 'SETTLEMENT_PAID':
        return '이미 정산금이 지급된 주문입니다. 관리자에게 문의해 주세요.';
      case 'NO_SETTLEMENT':
        return '정산 기록을 확인할 수 없어 판매자가 직접 환불할 수 없습니다. 관리자에게 문의해 주세요.';
      case 'NO_PAYMENT':
        return '환불할 결제를 찾을 수 없습니다. 관리자에게 문의해 주세요.';
      default:
        return '배송 후 환불을 할 수 없는 주문입니다.';
    }
  }

  private async readOrder(storeId: string, orderId: string): Promise<OrderRecord> {
    const snap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!snap.exists || snap.data()?.['storeId'] !== storeId) throw new NotFoundException();
    return snap.data() as OrderRecord;
  }
}
