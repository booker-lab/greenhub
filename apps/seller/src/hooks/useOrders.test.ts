import { describe, expect, it } from 'vitest';
import {
  buildSellerOrdersPath,
  isSellerOrdersBackgroundRefresh,
  resolveSellerOrdersAuthState,
  resolveSellerOrdersInitialView,
  SELLER_ORDERS_AUTH_ERROR,
  shouldIgnoreSellerOrdersResponse,
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
