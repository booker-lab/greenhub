import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// CONSUMER-LEGACY-GROUP-CONFIG-READ-RECOVERY-01 focused test.
// groupProductConfig read/recovery 의미 분리 계약:
// - loading / successful missing / read failure 구분
// - read failure에서 purchase fail-closed + retry
// - scope 변경 시 stale config/error 제거
// - 기존 group status/countdown/quantity 계약 보존
//
// 조회 경로: 57221e4a 이후 Firestore onSnapshot 대신 public product detail API
// (`GET /products/:id`)를 즉시 조회 + 10초 polling한다. fetch·setInterval을 모의한다.

const hookSource = await readFile(new URL('./useGroupProduct.ts', import.meta.url), 'utf8');
const actionsSource = await readFile(
  new URL('../app/products/[id]/_components/LegacyProductActions.tsx', import.meta.url),
  'utf8',
);

const compiled = ts.transpileModule(hookSource, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'useGroupProduct.ts',
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

// 요청마다 응답을 테스트가 직접 결정하는 fetch 모의(구 Firestore 구독 모의의 대체).
function createApiMock() {
  const requests = [];
  const fetchImpl = (url) => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    requests.push({ url: String(url), resolve, reject });
    return promise;
  };
  return { requests, fetchImpl };
}

// polling 주기를 테스트가 통제하는 setInterval 모의.
function createIntervalMock() {
  const intervals = [];
  return {
    intervals,
    setInterval: (fn, ms) => {
      const handle = { fn, ms, cleared: false };
      intervals.push(handle);
      return handle;
    },
    clearInterval: (handle) => {
      if (handle) handle.cleared = true;
    },
  };
}

