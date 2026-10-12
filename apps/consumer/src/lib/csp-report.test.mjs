import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTs(path, resolveImport) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: path,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(resolveImport, loaded, loaded.exports);
  return loaded.exports;
}

function noImports(specifier) {
  throw new Error(`unexpected module request in test: ${specifier}`);
}

const report = await loadTs('./csp-report.ts', noImports);
const route = await loadTs('../app/api/csp-report/route.ts', (specifier) => {
  if (specifier === '@/lib/csp-report') return report;
  return noImports(specifier);
});

const { CSP_REPORT_MAX_BYTES, formatCspViolation, readBodyWithinLimit, summarizeCspReports } =
  report;

function reportRequest(body, contentType) {
  return new Request('https://shop.example.test/api/csp-report', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });
}

const legacyReport = {
  'csp-report': {
    'document-uri': 'https://shop.example.test/checkout?phone=01012345678#top',
    'violated-directive': 'script-src-elem',
    'effective-directive': 'script-src-elem',
    'blocked-uri': 'https://evil.example.test/x.js?token=secret',
    disposition: 'report',
    'script-sample': 'alert(document.cookie)',
  },
};

async function captureWarnings(run) {
  const original = console.warn;
  const lines = [];
  console.warn = (line) => lines.push(line);
  try {
    return { result: await run(), lines };
  } finally {
    console.warn = original;
  }
}

test('report-uri 형식에서 지시어, 차단 출처 origin, query 없는 문서 경로만 남긴다', () => {
  assert.deepEqual(summarizeCspReports(legacyReport), [
    {
      directive: 'script-src-elem',
      blocked: 'https://evil.example.test',
      documentPath: '/checkout',
      disposition: 'report',
    },
  ]);
});

test('report-to 형식 배열에서 csp-violation 보고만 읽는다', () => {
  assert.deepEqual(
    summarizeCspReports([
      {
        type: 'csp-violation',
        body: {
          documentURL: 'https://shop.example.test/login?callbackUrl=%2Fcart',
          effectiveDirective: 'frame-src',
          blockedURL: 'https://pay.example.test/window?id=1',
          disposition: 'report',
        },
      },
      { type: 'deprecation', body: { id: 'x' } },
    ]),
    [
      {
        directive: 'frame-src',
        blocked: 'https://pay.example.test',
        documentPath: '/login',
        disposition: 'report',
      },
    ],
  );
  assert.deepEqual(summarizeCspReports({ nothing: true }), []);
});

test('data: 같은 scheme은 scheme만, inline·eval 같은 키워드는 그대로 남긴다', () => {
  const [data] = summarizeCspReports({
    'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': 'data:image/png;base64,AA' },
  });
  assert.equal(data.blocked, 'data:');
  assert.equal(data.documentPath, 'unknown');
  const [inline] = summarizeCspReports({
    'csp-report': { 'effective-directive': 'script-src-elem', 'blocked-uri': 'inline' },
  });
  assert.equal(inline.blocked, 'inline');
});

test('로그 한 줄에는 query·전체 URL·스크립트 샘플이 없다', () => {
  const line = formatCspViolation(summarizeCspReports(legacyReport)[0]);
  assert.equal(
    line,
    '[csp-report] directive=script-src-elem blocked=https://evil.example.test document=/checkout disposition=report',
  );
  assert.doesNotMatch(line, /token|phone|alert|\?/);
});

test('본문은 상한까지만 읽는다', async () => {
  assert.equal(await readBodyWithinLimit(reportRequest('{"a":1}', 'application/json')), '{"a":1}');
  assert.equal(
    await readBodyWithinLimit(
      reportRequest('x'.repeat(CSP_REPORT_MAX_BYTES + 1), 'application/json'),
    ),
    null,
  );
});

test('POST /api/csp-report는 보고를 요약 한 줄로 남기고 204를 돌려준다', async () => {
  const { result, lines } = await captureWarnings(() =>
    route.POST(reportRequest(JSON.stringify(legacyReport), 'application/csp-report')),
  );
  assert.equal(result.status, 204);
  assert.deepEqual(lines, [
    '[csp-report] directive=script-src-elem blocked=https://evil.example.test document=/checkout disposition=report',
  ]);
});

test('POST /api/csp-report는 다른 형식·큰 본문·깨진 본문을 기록하지 않는다', async () => {
  const { lines } = await captureWarnings(async () => {
    assert.equal((await route.POST(reportRequest('{}', 'text/plain'))).status, 415);
    assert.equal(
      (
        await route.POST(
          reportRequest('x'.repeat(CSP_REPORT_MAX_BYTES + 1), 'application/reports+json'),
        )
      ).status,
      413,
    );
    assert.equal((await route.POST(reportRequest('{', 'application/csp-report'))).status, 400);
  });
  assert.deepEqual(lines, []);
});
