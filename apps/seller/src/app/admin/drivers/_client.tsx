'use client';

import { ActionIcon, Box, Button, Group, Select, TextInput, Title, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { RotateCw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { type DriverSort, type DriverStatus, useAdminDrivers } from '@/hooks/useAdmin';
import { DriverList } from './_components/DriverList';
import {
  ACTION_META,
  type DriverAction,
  filterDrivers,
  getDriverEmptyMessage,
  type PendingAction,
  STATUS_TABS,
} from './_lib';

export default function DriversClient() {
  const [tab, setTab] = useState<DriverStatus>('pending');
  const [sort, setSort] = useState<DriverSort>('createdAt_desc');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword] = useDebouncedValue(keyword, 200);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const { drivers, loading, loadingMore, hasMore, reload, loadMore, approve, toggleSuspend } =
    useAdminDrivers({ status: tab, sort, limit: 100 });

  const filteredDrivers = useMemo(
    () => filterDrivers(drivers, debouncedKeyword),
    [drivers, debouncedKeyword],
  );
  const emptyMessage = getDriverEmptyMessage(drivers, filteredDrivers);

  const runPending = async () => {
    if (!pending) return;
    const current = pending;
    setProcessingId(current.userId);
    try {
      const ok =
        current.action === 'approve'
          ? await approve(current.userId)
          : await toggleSuspend(current.userId, current.action === 'suspend');

      if (ok) {
        notifications.show({
          color: 'green',
          message: ACTION_META[current.action].successMessage,
        });
        setPending(null);
      } else {
        notifications.show({
          color: 'red',
          message: '드라이버 상태 변경에 실패했습니다. 잠시 후 다시 시도해주세요.',
        });
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleAction = (userId: string, action: DriverAction) => setPending({ userId, action });

  const pendingMeta = pending ? ACTION_META[pending.action] : null;

  return (
    <Box>
      <Group justify="space-between" mb="md">
        <Title order={4}>드라이버 관리</Title>
        <Tooltip label="새로고침">
          <ActionIcon
            aria-label="드라이버 목록 새로고침"
            color="gray"
            loading={loading}
            onClick={reload}
            radius="md"
            variant="subtle"
          >
            <RotateCw size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <TextInput
        aria-label="드라이버 검색"
        leftSection={<Search size={16} />}
        mb="xs"
        onChange={(event) => setKeyword(event.currentTarget.value)}
        placeholder="이름, 이메일 검색"
        radius="md"
        size="sm"
        value={keyword}
      />

      <Select
        aria-label="드라이버 정렬"
        data={[
          { value: 'createdAt_desc', label: '가입일 최신순' },
          { value: 'createdAt_asc', label: '가입일 오래된순' },
        ]}
        mb="xs"
        onChange={(value) => setSort((value as DriverSort | null) ?? 'createdAt_desc')}
        radius="md"
        size="sm"
        value={sort}
      />

      <Box mb="md">
        <SegmentedTabs tabs={STATUS_TABS} value={tab} onChange={setTab} layout="scroll" />
      </Box>

      <DriverList
        drivers={filteredDrivers}
        loading={loading}
        processingId={processingId}
        emptyMessage={emptyMessage}
        onAction={handleAction}
      />

      {hasMore && (
        <Button
          fullWidth
          loading={loadingMore}
          mt="md"
          onClick={loadMore}
          radius="md"
          variant="light"
        >
          더 보기
        </Button>
      )}

      <ConfirmModal
        opened={pending !== null}
        title={pendingMeta?.title ?? ''}
        message={pendingMeta?.message ?? ''}
        confirmLabel={pendingMeta?.confirmLabel}
        confirmColor={pendingMeta?.confirmColor}
        loading={processingId !== null}
        onConfirm={runPending}
        onClose={() => {
          if (processingId === null) setPending(null);
        }}
      />
    </Box>
  );
}
