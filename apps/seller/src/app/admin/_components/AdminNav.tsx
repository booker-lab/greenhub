'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ADMIN_TODO_PROBLEM,
  type AdminNavGroup,
  type AdminTodoCounts,
  formatAdminTodoCount,
  isAdminNavActive,
} from './navItems';

// 관리자 메뉴 — 할 일 순서로 묶고, 메뉴 오른쪽에는 처리할 일의 수만 쓴다(design-direction.md §5 어드민 "틀").
// 현재 메뉴는 흰 면 + 1px 테두리 + 굵은 글자로만 표시하고 브랜드 색을 칠하지 않는다(aria-current="page").
// 메뉴 이동은 전체 새로고침 없이 한다(next/link, 링크 의미 유지). 목록(ul/li)을 쓰지 않는다 — 어드민 E2E가
// listitem 역할로 화면의 행을 찾는다(apps/e2e/tests/_helpers/admin-local.ts rowOrListItem).
export function AdminNav({
  groups,
  counts,
  onNavigate,
}: {
  groups: AdminNavGroup[];
  counts: AdminTodoCounts;
  /** 메뉴 시트(태블릿 이하)에서 메뉴를 누르면 시트를 닫는다. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="관리자 메뉴" className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p className="m-0 px-3 text-xs text-muted-foreground">{group.label}</p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isAdminNavActive(pathname, item.href);
              const todo = item.todo ? formatAdminTodoCount(counts[item.todo]) : null;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  onClick={onNavigate}
                  className={`flex min-h-10 items-center justify-between gap-3 rounded-[8px] border px-3 text-sm text-foreground no-underline ${
                    active ? 'border-rule bg-card font-bold' : 'border-transparent font-normal'
                  }`}
                >
                  <span>{item.label}</span>
                  {todo && item.todo && (
                    <span
                      className={`tabular-nums font-bold ${
                        ADMIN_TODO_PROBLEM[item.todo] ? 'text-destructive' : 'text-foreground'
                      }`}
                    >
                      <span className="sr-only">{', 처리할 일 '}</span>
                      {todo}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
