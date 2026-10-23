/** local runtime 진입은 API가 이 기기(loopback)에 있을 때만 허용한다. */
export declare function isLoopbackApiUrl(value: string): boolean;
/** 로그인·세션 확인·갱신 요청의 시간 제한. */
export declare const AUTH_UPSTREAM_TIMEOUT_MS = 10000;
/** 로그아웃 처리 전체(폐기 요청·재시도 포함)의 시간 제한. 로그아웃 화면 전환을 오래 막지 않는다. */
export declare const AUTH_LOGOUT_TIMEOUT_MS = 5000;
export declare function authUpstreamSignal(timeoutMs?: number): AbortSignal;
type RuntimeEnv = Record<string, string | undefined>;
/**
 * 테스트 전용 Credentials provider를 등록할지 판정한다.
 * - 운영 표식(`VERCEL_ENV`·`RAILWAY_ENVIRONMENT_NAME`이 production)이 있으면 등록하지 않는다.
 * - Vercel Preview(`VERCEL_ENV=preview`, 로컬 E2E 실행기도 같은 값을 쓴다)에서는 등록한다.
 * - 그 밖에는 개발 서버(`NODE_ENV !== 'production'`)에서만 등록한다.
 * 등록돼도 authorize의 기존 게이트(E2E secret 헤더·Preview E2E 게이트 또는 local runtime)를
 * 그대로 통과해야 한다. 호출하는 앱이 서버 런타임의 `process.env`를 넘긴다.
 */
export declare function isTestCredentialsProviderEnabled(env: RuntimeEnv): boolean;
/** E2E secret 헤더를 길이·내용과 무관한 시간으로 비교한다(두 값의 SHA-256 digest 비교). */
export declare function testSecretsMatch(received: string | null | undefined, expected: string | null | undefined): Promise<boolean>;
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
export type ApiSessionRevocationResult = 'revoked' | 'already-revoked' | 'skipped' | 'failed';
/**
 * API 세션(refresh token)을 폐기한다. 로그아웃 자체는 막지 않도록 예외를 던지지 않는다.
 * 1. 현재 access token으로 `POST /auth/logout`을 부른다.
 * 2. access token이 만료 등으로 거절(401/403)되면 refresh token으로 새 access token을 받아 한 번 더 부른다.
 *    refresh가 401/403이면 서버 세션은 이미 끝난 상태다.
 * 전체 과정은 하나의 시간 제한 안에서 끝난다.
 */
export declare function revokeApiSession({ apiBaseUrl, accessToken, refreshToken, fetchImpl, timeoutMs, }: {
    apiBaseUrl: string;
    accessToken: unknown;
    refreshToken: unknown;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
}): Promise<ApiSessionRevocationResult>;
export {};
//# sourceMappingURL=auth-runtime.d.ts.map