import type { SaleRoundItem } from '@greenhub/shared';
import { describe, expect, it } from 'vitest';
import { buildRoundPurchaseList, isPurchaseListRound, isRoundOrder } from './round-purchase-list';

function item(
  id: string,
  name: string,
  displayOrder: number,
  orderedQuantity: number,
  reservedQuantity = 0,
): SaleRoundItem {
  return {
    id,
    roundId: 'round-1',
    storeId: 'store-1',
    productId: `product-${id}`,
    productNameSnapshot: name,
    productImageUrlSnapshot: null,
    roundPrice: 30000,
    saleLimitQuantity: 10,
    reservedQuantity,
    orderedQuantity,
    displayOrder,
    status: 'ACTIVE',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

const counters = {
  reservedDeliveryAddresses: 1,
  reservedItemQuantity: 1,
  orderedDeliveryAddresses: 4,
  orderedItemQuantity: 7,
  heldOrderCount: 0,
};

describe('buildRoundPurchaseList', () => {
  it('회차 상품별 확정 주문 수량을 진열 순서대로 보여 준다', () => {
    const list = buildRoundPurchaseList({
      counters,
      items: [item('b', '만천홍', 2, 2), item('a', '빅립', 1, 5, 1)],
    });
    expect(list.lines.map((line) => [line.productName, line.orderedQuantity])).toEqual([
      ['빅립', 5],
      ['만천홍', 2],
    ]);
    expect(list.orderedTotal).toBe(7);
    expect(list.pendingTotal).toBe(1);
    expect(list.orderedDeliveryAddresses).toBe(4);
  });

  it('여러 상품을 담은 주문도 상품별로 나뉜 회차 수량을 그대로 쓴다(첫 상품으로 몰지 않는다)', () => {
    const list = buildRoundPurchaseList({
      counters,
      items: [item('a', '빅립', 1, 1), item('b', '만천홍', 2, 2), item('c', 'v3', 3, 0)],
    });
    expect(list.lines.find((line) => line.productName === '만천홍')?.orderedQuantity).toBe(2);
    expect(list.lines.find((line) => line.productName === 'v3')?.orderedQuantity).toBe(0);
  });
});

describe('isPurchaseListRound', () => {
  it('판매 중·주문 마감 회차만 구매 목록 대상이다', () => {
    expect(isPurchaseListRound({ status: 'OPEN' })).toBe(true);
    expect(isPurchaseListRound({ status: 'CLOSED' })).toBe(true);
    for (const status of ['DRAFT', 'SCHEDULED', 'COMPLETED', 'CANCELLED'] as const) {
      expect(isPurchaseListRound({ status })).toBe(false);
    }
  });
});

describe('isRoundOrder', () => {
  it('roundId가 있는 주문만 회차 주문이다', () => {
    expect(isRoundOrder({ roundId: 'round-1' })).toBe(true);
    expect(isRoundOrder({ roundId: null })).toBe(false);
    expect(isRoundOrder({})).toBe(false);
  });
});
