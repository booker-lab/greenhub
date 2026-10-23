"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CSP_REPORT_PATH = void 0;
exports.createCspNonce = createCspNonce;
exports.resolveCspApiOrigin = resolveCspApiOrigin;
exports.buildContentSecurityPolicy = buildContentSecurityPolicy;
exports.CSP_REPORT_PATH = '/api/csp-report';
const DEVELOPMENT_API_ORIGIN = 'http://localhost:3000';
/** 요청마다 새로 만드는 128비트 nonce(base64). */
function createCspNonce() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    let binary = '';
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary);
}
/**
 * connect-src에 넣을 API origin. 설정이 비었거나 형식이 틀려도 proxy가 페이지를 막지 않도록
 * 예외를 던지지 않고 null을 돌려준다(API 설정 오류는 resolveApiBaseUrl이 따로 알린다).
 */
function resolveCspApiOrigin(apiUrl, nodeEnv) {
    const value = apiUrl?.trim();
    if (!value)
        return nodeEnv === 'production' ? null : DEVELOPMENT_API_ORIGIN;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' && url.protocol !== 'http:')
            return null;
        return url.origin;
    }
    catch {
        return null;
    }
}
function buildContentSecurityPolicy(app, { nonce, nodeEnv, apiUrl }) {
    const isDevelopment = nodeEnv === 'development';
    const apiOrigin = resolveCspApiOrigin(apiUrl, nodeEnv);
    const frameOrigins = app.frameOrigins?.length ? app.frameOrigins : ["'none'"];
    const directives = [
        ['default-src', ["'self'"]],
        // React 개발 모드는 오류 스택 복원에 eval을 쓴다. 운영 빌드에는 넣지 않는다.
        [
            'script-src',
            [
                "'self'",
                `'nonce-${nonce}'`,
                "'strict-dynamic'",
                ...(isDevelopment ? ["'unsafe-eval'"] : []),
            ],
        ],
        // Mantine 컴포넌트가 인라인 style을 쓴다.
        ['style-src', ["'self'", "'unsafe-inline'"]],
        ['img-src', ["'self'", 'data:', 'blob:', ...app.imageOrigins]],
        ['font-src', ["'self'", 'data:']],
        [
            'connect-src',
            [
                "'self'",
                ...(apiOrigin ? [apiOrigin] : []),
                ...app.connectOrigins,
                ...(isDevelopment ? (app.developmentConnectOrigins ?? []) : []),
            ],
        ],
        ['frame-src', [...frameOrigins]],
        ['worker-src', ["'self'", 'blob:']],
        ['manifest-src', ["'self'"]],
        ['object-src', ["'none'"]],
        ['base-uri', ["'self'"]],
        ['frame-ancestors', ["'self'"]],
        ...(app.formActionSelf ? [['form-action', ["'self'"]]] : []),
        // report-to(Reporting API)를 함께 두면 Chrome은 report-uri를 무시한다. 로컬 확인에서
        // report-to 보고가 전달되지 않아 실제로 도착하는 report-uri만 둔다.
        ['report-uri', [exports.CSP_REPORT_PATH]],
    ];
    return directives
        .map(([name, sources]) => `${name} ${[...new Set(sources)].join(' ')}`)
        .join('; ');
}
