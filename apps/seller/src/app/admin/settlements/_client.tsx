'use client';

import { Box, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
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
      notifications.show({
        color: outcome.kind === 'rejected' ? 'red' : 'yellow',
        title: presentation.title,
        message: presentation.message,
      });
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <Box>
      <Group justify="space-between" mb="md">
        <Title order={4}>
          정산 목록{' '}
          {!loading && error === null && summary && (
            <Text
              component="span"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              ({summary.count})
            </Text>
          )}
        </Title>
      </Group>

      <Box mb="sm">
        <SegmentedTabs<AdminSettlementFilterKey>
          tabs={ADMIN_SETTLEMENT_FILTER_TABS}
          value={statusFilter}
          onChange={setStatusFilter}
          layout="scroll"
        />
      </Box>

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
        <Paper
          radius="lg"
          shadow="xs"
          style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
        >
          <Stack gap="sm" align="center" py={64} px="md">
            <Text style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>
              정산 목록을 불러오지 못했습니다.
            </Text>
            <Text
              ta="center"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              {error}
            </Text>
            <Button onClick={reload} size="sm" variant="outline" radius="md">
              다시 조회
            </Button>
          </Stack>
        </Paper>
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
        onConfirm={runPay}
        onClose={() => {
          if (processingId === null) setPayTarget(null);
        }}
      />
    </Box>
  );
}
