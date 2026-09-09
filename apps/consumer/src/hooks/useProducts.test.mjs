import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

// CONSUMER-PRODUCTS-READ-RECOVERY-01 focused test.
// useProducts() list-read 복구 계약:
// - manual refetch가 같은 query scope에서 실제 network fetch를 다시 실행하는지
// - 실패/성공-empty 구분, retry 성공 시 error clear, retry 실패 시 error 유지
// - query scope 변경이 올바른 새 query를 요청하고 이전 scope 데이터를 새 것처럼 보이지 않게 하는지
// - active UI retry가 실제 hook refetch에 연결되는지

const hookSource = await readFile(new URL('./useProducts.ts', import.meta.url), 'utf8');
const searchSource = await readFile(new URL('../app/search/page.tsx', import.meta.url), 'utf8');
const categorySource = await readFile(
  new URL('../app/category/page.tsx', import.meta.url),
  'utf8',
);
const homeSource = await readFile(
  new URL('../components/HomeProductList.tsx', import.meta.url),
  'utf8',
);
const groupbuySource = await readFile(
  new URL('../app/groupbuy/page.tsx', import.meta.url),
  'utf8',
);

test('소비자 상품 조회 훅은 shared SaleType을 사용한다', () => {
  assert.match(hookSource, /SaleType/);
  assert.match(hookSource, /saleType\?: SaleType/);
  assert.doesNotMatch(hookSource, /saleType\?: ['"]group['"] \| ['"]direct['"]/);
});

const compiled = ts.transpileModule(hookSource, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'useProducts.ts',
}).outputText;

const API_BASE_URL = 'https://api.example.test';

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

function mountHook({ fetchImpl, initialArgs = [] }) {
  globalThis.fetch = fetchImpl;
  const hookModule = { exports: {} };
  const stateSlots = [];
  const refSlots = [];
  const effectSlots = [];
  let cursor = 0;
  let renderScheduled = true;
  let latest = null;
  let currentArgs = initialArgs;

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
      return { getApiBaseUrl: () => API_BASE_URL };
    }
    if (specifier === 'firebase/firestore') {
      return { doc: () => ({}), getDoc: async () => ({ exists: () => false, data: () => ({}) }) };
    }
    if (specifier === '@/lib/firebase') {
      return { db: {} };
    }
    if (specifier === '@greenhub/shared') return {};
    throw new Error(`예상하지 못한 상품 조회 모듈 요청: ${specifier}`);
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
    latest = hookModule.exports.useProducts(...currentArgs);
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
  const setArgs = (args) => {
    currentArgs = args;
    scheduleRender();
  };
  return { get, settle, render, setArgs };
}

const productA = { id: 'product-A', name: 'A', createdAt: '2026-09-02T00:00:00.000Z' };
const productB = { id: 'product-B', name: 'B', createdAt: '2026-09-03T00:00:00.000Z' };

test('최초 fetch 1회가 network request를 실행하고 목록을 적재한다', async () => {
  const calls = [];
  const harness = mountHook({
    fetchImpl: async (url) => {
      calls.push(String(url));
      return okResponse([productA]);
    },
  });
  await harness.settle();

  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('/products?'));
  assert.ok(calls[0].includes('isActive=true'));
  assert.deepEqual(harness.get().products, [productA]);
  assert.equal(harness.get().loading, false);
  assert.equal(harness.get().error, null);
  assert.equal(typeof harness.get().refetch, 'function');
});

test('초기 실패는 error를 세우고 빈 성공으로 위장하지 않는다', async () => {
  const harness = mountHook({ fetchImpl: async () => errorResponse(500) });
  await harness.settle();

  assert.match(harness.get().error ?? '', /500/);
  assert.deepEqual(harness.get().products, []);
  assert.equal(harness.get().loading, false);
});

test('성공한 empty list는 error 없이 성공으로 확정한다 (failed read와 구분)', async () => {
  const failed = mountHook({ fetchImpl: async () => errorResponse(500) });
  await failed.settle();
  assert.notEqual(failed.get().error, null);
  assert.deepEqual(failed.get().products, []);

  const empty = mountHook({ fetchImpl: async () => okResponse([]) });
  await empty.settle();
  assert.deepEqual(empty.get().products, []);
  assert.equal(empty.get().error, null);
  assert.equal(empty.get().loading, false);
});

