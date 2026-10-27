import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// auth.ts가 공유 인증 런타임(packages/shared/src/auth-runtime.ts)을 올바르게 연결했는지 소스로 확인한다.
// 런타임 함수 자체의 동작은 packages/shared/src/auth-runtime.test.ts가 확인한다.
const authSource = await readFile(new URL('./auth.ts', import.meta.url), 'utf8');

test('auth.ts는 Credentials를 하나만 등록하고, E2E 헤더 게이트는 테스트 게이트 런타임 분기 안에서만 거친다', () => {
  // 2026-10-27 결정: 운영에서도 provider를 등록한다(운영 API가 심사 허용 계정만 받는다).
  assert.equal((authSource.match(/Credentials\(\{/g) ?? []).length, 1);
  assert.ok(
    !authSource.includes('...(isTestCredentialsProviderEnabled(process.env)'),
    'Credentials provider must be registered in every runtime (no spread gate)',
  );

  const credentials = authSource.indexOf('Credentials({');
  const branch = authSource.indexOf('if (isTestCredentialsProviderEnabled(process.env)) {');
  // 분기 블록은 authorize 본문(8칸 들여쓰기) 안에서 닫힌다.
  const branchEnd = authSource.indexOf('\n        }\n', branch);
  const admission = authSource.indexOf('if (!isAdmittedLoginCredentials(credentials))');
  const upstream = authSource.indexOf('`${API}/auth/login`');
  assert.ok(
    credentials > 0 && branch > credentials,
    'test-runtime branch must be inside authorize',
  );
  assert.ok(branchEnd > branch, 'test-runtime branch must close');
  assert.ok(
    admission > branchEnd && upstream > admission,
    'admission then upstream, after the branch',
  );

  // g1·g2는 분기 안에서만 던진다(운영 경로는 E2E secret·헤더와 무관).
  for (const code of [
    'authorize-rejected__g1-secret-missing',
    'authorize-rejected__g2-secret-mismatch',
  ]) {
    const occurrences = [...authSource.matchAll(new RegExp(`'${code}'`, 'g'))].map((m) => m.index);
    const throwSites = occurrences.filter((index) => index > credentials);
    assert.equal(throwSites.length, 1, `${code} must be thrown from exactly one site`);
    assert.ok(
      throwSites[0] > branch && throwSites[0] < branchEnd,
      `${code} must be inside the branch`,
    );
  }

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
