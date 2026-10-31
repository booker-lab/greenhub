'use client';

import { Button } from '@greenhub/ui/components/button';
import { notify } from '@/components/AppToaster';
import { useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import {
  type AdminSettlement,
  describeAdminCommandOutcome,
  useAdminSettlements,
  useAdminStores,
} from '@/hooks/useAdmin';
import { LoadMoreButton } from './_components/LoadMoreButton';
import { SettlementFilters } from './_components/SettlementFilters';
import { SettlementTable } from './_components/SettlementTable';
import { SummaryCards } from './_components/SummaryCards';
import {
  ADMIN_SETTLEMENT_FILTER_TABS,
  type AdminSettlementFilterKey,
  canPay,
  describePayConfirm,
  toStoreOptions,
} from './_lib';

export default function AdminSettlementsClient() {
  const [statusFilter, setStatusFilter] = useState<AdminSettlementFilterKey>('all');
  const [storeFilter, setStoreFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');
  const { stores, loading: storesLoading } = useAdminStores();
  const {
    settlements,
    loading,
    error,
    reload,
    markAsPaid,
    summary,
    summaryLoading,
    summaryError,
    hasMore,
    loadMore,
    loadingMore,
    loadMoreError,
  } = useAdminSettlements({
    storeId: storeFilter || undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
    from: fromFilter || undefined,
    to: toFilter || undefined,
  });
  const [processingId, setProcessingId] = useState<string | null>(null);
  // 확인창이 대상(가게·주문·지급액·계좌)을 보이도록 id가 아닌 정산 문서를 잡아 둔다.
  const [payTarget, setPayTarget] = useState<AdminSettlement | null>(null);

  const openPay = (settlementId: string) =>
    setPayTarget(settlements.find((s) => s.id === settlementId) ?? null);

  const runPay = async () => {
    if (!payTarget) return;
    setProcessingId(payTarget.id);
    try {
      const outcome = await markAsPaid(payTarget.id);
      setPayTarget(null);
      if (outcome.kind === 'confirmed' && outcome.reconciled) return;
      // stale은 완료+재조회 copy를 사용한다. rejected는 서버 reason 보존, unknown은 재확인 우선.
      const presentation = describeAdminCommandOutcome(outcome, '지급');
      notify({
        color: outcome.kind === 'rejected' ? 'red' : 'yellow',
        title: presentation.title,
        message: presentation.message,
      });
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div>
      {/* ① 외형 유지(UI 교체 P2b): Mantine Group(mb md)·Title order 4(18px·800·줄 높이 1.45)·Text·Paper 값. */}
      <div className="mb-4 flex flex-row flex-wrap items-center justify-between gap-4">
        <h4 className="m-0 text-[18px] leading-[1.45] font-extrabold">
          정산 목록{' '}
          {!loading && error === null && summary && (
            <span
              className="m-0 p-0 text-base font-normal"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              ({summary.count})
            </span>
          )}
        </h4>
      </div>

      <div className="mb-3">
        <SegmentedTabs<AdminSettlementFilterKey>
          tabs={ADMIN_SETTLEMENT_FILTER_TABS}
          value={statusFilter}
          onChange={setStatusFilter}
          layout="scroll"
        />
      </div>

      <SettlementFilters
        storeFilter={storeFilter}
        storeOptions={toStoreOptions(stores)}
        storesLoading={storesLoading}
        fromFilter={fromFilter}
        toFilter={toFilter}
        onStoreChange={setStoreFilter}
        onFromChange={setFromFilter}
        onToChange={setToFilter}
      />

      {error !== null && !loading ? (
        <div
          className="block rounded-[16px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.1)]"
          style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
        >
          <div className="flex flex-col items-center gap-3 px-4 py-16">
            <p
              className="m-0 p-0 text-base"
              style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}
            >
              정산 목록을 불러오지 못했습니다.
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
      ) : (
        <>
          <SummaryCards summary={summary} loading={summaryLoading} error={summaryError} />

          <SettlementTable
            settlements={settlements}
            loading={loading}
            processingId={processingId}
            onPay={openPay}
          />
          {hasMore && (
            <LoadMoreButton
              loadedCount={settlements.length}
              loadingMore={loadingMore}
              error={loadMoreError}
              onLoadMore={loadMore}
            />
          )}
        </>
      )}

      <ConfirmModal
        opened={payTarget !== null}
        title="정산 지급 처리"
        message={payTarget ? describePayConfirm(payTarget) : ''}
        confirmLabel="지급 완료"
        confirmColor="brand"
        loading={processingId !== null}
        confirmDisabled={payTarget !== null && !canPay(payTarget)}
        onConfirm={runPay}
        onClose={() => {
          if (processingId === null) setPayTarget(null);
        }}
      />
    </div>
  );
}
