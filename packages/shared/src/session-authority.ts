// NextAuth jwt 콜백의 세션 재검증 흐름(소비자·판매자·기사 앱 공통).
// - 세션 권위는 API `GET /auth/session`이다(JwtStrategy 재검증). 쿠키에 든 값은 권위가 아니다.
// - 같은 access token의 검증 성공은 SESSION_AUTHORITY_REUSE_MS 동안 재사용해 화면 이동마다
//   API 왕복을 하지 않는다. 데이터 요청은 API JwtStrategy가 매번 사용자 문서·역할·
//   sessionsRevokedAt·activeSessionIds를 검사하므로, 강제 로그아웃된 사용자는 최대 이 시간 동안
//   화면 틀만 볼 수 있다.
// - 화면의 API 요청이 거절(401/403)되면 watchApiAuthorityRejections가 세션을 update()로 다시
//   받게 해 재사용 없이 바로 검증한다. 폐기된 세션은 그 자리에서 끝난다.
// - access token이 바뀌면(갱신·재로그인) 재사용하지 않고 바로 다시 검증한다.
// - 화면이 update()로 세션을 다시 받을 때(판매자 가게 등록 직후 등)도 재사용하지 않는다.
// - revoked(401/403·허용되지 않은 역할)는 refresh를 한 번 시도해 만료와 폐기를 가린다
//   (refresh가 401/403이면 각 앱의 refresh가 null을 돌려 세션을 끝낸다).
// - transient(네트워크·시간 초과·5xx·429)는 토큰을 그대로 두고 다음 호출에서 다시 검증한다.
// 외부 모듈을 import하지 않는다(next-auth 없이 검증한다).

/** 같은 access token의 세션 검증 성공을 재사용하는 시간. */
export const SESSION_AUTHORITY_REUSE_MS = 60_000;

export type SessionAuthorityResult =
  | { kind: 'ok'; claims?: Record<string, unknown> }
  | { kind: 'revoked' }
  | { kind: 'transient' };

type SessionToken = Record<string, unknown>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** 토큰에 access token 원문을 한 번 더 싣지 않도록 짧은 지문만 남긴다. */
async function accessTokenFingerprint(accessToken: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken));
  return Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function isAuthorityReusable(token: SessionToken, fingerprint: string, now: number): boolean {
  const verifiedAt = token.authorityVerifiedAt;
  if (typeof verifiedAt !== 'number' || !Number.isFinite(verifiedAt)) return false;
  if (token.authorityVerifiedFor !== fingerprint) return false;
  // 시계가 뒤로 간 경우(verifiedAt이 미래)는 재사용하지 않는다.
  return verifiedAt <= now && now - verifiedAt < SESSION_AUTHORITY_REUSE_MS;
}

/**
 * 로그인 직후가 아닌 jwt 콜백 호출에서 세션을 다시 검증한다.
 * verify는 API `GET /auth/session` 판정, refresh는 각 앱의 `POST /auth/refresh` 처리다.
 * verify의 ok.claims(판매자 storeId 등)는 토큰에 덮어쓴다. 재사용 구간에서는 마지막 검증 값을 그대로 쓴다.
 * reuseVerified가 false면(update() 요청) 재사용 구간이어도 다시 검증한다.
 */
export async function revalidateSessionToken(
  token: SessionToken,
  {
    verify,
    refresh,
    now = Date.now,
    reuseVerified = true,
  }: {
    verify: (accessToken: string) => Promise<SessionAuthorityResult>;
    refresh: (token: SessionToken) => Promise<SessionToken | null>;
    now?: () => number;
    reuseVerified?: boolean;
  },
): Promise<SessionToken | null> {
  const accessToken = token.accessToken;
  if (!isNonEmptyString(accessToken) || !isNonEmptyString(token.refreshToken)) {
    return token;
  }

  const fingerprint = await accessTokenFingerprint(accessToken);
  const reusable = reuseVerified && isAuthorityReusable(token, fingerprint, now());
  const authority: SessionAuthorityResult = reusable ? { kind: 'ok' } : await verify(accessToken);
  const checkedAt = now();
  const accessTokenValid = checkedAt < (token.accessTokenExpires as number);

  if (authority.kind === 'revoked') {
    const { authorityVerifiedAt: _at, authorityVerifiedFor: _for, ...unverified } = token;
    void _at;
    void _for;
    return refresh(unverified);
  }
  if (authority.kind === 'ok') {
    const bound: SessionToken = reusable
      ? { ...token }
      : {
          ...token,
          ...authority.claims,
          authorityVerifiedAt: checkedAt,
          authorityVerifiedFor: fingerprint,
        };
    if (accessTokenValid) {
      delete bound.error;
      return bound;
    }
    return refresh(bound);
  }
  if (accessTokenValid) return token;
  return refresh(token);
}

/** 같은 access token의 거절로 강제 재검증을 다시 요청하기까지 쉬는 시간(거절이 이어질 때 요청 폭주 방지). */
export const AUTHORITY_RECHECK_COOLDOWN_MS = 10_000;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (input instanceof URL) return input;
    if (typeof input === 'string') return new URL(input);
    return new URL(input.url);
  } catch {
    return null;
  }
}

function bearerToken(input: RequestInfo | URL, init?: RequestInit): string | null {
  const fromRequest =
    typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined;
  const headers = new Headers(init?.headers ?? fromRequest);
  return /^Bearer (.+)$/.exec(headers.get('Authorization') ?? '')?.[1] ?? null;
}

/**
 * 화면의 API 요청이 401/403으로 거절되면 onRejected를 부른다. 호출부는 세션을 update()로
 * 다시 받아(jwt 콜백 trigger 'update') 재사용 구간이어도 API로 다시 검증하게 한다.
 * - apiOrigin으로 가는 Bearer 요청만 본다. 응답은 손대지 않고 그대로 돌려준다.
 * - 정지·기사 승인 철회는 403, 세션 폐기·탈퇴는 401이라 둘 다 본다.
 * - 같은 access token은 cooldownMs 안에 한 번만 알린다(거절이 이어지는 화면의 요청 폭주 방지).
 * 돌려준 함수를 부르면 원래 fetch로 되돌린다.
 */
export function watchApiAuthorityRejections({
  target,
  apiOrigin,
  onRejected,
  now = Date.now,
  cooldownMs = AUTHORITY_RECHECK_COOLDOWN_MS,
}: {
  target: { fetch: FetchLike };
  apiOrigin: string;
  onRejected: () => void;
  now?: () => number;
  cooldownMs?: number;
}): () => void {
  const original = target.fetch;
  let last: { token: string; at: number } | null = null;
  const watched: FetchLike = async (input, init) => {
    const response = await original.call(target, input, init);
    if (response.status === 401 || response.status === 403) {
      const token = bearerToken(input, init);
      if (token && requestUrl(input)?.origin === apiOrigin) {
        const at = now();
        if (!last || last.token !== token || at - last.at >= cooldownMs) {
          last = { token, at };
          onRejected();
        }
      }
    }
    return response;
  };
  target.fetch = watched;
  return () => {
    if (target.fetch === watched) target.fetch = original;
  };
}
