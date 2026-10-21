'use client';

import { Box, Group, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useRef, useState } from 'react';
import {
  type AdminOrder,
  describeAdminCommandOutcome,
  useAdminOrders,
  useAdminStores,
} from '@/hooks/useAdmin';
import { LoadMoreFooter } from '../_components/LoadMoreFooter';
import { OrdersFilters } from './_components/OrdersFilters';
import { OrdersTable } from './_components/OrdersTable';
import { RefundConfirmModal } from './_components/RefundConfirmModal';
import { buildStoreOptions, describeRefundTarget, normalizeRefundReason } from './_lib';

export default function AdminOrdersClient() {
  const [storeFilter, setStoreFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  // 가게는 판매자 목록에서 이름으로 고른다(겹친 응답은 훅이 최신만 반영).
  const { stores } = useAdminStores();
  const { orders, hasMore, loading, loadingMore, error, moreError, reload, loadMore, forceRefund } =
    useAdminOrders({
      storeId: storeFilter || undefined,
      status: statusFilter || undefined,
    });
  const [refundTarget, setRefundTarget] = useState<AdminOrder | null>(null);
  const [refundReason, setRefundReason] = useState('');
  // 여러 건을 이어서 환불해도 각 주문의 처리 중 표시가 따로 유지되도록 id 묶음으로 잠근다.
  // ref는 같은 틱의 두 번 클릭을 막고, state는 버튼 표시를 다시 그린다.
  const inFlightRef = useRef(new Set<string>());
  const [processingIds, setProcessingIds] = useState<ReadonlySet<string>>(() => new Set());

  const openRefund = (order: AdminOrder) => {
    setRefundReason('');
    setRefundTarget(order);
  };

  const runRefund = async () => {
    const target = refundTarget;
    if (!target || inFlightRef.current.has(target.id)) return;
    inFlightRef.current.add(target.id);
    setProcessingIds(new Set(inFlightRef.current));
    setRefundTarget(null);
    try {
      const outcome = await forceRefund(target.id, normalizeRefundReason(refundReason));
      if (outcome.kind === 'confirmed' && outcome.reconciled) return;
      // stale은 완료+재조회 copy를 사용한다. rejected는 서버 reason 보존, unknown은 재확인 우선.
      const presentation = describeAdminCommandOutcome(outcome, '환불');
      notifications.show({
        color: outcome.kind === 'rejected' ? 'red' : 'yellow',
        title: presentation.title,
        message: `주문 ${describeRefundTarget(target).orderLabel} — ${presentation.message}`,
      });
    } finally {
      inFlightRef.current.delete(target.id);
      setProcessingIds(new Set(inFlightRef.current));
    }
  };

  return (
    <Box>
      <Group justify="space-between" mb="md">
        <Title order={4}>
          전체 주문{' '}
          <Text
            component="span"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            ({orders.length}
            {hasMore ? '+' : ''})
          </Text>
        </Title>
      </Group>

      <OrdersFilters
        storeFilter={storeFilter}
        statusFilter={statusFilter}
        storeOptions={buildStoreOptions(stores)}
        onStoreChange={setStoreFilter}
        onStatusChange={setStatusFilter}
      />

      <OrdersTable
        orders={orders}
        loading={loading}
        error={error}
        processingIds={processingIds}
        onRefund={openRefund}
        onRetry={reload}
      />

      {error === null && !loading && (
        <LoadMoreFooter
          hasMore={hasMore}
          loadingMore={loadingMore}
          moreError={moreError}
          onLoadMore={loadMore}
        />
      )}

      <RefundConfirmModal
        target={refundTarget}
        reason={refundReason}
        onReasonChange={setRefundReason}
        onConfirm={runRefund}
        onClose={() => setRefundTarget(null)}
      />
    </Box>
  );
}
