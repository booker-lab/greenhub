import { describe, expect, it } from 'vitest';
import {
  buildOrderDetailPath,
  getOrderDetailMutationOutcomeMessage,
  isOrderDetailBackgroundRefresh,
  isOrderDetailNotFoundError,
  resolveOrderDetailAuthState,
  resolveOrderDetailMutationOutcome,
  resolveOrderDetailView,
  SELLER_ORDER_DETAIL_AUTH_ERROR,
  shouldIgnoreOrderDetailResponse,
  shouldReconcileOrderDetailAfterMutation,
  shouldRevalidateOrderDetailOnVisibilityChange,
  shouldRevalidateOrderDetailOnWindowFocus,
} from './useOrderDetail.recovery';

describe('Seller 주문 상세 recovery — auth prerequisite', () => {
  it('세션 transient은 recoverable loading으로 유지하고 fail-closed하지 않는다', () => {
    expect(resolveOrderDetailAuthState('loading', null, null)).toBe('loading');
    expect(resolveOrderDetailAuthState('loading', 'store-1', 'token-1')).toBe('loading');
  });

  it('확정된 prerequisite 부재는 주문 없음으로 확정하지 않고 missing으로 닫는다', () => {
    expect(resolveOrderDetailAuthState('unauthenticated', null, null)).toBe('missing');
    expect(resolveOrderDetailAuthState('authenticated', null, 'token-1')).toBe('missing');
    expect(resolveOrderDetailAuthState('authenticated', 'store-1', null)).toBe('missing');
    expect(resolveOrderDetailAuthState('authenticated', 'store-1', '')).toBe('missing');
  });

  it('인증된 store+token 조합만 network fetch 가능하다', () => {
    expect(resolveOrderDetailAuthState('authenticated', 'store-1', 'token-1')).toBe('ready');
  });

  it('인증 오류 메시지는 목록 계약과 동일한 문구를 사용한다', () => {
    expect(SELLER_ORDER_DETAIL_AUTH_ERROR).toBe('셀러 스토어 인증 정보를 확인할 수 없습니다.');
  });
});

describe('Seller 주문 상세 recovery — read view (A)', () => {
  it('auth pending + 주문 없음 → LOADING', () => {
    expect(
      resolveOrderDetailView({
        authState: 'loading',
        hasOrder: false,
        isLoading: true,
        error: null,
        notFound: false,
      }),
    ).toBe('LOADING');
  });

  it('auth 확정 실패 → AUTH_FAILED (주문 없음 표현 금지)', () => {
    expect(
      resolveOrderDetailView({
        authState: 'missing',
        hasOrder: false,
        isLoading: false,
        error: SELLER_ORDER_DETAIL_AUTH_ERROR,
        notFound: false,
      }),
    ).toBe('AUTH_FAILED');
  });

  it('auth 확정 실패는 stale이 있어도 protected data를 가리고 AUTH_FAILED', () => {
    expect(
      resolveOrderDetailView({
        authState: 'missing',
        hasOrder: true,
        isLoading: false,
        error: null,
        notFound: false,
      }),
    ).toBe('AUTH_FAILED');
  });

  it('initial loading → LOADING', () => {
    expect(
      resolveOrderDetailView({
        authState: 'ready',
        hasOrder: false,
        isLoading: true,
        error: null,
        notFound: false,
      }),
    ).toBe('LOADING');
  });

  it('error + 주문 없음 → READ_FAILED', () => {
    expect(
      resolveOrderDetailView({
        authState: 'ready',
        hasOrder: false,
        isLoading: false,
        error: '주문을 불러오지 못했습니다.',
        notFound: false,
      }),
    ).toBe('READ_FAILED');
  });

  it('authoritative successful read + 주문 없음 → NOT_FOUND', () => {
    expect(
      resolveOrderDetailView({
        authState: 'ready',
        hasOrder: false,
        isLoading: false,
        error: null,
        notFound: true,
      }),
    ).toBe('NOT_FOUND');
  });

  it('주문 존재 → READY', () => {
    expect(
      resolveOrderDetailView({
        authState: 'ready',
        hasOrder: true,
        isLoading: false,
        error: null,
        notFound: false,
      }),
    ).toBe('READY');
  });

  it('기존 주문 + refresh 실패 → stale READY를 유지하고 제거하지 않는다', () => {
    expect(
      resolveOrderDetailView({
        authState: 'ready',
        hasOrder: true,
        isLoading: false,
        error: '최신 주문 정보를 확인하지 못했습니다.',
        notFound: false,
      }),
    ).toBe('READY');
  });

  it('404만 NOT_FOUND이며 일반 read failure는 NOT_FOUND가 아니다', () => {
    expect(isOrderDetailNotFoundError({ status: 404 })).toBe(true);
    expect(isOrderDetailNotFoundError({ status: 500 })).toBe(false);
    expect(isOrderDetailNotFoundError(new Error('주문을 불러오지 못했습니다.'))).toBe(false);
    expect(isOrderDetailNotFoundError(null)).toBe(false);
  });
});

