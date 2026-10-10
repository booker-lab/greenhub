import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  retryReadOnceOnUnauthorized,
  SESSION_KEEPALIVE_INTERVAL_MS,
  SESSION_REFRESH_TIMEOUT_MS,
  shouldSyncSessionAccessToken,
  startSessionKeepAlive,
} from './session-refresh.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const apiSource = await read('./api.ts');
const providersSource = await read('../app/providers.tsx');
const boardSource = await read('../app/board/_client.tsx');
const mapSource = await read('../app/map/page.tsx');
const detailSource = await read('../app/board/[orderId]/page.tsx');
const photoCaptureSource = await read('../app/board/[orderId]/photo/photo-capture.tsx');
const holdModalSource = await read('../app/board/[orderId]/_components/DeliveryHoldModal.tsx');

// 가짜 조회: 토큰별로 정한 상태 코드를 돌려주고 호출을 기록한다.
function fakeRead(statusByToken) {
  const calls = [];
  const readOnce = async (token) => {
    calls.push(token);
    return new Response(null, { status: statusByToken[token] ?? 500 });
  };
  return { read: readOnce, calls };
}

function fakeRefresh(result) {
  const state = { calls: 0 };
  const refresh = async () => {
    state.calls += 1;
    if (result instanceof Error) throw result;
    return result;
  };
  return { refresh, state };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('조회 401이면 세션을 한 번 다시 받아 새 토큰으로 한 번만 다시 조회한다', async () => {
  const { read: readOnce, calls } = fakeRead({ expired: 401, fresh: 200 });
  const { refresh, state } = fakeRefresh('fresh');

  const response = await retryReadOnceOnUnauthorized({
    read: readOnce,
    token: 'expired',
    refreshAccessToken: refresh,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ['expired', 'fresh']);
  assert.equal(state.calls, 1);
});

test('다시 조회해도 401이면 더 반복하지 않고 그 401을 돌려준다', async () => {
  const { read: readOnce, calls } = fakeRead({ expired: 401, 'still-expired': 401 });
  const { refresh, state } = fakeRefresh('still-expired');

  const response = await retryReadOnceOnUnauthorized({
    read: readOnce,
    token: 'expired',
    refreshAccessToken: refresh,
  });

  assert.equal(response.status, 401);
  assert.deepEqual(calls, ['expired', 'still-expired']);
  assert.equal(state.calls, 1);
});

test('401이 아니면 세션을 다시 받지 않고 그대로 돌려준다', async () => {
  for (const status of [200, 204, 403, 404, 409, 500, 503]) {
    const { read: readOnce, calls } = fakeRead({ token: status });
    const { refresh, state } = fakeRefresh('fresh');

    const response = await retryReadOnceOnUnauthorized({
      read: readOnce,
      token: 'token',
      refreshAccessToken: refresh,
    });

    assert.equal(response.status, status);
    assert.deepEqual(calls, ['token'], `${status}`);
    assert.equal(state.calls, 0, `${status}`);
  }
});

test('세션을 다시 받지 못하면(로그아웃·실패·빈 토큰) 처음 401을 돌려준다', async () => {
  for (const result of [null, undefined, '', 42, new Error('session fetch failed')]) {
    const { read: readOnce, calls } = fakeRead({ expired: 401 });
    const { refresh, state } = fakeRefresh(result);

    const response = await retryReadOnceOnUnauthorized({
      read: readOnce,
      token: 'expired',
      refreshAccessToken: refresh,
    });

    assert.equal(response.status, 401, String(result));
    assert.deepEqual(calls, ['expired'], String(result));
    assert.equal(state.calls, 1, String(result));
  }
});

test('세션 다시 받기가 끝나지 않으면 기한 뒤 처음 401을 돌려준다', async () => {
  const { read: readOnce, calls } = fakeRead({ expired: 401 });

  const response = await retryReadOnceOnUnauthorized({
    read: readOnce,
    token: 'expired',
    refreshAccessToken: () => new Promise(() => {}),
    refreshTimeoutMs: 5,
  });

  assert.equal(response.status, 401);
  assert.deepEqual(calls, ['expired']);
  assert.equal(SESSION_REFRESH_TIMEOUT_MS, 15_000);
});

test('네트워크 오류는 세션을 다시 받지 않고 그대로 던진다', async () => {
  const { refresh, state } = fakeRefresh('fresh');
  await assert.rejects(
    retryReadOnceOnUnauthorized({
      read: async () => {
        throw new TypeError('Failed to fetch');
      },
      token: 'token',
      refreshAccessToken: refresh,
    }),
    TypeError,
  );
  assert.equal(state.calls, 0);
});

test('세션 확인 결과가 다른 쓸 수 있는 토큰일 때만 화면 세션을 갱신한다', () => {
  assert.equal(shouldSyncSessionAccessToken('token-b', 'token-a'), true);
  assert.equal(shouldSyncSessionAccessToken('token-a', undefined), true);
  assert.equal(shouldSyncSessionAccessToken('token-a', 'token-a'), false);
  for (const probed of [null, undefined, '', 0, {}]) {
    assert.equal(shouldSyncSessionAccessToken(probed, 'token-a'), false, String(probed));
  }
});

test('세션 유지: 2분마다 확인하고 새 토큰을 받았을 때만 갱신한다', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const probes = ['token-a', 'token-b', null];
  let probeCalls = 0;
  let syncCalls = 0;
  const stop = startSessionKeepAlive({
    probeAccessToken: async () => {
      probeCalls += 1;
      return probes.shift();
    },
    currentAccessToken: () => 'token-a',
    syncSession: () => {
      syncCalls += 1;
    },
  });

  t.mock.timers.tick(SESSION_KEEPALIVE_INTERVAL_MS - 1);
  await flush();
  assert.equal(probeCalls, 0);

  // 같은 토큰: 갱신하지 않는다.
  t.mock.timers.tick(1);
  await flush();
  assert.equal(probeCalls, 1);
  assert.equal(syncCalls, 0);

  // jwt callback이 토큰을 갱신했다: 화면 세션을 갱신한다.
  t.mock.timers.tick(SESSION_KEEPALIVE_INTERVAL_MS);
  await flush();
  assert.equal(probeCalls, 2);
  assert.equal(syncCalls, 1);

  // 확인 실패(null): 세션을 건드리지 않는다.
  t.mock.timers.tick(SESSION_KEEPALIVE_INTERVAL_MS);
  await flush();
  assert.equal(probeCalls, 3);
  assert.equal(syncCalls, 1);

  stop();
  t.mock.timers.tick(SESSION_KEEPALIVE_INTERVAL_MS * 3);
  await flush();
  assert.equal(probeCalls, 3);
  assert.equal(SESSION_KEEPALIVE_INTERVAL_MS, 120_000);
});

test('세션 유지: 확인 실패는 무시하고 끝나지 않은 확인과 겹쳐 보내지 않는다', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let probeCalls = 0;
  let syncCalls = 0;
  let release;
  const stop = startSessionKeepAlive({
    probeAccessToken: () => {
      probeCalls += 1;
      if (probeCalls === 1) return Promise.reject(new Error('offline'));
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    currentAccessToken: () => 'token-a',
    syncSession: () => {
      syncCalls += 1;
    },
    intervalMs: 1_000,
    probeTimeoutMs: 60_000,
  });

  t.mock.timers.tick(1_000);
  await flush();
  assert.equal(probeCalls, 1);
  assert.equal(syncCalls, 0);

  // 두 번째 확인이 끝나지 않은 동안에는 다음 주기에 새 확인을 보내지 않는다.
  t.mock.timers.tick(1_000);
  await flush();
  t.mock.timers.tick(1_000);
  await flush();
  assert.equal(probeCalls, 2);

  release('token-b');
  await flush();
  assert.equal(syncCalls, 1);
  t.mock.timers.tick(1_000);
  await flush();
  assert.equal(probeCalls, 3);
  stop();
});

test('세션 유지: 멈춘 뒤 도착한 확인 결과로는 갱신하지 않는다', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let release;
  let syncCalls = 0;
  const stop = startSessionKeepAlive({
    probeAccessToken: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    currentAccessToken: () => 'token-a',
    syncSession: () => {
      syncCalls += 1;
    },
    intervalMs: 1_000,
  });
  t.mock.timers.tick(1_000);
  await flush();
  stop();
  release('token-b');
  await flush();
  assert.equal(syncCalls, 0);
});

