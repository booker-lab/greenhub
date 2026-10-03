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

  // 관리자 세션은 로그인·세션 계약상 유지되지만, 기사 화면의 모든 조회 API(`/driver/*`)는
  // driver 역할만 허용해 403만 반복된다. 막다른 재시도 대신 로그인 화면 안내로 보낸다.
  if (session.user.role === 'admin') {
    const url = new URL('/login', request.url);
    url.searchParams.set('error', DRIVER_ADMIN_ACCOUNT_ERROR);
    return NextResponse.redirect(url);
  }

  if (session.user.role !== 'driver') {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/board/:path*', '/map/:path*', '/profile/:path*'],
};
