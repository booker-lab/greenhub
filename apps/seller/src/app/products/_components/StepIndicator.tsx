'use client';

import { Box, Container, Group, Text } from '@mantine/core';
import { STEP_LABELS } from './productForm.types';

/** ProductForm 5단계 진행 인디케이터. */
export function StepIndicator({ step }: { step: number }) {
  return (
    <Box
      style={{
        backgroundColor: 'var(--color-bg)',
        borderBottom: '1px solid var(--color-border)',
        padding: '8px 16px',
      }}
    >
      <Container size="sm">
        <Group gap={0}>
          {STEP_LABELS.map((label, i) => {
            const s = i + 1;
            const active = s === step;
            const done = s < step;
            return (
              <Box key={s} style={{ flex: 1, textAlign: 'center', padding: '4px 2px' }}>
                <Box
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    margin: '0 auto 2px',
                    backgroundColor: active
                      ? 'var(--color-primary)'
                      : done
                        ? 'var(--color-primary-surface)'
                        : 'var(--color-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--fw-medium)',
                    color: active
                      ? 'white'
                      : done
                        ? 'var(--color-primary)'
                        : 'var(--color-text-disabled)',
                  }}
                >
                  {done ? '✓' : s}
                </Box>
                <Text
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: active ? 'var(--color-primary)' : 'var(--color-text-disabled)',
                    fontWeight: active ? 'var(--fw-medium)' : 400,
                  }}
                >
                  {label}
                </Text>
              </Box>
            );
          })}
        </Group>
      </Container>
    </Box>
  );
}
