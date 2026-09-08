import type { OrderStatus } from '@greenhub/shared';
import { describe, expect, it } from 'vitest';
import { getDateRange, STATUS_GROUP_MAP } from './_constants';
import { filterOrdersByPriorityFocus, getOrderPriorityCounts } from './order-priority';

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

  it('배송 보류 포커스는 DELIVERY_HELD 부분집합만 표시한다', () => {
    const input = orders('DELIVERY_HELD', 'PENDING', 'ACCEPTED', 'DELIVERY_HELD', 'CONFIRMED');
    expect(filterOrdersByPriorityFocus(input, 'DELIVERY_HELD').map((o) => o.status)).toEqual([
      'DELIVERY_HELD',
      'DELIVERY_HELD',
    ]);
  });

  it('확인 필요 포커스는 ACTION_REQUIRED 전체를 유지한다', () => {
    const input = orders('DELIVERY_HELD', 'PENDING', 'ACCEPTED');
    expect(filterOrdersByPriorityFocus(input, 'ALL')).toHaveLength(3);
  });

  it('우선순위 진입 시 날짜 해제(custom 빈 값)는 날짜 필터를 미적용한다', () => {
    expect(getDateRange('custom', 'ACTION_REQUIRED', '', '')).toBeNull();
  });

  it('우선순위 건수는 탭+포커스+날짜해제 뒤 표시 집합과 일치한다', () => {
    const input = orders(
      'DELIVERY_HELD',
      'PENDING',
      'PREPARING',
      'DELIVERY_HELD',
      'CANCELLED',
      'CONFIRMED',
    );
    const counts = getOrderPriorityCounts(input);
    const tabFiltered = input.filter(
      (o) => STATUS_GROUP_MAP[o.status] === 'ACTION_REQUIRED',
    );
    expect(counts.actionRequired).toBe(tabFiltered.length);
    expect(filterOrdersByPriorityFocus(tabFiltered, 'DELIVERY_HELD')).toHaveLength(
      counts.deliveryHeld,
    );
    expect(filterOrdersByPriorityFocus(tabFiltered, 'ALL')).toHaveLength(counts.actionRequired);
  });
});
