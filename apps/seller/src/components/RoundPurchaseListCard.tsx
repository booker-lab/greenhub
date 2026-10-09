'use client';

import type { SaleRound, SaleRoundItem } from '@greenhub/shared';
import { Box, Group, Paper, Text } from '@mantine/core';
import { buildRoundPurchaseList } from '@/lib/round-purchase-list';

// 회차 구매 목록(경매에서 살 상품별 수량). 수량은 서버 회차 상품 집계를 그대로 쓴다.
export function RoundPurchaseListCard({
  round,
  title = '구매 목록',
}: {
  round: Pick<SaleRound, 'name' | 'counters'> & { items: SaleRoundItem[] };
  title?: string;
}) {
  const list = buildRoundPurchaseList(round);

  return (
    <Paper radius="lg" shadow="xs" p="md">
      <Text style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--fw-bold)' }}>{title}</Text>
      <Text
        mt={2}
        style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
      >
        결제가 끝난 주문 기준이에요. 취소·환불되면 바로 빠져요.
      </Text>
      <Box mt="sm">
        {list.lines.map((line, index) => (
          <Group
            key={line.roundItemId}
            justify="space-between"
            wrap="nowrap"
            py={10}
            style={index > 0 ? { borderTop: '1px solid var(--color-border)' } : undefined}
          >
            <Text
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-text)',
                fontWeight: 'var(--fw-medium)',
                minWidth: 0,
              }}
            >
              {line.productName}
            </Text>
            <Text
              style={{
                fontSize: 'var(--font-size-md)',
                fontWeight: 'var(--fw-bold)',
                fontVariantNumeric: 'tabular-nums',
                flexShrink: 0,
              }}
            >
              {line.orderedQuantity.toLocaleString()}개
            </Text>
          </Group>
        ))}
      </Box>
      <Group justify="flex-end" pt={10} style={{ borderTop: '1px solid var(--color-border)' }}>
        <Text
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
            fontWeight: 'var(--fw-medium)',
          }}
        >
          배송지 {list.orderedDeliveryAddresses.toLocaleString()}곳 · 총{' '}
          {list.orderedTotal.toLocaleString()}개
        </Text>
      </Group>
      {list.pendingTotal > 0 && (
        <Text
          mt={6}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
        >
          지금 결제 중인 {list.pendingTotal.toLocaleString()}개는 결제가 끝나면 더해져요.
        </Text>
      )}
    </Paper>
  );
}
