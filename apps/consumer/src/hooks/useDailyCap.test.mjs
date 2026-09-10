import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./useDailyCap.ts', import.meta.url), 'utf8');
const pickerSource = await readFile(
  new URL('../app/products/[id]/_components/DeliveryDatePicker.tsx', import.meta.url),
  'utf8',
);

test('useDailyCap의 기본 daily cap key는 KST business date를 사용한다', () => {
  assert.match(source, /import \{ todayKST \} from '@greenhub\/shared'/);
  assert.match(source, /date \?\? todayKST\(\)/);
  assert.doesNotMatch(source, /toISOString\(\)\.split\('T'\)/);
});

// ---------------------------------------------------------------------------
// CONSUMER-DELIVERY-SLOTS-READ-RECOVERY-01 focused regression.
// Firebase 실제 연결 없이 transpiled hook + mocked onSnapshot으로 검증한다.
// ---------------------------------------------------------------------------

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'useDailyCap.ts',
}).outputText;

function createFirestoreMock() {
  const subscriptions = [];
  const firestore = {
    collection: (db, name) => ({ __kind: 'collection', name }),
    doc: (db, col, id) => ({ __kind: 'doc', col, id }),
    query: (colRef, ...conds) => ({ __kind: 'query', colRef, conds }),
    where: (field, op, value) => ({ field, op, value }),
    onSnapshot: (target, onNext, onError) => {
      const sub = { target, onNext, onError, unsubscribed: false };
      subscriptions.push(sub);
      return () => {
        sub.unsubscribed = true;
      };
    },
  };
  return { firestore, subscriptions };
}

function mountHook({ hookName, initialProps, firestore, subscriptions }) {
  let props = { ...initialProps };
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
    if (specifier === 'firebase/firestore') return firestore;
    if (specifier === '@/lib/firebase') return { db: {} };
    if (specifier === '@greenhub/shared') return { todayKST: () => '2026-09-10' };
    throw new Error(`예상하지 못한 daily-cap 모듈 요청: ${specifier}`);
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
    latest = hookModule.exports[hookName](...Object.values(props));
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
  const setProps = (next) => {
    props = { ...props, ...next };
    scheduleRender();
  };
  return { get, settle, render, setProps, subscriptions };
}

function mountDeliverySlots(overrides = {}) {
  const { firestore, subscriptions } = createFirestoreMock();
  const harness = mountHook({
    hookName: 'useDeliverySlots',
    initialProps: { storeId: 'store-1', from: '2026-09-01', to: '2026-10-31', ...overrides },
    firestore,
    subscriptions,
  });
  return { ...harness, subscriptions };
}

function mountDailyCap(overrides = {}) {
  const { firestore, subscriptions } = createFirestoreMock();
  const harness = mountHook({
    hookName: 'useDailyCap',
    initialProps: { storeId: 'store-1', date: '2026-09-10', ...overrides },
    firestore,
    subscriptions,
  });
  return { ...harness, subscriptions };
}

function querySnap(entries) {
  return { docs: entries.map((data) => ({ data: () => data })) };
}

function docSnap(data) {
  if (data === null) return { exists: () => false };
  return { exists: () => true, data: () => data };
}

function loadPureHelpers() {
  const helperModule = { exports: {} };
  const helperRequire = (specifier) => {
    if (specifier === 'react') {
      return {
        useCallback: (fn) => fn,
        useEffect: () => {},
        useRef: (v) => ({ current: v }),
        useState: (v) => [v, () => {}],
      };
    }
    if (specifier === 'firebase/firestore') {
      return {
        collection: () => ({}),
        doc: () => ({}),
        onSnapshot: () => () => {},
        query: () => ({}),
        where: () => ({}),
      };
    }
    if (specifier === '@/lib/firebase') return { db: {} };
    if (specifier === '@greenhub/shared') return { todayKST: () => '2026-09-10' };
    throw new Error(`예상하지 못한 helper 모듈 요청: ${specifier}`);
  };
  new Function('require', 'module', 'exports', compiled)(
    helperRequire,
    helperModule,
    helperModule.exports,
  );
  return helperModule.exports;
}

const { buildDeliverySlotsMap, isDeliveryDateSelectable, computeRemainingSlots } =
  loadPureHelpers();

