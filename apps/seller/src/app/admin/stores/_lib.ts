import type { StoreStatus } from '@greenhub/shared';
import type { AdminStore } from '@/hooks/useAdmin';

// 판매자 상태 라벨/색 — stores 탭 표현 SSOT(테이블·카드 공용).
// 키는 shared StoreStatus union(invited|active|archived)과 정확히 일치.
// 호출부(StoresTable)는 `?? store.status` 폴백을 유지해 미래 union 확장 시 안전망 제공.
export const STATUS_LABEL: Record<StoreStatus, string> = {
  active: '운영중',
  invited: '초대됨',
  archived: '정리됨',
};

export const STATUS_COLOR: Record<StoreStatus, string> = {
  active: 'green',
  invited: 'yellow',
  archived: 'gray',
};

export type StoreStatusFilter = 'all' | 'current' | StoreStatus;
export type StoreSortKey = 'name' | 'status' | 'rate';
export type SortDirection = 'asc' | 'desc';
export type StoreSortValue = `${StoreSortKey}:${SortDirection}`;
export type StoreEmptyKind = 'no-data' | 'no-match' | 'has-data';
export type ParseRateError = 'EMPTY' | 'NOT_NUMBER' | 'OUT_OF_RANGE';
export type ParseRateResult = { ok: true; rate: number } | { ok: false; errorCode: ParseRateError };
export interface ParseRateOptions {
  min?: number;
  max?: number;
}

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

export const STATUS_FILTER_OPTIONS: { value: StoreStatusFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'current', label: '활성' },
  { value: 'invited', label: STATUS_LABEL.invited },
  { value: 'active', label: STATUS_LABEL.active },
  { value: 'archived', label: STATUS_LABEL.archived },
];

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

export function filterStores(stores: AdminStore[], filters: StoreFilters): AdminStore[] {
  const keyword = filters.keyword.trim().toLowerCase();
  return stores.filter((store) => {
    const statusMatches =
      filters.status === 'all' ||
      (filters.status === 'current'
        ? store.status !== 'archived'
        : store.status === filters.status);
    const keywordMatches = !keyword || (store.name || '').toLowerCase().includes(keyword);
    return statusMatches && keywordMatches;
  });
}

export function sortStores(
  stores: AdminStore[],
  sort: StoreSort,
  defaultCommissionRate?: number,
): AdminStore[] {
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...stores].sort((a, b) => {
    let compared = 0;
    if (sort.key === 'rate') {
      compared =
        effectiveRate(a.commissionRate, defaultCommissionRate) -
        effectiveRate(b.commissionRate, defaultCommissionRate);
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

export function parseRate(input: string, options: ParseRateOptions = {}): ParseRateResult {
  const min = options.min ?? 0;
  const max = options.max ?? 1;
  const trimmed = input.trim();
  if (trimmed === '') return { ok: false, errorCode: 'EMPTY' };
  const rate = Number.parseFloat(trimmed);
  if (Number.isNaN(rate)) return { ok: false, errorCode: 'NOT_NUMBER' };
  if (rate < min || rate > max) return { ok: false, errorCode: 'OUT_OF_RANGE' };
  return { ok: true, rate };
}

export function effectiveRate(rate: number | undefined, defaultRate = 0): number {
  return rate ?? defaultRate;
}

// 수수료율 표시 문자열 — 미설정 시 전역 기본값을 명시한다.
export function formatRate(rate: number | undefined, defaultRate = 0): string {
  if (rate !== undefined) return `${(rate * 100).toFixed(1)}%`;
  return `기본 ${(defaultRate * 100).toFixed(1)}%`;
}
