import {
  type OrderStatus,
  POST_DELIVERY_REFUND_MEMO_MAX_LENGTH,
  POST_DELIVERY_REFUND_SELLER_WINDOW_DAYS,
  POST_DELIVERY_REFUNDABLE_STATUSES,
} from '@greenhub/shared';

/** 서버 `GET .../post-delivery-refund` 응답(판매자 직접 환불 가능 여부). */
export interface SellerRefundEligibility {
  eligible: boolean;
  reason:
    | 'OK'
    | 'NOT_ROUND_ORDER'
    | 'NOT_DELIVERED'
    | 'ALREADY_REFUNDED'
    | 'CANCELLATION_IN_PROGRESS'
    | 'NO_SETTLEMENT'
    | 'SETTLEMENT_PAID'
    | 'WINDOW_EXPIRED'
    | 'NO_PAYMENT';
  deadline: string | null;
  amount: number | null;
}

/** 배송 완료로 표시된 주문만 환불 가능 여부를 묻는다. */
export function shouldCheckPostDeliveryRefund(status: OrderStatus): boolean {
  return POST_DELIVERY_REFUNDABLE_STATUSES.includes(status);
}

/** 버튼 대신 보여 줄 안내. null이면 아무것도 보여 주지 않는다. */
export function postDeliveryRefundBlockedMessage(
  reason: SellerRefundEligibility['reason'],
): string | null {
  switch (reason) {
    case 'OK':
    case 'ALREADY_REFUNDED':
    case 'NOT_DELIVERED':
      return null;
    case 'CANCELLATION_IN_PROGRESS':
      return '환불이 처리 중입니다. 잠시 뒤 다시 확인해 주세요.';
    case 'WINDOW_EXPIRED':
      return `배송 완료 ${POST_DELIVERY_REFUND_SELLER_WINDOW_DAYS}일이 지나 직접 환불할 수 없어요. 환불이 필요하면 관리자에게 문의해 주세요.`;
    case 'SETTLEMENT_PAID':
      return '정산금이 이미 지급된 주문이라 직접 환불할 수 없어요. 환불이 필요하면 관리자에게 문의해 주세요.';
    default:
      return '이 주문은 직접 환불할 수 없어요. 환불이 필요하면 관리자에게 문의해 주세요.';
  }
}

/** 마감 시각을 "11월 8일 15:00"처럼 한국 시간으로 보여 준다(실행 환경 언어 설정과 무관). 값이 없으면 null. */
export function formatRefundDeadline(deadline: string | null): string | null {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime();
  if (Number.isNaN(ms)) return null;
  const kst = new Date(ms + 9 * 60 * 60 * 1000);
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mm = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 ${hh}:${mm}`;
}

/** 확인 버튼을 누를 수 있는지: 사유를 골랐고 메모가 한 줄(1~200자)이어야 한다. */
export function canSubmitPostDeliveryRefund(reasonCode: string | null, memo: string): boolean {
  const trimmed = memo.trim();
  return (
    !!reasonCode &&
    trimmed.length > 0 &&
    trimmed.length <= POST_DELIVERY_REFUND_MEMO_MAX_LENGTH &&
    !/[\r\n]/.test(memo)
  );
}