test('initial successful slots는 map을 적재하고 error/stale을 비운다', async () => {
  const h = mountDeliverySlots();
  await h.settle();
  assert.equal(h.subscriptions.length, 1);

  h.subscriptions[0].onNext(
    querySnap([
      { storeId: 'store-1', date: '2026-09-12', totalCap: 10, usedSlots: 3 },
      { storeId: 'store-1', date: '2026-09-13', totalCap: 5 },
    ]),
  );
  await h.settle();

  const s = h.get();
  assert.equal(s.loading, false);
  assert.equal(s.refreshing, false);
  assert.equal(s.error, null);
  assert.equal(s.isStale, false);
  assert.equal(s.hasLoaded, true);
  assert.equal(s.slots['2026-09-12'].remainingSlots, 7);
  // usedSlots 누락은 ?? 0으로 처리한다.
  assert.equal(s.slots['2026-09-13'].usedSlots, 0);
  assert.equal(s.slots['2026-09-13'].remainingSlots, 5);
});

test('successful empty(문서 0개)는 error 없이 {} 성공으로 확정한다', async () => {
  const h = mountDeliverySlots();
  await h.settle();
  h.subscriptions[0].onNext(querySnap([]));
  await h.settle();

  const s = h.get();
  assert.deepEqual(s.slots, {});
  assert.equal(s.error, null);
  assert.equal(s.isStale, false);
  assert.equal(s.hasLoaded, true);
  assert.equal(s.loading, false);
});

test('initial listener failure는 빈 성공으로 위장하지 않는다', async () => {
  const h = mountDeliverySlots();
  await h.settle();
  h.subscriptions[0].onError(new Error('permission-denied'));
  await h.settle();

  const s = h.get();
  assert.match(s.error ?? '', /permission-denied/);
  assert.deepEqual(s.slots, {});
  assert.equal(s.hasLoaded, false);
  assert.equal(s.isStale, false);
  assert.equal(s.loading, false);
  assert.equal(typeof s.retry, 'function');
});

test('successful snapshot 이후 fatal failure는 데이터를 보존하고 stale로 표시한다', async () => {
  const h = mountDeliverySlots();
  await h.settle();
  h.subscriptions[0].onNext(
    querySnap([{ storeId: 'store-1', date: '2026-09-12', totalCap: 10, usedSlots: 2 }]),
  );
  await h.settle();
  assert.equal(h.get().slots['2026-09-12'].remainingSlots, 8);

  h.subscriptions[0].onError(new Error('unavailable'));
  await h.settle();

  const s = h.get();
  assert.match(s.error ?? '', /unavailable/);
  assert.equal(s.isStale, true);
  assert.equal(s.hasLoaded, true);
  assert.equal(s.loading, false);
  // 이전 slots는 정보 표시용으로 보존된다.
  assert.equal(s.slots['2026-09-12'].remainingSlots, 8);
});

test('stale 상태에서는 이전 remainingSlots 값만 믿고 새 선택을 허용하지 않는다', async () => {
  const h = mountDeliverySlots();
  await h.settle();
  h.subscriptions[0].onNext(
    querySnap([{ storeId: 'store-1', date: '2026-09-12', totalCap: 10, usedSlots: 2 }]),
  );
  await h.settle();
  h.subscriptions[0].onError(new Error('unavailable'));
  await h.settle();

  const s = h.get();
  assert.equal(s.isStale, true);
  const readBlocked = s.error !== null || s.isStale || s.loading || s.refreshing;
  assert.equal(readBlocked, true);
  assert.equal(
    isDeliveryDateSelectable('2026-09-12', '2026-09-10', s.slots['2026-09-12'], readBlocked),
    false,
  );
  // 동일 슬롯이라도 fresh 상태에서는 선택 가능하다.
  assert.equal(
    isDeliveryDateSelectable('2026-09-12', '2026-09-10', s.slots['2026-09-12'], false),
    true,
  );
});

test('retry는 동일 scope로 새로운 subscription을 실제 생성한다 (가짜 retry 금지)', async () => {
  const h = mountDeliverySlots();
  await h.settle();
  assert.equal(h.subscriptions.length, 1);
  h.subscriptions[0].onError(new Error('unavailable'));
  await h.settle();
  assert.equal(h.subscriptions.length, 1);

  h.get().retry();
  await h.settle();

  assert.equal(h.subscriptions.length, 2);
  assert.equal(h.subscriptions[0].unsubscribed, true);
  assert.equal(h.get().refreshing, true);
});

