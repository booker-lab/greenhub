import type { Order } from '@greenhub/shared';
import { STATUS_GROUP_MAP } from './_constants';

export interface OrderPriorityCounts {
  deliveryHeld: number;
  actionRequired: number;
}

/**
 * 기존 주문 상태 그룹을 그대로 사용해 업무 우선순위 건수를 계산한다.
 * 배송 보류는 ACTION_REQUIRED에 포함되므로 두 건수는 상호 배타적이지 않다.
 */
export function getOrderPriorityCounts(
  orders: ReadonlyArray<Pick<Order, 'status'>>,
): OrderPriorityCounts {
  let deliveryHeld = 0;
  let actionRequired = 0;

  for (const order of orders) {
    if (order.status === 'DELIVERY_HELD') deliveryHeld += 1;
    if (STATUS_GROUP_MAP[order.status] === 'ACTION_REQUIRED') actionRequired += 1;
  }

  return { deliveryHeld, actionRequired };
}

/**
 * ACTION_REQUIRED 목록의 배송 보류 진입 predicate.
 * OrdersPage의 목록 필터와 동일한 조건을 공유해 count·진입 불일치를 방지한다.
 */
export function shouldShowActionRequiredOrder(
  status: Order['status'],
  heldOnly: boolean,
): boolean {
  if (!heldOnly) return STATUS_GROUP_MAP[status] === 'ACTION_REQUIRED';
  return status === 'DELIVERY_HELD';
}

/**
 * ACTION_REQUIRED 목록의 배송 보류 진입 필터.
 * - `heldOnly=false`: 기존 처리 필요 전체 (DELIVERY_HELD 포함, vocabulary 유지).
 * - `heldOnly=true`: DELIVERY_HELD만 격리 — 우선순위 "배송 보류 N건"과 목록 진입을 1:1로 일치시킨다.
 * OrderStatus 재정의·API lifecycle 변경 없이 Seller task vocabulary를 보존한다.
 */
export function filterActionRequiredOrders<T extends Pick<Order, 'status'>>(
  orders: ReadonlyArray<T>,
  heldOnly: boolean,
): T[] {
  return orders.filter((order) => shouldShowActionRequiredOrder(order.status, heldOnly));
}
