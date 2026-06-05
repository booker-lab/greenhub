'use client';

import type { OrderStatus } from '@greenhub/shared';
import {
  ActionIcon,
  Alert,
  Box,
  Group,
  Pagination,
  Switch,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { RotateCw } from 'lucide-react';
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
  const [page, setPage] = useState(1);
  const { stores, loading: storesLoading } = useAdminStores();
  const { orders, loading, error, total, currentPage, totalPages, reload, forceRefund } =
    useAdminOrders({
      storeId: storeFilter || undefined,
      status: statusFilter || undefined,
      sort,
      limit: pageSize,
      page,
    });
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    if (includeArchivedStores || !storeFilter) return;
    const selectedStore = stores.find((store) => store.id === storeFilter);
    if (selectedStore?.status === 'archived') {
      setStoreFilter('');
      setPage(1);
    }
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
            ({total}건)
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
        onStoreChange={(value) => {
          setStoreFilter(value);
          setPage(1);
        }}
        onStatusChange={(value) => {
          setStatusFilter(value as OrderStatus | '');
          setPage(1);
        }}
        onSortChange={(value) => {
          setSort(value);
          setPage(1);
        }}
        onPageSizeChange={(value) => {
          setPageSize(value);
          setPage(1);
        }}
        onIncludeArchivedStoresChange={setIncludeArchivedStores}
      />

      {error && (
        <Alert color="red" mb="md" title="주문 목록을 불러오지 못했습니다.">
          잠시 후 다시 시도해 주세요.
        </Alert>
      )}

      <OrdersTable
        orders={orders}
        loading={loading}
        processingId={processingId}
        onView={setDetailOrder}
        onRefund={setRefundOrder}
      />

      {!loading && totalPages > 1 && (
        <Group justify="space-between" mt="md" gap="sm" wrap="wrap">
          <Text size="sm" c="dimmed">
            {currentPage} / {totalPages} 페이지
          </Text>
          <Pagination
            value={page}
            onChange={setPage}
            total={totalPages}
            siblings={1}
            boundaries={1}
            radius="md"
            size="sm"
          />
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
