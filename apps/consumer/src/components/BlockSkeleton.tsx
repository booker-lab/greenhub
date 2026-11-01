import type * as React from 'react';

// ① 외형 유지(UI 교체 P5): Mantine Skeleton(visible·animate, radius md 8px, 너비 100%)과 같은 모양.
// 흰 바탕(::before) 위에 gray-3 면(::after)을 겹치고 면만 깜빡인다. @greenhub/ui Skeleton(bg-muted, 12px)은
// 색·모서리가 달라 쓰지 않는다. 깜빡임은 Tailwind pulse(2초, 투명도 1↔0.5)라 Mantine(1.5초, 0.4↔1)과 움직이는 동안만
// 다르고, 촬영(애니메이션 끔)에서는 둘 다 gray-3 면이다.
const SKELETON =
  "relative w-full overflow-hidden rounded-[8px] [transform:translateZ(0)] before:absolute before:inset-0 before:z-10 before:bg-white before:content-[''] after:absolute after:inset-0 after:z-[11] after:animate-pulse after:bg-[#dee2e6] after:content-['']";

export default function BlockSkeleton({
  height,
  className,
  style,
  ...props
}: React.ComponentProps<'div'> & { height: number }) {
  return (
    <div
      className={className ? `${SKELETON} ${className}` : SKELETON}
      style={{ height, ...style }}
      {...props}
    />
  );
}
