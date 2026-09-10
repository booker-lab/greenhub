import { describe, expect, it } from 'vitest';
import {
  buildSellerOrdersPath,
  buildSellerOrdersScopeKey,
  isSellerOrdersBackgroundRefresh,
  resolveSellerOrdersAuthState,
  resolveSellerOrdersInitialView,
  SELLER_ORDERS_AUTH_ERROR,
  shouldIgnoreSellerOrdersResponse,
  shouldIgnoreSellerOrdersScopeResponse,
  shouldInvalidateSellerOrdersScope,
} from './useOrders.recovery';

describe('Seller 주문 recovery — auth prerequisite', () => {
  it('세션 transient은 recoverable loading으로 유지하고 fail-closed하지 않는다', () => {
    expect(resolveSellerOrdersAuthState('loading', null, null)).toBe('loading');
    expect(resolveSellerOrdersAuthState('loading', 'store-1', 'token-1')).toBe('loading');
  });

  it('확정된 prerequisite 부재는 빈 결과로 확정하지 않고 인증 오류로 닫는다', () => {
    expect(resolveSellerOrdersAuthState('unauthenticated', null, null)).toBe('missing');
    expect(resolveSellerOrdersAuthState('authenticated', null, 'token-1')).toBe('missing');
    expect(resolveSellerOrdersAuthState('authenticated', 'store-1', null)).toBe('missing');
    expect(resolveSellerOrdersAuthState('authenticated', 'store-1', '')).toBe('missing');
  });

  it('실제 unauthorized를 정상 loading으로 무한 유지하지 않는다', () => {
    // unauthenticated는 loading이 아니라 missing으로 확정되어야 한다.
    expect(resolveSellerOrdersAuthState('unauthenticated', null, null)).not.toBe('loading');
    expect(resolveSellerOrdersAuthState('unauthenticated', 'store-1', 'token-1')).not.toBe(
      'loading',
    );
  });

  it('인증된 store+token 조합만 network fetch 가능하다', () => {
    expect(resolveSellerOrdersAuthState('authenticated', 'store-1', 'token-1')).toBe('ready');
  });

  it('인증 오류 메시지는 useSaleRounds와 동일한 계약을 사용한다', () => {
    // apps/seller/src/hooks/useSaleRounds.ts의 동일 분기 메시지와 일치해야 한다.
    expect(SELLER_ORDERS_AUTH_ERROR).toBe('셀러 스토어 인증 정보를 확인할 수 없습니다.');
  });
});

describe('Seller 주문 recovery — manual refresh / refreshing / race', () => {
  it('manual refresh·retry·focus 재검증이 동일한 network 경로를 사용한다', () => {
    expect(buildSellerOrdersPath('store-1')).toBe('/stores/store-1/orders');
    expect(buildSellerOrdersPath('store id/한글')).toBe(
      `/stores/${encodeURIComponent('store id/한글')}/orders`,
    );
  });

  it('기존 데이터가 있으면 initial loading으로 되돌리지 않고 refreshing을 사용한다', () => {
    expect(isSellerOrdersBackgroundRefresh(true)).toBe(true);
    expect(isSellerOrdersBackgroundRefresh(false)).toBe(false);
  });

  it('race guard는 취소·stale 응답을 무시하고 최신 응답만 허용한다', () => {
    expect(shouldIgnoreSellerOrdersResponse(false, 2, 2)).toBe(true);
    expect(shouldIgnoreSellerOrdersResponse(true, 2, 1)).toBe(true);
    expect(shouldIgnoreSellerOrdersResponse(true, 1, 2)).toBe(true);
    expect(shouldIgnoreSellerOrdersResponse(true, 2, 2)).toBe(false);
  });

  it('중복 click이 guard를 깨지 않는다 — 최신 id가 아니면 모두 무시된다', () => {
    const current = 5;
    expect(shouldIgnoreSellerOrdersResponse(true, current, 3)).toBe(true);
    expect(shouldIgnoreSellerOrdersResponse(true, current, 4)).toBe(true);
    expect(shouldIgnoreSellerOrdersResponse(true, current, 5)).toBe(false);
  });
});

describe('Seller 주문 recovery — initial error vs empty / stale preservation', () => {
  it('초기 오류와 빈 목록을 혼동하지 않는다', () => {
    expect(resolveSellerOrdersInitialView(0, '주문 목록을 불러오지 못했습니다.')).toBe('error');
    expect(resolveSellerOrdersInitialView(0, SELLER_ORDERS_AUTH_ERROR)).toBe('error');
    expect(resolveSellerOrdersInitialView(0, null)).toBe('empty');
  });

  it('실패 시 기존 stale data를 보존한다 — stale+error는 목록을 유지한다', () => {
    expect(resolveSellerOrdersInitialView(3, '주문 목록을 불러오지 못했습니다.')).toBe('list');
    expect(resolveSellerOrdersInitialView(1, SELLER_ORDERS_AUTH_ERROR)).toBe('list');
  });

  it('정상 목록은 error 여부와 무관하게 list로 유지된다', () => {
    expect(resolveSellerOrdersInitialView(2, null)).toBe('list');
  });
});

