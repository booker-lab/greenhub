import { describe, expect, it } from 'vitest';
import {
  areStoreProductCountsTrustworthy,
  isStoreProductsBackgroundRefresh,
  nextStoreProductsRetryKey,
  resolveStoreProductsFilteredView,
  resolveStoreProductsView,
  shouldIgnoreStoreProductsCallback,
  shouldInvalidateStoreProductsScope,
  shouldResubscribeStoreProducts,
} from './useStoreProducts.recovery';

describe('Seller 상품 read recovery — scope invalidation (A/B)', () => {
  it('store A 성공 snapshot은 READY로 표시된다', () => {
    expect(
      resolveStoreProductsView({
        storeId: 'store-a',
        loading: false,
        error: null,
        productCount: 2,
        hasLoaded: true,
      }),
    ).toBe('READY');
  });

  it('scope 변경(A→B, A→null, null→A)은 이전 데이터를 무효화한다', () => {
    expect(shouldInvalidateStoreProductsScope('store-a', 'store-b')).toBe(true);
    expect(shouldInvalidateStoreProductsScope('store-a', null)).toBe(true);
    expect(shouldInvalidateStoreProductsScope(null, 'store-a')).toBe(true);
  });

  it('동일 scope는 무효화하지 않는다', () => {
    expect(shouldInvalidateStoreProductsScope('store-a', 'store-a')).toBe(false);
    expect(shouldInvalidateStoreProductsScope(null, null)).toBe(false);
  });

  it('scope 미확정(null)은 어떤 products 길이라도 empty/ready로 승격하지 않는다', () => {
    expect(
      resolveStoreProductsView({
        storeId: null,
        loading: false,
        error: null,
        productCount: 0,
        hasLoaded: false,
      }),
    ).toBe('LOADING');
    expect(
      resolveStoreProductsView({
        storeId: null,
        loading: false,
        error: null,
        productCount: 3,
        hasLoaded: false,
      }),
    ).toBe('LOADING');
  });

  it('usable previous data가 없는 첫 조회는 loading이다', () => {
    expect(
      resolveStoreProductsView({
        storeId: 'store-a',
        loading: true,
        error: null,
        productCount: 0,
        hasLoaded: false,
      }),
    ).toBe('LOADING');
  });
});

describe('Seller 상품 read recovery — failure vs empty (C/D)', () => {
  it('첫 조회 실패는 empty가 아니라 READ_FAILED다', () => {
    expect(
      resolveStoreProductsView({
        storeId: 'store-a',
        loading: false,
        error: '상품을 불러오지 못했습니다.',
        productCount: 0,
        hasLoaded: false,
      }),
    ).toBe('READ_FAILED');
  });

  it('Firestore 성공 0건만 true empty다', () => {
    expect(
      resolveStoreProductsView({
        storeId: 'store-a',
        loading: false,
        error: null,
        productCount: 0,
        hasLoaded: true,
      }),
    ).toBe('EMPTY');
  });

  it('로딩 중 0건·실패 0건을 성공 empty로 승격하지 않는다', () => {
    expect(
      resolveStoreProductsView({
        storeId: 'store-a',
        loading: true,
        error: null,
        productCount: 0,
        hasLoaded: false,
      }),
    ).not.toBe('EMPTY');
    expect(
      resolveStoreProductsView({
        storeId: 'store-a',
        loading: false,
        error: 'boom',
        productCount: 0,
        hasLoaded: false,
      }),
    ).not.toBe('EMPTY');
  });
});

