import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/utils';

// ① 외형 유지: Mantine Button(radius xl = 32px, 600, 줄 높이 1) 크기·색과 같게 둔다.
// 초점 표시는 Mantine focusRing auto와 같은 주색 2px 외곽선(간격 2px)이다.
// 모서리는 rounded-full(9999px)이 아니라 Mantine과 같은 32px이고, Mantine처럼 position: relative·overflow: hidden이다.
// 색은 판매자 앱 대조 화면(/dev/ui-compare, scripts/visual/compare-cells.mjs)에서 Mantine 계산값을 읽어 맞췄다.
// light·subtle은 Mantine brand-1·brand-9, 회색 글자는 gray-9, 위험은 red-6, 비활성은 gray-2 면·gray-5 글자다.
const buttonVariants = cva(
  'group/button relative inline-flex shrink-0 overflow-hidden cursor-pointer items-center justify-center gap-2.5 rounded-xl border border-transparent text-sm leading-none font-semibold whitespace-nowrap normal-case transition-all outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:outline-solid active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-transparent disabled:bg-[#e9ecef] disabled:text-[#adb5bd] aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
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
        link: 'bg-transparent text-brand-ink underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4.5',
        xs: 'h-7.5 px-3.5 text-xs leading-none',
        sm: 'h-7.5 px-3.5 text-xs leading-none',
        md: 'h-10.5 px-5.5 text-base leading-none',
        lg: 'h-12.5 px-6.5 text-lg leading-none',
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

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
