import {
  ButtonLabel,
  Button as UiButton,
  ButtonLink as UiButtonLink,
} from '@greenhub/ui/components/button';
import { cn } from '@greenhub/ui/lib/utils';
import type * as React from 'react';
import { touchButtonClassName } from '@/lib/touch-target';

// 소비자 화면의 버튼. 공용 @greenhub/ui Button·ButtonLink와 같은 모양·역할·이름이고, 눌리는 영역만 44px(--touch-target)로
// 맞춘다(design-standard.md §4, lib/touch-target.ts). 공용 부품의 기본 크기는 판매자·어드민·기사 화면이 함께 쓰므로 바꾸지 않는다.
// 화면이 className으로 높이·글자 크기를 직접 주면 그 값이 이긴다(tailwind-merge).

function Button({ size = 'default', className, ...props }: React.ComponentProps<typeof UiButton>) {
  return <UiButton size={size} className={cn(touchButtonClassName(size), className)} {...props} />;
}

function ButtonLink({
  size = 'default',
  className,
  ...props
}: React.ComponentProps<typeof UiButtonLink>) {
  return (
    <UiButtonLink size={size} className={cn(touchButtonClassName(size), className)} {...props} />
  );
}

export { Button, ButtonLabel, ButtonLink };
