import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  customerFaultClosureEligibleAtMs,
  customerFaultClosureReasonFor,
  isCustomerFaultClosableHoldReason,
  redeliveryFeePaymentDeadlineDateKST,
  redeliveryPaymentRequestedAtOf,
  type CustomerFaultClosureActorRole,
  type CustomerFaultClosureBlockReason,
  type CustomerFaultClosureEligibility,
  type CustomerFaultClosureRecord,
} from '@greenhub/shared';
import { FirestoreService } from '../firestore/firestore.service';
import { OrderChargePaymentService } from '../payments/order-charge-payment.service';
import { timestampMillis } from '../sale-rounds/sale-round-state.contract';
import { SettlementsService } from '../settlements/settlements.service';
import { OrderCapacityService } from './order-capacity.service';
import { isOrderCancellationInProgress } from './order-cancellation-state';
import {
  isCurrentRedeliveryChargeLinked,
  isCurrentRedeliveryPaymentRequired,
  isDeliveryHoldUnresolved,
} from './redelivery-resume-gate';

type OrderRecord = Record<string, any>;

/** 결제를 시작한 재배송비(PENDING)를 진행 중으로 보는 시간. 지나면 버려진 결제로 보고 종결을 허용한다. */
export const REDELIVERY_PAYMENT_IN_PROGRESS_MS = 24 * 60 * 60 * 1000;

export const CUSTOMER_FAULT_CLOSED_STATUS = 'CLOSED_UNDELIVERED' as const;

export interface CustomerFaultClosureInput {
  storeId: string;
  orderId: string;
  actorRole: CustomerFaultClosureActorRole;
  actorId: string;
  memo: string;
}

/** 트랜잭션에서 읽은 현재 보류의 재배송비 청구. 연결된 청구가 없으면 null. */
type ChargeRead = {
  chargeId: string;
  exists: boolean;
  data: OrderRecord | null;
} | null;

/**
 * 고객 사유 종결 판정(순수 함수). GET 판정과 POST 종결이 같은 규칙을 쓴다.
 * 검사 순서: 이미 종결 → 회차 주문 → 직배송 → 취소 진행 → 보류 상태 → 보류 사유·책임 →
 * 보류 기록 → 재배송비 청구(결제 완료·운영 확인) → 결제 요청 여부·결제 기한 → 진행 중 결제(24시간).
 *
 * 재배송비 미결제 기한은 보류 시각이 아니라 손님에게 결제 요청을 보낸 시각(deliveryHold.paymentRequestedAt)부터
 * 센다(S-15). 요청 전 보류(DELIVERY_HELD)는 PAYMENT_NOT_REQUESTED로 막는다. 결제 요청 뒤 준비 상태(PREPARING)인데
 * 요청 시각이 없으면(이 칸이 생기기 전에 돌린 주문) 기한을 알 수 없으므로 INVALID_HOLD로 막는다(fail closed).
 * 수령 거부는 요청과 무관하게 바로 종결할 수 있다.
 */
