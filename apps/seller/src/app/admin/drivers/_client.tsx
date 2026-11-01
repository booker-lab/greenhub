'use client';

import { useMemo, useState } from 'react';
import { notify } from '@/components/AppToaster';
import { ConfirmModal } from '@/components/ConfirmModal';
import { normalizeSuspendReason, SuspendReasonMessage } from '@/components/SuspendReasonMessage';
import {
  type AdminCommandOutcome,
  type DriverStatus,
  describeActiveDeliveryWarning,
  describeAdminCommandOutcome,
  useAdminDrivers,
} from '@/hooks/useAdmin';
import { LoadMoreFooter } from '../_components/LoadMoreFooter';
import { ActiveDeliveryNotice } from './_components/ActiveDeliveryNotice';
import { DriverList } from './_components/DriverList';
import {
  ACTION_META,
  type DriverAction,
  describeDriverConfirm,
  filterByTab,
  type PendingAction,
  STATUS_TABS,
} from './_lib';

export default function DriversClient() {
  const [tab, setTab] = useState<DriverStatus>('pending');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState('');
  // 정지 뒤 배송 중 배정 주문 안내(정지는 막지 않는다). null이면 안내창이 닫혀 있다.
  const [deliveryWarning, setDeliveryWarning] = useState<string | null>(null);
  const {
    drivers: allDrivers,
    hasMore,
    loading,
    loadingMore,
    error,
    moreError,
    reload,
    loadMore,
    approve,
    toggleSuspend,
  } = useAdminDrivers();

  const drivers = useMemo(() => filterByTab(allDrivers, tab), [allDrivers, tab]);

  const runPending = async () => {
    if (!pending) return;
    const actionLabel =
      pending.action === 'approve' ? '승인' : pending.action === 'suspend' ? '정지' : '정지 해제';
    setProcessingId(pending.userId);
    try {
      let outcome: AdminCommandOutcome;
      if (pending.action === 'approve') {
        outcome = await approve(pending.userId);
      } else {
        const result = await toggleSuspend(
          pending.userId,
          pending.action === 'suspend',
          normalizeSuspendReason(reason),
        );
        outcome = result;
        if (result.kind === 'confirmed' && pending.action === 'suspend') {
          setDeliveryWarning(describeActiveDeliveryWarning(result.activeDeliveryCount));
        }
      }
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

  const handleAction = (userId: string, action: DriverAction) => {
    setReason('');
    const driver = allDrivers.find((d) => d.id === userId);
    setPending({ userId, name: driver?.name ?? '', email: driver?.email ?? null, action });
  };

  const pendingMeta = pending ? ACTION_META[pending.action] : null;

  return (
    <div>
      {/* ① 외형 유지(UI 교체 P2b): Mantine Title order 4(18px·800·줄 높이 1.45)·UnstyledButton 값. */}
      <h4 className="m-0 mb-4 text-[18px] leading-[1.45] font-extrabold">드라이버 관리</h4>

      {/* 탭 */}
      <div className="mb-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex flex-row flex-wrap items-center justify-start gap-1">
          {STATUS_TABS.map((t) => (
            <button
              type="button"
              key={t.value}
              onClick={() => setTab(t.value)}
              className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-start text-base text-inherit no-underline [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]"
              style={{
                padding: '8px 16px',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 500,
                borderBottom: `2px solid ${tab === t.value ? 'var(--color-primary)' : 'transparent'}`,
                marginBottom: -1,
                color: tab === t.value ? 'var(--color-primary-dark)' : 'var(--color-text-disabled)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <DriverList
        drivers={drivers}
        loading={loading}
        error={error}
        processingId={processingId}
        onAction={handleAction}
        onRetry={reload}
      />

      {/* 탭은 받은 기사 안에서 거르므로, 서버에 더 있으면 탭과 상관없이 더 보기로 이어 받는다. */}
      {error === null && !loading && (
        <LoadMoreFooter
          hasMore={hasMore}
          loadingMore={loadingMore}
          moreError={moreError}
          onLoadMore={loadMore}
        />
      )}

      <ConfirmModal
        opened={pending !== null}
        title={pendingMeta?.title ?? ''}
        message={
          !pending ? (
            ''
          ) : pending.action === 'approve' ? (
            describeDriverConfirm(pending)
          ) : (
            <SuspendReasonMessage
              message={describeDriverConfirm(pending)}
              reason={reason}
              onReasonChange={setReason}
            />
          )
        }
        confirmLabel={pendingMeta?.confirmLabel}
        confirmColor={pendingMeta?.confirmColor}
        loading={processingId !== null}
        onConfirm={runPending}
        onClose={() => {
          if (processingId === null) setPending(null);
        }}
      />

      <ActiveDeliveryNotice message={deliveryWarning} onClose={() => setDeliveryWarning(null)} />
    </div>
  );
}
