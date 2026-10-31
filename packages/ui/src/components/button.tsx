import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { Children } from 'react';

import { cn } from '../lib/utils';

// ① 외형 유지: Mantine Button(radius xl = 32px, 600, 줄 높이 1) 크기·색과 같게 둔다.
// 아이콘을 글자 앞뒤에 둘 때는 svg에 data-icon="inline-start"·"inline-end"를 준다. Mantine left·rightSection처럼
// 그쪽 여백이 좌우 여백 ÷ 1.5가 되고, 글자와는 10px(gap) 떨어진다. 링크로 그려도 밑줄이 없다.
// 초점 표시는 Mantine focusRing auto와 같은 주색 2px 외곽선(간격 2px)이다.
// 모서리는 rounded-full(9999px)이 아니라 Mantine과 같은 32px이고, Mantine처럼 position: relative·overflow: hidden이다.
// 색은 판매자 앱 대조 화면(/dev/ui-compare, scripts/visual/compare-cells.mjs)에서 Mantine 계산값을 읽어 맞췄다.
// light·subtle은 Mantine brand-1·brand-9, 회색 글자는 gray-9, 위험은 red-6, 비활성은 gray-2 면·gray-5 글자다.
const buttonVariants = cva(
  'group/button relative inline-flex shrink-0 overflow-hidden cursor-pointer items-center justify-center gap-2.5 rounded-xl border border-transparent text-sm leading-none font-semibold whitespace-nowrap normal-case no-underline transition-all outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:outline-solid active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-transparent disabled:bg-[#e9ecef] disabled:text-[#adb5bd] aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border-primary bg-transparent text-brand-ink hover:bg-primary/5',
        // Mantine variant="outline" color="gray"(gray-6 테두리·글자, 대조 화면 계산값).
        'outline-gray': 'border-[#868e96] bg-transparent text-[#868e96] hover:bg-[#868e96]/5',
        light: 'bg-[#d2f2df] text-[#005c32]',
        subtle: 'bg-transparent text-[#005c32] hover:bg-brand-surface',
        secondary: 'bg-[#f1f3f5] text-[#212529] hover:bg-[#e9ecef]',
        ghost: 'bg-transparent text-[#212529] hover:bg-muted aria-expanded:bg-muted',
        destructive: 'bg-[#fa5252] text-white hover:bg-[#fa5252]/90',
        // Mantine light·subtle color="red"·"yellow"(노랑 light는 theme.ts가 경고 토큰으로 바꾼 값).
        'light-destructive': 'bg-[#ffe3e3] text-[#c92a2a] hover:bg-[#ffc9c9]',
        'subtle-destructive': 'bg-transparent text-[#c92a2a] hover:bg-[#ffe3e3]',
        'light-warning': 'bg-[#fff4cc] text-[#7a5b00]',
        // Mantine outline yellow·green(yellow-6·green-6 테두리·글자), light green(green-1 면·green-9 글자).
        'outline-warning': 'border-[#fab005] bg-transparent text-[#fab005] hover:bg-[#fab005]/5',
        'outline-green': 'border-[#40c057] bg-transparent text-[#40c057] hover:bg-[#40c057]/5',
        // Mantine outline red(red-6 테두리·글자).
        'outline-destructive':
          'border-[#fa5252] bg-transparent text-[#fa5252] hover:bg-[#fa5252]/5',
        'light-green': 'bg-[#d3f9d8] text-[#2b8a3e]',
        link: 'bg-transparent text-brand-ink underline-offset-4 hover:underline',
      },
      size: {
        default:
          'h-9 px-4.5 has-data-[icon=inline-start]:ps-[calc(18px/1.5)] has-data-[icon=inline-end]:pe-[calc(18px/1.5)]',
        xs: 'h-7.5 px-3.5 text-xs leading-none has-data-[icon=inline-start]:ps-[calc(14px/1.5)] has-data-[icon=inline-end]:pe-[calc(14px/1.5)]',
        sm: 'h-7.5 px-3.5 text-xs leading-none has-data-[icon=inline-start]:ps-[calc(14px/1.5)] has-data-[icon=inline-end]:pe-[calc(14px/1.5)]',
        md: 'h-10.5 px-5.5 text-base leading-none has-data-[icon=inline-start]:ps-[calc(22px/1.5)] has-data-[icon=inline-end]:pe-[calc(22px/1.5)]',
        lg: 'h-12.5 px-6.5 text-lg leading-none has-data-[icon=inline-start]:ps-[calc(26px/1.5)] has-data-[icon=inline-end]:pe-[calc(26px/1.5)]',
        icon: 'size-9',
        'icon-xs': 'size-6 [&_svg:not([class*=size-])]:size-3',
        'icon-sm': 'size-7.5',
        'icon-lg': 'size-10.5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

// Mantine Button의 글자 칸(.mantine-Button-label)과 같은 값. 글자 줄 상자를 대문자 높이로 잘라
// (text-box-trim) 세로 가운데에 놓으므로, 감싸지 않으면 글자 가장자리 픽셀이 Mantine과 달라진다.
const labelClassName =
  'flex h-full items-center overflow-hidden whitespace-nowrap [text-box-edge:cap_alphabetic] [text-box-trim:trim-both]';

/** 이어진 글자(문자열·숫자)를 한 글자 칸으로 감싼다(Mantine은 글자 전체가 칸 하나). 아이콘 등 요소는 그대로 둔다. */
function wrapLabels(children: React.ReactNode) {
  const out: React.ReactNode[] = [];
  let text: (string | number)[] = [];
  const flush = () => {
    if (text.length === 0) return;
    out.push(
      <span key={`label-${out.length}`} data-slot="button-label" className={labelClassName}>
        {text.join('')}
      </span>,
    );
    text = [];
  };
  for (const child of Children.toArray(children)) {
    if (typeof child === 'string' || typeof child === 'number') text.push(child);
    else {
      flush();
      out.push(child);
    }
  }
  flush();
  return out;
}

function Button({
  className,
  variant = 'default',
  size = 'default',
  children,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {typeof children === 'function' ? children : wrapLabels(children)}
    </ButtonPrimitive>
  );
}

// ① 외형 유지: Mantine Button 안쪽(inner·label) 구조. 버튼보다 긴 내용(두 줄 글자 등)을 Mantine처럼
// 왼쪽부터 그리고 오른쪽을 자르고, 글자 위치도 Mantine과 같은 반올림으로 놓는다.
// 글자만 있는 보통 버튼은 Button이 글자 칸으로 감싸므로(wrapLabels) 쓰지 않아도 된다. 직접 감싼 ButtonLabel은
// 요소라서 다시 감싸지 않는다.
function ButtonLabel({ className, children, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="button-inner"
      className="flex h-full w-full min-w-0 items-center justify-center overflow-visible"
    >
      <span
        data-slot="button-label"
        className={cn(
          'flex h-full items-center overflow-hidden whitespace-nowrap [text-box-edge:cap_alphabetic] [text-box-trim:trim-both]',
          className,
        )}
        {...props}
      >
        {children}
      </span>
    </span>
  );
}

export { Button, ButtonLabel, buttonVariants };
