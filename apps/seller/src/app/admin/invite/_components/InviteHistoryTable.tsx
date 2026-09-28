'use client';

import { Badge, Box, Button, Group, Paper, Stack, Text } from '@mantine/core';
import type { InviteToken } from '@/hooks/useAdmin';
import { formatExpiry, getAdminInviteReadState, inviteStatus } from '../_lib';

interface InviteHistoryTableProps {
  invites: InviteToken[];
  loading: boolean;
  /** useAdminInvite 조회 실패 메시지. null이면 마지막 조회가 실패하지 않았음. */
  error: string | null;
  /** 조회 실패 시 재시도 — hook의 reload()에 연결된다. */
  onRetry: () => void;
  /** 방금 복사에 성공한 토큰(2초간). 해당 행 버튼만 '복사됨!'으로 바뀐다. */
  copiedToken: string | null;
  /** 행별 토큰 복사 — 모든 상태(유효·사용됨·만료)에 노출한다(계획서 결정10). */
  onCopy: (token: string) => void;
}

const thBase = {
  textAlign: 'left' as const,
  padding: '12px 16px',
  fontWeight: 500,
  color: 'var(--color-text-secondary)',
};

function CopyTokenButton({
  token,
  copied,
  onCopy,
}: {
  token: string;
  copied: boolean;
  onCopy: (token: string) => void;
}) {
  return (
    <Button
      onClick={() => onCopy(token)}
      size="compact-xs"
      variant="outline"
      color="green"
      radius="md"
      aria-label={`토큰 ${token} 복사`}
    >
      {copied ? '복사됨!' : '복사'}
    </Button>
  );
}

export function InviteHistoryTable({
  invites,
  loading,
  error,
  onRetry,
  copiedToken,
  onCopy,
}: InviteHistoryTableProps) {
  const readState = getAdminInviteReadState({ loading, error, invites });

  if (readState === 'LOADING') {
    return (
      <Text ta="center" py={32} style={{ color: 'var(--color-text-disabled)' }}>
        불러오는 중...
      </Text>
    );
  }

  // 조회 실패는 성공-empty와 구조적으로 구분 — "발급된 토큰이 없습니다."로 collapse 금지.
  if (readState === 'FETCH_ERROR') {
    return (
      <Paper
        radius="lg"
        shadow="xs"
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
      >
        <Stack gap="sm" align="center" py={48} px="md">
          <Text style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>
            발급 내역을 불러오지 못했습니다.
          </Text>
          <Text
            ta="center"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            {error}
          </Text>
          <Button onClick={onRetry} size="sm" variant="outline" radius="md">
            다시 조회
          </Button>
        </Stack>
      </Paper>
    );
  }

  if (readState === 'EMPTY') {
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
                <Group gap="xs" wrap="nowrap">
                  <Text
                    component="code"
                    ff="monospace"
                    style={{ letterSpacing: '0.1em', color: 'var(--color-text)' }}
                  >
                    {inv.token}
                  </Text>
                  <CopyTokenButton
                    token={inv.token}
                    copied={copiedToken === inv.token}
                    onCopy={onCopy}
                  />
                </Group>
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
                    <Group gap="xs" wrap="nowrap">
                      <Text
                        component="code"
                        ff="monospace"
                        style={{ letterSpacing: '0.1em', color: 'var(--color-text)' }}
                      >
                        {inv.token}
                      </Text>
                      <CopyTokenButton
                        token={inv.token}
                        copied={copiedToken === inv.token}
                        onCopy={onCopy}
                      />
                    </Group>
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
