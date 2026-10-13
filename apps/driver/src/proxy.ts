import { type NextFetchEvent, type NextRequest, NextResponse } from 'next/server';
import { DRIVER_ADMIN_ACCOUNT_ERROR } from '@/app/login/login-notice';
import { auth } from '@/auth';
import { buildContentSecurityPolicy, createCspNonce } from '@/lib/content-security-policy';

// 요청마다 nonce를 만들어 요청 헤더로 넘긴다. Next는 요청의 CSP 헤더에서 nonce를 읽어
// 자기 스크립트에 붙이고, 루트 layout은 x-nonce를 읽어 인라인 스크립트에 붙인다.
// 응답에는 같은 정책을 Report-Only로만 보낸다(차단하지 않고 /api/csp-report로 보고만 받는다).
function continueWithCsp(request: NextRequest): NextResponse {
  const nonce = createCspNonce();
  const policy = buildContentSecurityPolicy({
    nonce,
    nodeEnv: process.env.NODE_ENV,
    apiUrl: process.env.NEXT_PUBLIC_API_URL,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy-Report-Only', policy);
  return response;
}

// 로그인 검사는 아래 config.matcher의 앞 세 경로(이전 matcher)에서만 한다.
const AUTH_PATH_PREFIXES = ['/board', '/map', '/profile'];

function isAuthGatedPath(pathname: string): boolean {
  return AUTH_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

// auth() 래퍼로 감싸야 proxy에서 토큰이 갱신될 때 새 세션 쿠키가 응답에 실린다.
// 인자 없이 `await auth()`를 부르면 갱신된 쿠키가 버려져 다음 요청이 이미 회전된
// refresh token을 다시 보내고, API가 이를 재사용으로 보고 세션을 폐기한다.
const authGate = auth((request) => {
  const session = request.auth;

  // 세션 객체가 있어도 필수 필드(role)가 없으면 로그인하지 않은 것으로 본다.
  if (!session?.user?.role) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // 기사 앱은 기사(driver) 역할만 받는다(2026-10-04 결정). 로그인과 jwt callback이 먼저
  // 걸러내지만, 이미 쿠키에 남은 관리자 세션도 기사 화면에 들이지 않고 로그인 안내로 보낸다.
  if (session.user.role !== 'driver') {
    const url = new URL('/login', request.url);
    if (session.user.role === 'admin') {
      url.searchParams.set('error', DRIVER_ADMIN_ACCOUNT_ERROR);
    }
    return NextResponse.redirect(url);
  }

  return continueWithCsp(request);
});

type AuthGateContext = Parameters<typeof authGate>[1];

export function proxy(request: NextRequest, event: NextFetchEvent) {
  // 로그인 검사가 없는 경로에서는 세션을 읽거나 갱신하지 않는다.
  if (!isAuthGatedPath(request.nextUrl.pathname)) return continueWithCsp(request);
  // auth()는 두 번째 인자를 위 콜백에 그대로 넘길 뿐 쓰지 않는다.
  return authGate(request, event as unknown as AuthGateContext);
}

export const config = {
  matcher: [
    // 로그인 검사 경로(이전 matcher 그대로). 프리페치 요청도 이전처럼 검사한다.
    '/board/:path*',
    '/map/:path*',
    '/profile/:path*',
    // 그 밖의 페이지 문서에는 CSP nonce만 붙인다. API, Next 내부 경로, 확장자가 있는
    // 정적 파일(sw.js·workbox-*.js·manifest.json·아이콘·글꼴 등)과 프리페치 요청은 제외한다.
    {
      source: '/((?!api/|_next/|.*\\.\\w+$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
