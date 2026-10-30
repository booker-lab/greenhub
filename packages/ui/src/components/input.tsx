import { Input as InputPrimitive } from '@base-ui/react/input';
import type * as React from 'react';

import { cn } from '../lib/utils';

// ① 외형 유지: Mantine TextInput(높이 36, radius 16, gray-4 테두리, 초점 시 주색 테두리).
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus:border-primary aria-invalid:border-destructive disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
