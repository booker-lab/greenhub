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
/**
 * 로그아웃 시각 표시 쿠키(AUTH-SIGNOUT-SESSION-RESURRECTION-FLAKE). 로그아웃(POST /api/auth/signout) 응답에 심는다.
 * 로그아웃 직전에 출발한 세션 조회의 늦은 응답이 세션 쿠키를 되살려도, 그 쿠키의 마지막 검증 시각은 이
 * 시각보다 앞이라 다음 요청에서 60초 재사용 없이 API로 다시 검증되고(서버 세션은 이미 폐기) 바로 끝난다.
 * 값은 로그아웃 시각(epoch ms)뿐이고 비밀이 아니다. 재사용 구간의 두 배 동안만 남는다.
 */
export declare const SIGNED_OUT_MARKER_COOKIE = "gh-signed-out-at";
export declare const SIGNED_OUT_MARKER_MAX_AGE_SECONDS: number;
/** 쿠키 헤더에서 로그아웃 시각을 읽는다. 없거나 읽을 수 없으면 null. */
export declare function readSignedOutAt(cookieHeader: string | null | undefined): number | null;
/** 로그아웃 시각 표시 쿠키의 Set-Cookie 값. */
export declare function signedOutMarkerCookie(signedOutAt: number, secure: boolean): string;
/** 로그아웃 시각 이전(같은 시각 포함)에 검증된 토큰에서 재사용 표시를 지운다. 그 밖의 토큰은 그대로 돌려준다. */
export declare function forgetAuthorityVerifiedBefore(token: SessionToken, signedOutAt: number | null): SessionToken;
type JwtCallbackConfig = {
    callbacks?: {
        jwt?: (params: any) => unknown;
    };
};
/**
 * NextAuth 설정을 요청마다 만드는 함수로 감싼다. 요청에 로그아웃 시각 표시 쿠키가 있으면 각 앱 jwt 콜백에
 * 넘기는 토큰에서 그 시각 이전의 재사용 표시를 지워, 되살아난 쿠키를 API로 다시 검증하게 한다.
 * 요청이 없을 때(서버 컴포넌트 auth())나 표시가 없을 때는 설정을 그대로 쓴다.
 */
export declare function withSignedOutMarker<C extends JwtCallbackConfig>(config: C): (request?: {
    headers: Headers;
}) => C;
/**
 * Auth.js POST 핸들러를 감싸 로그아웃(경로가 /signout으로 끝나는 요청) 응답에 로그아웃 시각 표시 쿠키를 더한다.
 * 실패 응답(4xx·5xx)에는 더하지 않는다. 다른 POST(세션 갱신·로그인 등)는 그대로 돌려준다.
 */
export declare function withSignedOutMarkerOnSignOut<R extends Request>(handler: (request: R) => Promise<Response>, now?: () => number): (request: R) => Promise<Response>;
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
 * 세션이 정말 끝났는지 재사용 없이 다시 검증해 확인한다(AUTH-SIGNOUT-SESSION-RESURRECTION-FLAKE).
 * 세션 조회를 POST(CSRF 토큰 포함, jwt 콜백 trigger 'update')로 보내 60초 검증 재사용을 건너뛴다.
 * update()가 쿠키를 지운 직후 늦게 도착한 다른 세션 응답이 쿠키를 되살리면, GET 조회는 재사용 구간이라
 * 되살아난 쿠키를 그대로 "로그인됨"으로 돌려줘 로그아웃이 최대 60초 늦어졌다. 강제 검증은 되살아난
 * 쿠키의 access token을 API로 다시 판정해 폐기됐으면 쿠키를 지우고 사용자 없음으로 답한다.
 * next-auth는 세션 없음과 네트워크 오류를 모두 null로 돌려주므로 update() 결과만으로는 둘을 가릴 수 없다.
 * 정상(2xx) 응답인데 사용자가 없을 때만 true다. CSRF 조회 실패·네트워크 오류·2xx 아님·읽을 수 없는
 * 본문은 false로 보고 일시 장애로 로그아웃시키지 않는다(검증이 일시 장애면 jwt 콜백이 토큰을 남긴다).
 */
export declare function isSessionEnded(fetchImpl: FetchLike, sessionUrl?: string): Promise<boolean>;
/**
 * API 거절 뒤 세션을 재사용 없이 다시 검증한다(update는 POST, jwt 콜백 trigger 'update').
 * 세션이 돌아오면 그대로 둔다(만료 토큰이 갱신된 경우 등). 돌아오지 않으면 isSessionEnded(재사용 없는
 * 강제 검증)로 확인해 정말 끝났을 때만 signOut으로 현재 탭과 다른 탭을 로그아웃 상태로 바꾼다.
 */
export declare function recheckSessionAfterRejection({ update, fetchImpl, signOut, sessionUrl, }: {
    update: () => Promise<unknown>;
    fetchImpl: FetchLike;
    signOut: () => Promise<unknown> | void;
    sessionUrl?: string;
}): Promise<'kept' | 'ended' | 'unknown'>;
export {};
//# sourceMappingURL=session-authority.d.ts.map