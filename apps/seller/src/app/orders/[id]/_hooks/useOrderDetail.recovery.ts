/**
 * Seller 주문 상세 recovery 순수 계약.
 * `useOrderDetail.ts`의 runtime effect와 동일한 판정을 공유하되,
 * vitest에서 `@/` alias 없이 직접 검증할 수 있도록 Framework 의존성을 두지 않는다.
 *
 * Detail에는 EMPTY 개념을 사용하지 않는다.
 * - order 없음 + read error → READ_FAILED
 * - order 없음 + authoritative successful read(404) → NOT_FOUND
 * - order 존재 → READY (refresh 실패 시 stale READY 유지)
 * - auth 확정 실패 → AUTH_FAILED (NOT_FOUND/빈 화면으로 collapse 금지)
 */

export const SELLER_ORDER_DETAIL_AUTH_ERROR = '셀러 스토어 인증 정보를 확인할 수 없습니다.';

export const SELLER_ORDER_DETAIL_READ_ERROR = '주문을 불러오지 못했습니다.';

export const SELLER_ORDER_DETAIL_NOT_FOUND = '주문을 찾을 수 없습니다.';

export const SELLER_ORDER_DETAIL_STALE_ERROR = '최신 주문 정보를 확인하지 못했습니다.';

export const SELLER_ORDER_DETAIL_RECONCILE_FAILED =
  '상태 변경은 완료됐습니다. 최신 주문 정보를 확인하지 못했습니다.';

export type SellerOrderDetailAuthState = 'loading' | 'missing' | 'ready';

export type OrderDetailViewState = 'LOADING' | 'READ_FAILED' | 'AUTH_FAILED' | 'NOT_FOUND' | 'READY';

export type OrderDetailMutationOutcome =
  | 'COMMAND_FAILED'
  | 'RECONCILED'
  | 'COMMAND_CONFIRMED_RECONCILE_FAILED';

/**
 * Seller 주문 상세의 인증 전제를 판정한다.
 * - `loading`: 세션 transient — recoverable loading 유지, fail-closed 금지.
 * - `missing`: 확정된 prerequisite 부재 — NOT_FOUND/빈 화면으로 collapse하지 않고 AUTH_FAILED로 닫는다.
 * - `ready`: network fetch 가능.
 * `useOrders.recovery.ts`의 동일 분기와 메시지를 공유한다.
 */
export function resolveOrderDetailAuthState(
  sessionStatus: string,
  storeId: string | null,
  token: string | null | undefined,
): SellerOrderDetailAuthState {
  if (sessionStatus === 'loading') return 'loading';
  if (!storeId || !token) return 'missing';
  return 'ready';
}

/** authoritative detail GET 경로. manual refresh/retry/focus 재검증/reconciliation이 동일한 경로를 사용한다. */
export function buildOrderDetailPath(storeId: string, orderId: string): string {
  return `/stores/${encodeURIComponent(storeId)}/orders/${encodeURIComponent(orderId)}`;
}

/** 기존 detail이 있으면 initial loading으로 되돌리지 않고 background refreshing을 사용한다. */
export function isOrderDetailBackgroundRefresh(hasOrder: boolean): boolean {
  return hasOrder;
}

/** race guard: 취소됐거나 최신 요청이 아니면 응답을 무시한다. */
export function shouldIgnoreOrderDetailResponse(
  active: boolean,
  currentRequestId: number,
  responseRequestId: number,
): boolean {
  return !active || currentRequestId !== responseRequestId;
}

/**
 * authoritative 부재 판정.
 * `GET /stores/:storeId/orders/:orderId`가 404를 반환한 경우에만 true다.
 * network/server read failure를 NOT_FOUND로 축약하지 않는다.
 */
export function isOrderDetailNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { status?: unknown }).status === 404;
}

export interface ResolveOrderDetailViewInput {
  authState: SellerOrderDetailAuthState;
  hasOrder: boolean;
  isLoading: boolean;
  error: string | null;
  notFound: boolean;
}

/**
 * Detail read의 사용자 의미를 판정한다.
 * - auth 확정 실패는 stale이 있어도 AUTH_FAILED (protected data 예외).
 * - order 존재는 refresh 실패와 무관하게 READY (stale 보존, 호출부가 별도 indication).
 * - order 없음 + error → READ_FAILED, order 없음 + authoritative 404 → NOT_FOUND.
 */
export function resolveOrderDetailView(input: ResolveOrderDetailViewInput): OrderDetailViewState {
  if (input.authState === 'missing') return 'AUTH_FAILED';
  if (input.hasOrder) return 'READY';
  if (input.authState === 'loading') return 'LOADING';
  if (input.isLoading) return 'LOADING';
  if (input.notFound) return 'NOT_FOUND';
  if (input.error) return 'READ_FAILED';
  return 'LOADING';
}

/** window focus 복귀 시 detail revalidation. */
export function shouldRevalidateOrderDetailOnWindowFocus(): boolean {
  return true;
}

/** visibility 복귀 시 detail revalidation. hidden이면 재검증하지 않는다. */
export function shouldRevalidateOrderDetailOnVisibilityChange(hidden: boolean): boolean {
  return !hidden;
}

/** mutation 성공 후 authoritative detail reconciliation이 필요하다. 실패한 command는 재조회하지 않는다. */
export function shouldReconcileOrderDetailAfterMutation(commandOk: boolean): boolean {
  return commandOk === true;
}

/**
 * mutation command 결과와 reconciliation 결과를 혼동하지 않는다.
 * - command 실패 → COMMAND_FAILED
 * - command 성공 + 재조회 성공 → RECONCILED
 * - command 성공 + 재조회 실패 → COMMAND_CONFIRMED_RECONCILE_FAILED
 */
export function resolveOrderDetailMutationOutcome(
  commandOk: boolean,
  reconcileFailed: boolean,
): OrderDetailMutationOutcome {
  if (!commandOk) return 'COMMAND_FAILED';
  if (reconcileFailed) return 'COMMAND_CONFIRMED_RECONCILE_FAILED';
  return 'RECONCILED';
}

/**
 * reconciliation 실패 안내 문구.
 * command 실패처럼 보여 동일 위험 command 반복을 유도하지 않는다.
 * COMMAND_FAILED/RECONCILED에는 별도 문구가 없다(null).
 */
export function getOrderDetailMutationOutcomeMessage(
  outcome: OrderDetailMutationOutcome,
): string | null {
  if (outcome === 'COMMAND_CONFIRMED_RECONCILE_FAILED') return SELLER_ORDER_DETAIL_RECONCILE_FAILED;
  return null;
}
