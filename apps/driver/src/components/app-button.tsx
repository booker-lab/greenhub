import { Button } from '@greenhub/ui/components/button';
import { cn } from '@greenhub/ui/lib/utils';
import type * as React from 'react';
import { Spinner } from './spinner';

// ① 외형 유지(ui-stack-migration-plan.md §7): packages/ui Button에 Mantine Button(theme.ts의 radius xl)과
// 같은 크기·색·글자 위치를 입힌다. Mantine은 글자 칸을 대문자 높이로 잘라(text-box-trim) 세로 가운데를
// 맞추므로 같은 규칙을 둔다. 화면 방향 적용(②)에서 packages/ui variant로 옮긴다.

const SIZE = {
  xs: { root: 'h-[30px] px-[14px] text-xs', withLeft: 'ps-[calc(14px/1.5)]', loader: 30 / 1.8 },
  sm: { root: 'h-9 px-[18px] text-sm', withLeft: 'ps-[12px]', loader: 36 / 1.8 },
  md: { root: 'h-[42px] px-[22px] text-base', withLeft: 'ps-[calc(22px/1.5)]', loader: 42 / 1.8 },
  lg: { root: 'h-[50px] px-[26px] text-lg', withLeft: 'ps-[calc(26px/1.5)]', loader: 50 / 1.8 },
} as const;

const TONE = {
  brand: 'bg-primary text-white hover:bg-[#008a4b]',
  'brand-outline': 'border-primary bg-transparent text-[#007a43] hover:bg-[rgba(0,166,90,0.05)]',
  'brand-light': 'bg-[#d2f2df] text-[#005c32] hover:bg-[#a6e5c0]',
  red: 'bg-[#fa5252] text-white hover:bg-[#f03e3e]',
  'red-outline': 'border-[#fa5252] bg-transparent text-[#fa5252] hover:bg-[rgba(250,82,82,0.05)]',
  gray: 'bg-[#868e96] text-white hover:bg-[#495057]',
  default: 'border-[#ced4da] bg-white text-black hover:bg-[#f8f9fa]',
  white: 'bg-white text-[#00a65a] hover:bg-white',
  'white-outline': 'border-white bg-transparent text-white hover:bg-[rgba(255,255,255,0.05)]',
} as const;

export type AppButtonTone = keyof typeof TONE;

type CommonProps = {
  tone?: AppButtonTone;
  size?: keyof typeof SIZE;
  fullWidth?: boolean;
  loading?: boolean;
  leftSection?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
};

type ButtonProps = CommonProps & {
  href?: undefined;
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: () => void;
  'aria-label'?: string;
};

type AnchorProps = CommonProps & {
  href: string;
  target?: string;
  rel?: string;
  'aria-label'?: string;
};

function rootClassName({
  tone = 'brand',
  size = 'sm',
  fullWidth,
  loading,
  leftSection,
  disabled,
  className,
}: CommonProps & { disabled?: boolean }) {
  const s = SIZE[size];
  return cn(
    'relative inline-block w-auto cursor-pointer overflow-hidden rounded-full border border-solid border-transparent bg-clip-border py-0 text-center align-middle font-semibold no-underline transition-none select-none disabled:opacity-100',
    s.root,
    // 글자 크기 유틸리티가 줄 높이도 정하므로 크기 뒤에 둔다(Mantine 버튼 줄 높이 1).
    'leading-none',
    TONE[tone],
    leftSection ? s.withLeft : null,
    fullWidth ? 'block w-full' : null,
    // Mantine은 로딩 중인 버튼을 막되 색은 그대로 두고, 위에 흐린 흰 막을 덮는다.
    disabled && !loading
      ? 'cursor-not-allowed border-transparent bg-[#e9ecef] text-[#adb5bd] hover:bg-[#e9ecef]'
      : null,
    // packages/ui Button은 disabled일 때 회색 면을 칠하므로, 로딩 중에는 같은 색을 disabled에도 다시 준다.
    loading
      ? TONE[tone]
          .split(' ')
          .filter((c) => !c.startsWith('hover:'))
          .map((c) => `disabled:${c}`)
          .join(' ')
      : null,
    loading
      ? "cursor-not-allowed before:pointer-events-none before:absolute before:-inset-px before:rounded-[inherit] before:bg-white/15 before:blur-[12px] before:content-['']"
      : null,
    className,
  );
}

function Inner({ size = 'sm', loading, leftSection, children }: CommonProps) {
  return (
    <>
      {loading && (
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-[calc(-50%+1px)]"
        >
          <Spinner size={SIZE[size].loader} className="text-current" />
        </span>
      )}
      <span
        className={cn(
          'flex h-full items-center justify-center overflow-visible',
          loading && 'translate-y-full opacity-0',
        )}
      >
        {leftSection && <span className="me-2.5 flex items-center">{leftSection}</span>}
        <span
          className={cn(
            'flex h-full items-center overflow-hidden whitespace-nowrap [text-box-edge:cap_alphabetic] [text-box-trim:trim-both]',
            loading && 'opacity-20',
          )}
        >
          {children}
        </span>
      </span>
    </>
  );
}

/** Mantine Button과 같은 모양의 버튼. href가 있으면 링크로 그린다. */
export function AppButton(props: ButtonProps | AnchorProps) {
  if (props.href !== undefined) {
    const { href, target, rel, style, 'aria-label': ariaLabel } = props;
    return (
      <a
        href={href}
        target={target}
        rel={rel}
        aria-label={ariaLabel}
        style={style}
        className={rootClassName(props)}
      >
        <Inner {...props} />
      </a>
    );
  }
  const { type = 'button', disabled, loading, onClick, style, 'aria-label': ariaLabel } = props;
  return (
    <Button
      type={type}
      disabled={disabled || loading}
      data-loading={loading || undefined}
      onClick={onClick}
      aria-label={ariaLabel}
      style={style}
      className={rootClassName({ ...props, disabled: disabled || loading })}
    >
      <Inner {...props} />
    </Button>
  );
}
