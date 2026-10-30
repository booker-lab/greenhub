'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { text } from './look';

const TABS = [
  {
    href: '/board',
    label: '작업 보드',
    icon: (active: boolean) => (
      <svg
        width="24"
        height="24"
        fill="none"
        stroke={active ? 'var(--color-primary)' : 'var(--color-text-disabled)'}
        strokeWidth={active ? 2.2 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
  },
  {
    href: '/map',
    label: '지도',
    icon: (active: boolean) => (
      <svg
        width="24"
        height="24"
        fill="none"
        stroke={active ? 'var(--color-primary)' : 'var(--color-text-disabled)'}
        strokeWidth={active ? 2.2 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
      </svg>
    ),
  },
  {
    href: '/profile',
    label: '내 정보',
    icon: (active: boolean) => (
      <svg
        width="24"
        height="24"
        fill="none"
        stroke={active ? 'var(--color-primary)' : 'var(--color-text-disabled)'}
        strokeWidth={active ? 2.2 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
] as const;

export default function BottomNav() {
  const pathname = usePathname();

  if (pathname === '/login') return null;

  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        backgroundColor: 'var(--color-bg)',
        borderTop: 'var(--border)',
        height: 'calc(72px + env(safe-area-inset-bottom))',
        paddingBottom: 'env(safe-area-inset-bottom)',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div style={{ maxWidth: 430, width: '100%', display: 'flex' }}>
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex-1 cursor-pointer text-inherit no-underline"
            >
              <div className="flex h-full flex-col items-center justify-center gap-1">
                {tab.icon(active)}
                <p
                  className={text}
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: active ? 'var(--fw-bold)' : 'var(--fw-medium)',
                    color: active ? 'var(--color-primary-dark)' : 'var(--color-text-disabled)',
                  }}
                >
                  {tab.label}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
