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
