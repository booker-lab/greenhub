// 고객이 요청하지 않은 환불(회차 취소·관리자 환불·늦은 결제 자동 환불) 때 ORDER_CANCELLED
// 알림톡의 "사유" 칸에 들어가는 고정 문구. 파일럿 개시 전 사용자가 최종 문구를 확정한다
// (BACKLOG SILENT-REFUND-CUSTOMER-NOTICE). 문구만 바꿀 때는 이 파일만 고친다.
export const REFUND_NOTICE_REASONS = {
  ROUND_CANCELLED: '판매자 사정으로 이번 회차가 취소되어 전액 환불했습니다',
  ADMIN_REFUND: '운영 확인 후 전액 환불했습니다',
  LATE_PAYMENT: '결제 확인이 늦어 주문을 받을 수 없어 전액 환불했습니다',
} as const;

export type RefundNoticeKind = keyof typeof REFUND_NOTICE_REASONS;

/** 같은 주문·같은 사유의 안내는 한 번만 보낸다(재시도·중복 호출 대비). */
export function refundNoticeIdempotencyKey(kind: RefundNoticeKind, orderId: string): string {
  return `refund-notice:${kind}:${orderId}`;
}
