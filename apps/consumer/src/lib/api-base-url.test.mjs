import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./api-base-url.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'api-base-url.ts',
}).outputText;

const moduleRecord = { exports: {} };
new Function('module', 'exports', 'process', compiled)(moduleRecord, moduleRecord.exports, {
  env: {},
});
const { ApiConfigurationError, DEVELOPMENT_API_BASE_URL, resolveApiBaseUrl } = moduleRecord.exports;

test('운영에서 HTTPS API URL은 끝 슬래시를 떼고 허용한다', () => {
  assert.equal(
    resolveApiBaseUrl({ configuredUrl: 'https://api.example.test/', nodeEnv: 'production' }),
    'https://api.example.test',
  );
});

for (const configuredUrl of ['http://api.example.test', 'http://10.0.0.5:3000']) {
  test(`운영에서 루프백이 아닌 http URL(${configuredUrl})은 거부한다`, () => {
    assert.throws(
      () => resolveApiBaseUrl({ configuredUrl, nodeEnv: 'production' }),
      (error) => error instanceof ApiConfigurationError && /HTTPS/.test(error.message),
    );
  });
}

for (const configuredUrl of [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://[::1]:3000',
]) {
  test(`운영에서 루프백 URL(${configuredUrl})은 거부한다`, () => {
    assert.throws(
      () => resolveApiBaseUrl({ configuredUrl, nodeEnv: 'production' }),
      ApiConfigurationError,
    );
  });
}

test('운영에서 URL이 없으면 거부한다', () => {
  assert.throws(
    () => resolveApiBaseUrl({ configuredUrl: '', nodeEnv: 'production' }),
    ApiConfigurationError,
  );
});

for (const configuredUrl of ['http://localhost:3000', 'http://api.example.test']) {
  test(`개발에서는 http URL(${configuredUrl})을 허용한다`, () => {
    assert.equal(resolveApiBaseUrl({ configuredUrl, nodeEnv: 'development' }), configuredUrl);
  });
}

test('개발에서 URL이 없으면 로컬 기본값을 쓴다', () => {
  assert.equal(resolveApiBaseUrl({ nodeEnv: 'development' }), DEVELOPMENT_API_BASE_URL);
});

for (const configuredUrl of [
  'ftp://api.example.test',
  'https://user:pw@api.example.test',
  'https://api.example.test?x=1',
  'not a url',
]) {
  test(`형식이 잘못된 URL(${configuredUrl})은 환경과 무관하게 거부한다`, () => {
    assert.throws(
      () => resolveApiBaseUrl({ configuredUrl, nodeEnv: 'development' }),
      ApiConfigurationError,
    );
  });
}
