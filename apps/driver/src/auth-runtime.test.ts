import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AUTH_UPSTREAM_TIMEOUT_MS,
  isLoopbackApiUrl,
  isTestCredentialsProviderEnabled,
  revokeApiSession,
} from './auth-runtime';

const API = 'https://api.example.test';
const authSource = readFileSync(new URL('./auth.ts', import.meta.url), 'utf8');

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function recordingFetch(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error(`unexpected request: ${url}`);
    return next;
  };
  return { calls, fetchImpl };
}

describe('테스트 전용 Credentials provider 등록 조건', () => {
  it('운영 표식이 있으면 등록하지 않는다', () => {
    expect(
      isTestCredentialsProviderEnabled({ NODE_ENV: 'production', VERCEL_ENV: 'production' }),
    ).toBe(false);
    expect(
      isTestCredentialsProviderEnabled({
        NODE_ENV: 'development',
        RAILWAY_ENVIRONMENT_NAME: 'production',
      }),
    ).toBe(false);
    expect(isTestCredentialsProviderEnabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('Preview(로컬 E2E 실행기 포함)와 개발 서버에서는 등록한다', () => {
    expect(
      isTestCredentialsProviderEnabled({ NODE_ENV: 'production', VERCEL_ENV: 'preview' }),
    ).toBe(true);
    expect(isTestCredentialsProviderEnabled({ NODE_ENV: 'development' })).toBe(true);
  });
});

describe('local runtime API loopback 검사', () => {
  it('이 기기 API 주소만 허용한다', () => {
    expect(isLoopbackApiUrl('http://localhost:3000')).toBe(true);
    expect(isLoopbackApiUrl('http://127.0.0.1:3000')).toBe(true);
    expect(isLoopbackApiUrl('http://[::1]:3000')).toBe(true);
    expect(isLoopbackApiUrl('https://api-staging.example.test')).toBe(false);
    expect(isLoopbackApiUrl('http://localhost.example.test')).toBe(false);
    expect(isLoopbackApiUrl('not a url')).toBe(false);
  });
});

describe('로그아웃 시 API 세션 폐기', () => {
  it('access token으로 POST /auth/logout을 부른다', async () => {
    const { calls, fetchImpl } = recordingFetch([jsonResponse(204)]);
    await expect(
      revokeApiSession({ apiBaseUrl: API, accessToken: 'a1', refreshToken: 'r1', fetchImpl }),
    ).resolves.toBe('revoked');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${API}/auth/logout`);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({ Authorization: 'Bearer a1' });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('access token이 거절되면 refresh 뒤 한 번만 다시 폐기한다', async () => {
    const { calls, fetchImpl } = recordingFetch([
      jsonResponse(401),
      jsonResponse(200, { accessToken: 'a2', refreshToken: 'r2' }),
      jsonResponse(204),
    ]);
    await expect(
      revokeApiSession({ apiBaseUrl: API, accessToken: 'a1', refreshToken: 'r1', fetchImpl }),
    ).resolves.toBe('revoked');
    expect(calls.map((call) => call.url)).toEqual([
      `${API}/auth/logout`,
      `${API}/auth/refresh`,
      `${API}/auth/logout`,
    ]);
    expect(calls[2].init.headers).toEqual({ Authorization: 'Bearer a2' });
  });

  it('재시도한 폐기도 거절되면 더 부르지 않고 failed로 끝난다', async () => {
    const { calls, fetchImpl } = recordingFetch([
      jsonResponse(403),
      jsonResponse(200, { accessToken: 'a2', refreshToken: 'r2' }),
      jsonResponse(401),
    ]);
    await expect(
      revokeApiSession({ apiBaseUrl: API, accessToken: 'a1', refreshToken: 'r1', fetchImpl }),
    ).resolves.toBe('failed');
    expect(calls).toHaveLength(3);
  });

  it('refresh도 거절되면 이미 끝난 세션으로 본다', async () => {
    const { fetchImpl } = recordingFetch([jsonResponse(401), jsonResponse(401)]);
    await expect(
      revokeApiSession({ apiBaseUrl: API, accessToken: 'a1', refreshToken: 'r1', fetchImpl }),
    ).resolves.toBe('already-revoked');
  });

  it('네트워크 오류는 예외 없이 failed로 끝난다', async () => {
    const { fetchImpl } = recordingFetch([new TypeError('fetch failed')]);
    await expect(
      revokeApiSession({ apiBaseUrl: API, accessToken: 'a1', refreshToken: 'r1', fetchImpl }),
    ).resolves.toBe('failed');
  });

  it('시간 제한을 넘기면 예외 없이 failed로 끝난다', async () => {
    const fetchImpl = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    await expect(
      revokeApiSession({
        apiBaseUrl: API,
        accessToken: 'a1',
        refreshToken: 'r1',
        fetchImpl,
        timeoutMs: 20,
      }),
    ).resolves.toBe('failed');
  });
});

describe('driver auth.ts 계약', () => {
  it('Credentials provider는 런타임 게이트 뒤에서만 등록한다', () => {
    expect(authSource.match(/Credentials\(\{/g)).toHaveLength(1);
    expect(authSource).toMatch(/const testCredentialsProvider = Credentials\(\{/);
    // providers에서는 게이트를 거친 spread로만 참조한다.
    expect(authSource.match(/testCredentialsProvider\b/g)).toHaveLength(2);
    expect(authSource).toMatch(
      /\.\.\.\(isTestCredentialsProviderEnabled\(\) \? \[testCredentialsProvider\] : \[\]\)/,
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
