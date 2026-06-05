import { Badge, Card, Group, Stack, Text } from '@mantine/core';
import Link from 'next/link';
import {
  type DriverBoardOrder,
  type DriverBoardTab,
  getBoardOrderLocation,
  getBoardOrderTimeLabel,
  METHOD_BADGE,
} from '@/app/board/_lib';

export default function OrderCard({
  order,
  tab,
}: {
  order: DriverBoardOrder;
  tab: DriverBoardTab;
}) {
  const badge = METHOD_BADGE[order.deliveryMethod] ?? METHOD_BADGE.direct;
  const displayLocation = getBoardOrderLocation(order);

  return (
    <Card
      component={Link}
      href={`/board/${order.id}`}
      radius="xl"
      withBorder
      p="md"
      style={{ textDecoration: 'none' }}
    >
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Badge color={badge.color} variant="light" size="md">
            {badge.label}
          </Badge>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            {getBoardOrderTimeLabel(order, tab)}
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
      </Stack>
    </Card>
  );
}
