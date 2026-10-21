import { type NextFetchEvent, type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { ADMIN_HOME_PATH, isAdminPath, isPureAdmin } from '@/lib/admin-landing';
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

// 로그인 검사 대상은 이전 matcher와 같은 식으로 고른다(config.matcher의 첫 항목과 같다).
// 판매자 초대 링크(/invite/[token])는 로그인 전에 여는 화면이라 검사하지 않는다.
const AUTH_GATED_PATH =
  /^\/(?!login|invite\/|api|_next\/static|_next\/image|favicon.ico|manifest.json|icons|sw.js|workbox-.*\.js)/;

// auth() 래퍼로 감싸야 proxy에서 토큰이 갱신될 때 새 세션 쿠키가 응답에 실린다.
// 인자 없이 `await auth()`를 부르면 갱신된 쿠키가 버려져 다음 요청이 이미 회전된
// refresh token을 다시 보내고, API가 이를 재사용으로 보고 세션을 폐기한다.
const authGate = auth((request) => {
  const session = request.auth;
  const { pathname } = request.nextUrl;

  // 미로그인 → /login 리다이렉트. 세션 객체가 있어도 필수 필드(role)가 없으면 미로그인으로 본다.
  if (!session?.user?.role) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const isAdmin = session.user.role === 'admin';

  // 프로필 미완성(storeId 없음) → /onboarding 강제 이동 (admin 제외)
  if (!isAdmin && !session.user.storeId && pathname !== '/onboarding') {
    return NextResponse.redirect(new URL('/onboarding', request.url));
  }

  // 순수 어드민(store 없음)이 /onboarding 접근 시 /admin으로 이동.
  // 겸직 계정(admin + storeId)은 자기 store 프로필 수정이 필요하므로 제외 (#CL-52)
  if (isAdmin && !session.user.storeId && pathname === '/onboarding') {
    return NextResponse.redirect(new URL('/admin/stores', request.url));
  }

  // storeId 있어도 /onboarding 재접근 허용 — 설정 > 사업자 정보 수정 경로

  // 순수 어드민이 판매자 화면(/orders 등)에 들어오면 관리자 콘솔로 보낸다. 가게가 없어
  // 판매자 화면은 빈 화면·오류만 보인다. 겸직 계정은 판매자 화면을 그대로 쓴다.
  if (isPureAdmin(session.user) && !isAdminPath(pathname)) {
    return NextResponse.redirect(new URL(ADMIN_HOME_PATH, request.url));
  }

  return continueWithCsp(request);
});

type AuthGateContext = Parameters<typeof authGate>[1];

export function proxy(request: NextRequest, event: NextFetchEvent) {
  // 로그인 화면처럼 검사 대상이 아닌 경로에서는 세션을 읽거나 갱신하지 않는다.
  if (!AUTH_GATED_PATH.test(request.nextUrl.pathname)) return continueWithCsp(request);
  // auth()는 두 번째 인자를 위 콜백에 그대로 넘길 뿐 쓰지 않는다.
  return authGate(request, event as unknown as AuthGateContext);
}

export const config = {
  matcher: [
    // 로그인 검사 경로(이전 matcher 그대로). 프리페치 요청도 이전처럼 검사한다.
    '/((?!login|invite/|api|_next/static|_next/image|favicon.ico|manifest.json|icons|sw.js|workbox-.*\\.js).*)',
    // 그 밖의 페이지 문서(/login 등)에는 CSP nonce만 붙인다. API, Next 내부 경로, 확장자가
    // 있는 정적 파일과 프리페치 요청은 제외한다.
    {
      source: '/((?!api/|_next/|.*\\.\\w+$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
