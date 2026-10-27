import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./_email-login-visibility.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: '_email-login-visibility.ts',
}).outputText;

const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  (specifier) => {
    throw new Error(`unexpected module request in test: ${specifier}`);
  },
  mod,
  mod.exports,
);
const { EMAIL_LOGIN_METHOD_QUERY, EMAIL_LOGIN_METHOD_VALUE, shouldShowEmailLoginForm } =
  mod.exports;

test('E2E 런타임에서는 쿼리와 무관하게 이메일 폼을 보인다', () => {
  assert.equal(shouldShowEmailLoginForm({ E2E_TEST: 'true' }, {}), true);
  assert.equal(shouldShowEmailLoginForm({ E2E_TEST: 'true' }, { method: 'kakao' }), true);
});

test('운영을 포함한 그 밖의 런타임에서는 ?method=email일 때만 이메일 폼을 보인다', () => {
  assert.equal(EMAIL_LOGIN_METHOD_QUERY, 'method');
  assert.equal(EMAIL_LOGIN_METHOD_VALUE, 'email');
  for (const env of [{}, { E2E_TEST: 'false' }, { E2E_TEST: undefined }]) {
    assert.equal(shouldShowEmailLoginForm(env, {}), false);
    assert.equal(shouldShowEmailLoginForm(env, { method: 'email' }), true);
    assert.equal(shouldShowEmailLoginForm(env, { method: 'Email' }), false);
    assert.equal(shouldShowEmailLoginForm(env, { method: ['email'] }), false);
    assert.equal(shouldShowEmailLoginForm(env, { method: 'kakao' }), false);
    assert.equal(shouldShowEmailLoginForm(env, { other: 'email' }), false);
  }
});

test('page.tsx는 노출 판정을 이 모듈에 맡기고 E2E_TEST를 직접 읽지 않는다', async () => {
  const page = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');
  assert.match(page, /shouldShowEmailLoginForm\(process\.env, await searchParams\)/);
  assert.ok(!page.includes("E2E_TEST === 'true'"), 'page.tsx must not duplicate the E2E condition');
});
