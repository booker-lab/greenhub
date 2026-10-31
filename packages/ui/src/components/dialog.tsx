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

// 창 안 Tab 대상(브라우저 순서의 근사, Mantine use-focus-trap과 같은 기준에 같은 이름 라디오는 하나만 센다).
const TABBABLE_CANDIDATES =
  'a[href],button,input:not([type="hidden"]),select,textarea,[tabindex],[contenteditable]:not([contenteditable="false"])';

function isVisible(element: HTMLElement) {
  if (typeof element.checkVisibility === 'function') {
    return element.checkVisibility({ visibilityProperty: true });
  }
  return element.getClientRects().length > 0;
}

function getTabbables(root: HTMLElement) {
  const radioGroups = new Set<string>();
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE_CANDIDATES)).filter((element) => {
    if (element.tabIndex < 0 || element.matches(':disabled') || element.closest('[inert]')) {
      return false;
    }
    if (element.hasAttribute('data-base-ui-focus-guard') || !isVisible(element)) return false;
    // 같은 이름 라디오는 선택된 것(없으면 첫째)만 Tab이 멈춘다.
    if (element instanceof HTMLInputElement && element.type === 'radio' && element.name) {
      if (radioGroups.has(element.name)) return false;
      const group = Array.from(
        root.querySelectorAll<HTMLInputElement>(
          `input[type="radio"][name="${CSS.escape(element.name)}"]`,
        ),
      ).filter((radio) => !radio.disabled && isVisible(radio));
      if ((group.find((radio) => radio.checked) ?? group[0]) !== element) return false;
      radioGroups.add(element.name);
    }
    return true;
  });
}

// Tab·Shift+Tab을 창 안에서 돌린다(Mantine Modal FocusTrap의 scopeTab과 같은 방식).
// Base UI 1.9.0 모달은 창 앞뒤에 초점 가드(창 밖의 숨은 span)를 두고, 가드가 초점을 받으면 다음 프레임
// (requestAnimationFrame)에 창 안 첫·마지막 요소로 옮긴다(FloatingFocusManager modal + enqueueFocus). 그래서 마지막
// 요소에서 Tab을 누르면 초점이 한 번 창 밖 가드에 가고, 그 프레임 안에 다시 누르면 BODY·뒤 화면까지 나간다.
// 경계에서만 기본 이동을 막고 반대쪽 끝으로 바로 옮기므로 창 밖 요소가 초점을 받는 순간이 없다.
function trapTabKey(event: React.KeyboardEvent<HTMLElement>) {
  if (
    event.key !== 'Tab' ||
    event.defaultPrevented ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  ) {
    return;
  }
  const popup = event.currentTarget;
  // 창 안에서 연 다른 팝업(포털, 예: Select 목록)의 키 입력은 React 트리로 올라오지만 그쪽이 처리한다.
  if (!(event.target instanceof Node) || !popup.contains(event.target)) return;
  const tabbables = getTabbables(popup);
  const active = popup.ownerDocument.activeElement;
  if (tabbables.length === 0) {
    event.preventDefault();
    popup.focus();
    return;
  }
  const boundary = event.shiftKey ? tabbables[0] : tabbables[tabbables.length - 1];
  if (active !== boundary && active !== popup) return;
  event.preventDefault();
  (event.shiftKey ? tabbables[tabbables.length - 1] : tabbables[0]).focus();
}

// 모달 창 본체. DialogContent가 쓰고, 뷰포트 없이 직접 조립하는 창(기사 배송 보류)도 이것을 써서 같은 보장을 받는다.
// - Tab·Shift+Tab이 창 안에서만 돈다(trapTabKey).
// - aria-modal="true": Base UI는 창 밖을 aria-hidden으로 가릴 뿐 aria-modal을 붙이지 않는다(Mantine Modal은 붙였다).
// - aria-describedby는 Base UI가 Description(DialogBody·DialogDescription)의 id로 붙인다.
function DialogPopup({ onKeyDown, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Popup
      aria-modal="true"
      onKeyDown={(event) => {
        onKeyDown?.(event);
        trapTabKey(event);
      }}
      {...props}
    />
  );
}