export function decideCustomerFaultClosure(
  order: OrderRecord,
  charge: ChargeRead,
  nowMs: number,
): CustomerFaultClosureEligibility {
  const hold = (order['deliveryHold'] ?? null) as OrderRecord | null;
  const heldAt = typeof hold?.['heldAt'] === 'string' ? hold['heldAt'] : null;
  const fee = typeof hold?.['redeliveryFee'] === 'number' ? hold['redeliveryFee'] : null;
  const closureReasonCode =
    hold &&
    hold['customerResponsible'] === true &&
    isCustomerFaultClosableHoldReason(hold['reasonCode'])
      ? customerFaultClosureReasonFor(hold['reasonCode'])
      : null;
  const paymentRequestedAt = redeliveryPaymentRequestedAtOf(hold);
  const windowEligibleAtMs = customerFaultClosureEligibleAtMs(paymentRequestedAt);
  const eligibleAtMs =
    closureReasonCode === 'RECEIPT_REFUSED' ? timestampMillis(heldAt) : windowEligibleAtMs;
  const base = {
    closureReasonCode,
    eligibleAt:
      closureReasonCode && eligibleAtMs !== null && Number.isFinite(eligibleAtMs)
        ? new Date(eligibleAtMs).toISOString()
        : null,
    paymentDeadlineDate: closureReasonCode
      ? redeliveryFeePaymentDeadlineDateKST(paymentRequestedAt)
      : null,
    redeliveryFee: fee,
  };
  const block = (reason: CustomerFaultClosureBlockReason): CustomerFaultClosureEligibility => ({
    eligible: reason === 'OK',
    reason,
    ...base,
  });

  if (order['status'] === CUSTOMER_FAULT_CLOSED_STATUS) {
    // 이미 종결한 주문은 종결 기록의 값을 보여 준다.
    const record = order['customerFaultClosure'] as CustomerFaultClosureRecord | undefined;
    return {
      eligible: false,
      reason: 'ALREADY_CLOSED',
      closureReasonCode: record?.reasonCode ?? closureReasonCode,
      eligibleAt: base.eligibleAt,
      paymentDeadlineDate: base.paymentDeadlineDate,
      redeliveryFee: record?.redeliveryFee ?? fee,
    };
  }
  if (order['schemaVersion'] !== 2 || !order['roundId']) return block('NOT_ROUND_ORDER');
  if (order['deliveryMethod'] !== 'direct') return block('NOT_DIRECT_DELIVERY');
  if (isOrderCancellationInProgress(order)) return block('CANCELLATION_IN_PROGRESS');

  // 재배송비를 기다리는 보류: 보류 중(DELIVERY_HELD)이거나, 결제 요청 뒤 준비 상태로 돌아왔지만
  // 결제 전이라 보류 집계에 남은 주문(PREPARING + 미해소 유료 재배송).
  const waiting =
    (order['status'] === 'DELIVERY_HELD' && isDeliveryHoldUnresolved(hold)) ||
    (order['status'] === 'PREPARING' && isCurrentRedeliveryPaymentRequired(order));
  if (!waiting || !hold) return block('NOT_HELD');
  if (!isCustomerFaultClosableHoldReason(hold['reasonCode'])) {
    return block('HOLD_REASON_NOT_ELIGIBLE');
  }
  if (hold['customerResponsible'] !== true) return block('NOT_CUSTOMER_RESPONSIBLE');
  // 고객 책임 보류는 0원보다 큰 재배송비가 함께 있어야 한다(delivery-hold-policy).
  if (!isCurrentRedeliveryPaymentRequired(order) || !Number.isFinite(timestampMillis(heldAt))) {
    return block('INVALID_HOLD');
  }

  const chargeState = classifyCharge(order, charge, nowMs);
  if (chargeState === 'PAID') return block('REDELIVERY_FEE_PAID');
  if (chargeState === 'NEEDS_REVIEW') return block('REDELIVERY_PAYMENT_NEEDS_REVIEW');
  if (closureReasonCode !== 'RECEIPT_REFUSED') {
    if (windowEligibleAtMs === null) {
      // 요청 시각 칸이 있는데 읽을 수 없거나, 요청 뒤 준비 상태인데 시각이 없으면 기한을 알 수 없다.
      const requestedAtRecorded =
        hold['paymentRequestedAt'] !== undefined && hold['paymentRequestedAt'] !== null;
      if (requestedAtRecorded || order['status'] !== 'DELIVERY_HELD') {
        return block('INVALID_HOLD');
      }
      return block('PAYMENT_NOT_REQUESTED');
    }
    if (nowMs < windowEligibleAtMs) return block('PAYMENT_WINDOW_OPEN');
  }
  if (chargeState === 'IN_PROGRESS') return block('REDELIVERY_PAYMENT_IN_PROGRESS');
  return block('OK');
}

/**
 * 현재 보류의 재배송비 청구 상태.
 * - 청구 없음·FAILED: 종결 가능.
 * - PENDING 24시간 미만: 진행 중. 24시간 이상: 버려진 결제로 보고 종결 가능(close()는 그 전에 PortOne에
 *   직접 물어 결제되지 않았음을 확인한다. 종결 뒤 결제는 order-charge-payment의 "필요 없어진 결제" 경로가
 *   자동 환불한다).
 * - PAID: 재배송을 해야 하므로 종결 불가.
 * - 연결 손상·청구 없음(링크만 있음)·REFUNDED·MISMATCHED·알 수 없는 값: 운영 확인.
 */
