import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);

const source = await readFile(new URL('./content-security-policy.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'content-security-policy.ts',
}).outputText;
const policyModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  (specifier) => {
    if (specifier === '@greenhub/shared') return require('@greenhub/shared');
    throw new Error(`unexpected module request in test: ${specifier}`);
  },
  policyModule,
  policyModule.exports,
);

const { buildContentSecurityPolicy } = policyModule.exports;

function directives(policy) {
  return new Map(
    policy.split(';').map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

const production = directives(
  buildContentSecurityPolicy({
    nonce: 'abc123==',
    nodeEnv: 'production',
    apiUrl: 'https://api.example.test/v1',
  }),
);

test('스크립트는 요청 nonce와 strict-dynamic으로만 허용하고 운영에서는 eval을 넣지 않는다', () => {
  assert.deepEqual(production.get('script-src'), [
    "'self'",
    "'nonce-abc123=='",
    "'strict-dynamic'",
  ]);
  assert.deepEqual(production.get('default-src'), ["'self'"]);
});

test('개발 모드에서만 unsafe-eval을 넣는다', () => {
  const development = directives(
    buildContentSecurityPolicy({ nonce: 'n', nodeEnv: 'development' }),
  );
  assert.ok(development.get('script-src').includes("'unsafe-eval'"));
  assert.ok(development.get('connect-src').includes('http://localhost:3000'));
});

test('연결은 자기 출처, API origin, Firestore, PortOne만 허용한다', () => {
  assert.deepEqual(production.get('connect-src'), [
    "'self'",
    'https://api.example.test',
    'https://firestore.googleapis.com',
    'https://*.portone.io',
  ]);
});

test('프레임은 PortOne 결제창과 우편번호 서비스만 허용한다', () => {
  assert.deepEqual(production.get('frame-src'), [
    'https://*.portone.io',
    'https://postcode.map.daum.net',
  ]);
});

test('이미지·스타일·글꼴·워커·매니페스트와 기존 강제 지시어를 둔다', () => {
  assert.deepEqual(production.get('img-src'), [
    "'self'",
    'data:',
    'blob:',
    'https://firebasestorage.googleapis.com',
    'https://storage.googleapis.com',
  ]);
  assert.deepEqual(production.get('style-src'), ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(production.get('font-src'), ["'self'", 'data:']);
  assert.deepEqual(production.get('worker-src'), ["'self'", 'blob:']);
  assert.deepEqual(production.get('manifest-src'), ["'self'"]);
  assert.deepEqual(production.get('object-src'), ["'none'"]);
  assert.deepEqual(production.get('base-uri'), ["'self'"]);
  assert.deepEqual(production.get('frame-ancestors'), ["'self'"]);
  // 모바일 결제는 결제사로 폼을 제출하므로 form-action은 두지 않는다.
  assert.equal(production.has('form-action'), false);
});

test('위반 보고를 /api/csp-report로 보낸다', () => {
  assert.deepEqual(production.get('report-uri'), ['/api/csp-report']);
  assert.equal(production.has('report-to'), false);
});
