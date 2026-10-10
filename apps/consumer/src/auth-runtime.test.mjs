import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./auth-runtime.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'auth-runtime.ts',
}).outputText;

const runtimeModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  (specifier) => {
    throw new Error(`unexpected module request in test: ${specifier}`);
  },
  runtimeModule,
  runtimeModule.exports,
);

const {
  AUTH_LOGOUT_TIMEOUT_MS,
  AUTH_UPSTREAM_TIMEOUT_MS,
  authUpstreamSignal,
  isTestCredentialsProviderEnabled,
  revokeApiSession,
  testSecretsMatch,
} = runtimeModule.exports;

const authSource = await readFile(new URL('./auth.ts', import.meta.url), 'utf8');

const API = 'https://api.example.test';

function jsonResponse(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function recordingFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error(`unexpected request: ${url}`);
    return next;
  };
  return { calls, fetchImpl };
}

test('테스트 전용 Credentials provider는 운영 런타임에서 꺼지고 Preview·개발 서버에서만 켜진다', () => {
  assert.equal(
    isTestCredentialsProviderEnabled({ NODE_ENV: 'production', VERCEL_ENV: 'production' }),
    false,
  );
  assert.equal(
    isTestCredentialsProviderEnabled({
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT_NAME: 'production',
    }),
    false,
  );
  // 운영 표식이 있으면 preview 표식이 함께 있어도 끈다.
  assert.equal(
    isTestCredentialsProviderEnabled({
      NODE_ENV: 'production',
      VERCEL_ENV: 'preview',
      RAILWAY_ENVIRONMENT_NAME: 'production',
    }),
    false,
  );
  // 표식 없는 운영 빌드(next start)는 끈다.
  assert.equal(isTestCredentialsProviderEnabled({ NODE_ENV: 'production' }), false);
  // Vercel Preview와 로컬 E2E 실행기(VERCEL_ENV=preview + next start)는 켠다.
  assert.equal(
    isTestCredentialsProviderEnabled({ NODE_ENV: 'production', VERCEL_ENV: 'preview' }),
    true,
  );
  // 개발 서버(launcher·화면 확인 하네스)는 켠다.
  assert.equal(isTestCredentialsProviderEnabled({ NODE_ENV: 'development' }), true);
  assert.equal(
    isTestCredentialsProviderEnabled({ NODE_ENV: 'development', VERCEL_ENV: 'development' }),
    true,
  );
});

test('E2E secret 비교는 값이 같을 때만 통과하고 비어 있으면 거부한다', async () => {
  assert.equal(await testSecretsMatch('secret-value', 'secret-value'), true);
  assert.equal(await testSecretsMatch('secret-value', 'secret-valuf'), false);
  assert.equal(await testSecretsMatch('secret', 'secret-value'), false);
  assert.equal(await testSecretsMatch(null, 'secret-value'), false);
  assert.equal(await testSecretsMatch(undefined, 'secret-value'), false);
  assert.equal(await testSecretsMatch('', ''), false);
  assert.equal(await testSecretsMatch('secret-value', undefined), false);
});

test('서버 fetch 시간 제한 신호는 설정한 시간 뒤 TimeoutError로 끊긴다', async () => {
  assert.equal(AUTH_UPSTREAM_TIMEOUT_MS, 10_000);
  const signal = authUpstreamSignal(5);
  assert.equal(signal.aborted, false);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason?.name, 'TimeoutError');
});

test('로그아웃은 현재 access token으로 POST /auth/logout을 부른다', async () => {
  const { calls, fetchImpl } = recordingFetch([jsonResponse(204)]);
  const result = await revokeApiSession({
    apiBaseUrl: API,
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    fetchImpl,
  });
  assert.equal(result, 'revoked');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API}/auth/logout`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer access-1');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test('access token이 거절되면 refresh로 새 token을 받아 한 번 더 폐기한다', async () => {
  const { calls, fetchImpl } = recordingFetch([
    jsonResponse(401, { message: 'expired' }),
    jsonResponse(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }),
    jsonResponse(204),
  ]);
  const result = await revokeApiSession({
    apiBaseUrl: API,
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    fetchImpl,
  });
  assert.equal(result, 'revoked');
  assert.deepEqual(
    calls.map((call) => call.url),
    [`${API}/auth/logout`, `${API}/auth/refresh`, `${API}/auth/logout`],
  );
  assert.deepEqual(JSON.parse(calls[1].init.body), { refreshToken: 'refresh-1' });
  assert.equal(calls[2].init.headers.Authorization, 'Bearer access-2');
  // 세 요청이 같은 시간 제한 신호를 공유한다.
  assert.equal(calls[0].init.signal, calls[1].init.signal);
  assert.equal(calls[1].init.signal, calls[2].init.signal);
});

test('refresh까지 거절되면 서버 세션은 이미 끝난 것으로 본다', async () => {
  const { calls, fetchImpl } = recordingFetch([jsonResponse(403), jsonResponse(401)]);
  const result = await revokeApiSession({
    apiBaseUrl: API,
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    fetchImpl,
  });
  assert.equal(result, 'already-revoked');
  assert.equal(calls.length, 2);
});

test('일시 실패·네트워크 오류는 예외 없이 failed로 끝나 로그아웃을 막지 않는다', async () => {
  const serverError = recordingFetch([jsonResponse(503)]);
  assert.equal(
    await revokeApiSession({
      apiBaseUrl: API,
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      fetchImpl: serverError.fetchImpl,
    }),
    'failed',
  );
  assert.equal(serverError.calls.length, 1);

  const network = recordingFetch([new TypeError('fetch failed')]);
  assert.equal(
    await revokeApiSession({
      apiBaseUrl: API,
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      fetchImpl: network.fetchImpl,
    }),
    'failed',
  );

  const badRefresh = recordingFetch([jsonResponse(401), jsonResponse(200, { accessToken: 1 })]);
  assert.equal(
    await revokeApiSession({
      apiBaseUrl: API,
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      fetchImpl: badRefresh.fetchImpl,
    }),
    'failed',
  );
});

test('시간 제한을 넘기면 대기 중인 요청을 끊고 failed로 끝난다', async () => {
  const fetchImpl = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
  const started = Date.now();
  // AbortSignal.timeout 타이머는 이벤트 루프를 붙잡지 않으므로 테스트 동안만 루프를 유지한다.
  const keepAlive = setTimeout(() => {}, 2_000);
  const result = await revokeApiSession({
    apiBaseUrl: API,
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    fetchImpl,
    timeoutMs: 20,
  });
  clearTimeout(keepAlive);
  assert.equal(result, 'failed');
  assert.ok(Date.now() - started < 1_000);
  assert.equal(AUTH_LOGOUT_TIMEOUT_MS, 5_000);
});

test('token이 없으면 아무 요청도 보내지 않는다', async () => {
  const { calls, fetchImpl } = recordingFetch([]);
  assert.equal(
    await revokeApiSession({
      apiBaseUrl: API,
      accessToken: '',
      refreshToken: undefined,
      fetchImpl,
    }),
    'skipped',
  );
  assert.equal(calls.length, 0);
});

test('auth.ts는 Credentials를 게이트 뒤에서만 등록하고 로그아웃 이벤트에서 API 세션을 폐기한다', () => {
  const gate = authSource.indexOf('...(isTestCredentialsProviderEnabled()');
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
