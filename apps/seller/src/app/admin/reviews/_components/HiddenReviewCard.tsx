import type { AdminHiddenReview } from '@greenhub/shared';
import { Button, Group, Paper, Stack, Text } from '@mantine/core';
import { hiddenReasonLabel, hiddenSummary } from '../../../reactions/_lib';

// 관리자 콘솔 숨긴 후기 한 건: 가게·상품·별점·내용·사유·설명·숨긴 사람/시각과 숨김 해제 버튼.

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Seoul',
  });

export interface HiddenReviewCardProps {
  review: AdminHiddenReview;
  busy: boolean;
  error: string | null;
  onUnhide: () => void;
}

export function HiddenReviewCard({ review, busy, error, onUnhide }: HiddenReviewCardProps) {
  const reason = hiddenReasonLabel(review) ?? '사유 없음';
  return (
    <Paper radius="lg" shadow="xs" p="md">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={0}>
          <Text fw={700}>{review.storeName ?? review.storeId}</Text>
          <Text size="sm" c="var(--color-text-secondary)">
            {review.productName ?? '삭제된 상품'}
          </Text>
        </Stack>
        <Text size="sm" c="var(--color-text-secondary)" style={{ flexShrink: 0 }}>
          {review.authorName} · {day(review.createdAt)}
        </Text>
      </Group>
      <Text fw={700} mt={6} c="var(--color-text-secondary)">
        {'★'.repeat(review.rating)}
      </Text>
      <Text size="sm" mt={2} style={{ whiteSpace: 'pre-wrap' }}>
        {review.text}
      </Text>
      <Stack gap={0} mt={8}>
        <Text size="sm" fw={700}>
          사유: {reason}
        </Text>
        {review.hiddenNote && (
          <Text size="sm" c="var(--color-text-secondary)">
            설명: {review.hiddenNote}
          </Text>
        )}
        <Text size="sm" c="var(--color-text-secondary)">
          {hiddenSummary(review)}
        </Text>
      </Stack>
      <Group justify="flex-end" mt={8}>
        <Button variant="light" radius="xl" size="compact-sm" loading={busy} onClick={onUnhide}>
          숨김 해제
        </Button>
      </Group>
      {error && (
        <Text role="alert" size="sm" mt={6} c="var(--color-danger)">
          {error}
        </Text>
      )}
    </Paper>
  );
}
