'use client';

import { Box, Button, Group, Select, TextInput } from '@mantine/core';
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
    <Group gap="sm" mb="md" align="end" wrap="wrap">
      <TextInput
        label="판매자 검색"
        placeholder="상호명 입력"
        value={keyword}
        onChange={(event) => onKeywordChange(event.currentTarget.value)}
        style={{ flex: 1, minWidth: 180 }}
        radius="md"
        size="sm"
      />
      <Select
        label="상태"
        value={status}
        onChange={(value) => onStatusChange((value as StoreStatusFilter | null) ?? 'current')}
        data={STATUS_FILTER_OPTIONS}
        radius="md"
        size="sm"
        style={{ minWidth: 120 }}
      />
      <Box hiddenFrom="sm" style={{ flex: 1, minWidth: 140 }}>
        <Select
          label="정렬"
          value={toSortValue(sort)}
          onChange={(value) => onSortChange(parseSortValue(value))}
          data={SORT_OPTIONS}
          radius="md"
          size="sm"
        />
      </Box>
      <Button variant="light" color="gray" radius="md" loading={loading} onClick={onReload}>
        새로고침
      </Button>
    </Group>
  );
}
