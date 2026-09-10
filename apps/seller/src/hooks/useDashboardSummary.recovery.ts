/**
 * Seller 홈 정산 summary read recovery 순수 계약.
 * `useDashboardSummary.ts`의 runtime effect와 동일한 판정을 공유하되,
 * vitest에서 `@/` alias 없이 직접 검증할 수 있도록 framework 의존성을 두지 않는다.
 *
 * 상품/주문 recovery와 같은 의미 계약을 사용하되 전체 공통 abstraction은 만들지 않는다.
 * Settlement 전용 최소 계약만 둔다.
 *
 * Collapse 방지 원칙:
 * - 성공한 summary만 금액을 표시한다. 0원은 유효한 성공 값이다.
 * - summary가 한 번도 성공하지 않은 첫 실패는 0원·empty로 표시하지 않고
 *   명시적 오류 + retry로 닫는다.
 * - 이전 성공 뒤 재조회 실패는 이전 금액을 지우지 않고 stale로 보존한다.
 * - scope(storeId) 변경 시 이전 store summary를 새 scope 값처럼 노출하지 않는다.
 * - 잘못된 응답 객체를 0원 summary로 렌더하지 않는다.
 */

export const DASHBOARD_SUMMARY_AUTH_ERROR = '셀러 스토어 인증 정보를 확인할 수 없습니다.';
export const DASHBOARD_SUMMARY_READ_ERROR = '정산 정보를 불러오지 못했습니다.';
export const DASHBOARD_SUMMARY_INVALID_RESPONSE_ERROR = '정산 응답 형식이 올바르지 않습니다.';

export type DashboardSummaryScopeId = string | null | undefined;

export type DashboardSummaryAuthState = 'loading' | 'missing' | 'ready';

export type DashboardSummaryView = 'LOADING' | 'READ_FAILED' | 'STALE' | 'READY';

export interface DashboardSummaryByStatus {
  pending: number;
  confirmed: number;
  paid: number;
  cancelled: number;
}

export interface DashboardSummaryData {
  date: string;
  count: number;
  totalAmount: number;
  totalPlatformFee: number;
  totalNetAmount: number;
  byStatus: DashboardSummaryByStatus;
}

/**
 * Seller 정산 summary의 인증 전제를 판정한다.
 * - `loading`: 세션 transient — 무한 loading이 아니라 recoverable loading으로 유지한다.
 * - `missing`: 확정된 prerequisite 부재(unauthenticated/store·token 없음) — 빈 결과로
 *   확정하지 않고 인증 오류로 닫는다. 호출부는 loading을 false로 닫아야 한다.
 * - `ready`: network fetch 가능.
 * `useOrders`의 동일 분기와 메시지를 공유한다.
 */
export function resolveDashboardSummaryAuthState(
  sessionStatus: string,
  storeId: DashboardSummaryScopeId,
  token: string | null | undefined,
): DashboardSummaryAuthState {
  if (sessionStatus === 'loading') return 'loading';
  if (!storeId || !token) return 'missing';
  return 'ready';
}

/** scope가 바뀌면 이전 scope summary를 무효화해야 한다 (A→B, A→null, null→A 포함). */
export function shouldInvalidateDashboardSummaryScope(
  prevStoreId: DashboardSummaryScopeId,
  nextStoreId: DashboardSummaryScopeId,
): boolean {
  return (prevStoreId ?? null) !== (nextStoreId ?? null);
}

/** 이전 성공 summary가 있으면 initial loading으로 되돌리지 않고 background 갱신으로 취급한다. */
export function isDashboardSummaryBackgroundRefresh(hasLoaded: boolean): boolean {
  return hasLoaded;
}

/** race guard: 취소됐거나 최신 요청이 아니면 응답을 무시한다. */
export function shouldIgnoreDashboardSummaryResponse(
  active: boolean,
  currentRequestId: number,
  responseRequestId: number,
): boolean {
  return !active || currentRequestId !== responseRequestId;
}

/** network refetch 경로. manual retry가 동일한 경로를 사용한다. */
export function buildDashboardSummaryPath(storeId: string, date: string): string {
  return `/stores/${encodeURIComponent(storeId)}/settlements/summary?date=${encodeURIComponent(date)}`;
}

