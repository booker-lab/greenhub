'use client';

import { Badge } from '@greenhub/ui/components/badge';
import { Button } from '@greenhub/ui/components/button';
import type { AdminUser } from '@/hooks/useAdmin';
import { formatJoinedDate, formatPhone, suspendActionLabel } from '../_lib';

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

// ① 외형 유지(UI 교체 P2b): Mantine Text(p, 16px·줄 높이 1.55·여백 0)·Paper·Group·Stack·Badge·Button과 같은 값.
// 카드·표 전환은 Mantine hiddenFrom·visibleFrom="sm"(48em)과 같은 경계다.
const TEXT = 'm-0 p-0 text-base font-normal';
const PAPER = 'block rounded-[16px] bg-white shadow-mantine-xs';

// 테이블·카드 공용. 함수로 불러 렌더 트리에 바로 넣는다(UsersTable.test가 트리 글자를 읽는다).
function renderStatusBadge(user: AdminUser) {
  return (
    <Badge variant={user.suspended ? 'destructive' : 'light'} className="rounded-[32px]">
      {user.suspended ? '정지됨' : '정상'}
    </Badge>
  );
}

function renderToggleButton(
  user: AdminUser,
  processingId: string | null,
  onToggle: (user: AdminUser) => void,
) {
  return (
    <Button
      onClick={() => onToggle(user)}
      disabled={processingId === user.id}
      size="xs"
      variant={user.suspended ? 'outline' : 'outline-destructive'}
      className="rounded-[8px]"
    >
      {processingId === user.id ? '처리중…' : suspendActionLabel(!!user.suspended)}
    </Button>
  );
}

export function UsersTable({ users, processingId, onToggle }: UsersTableProps) {
  if (users.length === 0) {
    return (
      <div
        className={PAPER}
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
      >
        <p className={`${TEXT} py-16 text-center`} style={{ color: 'var(--color-text-disabled)' }}>
          등록된 소비자가 없습니다.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* 모바일(<sm): 카드 리스트 — 상태·정지/정지 해제 버튼 잘림 방지 */}
      <div className="flex flex-col gap-3 min-[48em]:hidden!">
        {users.map((user) => (
          <div
            key={user.id}
            className="block rounded-[8px] bg-white px-4 py-3 shadow-mantine-xs"
            style={{ border: '1px solid var(--color-border)' }}
          >
            <div className="mb-2.5 flex flex-row flex-wrap items-start justify-between gap-4">
              <div style={{ minWidth: 0, flex: 1 }}>
                <p className={TEXT} style={{ fontWeight: 'var(--fw-medium)' }}>
                  {user.name}
                </p>
                <p
                  className={TEXT}
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-secondary)',
                    wordBreak: 'break-all',
                  }}
                >
                  {user.email}
                </p>
                <p
                  className={TEXT}
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
                >
                  전화 {formatPhone(user.phone)}
                </p>
                <p
                  className={TEXT}
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                >
                  가입일 {formatJoinedDate(user.createdAt)}
                </p>
              </div>
              {renderStatusBadge(user)}
            </div>
            <div className="mt-2.5 flex flex-row flex-wrap items-center justify-end gap-4">
              {renderToggleButton(user, processingId, onToggle)}
            </div>
          </div>
        ))}
      </div>

      {/* 데스크톱(≥sm): 기존 4칸 테이블 유지. 앱 셸이 480px라 칸을 늘리면 상태·정지 버튼이
          잘리므로 전화·가입일은 이메일 칸 아래 보조 줄로 둔다. */}
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
              <th style={thBase}>이름</th>
              <th style={thBase}>이메일</th>
              <th style={thBase}>상태</th>
              <th style={{ padding: '12px 16px' }} />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td style={{ padding: '12px 16px' }}>
                  <p className={TEXT} style={{ fontWeight: 'var(--fw-medium)' }}>
                    {user.name}
                  </p>
                  <p
                    className={`${TEXT} font-mono`}
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-disabled)',
                    }}
                  >
                    {user.id.slice(0, 8)}…
                  </p>
                </td>
                <td style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}>
                  <p
                    className={TEXT}
                    style={{ fontSize: 'var(--font-size-sm)', wordBreak: 'break-all' }}
                  >
                    {user.email}
                  </p>
                  <p
                    className={TEXT}
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    전화 {formatPhone(user.phone)}
                  </p>
                  <p
                    className={TEXT}
                    style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                  >
                    가입일 {formatJoinedDate(user.createdAt)}
                  </p>
                </td>
                <td style={{ padding: '12px 16px' }}>{renderStatusBadge(user)}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  {renderToggleButton(user, processingId, onToggle)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
