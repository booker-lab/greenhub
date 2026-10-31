import type { Metadata, Viewport } from 'next';
import { mantineHtmlProps } from '@mantine/core';
import Providers from './providers';
import BottomNav from '@/components/BottomNav';
import { enabledFeatureKeys } from '@/lib/features';
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
    images: [{ url: DEFAULT_SHARE_IMAGE, width: 1200, height: 630, alt: SITE_NAME }],
  },
  manifest: '/manifest.json',
  icons: { icon: '/icons/icon-192x192.png' },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Green Love',
  },
  // 네이버 서치어드바이저 소유 확인(HTML 태그 방식). 지우면 소유 확인이 풀린다.
  verification: {
    other: { 'naver-site-verification': 'a69f8be2ede55c9efa26e8e75d077f9e9ea8ecbe' },
  },
};

export const viewport: Viewport = {
  themeColor: '#00A65A',
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  viewportFit: 'cover',
};

// 루트 layout은 요청 헤더를 읽지 않는다. 읽으면 모든 화면이 요청마다 서버에서 만들어져 공개 화면을
// CDN에 둘 수 없다. 색상 모드는 밝은 모드 하나뿐이라(전환 기능 없음) 인라인 색상 모드 스크립트 대신
// html 속성(data-mantine-color-scheme="light")으로 고정한다. 인라인 스크립트가 없으므로 nonce도 필요 없다.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" {...mantineHtmlProps}>
      <head>
        {/* 빌드 때 켜진 기능 토글 키(쉼표 목록, 꺼짐이면 빈 값). E2E가 배포 빌드의 토글을 읽는다. */}
        <meta name="greenhub-features" content={enabledFeatureKeys().join(',')} />
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
