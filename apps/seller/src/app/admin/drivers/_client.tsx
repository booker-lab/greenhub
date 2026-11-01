'use client';

import { useMemo, useState } from 'react';
import { notify } from '@/components/AppToaster';
import { ConfirmModal } from '@/components/ConfirmModal';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { normalizeSuspendReason, SuspendReasonMessage } from '@/components/SuspendReasonMessage';
import {
  type AdminCommandOutcome,
  describeActiveDeliveryWarning,
  describeAdminCommandOutcome,
  useAdminDrivers,
} from '@/hooks/useAdmin';
import { AdminPageHeader } from '../_components/adminList';
import { useAdminTodoCountsValue } from '../_components/adminTodoContext';
import { LoadMoreFooter } from '../_components/LoadMoreFooter';
import { ActiveDeliveryNotice } from './_components/ActiveDeliveryNotice';
import { DriverList } from './_components/DriverList';
import { PendingDrivers } from './_components/PendingDrivers';
import {
  ACTION_META,
  DRIVER_TABLE_TABS,
  type DriverAction,
  type DriverTableTab,
  describeDriverConfirm,
  filterByTab,
  type PendingAction,
} from './_lib';

export default function DriversClient() {
  const [tab, setTab] = useState<DriverTableTab>('all');
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
  const pendingDrivers = useMemo(() => filterByTab(allDrivers, 'pending'), [allDrivers]);
  const todo = useAdminTodoCountsValue();

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

  const ready = !loading && error === null;
  const activeCount = filterByTab(allDrivers, 'approved').length;
  const suspendedCount = filterByTab(allDrivers, 'suspended').length;
  const tabs = DRIVER_TABLE_TABS.map((t) => ({
    key: t.value,
    label: t.label,
    count: ready ? filterByTab(allDrivers, t.value).length : undefined,
  }));

  return (
    <div>
      {/* ② 방향(design-direction.md §5 어드민 "기사", §8 D7): 명사 하나의 h1과 지금 기준 한 줄.
          회차 배송지 수는 데이터가 없어 활동 중·정지 인원만 쓴다(불러온 기사 기준). */}
      <AdminPageHeader
        title="기사"
        subline={
          ready ? (
            <>
              활동 중 {activeCount}명 · 정지 {suspendedCount}명
              {hasMore ? ' · 불러온 기사 기준' : ''}
            </>
          ) : undefined
        }
      />

      {ready && (
        <PendingDrivers
          drivers={pendingDrivers}
          // 다 받았으면 불러온 수가 정확하다(사이드바 수는 승인 뒤 다시 세지 않는다).
          // 더 받을 기사가 있으면 사이드바와 같은 서버 건수를 쓴다.
          count={
            hasMore
              ? Math.max(todo.drivers?.count ?? 0, pendingDrivers.length)
              : pendingDrivers.length
          }
          more={hasMore && (todo.drivers?.more ?? false)}
          processingId={processingId}
          onApprove={(userId) => handleAction(userId, 'approve')}
        />
      )}

      <div className="mb-2">
        <SegmentedTabs<DriverTableTab>
          tabs={tabs}
          value={tab}
          onChange={setTab}
          layout="scroll"
          variant="underline"
          surface="paper"
          ariaLabel="기사 상태"
        />
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