describe('Seller 상품 read recovery — stale preservation (E)', () => {
  it('이전 성공 뒤 listener 실패는 STALE이며 []로 지우지 않는다', () => {
    expect(
      resolveStoreProductsView({
        storeId: 'store-a',
        loading: false,
        error: 'listener failed',
        productCount: 2,
        hasLoaded: true,
      }),
    ).toBe('STALE');
  });

  it('stale은 background 갱신으로 취급하고 initial loading으로 되돌리지 않는다', () => {
    expect(isStoreProductsBackgroundRefresh(true)).toBe(true);
    expect(isStoreProductsBackgroundRefresh(false)).toBe(false);
  });

  it('stale 집계는 신뢰 가능한 0으로 취급하지 않는다', () => {
    expect(
      areStoreProductCountsTrustworthy({ hasLoaded: true, loading: false, error: 'boom' }),
    ).toBe(false);
  });

  it('늦은 scope의 snapshot/error 콜백은 무시하고 최신 scope만 허용한다', () => {
    expect(shouldIgnoreStoreProductsCallback(false, 'store-a', 'store-a')).toBe(true);
    expect(shouldIgnoreStoreProductsCallback(true, 'store-a', 'store-b')).toBe(true);
    expect(shouldIgnoreStoreProductsCallback(true, 'store-a', 'store-a')).toBe(false);
  });
});

describe('Seller 상품 read recovery — retry resubscribe (F)', () => {
  it('retry 키는 단조 증가하고 키 변경이 재구독을 의미한다', () => {
    const prev = 0;
    const next = nextStoreProductsRetryKey(prev);
    expect(next).not.toBe(prev);
    expect(next).toBe(1);
    expect(shouldResubscribeStoreProducts(prev, next)).toBe(true);
    expect(shouldResubscribeStoreProducts(next, next)).toBe(false);
  });

  it('연속 retry가 guard를 깨지 않는다', () => {
    const k1 = nextStoreProductsRetryKey(0);
    const k2 = nextStoreProductsRetryKey(k1);
    expect(shouldResubscribeStoreProducts(0, k2)).toBe(true);
    expect(shouldResubscribeStoreProducts(k2, k2)).toBe(false);
  });
});

describe('Seller 상품 read recovery — ProductsPage error precedence / filter-empty (G/H)', () => {
  it('read error가 empty/filter-empty보다 우선한다', () => {
    const view = resolveStoreProductsView({
      storeId: 'store-a',
      loading: false,
      error: 'boom',
      productCount: 0,
      hasLoaded: false,
    });
    expect(resolveStoreProductsFilteredView(view, 0)).toBe('error');
  });

  it('filter 0건은 read error와 별개다', () => {
    const ready = resolveStoreProductsView({
      storeId: 'store-a',
      loading: false,
      error: null,
      productCount: 2,
      hasLoaded: true,
    });
    expect(resolveStoreProductsFilteredView(ready, 0)).toBe('filter-empty');
    expect(resolveStoreProductsFilteredView(ready, 1)).toBe('list');
  });

  it('성공 empty와 filter-empty를 구분한다', () => {
    const empty = resolveStoreProductsView({
      storeId: 'store-a',
      loading: false,
      error: null,
      productCount: 0,
      hasLoaded: true,
    });
    expect(resolveStoreProductsFilteredView(empty, 0)).toBe('empty');
  });

  it('stale + 목록 있음은 stale을 유지하고 지우지 않는다', () => {
    const stale = resolveStoreProductsView({
      storeId: 'store-a',
      loading: false,
      error: 'boom',
      productCount: 2,
      hasLoaded: true,
    });
    expect(resolveStoreProductsFilteredView(stale, 2)).toBe('stale');
  });
});

describe('Seller 상품 read recovery — Prep/Home 집계 신뢰도 (I)', () => {
  it('hasLoaded + error 없음일 때만 집계가 신뢰 가능하다', () => {
    expect(
      areStoreProductCountsTrustworthy({ hasLoaded: true, loading: false, error: null }),
    ).toBe(true);
  });

  it('초기 로딩·첫 실패는 정상 0으로 오인하지 않는다', () => {
    expect(
      areStoreProductCountsTrustworthy({ hasLoaded: false, loading: true, error: null }),
    ).toBe(false);
    expect(
      areStoreProductCountsTrustworthy({ hasLoaded: false, loading: false, error: 'boom' }),
    ).toBe(false);
  });

  it('stale은 신뢰 불가이므로 홈 완료 메시지와 0/0 현황으로 승격하지 않는다', () => {
    expect(
      areStoreProductCountsTrustworthy({ hasLoaded: true, loading: false, error: 'boom' }),
    ).toBe(false);
    expect(
      areStoreProductCountsTrustworthy({ hasLoaded: true, loading: true, error: null }),
    ).toBe(false);
  });
});
