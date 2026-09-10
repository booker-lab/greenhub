'use client';

import { Box, Group, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useAdminOrders } from '@/hooks/useAdmin';
import { describeAdminCommandOutcome } from '@/hooks/useAdmin';
import { OrdersFilters } from './_components/OrdersFilters';
import { OrdersTable } from './_components/OrdersTable';

export default function AdminOrdersClient() {
  const [storeFilter, setStoreFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const { orders, loading, error, reload, forceRefund } = useAdminOrders({
    storeId: storeFilter || undefined,
    status: statusFilter || undefined,
  });
  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleRefund = async (orderId: string) => {
    const reason = prompt('환불 사유를 입력하세요 (선택사항)');
    if (reason === null) return;
    setProcessingId(orderId);
    const outcome = await forceRefund(orderId, reason || undefined);
    setProcessingId(null);
    if (outcome.kind === 'confirmed' && outcome.reconciled) return;
    // stale은 완료+재조회 copy를 사용한다. rejected는 서버 reason 보존, unknown은 재확인 우선.
    const presentation = describeAdminCommandOutcome(outcome, '환불');
    notifications.show({
      color: outcome.kind === 'rejected' ? 'red' : outcome.kind === 'unknown' ? 'orange' : 'yellow',
      title: presentation.title,
      message: presentation.message,
    });
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
        error={error}
        processingId={processingId}
        onRefund={handleRefund}
        onRetry={reload}
      />
    </Box>
  );
}
