'use client';

import { Group, Select } from '@mantine/core';
import { buildStatusOptions } from '../_lib';

interface OrdersFiltersProps {
  storeFilter: string;
  statusFilter: string;
  /** 가게 선택 옵션('전체 가게' 포함). 판매자 목록을 읽는 중이면 '전체 가게'만 있다. */
  storeOptions: { value: string; label: string }[];
  onStoreChange: (v: string) => void;
  onStatusChange: (v: string) => void;
}

export function OrdersFilters({
  storeFilter,
  statusFilter,
  storeOptions,
  onStoreChange,
  onStatusChange,
}: OrdersFiltersProps) {
  return (
    <Group gap="sm" mb="md">
      <Select
        aria-label="가게 선택"
        value={storeFilter}
        onChange={(v) => onStoreChange(v ?? '')}
        data={storeOptions}
        searchable
        nothingFoundMessage="맞는 가게가 없습니다"
        radius="md"
        size="sm"
        style={{ flex: 1, minWidth: 160 }}
      />
      <Select
        aria-label="주문 상태"
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
