import { readFileSync } from 'node:fs';
import { AUTH_UPSTREAM_TIMEOUT_MS } from '@greenhub/shared';
import { describe, expect, it } from 'vitest';

// auth.ts가 공유 인증 런타임(packages/shared/src/auth-runtime.ts)을 올바르게 연결했는지 소스로 확인한다.
// 런타임 함수 자체의 동작은 packages/shared/src/auth-runtime.test.ts가 확인한다.
const authSource = readFileSync(new URL('./auth.ts', import.meta.url), 'utf8');

describe('seller auth.ts 계약', () => {
  it('Credentials provider는 런타임 게이트 뒤에서만 등록한다', () => {
    const gate = authSource.indexOf('...(isTestCredentialsProviderEnabled(process.env)');
    expect(gate).toBeGreaterThan(0);
    expect(authSource.indexOf('Credentials({')).toBeGreaterThan(gate);
    expect(authSource).toMatch(/testSecretsMatch\(got, expected\)/);
    expect(authSource).not.toMatch(/got !== expected/);
    expect(authSource).toMatch(/if \(!isLoopbackApiUrl\(API\)\) return false;/);
  });

  it('update()의 클라이언트 storeId를 토큰에 넣지 않고 /auth/session 응답으로 묶는다', () => {
    expect(authSource).not.toMatch(/trigger === 'update'/);
    expect(authSource).not.toMatch(/session\?\.storeId/);
    expect(authSource).toMatch(/storeId: authority\.storeId/);
  });

  it('초대 쿠키는 카카오 로그인에서 한 번 읽어 kakao-login 요청에 싣고 바로 지운다', () => {
    expect(authSource).toMatch(/cookieStore\.get\(SELLER_INVITE_COOKIE\)/);
    expect(authSource).toMatch(/cookieStore\.delete\(SELLER_INVITE_COOKIE\)/);
    expect(authSource).toMatch(/targetRole: 'seller',\s*inviteToken,/);
    expect(authSource).toMatch(/error: SIGN_IN_ERROR_PATH/);
  });

  it('로그아웃 이벤트에서 API 세션을 폐기하고, 서버 쪽 API 호출은 시간 제한을 쓴다', () => {
    expect(authSource).toMatch(/async signOut\(message\)/);
    expect(authSource).toMatch(/revokeApiSession\(\{\s*apiBaseUrl: API,/);
    const fetchCalls =
      authSource.match(/await fetch\(`\$\{API\}[^`]*`, \{[\s\S]*?\n\s*\}\);/g) ?? [];
    expect(fetchCalls).toHaveLength(4);
    for (const call of fetchCalls) expect(call).toMatch(/signal: authUpstreamSignal\(\)/);
    expect(AUTH_UPSTREAM_TIMEOUT_MS).toBe(10_000);
  });
});
