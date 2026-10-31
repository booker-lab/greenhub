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

function LoadingButton({
  loading = false,
  disabled,
  size = 'default',
  className,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { loading?: boolean }) {
  if (!loading) {
    return (
      <Button size={size} disabled={disabled} className={className} {...props}>
        {children}
      </Button>
    );
  }
  const px = LOADER_PX[size as keyof typeof LOADER_PX] ?? LOADER_PX.default;
  return (
    <Button
      size={size}
      disabled
      focusableWhenDisabled
      data-loading=""
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
        style={
          { '--loader-size': `${px}px`, '--loader-border': `${px / 8}px` } as React.CSSProperties
        }
      />
    </Button>
  );
}

export { LoadingButton };
