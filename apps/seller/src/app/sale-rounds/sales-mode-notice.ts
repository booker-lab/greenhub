import type { StoreSalesModeState } from '@/hooks/useStoreSalesMode.state';

/**
 * 회차 화면에 보일 판매 방식 안내. 공개 API는 판매 방식이 round_direct가 아닌 가게의 회차를 404로 숨긴다
 * (apps/api sale-rounds.service assertPublicRoundStore).
 * - not_round_direct: 실제 예전 방식(legacy) 가게라 손님에게 회차가 보이지 않아요(단정 경고).
 * - unknown: 판매 방식 조회에 실패해 알 수 없어요(약한 안내).
 * - null: 조회 중(깜빡이지 않게)이거나 회차 판매 가게라 숨겨요.
 */
export type RoundSalesModeNotice = 'not_round_direct' | 'unknown' | null;

export function resolveRoundSalesModeNotice(state: StoreSalesModeState): RoundSalesModeNotice {
  if (state.status === 'error') return 'unknown';
  if (state.status === 'ready' && state.salesMode !== 'round_direct') return 'not_round_direct';
  return null;
}
