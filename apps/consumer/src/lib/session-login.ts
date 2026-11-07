// 세션이 끝났을 때 로그인 화면으로 보내는 주소와 그 이유 판정, 로그인 화면을 건너뛸 세션 판정.
// 로그인 화면은 callbackUrl을 같은 출처 상대 경로로만 받아들인다(app/login/_callback-url.ts).

export const LOGIN_PATH = '/login';
export const SESSION_EXPIRED_REASON = 'expired';

function isLoginPath(pathname: string): boolean {
  return pathname === LOGIN_PATH || pathname === `${LOGIN_PATH}/`;
}

/**
 * 세션이 끝났을 때 보낼 로그인 주소를 만든다.
 *
 * - 지금 보던 경로+쿼리를 callbackUrl로 실어, 다시 로그인하면 그 화면으로 돌아오게 한다.
 * - 홈('/')이면 callbackUrl을 싣지 않는다(로그인 화면의 기본 복귀 주소가 홈이다).
 * - 이미 로그인 화면이면 그 화면의 callbackUrl을 그대로 이어 쓴다(로그인 화면을 복귀 주소로 겹쳐 싣지 않는다).
 * - 이유(reason=expired)를 실어 로그인 화면이 만료 안내를 보이게 한다.
 */
export function buildSessionExpiredLoginUrl(pathname: string, search: string): string {
  const params = new URLSearchParams();
  let callbackUrl: string | null;
  if (isLoginPath(pathname)) {
    callbackUrl = new URLSearchParams(search).get('callbackUrl');
  } else {
    const query = search.replace(/^\?/, '');
    callbackUrl = `${pathname || '/'}${query ? `?${query}` : ''}`;
  }
  if (callbackUrl && callbackUrl !== '/') params.set('callbackUrl', callbackUrl);
  params.set('reason', SESSION_EXPIRED_REASON);
  return `${LOGIN_PATH}?${params.toString()}`;
}

/** 로그인 화면 주소의 reason 값이 세션 만료인지. */
export function isSessionExpiredReason(reason: string | null | undefined): boolean {
  return reason === SESSION_EXPIRED_REASON;
}

type SessionLike =
  | {
      user?: { role?: string | null; tokenError?: boolean | null } | null;
    }
  | null
  | undefined;

// auth.ts가 소비자 앱 세션으로 만들어 주는 역할과 같다.
const SIGNED_IN_ROLES = ['consumer', 'admin'];

/**
 * 로그인 화면을 건너뛰어도 되는 세션인지.
 * 역할이 있고 토큰 오류가 없어야 한다. 토큰 오류 세션은 곧 로그아웃되므로 로그인 화면에 남긴다.
 */
export function hasActiveSession(session: SessionLike): boolean {
  const user = session?.user;
  if (!user || user.tokenError) return false;
  return typeof user.role === 'string' && SIGNED_IN_ROLES.includes(user.role);
}
