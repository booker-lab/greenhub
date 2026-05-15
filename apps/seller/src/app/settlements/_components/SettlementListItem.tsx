'use client';

import { Badge, Group, Paper, Stack, Text } from '@mantine/core';
import type { Settlement } from '../_constants';
import { STATUS_COLOR, STATUS_LABEL } from '../_constants';
import { toDateStr, toKRW } from '../_lib';

interface SettlementListItemProps {
  settlement: Settlement;
  showFee?: boolean;
}

export function SettlementListItem({ settlement: s, showFee }: SettlementListItemProps) {
  return (
    <Paper radius="md" px="md" py="sm" shadow="xs">
      <Group justify="space-between" mb={4}>
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
          {s.orderId.slice(0, 8)}…
        </Text>
        <Badge color={STATUS_COLOR[s.status]} variant="light" size="xs" radius="xl">
          {STATUS_LABEL[s.status]}
        </Badge>
      </Group>
      <Group justify="space-between">
        {showFee ? (
          <Stack gap={0}>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              {toDateStr(s.settledAt._seconds)}
            </Text>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              수수료 {toKRW(s.platformFee)}
            </Text>
          </Stack>
        ) : (
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            {toDateStr(s.settledAt._seconds)}
          </Text>
        )}
        <Text style={{ fontWeight: 'var(--fw-medium)' }}>{toKRW(s.netAmount)}</Text>
      </Group>
    </Paper>
  );
}