test('apiRead는 GET으로 고정되고 세션을 다시 받아 401 조회를 한 번만 다시 보낸다', () => {
  const at = apiSource.indexOf('export function apiRead');
  assert.ok(at !== -1, 'apiRead가 있어야 한다');
  const block = apiSource.slice(at);
  assert.match(block, /retryReadOnceOnUnauthorized\(\{/);
  assert.match(block, /apiFetch\(path, readToken, \{ \.\.\.options, method: 'GET' \}\)/);
  assert.match(block, /await getSession\(\)/);
  // 조회 옵션에는 method·body가 없다.
  assert.match(apiSource, /ApiReadOptions = Pick<ApiFetchOptions, 'signal' \| 'timeoutMs'>/);
});

test('기사 주문 조회는 apiRead를 쓰고 명령은 apiFetch로 한 번만 보낸다', () => {
  assert.match(
    boardSource,
    /apiRead\('\/driver\/orders', token, \{ signal: controller\.signal \}\)/,
  );
  assert.match(mapSource, /apiRead\('\/driver\/orders', token, \{ signal: controller\.signal \}\)/);
  // 상세 조회·명령 뒤 확인 조회·사진 실패 뒤 상태 조회 모두 조회 경로다.
  assert.equal(
    (
      detailSource.match(
        /apiRead\(`\/driver\/orders\/\$\{encodeURIComponent\(orderId\)\}`, token\)/g,
      ) ?? []
    ).length,
    2,
  );
  assert.match(
    photoCaptureSource,
    /apiRead\(`\/driver\/orders\/\$\{encodeURIComponent\(orderId\)\}`, token\)/,
  );
  // 모든 apiRead 호출은 /driver/orders 조회뿐이다.
  for (const source of [
    boardSource,
    mapSource,
    detailSource,
    photoCaptureSource,
    holdModalSource,
  ]) {
    for (const call of source.match(/apiRead\([^,]*,/g) ?? []) {
      assert.match(call, /^apiRead\(['`]\/driver\/orders/, call);
    }
  }
  // 명령(PATCH·POST)은 apiFetch로 한 번 보내며 apiRead로 감싸지 않는다.
  for (const source of [detailSource, photoCaptureSource, holdModalSource]) {
    const commandCount = (source.match(/method: '(?:PATCH|POST)'/g) ?? []).length;
    const commandCalls = [
      ...source.matchAll(/(\w+)\(\s*`[^`]*`,\s*token,\s*\{\s*method: '(?:PATCH|POST)'/g),
    ];
    assert.ok(commandCount > 0);
    assert.equal(commandCalls.length, commandCount);
    for (const [, callee] of commandCalls) assert.equal(callee, 'apiFetch');
  }
  assert.doesNotMatch(holdModalSource, /apiRead\(/);
});

test('세션 유지는 refetchInterval 대신 실패를 무시하는 확인으로 한다', () => {
  assert.match(providersSource, /<SessionKeepAlive \/>/);
  assert.match(providersSource, /startSessionKeepAlive\(\{/);
  assert.match(providersSource, /getSession\(\{ broadcast: false \}\)/);
  assert.match(providersSource, /void updateRef\.current\(\)/);
  assert.doesNotMatch(providersSource, /refetchInterval=/);
});
