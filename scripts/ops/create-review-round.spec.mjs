import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUDIT_ACTION,
  buildItemDocument,
  buildRoundDocument,
  DEFAULT_LIMITS,
  parseKstDateTime,
  parseLimits,
  parseSchedule,
  pickDeliveryRegion,
  readInputs,
  run,
} from './create-review-round.mjs';

const STORE = '80189070-2c3d-45f2-bc11-68a870b13951';
const PRODUCT = '0a96f85d-b906-439c-a38c-f469a21e1dbf';
const OTHER_STORE = '11111111-2222-4333-8444-555555555555';
const KEY_PATH = '/fixture/sa.json';
const NOW = Date.UTC(2026, 9, 27, 16, 30, 0, 0);
const SCHEDULE_TEXT =
  '2026-10-28 09:00|2026-11-11 23:00|2026-11-12 07:00|2026-11-13 00:00|2026-11-13 09:00';
const REGION = {
  id: 'icheon',
  label: '경기도 이천시',
  province: '경기도',
  city: '이천시',
  enabled: true,
};

class FakeTimestamp {
  constructor(millis) {
    this.millis = millis;
  }
  static fromMillis(millis) {
    return new FakeTimestamp(millis);
  }
  toMillis() {
    return this.millis;
  }
}

function existingRound(overrides = {}) {
  return {
    id: 'e8ca686f-a9db-4c6b-8ebf-2bf190351a3c',
    storeId: STORE,
    name: '11월 10일 배송 회차',
    status: 'SCHEDULED',
    schedule: {
      orderOpenAt: '2026-11-01T01:00:00.000Z',
      orderCloseAt: '2026-11-08T15:00:00.000Z',
      auctionAt: '2026-11-08T22:00:00.000Z',
      deliveryStartAt: '2026-11-09T15:00:00.000Z',
      deliveryEndAt: '2026-11-10T00:00:00.000Z',
      timezone: 'Asia/Seoul',
    },
    deliveryRegion: REGION,
    limits: { maxDeliveryAddresses: 15, maxItemQuantity: 30 },
    createdAt: FakeTimestamp.fromMillis(NOW - 10 * 86_400_000),
    ...overrides,
  };
}

function product(overrides = {}) {
  return {
    id: PRODUCT,
    storeId: STORE,
    name: '만천홍',
    price: 25000,
    saleType: 'normal',
    images: ['https://example.test/manchunhong.png'],
    ...overrides,
  };
}

// 최소 Firestore 흉내: saleRounds의 storeId 질의, 문서 get/set, 트랜잭션 get/create.
function createFakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const writes = [];
  const docRef = (path) => ({
    path,
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    set: async (data) => {
      writes.push(['set', path]);
      docs.set(path, data);
    },
  });
  const db = {
    doc: docRef,
    collection: (name) => ({
      where: (field, op, value) => ({
        limit: () => ({
          get: async () => {
            assert.equal(name, 'saleRounds');
            assert.equal(field, 'storeId');
            assert.equal(op, '==');
            const hits = [...docs.entries()]
              .filter(([p, d]) => p.startsWith('saleRounds/') && d.storeId === value)
              .map(([, d]) => ({ data: () => d }));
            return { docs: hits };
          },
        }),
      }),
    }),
    runTransaction: async (fn) =>
      fn({
        get: async (ref) => ref.get(),
        create: (ref, data) => {
          if (docs.has(ref.path)) throw new Error('already exists');
          writes.push(['create', ref.path]);
          docs.set(ref.path, data);
        },
      }),
  };
  return { db, docs, writes };
}

function harness({ seed, env = {}, argv, project } = {}) {
  const fake = createFakeDb(seed);
  const lines = [];
  let connected = 0;
  const options = {
    argv: argv ?? [],
    env: {
      ROUND_STORE_ID: STORE,
      ROUND_MODE: 'check',
      GOOGLE_APPLICATION_CREDENTIALS: KEY_PATH,
      ...env,
    },
    write: (line) => lines.push(line),
    loadFile: async (path) => {
      assert.equal(path, KEY_PATH);
      return JSON.stringify({ project_id: project ?? 'green-e4fe3', private_key: 'fixture' });
    },
    connect: async () => {
      connected += 1;
      return { db: fake.db, Timestamp: FakeTimestamp };
    },
    now: () => NOW,
  };
  return {
    fake,
    lines,
    connected: () => connected,
    run: () => run(options),
    output: () => lines.join('\n'),
  };
}

