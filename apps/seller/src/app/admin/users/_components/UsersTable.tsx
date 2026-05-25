'use client';

import { Badge, Box, Button, Group, Paper, Stack, Text } from '@mantine/core';
import type { AdminUser } from '@/hooks/useAdmin';

interface UsersTableProps {
  users: AdminUser[];
  processingId: string | null;
  onToggle: (user: AdminUser) => void;
}

const thBase = {
  textAlign: 'left' as const,
  padding: '12px 16px',
  fontWeight: 500,
  color: 'var(--color-text-secondary)',
};

export function UsersTable({ users, processingId, onToggle }: UsersTableProps) {
  if (users.length === 0) {
    return (
      <Paper
        radius="lg"
        shadow="xs"
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
      >
        <Text ta="center" py={64} style={{ color: 'var(--color-text-disabled)' }}>
          등록된 소비자가 없습니다.
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
