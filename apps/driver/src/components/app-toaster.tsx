'use client';

import { Toast as ToastPrimitive } from '@base-ui/react/toast';
import { ToastProvider, toast } from '@greenhub/ui/components/toast';
import type * as React from 'react';
import { CloseIcon } from './close-icon';

// 알림은 packages/ui의 toast 관리자(toast.add)로 띄운다. 여기서는 그 알림을 Mantine Notification과 같은
// 모양으로 그린다(① 외형 유지, ui-stack-migration-plan.md §7): 오른쪽 아래, 폭 440px까지, 알림 사이 16px,
// 흰 바탕·16px 모서리·큰 그림자, 왼쪽 색 막대(경고 노랑, 그 밖 주색), 4초 뒤 닫힘, 오래된 알림이 위,
// 오른쪽에서 밀려 들어오고 나가며 높이가 0에서 늘거나 0으로 준다(250ms). 전환 방식까지 Mantine과 같게 두어야
// 먼저 뜬 알림이 밀려 올라가는 동안의 그림이 같아진다.

/** 경고(노랑) 알림. Mantine notifications.show({ color: 'yellow' })와 같다. */
export const TOAST_WARNING = 'warning';

const BAR_COLOR: Record<string, string> = {
  [TOAST_WARNING]: '#fab005',
};

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();
  // Base UI는 새 알림을 앞에 둔다. Mantine 오른쪽 아래 목록처럼 오래된 알림을 위에 그린다.
  // 그림자는 Tailwind shadow 유틸리티(링 그림자 변수와 합쳐 그린다) 대신 Mantine shadow lg 값을 그대로 둔다.
  return [...toasts].reverse().map((item, index) => (
    <ToastPrimitive.Root
      key={item.id}
      toast={item}
      className="relative flex cursor-default items-center overflow-hidden rounded-[16px] bg-white py-2.5 ps-[22px] pe-2.5 [box-shadow:0_1px_3px_rgba(0,0,0,0.05),rgba(0,0,0,0.05)_0_28px_23px_-7px,rgba(0,0,0,0.04)_0_12px_12px_-7px] [transform:translateX(0)_translate3d(0px,0,0)] [touch-action:pan-y] outline-none max-h-[200px] [transition-duration:250ms,250ms,250ms] [transition-property:opacity,transform,max-height] [transition-timing-function:cubic-bezier(.51,.3,0,1.21),cubic-bezier(.51,.3,0,1.21),linear] before:absolute before:start-1 before:top-4 before:bottom-4 before:block before:w-1.5 before:rounded-[16px] before:bg-(--toast-bar) before:content-[''] data-ending-style:[transform:translateX(100%)_translate3d(0px,0,0)] data-ending-style:max-h-0 data-ending-style:opacity-0 data-starting-style:[transform:translateX(100%)_translate3d(0px,0,0)] data-starting-style:max-h-0 data-starting-style:opacity-0"
      style={
        {
          '--toast-bar': BAR_COLOR[item.type ?? ''] ?? 'var(--color-primary)',
          marginTop: index === 0 ? undefined : 16,
        } as React.CSSProperties
      }
    >
      <div className="me-2.5 flex-1 overflow-hidden">
        <ToastPrimitive.Description className="m-0 overflow-hidden text-sm/[1.45] text-ellipsis text-black" />
      </div>
      <ToastPrimitive.Close
        aria-label="닫기"
        className="relative inline-flex size-7 min-h-7 min-w-7 cursor-pointer appearance-none items-center justify-center rounded-[16px] border-0 bg-transparent p-0 leading-none text-[#495057] select-none hover:bg-[#f8f9fa]"
      >
        <CloseIcon size={16} />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  ));
}

export function AppToaster({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider toastManager={toast} timeout={4000} limit={5}>
      {children}
      <ToastPrimitive.Portal>
        <ToastPrimitive.Viewport className="fixed right-4 bottom-4 z-[400] w-[calc(100%-32px)] max-w-[440px] outline-none">
          <ToastList />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastProvider>
  );
}
