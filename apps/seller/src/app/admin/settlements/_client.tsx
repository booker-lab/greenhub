'use client';

import { Button } from '@greenhub/ui/components/button';
import { useState } from 'react';
import { notify } from '@/components/AppToaster';
import { ConfirmModal } from '@/components/ConfirmModal';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import {
  type AdminSettlement,
  describeAdminCommandOutcome,
  useAdminSettlements,
  useAdminStores,
} from '@/hooks/useAdmin';
import { AdminPageHeader } from '../_components/adminList';
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
      {/* ② 방향(design-direction.md §5 어드민 "정산", §8 D7): 명사 하나의 h1과 지금 기준 한 줄. 기록은 돈을 보내지 않는다. */}
      <AdminPageHeader
        title="정산"
        subline={
          <>
            {!loading && error === null && summary && (
              <>
                <span className="tabular-nums">정산 {summary.count}건</span> ·{' '}
              </>
            )}
            지급 완료 기록은 돈을 보내지 않습니다. 은행 앱에서 이체를 마친 뒤 기록하세요.
          </>
        }
      />

      <div className="mb-3">
        <SegmentedTabs<AdminSettlementFilterKey>
          tabs={ADMIN_SETTLEMENT_FILTER_TABS}
          value={statusFilter}
          onChange={setStatusFilter}
          layout="scroll"
          variant="underline"
          surface="paper"
          ariaLabel="정산 상태"
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
        <div className="flex flex-col items-center gap-3 rounded-[8px] border border-rule px-4 py-16">
          <p className="m-0 text-[15px] font-medium text-foreground">
            정산 목록을 불러오지 못했습니다.
          </p>
          <p className="m-0 text-center text-[13px] text-[var(--color-text-secondary)]">{error}</p>
          <Button onClick={reload} variant="outline" className="rounded-[8px]">
            다시 조회
          </Button>
        </div>
      ) : (
        <>
          <SummaryCards
            summary={summary}
            loading={summaryLoading}
            error={summaryError}
            loadedRows={settlements}
          />

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
