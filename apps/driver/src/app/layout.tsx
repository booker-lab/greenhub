import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { ColorSchemeScript } from '@mantine/core';
import Providers from './providers';
import BottomNav from '@/components/BottomNav';
import './globals.css';

export const metadata: Metadata = {
  title: 'Green Love 드라이버',
  description: 'Green Love 드라이버 배송 앱',
  manifest: '/manifest.json',
  icons: { icon: '/icons/icon-192x192.png' },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: '그린러브드라이버',
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
    <html lang="ko" suppressHydrationWarning>
      <head>
        <ColorSchemeScript nonce={nonce} />
      </head>
      <body>
        <Providers>
          <div
            style={{
              maxWidth: 430,
              margin: '0 auto',
              backgroundColor: 'var(--color-bg)',
              minHeight: '100dvh',
            }}
          >
            {children}
          </div>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
