import { type NextFetchEvent, type NextRequest, NextResponse } from 'next/server';
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

// 로그인 검사는 아래 config.matcher의 앞 네 경로(이전 matcher)에서만 한다.
const AUTH_PATH_PREFIXES = ['/mypage', '/checkout', '/order'];

// 비회원 장바구니(guest-cart, 팔도감 벤치마킹 비교 기능)가 켜지면 장바구니는 로그인 없이 열고,
// 결제(/checkout)에서 로그인한다. 값은 빌드 때 굳는다(packages/shared features.ts와 같은 형식).
// 테스트가 proxy만 따로 읽으므로 기능 토글 모듈을 불러오지 않고 여기서 직접 읽는다.
export function isGuestCartEnabled(value: string | undefined): boolean {
  const keys = (value ?? '').split(',').map((key) => key.trim());
  return keys.includes('all') || keys.includes('guest-cart');
}
const GUEST_CART = isGuestCartEnabled(process.env.NEXT_PUBLIC_GREENHUB_FEATURES);

function isAuthGatedPath(pathname: string): boolean {
  if (pathname === '/cart' || pathname === '/cart/') return !GUEST_CART;
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
    // 로그인 뒤 원래 보던 화면(경로+쿼리)으로 돌아오도록 복귀 주소를 싣는다.
    // 로그인 화면은 이 값을 같은 출처 상대 경로로만 받아들인다(login/_callback-url.ts).
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set(
      'callbackUrl',
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(loginUrl);
  }

  if (session.user.role === 'driver') {
    return NextResponse.redirect(new URL('/login', request.url));
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
    '/mypage/:path*',
    '/cart',
    '/checkout/:path*',
    '/order/:path*',
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
