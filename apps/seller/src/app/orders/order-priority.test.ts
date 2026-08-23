import type { OrderStatus } from '@greenhub/shared';
import { describe, expect, it } from 'vitest';
import { getOrderPriorityCounts } from './order-priority';

function orders(...statuses: OrderStatus[]) {
  return statuses.map((status) => ({ status }));
}

describe('셀러 주문 업무 우선순위', () => {
  it('배송 보류를 별도 집계하면서 기존 확인 필요 그룹에도 포함한다', () => {
    expect(
      getOrderPriorityCounts(
        orders('DELIVERY_HELD', 'PENDING', 'RECRUITING', 'ACCEPTED', 'CONFIRMED'),
      ),
    ).toEqual({
      deliveryHeld: 1,
      actionRequired: 5,
    });
  });

  it('대기·배송 중·완료·취소 주문을 확인 필요 건수로 승격하지 않는다', () => {
    expect(
      getOrderPriorityCounts(
        orders('PREPARING', 'DELIVERING', 'HUB_ARRIVED', 'DELIVERED', 'CANCELLED'),
      ),
    ).toEqual({
      deliveryHeld: 0,
      actionRequired: 0,
    });
  });
});
