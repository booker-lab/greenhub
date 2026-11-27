import {
  ButtonLabel,
  Button as UiButton,
  ButtonLink as UiButtonLink,
} from '@greenhub/ui/components/button';
import { LoadingButton as UiLoadingButton } from '@greenhub/ui/components/loading-button';
import { cn } from '@greenhub/ui/lib/utils';
import type * as React from 'react';

// 판매자 화면의 버튼. 공용 @greenhub/ui Button·ButtonLink·LoadingButton과 모양·역할·이름이 같고 글자 굵기만 700(font-bold)이다.
// 공용 버튼의 600(font-bold)은 디자인 기준 §3(굵기 400·700·800) 밖이지만, 공용 부품은 기사·소비자 앱도 함께 써서
// 값을 바꾸지 않고 판매자 화면에서만 덮는다(소비자 래퍼와 같은 방식, 2026-11-26 결정). 화면이 className으로 굵기를 직접 주면 그 값이 이긴다.

function Button({ className, ...props }: React.ComponentProps<typeof UiButton>) {
  return <UiButton className={cn('font-bold', className)} {...props} />;
}

function ButtonLink({ className, ...props }: React.ComponentProps<typeof UiButtonLink>) {
  return <UiButtonLink className={cn('font-bold', className)} {...props} />;
}

function LoadingButton({ className, ...props }: React.ComponentProps<typeof UiLoadingButton>) {
  return <UiLoadingButton className={cn('font-bold', className)} {...props} />;
}

export { Button, ButtonLabel, ButtonLink, LoadingButton };