const createEnv = {
  ROUND_MODE: 'create',
  ROUND_NAME: '11월 특별 회차',
  ROUND_PRODUCT_ID: PRODUCT,
  ROUND_SCHEDULE: SCHEDULE_TEXT,
};

const roundsOf = (h) =>
  [...h.fake.docs.entries()].filter(([p]) => p.startsWith('saleRounds/')).map(([, d]) => d);
const itemsOf = (h) =>
  [...h.fake.docs.entries()].filter(([p]) => p.startsWith('saleRoundItems/')).map(([, d]) => d);
const auditsOf = (h) =>
  [...h.fake.docs.entries()].filter(([p]) => p.startsWith('auditLogs/')).map(([, d]) => d);

// ── 입력 파싱 ─────────────────────────────────────────────────────────────────

test('parseKstDateTime: 한국 시간을 UTC ISO로 바꾸고 없는 날짜·형식 오류를 거부한다', () => {
  assert.equal(parseKstDateTime('2026-10-28 09:00'), '2026-10-28T00:00:00.000Z');
  assert.equal(parseKstDateTime('2026-11-13T00:00'), '2026-11-12T15:00:00.000Z');
  assert.throws(() => parseKstDateTime('2026-02-30 10:00'), /달력에 없는/);
  assert.throws(() => parseKstDateTime('2026-10-28'), /형식/);
  assert.throws(() => parseKstDateTime('2026-10-28 25:00'), /달력에 없는/);
});

test('parseSchedule: 5개 시각을 순서 규칙·30일 상한으로 검증한다', () => {
  const schedule = parseSchedule(SCHEDULE_TEXT);
  assert.deepEqual(schedule, {
    orderOpenAt: '2026-10-28T00:00:00.000Z',
    orderCloseAt: '2026-11-11T14:00:00.000Z',
    auctionAt: '2026-11-11T22:00:00.000Z',
    deliveryStartAt: '2026-11-12T15:00:00.000Z',
    deliveryEndAt: '2026-11-13T00:00:00.000Z',
    timezone: 'Asia/Seoul',
  });
  assert.throws(() => parseSchedule('2026-10-28 09:00|2026-11-11 23:00'), /5개/);
  // 마감이 시작보다 빠름
  assert.throws(
    () =>
      parseSchedule(
        '2026-11-11 23:00|2026-10-28 09:00|2026-11-12 07:00|2026-11-13 00:00|2026-11-13 09:00',
      ),
    /순서/,
  );
  // 경매가 마감보다 빠름
  assert.throws(
    () =>
      parseSchedule(
        '2026-10-28 09:00|2026-11-11 23:00|2026-11-11 22:00|2026-11-13 00:00|2026-11-13 09:00',
      ),
    /순서/,
  );
  // 배송 종료가 배송 시작과 같음
  assert.throws(
    () =>
      parseSchedule(
        '2026-10-28 09:00|2026-11-11 23:00|2026-11-12 07:00|2026-11-13 00:00|2026-11-13 00:00',
      ),
    /순서/,
  );
  // 주문 기간 31일
  assert.throws(
    () =>
      parseSchedule(
        '2026-10-28 09:00|2026-11-28 09:01|2026-11-29 07:00|2026-11-30 00:00|2026-11-30 09:00',
      ),
    /30일/,
  );
});

test('parseLimits: 기본 2,2,2이고 범위 밖·개수 오류를 거부한다', () => {
  assert.deepEqual(parseLimits(''), { ...DEFAULT_LIMITS });
  assert.deepEqual(parseLimits(' 1, 3 ,10 '), {
    itemLimit: 1,
    maxDeliveryAddresses: 3,
    maxItemQuantity: 10,
  });
  for (const bad of ['2,2', '0,2,2', '2,11,2', 'a,2,2', '1.5,2,2']) {
    assert.throws(() => parseLimits(bad), /ROUND_LIMITS/);
  }
});

