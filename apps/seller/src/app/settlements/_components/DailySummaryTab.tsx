'use client';

import { Badge, Divider, Group, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import type { SettlementStatus, Summary } from '../_constants';
import { STATUS_COLOR, STATUS_LABEL } from '../_constants';
import { toKRW } from '../_lib';

interface DailySummaryTabProps {
  selectedDate: string;
  setSelectedDate: (v: string) => void;
  selectedDateLabel: string;
  today: string;
  summary: Summary | null;
  summaryLoading: boolean;
  summaryError: string;
}

export function DailySummaryTab({
  selectedDate,
  setSelectedDate,
  selectedDateLabel,
  today,
  summary,
  summaryLoading,
  summaryError,
}: DailySummaryTabProps) {
  return (
    <Paper radius="lg" p="lg" shadow="xs">
      <Group justify="space-between" align="center" mb="md">
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
          {selectedDateLabel}
        </Text>
        <input
          type="date"
          value={selectedDate}
          max={today}
          onChange={(e) => setSelectedDate(e.target.value)}
          style={{
            padding: '6px 10px',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
          }}
        />
      </Group>
      {summaryLoading ? (
        <Text
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          ta="center"
          py="md"
        >
          불러오는 중...
        </Text>
      ) : summaryError ? (
        <Text
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
          ta="center"
          py="md"
        >
          {summaryError}
        </Text>
      ) : (
        <Stack gap="sm">
          <Group justify="space-between">
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              완료 건수
            </Text>
            <Text style={{ fontWeight: 'var(--fw-medium)' }}>{summary?.count ?? 0}건</Text>
          </Group>
          <Group justify="space-between">
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              총 매출
            </Text>
            <Text style={{ fontWeight: 'var(--fw-medium)' }}>
              {toKRW(summary?.totalAmount ?? 0)}
            </Text>
          </Group>
          <Group justify="space-between">
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              플랫폼 수수료
            </Text>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              −{toKRW(summary?.totalPlatformFee ?? 0)}
            </Text>
          </Group>
          <Divider />
          <Group justify="space-between">
            <Text
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-medium)',
                color: 'var(--color-text-secondary)',
              }}
            >
              정산 예정
            </Text>
            <Text style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-primary)' }}>
              {toKRW(summary?.totalNetAmount ?? 0)}
            </Text>
          </Group>
          {summary && summary.count > 0 && (
            <SimpleGrid
              cols={2}
              mt="xs"
              style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8 }}
            >
              {(Object.entries(summary.byStatus) as [SettlementStatus, number][])
                .filter(([, v]) => v > 0)
                .map(([status, count]) => (
                  <Badge key={status} color={STATUS_COLOR[status]} variant="light" radius="xl">
                    {STATUS_LABEL[status]} {count}건
                  </Badge>
                ))}
            </SimpleGrid>
          )}
        </Stack>
      )}
    </Paper>
  );
}
