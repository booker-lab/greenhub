import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// CONSUMER-ORDERS-REFETCH-RECOVERY-01 focused test.
// CONSUMER-ORDERS-READ-RECOVERY-02 root-cause-complete closure (scope 격리 포함).
// refetch() public contract가 실제 authoritative order GET을 다시 실행하는지,
// 복구 경로(성공/실패/재시도/stale/scope)가 데이터·error 규율을 지키는지 검증한다.

const hookSource = await readFile(new URL('./useOrders.ts', import.meta.url), 'utf8');
const clientSource = await readFile(
  new URL('../app/mypage/_client.tsx', import.meta.url),
  'utf8',
);

const compiled = ts.transpileModule(hookSource, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'useOrders.ts',
}).outputText;

const SESSION = { user: { id: 'user-1', accessToken: 'token-1' } };
const API_BASE_URL = 'https://api.example.test';
const EXPECTED_URL = `${API_BASE_URL}/orders?userId=user-1`;

const originalFetch = globalThis.fetch;
test.after(() => {
  globalThis.fetch = originalFetch;
});

function okResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}

function errorResponse(status = 500) {
  return { ok: false, status, json: async () => ({}) };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mountHook({ session = SESSION, fetchImpl }) {
  globalThis.fetch = fetchImpl;
  let currentSession = session;
  const hookModule = { exports: {} };
  const stateSlots = [];
  const refSlots = [];
  const effectSlots = [];
  let cursor = 0;
  let renderScheduled = true;
  let latest = null;

  const scheduleRender = () => {
    renderScheduled = true;
  };

  function useState(initial) {
    const index = cursor++;
    if (stateSlots[index] === undefined) stateSlots[index] = { value: initial };
    const slot = stateSlots[index];
    const setState = (next) => {
      const value = typeof next === 'function' ? next(slot.value) : next;
      if (Object.is(value, slot.value)) return;
      slot.value = value;
      scheduleRender();
    };
    return [slot.value, setState];
  }

  function useRef(initial) {
    const index = cursor++;
    if (refSlots[index] === undefined) refSlots[index] = { current: initial };
    return refSlots[index];
  }

  function useCallback(fn) {
    return fn;
  }

  function useEffect(create, deps) {
    const index = cursor++;
    if (effectSlots[index] === undefined) {
      effectSlots[index] = { deps: undefined, cleanup: undefined, hasRun: false };
    }
    effectSlots[index].pendingCreate = create;
    effectSlots[index].pendingDeps = deps;
  }

  const requireForTest = (specifier) => {
    if (specifier === 'react') return { useCallback, useEffect, useRef, useState };
    if (specifier === 'next-auth/react') return { useSession: () => ({ data: currentSession }) };
    if (specifier === '@/lib/api-base-url') {
      return { getApiBaseUrl: () => API_BASE_URL };
    }
    throw new Error(`예상하지 못한 주문 조회 모듈 요청: ${specifier}`);
  };
  new Function('require', 'module', 'exports', compiled)(
    requireForTest,
    hookModule,
    hookModule.exports,
  );

  function flushEffects() {
    for (const slot of effectSlots) {
      if (!slot || slot.pendingCreate === undefined) continue;
      const prevDeps = slot.deps;
      const nextDeps = slot.pendingDeps;
      const changed =
        !slot.hasRun ||
        prevDeps === undefined ||
        nextDeps === undefined ||
        nextDeps.length !== prevDeps.length ||
        nextDeps.some((dep, i) => !Object.is(dep, prevDeps[i]));
      if (!changed) continue;
      if (typeof slot.cleanup === 'function') {
        const cleanup = slot.cleanup;
        slot.cleanup = undefined;
        cleanup();
      }
      slot.deps = nextDeps;
      slot.hasRun = true;
      const nextCleanup = slot.pendingCreate();
      slot.cleanup = typeof nextCleanup === 'function' ? nextCleanup : undefined;
    }
  }

  function render() {
    cursor = 0;
    renderScheduled = false;
    // biome-ignore lint/correctness/useHookAtTopLevel: React를 모의한 훅 계약 단위 테스트다.
    latest = hookModule.exports.useOrders();
    flushEffects();
  }

  async function settle(passes = 25) {
    for (let i = 0; i < passes; i += 1) {
      if (renderScheduled) render();
      await new Promise((resolve) => setImmediate(resolve));
      if (renderScheduled) render();
    }
    if (renderScheduled) render();
  }

  const get = () => latest;
  const setSession = (next) => {
    currentSession = next;
    scheduleRender();
  };
  return { get, settle, render, setSession };
}

const orderA = { id: 'order-A' };
const orderB = { id: 'order-B' };

test('initial success는 authoritative GET 1회로 주문을 적재하고 error를 비운다', async () => {
  const calls = [];
  const harness = mountHook({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return okResponse([orderA]);
    },
  });
  await harness.settle();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, EXPECTED_URL);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer token-1');
  assert.deepEqual(harness.get().orders, [orderA]);
  assert.equal(harness.get().loading, false);
  assert.equal(harness.get().error, null);
});

