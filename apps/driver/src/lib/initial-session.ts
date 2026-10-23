import type { Session } from 'next-auth';

/**
 * proxy가 이미 확인한 세션을 같은 요청의 서버 렌더(루트 layout)로 넘기는 요청 헤더.
 *
 * layout에서 auth()를 다시 부르지 않는다. proxy가 토큰을 갱신해도 새 쿠키는 응답에만 실리고
 * 이 요청의 쿠키는 그대로라, layout의 auth()는 이미 회전된 refresh token으로 다시 갱신해
 * API가 재사용으로 보고 세션을 폐기할 수 있다(API 세션 확인 왕복도 한 번 더 생긴다).
 *
 * 값은 /api/auth/session 응답과 같은 세션 객체(auth.ts session callback 결과)다. 화면은 원래
 * 그 응답을 받아 쓰므로 클라이언트에 새로 드러나는 값은 없다. 이름 등 한글이 있어 헤더에
 * 그대로 실을 수 없으므로 URI 인코딩한다.
 */
export const INITIAL_SESSION_HEADER = 'x-driver-initial-session';

export function encodeInitialSession(session: Session): string {
  return encodeURIComponent(JSON.stringify(session));
}

/**
 * 헤더 값을 세션으로 되돌린다. 없거나 읽을 수 없거나 기사 세션 모양이 아니면 undefined를 돌려줘
 * SessionProvider가 예전처럼 /api/auth/session을 직접 조회하게 한다(null은 비로그인 확정이라 쓰지 않는다).
 */
export function decodeInitialSession(value: string | null | undefined): Session | undefined {
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(value));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const user = (parsed as { user?: unknown }).user;
  if (!user || typeof user !== 'object') return undefined;
  if ((user as { role?: unknown }).role !== 'driver') return undefined;
  return parsed as Session;
}