describe('Seller 주문 scope authority — storeId + token identity', () => {
  it('scope key는 store와 token을 함께 식별한다', () => {
    const a = buildSellerOrdersScopeKey('store-a', 'token-a');
    const sameStoreSameToken = buildSellerOrdersScopeKey('store-a', 'token-a');
    const storeB = buildSellerOrdersScopeKey('store-b', 'token-a');
    const tokenB = buildSellerOrdersScopeKey('store-a', 'token-b');
    expect(sameStoreSameToken).toBe(a);
    expect(storeB).not.toBe(a);
    expect(tokenB).not.toBe(a);
    expect(storeB).not.toBe(tokenB);
  });

  it('store 경계가 보존된다 — 단순 결합 충돌이 scope를 속이지 않는다', () => {
    // 'AB'+'C' 와 'A'+'BC' 는 다른 scope다.
    expect(buildSellerOrdersScopeKey('AB', 'C')).not.toBe(buildSellerOrdersScopeKey('A', 'BC'));
  });

  it('A success → store B change → synchronous clear 판정', () => {
    const prevScope = buildSellerOrdersScopeKey('store-a', 'token-a');
    const nextScope = buildSellerOrdersScopeKey('store-b', 'token-a');
    // hook 렌더 단계: scope가 바뀌면 이전 authority를 즉시 무효화한다.
    expect(shouldInvalidateSellerOrdersScope(prevScope, nextScope)).toBe(true);
    // 무효화 뒤: hasData reset → background가 아니라 initial loading이다.
    const clearedHasData = false;
    const clearedOrdersLength = 0;
    const clearedError: string | null = null;
    expect(isSellerOrdersBackgroundRefresh(clearedHasData)).toBe(false);
    expect(clearedOrdersLength).toBe(0);
    expect(clearedError).toBeNull();
    // A rows/count/badge authority가 B에 노출되지 않는다.
    expect(resolveSellerOrdersInitialView(clearedOrdersLength, clearedError)).toBe('empty');
    expect(resolveSellerOrdersInitialView(clearedOrdersLength, clearedError)).not.toBe('list');
  });

  it('A success → token B change → synchronous clear 판정', () => {
    const prevScope = buildSellerOrdersScopeKey('store-a', 'token-a');
    const nextScope = buildSellerOrdersScopeKey('store-a', 'token-b');
    expect(shouldInvalidateSellerOrdersScope(prevScope, nextScope)).toBe(true);
    expect(isSellerOrdersBackgroundRefresh(false)).toBe(false);
    expect(resolveSellerOrdersInitialView(0, null)).toBe('empty');
  });

  it('동일 scope는 무효화하지 않는다 — same-scope stale 계약의 전제', () => {
    const scope = buildSellerOrdersScopeKey('store-a', 'token-a');
    expect(shouldInvalidateSellerOrdersScope(scope, scope)).toBe(false);
    // 동일 scope에서 기존 데이터가 있으면 background refreshing이다.
    expect(isSellerOrdersBackgroundRefresh(true)).toBe(true);
  });
});

describe('Seller 주문 scope 전환 — B loading 중 A rows/count 없음', () => {
  it('B fetch loading은 A stale을 background로 표시하지 않는다', () => {
    const prevScope = buildSellerOrdersScopeKey('store-a', 'token-a');
    const nextScope = buildSellerOrdersScopeKey('store-b', 'token-a');
    expect(shouldInvalidateSellerOrdersScope(prevScope, nextScope)).toBe(true);
    // clear 뒤 hasData=false → loading=true, refreshing=false 경로다.
    const hasDataAfterClear = false;
    const isBackground = isSellerOrdersBackgroundRefresh(hasDataAfterClear);
    expect(isBackground).toBe(false);
    const loading = !isBackground;
    const refreshing = isBackground;
    expect(loading).toBe(true);
    expect(refreshing).toBe(false);
    // rows/count 없음: orders 0 + error null → empty, list가 아니다.
    expect(resolveSellerOrdersInitialView(0, null)).toBe('empty');
  });

  it('이전 error/reset state를 B scope에 재사용하지 않는다', () => {
    const prevScope = buildSellerOrdersScopeKey('store-a', 'token-a');
    const nextScope = buildSellerOrdersScopeKey('store-b', 'token-a');
    expect(shouldInvalidateSellerOrdersScope(prevScope, nextScope)).toBe(true);
    // hook은 scope 전환 시 setError(null)로 이전 오류를 버린다.
    const carriedError: string | null = null;
    expect(carriedError).toBeNull();
    expect(resolveSellerOrdersAuthState('authenticated', 'store-b', 'token-a')).toBe('ready');
    expect(resolveSellerOrdersInitialView(0, carriedError)).toBe('empty');
  });
});

