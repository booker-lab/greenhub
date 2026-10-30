import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTs(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: path,
  }).outputText;
  const loaded = { exports: {} };
  new Function('module', 'exports', compiled)(loaded, loaded.exports);
  return loaded.exports;
}

const { decodeInitialSession, encodeInitialSession } = await loadTs('./initial-session.ts');

const session = {
  user: {
    id: 'user-1',
    name: '김소비',
    email: 'consumer@example.test',
    role: 'consumer',
    accessToken: 'access-1',
  },
  expires: '2099-01-01T00:00:00.000Z',
};

test('한글 이름이 있어도 헤더에 실을 수 있는 값으로 바꾸고 그대로 되돌린다', () => {
  const encoded = encodeInitialSession(session);
  // 헤더 값은 ASCII만 허용한다.
  assert.match(encoded, /^[\x20-\x7e]*$/);
  assert.doesNotThrow(() => new Headers({ 'x-test': encoded }));
  assert.deepEqual(decodeInitialSession(encoded), session);
});

test('관리자 세션도 그대로 되돌린다', () => {
  const admin = { ...session, user: { ...session.user, role: 'admin' } };
  assert.deepEqual(decodeInitialSession(encodeInitialSession(admin)), admin);
});

test('토큰 오류 표시도 그대로 넘겨 TokenErrorGuard가 예전처럼 로그아웃시킨다', () => {
  const errored = { ...session, user: { ...session.user, accessToken: '', tokenError: true } };
  assert.deepEqual(decodeInitialSession(encodeInitialSession(errored)), errored);
});

test('값이 없거나 읽을 수 없거나 소비자 앱 세션이 아니면 undefined로 돌려 화면이 직접 조회하게 한다', () => {
  for (const value of [
    null,
    undefined,
    '',
    '%E0%A4%A',
    'not-json',
    encodeURIComponent('null'),
    encodeURIComponent('"text"'),
    encodeURIComponent(JSON.stringify({ expires: 'x' })),
    encodeURIComponent(JSON.stringify({ user: 'consumer' })),
    encodeURIComponent(JSON.stringify({ user: { role: 'driver' } })),
    encodeURIComponent(JSON.stringify({ user: { role: 'seller' } })),
    encodeURIComponent(JSON.stringify({ user: {} })),
  ]) {
    assert.equal(decodeInitialSession(value), undefined, String(value));
  }
});
