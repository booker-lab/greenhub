/**
 * Seller 주문 목록 공구 배송일 auxiliary read 순수 계약 (seller-only).
 * `useGroupConfigs.ts`의 runtime effect와 동일한 판정을 공유하되,
 * vitest에서 `@/` alias 없이 직접 검증할 수 있도록 framework 의존성을 두지 않는다.
 *
 * 이 파일은 SELLER_ORDER_GROUP_CONFIG_AUXILIARY_READ 전용이다.
 * Consumer Legacy Group Config (`apps/consumer`)와 collection을 읽더라도
 * 파일·semantic owner를 공유하지 않으며, 공통 helper로 결합하지 않는다.
 * groupProductConfig backend/schema·배송 정책은 변경하지 않는다.
 *
 * Collapse 방지 원칙:
 * - core order read와 auxiliary group-config read를 분리한다.
 * - Firestore 성공(문서 없음 포함)만 map을 갱신한다.
 * - getDoc 실패는 map을 `{}`로 지우지 않고 error + retry로 닫는다.
 * - 이전 성공 뒤 같은 scope 재조회 실패는 stale로 보존하되 최신 확정값처럼 쓰지 않는다.
 * - scope(product ID set) 변경 시 이전 scope 데이터를 새 scope 값처럼 노출하지 않는다.
 */

export const GROUP_CONFIGS_ERROR_MESSAGE = '공구 배송일 정보를 불러오지 못했습니다.';

export type GroupConfigEntry = readonly [productId: string, iso: string | null];

export type GroupConfigMapData = Record<string, { groupDeliveryDate: string }>;

export type GroupConfigView = 'DISABLED' | 'LOADING' | 'READY' | 'READ_FAILED' | 'STALE';

/** 중복 productId를 제거하고 정렬된 배열로 반환한다. */
export function dedupeGroupProductIds(productIds: string[]): string[] {
  return [...new Set(productIds.filter(Boolean))].sort();
}

/**
 * effect 의존성 안정화를 위한 scope key.
 * disabled면 `''`, enabled면 dedupe+정렬된 join key.
 * 같은 key는 같은 scope이며 재fetch가 필요 없다.
 */
export function buildGroupConfigKey(productIds: string[], enabled: boolean): string {
  if (!enabled) return '';
  return dedupeGroupProductIds(productIds).join('|');
}

/**
 * Firestore Timestamp → ISO 정규화 (기존 useGroupConfigs 패턴 유지).
 * - `{ toDate(): Date }`면 `toDate().toISOString()`
 * - string이면 그대로 사용
 * - 그 외(null/undefined/number/object without toDate 등)는 null
 */
export function normalizeGroupDeliveryDate(raw: unknown): string | null {
  if (raw && typeof raw === 'object' && 'toDate' in raw) {
    const toDate = (raw as { toDate: unknown }).toDate;
    if (typeof toDate === 'function') {
      try {
        const date = (toDate as () => unknown).call(raw);
        if (date instanceof Date && !Number.isNaN(date.getTime())) {
          return date.toISOString();
        }
      } catch {
        return null;
      }
      return null;
    }
    return null;
  }
  return typeof raw === 'string' ? raw : null;
}

/**
 * fetch 성공 entries → authoritative map.
 * iso가 null인 productId(문서 없음·날짜 없음)는 "read failure"가 아니라
 * map에서 제외한다. 호출부는 빈 map을 실패와 혼동하지 않는다.
 */
export function buildGroupConfigMapFromEntries(entries: GroupConfigEntry[]): GroupConfigMapData {
  const next: GroupConfigMapData = {};
  for (const [productId, iso] of entries) {
    if (iso) next[productId] = { groupDeliveryDate: iso };
  }
  return next;
}

/**
 * 보조 조회 오케스트레이션 (순수 async, Firestore 의존성 없음).
 * - ids는 hook이 전달한 dedupe済み scope다. 여기서도 Set으로 이중 보장한다.
 * - `fetchOne`은 productId당 정규화된 ISO 또는 null(missing)을 반환한다.
 * - `fetchOne`이 throw하면 Promise.all이 reject되며 호출부(hook)가
 *   error + retry로 닫는다. `.catch(() => ({}))`로 빈 map 승격을 금지한다.
 */
export async function fetchGroupConfigMap(
  ids: string[],
  fetchOne: (productId: string) => Promise<string | null>,
): Promise<GroupConfigMapData> {
  const unique = [...new Set(ids.filter(Boolean))];
  const entries = await Promise.all(
    unique.map(async (productId) => {
      const iso = await fetchOne(productId);
      return [productId, iso] as const;
    }),
  );
  return buildGroupConfigMapFromEntries(entries);
}

/**
 * 보조 조회 상태를 단일 view로 판정한다.
 * 우선순위: DISABLED > 첫 조회 실패(READ_FAILED) > stale(STALE) > 초기 로딩(LOADING) > 성공(READY).
 * - DISABLED: enabled=false 또는 key 없음 — map/error/loading 모두 clean이어야 한다.
 * - READ_FAILED: 첫 조회 실패 — 빈 map을 정상 empty로 승격 금지.
 * - STALE: 이전 성공 뒤 재조회 실패 — 이전 map 보존 + error, 최신 확정값 아님.
 * - READY: 마지막 authoritative 성공 — map이 비어도(전부 missing) 실패가 아니다.
 */
export function resolveGroupConfigView(input: {
  enabled: boolean;
  key: string;
  loading: boolean;
  error: string | null;
  hasLoaded: boolean;
}): GroupConfigView {
  const { enabled, key, error, hasLoaded } = input;
  if (!enabled || !key) return 'DISABLED';
  if (error && !hasLoaded) return 'READ_FAILED';
  if (error && hasLoaded) return 'STALE';
  if (!hasLoaded) return 'LOADING';
  return 'READY';
}

/** stale은 "이전 성공 map + 현재 error"일 때만 true다. 최신 확정값처럼 쓰지 않는다. */
export function isGroupConfigStale(error: string | null, hasLoaded: boolean): boolean {
  return error !== null && hasLoaded;
}

/** race guard: 취소됐거나 최신 요청이 아니면 응답을 무시한다. */
export function shouldIgnoreGroupConfigResponse(
  active: boolean,
  currentRequestId: number,
  responseRequestId: number,
): boolean {
  return !active || currentRequestId !== responseRequestId;
}

/** auxiliary retry 키. retry 호출마다 단조 증가하며 effect deps로 사용된다. */
export function nextGroupConfigRetryKey(current: number): number {
  return current + 1;
}

/**
 * 실패 시 map 판정: 이전 map을 그대로 보존한다.
 * 첫 실패(prev empty + !hasLoaded)도 `{}`를 "정상 empty"로 승격하지 않도록
 * 호출부는 반드시 error와 함께 다룬다.
 */
export function resolveGroupConfigMapAfterFailure(
  prevMap: GroupConfigMapData,
  _hasLoaded: boolean,
): GroupConfigMapData {
  return prevMap;
}
