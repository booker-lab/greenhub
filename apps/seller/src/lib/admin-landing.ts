// 순수 관리자(가게 없는 관리자)가 들어갈 곳. 판매자 화면은 가게 데이터가 없어 빈 화면·오류만 보이므로
// 관리자 콘솔로 보낸다. 겸직 계정(관리자 + 가게)은 판매자 화면을 그대로 쓴다(#CL-52).

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

/** 로그인 직후 갈 곳. */
export function postLoginPath(user: SessionUser): string {
  return isPureAdmin(user) ? ADMIN_HOME_PATH : SELLER_HOME_PATH;
}
