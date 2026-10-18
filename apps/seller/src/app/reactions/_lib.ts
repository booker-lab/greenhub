import {
  type HideReviewRequest,
  type ManagedReview,
  REVIEW_HIDE_REASON_LABELS,
  REVIEW_HIDE_REASON_MAX_LENGTH,
  REVIEW_HIDE_REASONS,
  type ReviewHideReason,
  type ReviewModeratorRole,
} from '@greenhub/shared';

// 고객 반응 → 후기 탭(과 관리자 후기 화면)의 순수 판단: 숨김 제외 별점, 숨김 사유 확인, 숨김 안내 문구.

export const MODERATOR_LABEL: Record<ReviewModeratorRole, string> = {
  seller: '판매자',
  admin: '관리자',
};

/** 숨김 창 안내. 숨김은 정해진 사유에만 쓰고, 불만·낮은 별점은 숨길 수 없다. */
export const HIDE_POLICY_NOTE =
  '불만이나 낮은 별점이라는 이유로는 숨길 수 없어요. 아래 사유에 해당할 때만 숨겨 주세요. 숨긴 후기는 관리자만 다시 보이게 할 수 있어요.';

export const HIDE_REASON_OPTIONS: ReadonlyArray<{ value: ReviewHideReason; label: string }> =
  REVIEW_HIDE_REASONS.map((value) => ({ value, label: REVIEW_HIDE_REASON_LABELS[value] }));

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

/** 숨기기 입력 확인 후 요청 본문을 만든다. 문제가 있으면 error 문구를 돌려준다. */
export function buildHideRequest(
  reasonCode: string | null,
  note: string,
): { body: HideReviewRequest; error: null } | { body: null; error: string } {
  if (!reasonCode || !(REVIEW_HIDE_REASONS as readonly string[]).includes(reasonCode)) {
    return { body: null, error: '숨기는 사유를 골라 주세요.' };
  }
  const trimmed = note.trim();
  if (Array.from(trimmed).length > REVIEW_HIDE_REASON_MAX_LENGTH) {
    return { body: null, error: `설명은 ${REVIEW_HIDE_REASON_MAX_LENGTH}자까지 적을 수 있어요.` };
  }
  const body: HideReviewRequest = { reasonCode: reasonCode as ReviewHideReason };
  if (trimmed) body.note = trimmed;
  return { body, error: null };
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

/** 숨김 사유 분류 이름. 분류가 없으면(예전 데이터) null. */
export function hiddenReasonLabel(review: Pick<ManagedReview, 'hiddenReasonCode'>): string | null {
  return review.hiddenReasonCode ? REVIEW_HIDE_REASON_LABELS[review.hiddenReasonCode] : null;
}

/** 서버가 돌려준 후기로 목록의 같은 후기를 바꾼다. */
export function replaceReview<T extends ManagedReview>(list: readonly T[], updated: T): T[] {
  return list.map((review) => (review.id === updated.id ? updated : review));
}
