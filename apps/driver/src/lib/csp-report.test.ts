import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CSP_REPORT_MAX_BYTES,
  formatCspViolation,
  readBodyWithinLimit,
  summarizeCspReports,
} from './csp-report';

// route.ts는 '@/lib/csp-report'를 쓰지만 vitest에는 '@/' 별칭 설정이 없어 같은 모듈로 잇는다.
vi.mock('@/lib/csp-report', () => import('./csp-report'));

const { POST } = await import('../app/api/csp-report/route');

function reportRequest(body: string, contentType: string, headers: Record<string, string> = {}) {
  return new Request('https://driver.example.test/api/csp-report', {
    method: 'POST',
    headers: { 'content-type': contentType, ...headers },
    body,
  });
}

const legacyReport = {
  'csp-report': {
    'document-uri': 'https://driver.example.test/orders/abc?phone=01012345678#top',
    'violated-directive': 'script-src-elem',
    'effective-directive': 'script-src-elem',
    'blocked-uri': 'https://evil.example.test/x.js?token=secret',
    disposition: 'report',
    'script-sample': 'alert(document.cookie)',
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CSP 위반 보고 요약', () => {
  it('report-uri 형식에서 지시어, 차단 출처 origin, query 없는 문서 경로만 남긴다', () => {
    expect(summarizeCspReports(legacyReport)).toEqual([
      {
        directive: 'script-src-elem',
        blocked: 'https://evil.example.test',
        documentPath: '/orders/abc',
        disposition: 'report',
      },
    ]);
  });

  it('report-to 형식 배열에서 csp-violation 보고만 읽는다', () => {
    const summaries = summarizeCspReports([
      {
        type: 'csp-violation',
        body: {
          documentURL: 'https://driver.example.test/login?callbackUrl=%2Forders',
          effectiveDirective: 'connect-src',
          blockedURL: 'wss://socket.example.test/path',
          disposition: 'report',
        },
      },
      { type: 'deprecation', body: { id: 'x' } },
      {
        type: 'csp-violation',
        body: {
          documentURL: 'https://driver.example.test/',
          effectiveDirective: 'script-src',
          blockedURL: 'inline',
        },
      },
    ]);
    expect(summaries).toEqual([
      {
        directive: 'connect-src',
        blocked: 'wss://socket.example.test',
        documentPath: '/login',
        disposition: 'report',
      },
      { directive: 'script-src', blocked: 'inline', documentPath: '/', disposition: 'unknown' },
    ]);
  });

  it('data:·blob: 같은 scheme은 scheme만, 알 수 없는 값은 unknown으로 남긴다', () => {
    const [summary] = summarizeCspReports({
      'csp-report': {
        'document-uri': 'not a url',
        'effective-directive': 'img-src <script>',
        'blocked-uri': 'data:image/png;base64,AAAA',
      },
    });
    expect(summary).toEqual({
      directive: 'img-src',
      blocked: 'data:',
      documentPath: 'unknown',
      disposition: 'unknown',
    });
    expect(summarizeCspReports({ nothing: true })).toEqual([]);
    expect(summarizeCspReports('text')).toEqual([]);
  });

  it('로그 한 줄에는 query·전체 URL·스크립트 샘플이 없다', () => {
    const line = formatCspViolation(summarizeCspReports(legacyReport)[0]);
    expect(line).toBe(
      '[csp-report] directive=script-src-elem blocked=https://evil.example.test document=/orders/abc disposition=report',
    );
    expect(line).not.toMatch(/token|phone|alert|\?/);
  });

  it('본문은 상한까지만 읽는다', async () => {
    const small = reportRequest('{"a":1}', 'application/json');
    expect(await readBodyWithinLimit(small)).toBe('{"a":1}');
    const large = reportRequest('x'.repeat(CSP_REPORT_MAX_BYTES + 1), 'application/json');
    expect(await readBodyWithinLimit(large)).toBeNull();
  });
});

describe('POST /api/csp-report', () => {
  it('report-uri 보고를 요약해 경고 로그 한 줄로 남기고 204를 돌려준다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await POST(
      reportRequest(JSON.stringify(legacyReport), 'application/csp-report'),
    );
    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe(
      '[csp-report] directive=script-src-elem blocked=https://evil.example.test document=/orders/abc disposition=report',
    );
  });

  it('report-to 보고(application/reports+json)도 받는다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = JSON.stringify([
      {
        type: 'csp-violation',
        body: {
          documentURL: 'https://driver.example.test/',
          effectiveDirective: 'img-src',
          blockedURL: 'https://img.example.test/a.png',
        },
      },
    ]);
    const response = await POST(reportRequest(body, 'application/reports+json'));
    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('형식이 다르거나 크거나 깨진 본문은 기록하지 않는다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await POST(reportRequest('{}', 'text/plain'))).status).toBe(415);
    expect(
      (await POST(reportRequest('x'.repeat(CSP_REPORT_MAX_BYTES + 1), 'application/csp-report')))
        .status,
    ).toBe(413);
    expect((await POST(reportRequest('{', 'application/csp-report'))).status).toBe(400);
    expect(warn).not.toHaveBeenCalled();
  });
});
