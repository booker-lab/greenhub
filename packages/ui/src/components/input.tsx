import { Input as InputPrimitive } from '@base-ui/react/input';
import type * as React from 'react';

import { cn } from '../lib/utils';

// ① 외형 유지: Mantine TextInput(높이 36, radius 16, gray-4 테두리, 초점 시 주색 테두리).
// 글자는 Mantine 기본 검정, 자리표시 글자 gray-5, 비활성 gray-2 면·gray-5 글자, 오류 red-6 테두리·글자(대조 화면에서 맞춤).
// Autocomplete 입력칸도 같은 모양이라 클래스를 함께 쓴다.
const inputClassName =
  'h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-black transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-[#adb5bd] focus:border-primary aria-invalid:border-[#fa5252] aria-invalid:text-[#fa5252] disabled:cursor-not-allowed disabled:bg-[#e9ecef] disabled:text-[#adb5bd] disabled:opacity-60';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(inputClassName, className)}
      {...props}
    />
  );
}

export { Input, inputClassName };
