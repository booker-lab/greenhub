import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./useSaleRounds.ts', import.meta.url), 'utf8');
const testableSource = `${source.replace(
  "import { getApiBaseUrl } from '@/lib/api-base-url';",
  "const getApiBaseUrl = () => 'https://api.example.test';",
)}
export { createLoadingSaleRoundsState, createEmptySaleRoundsState, createErrorSaleRoundsState, hasRecoverableSaleRoundsData, createRefreshingSaleRoundsState, createStaleSaleRoundsState, resolveSaleRoundsRefreshStart, resolveSaleRoundsRefreshResult, fetchPublicSaleRoundsState };`;
const compiled = ts.transpileModule(testableSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'useSaleRounds.ts',
}).outputText;
const saleRoundsModule = { exports: {} };
const saleRoundsRequire = (specifier) => {
  if (specifier === 'react') {
    return {
      useCallback: (callback) => callback,
      useEffect: () => {},
      useRef: (initial) => ({ current: initial }),
      useState: (initial) => [initial, () => {}],
    };
  }
  throw new Error(`예상하지 못한 회차 모듈 요청: ${specifier}`);
};
new Function('require', 'module', 'exports', compiled)(
  saleRoundsRequire,
  saleRoundsModule,
  saleRoundsModule.exports,
);

const {
  createLoadingSaleRoundsState,
  hasRecoverableSaleRoundsData,
  createStaleSaleRoundsState,
  resolveSaleRoundsRefreshStart,
  resolveSaleRoundsRefreshResult,
  fetchPublicSaleRoundsState,
} = saleRoundsModule.exports;

const originalFetch = globalThis.fetch;
test.after(() => {
  globalThis.fetch = originalFetch;
});

