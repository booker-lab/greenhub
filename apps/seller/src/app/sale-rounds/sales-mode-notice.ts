import type { SalesMode } from '@greenhub/shared';

/**
 * 회차 판매 전환 경고를 보일지. 공개 API는 판매 방식이 round_direct가 아닌 가게의 회차를 404로 숨긴다
 * (apps/api sale-rounds.service assertPublicRoundStore). 조회 중(undefined)에는 깜빡이지 않게 숨긴다.
 * useStoreSalesMode는 조회 실패도 'legacy'로 돌려주므로 경고 문구는 단정하지 않는다.
 */
export function showsRoundSalesModeWarning(salesMode: SalesMode | undefined): boolean {
  return salesMode !== undefined && salesMode !== 'round_direct';
}
