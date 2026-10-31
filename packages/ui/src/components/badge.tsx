import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/utils';

// ① 외형 유지: Mantine Badge md(모서리 1000px, 높이 20, 좌우 10, 11px·700·대문자, 줄 높이 18, 자간 0.25px).
// Mantine은 text-box-trim으로 한글을 잘라 style.css에서 보정했다. 여기서는 trim을 쓰지 않고
// overflow를 열어 둔다. 색은 Mantine 계산값(light = brand-1 면·brand-9 글자, 회색 gray-1·gray-9, 빨강 red-1·red-9)이다.
const badgeVariants = cva(
  'group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-visible rounded-[1000px] border border-transparent px-2.5 text-[11px] leading-[18px] font-bold tracking-[0.25px] whitespace-nowrap uppercase transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3!',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a]:hover:bg-primary/90',
        light: 'bg-[#d2f2df] text-[#005c32]',
        outline: 'border-primary bg-transparent text-brand-ink',
        // Mantine variant="outline" color="gray"(gray-6 테두리·글자).
        'outline-gray': 'border-[#868e96] bg-transparent text-[#868e96]',
        warning: 'bg-status-warning text-status-warning-foreground',
        secondary: 'bg-[#f1f3f5] text-[#212529]',
        destructive: 'bg-[#ffe3e3] text-[#c92a2a]',
        // Mantine light orange(orange-1 면·orange-9 글자).
        'light-orange': 'bg-[#ffe8cc] text-[#d9480f]',
        // Mantine light green(green-1 면·green-9 글자).
        'light-green': 'bg-[#d3f9d8] text-[#2b8a3e]',
        ghost: 'bg-transparent text-foreground hover:bg-muted',
        link: 'bg-transparent text-brand-ink underline-offset-4 hover:underline',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant = 'default',
  render,
  ...props
}: useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: 'badge',
      variant,
    },
  });
}

export { Badge, badgeVariants };