test('readInputs: check는 매장 id만, create는 이름·상품·일정·한도를 요구한다', () => {
  assert.deepEqual(readInputs({ ROUND_STORE_ID: STORE }), { mode: 'check', storeId: STORE });
  const inputs = readInputs({ ROUND_STORE_ID: STORE, ...createEnv, ROUND_PRICE: '25000' });
  assert.equal(inputs.name, '11월 특별 회차');
  assert.equal(inputs.productId, PRODUCT);
  assert.equal(inputs.price, 25000);
  assert.deepEqual(inputs.limits, { ...DEFAULT_LIMITS });
  assert.equal(inputs.schedule.timezone, 'Asia/Seoul');
  assert.equal(readInputs({ ROUND_STORE_ID: STORE, ...createEnv }).price, null);

  assert.throws(() => readInputs({ ROUND_STORE_ID: 'nope' }), /ROUND_STORE_ID/);
  assert.throws(() => readInputs({ ROUND_STORE_ID: STORE, ROUND_MODE: 'open' }), /ROUND_MODE/);
  assert.throws(
    () => readInputs({ ROUND_STORE_ID: STORE, ...createEnv, ROUND_NAME: '' }),
    /ROUND_NAME/,
  );
  assert.throws(
    () => readInputs({ ROUND_STORE_ID: STORE, ...createEnv, ROUND_NAME: 'x'.repeat(41) }),
    /ROUND_NAME/,
  );
  assert.throws(
    () => readInputs({ ROUND_STORE_ID: STORE, ...createEnv, ROUND_PRODUCT_ID: 'bad' }),
    /ROUND_PRODUCT_ID/,
  );
  assert.throws(
    () => readInputs({ ROUND_STORE_ID: STORE, ...createEnv, ROUND_PRICE: '-1' }),
    /ROUND_PRICE/,
  );
  assert.throws(
    () => readInputs({ ROUND_STORE_ID: STORE, ...createEnv, ROUND_SCHEDULE: '' }),
    /5개/,
  );
});

// ── 문서 모양 ─────────────────────────────────────────────────────────────────

test('buildRoundDocument·buildItemDocument: API createRound과 같은 필드 집합이다', () => {
  const now = FakeTimestamp.fromMillis(NOW);
  const schedule = parseSchedule(SCHEDULE_TEXT);
  const round = buildRoundDocument({
    roundId: 'round-1',
    storeId: STORE,
    name: '11월 특별 회차',
    schedule,
    deliveryRegion: REGION,
    limits: { itemLimit: 2, maxDeliveryAddresses: 3, maxItemQuantity: 4 },
    now,
  });
  assert.deepEqual(Object.keys(round).sort(), [
    'cancellation',
    'cancelledAt',
    'carrotLandingUrl',
    'closeReason',
    'completedAt',
    'counters',
    'createdAt',
    'deliveryRegion',
    'id',
    'limits',
    'name',
    'schedule',
    'status',
    'storeId',
    'updatedAt',
  ]);
  assert.equal(round.status, 'SCHEDULED');
  assert.equal(round.closeReason, null);
  assert.deepEqual(round.limits, { maxDeliveryAddresses: 3, maxItemQuantity: 4 });
  assert.deepEqual(round.counters, {
    reservedDeliveryAddresses: 0,
    reservedItemQuantity: 0,
    orderedDeliveryAddresses: 0,
    orderedItemQuantity: 0,
    heldOrderCount: 0,
  });

  const item = buildItemDocument({
    itemId: 'item-1',
    roundId: 'round-1',
    storeId: STORE,
    productId: PRODUCT,
    product: product(),
    roundPrice: 25000,
    saleLimitQuantity: 2,
    now,
  });
  assert.deepEqual(Object.keys(item).sort(), [
    'createdAt',
    'displayOrder',
    'id',
    'orderedQuantity',
    'productId',
    'productImageUrlSnapshot',
    'productNameSnapshot',
    'reservedQuantity',
    'roundId',
    'roundPrice',
    'saleLimitQuantity',
    'status',
    'storeId',
    'updatedAt',
  ]);
  assert.equal(item.status, 'ACTIVE');
  assert.equal(item.displayOrder, 0);
  assert.equal(item.productImageUrlSnapshot, 'https://example.test/manchunhong.png');
  assert.equal(
    buildItemDocument({
      itemId: 'i',
      roundId: 'r',
      storeId: STORE,
      productId: PRODUCT,
      product: product({ images: undefined }),
      roundPrice: 1,
      saleLimitQuantity: 1,
      now,
    }).productImageUrlSnapshot,
    null,
  );
});

