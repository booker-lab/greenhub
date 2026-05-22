'use client';

import { Badge, Box, Button, Group, Paper, Select, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useAdminOrders } from '@/hooks/useAdmin';

const STATUS_LABEL: Record<string, string> = {
  PENDING: '결제대기',
  RECRUITING: '모집중',
  ACCEPTED: '접수됨',
  CONFIRMED: '확정',
  PREPARING: '준비중',
  DELIVERING: '배달중',
  HUB_ARRIVED: '거점도착',
  PICKED_UP: '픽업완료',
  DELIVERED: '배달완료',
  REVIEWED: '리뷰완료',
  CANCELLED: '취소됨',
};

function getStatusColor(status: string): string {
  if (status === 'CANCELLED') return 'red';
  if (status === 'DELIVERED' || status === 'REVIEWED') return 'green';
  return 'yellow';
}

const REFUNDABLE = ['ACCEPTED', 'RECRUITING', 'CONFIRMED', 'PREPARING'];

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

  const statusOptions = [
    { value: '', label: '전체 상태' },
    ...Object.entries(STATUS_LABEL).map(([k, v]) => ({ value: k, label: v })),
  ];

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

      {/* 필터 */}
      <Group gap="sm" mb="md">
        <TextInput
          placeholder="스토어 ID 필터"
          value={storeFilter}
          onChange={(e) => setStoreFilter(e.target.value)}
          style={{ flex: 1 }}
          radius="md"
          size="sm"
        />
        <Select
          value={statusFilter}
          onChange={(v) => setStatusFilter(v ?? '')}
          data={statusOptions}
          radius="md"
          size="sm"
          style={{ minWidth: 140 }}
        />
      </Group>

      {loading ? (
        <Text ta="center" py={80} style={{ color: 'var(--color-text-disabled)' }}>
          불러오는 중...
        </Text>
      ) : (
        <Paper
          radius="lg"
          shadow="xs"
          style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
        >
          {orders.length === 0 ? (
            <Text ta="center" py={64} style={{ color: 'var(--color-text-disabled)' }}>
              주문이 없습니다.
            </Text>
          ) : (
            <Box
              component="table"
              style={{ width: '100%', fontSize: 'var(--font-size-sm)', borderCollapse: 'collapse' }}
            >
              <Box
                component="thead"
                style={{
                  backgroundColor: 'var(--color-surface-muted)',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                <tr>
                  <Box
                    component="th"
                    style={{
                      textAlign: 'left',
                      padding: '12px 16px',
                      fontWeight: 500,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    주문ID
                  </Box>
                  <Box
                    component="th"
                    style={{
                      textAlign: 'left',
                      padding: '12px 16px',
                      fontWeight: 500,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    스토어
                  </Box>
                  <Box
                    component="th"
                    style={{
                      textAlign: 'left',
                      padding: '12px 16px',
                      fontWeight: 500,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    상태
                  </Box>
                  <Box
                    component="th"
                    style={{
                      textAlign: 'right',
                      padding: '12px 16px',
                      fontWeight: 500,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    금액
                  </Box>
                  <Box component="th" style={{ padding: '12px 16px' }} />
                </tr>
              </Box>
              <Box component="tbody">
                {orders.map((order) => (
                  <Box
                    component="tr"
                    key={order.id}
                    style={{ borderTop: '1px solid var(--color-border)' }}
                  >
                    <Box component="td" style={{ padding: '12px 16px' }}>
                      <Text
                        style={{
                          fontSize: 'var(--font-size-sm)',
                          color: 'var(--color-text-disabled)',
                        }}
                        ff="monospace"
                      >
                        {order.id.slice(0, 12)}…
                      </Text>
                    </Box>
                    <Box component="td" style={{ padding: '12px 16px' }}>
                      <Text
                        style={{
                          fontSize: 'var(--font-size-sm)',
                          color: 'var(--color-text-disabled)',
                        }}
                        ff="monospace"
                      >
                        {order.storeId.slice(0, 8)}…
                      </Text>
                    </Box>
                    <Box component="td" style={{ padding: '12px 16px' }}>
                      <Badge color={getStatusColor(order.status)} variant="light" radius="xl">
                        {STATUS_LABEL[order.status] ?? order.status}
                      </Badge>
                    </Box>
                    <Box
                      component="td"
                      style={{
                        padding: '12px 16px',
                        textAlign: 'right',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      ₩{order.totalAmount.toLocaleString()}
                    </Box>
                    <Box component="td" style={{ padding: '12px 16px', textAlign: 'right' }}>
                      {REFUNDABLE.includes(order.status) && (
                        <Button
                          onClick={() => handleRefund(order.id)}
                          disabled={processingId === order.id}
                          size="xs"
                          variant="outline"
                          color="red"
                          radius="md"
                        >
                          {processingId === order.id ? '처리중…' : '강제환불'}
                        </Button>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </Paper>
      )}
    </Box>
  );
}
