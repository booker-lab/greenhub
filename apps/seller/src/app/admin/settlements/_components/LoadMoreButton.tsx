'use client';

import { Button, Stack, Text } from '@mantine/core';

interface LoadMoreButtonProps {
  loadedCount: number;
  loadingMore: boolean;
  error: string;
  onLoadMore: () => void;
}

/** 판매자 정산 LoadMoreSettlements와 같은 모양. 서버가 같은 조건의 정산이 더 있다고 알린 경우에만 보인다. */
export function LoadMoreButton({ loadedCount, loadingMore, error, onLoadMore }: LoadMoreButtonProps) {
  return (
    <Stack gap={6} align="center" py="sm">
      <Text
        style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-disabled)' }}
        ta="center"
      >
        {loadedCount}건까지 불러왔습니다. 합계 카드는 조건 전체 기준입니다.
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
