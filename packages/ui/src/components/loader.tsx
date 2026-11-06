import type * as React from 'react';

import { cn } from '../lib/utils';

// ① 외형 유지: Mantine Loader(oval). 테두리 굵기 = 크기 ÷ 8, 왼쪽 테두리만 투명, 1.2초에 한 바퀴.
// 크기는 Mantine xs 18·sm 22·md 36·lg 44, 색은 주색이 기본이다(color로 바꾼다).
const LOADER_SIZE = { xs: 18, sm: 22, md: 36, lg: 44 } as const;

function Loader({
  size = 'md',
  color = 'var(--color-primary)',
  className,
  style,
  ...props
}: Omit<React.ComponentProps<'span'>, 'color'> & {
  size?: keyof typeof LOADER_SIZE;
  color?: string;
}) {
  const px = LOADER_SIZE[size];
  return (
    <span
      role="presentation"
      data-slot="loader"
      className={cn(
        'inline-block size-(--loader-size) after:block after:size-(--loader-size) after:animate-spin after:[animation-duration:1.2s] after:rounded-[10000px] after:border-(length:--loader-border) after:border-solid after:border-(--loader-color) after:border-l-transparent after:content-[""]',
        className,
      )}
      style={
        {
          '--loader-size': `${px}px`,
          '--loader-border': `${px / 8}px`,
          '--loader-color': color,
          ...style,
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Loader };
