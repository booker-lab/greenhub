'use client';

import { SearchableSelect } from '@greenhub/ui/components/searchable-select';
import { Select } from '@greenhub/ui/components/select';
import { buildStatusOptions } from '../_lib';

interface OrdersFiltersProps {
  storeFilter: string;
  statusFilter: string;
  /** 가게 선택 옵션('전체 가게' 포함). 판매자 목록을 읽는 중이면 '전체 가게'만 있다. */
  storeOptions: { value: string; label: string }[];
  onStoreChange: (v: string) => void;
  onStatusChange: (v: string) => void;
}

// ① 외형 유지(UI 교체 P2b): Mantine Group gap sm·mb md, Select size sm·radius md(8px)와 같은 값.
// 상태 목록은 Mantine 기본 높이 220, 항목 줄 높이는 Mantine처럼 본문 1.55이고, 칸의 소수점 위치를 따른다.
export function OrdersFilters({
  storeFilter,
  statusFilter,
  storeOptions,
  onStoreChange,
  onStatusChange,
}: OrdersFiltersProps) {
  return (
    <div className="mb-4 flex flex-row flex-wrap items-center justify-start gap-3">
      <div style={{ flex: 1, minWidth: 160 }}>
        <SearchableSelect
          aria-label="가게 선택"
          value={storeFilter}
          onValueChange={(v) => onStoreChange(v ?? '')}
          data={storeOptions}
          nothingFoundMessage="맞는 가게가 없습니다"
          className="rounded-[8px]"
        />
      </div>
      <div style={{ minWidth: 140 }}>
        <Select
          aria-label="주문 상태"
          value={statusFilter}
          onValueChange={(v) => onStatusChange(v ?? '')}
          data={buildStatusOptions()}
          maxDropdownHeight={220}
          className="rounded-[8px]"
          itemClassName="leading-[1.55]"
          inlinePopup
        />
      </div>
    </div>
  );
}
