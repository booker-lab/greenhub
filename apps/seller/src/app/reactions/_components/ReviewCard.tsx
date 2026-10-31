import { type ManagedReview, REVIEW_HIDE_REASON_MAX_LENGTH } from '@greenhub/shared';
import { Badge } from '@greenhub/ui/components/badge';
import { Button } from '@greenhub/ui/components/button';
import { Field, FieldLabel } from '@greenhub/ui/components/field';
import { Textarea } from '@greenhub/ui/components/textarea';
import { useId } from 'react';
import { BUTTON_LOADING, ButtonLoader } from '../../orders/[id]/_components/ButtonLoading';
import { HIDE_POLICY_NOTE, HIDE_REASON_OPTIONS, hiddenReasonLabel, hiddenSummary } from '../_lib';

// 후기 한 건. 숨기기(사유 고르기·설명 선택)와 숨김 상태를 보여준다. 상태는 부모(page)가 가진다.
// 숨김 해제는 관리자 콘솔에서만 한다(판매자 화면에는 버튼이 없다).

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Seoul',
  });

export interface ReviewCardProps {
  review: ManagedReview;
  /** 이 후기의 숨김 사유를 고르는 중인지 */
  editing: boolean;
  reasonCode: string | null;
  note: string;
  busy: boolean;
  error: string | null;
  onStartHide: () => void;
  onReasonChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onCancel: () => void;
  onConfirmHide: () => void;
}

// ① 외형 유지(UI 교체 P4): Mantine Paper(radius lg = 16px, shadow xs, p md)·Group·Stack·Text(p, 여백 0)와 같은 값.
// Text size="sm"은 15px·줄 높이 1.45(text-sm), 기본은 16px·1.55다. Badge filled gray sm(높이 18·10px·좌우 8),
// Button compact-sm(높이 26·좌우 8·15px), variant default(흰 면·gray-4 테두리·검정 글자),
// Radio.Group(라벨 600 + 필수 표시 red-6)·Radio sm은 어드민 배송 후 환불 확인창(#714)과 같은 계산값이다.
const TEXT = 'm-0 p-0 font-normal';
const TEXT_MD = `${TEXT} text-base`;
const TEXT_SM = `${TEXT} text-sm`;
const COMPACT_SM = 'h-[26px] px-2 text-[15px]';
const DEFAULT_BUTTON = 'border-[#ced4da] bg-white text-black hover:bg-[#f8f9fa]';
const GROUP_LABEL =
  'inline-block cursor-default text-sm/[1.55] font-semibold break-words text-black';

