import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { ColorSchemeScript } from '@mantine/core';
import Providers from './providers';
import BottomNav from '@/components/BottomNav';
import {
  DEFAULT_SHARE_IMAGE,
  SITE_NAME,
  SITE_SHARE_DESCRIPTION,
  SITE_URL,
} from '@/lib/share-metadata';
import './globals.css';

export const metadata: Metadata = {
  title: '그린러브 | 디어 오키드가 운영하는 화훼 쇼핑몰',
  description: '그린러브는 사업자 디어 오키드가 운영하는 화훼 쇼핑몰입니다.',
  metadataBase: new URL(SITE_URL),
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    locale: 'ko_KR',
    url: SITE_URL,
    title: '그린러브 | 경매 당일 매입 호접란 이천 직배송',
    description: SITE_SHARE_DESCRIPTION,
    images: [{ url: DEFAULT_SHARE_IMAGE }],
  },
  manifest: '/manifest.json',
  icons: { icon: '/icons/icon-192x192.png' },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Green Love',
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
              position: 'relative',
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
