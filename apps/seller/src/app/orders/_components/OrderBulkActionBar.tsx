'use client';

import { Button, Checkbox, Group, Paper, Stack, Text } from '@mantine/core';
import { CheckCheck, Truck } from 'lucide-react';
import type { BulkActionMode } from '../_constants';

interface OrderBulkActionBarProps {
  mode: BulkActionMode;
  eligibleCount: number;
  selectedCount: number;
  loading: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onSubmit: () => void;
}

export function OrderBulkActionBar({
  mode,
  eligibleCount,
  selectedCount,
  loading,
  onSelectAll,
  onClear,
  onSubmit,
}: OrderBulkActionBarProps) {
  if (eligibleCount === 0) return null;

  const allSelected = selectedCount > 0 && selectedCount === eligibleCount;
  const indeterminate = selectedCount > 0 && selectedCount < eligibleCount;
  const isShipParcel = mode === 'shipParcel';
  const label = isShipParcel ? '택배 발송 가능' : '준비 가능';
  const actionLabel = isShipParcel ? '택배 발송' : '준비 시작';
  const ActionIcon = isShipParcel ? Truck : CheckCheck;

  return (
    <Paper
      radius="md"
      p="sm"
      withBorder
      style={{
        background: 'var(--color-bg)',
        position: 'sticky',
        top: 0,
        zIndex: 2,
      }}
    >
      <Stack gap="xs">
        <Group justify="space-between" align="center" gap="sm" wrap="nowrap">
          <Checkbox
            checked={allSelected}
            indeterminate={indeterminate}
            onChange={(event) => (event.currentTarget.checked ? onSelectAll() : onClear())}
            label={`${label} ${eligibleCount}건`}
          />
          <Text
            style={{
              fontSize: 'var(--font-size-sm)',
              color: selectedCount > 0 ? 'var(--color-text)' : 'var(--color-text-disabled)',
              whiteSpace: 'nowrap',
            }}
          >
            {selectedCount}건 선택
          </Text>
        </Group>

        <Group gap="xs" grow>
          <Button
            leftSection={<ActionIcon size={16} />}
            onClick={onSubmit}
            disabled={selectedCount === 0 || loading}
            loading={loading}
            radius="md"
            color="brand"
          >
            {actionLabel}
          </Button>
          <Button
            onClick={onClear}
            disabled={selectedCount === 0 || loading}
            radius="md"
            variant="outline"
            color="gray"
          >
            선택 해제
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
