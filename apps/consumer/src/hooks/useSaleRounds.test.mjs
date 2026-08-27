import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./useSaleRounds.ts', import.meta.url), 'utf8');
const testableSource = `${source.replace(
  "import { getApiBaseUrl } from '@/lib/api-base-url';",
  "const getApiBaseUrl = () => 'http://localhost:3000';",
)}
export { createLoadingSaleRoundsState, fetchPublicSaleRoundsState };`;
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

const { createLoadingSaleRoundsState, fetchPublicSaleRoundsState } = saleRoundsModule.exports;

function round(id, status, orderOpenAt) {
  return {
    id,
    storeId: 'store-1',
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

test('초기 상태는 회차 데이터 없이 loading이다', () => {
  assert.deepEqual(createLoadingSaleRoundsState(), {
    rounds: [],
    currentRound: null,
    pastRounds: [],
    status: 'loading',
    loading: true,
    error: null,
    isEmpty: false,
  });
});

test('공개 회차가 없으면 empty 상태를 제공한다', async () => {
  const state = await fetchPublicSaleRoundsState('store-1', async () =>
    jsonResponse({ items: [] }),
  );

  assert.equal(state.status, 'empty');
  assert.equal(state.loading, false);
  assert.equal(state.isEmpty, true);
  assert.equal(state.error, null);
  assert.deepEqual(state.rounds, []);
  assert.equal(state.currentRound, null);
  assert.deepEqual(state.pastRounds, []);
});

test('공개 API 실패는 데이터를 비우고 error 상태를 제공한다', async () => {
  const state = await fetchPublicSaleRoundsState('store-1', async () =>
    jsonResponse({ message: '일시적인 장애' }, 503),
  );

  assert.equal(state.status, 'error');
  assert.equal(state.loading, false);
  assert.equal(state.isEmpty, false);
  assert.equal(state.error, '회차 조회 오류: 503');
  assert.deepEqual(state.rounds, []);
});

test('목록과 상세를 조회해 현재 회차 하나와 최신순 지난 회차를 제공한다', async () => {
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
});

test('판매 중 회차가 없으면 현재 시각 이후 가장 가까운 예정 회차를 선택한다', async () => {
  const now = new Date('2026-07-18T03:00:00.000Z');
  const stale = round('round-stale', 'SCHEDULED', '2026-07-17T15:00:00.000Z');
  const nearest = round('round-nearest', 'SCHEDULED', '2026-07-19T15:00:00.000Z');
  const later = round('round-later', 'SCHEDULED', '2026-07-26T15:00:00.000Z');
  const rounds = [later, stale, nearest];

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
