'use client';

import { StatusDot } from '@greenhub/ui/components/status-dot';
import type { AdminUser } from '@/hooks/useAdmin';
import {
  ADMIN_SUB,
  ADMIN_TD,
  ADMIN_TH,
  AdminListNotice,
  AdminMissing,
  AdminRowMenu,
  formatAdminDate,
} from '../../_components/adminList';
import { suspendActionLabel } from '../_lib';

interface UsersTableProps {
  users: AdminUser[];
  processingId: string | null;
  onToggle: (user: AdminUser) => void;
}

// ② 방향(design-direction.md §5 어드민 "모든 목록 화면의 규칙", §8 D7): 카드 목록 대신 다른 목록과 같은 표.
// 열: 이름(굵게, 아래 회색 이메일) → 연락처 → 상태(점 + 글자, 정지는 빨강) → 가입일 → ⋮(정지… / 정지 풀기…).
// 잘린 계정 id는 보여 주지 않는다. 태블릿(1100px 이하)은 가입일을 이름 아래 보조 줄로, 휴대폰은 세 줄 행이다.

function userName(user: AdminUser): string {
  // 타입은 string이지만 옛 문서에 필드가 없을 수 있어 ?.로 방어한다.
  return user.name?.trim() || '이름 없음';
}

function UserPhone({ phone }: { phone?: string }) {
  const value = phone?.trim();
  if (!value) return <span className="text-[var(--color-text-secondary)]">연락처 미등록</span>;
  return <span className="whitespace-nowrap tabular-nums">{value}</span>;
}

function UserStatus({ user, size }: { user: AdminUser; size: 13 | 15 }) {
  return user.suspended ? (
    <StatusDot tone="problem" size={size}>
      정지
    </StatusDot>
  ) : (
    <StatusDot size={size}>정상</StatusDot>
  );
}

function UserJoined({ user }: { user: AdminUser }) {
  const date = formatAdminDate(user.createdAt);
  return date ? <span className="whitespace-nowrap tabular-nums">{date}</span> : <AdminMissing />;
}

export function UsersTable({ users, processingId, onToggle }: UsersTableProps) {
  if (users.length === 0) return <AdminListNotice>등록된 소비자가 없습니다.</AdminListNotice>;

  const actionsOf = (user: AdminUser) =>
    processingId === user.id ? (
      <span className="text-[13px] whitespace-nowrap text-[var(--color-text-secondary)]">
        처리 중…
      </span>
    ) : (
      <AdminRowMenu
        label={`소비자 ${userName(user)}`}
        items={[
          {
            key: 'suspend',
            label: user.suspended ? '정지 풀기…' : `${suspendActionLabel(false)}…`,
            onSelect: () => onToggle(user),
          },
        ]}
      />
    );

  return (
    <>
      {/* 휴대폰(640px 이하): 세 줄 행 — 1줄 이름, 2줄 연락처와 오른쪽 상태, 3줄 이메일·가입일, 옆에 ⋮ 한 자리. */}
      <ul className="m-0 list-none p-0 min-[641px]:hidden" aria-label="소비자 목록">
        {users.map((user) => (
          <li
            key={user.id}
            className="flex items-center gap-2 border-b border-rule py-2.5 [word-break:keep-all]"
          >
            <div className="min-w-0 flex-1">
              <p className="m-0 text-[15px] leading-[22px] font-bold">{userName(user)}</p>
              <div className="flex items-start justify-between gap-2">
                <p className={`${ADMIN_SUB} min-w-0`}>
                  <UserPhone phone={user.phone} />
                </p>
                <UserStatus user={user} size={13} />
              </div>
              <p className={`${ADMIN_SUB} break-all`}>
                {user.email} · 가입 <UserJoined user={user} />
              </p>
            </div>
            <div className="flex w-11 shrink-0 justify-center">{actionsOf(user)}</div>
          </li>
        ))}
      </ul>

      {/* 태블릿·데스크톱(641px 이상): 표. 1100px 이하는 가입일을 이름 아래 보조 줄로 옮긴다. */}
      <table className="w-full border-collapse max-[640px]:hidden">
        <thead>
          <tr>
            <th className={ADMIN_TH}>이름</th>
            <th className={ADMIN_TH}>연락처</th>
            <th className={ADMIN_TH}>상태</th>
            <th className={`${ADMIN_TH} max-[1100px]:hidden`}>가입일</th>
            <th className={`${ADMIN_TH} w-[60px]`}>
              <span className="sr-only">동작</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td className={`${ADMIN_TD} w-[40%] [word-break:keep-all]`}>
                <p className="m-0 font-bold">{userName(user)}</p>
                <p className={`${ADMIN_SUB} break-all`}>{user.email}</p>
                <p className={`${ADMIN_SUB} min-[1101px]:hidden`}>
                  가입 <UserJoined user={user} />
                </p>
              </td>
              <td className={ADMIN_TD}>
                <UserPhone phone={user.phone} />
              </td>
              <td className={ADMIN_TD}>
                <UserStatus user={user} size={15} />
              </td>
              <td className={`${ADMIN_TD} max-[1100px]:hidden`}>
                <UserJoined user={user} />
              </td>
              <td className={`${ADMIN_TD} py-1 text-right align-middle`}>
                <span className="flex justify-end">{actionsOf(user)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
