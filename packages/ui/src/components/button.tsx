import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/utils';

// ① 외형 유지: Mantine Button(radius xl, 600, 15px) 크기·색과 같게 둔다.
const buttonVariants = cva(
  'group/button inline-flex shrink-0 cursor-pointer items-center justify-center gap-2.5 rounded-full border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap normal-case transition-all outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border-primary bg-transparent text-brand-ink hover:bg-primary/5',
        light: 'bg-brand-surface text-brand-ink',
        subtle: 'bg-transparent text-brand-ink hover:bg-brand-surface',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'bg-transparent text-foreground hover:bg-muted aria-expanded:bg-muted',
        destructive: 'bg-destructive text-white hover:bg-destructive/90',
        link: 'bg-transparent text-brand-ink underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4.5',
        xs: 'h-7.5 px-3.5',
        sm: 'h-7.5 px-3.5',
        md: 'h-10.5 px-5.5',
        lg: 'h-12.5 px-6.5',
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
