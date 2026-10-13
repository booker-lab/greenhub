import type { Order, Product } from '@greenhub/shared';
import { describe, expect, it } from 'vitest';
import { aggregatePrep, isDelayed } from './prep';

function order(overrides: Partial<Order>): Order {
  return {
    id: 'o',
    storeId: 'store-1',
    productId: 'p1',
    quantity: 1,
    saleType: 'normal',
    status: 'ACCEPTED',
    requestedDeliveryDate: '2026-11-10',
    ...overrides,
  } as Order;
}

const products = [
  { id: 'p1', name: '빅립' },
  { id: 'p2', name: '만천홍' },
] as Product[];

describe('aggregatePrep', () => {
  it('일반 판매 주문을 오늘·지연으로 나눠 상품별로 합산한다', () => {
    const result = aggregatePrep(
      [
        order({ id: 'a', productId: 'p1', quantity: 2 }),
        order({ id: 'b', productId: 'p1', quantity: 1 }),
        order({ id: 'c', productId: 'p2', quantity: 4, requestedDeliveryDate: '2026-11-09' }),
        order({ id: 'd', productId: 'p2', quantity: 9, requestedDeliveryDate: '2026-11-11' }),
        order({ id: 'e', productId: 'p2', quantity: 9, status: 'DELIVERED' }),
      ],
      products,
      '2026-11-10',
    );
    expect(result.today).toEqual([
      { productId: 'p1', productName: '빅립', selectionLabel: null, quantity: 3 },
    ]);
    expect(result.delayed).toEqual([
      { productId: 'p2', productName: '만천홍', selectionLabel: null, quantity: 4 },
    ]);
  });

  it('회차 주문은 대표 상품·총수량으로 잘못 합산하지 않고 제외한다', () => {
    const result = aggregatePrep(
      [
        // 빅립 1 + 만천홍 2를 담은 회차 주문: 목록에는 첫 상품과 총수량 3만 실린다.
        order({ id: 'round', productId: 'p1', quantity: 3, roundId: 'round-1' }),
        order({ id: 'normal', productId: 'p2', quantity: 1 }),
      ],
      products,
      '2026-11-10',
    );
    expect(result.today).toEqual([
      { productId: 'p2', productName: '만천홍', selectionLabel: null, quantity: 1 },
    ]);
  });
});

describe('isDelayed', () => {
  it('배송일이 지난 미발송 일반 주문은 발송 지연이다', () => {
    expect(isDelayed(order({ requestedDeliveryDate: '2026-11-10' }), '2026-11-11')).toBe(true);
    expect(isDelayed(order({ status: 'PREPARING' }), '2026-11-11')).toBe(true);
    expect(isDelayed(order({}), '2026-11-10')).toBe(false);
    expect(isDelayed(order({ status: 'DELIVERED' }), '2026-11-11')).toBe(false);
  });

  it('회차 주문은 회차 화면이 맡으므로 발송 지연으로 세지 않는다(준비 화면 집계와 같은 기준)', () => {
    expect(isDelayed(order({ status: 'PREPARING', roundId: 'round-1' }), '2026-11-11')).toBe(false);
  });
});
