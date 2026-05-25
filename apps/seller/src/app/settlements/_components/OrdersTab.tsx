'use client';

import { Box, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import type { Settlement, SettlementFilterKey, SettlementStatus } from '../_constants';
import { SETTLEMENT_FILTER_TABS } from '../_constants';
import { downloadCSV } from '../_lib';
import { SettlementListItem } from './SettlementListItem';

interface OrdersTabProps {
  settlements: Settlement[];
  listLoading: boolean;
  // status 필터 fetch 배선(T3). 'all' → status 미전달(전체 조회, 기존 동작 유지).
  fetchSettlements: (f?: string, t?: string, status?: SettlementStatus) => void;
}

export function OrdersTab({ settlements, listLoading, fetchSettlements }: OrdersTabProps) {
  const [activeStatus, setActiveStatus] = useState<SettlementFilterKey>('all');

  const handleChange = (key: SettlementFilterKey) => {
    setActiveStatus(key);
    fetchSettlements(undefined, undefined, key === 'all' ? undefined : key);
  };

  return (
    <Stack gap="xs">
      <SegmentedTabs<SettlementFilterKey>
        tabs={SETTLEMENT_FILTER_TABS}
        value={activeStatus}
        onChange={handleChange}
        layout="scroll"
      />

      {listLoading ? (
        <Text
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          ta="center"
          py={80}
        >
          불러오는 중...
        </Text>
      ) : settlements.length === 0 ? (
        <Box
          py={80}
          style={{ textAlign: 'center', color: 'var(--color-text-disabled)' }}
        >
          <Text style={{ fontSize: 'var(--font-size-sm)' }}>정산 완료된 주문이 없습니다</Text>
        </Box>
      ) : (
        <>
          <Group justify="flex-end" px={4}>
            <UnstyledButton
              onClick={() => downloadCSV(settlements, '', '')}
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
            <SettlementListItem key={s.id} settlement={s} showFee />
          ))}
        </>
      )}
    </Stack>
  );
}
