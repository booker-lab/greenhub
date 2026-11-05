'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api';
import {
  ADMIN_SUB,
  ADMIN_TD,
  ADMIN_TH,
  AdminListNotice,
  AdminPageHeader,
} from '../_components/adminList';
import {
  type AdminAuditLog,
  actionLabel,
  describeChanges,
  formatLoggedAt,
  targetIdLabel,
  targetTypeLabel,
} from './_lib';

// 어드민이 수수료·정지·환불·지급·배너를 바꾼 기록. 최근 100건만 읽기 전용으로 보여 준다.
// ② 방향(design-direction.md §5 어드민 "모든 목록 화면의 규칙", §8 D7): 카드 대신 다른 목록과 같은 표.
// 열: 시각 → 기록(굵게) → 대상(종류 + 전체 식별 값) → 바뀐 내용(한국어 칸 이름·값, 사유) → 처리한 사람.
// 태블릿(1100px 이하)은 처리한 사람을 바뀐 내용 아래 보조 줄로, 휴대폰(640px 이하)은 세 줄 행이다.

function actorLabel(log: AdminAuditLog, myId: string | undefined): string {
  return log.actorId === myId ? '나' : `다른 관리자 · ${log.actorId}`;
}

function Changes({ log }: { log: AdminAuditLog }) {
  const lines = describeChanges(log);
  return (
    <>
      {lines.map((line) => (
        <p key={line} className="m-0 [word-break:keep-all]">
          {line}
        </p>
      ))}
      {log.reason && <p className={`${ADMIN_SUB} break-words`}>사유: {log.reason}</p>}
    </>
  );
}

function Target({ log }: { log: AdminAuditLog }) {
  const id = targetIdLabel(log);
  return (
    <>
      <span className="whitespace-nowrap">{targetTypeLabel(log.targetType)}</span>
      {id && <span className={`${ADMIN_SUB} block break-all`}>{id}</span>}
    </>
  );
}

export default function AdminAuditPage() {
  const { data: session } = useSession();
  const token = session?.user.accessToken;
  const myId = session?.user.id;
  const [logs, setLogs] = useState<AdminAuditLog[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!token) return;
    apiJson<AdminAuditLog[]>('/admin/audit-logs', token).then(
      (items) => {
        setLogs(items);
        setFailed(false);
      },
      () => {
        setLogs([]);
        setFailed(true);
      },
    );
  }, [token]);

  return (
    <div>
      <AdminPageHeader
        title="감사 기록"
        subline="관리자가 바꾼 내용을 최근 100건까지 보여 줘요. 기록은 고칠 수 없어요."
      />
      {logs === null ? (
        <AdminListNotice>불러오는 중...</AdminListNotice>
      ) : failed ? (
        <AdminListNotice>기록을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</AdminListNotice>
      ) : logs.length === 0 ? (
        <AdminListNotice>아직 기록이 없어요</AdminListNotice>
      ) : (
        <>
          {/* 휴대폰(640px 이하): 1줄 기록·시각, 2줄 대상, 3줄 바뀐 내용·사유·처리한 사람. */}
          <ul className="m-0 list-none p-0 min-[641px]:hidden" aria-label="감사 기록">
            {logs.map((log) => (
              <li key={log.id} className="border-b border-rule py-2.5 text-[15px] leading-[22px]">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="m-0 min-w-0 font-bold">{actionLabel(log.action)}</p>
                  <p className={`${ADMIN_SUB} shrink-0 whitespace-nowrap tabular-nums`}>
                    {formatLoggedAt(log.createdAt)}
                  </p>
                </div>
                <div className="text-[13px] leading-[18px] text-[var(--color-text-secondary)]">
                  <Target log={log} />
                </div>
                <Changes log={log} />
                <p className={`${ADMIN_SUB} break-all`}>처리: {actorLabel(log, myId)}</p>
              </li>
            ))}
          </ul>

          {/* 태블릿·데스크톱(641px 이상): 표. 1100px 이하는 처리한 사람을 바뀐 내용 아래 보조 줄로 옮긴다. */}
          <table className="w-full border-collapse max-[640px]:hidden">
            <thead>
              <tr>
                <th className={ADMIN_TH}>시각</th>
                <th className={ADMIN_TH}>기록</th>
                <th className={ADMIN_TH}>대상</th>
                <th className={ADMIN_TH}>바뀐 내용</th>
                <th className={`${ADMIN_TH} max-[1100px]:hidden`}>처리</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className={`${ADMIN_TD} whitespace-nowrap tabular-nums`}>
                    {formatLoggedAt(log.createdAt)}
                  </td>
                  <td className={`${ADMIN_TD} font-bold whitespace-nowrap`}>
                    {actionLabel(log.action)}
                  </td>
                  <td className={`${ADMIN_TD} max-w-[220px]`}>
                    <Target log={log} />
                  </td>
                  <td className={ADMIN_TD}>
                    <Changes log={log} />
                    <p className={`${ADMIN_SUB} break-all min-[1101px]:hidden`}>
                      처리: {actorLabel(log, myId)}
                    </p>
                  </td>
                  <td
                    className={`${ADMIN_TD} max-w-[200px] break-all text-[13px] max-[1100px]:hidden`}
                  >
                    {actorLabel(log, myId)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
