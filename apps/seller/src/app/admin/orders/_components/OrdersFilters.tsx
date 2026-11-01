'use client';

import { SearchableSelect } from '@greenhub/ui/components/searchable-select';

interface OrdersFiltersProps {
  storeFilter: string;
  /** 가게 선택 옵션('전체 가게' 포함). 판매자 목록을 읽는 중이면 '전체 가게'만 있다. */
  storeOptions: { value: string; label: string }[];
  onStoreChange: (v: string) => void;
}

// ② 방향(design-direction.md §5 어드민): 상태는 표 위 숫자 탭 한 줄로 옮기고, 여기에는 가게 선택만 남긴다.
export function OrdersFilters({ storeFilter, storeOptions, onStoreChange }: OrdersFiltersProps) {
  return (
    <div className="mb-3 w-full min-[641px]:max-w-[320px]">
      <SearchableSelect
        aria-label="가게 선택"
        value={storeFilter}
        onValueChange={(v) => onStoreChange(v ?? '')}
        data={storeOptions}
        nothingFoundMessage="맞는 가게가 없습니다"
        className="rounded-[8px]"
      />
    </div>
  );
}
