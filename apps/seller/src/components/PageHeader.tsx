'use client';

import { ActionIcon, Box, Container, Group, Title } from '@mantine/core';
import { ChevronLeft } from 'lucide-react';
import type { MantineSize } from '@mantine/core';
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
      <Container size={containerSize}>
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
      </Container>
    </Box>
  );
}
