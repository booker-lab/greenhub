import {
  CUSTOMER_FAULT_CLOSURE_MEMO_MAX_LENGTH,
  type CustomerFaultClosureBlockReason,
  type CustomerFaultClosureEligibility,
  type CustomerFaultClosureReasonCode,
  type CustomerFaultClosureRecord,
  formatKoreanMonthDayKST,
  type Order,
} from '@greenhub/shared';

/**
 * 고객 사유 종결(환불 없음) 판매자 화면 판단 — 순수 함수.
 * 서버(GET·POST stores/:storeId/orders/:orderId/customer-fault-closure)가 같은 규칙으로 다시 판정한다.
 */

export const CUSTOMER_FAULT_CLOSURE_REASON_LABEL: Record<CustomerFaultClosureReasonCode, string> = {
  RECEIPT_REFUSED: '수령 거부',
  REDELIVERY_FEE_UNPAID: '재배송비 미결제',
};

export const CUSTOMER_FAULT_CLOSURE_BUTTON_LABEL = '환불 없이 주문 종결';

/** 종결 뒤 정산이 없을 때 보이는 버튼. 같은 종결 요청을 다시 보내 정산만 맞춘다. */
export const SETTLEMENT_RECONCILE_BUTTON_LABEL = '정산 다시 맞추기';

export const CUSTOMER_FAULT_CLOSURE_CONFIRM_MESSAGE =
  '환불 없이 주문을 종결해요. 결제 금액은 정산되고 상품은 직접 처리해 주세요. 되돌릴 수 없어요.';

const BLOCK_REASONS: readonly CustomerFaultClosureBlockReason[] = [
  'OK',
  'ALREADY_CLOSED',
  'NOT_ROUND_ORDER',
  'NOT_DIRECT_DELIVERY',
  'NOT_HELD',
  'HOLD_REASON_NOT_ELIGIBLE',
  'NOT_CUSTOMER_RESPONSIBLE',
  'INVALID_HOLD',
  'CANCELLATION_IN_PROGRESS',
  'REDELIVERY_FEE_PAID',
  'REDELIVERY_PAYMENT_NEEDS_REVIEW',
  'PAYMENT_NOT_REQUESTED',
  'PAYMENT_WINDOW_OPEN',
  'REDELIVERY_PAYMENT_IN_PROGRESS',
];

type ClosureCheckOrder = Pick<
  Order,
  'status' | 'roundId' | 'deliveryMethod' | 'deliveryHold' | 'redeliveryPayment'
>;

/**
 * 종결 가능 여부를 서버에 물을 주문인지: 회차 직배송 주문이 고객 책임 보류로 재배송비를 기다리는 중
 * (보류 중이거나, 결제 요청 뒤 준비 상태로 돌아왔지만 결제 전)일 때만 묻는다.
 */
export function shouldCheckCustomerFaultClosure(order: ClosureCheckOrder): boolean {
  if (!order.roundId || order.deliveryMethod !== 'direct') return false;
  const hold = order.deliveryHold;
  if (!hold || hold.customerResponsible !== true || hold.resolvedAt) return false;
  if (order.status === 'DELIVERY_HELD') return true;
  return order.status === 'PREPARING' && order.redeliveryPayment?.required === true;
}

/** 종결한 주문인지: 종결 뒤 정산이 만들어졌는지 확인하려고 판정을 묻는다. */
export function shouldCheckCustomerFaultClosureSettlement(order: Pick<Order, 'status'>): boolean {
  return order.status === 'CLOSED_UNDELIVERED';
}

/** 서버 판정 응답을 읽는다. 모양이 다르면 null(버튼을 숨긴다 — fail closed). */
export function parseCustomerFaultClosureEligibility(
  payload: unknown,
): CustomerFaultClosureEligibility | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const reason = record.reason;
  if (
    typeof record.eligible !== 'boolean' ||
    typeof reason !== 'string' ||
    !(BLOCK_REASONS as readonly string[]).includes(reason) ||
    record.eligible !== (reason === 'OK')
  ) {
    return null;
  }
  const closureReasonCode =
    record.closureReasonCode === 'RECEIPT_REFUSED' ||
    record.closureReasonCode === 'REDELIVERY_FEE_UNPAID'
      ? record.closureReasonCode
      : null;
  return {
    eligible: record.eligible,
    reason: reason as CustomerFaultClosureBlockReason,
    closureReasonCode,
    eligibleAt: typeof record.eligibleAt === 'string' ? record.eligibleAt : null,
    paymentDeadlineDate:
      typeof record.paymentDeadlineDate === 'string' ? record.paymentDeadlineDate : null,
    redeliveryFee: typeof record.redeliveryFee === 'number' ? record.redeliveryFee : null,
    // 이미 종결한 주문만 정산 없음 표시를 읽는다. true가 아니면 버튼을 보이지 않는다.
    ...(reason === 'ALREADY_CLOSED'
      ? { settlementMissing: record.settlementMissing === true }
      : {}),
  };
}

