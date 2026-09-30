import { NextResponse } from 'next/server';
import { auth } from '@/auth';

// auth() 래퍼로 감싸야 proxy에서 토큰이 갱신될 때 새 세션 쿠키가 응답에 실린다.
// 인자 없이 `await auth()`를 부르면 갱신된 쿠키가 버려져 다음 요청이 이미 회전된
// refresh token을 다시 보내고, API가 이를 재사용으로 보고 세션을 폐기한다.
export const proxy = auth((request) => {
  const session = request.auth;

  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (!['driver', 'admin'].includes(session.user.role)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/board/:path*', '/map/:path*', '/profile/:path*'],
};
