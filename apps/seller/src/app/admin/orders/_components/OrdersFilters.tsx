'use client';

import { Group, Select, Switch } from '@mantine/core';
import type { AdminOrderSort, AdminStore } from '@/hooks/useAdmin';
import { buildStatusOptions } from '../_lib';

interface OrdersFiltersProps {
  storeFilter: string;
  statusFilter: string;
  sort: AdminOrderSort;
  pageSize: number;
  stores: AdminStore[];
  storesLoading: boolean;
  includeArchivedStores: boolean;
  onStoreChange: (v: string) => void;
  onStatusChange: (v: string) => void;
  onSortChange: (v: AdminOrderSort) => void;
  onPageSizeChange: (v: number) => void;
  onIncludeArchivedStoresChange: (v: boolean) => void;
}

export function OrdersFilters({
  storeFilter,
  statusFilter,
  sort,
  pageSize,
  stores,
  storesLoading,
  includeArchivedStores,
  onStoreChange,
  onStatusChange,
  onSortChange,
  onPageSizeChange,
  onIncludeArchivedStoresChange,
}: OrdersFiltersProps) {
  const storeOptions = [
    { value: '', label: '전체 스토어' },
    ...stores
      .filter((store) => includeArchivedStores || store.status === 'active')
      .map((store) => ({
        value: store.id,
        label: `${store.name || '(미설정)'}${store.status === 'archived' ? ' (치운)' : ''}`,
      })),
  ];

  return (
    <Group gap="sm" mb="md" align="end" wrap="wrap">
      <Select
        label="스토어"
        placeholder="전체 스토어"
        value={storeFilter}
        onChange={(value) => onStoreChange(value ?? '')}
        data={storeOptions}
        disabled={storesLoading}
        searchable
        clearable
        radius="md"
        size="sm"
        style={{ flex: 1, minWidth: 220 }}
      />
      <Select
        label="상태"
        value={statusFilter}
        onChange={(v) => onStatusChange(v ?? '')}
        data={buildStatusOptions()}
        radius="md"
        size="sm"
        style={{ minWidth: 140 }}
      />
      <Select
        label="정렬"
        value={sort}
        onChange={(value) => onSortChange((value as AdminOrderSort | null) ?? 'createdAt_desc')}
        data={[
          { value: 'createdAt_desc', label: '최신순' },
          { value: 'createdAt_asc', label: '오래된순' },
        ]}
        allowDeselect={false}
        radius="md"
        size="sm"
        style={{ minWidth: 130 }}
      />
      <Select
        label="페이지 크기"
        value={String(pageSize)}
        onChange={(value) => onPageSizeChange(Number(value ?? 50))}
        data={[
          { value: '25', label: '25개' },
          { value: '50', label: '50개' },
          { value: '100', label: '100개' },
        ]}
        allowDeselect={false}
        radius="md"
        size="sm"
        style={{ minWidth: 120 }}
      />
      <Switch
        label="치운 스토어 포함"
        checked={includeArchivedStores}
        onChange={(event) => onIncludeArchivedStoresChange(event.currentTarget.checked)}
        size="sm"
      />
    </Group>
  );
}
