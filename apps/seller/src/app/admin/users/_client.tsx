'use client';

import { Button } from '@greenhub/ui/components/button';
import { notify } from '@/components/AppToaster';
import { useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { normalizeSuspendReason, SuspendReasonMessage } from '@/components/SuspendReasonMessage';
import type { AdminUser } from '@/hooks/useAdmin';
import { describeAdminCommandOutcome, useAdminUsers } from '@/hooks/useAdmin';
import { RefreshButton } from '../_components/RefreshButton';
import { UsersTable } from './_components/UsersTable';
import { describeUserSuspendConfirm } from './_lib';

interface PendingUserAction {
  userId: string;
  name: string;
  email: string;
  currentlySuspended: boolean;
}

export default function AdminUsersClient() {
  const { users, loading, error, reload, toggleSuspend } = useAdminUsers();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingUserAction | null>(null);
  const [reason, setReason] = useState('');

  const runPending = async () => {
    if (!pending) return;
    const actionLabel = describeUserSuspendConfirm(pending).confirmLabel;
    setProcessingId(pending.userId);
    try {
      const outcome = await toggleSuspend(
        pending.userId,
        !pending.currentlySuspended,
        normalizeSuspendReason(reason),
      );
      setPending(null);
      if (outcome.kind === 'confirmed' && outcome.reconciled) return;
      // rejected는 서버 reason 보존, unknown/stale은 재확인 우선 + blind retry 금지.
      const presentation = describeAdminCommandOutcome(outcome, actionLabel);
      notify({
        color: outcome.kind === 'rejected' ? 'red' : 'yellow',
        title: presentation.title,
        message: presentation.message,
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleToggle = (user: AdminUser) => {
    setReason('');
    setPending({
      userId: user.id,
      name: user.name,
      email: user.email,
      currentlySuspended: !!user.suspended,
    });
  };

  const confirm = pending ? describeUserSuspendConfirm(pending) : null;

  // ① 외형 유지(UI 교체 P2b): Mantine Text·Group·Title order 4(18px·800·줄 높이 1.45)·Paper와 같은 값.
  if (loading) {
    return (
      <p
        className="m-0 p-0 py-20 text-center text-base"
        style={{ color: 'var(--color-text-disabled)' }}
      >
        불러오는 중...
      </p>
    );
  }

  if (error !== null && !loading) {
    return (
      <div>
        <div className="mb-4 flex flex-row flex-wrap items-center justify-between gap-4">
          <h4 className="m-0 text-[18px] leading-[1.45] font-extrabold">소비자 계정</h4>
        </div>
        <div
          className="block rounded-[16px] bg-white shadow-mantine-xs"
          style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
        >
          <div className="flex flex-col items-center gap-3 px-4 py-16">
            <p
              className="m-0 p-0 text-base"
              style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}
            >
              소비자 목록을 불러오지 못했습니다.
            </p>
            <p
              className="m-0 p-0 text-center text-base"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              {error}
            </p>
            <Button onClick={reload} variant="outline" className="rounded-[8px]">
              다시 조회
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-row flex-wrap items-center justify-between gap-4">
        <h4 className="m-0 text-[18px] leading-[1.45] font-extrabold">
          소비자 계정{' '}
          <span
            className="m-0 p-0 text-base font-normal"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            ({users.length})
          </span>
        </h4>
        {/* 새로고침 — stores 탭(StoresFilters)과 같은 버튼 형태, hook reload 재사용 */}
        <RefreshButton loading={loading} onClick={reload} />
      </div>

      <UsersTable users={users} processingId={processingId} onToggle={handleToggle} />

      <ConfirmModal
        opened={pending !== null}
        title={confirm?.title ?? ''}
        message={
          <SuspendReasonMessage
            message={confirm?.message ?? ''}
            reason={reason}
            onReasonChange={setReason}
          />
        }
        confirmLabel={confirm?.confirmLabel}
        confirmColor={confirm?.confirmColor}
        loading={processingId !== null}
        onConfirm={runPending}
        onClose={() => {
          if (processingId === null) setPending(null);
        }}
      />
    </div>
  );
}
