'use client';

import { Stack, TextInput } from '@mantine/core';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { USER_STATUS_TABS, type UserStatusFilter } from '../_lib';

interface UsersFiltersProps {
  keyword: string;
  status: UserStatusFilter;
  onKeywordChange: (value: string) => void;
  onStatusChange: (value: UserStatusFilter) => void;
}

export function UsersFilters({
  keyword,
  status,
  onKeywordChange,
  onStatusChange,
}: UsersFiltersProps) {
  return (
    <Stack gap="xs" mb="md">
      <TextInput
        aria-label="소비자 검색"
        placeholder="이름, 이메일, 전화번호 검색"
        value={keyword}
        onChange={(event) => onKeywordChange(event.currentTarget.value)}
        radius="md"
        size="sm"
      />
      <SegmentedTabs
        tabs={USER_STATUS_TABS}
        value={status}
        onChange={onStatusChange}
        layout="scroll"
      />
    </Stack>
  );
}