/** 시각(ISO)을 "11월 17일 00:00"처럼 한국 시간으로 쓴다(실행 환경 시간대와 무관). 잘못된 값이면 null. */
export function formatClosureTimeKST(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  const day = formatKoreanMonthDayKST(ms);
  const kst = new Date(ms + 9 * 60 * 60 * 1000);
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mm = String(kst.getUTCMinutes()).padStart(2, '0');
  return day ? `${day} ${hh}:${mm}` : null;
}

/**
 * 결제 요청 전이라 종결할 수 없을 때의 안내(S-15). 종결 기한은 손님에게 재배송비 결제 요청을 보낸 날부터 센다.
 */
export const CUSTOMER_FAULT_CLOSURE_PAYMENT_NOT_REQUESTED_MESSAGE =
  "손님에게 재배송비 결제 요청을 보낸 뒤 3일이 지나야 종결할 수 있어요. 먼저 '재배송 준비로 돌리기'를 눌러 주세요.";

/**
 * 버튼 대신 보여 줄 안내. null이면 아무것도 보여 주지 않는다(종결 대상이 아닌 주문).
 */
export function customerFaultClosureBlockedMessage(
  eligibility: Pick<CustomerFaultClosureEligibility, 'reason' | 'eligibleAt'>,
): string | null {
  switch (eligibility.reason) {
    case 'PAYMENT_NOT_REQUESTED':
      return CUSTOMER_FAULT_CLOSURE_PAYMENT_NOT_REQUESTED_MESSAGE;
    case 'PAYMENT_WINDOW_OPEN': {
      const at = formatClosureTimeKST(eligibility.eligibleAt);
      return at
        ? `손님이 재배송비를 결제하지 않으면 ${at}부터 종결할 수 있어요.`
        : '재배송비 결제 기한이 지나면 종결할 수 있어요.';
    }
    case 'REDELIVERY_PAYMENT_IN_PROGRESS':
      return '재배송비 결제가 진행 중이에요. 결제를 시작하고 24시간이 지나도 끝나지 않으면 종결할 수 있어요.';
    case 'REDELIVERY_FEE_PAID':
      return '재배송비가 결제됐어요. 재배송을 진행해 주세요.';
    case 'REDELIVERY_PAYMENT_NEEDS_REVIEW':
      return '재배송비 결제 상태를 확인해야 해서 종결할 수 없어요. 운영팀에 문의해 주세요.';
    case 'INVALID_HOLD':
      return '배송 보류 기록을 확인할 수 없어 종결할 수 없어요. 운영팀에 문의해 주세요.';
    case 'CANCELLATION_IN_PROGRESS':
      return '주문 취소가 진행 중이라 종결할 수 없어요.';
    default:
      return null;
  }
}

/** 종결 버튼 위에 보여 줄 한 줄 설명. */
export function describeCustomerFaultClosureEligible(
  eligibility: Pick<CustomerFaultClosureEligibility, 'closureReasonCode' | 'paymentDeadlineDate'>,
): string {
  if (eligibility.closureReasonCode === 'RECEIPT_REFUSED') {
    return '손님이 수령을 거부했어요. 손님과 연락한 뒤 환불 없이 주문을 종결할 수 있어요.';
  }
  const deadline = formatKoreanMonthDayKST(eligibility.paymentDeadlineDate);
  return deadline
    ? `손님이 ${deadline}까지 재배송비를 결제하지 않았어요. 손님과 연락한 뒤 환불 없이 주문을 종결할 수 있어요.`
    : '손님이 기한까지 재배송비를 결제하지 않았어요. 손님과 연락한 뒤 환불 없이 주문을 종결할 수 있어요.';
}

/** 확인 버튼을 누를 수 있는지: 손님과 연락한 내용(한 줄, 1~200자)이 있어야 한다. */
export function canSubmitCustomerFaultClosure(memo: string): boolean {
  const trimmed = memo.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= CUSTOMER_FAULT_CLOSURE_MEMO_MAX_LENGTH &&
    !/[\r\n]/.test(memo)
  );
}

/** 종결한 주문의 기록 요약(판매자 화면). 기록이 없으면 null. */
export function describeCustomerFaultClosureRecord(
  record: Pick<CustomerFaultClosureRecord, 'reasonCode' | 'closedAt'> | null | undefined,
): string | null {
  if (!record) return null;
  const label = CUSTOMER_FAULT_CLOSURE_REASON_LABEL[record.reasonCode] ?? '고객 사유';
  const at = formatClosureTimeKST(record.closedAt);
  return at
    ? `${label}로 ${at}에 환불 없이 종결한 주문이에요. 상품은 직접 처리해 주세요.`
    : `${label}로 환불 없이 종결한 주문이에요. 상품은 직접 처리해 주세요.`;
}
