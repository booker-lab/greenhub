import type { StoreStatus } from '@greenhub/shared';
import type { AdminStore } from '@/hooks/useAdmin';

// 판매자 상태 라벨·점 색 — stores 화면 표현 SSOT(표·휴대폰 행 공용).
// 키는 shared StoreStatus union(invited|active|archived)과 정확히 일치.
// 호출부는 `?? store.status` 폴백을 유지해 미래 union 확장 시 안전망 제공.
// ② 방향(design-direction.md §5 어드민 "판매자"): "치우기"는 "정리하기"로 부른다. 정리한 판매자는 끝난 상태라 회색 점.
export const STATUS_LABEL: Record<StoreStatus, string> = {
  active: '운영 중',
  invited: '초대됨',
  archived: '정리됨',
};

export const STATUS_TONE: Record<StoreStatus, 'default' | 'done'> = {
  active: 'default',
  invited: 'default',
  archived: 'done',
};

export type StoreStatusFilter = 'all' | 'current' | StoreStatus;
export type StoreSortKey = 'name' | 'status' | 'rate';
export type SortDirection = 'asc' | 'desc';
export type StoreSortValue = `${StoreSortKey}:${SortDirection}`;
export type StoreEmptyKind = 'no-data' | 'no-match' | 'has-data';
export type ParseRateError = 'EMPTY' | 'NOT_NUMBER' | 'OUT_OF_RANGE';
export type ParseRateResult = { ok: true; rate: number } | { ok: false; errorCode: ParseRateError };

export interface StoreFilters {
  keyword: string;
  status: StoreStatusFilter;
}

export interface StoreSort {
  key: StoreSortKey;
  direction: SortDirection;
}

export const DEFAULT_STATUS_FILTER: StoreStatusFilter = 'current';
export const DEFAULT_SORT: StoreSort = { key: 'name', direction: 'asc' };

// 상태 탭 순서 — 기본 보기(정리하지 않은 판매자)를 맨 앞에 둔다. 전체는 정리한 판매자까지 포함한다.
export const STATUS_FILTER_OPTIONS: { value: StoreStatusFilter; label: string }[] = [
  { value: 'current', label: '운영·초대' },
  { value: 'active', label: STATUS_LABEL.active },
  { value: 'invited', label: STATUS_LABEL.invited },
  { value: 'archived', label: STATUS_LABEL.archived },
  { value: 'all', label: '전체' },
];

/** 탭마다 붙일 건수 — 받은 판매자 전체에서 검색어만 적용해 센다(상태 탭을 바꿔도 숫자가 흔들리지 않게). */
export function countStoresByFilter(
  stores: AdminStore[],
  keyword: string,
): Record<StoreStatusFilter, number> {
  const counts = { all: 0, current: 0, invited: 0, active: 0, archived: 0 } as Record<
    StoreStatusFilter,
    number
  >;
  for (const option of STATUS_FILTER_OPTIONS) {
    counts[option.value] = filterStores(stores, { keyword, status: option.value }).length;
  }
  return counts;
}

export const SORT_OPTIONS: { value: StoreSortValue; label: string }[] = [
  { value: 'name:asc', label: '이름 ↑' },
  { value: 'name:desc', label: '이름 ↓' },
  { value: 'status:asc', label: '상태 ↑' },
  { value: 'status:desc', label: '상태 ↓' },
  { value: 'rate:asc', label: '수수료율 ↑' },
  { value: 'rate:desc', label: '수수료율 ↓' },
];

export function parseStatusFilter(value: string | null): StoreStatusFilter {
  return STATUS_FILTER_OPTIONS.some((option) => option.value === value)
    ? (value as StoreStatusFilter)
    : DEFAULT_STATUS_FILTER;
}

export function parseSort(keyValue: string | null, directionValue: string | null): StoreSort {
  const key = keyValue === 'status' || keyValue === 'rate' ? keyValue : DEFAULT_SORT.key;
  const direction = directionValue === 'desc' ? directionValue : DEFAULT_SORT.direction;
  return { key, direction };
}

export function toSortValue(sort: StoreSort): StoreSortValue {
  return `${sort.key}:${sort.direction}`;
}

