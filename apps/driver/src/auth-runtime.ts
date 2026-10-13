// NextAuth 서버 콜백이 API를 부를 때 쓰는 런타임 규칙.
// - 서버 쪽 fetch는 시간 제한을 둔다. 제한을 넘기면 각 호출자의 기존 일시 실패 경로로 처리한다.
// - 로그아웃하면 API의 refresh token도 폐기한다.
// - 테스트 전용 Credentials provider는 운영 런타임에 등록하지 않는다.
// 이 파일은 외부 모듈을 import하지 않는다(auth-runtime.test.ts에서 next-auth 없이 검증한다).

/** local runtime 진입은 API가 이 기기(loopback)에 있을 때만 허용한다. */
export function isLoopbackApiUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

/** 로그인·세션 확인·갱신 요청의 시간 제한. */
export const AUTH_UPSTREAM_TIMEOUT_MS = 10_000;

/** 로그아웃 처리 전체(폐기 요청·재시도 포함)의 시간 제한. 로그아웃 화면 전환을 오래 막지 않는다. */
export const AUTH_LOGOUT_TIMEOUT_MS = 5_000;

export function authUpstreamSignal(timeoutMs: number = AUTH_UPSTREAM_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

type RuntimeEnv = Record<string, string | undefined>;

/**
 * 테스트 전용 Credentials provider를 등록할지 판정한다.
 * - 운영 표식(`VERCEL_ENV`·`RAILWAY_ENVIRONMENT_NAME`이 production)이 있으면 등록하지 않는다.
 * - Vercel Preview(`VERCEL_ENV=preview`, 로컬 E2E 실행기도 같은 값을 쓴다)에서는 등록한다.
 * - 그 밖에는 개발 서버(`NODE_ENV !== 'production'`)에서만 등록한다.
 * 등록돼도 authorize의 기존 게이트(Preview E2E 게이트 또는 local runtime)를 그대로 통과해야 한다.
 */
export function isTestCredentialsProviderEnabled(env: RuntimeEnv = process.env): boolean {
  if (env.VERCEL_ENV === 'production') return false;
  if (env.RAILWAY_ENVIRONMENT_NAME === 'production') return false;
  if (env.VERCEL_ENV === 'preview') return true;
  return env.NODE_ENV !== 'production';
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type ApiSessionRevocationResult = 'revoked' | 'already-revoked' | 'skipped' | 'failed';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * API 세션(refresh token)을 폐기한다. 로그아웃 자체는 막지 않도록 예외를 던지지 않는다.
 * 1. 현재 access token으로 `POST /auth/logout`을 부른다.
 * 2. access token이 만료 등으로 거절(401/403)되면 refresh token으로 새 access token을 받아 한 번 더 부른다.
 *    refresh가 401/403이면 서버 세션은 이미 끝난 상태다.
 * 전체 과정은 하나의 시간 제한 안에서 끝난다.
 */
export async function revokeApiSession({
  apiBaseUrl,
  accessToken,
  refreshToken,
  fetchImpl = fetch,
  timeoutMs = AUTH_LOGOUT_TIMEOUT_MS,
}: {
  apiBaseUrl: string;
  accessToken: unknown;
  refreshToken: unknown;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<ApiSessionRevocationResult> {
  const signal = AbortSignal.timeout(timeoutMs);
  const logout = (token: string) =>
    fetchImpl(`${apiBaseUrl}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });

  try {
    if (isNonEmptyString(accessToken)) {
      const res = await logout(accessToken);
      if (res.ok) return 'revoked';
      if (res.status !== 401 && res.status !== 403) return 'failed';
    }
    if (!isNonEmptyString(refreshToken)) {
      return isNonEmptyString(accessToken) ? 'failed' : 'skipped';
    }

    const refreshed = await fetchImpl(`${apiBaseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      signal,
    });
    if (refreshed.status === 401 || refreshed.status === 403) return 'already-revoked';
    if (!refreshed.ok) return 'failed';
    const data = (await refreshed.json()) as { accessToken?: unknown } | null;
    if (!isNonEmptyString(data?.accessToken)) return 'failed';

    const retried = await logout(data.accessToken);
    return retried.ok ? 'revoked' : 'failed';
  } catch {
    return 'failed';
  }
}
