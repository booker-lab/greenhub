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

// React hook을 한 번 실행하는 최소 대역: useEffect 본문을 꺼내 직접 실행·정리한다.
function loadHook() {
  const effects = [];
  const state = { lastOrder: undefined, lastStatus: undefined, pollingExpired: undefined };
  const hookModule = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    (specifier) => {
      if (specifier === 'react') {
        return {
          useCallback: (fn) => fn,
          useEffect: (fn) => effects.push(fn),
          useRef: () => ({ current: null }),
          useState: (initial) => [
            initial,
            (value) => {
              // pollingExpired는 false로 시작하는 유일한 state다.
              if (initial === false) {
                state.pollingExpired = value;
                return;
              }
              if (value && typeof value === 'object' && 'status' in value) state.lastOrder = value;
              if (typeof value === 'string') state.lastStatus = value;
            },
          ],
        };
      }
      if (specifier === '@/lib/api-base-url') {
        return { getApiBaseUrl: () => 'https://api.example.test' };
      }
      return {};
    },
    hookModule,
    hookModule.exports,
  );
  return { hook: hookModule.exports, effects, state };
}

// 다시 확인은 결제 확인 전(PENDING) 주문만 setTimeout으로 하나씩 예약한다.
function installFakeBrowser({ hidden = false, orderStatus = 'PENDING' } = {}) {
  const listeners = new Map();
  const timers = new Map();
  let nextTimerId = 1;
  const fetchCalls = [];
  const fakeDocument = {
    visibilityState: hidden ? 'hidden' : 'visible',
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
  };
  const original = {
    document: globalThis.document,
    fetch: globalThis.fetch,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    dateNow: Date.now,
  };
  const current = { orderStatus, now: 0 };
  globalThis.document = fakeDocument;
  Date.now = () => current.now;
  globalThis.fetch = async (url) => {
    fetchCalls.push(url);
    return new Response(JSON.stringify({ id: 'order-1', status: current.orderStatus }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  globalThis.setTimeout = (fn, ms) => {
    const id = nextTimerId++;
    timers.set(id, { fn, ms });
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);

  return {
    current,
    fetchCalls,
    timers,
    listeners,
    setVisibility(value) {
      fakeDocument.visibilityState = value;
      listeners.get('visibilitychange')?.();
    },
    tick() {
      for (const [id, { fn, ms }] of [...timers.entries()]) {
        timers.delete(id);
        current.now += ms;
        fn();
      }
    },
    restore() {
      globalThis.document = original.document;
      globalThis.fetch = original.fetch;
      globalThis.setTimeout = original.setTimeout;
      globalThis.clearTimeout = original.clearTimeout;
      Date.now = original.dateNow;
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

// 대역 React에서 hook 본문을 한 번 실행한다(useEffect 본문은 effects에 모인다).
function runOrderStatusEffectHost(hook, orderId, accessToken) {
  const renderOnce = hook.useOrderStatus;
  return renderOnce(orderId, accessToken);
}

test('isDocumentHidden은 visibilityState가 hidden일 때만 true다', () => {
  const { hook } = loadHook();
  assert.equal(hook.isDocumentHidden({ visibilityState: 'hidden' }), true);
  assert.equal(hook.isDocumentHidden({ visibilityState: 'visible' }), false);
  assert.equal(hook.isDocumentHidden(undefined), false);
});

test('보이는 탭에서는 PENDING 주문을 3초마다 다시 읽고, 숨기면 멈췄다가 다시 보이면 바로 조회하고 이어 간다', async () => {
  const browser = installFakeBrowser();
  try {
    const { hook, effects } = loadHook();
    runOrderStatusEffectHost(hook, 'order-1', 'access-token');
    assert.equal(effects.length, 1);
    const cleanup = effects[0]();
    await flush();

    assert.equal(browser.fetchCalls.length, 1, '처음 한 번 조회한다');
    assert.equal(browser.timers.size, 1);
    assert.equal([...browser.timers.values()][0].ms, 3000);

    browser.tick();
    await flush();
    assert.equal(browser.fetchCalls.length, 2);
    assert.equal(browser.timers.size, 1);

    browser.setVisibility('hidden');
    assert.equal(browser.timers.size, 0, '숨김 탭에서는 예약된 확인이 없다');
    browser.tick();
    await flush();
    assert.equal(browser.fetchCalls.length, 2, '숨김 동안 조회하지 않는다');

    browser.setVisibility('visible');
    await flush();
    assert.equal(browser.fetchCalls.length, 3, '다시 보이면 바로 조회한다');
    assert.equal(browser.timers.size, 1, '폴링을 이어 간다');

    cleanup();
    assert.equal(browser.timers.size, 0);
    assert.equal(browser.listeners.has('visibilitychange'), false, '정리 시 listener를 뗀다');
  } finally {
    browser.restore();
  }
});

test('숨김 탭에서 열리면 한 번만 조회하고, 보일 때부터 폴링한다', async () => {
  const browser = installFakeBrowser({ hidden: true });
  try {
    const { hook, effects } = loadHook();
    runOrderStatusEffectHost(hook, 'order-1', 'access-token');
    const cleanup = effects[0]();
    await flush();
    assert.equal(browser.fetchCalls.length, 1);
    assert.equal(browser.timers.size, 0);

    browser.setVisibility('visible');
    await flush();
    assert.equal(browser.fetchCalls.length, 2);
    assert.equal(browser.timers.size, 1);
    cleanup();
  } finally {
    browser.restore();
  }
});

test('PENDING이 아니라 폴링을 끝낸 주문은 탭이 다시 보여도 재개하지 않는다', async () => {
  for (const orderStatus of ['ACCEPTED', 'DELIVERED']) {
    const browser = installFakeBrowser({ orderStatus });
    try {
      const { hook, effects } = loadHook();
      runOrderStatusEffectHost(hook, 'order-1', 'access-token');
      const cleanup = effects[0]();
      await flush();
      assert.equal(browser.fetchCalls.length, 1, orderStatus);
      assert.equal(browser.timers.size, 0, orderStatus);

      browser.setVisibility('hidden');
      browser.setVisibility('visible');
      await flush();
      assert.equal(browser.fetchCalls.length, 1, orderStatus);
      assert.equal(browser.timers.size, 0, orderStatus);
      cleanup();
    } finally {
      browser.restore();
    }
  }
});

test('숨긴 동안 2분 창이 지나면 다시 보일 때 한 번만 조회하고 자동 확인 멈춤을 알린다', async () => {
  const browser = installFakeBrowser();
  try {
    const { hook, effects, state } = loadHook();
    runOrderStatusEffectHost(hook, 'order-1', 'access-token');
    const cleanup = effects[0]();
    await flush();
    assert.equal(browser.fetchCalls.length, 1);
    assert.equal(browser.timers.size, 1);

    browser.setVisibility('hidden');
    assert.equal(browser.timers.size, 0);
    browser.current.now += 2 * 60 * 1000;

    browser.setVisibility('visible');
    await flush();
    assert.equal(browser.fetchCalls.length, 2, '다시 보이면 최신 상태를 한 번 조회한다');
    assert.equal(browser.timers.size, 0, '2분 창이 지났으므로 이어 가지 않는다');
    assert.equal(state.pollingExpired, true);
    cleanup();
  } finally {
    browser.restore();
  }
});
