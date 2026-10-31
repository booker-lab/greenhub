import { ColorSchemeScript } from '@mantine/core';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import AppShell from '@/components/AppShell';
import BottomNav from '@/components/BottomNav';
import { decodeInitialSession, INITIAL_SESSION_HEADER } from '@/lib/initial-session';
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
  themeColor: '#00A65A',
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
  const requestHeaders = await headers();
  // proxy가 요청마다 만든 CSP nonce. 인라인 색상 모드 스크립트에 붙인다.
  const nonce = requestHeaders.get('x-nonce') ?? undefined;
  // proxy가 보호 경로에서 이미 확인한 판매자 세션. 없으면(로그인·초대 화면) 화면이 예전처럼 직접 조회한다.
  const initialSession = decodeInitialSession(requestHeaders.get(INITIAL_SESSION_HEADER));
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <ColorSchemeScript nonce={nonce} />
      </head>
      <body>
        <Providers session={initialSession}>
          <AppShell>{children}</AppShell>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
