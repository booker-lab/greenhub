'use client';

import { Button, Stack, Text } from '@mantine/core';

interface LoadMoreFooterProps {
  hasMore: boolean;
  loadingMore: boolean;
  /** 더 보기 실패 메시지. 목록은 그대로 두고 여기서 다시 시도한다. */
  moreError: string | null;
  onLoadMore: () => void;
}

// 관리자 목록 공통 "더 보기" — 서버가 더 있다고 알릴 때만 보인다(주문·기사 탭 공용).
export function LoadMoreFooter({
  hasMore,
  loadingMore,
  moreError,
  onLoadMore,
}: LoadMoreFooterProps) {
  if (!hasMore) return null;
  return (
    <Stack align="center" gap={4} mt="md">
      {moreError && (
        <Text
          role="alert"
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
        >
          {moreError}
        </Text>
      )}
      <Button variant="light" color="gray" radius="md" loading={loadingMore} onClick={onLoadMore}>
        {moreError ? '다시 시도' : '더 보기'}
      </Button>
    </Stack>
  );
}
