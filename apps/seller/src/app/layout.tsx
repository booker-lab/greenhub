import { COLOR_SCHEME_SCRIPT } from '@greenhub/shared';
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
    // data-theme은 hydration 전에 인라인 스크립트가 넣으므로 html 속성 차이 경고를 끈다(html 요소 자신만 해당).
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* 화면 모드 직접 선택(D5-b, design-direction.md §9.3): 첫 페인트 전에 저장값으로 <html data-theme>을 정한다.
            고정 문자열이라 CSP script-src에 sha256 해시로 허용한다(@greenhub/shared color-scheme.ts). */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: 고정 상수 스크립트(사용자 입력 없음), CSP 해시와 짝이다 */}
        <script dangerouslySetInnerHTML={{ __html: COLOR_SCHEME_SCRIPT }} />
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
