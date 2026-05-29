'use client';

import type { OrderStatus } from '@greenhub/shared';
import { ActionIcon, Box, Button, Group, Switch, Text, Title, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { ChevronDown, RotateCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AdminOrder, AdminOrderSort } from '@/hooks/useAdmin';
import { useAdminOrders, useAdminStores } from '@/hooks/useAdmin';
import { OrderDetailModal } from './_components/OrderDetailModal';
import { OrdersFilters } from './_components/OrdersFilters';
import { OrdersTable } from './_components/OrdersTable';
import { RefundModal } from './_components/RefundModal';

export default function AdminOrdersClient() {
  const [storeFilter, setStoreFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | ''>('');
  const [includeArchivedStores, setIncludeArchivedStores] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [detailOrder, setDetailOrder] = useState<AdminOrder | null>(null);
  const [refundOrder, setRefundOrder] = useState<AdminOrder | null>(null);
  const [sort, setSort] = useState<AdminOrderSort>('createdAt_desc');
  const [pageSize, setPageSize] = useState(50);
  const { stores, loading: storesLoading } = useAdminStores();
  const { orders, loading, loadingMore, hasMore, reload, loadMore, forceRefund } = useAdminOrders({
    storeId: storeFilter || undefined,
    status: statusFilter || undefined,
    sort,
    limit: pageSize,
  });
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    if (includeArchivedStores || !storeFilter) return;
    const selectedStore = stores.find((store) => store.id === storeFilter);
    if (selectedStore?.status === 'archived') setStoreFilter('');
  }, [includeArchivedStores, storeFilter, stores]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      void reload();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, reload]);

  const handleRefundConfirm = async (reason?: string) => {
    if (!refundOrder) return;
    const orderId = refundOrder.id;
    setProcessingId(orderId);
    const ok = await forceRefund(orderId, reason);
    setProcessingId(null);
    if (!ok) {
      notifications.show({
        color: 'red',
        title: '환불 처리 실패',
        message: '주문 환불 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      });
      return;
    }
    setRefundOrder(null);
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
            ({orders.length})
          </Text>
        </Title>
        <Group gap="xs">
          <Switch
            label="자동 새로고침(30초)"
            checked={autoRefresh}
            onChange={(event) => setAutoRefresh(event.currentTarget.checked)}
            size="sm"
          />
          <Tooltip label="새로고침">
            <ActionIcon
              aria-label="주문 목록 새로고침"
              color="gray"
              loading={loading}
              onClick={reload}
              radius="md"
              variant="subtle"
            >
              <RotateCw size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <OrdersFilters
        storeFilter={storeFilter}
        statusFilter={statusFilter}
        sort={sort}
        pageSize={pageSize}
        stores={stores}
        storesLoading={storesLoading}
        includeArchivedStores={includeArchivedStores}
        onStoreChange={setStoreFilter}
        onStatusChange={(value) => setStatusFilter(value as OrderStatus | '')}
        onSortChange={setSort}
        onPageSizeChange={setPageSize}
        onIncludeArchivedStoresChange={setIncludeArchivedStores}
      />

      <OrdersTable
        orders={orders}
        loading={loading}
        processingId={processingId}
        onView={setDetailOrder}
        onRefund={setRefundOrder}
      />

      {!loading && hasMore && (
        <Group justify="center" mt="md">
          <Button
            color="gray"
            leftSection={<ChevronDown size={16} />}
            loading={loadingMore}
            onClick={loadMore}
            radius="md"
            variant="light"
          >
            더 보기
          </Button>
        </Group>
      )}

      <OrderDetailModal order={detailOrder} onClose={() => setDetailOrder(null)} />

      <RefundModal
        order={refundOrder}
        processing={processingId === refundOrder?.id}
        onClose={() => {
          if (processingId) return;
          setRefundOrder(null);
        }}
        onConfirm={handleRefundConfirm}
      />
    </Box>
  );
}
