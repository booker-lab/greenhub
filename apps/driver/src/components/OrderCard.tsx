import type { Order } from '@greenhub/shared';
import { Badge, Card, Group, Stack, Text } from '@mantine/core';
import Link from 'next/link';
import { getRedeliveryPaymentPresentation } from '@/app/board/_lib/redelivery-payment';

const METHOD_BADGE: Record<string, { label: string; color: string }> = {
  direct: { label: '직배송', color: 'green' },
  hub: { label: '거점 픽업', color: 'blue' },
  parcel: { label: '택배', color: 'gray' },
};

function formatTime(value?: string | null) {
  if (!value) return '시간 미정';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '시간 미정';
  return date.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function OrderCard({ order, tab }: { order: Order; tab: string }) {
  const badge = METHOD_BADGE[order.deliveryMethod] ?? METHOD_BADGE.direct;
  const payment = getRedeliveryPaymentPresentation(order.redeliveryPayment);
  const displayAddress =
    order.deliveryMethod === 'hub' ? (order.hubAddress ?? '-') : (order.address ?? '-');
  const displayLocation =
    order.deliveryMethod === 'hub'
      ? `${order.hubName ?? '거점'} · ${displayAddress}`
      : displayAddress;

  return (
    <Card
      component={Link}
      href={`/board/${order.id}`}
      radius="xl"
      withBorder
      p="md"
      data-testid={`driver-order-${order.id}`}
      style={{ textDecoration: 'none' }}
    >
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Group gap="xs">
            <Badge color={badge.color} variant="light" size="md">
              {badge.label}
            </Badge>
            {order.status === 'DELIVERY_HELD' && (
              <Badge color="red" variant="light" size="md">
                배송 보류
              </Badge>
            )}
            {payment && (
              <Badge color={payment.color} variant="light" size="md">
                {payment.label}
              </Badge>
            )}
          </Group>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            {tab === 'preparing'
              ? `수거 ${formatTime(order.preparedAt)}`
              : `배송 시작 ${formatTime(order.updatedAt)}`}
          </Text>
        </Group>
        <Text style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-sm)' }}>
          {order.buyerName ?? '소비자'}
        </Text>
        <Text
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          truncate="end"
        >
          {displayLocation}
        </Text>
        {order.productName && (
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            {order.productName}
            {order.quantity && order.quantity > 1 ? ` 외 ${order.quantity - 1}건` : ''}
          </Text>
        )}
        {payment && (
          <Text
            style={{
              fontSize: 'var(--font-size-sm)',
              color:
                payment.color === 'green'
                  ? 'var(--color-primary)'
                  : payment.color === 'red'
                    ? 'var(--color-danger)'
                    : '#d97706',
              fontWeight: 'var(--fw-medium)',
            }}
          >
            {payment.description}
          </Text>
        )}
      </Stack>
    </Card>
  );
}