function round(id, status, orderOpenAt, storeId = 'store-1') {
  return {
    id,
    storeId,
    name: id,
    status,
    closeReason: null,
    cancellation: null,
    schedule: {
      orderOpenAt,
      orderCloseAt: orderOpenAt,
      auctionAt: orderOpenAt,
      deliveryStartAt: orderOpenAt,
      deliveryEndAt: orderOpenAt,
      timezone: 'Asia/Seoul',
    },
    deliveryRegion: {
      id: 'icheon',
      label: '이천시',
      province: '경기도',
      city: '이천시',
      enabled: true,
    },
    limits: {
      maxDeliveryAddresses: 15,
      maxItemQuantity: 30,
    },
    counters: {
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 0,
      orderedItemQuantity: 0,
      heldOrderCount: 0,
    },
    carrotLandingUrl: null,
    cancelledAt: null,
    completedAt: null,
    createdAt: orderOpenAt,
    updatedAt: orderOpenAt,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function successFetcherFor(rounds) {
  return async (input) => {
    const url = String(input);
    if (url.endsWith('/public')) {
      return jsonResponse({ items: rounds });
    }
    const id = url.split('/').at(-1);
    const selected = rounds.find((item) => item.id === id);
    return jsonResponse({ ...selected, items: [{ id: `${id}-item`, roundId: id }] });
  };
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

function mountHook({ storeId = 'store-1', fetchImpl }) {
  globalThis.fetch = fetchImpl;
  let currentStoreId = storeId;
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
    if (specifier === '@/lib/api-base-url') {
      return { getApiBaseUrl: () => 'https://api.example.test' };
    }
    throw new Error(`예상하지 못한 회차 모듈 요청: ${specifier}`);
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
    latest = hookModule.exports.useSaleRounds(currentStoreId);
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
  const setStoreId = (next) => {
    currentStoreId = next;
    scheduleRender();
  };
  return { get, settle, render, setStoreId };
}

test('초기 상태는 회차 데이터 없이 loading이다', () => {
  assert.deepEqual(createLoadingSaleRoundsState(), {
    rounds: [],
    currentRound: null,
    pastRounds: [],
    status: 'loading',
    loading: true,
    error: null,
    isEmpty: false,
    isRefreshing: false,
    isStale: false,
  });
});

test('1. initial success: 목록과 상세를 조회해 현재 회차와 최신순 지난 회차를 제공한다', async () => {
  const open = round('round-open', 'OPEN', '2026-07-13T00:00:00.000Z');
  const closed = round('round-closed', 'CLOSED', '2026-07-06T00:00:00.000Z');
  const completed = round('round-completed', 'COMPLETED', '2026-06-29T00:00:00.000Z');
  const requests = [];

  const state = await fetchPublicSaleRoundsState('store-1', async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith('/public')) {
      return jsonResponse({ items: [completed, open, closed] });
    }
    const id = url.split('/').at(-1);
    const selected = [open, closed, completed].find((item) => item.id === id);
    return jsonResponse({ ...selected, items: [{ id: `${id}-item`, roundId: id }] });
  });

  assert.equal(state.status, 'success');
  assert.equal(state.loading, false);
  assert.equal(state.isEmpty, false);
  assert.equal(state.error, null);
  assert.equal(state.isRefreshing, false);
  assert.equal(state.isStale, false);
  assert.equal(state.currentRound?.id, 'round-open');
  assert.deepEqual(
    state.pastRounds.map((item) => item.id),
    ['round-closed', 'round-completed'],
  );
  assert.deepEqual(
    state.rounds.map((item) => item.id),
    ['round-open', 'round-closed', 'round-completed'],
  );
  assert.equal(state.currentRound?.items[0]?.id, 'round-open-item');
  assert.equal(requests.length, 4);
  assert.ok(hasRecoverableSaleRoundsData(state));
});

test('2. authoritative empty: 공개 회차가 없으면 empty 상태를 제공한다', async () => {
  const state = await fetchPublicSaleRoundsState('store-1', async () =>
    jsonResponse({ items: [] }),
  );

  assert.equal(state.status, 'empty');
  assert.equal(state.loading, false);
  assert.equal(state.isEmpty, true);
  assert.equal(state.error, null);
  assert.equal(state.isRefreshing, false);
  assert.equal(state.isStale, false);
  assert.deepEqual(state.rounds, []);
  assert.equal(state.currentRound, null);
  assert.deepEqual(state.pastRounds, []);
  assert.equal(hasRecoverableSaleRoundsData(state), false);
});

test('3. initial failure != empty: 공개 API 실패는 error를 제공하고 empty로 위장하지 않는다', async () => {
  const state = await fetchPublicSaleRoundsState('store-1', async () =>
    jsonResponse({ message: '일시적인 장애' }, 503),
  );

  assert.equal(state.status, 'error');
  assert.equal(state.loading, false);
  assert.equal(state.isEmpty, false);
  assert.equal(state.isRefreshing, false);
  assert.equal(state.isStale, false);
  assert.equal(state.error, '회차 조회 오류: 503');
  assert.deepEqual(state.rounds, []);
  assert.equal(hasRecoverableSaleRoundsData(state), false);
});

test('malformed 응답은 정상 empty로 바꾸지 않고 error를 유지한다', async () => {
  const malformedList = await fetchPublicSaleRoundsState('store-1', async () =>
    jsonResponse({ items: 'not-an-array' }),
  );
  assert.equal(malformedList.status, 'error');
  assert.equal(malformedList.isEmpty, false);
  assert.match(malformedList.error ?? '', /형식/);

  const open = round('round-open', 'OPEN', '2026-07-13T00:00:00.000Z');
  const malformedDetail = await fetchPublicSaleRoundsState('store-1', async (input) => {
    const url = String(input);
    if (url.endsWith('/public')) return jsonResponse({ items: [open] });
    return jsonResponse({ unexpected: true });
  });
  assert.equal(malformedDetail.status, 'error');
  assert.equal(malformedDetail.isEmpty, false);
});

test('판매 중 회차가 없으면 현재 시각 이후 가장 가까운 예정 회차를 선택한다', async () => {
  const now = new Date('2026-07-18T03:00:00.000Z');
  const pastScheduled = round('round-past', 'SCHEDULED', '2026-07-17T15:00:00.000Z');
  const nearest = round('round-nearest', 'SCHEDULED', '2026-07-19T15:00:00.000Z');
  const later = round('round-later', 'SCHEDULED', '2026-07-26T15:00:00.000Z');
  const rounds = [later, pastScheduled, nearest];

  const state = await fetchPublicSaleRoundsState(
    'store-1',
    async (input) => {
      const url = String(input);
      if (url.endsWith('/public')) {
        return jsonResponse({ items: rounds });
      }
      const id = url.split('/').at(-1);
      const selected = rounds.find((item) => item.id === id);
      return jsonResponse({ ...selected, items: [{ id: `${id}-item`, roundId: id }] });
    },
    now,
  );

  assert.equal(state.status, 'success');
  assert.equal(state.currentRound?.id, 'round-nearest');
});

test('4. success → refresh start는 이전 데이터를 유지하고 refreshing을 표현한다', async () => {
  const open = round('round-open', 'OPEN', '2026-07-13T00:00:00.000Z');
  const previous = await fetchPublicSaleRoundsState('store-1', successFetcherFor([open]));
  assert.equal(previous.status, 'success');

  const started = resolveSaleRoundsRefreshStart(previous);
  assert.equal(started.status, 'refreshing');
  assert.equal(started.isRefreshing, true);
  assert.equal(started.isStale, false);
  assert.equal(started.loading, false);
  assert.equal(started.isEmpty, false);
  assert.equal(started.error, null);
  assert.deepEqual(
    started.rounds.map((item) => item.id),
    ['round-open'],
  );
  assert.equal(started.currentRound?.id, 'round-open');

  const emptyPrevious = await fetchPublicSaleRoundsState('store-1', async () =>
    jsonResponse({ items: [] }),
  );
  assert.deepEqual(resolveSaleRoundsRefreshStart(emptyPrevious), createLoadingSaleRoundsState());

  const failurePrevious = await fetchPublicSaleRoundsState('store-1', async () =>
    jsonResponse({}, 500),
  );
  assert.deepEqual(resolveSaleRoundsRefreshStart(failurePrevious), createLoadingSaleRoundsState());
});

test('5. success → refresh failure는 이전 결과를 보존하고 stale/error를 노출한다', async () => {
  const open = round('round-open', 'OPEN', '2026-07-13T00:00:00.000Z');
  const previous = await fetchPublicSaleRoundsState('store-1', successFetcherFor([open]));
  const failed = await fetchPublicSaleRoundsState('store-1', async () =>
    jsonResponse({}, 503),
  );
  assert.equal(failed.status, 'error');

  const stale = resolveSaleRoundsRefreshResult(previous, failed);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.isStale, true);
  assert.equal(stale.isRefreshing, false);
  assert.equal(stale.loading, false);
  assert.equal(stale.isEmpty, false);
  assert.notEqual(stale.error, null);
  assert.deepEqual(
    stale.rounds.map((item) => item.id),
    ['round-open'],
  );
  assert.equal(stale.currentRound?.id, 'round-open');

  const withoutPrevious = await fetchPublicSaleRoundsState('store-1', async () =>
    jsonResponse({ items: [] }),
  );
  const initialFailure = resolveSaleRoundsRefreshResult(withoutPrevious, failed);
  assert.equal(initialFailure.status, 'error');
  assert.equal(initialFailure.isStale, false);
  assert.deepEqual(initialFailure.rounds, []);
});

