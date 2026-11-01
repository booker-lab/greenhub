'use client';

import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@greenhub/ui/components/sheet';
import { usePathname } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { AdminLogoutButton } from './AdminLogoutButton';
import { AdminNav } from './AdminNav';
import type { AdminNavGroup } from './navItems';
import { useAdminTodoCounts } from './useAdminTodoCounts';

// 어드민 틀 — "옅은 틀과 흰 종이"(design-direction.md §5, D3·D7).
// 사이드바와 48px 상단바는 틀 색(bg-frame) 한 가지이고 둘 사이에 선이 없다. 작업 영역은 1px 테두리의 흰 종이 한 장이며,
// 종이 높이는 내용에 맞춘다(화면 바닥까지 늘이지 않는다). 그림자는 쓰지 않는다.
// 태블릿 이하(1100px 이하)는 사이드바를 접고 상단바의 메뉴 버튼이 왼쪽 메뉴 시트를 연다.
// 폭 기준 클래스는 Tailwind가 소스 글자로 찾으므로 `min-[1101px]:`를 조합하지 않고 그대로 쓴다.

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3 5h14M3 10h14M3 15h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Brand() {
  return (
    <span className="flex items-baseline gap-2">
      <span className="font-brand text-lg font-extrabold text-brand-ink">Green Love</span>
      <span className="text-sm font-bold text-foreground">운영</span>
    </span>
  );
}

export function AdminShell({
  groups,
  showSellerLink,
  children,
}: {
  groups: AdminNavGroup[];
  /** 겸직 계정(어드민 + 자기 store 보유)만 셀러 화면 복귀 링크를 둔다 (#CL-52). */
  showSellerLink: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const counts = useAdminTodoCounts(pathname);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-frame text-foreground">
      <header className="sticky top-0 z-10 flex h-12 items-center justify-between gap-3 bg-frame px-4">
        <div className="flex items-center gap-2">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger
              aria-label="메뉴 열기"
              className={`-ml-2 flex size-11 cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent text-foreground min-[1101px]:hidden`}
            >
              <MenuIcon />
            </SheetTrigger>
            <SheetContent
              side="left"
              className="rounded-none bg-frame data-[side=left]:max-w-[320px]"
            >
              <SheetHeader className="bg-frame">
                <SheetTitle>
                  <Brand />
                </SheetTitle>
              </SheetHeader>
              <SheetBody>
                <AdminNav groups={groups} counts={counts} onNavigate={() => setMenuOpen(false)} />
              </SheetBody>
            </SheetContent>
          </Sheet>
          <Brand />
        </div>
        <div className="flex items-center gap-4 text-sm">
          {showSellerLink && (
            <a href="/orders" className="text-foreground underline underline-offset-4">
              셀러 화면으로
            </a>
          )}
          <AdminLogoutButton />
        </div>
      </header>
      <div className={`flex items-start gap-4 px-2 pb-6 min-[1101px]:px-4`}>
        <aside className={`sticky top-12 hidden w-[208px] shrink-0 pt-2 min-[1101px]:block`}>
          <AdminNav groups={groups} counts={counts} />
        </aside>
        <main
          className={`min-w-0 flex-1 rounded-[12px] border border-rule bg-card p-4 min-[1101px]:p-6`}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
