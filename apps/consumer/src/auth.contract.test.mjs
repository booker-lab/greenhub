import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// auth.ts가 공유 인증 런타임(packages/shared/src/auth-runtime.ts)을 올바르게 연결했는지 소스로 확인한다.
// 런타임 함수 자체의 동작은 packages/shared/src/auth-runtime.test.ts가 확인한다.
const authSource = await readFile(new URL('./auth.ts', import.meta.url), 'utf8');

test('auth.ts는 Credentials를 게이트 뒤에서만 등록하고 로그아웃 이벤트에서 API 세션을 폐기한다', () => {
  const gate = authSource.indexOf('...(isTestCredentialsProviderEnabled(process.env)');
  const credentials = authSource.indexOf('Credentials({');
  assert.ok(gate > 0, 'Credentials provider must be registered behind the runtime gate');
  assert.ok(credentials > gate, 'Credentials provider must be inside the gate');
  assert.equal((authSource.match(/Credentials\(\{/g) ?? []).length, 1);

  assert.match(authSource, /events:\s*\{\s*\/\/[^\n]*\n\s*async signOut\(message\)/);
  assert.match(authSource, /revokeApiSession\(\{\s*apiBaseUrl: API,/);
  assert.match(authSource, /testSecretsMatch\(got, expected\)/);
  assert.doesNotMatch(authSource, /got !== expected/);
});

test('auth.ts의 서버 쪽 API 호출은 모두 시간 제한 신호를 쓴다', () => {
  const fetchCalls = authSource.match(/await fetch\(`\$\{API\}[^`]*`, \{[\s\S]*?\n\s*\}\);/g) ?? [];
  assert.equal(fetchCalls.length, 4, 'session, refresh, login, kakao-login');
  for (const call of fetchCalls) {
    assert.match(call, /signal: authUpstreamSignal\(\)/);
  }
});
