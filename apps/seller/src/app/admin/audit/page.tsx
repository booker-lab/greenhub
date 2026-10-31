'use client';

import { Badge } from '@greenhub/ui/components/badge';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { apiJson } from '@/lib/api';
import {
  type AdminAuditLog,
  actionLabel,
  describeChanges,
  formatLoggedAt,
  targetLabel,
} from './_lib';

// 어드민이 수수료·정지·환불·지급·배너를 바꾼 기록. 최근 100건만 읽기 전용으로 보여 준다.

// Mantine Text size sm(15px·줄 높이 1.45)·xs(13px·1.4), 여백 0.
const TEXT_SM = 'm-0 p-0 text-sm font-normal';
const TEXT_XS = 'm-0 p-0 text-xs font-normal';

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

  // ① 외형 유지(UI 교체 P2b): Mantine Stack(gap sm)·Title order 3(22px·800·줄 높이 1.4)·Text sm·xs·Paper(lg·xs·md)·Badge light gray.
  return (
    <div className="flex flex-col gap-3">
      <h3 className="m-0 text-[22px] leading-[1.4] font-extrabold">행동 기록</h3>
      <p className={TEXT_SM} style={{ color: 'var(--color-text-secondary)' }}>
        관리자가 바꾼 내용을 최근 100건까지 보여 줘요. 기록은 고칠 수 없어요.
      </p>
      {logs === null ? (
        <LoadingState />
      ) : failed ? (
        <EmptyState text="기록을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요." />
      ) : logs.length === 0 ? (
        <EmptyState text="아직 기록이 없어요" />
      ) : (
        logs.map((log) => (
          <div key={log.id} className="block rounded-[16px] bg-white p-4 shadow-mantine-xs">
            <div className="flex flex-row flex-nowrap items-center justify-between gap-2.5">
              <div className="flex flex-row flex-nowrap items-center justify-start gap-2.5">
                <Badge variant="secondary" className="rounded-[16px]">
                  {actionLabel(log.action)}
                </Badge>
                <p className={`${TEXT_SM} font-semibold`}>{targetLabel(log)}</p>
              </div>
              <p
                className={TEXT_XS}
                style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }}
              >
                {formatLoggedAt(log.createdAt)}
              </p>
            </div>
            {describeChanges(log).map((line) => (
              <p key={line} className={`${TEXT_SM} mt-1`}>
                {line}
              </p>
            ))}
            {log.reason && (
              <p className={`${TEXT_SM} mt-1`} style={{ color: 'var(--color-text-secondary)' }}>
                사유: {log.reason}
              </p>
            )}
            <p className={`${TEXT_XS} mt-1`} style={{ color: 'var(--color-text-disabled)' }}>
              처리: {log.actorId === myId ? '나' : log.actorId.slice(0, 8)}
            </p>
          </div>
        ))
      )}
    </div>
  );
}