test('retry 후 snapshot 성공은 slots를 최신화하고 error/stale을 해제한다', async () => {
  const h = mountDeliverySlots();
  await h.settle();
  h.subscriptions[0].onNext(
    querySnap([{ storeId: 'store-1', date: '2026-09-12', totalCap: 10, usedSlots: 2 }]),
  );
  await h.settle();
  h.subscriptions[0].onError(new Error('unavailable'));
  await h.settle();
  assert.equal(h.get().isStale, true);

  h.get().retry();
  await h.settle();
  assert.equal(h.subscriptions.length, 2);

  h.subscriptions[1].onNext(
    querySnap([{ storeId: 'store-1', date: '2026-09-12', totalCap: 10, usedSlots: 9 }]),
  );
  await h.settle();

  const s = h.get();
  assert.equal(s.slots['2026-09-12'].remainingSlots, 1);
  assert.equal(s.error, null);
  assert.equal(s.isStale, false);
  assert.equal(s.refreshing, false);
  assert.equal(s.hasLoaded, true);
  assert.equal(
    isDeliveryDateSelectable('2026-09-12', '2026-09-10', s.slots['2026-09-12'], false),
    true,
  );
});

test('store/range scope 변경은 이전 scope slots를 재사용하지 않는다', async () => {
  const h = mountDeliverySlots({ storeId: 'store-A' });
  await h.settle();
  h.subscriptions[0].onNext(
    querySnap([{ storeId: 'store-A', date: '2026-09-12', totalCap: 10, usedSlots: 1 }]),
  );
  await h.settle();
  assert.equal(h.get().slots['2026-09-12'].remainingSlots, 9);

  h.setProps({ storeId: 'store-B' });
  await h.settle();

  // 새 구독이 생성되고 이전 데이터는 즉시 무효화된다.
  assert.equal(h.subscriptions.length, 2);
  assert.deepEqual(h.get().slots, {});
  assert.equal(h.get().hasLoaded, false);
  assert.equal(h.get().error, null);
  assert.equal(h.get().isStale, false);
  assert.equal(h.get().loading, true);

  h.subscriptions[1].onNext(
    querySnap([{ storeId: 'store-B', date: '2026-09-12', totalCap: 4, usedSlots: 4 }]),
  );
  await h.settle();
  assert.equal(h.get().slots['2026-09-12'].remainingSlots, 0);
  assert.equal(h.get().hasLoaded, true);
});

test('range(from/to) 변경도 이전 slots를 재사용하지 않는다', async () => {
  const h = mountDeliverySlots({ from: '2026-09-01', to: '2026-09-30' });
  await h.settle();
  h.subscriptions[0].onNext(
    querySnap([{ storeId: 'store-1', date: '2026-09-12', totalCap: 10, usedSlots: 0 }]),
  );
  await h.settle();
  assert.equal(h.get().hasLoaded, true);

  h.setProps({ from: '2026-10-01', to: '2026-10-31' });
  await h.settle();

  assert.equal(h.subscriptions.length, 2);
  assert.deepEqual(h.get().slots, {});
  assert.equal(h.get().hasLoaded, false);
});

test('useDailyCap 단일 조회도 동일 recovery primitive를 제공한다', async () => {
  const h = mountDailyCap();
  await h.settle();
  assert.equal(h.subscriptions.length, 1);

  // 성공
  h.subscriptions[0].onNext(docSnap({ id: 'store-1_2026-09-10', storeId: 'store-1', date: '2026-09-10', totalCap: 10, usedSlots: 4 }));
  await h.settle();
  assert.equal(h.get().dailyCap.totalCap, 10);
  assert.equal(h.get().remainingSlots, 6);
  assert.equal(h.get().hasLoaded, true);
  assert.equal(h.get().isStale, false);
  assert.equal(h.get().error, null);

  // 성공 이후 실패는 stale + 보존
  h.subscriptions[0].onError(new Error('unavailable'));
  await h.settle();
  assert.equal(h.get().dailyCap.totalCap, 10);
  assert.equal(h.get().isStale, true);
  assert.notEqual(h.get().error, null);

  // retry는 새 subscription을 생성한다
  h.get().retry();
  await h.settle();
  assert.equal(h.subscriptions.length, 2);

  // retry 성공은 복구한다
  h.subscriptions[1].onNext(docSnap({ id: 'store-1_2026-09-10', storeId: 'store-1', date: '2026-09-10', totalCap: 10, usedSlots: 1 }));
  await h.settle();
  assert.equal(h.get().remainingSlots, 9);
  assert.equal(h.get().error, null);
  assert.equal(h.get().isStale, false);
});

