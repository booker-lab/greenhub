import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  const session = await auth();
  const { pathname } = request.nextUrl;

  // 미로그인 → /login 리다이렉트
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const isAdmin = session.user.role === 'admin';

  // 프로필 미완성(storeId 없음) → /onboarding 강제 이동 (admin 제외)
  if (!isAdmin && !session.user.storeId && pathname !== '/onboarding') {
    return NextResponse.redirect(new URL('/onboarding', request.url));
  }

  // admin이 /onboarding 접근 시 /admin으로 이동
  if (isAdmin && pathname === '/onboarding') {
    return NextResponse.redirect(new URL('/admin/stores', request.url));
  }

  // 온보딩 완료 후 /onboarding 재접근 시 /orders로 이동
  if (!isAdmin && session.user.storeId && pathname === '/onboarding') {
    return NextResponse.redirect(new URL('/orders', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!login|api|_next/static|_next/image|favicon.ico|manifest.json|icons|sw.js|workbox-.*\\.js).*)',
  ],
};
