import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';

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

  // 순수 어드민(store 없음)이 /onboarding 접근 시 /admin으로 이동.
  // 겸직 계정(admin + storeId)은 자기 store 프로필 수정이 필요하므로 제외 (#CL-52)
  if (isAdmin && !session.user.storeId && pathname === '/onboarding') {
    return NextResponse.redirect(new URL('/admin/stores', request.url));
  }

  // storeId 있어도 /onboarding 재접근 허용 — 설정 > 사업자 정보 수정 경로

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!login|api|_next/static|_next/image|favicon.ico|manifest.json|icons|sw.js|workbox-.*\\.js).*)',
  ],
};
