'use client';

import type { Order } from '@greenhub/shared';
import { Alert, Badge, Button, Checkbox, Group, Paper, Text } from '@mantine/core';
import { useRouter } from 'next/navigation';
import {
  ACCENT_BORDER,
  type BulkActionMode,
  canBulkPrepareOrder,
  canBulkShipParcelOrder,
  DELIVERY_LABEL,
  formatRelativeTime,
  STATUS_COLOR,
  STATUS_LABEL,
} from '../_constants';

interface OrderCardProps {
  order: Order;
  selected?: boolean;
  bulkActionMode?: BulkActionMode;
  onSelectedChange?: (orderId: string, selected: boolean) => void;
}

export function OrderCard({
  order,
  selected = false,
  bulkActionMode = 'prepare',
  onSelectedChange,
}: OrderCardProps) {
  const router = useRouter();

  const canPrepare = order.status === 'ACCEPTED' || order.status === 'CONFIRMED';
  const canShipParcel = order.status === 'PREPARING' && order.deliveryMethod === 'parcel';
  const selectable =
    !!onSelectedChange &&
    (bulkActionMode === 'shipParcel' ? canBulkShipParcelOrder(order) : canBulkPrepareOrder(order));
  const selectionLabel = bulkActionMode === 'shipParcel' ? '일괄 택배 발송 선택' : '일괄 준비 선택';

  return (
    <Paper
      radius="md"
      shadow="xs"
      p="md"
      style={{ cursor: 'pointer', borderLeft: `4px solid ${ACCENT_BORDER[order.status]}` }}
      onClick={() => router.push(`/orders/${order.id}`)}
    >
      {/* 상단: 상태 뱃지 + 시간 */}
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          {selectable && (
            <Checkbox
              aria-label={`${order.orderNumber ?? order.id} ${selectionLabel}`}
              checked={selected}
              onChange={(event) => onSelectedChange(order.id, event.currentTarget.checked)}
              onClick={(event) => event.stopPropagation()}
            />
          )}
          <Badge color={STATUS_COLOR[order.status]} variant="light" radius="xl">
            {STATUS_LABEL[order.status]}
          </Badge>
        </Group>
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
          {formatRelativeTime(order.createdAt)}
        </Text>
      </Group>

      {/* 주문 정보 */}
      <Text
        style={{
          fontWeight: 'var(--fw-bold)',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text)',
        }}
        mb={2}
      >
        주문 {order.orderNumber ?? `#${order.id.slice(-8).toUpperCase()}`}
      </Text>
      {order.productName && (
        <Text
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
          mb={4}
          lineClamp={1}
        >
          {order.productName}
        </Text>
      )}
      <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }} mb={6}>
        {DELIVERY_LABEL[order.deliveryMethod]}
        {order.requestedDeliveryDate && ` · ${order.requestedDeliveryDate}`}
      </Text>
      <Text
        style={{
          fontSize: 'var(--font-size-xl)',
          fontWeight: 'var(--fw-bold)',
          color: 'var(--color-text)',
        }}
        mb="sm"
      >
        {order.totalAmount.toLocaleString()}원
      </Text>

      {/* 액션 버튼 — 준비 시작은 상세 페이지에서 수행 */}
      {canPrepare && (
        <Group gap="xs" onClick={(e) => e.stopPropagation()}>
          <Button
            onClick={() => router.push(`/orders/${order.id}`)}
            flex={1}
            size="sm"
            radius="md"
            color="brand"
          >
            준비 시작
          </Button>
        </Group>
      )}

      {canShipParcel && (
        <Group gap="xs" onClick={(e) => e.stopPropagation()}>
          <Button
            onClick={() => router.push(`/orders/${order.id}`)}
            flex={1}
            size="sm"
            radius="md"
            color="brand"
          >
            택배 발송 완료
          </Button>
        </Group>
      )}

      {order.status === 'RECRUITING' && (
        <Alert
          color="blue"
          variant="light"
          radius="md"
          mt="xs"
          py="xs"
          onClick={(e) => e.stopPropagation()}
        >
          <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}>
            공동구매 모집 중
          </Text>
          <Text
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            mt={2}
          >
            모집 마감 후 인원 충족 시 자동 확정됩니다.
          </Text>
        </Alert>
      )}

      {order.status === 'HUB_ARRIVED' && order.pickupCode && (
        <Paper
          mt="xs"
          p="sm"
          radius="md"
          style={{ background: 'var(--color-primary-surface)' }}
          ta="center"
          onClick={(e) => e.stopPropagation()}
        >
          <Text
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-primary)',
              fontWeight: 'var(--fw-medium)',
            }}
            mb={4}
          >
            픽업 코드
          </Text>
          <Text
            style={{
              fontSize: 'var(--font-size-2xl)',
              letterSpacing: '0.2em',
              fontFamily: 'monospace',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-primary-dark)',
            }}
          >
            {order.pickupCode}
          </Text>
        </Paper>
      )}
    </Paper>
  );
}
