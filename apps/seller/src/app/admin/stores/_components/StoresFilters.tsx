'use client';

import { Field, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { Select } from '@greenhub/ui/components/select';
import { RefreshButton } from '../../_components/RefreshButton';
import { parseSortValue, SORT_OPTIONS, type StoreSort, toSortValue } from '../_lib';

interface StoresFiltersProps {
  keyword: string;
  sort: StoreSort;
  loading: boolean;
  onKeywordChange: (value: string) => void;
  onSortChange: (value: StoreSort) => void;
  onReload: () => void;
}

// ② 방향(design-direction.md §5 어드민 "목록 검색"): 표 위 검색칸은 "이 목록에서 찾기"로 이름을 붙인다.
// 상태는 표 위 숫자 탭으로 옮겼다. 정렬은 표 머리글이 없는 휴대폰에서만 고르는 칸으로 둔다.
export function StoresFilters({
  keyword,
  sort,
  loading,
  onKeywordChange,
  onSortChange,
  onReload,
}: StoresFiltersProps) {
  return (
    <div className="mb-3 flex flex-row flex-wrap items-end justify-start gap-3">
      <Field className="w-auto min-w-[180px] flex-1 min-[641px]:max-w-[360px]">
        <FieldLabel htmlFor="stores-keyword">이 목록에서 찾기</FieldLabel>
        <Input
          id="stores-keyword"
          placeholder="상호·대표자·전화번호"
          value={keyword}
          onChange={(event) => onKeywordChange(event.currentTarget.value)}
          className="rounded-[8px]"
        />
      </Field>
      <div className="min-w-[140px] flex-1 min-[641px]:hidden">
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
