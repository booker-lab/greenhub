'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type AdminNavItem, isAdminNavActive } from './navItems';

// 관리자 상단 메뉴 — 현재 탭을 강조하고(aria-current) 탭 이동은 전체 새로고침 없이 한다.
export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();
  return (
    // ① 외형 유지(UI 교체 P4): Mantine Group(gap 4·가운데·줄바꿈 없음)과 같은 값.
    <nav
      aria-label="관리자 메뉴"
      className="flex flex-row flex-nowrap items-center justify-start gap-1"
    >
      {items.map((item) => {
        const active = isAdminNavActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            style={{
              flexShrink: 0,
              padding: '6px 12px',
              borderRadius: 6,
              fontSize: 'var(--font-size-sm)',
              fontWeight: active ? 'var(--fw-bold)' : 500,
              color: active ? 'var(--color-primary-dark)' : 'var(--color-text-secondary)',
              backgroundColor: active ? 'var(--color-primary-surface)' : 'transparent',
              textDecoration: 'none',
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
