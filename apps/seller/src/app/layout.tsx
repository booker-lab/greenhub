import { ColorSchemeScript } from '@mantine/core';
import '@mantine/notifications/styles.css';
import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import { headers } from 'next/headers';
import AppShell from '@/components/AppShell';
import BottomNav from '@/components/BottomNav';
import Providers from './providers';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

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
  // proxy가 요청마다 만든 CSP nonce. 인라인 색상 모드 스크립트에 붙인다.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="ko" className={geistSans.variable} suppressHydrationWarning>
      <head>
        <ColorSchemeScript nonce={nonce} />
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
