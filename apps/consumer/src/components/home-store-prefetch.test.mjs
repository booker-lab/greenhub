import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

// 홈 첫 조회의 동시 시작을 실제 모듈(공유 요청·회차·매장 프로필·별점 조회)로 확인한다.
// 브라우저 fetch만 가짜로 바꾸고, 각 테스트는 공유 요청 캐시가 빈 새 모듈 묶음을 쓴다.

const API = 'https://api.example.test';
const STORE = 'store-1';
const requireFromApp = createRequire(new URL('../../package.json', import.meta.url));
const sources = {
  '@/lib/shared-request': '../lib/shared-request.ts',
  '@/hooks/useSaleRounds': '../hooks/useSaleRounds.ts',
  '@/lib/public-store-profile': '../lib/public-store-profile.ts',
  '@/lib/benchmark-api': '../lib/benchmark-api.ts',
  './home-store-prefetch': './home-store-prefetch.ts',
};
const compiled = new Map(
  Object.entries(sources).map(([specifier, path]) => [
    specifier,
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: path,
    }).outputText,
  ]),
);

function loadWorld({ features = ['reviews'] } = {}) {
  const enabled = new Set(features);
  const stubs = {
    '@/lib/api-base-url': { getApiBaseUrl: () => API },
    '@/lib/features': { isFeatureOn: (key) => enabled.has(key) },
  };
  const loaded = new Map();
  const load = (specifier) => {
    if (stubs[specifier]) return stubs[specifier];
    if (loaded.has(specifier)) return loaded.get(specifier);
    const code = compiled.get(specifier);
    if (!code) return requireFromApp(specifier);
    const module = { exports: {} };
    loaded.set(specifier, module.exports);
    new Function('require', 'module', 'exports', code)(load, module, module.exports);
    loaded.set(specifier, module.exports);
    return module.exports;
  };
  return {
    prefetch: load('./home-store-prefetch'),
    rounds: load('@/hooks/useSaleRounds'),
    profile: load('@/lib/public-store-profile'),
    benchmark: load('@/lib/benchmark-api'),
  };
}

const day = 86_400_000;
const at = (offsetDays) => new Date(Date.now() + offsetDays * day).toISOString();
function round(id, status, openOffsetDays) {
  return {
    id,
    storeId: STORE,
    name: id,
    status,
    schedule: {
      orderOpenAt: at(openOffsetDays),
      orderCloseAt: at(openOffsetDays + 3),
      auctionAt: at(openOffsetDays + 4),
      deliveryStartAt: at(openOffsetDays + 5),
      deliveryEndAt: at(openOffsetDays + 5),
      timezone: 'Asia/Seoul',
    },
    items: [],
  };
}
// 서버는 판매 중 회차와 최근 지난 회차 3개(past=3)를 준다. 홈은 지난 회차 중 최신 2개만 보여 준다.
const ROUNDS = [
  round('closed-old', 'CLOSED', -21),
  round('open', 'OPEN', -1),
  round('completed', 'COMPLETED', -7),
  round('closed-mid', 'CLOSED', -14),
];
const BODIES = {
  [`/stores/${STORE}/public-profile`]: { id: STORE, name: '농장', logoUrl: null, salesMode: 'round_direct' },
  [`/stores/${STORE}/sale-rounds/public`]: { items: ROUNDS },
  [`/stores/${STORE}/review-stats`]: { p1: { count: 2, average: 4.5 } },
};

/** 응답을 직접 풀어 줄 때까지 붙잡아 두는 가짜 fetch. */
function installHeldFetch(t, { failPaths = [] } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = new URL(String(input));
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    calls.push({ path: url.pathname, search: url.search, release });
    return held.then(() => {
      if (failPaths.includes(url.pathname)) return new Response('{}', { status: 500 });
      const body = BODIES[url.pathname];
      return body
        ? new Response(JSON.stringify(body), { status: 200 })
        : new Response('{}', { status: 404 });
    });
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return {
    calls,
    releaseAll() {
      for (const call of calls) call.release();
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('미리 조회할 매장은 상품으로 확정한 매장, 없으면 주소의 storeId다', () => {
  const { prefetch } = loadWorld();
  assert.equal(prefetch.homePrefetchStoreId('store-a', 'store-b'), 'store-a');
  assert.equal(prefetch.homePrefetchStoreId(null, 'store-b'), 'store-b');
  assert.equal(prefetch.homePrefetchStoreId(null, null), null);
  assert.equal(prefetch.homePrefetchStoreId(null, ''), null);
});

test('판매 방식·회차·별점 조회를 어느 응답도 오기 전에 함께 보낸다', async (t) => {
  const network = installHeldFetch(t);
  const { prefetch } = loadWorld();

  prefetch.prefetchHomeStore(STORE);
  await flush();

  assert.deepEqual(
    network.calls.map((call) => call.path + call.search).sort(),
    [
      `/stores/${STORE}/public-profile`,
      `/stores/${STORE}/review-stats`,
      `/stores/${STORE}/sale-rounds/public?include=items&past=3`,
    ],
  );
  network.releaseAll();
});

test('홈 화면 쪽 조회는 미리 보낸 요청을 받아 새 요청 없이 같은 표시 결과를 만든다', async (t) => {
  const network = installHeldFetch(t);
  const { prefetch, rounds, profile, benchmark } = loadWorld();

  prefetch.prefetchHomeStore(STORE);
  await flush();
  // 화면은 판매 방식 확인 → 회차 조회 → 별점 순으로 부르지만 이미 보낸 요청을 기다린다.
  const pending = Promise.all([
    profile.fetchPublicStoreProfile(STORE),
    rounds.loadPublicSaleRoundsState(STORE),
    benchmark.fetchStoreReviewStats(STORE),
  ]);
  await flush();
  assert.equal(network.calls.length, 3);

  network.releaseAll();
  const [storeProfile, state, reviewStats] = await pending;
  assert.equal(network.calls.length, 3);
  assert.equal(storeProfile.salesMode, 'round_direct');
  assert.equal(state.status, 'success');
  assert.equal(state.currentRound?.id, 'open');
  assert.deepEqual(
    state.pastRounds.map((item) => item.id),
    ['completed', 'closed-mid'],
  );
  assert.deepEqual(reviewStats, BODIES[`/stores/${STORE}/review-stats`]);
});

test('별점 기능이 꺼져 있으면 별점 조회는 보내지 않는다', async (t) => {
  const network = installHeldFetch(t);
  const { prefetch } = loadWorld({ features: [] });

  prefetch.prefetchHomeStore(STORE);
  await flush();

  assert.deepEqual(
    network.calls.map((call) => call.path).sort(),
    [`/stores/${STORE}/public-profile`, `/stores/${STORE}/sale-rounds/public`],
  );
  network.releaseAll();
});

test('미리 조회가 실패해도 처리되지 않은 거부를 남기지 않고, 다음 화면 조회는 새로 보낸다', async (t) => {
  const network = installHeldFetch(t, {
    failPaths: [`/stores/${STORE}/public-profile`, `/stores/${STORE}/review-stats`],
  });
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.off('unhandledRejection', onUnhandled));
  const { prefetch, profile } = loadWorld();

  prefetch.prefetchHomeStore(STORE);
  await flush();
  network.releaseAll();
  await flush();
  await flush();
  assert.deepEqual(unhandled, []);

  const retry = profile.fetchPublicStoreProfile(STORE);
  await flush();
  assert.equal(
    network.calls.filter((call) => call.path === `/stores/${STORE}/public-profile`).length,
    2,
  );
  network.releaseAll();
  await assert.rejects(retry);
});