test('pickDeliveryRegion: 가장 최근 회차의 배송 지역을 활성 상태로 복사하고 없으면 null', () => {
  const older = existingRound({
    id: 'old',
    deliveryRegion: { ...REGION, id: 'old-region', city: '옛도시' },
    createdAt: FakeTimestamp.fromMillis(NOW - 30 * 86_400_000),
  });
  const newest = existingRound({ deliveryRegion: { ...REGION, enabled: false } });
  assert.deepEqual(pickDeliveryRegion([older, newest]), { ...REGION, enabled: true });
  assert.equal(pickDeliveryRegion([]), null);
  assert.equal(pickDeliveryRegion([existingRound({ deliveryRegion: null })]), null);
});

// ── 실행 ─────────────────────────────────────────────────────────────────────

test('check: 매장 회차를 최신순으로 나열하고 아무것도 쓰지 않는다', async () => {
  const h = harness({
    seed: {
      [`saleRounds/${existingRound().id}`]: existingRound(),
      'saleRounds/other-store': existingRound({ id: 'other', storeId: OTHER_STORE }),
    },
  });
  assert.equal(await h.run(), 0);
  assert.equal(h.connected(), 1);
  assert.match(
    h.output(),
    /mode: check\nrounds: 1\n- 11월 10일 배송 회차 \| SCHEDULED \| 2026-11-01T01:00:00\.000Z ~ 2026-11-08T15:00:00\.000Z$/,
  );
  assert.ok(!h.output().includes('roundIdPrefix'), 'id prefix is detail only');
  assert.deepEqual(h.fake.writes, []);
});

test('create: 회차·회차 상품을 한 트랜잭션에 만들고 배송 지역은 기존 회차에서 복사하며 감사 기록을 남긴다', async () => {
  const h = harness({
    env: { ...createEnv, ROUND_LIMITS: '1,2,3' },
    seed: {
      [`saleRounds/${existingRound().id}`]: existingRound(),
      [`products/${PRODUCT}`]: product(),
    },
  });
  assert.equal(await h.run(), 0);

  const rounds = roundsOf(h).filter((round) => round.name === '11월 특별 회차');
  assert.equal(rounds.length, 1);
  const [round] = rounds;
  assert.equal(round.status, 'SCHEDULED');
  assert.equal(round.storeId, STORE);
  assert.deepEqual(round.deliveryRegion, { ...REGION, enabled: true });
  assert.deepEqual(round.limits, { maxDeliveryAddresses: 2, maxItemQuantity: 3 });
  assert.equal(round.schedule.orderOpenAt, '2026-10-28T00:00:00.000Z');
  assert.equal(round.createdAt.toMillis(), NOW);

  const items = itemsOf(h);
  assert.equal(items.length, 1);
  assert.equal(items[0].roundId, round.id);
  assert.equal(items[0].productId, PRODUCT);
  assert.equal(items[0].productNameSnapshot, '만천홍');
  assert.equal(items[0].roundPrice, 25000);
  assert.equal(items[0].saleLimitQuantity, 1);

  const audits = auditsOf(h);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, AUDIT_ACTION);
  assert.equal(audits[0].detail.roundId, round.id);
  assert.equal(audits[0].detail.roundItemId, items[0].id);

  assert.deepEqual(
    h.fake.writes.map(([op, p]) => `${op}:${p.split('/')[0]}`),
    ['create:saleRounds', 'create:saleRoundItems', 'set:auditLogs'],
  );
  assert.match(
    h.output(),
    /result: created\nname: 11월 특별 회차\nstatus: SCHEDULED\norderOpenAt: 2026-10-28T00:00:00\.000Z[\s\S]*deliveryRegion: 이천시\nlimits: item 1, addresses 2, quantity 3\nproduct: 만천홍 \(25000원\)/,
  );
  assert.ok(!h.output().includes(round.id), 'round id must not appear in default output');
});

