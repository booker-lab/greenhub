import {
  type ManagedReview,
  REVIEW_HIDE_REASON_MAX_LENGTH,
  type ReviewModeratorRole,
} from '@greenhub/shared';

// 고객 반응 → 후기 탭의 순수 판단(숨김 제외 별점, 숨김 사유 확인, 숨김 안내 문구).

export const MODERATOR_LABEL: Record<ReviewModeratorRole, string> = {
  seller: '판매자',
  admin: '관리자',
};

/** 고객에게 보이는 후기(숨기지 않은 후기)만으로 낸 평균·개수. 공개 별점과 같은 기준이다. */
export function visibleReviewSummary(reviews: readonly ManagedReview[]): {
  count: number;
  average: number | null;
  hiddenCount: number;
} {
  const visible = reviews.filter((review) => !review.hidden);
  const average =
    visible.length > 0
      ? Math.round(
          (visible.reduce((sum, review) => sum + review.rating, 0) / visible.length) * 10,
        ) / 10
      : null;
  return { count: visible.length, average, hiddenCount: reviews.length - visible.length };
}

/** 숨기는 사유 확인. 문제가 없으면 null. */
export function hideReasonError(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return '숨기는 사유를 적어 주세요.';
  if (Array.from(trimmed).length > REVIEW_HIDE_REASON_MAX_LENGTH) {
    return `사유는 ${REVIEW_HIDE_REASON_MAX_LENGTH}자까지 적을 수 있어요.`;
  }
  return null;
}

const kstDay = (iso: string) =>
  new Date(iso).toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Seoul',
  });

/** "판매자가 10월 18일 숨김" 같은 안내. 숨기지 않은 후기는 null. */
export function hiddenSummary(review: ManagedReview): string | null {
  if (!review.hidden) return null;
  const who = review.hiddenByRole ? `${MODERATOR_LABEL[review.hiddenByRole]}가` : '';
  const when = review.hiddenAt ? kstDay(review.hiddenAt) : '';
  return [who, when, '숨김'].filter(Boolean).join(' ');
}

/** 서버가 돌려준 후기로 목록의 같은 후기를 바꾼다. */
export function replaceReview(
  list: readonly ManagedReview[],
  updated: ManagedReview,
): ManagedReview[] {
  return list.map((review) => (review.id === updated.id ? updated : review));
}