test('6. success → refresh success는 최신 결과로 교체하고 stale을 해제한다', async () => {
  const open = round('round-open', 'OPEN', '2026-07-13T00:00:00.000Z');
  const previous = await fetchPublicSaleRoundsState('store-1', successFetcherFor([open]));
  const stale = createStaleSaleRoundsState(previous, new Error('회차 조회 오류: 503'));
  assert.equal(stale.isStale, true);

  const nextOpen = round('round-next', 'OPEN', '2026-07-20T00:00:00.000Z');
  const next = await fetchPublicSaleRoundsState('store-1', successFetcherFor([nextOpen]));
  const replaced = resolveSaleRoundsRefreshResult(stale, next);
  assert.equal(replaced.status, 'success');
  assert.equal(replaced.isStale, false);
  assert.equal(replaced.isRefreshing, false);
  assert.equal(replaced.error, null);
  assert.deepEqual(
    replaced.rounds.map((item) => item.id),
    ['round-next'],
  );
});

test('7. success → refresh authoritative empty는 이전 데이터를 제거한다', async () => {
  const open = round('round-open', 'OPEN', '2026-07-13T00:00:00.000Z');
  const previous = await fetchPublicSaleRoundsState('store-1', successFetcherFor([open]));
  const emptied = await fetchPublicSaleRoundsState('store-1', async () =>
    jsonResponse({ items: [] }),
  );
  const resolved = resolveSaleRoundsRefreshResult(previous, emptied);
  assert.equal(resolved.status, 'empty');
  assert.equal(resolved.isEmpty, true);
  assert.equal(resolved.isStale, false);
  assert.deepEqual(resolved.rounds, []);
  assert.equal(resolved.currentRound, null);
});

