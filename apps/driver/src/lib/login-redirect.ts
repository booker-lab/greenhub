/**
 * 기사 앱 로그인 이동·복귀 판정 (DOM·Next 의존 없음, node:test로 검증).
 *
 * - 세션이 끝나 로그인 화면으로 보낼 때 보던 화면 경로를 `callbackUrl`로 싣고,
 *   로그인 뒤(또는 이미 로그인한 채 `/login`을 열었을 때) 그 경로로 돌려보낸다.
 * - `callbackUrl`은 같은 출처의 앱 경로만 허용한다(열린 리다이렉트 방지). 로그인 화면 자신과
 *   `/api`는 돌아갈 곳이 아니므로 거절한다(`/login?callbackUrl=%2Flogin` 자기 순환 방지).
 *   허용하지 않는 값은 모두 작업 보드(`/board`).
 */

export const DRIVER_DEFAULT_RETURN_PATH = '/board';
export const DRIVER_LOGIN_PATH = '/login';

// 세션이 끝나 로그인 화면으로 보낼 때 붙이는 `reason` 값. 로그인 화면이 만료 안내를 보인다.
export const DRIVER_SESSION_ENDED_REASON = 'expired';

const PROBE_ORIGIN = 'http://driver-return-check.invalid';
const MAX_RETURN_PATH_LENGTH = 2048;

// 브라우저 URL 파서는 탭·줄바꿈 등 제어 문자를 지우고 `\`를 `/`로 바꾼다.
// `/\evil.com`, `/\t/evil.com` 같은 값이 `//evil.com`(다른 출처)이 될 수 있어 위치와 상관없이 거부한다.
// biome-ignore lint/suspicious/noControlCharactersInRegex: 제어 문자 거부가 목적이다.
const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f\\]/;

// 돌아갈 곳이 아닌 경로(로그인 화면 자신, Auth.js·API 경로).
const EXCLUDED_PREFIXES = [DRIVER_LOGIN_PATH, '/api'];

function isExcludedPathname(pathname: string): boolean {
  return EXCLUDED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function decodedPathname(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

/**
 * `callbackUrl` 값이 돌아갈 수 있는 같은 출처 앱 경로이면 경로+쿼리+해시를, 아니면 null을 준다.
 * `/`로 시작해야 하고 `//`·`\`·제어 문자·스킴(절대 주소)은 거절한다.
 */
export function safeDriverReturnPath(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > MAX_RETURN_PATH_LENGTH) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (FORBIDDEN_CHARS.test(value)) return null;

  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return null;
  }
  // 임의의 기준 출처로 해석해도 출처가 바뀌지 않아야 같은 출처의 경로다.
  if (url.origin !== PROBE_ORIGIN) return null;
  // `/./login`·`/%6Cogin`처럼 돌려 쓴 경로도 해석한 경로로 거른다.
  const decoded = decodedPathname(url.pathname);
  if (decoded === null || isExcludedPathname(url.pathname) || isExcludedPathname(decoded)) {
    return null;
  }
  // `/.//evil.com`·`/..//evil.com`·`/board/..//evil.com`은 점 세그먼트를 정리하면 `//evil.com`이 된다.
  // 돌려줄 값이 `//`로 시작하면 받는 쪽에서 다른 출처(프로토콜 상대 주소)로 읽히므로 정리한 뒤에도 거절한다.
  if (url.pathname.startsWith('//') || decoded.startsWith('//')) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** 로그인 뒤(또는 이미 로그인한 기사가 `/login`을 열었을 때) 보낼 곳. 허용하지 않는 값은 `/board`. */
export function resolveDriverReturnPath(raw: unknown): string {
  return safeDriverReturnPath(raw) ?? DRIVER_DEFAULT_RETURN_PATH;
}

/**
 * 로그인 화면 주소를 만든다. 돌아갈 경로가 허용되고 기본값(`/board`)이 아니면 `callbackUrl`로 싣고,
 * 세션이 끝나 보내는 경우에는 `reason=expired`를 붙인다.
 */
export function buildDriverLoginPath(options: {
  returnPath?: string | null;
  sessionEnded?: boolean;
}): string {
  const params = new URLSearchParams();
  if (options.sessionEnded) params.set('reason', DRIVER_SESSION_ENDED_REASON);
  const returnPath = safeDriverReturnPath(options.returnPath);
  if (returnPath && returnPath !== DRIVER_DEFAULT_RETURN_PATH) {
    params.set('callbackUrl', returnPath);
  }
  const query = params.toString();
  return query ? `${DRIVER_LOGIN_PATH}?${query}` : DRIVER_LOGIN_PATH;
}

// Auth.js 세션 쿠키 이름(`authjs.session-token`, https에서는 `__Secure-` 접두, 큰 값은 `.0`·`.1`로 나뉜다).
const AUTH_SESSION_COOKIE = /^(__Secure-)?authjs\.session-token(\.\d+)?$/;

/**
 * 요청에 Auth.js 세션 쿠키가 실려 있었는지. 쿠키가 있는데 세션이 없으면 로그인이 끝난 것(폐기·만료)으로
 * 보고 로그인 화면에 만료 안내를 보인다. 처음 여는 경우(쿠키 없음)에는 안내하지 않는다.
 */
export function hasAuthSessionCookie(cookieNames: Iterable<string>): boolean {
  for (const name of cookieNames) {
    if (AUTH_SESSION_COOKIE.test(name)) return true;
  }
  return false;
}

/**
 * 카카오 로그인에서 API가 거절했을 때(`res.ok`가 아님) 로그인 화면에 보일 안내 종류.
 * - 403 + 관리자 code → 관리자 계정 안내
 * - 403 + 승인 대기 code → 가입 접수·승인 대기 안내
 * - 403(code 없음) → 기사 앱이 받지 않는 역할(손님·판매자 등) 안내
 * - 그 밖(401 정지·카카오 확인 실패, 5xx, 429 등) → 일반 실패 안내
 */
export type KakaoLoginRejection = 'admin-account' | 'approval-pending' | 'other-role' | 'failed';

export function classifyKakaoLoginRejection(params: {
  status: number;
  code: unknown;
  adminAccountCode: string;
  approvalPendingCode: string;
}): KakaoLoginRejection {
  if (params.status !== 403) return 'failed';
  if (params.code === params.adminAccountCode) return 'admin-account';
  if (params.code === params.approvalPendingCode) return 'approval-pending';
  return 'other-role';
}
