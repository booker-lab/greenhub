import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./public-store-profile.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'public-store-profile.ts',
}).outputText;
const profileModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  (specifier) => {
    if (specifier === '@greenhub/shared') return { normalizeSalesMode: () => 'legacy' };
    if (specifier === '@/lib/api-base-url') return { getApiBaseUrl: () => 'https://api.test' };
    if (specifier === '@/lib/shared-request') return { sharedRequest: (_key, load) => load() };
    throw new Error(`예상하지 못한 가게 프로필 모듈 요청: ${specifier}`);
  },
  profileModule,
  profileModule.exports,
);
const { PublicStoreProfileNotFoundError, classifyStoreProfileFailure, storeProfileFailureMessage } =
  profileModule.exports;

test('가게 프로필 404(치운 가게·없는 가게)는 다시 시도할 오류와 나눠 안내한다', () => {
  const failure = classifyStoreProfileFailure(new PublicStoreProfileNotFoundError('s-1'));
  assert.equal(failure, 'unavailable');
  assert.equal(storeProfileFailureMessage(failure), '지금은 둘러볼 수 없는 가게예요.');
});

test('네트워크·서버 오류는 잠시 후 다시 시도하라고 안내한다', () => {
  const failure = classifyStoreProfileFailure(new Error('스토어 조회 오류: 500'));
  assert.equal(failure, 'error');
  assert.match(storeProfileFailureMessage(failure), /다시 시도/);
});