function mountHook({ api, timers = createIntervalMock(), initialArgs = [null] }) {
  globalThis.fetch = api.fetchImpl;
  const hookModule = { exports: {} };
  const stateSlots = [];
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
    if (stateSlots[index] === undefined) {
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
    if (specifier === 'react') return { useCallback, useEffect, useState };
    if (specifier === '@/lib/api-base-url') {
      return { getApiBaseUrl: () => API_BASE_URL };
    }
    throw new Error(`예상하지 못한 group hook 모듈 요청: ${specifier}`);
  };
  new Function('require', 'module', 'exports', 'setInterval', 'clearInterval', compiled)(
    requireForTest,
    hookModule,
    hookModule.exports,
    timers.setInterval,
    timers.clearInterval,
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
    latest = hookModule.exports.useGroupProduct(...currentArgs);
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
  return { get, settle, render, setArgs, timers };
}

function successResponse(config) {
  return okResponse({ id: config.productId, groupConfig: { ...config } });
}

const baseConfig = {
  productId: 'p1',
  minQuantity: 5,
  targetQuantity: 10,
  maxPerPerson: 3,
  recruitDeadline: '2026-12-31T00:00:00.000Z',
  currentQuantity: 4,
  groupDeliveryDate: '2027-01-07T00:00:00.000Z',
};

// 1. non-group product
test('non-group productId null이면 조회 없이 config/error 없이 대기하지 않는다', async () => {
  const api = createApiMock();
  const harness = mountHook({ api, initialArgs: [null] });
  await harness.settle();

  assert.equal(api.requests.length, 0);
  assert.equal(harness.timers.intervals.length, 0);
  assert.equal(harness.get().config, null);
  assert.equal(harness.get().loading, false);
  assert.equal(harness.get().error, null);
  assert.equal(harness.get().isMissing, false);
});

// 2. group config loading
test('group productId 진입 시 loading으로 구매 판정 전에 대기한다', async () => {
  const api = createApiMock();
  const harness = mountHook({ api, initialArgs: ['p1'] });
  await harness.settle();

  assert.equal(api.requests.length, 1);
  assert.equal(api.requests[0].url, `${API_BASE_URL}/products/p1`);
  // currentQuantity freshness를 위한 10초 polling이 걸린다.
  assert.equal(harness.timers.intervals.length, 1);
  assert.equal(harness.timers.intervals[0].ms, 10_000);
  assert.equal(harness.get().loading, true);
  assert.equal(harness.get().config, null);
  assert.equal(harness.get().error, null);
  assert.equal(harness.get().isMissing, false);
  assert.equal(typeof harness.get().retry, 'function');
});

// 3. group config success
test('group config success는 기존 status/countdown/quantity 필드를 보존한다', async () => {
  const api = createApiMock();
  const harness = mountHook({ api, initialArgs: ['p1'] });
  await harness.settle();

  api.requests[0].resolve(successResponse(baseConfig));
  await harness.settle();

  assert.equal(harness.get().loading, false);
  assert.equal(harness.get().error, null);
  assert.equal(harness.get().isMissing, false);
  assert.equal(harness.get().config.currentQuantity, 4);
  assert.equal(harness.get().config.targetQuantity, 10);
  assert.equal(harness.get().config.minQuantity, 5);
  assert.equal(harness.get().config.maxPerPerson, 3);
  assert.equal(harness.get().config.recruitDeadline, '2026-12-31T00:00:00.000Z');
  assert.equal(harness.get().config.groupDeliveryDate, '2027-01-07T00:00:00.000Z');
});

// 4. authoritative config missing
test('authoritative missing은 error 없이 missing으로 확정한다', async () => {
  const api = createApiMock();
  const harness = mountHook({ api, initialArgs: ['p1'] });
  await harness.settle();

  api.requests[0].resolve(errorResponse(404));
  await harness.settle();

  assert.equal(harness.get().config, null);
  assert.equal(harness.get().loading, false);
  assert.equal(harness.get().error, null);
  assert.equal(harness.get().isMissing, true);
});

// 5. config read failure ≠ missing
test('config read failure는 missing으로 위장하지 않는다', async () => {
  const api = createApiMock();
  const harness = mountHook({ api, initialArgs: ['p1'] });
  await harness.settle();

  api.requests[0].reject(new Error('permission-denied'));
  await harness.settle();

  assert.match(harness.get().error ?? '', /permission-denied/);
  assert.equal(harness.get().loading, false);
  assert.equal(harness.get().isMissing, false);
  assert.equal(harness.get().config, null);
});

// 6. read failure → purchase disabled (component fail-closed 계약)
test('read failure에서 구매 CTA는 fail-closed이고 recovery UI를 제공한다', () => {
  // hook error를 소비하지 않으면 missing/실패를 구분할 수 없다.
  assert.match(actionsSource, /error:\s*groupError/);
  assert.match(actionsSource, /retry:\s*retryGroupConfig/);
  // read failure 판정은 최신 error 기준이며 loading과 함께 unavailable에 포함된다.
  assert.match(actionsSource, /isGroupReadError/);
  assert.match(actionsSource, /groupError != null/);
  assert.match(
    actionsSource,
    /isGroupUnavailable\s*=\s*isGroup && \(isGroupLoading \|\| isGroupReadError/,
  );
  // 구매 가능 판정은 loading/read-failure를 명시적으로 제외한다.
  assert.match(actionsSource, /!isGroupLoading && !isGroupReadError/);
  // 사용자에게 recovery 상태와 retry를 제공한다.
  assert.match(actionsSource, /공동구매 정보를 불러오지 못했습니다/);
  assert.match(actionsSource, /data-testid="group-config-retry"/);
  assert.match(actionsSource, /onClick=\{retryGroupConfig\}/);
  // failure 라벨은 missing의 기존 semantics(판매 준비 중)와 다르다.
  assert.match(actionsSource, /판매 준비 중/);
});

// 7. retry → success
test('read failure 이후 retry는 다시 조회하고 성공 시 error를 clear한다', async () => {
  const api = createApiMock();
  const harness = mountHook({ api, initialArgs: ['p1'] });
  await harness.settle();

  api.requests[0].reject(new Error('unavailable'));
  await harness.settle();
  assert.notEqual(harness.get().error, null);

  harness.get().retry();
  await harness.settle();

  assert.equal(api.requests.length, 2);
  assert.equal(api.requests[1].url, `${API_BASE_URL}/products/p1`);
  // 이전 scope의 polling은 정리되고 새 polling이 걸린다.
  assert.equal(harness.timers.intervals.length, 2);
  assert.equal(harness.timers.intervals[0].cleared, true);
  assert.equal(harness.timers.intervals[1].cleared, false);

  api.requests[1].resolve(successResponse({ ...baseConfig, currentQuantity: 7 }));
  await harness.settle();

  assert.equal(harness.get().error, null);
  assert.equal(harness.get().loading, false);
  assert.equal(harness.get().isMissing, false);
  assert.equal(harness.get().config.currentQuantity, 7);
});

// 8. productId scope change stale config 제거
test('product A → B 전환 시 A의 config가 B에 남지 않는다', async () => {
  const api = createApiMock();
  const harness = mountHook({ api, initialArgs: ['pA'] });
  await harness.settle();
  api.requests[0].resolve(successResponse({ ...baseConfig, productId: 'pA' }));
  await harness.settle();
  assert.equal(harness.get().config.productId, 'pA');

  harness.setArgs(['pB']);
  await harness.settle();

  assert.equal(harness.timers.intervals[0].cleared, true);
  assert.equal(api.requests[1].url, `${API_BASE_URL}/products/pB`);
  // 새 scope 확정 전에는 이전 config를 새 것처럼 보이지 않게 한다.
  assert.equal(harness.get().config, null);
  assert.equal(harness.get().error, null);
  assert.equal(harness.get().isMissing, false);
  assert.equal(harness.get().loading, true);
});

test('group → non-group 전환 시 config/error가 남지 않는다', async () => {
  const api = createApiMock();
  const harness = mountHook({ api, initialArgs: ['pA'] });
  await harness.settle();
  api.requests[0].reject(new Error('boom'));
  await harness.settle();
  assert.notEqual(harness.get().error, null);

  harness.setArgs([null]);
  await harness.settle();

  assert.equal(harness.timers.intervals[0].cleared, true);
  assert.equal(harness.get().config, null);
  assert.equal(harness.get().error, null);
  assert.equal(harness.get().isMissing, false);
  assert.equal(harness.get().loading, false);
});

// 9. previous config + polling failure actionability
test('이전 valid config 이후 polling 조회 실패가 오면 최신 error를 무시하지 않는다', async () => {
  const api = createApiMock();
  const harness = mountHook({ api, initialArgs: ['p1'] });
  await harness.settle();
  api.requests[0].resolve(successResponse(baseConfig));
  await harness.settle();
  assert.equal(harness.get().config.currentQuantity, 4);
  assert.equal(harness.get().error, null);

  // 같은 scope의 다음 polling 조회가 fatal error를 전달한 상황.
  harness.timers.intervals[0].fn();
  await harness.settle();
  assert.equal(api.requests.length, 2);
  api.requests[1].reject(new Error('lost-connection'));
  await harness.settle();

  assert.match(harness.get().error ?? '', /lost-connection/);
  assert.equal(harness.get().loading, false);
  assert.equal(harness.get().isMissing, false);
  // hook error가 있으면 component는 stale config 상태 판정(full/expired/open)과
  // 무관하게 fail-closed여야 한다.
  assert.match(actionsSource, /isGroup && \(isGroupLoading \|\| isGroupReadError/);
  assert.match(actionsSource, /if \(isGroupUnavailable \|\| isGroupLoading \|\| isGroupReadError\) return;/);
});

// 10. 기존 group quantity/deadline behavior 회귀 없음
test('기존 group quantity/deadline 판정 계약이 유지된다', () => {
  // status/countdown/quantity 계산이 그대로 groupConfig 기준이다.
  assert.match(actionsSource, /getGroupBuyStatus\(groupConfig\)/);
  assert.match(actionsSource, /groupConfig\?\.recruitDeadline/);
  assert.match(actionsSource, /groupConfig\.currentQuantity/);
  assert.match(actionsSource, /groupConfig\.targetQuantity/);
  assert.match(actionsSource, /groupConfig\.minQuantity/);
  assert.match(actionsSource, /groupConfig\.maxPerPerson/);
  // missing의 기존 제품 semantics(판매 불가 + 판매 준비 중)가 보존된다.
  assert.match(actionsSource, /groupStatus !== 'open'/);
  assert.match(actionsSource, /모집 마감/);
  assert.match(actionsSource, /모집 완료/);
});
