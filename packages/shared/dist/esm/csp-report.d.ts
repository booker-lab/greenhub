/**
 * CSP 위반 보고 요약. 브라우저가 보낸 보고에서 지시어, 차단된 출처(origin만),
 * 문서 경로(query 제외)만 남겨 한 줄 로그로 만든다. 전체 URL·query·스크립트 샘플은 남기지 않는다.
 *
 * 받는 형식
 * - `application/csp-report`(report-uri): `{ "csp-report": { "effective-directive", "blocked-uri", "document-uri" } }`
 * - `application/reports+json`(report-to): `[{ "type": "csp-violation", "body": { "effectiveDirective", "blockedURL", "documentURL" } }]`
 */
export declare const CSP_REPORT_MAX_BYTES: number;
export declare const CSP_REPORT_MAX_ENTRIES = 10;
export declare const CSP_REPORT_CONTENT_TYPES: string[];
export type CspViolationSummary = {
    directive: string;
    blocked: string;
    documentPath: string;
    disposition: string;
};
/** 차단된 리소스는 origin(또는 inline·eval 같은 키워드, data:·blob: 같은 scheme)만 남긴다. */
export declare function summarizeBlockedSource(value: string): string;
/** 문서 주소는 경로만 남긴다(query·fragment 제외). */
export declare function summarizeDocumentPath(value: string): string;
export declare function summarizeCspReports(payload: unknown): CspViolationSummary[];
export declare function formatCspViolation(summary: CspViolationSummary): string;
/** 본문을 최대 maxBytes까지만 읽는다. 넘으면 읽기를 멈추고 null을 돌려준다. */
export declare function readBodyWithinLimit(request: Request, maxBytes?: number): Promise<string | null>;
export declare function readContentType(request: Request): string;
/**
 * 각 앱 `app/api/csp-report/route.ts`의 POST 처리.
 * 브라우저가 보내는 CSP 위반 보고를 받아 요약 한 줄만 남긴다. 응답 본문은 없다.
 */
export declare function handleCspReportRequest(request: Request): Promise<Response>;
//# sourceMappingURL=csp-report.d.ts.map