'use client';

import { Loader } from '@greenhub/ui/components/loader';
import type { CSSProperties } from 'react';

// ① 외형 유지(UI 교체 P4): Mantine Button loading. 면색을 그대로 두고(disabled 회색으로 바꾸지 않음) 글자를 숨긴 채,
// 흐린 흰 덮개(15%·blur 12px) 위 가운데에 원(높이 ÷ 1.8, 테두리 ÷ 8)을 돌린다. 원은 Mantine 전환처럼
// 따로 합성해 그린다(will-change: transform). 정산 LoadMoreButton(#718)과 같은 방식이다.
const OVERLAY =
  "before:pointer-events-none before:absolute before:inset-[-1px] before:rounded-xl before:bg-white/15 before:blur-[12px] before:content-[''] [&_[data-slot=button-label]]:translate-y-full [&_[data-slot=button-label]]:opacity-0";

/** 버튼 변형별 불러오는 중 클래스(면·글자색은 그 변형 그대로). */
export const BUTTON_LOADING = {
  default: `${OVERLAY} disabled:bg-primary disabled:text-primary-foreground`,
  destructive: `${OVERLAY} disabled:bg-[#fa5252] disabled:text-white`,
  ghost: `${OVERLAY} disabled:bg-transparent disabled:text-[#212529]`,
} as const;

const LOADER_COLOR: Record<keyof typeof BUTTON_LOADING, string> = {
  default: '#ffffff',
  destructive: '#ffffff',
  ghost: '#212529',
};

/** Mantine Button 안 Loader(크기 = 버튼 높이 ÷ 1.8). height는 버튼 높이(px)다. */
export function ButtonLoader({
  variant,
  height,
}: {
  variant: keyof typeof BUTTON_LOADING;
  height: number;
}) {
  const size = height / 1.8;
  return (
    <span
      aria-hidden
      className="absolute top-1/2 left-1/2 [transform:translate(-50%,calc(-50%+1px))] will-change-transform"
    >
      <Loader
        color={LOADER_COLOR[variant]}
        style={
          { '--loader-size': `${size}px`, '--loader-border': `${size / 8}px` } as CSSProperties
        }
      />
    </span>
  );
}
