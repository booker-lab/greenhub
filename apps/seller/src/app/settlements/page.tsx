'use client';

import { Container } from '@mantine/core';
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

      <SegmentedTabs<SettlementTab> tabs={TABS} value={activeTab} onChange={setActiveTab} sticky />

      <Container size="sm" px="md" py="md">
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
      </Container>
    </PageShell>
  );
}
