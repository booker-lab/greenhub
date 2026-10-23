/** 같은 access token의 세션 검증 성공을 재사용하는 시간. */
export declare const SESSION_AUTHORITY_REUSE_MS = 60000;
export type SessionAuthorityResult = {
    kind: 'ok';
    claims?: Record<string, unknown>;
} | {
    kind: 'revoked';
} | {
    kind: 'transient';
};
type SessionToken = Record<string, unknown>;
/**
 * 로그인 직후가 아닌 jwt 콜백 호출에서 세션을 다시 검증한다.
 * verify는 API `GET /auth/session` 판정, refresh는 각 앱의 `POST /auth/refresh` 처리다.
 * verify의 ok.claims(판매자 storeId 등)는 토큰에 덮어쓴다. 재사용 구간에서는 마지막 검증 값을 그대로 쓴다.
 * reuseVerified가 false면(update() 요청) 재사용 구간이어도 다시 검증한다.
 */
export declare function revalidateSessionToken(token: SessionToken, { verify, refresh, now, reuseVerified, }: {
    verify: (accessToken: string) => Promise<SessionAuthorityResult>;
    refresh: (token: SessionToken) => Promise<SessionToken | null>;
    now?: () => number;
    reuseVerified?: boolean;
}): Promise<SessionToken | null>;
export {};
//# sourceMappingURL=session-authority.d.ts.map