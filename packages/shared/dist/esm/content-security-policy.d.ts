/**
 * 프런트 앱(소비자·판매자·기사) Content-Security-Policy(Report-Only) 정책의 공통 틀.
 *
 * 각 앱 proxy가 요청마다 nonce를 만들어 이 정책을 `Content-Security-Policy-Report-Only`로 보낸다.
 * 위반은 차단하지 않고 `/api/csp-report`로만 보고된다. 실제 보고를 확인한 뒤 강제로 바꾼다.
 * 각 앱 next.config.ts의 강제 CSP는 그대로 둔다.
 *
 * 앱마다 실제로 불러오는 출처 목록과 frame-src·form-action 차이는
 * 각 앱 `lib/content-security-policy.ts`가 AppContentSecurityPolicy로 정한다.
 * API origin은 NEXT_PUBLIC_API_URL(각 앱 lib/api-base-url.ts와 같은 값)에서 만든다.
 */
export declare const CSP_REPORT_PATH = "/api/csp-report";
/** 앱마다 다른 출처 목록과 지시어. */
export type AppContentSecurityPolicy = {
    /** img-src에 더할 출처. */
    imageOrigins: readonly string[];
    /** connect-src에 더할 출처. API origin은 따로 넣는다. */
    connectOrigins: readonly string[];
    /** 개발 모드(NODE_ENV=development)에서만 connect-src에 더할 출처(로컬 에뮬레이터 등). */
    developmentConnectOrigins?: readonly string[];
    /** frame-src 출처. 비어 있으면 `'none'`. */
    frameOrigins?: readonly string[];
    /** true면 `form-action 'self'`를 둔다. 폼 제출 뒤 외부로 이동하는 앱은 false로 둔다. */
    formActionSelf: boolean;
};
export type ContentSecurityPolicyInput = {
    nonce: string;
    nodeEnv?: string;
    apiUrl?: string;
};
/** 요청마다 새로 만드는 128비트 nonce(base64). */
export declare function createCspNonce(): string;
/**
 * connect-src에 넣을 API origin. 설정이 비었거나 형식이 틀려도 proxy가 페이지를 막지 않도록
 * 예외를 던지지 않고 null을 돌려준다(API 설정 오류는 resolveApiBaseUrl이 따로 알린다).
 */
export declare function resolveCspApiOrigin(apiUrl: string | undefined, nodeEnv: string | undefined): string | null;
export declare function buildContentSecurityPolicy(app: AppContentSecurityPolicy, { nonce, nodeEnv, apiUrl }: ContentSecurityPolicyInput): string;
//# sourceMappingURL=content-security-policy.d.ts.map