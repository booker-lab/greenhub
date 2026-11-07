import type { SaleRound, SaleRoundItem } from '@greenhub/shared';
import { isRoundOrderClosed } from '@/lib/round-schedule-label';

export type RoundProductState = 'current' | 'closed' | 'sold_out';

export interface RoundProductAvailability {
  state: RoundProductState;
  isPurchasable: boolean;
}

/**
 * 상품 상세의 회차 상품 상태(판매 중·마감·품절)와 구매 가능 여부.
 * 판매 중(OPEN) 회차라도 주문 마감 시각이 지났으면(서버 상태가 바뀌기 전 틈) 장바구니와 같게
 * isRoundOrderClosed로 마감으로 본다. 판매 예정(SCHEDULED) 회차는 시각과 관계없이 지금처럼
 * 현재 회차로 두되 구매는 막는다. 최종 판단은 서버 주문 검증이 한다.
 */
export function resolveRoundProductAvailability(
  round: Pick<SaleRound, 'status' | 'schedule'>,
  item: Pick<SaleRoundItem, 'status'>,
  nowMillis: number,
): RoundProductAvailability {
  const isOpenForOrder = round.status === 'OPEN' && !isRoundOrderClosed(round, nowMillis);
  const isCurrentRound = isOpenForOrder || round.status === 'SCHEDULED';
  const isCurrentItem = item.status === 'ACTIVE';
  // 판매 중 회차에서 수량이 찬 상품(결제 대기 예약 포함)은 회차 마감이 아니라 품절로 보인다.
  const isSoldOut = isCurrentRound && item.status === 'SOLD_OUT';

  return {
    state: isCurrentRound && isCurrentItem ? 'current' : isSoldOut ? 'sold_out' : 'closed',
    isPurchasable: isOpenForOrder && isCurrentItem,
  };
}
