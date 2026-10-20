import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./useSaleRounds.ts', import.meta.url), 'utf8');
const sharedRequestSource = await readFile(
  new URL('../lib/shared-request.ts', import.meta.url),
  'utf8',
);
const sharedRequestCompiled = ts.transpileModule(sharedRequestSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'shared-request.ts',
}).outputText;
/** 호출할 때마다 공유 캐시가 비어 있는 shared-request 모듈을 새로 만든다(테스트끼리 섞이지 않게). */
function freshSharedRequestModule() {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', sharedRequestCompiled)(
    () => {
      throw new Error('shared-request는 다른 모듈을 쓰지 않는다');
    },
    module,
    module.exports,
  );
  return module.exports;
}
const testableSource = `${source.replace(
  "import { getApiBaseUrl } from '@/lib/api-base-url';",
  "const getApiBaseUrl = () => 'https://api.example.test';",
)}
export { createLoadingSaleRoundsState, createEmptySaleRoundsState, createErrorSaleRoundsState, hasRecoverableSaleRoundsData, createRefreshingSaleRoundsState, createStaleSaleRoundsState, resolveSaleRoundsRefreshStart, resolveSaleRoundsRefreshResult, fetchPublicSaleRoundsState, loadPublicSaleRoundsState, fetchPublicSaleRound };`;
const compiled = ts.transpileModule(testableSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'useSaleRounds.ts',
}).outputText;
const saleRoundsModule = { exports: {} };
const topLevelSharedRequest = freshSharedRequestModule();
const saleRoundsRequire = (specifier) => {
  if (specifier === 'react') {
    return {
      useCallback: (callback) => callback,
      useEffect: () => {},
      useRef: (initial) => ({ current: initial }),
      useState: (initial) => [initial, () => {}],
    };
  }
  if (specifier === '@/lib/shared-request') return topLevelSharedRequest;
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
  loadPublicSaleRoundsState,
  fetchPublicSaleRound,
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

/** 묶음 응답(`?include=items`)의 회차: 상품을 함께 싣는다. */
function withItems(rounds) {
  return rounds.map((item) => ({ ...item, items: [{ id: `${item.id}-item`, roundId: item.id }] }));
}

function isRoundsListUrl(url) {
  return String(url).includes('/sale-rounds/public?');
}

function successFetcherFor(rounds) {
  return async (input) => {
    if (isRoundsListUrl(input)) return jsonResponse({ items: withItems(rounds) });
    return jsonResponse({}, 404);
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
  const sharedRequestModule = freshSharedRequestModule();
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
    if (stateSlots[index] === undefined) {
      // React처럼 함수 초기값은 호출해 쓴다.
      stateSlots[index] = { value: typeof initial === 'function' ? initial() : initial };
    }
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
    if (specifier === '@/lib/shared-request') return sharedRequestModule;
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
  const unmount = () => {
    for (const slot of effectSlots) {
      if (typeof slot?.cleanup === 'function') slot.cleanup();
    }
  };
  return { get, settle, render, setStoreId, unmount };
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

test('1. initial success: 상품을 포함한 회차 묶음을 한 번만 조회해 현재 회차와 최신순 지난 회차를 제공한다', async () => {
  const open = round('round-open', 'OPEN', '2026-07-13T00:00:00.000Z');
  const closed = round('round-closed', 'CLOSED', '2026-07-06T00:00:00.000Z');
  const completed = round('round-completed', 'COMPLETED', '2026-06-29T00:00:00.000Z');
  const requests = [];

  const state = await fetchPublicSaleRoundsState('store-1', async (input) => {
    requests.push(String(input));
    return jsonResponse({ items: withItems([completed, open, closed]) });
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
  // 회차 수와 상관없이 요청은 한 번이고, 지난 회차는 화면 개수(2)+1개만 받는다.
  assert.deepEqual(requests, [
    'https://api.example.test/stores/store-1/sale-rounds/public?include=items&past=3',
  ]);
  assert.ok(hasRecoverableSaleRoundsData(state));
});

test('지난 회차는 최신 2개만 보여 주고, 마감 회차가 지금 회차가 되어도 지난 회차 2개가 남는다', async () => {
  const open = round('round-open', 'OPEN', '2026-07-13T00:00:00.000Z');
  const past = [
    round('past-1', 'CLOSED', '2026-07-06T00:00:00.000Z'),
    round('past-2', 'COMPLETED', '2026-06-29T00:00:00.000Z'),
    round('past-3', 'COMPLETED', '2026-06-22T00:00:00.000Z'),
  ];

  const withOpen = await fetchPublicSaleRoundsState('store-1', successFetcherFor([open, ...past]));
  assert.equal(withOpen.currentRound?.id, 'round-open');
  assert.deepEqual(
    withOpen.pastRounds.map((item) => item.id),
    ['past-1', 'past-2'],
  );

  const closedOnly = await fetchPublicSaleRoundsState('store-1', successFetcherFor(past));
  assert.equal(closedOnly.currentRound?.id, 'past-1');
  assert.deepEqual(
    closedOnly.pastRounds.map((item) => item.id),
    ['past-2', 'past-3'],
  );
});

test('같은 매장 회차 조회는 화면 사이에서 공유하고, 실패는 공유하지 않으며 fresh는 새로 보낸다', async () => {
  const open = round('round-open', 'OPEN', '2026-07-13T00:00:00.000Z');
  let calls = 0;
  let fail = true;
  globalThis.fetch = async (input) => {
    calls += 1;
    if (fail) return jsonResponse({}, 503);
    return successFetcherFor([open])(input);
  };

  const failed = await loadPublicSaleRoundsState('store-share');
  assert.equal(failed.status, 'error');
  fail = false;
  const first = await loadPublicSaleRoundsState('store-share');
  const second = await loadPublicSaleRoundsState('store-share');
  assert.equal(first.status, 'success');
  assert.equal(second, first);
  assert.equal(calls, 2, '실패 뒤 한 번 더 보내고, 성공은 공유한다');

  const fresh = await loadPublicSaleRoundsState('store-share', { fresh: true });
  assert.equal(fresh.status, 'success');
  assert.equal(calls, 3);
  await loadPublicSaleRoundsState('store-other');
  assert.equal(calls, 4, '다른 매장은 따로 보낸다');
});

test('목록 밖 회차 하나 조회: 같은 매장·같은 회차만 받고 실패는 null이다', async () => {
  const old = round('round-old', 'COMPLETED', '2026-05-01T00:00:00.000Z');
  const requests = [];
  const found = await fetchPublicSaleRound('store-1', 'round-old', async (input) => {
    requests.push(String(input));
    return jsonResponse({ ...old, items: [] });
  });
  assert.equal(found?.id, 'round-old');
  assert.deepEqual(requests, [
    'https://api.example.test/stores/store-1/sale-rounds/public/round-old',
  ]);

  const otherStore = round('round-old', 'COMPLETED', '2026-05-01T00:00:00.000Z', 'store-2');
  assert.equal(
    await fetchPublicSaleRound('store-1', 'round-old', async () =>
      jsonResponse({ ...otherStore, items: [] }),
    ),
    null,
  );
  assert.equal(
    await fetchPublicSaleRound('store-1', 'round-old', async () => jsonResponse({}, 404)),
    null,
  );
  assert.equal(
    await fetchPublicSaleRound('store-1', 'round-old', async () => {
      throw new Error('network');
    }),
    null,
  );
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

  // 상품이 빠진 회차가 섞이면 정상 결과로 보지 않는다.
  const open = round('round-open', 'OPEN', '2026-07-13T00:00:00.000Z');
  const malformedDetail = await fetchPublicSaleRoundsState('store-1', async () =>
    jsonResponse({ items: [open] }),
  );
  assert.equal(malformedDetail.status, 'error');
  assert.equal(malformedDetail.isEmpty, false);
});

test('판매 중 회차가 없으면 현재 시각 이후 가장 가까운 예정 회차를 선택한다', async () => {
  const now = new Date('2026-07-18T03:00:00.000Z');
  const pastScheduled = round('round-past', 'SCHEDULED', '2026-07-17T15:00:00.000Z');
  const nearest = round('round-nearest', 'SCHEDULED', '2026-07-19T15:00:00.000Z');
  const later = round('round-later', 'SCHEDULED', '2026-07-26T15:00:00.000Z');
  const rounds = [later, pastScheduled, nearest];

  const state = await fetchPublicSaleRoundsState('store-1', successFetcherFor(rounds), now);

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
    fetchImpl: async () => {
      listCalls += 1;
      if (listCalls === 1) return jsonResponse({ items: withItems([open]) });
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
    fetchImpl: async () => {
      listCalls += 1;
      if (listCalls === 1) return first.promise;
      return second.promise;
    },
  });
  await harness.settle(5);

  harness.setStoreId('store-b');
  await harness.settle(5);

  second.resolve(jsonResponse({ items: withItems([openB]) }));
  await harness.settle();
  assert.deepEqual(
    harness.get().rounds.map((item) => item.id),
    ['round-b'],
  );

  first.resolve(jsonResponse({ items: withItems([openA]) }));
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

  second.resolve(jsonResponse({ items: withItems([openB]) }));
  await harness.settle();

  first.resolve(jsonResponse({ items: withItems([openA]) }));
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

const { roundBoundaryRefetchDelay } = saleRoundsModule.exports;
const OPEN_AT = Date.parse('2026-11-01T01:00:00.000Z'); // 11월 1일 10:00 KST
const CLOSE_AT = Date.parse('2026-11-08T15:00:00.000Z'); // 11월 9일 00:00 KST
const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (millis) => new Date(millis).toISOString();
const noSpread = () => 0;

function windowRound(id, status, openAt = OPEN_AT, closeAt = CLOSE_AT) {
  const base = round(id, status, iso(openAt));
  return {
    ...base,
    schedule: { ...base.schedule, orderOpenAt: iso(openAt), orderCloseAt: iso(closeAt) },
  };
}

test('판매 예정 회차는 주문 시작 1초 뒤에 0~3초를 흩뿌려 다시 조회한다', () => {
  const rounds = [windowRound('r', 'SCHEDULED')];
  const now = OPEN_AT - 10_000;
  assert.equal(roundBoundaryRefetchDelay(rounds, now, now, noSpread), 11_000);
  assert.equal(
    roundBoundaryRefetchDelay(rounds, now, now, () => 0.5),
    12_500,
  );
  const latest = roundBoundaryRefetchDelay(rounds, now, now, () => 0.999999);
  assert.ok(latest >= 11_000 && latest < 14_000);
  // 기본 흩뿌림도 0~3초 안이다.
  for (let i = 0; i < 20; i += 1) {
    const delay = roundBoundaryRefetchDelay(rounds, now, now);
    assert.ok(delay >= 11_000 && delay < 14_000);
  }
});

test('판매 중 회차는 주문 마감을 기준으로 하고 시간으로 바뀌지 않는 회차는 예약하지 않는다', () => {
  const now = CLOSE_AT - 60_000;
  assert.equal(roundBoundaryRefetchDelay([windowRound('r', 'OPEN')], now, now, noSpread), 61_000);
  for (const status of ['CLOSED', 'COMPLETED', 'CANCELLED', 'DRAFT']) {
    assert.equal(roundBoundaryRefetchDelay([windowRound('r', status)], now, now, noSpread), null);
  }
  const broken = { ...windowRound('r', 'OPEN'), schedule: { orderOpenAt: 'x', orderCloseAt: 'x' } };
  assert.equal(roundBoundaryRefetchDelay([broken], now, now, noSpread), null);
  assert.equal(roundBoundaryRefetchDelay([], now, now, noSpread), null);
  assert.equal(roundBoundaryRefetchDelay([windowRound('r', 'OPEN')], Number.NaN, now), null);
});

test('24시간보다 먼 경계는 예약하지 않아 setTimeout 상한(약 24.8일)을 넘지 않는다', () => {
  const rounds = [windowRound('r', 'SCHEDULED')];
  const far = OPEN_AT - DAY_MS - 1;
  assert.equal(roundBoundaryRefetchDelay(rounds, far, far, noSpread), null);
  const withinDay = roundBoundaryRefetchDelay(
    rounds,
    OPEN_AT - DAY_MS,
    OPEN_AT - DAY_MS,
    () => 0.999999,
  );
  assert.ok(withinDay !== null && withinDay < 2 ** 31 - 1);
});

test('경계 전에 받은 정보는 경계가 지났으면 곧바로, 경계 뒤 정보가 아직 이전 상태면 1분 동안만 다시 확인한다', () => {
  const rounds = [windowRound('r', 'SCHEDULED')];
  // 숨은 탭·잠든 기기: 경계 전에 받은 정보는 경계가 한참 지나도 1초 뒤 다시 조회한다.
  assert.equal(
    roundBoundaryRefetchDelay(rounds, OPEN_AT + 3 * 3600_000, OPEN_AT - 1, noSpread),
    1000,
  );
  // 경계 뒤에 받았는데 아직 판매 예정(기기 시계가 서버보다 빠름): 5초 뒤 다시 확인, 1분이 지나면 멈춘다.
  assert.equal(roundBoundaryRefetchDelay(rounds, OPEN_AT + 2000, OPEN_AT + 1500, noSpread), 5000);
  assert.equal(
    roundBoundaryRefetchDelay(rounds, OPEN_AT + 60_000, OPEN_AT + 59_000, noSpread),
    null,
  );
});

test('여러 회차 중 가장 가까운 경계를 쓴다', () => {
  const now = OPEN_AT - 60_000;
  const rounds = [
    windowRound('later', 'SCHEDULED', OPEN_AT + 3600_000, CLOSE_AT + DAY_MS),
    windowRound('soon', 'SCHEDULED'),
    windowRound('past', 'COMPLETED'),
  ];
  assert.equal(roundBoundaryRefetchDelay(rounds, now, now, noSpread), 61_000);
});

function boundaryServer() {
  const server = { listCalls: 0 };
  const current = () => windowRound('round-open', Date.now() >= CLOSE_AT ? 'CLOSED' : 'OPEN');
  server.fetch = async (input) => {
    if (isRoundsListUrl(input)) {
      server.listCalls += 1;
      return jsonResponse({ items: [{ ...current(), items: [] }] });
    }
    return jsonResponse({}, 404);
  };
  return server;
}

test('hook: 주문 마감이 지나면 새로고침 없이 다시 조회해 마감 상태로 바꾸고 더 부르지 않는다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: CLOSE_AT - 10_000 });
  const server = boundaryServer();
  const harness = mountHook({ storeId: 'store-1', fetchImpl: server.fetch });
  await harness.settle();
  assert.equal(harness.get().currentRound?.status, 'OPEN');
  assert.equal(server.listCalls, 1);

  t.mock.timers.tick(10_000);
  await harness.settle();
  assert.equal(server.listCalls, 1, '경계 순간이 아니라 1초 뒤부터 부른다');

  t.mock.timers.tick(4_000);
  await harness.settle();
  assert.equal(server.listCalls, 2);
  assert.equal(harness.get().currentRound?.status, 'CLOSED');
  assert.equal(harness.get().status, 'success');

  t.mock.timers.tick(10 * 60_000);
  await harness.settle();
  assert.equal(server.listCalls, 2);
  harness.unmount();
});

test('hook: 화면을 떠나면 경계 다시 조회 예약을 지운다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: CLOSE_AT - 10_000 });
  const server = boundaryServer();
  const harness = mountHook({ storeId: 'store-1', fetchImpl: server.fetch });
  await harness.settle();
  harness.unmount();

  t.mock.timers.tick(60_000);
  await harness.settle();
  assert.equal(server.listCalls, 1);
});

test('hook: 숨은 탭은 경계 순간에 부르지 않고 화면에 돌아오면 바로 다시 조회한다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: CLOSE_AT - 10_000 });
  const listeners = new Set();
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: (type, listener) => type === 'visibilitychange' && listeners.add(listener),
    removeEventListener: (type, listener) => listeners.delete(listener),
  };
  t.after(() => {
    delete globalThis.document;
  });
  const server = boundaryServer();
  const harness = mountHook({ storeId: 'store-1', fetchImpl: server.fetch });
  await harness.settle();
  assert.equal(listeners.size, 1);

  globalThis.document.visibilityState = 'hidden';
  t.mock.timers.tick(20_000);
  await harness.settle();
  assert.equal(server.listCalls, 1);

  globalThis.document.visibilityState = 'visible';
  for (const listener of listeners) listener();
  await harness.settle();
  t.mock.timers.tick(4_000);
  await harness.settle();
  assert.equal(server.listCalls, 2);
  assert.equal(harness.get().currentRound?.status, 'CLOSED');

  harness.unmount();
  assert.equal(listeners.size, 0);
});
