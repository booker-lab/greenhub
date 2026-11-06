'use client';

import { StatusDot } from '@greenhub/ui/components/status-dot';
import type { InviteToken } from '@/hooks/useAdmin';
import {
  ADMIN_SUB,
  ADMIN_TD,
  ADMIN_TH,
  AdminListError,
  AdminListNotice,
  AdminRowMenu,
} from '../../_components/adminList';
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

// ② 방향(design-direction.md §5 어드민 "모든 목록 화면의 규칙", §8 D7): 카드 대신 다른 목록과 같은 표.
// 열: 초대 코드(굵게, 링크 복사, 아래 회색 받는 사람) → 상태(점 + 글자) → 발급 → 만료 → 사용 → ⋮(초대 취소…).
// 링크 복사는 모든 상태에 두는 일상 동작이라 코드 옆 글자 버튼으로, 되돌릴 수 없는 취소는 ⋮에 넣는다.
// 태블릿(1100px 이하)은 발급·만료·사용을 코드 아래 보조 줄로, 휴대폰(640px 이하)은 세 줄 행이다.

/** 행 옆 링크 복사 글자 버튼(검정 밑줄 대신 회색 13px — 주요 동작이 아니다). */
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
    <button
      type="button"
      onClick={() => onCopy(token)}
      aria-label={`토큰 ${token} 초대 링크 복사`}
      className="inline-flex min-h-11 cursor-pointer items-center border-0 bg-transparent px-1 text-[13px] whitespace-nowrap text-foreground underline underline-offset-4"
    >
      {copied ? '복사됨!' : '링크 복사'}
    </button>
  );
}

/** 사용한 초대만 사용 시각(KST)과 가입한 계정 id를 보여 준다. 쓰지 않은 초대는 null. */
function usageText(inv: InviteToken): string | null {
  if (!inv.usedAt) return null;
  const usedAt = formatKstDateTime(inv.usedAt);
  return inv.usedBy ? `${usedAt} · 계정 ${inv.usedBy}` : usedAt;
}

function InviteDate({ value }: { value: Date | string | null | undefined }) {
  return <span className="whitespace-nowrap tabular-nums">{formatKstDateTime(value)}</span>;
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

  if (readState === 'LOADING') return <AdminListNotice>불러오는 중...</AdminListNotice>;
  // 조회 실패는 성공-empty와 구조적으로 구분 — "발급된 토큰이 없습니다."로 collapse 금지.
  if (readState === 'FETCH_ERROR') {
    return (
      <AdminListError title="발급 내역을 불러오지 못했습니다." error={error} onRetry={onRetry} />
    );
  }
  if (readState === 'EMPTY') return <AdminListNotice>발급된 초대 링크가 없습니다.</AdminListNotice>;

  const rows = invites.map((inv) => ({ inv, status: inviteStatus(inv) }));
  const toneOf = (revocable: boolean) => (revocable ? 'default' : 'done');
  const actionsOf = (inv: InviteToken, revocable: boolean) =>
    revokingToken === inv.token ? (
      <span className="text-[13px] whitespace-nowrap text-[var(--color-text-secondary)]">
        취소 중…
      </span>
    ) : (
      <AdminRowMenu
        label={`초대 ${inv.token}`}
        items={
          revocable && revokingToken === null
            ? [{ key: 'revoke', label: '초대 취소…', onSelect: () => onRevoke(inv.token) }]
            : []
        }
      />
    );
  const codeOf = (inv: InviteToken) => (
    <span className="flex flex-wrap items-center gap-x-2">
      <code className="font-mono text-[15px] leading-[22px] font-bold tracking-[0.1em] text-foreground">
        {inv.token}
      </code>
      <CopyTokenButton token={inv.token} copied={copiedToken === inv.token} onCopy={onCopy} />
    </span>
  );

  return (
    <>
      {/* 휴대폰(640px 이하): 세 줄 행 — 1줄 코드·복사, 2줄 받는 사람과 오른쪽 상태, 3줄 발급·만료·사용, 옆에 ⋮ 한 자리. */}
      <ul className="m-0 list-none p-0 min-[641px]:hidden" aria-label="초대 기록">
        {rows.map(({ inv, status }) => {
          const usage = usageText(inv);
          return (
            <li
              key={inv.token}
              className="flex items-center gap-2 border-b border-rule py-1.5 [word-break:keep-all]"
            >
              <div className="min-w-0 flex-1">
                {codeOf(inv)}
                <div className="flex items-start justify-between gap-2">
                  <p className={`${ADMIN_SUB} min-w-0 break-all`}>
                    {inv.recipientEmail
                      ? `받는 사람 ${inv.recipientEmail}`
                      : '받는 사람 지정 안 함'}
                  </p>
                  <StatusDot tone={toneOf(status.revocable)} size={13}>
                    {status.label}
                  </StatusDot>
                </div>
                <p className={ADMIN_SUB}>
                  발급 <InviteDate value={inv.createdAt} /> · 만료{' '}
                  <InviteDate value={status.expDate} />
                </p>
                {usage && <p className={`${ADMIN_SUB} break-all`}>사용 {usage}</p>}
              </div>
              <div className="flex w-11 shrink-0 justify-center">
                {actionsOf(inv, status.revocable)}
              </div>
            </li>
          );
        })}
      </ul>

      {/* 태블릿·데스크톱(641px 이상): 표. 1100px 이하는 발급·만료·사용을 코드 아래 보조 줄로 옮긴다. */}
      <table className="w-full border-collapse max-[640px]:hidden">
        <thead>
          <tr>
            <th className={ADMIN_TH}>초대 코드</th>
            <th className={ADMIN_TH}>상태</th>
            <th className={`${ADMIN_TH} max-[1100px]:hidden`}>발급</th>
            <th className={`${ADMIN_TH} max-[1100px]:hidden`}>만료</th>
            <th className={`${ADMIN_TH} max-[1100px]:hidden`}>사용</th>
            <th className={`${ADMIN_TH} w-[60px]`}>
              <span className="sr-only">동작</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ inv, status }) => {
            const usage = usageText(inv);
            return (
              <tr key={inv.token}>
                <td className={`${ADMIN_TD} py-1.5`}>
                  {codeOf(inv)}
                  {inv.recipientEmail && (
                    <p className={`${ADMIN_SUB} break-all`}>받는 사람 {inv.recipientEmail}</p>
                  )}
                  <p className={`${ADMIN_SUB} min-[1101px]:hidden`}>
                    발급 <InviteDate value={inv.createdAt} /> · 만료{' '}
                    <InviteDate value={status.expDate} />
                  </p>
                  {usage && (
                    <p className={`${ADMIN_SUB} break-all min-[1101px]:hidden`}>사용 {usage}</p>
                  )}
                </td>
                <td className={ADMIN_TD}>
                  <StatusDot tone={toneOf(status.revocable)}>{status.label}</StatusDot>
                </td>
                <td className={`${ADMIN_TD} max-[1100px]:hidden`}>
                  <InviteDate value={inv.createdAt} />
                </td>
                <td className={`${ADMIN_TD} max-[1100px]:hidden`}>
                  <InviteDate value={status.expDate} />
                </td>
                <td className={`${ADMIN_TD} break-all text-[13px] max-[1100px]:hidden`}>
                  {usage ?? <span className="text-[var(--color-text-secondary)]">–</span>}
                </td>
                <td className={`${ADMIN_TD} py-1 text-right align-middle`}>
                  <span className="flex justify-end">{actionsOf(inv, status.revocable)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