test('hook: success → refetch 시작은 데이터를 유지하고 refreshing을 노출한다', async () => {
  const open = round('round-open', 'OPEN', '2026-07-13T00:00:00.000Z');
  const gate = deferred();
  let listCalls = 0;
  const harness = mountHook({
    storeId: 'store-1',
    fetchImpl: async (input) => {
      const url = String(input);
      if (!url.endsWith('/public')) {
        return jsonResponse({ ...open, items: [{ id: 'round-open-item', roundId: 'round-open' }] });
      }
      listCalls += 1;
      if (listCalls === 1) return jsonResponse({ items: [open] });
      return gate.promise;
    },
  });
  await harness.settle();
  assert.equal(harness.get().status, 'success');
  assert.deepEqual(
    harness.get().rounds.map((item) => item.id),
    ['round-open'],
  );

  harness.get().refetch();
  await harness.settle(5);
  assert.equal(harness.get().status, 'refreshing');
  assert.equal(harness.get().isRefreshing, true);
  assert.equal(harness.get().loading, false);
  assert.deepEqual(
    harness.get().rounds.map((item) => item.id),
    ['round-open'],
  );

  gate.resolve(jsonResponse({ items: [] }));
  await harness.settle();
  assert.equal(harness.get().status, 'empty');
  assert.deepEqual(harness.get().rounds, []);
});

test('hook: success → refresh failure는 stale 데이터를 유지하고 retry를 노출한다', async () => {
  const open = round('round-open', 'OPEN', '2026-07-13T00:00:00.000Z');
  let mode = 'success';
  const harness = mountHook({
    storeId: 'store-1',
    fetchImpl: async (input) => {
      if (mode === 'success') return successFetcherFor([open])(input);
      return jsonResponse({}, 503);
    },
  });
  await harness.settle();
  assert.equal(harness.get().status, 'success');

  mode = 'failure';
  harness.get().refetch();
  await harness.settle();

  assert.equal(harness.get().status, 'stale');
  assert.equal(harness.get().isStale, true);
  assert.equal(harness.get().isEmpty, false);
  assert.notEqual(harness.get().error, null);
  assert.deepEqual(
    harness.get().rounds.map((item) => item.id),
    ['round-open'],
  );
  assert.equal(typeof harness.get().refetch, 'function');
});

test('hook: success → refresh success는 데이터를 교체한다', async () => {
  const open = round('round-open', 'OPEN', '2026-07-13T00:00:00.000Z');
  const next = round('round-next', 'OPEN', '2026-07-20T00:00:00.000Z');
  let current = [open];
  const harness = mountHook({
    storeId: 'store-1',
    fetchImpl: async (input) => successFetcherFor(current)(input),
  });
  await harness.settle();
  assert.deepEqual(
    harness.get().rounds.map((item) => item.id),
    ['round-open'],
  );

  current = [next];
  harness.get().refetch();
  await harness.settle();

  assert.equal(harness.get().status, 'success');
  assert.equal(harness.get().isStale, false);
  assert.equal(harness.get().error, null);
  assert.deepEqual(
    harness.get().rounds.map((item) => item.id),
    ['round-next'],
  );
});

test('8. hook: storeId scope 변경은 이전 store 회차를 stale로 유지하지 않는다', async () => {
  const openA = round('round-a', 'OPEN', '2026-07-13T00:00:00.000Z', 'store-a');
  const openB = round('round-b', 'OPEN', '2026-07-13T00:00:00.000Z', 'store-b');
  const harness = mountHook({
    storeId: 'store-a',
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes('/stores/store-a/')) return successFetcherFor([openA])(input);
      if (url.includes('/stores/store-b/')) return successFetcherFor([openB])(input);
      return jsonResponse({}, 404);
    },
  });
  await harness.settle();
  assert.deepEqual(
    harness.get().rounds.map((item) => item.id),
    ['round-a'],
  );

  harness.setStoreId('store-b');
  await harness.settle();

  assert.deepEqual(
    harness.get().rounds.map((item) => item.id),
    ['round-b'],
  );
  assert.equal(harness.get().status, 'success');
  assert.equal(harness.get().isStale, false);
});

