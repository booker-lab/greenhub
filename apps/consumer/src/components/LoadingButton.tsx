'use client';

import { LoadingButton as UiLoadingButton } from '@greenhub/ui/components/loading-button';
import { cn } from '@greenhub/ui/lib/utils';
import type * as React from 'react';

// 소비자 화면의 처리 중 버튼. 공용 @greenhub/ui LoadingButton을 그대로 쓴다(판매자 앱·소비자 배송지/로그인 화면과 같은 모양):
// 처리 중에는 변형 색 위에 흰 15% 막을 덮고, 글자를 아래로 내려 감춘 자리 가운데에 글자색 도는 원(Loader)을 보인다.
// 글자는 읽기 도구에 남고, 누를 수 없으며(aria-disabled) 초점은 버튼에 남는다. loading이 아니면 Button과 같다.
// 예전에는 Mantine Loader 스타일이 없어 도는 표시 없이 빈 알약으로 보이던 모양을 그대로 옮겨 두었다.
// 공용 Loader에는 움직임 줄이기 대응이 없어, prefers-reduced-motion에서는 여기서 회전만 멈춘다(원은 그대로 보인다).
const REDUCED_MOTION_LOADER = 'motion-reduce:[&_[data-slot=loader]]:after:animate-none';

function LoadingButton({
  loading = false,
  className,
  ...props
}: React.ComponentProps<typeof UiLoadingButton>) {
  return (
    <UiLoadingButton
      loading={loading}
      className={cn(loading && REDUCED_MOTION_LOADER, className)}
      {...props}
    />
  );
}

export { LoadingButton };
