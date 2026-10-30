import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/utils';

// ① 외형 유지: Mantine Badge md(높이 20, 좌우 10, 11px·700·대문자, 줄 높이 18, 자간 0.25px).
// Mantine은 text-box-trim으로 한글을 잘라 style.css에서 보정했다. 여기서는 trim을 쓰지 않고
// overflow를 열어 둔다.
const badgeVariants = cva(
  'group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-visible rounded-full border border-transparent px-2.5 text-[11px] leading-[18px] font-bold tracking-[0.25px] whitespace-nowrap uppercase transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3!',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a]:hover:bg-primary/90',
        light: 'bg-brand-surface text-brand-ink',
        outline: 'border-primary bg-transparent text-brand-ink',
        warning: 'bg-status-warning text-status-warning-foreground',
        secondary: 'bg-status-info text-status-info-foreground',
        destructive: 'bg-destructive-surface text-destructive',
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