test('create: ROUND_PRICE를 주면 그 값이 회차 가격이 된다', async () => {
  const h = harness({
    env: { ...createEnv, ROUND_PRICE: '1000' },
    seed: {
      [`saleRounds/${existingRound().id}`]: existingRound(),
      [`products/${PRODUCT}`]: product(),
    },
  });
  assert.equal(await h.run(), 0);
  assert.equal(itemsOf(h)[0].roundPrice, 1000);
});

test('create: 같은 이름의 살아 있는 회차가 있으면 아무것도 바꾸지 않고 exit 1', async () => {
  const h = harness({
    env: createEnv,
    seed: {
      [`saleRounds/${existingRound().id}`]: existingRound(),
      'saleRounds/dup': existingRound({ id: 'dup', name: '11월 특별 회차', status: 'OPEN' }),
      [`products/${PRODUCT}`]: product(),
    },
  });
  assert.equal(await h.run(), 1);
  assert.match(h.output(), /result: already-exists/);
  assert.deepEqual(h.fake.writes, []);
});

test('create: 같은 이름이라도 취소·완료된 회차만 있으면 새로 만든다', async () => {
  const h = harness({
    env: createEnv,
    seed: {
      [`saleRounds/${existingRound().id}`]: existingRound(),
      'saleRounds/done': existingRound({ id: 'done', name: '11월 특별 회차', status: 'CANCELLED' }),
      [`products/${PRODUCT}`]: product(),
    },
  });
  assert.equal(await h.run(), 0);
  assert.equal(roundsOf(h).filter((round) => round.name === '11월 특별 회차').length, 2);
});

test('create: 배송 지역을 복사할 회차가 없으면 만들지 않는다', async () => {
  const h = harness({ env: createEnv, seed: { [`products/${PRODUCT}`]: product() } });
  assert.equal(await h.run(), 1);
  assert.match(h.output(), /배송 지역을 복사할/);
  assert.deepEqual(h.fake.writes, []);
});

test('create: 상품이 없거나 다른 매장 상품·공동구매 상품이면 트랜잭션 안에서 거부하고 아무것도 쓰지 않는다', async () => {
  for (const seedProduct of [
    undefined,
    product({ storeId: OTHER_STORE }),
    product({ saleType: 'group' }),
  ]) {
    const seed = { [`saleRounds/${existingRound().id}`]: existingRound() };
    if (seedProduct) seed[`products/${PRODUCT}`] = seedProduct;
    const h = harness({ env: createEnv, seed });
    assert.equal(await h.run(), 1);
    assert.match(h.output(), /회차 상품을 찾을 수 없습니다|공동구매/);
    assert.deepEqual(h.fake.writes, []);
  }
});

test('create: 상품 가격이 없고 ROUND_PRICE도 없으면 거부한다', async () => {
  const h = harness({
    env: createEnv,
    seed: {
      [`saleRounds/${existingRound().id}`]: existingRound(),
      [`products/${PRODUCT}`]: product({ price: undefined }),
    },
  });
  assert.equal(await h.run(), 1);
  assert.match(h.output(), /ROUND_PRICE/);
  assert.deepEqual(h.fake.writes, []);
});

test('--detail은 CI 환경에서 연결 전에 거부하고, 운영이 아닌 키도 연결 전에 거부한다', async () => {
  const ci = harness({ argv: ['--detail'], env: { GITHUB_ACTIONS: 'true' } });
  assert.equal(await ci.run(), 1);
  assert.equal(ci.connected(), 0);

  const staging = harness({ project: 'greenhub-round-direct-e2e' });
  assert.equal(await staging.run(), 1);
  assert.equal(staging.connected(), 0);
  assert.match(staging.output(), /운영\(green-e4fe3\)이 아니어서 거부/);
});

test('create 입력이 모자라면 연결 전에 거부한다', async () => {
  const h = harness({ env: { ROUND_MODE: 'create' } });
  assert.equal(await h.run(), 1);
  assert.equal(h.connected(), 0);
  assert.match(h.output(), /ROUND_NAME/);
});
