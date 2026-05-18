'use client';

import Link from 'next/link';
import { Group, Paper, Text, UnstyledButton } from '@mantine/core';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

interface DashboardCardProps {
  title: string;
  /** 지정 시 우상단에 "더보기 >" 링크를 렌더. */
  moreHref?: string;
  moreLabel?: string;
  children: ReactNode;
}

/** 홈 대시보드 카드 — 제목 + 선택적 "더보기 >" 링크 + 본문. */
export function DashboardCard({
  title,
  moreHref,
  moreLabel = '더보기',
  children,
}: DashboardCardProps) {
  return (
    <Paper radius="lg" shadow="xs" p="md">
      <Group justify="space-between" mb="sm">
        <Text style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--fw-bold)' }}>
          {title}
        </Text>
        {moreHref && (
          <UnstyledButton
            component={Link}
            href={moreHref}
            style={{ display: 'flex', alignItems: 'center', gap: 2 }}
          >
            <Text
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              {moreLabel}
            </Text>
            <ChevronRight size={14} color="var(--color-text-disabled)" />
          </UnstyledButton>
        )}
      </Group>
      {children}
    </Paper>
  );
}
