'use client';

import type { MantineSize } from '@mantine/core';
import { ActionIcon, Box, Container, Group, Title } from '@mantine/core';
import { ChevronLeft, Home } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  /** 지정 시 좌측에 뒤로가기 버튼을 렌더. */
  onBack?: () => void;
  /** 우측 영역 (액션 버튼·상태 표시 등). */
  right?: ReactNode;
  containerSize?: MantineSize;
  /** false면 sticky 해제 (기본 true). */
  sticky?: boolean;
}

/** 페이지 헤더. 셀러앱 전 페이지가 동일 마크업을 공유. */
export function PageHeader({
  title,
  onBack,
  right,
  containerSize = 'sm',
  sticky = true,
}: PageHeaderProps) {
  const pathname = usePathname();
  // 홈 진입점 — 현재 경로가 홈이 아닐 때만 노출. 좌/우 zone과 무관하게 정중앙 고정.
  const showHome = pathname !== '/';

  return (
    <Box
      component="header"
      style={{
        backgroundColor: 'var(--color-bg)',
        borderBottom: '1px solid var(--color-border)',
        padding: '16px',
        ...(sticky ? { position: 'sticky', top: 0, zIndex: 10 } : {}),
      }}
    >
      <Container size={containerSize} style={{ position: 'relative' }}>
        <Group justify="space-between">
          <Group gap="sm">
            {onBack && (
              <ActionIcon variant="subtle" color="gray" onClick={onBack}>
                <ChevronLeft size={20} />
              </ActionIcon>
            )}
            <Title order={3}>{title}</Title>
          </Group>
          {right}
        </Group>
        {showHome && (
          <ActionIcon
            component={Link}
            href="/"
            variant="subtle"
            color="gray"
            aria-label="홈"
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
            }}
          >
            <Home size={20} />
          </ActionIcon>
        )}
      </Container>
    </Box>
  );
}
