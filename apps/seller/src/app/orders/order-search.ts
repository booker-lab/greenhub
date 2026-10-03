import type { Order } from '@greenhub/shared';

/** 서버 전화 검색을 부르는 최소 숫자 수 — API `normalizeSellerPhoneSearch`와 같은 값 */
export const PHONE_SEARCH_MIN_DIGITS = 4;
const PHONE_SEARCH_MAX_DIGITS = 20;

/**
 * 목록 응답에는 전화번호가 없다. 검색어가 숫자·하이픈·공백·괄호·+로만 되어 있고
 * 숫자가 4~20자리면 서버 전화 검색에 보낼 숫자를 돌려준다. 아니면 null(서버 호출 안 함).
 */
export function phoneSearchDigits(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed || !/^[\d\s\-+().]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < PHONE_SEARCH_MIN_DIGITS || digits.length > PHONE_SEARCH_MAX_DIGITS) {
    return null;
  }
  return digits;
}

function compact(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

/**
 * 통합 검색 한 칸 — 손님 이름·주문번호는 목록 데이터로 바로 비교하고,
 * 전화는 서버가 찾아 준 주문 id(phoneMatchIds)에 들어 있는지로 판단한다.
 * 검색어가 비어 있으면 항상 통과한다.
 */
export function matchesOrderSearch(
  order: Pick<Order, 'id' | 'buyerName' | 'orderNumber'>,
  query: string,
  phoneMatchIds?: ReadonlySet<string> | null,
): boolean {
  const q = compact(query);
  if (!q) return true;
  if (order.buyerName && compact(order.buyerName).includes(q)) return true;
  const orderNumber = order.orderNumber ?? `#${order.id.slice(-8).toUpperCase()}`;
  if (compact(orderNumber).includes(q)) return true;
  return phoneMatchIds?.has(order.id) ?? false;
}

export function filterOrdersBySearch<T extends Pick<Order, 'id' | 'buyerName' | 'orderNumber'>>(
  orders: T[],
  query: string,
  phoneMatchIds?: ReadonlySet<string> | null,
): T[] {
  if (!compact(query)) return orders;
  return orders.filter((order) => matchesOrderSearch(order, query, phoneMatchIds));
}
