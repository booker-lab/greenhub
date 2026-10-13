// 주문 취소 사유 표시. 서버가 결제 자동 취소 때 남기는 내부 코드는 고객이 읽을 문장으로 바꾸고,
// 판매자·관리자가 적은 사유나 '고객 요청' 같은 문장은 그대로 보인다.
// 코드 출처: apps/api payments 결제 웹훅(payment_failed)·15분 정리(timeout)·금액 검증(amount_mismatch).
const CANCEL_REASON_LABELS = new Map<string, string>([
  ['timeout', '결제 시간이 지나 주문이 자동으로 취소됐어요'],
  ['payment_failed', '결제가 완료되지 않아 주문이 자동으로 취소됐어요'],
  [
    'amount_mismatch',
    '결제 금액이 주문 금액과 달라 주문이 자동으로 취소되고 결제한 금액은 환불돼요',
  ],
]);

/** 고객에게 보일 취소 사유. 사유가 없거나 문자열이 아니면 null. */
export function formatCancelReason(reason: unknown): string | null {
  if (typeof reason !== 'string') return null;
  const value = reason.trim();
  if (!value) return null;
  return CANCEL_REASON_LABELS.get(value) ?? value;
}
