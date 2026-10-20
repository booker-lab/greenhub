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

/**
 * 주문 목록 범위. 모든 기간의 주문을 통째로 받지 않도록 화면마다 필요한 범위만 고른다.
 * - `{ scope: 'active' }`: 진행 중 주문(처리 필요·대기·배송 중) 전부 — 홈·준비 물량·주문 화면
 * - `{ roundId }`: 그 회차의 주문 전부 — 회차 상세·주문 화면의 회차 필터
 * 끝난 주문(완료·취소)은 `buildArchivedOrdersPath`로 나눠 받는다.
 */
export type SellerOrdersQuery = { scope: 'active' } | { roundId: string };

export const ACTIVE_SELLER_ORDERS_QUERY: SellerOrdersQuery = { scope: 'active' };

/** 범위를 쿼리 문자열로 바꾼다. 같은 범위면 같은 문자열이라 hook 의존성·scope key로 쓴다. */
export function buildSellerOrdersQueryString(query?: SellerOrdersQuery): string {
  if (!query) return '';
  if ('roundId' in query) return `?roundId=${encodeURIComponent(query.roundId)}`;
  return '?scope=active';
}

/** network refetch 경로. manual refresh/retry/focus 재검증이 동일한 경로를 사용한다. */
export function buildSellerOrdersPath(storeId: string, query?: SellerOrdersQuery): string {
  return `/stores/${encodeURIComponent(storeId)}/orders${buildSellerOrdersQueryString(query)}`;
}

/**
 * Seller 주문 read scope identity — 최소 `storeId + auth token`(+ 목록 범위).
 * 같은 store라도 token이나 목록 범위가 바뀌면 별도 scope이며, 이전 scope의
 * orders/count/badge/hasData/error authority를 재사용하지 않는다.
 * `\0` 구분자로 store·token·범위 경계를 보존한다.
 */
export function buildSellerOrdersScopeKey(
  storeId: string | null,
  token: string | null | undefined,
  queryString = '',
): string {
  const base = `${storeId ?? ''}\u0000${token ?? ''}`;
  return queryString ? `${base}\u0000${queryString}` : base;
}

/** 끝난 주문(완료·취소) 한 번에 받는 건수. */
export const ARCHIVED_ORDERS_PAGE_SIZE = 50;

/** 끝난 주문 페이지 경로. cursor는 앞 응답의 nextCursor다. */
export function buildArchivedOrdersPath(storeId: string, cursor: string | null = null): string {
  const params = new URLSearchParams({
    scope: 'archive',
    limit: String(ARCHIVED_ORDERS_PAGE_SIZE),
  });
  if (cursor) params.set('cursor', cursor);
  return `/stores/${encodeURIComponent(storeId)}/orders?${params.toString()}`;
}

export interface ArchivedOrdersPage<T> {
  orders: T[];
  hasMore: boolean;
  nextCursor: string | null;
}

/** 끝난 주문 페이지 응답 검사. 모양이 다르면 빈 목록으로 바꾸지 않고 오류로 닫는다. */
export function parseArchivedOrdersPage<T>(payload: unknown): ArchivedOrdersPage<T> {
  if (typeof payload === 'object' && payload !== null) {
    const { orders, hasMore, nextCursor } = payload as Record<string, unknown>;
    const cursorOk = nextCursor === null || (typeof nextCursor === 'string' && nextCursor !== '');
    if (
      Array.isArray(orders) &&
      typeof hasMore === 'boolean' &&
      cursorOk &&
      hasMore === (nextCursor !== null)
    ) {
      return { orders: orders as T[], hasMore, nextCursor: nextCursor as string | null };
    }
  }
  throw new Error('끝난 주문 목록 응답 형식이 올바르지 않습니다.');
}

/** 끝난 주문 상태별 건수 경로. */
export function buildOrderSummaryPath(storeId: string): string {
  return `/stores/${encodeURIComponent(storeId)}/orders/summary`;
}

/** 끝난 주문 건수를 탭 묶음(완료·취소)으로 바꾼다. 응답 모양이 다르면 오류로 닫는다(0건으로 속이지 않는다). */
export function parseArchivedGroupCounts(payload: unknown): { DONE: number; CANCELLED: number } {
  const counts =
    typeof payload === 'object' && payload !== null
      ? (payload as { archivedStatusCounts?: unknown }).archivedStatusCounts
      : undefined;
  if (typeof counts === 'object' && counts !== null) {
    const read = (key: string) => (counts as Record<string, unknown>)[key];
    const values = ['DELIVERED', 'PICKED_UP', 'REVIEWED', 'CANCELLED'].map(read);
    if (
      values.every((value) => typeof value === 'number' && Number.isInteger(value) && value >= 0)
    ) {
      const [delivered, pickedUp, reviewed, cancelled] = values as number[];
      return { DONE: delivered + pickedUp + reviewed, CANCELLED: cancelled };
    }
  }
  throw new Error('주문 건수 응답 형식이 올바르지 않습니다.');
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
