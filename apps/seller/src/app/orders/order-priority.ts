import type { Order } from '@greenhub/shared';
import { STATUS_GROUP_MAP } from './_constants';

export interface OrderPriorityCounts {
  deliveryHeld: number;
  actionRequired: number;
}

/** 업무 우선순위에서 진입한 ACTION_REQUIRED 하위 포커스. 배송 보류는 부분집합이다. */
export type PriorityFocus = 'ALL' | 'DELIVERY_HELD';

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
 * 우선순위 포커스에 따른 ACTION_REQUIRED 하위 집합 필터.
 * `DELIVERY_HELD`는 배송 보류만, `ALL`은 확인 필요 전체를 그대로 반환한다.
 * 페이지의 filteredOrders와 동일한 단일 predicate를 공유하기 위한 pure helper다.
 */
export function filterOrdersByPriorityFocus<T extends Pick<Order, 'status'>>(
  orders: ReadonlyArray<T>,
  focus: PriorityFocus,
): T[] {
  if (focus === 'DELIVERY_HELD') return orders.filter((order) => order.status === 'DELIVERY_HELD');
  return [...orders];
}
