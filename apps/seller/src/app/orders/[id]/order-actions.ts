import type { Order } from '@greenhub/shared';
import { CANCELLABLE_STATUSES } from './_lib';

// 주문 상세 하단 버튼 — 상태별로 판매자에게 허용된 전이(API orders.helpers.ts SELLER_TRANSITIONS)만 보인다.

export interface OrderDetailActions {
  /** ACCEPTED·CONFIRMED → PREPARING */
  prepare: boolean;
  /** 택배 PREPARING → DELIVERED */
  shipParcel: boolean;
  /** 기사가 가져가기 전 PREPARING → DELIVERY_HELD(직배송·거점). 택배는 기사 배송이 아니라 제외. */
  hold: boolean;
  /** DELIVERY_HELD → PREPARING(재배송 준비) */
  releaseHold: boolean;
  /** → CANCELLED(결제 금액 환불) */
  cancel: boolean;
}

export function resolveOrderDetailActions(
  order: Pick<Order, 'status' | 'deliveryMethod'>,
): OrderDetailActions {
  return {
    prepare: order.status === 'ACCEPTED' || order.status === 'CONFIRMED',
    shipParcel: order.deliveryMethod === 'parcel' && order.status === 'PREPARING',
    hold: order.status === 'PREPARING' && order.deliveryMethod !== 'parcel',
    releaseHold: order.status === 'DELIVERY_HELD',
    cancel: CANCELLABLE_STATUSES.includes(order.status),
  };
}

/**
 * 보류 주문을 재배송 준비(PREPARING)로 돌릴 때 서버가 하는 일.
 * - PAYMENT_REQUEST: 유료 재배송(고객 책임·재배송비 > 0·미해소)이고 아직 결제 전 → 결제 요청 알림톡,
 *   결제 전에는 기사가 배송을 다시 시작할 수 없다.
 * - ALREADY_PAID: 유료 재배송인데 이미 결제됨 → 서버는 그래도 결제 요청 알림톡을 보낸다.
 * - FREE: 무료·판매자 책임 보류 → 보류를 해소하고 알림톡 없이 기사 수거 대기로 돌아간다.
 * 서버 판단(isCurrentRedeliveryPaymentRequired)은 상세 응답의 redeliveryPayment.required로 받는다.
 */
export type HoldReleaseMode = 'PAYMENT_REQUEST' | 'ALREADY_PAID' | 'FREE';

function holdRequiresPayment(hold: Order['deliveryHold']): boolean {
  const fee = hold?.redeliveryFee;
  return (
    hold?.customerResponsible === true &&
    typeof fee === 'number' &&
    Number.isFinite(fee) &&
    fee > 0 &&
    !hold.resolvedAt
  );
}

export function resolveHoldReleaseMode(
  order: Pick<Order, 'deliveryHold' | 'redeliveryPayment'>,
): HoldReleaseMode {
  const required = order.redeliveryPayment?.required ?? holdRequiresPayment(order.deliveryHold);
  if (!required) return 'FREE';
  return order.redeliveryPayment?.paid ? 'ALREADY_PAID' : 'PAYMENT_REQUEST';
}

/** 재배송 준비 확인 창 문구. */
export function holdReleaseMessage(
  order: Pick<Order, 'deliveryHold' | 'redeliveryPayment'>,
): string {
  const fee = order.deliveryHold?.redeliveryFee;
  const amount = typeof fee === 'number' && fee > 0 ? ` ${fee.toLocaleString()}원` : '';
  switch (resolveHoldReleaseMode(order)) {
    case 'PAYMENT_REQUEST':
      return `고객에게 재배송비${amount} 결제 요청 알림톡이 가요. 결제가 끝나야 기사가 배송을 다시 시작할 수 있어요.`;
    case 'ALREADY_PAID':
      return `재배송비${amount}은 이미 결제됐어요. 기사 화면 수거 대기로 돌아가 바로 배송을 다시 시작할 수 있어요. 다만 고객에게 결제 요청 알림톡이 한 번 더 가요.`;
    default:
      return '기사 화면 수거 대기로 돌아가요(알림톡 없음).';
  }
}