// ① 외형 유지: Mantine Modal(md 440px, 좁은 화면은 90vw, 가운데, 모서리 16, 그림자 xl, 글자 검정).
// will-change: opacity — Mantine은 열림 전환(투명도) 때문에 본문 상자를 따로 합성해 그린다. 같게 하지 않으면 안쪽 버튼
// 둥근 모서리의 안티앨리어싱이 다르게 그려진다(판매자 기사 승인·정지 확인창 촬영 실측, 세 폭 모두).
// 가운데 정렬은 Mantine처럼 flex(위아래 5dvh·좌우 5vw 여백)로 한다. translate(-50%)로 옮기면 소수점 위치의 글자가 다르게 그려진다.
// 구성은 Mantine과 같이 머리(DialogHeader: 제목, 60px) → 본문(DialogBody: 좌우·아래 16px)이다.
// 설명(DialogDescription)은 머리가 아니라 본문에 둔다.
// 첫 초점 이동은 Base UI에 맡긴다(아래 data-autofocus는 대상만 고른다). 여기서 focus()를 호출하지 않는다.
// Tab 순회·aria-modal은 DialogPopup이 맡는다.
// 닫기 버튼을 본문보다 앞에 두어 Mantine Modal처럼 열릴 때 첫 초점이 닫기 버튼에 간다(확인 버튼이 첫 초점이면 Enter 한 번에 승인·정지된다). 위치는 absolute라 화면은 같다.
function DialogContent({
  className,
  children,
  showCloseButton = true,
  initialFocus,
  align = 'center',
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  /** 세로 위치. center는 Mantine Modal centered, top은 Mantine 기본(위 5dvh에서 시작)이다. */
  align?: 'center' | 'top';
}) {
  // Mantine Modal과 같은 약속: 안쪽에 data-autofocus 요소가 있으면 열릴 때 그 요소가 첫 초점이다
  // (강제환불 사유 입력칸 등). 없으면 Base UI 기본(첫 초점 가능 요소 = 닫기 버튼).
  const popupRef = useRef<HTMLDivElement>(null);
  const autofocus = () => popupRef.current?.querySelector<HTMLElement>('[data-autofocus]') ?? true;
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Viewport
        data-slot="dialog-viewport"
        className={cn(
          'pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-[5vw] py-[5dvh]',
          align === 'top' && 'items-start',
        )}
      >
        <DialogPopup
          ref={popupRef}
          initialFocus={initialFocus ?? autofocus}
          data-slot="dialog-content"
          className={cn(
            'pointer-events-auto relative flex max-h-[90dvh] will-change-[opacity] w-[440px] max-w-full flex-col overflow-y-auto rounded-lg bg-background text-black shadow-[0_1px_3px_rgba(0,0,0,0.05),rgba(0,0,0,0.05)_0_36px_28px_-7px,rgba(0,0,0,0.04)_0_17px_17px_-7px] duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          {...props}
        >
          {showCloseButton && (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              aria-label="닫기"
              className={closeButtonClassName}
            >
              <CloseIcon />
            </DialogPrimitive.Close>
          )}
          {children}
        </DialogPopup>
      </DialogPrimitive.Viewport>
    </DialogPortal>
  );
}

// Mantine Modal 머리: 높이 최소 60px, 위아래·왼쪽 16px, 위 모서리 16px 흰 바탕으로 위에 붙는다(본문이 길면 머리 아래로 스크롤).
// 오른쪽은 닫기 버튼(11px + 28px) 자리를 비운다.
function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        'sticky top-0 z-10 flex min-h-[60px] items-center rounded-t-lg bg-background py-4 pr-[47px] pl-4',
        className,
      )}
      {...props}
    />
  );
}

// Mantine Modal 본문: 16px, 머리 다음이면 위 여백 0.
// Mantine처럼 창의 aria-describedby가 본문을 가리키게 Base UI Description으로 그린다(요소는 그대로 div).
// 본문 안에 DialogDescription을 또 두면 바깥(본문)의 id가 쓰인다(효과는 안쪽부터 실행돼 바깥이 나중에 덮는다).
function DialogBody({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-body"
      render={<div />}
      className={cn('px-4 pb-4 first:pt-4', className)}
      {...props}
    />
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
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
