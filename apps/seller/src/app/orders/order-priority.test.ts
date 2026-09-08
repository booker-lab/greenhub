import type { OrderStatus } from '@greenhub/shared';
import { describe, expect, it } from 'vitest';
import { STATUS_GROUP_MAP } from './_constants';
import {
  filterActionRequiredOrders,
  getOrderPriorityCounts,
  shouldShowActionRequiredOrder,
} from './order-priority';

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

describe('셀러 주문 DELIVERY_HELD 진입 일관성', () => {
  it('DELIVERY_HELD는 업무상 처리 필요 그룹에 속하면서 별도 격리 진입이 가능하다', () => {
    expect(STATUS_GROUP_MAP.DELIVERY_HELD).toBe('ACTION_REQUIRED');
    expect(shouldShowActionRequiredOrder('DELIVERY_HELD', false)).toBe(true);
    expect(shouldShowActionRequiredOrder('DELIVERY_HELD', true)).toBe(true);
  });

  it('배송 보류 격리는 다른 처리 필요 상태를 포함하지 않는다', () => {
    for (const status of ['PENDING', 'RECRUITING', 'ACCEPTED', 'CONFIRMED'] as OrderStatus[]) {
      expect(shouldShowActionRequiredOrder(status, false)).toBe(true);
      expect(shouldShowActionRequiredOrder(status, true)).toBe(false);
    }
  });

  it('배송 보류 count와 격리 목록 진입이 1:1로 일치한다', () => {
    const input = orders(
      'DELIVERY_HELD',
      'PENDING',
      'DELIVERY_HELD',
      'ACCEPTED',
      'PREPARING',
      'DELIVERING',
    );
    const counts = getOrderPriorityCounts(input);
    expect(counts.deliveryHeld).toBe(2);

    const heldOnly = filterActionRequiredOrders(input, true);
    expect(heldOnly).toHaveLength(counts.deliveryHeld);
    expect(heldOnly.every((order) => order.status === 'DELIVERY_HELD')).toBe(true);

    const allAction = filterActionRequiredOrders(input, false);
    expect(allAction).toHaveLength(counts.actionRequired);
    expect(allAction.filter((order) => order.status === 'DELIVERY_HELD')).toHaveLength(
      counts.deliveryHeld,
    );
  });

  it('count에는 포함되지만 목록 진입 시 보이지 않는 누락이 없다', () => {
    const input = orders('DELIVERY_HELD', 'PENDING', 'CONFIRMED');
    const counts = getOrderPriorityCounts(input);
    // 전체 진입은 HELD를 포함하고, 격리 진입은 HELD만 보여준다.
    expect(filterActionRequiredOrders(input, false).map(({ status }) => status)).toEqual(
      expect.arrayContaining(['DELIVERY_HELD']),
    );
    expect(filterActionRequiredOrders(input, true).map(({ status }) => status)).toEqual([
      'DELIVERY_HELD',
    ]);
    expect(counts.actionRequired).toBe(3);
    expect(counts.deliveryHeld).toBe(1);
  });
});
