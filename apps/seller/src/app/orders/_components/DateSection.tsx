'use client';

import type { Order } from '@greenhub/shared';
import { Box, Stack, Text } from '@mantine/core';
import type { GroupHeaderMeta } from '../_constants';
import { OrderCard } from './OrderCard';

export function DateSection({ meta, orders }: { meta: GroupHeaderMeta; orders: Order[] }) {
  const danger = meta.urgency === 'overdue' || meta.urgency === 'today';

  return (
    <Stack gap="sm">
      <Box
        style={{
          padding: '6px 10px',
          borderRadius: 8,
          backgroundColor: danger ? 'var(--color-danger-surface)' : 'transparent',
        }}
      >
        <Text
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-bold)',
            color: danger ? 'var(--color-danger)' : 'var(--color-text-disabled)',
          }}
        >
          {danger && '🔴 '}
          {meta.label} · {orders.length}건
        </Text>
      </Box>

      {orders.map((order) => (
        <OrderCard key={order.id} order={order} />
      ))}
    </Stack>
  );
}
