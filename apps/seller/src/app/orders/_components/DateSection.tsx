'use client';

import type { Order } from '@greenhub/shared';
import { Box, Stack, Text } from '@mantine/core';
import type { BulkActionMode, GroupHeaderMeta } from '../_constants';
import { OrderCard } from './OrderCard';

interface DateSectionProps {
  meta: GroupHeaderMeta;
  orders: Order[];
  selectedOrderIds?: Set<string>;
  bulkActionMode?: BulkActionMode;
  onSelectedChange?: (orderId: string, selected: boolean) => void;
}

export function DateSection({
  meta,
  orders,
  selectedOrderIds,
  bulkActionMode = 'prepare',
  onSelectedChange,
}: DateSectionProps) {
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
        <OrderCard
          key={order.id}
          order={order}
          selected={selectedOrderIds?.has(order.id) ?? false}
          bulkActionMode={bulkActionMode}
          onSelectedChange={onSelectedChange}
        />
      ))}
    </Stack>
  );
}
