import type { ComponentProps } from 'react';

import { cn } from '../lib/utils';

// ② 방향(design-direction.md §5 어드민 "상태", §8 D7·2026-11-01 판매자 통일): 상태는 배지 면 없이 점 + 글자 하나로 쓴다.
// - problem(문제: 배송 보류·환불 실패·계좌 미등록·정지) = 빨강 점과 빨강 글자
// - done(끝남: 취소·결제 대기 같은 끝났거나 멈춘 상태) = 회색 점과 회색 글자
// - default(나머지) = 검정 점과 검정 글자
// 점은 꾸밈이라 화면 읽기에서 빼고(aria-hidden), 뜻은 글자가 전한다. 글자는 줄을 바꾸지 않는다.
// 판매자·어드민이 함께 쓴다. 기존 Badge 기본값은 바꾸지 않는다.

export type StatusDotTone = 'default' | 'problem' | 'done';

const TONE_TEXT: Record<StatusDotTone, string> = {
  default: 'text-foreground',
  problem: 'text-destructive',
  // --color-text-secondary(#6B716E): 흰 종이·틀 바탕 위 대비 4.5:1 이상. --color-text-disabled는 대비가 모자라 쓰지 않는다.
  done: 'text-[var(--color-text-secondary)]',
};

const SIZE: Record<13 | 15, { text: string; dot: string }> = {
  13: { text: 'text-[13px] leading-[18px]', dot: 'size-1.5' },
  15: { text: 'text-[15px] leading-[22px]', dot: 'size-[7px]' },
};

export function StatusDot({
  tone = 'default',
  size = 15,
  className,
  children,
  ...props
}: ComponentProps<'span'> & {
  tone?: StatusDotTone;
  /** 글자 크기(px). 목록 보조 줄은 13, 표 칸은 15. */
  size?: 13 | 15;
}) {
  const s = SIZE[size];
  return (
    <span
      data-slot="status-dot"
      data-tone={tone}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap',
        s.text,
        TONE_TEXT[tone],
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className={cn('shrink-0 rounded-full bg-current', s.dot)} />
      {children}
    </span>
  );
}
