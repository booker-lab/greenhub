'use client';

import type { SaleType } from '@greenhub/shared';
import { Box, Container, Group, UnstyledButton } from '@mantine/core';

interface Props {
  value: SaleType;
  onChange: (next: SaleType) => void;
}

const OPTIONS: { key: SaleType; label: string }[] = [
  { key: 'normal', label: '일반 주문' },
  { key: 'group', label: '공동구매' },
];

export function SaleTypeToggle({ value, onChange }: Props) {
  return (
    <Box
      style={{
        backgroundColor: 'var(--color-bg)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <Container size="sm" py="xs">
        <Group gap={0}>
          {OPTIONS.map((opt) => {
            const active = value === opt.key;
            return (
              <UnstyledButton
                key={opt.key}
                data-testid={`sale-type-toggle-${opt.key}`}
                onClick={() => onChange(opt.key)}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  textAlign: 'center',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: active ? 700 : 400,
                  borderBottom: `2px solid ${active ? 'var(--color-text)' : 'transparent'}`,
                  color: active ? 'var(--color-text)' : 'var(--color-text-disabled)',
                  transition: 'all 0.15s',
                }}
              >
                {opt.label}
              </UnstyledButton>
            );
          })}
        </Group>
      </Container>
    </Box>
  );
}
