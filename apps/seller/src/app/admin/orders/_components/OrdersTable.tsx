'use client';

import { ActionIcon, Badge, Box, Button, Group, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { Eye } from 'lucide-react';
import type { AdminOrder } from '@/hooks/useAdmin';
import { getStatusColor, REFUNDABLE, STATUS_LABEL } from '../_lib';

interface OrdersTableProps {
  orders: AdminOrder[];
  loading: boolean;
  processingId: string | null;
  onView: (order: AdminOrder) => void;
  onRefund: (order: AdminOrder) => void;
}

const thBase = {
  padding: '12px 16px',
  fontWeight: 500,
  color: 'var(--color-text-secondary)',
};

function hasTracking(order: AdminOrder) {
  return Boolean(order.courierCompany?.trim() && order.trackingNumber?.trim());
}

function TrackingInfo({ order }: { order: AdminOrder }) {
  if (!hasTracking(order)) {
    return (
      <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
        -
      </Text>
    );
  }

  return (
    <Stack gap={2}>
      <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
        {order.courierCompany}
      </Text>
      <Text
        ff="monospace"
        style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-disabled)' }}
      >
        {order.trackingNumber}
      </Text>
    </Stack>
  );
}

export function OrdersTable({ orders, loading, processingId, onView, onRefund }: OrdersTableProps) {
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
            <Group justify="space-between" align="flex-start" mt="xs" gap="md">
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                송장
              </Text>
              <Box style={{ textAlign: 'right', minWidth: 0 }}>
                <TrackingInfo order={order} />
              </Box>
            </Group>
            <Group justify="space-between" align="center" mt="xs">
              <Text style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                ₩{order.totalAmount.toLocaleString()}
              </Text>
              <Group gap="xs">
                <Button
                  onClick={() => onView(order)}
                  size="xs"
                  variant="light"
                  color="gray"
                  radius="md"
                >
                  상세
                </Button>
                {REFUNDABLE.includes(order.status) && (
                  <Button
                    onClick={() => onRefund(order)}
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
              <Box component="th" style={{ ...thBase, textAlign: 'left' }}>
                송장
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
                <Box component="td" style={{ padding: '12px 16px' }}>
                  <TrackingInfo order={order} />
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
                  <Group gap="xs" justify="flex-end">
                    <Tooltip label="상세 보기">
                      <ActionIcon
                        aria-label={`${order.orderNumber ?? order.id} 상세 보기`}
                        onClick={() => onView(order)}
                        variant="subtle"
                        color="gray"
                        radius="md"
                        size="sm"
                      >
                        <Eye size={16} />
                      </ActionIcon>
                    </Tooltip>
                    {REFUNDABLE.includes(order.status) && (
                      <Button
                        onClick={() => onRefund(order)}
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
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Paper>
    </>
  );
}
