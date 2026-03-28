import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const session = await auth();
  const { pathname } = request.nextUrl;

  // 미로그인 → /login 리다이렉트
  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // 프로필 미완성(storeId 없음) → /onboarding 강제 이동
  if (!session.user.storeId && pathname !== "/onboarding") {
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }

  // 온보딩 완료 후 /onboarding 재접근 시 /orders로 이동
  if (session.user.storeId && pathname === "/onboarding") {
    return NextResponse.redirect(new URL("/orders", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!login|api|_next/static|_next/image|favicon.ico|manifest.json|icons|sw.js|workbox-.*\\.js).*)",
  ],
};
