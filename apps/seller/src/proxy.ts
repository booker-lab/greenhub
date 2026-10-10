import { NextResponse } from 'next/server';
import { auth } from '@/auth';

// auth() 래퍼로 감싸야 proxy에서 토큰이 갱신될 때 새 세션 쿠키가 응답에 실린다.
// 인자 없이 `await auth()`를 부르면 갱신된 쿠키가 버려져 다음 요청이 이미 회전된
// refresh token을 다시 보내고, API가 이를 재사용으로 보고 세션을 폐기한다.
export const proxy = auth((request) => {
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

  return NextResponse.next();
});

export const config = {
  matcher: [
    '/((?!login|api|_next/static|_next/image|favicon.ico|manifest.json|icons|sw.js|workbox-.*\\.js).*)',
  ],
};
