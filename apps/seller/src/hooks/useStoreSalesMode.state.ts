import type { SalesMode } from '@greenhub/shared';

/**
 * 가게 판매 방식 조회 상태. 조회 실패를 실제 예전 방식(legacy)과 구분해야 하는 화면(회차 경고 등)이 쓴다.
 * - loading: 조회 중이거나 가게·토큰이 아직 없어요.
 * - ready: 조회에 성공했어요(응답에 판매 방식이 없으면 기본값 legacy).
 * - error: 조회에 실패했어요(판매 방식을 알 수 없어요).
 */
export type StoreSalesModeState =
  | { status: 'loading' }
  | { status: 'ready'; salesMode: SalesMode }
  | { status: 'error' };

/** 가게별로 기억하는 마지막 조회 결과. */
export type StoreSalesModeResult =
  | { storeId: string; status: 'ready'; salesMode: SalesMode }
  | { storeId: string; status: 'error' };

/** 다른 가게의 이전 결과는 쓰지 않고, 결과가 없으면 조회 중으로 본다. */
export function resolveStoreSalesModeState(
  result: StoreSalesModeResult | null,
  storeId: string | null | undefined,
): StoreSalesModeState {
  if (!result || !storeId || result.storeId !== storeId) return { status: 'loading' };
  return result.status === 'ready'
    ? { status: 'ready', salesMode: result.salesMode }
    : { status: 'error' };
}

/**
 * 메뉴·입력 숨김용 판매 방식. 조회 중이면 undefined(숨긴 상태로 시작해 깜빡임이 없다),
 * 조회에 실패하면 접근을 막지 않도록 'legacy'.
 */
export function toMenuSalesMode(state: StoreSalesModeState): SalesMode | undefined {
  if (state.status === 'loading') return undefined;
  return state.status === 'ready' ? state.salesMode : 'legacy';
}
