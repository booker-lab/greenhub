'use client';

import { Box, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import type { Settlement } from '../_constants';
import { downloadCSV } from '../_lib';
import { SettlementListItem } from './SettlementListItem';

interface OrdersTabProps {
  settlements: Settlement[];
  listLoading: boolean;
}

export function OrdersTab({ settlements, listLoading }: OrdersTabProps) {
  if (listLoading) {
    return (
      <Box>
        <Text
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          ta="center"
          py={80}
        >
          불러오는 중...
        </Text>
      </Box>
    );
  }

  if (settlements.length === 0) {
    return (
      <Stack
        align="center"
        justify="center"
        py={80}
        style={{ color: 'var(--color-text-disabled)' }}
      >
        <Text style={{ fontSize: 'var(--font-size-sm)' }}>정산 완료된 주문이 없습니다</Text>
      </Stack>
    );
  }

  return (
    <Stack gap="xs">
      <Group justify="flex-end" px={4}>
        <UnstyledButton
          onClick={() => downloadCSV(settlements, '', '')}
          style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 500 }}
        >
          CSV 다운로드
        </UnstyledButton>
      </Group>
      {settlements.map((s) => (
        <SettlementListItem key={s.id} settlement={s} showFee />
      ))}
    </Stack>
  );
}
