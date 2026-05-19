'use client';

import { Group, Text } from '@mantine/core';

export function Row({
  label,
  value,
  bold,
  highlight,
  mono,
}: {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: boolean;
  mono?: boolean;
}) {
  return (
    <Group justify="space-between" align="flex-start" gap="xs">
      <Text
        style={{
          flexShrink: 0,
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-disabled)',
        }}
      >
        {label}
      </Text>
      <Text
        ta="right"
        ff={mono ? 'monospace' : undefined}
        style={{
          wordBreak: 'break-all',
          fontSize: 'var(--font-size-sm)',
          fontWeight: bold ? 'var(--fw-bold)' : undefined,
          color: bold
            ? 'var(--color-text)'
            : highlight
              ? 'var(--color-primary)'
              : 'var(--color-text-secondary)',
        }}
      >
        {value}
      </Text>
    </Group>
  );
}
