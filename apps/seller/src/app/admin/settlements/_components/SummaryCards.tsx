'use client';

import { Paper, SimpleGrid, Text } from '@mantine/core';
import { toKRW } from '../_lib';

interface SummaryCardsProps {
  /** N11: confirmed + paid 한정 합계 (sumPayable 결과). */
  totalFee: number;
  totalNet: number;
}

export function SummaryCards({ totalFee, totalNet }: SummaryCardsProps) {
  return (
    <SimpleGrid cols={2} mb="md">
      <Paper radius="lg" style={{ border: '1px solid var(--color-border)' }} p="md">
        <Text
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          mb={4}
        >
          플랫폼 수수료 합계
        </Text>
        <Text style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--fw-bold)' }}>
          {toKRW(totalFee)}
        </Text>
      </Paper>
      <Paper radius="lg" style={{ border: '1px solid var(--color-border)' }} p="md">
        <Text
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          mb={4}
        >
          판매자 지급 합계
        </Text>
        <Text
          style={{
            fontSize: 'var(--font-size-lg)',
            fontWeight: 'var(--fw-bold)',
            color: 'var(--color-primary)',
          }}
        >
          {toKRW(totalNet)}
        </Text>
      </Paper>
    </SimpleGrid>
  );
}