/** retry 키. retry 호출마다 단조 증가하며 effect deps로 사용된다. */
export function nextDashboardSummaryRetryKey(current: number): number {
  return current + 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Summary 실제 계약의 최소 runtime validation.
 * API `getSummary` 반환 `{ date, count, totalAmount, totalPlatformFee, totalNetAmount, byStatus }`만
 * 인정한다. 0원은 유효하므로 falsy로 거부하지 않는다.
 */
export function isValidDashboardSummaryPayload(payload: unknown): payload is DashboardSummaryData {
  if (!isRecord(payload)) return false;
  if (!isDateKey(payload.date)) return false;
  if (!isCount(payload.count)) return false;
  if (!isMoney(payload.totalAmount)) return false;
  if (!isMoney(payload.totalPlatformFee)) return false;
  if (!isMoney(payload.totalNetAmount)) return false;
  const byStatus = payload.byStatus;
  if (!isRecord(byStatus)) return false;
  if (!isCount(byStatus.pending)) return false;
  if (!isCount(byStatus.confirmed)) return false;
  if (!isCount(byStatus.paid)) return false;
  if (!isCount(byStatus.cancelled)) return false;
  return true;
}

/**
 * fetch 응답을 검증된 summary로 변환한다.
 * 잘못된 객체·배열·부분 필드·문자열 금액·NaN/Infinity·음수·날짜 형식 오류는
 * 0원 summary로 승격하지 않고 throw한다.
 */
export function parseDashboardSummaryPayload(payload: unknown): DashboardSummaryData {
  if (!isValidDashboardSummaryPayload(payload)) {
    throw new Error(DASHBOARD_SUMMARY_INVALID_RESPONSE_ERROR);
  }
  return payload;
}

/**
 * 정산 summary 읽기 상태를 단일 view로 판정한다.
 * 우선순위: 첫 조회 실패(READ_FAILED) > stale(STALE) > 초기 로딩(LOADING) > 성공(READY).
 * - READ_FAILED: 성공 이력 없음 + error — "—" + 명시적 오류 + retry. 0원으로 표시 금지.
 * - STALE: 이전 성공 + 최신 확인 실패 — 이전 금액 유지 + stale 명시 + retry.
 * - LOADING: 성공 이력 없음 + 요청 중.
 * - READY: 마지막 성공 — 0원도 유효한 성공 값이다.
 */
export function resolveDashboardSummaryView(input: {
  hasLoaded: boolean;
  loading: boolean;
  error: string | null;
}): DashboardSummaryView {
  const { hasLoaded, loading, error } = input;
  if (error && !hasLoaded) return 'READ_FAILED';
  if (error && hasLoaded) return 'STALE';
  if (!hasLoaded && loading) return 'LOADING';
  if (!hasLoaded) return 'LOADING';
  return 'READY';
}

/** stale은 "이전 성공 summary + 현재 error"일 때만 true다. 최신 확정값처럼 쓰지 않는다. */
export function isDashboardSummaryStale(error: string | null, hasLoaded: boolean): boolean {
  return error !== null && hasLoaded;
}

/**
 * 실패 시 summary 판정: 이전 summary를 그대로 보존한다.
 * 첫 실패(prev null)도 `0원 summary`를 만들어내지 않는다.
 */
export function resolveDashboardSummaryAfterFailure(
  prevSummary: DashboardSummaryData | null,
): DashboardSummaryData | null {
  return prevSummary;
}

/** 성공 금액 포맷. view 판정과 분리되어 실패를 0원으로 바꾸지 않는다. */
export function formatDashboardSummaryAmount(totalNetAmount: number): string {
  return `${totalNetAmount.toLocaleString('ko-KR')}원`;
}

/**
 * SettlementCard 금액 영역 표시 텍스트.
 * - READY/STALE + summary 있음: 실제 금액(0원 포함).
 * - LOADING: 불러오는 중.
 * - READ_FAILED 그 외: "—". 실패를 금액으로 바꾸지 않는다.
 */
export function resolveDashboardSummaryAmountText(input: {
  summary: DashboardSummaryData | null;
  view: DashboardSummaryView;
}): string {
  const { summary, view } = input;
  if ((view === 'READY' || view === 'STALE') && summary) {
    return formatDashboardSummaryAmount(summary.totalNetAmount);
  }
  if (view === 'LOADING') return '불러오는 중…';
  return '—';
}