test('initial failure는 error를 세우고 빈 성공으로 위장하지 않는다', async () => {
  const harness = mountHook({ fetchImpl: async () => errorResponse(500) });
  await harness.settle();

  assert.match(harness.get().error ?? '', /500/);
  assert.deepEqual(harness.get().orders, []);
  assert.equal(harness.get().loading, false);
});

test('정상 empty([])는 error 없이 성공으로 확정한다', async () => {
  const harness = mountHook({ fetchImpl: async () => okResponse([]) });
  await harness.settle();

  assert.deepEqual(harness.get().orders, []);
  assert.equal(harness.get().error, null);
  assert.equal(harness.get().loading, false);
});

test('manual refetch는 동일한 authoritative GET을 다시 실행한다', async () => {
  const calls = [];
  const harness = mountHook({
    fetchImpl: async (url) => {
      calls.push(url);
      return okResponse([orderA]);
    },
  });
  await harness.settle();
  assert.equal(calls.length, 1);

  harness.get().refetch();
  await harness.settle();

  assert.equal(calls.length, 2);
  assert.equal(calls[1], EXPECTED_URL);
  assert.deepEqual(harness.get().orders, [orderA]);
  assert.equal(harness.get().error, null);
});

test('failure → retry → success는 error를 clear하고 주문을 적재한다', async () => {
  let mode = 'failure';
  const harness = mountHook({
    fetchImpl: async () => (mode === 'failure' ? errorResponse(500) : okResponse([orderB])),
  });
  await harness.settle();
  assert.notEqual(harness.get().error, null);
  assert.deepEqual(harness.get().orders, []);

  mode = 'success';
  harness.get().refetch();
  await harness.settle();

  assert.deepEqual(harness.get().orders, [orderB]);
  assert.equal(harness.get().error, null);
  assert.equal(harness.get().loading, false);
});

test('기존 주문이 있을 때 transient retry failure는 데이터를 삭제하지 않는다', async () => {
  let mode = 'success';
  const harness = mountHook({
    fetchImpl: async () => (mode === 'success' ? okResponse([orderA]) : errorResponse(500)),
  });
  await harness.settle();
  assert.deepEqual(harness.get().orders, [orderA]);

  mode = 'failure';
  harness.get().refetch();
  await harness.settle();

  assert.deepEqual(harness.get().orders, [orderA]);
  assert.notEqual(harness.get().error, null);
  assert.equal(harness.get().loading, false);
});

test('stale 응답은 더 최신 refetch 결과를 덮지 않는다', async () => {
  const calls = [];
  const first = deferred();
  const second = deferred();
  let n = 0;
  const harness = mountHook({
    fetchImpl: async (url) => {
      n += 1;
      calls.push(url);
      return n === 1 ? first.promise : second.promise;
    },
  });
  await harness.settle(5);
  assert.equal(calls.length, 1);

  harness.get().refetch();
  await harness.settle(5);
  assert.equal(calls.length, 2);

  second.resolve(okResponse([orderB]));
  await harness.settle();
  assert.deepEqual(harness.get().orders, [orderB]);

  first.resolve(okResponse([orderA]));
  await harness.settle();
  assert.deepEqual(harness.get().orders, [orderB]);
  assert.equal(harness.get().error, null);
});

