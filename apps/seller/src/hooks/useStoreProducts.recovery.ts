/**
 * Seller 상품 조회 read recovery 순수 계약.
 * `useStoreProducts.ts`의 runtime effect와 동일한 판정을 공유하되,
 * vitest에서 `@/` alias 없이 직접 검증할 수 있도록 framework 의존성을 두지 않는다.
 *
 * Collapse 방지 원칙:
 * - Firestore 성공 0건만 true empty.
 * - 첫 조회 실패는 상품 0건으로 표시하지 않고 visible error + retry.
 * - 이전 정상 snapshot 뒤 listener 실패는 stale을 유지하고 []로 지우지 않는다.
 * - scope(storeId) 변경 시 이전 store 데이터를 새 scope의 authoritative data처럼 노출하지 않는다.
 */

export type StoreProductsScope = string | null;

export type StoreProductsView = 'LOADING' | 'READ_FAILED' | 'STALE' | 'EMPTY' | 'READY';

export interface StoreProductsViewInput {
  storeId: StoreProductsScope;
  loading: boolean;
  error: string | null;
  productCount: number;
  hasLoaded: boolean;
}

/** scope가 바뀌면 이전 scope 데이터를 무효화해야 한다 (A→B, A→null, null→A 포함). */
export function shouldInvalidateStoreProductsScope(
  prevStoreId: StoreProductsScope,
  nextStoreId: StoreProductsScope,
): boolean {
  return prevStoreId !== nextStoreId;
}

/** 이전 정상 데이터가 있으면 initial loading으로 되돌리지 않고 background 갱신으로 취급한다. */
export function isStoreProductsBackgroundRefresh(hasLoaded: boolean): boolean {
  return hasLoaded;
}

/**
 * 상품 목록 읽기 상태를 단일 view로 판정한다.
 * 우선순위: SCOPE 미확정/초기 로딩 > 첫 조회 실패 > stale > 성공 empty > 정상 목록.
 */
export function resolveStoreProductsView(input: StoreProductsViewInput): StoreProductsView {
  const { storeId, loading, error, productCount, hasLoaded } = input;

  if (!storeId) {
    return 'LOADING';
  }
  if (!hasLoaded && loading && !error) {
    return 'LOADING';
  }
  if (error && !hasLoaded) {
    return 'READ_FAILED';
  }
  if (error && hasLoaded) {
    return 'STALE';
  }
  if (!error && hasLoaded && productCount === 0) {
    return 'EMPTY';
  }
  if (!error && hasLoaded && productCount > 0) {
    return 'READY';
  }
  // hasLoaded=false인데 loading도 error도 없는 transient (scope 전환 직후 등)는 로딩으로 닫는다.
  if (!hasLoaded) {
    return 'LOADING';
  }
  return 'READY';
}

/** 목록 view에서 필터 0건은 read error와 별개로 판정한다. */
export function resolveStoreProductsFilteredView(
  view: StoreProductsView,
  filteredCount: number,
): 'error' | 'stale' | 'loading' | 'empty' | 'filter-empty' | 'list' {
  if (view === 'LOADING') return 'loading';
  if (view === 'READ_FAILED') return 'error';
  if (view === 'STALE') return filteredCount === 0 ? 'filter-empty' : 'stale';
  if (view === 'EMPTY') return 'empty';
  if (filteredCount === 0) return 'filter-empty';
  return 'list';
}

/**
 * 상품 기반 집계(준비 수량·홈 현황)를 신뢰 가능한 수치로 취급해도 되는지 판정한다.
 * - hasLoaded + error 없음일 때만 신뢰.
 * - 초기 로딩·첫 실패·stale 모두 신뢰 불가(정상 0으로 오인 금지).
 */
export function areStoreProductCountsTrustworthy(input: {
  hasLoaded: boolean;
  loading: boolean;
  error: string | null;
}): boolean {
  if (input.error) return false;
  if (!input.hasLoaded) return false;
  if (input.loading) return false;
  return true;
}

/** listener 재구독 키. retry 호출마다 단조 증가하며 effect deps로 사용된다. */
export function nextStoreProductsRetryKey(current: number): number {
  return current + 1;
}

/** retry 키가 바뀌면 기존 listener를 정리하고 재구독해야 한다. */
export function shouldResubscribeStoreProducts(prevKey: number, nextKey: number): boolean {
  return prevKey !== nextKey;
}

/** race guard: 취소됐거나 최신 scope/구독이 아니면 snapshot/error 콜백을 무시한다. */
export function shouldIgnoreStoreProductsCallback(
  active: boolean,
  subscribedStoreId: StoreProductsScope,
  currentStoreId: StoreProductsScope,
): boolean {
  if (!active) return true;
  return subscribedStoreId !== currentStoreId;
}