function classifyCharge(
  order: OrderRecord,
  charge: ChargeRead,
  nowMs: number,
): 'NONE' | 'ALLOWED' | 'IN_PROGRESS' | 'PAID' | 'NEEDS_REVIEW' {
  const heldAt = order['deliveryHold']?.['heldAt'];
  if (!charge) {
    // 청구 id 없이 보류 연결만 남은 주문은 결제 연결이 손상된 것이다.
    const linkHoldAt = order['redeliveryChargeHoldAt'];
    return linkHoldAt === null || linkHoldAt === undefined ? 'NONE' : 'NEEDS_REVIEW';
  }
  if (order['redeliveryChargeHoldAt'] !== heldAt) return 'NEEDS_REVIEW';
  if (!charge.exists || !charge.data) return 'NEEDS_REVIEW';
  if (!isCurrentRedeliveryChargeLinked(order, charge.data, charge.chargeId)) {
    return 'NEEDS_REVIEW';
  }
  if (charge.data['refundedAt']) return 'NEEDS_REVIEW';
  switch (charge.data['status']) {
    case 'PAID':
      return 'PAID';
    case 'FAILED':
      return 'ALLOWED';
    case 'PENDING': {
      const createdAtMs = timestampMillis(charge.data['createdAt']);
      if (!Number.isFinite(createdAtMs)) return 'NEEDS_REVIEW';
      return nowMs - createdAtMs < REDELIVERY_PAYMENT_IN_PROGRESS_MS ? 'IN_PROGRESS' : 'ALLOWED';
    }
    default:
      return 'NEEDS_REVIEW';
  }
}

/** 종결 직전 PortOne 확인이 결제 여부를 확정하지 못했을 때(조회 실패·시간 초과 등). */
export const CLOSURE_CHARGE_CHECK_FAILED_MESSAGE =
  '재배송비 결제 상태를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.';

/** 회차가 취소됐거나 취소가 진행 중(취소 작업 소유·로컬 실패 뒤 재시도 대기)일 때. */
export const CLOSURE_ROUND_CANCELLING_MESSAGE = '회차 취소가 진행 중이라 종결할 수 없어요.';

/**
 * 회차 취소가 시작됐거나 끝난 회차인지. 회차 취소는 남은 주문을 환불하며 종결 주문은 건너뛰므로,
 * 취소가 시작된 뒤에는 환불 없는 종결을 허용하지 않는다(LOCAL_FAILED도 다시 시도될 취소다).
 */
export function isRoundCancellationStarted(round: OrderRecord | undefined): boolean {
  if (!round) return false;
  if (round['status'] === 'CANCELLED') return true;
  const status = round['cancellation']?.['status'];
  return status === 'CANCELLING' || status === 'LOCAL_FAILED';
}

const BLOCK_MESSAGES: Record<Exclude<CustomerFaultClosureBlockReason, 'OK'>, string> = {
  ALREADY_CLOSED: '이미 종결한 주문입니다.',
  NOT_ROUND_ORDER: '고객 사유 종결은 회차 주문만 할 수 있습니다.',
  NOT_DIRECT_DELIVERY: '고객 사유 종결은 직배송 주문만 할 수 있습니다.',
  NOT_HELD: '재배송비를 기다리는 배송 보류 주문만 종결할 수 있습니다.',
  HOLD_REASON_NOT_ELIGIBLE:
    '기상·상품 파손 보류는 종결할 수 없습니다. 재배송하거나 주문을 취소해 주세요.',
  NOT_CUSTOMER_RESPONSIBLE: '고객 책임 보류만 종결할 수 있습니다.',
  INVALID_HOLD: '배송 보류 기록을 확인할 수 없어 종결할 수 없습니다. 운영팀에 문의해 주세요.',
  CANCELLATION_IN_PROGRESS: '주문 취소가 진행 중이어서 종결할 수 없습니다.',
  REDELIVERY_FEE_PAID: '재배송비가 결제된 주문은 종결할 수 없습니다. 재배송을 진행해 주세요.',
  REDELIVERY_PAYMENT_NEEDS_REVIEW:
    '재배송비 결제 상태를 확인할 수 없어 종결할 수 없습니다. 운영팀에 문의해 주세요.',
  PAYMENT_NOT_REQUESTED:
    "손님에게 재배송비 결제 요청을 보낸 뒤 3일이 지나야 종결할 수 있습니다. 먼저 '재배송 준비로 돌리기'를 눌러 주세요.",
  PAYMENT_WINDOW_OPEN: '재배송비 결제 기한이 지나지 않아 아직 종결할 수 없습니다.',
  REDELIVERY_PAYMENT_IN_PROGRESS: '재배송비 결제가 진행 중이어서 종결할 수 없습니다.',
};

