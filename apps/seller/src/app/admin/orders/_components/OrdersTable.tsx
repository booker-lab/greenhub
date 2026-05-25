'use client';

import { Badge, Box, Button, Group, Paper, Stack, Text } from '@mantine/core';
import type { AdminOrder } from '@/hooks/useAdmin';
import { getStatusColor, REFUNDABLE, STATUS_LABEL } from '../_lib';

interface OrdersTableProps {
  orders: AdminOrder[];
  loading: boolean;
  processingId: string | null;
  onRefund: (orderId: string) => void;
}

const thBase = {
  padding: '12px 16px',
  fontWeight: 500,
  color: 'var(--color-text-secondary)',
};

export function OrdersTable({ orders, loading, processingId, onRefund }: OrdersTableProps) {
  if (loading) {
    return (
      <Text ta="center" py={80} style={{ color: 'var(--color-text-disabled)' }}>
        불러오는 중...
      </Text>
    );
  }

  if (orders.length === 0) {
    return (
      <Paper
        radius="lg"
        shadow="xs"
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
      >
        <Text ta="center" py={64} style={{ color: 'var(--color-text-disabled)' }}>
          주문이 없습니다.
        </Text>
      </Paper>
    );
  }

  return (
    <>
      {/* 모바일(<sm): 카드 리스트 — 마지막 컬럼(금액·강제환불) 잘림 방지 */}
      <Stack gap="sm" hiddenFrom="sm">
        {orders.map((order) => (
          <Paper
            key={order.id}
            radius="md"
            px="md"
            py="sm"
            shadow="xs"
            style={{ border: '1px solid var(--color-border)' }}
          >
            <Group justify="space-between" mb="xs">
              <Text
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-text-disabled)',
                }}
                ff="monospace"
              >
                {order.orderNumber ?? `${order.id.slice(0, 12)}…`}
              </Text>
              <Badge color={getStatusColor(order.status)} variant="light" radius="xl">
                {STATUS_LABEL[order.status] ?? order.status}
              </Badge>
            </Group>
            <Text
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-text-disabled)',
              }}
              ff="monospace"
              mb={4}
            >
              스토어 {order.storeId.slice(0, 8)}…
            </Text>
            <Group justify="space-between" align="center" mt="xs">
              <Text style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                ₩{order.totalAmount.toLocaleString()}
              </Text>
              {REFUNDABLE.includes(order.status) && (
                <Button
                  onClick={() => onRefund(order.id)}
                  disabled={processingId === order.id}
                  size="xs"
                  variant="outline"
                  color="red"
                  radius="md"
                >
                  {processingId === order.id ? '처리중…' : '강제환불'}
                </Button>
              )}
            </Group>
          </Paper>
        ))}
      </Stack>

      {/* 데스크톱(≥sm): 기존 테이블 유지(시각 회귀 0) */}
      <Paper
        radius="lg"
        shadow="xs"
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
        visibleFrom="sm"
      >
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
              <Box component="th" style={{ ...thBase, textAlign: 'left' }}>
                주문ID
              </Box>
              <Box component="th" style={{ ...thBase, textAlign: 'left' }}>
                스토어
              </Box>
              <Box component="th" style={{ ...thBase, textAlign: 'left' }}>
                상태
              </Box>
              <Box component="th" style={{ ...thBase, textAlign: 'right' }}>
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
                    {order.orderNumber ?? `${order.id.slice(0, 12)}…`}
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
                      onClick={() => onRefund(order.id)}
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
      </Paper>
    </>
  );
}
