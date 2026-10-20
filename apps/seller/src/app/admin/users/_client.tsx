'use client';

import { Box, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { normalizeSuspendReason, SuspendReasonMessage } from '@/components/SuspendReasonMessage';
import type { AdminUser } from '@/hooks/useAdmin';
import { describeAdminCommandOutcome, useAdminUsers } from '@/hooks/useAdmin';
import { UsersTable } from './_components/UsersTable';
import { describeUserSuspendConfirm } from './_lib';

interface PendingUserAction {
  userId: string;
  name: string;
  email: string;
  currentlySuspended: boolean;
}

export default function AdminUsersClient() {
  const { users, loading, error, reload, toggleSuspend } = useAdminUsers();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingUserAction | null>(null);
  const [reason, setReason] = useState('');

  const runPending = async () => {
    if (!pending) return;
    const actionLabel = describeUserSuspendConfirm(pending).confirmLabel;
    setProcessingId(pending.userId);
    try {
      const outcome = await toggleSuspend(
        pending.userId,
        !pending.currentlySuspended,
        normalizeSuspendReason(reason),
      );
      setPending(null);
      if (outcome.kind === 'confirmed' && outcome.reconciled) return;
      // rejected는 서버 reason 보존, unknown/stale은 재확인 우선 + blind retry 금지.
      const presentation = describeAdminCommandOutcome(outcome, actionLabel);
      notifications.show({
        color: outcome.kind === 'rejected' ? 'red' : 'yellow',
        title: presentation.title,
        message: presentation.message,
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleToggle = (user: AdminUser) => {
    setReason('');
    setPending({
      userId: user.id,
      name: user.name,
      email: user.email,
      currentlySuspended: !!user.suspended,
    });
  };

  const confirm = pending ? describeUserSuspendConfirm(pending) : null;

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
        {/* 새로고침 — stores 탭(StoresFilters)과 같은 버튼 형태, hook reload 재사용 */}
        <Button variant="light" color="gray" radius="md" loading={loading} onClick={reload}>
          새로고침
        </Button>
      </Group>

      <UsersTable users={users} processingId={processingId} onToggle={handleToggle} />

      <ConfirmModal
        opened={pending !== null}
        title={confirm?.title ?? ''}
        message={
          <SuspendReasonMessage
            message={confirm?.message ?? ''}
            reason={reason}
            onReasonChange={setReason}
          />
        }
        confirmLabel={confirm?.confirmLabel}
        confirmColor={confirm?.confirmColor}
        loading={processingId !== null}
        onConfirm={runPending}
        onClose={() => {
          if (processingId === null) setPending(null);
        }}
      />
    </Box>
  );
}
