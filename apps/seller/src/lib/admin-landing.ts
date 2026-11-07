// 순수 관리자(가게 없는 관리자)가 들어갈 곳. 판매자 화면은 가게 데이터가 없어 빈 화면·오류만 보이므로
// 관리자 콘솔로 보낸다. 겸직 계정(관리자 + 가게)은 판매자 화면을 그대로 쓴다(#CL-52).

import { safeCallbackPath } from './login-callback';

export const ADMIN_HOME_PATH = '/admin/stores';
export const SELLER_HOME_PATH = '/orders';

type SessionUser = { role?: string; storeId?: string | null } | null | undefined;

/** 겸직 판정과 같은 기준(role·storeId)만 본다. 로그인 수단·계정 이름으로 가르지 않는다. */
export function isPureAdmin(user: SessionUser): boolean {
  return user?.role === 'admin' && !user.storeId;
}

export function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

function pathnameOf(path: string): string {
  return path.split(/[?#]/, 1)[0];
}

/**
 * 로그인 직후 갈 곳. 돌아갈 경로(callbackUrl)가 있으면 검증한 뒤 역할에 맞을 때만 쓴다.
 * - 순수 관리자: 관리자 경로만 받고, 그 밖에는 예전처럼 관리자 콘솔로 간다.
 * - 관리자가 아닌 계정: 관리자 경로는 받지 않고 예전처럼 판매자 홈으로 간다.
 * - 겸직 계정: 어느 쪽 경로든 그대로 쓴다.
 */
export function postLoginPath(user: SessionUser, callbackPath?: string | null): string {
  const home = isPureAdmin(user) ? ADMIN_HOME_PATH : SELLER_HOME_PATH;
  const callback = safeCallbackPath(callbackPath);
  if (!callback) return home;
  const toAdmin = isAdminPath(pathnameOf(callback));
  if (isPureAdmin(user)) return toAdmin ? callback : home;
  if (toAdmin && user?.role !== 'admin') return home;
  return callback;
}

/** 카카오 로그인에서 돌아왔다는 표시. 이 표시가 있을 때만 로그인 화면이 세션을 확인해 바로 이동한다. */
export const POST_LOGIN_PARAM = 'postLogin';

/**
 * 카카오 로그인 뒤 돌아올 주소. 돌아갈 경로가 있으면 로그인 화면으로 다시 와서 세션의 역할을 확인한 뒤
 * postLoginPath로 보낸다(로그인 전에는 역할을 몰라 관리자 경로를 그대로 넘기지 않는다).
 * 없으면 예전처럼 판매자 홈으로 가고, 순수 관리자는 proxy가 관리자 콘솔로 보낸다.
 */
export function kakaoCallbackUrl(callbackPath?: string | null): string {
  const callback = safeCallbackPath(callbackPath);
  return callback
    ? `/login?callbackUrl=${encodeURIComponent(callback)}&${POST_LOGIN_PARAM}=1`
    : SELLER_HOME_PATH;
}

/**
 * 로그인 화면이 열리자마자 세션을 확인해 이동할지. 카카오에서 돌아온 경우(표시 있음)에만 한다.
 * 로그아웃·계정 정지로 열린 로그인 화면이 세션을 조회하면, 지워지기 직전 쿠키를 실은 그 요청이
 * 세션 확인 재사용 구간(60초) 안에서 세션 쿠키를 다시 써 로그아웃을 되돌릴 수 있다.
 */
export function shouldContinueAfterLogin(postLogin: unknown): boolean {
  return postLogin === '1';
}
