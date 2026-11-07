import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./useOrderStatus.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'useOrderStatus.ts',
}).outputText;

const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

function loadModule(react) {
  const hookModule = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    (specifier) => {
      if (specifier === 'react') return react;
      if (specifier === '@/lib/api-base-url') {
        return { getApiBaseUrl: () => 'https://api.example.test' };
      }
      throw new Error(`예상하지 못한 주문 상태 모듈 요청: ${specifier}`);
    },
    hookModule,
    hookModule.exports,
  );
  return hookModule.exports;
}

const {
  ORDER_PAYMENT_CHECK_AFTER_MS,
  ORDER_STATUS_POLL_INTERVAL_MS,
  ORDER_STATUS_POLL_MAX_MS,
  shouldCheckPendingPayment,
  shouldPollOrderStatus,
} = loadModule({
  useCallback: (fn) => fn,
  useEffect: () => {},
  useRef: (initial) => ({ current: initial }),
  useState: (initial) => [initial, () => {}],
});

// React 없이 훅의 state·ref·effect 계약만 흉내 내는 최소 실행기(useSaleRounds.test.mjs와 같은 방식).
function mountHook({ orderId = 'order-1', accessToken = 'token-1', fetchImpl, options }) {
  globalThis.fetch = fetchImpl;
  const stateSlots = [];
  const refSlots = [];
  const effectSlots = [];
  let cursor = 0;
  let renderScheduled = true;
  let latest = null;

  function useState(initial) {
    const index = cursor++;
    if (stateSlots[index] === undefined) stateSlots[index] = { value: initial };
    const slot = stateSlots[index];
    const setState = (next) => {
      const value = typeof next === 'function' ? next(slot.value) : next;
      if (Object.is(value, slot.value)) return;
      slot.value = value;
      renderScheduled = true;
    };
    return [slot.value, setState];
  }

  function useRef(initial) {
    const index = cursor++;
    if (refSlots[index] === undefined) refSlots[index] = { current: initial };
    return refSlots[index];
  }

  function useEffect(create, deps) {
    const index = cursor++;
    if (effectSlots[index] === undefined) effectSlots[index] = { deps: undefined, hasRun: false };
    effectSlots[index].pendingCreate = create;
    effectSlots[index].pendingDeps = deps;
  }

  const hook = loadModule({ useCallback: (fn) => fn, useEffect, useRef, useState });

  function flushEffects() {
    for (const slot of effectSlots) {
      if (!slot?.pendingCreate) continue;
      const changed =
        !slot.hasRun || slot.pendingDeps.some((dep, i) => !Object.is(dep, slot.deps[i]));
      if (!changed) continue;
      if (typeof slot.cleanup === 'function') slot.cleanup();
      slot.deps = slot.pendingDeps;
      slot.hasRun = true;
      const cleanup = slot.pendingCreate();
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    }
  }

  function render() {
    cursor = 0;
    renderScheduled = false;
    latest = hook.useOrderStatus(orderId, accessToken, options);
    flushEffects();
  }

  async function settle(passes = 6) {
    for (let i = 0; i < passes; i += 1) {
      if (renderScheduled) render();
      await new Promise((resolve) => setImmediate(resolve));
    }
    if (renderScheduled) render();
  }

  function unmount() {
    for (const slot of effectSlots) {
      if (typeof slot?.cleanup === 'function') slot.cleanup();
    }
  }

  return { get: () => latest, settle, unmount };
}

