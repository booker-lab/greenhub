'use client';

import { Box, Group, Loader, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';

/** 로딩 스피너. fullPage=true면 화면 전체 중앙 정렬. */
export function LoadingState({ fullPage = false }: { fullPage?: boolean }) {
  if (fullPage) {
    return (
      <Box
        style={{
          minHeight: '100vh',
          backgroundColor: 'var(--color-surface-muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Loader size="sm" color="brand" />
      </Box>
    );
  }
  return (
    <Group justify="center" py={80}>
      <Loader size="sm" color="brand" />
    </Group>
  );
}

/** 빈 목록 안내 (아이콘 + 문구 + 선택 액션). */
export function EmptyState({
  icon,
  text,
  action,
}: {
  icon?: ReactNode;
  text: string;
  action?: ReactNode;
}) {
  return (
    <Stack
      align="center"
      justify="center"
      py={80}
      style={{ color: 'var(--color-text-disabled)' }}
    >
      {icon}
      <Text style={{ fontSize: 'var(--font-size-sm)' }}>{text}</Text>
      {action}
    </Stack>
  );
}
