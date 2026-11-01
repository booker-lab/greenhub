'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { DailySummaryTab } from './_components/DailySummaryTab';
import { OrdersTab } from './_components/OrdersTab';
import { PeriodTab } from './_components/PeriodTab';
import type { SettlementTab } from './_constants';
import { TABS } from './_constants';
import { useSettlements } from './_hooks/useSettlements';

export default function SettlementsPage() {
  const [activeTab, setActiveTab] = useState<SettlementTab>('daily');
  const {
    selectedDate,
    setSelectedDate,
    selectedDateLabel,
    today,
    from,
    setFrom,
    to,
    setTo,
    summary,
    summaryLoading,
    summaryError,
    settlements,
    listLoading,
    listError,
    hasMore,
    loadingMore,
    loadMoreError,
    fetchSettlements,
    loadMoreSettlements,
  } = useSettlements(activeTab);

  return (
    <PageShell>
      <PageHeader title="정산 관리" />

      <SegmentedTabs<SettlementTab>
        tabs={TABS}
        value={activeTab}
        onChange={setActiveTab}
        sticky
        variant="underline"
      />

      {/* ① 외형 유지(UI 교체 P4): Mantine Container size sm(최대 720px·좌우 md)·py md와 같은 값. */}
      <div className="mx-auto max-w-[720px] px-4 py-4">
        {activeTab === 'daily' && (
          <DailySummaryTab
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            selectedDateLabel={selectedDateLabel}
            today={today}
            summary={summary}
            summaryLoading={summaryLoading}
            summaryError={summaryError}
          />
        )}
        {activeTab === 'period' && (
          <PeriodTab
            from={from}
            setFrom={setFrom}
            to={to}
            setTo={setTo}
            settlements={settlements}
            listLoading={listLoading}
            listError={listError}
            hasMore={hasMore}
            loadingMore={loadingMore}
            loadMoreError={loadMoreError}
            onSearch={(f, t) => fetchSettlements(f, t)}
            onLoadMore={loadMoreSettlements}
          />
        )}
        {activeTab === 'orders' && (
          <OrdersTab
            settlements={settlements}
            listLoading={listLoading}
            fetchSettlements={fetchSettlements}
            hasMore={hasMore}
            loadingMore={loadingMore}
            loadMoreError={loadMoreError}
            onLoadMore={loadMoreSettlements}
          />
        )}
      </div>
    </PageShell>
  );
}
