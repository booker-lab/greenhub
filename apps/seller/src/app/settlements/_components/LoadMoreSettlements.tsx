'use client';

import { Button, Stack, Text } from '@mantine/core';

interface LoadMoreSettlementsProps {
  loadedCount: number;
  loadingMore: boolean;
  error: string;
  onLoadMore: () => void;
}

/** 서버가 같은 조건의 정산이 더 있다고 알려 준 경우에만 보인다. 불러온 범위와 CSV 범위를 함께 알린다. */
export function LoadMoreSettlements({
  loadedCount,
  loadingMore,
  error,
  onLoadMore,
}: LoadMoreSettlementsProps) {
  return (
    <Stack gap={6} align="center" py="sm">
      <Text
        style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-disabled)' }}
        ta="center"
      >
        {loadedCount}건까지 불러왔습니다. 정산이 더 있으며, CSV에는 불러온 건만 담깁니다.
      </Text>
      {error && (
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }} ta="center">
          {error}
        </Text>
      )}
      <Button
        variant="light"
        radius="xl"
        size="sm"
        onClick={onLoadMore}
        loading={loadingMore}
        disabled={loadingMore}
      >
        더 보기
      </Button>
    </Stack>
  );
}
