'use client';

import { Paper, SimpleGrid, Text, Tooltip } from '@mantine/core';
import { toKRW } from '../_lib';

interface SummaryCardsProps {
  /** N11: confirmed + paid 한정 합계 (sumPayable 결과). */
  totalFee: number;
  totalNet: number;
}

export function SummaryCards({ totalFee, totalNet }: SummaryCardsProps) {
  const summaryHelp = '현재 필터 범위의 confirmed+paid 합계이며 pending·cancelled는 제외합니다.';

  return (
    <SimpleGrid cols={2} mb="md">
      <Paper radius="lg" style={{ border: '1px solid var(--color-border)' }} p="md">
        <Tooltip label={summaryHelp} withArrow>
          <Text
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            mb={4}
          >
            플랫폼 수수료 합계
          </Text>
        </Tooltip>
        <Text style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--fw-bold)' }}>
          {toKRW(totalFee)}
        </Text>
      </Paper>
      <Paper radius="lg" style={{ border: '1px solid var(--color-border)' }} p="md">
        <Tooltip label={summaryHelp} withArrow>
          <Text
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            mb={4}
          >
            판매자 지급 합계
          </Text>
        </Tooltip>
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
