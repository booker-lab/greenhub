'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import type * as React from 'react';
import { useRef } from 'react';

import { cn } from '../lib/utils';
import { Button } from './button';
import { CloseIcon, closeButtonClassName } from './close-button';

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

// ① 외형 유지: Mantine Modal 배경(검정 60%, 흐림 없음).
function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 isolate z-50 bg-black/60 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        className,
      )}
      {...props}
    />
  );
}

// ① 외형 유지: Mantine Modal(md 440px, 좁은 화면은 90vw, 가운데, 모서리 16, 그림자 xl, 글자 검정).
// will-change: opacity — Mantine은 열림 전환(투명도) 때문에 본문 상자를 따로 합성해 그린다. 같게 하지 않으면 모바일 2배율에서
// 안쪽 버튼 모서리 한 줄이 다르게 그려진다(판매자 기사 확인창 촬영 실측).
// 가운데 정렬은 Mantine처럼 flex(위아래 5dvh·좌우 5vw 여백)로 한다. translate(-50%)로 옮기면 소수점 위치의 글자가 다르게 그려진다.
// 구성은 Mantine과 같이 머리(DialogHeader: 제목, 60px) → 본문(DialogBody: 좌우·아래 16px)이다.
// 설명(DialogDescription)은 머리가 아니라 본문에 둔다.
// 초점 이동은 Base UI에 맡긴다. 여기서 focus()를 호출하지 않는다.
function DialogContent({
  className,
  children,
  initialFocus,
  ...props
}: DialogPrimitive.Popup.Props) {
  // Mantine Modal과 같은 약속: 안쪽에 data-autofocus 요소가 있으면 열릴 때 그 요소에 초점을 둔다
  // (예: 강제환불 사유 입력칸 — Enter만 눌러 환불되지 않게). 없으면 Base UI 기본 동작(첫 초점 가능 요소).
  const popupRef = useRef<HTMLDivElement>(null);
  const autofocus = () => popupRef.current?.querySelector<HTMLElement>('[data-autofocus]') ?? true;
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Viewport
        data-slot="dialog-viewport"
        className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-[5vw] py-[5dvh]"
      >
        <DialogPrimitive.Popup
          ref={popupRef}
          initialFocus={initialFocus ?? autofocus}
          data-slot="dialog-content"
          className={cn(
            'pointer-events-auto flex max-h-[90dvh] will-change-[opacity] w-[440px] max-w-full flex-col overflow-y-auto rounded-lg bg-background text-black shadow-[0_1px_3px_rgba(0,0,0,0.05),rgba(0,0,0,0.05)_0_36px_28px_-7px,rgba(0,0,0,0.04)_0_17px_17px_-7px] duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPortal>
  );
}

// Mantine Modal 머리: 높이 최소 60px, 위아래·왼쪽 16px·오른쪽 11px, 위 모서리 16px 흰 바탕으로 위에 붙는다
// (본문이 길면 머리 아래로 스크롤). 닫기 버튼은 Mantine처럼 머리 안 flex 끝에 둔다. 본문 상자에 position을
// 주어 absolute로 두면 안쪽 버튼 모서리가 Mantine과 다르게 그려진다(판매자 확인창 촬영 실측).
// 닫기 버튼이 제목 다음 첫 초점 가능 요소라 Mantine처럼 열릴 때 첫 초점이 간다.
function DialogHeader({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<'div'> & { showCloseButton?: boolean }) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        'sticky top-0 z-10 flex min-h-[60px] items-center justify-between rounded-t-lg bg-background py-4 pr-[11px] pl-4',
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close
          data-slot="dialog-close"
          aria-label="닫기"
          className={cn(closeButtonClassName, 'ms-auto')}
        >
          <CloseIcon />
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

// Mantine Modal 본문: 16px, 머리 다음이면 위 여백 0.
function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="dialog-body" className={cn('px-4 pb-4 first:pt-4', className)} {...props} />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 px-4 pb-4 sm:flex-row sm:justify-end', className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>닫기</DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-base leading-none font-normal', className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        'text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
