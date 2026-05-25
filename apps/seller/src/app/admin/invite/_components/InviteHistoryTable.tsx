'use client';

import { Badge, Box, Group, Paper, Stack, Text } from '@mantine/core';
import type { InviteToken } from '@/hooks/useAdmin';
import { formatExpiry, inviteStatus } from '../_lib';

interface InviteHistoryTableProps {
  invites: InviteToken[];
  loading: boolean;
}

const thBase = {
  textAlign: 'left' as const,
  padding: '12px 16px',
  fontWeight: 500,
  color: 'var(--color-text-secondary)',
};

export function InviteHistoryTable({ invites, loading }: InviteHistoryTableProps) {
  if (loading) {
    return (
      <Text ta="center" py={32} style={{ color: 'var(--color-text-disabled)' }}>
        불러오는 중...
      </Text>
    );
  }

  if (invites.length === 0) {
    return (
      <Paper
        radius="lg"
        shadow="xs"
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
      >
        <Text ta="center" py={48} style={{ color: 'var(--color-text-disabled)' }}>
          발급된 토큰이 없습니다.
        </Text>
      </Paper>
    );
  }

  return (
    <>
      {/* 모바일(<sm): 카드 리스트 — 만료일 컬럼 잘림 방지 */}
      <Stack gap="sm" hiddenFrom="sm">
        {invites.map((inv) => {
          const { label, color, expDate } = inviteStatus(inv);
          return (
            <Paper
              key={inv.token}
              radius="md"
              px="md"
              py="sm"
              shadow="xs"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <Group justify="space-between" mb="xs">
                <Text
                  component="code"
                  ff="monospace"
                  style={{ letterSpacing: '0.1em', color: 'var(--color-text)' }}
                >
                  {inv.token}
                </Text>
                <Badge color={color} variant="light" radius="xl">
                  {label}
                </Badge>
              </Group>
              <Text
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-text-disabled)',
                }}
              >
                만료 {formatExpiry(expDate)}
              </Text>
            </Paper>
          );
        })}
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
                토큰
              </Box>
              <Box component="th" style={thBase}>
                상태
              </Box>
              <Box component="th" style={thBase}>
                만료일
              </Box>
            </tr>
          </Box>
          <Box component="tbody">
            {invites.map((inv) => {
              const { label, color, expDate } = inviteStatus(inv);
              return (
                <Box
                  component="tr"
                  key={inv.token}
                  style={{ borderTop: '1px solid var(--color-border)' }}
                >
                  <Box component="td" style={{ padding: '12px 16px' }}>
                    <Text
                      component="code"
                      ff="monospace"
                      style={{ letterSpacing: '0.1em', color: 'var(--color-text)' }}
                    >
                      {inv.token}
                    </Text>
                  </Box>
                  <Box component="td" style={{ padding: '12px 16px' }}>
                    <Badge color={color} variant="light" radius="xl">
                      {label}
                    </Badge>
                  </Box>
                  <Box
                    component="td"
                    style={{
                      padding: '12px 16px',
                      color: 'var(--color-text-disabled)',
                      fontSize: 'var(--font-size-sm)',
                    }}
                  >
                    {formatExpiry(expDate)}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      </Paper>
    </>
  );
}
