'use client';

import { Button } from '@greenhub/ui/components/button';
import { Loader } from '@greenhub/ui/components/loader';
import type * as React from 'react';

// ① 외형 유지(UI 교체 P4): Mantine Button loading. 면색을 그대로 두고 글자를 숨긴 채, 흐린 흰 덮개(15%·blur 12px)
// 위 가운데에 버튼 높이 ÷ 1.8 크기의 원(테두리 = 크기 ÷ 8)을 돌린다. 어드민 정산 LoadMoreButton(#718)과 같은 모양이다.
const LOADING =
  "disabled:bg-(--loading-bg) disabled:text-(--loading-fg) before:pointer-events-none before:absolute before:inset-[-1px] before:rounded-xl before:bg-white/15 before:blur-[12px] before:content-[''] [&_[data-slot=button-label]]:translate-y-full [&_[data-slot=button-label]]:opacity-0";

// 변형별 면·글자색(packages/ui Button과 같은 값).
const COLORS = {
  default: { bg: 'var(--color-primary)', fg: 'var(--color-primary-foreground)' },
  'light-green': { bg: '#d3f9d8', fg: '#2b8a3e' },
  secondary: { bg: '#f1f3f5', fg: '#212529' },
} as const;

// Mantine Button 높이(sm 36·md 42) ÷ 1.8.
const LOADER_SIZE = { default: 20, md: 42 / 1.8 } as const;

export function LoadingButton({
  loading,
  variant = 'default',
  size = 'default',
  className,
  style,
  disabled,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'variant' | 'size'> & {
  loading: boolean;
  variant?: keyof typeof COLORS;
  size?: keyof typeof LOADER_SIZE;
}) {
  const color = COLORS[variant];
  const loader = LOADER_SIZE[size];
  return (
    <Button
      {...props}
      variant={variant}
      size={size}
      disabled={loading || disabled}
      data-loading={loading || undefined}
      className={loading ? `${LOADING} ${className ?? ''}` : className}
      style={
        { ...style, '--loading-bg': color.bg, '--loading-fg': color.fg } as React.CSSProperties
      }
    >
      {loading && (
        <span
          aria-hidden
          className="absolute top-1/2 left-1/2 [transform:translate(-50%,calc(-50%+1px))] will-change-transform"
        >
          <Loader
            color={color.fg}
            style={
              {
                '--loader-size': `${loader}px`,
                '--loader-border': `${loader / 8}px`,
              } as React.CSSProperties
            }
          />
        </span>
      )}
      {children}
    </Button>
  );
}