function orderResponse(status) {
  return new Response(JSON.stringify({ id: 'order-1', status }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function serverReturning(initialStatus) {
  const server = { status: initialStatus, calls: 0 };
  server.fetch = async (input) => {
    assert.equal(String(input), 'https://api.example.test/orders/order-1');
    server.calls += 1;
    if (typeof server.status === 'number') {
      return new Response(JSON.stringify({ message: 'error' }), { status: server.status });
    }
    return orderResponse(server.status);
  };
  return server;
}

async function advance(t, harness, ms) {
  t.mock.timers.tick(ms);
  await harness.settle();
}

test('PENDING 주문만 2분 안에서 다시 확인한다', () => {
  assert.equal(ORDER_STATUS_POLL_INTERVAL_MS, 3000);
  assert.equal(ORDER_STATUS_POLL_MAX_MS, 120000);
  assert.equal(shouldPollOrderStatus('PENDING', 0), true);
  assert.equal(shouldPollOrderStatus('PENDING', 119_999), true);
  assert.equal(shouldPollOrderStatus('PENDING', 120_000), false);
  // 아직 한 번도 못 읽은 주문(일시 실패)도 같은 2분 안에서만 다시 시도한다.
  assert.equal(shouldPollOrderStatus(null, 3000), true);
  assert.equal(shouldPollOrderStatus(null, 120_000), false);
  for (const status of ['ACCEPTED', 'PREPARING', 'DELIVERING', 'DELIVERY_HELD', 'CANCELLED']) {
    assert.equal(shouldPollOrderStatus(status, 0), false);
  }
  for (const elapsed of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
    assert.equal(shouldPollOrderStatus('PENDING', elapsed), false);
  }
});

test('결제 확인 중(PENDING)이면 3초마다 다시 읽고 ACCEPTED가 되면 바로 멈춘다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  const server = serverReturning('PENDING');
  const harness = mountHook({ fetchImpl: server.fetch });
  await harness.settle();
  assert.equal(server.calls, 1);
  assert.equal(harness.get().order?.status, 'PENDING');

  await advance(t, harness, 2999);
  assert.equal(server.calls, 1);
  await advance(t, harness, 1);
  assert.equal(server.calls, 2);

  server.status = 'ACCEPTED';
  await advance(t, harness, 3000);
  assert.equal(server.calls, 3);
  assert.equal(harness.get().order?.status, 'ACCEPTED');
  assert.equal(harness.get().status, 'found');

  await advance(t, harness, 60_000);
  assert.equal(server.calls, 3);
  assert.equal(harness.get().pollingExpired, false);
  harness.unmount();
});

test('처음부터 PENDING이 아닌 주문은 한 번만 읽는다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  for (const status of ['ACCEPTED', 'DELIVERY_HELD', 'DELIVERED', 'CANCELLED']) {
    const server = serverReturning(status);
    const harness = mountHook({ fetchImpl: server.fetch });
    await harness.settle();
    await advance(t, harness, 30_000);
    assert.equal(server.calls, 1, status);
    assert.equal(harness.get().order?.status, status);
    harness.unmount();
  }
});

test('2분 동안 PENDING이면 멈추고 알리며, 다시 확인하면 2분 동안 다시 확인한다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  const server = serverReturning('PENDING');
  const harness = mountHook({ fetchImpl: server.fetch });
  await harness.settle();

  for (let i = 0; i < 50; i += 1) await advance(t, harness, ORDER_STATUS_POLL_INTERVAL_MS);
  // 0초 + 3초 간격 40번(120초) = 41번 읽고 멈춘다(분당 약 20번 < IP당 100번 한도).
  assert.equal(server.calls, 41);
  assert.equal(harness.get().pollingExpired, true);
  assert.equal(harness.get().order?.status, 'PENDING');

  const refetched = harness.get().refetch();
  await harness.settle();
  assert.equal((await refetched)?.status, 'PENDING');
  assert.equal(server.calls, 42);
  assert.equal(harness.get().pollingExpired, false);

  await advance(t, harness, ORDER_STATUS_POLL_INTERVAL_MS);
  assert.equal(server.calls, 43);
  server.status = 'ACCEPTED';
  await advance(t, harness, ORDER_STATUS_POLL_INTERVAL_MS);
  assert.equal(harness.get().order?.status, 'ACCEPTED');
  await advance(t, harness, 60_000);
  assert.equal(server.calls, 44);
  harness.unmount();
});

test('일시 실패는 2분 안에서 다시 시도하고 404·권한 오류는 다시 읽지 않는다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  const flaky = serverReturning(503);
  const harness = mountHook({ fetchImpl: flaky.fetch });
  await harness.settle();
  assert.equal(harness.get().status, 'server');
  flaky.status = 'PENDING';
  await advance(t, harness, ORDER_STATUS_POLL_INTERVAL_MS);
  assert.equal(flaky.calls, 2);
  assert.equal(harness.get().status, 'found');
  harness.unmount();

  for (const httpStatus of [404, 401, 403]) {
    const server = serverReturning(httpStatus);
    const stopped = mountHook({ fetchImpl: server.fetch });
    await stopped.settle();
    await advance(t, stopped, 30_000);
    assert.equal(server.calls, 1, String(httpStatus));
    stopped.unmount();
  }
});

test('화면을 떠나면 예약된 다시 확인을 취소한다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  const server = serverReturning('PENDING');
  const harness = mountHook({ fetchImpl: server.fetch });
  await harness.settle();
  assert.equal(server.calls, 1);

  harness.unmount();
  await advance(t, harness, 30_000);
  assert.equal(server.calls, 1);
});

