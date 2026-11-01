import type * as React from 'react';

import { cn } from '../lib/utils';
import { Button } from './button';
import { Loader } from './loader';

// ① 외형 유지: Mantine Button loading. 변형 색은 그대로 두고(비활성 회색이 아님) 위에 흰 15% 막을 덮고,
// 글자를 아래로 내려 감춘 뒤 가운데에 글자색 Loader(버튼 높이 ÷ 1.8)를 둔다. 누를 수 없고 커서는 not-allowed다.
// loading이 아니면 Button과 같다.
const LOADER_PX = {
  default: 20,
  xs: 30 / 1.8,
  sm: 30 / 1.8,
  md: 42 / 1.8,
  lg: 50 / 1.8,
  'compact-xs': 22 / 1.8,
  'compact-sm': 26 / 1.8,
} as const;

// measured: 판매자 앱에서 Mantine 계산값과 실측으로 맞춘 모양(#718 정산 더 보기). 기본 모양과 네 가지가 다르다.
// ① 덮개를 12px 흐리게(blur) ② 원을 1px 아래(translate(-50%, calc(-50% + 1px))) ③ 원을 따로 합성(will-change: transform)
// ④ 원을 글자 앞에 두고, 버튼은 진짜 disabled(마우스 올림 없음)로 두되 면·글자색은 변형 그대로 둔다.
// hideIcons를 주면 버튼 바로 아래 아이콘(svg)도 글자처럼 내려 감춘다(회차 저장). 주지 않으면 아이콘은 보인 채 남는다.
const MEASURED =
  "before:pointer-events-none before:absolute before:inset-[-1px] before:rounded-[inherit] before:bg-white/15 before:blur-[12px] before:content-[''] [&_[data-slot=button-label]]:translate-y-full [&_[data-slot=button-label]]:opacity-0";
const MEASURED_HIDE_ICONS = '[&>svg]:translate-y-full [&>svg]:opacity-0';

// measured에서 disabled 회색 대신 남길 변형별 면·글자색(Button 변형과 같은 값).
const MEASURED_COLORS = {
  default: 'disabled:bg-primary disabled:text-primary-foreground',
  light: 'disabled:bg-[#d2f2df] disabled:text-[#005c32]',
  'light-green': 'disabled:bg-[#d3f9d8] disabled:text-[#2b8a3e]',
  secondary: 'disabled:bg-[#f1f3f5] disabled:text-[#212529]',
  ghost: 'disabled:bg-transparent disabled:text-[#212529]',
  destructive: 'disabled:bg-[#fa5252] disabled:text-white',
} as const;

type MeasuredVariant = keyof typeof MEASURED_COLORS;

type LoadingButtonProps = React.ComponentProps<typeof Button> & {
  loading?: boolean;
  /** 버튼 높이를 className으로 바꾼 경우의 실제 높이(px). 원 크기 = 높이 ÷ 1.8. 주지 않으면 size로 정한다. */
  buttonHeight?: number;
} & (
    | { measured?: false; hideIcons?: never }
    | { measured: true; variant?: MeasuredVariant; hideIcons?: boolean }
  );

function loaderStyle(px: number) {
  return { '--loader-size': `${px}px`, '--loader-border': `${px / 8}px` } as React.CSSProperties;
}

function LoadingButton({
  loading = false,
  disabled,
  size = 'default',
  buttonHeight,
  measured,
  hideIcons,
  className,
  children,
  ...props
}: LoadingButtonProps) {
  if (!loading) {
    return (
      <Button size={size} disabled={disabled} className={className} {...props}>
        {children}
      </Button>
    );
  }
  const px =
    buttonHeight !== undefined
      ? buttonHeight / 1.8
      : (LOADER_PX[size as keyof typeof LOADER_PX] ?? LOADER_PX.default);
  if (measured) {
    const variant = (props.variant ?? 'default') as MeasuredVariant;
    return (
      <Button
        size={size}
        disabled
        data-loading=""
        aria-busy
        className={cn(
          MEASURED,
          hideIcons && MEASURED_HIDE_ICONS,
          MEASURED_COLORS[variant],
          className,
        )}
        {...props}
      >
        <span
          aria-hidden
          className="absolute top-1/2 left-1/2 [transform:translate(-50%,calc(-50%+1px))] will-change-transform"
        >
          <Loader color="currentColor" style={loaderStyle(px)} />
        </span>
        {children}
      </Button>
    );
  }
  return (
    <Button
      size={size}
      disabled
      focusableWhenDisabled
      data-loading=""
      aria-busy
      className={cn(
        "cursor-not-allowed before:absolute before:-inset-px before:rounded-[inherit] before:bg-white/15 before:content-['']",
        className,
      )}
      {...props}
    >
      {/* Mantine: 글자 칸(inner)은 opacity 0·translateY(100%)로 아래로 내려 감춘다(읽기 도구에는 남는다). */}
      <span className="flex h-full translate-y-full items-center opacity-0">{children}</span>
      <Loader
        color="currentColor"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={loaderStyle(px)}
      />
    </Button>
  );
}

export { LoadingButton };