export function RadioItem({
  name,
  label,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  const id = useId();
  return (
    <div className="flex [-webkit-tap-highlight-color:transparent]">
      <div className="relative order-1 size-5">
        <input
          id={id}
          type="radio"
          name={name}
          checked={checked}
          onChange={onChange}
          className="peer relative m-0 flex size-5 cursor-default appearance-none items-center justify-center rounded-[20px] border border-solid border-[#ced4da] bg-white transition-[background-color,border-color] duration-100 ease-[ease] checked:border-primary checked:bg-primary [-webkit-tap-highlight-color:transparent]"
        />
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 5 5"
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 size-2 text-white opacity-0 transition-[opacity,transform] duration-[100ms,200ms] ease-[ease] [transform:scale(0.2)_translateY(10px)] [translate:-50%_-50%] peer-checked:opacity-100 peer-checked:[transform:scale(1)]"
        >
          <circle cx="2.5" cy="2.5" r="2.5" fill="currentColor" />
        </svg>
      </div>
      <div className="order-2 inline-flex cursor-default flex-col text-sm/[20px] [-webkit-tap-highlight-color:transparent]">
        <label htmlFor={id} className="block cursor-default ps-3 text-inherit">
          {label}
        </label>
      </div>
    </div>
  );
}

export function ReviewCard({
  review,
  editing,
  reasonCode,
  note,
  busy,
  error,
  onStartHide,
  onReasonChange,
  onNoteChange,
  onCancel,
  onConfirmHide,
}: ReviewCardProps) {
  const summary = hiddenSummary(review);
  const reasonLabel = hiddenReasonLabel(review);
  // 부모 목록 안에서 후기마다 다른 id(후기 id는 주문·상품 id라 안전한 글자만 쓴다).
  const reasonLabelId = `review-${review.id}-reason-label`;
  const reasonName = `review-${review.id}-reason`;
  const noteId = `review-${review.id}-note`;
  return (
    <div
      className="block rounded-[16px] bg-white p-4 shadow-mantine-xs"
      style={review.hidden ? { background: 'var(--color-surface-muted)' } : undefined}
    >
      <div className="flex flex-row flex-nowrap items-center justify-between gap-4">
        <div className="flex flex-row flex-nowrap items-center justify-start gap-1.5">
          <p
            className={`${TEXT_MD} font-bold`}
            style={{
              color: review.hidden ? 'var(--color-text-secondary)' : 'var(--color-primary-dark)',
            }}
          >
            {'★'.repeat(review.rating)}
          </p>
          {review.hidden && (
            <Badge
              variant="secondary"
              className="h-[18px] rounded-[16px] bg-[#868e96] px-2 text-[10px] leading-4 text-white"
            >
              숨김
            </Badge>
          )}
        </div>
        <p className={TEXT_SM} style={{ color: 'var(--color-text-secondary)' }}>
          {review.authorName} · {day(review.createdAt)}
        </p>
      </div>
      <p
        className={`${TEXT_SM} mt-1`}
        style={{
          color: review.hidden ? 'var(--color-text-secondary)' : undefined,
          whiteSpace: 'pre-wrap',
        }}
      >
        {review.text}
      </p>
      {review.photoUrls && review.photoUrls.length > 0 && (
        <div className="mt-1.5 flex flex-row flex-nowrap items-center justify-start gap-1.5">
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
        </div>
      )}

      {summary && (
        <div className="mt-2 flex flex-col gap-0">
          <p className={`${TEXT_SM} font-bold`}>{summary} · 고객 화면과 별점에서 빠졌어요</p>
          {reasonLabel && (
            <p className={TEXT_SM} style={{ color: 'var(--color-text-secondary)' }}>
              사유: {reasonLabel}
              {review.hiddenNote ? ` · ${review.hiddenNote}` : ''}
            </p>
          )}
          <p className={TEXT_SM} style={{ color: 'var(--color-text-secondary)' }}>
            다시 보이게 하려면 관리자에게 요청해 주세요.
          </p>
        </div>
      )}

      {!review.hidden &&
        (editing ? (
          <div className="mt-2 flex flex-col gap-2">
            <p className={TEXT_SM} style={{ color: 'var(--color-text-secondary)' }}>
              {HIDE_POLICY_NOTE}
            </p>
            <div>
              <div id={reasonLabelId} className={GROUP_LABEL}>
                숨기는 사유
                <span className="text-[#fa5252]" aria-hidden>
                  {' *'}
                </span>
              </div>
              <div role="radiogroup" aria-labelledby={reasonLabelId} aria-required>
                <div className="mt-1 flex flex-col gap-1.5">
                  {HIDE_REASON_OPTIONS.map((option) => (
                    <RadioItem
                      key={option.value}
                      name={reasonName}
                      label={option.label}
                      checked={reasonCode === option.value}
                      onChange={() => onReasonChange(option.value)}
                    />
                  ))}
                </div>
              </div>
            </div>
            <Field>
              <FieldLabel htmlFor={noteId}>설명(선택)</FieldLabel>
              <Textarea
                id={noteId}
                placeholder="관리자에게 남길 설명이 있으면 적어 주세요. 고객에게는 보이지 않아요."
                maxLength={REVIEW_HIDE_REASON_MAX_LENGTH}
                autosize
                minRows={2}
                value={note}
                onChange={(event) => onNoteChange(event.currentTarget.value)}
              />
            </Field>
            <div className="flex flex-row flex-wrap items-center justify-end gap-2.5">
              <Button
                variant="secondary"
                className={`${COMPACT_SM} ${DEFAULT_BUTTON}`}
                disabled={busy}
                onClick={onCancel}
              >
                취소
              </Button>
              <Button
                variant="destructive"
                className={`${COMPACT_SM} ${busy ? BUTTON_LOADING.destructive : ''}`}
                disabled={busy || !reasonCode}
                data-loading={busy || undefined}
                aria-busy={busy || undefined}
                onClick={onConfirmHide}
              >
                {busy && <ButtonLoader variant="destructive" height={26} />}
                숨기기 확인
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex flex-row flex-wrap items-center justify-end gap-4">
            <Button
              variant="subtle-destructive"
              className={COMPACT_SM}
              disabled={busy}
              onClick={onStartHide}
            >
              숨기기
            </Button>
          </div>
        ))}

      {error && (
        <p role="alert" className={`${TEXT_SM} mt-1.5`} style={{ color: 'var(--color-danger)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