describe('Seller 주문 상세 recovery — race guard (B)', () => {
  it('취소·stale 응답을 무시하고 최신 응답만 허용한다', () => {
    expect(shouldIgnoreOrderDetailResponse(false, 2, 2)).toBe(true);
    expect(shouldIgnoreOrderDetailResponse(true, 2, 1)).toBe(true);
    expect(shouldIgnoreOrderDetailResponse(true, 1, 2)).toBe(true);
    expect(shouldIgnoreOrderDetailResponse(true, 2, 2)).toBe(false);
  });

  it('A 시작 → B 시작 → B 성공 → A 늦은 성공/실패: A는 B 결과를 덮어쓰지 않는다', () => {
    // B가 최신 요청(id 2)으로 성공 — 허용.
    expect(shouldIgnoreOrderDetailResponse(true, 2, 2)).toBe(false);
    // 늦게 도착한 A(id 1)의 성공/실패 응답 — 모두 무시.
    expect(shouldIgnoreOrderDetailResponse(true, 2, 1)).toBe(true);
  });
});

describe('Seller 주문 상세 recovery — manual refresh (C)', () => {
  it('manual refresh·retry·focus 재검증·reconciliation이 동일한 authoritative GET 경로를 사용한다', () => {
    expect(buildOrderDetailPath('store-1', 'order-1')).toBe('/stores/store-1/orders/order-1');
    expect(buildOrderDetailPath('store id/한글', 'order/1')).toBe(
      `/stores/${encodeURIComponent('store id/한글')}/orders/${encodeURIComponent('order/1')}`,
    );
  });

  it('기존 detail이 있으면 initial loading으로 되돌리지 않고 refreshing을 사용한다', () => {
    expect(isOrderDetailBackgroundRefresh(true)).toBe(true);
    expect(isOrderDetailBackgroundRefresh(false)).toBe(false);
  });
});

describe('Seller 주문 상세 recovery — focus/visibility (D)', () => {
  it('window focus 복귀 시 detail을 재검증한다', () => {
    expect(shouldRevalidateOrderDetailOnWindowFocus()).toBe(true);
  });

  it('visibility 복귀 시에만 재검증하고 hidden에서는 재검증하지 않는다', () => {
    expect(shouldRevalidateOrderDetailOnVisibilityChange(true)).toBe(false);
    expect(shouldRevalidateOrderDetailOnVisibilityChange(false)).toBe(true);
  });
});

describe('Seller 주문 상세 recovery — mutation reconciliation (E/F)', () => {
  it('성공한 command 뒤에만 authoritative detail 재조회를 수행한다', () => {
    expect(shouldReconcileOrderDetailAfterMutation(true)).toBe(true);
    expect(shouldReconcileOrderDetailAfterMutation(false)).toBe(false);
  });

  it('command 실패는 COMMAND_FAILED로 닫는다', () => {
    expect(resolveOrderDetailMutationOutcome(false, false)).toBe('COMMAND_FAILED');
    expect(resolveOrderDetailMutationOutcome(false, true)).toBe('COMMAND_FAILED');
  });

  it('command 성공 + 재조회 성공 → RECONCILED', () => {
    expect(resolveOrderDetailMutationOutcome(true, false)).toBe('RECONCILED');
    expect(getOrderDetailMutationOutcomeMessage('RECONCILED')).toBeNull();
    expect(getOrderDetailMutationOutcomeMessage('COMMAND_FAILED')).toBeNull();
  });

  it('PATCH 성공 + 재조회 실패를 command 실패로 잘못 표현하지 않는다', () => {
    expect(resolveOrderDetailMutationOutcome(true, true)).toBe(
      'COMMAND_CONFIRMED_RECONCILE_FAILED',
    );
    const message = getOrderDetailMutationOutcomeMessage('COMMAND_CONFIRMED_RECONCILE_FAILED');
    expect(message).not.toBeNull();
    // command 완료 사실과 최신 상태 확인 실패를 함께 전달한다.
    expect(message).toContain('완료');
    expect(message).toContain('최신');
    // 동일 위험 command 반복을 유도하는 실패 문구가 아니다.
    expect(message).not.toContain('상태 변경에 실패');
  });
});
