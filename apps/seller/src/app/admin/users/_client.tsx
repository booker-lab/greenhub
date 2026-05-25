'use client';

import { Box, Group, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import type { AdminUser } from '@/hooks/useAdmin';
import { useAdminUsers } from '@/hooks/useAdmin';
import { UsersTable } from './_components/UsersTable';

interface PendingUserAction {
  userId: string;
  currentlySuspended: boolean;
}

export default function AdminUsersClient() {
  const { users, loading, toggleSuspend } = useAdminUsers();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingUserAction | null>(null);

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

  if (loading) {
    return (
      <Text ta="center" py={80} style={{ color: 'var(--color-text-disabled)' }}>
        불러오는 중...
      </Text>
    );
  }

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
      </Group>

      <UsersTable users={users} processingId={processingId} onToggle={handleToggle} />

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
