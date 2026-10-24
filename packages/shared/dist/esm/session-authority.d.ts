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
/**
 * 세션이 정말 끝났는지 세션 조회(GET `/api/auth/session`)로 확인한다. next-auth는 세션 없음과
 * 네트워크 오류를 모두 null로 돌려주므로 update() 결과만으로는 둘을 가릴 수 없다.
 * 정상(2xx) 응답인데 사용자가 없을 때만 true다. 네트워크 오류·2xx 아님·읽을 수 없는 본문은
 * false로 보고 일시 장애로 로그아웃시키지 않는다.
 */
export declare function isSessionEnded(fetchImpl: FetchLike, sessionUrl?: string): Promise<boolean>;
/**
 * API 거절 뒤 세션을 재사용 없이 다시 검증한다(update는 POST, jwt 콜백 trigger 'update').
 * 세션이 돌아오면 그대로 둔다(만료 토큰이 갱신된 경우 등). 돌아오지 않으면 isSessionEnded로
 * 확인해 정말 끝났을 때만 signOut으로 현재 탭과 다른 탭을 로그아웃 상태로 바꾼다.
 */
export declare function recheckSessionAfterRejection({ update, fetchImpl, signOut, sessionUrl, }: {
    update: () => Promise<unknown>;
    fetchImpl: FetchLike;
    signOut: () => Promise<unknown> | void;
    sessionUrl?: string;
}): Promise<'kept' | 'ended' | 'unknown'>;
export {};
//# sourceMappingURL=session-authority.d.ts.map