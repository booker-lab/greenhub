'use client';

import { Group, Select } from '@mantine/core';

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
  return (
    <Group gap="sm" mb="md" style={{ flexWrap: 'wrap' }}>
      {/* 가게는 이름으로 고른다(관리자 판매자 목록). 비우면 전체 가게. */}
      <Select
        placeholder={storesLoading ? '가게 불러오는 중…' : '전체 가게'}
        aria-label="가게"
        data={storeOptions}
        value={storeFilter || null}
        onChange={(value) => onStoreChange(value ?? '')}
        searchable
        clearable
        nothingFoundMessage="일치하는 가게가 없습니다"
        style={{ flex: 1, minWidth: 160 }}
        radius="md"
        size="sm"
      />
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
    </Group>
  );
}
