'use client';

import { Badge } from '@greenhub/ui/components/badge';
import { Button } from '@greenhub/ui/components/button';
import { LoadingButton } from '@greenhub/ui/components/loading-button';
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

// ① 외형 유지(UI 교체 P2b): Mantine Text(16px·줄 높이 1.55)·Paper·Group·Stack·Badge light·Button compact-xs와 같은 값.
// 카드·표 전환은 Mantine hiddenFrom·visibleFrom="sm"(48em)과 같은 경계다.
const TEXT = 'm-0 p-0 text-base font-normal';
const PAPER = 'block rounded-[16px] bg-white shadow-mantine-xs';
const GROUP_NOWRAP = 'flex flex-row flex-nowrap items-center justify-start gap-2.5';
// Mantine Badge light: brand ↔ light, gray ↔ secondary, red ↔ destructive, orange ↔ light-orange.
const BADGE_VARIANT = {
  brand: 'light',
  gray: 'secondary',
  red: 'destructive',
  orange: 'light-orange',
} as const;

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
      className="rounded-[8px]"
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
    <LoadingButton
      onClick={() => onRevoke(token)}
      size="compact-xs"
      variant="subtle-destructive"
      className="rounded-[8px]"
      loading={revokingToken === token}
      disabled={revokingToken !== null}
      aria-label={`토큰 ${token} 초대 취소`}
    >
      취소
    </LoadingButton>
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
    <p
      className={`${TEXT} mt-1`}
      style={{
        fontSize: 'var(--font-size-sm)',
        color: 'var(--color-text-disabled)',
        wordBreak: 'break-all',
      }}
    >
      받는 사람 {recipientEmail}
    </p>
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
      <p className={`${TEXT} py-8 text-center`} style={{ color: 'var(--color-text-disabled)' }}>
        불러오는 중...
      </p>
    );
  }

  // 조회 실패는 성공-empty와 구조적으로 구분 — "발급된 토큰이 없습니다."로 collapse 금지.
  if (readState === 'FETCH_ERROR') {
    return (
      <div
        className={PAPER}
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
      >
        <div className="flex flex-col items-center gap-3 px-4 py-12">
          <p className={TEXT} style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>
            발급 내역을 불러오지 못했습니다.
          </p>
          <p
            className={`${TEXT} text-center`}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            {error}
          </p>
          <Button onClick={onRetry} variant="outline" className="rounded-[8px]">
            다시 조회
          </Button>
        </div>
      </div>
    );
  }

  if (readState === 'EMPTY') {
    return (
      <div
        className={PAPER}
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
      >
        <p className={`${TEXT} py-12 text-center`} style={{ color: 'var(--color-text-disabled)' }}>
          발급된 초대 링크가 없습니다.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* 모바일(<sm): 카드 리스트 — 날짜 컬럼 잘림 방지 */}
      {/* biome-ignore lint/a11y/useSemanticElements: Mantine Stack(div) 그대로의 목록 역할. ul로 바꾸면 기본 여백·글머리표가 생긴다. */}
      <div className="flex flex-col gap-3 min-[48em]:hidden!" role="list" aria-label="초대 기록">
        {invites.map((inv) => {
          const { label, color, expDate, revocable } = inviteStatus(inv);
          return (
            // biome-ignore lint/a11y/useSemanticElements: 위 목록(div)의 항목. Mantine Paper(div) 그대로다.
            <div
              role="listitem"
              key={inv.token}
              className="block rounded-[8px] bg-white px-4 py-3 shadow-mantine-xs"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <div className="mb-2.5 flex flex-row flex-wrap items-center justify-between gap-4">
                <div className={GROUP_NOWRAP}>
                  <code
                    className={`${TEXT} font-mono`}
                    style={{ letterSpacing: '0.1em', color: 'var(--color-text)' }}
                  >
                    {inv.token}
                  </code>
                  <CopyTokenButton
                    token={inv.token}
                    copied={copiedToken === inv.token}
                    onCopy={onCopy}
                  />
                </div>
                <div className={GROUP_NOWRAP}>
                  <Badge variant={BADGE_VARIANT[color]} className="rounded-[32px]">
                    {label}
                  </Badge>
                  {revocable && (
                    <RevokeInviteButton
                      token={inv.token}
                      revokingToken={revokingToken}
                      onRevoke={onRevoke}
                    />
                  )}
                </div>
              </div>
              <p className={TEXT} style={mutedSm}>
                발급 {formatKstDateTime(inv.createdAt)}
              </p>
              <p className={TEXT} style={mutedSm}>
                만료 {formatKstDateTime(expDate)}
              </p>
              {inv.usedAt && (
                <p className={TEXT} style={{ ...mutedSm, wordBreak: 'break-all' }}>
                  사용 {usageText(inv)}
                </p>
              )}
              {recipientEmailText(inv.recipientEmail)}
            </div>
          );
        })}
      </div>

      {/* 데스크톱(≥sm): 기존 테이블 유지(시각 회귀 0) */}
      <div
        className={`${PAPER} max-[47.99375em]:hidden!`}
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
      >
        <table
          style={{ width: '100%', fontSize: 'var(--font-size-sm)', borderCollapse: 'collapse' }}
        >
          <thead
            style={{
              backgroundColor: 'var(--color-surface-muted)',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <tr>
              <th style={thBase}>토큰</th>
              <th style={thBase}>상태</th>
              <th style={thBase}>발급</th>
              <th style={thBase}>만료</th>
              <th style={thBase}>사용</th>
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => {
              const { label, color, expDate, revocable } = inviteStatus(inv);
              return (
                <tr key={inv.token} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <div className={GROUP_NOWRAP}>
                      <code
                        className={`${TEXT} font-mono`}
                        style={{ letterSpacing: '0.1em', color: 'var(--color-text)' }}
                      >
                        {inv.token}
                      </code>
                      <CopyTokenButton
                        token={inv.token}
                        copied={copiedToken === inv.token}
                        onCopy={onCopy}
                      />
                    </div>
                    {recipientEmailText(inv.recipientEmail)}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div className={GROUP_NOWRAP}>
                      <Badge variant={BADGE_VARIANT[color]} className="rounded-[32px]">
                        {label}
                      </Badge>
                      {revocable && (
                        <RevokeInviteButton
                          token={inv.token}
                          revokingToken={revokingToken}
                          onRevoke={onRevoke}
                        />
                      )}
                    </div>
                  </td>
                  <td style={dateCell}>{formatKstDateTime(inv.createdAt)}</td>
                  <td style={dateCell}>{formatKstDateTime(expDate)}</td>
                  <td style={{ ...dateCell, wordBreak: 'break-all' }}>{usageText(inv)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
