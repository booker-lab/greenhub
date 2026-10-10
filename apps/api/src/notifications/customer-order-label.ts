/**
 * 고객 알림 본문의 `#{orderId}` 자리에 넣을 값.
 *
 * 고객은 결제 완료·MY 주문 화면에서 주문번호(예: 20261101-000003)를 보므로 알림톡도 같은 번호를
 * 보여 준다. 문서 ID(32자 영숫자)는 고객이 대조할 수 없다. 주문번호가 없는 옛 주문만 문서 ID를 쓴다.
 * 알림 기록·멱등 키·운영 이슈 연결에는 계속 문서 ID를 쓴다(이 값은 본문 표시용이다).
 */
export function customerOrderLabel(
  order: Record<string, unknown> | null | undefined,
  orderId: string,
): string {
  const orderNumber = order?.['orderNumber'];
  if (typeof orderNumber === 'string' && orderNumber.trim()) return orderNumber.trim();
  return orderId;
}