test('useDailyCap 최초 실패는 문서 없음(empty)과 구분된다', async () => {
  const emptyHarness = mountDailyCap();
  await emptyHarness.settle();
  emptyHarness.subscriptions[0].onNext(docSnap(null));
  await emptyHarness.settle();
  assert.equal(emptyHarness.get().dailyCap, null);
  assert.equal(emptyHarness.get().error, null);
  assert.equal(emptyHarness.get().hasLoaded, true);
  assert.equal(emptyHarness.get().isStale, false);

  const failedHarness = mountDailyCap();
  await failedHarness.settle();
  failedHarness.subscriptions[0].onError(new Error('permission-denied'));
  await failedHarness.settle();
  assert.equal(failedHarness.get().dailyCap, null);
  assert.notEqual(failedHarness.get().error, null);
  assert.equal(failedHarness.get().hasLoaded, false);
  assert.equal(failedHarness.get().isStale, false);
});

test('buildDeliverySlotsMap은 usedSlots 누락을 0으로 처리한다', () => {
  const map = buildDeliverySlotsMap([
    { date: '2026-09-12', totalCap: 10 },
    { date: '2026-09-13', totalCap: 5, usedSlots: null },
    { date: '2026-09-14', totalCap: 5, usedSlots: 5 },
  ]);
  assert.equal(map['2026-09-12'].usedSlots, 0);
  assert.equal(map['2026-09-12'].remainingSlots, 10);
  assert.equal(map['2026-09-13'].remainingSlots, 5);
  assert.equal(map['2026-09-14'].remainingSlots, 0);
});

test('isDeliveryDateSelectable는 fail-closed 게이트를 지킨다', () => {
  const slot = { date: '2026-09-12', totalCap: 10, usedSlots: 2, remainingSlots: 8 };
  assert.equal(isDeliveryDateSelectable('2026-09-12', '2026-09-10', slot, false), true);
  // readBlocked면 잔여가 있어도 선택 불가
  assert.equal(isDeliveryDateSelectable('2026-09-12', '2026-09-10', slot, true), false);
  // 과거·문서 없음·잔여 0은 선택 불가
  assert.equal(isDeliveryDateSelectable('2026-09-09', '2026-09-10', slot, false), false);
  assert.equal(isDeliveryDateSelectable('2026-09-12', '2026-09-10', undefined, false), false);
  assert.equal(
    isDeliveryDateSelectable(
      '2026-09-12',
      '2026-09-10',
      { date: '2026-09-12', totalCap: 10, usedSlots: 10, remainingSlots: 0 },
      false,
    ),
    false,
  );
});

test('computeRemainingSlots는 usedSlots 누락을 0으로 처리한다', () => {
  assert.equal(computeRemainingSlots(10, 3), 7);
  assert.equal(computeRemainingSlots(10, undefined), 10);
  assert.equal(computeRemainingSlots(10, null), 10);
});

test('hook recovery primitive가 effect와 실제로 연결되어 있다 (가짜 retry 금지)', () => {
  assert.match(source, /retryCount/);
  assert.match(source, /hasLoadedRef/);
  assert.match(source, /isStale/);
  assert.match(source, /setRefreshing/);
  assert.match(source, /\[\s*storeId,\s*from,\s*to,\s*retryCount\s*\]/);
  assert.match(source, /\[\s*docId,\s*retryCount\s*\]/);
  assert.match(source, /prevScopeRef\.current !== scopeKey/);
  assert.doesNotMatch(source, /location\.reload/);
});

test('DeliveryDatePicker는 최초 실패와 stale을 구분하고 실제 retry에 연결한다', () => {
  assert.match(pickerSource, /배송 가능 날짜를 확인하지 못했습니다/);
  assert.match(pickerSource, /최신 잔여 수량을 확인하지 못했습니다/);
  assert.match(pickerSource, /이전 정보/);
  assert.match(pickerSource, /다시 조회/);
  assert.match(pickerSource, /data-testid="delivery-slots-error"/);
  assert.match(pickerSource, /data-testid="delivery-slots-stale"/);
  assert.match(pickerSource, /data-testid="delivery-slots-retry"/);
  assert.match(pickerSource, /isDeliveryDateSelectable/);
  assert.match(pickerSource, /onClick=\{retry\}/);
  assert.match(pickerSource, /error !== null \|\| isStale/);
  assert.doesNotMatch(pickerSource, /location\.reload/);
  // 기존 선택 value를 임의로 해소하지 않는다.
  assert.doesNotMatch(pickerSource, /onChange\(null\)/);
});

test('production Firebase에 직접 연결하지 않는다 (mock subscription만 사용)', () => {
  assert.doesNotMatch(source, /firestore\.googleapis\.com/);
  assert.match(source, /from '@\/lib\/firebase'/);
});