// 결제 확인 요청(POST /payments/orders/:orderId/check)과 주문 조회(GET /orders/:orderId)를 함께 흉내 낸다.
function serverWithPaymentCheck(initialStatus) {
  const server = { status: initialStatus, reads: 0, checks: [], checkResult: null };
  server.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === 'https://api.example.test/payments/orders/order-1/check') {
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, 'Bearer token-1');
      server.checks.push(Date.now());
      if (server.checkResult === 'network') throw new TypeError('fetch failed');
      if (typeof server.checkResult === 'number') {
        return new Response(JSON.stringify({ message: 'error' }), { status: server.checkResult });
      }
      if (server.checkResult) server.status = server.checkResult;
      return new Response(JSON.stringify({ status: server.status, result: 'checked' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    assert.equal(url, 'https://api.example.test/orders/order-1');
    server.reads += 1;
    return orderResponse(server.status);
  };
  return server;
}

test('결제 확인은 PENDING이 6초·20초·45초를 넘겨 이어질 때만 차례로 요청한다', () => {
  assert.deepEqual([...ORDER_PAYMENT_CHECK_AFTER_MS], [6000, 20000, 45000]);
  assert.equal(shouldCheckPendingPayment('PENDING', 5999, 0), false);
  assert.equal(shouldCheckPendingPayment('PENDING', 6000, 0), true);
  assert.equal(shouldCheckPendingPayment('PENDING', 19_999, 1), false);
  assert.equal(shouldCheckPendingPayment('PENDING', 20_000, 1), true);
  assert.equal(shouldCheckPendingPayment('PENDING', 45_000, 2), true);
  // 한 폴링 창에서 3번까지만 보낸다.
  assert.equal(shouldCheckPendingPayment('PENDING', 119_000, 3), false);
  assert.equal(shouldCheckPendingPayment('PENDING', ORDER_STATUS_POLL_MAX_MS, 2), false);
  for (const status of [null, 'ACCEPTED', 'RECRUITING', 'CANCELLED']) {
    assert.equal(shouldCheckPendingPayment(status, 30_000, 0), false);
  }
  for (const elapsed of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
    assert.equal(shouldCheckPendingPayment('PENDING', elapsed, 0), false);
  }
  assert.equal(shouldCheckPendingPayment('PENDING', 30_000, -1), false);
});

test('결제 확인을 켠 화면은 PENDING이 이어지면 결제 확인을 최대 3번 요청하고 폴링은 그대로 둔다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  const server = serverWithPaymentCheck('PENDING');
  const harness = mountHook({ fetchImpl: server.fetch, options: { checkPendingPayment: true } });
  await harness.settle();
  assert.equal(server.reads, 1);
  assert.deepEqual(server.checks, []);

  await advance(t, harness, 3000);
  assert.deepEqual(server.checks, []);
  await advance(t, harness, 3000);
  assert.deepEqual(server.checks, [6000]);

  for (let i = 0; i < 50; i += 1) await advance(t, harness, ORDER_STATUS_POLL_INTERVAL_MS);
  assert.deepEqual(server.checks, [6000, 21_000, 45_000]);
  assert.equal(server.reads, 41);
  assert.equal(harness.get().pollingExpired, true);
  assert.equal(harness.get().error, null);
  harness.unmount();
});

test('서버가 결제를 확정했다고 답하면 다음 폴링을 기다리지 않고 바로 다시 읽는다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  const server = serverWithPaymentCheck('PENDING');
  server.checkResult = 'ACCEPTED';
  const harness = mountHook({ fetchImpl: server.fetch, options: { checkPendingPayment: true } });
  await harness.settle();
  await advance(t, harness, 6000);
  assert.equal(server.checks.length, 1);
  assert.equal(harness.get().order?.status, 'ACCEPTED');
  const readsAfterConfirm = server.reads;

  await advance(t, harness, 60_000);
  assert.equal(server.checks.length, 1);
  assert.equal(server.reads, readsAfterConfirm);
  harness.unmount();
});

test('결제 확인 실패는 손님 화면에 오류를 띄우지 않고 기존 폴링을 이어 간다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  for (const failure of [429, 503, 'network']) {
    const server = serverWithPaymentCheck('PENDING');
    server.checkResult = failure;
    const harness = mountHook({ fetchImpl: server.fetch, options: { checkPendingPayment: true } });
    await harness.settle();
    await advance(t, harness, 6000);
    assert.equal(server.checks.length, 1, String(failure));
    assert.equal(harness.get().error, null, String(failure));
    assert.equal(harness.get().order?.status, 'PENDING');
    const reads = server.reads;
    await advance(t, harness, ORDER_STATUS_POLL_INTERVAL_MS);
    assert.equal(server.reads, reads + 1, String(failure));
    harness.unmount();
  }
});

test('결제 확인을 켜지 않았거나 PENDING이 아닌 주문은 결제 확인을 요청하지 않는다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  const plain = serverWithPaymentCheck('PENDING');
  const off = mountHook({ fetchImpl: plain.fetch });
  await off.settle();
  for (let i = 0; i < 50; i += 1) await advance(t, off, ORDER_STATUS_POLL_INTERVAL_MS);
  assert.deepEqual(plain.checks, []);
  off.unmount();

  for (const status of ['ACCEPTED', 'RECRUITING', 'CANCELLED']) {
    const server = serverWithPaymentCheck(status);
    const harness = mountHook({ fetchImpl: server.fetch, options: { checkPendingPayment: true } });
    await harness.settle();
    await advance(t, harness, 60_000);
    assert.deepEqual(server.checks, [], status);
    harness.unmount();
  }
});
