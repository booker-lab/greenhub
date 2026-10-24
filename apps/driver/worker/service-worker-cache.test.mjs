import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const APP = 'https://driver.example.test';

// Cache Storage를 URL 단위로 흉내 낸다. 이전 워커가 남긴 항목을 미리 채워 두고 정리 결과를 본다.
function createCacheStorage(seed) {
  const caches = new Map(
    Object.entries(seed).map(([name, paths]) => [
      name,
      new Set(paths.map((path) => `${APP}${path}`)),
    ]),
  );
  const deleteCalls = [];
  const storage = {
    has: async (name) => caches.has(name),
    open: async (name) => {
      if (!caches.has(name)) caches.set(name, new Set());
      const entries = caches.get(name);
      return {
        keys: async () => [...entries].map((url) => ({ url })),
        delete: async (request, options) => {
          deleteCalls.push(options);
          return entries.delete(request.url);
        },
      };
    },
  };
  const snapshot = () =>
    Object.fromEntries(
      [...caches].map(([name, entries]) => [
        name,
        [...entries].map((url) => url.slice(APP.length)).sort(),
      ]),
    );
  return { storage, snapshot, deleteCalls };
}

async function loadWorker(storage) {
  const source = await readFile(new URL('./index.js', import.meta.url), 'utf8');
  const listeners = new Map();
  const self = {
    location: { origin: APP },
    caches: storage,
    addEventListener: (type, listener) => listeners.set(type, listener),
  };
  vm.runInNewContext(source, { self, URL });
  return listeners;
}

async function dispatch(listener, extra = {}) {
  const pending = [];
  listener({ ...extra, waitUntil: (promise) => pending.push(promise) });
  await Promise.all(pending);
  return pending.length;
}

// 이전 워커(next-pwa 기본 runtimeCaching)가 남길 수 있는 항목
const SEED = {
  pages: ['/board', '/board/order-1', '/map', '/profile', '/login', '/', '/boardroom'],
  'pages-rsc': ['/board?_rsc=a1', '/map?_rsc=b2', '/login?_rsc=c3'],
  'pages-rsc-prefetch': ['/profile?_rsc=d4', '/login?_rsc=e5'],
  'start-url': ['/'],
  'static-js-assets': ['/_next/static/chunks/main.js'],
};

const PUBLIC_AFTER_PURGE = {
  pages: ['/', '/boardroom', '/login'],
  'pages-rsc': ['/login?_rsc=c3'],
  'pages-rsc-prefetch': ['/login?_rsc=e5'],
  'start-url': ['/'],
  'static-js-assets': ['/_next/static/chunks/main.js'],
};

test('새 서비스워커 활성화 때 보호 경로 문서·RSC 항목만 지우고 공개 경로 항목은 남긴다', async () => {
  const { storage, snapshot, deleteCalls } = createCacheStorage(SEED);
  const listeners = await loadWorker(storage);

  assert.equal(await dispatch(listeners.get('activate')), 1);

  assert.deepEqual(snapshot(), PUBLIC_AFTER_PURGE);
  assert.ok(deleteCalls.every((options) => options?.ignoreVary === true));
});

test('없는 pages 계열 캐시는 새로 만들지 않는다', async () => {
  const { storage, snapshot } = createCacheStorage({ pages: ['/board', '/login'] });
  const listeners = await loadWorker(storage);

  await dispatch(listeners.get('activate'));

  assert.deepEqual(snapshot(), { pages: ['/login'] });
});

test('활성화 뒤 늦게 남은 보호 경로 항목은 다음 보호 경로 요청 때 지운다', async () => {
  const { storage, snapshot } = createCacheStorage(SEED);
  const listeners = await loadWorker(storage);
  const fetchListener = listeners.get('fetch');

  // 공개 경로·다른 출처 요청은 정리하지 않는다
  for (const href of [`${APP}/login`, `${APP}/boardroom`, 'https://other.example.test/board']) {
    assert.equal(await dispatch(fetchListener, { request: { url: href } }), 0, href);
  }
  assert.deepEqual(snapshot(), sortedSeed());

  assert.equal(await dispatch(fetchListener, { request: { url: `${APP}/board?_rsc=z9` } }), 1);
  assert.deepEqual(snapshot(), PUBLIC_AFTER_PURGE);
});

test('보호 경로 판정은 next.config의 NetworkOnly 규칙과 같은 정규식을 쓴다', async () => {
  const worker = await readFile(new URL('./index.js', import.meta.url), 'utf8');
  const config = await readFile(new URL('../next.config.ts', import.meta.url), 'utf8');
  const pattern = '/^\\/(?:board|map|profile)(?:\\/|$)/';
  assert.ok(worker.includes(pattern), 'worker/index.js 보호 경로 정규식이 바뀌었다');
  assert.ok(config.includes(pattern), 'next.config.ts 보호 경로 정규식이 바뀌었다');
});

function sortedSeed() {
  return Object.fromEntries(Object.entries(SEED).map(([name, paths]) => [name, [...paths].sort()]));
}
