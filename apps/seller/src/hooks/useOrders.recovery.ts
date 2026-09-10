/**
 * Seller 주문 목록 recovery 순수 계약.
 * `useOrders.ts`의 runtime effect와 동일한 판정을 공유하되,
 * vitest에서 `@/` alias 없이 직접 검증할 수 있도록 Framework 의존성을 두지 않는다.
 */

export const SELLER_ORDERS_AUTH_ERROR = '셀러 스토어 인증 정보를 확인할 수 없습니다.';

export type SellerOrdersAuthState = 'loading' | 'missing' | 'ready';

/**
 * Seller 주문 목록의 인증 전제를 판정한다.
 * - `loading`: 세션 transient — recoverable loading/refreshing 유지, fail-closed 금지.
 * - `missing`: 확정된 prerequisite 부재(unauthenticated/store·token 없음) — 빈 결과로 확정하지 않고 인증 오류로 닫는다.
 * - `ready`: network fetch 가능.
 * `useSaleRounds`의 동일 분기와 메시지를 공유한다.
 */
export function resolveSellerOrdersAuthState(
  sessionStatus: string,
  storeId: string | null,
  token: string | null | undefined,
): SellerOrdersAuthState {
  if (sessionStatus === 'loading') return 'loading';
  if (!storeId || !token) return 'missing';
  return 'ready';
}

/** 기존 데이터가 있으면 initial loading으로 되돌리지 않고 background refreshing을 사용한다. */
export function isSellerOrdersBackgroundRefresh(hasData: boolean): boolean {
  return hasData;
}

/** race guard: 취소됐거나 최신 요청이 아니면 응답을 무시한다. */
export function shouldIgnoreSellerOrdersResponse(
  active: boolean,
  currentRequestId: number,
  responseRequestId: number,
): boolean {
  return !active || currentRequestId !== responseRequestId;
}

/** network refetch 경로. manual refresh/retry/focus 재검증이 동일한 경로를 사용한다. */
export function buildSellerOrdersPath(storeId: string): string {
  return `/stores/${encodeURIComponent(storeId)}/orders`;
}

/**
 * Seller 주문 read scope identity — 최소 `storeId + auth token`.
 * 같은 store라도 token이 바뀌면 별도 scope이며, 이전 scope의
 * orders/count/badge/hasData/error authority를 재사용하지 않는다.
 * `\0` 구분자로 store·token 경계를 보존한다.
 */
export function buildSellerOrdersScopeKey(
  storeId: string | null,
  token: string | null | undefined,
): string {
  return `${storeId ?? ''}\u0000${token ?? ''}`;
}

/**
 * Cross-scope reuse 판정: 이전 scope key와 다음 scope key가 다르면
 * 이전 scope의 orders/count/badge/hasData/error를 즉시 무효화해야 한다.
 * (A→B, A→missing, missing→A 포함. 동일 scope는 무효화하지 않는다.)
 */
export function shouldInvalidateSellerOrdersScope(
  prevScopeKey: string | null,
  nextScopeKey: string | null,
): boolean {
  return (prevScopeKey ?? null) !== (nextScopeKey ?? null);
}

/**
 * Scope guard: 현재 scope와 응답 scope가 다르면 늦은 응답이라도
 * 현재 scope state를 덮지 않는다. requestId guard와 함께 사용한다.
 */
export function shouldIgnoreSellerOrdersScopeResponse(
  currentScopeKey: string,
  responseScopeKey: string,
): boolean {
  return currentScopeKey !== responseScopeKey;
}

/**
 * 초기 결과 구분: 인증·network 오류와 빈 목록을 혼동하지 않는다.
 * - error + 데이터 없음 → error UI (EMPTY collapse 금지)
 * - error + stale 있음 → stale 유지 + 인라인 오류
 * - error 없음 + 데이터 없음 → empty
 */
export function resolveSellerOrdersInitialView(
  ordersLength: number,
  error: string | null,
): 'error' | 'empty' | 'list' {
  if (error && ordersLength === 0) return 'error';
  if (ordersLength === 0) return 'empty';
  return 'list';
}
