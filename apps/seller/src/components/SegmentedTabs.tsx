'use client';

import { Badge, Box, Container, Group, UnstyledButton } from '@mantine/core';
import type { CSSProperties } from 'react';

export type SegmentedTabItem<T extends string = string> = {
  key: T;
  label: string;
  count?: number;
  badgeColor?: 'red' | 'gray';
};

type Props<T extends string> = {
  tabs: ReadonlyArray<SegmentedTabItem<T>>;
  value: T;
  onChange: (key: T) => void;
  sticky?: boolean;
  topOffset?: string;
  layout?: 'flex' | 'scroll';
};

export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  sticky = false,
  topOffset = 'var(--header-height)',
  layout = 'flex',
}: Props<T>) {
  const containerStyle: CSSProperties = {
    backgroundColor: 'var(--color-bg)',
    borderBottom: '1px solid var(--color-border)',
    ...(sticky ? { position: 'sticky', top: topOffset, zIndex: 10 } : {}),
  };

  const groupStyle: CSSProperties =
    layout === 'scroll' ? { overflowX: 'auto', flexWrap: 'nowrap', scrollbarWidth: 'none' } : {};

  return (
    <Box style={containerStyle}>
      <Container size="sm">
        <Group gap={0} style={groupStyle}>
          {tabs.map((tab) => {
            const active = tab.key === value;
            const buttonStyle: CSSProperties = {
              padding: '12px 16px',
              fontSize: 'var(--font-size-sm)',
              fontWeight: active ? 700 : 'var(--fw-medium)',
              textAlign: 'center',
              borderBottom: `2px solid ${active ? 'var(--color-primary)' : 'transparent'}`,
              color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              transition: 'all 0.15s',
              ...(layout === 'flex' ? { flex: 1 } : { flexShrink: 0 }),
            };

            return (
              <UnstyledButton key={tab.key} onClick={() => onChange(tab.key)} style={buttonStyle}>
                {tab.label}
                {typeof tab.count === 'number' && tab.count > 0 && (
                  <Badge size="xs" ml={6} color={tab.badgeColor ?? 'gray'}>
                    {tab.count}
                  </Badge>
                )}
              </UnstyledButton>
            );
          })}
        </Group>
      </Container>
    </Box>
  );
}
