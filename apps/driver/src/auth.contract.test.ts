import { readFileSync } from 'node:fs';
import { AUTH_UPSTREAM_TIMEOUT_MS } from '@greenhub/shared';
import { describe, expect, it } from 'vitest';

// auth.ts가 공유 인증 런타임(packages/shared/src/auth-runtime.ts)을 올바르게 연결했는지 소스로 확인한다.
// 런타임 함수 자체의 동작은 packages/shared/src/auth-runtime.test.ts가 확인한다.
const authSource = readFileSync(new URL('./auth.ts', import.meta.url), 'utf8');

describe('driver auth.ts 계약', () => {
  it('Credentials provider는 런타임 게이트 뒤에서만 등록한다', () => {
    expect(authSource.match(/Credentials\(\{/g)).toHaveLength(1);
    expect(authSource).toMatch(/const testCredentialsProvider = Credentials\(\{/);
    // providers에서는 게이트를 거친 spread로만 참조한다.
    expect(authSource.match(/testCredentialsProvider\b/g)).toHaveLength(2);
    expect(authSource).toMatch(
      /\.\.\.\(isTestCredentialsProviderEnabled\(process\.env\) \? \[testCredentialsProvider\] : \[\]\)/,
    );
    expect(authSource).toMatch(/if \(!isLoopbackApiUrl\(API\)\) return false;/);
  });

  it('로그아웃 이벤트에서 API 세션을 폐기하고, 서버 쪽 API 호출은 시간 제한을 쓴다', () => {
    expect(authSource).toMatch(/async signOut\(message\)/);
    expect(authSource).toMatch(/revokeApiSession\(\{\s*apiBaseUrl: API,/);
    const fetchCalls =
      authSource.match(/await fetch\(`\$\{API\}[^`]*`, \{[\s\S]*?\n\s*\}\);/g) ?? [];
    expect(fetchCalls).toHaveLength(5);
    for (const call of fetchCalls) expect(call).toMatch(/signal: authUpstreamSignal\(\)/);
    expect(AUTH_UPSTREAM_TIMEOUT_MS).toBe(10_000);
  });

  it('카카오 로그인 API 호출 실패는 예외 대신 false로 끝난다', () => {
    const kakaoAt = authSource.search(/fetch\(`\$\{API\}\/auth\/kakao-login`/);
    expect(kakaoAt).toBeGreaterThan(0);
    const tryAt = authSource.lastIndexOf('try {', kakaoAt);
    const signInAt = authSource.indexOf('async signIn({ user, account })');
    expect(tryAt).toBeGreaterThan(signInAt);
    expect(authSource.slice(kakaoAt)).toMatch(/\} catch \{\s*return false;\s*\}/);
  });
});
