import { NextResponse } from 'next/server';
import { DRIVER_ADMIN_ACCOUNT_ERROR } from '@/app/login/login-notice';
import { auth } from '@/auth';

// auth() 래퍼로 감싸야 proxy에서 토큰이 갱신될 때 새 세션 쿠키가 응답에 실린다.
// 인자 없이 `await auth()`를 부르면 갱신된 쿠키가 버려져 다음 요청이 이미 회전된
// refresh token을 다시 보내고, API가 이를 재사용으로 보고 세션을 폐기한다.
export const proxy = auth((request) => {
  const session = request.auth;

  if (!session) {
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

  return NextResponse.next();
});

export const config = {
  matcher: ['/board/:path*', '/map/:path*', '/profile/:path*'],
};
