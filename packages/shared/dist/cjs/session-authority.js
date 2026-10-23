"use strict";
// NextAuth jwt 콜백의 세션 재검증 흐름(소비자·판매자·기사 앱 공통).
// - 세션 권위는 API `GET /auth/session`이다(JwtStrategy 재검증). 쿠키에 든 값은 권위가 아니다.
// - 같은 access token의 검증 성공은 SESSION_AUTHORITY_REUSE_MS 동안 재사용해 화면 이동마다
//   API 왕복을 하지 않는다. 데이터 요청은 API JwtStrategy가 매번 사용자 문서·역할·
//   sessionsRevokedAt·activeSessionIds를 검사하므로, 강제 로그아웃된 사용자는 최대 이 시간 동안
//   화면 틀만 볼 수 있다.
// - access token이 바뀌면(갱신·재로그인) 재사용하지 않고 바로 다시 검증한다.
// - 화면이 update()로 세션을 다시 받을 때(판매자 가게 등록 직후 등)도 재사용하지 않는다.
// - revoked(401/403·허용되지 않은 역할)는 refresh를 한 번 시도해 만료와 폐기를 가린다
//   (refresh가 401/403이면 각 앱의 refresh가 null을 돌려 세션을 끝낸다).
// - transient(네트워크·시간 초과·5xx·429)는 토큰을 그대로 두고 다음 호출에서 다시 검증한다.
// 외부 모듈을 import하지 않는다(next-auth 없이 검증한다).
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSION_AUTHORITY_REUSE_MS = void 0;
exports.revalidateSessionToken = revalidateSessionToken;
/** 같은 access token의 세션 검증 성공을 재사용하는 시간. */
exports.SESSION_AUTHORITY_REUSE_MS = 60_000;
function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}
/** 토큰에 access token 원문을 한 번 더 싣지 않도록 짧은 지문만 남긴다. */
async function accessTokenFingerprint(accessToken) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken));
    return Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function isAuthorityReusable(token, fingerprint, now) {
    const verifiedAt = token.authorityVerifiedAt;
    if (typeof verifiedAt !== 'number' || !Number.isFinite(verifiedAt))
        return false;
    if (token.authorityVerifiedFor !== fingerprint)
        return false;
    // 시계가 뒤로 간 경우(verifiedAt이 미래)는 재사용하지 않는다.
    return verifiedAt <= now && now - verifiedAt < exports.SESSION_AUTHORITY_REUSE_MS;
}
/**
 * 로그인 직후가 아닌 jwt 콜백 호출에서 세션을 다시 검증한다.
 * verify는 API `GET /auth/session` 판정, refresh는 각 앱의 `POST /auth/refresh` 처리다.
 * verify의 ok.claims(판매자 storeId 등)는 토큰에 덮어쓴다. 재사용 구간에서는 마지막 검증 값을 그대로 쓴다.
 * reuseVerified가 false면(update() 요청) 재사용 구간이어도 다시 검증한다.
 */
async function revalidateSessionToken(token, { verify, refresh, now = Date.now, reuseVerified = true, }) {
    const accessToken = token.accessToken;
    if (!isNonEmptyString(accessToken) || !isNonEmptyString(token.refreshToken)) {
        return token;
    }
    const fingerprint = await accessTokenFingerprint(accessToken);
    const reusable = reuseVerified && isAuthorityReusable(token, fingerprint, now());
    const authority = reusable ? { kind: 'ok' } : await verify(accessToken);
    const checkedAt = now();
    const accessTokenValid = checkedAt < token.accessTokenExpires;
    if (authority.kind === 'revoked') {
        const { authorityVerifiedAt: _at, authorityVerifiedFor: _for, ...unverified } = token;
        void _at;
        void _for;
        return refresh(unverified);
    }
    if (authority.kind === 'ok') {
        const bound = reusable
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
    if (accessTokenValid)
        return token;
    return refresh(token);
}
