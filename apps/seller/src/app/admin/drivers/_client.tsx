'use client';

import { ActionIcon, Box, Group, TextInput, Title, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { RotateCw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { type DriverStatus, useAdminDrivers } from '@/hooks/useAdmin';
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
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword] = useDebouncedValue(keyword, 200);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const { drivers, loading, reload, approve, toggleSuspend } = useAdminDrivers({ status: tab });

  const filteredDrivers = useMemo(
    () => filterDrivers(drivers, debouncedKeyword),
    [drivers, debouncedKeyword],
  );
  const emptyMessage = getDriverEmptyMessage(drivers, filteredDrivers);

  const runPending = async () => {
    if (!pending) return;
    setProcessingId(pending.userId);
    try {
      if (pending.action === 'approve') {
        await approve(pending.userId);
      } else {
        await toggleSuspend(pending.userId, pending.action === 'suspend');
      }
      setPending(null);
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
