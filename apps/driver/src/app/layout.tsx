import { COLOR_SCHEME_SCRIPT } from '@greenhub/shared';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import Providers from './providers';
import BottomNav from '@/components/BottomNav';
import { decodeInitialSession, INITIAL_SESSION_HEADER } from '@/lib/initial-session';
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
  // 다크 모드(D5, design-direction.md §9.3): 기기 설정을 따르는 정적 메타 두 값. 어둠은 기사 바탕(#121212)이다.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#00A65A' },
    { media: '(prefers-color-scheme: dark)', color: '#121212' },
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
  const requestHeaders = await headers();
  // proxy가 보호 경로에서 이미 확인한 기사 세션. 없으면(공개 경로) 화면이 예전처럼 직접 조회한다.
  const initialSession = decodeInitialSession(requestHeaders.get(INITIAL_SESSION_HEADER));
  return (
    // data-theme은 hydration 전에 인라인 스크립트가 넣으므로 html 속성 차이 경고를 끈다(html 요소 자신만 해당).
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* 화면 모드 직접 선택(D5-b, design-direction.md §9.3): 첫 페인트 전에 저장값으로 <html data-theme>을 정한다.
            고정 문자열이라 CSP script-src에 sha256 해시로 허용한다(@greenhub/shared color-scheme.ts). */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: 고정 상수 스크립트(사용자 입력 없음), CSP 해시와 짝이다 */}
        <script dangerouslySetInnerHTML={{ __html: COLOR_SCHEME_SCRIPT }} />
      </head>
      <body>
        <Providers session={initialSession}>
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
