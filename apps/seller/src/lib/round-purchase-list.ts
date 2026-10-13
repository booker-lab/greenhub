import type { SaleRound, SaleRoundItem } from '@greenhub/shared';

// 회차 구매 목록: 경매에서 살 상품별 수량.
// 서버가 결제 확정 때 늘리고 취소·환불 때 되돌리는 회차 상품 `orderedQuantity`를 그대로 쓴다.
// (주문 목록의 대표 상품·총수량으로 다시 합산하면 여러 상품 주문이 첫 상품으로 몰린다.)
// `reservedQuantity`는 결제 진행 중인 수량으로, 결제되면 주문 수량으로 옮겨진다.

export interface RoundPurchaseLine {
  roundItemId: string;
  productName: string;
  orderedQuantity: number;
  pendingQuantity: number;
}

export interface RoundPurchaseList {
  lines: RoundPurchaseLine[];
  orderedTotal: number;
  pendingTotal: number;
  orderedDeliveryAddresses: number;
}

/** 구매 목록을 보여 줄 회차: 주문이 들어올 수 있거나 들어온 뒤 아직 끝나지 않은 회차. */
export const PURCHASE_LIST_STATUSES: ReadonlyArray<SaleRound['status']> = ['OPEN', 'CLOSED'];

export function isPurchaseListRound(round: Pick<SaleRound, 'status'>): boolean {
  return PURCHASE_LIST_STATUSES.includes(round.status);
}

export function buildRoundPurchaseList(
  round: Pick<SaleRound, 'counters'> & { items: SaleRoundItem[] },
): RoundPurchaseList {
  const lines = [...round.items]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((item) => ({
      roundItemId: item.id,
      productName: item.productNameSnapshot,
      orderedQuantity: item.orderedQuantity,
      pendingQuantity: item.reservedQuantity,
    }));
  return {
    lines,
    orderedTotal: lines.reduce((sum, line) => sum + line.orderedQuantity, 0),
    pendingTotal: lines.reduce((sum, line) => sum + line.pendingQuantity, 0),
    orderedDeliveryAddresses: round.counters.orderedDeliveryAddresses,
  };
}

/** 회차 주문은 회차 구매 목록이 맡는다. 일반 판매 준비 물량 집계에서는 뺀다. */
export function isRoundOrder(order: { roundId?: string | null }): boolean {
  return typeof order.roundId === 'string' && order.roundId.length > 0;
}
