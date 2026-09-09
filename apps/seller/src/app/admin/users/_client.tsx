'use client';

import { Box, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
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
  const { users, loading, error, reload, toggleSuspend } = useAdminUsers();
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

  if (error !== null && !loading) {
    return (
      <Box>
        <Group justify="space-between" mb="md">
          <Title order={4}>소비자 계정</Title>
        </Group>
        <Paper
          radius="lg"
          shadow="xs"
          style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
        >
          <Stack gap="sm" align="center" py={64} px="md">
            <Text style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>
              소비자 목록을 불러오지 못했습니다.
            </Text>
            <Text
              ta="center"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              {error}
            </Text>
            <Button onClick={reload} size="sm" variant="outline" radius="md">
              다시 조회
            </Button>
          </Stack>
        </Paper>
      </Box>
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
