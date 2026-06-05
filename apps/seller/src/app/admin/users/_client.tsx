'use client';

import { ActionIcon, Box, Group, Text, Title, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { RotateCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import type { AdminUser } from '@/hooks/useAdmin';
import { useAdminUsers } from '@/hooks/useAdmin';
import { UsersFilters } from './_components/UsersFilters';
import { UsersTable } from './_components/UsersTable';
import { filterUsers, getUserEmptyKind, type UserStatusFilter } from './_lib';

interface PendingUserAction {
  userId: string;
  currentlySuspended: boolean;
}

export default function AdminUsersClient() {
  const { users, loading, reload, toggleSuspend } = useAdminUsers();
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<UserStatusFilter>('all');
  const [debouncedKeyword] = useDebouncedValue(keyword, 200);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingUserAction | null>(null);

  const filteredUsers = useMemo(
    () => filterUsers(users, { keyword: debouncedKeyword, status }),
    [users, debouncedKeyword, status],
  );
  const emptyKind = getUserEmptyKind(users, filteredUsers);
  const emptyMessage = emptyKind === 'no-match' ? '검색 결과가 없습니다.' : undefined;

  const runPending = async () => {
    if (!pending) return;
    setProcessingId(pending.userId);
    try {
      await toggleSuspend(pending.userId, !pending.currentlySuspended);
      setPending(null);
    } finally {
      setProcessingId(null);
    }
  };

  const handleToggle = (user: AdminUser) =>
    setPending({ userId: user.id, currentlySuspended: !!user.suspended });

  return (
    <Box>
      <Group justify="space-between" mb="md">
        <Title order={4}>
          소비자 계정{' '}
          <Text
            component="span"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            ({users.length})
          </Text>
        </Title>
        <Tooltip label="새로고침">
          <ActionIcon
            aria-label="소비자 계정 새로고침"
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

      <UsersFilters
        keyword={keyword}
        status={status}
        onKeywordChange={setKeyword}
        onStatusChange={setStatus}
      />

      <UsersTable
        users={filteredUsers}
        loading={loading}
        processingId={processingId}
        emptyMessage={emptyMessage}
        onToggle={handleToggle}
      />

      <ConfirmModal
        opened={pending !== null}
        title={pending?.currentlySuspended ? '계정 정지 해제' : '계정 정지'}
        message={
          pending?.currentlySuspended
            ? '계정 정지를 해제하시겠습니까?'
            : '이 계정을 정지하시겠습니까?'
        }
        confirmLabel={pending?.currentlySuspended ? '해제' : '정지'}
        confirmColor={pending?.currentlySuspended ? 'green' : 'red'}
        loading={processingId !== null}
        onConfirm={runPending}
        onClose={() => {
          if (processingId === null) setPending(null);
        }}
      />
    </Box>
  );
}
