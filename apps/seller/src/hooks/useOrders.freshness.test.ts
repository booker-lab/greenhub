import type { OrderStatus } from '@greenhub/shared';
import { describe, expect, it } from 'vitest';
import {
  collectActionRequiredOrderIds,
  countNewActionRequiredOrders,
  SELLER_ORDERS_POLL_INTERVAL_MS,
  shouldPollSellerOrders,
} from './useOrders.freshness';

const order = (id: string, status: OrderStatus) => ({ id, status });

describe('Seller 주문 최신성 — 간격 재조회 판정', () => {
  it('간격은 60초 상수다', () => {
    expect(SELLER_ORDERS_POLL_INTERVAL_MS).toBe(60_000);
  });

  it('화면이 보이고 읽는 중이 아니면 다시 읽는다', () => {
    expect(shouldPollSellerOrders({ hidden: false, inFlight: false })).toBe(true);
  });

  it('숨은 탭에서는 멈춘다', () => {
    expect(shouldPollSellerOrders({ hidden: true, inFlight: false })).toBe(false);
    expect(shouldPollSellerOrders({ hidden: true, inFlight: true })).toBe(false);
  });

  it('이미 읽는 중이면 겹쳐 부르지 않는다', () => {
    expect(shouldPollSellerOrders({ hidden: false, inFlight: true })).toBe(false);
  });
});

describe('Seller 주문 최신성 — 새 처리 필요 주문 감지', () => {
  it('처리 필요 묶음 상태만 모은다', () => {
    const ids = collectActionRequiredOrderIds([
      order('a', 'PENDING'),
      order('b', 'DELIVERY_HELD'),
      order('c', 'PREPARING'),
      order('d', 'DELIVERING'),
      order('e', 'DELIVERED'),
      order('f', 'CANCELLED'),
      order('g', 'CONFIRMED'),
    ]);
    expect([...ids].sort()).toEqual(['a', 'b', 'g']);
  });

  it('이전 기준이 없으면(첫 조회·범위 전환 직후) 알리지 않는다', () => {
    expect(countNewActionRequiredOrders(null, new Set(['a', 'b']))).toBe(0);
  });

  it('이전에 없던 처리 필요 주문만 센다', () => {
    expect(countNewActionRequiredOrders(new Set(['a']), new Set(['a', 'b', 'c']))).toBe(2);
  });

  it('처리되어 빠진 주문이나 그대로인 목록은 새 주문이 아니다', () => {
    expect(countNewActionRequiredOrders(new Set(['a', 'b']), new Set(['b']))).toBe(0);
    expect(countNewActionRequiredOrders(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(0);
    expect(countNewActionRequiredOrders(new Set(), new Set())).toBe(0);
  });

  it('대기 중이던 주문이 처리 필요로 돌아오면(배송 보류 등) 새로 처리할 주문으로 센다', () => {
    const before = collectActionRequiredOrderIds([order('a', 'PENDING'), order('b', 'PREPARING')]);
    const after = collectActionRequiredOrderIds([
      order('a', 'PENDING'),
      order('b', 'DELIVERY_HELD'),
    ]);
    expect(countNewActionRequiredOrders(before, after)).toBe(1);
  });
});
