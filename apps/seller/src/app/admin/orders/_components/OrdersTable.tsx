'use client';

import { Badge, Box, Button, Group, Paper, Stack, Text } from '@mantine/core';
import type { AdminOrder } from '@/hooks/useAdmin';
import { getAdminOrdersReadState, getStatusColor, REFUNDABLE, STATUS_LABEL } from '../_lib';

interface OrdersTableProps {
  orders: AdminOrder[];
  loading: boolean;
  /** useAdminOrders 조회 실패 메시지. null이면 마지막 조회가 실패하지 않았음. */
  error: string | null;
  processingId: string | null;
  onRefund: (orderId: string) => void;
  /** 조회 실패 시 재시도 — hook의 reload()에 연결된다. */
  onRetry: () => void;
}

const thBase = {
  padding: '12px 16px',
  fontWeight: 500,
  color: 'var(--color-text-secondary)',
};

export function OrdersTable({ orders, loading, error, processingId, onRefund, onRetry }: OrdersTableProps) {
  const readState = getAdminOrdersReadState({ loading, error, orders });

  if (readState === 'LOADING') {
    return (
      <Text ta="center" py={80} style={{ color: 'var(--color-text-disabled)' }}>
        불러오는 중...
      </Text>
    );
  }

  // 조회 실패는 성공-empty와 구조적으로 구분 — "주문이 없습니다."로 collapse 금지.
  if (readState === 'FETCH_ERROR') {
    return (
      <Paper
        radius="lg"
        shadow="xs"
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
      >
        <Stack gap="sm" align="center" py={64} px="md">
          <Text style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>
            주문 목록을 불러오지 못했습니다.
          </Text>
          <Text
            ta="center"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            {error}
          </Text>
          <Button onClick={onRetry} size="sm" variant="outline" radius="md">
            다시 조회
          </Button>
        </Stack>
      </Paper>
    );
  }

  if (readState === 'EMPTY') {
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
