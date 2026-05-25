'use client';

import { Box, Group, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useAdminOrders } from '@/hooks/useAdmin';
import { OrdersFilters } from './_components/OrdersFilters';
import { OrdersTable } from './_components/OrdersTable';

export default function AdminOrdersClient() {
  const [storeFilter, setStoreFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const { orders, loading, forceRefund } = useAdminOrders({
    storeId: storeFilter || undefined,
    status: statusFilter || undefined,
  });
  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleRefund = async (orderId: string) => {
    const reason = prompt('환불 사유를 입력하세요 (선택사항)');
    if (reason === null) return;
    setProcessingId(orderId);
    const ok = await forceRefund(orderId, reason || undefined);
    setProcessingId(null);
    if (!ok) {
      notifications.show({
        color: 'red',
        title: '환불 처리 실패',
        message: '주문 환불 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      });
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
            ({orders.length})
          </Text>
        </Title>
      </Group>

      <OrdersFilters
        storeFilter={storeFilter}
        statusFilter={statusFilter}
        onStoreChange={setStoreFilter}
        onStatusChange={setStatusFilter}
      />

      <OrdersTable
        orders={orders}
        loading={loading}
        processingId={processingId}
        onRefund={handleRefund}
      />
    </Box>
  );
}
