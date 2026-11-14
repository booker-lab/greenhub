import { cookies, headers } from 'next/headers';
import {
  DRIVER_APPLICATION_TICKET_COOKIE,
  driverApplicationCookieOptions,
  isDriverApplicationTicket,
} from './driver-application-ticket';

// 서버 전용: 기사 가입 신청 티켓 쿠키를 쓰고 읽고 지운다(규칙은 `./driver-application-ticket`).
//
// 쓰기는 카카오 로그인 콜백(`GET /api/auth/callback/kakao` 라우트 핸들러 안의 Auth.js signIn 콜백)과
// `/apply` 서버 액션에서만 한다. Next 라우트 핸들러·서버 액션은 cookies()를 바꿀 수 있는 단계('action')로
// 시작하고, 핸들러가 돌려준 응답(Auth.js의 302 리다이렉트 포함)에 바꾼 쿠키를 Set-Cookie로 붙인다
// (next/dist/server/route-modules/app-route/module.js finalizeResponse → appendMutableCookies,
// `src/auth.application-cookie.test.ts`가 설치된 next 소스로 고정한다). 서버 컴포넌트(`/apply` 화면 그리기)에서는
// 읽기만 한다.

export async function storeDriverApplicationTicket(ticket: string): Promise<void> {
  const host = (await headers()).get('host');
  (await cookies()).set(
    DRIVER_APPLICATION_TICKET_COOKIE,
    ticket,
    driverApplicationCookieOptions(host),
  );
}

export async function readDriverApplicationTicket(): Promise<string | null> {
  const value = (await cookies()).get(DRIVER_APPLICATION_TICKET_COOKIE)?.value;
  return isDriverApplicationTicket(value) ? value : null;
}

/** 같은 경로·속성으로 만료시켜 지운다(서버 액션에서만). */
export async function clearDriverApplicationTicket(): Promise<void> {
  const host = (await headers()).get('host');
  (await cookies()).set(DRIVER_APPLICATION_TICKET_COOKIE, '', {
    ...driverApplicationCookieOptions(host),
    maxAge: 0,
  });
}
