'use client';

import { Button } from '@greenhub/ui/components/button';
import { cn } from '@greenhub/ui/lib/utils';
import type * as React from 'react';

// ① 외형 유지(UI 교체 P5): 소비자 앱의 Mantine Button loading 모양.
// 소비자 globals.css는 Mantine Loader.css를 불러오지 않아, Button loading의 Loader가 스타일 없는 빈 span으로
// 그려져 보이지 않는다. 그래서 지금 소비자 화면의 loading 버튼은 변형 색 위에 흰 15% 막만 덮이고 글자는 아래로
// 내려가 감춰진 모양이다. packages/ui LoadingButton(Loader 표시)과 달리 그 모양을 그대로 둔다.
// 누를 수 없고(aria-disabled) 커서는 not-allowed다. loading이 아니면 Button과 같다.
// Loader를 보일지는 ② 방향 적용 또는 P6 정리에서 정한다.
function LoadingButton({
  loading = false,
  disabled,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { loading?: boolean }) {
  if (!loading) {
    return (
      <Button disabled={disabled} className={className} {...props}>
        {children}
      </Button>
    );
  }
  return (
    <Button
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
    </Button>
  );
}

export { LoadingButton };
