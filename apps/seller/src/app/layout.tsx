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
  // 요청마다 그린다. proxy가 요청 CSP 헤더에 넣은 nonce를 Next가 자기 스크립트에 붙이려면 동적 렌더링이어야 한다
  // (Mantine 색상 모드 스크립트에 nonce를 넘기려고 요청 헤더를 읽던 동안과 같은 렌더링 방식).
  await connection();
  return (
    <html lang="ko">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