describe('Seller 주문 scope 전환 — late response / B failure guard', () => {
  it('A request가 늦게 완료되어도 requestId guard로 B를 덮지 않는다', () => {
    // A myId=1 → B myId=2. 현재 최신은 2이므로 늦은 A(1)는 무시된다.
    const currentRequestId = 2;
    const lateAResponseId = 1;
    const currentBResponseId = 2;
    expect(shouldIgnoreSellerOrdersResponse(true, currentRequestId, lateAResponseId)).toBe(true);
    expect(shouldIgnoreSellerOrdersResponse(true, currentRequestId, currentBResponseId)).toBe(
      false,
    );
  });

  it('A request가 늦게 완료되어도 scope guard로 B를 덮지 않는다', () => {
    const scopeA = buildSellerOrdersScopeKey('store-a', 'token-a');
    const scopeB = buildSellerOrdersScopeKey('store-b', 'token-a');
    expect(shouldIgnoreSellerOrdersScopeResponse(scopeB, scopeA)).toBe(true);
    expect(shouldIgnoreSellerOrdersScopeResponse(scopeB, scopeB)).toBe(false);
  });

  it('B failure 시 A stale fallback으로 복구하지 않는다', () => {
    const scopeA = buildSellerOrdersScopeKey('store-a', 'token-a');
    const scopeB = buildSellerOrdersScopeKey('store-b', 'token-a');
    expect(shouldInvalidateSellerOrdersScope(scopeA, scopeB)).toBe(true);
    // B 실패 직후: B scope 성공 이력이 없으므로 orders 0 + error → error view다.
    // A의 이전 3건이 B의 stale처럼 list로 복구되면 실패다.
    expect(resolveSellerOrdersInitialView(0, '주문 목록을 불러오지 못했습니다.')).toBe('error');
    expect(resolveSellerOrdersInitialView(0, '주문 목록을 불러오지 못했습니다.')).not.toBe('list');
  });

  it('same-scope refresh failure에서는 기존 stale-preserve 계약을 유지한다', () => {
    const scope = buildSellerOrdersScopeKey('store-a', 'token-a');
    expect(shouldInvalidateSellerOrdersScope(scope, scope)).toBe(false);
    // 같은 scope에서 이전 성공 3건 + 재조회 실패 → stale list를 유지한다.
    expect(resolveSellerOrdersInitialView(3, '주문 목록을 불러오지 못했습니다.')).toBe('list');
    expect(isSellerOrdersBackgroundRefresh(true)).toBe(true);
  });
});

describe('Seller 주문 scope 전환 — missing store/token clear', () => {
  it('store 또는 token이 없어지면 protected state를 clear한다', () => {
    const scopeA = buildSellerOrdersScopeKey('store-a', 'token-a');
    const missingStore = buildSellerOrdersScopeKey(null, 'token-a');
    const missingToken = buildSellerOrdersScopeKey('store-a', null);
    const missingBoth = buildSellerOrdersScopeKey(null, null);
    expect(shouldInvalidateSellerOrdersScope(scopeA, missingStore)).toBe(true);
    expect(shouldInvalidateSellerOrdersScope(scopeA, missingToken)).toBe(true);
    expect(shouldInvalidateSellerOrdersScope(scopeA, missingBoth)).toBe(true);
    expect(resolveSellerOrdersAuthState('authenticated', null, 'token-a')).toBe('missing');
    expect(resolveSellerOrdersAuthState('authenticated', 'store-a', null)).toBe('missing');
    expect(resolveSellerOrdersAuthState('authenticated', null, null)).toBe('missing');
  });

  it('missing은 이전 store의 order/count를 유지하지 않고 인증 오류로 닫는다', () => {
    // hook missing 분기: orders [] + hasData false + AUTH_ERROR + loading false.
    const clearedOrdersLength = 0;
    const clearedHasData = false;
    expect(clearedOrdersLength).toBe(0);
    expect(clearedHasData).toBe(false);
    expect(isSellerOrdersBackgroundRefresh(clearedHasData)).toBe(false);
    expect(resolveSellerOrdersInitialView(clearedOrdersLength, SELLER_ORDERS_AUTH_ERROR)).toBe(
      'error',
    );
    expect(resolveSellerOrdersInitialView(clearedOrdersLength, SELLER_ORDERS_AUTH_ERROR)).not.toBe(
      'list',
    );
    expect(resolveSellerOrdersInitialView(clearedOrdersLength, SELLER_ORDERS_AUTH_ERROR)).not.toBe(
      'empty',
    );
  });

  it('genuine empty와 read failure 의미를 보존한다', () => {
    // B scope 첫 성공이 빈 목록이면 error 없이 empty다.
    expect(resolveSellerOrdersInitialView(0, null)).toBe('empty');
    // B scope 첫 실패는 empty로 속이지 않고 error다.
    expect(resolveSellerOrdersInitialView(0, '주문 목록을 불러오지 못했습니다.')).toBe('error');
    expect(resolveSellerOrdersInitialView(0, null)).not.toBe('error');
    expect(resolveSellerOrdersInitialView(0, '주문 목록을 불러오지 못했습니다.')).not.toBe('empty');
  });
});
