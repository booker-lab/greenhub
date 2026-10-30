import { cn } from '@greenhub/ui/lib/utils';
import type * as React from 'react';

// ① 외형 유지: Mantine Loader(oval)와 같은 모양. 크기의 1/8 두께 고리에서 왼쪽 1/4을 비우고 1.2초에 한 바퀴 돈다.
export function Spinner({
  size = 36,
  className,
  style,
}: {
  /** 지름(px 또는 CSS 길이). Mantine Loader md = 36px. */
  size?: number | string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const length = typeof size === 'number' ? `${size}px` : size;
  return (
    <span
      role="presentation"
      className={cn(
        'inline-block size-(--spinner-size) text-primary',
        "after:block after:size-(--spinner-size) after:animate-spin after:[animation-duration:1.2s] after:rounded-full after:border-[calc(var(--spinner-size)/8)] after:border-solid after:border-current after:border-l-transparent after:content-['']",
        className,
      )}
      style={{ '--spinner-size': length, ...style } as React.CSSProperties}
    />
  );
}
