'use client';

import { Group, TextInput } from '@mantine/core';

interface SettlementFiltersProps {
  storeFilter: string;
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
  fromFilter,
  toFilter,
  onStoreChange,
  onFromChange,
  onToChange,
}: SettlementFiltersProps) {
  return (
    <Group gap="sm" mb="md" style={{ flexWrap: 'wrap' }}>
      <TextInput
        placeholder="스토어 ID 필터"
        value={storeFilter}
        onChange={(e) => onStoreChange(e.target.value)}
        style={{ flex: 1, minWidth: 140 }}
        radius="md"
        size="sm"
      />
      <input
        type="date"
        value={fromFilter}
        onChange={(e) => onFromChange(e.target.value)}
        style={dateInputStyle}
      />
      <input
        type="date"
        value={toFilter}
        onChange={(e) => onToChange(e.target.value)}
        style={dateInputStyle}
      />
    </Group>
  );
}
