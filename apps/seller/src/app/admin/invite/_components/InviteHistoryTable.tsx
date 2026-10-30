'use client';

import { Badge, Box, Button, Group, Paper, Stack, Text } from '@mantine/core';
import type { InviteToken } from '@/hooks/useAdmin';
import { formatKstDateTime, getAdminInviteReadState, inviteStatus } from '../_lib';

interface InviteHistoryTableProps {
  invites: InviteToken[];
  loading: boolean;
  /** useAdminInvite 조회 실패 메시지. null이면 마지막 조회가 실패하지 않았음. */
  error: string | null;
  /** 조회 실패 시 재시도 — hook의 reload()에 연결된다. */
  onRetry: () => void;
  /** 방금 복사에 성공한 토큰(2초간). 해당 행 버튼만 '복사됨!'으로 바뀐다. */
  copiedToken: string | null;
  /** 행별 초대 링크 복사 — 모든 상태(유효·사용됨·만료·취소됨)에 노출한다(계획서 결정10). */
  onCopy: (token: string) => void;
  /** 취소 처리 중인 토큰. 처리 중에는 모든 행의 취소 버튼을 잠근다. */
  revokingToken: string | null;
  /** 행별 초대 취소 요청 — 유효 상태 행에만 노출하며, 확인 창은 호출자가 띄운다. */
  onRevoke: (token: string) => void;
}

const dateCell = {
  padding: '12px 16px',
  color: 'var(--color-text-disabled)',
  fontSize: 'var(--font-size-sm)',
};

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
      color="brand"
      radius="md"
      aria-label={`토큰 ${token} 초대 링크 복사`}
    >
      {copied ? '복사됨!' : '링크 복사'}
    </Button>
  );
}

function RevokeInviteButton({
  token,
  revokingToken,
  onRevoke,
}: {
  token: string;
  revokingToken: string | null;
  onRevoke: (token: string) => void;
}) {
  return (
    <Button
      onClick={() => onRevoke(token)}
      size="compact-xs"
      variant="subtle"
      color="red"
      radius="md"
      loading={revokingToken === token}
      disabled={revokingToken !== null}
      aria-label={`토큰 ${token} 초대 취소`}
    >
      취소
    </Button>
  );
}

const mutedSm = { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' };

/** 사용한 초대만 사용 시각(KST)과 가입한 계정 id를 보여 준다. 쓰지 않은 초대는 '-'. */
function usageText(inv: InviteToken): string {
  if (!inv.usedAt) return '-';
  const usedAt = formatKstDateTime(inv.usedAt);
  return inv.usedBy ? `${usedAt} · 계정 ${inv.usedBy}` : usedAt;
}

/** 받는 사람을 지정한 초대만 이메일을 보여 준다. 지정하지 않은 초대는 아무것도 그리지 않는다. */
function recipientEmailText(recipientEmail: string | null | undefined) {
  if (!recipientEmail) return null;
  return (
    <Text
      mt={4}
      style={{
        fontSize: 'var(--font-size-sm)',
        color: 'var(--color-text-disabled)',
        wordBreak: 'break-all',
      }}
    >
      받는 사람 {recipientEmail}
    </Text>
  );
}

export function InviteHistoryTable({
  invites,
  loading,
  error,
  onRetry,
  copiedToken,
  onCopy,
  revokingToken,
  onRevoke,
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
          발급된 초대 링크가 없습니다.
        </Text>
      </Paper>
    );
  }

  return (
    <>
      {/* 모바일(<sm): 카드 리스트 — 날짜 컬럼 잘림 방지 */}
      <Stack gap="sm" hiddenFrom="sm" role="list" aria-label="초대 기록">
        {invites.map((inv) => {
          const { label, color, expDate, revocable } = inviteStatus(inv);
          return (
            <Paper
              role="listitem"
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
                <Group gap="xs" wrap="nowrap">
                  <Badge color={color} variant="light" radius="xl">
                    {label}
                  </Badge>
                  {revocable && (
                    <RevokeInviteButton
                      token={inv.token}
                      revokingToken={revokingToken}
                      onRevoke={onRevoke}
                    />
                  )}
                </Group>
              </Group>
              <Text style={mutedSm}>발급 {formatKstDateTime(inv.createdAt)}</Text>
              <Text style={mutedSm}>만료 {formatKstDateTime(expDate)}</Text>
              {inv.usedAt && (
                <Text style={{ ...mutedSm, wordBreak: 'break-all' }}>사용 {usageText(inv)}</Text>
              )}
              {recipientEmailText(inv.recipientEmail)}
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
                발급
              </Box>
              <Box component="th" style={thBase}>
                만료
              </Box>
              <Box component="th" style={thBase}>
                사용
              </Box>
            </tr>
          </Box>
          <Box component="tbody">
            {invites.map((inv) => {
              const { label, color, expDate, revocable } = inviteStatus(inv);
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
                    {recipientEmailText(inv.recipientEmail)}
                  </Box>
                  <Box component="td" style={{ padding: '12px 16px' }}>
                    <Group gap="xs" wrap="nowrap">
                      <Badge color={color} variant="light" radius="xl">
                        {label}
                      </Badge>
                      {revocable && (
                        <RevokeInviteButton
                          token={inv.token}
                          revokingToken={revokingToken}
                          onRevoke={onRevoke}
                        />
                      )}
                    </Group>
                  </Box>
                  <Box component="td" style={dateCell}>
                    {formatKstDateTime(inv.createdAt)}
                  </Box>
                  <Box component="td" style={dateCell}>
                    {formatKstDateTime(expDate)}
                  </Box>
                  <Box component="td" style={{ ...dateCell, wordBreak: 'break-all' }}>
                    {usageText(inv)}
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
