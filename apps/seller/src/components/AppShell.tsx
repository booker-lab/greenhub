'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** 어드민 콘솔(/admin)은 PC 표를 쓰므로 폭 제한을 풀고, 판매자 화면은 모바일 폭(480px)을 유지한다. */
export function isAdminPath(pathname: string) {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const wide = isAdminPath(pathname);

  return (
    <div
      style={{
        maxWidth: wide ? 'none' : 480,
        margin: '0 auto',
        position: 'relative',
        backgroundColor: 'var(--color-bg)',
        minHeight: '100dvh',
      }}
    >
      {children}
    </div>
  );
}
