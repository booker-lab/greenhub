import { THEME_INIT_SCRIPT } from '@greenhub/shared';
import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import AppShell from '@/components/AppShell';
import BottomNav from '@/components/BottomNav';
import Providers from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Green Love 판매자',
  description: 'Green Love 판매자 관리 앱',
  manifest: '/manifest.json',
  icons: { icon: '/icons/icon-192x192.png' },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'GreenLove 판매자',
  },
};

export const viewport: Viewport = {
  // 다크 모드(D5, design-direction.md §9.3): 기기 설정을 따르는 정적 메타 두 값. 어둠은 판매자·어드민 상단 바의 틀 색(#0F1311)이다.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#00A65A' },
    { media: '(prefers-color-scheme: dark)', color: '#0F1311' },
  ],
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 요청마다 그린다. proxy가 요청 CSP 헤더에 넣은 nonce를 Next가 자기 스크립트에 붙이려면 동적 렌더링이어야 한다
  // (Mantine 색상 모드 스크립트에 nonce를 넘기려고 요청 헤더를 읽던 동안과 같은 렌더링 방식).
  await connection();
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* 다크 모드 직접 전환(D5-b, design-direction.md §9.3): 저장된 밝게·어둡게를 칠하기 전에 <html data-theme>으로
            적용한다. 고정 글자라 CSP(Report-Only)는 해시로 허용한다(@greenhub/shared theme-preference.ts). */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: 고정 문자열(사용자 입력 없음)이고 CSP 해시로 허용한다
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
