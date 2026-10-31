'use client';

import { Field, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { Select } from '@greenhub/ui/components/select';
import { RefreshButton } from '../../_components/RefreshButton';
import {
  parseSortValue,
  SORT_OPTIONS,
  STATUS_FILTER_OPTIONS,
  type StoreSort,
  type StoreStatusFilter,
  toSortValue,
} from '../_lib';

interface StoresFiltersProps {
  keyword: string;
  status: StoreStatusFilter;
  sort: StoreSort;
  loading: boolean;
  onKeywordChange: (value: string) => void;
  onStatusChange: (value: StoreStatusFilter) => void;
  onSortChange: (value: StoreSort) => void;
  onReload: () => void;
}

// ① 외형 유지(UI 교체 P2b): Mantine Group(gap sm, align end)·TextInput·Select(radius md)와 같은 값.
// Field는 기본 w-full이라 w-auto로 Mantine 입력 상자(폭 없음)처럼 둔다. 정렬 칸은 Mantine hiddenFrom="sm"(48em)과 같은 경계에서 숨는다.
export function StoresFilters({
  keyword,
  status,
  sort,
  loading,
  onKeywordChange,
  onStatusChange,
  onSortChange,
  onReload,
}: StoresFiltersProps) {
  return (
    <div className="mb-4 flex flex-row flex-wrap items-end justify-start gap-3">
      <Field className="w-auto" style={{ flex: 1, minWidth: 180 }}>
        <FieldLabel htmlFor="stores-keyword">판매자 검색</FieldLabel>
        <Input
          id="stores-keyword"
          placeholder="상호·대표자·전화번호"
          value={keyword}
          onChange={(event) => onKeywordChange(event.currentTarget.value)}
          className="rounded-[8px]"
        />
      </Field>
      <Field className="w-auto" style={{ minWidth: 120 }}>
        <FieldLabel htmlFor="stores-status">상태</FieldLabel>
        <Select
          id="stores-status"
          value={status}
          onValueChange={(value) =>
            onStatusChange((value as StoreStatusFilter | null) ?? 'current')
          }
          data={STATUS_FILTER_OPTIONS}
          className="rounded-[8px]"
        />
      </Field>
      <div className="min-[48em]:hidden!" style={{ flex: 1, minWidth: 140 }}>
        <Field>
          <FieldLabel htmlFor="stores-sort">정렬</FieldLabel>
          <Select
            id="stores-sort"
            value={toSortValue(sort)}
            onValueChange={(value) => onSortChange(parseSortValue(value))}
            data={SORT_OPTIONS}
            className="rounded-[8px]"
          />
        </Field>
      </div>
      <RefreshButton loading={loading} onClick={onReload} />
    </div>
  );
}
