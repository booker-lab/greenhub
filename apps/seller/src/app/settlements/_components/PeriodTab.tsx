'use client';

import { Button, Group, Paper, Stack, Text, UnstyledButton } from '@mantine/core';
import type { Settlement } from '../_constants';
import { downloadCSV } from '../_lib';
import { SettlementListItem } from './SettlementListItem';

interface PeriodTabProps {
  from: string;
  setFrom: (v: string) => void;
  to: string;
  setTo: (v: string) => void;
  settlements: Settlement[];
  listLoading: boolean;
  listError: string;
  onSearch: (f: string, t: string) => void;
}

export function PeriodTab({
  from,
  setFrom,
  to,
  setTo,
  settlements,
  listLoading,
  listError,
  onSearch,
}: PeriodTabProps) {
  return (
    <Stack gap="md">
      <Paper radius="lg" p="lg" shadow="xs">
        <Text
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          mb="md"
        >
          조회 기간을 선택하세요
        </Text>
        <Group gap="xs" mb="md">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={{
              flex: 1,
              padding: '8px 12px',
              border: '1px solid var(--color-border)',
              borderRadius: 12,
              fontSize: 'var(--font-size-sm)',
            }}
          />
          <Text style={{ color: 'var(--color-text-disabled)' }}>~</Text>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={{
              flex: 1,
              padding: '8px 12px',
              border: '1px solid var(--color-border)',
              borderRadius: 12,
              fontSize: 'var(--font-size-sm)',
            }}
          />
        </Group>
        <Button
          onClick={() => onSearch(from, to)}
          disabled={listLoading}
          fullWidth
          size="md"
          radius="xl"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          {listLoading ? '조회 중...' : '조회'}
        </Button>
      </Paper>

      {listError && (
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }} ta="center">
          {listError}
        </Text>
      )}

      {settlements.length > 0 && (
        <Stack gap="xs">
          <Group justify="space-between" px={4}>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              {settlements.length}건 조회됨
            </Text>
            <UnstyledButton
              onClick={() => downloadCSV(settlements, from, to)}
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-primary)',
                fontWeight: 500,
              }}
            >
              CSV 다운로드
            </UnstyledButton>
          </Group>
          {settlements.map((s) => (
            <SettlementListItem key={s.id} settlement={s} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
