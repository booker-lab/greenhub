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
/** 같은 access token의 거절로 강제 재검증을 다시 요청하기까지 쉬는 시간(거절이 이어질 때 요청 폭주 방지). */
export declare const AUTHORITY_RECHECK_COOLDOWN_MS = 10000;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
/**
 * 화면의 API 요청이 401/403으로 거절되면 onRejected를 부른다. 호출부는 세션을 update()로
 * 다시 받아(jwt 콜백 trigger 'update') 재사용 구간이어도 API로 다시 검증하게 한다.
 * - apiOrigin으로 가는 Bearer 요청만 본다. 응답은 손대지 않고 그대로 돌려준다.
 * - 정지·기사 승인 철회는 403, 세션 폐기·탈퇴는 401이라 둘 다 본다.
 * - 같은 access token은 cooldownMs 안에 한 번만 알린다(거절이 이어지는 화면의 요청 폭주 방지).
 * 돌려준 함수를 부르면 원래 fetch로 되돌린다.
 */
export declare function watchApiAuthorityRejections({ target, apiOrigin, onRejected, now, cooldownMs, }: {
    target: {
        fetch: FetchLike;
    };
    apiOrigin: string;
    onRejected: () => void;
    now?: () => number;
    cooldownMs?: number;
}): () => void;
export {};
//# sourceMappingURL=session-authority.d.ts.map