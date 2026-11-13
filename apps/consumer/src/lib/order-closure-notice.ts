/**
 * 고객 사유 종결(환불 없음) 안내 문구 — 주문 상세 화면.
 *
 * 회차 직배송 주문이 고객 책임 보류(기상·상품 파손 제외)일 때, 손님이 수령을 거부했거나 재배송비를
 * 기한(보류한 날 다음 날부터 3일째 되는 날 끝)까지 결제하지 않으면 판매자가 환불 없이 주문을 종결할 수 있다.
 * 기한 계산은 API·판매자 앱과 같은 공유 함수(@greenhub/shared customer-fault-closure)를 쓴다.
 * 종결된 주문(CLOSED_UNDELIVERED)은 환불되지 않는 이유와 상품 처리를 알린다.
 */

import {
  type DeliveryHoldReasonCode,
  formatKoreanMonthDayKST,
  isCustomerFaultClosableHoldReason,
  type OrderStatus,
  redeliveryFeePaymentDeadlineDateKST,
} from '@greenhub/shared';

export const CLOSED_UNDELIVERED_TITLE = '배송하지 못해 주문이 종결됐어요';

export const CLOSED_UNDELIVERED_MESSAGE =
  '고객 사유(수령 거부·재배송비 미결제)로 배송하지 못해 주문이 종결됐어요. 살아 있는 꽃이라 다시 판매할 수 없어 결제 금액은 환불되지 않고, 상품은 판매자가 처리해요.';

export const RECEIPT_REFUSED_CLOSURE_WARNING = '판매자가 환불 없이 주문을 종결할 수 있어요.';

export interface ClosureWarningInput {
  isRoundOrder: boolean;
  deliveryMethod: 'direct' | 'hub' | 'parcel';
  status: OrderStatus;
  deliveryHold: {
    heldAt: string;
    reasonCode: DeliveryHoldReasonCode;
    customerResponsible: boolean;
    resolvedAt: string | null;
  } | null;
  /** 재배송비 결제가 끝났으면 종결 경고를 보이지 않는다. */
  redeliveryPaid: boolean;
}

/**
 * 고객 책임 보류에서 재배송비를 기다리는 주문에 보일 종결 경고. 해당하지 않으면 null.
 * 수령 거부는 바로 종결될 수 있고, 그 밖에는 결제 마지막 날을 알려 준다.
 */
export function customerFaultClosureWarning(input: ClosureWarningInput): string | null {
  const hold = input.deliveryHold;
  if (
    !input.isRoundOrder ||
    input.deliveryMethod !== 'direct' ||
    (input.status !== 'DELIVERY_HELD' && input.status !== 'PREPARING') ||
    !hold ||
    hold.resolvedAt !== null ||
    hold.customerResponsible !== true ||
    !isCustomerFaultClosableHoldReason(hold.reasonCode) ||
    input.redeliveryPaid
  ) {
    return null;
  }
  if (hold.reasonCode === 'RECEIPT_REFUSED') return RECEIPT_REFUSED_CLOSURE_WARNING;
  const deadline = formatKoreanMonthDayKST(redeliveryFeePaymentDeadlineDateKST(hold.heldAt));
  if (!deadline) return null;
  return `${deadline}까지 재배송비를 결제하지 않으면 환불 없이 주문이 종결될 수 있어요.`;
}
