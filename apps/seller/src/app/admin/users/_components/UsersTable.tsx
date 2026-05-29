'use client';

import { Badge, Box, Button, Group, Paper, Stack, Text } from '@mantine/core';
import { toDateStrKST } from '@greenhub/shared';
import type { AdminUser } from '@/hooks/useAdmin';

interface UsersTableProps {
  users: AdminUser[];
  loading: boolean;
  processingId: string | null;
  emptyMessage?: string;
  onToggle: (user: AdminUser) => void;
}

const thBase = {
  textAlign: 'left' as const,
  padding: '12px 16px',
  fontWeight: 500,
  color: 'var(--color-text-secondary)',
};

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (!value || typeof value !== 'object') return null;

  const record = value as {
    _seconds?: number;
    seconds?: number;
    toDate?: () => Date;
  };
  if (typeof record.toDate === 'function') return record.toDate();
  const seconds = record._seconds ?? record.seconds;
  return typeof seconds === 'number' ? new Date(seconds * 1000) : null;
}

function formatCreatedAt(value: unknown): string {
  const date = toDate(value);
  return date ? toDateStrKST(date) : '-';
}

function formatPhone(value: string | undefined): string {
  return value?.trim() || '-';
}

export function UsersTable({
  users,
  loading,
  processingId,
  emptyMessage = '등록된 소비자가 없습니다.',
  onToggle,
}: UsersTableProps) {
  if (loading) {
    return (
      <Text ta="center" py={80} style={{ color: 'var(--color-text-disabled)' }}>
        불러오는 중...
      </Text>
    );
  }

  if (users.length === 0) {
    return (
      <Paper
        radius="lg"
        shadow="xs"
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
      >
        <Text ta="center" py={64} style={{ color: 'var(--color-text-disabled)' }}>
          {emptyMessage}
        </Text>
      </Paper>
    );
  }

  return (
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
                <Text
                  style={{
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--color-text-disabled)',
                  }}
                >
                  가입일 {formatCreatedAt(user.createdAt)}
                </Text>
                <Text
                  style={{
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--color-text-disabled)',
                  }}
                >
                  전화 {formatPhone(user.phone)}
                </Text>
              </Box>
              <Badge color={user.suspended ? 'red' : 'green'} variant="light" radius="xl">
                {user.suspended ? '정지됨' : '정상'}
              </Badge>
            </Group>
            <Group justify="flex-end" mt="xs">
              <Button
                onClick={() => onToggle(user)}
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
              <Box component="th" style={thBase}>
                이름
              </Box>
              <Box component="th" style={thBase}>
                이메일
              </Box>
              <Box component="th" style={thBase}>
                가입일
              </Box>
              <Box component="th" style={thBase}>
                전화
              </Box>
              <Box component="th" style={thBase}>
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
                <Box
                  component="td"
                  style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}
                >
                  {formatCreatedAt(user.createdAt)}
                </Box>
                <Box
                  component="td"
                  style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}
                >
                  {formatPhone(user.phone)}
                </Box>
                <Box component="td" style={{ padding: '12px 16px' }}>
                  <Badge color={user.suspended ? 'red' : 'green'} variant="light" radius="xl">
                    {user.suspended ? '정지됨' : '정상'}
                  </Badge>
                </Box>
                <Box component="td" style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <Button
                    onClick={() => onToggle(user)}
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
  );
}
