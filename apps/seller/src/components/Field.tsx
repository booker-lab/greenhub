import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel as UiFieldLabel,
} from '@greenhub/ui/components/field';
import { cn } from '@greenhub/ui/lib/utils';
import type * as React from 'react';

// 판매자 화면의 입력칸 이름표. 공용 FieldLabel의 600(font-bold)을 700(font-bold)으로 덮는다(디자인 기준 §3,
// 역할별 굵기: 입력칸 이름표는 700, 2026-11-26 결정). 공용 부품 값은 다른 앱도 쓰므로 바꾸지 않는다.

function FieldLabel({ className, ...props }: React.ComponentProps<typeof UiFieldLabel>) {
  return <UiFieldLabel className={cn('font-bold', className)} {...props} />;
}

export { Field, FieldDescription, FieldError, FieldLabel };