export function parseSortValue(value: string | null): StoreSort {
  const [key, direction] = value?.split(':') ?? [];
  return parseSort(key ?? null, direction ?? null);
}

// 검색어가 상호·대표자 이름·전화번호 중 하나에 들어 있으면 맞는 것으로 본다.
// 전화번호는 하이픈·공백을 빼고 숫자끼리도 비교한다(010-1234 / 0101234 모두 찾음).
function matchesKeyword(store: AdminStore, keyword: string): boolean {
  if (!keyword) return true;
  const texts = [store.name, store.ceoName, store.phone].map((value) =>
    (value ?? '').toLowerCase(),
  );
  if (texts.some((text) => text.includes(keyword))) return true;
  const digits = keyword.replace(/\D/g, '');
  return digits.length > 0 && (store.phone ?? '').replace(/\D/g, '').includes(digits);
}

export function filterStores(stores: AdminStore[], filters: StoreFilters): AdminStore[] {
  const keyword = filters.keyword.trim().toLowerCase();
  return stores.filter((store) => {
    const statusMatches =
      filters.status === 'all' ||
      (filters.status === 'current'
        ? store.status !== 'archived'
        : store.status === filters.status);
    return statusMatches && matchesKeyword(store, keyword);
  });
}

/** 대표자·연락처 한 줄. 둘 다 없으면 "대표·연락처 미등록". */
export function formatStoreContact(store: Pick<AdminStore, 'ceoName' | 'phone'>): string {
  const parts = [store.ceoName?.trim(), store.phone?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '대표·연락처 미등록';
}

/** 정리하기 확인창 — 실제 동작(손님 화면 숨김·새 주문 차단, 로그인 유지, 기록 있으면 ID 확인)을 알린다. */
export function describeArchiveConfirm(store: Pick<AdminStore, 'name'>): string {
  const label = store.name?.trim() || '(미설정)';
  return [
    `${label} 판매자를 정리할까요?`,
    '정리하면 손님 화면에서 가게와 상품이 숨고 새 주문을 받지 않습니다. 판매자는 계속 로그인할 수 있고, 복구하면 정리하기 전 상태로 돌아갑니다.',
    '주문·정산 기록이 있는 판매자는 가게 ID 앞 8자리를 한 번 더 입력해야 정리됩니다. 기록은 지워지지 않습니다.',
  ].join('\n');
}

/** 가게 ID 확인 입력값 — 기록 있는 판매자를 정리할 때 서버가 비교하는 앞 8자리. */
export function storeIdConfirmPrefix(storeId: string): string {
  return storeId.slice(0, 8);
}

/** 기록 있는 판매자 정리하기 입력창 — 이름이 깨져 있어도 ID로 대상을 확인하게 한다. */
export function describeArchiveRecordsPrompt(store: Pick<AdminStore, 'id' | 'name'>): string {
  const label = store.name?.trim() || '(미설정)';
  return [
    `${label} 판매자는 주문·정산 기록이 있습니다.`,
    `그래도 정리하려면 가게 ID 앞 8자리 "${storeIdConfirmPrefix(store.id)}"를 입력하세요.`,
    '주문·정산 기록은 그대로 남고, 복구하면 다시 손님 화면에 보입니다.',
  ].join('\n');
}

/** 복구 확인창 — 복구하면 손님 화면에 다시 보이고 주문을 받는다. */
export function describeRestoreConfirm(store: Pick<AdminStore, 'name'>): string {
  const label = store.name?.trim() || '(미설정)';
  return `${label} 판매자를 복구할까요?\n복구하면 손님 화면에 다시 보이고 새 주문을 받습니다.`;
}

export function sortStores(stores: AdminStore[], sort: StoreSort): AdminStore[] {
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...stores].sort((a, b) => {
    let compared = 0;
    if (sort.key === 'rate') {
      compared = (a.commissionRate ?? -1) - (b.commissionRate ?? -1);
    } else if (sort.key === 'status') {
      compared = STATUS_LABEL[a.status].localeCompare(STATUS_LABEL[b.status], 'ko');
    } else {
      compared = (a.name || '(미설정)').localeCompare(b.name || '(미설정)', 'ko');
    }
    return (compared || a.id.localeCompare(b.id)) * direction;
  });
}

