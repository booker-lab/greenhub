'use client';

import { Toast as ToastPrimitive } from '@base-ui/react/toast';
import { CloseIcon } from '@greenhub/ui/components/close-button';
import { ToastProvider, toast } from '@greenhub/ui/components/toast';
import type * as React from 'react';

// 알림은 packages/ui의 toast 관리자(toast.add)로 띄운다. 여기서는 그 알림을 예전 Mantine Notifications
// (position top-right, autoClose 4000)와 같은 모양으로 그린다(① 외형 유지, UI 교체 P4): 오른쪽 위 16px, 폭 440px까지,
// 알림 사이 16px, 흰 바탕·16px 모서리·큰 그림자, 왼쪽 색 막대, 4초 뒤 닫힘(timeout 0이면 닫을 때까지), 오래된 알림이 위,
// 오른쪽에서 밀려 들어오고 나가며 높이가 0에서 늘거나 0으로 준다(250ms). 기사 앱 AppToaster와 같은 방식이다.
// 제목(Mantine title)은 15px·500·gray-9·아래 2px, 제목이 있으면 설명은 gray-6이다.

/** 판매자 앱이 쓰는 알림 색(Mantine notifications color). 막대 색은 brand = 주색, red-6·yellow-6·green-6이다. */
export type NotifyColor = 'brand' | 'red' | 'yellow' | 'green';

const BAR_COLOR: Record<NotifyColor, string> = {
  brand: 'var(--color-primary)',
  red: '#fa5252',
  yellow: '#fab005',
  green: '#40c057',
};

/**
 * 알림을 띄운다. 예전 Mantine notifications.show와 같은 인자다(color 기본 brand, title 선택, autoClose: false면 닫을 때까지).
 * 그리는 곳은 앱 공급자의 AppToaster다.
 */
export function notify({
  color = 'brand',
  title,
  message,
  autoClose,
}: {
  color?: NotifyColor;
  title?: string;
  message: string;
  autoClose?: false;
}) {
  toast.add({
    title,
    description: message,
    type: color,
    ...(autoClose === false ? { timeout: 0 } : {}),
  });
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();
  // Base UI는 새 알림을 앞에 둔다. Mantine 목록처럼 오래된 알림을 위에 그린다.
  return [...toasts].reverse().map((item, index) => (
    <ToastPrimitive.Root
      key={item.id}
      toast={item}
      className="relative flex cursor-default items-center overflow-hidden rounded-[16px] bg-white py-2.5 ps-[22px] pe-2.5 [box-shadow:0_1px_3px_rgba(0,0,0,0.05),rgba(0,0,0,0.05)_0_28px_23px_-7px,rgba(0,0,0,0.04)_0_12px_12px_-7px] [transform:translateX(0)_translate3d(0px,0,0)] [touch-action:pan-y] outline-none max-h-[200px] [transition-duration:250ms,250ms,250ms] [transition-property:opacity,transform,max-height] [transition-timing-function:cubic-bezier(.51,.3,0,1.21),cubic-bezier(.51,.3,0,1.21),linear] before:absolute before:start-1 before:top-4 before:bottom-4 before:block before:w-1.5 before:rounded-[16px] before:bg-(--toast-bar) before:content-[''] data-ending-style:[transform:translateX(100%)_translate3d(0px,0,0)] data-ending-style:max-h-0 data-ending-style:opacity-0 data-starting-style:[transform:translateX(100%)_translate3d(0px,0,0)] data-starting-style:max-h-0 data-starting-style:opacity-0"
      style={
        {
          '--toast-bar': BAR_COLOR[(item.type ?? 'brand') as NotifyColor] ?? BAR_COLOR.brand,
          marginTop: index === 0 ? undefined : 16,
        } as React.CSSProperties
      }
    >
      <div className="me-2.5 flex-1 overflow-hidden">
        {item.title ? (
          <ToastPrimitive.Title className="m-0 mb-0.5 overflow-hidden text-sm/[1.45] font-medium text-ellipsis text-[#212529]" />
        ) : null}
        <ToastPrimitive.Description
          className={`m-0 overflow-hidden text-sm/[1.45] font-normal text-ellipsis ${item.title ? 'text-[#868e96]' : 'text-black'}`}
        />
      </div>
      <ToastPrimitive.Close
        aria-label="닫기"
        className="relative inline-flex size-7 min-h-7 min-w-7 cursor-pointer appearance-none items-center justify-center rounded-[16px] border-0 bg-transparent p-0 leading-none text-[#495057] select-none hover:bg-[#f8f9fa]"
      >
        <CloseIcon style={{ width: 16, height: 16 }} />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  ));
}

export function AppToaster({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider toastManager={toast} timeout={4000} limit={5}>
      {children}
      <ToastPrimitive.Portal>
        <ToastPrimitive.Viewport className="fixed top-4 right-4 z-[200] w-[calc(100%-32px)] max-w-[440px] outline-none">
          <ToastList />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastProvider>
  );
}
