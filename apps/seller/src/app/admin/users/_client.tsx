'use client';

import { useState } from 'react';
import { notify } from '@/components/AppToaster';
import { normalizeSuspendReason, SuspendReasonField } from '@/components/SuspendReasonMessage';
import type { AdminUser } from '@/hooks/useAdmin';
import { describeAdminCommandOutcome, useAdminUsers } from '@/hooks/useAdmin';
import { AdminConfirmDialog } from '../_components/AdminConfirmDialog';
import { AdminListError, AdminListNotice, AdminPageHeader } from '../_components/adminList';
import { RefreshButton } from '../_components/RefreshButton';
import { UsersTable } from './_components/UsersTable';
import { describeUserSuspendConfirm, suspendActionLabel } from './_lib';

interface PendingUserAction {
  userId: string;
  name: string;
  email: string;
  phone?: string;
  createdAt?: unknown;
  currentlySuspended: boolean;
}

export default function AdminUsersClient() {
  const { users, loading, error, reload, toggleSuspend } = useAdminUsers();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingUserAction | null>(null);
  const [reason, setReason] = useState('');

  const runPending = async () => {
    if (!pending) return;
    const actionLabel = suspendActionLabel(pending.currentlySuspended);
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
      phone: user.phone,
      createdAt: user.createdAt,
      currentlySuspended: !!user.suspended,
    });
  };

  const confirm = pending ? describeUserSuspendConfirm(pending) : null;

  // ② 방향(design-direction.md §5 어드민, §8 D7): 명사 하나의 h1과 지금 기준 한 줄, 다른 목록과 같은 표.
  const ready = !loading && error === null;
  const suspendedCount = users.filter((user) => user.suspended).length;
  const header = (
    <AdminPageHeader
      title="소비자"
      subline={ready ? `가입 ${users.length}명 · 정지 ${suspendedCount}명` : undefined}
      action={<RefreshButton loading={loading} onClick={reload} />}
    />
  );

  if (loading) {
    return (
      <div>
        {header}
        <AdminListNotice>불러오는 중...</AdminListNotice>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div>
        {header}
        <AdminListError title="소비자 목록을 불러오지 못했습니다." error={error} onRetry={reload} />
      </div>
    );
  }

  return (
    <div>
      {header}

      <UsersTable users={users} processingId={processingId} onToggle={handleToggle} />

      <AdminConfirmDialog
        open={pending !== null}
        title={confirm?.title ?? ''}
        lead={confirm?.lead}
        facts={confirm?.facts}
        confirmLabel={confirm?.confirmLabel ?? ''}
        loading={processingId !== null}
        onConfirm={runPending}
        onClose={() => {
          if (processingId === null) setPending(null);
        }}
      >
        <SuspendReasonField reason={reason} onReasonChange={setReason} />
      </AdminConfirmDialog>
    </div>
  );
}
