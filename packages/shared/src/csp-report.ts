/**
 * CSP 위반 보고 요약. 브라우저가 보낸 보고에서 지시어, 차단된 출처(origin만),
 * 문서 경로(query 제외)만 남겨 한 줄 로그로 만든다. 전체 URL·query·스크립트 샘플은 남기지 않는다.
 *
 * 받는 형식
 * - `application/csp-report`(report-uri): `{ "csp-report": { "effective-directive", "blocked-uri", "document-uri" } }`
 * - `application/reports+json`(report-to): `[{ "type": "csp-violation", "body": { "effectiveDirective", "blockedURL", "documentURL" } }]`
 */

export const CSP_REPORT_MAX_BYTES = 8 * 1024;
export const CSP_REPORT_MAX_ENTRIES = 10;
export const CSP_REPORT_CONTENT_TYPES = [
  'application/csp-report',
  'application/reports+json',
  'application/json',
];

const MAX_PATH_LENGTH = 200;
const KEYWORD_SOURCES = new Set([
  'inline',
  'eval',
  'wasm-eval',
  'self',
  'trusted-types-policy',
  'trusted-types-sink',
]);

export type CspViolationSummary = {
  directive: string;
  blocked: string;
  documentPath: string;
  disposition: string;
};

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeDirective(value: string): string {
  const directive = value.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return /^[a-z-]{1,40}$/.test(directive) ? directive : 'unknown';
}

function sanitizeDisposition(value: string): string {
  return value === 'enforce' || value === 'report' ? value : 'unknown';
}

/** 차단된 리소스는 origin(또는 inline·eval 같은 키워드, data:·blob: 같은 scheme)만 남긴다. */
export function summarizeBlockedSource(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'unknown';
  if (KEYWORD_SOURCES.has(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return url.origin;
    return url.protocol;
  } catch {
    return 'unknown';
  }
}

/** 문서 주소는 경로만 남긴다(query·fragment 제외). */
export function summarizeDocumentPath(value: string): string {
  try {
    return new URL(value).pathname.slice(0, MAX_PATH_LENGTH);
  } catch {
    return 'unknown';
  }
}

function fromLegacyReport(report: Record<string, unknown>): CspViolationSummary {
  return {
    directive: sanitizeDirective(
      readString(report, 'effective-directive') || readString(report, 'violated-directive'),
    ),
    blocked: summarizeBlockedSource(readString(report, 'blocked-uri')),
    documentPath: summarizeDocumentPath(readString(report, 'document-uri')),
    disposition: sanitizeDisposition(readString(report, 'disposition')),
  };
}

function fromReportingApi(body: Record<string, unknown>): CspViolationSummary {
  return {
    directive: sanitizeDirective(
      readString(body, 'effectiveDirective') || readString(body, 'violatedDirective'),
    ),
    blocked: summarizeBlockedSource(readString(body, 'blockedURL')),
    documentPath: summarizeDocumentPath(readString(body, 'documentURL')),
    disposition: sanitizeDisposition(readString(body, 'disposition')),
  };
}

export function summarizeCspReports(payload: unknown): CspViolationSummary[] {
  if (Array.isArray(payload)) {
    return payload
      .filter(
        (entry): entry is { type: string; body: Record<string, unknown> } =>
          isRecord(entry) && entry.type === 'csp-violation' && isRecord(entry.body),
      )
      .slice(0, CSP_REPORT_MAX_ENTRIES)
      .map((entry) => fromReportingApi(entry.body));
  }
  if (isRecord(payload) && isRecord(payload['csp-report'])) {
    return [fromLegacyReport(payload['csp-report'])];
  }
  return [];
}

export function formatCspViolation(summary: CspViolationSummary): string {
  return `[csp-report] directive=${summary.directive} blocked=${summary.blocked} document=${summary.documentPath} disposition=${summary.disposition}`;
}

/** 본문을 최대 maxBytes까지만 읽는다. 넘으면 읽기를 멈추고 null을 돌려준다. */
export async function readBodyWithinLimit(
  request: Request,
  maxBytes: number = CSP_REPORT_MAX_BYTES,
): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function readContentType(request: Request): string {
  return (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

/**
 * 각 앱 `app/api/csp-report/route.ts`의 POST 처리.
 * 브라우저가 보내는 CSP 위반 보고를 받아 요약 한 줄만 남긴다. 응답 본문은 없다.
 */
export async function handleCspReportRequest(request: Request): Promise<Response> {
  if (!CSP_REPORT_CONTENT_TYPES.includes(readContentType(request))) {
    return new Response(null, { status: 415 });
  }
  const text = await readBodyWithinLimit(request);
  if (text === null) return new Response(null, { status: 413 });

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  for (const summary of summarizeCspReports(payload)) {
    console.warn(formatCspViolation(summary));
  }
  return new Response(null, { status: 204 });
}
