'use client';

import { Badge, Box, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { useAdminUsers } from '@/hooks/useAdmin';

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

      {users.length === 0 ? (
        <Paper
          radius="lg"
          shadow="xs"
          style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
        >
          <Text ta="center" py={64} style={{ color: 'var(--color-text-disabled)' }}>
            등록된 소비자가 없습니다.
          </Text>
        </Paper>
      ) : (
        <>
          {/* 모바일(<sm): 카드 리스트 — 상태·정지/복구 버튼 잘림 방지 */}
          <Stack gap="sm" hiddenFrom="sm">
            {users.map((user) => (
              <Paper
                key={user.id}
                radius="md"
                px="md"
                py="sm"
                shadow="xs"
                style={{ border: '1px solid var(--color-border)' }}
              >
                <Group justify="space-between" mb="xs" align="flex-start">
                  <Box style={{ minWidth: 0, flex: 1 }}>
                    <Text style={{ fontWeight: 'var(--fw-medium)' }}>{user.name}</Text>
                    <Text
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-secondary)',
                        wordBreak: 'break-all',
                      }}
                    >
                      {user.email}
                    </Text>
                  </Box>
                  <Badge color={user.suspended ? 'red' : 'green'} variant="light" radius="xl">
                    {user.suspended ? '정지됨' : '정상'}
                  </Badge>
                </Group>
                <Group justify="flex-end" mt="xs">
                  <Button
                    onClick={() =>
                      setPending({ userId: user.id, currentlySuspended: !!user.suspended })
                    }
                    disabled={processingId === user.id}
                    size="xs"
                    variant="outline"
                    color={user.suspended ? 'green' : 'red'}
                    radius="md"
                  >
                    {processingId === user.id ? '처리중…' : user.suspended ? '복구' : '정지'}
                  </Button>
                </Group>
              </Paper>
            ))}
          </Stack>

          {/* 데스크톱(≥sm): 기존 테이블 유지(시각 회귀 0) */}
          <Paper
            radius="lg"
            shadow="xs"
            style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
            visibleFrom="sm"
          >
            <Box
              component="table"
              style={{ width: '100%', fontSize: 'var(--font-size-sm)', borderCollapse: 'collapse' }}
            >
            <Box
              component="thead"
              style={{
                backgroundColor: 'var(--color-surface-muted)',
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <tr>
                <Box
                  component="th"
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    fontWeight: 500,
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  이름
                </Box>
                <Box
                  component="th"
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    fontWeight: 500,
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  이메일
                </Box>
                <Box
                  component="th"
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    fontWeight: 500,
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  상태
                </Box>
                <Box component="th" style={{ padding: '12px 16px' }} />
              </tr>
            </Box>
            <Box component="tbody">
              {users.map((user) => (
                <Box
                  component="tr"
                  key={user.id}
                  style={{ borderTop: '1px solid var(--color-border)' }}
                >
                  <Box component="td" style={{ padding: '12px 16px' }}>
                    <Text style={{ fontWeight: 'var(--fw-medium)' }}>{user.name}</Text>
                    <Text
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-disabled)',
                      }}
                      ff="monospace"
                    >
                      {user.id.slice(0, 8)}…
                    </Text>
                  </Box>
                  <Box
                    component="td"
                    style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}
                  >
                    {user.email}
                  </Box>
                  <Box component="td" style={{ padding: '12px 16px' }}>
                    <Badge color={user.suspended ? 'red' : 'green'} variant="light" radius="xl">
                      {user.suspended ? '정지됨' : '정상'}
                    </Badge>
                  </Box>
                  <Box component="td" style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <Button
                      onClick={() =>
                        setPending({ userId: user.id, currentlySuspended: !!user.suspended })
                      }
                      disabled={processingId === user.id}
                      size="xs"
                      variant="outline"
                      color={user.suspended ? 'green' : 'red'}
                      radius="md"
                    >
                      {processingId === user.id ? '처리중…' : user.suspended ? '복구' : '정지'}
                    </Button>
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
          </Paper>
        </>
      )}

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
