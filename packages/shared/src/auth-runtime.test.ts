import { describe, expect, it } from 'vitest';
import {
  AUTH_LOGOUT_TIMEOUT_MS,
  AUTH_UPSTREAM_TIMEOUT_MS,
  authUpstreamSignal,
  isLoopbackApiUrl,
  isTestCredentialsProviderEnabled,
  revokeApiSession,
  testSecretsMatch,
} from './auth-runtime.js';

const API = 'https://api.example.test';

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
    // 운영 표식이 있으면 preview 표식이 함께 있어도 끈다.
    expect(
      isTestCredentialsProviderEnabled({
        NODE_ENV: 'production',
        VERCEL_ENV: 'preview',
        RAILWAY_ENVIRONMENT_NAME: 'production',
      }),
    ).toBe(false);
    // 표식 없는 운영 빌드(next start)는 끈다.
    expect(isTestCredentialsProviderEnabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('Preview(로컬 E2E 실행기 포함)와 개발 서버에서는 등록한다', () => {
    expect(
      isTestCredentialsProviderEnabled({ NODE_ENV: 'production', VERCEL_ENV: 'preview' }),
    ).toBe(true);
    expect(isTestCredentialsProviderEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(
      isTestCredentialsProviderEnabled({ NODE_ENV: 'development', VERCEL_ENV: 'development' }),
    ).toBe(true);
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

describe('E2E secret 비교', () => {
  it('같은 값만 통과하고 빈 값은 거부한다', async () => {
    await expect(testSecretsMatch('secret-value', 'secret-value')).resolves.toBe(true);
    await expect(testSecretsMatch('secret-value', 'secret-valuf')).resolves.toBe(false);
    await expect(testSecretsMatch('secret', 'secret-value')).resolves.toBe(false);
    await expect(testSecretsMatch(null, 'secret-value')).resolves.toBe(false);
    await expect(testSecretsMatch(undefined, 'secret-value')).resolves.toBe(false);
    await expect(testSecretsMatch('', '')).resolves.toBe(false);
    await expect(testSecretsMatch('secret-value', undefined)).resolves.toBe(false);
  });
});

describe('서버 fetch 시간 제한', () => {
  it('신호는 설정한 시간 뒤 TimeoutError로 끊긴다', async () => {
    expect(AUTH_UPSTREAM_TIMEOUT_MS).toBe(10_000);
    const signal = authUpstreamSignal(5);
    expect(signal.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(signal.aborted).toBe(true);
    expect((signal.reason as Error | undefined)?.name).toBe('TimeoutError');
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
      jsonResponse(401, { message: 'expired' }),
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
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ refreshToken: 'r1' });
    expect(calls[2].init.headers).toEqual({ Authorization: 'Bearer a2' });
    // 세 요청이 같은 시간 제한 신호를 공유한다.
    expect(calls[1].init.signal).toBe(calls[0].init.signal);
    expect(calls[2].init.signal).toBe(calls[1].init.signal);
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
    const { calls, fetchImpl } = recordingFetch([jsonResponse(403), jsonResponse(401)]);
    await expect(
      revokeApiSession({ apiBaseUrl: API, accessToken: 'a1', refreshToken: 'r1', fetchImpl }),
    ).resolves.toBe('already-revoked');
    expect(calls).toHaveLength(2);
  });

  it('일시 실패·네트워크 오류·잘못된 refresh 응답은 예외 없이 failed로 끝난다', async () => {
    const serverError = recordingFetch([jsonResponse(503)]);
    await expect(
      revokeApiSession({
        apiBaseUrl: API,
        accessToken: 'a1',
        refreshToken: 'r1',
        fetchImpl: serverError.fetchImpl,
      }),
    ).resolves.toBe('failed');
    expect(serverError.calls).toHaveLength(1);

    const network = recordingFetch([new TypeError('fetch failed')]);
    await expect(
      revokeApiSession({
        apiBaseUrl: API,
        accessToken: 'a1',
        refreshToken: 'r1',
        fetchImpl: network.fetchImpl,
      }),
    ).resolves.toBe('failed');

    const badRefresh = recordingFetch([jsonResponse(401), jsonResponse(200, { accessToken: 1 })]);
    await expect(
      revokeApiSession({
        apiBaseUrl: API,
        accessToken: 'a1',
        refreshToken: 'r1',
        fetchImpl: badRefresh.fetchImpl,
      }),
    ).resolves.toBe('failed');
  });

  it('시간 제한을 넘기면 대기 중인 요청을 끊고 failed로 끝난다', async () => {
    const fetchImpl = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    const started = Date.now();
    await expect(
      revokeApiSession({
        apiBaseUrl: API,
        accessToken: 'a1',
        refreshToken: 'r1',
        fetchImpl,
        timeoutMs: 20,
      }),
    ).resolves.toBe('failed');
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(AUTH_LOGOUT_TIMEOUT_MS).toBe(5_000);
  });

  it('token이 없으면 아무 요청도 보내지 않는다', async () => {
    const { calls, fetchImpl } = recordingFetch([]);
    await expect(
      revokeApiSession({ apiBaseUrl: API, accessToken: '', refreshToken: undefined, fetchImpl }),
    ).resolves.toBe('skipped');
    expect(calls).toHaveLength(0);
  });
});