/**
 * 고객 사유 종결(환불 없음) — 회차 직배송 주문이 고객 책임 보류에서 수령 거부·재배송비 미결제로
 * 끝날 때 판매자(매장 주인)·관리자가 수동으로 종결한다(자동 종결 없음).
 *
 * 트랜잭션 전에 현재 보류의 PENDING 재배송비를 PortOne에 직접 확인한다(결제됐거나 확인하지 못하면 거절).
 * 한 트랜잭션에서 주문·재배송비 청구·회차를 읽고 판정한 뒤(회차 취소가 시작됐으면 거절) 주문을 CLOSED_UNDELIVERED로 바꾸고
 * 보류를 해소하며 회차 보류 집계를 정확히 한 번 줄인다. 환불하지 않고 회차 수량·재고도 되돌리지
 * 않는다(상품은 판매자가 처리). 커밋 뒤 배송 완료와 같은 방식으로 정산을 만든다(이미 있으면 그대로).
 * 같은 요청을 다시 보내면 정산만 맞춘다(집계를 다시 줄이지 않는다).
 *
 * 손님 알림은 보내지 않는다. 기존 알림톡 템플릿(ORDER_CANCELLED)은 환불을 안내하므로 맞지 않고,
 * 새 템플릿은 외부(카카오·ALIGO) 승인이 필요하다. 손님은 주문 상세 화면에서 종결 안내를 본다.
 */