test('refetch 1회는 같은 query scope에서 network request 1회를 추가한다', async () => {
  const calls = [];
  const harness = mountHook({
    fetchImpl: async (url) => {
      calls.push(String(url));
      return okResponse([productA]);
    },
  });
  await harness.settle();
  assert.equal(calls.length, 1);
  const firstUrl = calls[0];

  harness.get().refetch();
  await harness.settle();

  assert.equal(calls.length, 2);
  assert.equal(calls[1], firstUrl);
  assert.deepEqual(harness.get().products, [productA]);
  assert.equal(harness.get().error, null);
});

test('failure → retry → success는 error를 clear하고 목록을 적재한다', async () => {
  let mode = 'failure';
  const harness = mountHook({
    fetchImpl: async () => (mode === 'failure' ? errorResponse(500) : okResponse([productB])),
  });
  await harness.settle();
  assert.notEqual(harness.get().error, null);
  assert.deepEqual(harness.get().products, []);

  mode = 'success';
  harness.get().refetch();
  await harness.settle();

  assert.deepEqual(harness.get().products, [productB]);
  assert.equal(harness.get().error, null);
  assert.equal(harness.get().loading, false);
});

test('retry failure는 error 상태를 유지한다', async () => {
  let mode = 'failure';
  const harness = mountHook({
    fetchImpl: async () => (mode === 'failure' ? errorResponse(500) : okResponse([productB])),
  });
  await harness.settle();
  assert.notEqual(harness.get().error, null);

  // 두 번째 시도도 실패하면 error가 그대로 남는다.
  harness.get().refetch();
  await harness.settle();

  assert.notEqual(harness.get().error, null);
  assert.equal(harness.get().loading, false);

  // 실패 응답 상태가 달라도 error가 유지된다.
  mode = 'failure';
  harness.get().refetch();
  await harness.settle();
  assert.notEqual(harness.get().error, null);
});

test('query scope 변경은 올바른 새 query request를 보낸다', async () => {
  const calls = [];
  const harness = mountHook({
    initialArgs: [undefined, [], undefined],
    fetchImpl: async (url) => {
      calls.push(String(url));
      const urlString = String(url);
      if (urlString.includes('category=orchid')) return okResponse([productB]);
      return okResponse([productA]);
    },
  });
  await harness.settle();
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].includes('category=orchid'));

  harness.setArgs(['orchid', [], undefined]);
  await harness.settle();

  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes('category=orchid'));
  assert.ok(calls[1].includes('isActive=true'));
  assert.deepEqual(harness.get().products, [productB]);
  assert.equal(harness.get().error, null);
});

test('saleType/colors scope 변경도 새 query에 반영된다', async () => {
  const calls = [];
  const harness = mountHook({
    initialArgs: [undefined, [], undefined],
    fetchImpl: async (url) => {
      calls.push(String(url));
      return okResponse([]);
    },
  });
  await harness.settle();
  assert.equal(calls.length, 1);

  harness.setArgs([undefined, [], 'group']);
  await harness.settle();
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes('saleType=group'));

  harness.setArgs(['cut_flower', ['레드'], 'group']);
  await harness.settle();
  assert.equal(calls.length, 3);
  assert.ok(calls[2].includes('category=cut_flower'));
  assert.ok(calls[2].includes('saleType=group'));
  assert.ok(decodeURIComponent(calls[2]).includes('colors=레드'));
});

