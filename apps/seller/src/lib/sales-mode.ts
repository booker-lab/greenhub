import type { SalesMode, SaleType } from '@greenhub/shared';

/**
 * 공동구매 선택·보기를 보일지. 공동구매는 예전 판매 방식(legacy) 가게에서만 쓴다.
 * 회차 판매(round_direct) 가게나 판매 방식을 아직 모를 때는 숨기되,
 * 이미 공동구매로 고른 값이 있으면 보여서 일반 판매로 되돌릴 수 있게 한다.
 */
export function showsGroupBuyChoice(
  salesMode: SalesMode | undefined,
  currentSaleType: SaleType,
): boolean {
  return salesMode === 'legacy' || currentSaleType === 'group';
}
