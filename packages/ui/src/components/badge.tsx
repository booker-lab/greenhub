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
        light: 'bg-ui-brand-light text-ui-brand-light-text',
        outline: 'border-primary bg-transparent text-brand-ink',
        // Mantine variant="outline" color="gray"(gray-6 테두리·글자).
        'outline-gray': 'border-ui-gray-6 bg-transparent text-ui-gray-6',
        // Mantine variant="outline" color="yellow"·"red"(yellow-6·red-6 테두리·글자).
        'outline-warning': 'border-[#fab005] bg-transparent text-[#fab005]',
        'outline-destructive': 'border-ui-red bg-transparent text-ui-red',
        warning: 'bg-status-warning text-status-warning-foreground',
        secondary: 'bg-ui-gray-1 text-ui-gray-9',
        destructive: 'bg-ui-red-light text-ui-red-light-text',
        // Mantine filled red(red-6 면·흰 글자), light orange(orange-1 면·orange-9 글자).
        'destructive-filled': 'bg-ui-red-filled text-white',
        'light-orange': 'bg-ui-orange-light text-ui-orange-light-text',
        // Mantine light dark·green(dark-1 면·dark-9 글자, green-1 면·green-9 글자).
        'light-dark': 'bg-ui-dark-light text-ui-dark-light-text',
        'light-green': 'bg-ui-green-light text-ui-green-light-text',
        ghost: 'bg-transparent text-foreground hover:bg-muted',
        link: 'bg-transparent text-brand-ink underline-offset-4 hover:underline',
      },
      // Mantine Badge size(기본 md). sm = 높이 18·좌우 8·10px, xs = 높이 16·좌우 6·9px(줄 높이는 높이 - 2px).
      size: {
        md: '',
        sm: 'h-[18px] px-2 text-[10px] leading-4',
        xs: 'h-4 px-1.5 text-[9px] leading-[14px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
);

function Badge({
  className,
  variant = 'default',
  size = 'md',
  render,
  ...props
}: useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {
        className: cn(badgeVariants({ variant, size }), className),
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
