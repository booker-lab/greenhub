'use client';

import { Button, Group, NumberInput, Paper, Stack, Text } from '@mantine/core';

interface DefaultCommissionPanelProps {
  value: string;
  rate: number;
  loading: boolean;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}

export function DefaultCommissionPanel({
  value,
  rate,
  loading,
  saving,
  onChange,
  onSave,
}: DefaultCommissionPanelProps) {
  return (
    <Paper radius="md" p="md" mb="md" style={{ border: '1px solid var(--color-border)' }}>
      <Group justify="space-between" align="flex-end" gap="md">
        <Stack gap={4}>
          <Text fw={600}>플랫폼 기본 수수료율</Text>
          <Text c="dimmed" size="sm">
            현재 기본값 {(rate * 100).toFixed(1)}%
          </Text>
        </Stack>
        <Group gap="xs" align="flex-end">
          <NumberInput
            aria-label="플랫폼 기본 수수료율"
            min={0}
            max={1}
            step={0.01}
            decimalScale={2}
            clampBehavior="strict"
            inputMode="decimal"
            value={value}
            onChange={(next) => onChange(String(next))}
            placeholder="0.05"
            w={128}
            disabled={loading || saving}
          />
          <Button color="green" onClick={onSave} loading={saving} disabled={loading}>
            저장
          </Button>
        </Group>
      </Group>
    </Paper>
  );
}