test('refetch trigger가 fetch effect에 연결되어 dead tick이 아니다', () => {
  assert.doesNotMatch(hookSource, /_tick/);
  assert.match(hookSource, /\[\s*session\?\.user\?\.id,\s*session\?\.user\?\.accessToken,\s*tick\s*\]/);
  // dummy state를 effect와 명시적으로 연결한다: warning 억제(biome-ignore)로 끝내지 않는다.
  assert.match(hookSource, /void\s+tick/);
  assert.doesNotMatch(hookSource, /biome-ignore.*useExhaustiveDependencies/);
});

test('MyPage는 주문 조회 실패에 실제 동작하는 retry를 제공한다', () => {
  assert.match(clientSource, /const \{ orders, loading, error, refetch \} = useOrders\(\)/);
  assert.match(clientSource, /data-testid="orders-retry"/);
  assert.match(clientSource, /onClick=\{refetch\}/);
  assert.match(clientSource, /다시 시도/);
});

test('MyPage는 refetch 중 기존 주문을 숨기지 않고 error와 정상 empty를 구분한다', () => {
  assert.doesNotMatch(clientSource, /!loading && orders\.length > 0/);
  assert.match(clientSource, /!loading && !error && orders\.length === 0/);
});

test('user/token scope 변경은 이전 사용자의 주문을 재사용하지 않는다', async () => {
  const calls = [];
  const userA = { user: { id: 'user-1', accessToken: 'token-1' } };
  const userB = { user: { id: 'user-2', accessToken: 'token-2' } };
  const harness = mountHook({
    session: userA,
    fetchImpl: async (url, init) => {
      calls.push({ url, auth: init?.headers?.Authorization });
      if (url.includes('userId=user-1')) return okResponse([orderA]);
      if (url.includes('userId=user-2')) return okResponse([orderB]);
      return errorResponse(404);
    },
  });
  await harness.settle();
  assert.deepEqual(harness.get().orders, [orderA]);

  harness.setSession(userB);
  await harness.settle();

  assert.ok(calls.some((c) => c.url === `${API_BASE_URL}/orders?userId=user-2`));
  assert.equal(calls[calls.length - 1].auth, 'Bearer token-2');
  assert.deepEqual(harness.get().orders, [orderB]);
  assert.equal(harness.get().error, null);
});

test('scope 변경 후 실패는 이전 사용자의 주문을 노출하지 않는다', async () => {
  const userA = { user: { id: 'user-1', accessToken: 'token-1' } };
  const userB = { user: { id: 'user-2', accessToken: 'token-2' } };
  const harness = mountHook({
    session: userA,
    fetchImpl: async (url) => {
      if (url.includes('userId=user-1')) return okResponse([orderA]);
      return errorResponse(500);
    },
  });
  await harness.settle();
  assert.deepEqual(harness.get().orders, [orderA]);

  harness.setSession(userB);
  await harness.settle();

  assert.deepEqual(harness.get().orders, []);
  assert.notEqual(harness.get().error, null);
  assert.equal(harness.get().loading, false);
});

test('session 소멸(logout)은 이전 주문 잔재를 비운다', async () => {
  const userA = { user: { id: 'user-1', accessToken: 'token-1' } };
  const harness = mountHook({
    session: userA,
    fetchImpl: async () => okResponse([orderA]),
  });
  await harness.settle();
  assert.deepEqual(harness.get().orders, [orderA]);

  harness.setSession(null);
  await harness.settle();

  assert.deepEqual(harness.get().orders, []);
  assert.equal(harness.get().error, null);
  assert.equal(harness.get().loading, false);
});

test('MyPage retry는 window.location.reload를 사용하지 않는다', () => {
  assert.doesNotMatch(clientSource, /location\.reload/);
  assert.doesNotMatch(hookSource, /location\.reload/);
});
