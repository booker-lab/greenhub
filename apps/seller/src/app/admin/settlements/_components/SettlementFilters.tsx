'use client';

import { SearchableSelect } from '@greenhub/ui/components/searchable-select';

interface SettlementFiltersProps {
  storeFilter: string;
  storeOptions: { value: string; label: string }[];
  storesLoading: boolean;
  fromFilter: string;
  toFilter: string;
  onStoreChange: (v: string) => void;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}

const dateInputStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 'var(--font-size-sm)',
};

export function SettlementFilters({
  storeFilter,
  storeOptions,
  storesLoading,
  fromFilter,
  toFilter,
  onStoreChange,
  onFromChange,
  onToChange,
}: SettlementFiltersProps) {
  // ① 외형 유지(UI 교체 P2b): Mantine Group gap sm·mb md, Select size sm·radius md(8px)와 같은 값.
  return (
    <div className="mb-4 flex flex-row flex-wrap items-center justify-start gap-3">
      {/* 가게는 이름으로 고른다(관리자 판매자 목록). 비우면 전체 가게. */}
      <div style={{ flex: 1, minWidth: 160 }}>
        <SearchableSelect
          placeholder={storesLoading ? '가게 불러오는 중…' : '전체 가게'}
          aria-label="가게"
          data={storeOptions}
          value={storeFilter || null}
          onValueChange={(value) => onStoreChange(value ?? '')}
          clearable
          nothingFoundMessage="일치하는 가게가 없습니다"
          className="rounded-[8px]"
        />
      </div>
      <input
        type="date"
        aria-label="시작일"
        value={fromFilter}
        onChange={(e) => onFromChange(e.target.value)}
        style={dateInputStyle}
      />
      <input
        type="date"
        aria-label="종료일"
        value={toFilter}
        onChange={(e) => onToChange(e.target.value)}
        style={dateInputStyle}
      />
    </div>
  );
}