export function getEmptyKind(stores: AdminStore[], filtered: AdminStore[]): StoreEmptyKind {
  if (stores.length === 0) return 'no-data';
  return filtered.length === 0 ? 'no-match' : 'has-data';
}

// Admin 판매자 목록 read state — 조회 실패와 정상 빈 결과의 구조적 구분.
// useAdminStores는 error/reload를 노출하지만 화면이 이를 소비하지 않으면
// 조회 실패가 빈 목록("등록된 판매자가 없습니다."/"조건에 맞는 판매자가 없습니다.")으로 collapse된다.
// filterStores/sortStores/getEmptyKind 계약은 재설계하지 않고,
// 분기 우선순위(loading > error > empty > results)만 순수 함수로 고정한다.
// 매핑은 getEmptyKind와 일치한다: stores 0건 → EMPTY_UNFILTERED(실제 0건),
// stores 유지 + visible 0건 → EMPTY_FILTERED(필터 결과 0건).
// useAdminList는 조회 실패 시 items를 비우지 않고 이전 결과를 보존하므로,
// error가 존재하면 stale 유무와 무관하게 FETCH_ERROR를 우선한다(성공-empty로 collapse 금지).
export type AdminStoresReadState =
  | 'LOADING'
  | 'FETCH_ERROR'
  | 'EMPTY_UNFILTERED'
  | 'EMPTY_FILTERED'
  | 'HAS_RESULTS';

export function getAdminStoresReadState(args: {
  loading: boolean;
  error: string | null;
  stores: readonly unknown[];
  visible: readonly unknown[];
}): AdminStoresReadState {
  if (args.loading) return 'LOADING';
  if (args.error !== null) return 'FETCH_ERROR';
  if (args.stores.length === 0) return 'EMPTY_UNFILTERED';
  if (args.visible.length === 0) return 'EMPTY_FILTERED';
  return 'HAS_RESULTS';
}

/** 수수료율을 설정하지 않은 가게에 정산이 쓰는 기본 수수료율(서버 PLATFORM_FEE_RATE 기본값, 결정 ②). */
export const DEFAULT_COMMISSION_PERCENT = 5;

/**
 * 화면은 수수료율을 % 단위로 받는다(예: "5" → 0.05 저장). 0~100%, 소수 둘째 자리까지 반올림한다.
 * 저장값(0~1)은 소수 넷째 자리까지로 맞춰 부동소수 오차가 남지 않게 한다.
 */
export function parseRate(input: string): ParseRateResult {
  const trimmed = input.trim().replace(/%$/, '').trim();
  if (trimmed === '') return { ok: false, errorCode: 'EMPTY' };
  const percent = Number(trimmed);
  if (!Number.isFinite(percent)) return { ok: false, errorCode: 'NOT_NUMBER' };
  if (percent < 0 || percent > 100) return { ok: false, errorCode: 'OUT_OF_RANGE' };
  return { ok: true, rate: Math.round(percent * 100) / 10000 };
}

/** 저장된 수수료율(0~1)을 % 숫자로 바꾼다(소수 둘째 자리까지). */
export function rateToPercent(rate: number): number {
  return Math.round(rate * 10000) / 100;
}

/** 편집칸 초기값 — 설정된 요율은 % 숫자, 미설정이면 빈칸. */
export function rateToInput(rate: number | undefined): string {
  return rate === undefined ? '' : String(rateToPercent(rate));
}

// 수수료율 표시 — 숫자는 모두 같은 크기로 쓰고, 설정하지 않은 가게에만 회색 "기본"을 붙인다("5% 기본").
export function formatRate(rate: number | undefined): { percent: string; isDefault: boolean } {
  return rate !== undefined
    ? { percent: `${rateToPercent(rate)}%`, isDefault: false }
    : { percent: `${DEFAULT_COMMISSION_PERCENT}%`, isDefault: true };
}

/** 수수료율 저장 성공 안내 — 다음 정산부터 적용되고 이미 만든 정산은 바뀌지 않는다. */
export function describeCommissionSaved(storeName: string, rate: number): string {
  return `${storeName || '(미설정)'} 수수료율 ${rateToPercent(rate)}%는 다음에 만들어지는 정산부터 적용됩니다. 이미 만든 정산은 그대로입니다.`;
}