test('hook: scope 변경 후 실패는 이전 scope 데이터를 노출하지 않는다', async () => {
  const openA = round('round-a', 'OPEN', '2026-07-13T00:00:00.000Z', 'store-a');
  const harness = mountHook({
    storeId: 'store-a',
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes('/stores/store-a/')) return successFetcherFor([openA])(input);
      return jsonResponse({}, 500);
    },
  });
  await harness.settle();
  assert.deepEqual(
    harness.get().rounds.map((item) => item.id),
    ['round-a'],
  );

  harness.setStoreId('store-b');
  await harness.settle();

  assert.equal(harness.get().status, 'error');
  assert.equal(harness.get().isStale, false);
  assert.deepEqual(harness.get().rounds, []);
  assert.notEqual(harness.get().error, null);
});

test('9. hook: 늦은 이전 요청은 새 scope/newer refresh를 덮지 않는다', async () => {
  const openA = round('round-a', 'OPEN', '2026-07-13T00:00:00.000Z', 'store-a');
  const openB = round('round-b', 'OPEN', '2026-07-13T00:00:00.000Z', 'store-b');
  const first = deferred();
  const second = deferred();
  let listCalls = 0;
  const harness = mountHook({
    storeId: 'store-a',
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith('/public')) {
        listCalls += 1;
        if (listCalls === 1) return first.promise;
        return second.promise;
      }
      const id = url.split('/').at(-1);
      const selected = [openA, openB].find((item) => item.id === id);
      return jsonResponse({ ...selected, items: [{ id: `${id}-item`, roundId: id }] });
    },
  });
  await harness.settle(5);

  harness.setStoreId('store-b');
  await harness.settle(5);

  second.resolve(jsonResponse({ items: [openB] }));
  await harness.settle();
  assert.deepEqual(
    harness.get().rounds.map((item) => item.id),
    ['round-b'],
  );

  first.resolve(jsonResponse({ items: [openA] }));
  await harness.settle();

  assert.deepEqual(
    harness.get().rounds.map((item) => item.id),
    ['round-b'],
  );
  assert.equal(harness.get().isStale, false);
});

test('hook: stale refetch 응답은 더 최신 refetch 결과를 덮지 않는다', async () => {
  const openA = round('round-a', 'OPEN', '2026-07-13T00:00:00.000Z');
  const openB = round('round-b', 'OPEN', '2026-07-20T00:00:00.000Z');
  const first = deferred();
  const second = deferred();
  let n = 0;
  const harness = mountHook({
    storeId: 'store-1',
    fetchImpl: async (input) => {
      const url = String(input);
      if (!url.endsWith('/public')) {
        const id = url.split('/').at(-1);
        const selected = [openA, openB].find((item) => item.id === id);
        return jsonResponse({ ...selected, items: [{ id: `${id}-item`, roundId: id }] });
      }
      n += 1;
      if (n === 1) return successFetcherFor([openA])(input);
      if (n === 2) return first.promise;
      return second.promise;
    },
  });
  await harness.settle();
  assert.deepEqual(
    harness.get().rounds.map((item) => item.id),
    ['round-a'],
  );

  harness.get().refetch();
  await harness.settle(5);
  harness.get().refetch();
  await harness.settle(5);

  second.resolve(jsonResponse({ items: [openB] }));
  await harness.settle();
  // detail fetch는 즉시 성공하므로 최종은 round-b가 된다.
  // (상세 fetch가 목록 resolve 이후 실행되기 때문에 settle로 모두 확정한다.)
  await harness.settle();

  first.resolve(jsonResponse({ items: [openA] }));
  await harness.settle();

  assert.deepEqual(
    harness.get().rounds.map((item) => item.id),
    ['round-b'],
  );
});

test('hook 소스는 request race 보호와 scope 격리를 유지한다', () => {
  assert.match(source, /requestId/);
  assert.match(source, /requestId\.current !== currentRequestId|requestId\.current === currentRequestId/);
  assert.match(source, /scopeRef/);
  assert.match(source, /hasRecoverableSaleRoundsData/);
  assert.match(source, /createRefreshingSaleRoundsState/);
  assert.match(source, /createStaleSaleRoundsState/);
});
