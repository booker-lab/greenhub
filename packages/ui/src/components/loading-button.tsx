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
// ④ 원을 글자 앞에 두고, 마우스 올림 없이(pointer-events: none) 면·글자색은 변형 그대로 둔다.
// 처리 중에도 버튼은 초점을 잃지 않는다(focusableWhenDisabled = aria-disabled, 진짜 disabled 아님). 진짜 disabled면
// 누른 버튼에 있던 초점이 문서(body)로 빠져, 창 안에서 누르면 초점이 창 밖으로 나갔다(Mantine Button loading도 같았다).
// 누름은 Base UI가 막는다. 진짜 disabled가 아니므로 Button의 disabled 회색도 걸리지 않는다.
// 버튼 바로 아래 아이콘(svg)도 글자처럼 내려 감춘다. Mantine Button loading은 글자·아이콘이 든 안쪽 칸(inner)을 통째로
// 내려 감추므로 아이콘만 남는 일이 없다(운영 확인 새로고침 아이콘이 원 뒤에 보이던 차이).
const MEASURED =
  "pointer-events-none before:pointer-events-none before:absolute before:inset-[-1px] before:rounded-[inherit] before:bg-white/15 before:blur-[12px] before:content-[''] [&_[data-slot=button-label]]:translate-y-full [&_[data-slot=button-label]]:opacity-0 [&>svg]:translate-y-full [&>svg]:opacity-0";
// ③의 따로 합성은 창(role=dialog) 밖에서만 한다. Mantine Modal 안의 Button loading 원은 따로 합성되지 않은 모양이고(실측),
// 창 안에서 원을 따로 합성하면 촬영(Playwright animations: 'disabled')이 무한 회전을 취소해도 합성 층에 돌던 각도가
// 남아 찍혔다(회차 복사·해결로 닫기 처리 중). 창 밖은 따로 합성해야 Mantine과 같고 취소도 반영된다.
const MEASURED_LOADER =
  'absolute top-1/2 left-1/2 [transform:translate(-50%,calc(-50%+1px))] will-change-transform [[role=dialog]_&]:will-change-auto';

// measured를 쓸 수 있는 변형(판매자 화면에서 Mantine과 실측으로 맞춘 것).
type MeasuredVariant = 'default' | 'light' | 'light-green' | 'secondary' | 'ghost' | 'destructive';

type LoadingButtonProps = React.ComponentProps<typeof Button> & {
  loading?: boolean;
  /** 버튼 높이를 className으로 바꾼 경우의 실제 높이(px). 원 크기 = 높이 ÷ 1.8. 주지 않으면 size로 정한다. */
  buttonHeight?: number;
} & ({ measured?: false } | { measured: true; variant?: MeasuredVariant });

function loaderStyle(px: number) {
  return { '--loader-size': `${px}px`, '--loader-border': `${px / 8}px` } as React.CSSProperties;
}

function LoadingButton({
  loading = false,
  disabled,
  size = 'default',
  buttonHeight,
  measured,
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
    return (
      <Button
        size={size}
        disabled
        focusableWhenDisabled
        data-loading=""
        aria-busy
        className={cn(MEASURED, className)}
        {...props}
      >
        <span aria-hidden className={MEASURED_LOADER}>
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
