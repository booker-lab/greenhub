'use client';

import { Group, Select, TextInput } from '@mantine/core';
import { buildStatusOptions } from '../_lib';

interface OrdersFiltersProps {
  storeFilter: string;
  statusFilter: string;
  onStoreChange: (v: string) => void;
  onStatusChange: (v: string) => void;
}

export function OrdersFilters({
  storeFilter,
  statusFilter,
  onStoreChange,
  onStatusChange,
}: OrdersFiltersProps) {
  return (
    <Group gap="sm" mb="md">
      <TextInput
        placeholder="스토어 ID 필터"
        value={storeFilter}
        onChange={(e) => onStoreChange(e.target.value)}
        style={{ flex: 1 }}
        radius="md"
        size="sm"
      />
      <Select
        value={statusFilter}
        onChange={(v) => onStatusChange(v ?? '')}
        data={buildStatusOptions()}
        radius="md"
        size="sm"
        style={{ minWidth: 140 }}
      />
    </Group>
  );
}
