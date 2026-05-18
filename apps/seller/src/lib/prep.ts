import type { Order } from '@greenhub/shared';

/** 셀러가 아직 발송 처리하지 않은 주문 상태 — 준비 물량 집계 대상. */
export const UNSHIPPED_STATUSES: ReadonlyArray<Order['status']> = [
  'ACCEPTED',
  'CONFIRMED',
  'PREPARING',
];

/** 로컬 기준 오늘 날짜 키 'YYYY-MM-DD'. */
export function todayKey(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 주문 배송예정일의 날짜 부분 'YYYY-MM-DD'. 없으면 null. (ISO8601·날짜문자열 모두 대응) */
export function deliveryDateKey(order: Order): string | null {
  return order.requestedDeliveryDate ? order.requestedDeliveryDate.slice(0, 10) : null;
}

/** 미발송 상태인지. */
export function isUnshipped(order: Order): boolean {
  return UNSHIPPED_STATUSES.includes(order.status);
}

/** 미발송 상태이며 배송예정일이 오늘 이전(경과)인 주문 — 발송 지연. */
export function isDelayed(order: Order, today: string = todayKey()): boolean {
  if (!isUnshipped(order)) return false;
  const key = deliveryDateKey(order);
  return key !== null && key < today;
}
