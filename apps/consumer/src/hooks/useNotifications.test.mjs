import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// CONSUMER-NOTIFICATIONS-READ-RECOVERY-01 focused test.
// Consumer 알림 목록 읽기 lifecycle만 소유한다:
// auth scope, request race, read states, retry, auto-read guard, scoped storage.

const hookSource = await readFile(new URL('./useNotifications.ts', import.meta.url), 'utf8');
const clientSource = await readFile(
  new URL('../app/mypage/notifications/_client.tsx', import.meta.url),
  'utf8',
);

const compiled = ts.transpileModule(hookSource, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'useNotifications.ts',
}).outputText;

const API_BASE_URL = 'https://api.example.test';
const EXPECTED_URL = `${API_BASE_URL}/notifications/me`;
const USER_A = { user: { id: 'user-a', accessToken: 'token-a' } };
const USER_B = { user: { id: 'user-b', accessToken: 'token-b' } };

const originalFetch = globalThis.fetch;
const originalLocalStorage = globalThis.localStorage;
test.after(() => {
  globalThis.fetch = originalFetch;
  globalThis.localStorage = originalLocalStorage;
});

function createStorage() {
  const store = new Map();
  return {
    __store: store,
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

function okItems(items) {
  return { ok: true, status: 200, json: async () => ({ items, total: items.length }) };
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

function mountHook({ session = USER_A, fetchImpl }) {
  globalThis.fetch = fetchImpl;
  globalThis.localStorage = createStorage();
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
    if (specifier === '@/lib/api-base-url') return { getApiBaseUrl: () => API_BASE_URL };
    throw new Error(`예상하지 못한 알림 조회 모듈 요청: ${specifier}`);
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
    latest = hookModule.exports.useNotifications();
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
  const storage = () => globalThis.localStorage;
  return { get, settle, render, setSession, storage };
}

const notifA1 = { id: 'notif-a1' };
const notifA2 = { id: 'notif-a2' };
const notifB1 = { id: 'notif-b1' };

// 1. success with items
test('1. success with items: authoritative GET 1회로 목록을 적재하고 error를 비운다', async () => {
  const calls = [];
  const harness = mountHook({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return okItems([notifA1, notifA2]);
    },
  });
  await harness.settle();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, EXPECTED_URL);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer token-a');
  assert.deepEqual(harness.get().notifications, [notifA1, notifA2]);
  assert.equal(harness.get().loading, false);
  assert.equal(harness.get().error, null);
});

// 2. successful empty
test('2. successful empty: 빈 목록은 error 없이 성공으로 확정한다', async () => {
  const harness = mountHook({ fetchImpl: async () => okItems([]) });
  await harness.settle();

  assert.deepEqual(harness.get().notifications, []);
  assert.equal(harness.get().error, null);
  assert.equal(harness.get().loading, false);
});

// 3. initial error !== empty
test('3. initial error는 빈 성공으로 위장하지 않는다', async () => {
  const harness = mountHook({ fetchImpl: async () => errorResponse(500) });
  await harness.settle();

  assert.match(harness.get().error ?? '', /500/);
  assert.deepEqual(harness.get().notifications, []);
  assert.equal(harness.get().loading, false);
});

// 4. error -> retry -> success
test('4. error → retry → success: refetch는 동일 GET을 재실행하고 error를 clear한다', async () => {
  let mode = 'failure';
  const calls = [];
  const harness = mountHook({
    fetchImpl: async (url) => {
      calls.push(url);
      return mode === 'failure' ? errorResponse(500) : okItems([notifA1]);
    },
  });
  await harness.settle();
  assert.notEqual(harness.get().error, null);
  assert.equal(calls.length, 1);

  mode = 'success';
  harness.get().refetch();
  await harness.settle();

  assert.equal(calls.length, 2);
  assert.equal(calls[1], EXPECTED_URL);
  assert.deepEqual(harness.get().notifications, [notifA1]);
  assert.equal(harness.get().error, null);
  assert.equal(harness.get().loading, false);
});

// 5. auth/token loss clears protected list
test('5. auth/token loss는 이전 사용자의 protected 목록·readIds·error를 제거한다', async () => {
  const harness = mountHook({ fetchImpl: async () => okItems([notifA1]) });
  await harness.settle();
  assert.deepEqual(harness.get().notifications, [notifA1]);

  harness.get().markAllRead();
  await harness.settle();
  assert.ok(harness.get().readIds.has('notif-a1'));

  harness.setSession(null);
  await harness.settle();

  assert.deepEqual(harness.get().notifications, []);
  assert.deepEqual([...harness.get().readIds], []);
  assert.equal(harness.get().error, null);
  assert.equal(harness.get().loading, false);
});

// 6. A -> B stale response blocked
test('6. account A → B 전환에서 늦은 A 응답이 B state를 덮지 않는다', async () => {
  const first = deferred();
  const second = deferred();
  let n = 0;
  const harness = mountHook({
    session: USER_A,
    fetchImpl: async () => {
      n += 1;
      return n === 1 ? first.promise : second.promise;
    },
  });
  await harness.settle(5);

  harness.setSession(USER_B);
  await harness.settle(5);

  second.resolve(okItems([notifB1]));
  await harness.settle();
  assert.deepEqual(harness.get().notifications, [notifB1]);
  assert.equal(harness.get().error, null);

  first.resolve(okItems([notifA1]));
  await harness.settle();
  assert.deepEqual(harness.get().notifications, [notifB1]);
  assert.equal(harness.get().error, null);
});

// 7. previous success -> refresh failure keeps stale
test('7. previous success → refresh failure는 stale 목록을 유지하고 failure를 명시한다', async () => {
  let mode = 'success';
  const harness = mountHook({
    fetchImpl: async () => (mode === 'success' ? okItems([notifA1]) : errorResponse(500)),
  });
  await harness.settle();
  assert.deepEqual(harness.get().notifications, [notifA1]);
  assert.equal(harness.get().error, null);

  mode = 'failure';
  harness.get().refetch();
  await harness.settle();

  assert.deepEqual(harness.get().notifications, [notifA1]);
  assert.notEqual(harness.get().error, null);
  assert.equal(harness.get().loading, false);
});

// 8. failure state에서는 automatic markAllRead가 실행되지 않는다
test('8. failure state에서 automatic markAllRead가 실행되지 않는다', () => {
  assert.match(
    clientSource,
    /if\s*\(\s*!loading\s*&&\s*!error\s*&&\s*notifications\.length\s*>\s*0\s*\)/,
  );
  assert.match(clientSource, /markAllRead\(\)/);
  assert.doesNotMatch(clientSource, /if\s*\(\s*!loading\s*&&\s*notifications\.length\s*>\s*0\s*\)/);
});

// 9. authoritative success 이후에만 intended mark-all behavior
test('9. authoritative success 이후에만 현재 intended mark-all behavior가 동작한다', async () => {
  // hook: markAllRead는 현재 scope 목록을 readIds에 적재한다
  const harness = mountHook({ fetchImpl: async () => okItems([notifA1, notifA2]) });
  await harness.settle();
  assert.equal(harness.get().readIds.size, 0);

  harness.get().markAllRead();
  await harness.settle();
  assert.ok(harness.get().readIds.has('notif-a1'));
  assert.ok(harness.get().readIds.has('notif-a2'));

  // client: auto-read effect는 error를 의존하고 성공 가드 뒤에만 호출한다
  assert.match(clientSource, /\[\s*loading,\s*error,\s*notifications\.length,\s*markAllRead\s*\]/);
});

// 10. readIds scope isolation
test('10. readIds 저장소는 계정별로 격리되고 기존 공통 key를 공유하지 않는다', async () => {
  const harness = mountHook({
    fetchImpl: async (url, init) => {
      const auth = init?.headers?.Authorization;
      if (auth === 'Bearer token-b') return okItems([notifB1]);
      return okItems([notifA1]);
    },
  });
  await harness.settle();
  assert.deepEqual(harness.get().notifications, [notifA1]);

  harness.get().markAllRead();
  await harness.settle();
  const store = harness.storage().__store;
  assert.equal(store.get('gh_read_notifications:user-a'), JSON.stringify(['notif-a1']));
  assert.equal(store.has('gh_read_notifications'), false);

  harness.setSession(USER_B);
  await harness.settle();

  assert.deepEqual(harness.get().notifications, [notifB1]);
  assert.deepEqual([...harness.get().readIds], []);
  // B scope에는 A의 읽음 표시가 넘어오지 않는다
  assert.equal(harness.storage().__store.get('gh_read_notifications:user-a'), JSON.stringify(['notif-a1']));
  assert.ok(!harness.get().readIds.has('notif-a1'));
});

test('hook은 userId+token scope·sequence race guard·tick refetch 계약을 가진다', () => {
  assert.match(hookSource, /session\?\.user\?\.id/);
  assert.match(hookSource, /requestSequenceRef/);
  assert.match(hookSource, /requestSequenceRef\.current !== requestId/);
  assert.match(hookSource, /void\s+tick/);
  assert.match(hookSource, /\[\s*session\?\.user\?\.id,\s*session\?\.user\?\.accessToken,\s*tick\s*\]/);
  assert.match(hookSource, /gh_read_notifications/);
  assert.match(hookSource, /readKeyFor\(userId\)/);
  assert.match(hookSource, /LEGACY_READ_KEY/);
  assert.match(hookSource, /\/notifications\/me/);
  assert.doesNotMatch(hookSource, /biome-ignore.*useExhaustiveDependencies/);
  assert.doesNotMatch(hookSource, /location\.reload/);
});

test('client retry는 실제 fetch lifecycle에 연결되고 상태 우선순위를 지킨다', () => {
  assert.match(clientSource, /refetch/);
  assert.match(clientSource, /data-testid="notifications-retry"/);
  assert.match(clientSource, /onClick=\{refetch\}/);
  assert.match(clientSource, /다시 시도/);
  assert.match(clientSource, /!loading && error && notifications\.length === 0/);
  assert.match(clientSource, /!loading && !error && notifications\.length === 0/);
  assert.match(clientSource, /loading && notifications\.length === 0/);
  assert.match(clientSource, /이전 목록을 표시합니다/);
  assert.doesNotMatch(clientSource, /location\.reload/);
});
