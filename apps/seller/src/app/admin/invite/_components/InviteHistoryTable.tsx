'use client';

import { ActionIcon, Badge, Box, Group, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { Check, Copy } from 'lucide-react';
import type { InviteToken } from '@/hooks/useAdmin';
import { formatExpiry, formatInviteDateTime, inviteStatus } from '../_lib';

interface InviteHistoryTableProps {
  invites: InviteToken[];
  loading: boolean;
  copiedToken: string | null;
  onCopyToken: (token: string) => void;
}

const thBase = {
  textAlign: 'left' as const,
  padding: '12px 16px',
  fontWeight: 500,
  color: 'var(--color-text-secondary)',
};

const tdBase = { padding: '12px 16px' };

function CopyTokenButton({
  token,
  copied,
  onCopyToken,
}: {
  token: string;
  copied: boolean;
  onCopyToken: (token: string) => void;
}) {
  return (
    <Tooltip label={copied ? '복사됨' : '토큰 복사'}>
      <ActionIcon
        aria-label={`${token} 복사`}
        variant="subtle"
        color={copied ? 'green' : 'gray'}
        onClick={() => onCopyToken(token)}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </ActionIcon>
    </Tooltip>
  );
}

export function InviteHistoryTable({
  invites,
  loading,
  copiedToken,
  onCopyToken,
}: InviteHistoryTableProps) {
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
          const copied = copiedToken === inv.token;
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
                <Group gap="xs">
                  <Text
                    component="code"
                    ff="monospace"
                    style={{ letterSpacing: '0.1em', color: 'var(--color-text)' }}
                  >
                    {inv.token}
                  </Text>
                  <CopyTokenButton token={inv.token} copied={copied} onCopyToken={onCopyToken} />
                </Group>
                <Badge color={color} variant="light" radius="xl">
                  {label}
                </Badge>
              </Group>
              <Stack gap={4}>
                <Text
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-disabled)',
                  }}
                >
                  발급 {formatInviteDateTime(inv.createdAt)}
                </Text>
                <Text
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-disabled)',
                  }}
                >
                  사용 {formatInviteDateTime(inv.usedAt)}
                </Text>
                <Text
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-disabled)',
                  }}
                >
                  만료 {formatExpiry(expDate)}
                </Text>
              </Stack>
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
                복사
              </Box>
              <Box component="th" style={thBase}>
                상태
              </Box>
              <Box component="th" style={thBase}>
                발급일
              </Box>
              <Box component="th" style={thBase}>
                사용일
              </Box>
              <Box component="th" style={thBase}>
                만료일
              </Box>
            </tr>
          </Box>
          <Box component="tbody">
            {invites.map((inv) => {
              const { label, color, expDate } = inviteStatus(inv);
              const copied = copiedToken === inv.token;
              return (
                <Box
                  component="tr"
                  key={inv.token}
                  style={{ borderTop: '1px solid var(--color-border)' }}
                >
                  <Box component="td" style={tdBase}>
                    <Text
                      component="code"
                      ff="monospace"
                      style={{ letterSpacing: '0.1em', color: 'var(--color-text)' }}
                    >
                      {inv.token}
                    </Text>
                  </Box>
                  <Box component="td" style={tdBase}>
                    <CopyTokenButton token={inv.token} copied={copied} onCopyToken={onCopyToken} />
                  </Box>
                  <Box component="td" style={tdBase}>
                    <Badge color={color} variant="light" radius="xl">
                      {label}
                    </Badge>
                  </Box>
                  <Box
                    component="td"
                    style={{
                      ...tdBase,
                      color: 'var(--color-text-disabled)',
                      fontSize: 'var(--font-size-sm)',
                    }}
                  >
                    {formatInviteDateTime(inv.createdAt)}
                  </Box>
                  <Box
                    component="td"
                    style={{
                      ...tdBase,
                      color: 'var(--color-text-disabled)',
                      fontSize: 'var(--font-size-sm)',
                    }}
                  >
                    {formatInviteDateTime(inv.usedAt)}
                  </Box>
                  <Box
                    component="td"
                    style={{
                      ...tdBase,
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
