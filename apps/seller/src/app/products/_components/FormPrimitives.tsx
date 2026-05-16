'use client';

import { Button, Group, Paper, Text } from '@mantine/core';
import type { ReactNode } from 'react';

const LABEL_STYLE = {
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--fw-medium)',
  color: 'var(--color-text-disabled)',
} as const;

const SELECTED_STYLE = {
  backgroundColor: 'var(--color-primary)',
  borderColor: 'var(--color-primary)',
  color: 'white',
} as const;

/** Paper 카드 + 비활성색 라벨. ProductForm 스텝 본문 전반에서 재사용. */
export function FieldCard({
  label,
  labelGap = 'xs',
  children,
}: {
  label: string;
  labelGap?: 'xs' | 'sm';
  children: ReactNode;
}) {
  return (
    <Paper radius="lg" shadow="xs" p="md">
      <Text style={LABEL_STYLE} mb={labelGap}>
        {label}
      </Text>
      {children}
    </Paper>
  );
}

/** 단일 선택 버튼 행 (카테고리·배송 사이즈 등 동일 패턴). */
export function ChoiceRow({
  options,
  value,
  onChange,
}: {
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Group gap="xs">
      {options.map(({ value: v, label }) => (
        <Button
          key={v}
          onClick={() => onChange(v)}
          flex={1}
          size="sm"
          radius="xl"
          variant={value === v ? 'filled' : 'outline'}
          color="gray"
          style={value === v ? SELECTED_STYLE : {}}
        >
          {label}
        </Button>
      ))}
    </Group>
  );
}
