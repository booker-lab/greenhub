// MY 화면을 로그인하지 않은 채 열었을 때 보낼 로그인 주소. 다시 로그인하면 보던 화면으로 돌아오게 한다.
// 복귀 주소 규칙은 세션 만료용 buildSessionExpiredLoginUrl(lib/session-login.ts)과 같고,
// 단순 비로그인이라 만료 이유(reason=expired)는 붙이지 않는다.
// 로그인 화면은 callbackUrl을 같은 출처 상대 경로로만 받아들인다(app/login/_callback-url.ts).

const LOGIN_PATH = '/login';
// 주소를 읽을 수 없을 때(브라우저 밖) 돌아올 곳.
const FALLBACK_PATH = '/mypage';

function isLoginPath(pathname: string): boolean {
  return pathname === LOGIN_PATH || pathname === `${LOGIN_PATH}/`;
}

/**
 * 지금 보던 경로+쿼리를 callbackUrl로 실은 로그인 주소를 만든다.
 *
 * - 홈('/')이면 callbackUrl을 싣지 않는다(로그인 화면의 기본 복귀 주소가 홈이다).
 * - 이미 로그인 화면이면 그 화면의 callbackUrl을 그대로 이어 쓴다(로그인 화면을 복귀 주소로 겹쳐 싣지 않는다).
 * - reason은 싣지 않는다.
 */
export function buildMyPageLoginUrl(pathname: string, search: string): string {
  let callbackUrl: string | null;
  if (isLoginPath(pathname)) {
    callbackUrl = new URLSearchParams(search).get('callbackUrl');
  } else {
    const query = search.replace(/^\?/, '');
    callbackUrl = `${pathname || '/'}${query ? `?${query}` : ''}`;
  }
  if (!callbackUrl || callbackUrl === '/') return LOGIN_PATH;
  return `${LOGIN_PATH}?${new URLSearchParams({ callbackUrl }).toString()}`;
}

/** 브라우저의 현재 주소로 로그인 주소를 만든다. 주소를 읽을 수 없으면 MY로 돌아오게 한다. */
export function currentMyPageLoginUrl(
  location: { pathname: string; search: string } | undefined = typeof window === 'undefined'
    ? undefined
    : window.location,
): string {
  return location
    ? buildMyPageLoginUrl(location.pathname, location.search)
    : buildMyPageLoginUrl(FALLBACK_PATH, '');
}
