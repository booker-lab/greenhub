'use client';

import { Button, Paper, Stack, Text } from '@mantine/core';

interface AdminFetchErrorProps {
  /** 예: '숨긴 후기를 불러오지 못했습니다.' */
  title: string;
  /** 예: '숨긴 후기 조회 중 오류 발생' */
  detail: string;
  onRetry: () => void;
}

// 관리자 탭 조회 실패 화면 — 정산·소비자 탭과 같은 모양(제목·상세·다시 조회).
// 조회 실패를 빈 목록("없어요")으로 보여 주지 않기 위해 쓴다.
export function AdminFetchError({ title, detail, onRetry }: AdminFetchErrorProps) {
  return (
    <Paper
      radius="lg"
      shadow="xs"
      style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
    >
      <Stack gap="sm" align="center" py={64} px="md">
        <Text style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>{title}</Text>
        <Text
          ta="center"
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        >
          {detail}
        </Text>
        <Button onClick={onRetry} size="sm" variant="outline" radius="md">
          다시 조회
        </Button>
      </Stack>
    </Paper>
  );
}