@Injectable()
export class CustomerFaultClosureService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly capacity: OrderCapacityService,
    private readonly settlements: SettlementsService,
    private readonly chargePayments: OrderChargePaymentService,
  ) {}

  async getEligibility(storeId: string, orderId: string): Promise<CustomerFaultClosureEligibility> {
    const orderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!orderSnap.exists || orderSnap.data()?.['storeId'] !== storeId) {
      throw new NotFoundException();
    }
    const order = { ...(orderSnap.data() as OrderRecord), id: orderId };
    const chargeId = this.currentChargeId(order);
    let charge: ChargeRead = null;
    if (chargeId) {
      const chargeSnap = await this.firestore.doc(`orderCharges/${chargeId}`).get();
      charge = {
        chargeId,
        exists: chargeSnap.exists,
        data: chargeSnap.exists ? (chargeSnap.data() as OrderRecord) : null,
      };
    }
    const decision = decideCustomerFaultClosure(order, charge, Date.now());
    if (decision.reason === 'ALREADY_CLOSED') {
      // 종결 뒤 정산 생성이 실패했으면 판매자 화면이 "정산 다시 맞추기"를 보인다.
      return {
        ...decision,
        settlementMissing: !(await this.settlements.hasSettlement(orderId)),
      };
    }
    return decision;
  }

  async close(input: CustomerFaultClosureInput) {
    const memo = input.memo.trim();
    if (!memo) throw new BadRequestException('손님과 연락한 내용을 적어 주세요.');

    await this.confirmPendingChargeWithProvider(input);

    // Retry purity: 결정은 커밋된 시도의 반환값으로만 내린다.
    const committed = await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${input.orderId}`);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists || orderSnap.data()?.['storeId'] !== input.storeId) {
        throw new NotFoundException();
      }
      const order = { ...(orderSnap.data() as OrderRecord), id: input.orderId };
      if (order['status'] === CUSTOMER_FAULT_CLOSED_STATUS) {
        // 이미 종결됨: 집계·주문은 건드리지 않고 정산만 이어서 맞춘다.
        return { order, alreadyClosed: true };
      }

      const chargeId = this.currentChargeId(order);
      let charge: ChargeRead = null;
      if (chargeId) {
        const chargeSnap = await tx.get(this.firestore.doc(`orderCharges/${chargeId}`));
        charge = {
          chargeId,
          exists: chargeSnap.exists,
          data: chargeSnap.exists ? (chargeSnap.data() as OrderRecord) : null,
        };
      }
      const decision = decideCustomerFaultClosure(order, charge, Date.now());
      if (decision.reason !== 'OK') {
        const message = BLOCK_MESSAGES[decision.reason];
        if (
          decision.reason === 'NOT_ROUND_ORDER' ||
          decision.reason === 'NOT_DIRECT_DELIVERY' ||
          decision.reason === 'HOLD_REASON_NOT_ELIGIBLE' ||
          decision.reason === 'NOT_CUSTOMER_RESPONSIBLE'
        ) {
          throw new ForbiddenException(message);
        }
        throw new ConflictException(message);
      }

      // 회차 취소가 시작됐으면 그 취소가 주문을 환불하도록 둔다. 회차 취소 작업이 이 읽기 뒤에
      // 회차 문서를 바꾸면 이 트랜잭션은 다시 실행돼 여기서 막힌다(집계 함수도 같은 회차 문서를 쓴다).
      const roundSnap = await tx.get(this.firestore.doc(`saleRounds/${order['roundId']}`));
      if (isRoundCancellationStarted(roundSnap.exists ? roundSnap.data() : undefined)) {
        throw new ConflictException(CLOSURE_ROUND_CANCELLING_MESSAGE);
      }

      const now = this.firestore.Timestamp.now();
      const nowIso = new Date(timestampMillis(now)).toISOString();
      const hold = order['deliveryHold'] as OrderRecord;
      const record: CustomerFaultClosureRecord = {
        reasonCode: decision.closureReasonCode!,
        heldAt: hold['heldAt'],
        redeliveryFee: decision.redeliveryFee,
        actorRole: input.actorRole,
        actorId: input.actorId,
        memo,
        closedAt: nowIso,
      };
      // 보류 집계(회차 heldOrderCount)는 DELIVERY_HELD와 결제 대기 PREPARING 모두 1로 센다.
      // 종결로 보류에서 나가므로 정확히 한 번 줄인다. 회차를 먼저 읽고(집계 함수 안) 쓴다.
      await this.capacity.adjustHeldOrderCountInTransaction(tx, {
        storeId: input.storeId,
        roundId: order['roundId'],
        delta: -1,
        now,
      });
      tx.update(orderRef, {
        status: CUSTOMER_FAULT_CLOSED_STATUS,
        deliveryHold: { ...hold, resolvedAt: nowIso },
        customerFaultClosure: record,
        updatedAt: now,
      });
      return {
        order: {
          ...order,
          status: CUSTOMER_FAULT_CLOSED_STATUS,
          customerFaultClosure: record,
        },
        alreadyClosed: false,
      };
    });

    // 배송 완료와 같은 정산(결제 금액 정산). 이미 있으면 다시 만들지 않는다(멱등).
    // 실패해도 주문은 이미 종결됐으므로 같은 요청을 다시 보내면 이 단계만 이어서 끝낸다.
    await this.settlements.createSettlement(committed.order, CUSTOMER_FAULT_CLOSED_STATUS);
    return {
      orderId: input.orderId,
      status: CUSTOMER_FAULT_CLOSED_STATUS,
      alreadyClosed: committed.alreadyClosed,
    };
  }

  /**
   * 현재 보류에 연결된 재배송비가 PENDING이면 트랜잭션 전에 PortOne에 직접 묻는다(나이와 관계없이).
   * 마감일 늦게 결제했는데 웹훅이 늦거나 빠진 청구를 버려진 결제로 보고 종결하면, 뒤늦은 확정이
   * 재배송비만 돌려주고 주문은 환불 없이 끝난다. PAID면 기존 확정 경로로 확정한 뒤 거절하고(재배송을
   * 해야 한다), 확인하지 못하면 거절한다(fail closed). 결제되지 않았으면 트랜잭션이 청구를 다시 읽어
   * 기존 판정표(24시간 진행 중 등)를 그대로 적용한다.
   */
  private async confirmPendingChargeWithProvider(input: CustomerFaultClosureInput) {
    const orderSnap = await this.firestore.doc(`orders/${input.orderId}`).get();
    if (!orderSnap.exists || orderSnap.data()?.['storeId'] !== input.storeId) {
      throw new NotFoundException();
    }
    const order = orderSnap.data() as OrderRecord;
    if (order['status'] === CUSTOMER_FAULT_CLOSED_STATUS) return;
    const chargeId = this.currentChargeId(order);
    const heldAt = order['deliveryHold']?.['heldAt'];
    // 다른 보류에 연결된 청구는 트랜잭션이 운영 확인(REDELIVERY_PAYMENT_NEEDS_REVIEW)으로 막는다.
    if (!chargeId || typeof heldAt !== 'string' || order['redeliveryChargeHoldAt'] !== heldAt) {
      return;
    }
    const result = await this.chargePayments.checkPendingChargeBeforeClosure(chargeId);
    if (result === 'finalized') {
      throw new ConflictException(BLOCK_MESSAGES.REDELIVERY_FEE_PAID);
    }
    if (result === 'inconclusive') {
      throw new ConflictException(CLOSURE_CHARGE_CHECK_FAILED_MESSAGE);
    }
  }

  /** 주문에 연결된 재배송비 청구 id. 없으면 null. */
  private currentChargeId(order: OrderRecord): string | null {
    const chargeId = order['redeliveryChargeId'];
    return typeof chargeId === 'string' && chargeId.length > 0 ? chargeId : null;
  }
}
