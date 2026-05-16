'use client';

import { Box } from '@mantine/core';
import type { ReactNode } from 'react';

/** 셀러앱 페이지의 최상위 컨테이너 (min-height + muted 배경). */
export function PageShell({
  children,
  paddingBottom,
}: {
  children: ReactNode;
  paddingBottom?: number;
}) {
  return (
    <Box
      component="main"
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--color-surface-muted)',
        ...(paddingBottom ? { paddingBottom } : {}),
      }}
    >
      {children}
    </Box>
  );
}
