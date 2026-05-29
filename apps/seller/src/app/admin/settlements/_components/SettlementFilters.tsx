'use client';

import type { PeriodRangeKey } from '@greenhub/shared';
import { periodRange } from '@greenhub/shared';
import { Button, Group, TextInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import 'dayjs/locale/ko';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { SETTLEMENT_FILTER_TABS, type SettlementFilterKey } from '../_constants';

interface SettlementFiltersProps {
  storeFilter: string;
  fromFilter: string;
  toFilter: string;
  statusFilter: SettlementFilterKey;
  onStoreChange: (v: string) => void;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onStatusChange: (v: SettlementFilterKey) => void;
}

const QUICK_PERIODS: PeriodRangeKey[] = ['thisWeek', 'thisMonth', 'lastMonth'];

export function SettlementFilters({
  storeFilter,
  fromFilter,
  toFilter,
  statusFilter,
  onStoreChange,
  onFromChange,
  onToChange,
  onStatusChange,
}: SettlementFiltersProps) {
  const activePeriod = QUICK_PERIODS.find((key) => {
    const range = periodRange(key);
    return range.from === fromFilter && range.to === toFilter;
  });

  const applyPeriod = (key: PeriodRangeKey) => {
    const range = periodRange(key);
    onFromChange(range.from);
    onToChange(range.to);
  };

  return (
    <>
      <SegmentedTabs<SettlementFilterKey>
        tabs={SETTLEMENT_FILTER_TABS}
        value={statusFilter}
        onChange={onStatusChange}
        layout="scroll"
      />
      <Group gap="sm" mb="md" mt="sm" style={{ flexWrap: 'wrap' }}>
        <TextInput
          placeholder="스토어 ID 필터"
          value={storeFilter}
          onChange={(e) => onStoreChange(e.target.value)}
          style={{ flex: 1, minWidth: 140 }}
          radius="md"
          size="sm"
        />
        <Group gap={6} style={{ flexWrap: 'wrap' }}>
          {QUICK_PERIODS.map((key) => {
            const range = periodRange(key);
            return (
              <Button
                key={key}
                size="xs"
                radius="md"
                variant={activePeriod === key ? 'filled' : 'light'}
                color={activePeriod === key ? 'green' : 'gray'}
                onClick={() => applyPeriod(key)}
              >
                {range.label}
              </Button>
            );
          })}
        </Group>
        <DatePickerInput
          value={fromFilter || null}
          onChange={(value) => onFromChange(value ?? '')}
          placeholder="시작일"
          valueFormat="YYYY-MM-DD"
          locale="ko"
          clearable
          radius="md"
          size="sm"
          style={{ minWidth: 132 }}
        />
        <DatePickerInput
          value={toFilter || null}
          onChange={(value) => onToChange(value ?? '')}
          placeholder="종료일"
          valueFormat="YYYY-MM-DD"
          locale="ko"
          clearable
          radius="md"
          size="sm"
          style={{ minWidth: 132 }}
        />
      </Group>
    </>
  );
}
