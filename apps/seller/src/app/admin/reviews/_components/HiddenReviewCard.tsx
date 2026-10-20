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

/** 별점을 숫자와 함께 보여 준다(예: ★4/5). 별만 반복하면 1점과 2점을 한눈에 구분하기 어렵다. */
export const ratingLabel = (rating: number) => `★${rating}/5`;

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
      <Text
        fw={700}
        mt={6}
        c="var(--color-text-secondary)"
        aria-label={`별점 5점 중 ${review.rating}점`}
      >
        {ratingLabel(review.rating)}
      </Text>
      <Text size="sm" mt={2} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {review.text}
      </Text>
      {review.photoUrls && review.photoUrls.length > 0 && (
        <Group gap={6} mt={6} wrap="nowrap" style={{ overflowX: 'auto' }}>
          {review.photoUrls.map((url, index) => (
            // 눌러서 새 탭에서 원본 크기로 본다(숨김 사유 확인용).
            <a key={url} href={url} target="_blank" rel="noopener noreferrer">
              {/* biome-ignore lint/performance/noImgElement: 한 시간짜리 서명 URL이라 next/image 최적화 대상이 아니다. */}
              <img
                src={url}
                alt={`${review.authorName} 후기 사진 ${index + 1}`}
                loading="lazy"
                width={64}
                height={64}
                style={{ borderRadius: 8, height: 64, objectFit: 'cover', width: 64 }}
              />
            </a>
          ))}
        </Group>
      )}
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
