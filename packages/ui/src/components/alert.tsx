import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '../lib/utils';

// ① 외형 유지: Mantine Alert variant="light"(안쪽 16, 모서리 16, 투명 테두리 1px, 제목 15px·700, 본문 15px 검정,
// 제목·본문 사이 10px). 색은 Mantine 계산값이다: 기본 brand-1 면·brand-9 글자, 빨강 red-1·red-9,
// 노랑은 theme.ts가 경고 토큰(#FFF4CC·#7A5B00)으로 바꾼 값.
// 줄 높이는 Mantine처럼 물려받는다(text-sm을 쓰면 1.45로 바뀌므로 글자 크기만 준다).
const alertVariants = cva(
  'relative overflow-hidden rounded-lg border border-transparent p-4 text-[15px]',
  {
    variants: {
      variant: {
        default: 'bg-[#d2f2df] text-[#005c32]',
        destructive: 'bg-[#ffe3e3] text-[#c92a2a]',
        warning: 'bg-[#fff4cc] text-[#7a5b00]',
        // Mantine light gray(gray-1 면·gray-9 글자).
        secondary: 'bg-[#f1f3f5] text-[#212529]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Alert({
  className,
  variant,
  children,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div data-slot="alert" className={cn(alertVariants({ variant }), className)} {...props}>
      <div className="flex">
        <div className="flex flex-1 flex-col gap-2.5">{children}</div>
      </div>
    </div>
  );
}

function AlertTitle({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('flex items-center justify-between text-[15px] font-bold', className)}
      {...props}
    >
      <span className="block overflow-hidden text-ellipsis">{children}</span>
    </div>
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('overflow-hidden text-[15px] text-ellipsis text-black', className)}
      {...props}
    />
  );
}

export { Alert, AlertDescription, AlertTitle };
