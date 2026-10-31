import type * as React from 'react';

import { cn } from '../lib/utils';

// ① 외형 유지: Mantine Progress(한 구간). 바탕 gray-2, 기본 높이 8px(md)·모서리 16px, 구간은 주색 면.
// 높이·모서리·색은 className(바탕)·indicatorClassName(구간)으로 준다(예: Mantine size="sm" radius="xl" =
// h-[5px] rounded-[32px]). 구간의 progressbar 역할·aria 값은 Mantine ProgressSection과 같다.
// 구간 모서리는 시작 쪽만 둥글다. Mantine은 한 구간이 first·last-of-type 둘 다인데, 뒤에 오는 first-of-type 규칙이
// border-radius를 0으로 덮고 시작 쪽만 다시 둥글게 해서 끝 쪽이 각진다(판매자 회차 목록 촬영 실측).
function Progress({
  value,
  className,
  indicatorClassName,
  ...props
}: React.ComponentProps<'div'> & { value: number; indicatorClassName?: string }) {
  return (
    <div
      data-slot="progress"
      className={cn('relative flex h-2 overflow-hidden rounded-lg bg-[#e9ecef]', className)}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        role="progressbar"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={value}
        aria-valuetext={`${value}%`}
        className={cn(
          'flex h-full items-center justify-center overflow-hidden rounded-s-[inherit] bg-primary transition-[width] duration-100 ease-[ease]',
          indicatorClassName,
        )}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

export { Progress };
