'use client';

import { Switch as SwitchPrimitive } from '@base-ui/react/switch';

import { cn } from '../lib/utils';

// ① 외형 유지: Mantine Switch sm(트랙 38×20·gray-3, 켜면 주색, 손잡이 14px 흰색·안쪽 2.5px,
// 손잡이 가운데 트랙 색 점 40%, 150ms, 초점 시 주색 2px 외곽선).
// 잠기면 Mantine처럼 트랙·가운데 점이 켜짐 여부와 상관없이 비활성 색(gray-2)이다(판매자 회차 상세 촬영 실측).
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'group/switch relative z-0 inline-flex h-5 w-[38px] min-w-[38px] shrink-0 cursor-pointer items-center overflow-hidden rounded-[1000px] bg-[#dee2e6] transition-[background-color,border-color] duration-150 ease-[ease] outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:outline-solid data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:bg-[#e9ecef]',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="absolute start-[2.5px] z-[1] flex size-3.5 rounded-[1000px] bg-white transition-[inset-inline-start] duration-150 ease-[ease] before:absolute before:top-1/2 before:left-1/2 before:size-[40%] before:-translate-1/2 before:rounded-[1000px] before:bg-[#dee2e6] before:content-[''] data-checked:start-[calc(100%-14px-2.5px)] data-checked:before:bg-primary data-disabled:before:bg-[#e9ecef] data-checked:data-disabled:before:bg-[#e9ecef] group-data-disabled/switch:bg-[#f8f9fa]"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
