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
  const state = { lastOrder: undefined, lastStatus: undefined };
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

function installFakeBrowser({ hidden = false, orderStatus = 'PREPARING' } = {}) {
  const listeners = new Map();
  const intervals = new Map();
  let nextIntervalId = 1;
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
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  const current = { orderStatus };
  globalThis.document = fakeDocument;
  globalThis.fetch = async (url) => {
    fetchCalls.push(url);
    return new Response(JSON.stringify({ id: 'order-1', status: current.orderStatus }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  globalThis.setInterval = (fn, ms) => {
    const id = nextIntervalId++;
    intervals.set(id, { fn, ms });
    return id;
  };
  globalThis.clearInterval = (id) => intervals.delete(id);

  return {
    current,
    fetchCalls,
    intervals,
    listeners,
    setVisibility(value) {
      fakeDocument.visibilityState = value;
      listeners.get('visibilitychange')?.();
    },
    tick() {
      for (const { fn } of [...intervals.values()]) fn();
    },
    restore() {
      globalThis.document = original.document;
      globalThis.fetch = original.fetch;
      globalThis.setInterval = original.setInterval;
      globalThis.clearInterval = original.clearInterval;
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

test('보이는 탭에서는 3초 폴링을 하고, 숨기면 멈췄다가 다시 보이면 바로 조회하고 이어 간다', async () => {
  const browser = installFakeBrowser();
  try {
    const { hook, effects } = loadHook();
    runOrderStatusEffectHost(hook, 'order-1', 'access-token');
    assert.equal(effects.length, 1);
    const cleanup = effects[0]();
    await flush();

    assert.equal(browser.fetchCalls.length, 1, '처음 한 번 조회한다');
    assert.equal(browser.intervals.size, 1);
    assert.equal([...browser.intervals.values()][0].ms, 3000);

    browser.tick();
    await flush();
    assert.equal(browser.fetchCalls.length, 2);

    browser.setVisibility('hidden');
    assert.equal(browser.intervals.size, 0, '숨김 탭에서는 interval이 없다');
    browser.tick();
    await flush();
    assert.equal(browser.fetchCalls.length, 2, '숨김 동안 조회하지 않는다');

    browser.setVisibility('visible');
    await flush();
    assert.equal(browser.fetchCalls.length, 3, '다시 보이면 바로 조회한다');
    assert.equal(browser.intervals.size, 1, '폴링을 이어 간다');

    cleanup();
    assert.equal(browser.intervals.size, 0);
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
    assert.equal(browser.intervals.size, 0);

    browser.setVisibility('visible');
    await flush();
    assert.equal(browser.fetchCalls.length, 2);
    assert.equal(browser.intervals.size, 1);
    cleanup();
  } finally {
    browser.restore();
  }
});

test('종료 상태에 도달하면 폴링을 끝내고 탭이 다시 보여도 재개하지 않는다', async () => {
  const browser = installFakeBrowser({ orderStatus: 'DELIVERED' });
  try {
    const { hook, effects } = loadHook();
    runOrderStatusEffectHost(hook, 'order-1', 'access-token');
    const cleanup = effects[0]();
    await flush();
    assert.equal(browser.fetchCalls.length, 1);
    assert.equal(browser.intervals.size, 0);

    browser.setVisibility('hidden');
    browser.setVisibility('visible');
    await flush();
    assert.equal(browser.fetchCalls.length, 1);
    assert.equal(browser.intervals.size, 0);
    cleanup();
  } finally {
    browser.restore();
  }
});
