import { type ManagedReview, REVIEW_HIDE_REASON_MAX_LENGTH } from '@greenhub/shared';
import { Badge, Button, Group, Paper, Stack, Text, Textarea } from '@mantine/core';
import { hiddenSummary } from '../_lib';

// 후기 한 건. 숨기기(사유 입력)·숨김 해제 버튼과 숨김 상태를 보여준다. 상태는 부모(page)가 가진다.

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Seoul',
  });

export interface ReviewCardProps {
  review: ManagedReview;
  /** 이 후기의 숨김 사유를 적는 중인지 */
  editing: boolean;
  reason: string;
  busy: boolean;
  error: string | null;
  onStartHide: () => void;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onConfirmHide: () => void;
  onUnhide: () => void;
}

export function ReviewCard({
  review,
  editing,
  reason,
  busy,
  error,
  onStartHide,
  onReasonChange,
  onCancel,
  onConfirmHide,
  onUnhide,
}: ReviewCardProps) {
  const summary = hiddenSummary(review);
  return (
    <Paper
      radius="lg"
      shadow="xs"
      p="md"
      style={review.hidden ? { background: 'var(--color-surface-muted)' } : undefined}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap={6} wrap="nowrap">
          <Text
            fw={700}
            c={review.hidden ? 'var(--color-text-secondary)' : 'var(--color-primary-dark)'}
          >
            {'★'.repeat(review.rating)}
          </Text>
          {review.hidden && (
            <Badge color="gray" variant="filled" size="sm">
              숨김
            </Badge>
          )}
        </Group>
        <Text size="sm" c="var(--color-text-secondary)">
          {review.authorName} · {day(review.createdAt)}
        </Text>
      </Group>
      <Text
        size="sm"
        mt={4}
        c={review.hidden ? 'var(--color-text-secondary)' : undefined}
        style={{ whiteSpace: 'pre-wrap' }}
      >
        {review.text}
      </Text>
      {review.photoUrls && review.photoUrls.length > 0 && (
        <Group gap={6} mt={6} wrap="nowrap">
          {review.photoUrls.map((url, index) => (
            // biome-ignore lint/performance/noImgElement: 한 시간짜리 서명 URL이라 next/image 최적화 대상이 아니다.
            <img
              key={url}
              src={url}
              alt={`${review.authorName} 후기 사진 ${index + 1}`}
              loading="lazy"
              width={64}
              height={64}
              style={{ borderRadius: 8, height: 64, objectFit: 'cover', width: 64 }}
            />
          ))}
        </Group>
      )}

      {summary && (
        <Stack gap={0} mt={8}>
          <Text size="sm" fw={700}>
            {summary} · 고객 화면과 별점에서 빠졌어요
          </Text>
          {review.hiddenReason && (
            <Text size="sm" c="var(--color-text-secondary)">
              사유: {review.hiddenReason}
            </Text>
          )}
        </Stack>
      )}

      {editing && !review.hidden ? (
        <Stack gap={6} mt={8}>
          <Textarea
            aria-label="숨기는 사유"
            placeholder="예: 상품과 관계없는 광고 글"
            maxLength={REVIEW_HIDE_REASON_MAX_LENGTH}
            autosize
            minRows={2}
            value={reason}
            onChange={(event) => onReasonChange(event.currentTarget.value)}
          />
          <Group gap="xs" justify="flex-end">
            <Button
              variant="default"
              radius="xl"
              size="compact-sm"
              disabled={busy}
              onClick={onCancel}
            >
              취소
            </Button>
            <Button
              color="red"
              radius="xl"
              size="compact-sm"
              loading={busy}
              onClick={onConfirmHide}
            >
              숨기기 확인
            </Button>
          </Group>
        </Stack>
      ) : (
        <Group justify="flex-end" mt={8}>
          {review.hidden ? (
            <Button variant="light" radius="xl" size="compact-sm" loading={busy} onClick={onUnhide}>
              숨김 해제
            </Button>
          ) : (
            <Button
              variant="subtle"
              color="red"
              radius="xl"
              size="compact-sm"
              disabled={busy}
              onClick={onStartHide}
            >
              숨기기
            </Button>
          )}
        </Group>
      )}

      {error && (
        <Text role="alert" size="sm" mt={6} c="var(--color-danger)">
          {error}
        </Text>
      )}
    </Paper>
  );
}