test('scope 변경 시 이전 scope 데이터를 새 scope 결과처럼 보여주지 않는다', async () => {
  const first = deferred();
  const second = deferred();
  let n = 0;
  const harness = mountHook({
    initialArgs: [undefined, [], undefined],
    fetchImpl: async () => {
      n += 1;
      return n === 1 ? first.promise : second.promise;
    },
  });
  await harness.settle(5);
  // 첫 scope fetch가 계류 중이면 목록은 비어 있다.
  assert.deepEqual(harness.get().products, []);

  // scope를 바꾸면 새 fetch가 시작되고 이전 데이터가 남아 있지 않다.
  harness.setArgs(['orchid', [], undefined]);
  await harness.settle(5);
  assert.deepEqual(harness.get().products, []);

  // 늦게 도착한 이전 scope 응답이 최신 결과를 덮지 않는다.
  second.resolve(okResponse([productB]));
  await harness.settle();
  assert.deepEqual(harness.get().products, [productB]);

  first.resolve(okResponse([productA]));
  await harness.settle();
  assert.deepEqual(harness.get().products, [productB]);
  assert.equal(harness.get().error, null);
});

test('stale retry 응답은 더 최신 refetch 결과를 덮지 않는다', async () => {
  const first = deferred();
  const second = deferred();
  let n = 0;
  const calls = [];
  const harness = mountHook({
    fetchImpl: async (url) => {
      n += 1;
      calls.push(String(url));
      return n === 1 ? first.promise : second.promise;
    },
  });
  await harness.settle(5);
  assert.equal(calls.length, 1);

  harness.get().refetch();
  await harness.settle(5);
  assert.equal(calls.length, 2);

  second.resolve(okResponse([productB]));
  await harness.settle();
  assert.deepEqual(harness.get().products, [productB]);

  first.resolve(okResponse([productA]));
  await harness.settle();
  assert.deepEqual(harness.get().products, [productB]);
  assert.equal(harness.get().error, null);
});

test('refetch trigger가 fetch effect에 연결되어 dead tick이 아니다', () => {
  assert.doesNotMatch(hookSource, /_tick/);
  assert.match(hookSource, /const\s+refetch\s*=\s*useCallback\(\(\)\s*=>\s*\{\s*setTick/);
  assert.match(hookSource, /\[\s*category,\s*saleType,\s*colorKey,\s*tick\s*\]/);
  assert.match(hookSource, /return\s*\{\s*products,\s*loading,\s*error,\s*refetch\s*\}/);
});

test('search 화면은 상품 조회 실패에 실제 동작하는 retry를 제공한다', () => {
  assert.match(searchSource, /const\s*\{\s*products,\s*loading,\s*error,\s*refetch\s*\}\s*=\s*useProducts\(\)/);
  assert.match(searchSource, /data-testid="products-retry"/);
  assert.match(searchSource, /onClick=\{refetch\}/);
  assert.match(searchSource, /다시 시도/);
});

test('category 화면은 scope 조회 실패에 실제 동작하는 retry를 제공한다', () => {
  assert.match(
    categorySource,
    /const\s*\{\s*products,\s*loading,\s*error,\s*refetch\s*\}\s*=\s*useProducts\(/,
  );
  assert.match(categorySource, /refetch=\{refetch\}/);
  assert.match(categorySource, /refetch:\s*\(\)\s*=>\s*void/);
  assert.match(categorySource, /data-testid="products-retry"/);
  assert.match(categorySource, /onClick=\{refetch\}/);
});

test('home 화면은 상품 조회 실패에 실제 동작하는 retry를 제공한다', () => {
  assert.match(homeSource, /const\s*\{\s*products,\s*loading,\s*error,\s*refetch\s*\}\s*=\s*useProducts\(\)/);
  assert.match(homeSource, /refetch=\{refetch\}/);
  assert.match(homeSource, /data-testid="products-retry"/);
  assert.match(homeSource, /onClick=\{refetch\}/);
  assert.match(homeSource, /다시 시도/);
});

test('groupbuy 화면은 상품 조회 실패에 실제 동작하는 retry를 제공한다', () => {
  assert.match(groupbuySource, /const\s*\{\s*products,\s*loading,\s*error,\s*refetch\s*\}\s*=\s*useProducts\(undefined,\s*undefined,\s*'group'\)/);
  assert.match(groupbuySource, /data-testid="products-retry"/);
  assert.match(groupbuySource, /onClick=\{refetch\}/);
  assert.match(groupbuySource, /다시 시도/);
});
