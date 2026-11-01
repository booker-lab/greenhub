'use client';

import { Menu as MenuPrimitive } from '@base-ui/react/menu';

import { cn } from '../lib/utils';

// ② 방향(design-direction.md §5 어드민 "행 동작"): 행 끝 ⋮ 메뉴. 처리가 필요하지 않은 동작(정상 주문 환불, 배송 후 환불,
// 수수료 바꾸기, 정리하기, 정지)을 넣는다. 메뉴 역할·키보드(화살표·Enter·Esc, 닫으면 트리거로 초점 복귀)는 Base UI Menu에 맡긴다.
// 면은 흰 종이 + 1px rule 테두리이고 쉬는 그림자는 쓰지 않는다(떠 있는 메뉴라 아주 옅은 그림자 하나만 둔다).
// 새 파일이며 다른 컴포넌트 기본값은 바꾸지 않는다.

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger({ className, ...props }: MenuPrimitive.Trigger.Props) {
  return (
    <MenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      className={cn(
        'inline-flex size-11 cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent text-foreground outline-none hover:bg-[var(--color-surface-muted)] focus-visible:outline-2 focus-visible:outline-foreground disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

/** ⋮ 아이콘(세로 점 셋). 트리거 안에 넣는다. 이름은 트리거의 aria-label이 전한다. */
function DropdownMenuDotsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="3.5" r="1.6" />
      <circle cx="9" cy="9" r="1.6" />
      <circle cx="9" cy="14.5" r="1.6" />
    </svg>
  );
}

function DropdownMenuContent({
  className,
  align = 'end',
  sideOffset = 4,
  ...props
}: MenuPrimitive.Popup.Props & {
  align?: MenuPrimitive.Positioner.Props['align'];
  sideOffset?: number;
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="z-50 outline-none"
        side="bottom"
        align={align}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            'min-w-[180px] rounded-[8px] border border-rule bg-card p-1 text-[15px] text-foreground shadow-[0_4px_12px_rgba(0,0,0,0.08)] outline-none',
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function DropdownMenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        'flex min-h-10 cursor-pointer items-center rounded-[6px] px-3 whitespace-nowrap outline-none select-none data-disabled:cursor-not-allowed data-disabled:text-[var(--color-text-secondary)] data-highlighted:bg-[var(--color-surface-muted)]',
        className,
      )}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuDotsIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
};
