import type { AdminHiddenReview } from '@greenhub/shared';
import { hiddenReasonLabel, MODERATOR_LABEL } from '../../../reactions/_lib';
import { formatAdminDate } from '../../_components/adminFormat';
import { ADMIN_TEXT_ACTION } from '../../_components/adminList';

// 관리자 콘솔 숨긴 후기 한 건: 가게·상품·별점·내용·사유·설명·숨긴 사람/시각과 숨김 해제 버튼.

// 어드민 목록 규칙(design-direction.md §5): 그림자 없는 줄 목록 한 행, 날짜는 어드민 형식(2026-10-03),
// 이 화면의 단 하나뿐인 동작 "숨김 해제"는 검정 밑줄 글자 버튼. 글자 크기는 Mantine Text 값을 그대로 둔다.
const TEXT = 'm-0 p-0 text-base';
const TEXT_SM = 'm-0 p-0 text-sm';
const SECONDARY = { color: 'var(--color-text-secondary)' };

/** 별점을 숫자와 함께 보여 준다(예: ★4/5). 별만 반복하면 1점과 2점을 한눈에 구분하기 어렵다. */
export const ratingLabel = (rating: number) => `★${rating}/5`;

/**
 * "판매자가 2026-10-03 숨김" — 판매자 반응 화면의 hiddenSummary와 같은 뜻을 어드민 날짜 형식으로 쓴다.
 * 한 행에 날짜 형식이 둘이 되지 않게 어드민 카드 안에서만 만든다(2026-11-20 사용자 결정, 판매자 화면은 그대로).
 */
export function adminHiddenSummary(
  review: Pick<AdminHiddenReview, 'hidden' | 'hiddenByRole' | 'hiddenAt'>,
): string | null {
  if (!review.hidden) return null;
  const who = review.hiddenByRole ? `${MODERATOR_LABEL[review.hiddenByRole]}가` : '';
  const when = formatAdminDate(review.hiddenAt) ?? '';
  return [who, when, '숨김'].filter(Boolean).join(' ');
}

export interface HiddenReviewCardProps {
  review: AdminHiddenReview;
  busy: boolean;
  error: string | null;
  onUnhide: () => void;
}

export function HiddenReviewCard({ review, busy, error, onUnhide }: HiddenReviewCardProps) {
  const reason = hiddenReasonLabel(review) ?? '사유 없음';
  return (
    <div className="block border-b border-rule py-3 [word-break:keep-all]">
      <div className="flex flex-row flex-nowrap items-start justify-between gap-4">
        <div className="flex flex-col gap-0">
          <p className={`${TEXT} font-bold`}>{review.storeName ?? review.storeId}</p>
          <p className={TEXT_SM} style={SECONDARY}>
            {review.productName ?? '삭제된 상품'}
          </p>
        </div>
        <p className={TEXT_SM} style={{ ...SECONDARY, flexShrink: 0 }}>
          {[review.authorName, formatAdminDate(review.createdAt)].filter(Boolean).join(' · ')}
        </p>
      </div>
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: Mantine Text(p)에 붙어 있던 별점 읽기 이름을 그대로 둔다. */}
      <p
        className={`${TEXT} mt-1.5 font-bold`}
        style={SECONDARY}
        aria-label={`별점 5점 중 ${review.rating}점`}
      >
        {ratingLabel(review.rating)}
      </p>
      <p
        className={`${TEXT_SM} mt-0.5`}
        style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
      >
        {review.text}
      </p>
      {review.photoUrls && review.photoUrls.length > 0 && (
        <div
          className="mt-1.5 flex flex-row flex-nowrap items-center justify-start gap-1.5"
          style={{ overflowX: 'auto' }}
        >
          {review.photoUrls.map((url, index) => (
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
        </div>
      )}
      <div className="mt-2 flex flex-col gap-0">
        <p className={`${TEXT_SM} font-bold`}>사유: {reason}</p>
        {review.hiddenNote && (
          <p className={TEXT_SM} style={SECONDARY}>
            설명: {review.hiddenNote}
          </p>
        )}
        <p className={TEXT_SM} style={SECONDARY}>
          {adminHiddenSummary(review)}
        </p>
      </div>
      <div className="flex flex-row flex-wrap items-center justify-end gap-4">
        <button type="button" onClick={onUnhide} disabled={busy} className={ADMIN_TEXT_ACTION}>
          {busy ? '처리 중…' : '숨김 해제'}
        </button>
      </div>
      {error && (
        <p role="alert" className={`${TEXT_SM} mt-1.5`} style={{ color: 'var(--color-danger)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
