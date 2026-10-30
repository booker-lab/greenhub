'use client';

import { Dialog as SheetPrimitive } from '@base-ui/react/dialog';
import type * as React from 'react';

import { cn } from '../lib/utils';
import { CloseIcon, closeButtonClassName } from './close-button';

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

// Dialog와 같은 배경(검정 60%).
function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/60 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0',
        className,
      )}
      {...props}
    />
  );
}

// ① 외형 유지: Mantine Drawer(모서리 16, 그림자 xl, 글자 검정, 머리 60px → 본문 16px).
// 아래(bottom)는 소비자 OptionSheet처럼 내용 높이만큼이다. 좌우는 Mantine 기본 md 440px(좁은 화면은 화면 폭)이다.
// 설명(SheetDescription)은 머리가 아니라 본문(SheetBody)에 둔다.
// 초점 이동은 Base UI에 맡긴다. 여기서 focus()를 호출하지 않는다.
function SheetContent({
  className,
  children,
  side = 'right',
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: 'top' | 'right' | 'bottom' | 'left';
  showCloseButton?: boolean;
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          'fixed z-50 flex flex-col overflow-y-auto rounded-lg bg-background text-black shadow-[0_1px_3px_rgba(0,0,0,0.05),rgba(0,0,0,0.05)_0_36px_28px_-7px,rgba(0,0,0,0.04)_0_17px_17px_-7px] transition duration-200 ease-in-out outline-none',
          'data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:max-h-full',
          'data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-full data-[side=left]:max-w-[440px]',
          'data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-full data-[side=right]:max-w-[440px]',
          'data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto',
          'data-ending-style:opacity-0 data-starting-style:opacity-0',
          'data-[side=bottom]:data-ending-style:translate-y-10 data-[side=bottom]:data-starting-style:translate-y-10',
          'data-[side=left]:data-ending-style:-translate-x-10 data-[side=left]:data-starting-style:-translate-x-10',
          'data-[side=right]:data-ending-style:translate-x-10 data-[side=right]:data-starting-style:translate-x-10',
          'data-[side=top]:data-ending-style:-translate-y-10 data-[side=top]:data-starting-style:-translate-y-10',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            aria-label="닫기"
            className={cn(closeButtonClassName, 'absolute top-4 right-[11px] z-20')}
          >
            <CloseIcon />
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  );
}

// Mantine Drawer 머리: 높이 최소 60px, 위아래·왼쪽 16px, 모서리 없는 흰 바탕으로 위에 붙는다(본문이 길면 머리 아래로 스크롤).
// 오른쪽은 닫기 버튼(11px + 28px) 자리를 비운다.
function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn(
        'sticky top-0 z-10 flex min-h-[60px] items-center bg-background py-4 pr-[47px] pl-4',
        className,
      )}
      {...props}
    />
  );
}

// Mantine Drawer 본문: 16px, 머리 다음이면 위 여백 0.
function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="sheet-body" className={cn('px-4 pb-4 first:pt-4', className)} {...props} />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col gap-2 px-4 pb-4', className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-base leading-none font-normal', className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};
