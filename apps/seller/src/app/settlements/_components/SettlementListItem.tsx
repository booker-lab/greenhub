'use client';

import { Badge, Group, Paper, Stack, Text } from '@mantine/core';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { Settlement } from '../_constants';
import { STATUS_COLOR, STATUS_LABEL } from '../_constants';
import { toDateStr, toKRW } from '../_lib';

interface SettlementListItemProps {
  settlement: Settlement;
  showFee?: boolean;
}

export function SettlementListItem({ settlement: s, showFee }: SettlementListItemProps) {
  return (
    // 정산에는 사람이 읽을 주문번호가 없어(orderId만 있음) 잘린 ID 대신 그 주문 상세로 가는 카드로 둔다.
    <Paper
      component={Link}
      href={`/orders/${encodeURIComponent(s.orderId)}`}
      radius="md"
      px="md"
      py="sm"
      shadow="xs"
      style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}
    >
      <Group justify="space-between" mb={4}>
        <Group gap={2} style={{ color: 'var(--color-primary-dark)' }}>
          <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)' }}>
            주문 보기
          </Text>
          <ChevronRight size={16} aria-hidden />
        </Group>
        <Badge color={STATUS_COLOR[s.status]} variant="light" size="xs" radius="xl">
          {STATUS_LABEL[s.status]}
        </Badge>
      </Group>
      <Group justify="space-between">
        {showFee ? (
          <Stack gap={0}>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              {toDateStr(s.settledAt)}
            </Text>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              수수료 {toKRW(s.platformFee)}
            </Text>
          </Stack>
        ) : (
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            {toDateStr(s.settledAt)}
          </Text>
        )}
        <Text style={{ fontWeight: 'var(--fw-bold)', fontVariantNumeric: 'tabular-nums' }}>
          {toKRW(s.netAmount)}
        </Text>
      </Group>
    </Paper>
  );
}
