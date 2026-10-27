import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUDIT_ACTION,
  assertScheduleOrder,
  formatKst,
  parseExplicitSchedule,
  planReschedule,
  readInputs,
  run,
  shiftSchedule,
} from './reschedule-round.mjs';

const STORE = '80189070-2c3d-45f2-bc11-68a870b13951';
const ROUND = 'e8ca686f-a9db-4c6b-8ebf-2bf190351a3c';
const OTHER_ROUND = '8a6f155b-0758-4631-be35-93550b30e823';
const KEY_PATH = '/fixture/sa.json';
// 2026-10-28 03:00 KST
const NOW = Date.UTC(2026, 9, 27, 18, 0, 0, 0);
const CURRENT_SCHEDULE = Object.freeze({
  orderOpenAt: '2026-11-01T01:00:00.000Z',
  orderCloseAt: '2026-11-08T15:00:00.000Z',
  auctionAt: '2026-11-08T22:00:00.000Z',
  deliveryStartAt: '2026-11-09T15:00:00.000Z',
  deliveryEndAt: '2026-11-10T00:00:00.000Z',
  timezone: 'Asia/Seoul',
});
const SHIFTED_21 = Object.freeze({
  orderOpenAt: '2026-11-22T01:00:00.000Z',
  orderCloseAt: '2026-11-29T15:00:00.000Z',
  auctionAt: '2026-11-29T22:00:00.000Z',
  deliveryStartAt: '2026-11-30T15:00:00.000Z',
  deliveryEndAt: '2026-12-01T00:00:00.000Z',
  timezone: 'Asia/Seoul',
});

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
    id: ROUND,
    storeId: STORE,
    name: '11월 10일 배송 회차',
    status: 'SCHEDULED',
    cancellation: null,
    schedule: { ...CURRENT_SCHEDULE },
    limits: { maxDeliveryAddresses: 15, maxItemQuantity: 30 },
    counters: {
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 0,
      orderedItemQuantity: 0,
      heldOrderCount: 0,
    },
    ...overrides,
  };
}

// 최소 Firestore 흉내: 문서 get/set/update, saleRounds의 storeId 질의, 트랜잭션 get/update.
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
        update: (ref, data) => {
          if (!docs.has(ref.path)) throw new Error('missing document');
          writes.push(['update', ref.path, data]);
          docs.set(ref.path, { ...docs.get(ref.path), ...data });
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
      ROUND_ID: ROUND,
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

const seeded = (overrides) => ({ [`saleRounds/${ROUND}`]: existingRound(overrides) });
const auditsOf = (h) =>
  [...h.fake.docs.entries()].filter(([p]) => p.startsWith('auditLogs/')).map(([, d]) => d);
const inputsOf = (env) => readInputs({ ROUND_ID: ROUND, ROUND_MODE: 'reschedule', ...env });

// ── 순수 함수 ─────────────────────────────────────────────────────────────────

test('formatKst·shiftSchedule: 한국 시간 표기와 n일 밀기(간격·요일 구조 보존)', () => {
  assert.equal(formatKst('2026-11-01T01:00:00.000Z'), '2026-11-01 10:00');
  assert.equal(formatKst(new FakeTimestamp(Date.UTC(2026, 10, 9, 15, 0))), '2026-11-10 00:00');
  assert.equal(formatKst(undefined), 'n/a');
  assert.deepEqual(shiftSchedule(CURRENT_SCHEDULE, 21), SHIFTED_21);
  // Timestamp 값도 민다
  const asTimestamp = Object.fromEntries(
    Object.entries(CURRENT_SCHEDULE).map(([k, v]) =>
      k === 'timezone' ? [k, v] : [k, new FakeTimestamp(Date.parse(v))],
    ),
  );
  assert.deepEqual(shiftSchedule(asTimestamp, 21), SHIFTED_21);
  assert.throws(() => shiftSchedule({ ...CURRENT_SCHEDULE, auctionAt: 'x' }, 7), /auctionAt/);
});

test('assertScheduleOrder·parseExplicitSchedule: API와 같은 순서 규칙', () => {
  assert.doesNotThrow(() => assertScheduleOrder(CURRENT_SCHEDULE));
  assert.throws(
    () => assertScheduleOrder({ ...CURRENT_SCHEDULE, auctionAt: '2026-11-08T14:00:00.000Z' }),
    /순서/,
  );
  assert.throws(
    () => assertScheduleOrder({ ...CURRENT_SCHEDULE, deliveryEndAt: undefined }),
    /순서/,
  );
  assert.deepEqual(
    parseExplicitSchedule(
      '2026-11-22 10:00|2026-11-30 00:00|2026-11-30 07:00|2026-12-01 00:00|2026-12-01 09:00',
    ),
    SHIFTED_21,
  );
  assert.throws(() => parseExplicitSchedule('2026-11-22 10:00|2026-11-30 00:00'), /5개/);
  assert.throws(
    () =>
      parseExplicitSchedule(
        '2026-11-22 10:00|2026-11-30 00:00|2026-11-29 07:00|2026-12-01 00:00|2026-12-01 09:00',
      ),
    /순서/,
  );
  assert.throws(
    () =>
      parseExplicitSchedule(
        '2026-11-31 10:00|2026-12-07 00:00|2026-12-07 07:00|2026-12-08 00:00|2026-12-08 09:00',
      ),
    /달력에 없는/,
  );
});

test('readInputs: check는 회차 id만, reschedule은 SHIFT_DAYS·SCHEDULE 중 하나와 선택 이름', () => {
  assert.deepEqual(readInputs({ ROUND_ID: ROUND }), { mode: 'check', roundId: ROUND });
  assert.deepEqual(inputsOf({ ROUND_SHIFT_DAYS: ' 21 ', ROUND_NAME: ' 12월 1일 배송 회차 ' }), {
    mode: 'reschedule',
    roundId: ROUND,
    shiftDays: 21,
    schedule: null,
    name: '12월 1일 배송 회차',
  });
  assert.deepEqual(
    inputsOf({
      ROUND_SCHEDULE:
        '2026-11-22 10:00|2026-11-30 00:00|2026-11-30 07:00|2026-12-01 00:00|2026-12-01 09:00',
    }),
    { mode: 'reschedule', roundId: ROUND, shiftDays: null, schedule: SHIFTED_21, name: null },
  );
  assert.throws(() => readInputs({ ROUND_ID: ROUND, ROUND_MODE: 'create' }), /ROUND_MODE/);
  assert.throws(() => readInputs({ ROUND_ID: 'not-a-uuid' }), /ROUND_ID/);
  assert.throws(() => inputsOf({}), /하나만/);
  assert.throws(() => inputsOf({ ROUND_SHIFT_DAYS: '7', ROUND_SCHEDULE: 'x|x|x|x|x' }), /하나만/);
  for (const bad of ['0', '91', '1.5', 'a', '-7']) {
    assert.throws(() => inputsOf({ ROUND_SHIFT_DAYS: bad }), /ROUND_SHIFT_DAYS/);
  }
  assert.throws(
    () => inputsOf({ ROUND_SHIFT_DAYS: '7', ROUND_NAME: 'x'.repeat(41) }),
    /ROUND_NAME/,
  );
  assert.throws(() => inputsOf({ ROUND_SHIFT_DAYS: '7', ROUND_NAME: 'a\u0007b' }), /ROUND_NAME/);
});

test('planReschedule: 밀린 일정·새 이름만 update로 내고 거부 조건을 지킨다', () => {
  const inputs = inputsOf({ ROUND_SHIFT_DAYS: '21', ROUND_NAME: '12월 1일 배송 회차' });
  assert.deepEqual(planReschedule({ round: existingRound(), inputs, nowMillis: NOW }), {
    schedule: SHIFTED_21,
    name: '12월 1일 배송 회차',
  });
  // 이름이 같으면 name을 내지 않는다
  assert.deepEqual(
    planReschedule({
      round: existingRound(),
      inputs: inputsOf({ ROUND_SHIFT_DAYS: '7' }),
      nowMillis: NOW,
    }),
    { schedule: shiftSchedule(CURRENT_SCHEDULE, 7) },
  );
  const rejects = [
    [existingRound({ status: 'OPEN' }), inputs, NOW, /판매 예정/],
    [existingRound({ status: 'CANCELLED' }), inputs, NOW, /판매 예정/],
    [existingRound({ cancellation: { status: 'CANCELLING' } }), inputs, NOW, /판매 예정/],
    // 주문 시작이 이미 지남(자동 OPEN)
    [existingRound(), inputs, Date.parse(CURRENT_SCHEDULE.orderOpenAt), /이미 지난/],
    [existingRound({ counters: { reservedItemQuantity: 1 } }), inputs, NOW, /예약 또는 주문/],
    [existingRound({ counters: { heldOrderCount: 1 } }), inputs, NOW, /예약 또는 주문/],
    // 명시 일정이 기존보다 이르면 거부(앞당기기 금지)
    [
      existingRound(),
      inputsOf({
        ROUND_SCHEDULE:
          '2026-10-30 10:00|2026-11-08 00:00|2026-11-08 07:00|2026-11-09 00:00|2026-11-09 09:00',
      }),
      NOW,
      /늦어야/,
    ],
    [
      existingRound({ schedule: { ...CURRENT_SCHEDULE, orderOpenAt: 'bad' } }),
      inputs,
      NOW,
      /읽을 수 없/,
    ],
  ];
  for (const [round, roundInputs, nowMillis, pattern] of rejects) {
    assert.throws(() => planReschedule({ round, inputs: roundInputs, nowMillis }), pattern);
  }
});

// ── run ───────────────────────────────────────────────────────────────────────

test('check: 회차 이름·상태·일정(KST)만 보여주고 아무것도 쓰지 않는다', async () => {
  const h = harness({ seed: seeded() });
  assert.equal(await h.run(), 0);
  assert.equal(h.connected(), 1);
  assert.match(h.output(), /mode: check/);
  assert.match(h.output(), /name: 11월 10일 배송 회차/);
  assert.match(h.output(), /status: SCHEDULED/);
  assert.match(h.output(), /orderOpenAt: 2026-11-01 10:00 KST/);
  assert.match(h.output(), /deliveryEndAt: 2026-11-10 09:00 KST/);
  assert.doesNotMatch(h.output(), /IdPrefix/);
  assert.deepEqual(h.fake.writes, []);
});

test('check: 없는 회차는 not-found로 exit 1', async () => {
  const h = harness({ seed: {} });
  assert.equal(await h.run(), 1);
  assert.match(h.output(), /result: not-found/);
  assert.deepEqual(h.fake.writes, []);
});

test('reschedule: 일정 5개를 21일 뒤로 밀고 이름을 바꾸며 updatedAt·감사 기록을 남긴다', async () => {
  const h = harness({
    seed: {
      ...seeded(),
      [`saleRounds/${OTHER_ROUND}`]: existingRound({
        id: OTHER_ROUND,
        name: '11월 특별 회차',
      }),
    },
    env: { ROUND_MODE: 'reschedule', ROUND_SHIFT_DAYS: '21', ROUND_NAME: '12월 1일 배송 회차' },
  });
  assert.equal(await h.run(), 0);
  const updated = h.fake.docs.get(`saleRounds/${ROUND}`);
  assert.equal(updated.name, '12월 1일 배송 회차');
  assert.deepEqual(updated.schedule, SHIFTED_21);
  assert.equal(updated.updatedAt.toMillis(), NOW);
  // 상품·한도·상태·지역은 그대로
  assert.equal(updated.status, 'SCHEDULED');
  assert.deepEqual(updated.limits, { maxDeliveryAddresses: 15, maxItemQuantity: 30 });
  assert.deepEqual(
    h.fake.writes.map(([kind, path]) => [kind, path.split('/')[0]]),
    [
      ['update', 'saleRounds'],
      ['set', 'auditLogs'],
    ],
  );
  assert.deepEqual(Object.keys(h.fake.writes[0][2]).sort(), ['name', 'schedule', 'updatedAt']);
  const [audit] = auditsOf(h);
  assert.equal(audit.action, AUDIT_ACTION);
  assert.equal(audit.detail.roundId, ROUND);
  assert.equal(audit.detail.shiftDays, 21);
  assert.deepEqual(audit.detail.before, {
    name: '11월 10일 배송 회차',
    schedule: CURRENT_SCHEDULE,
  });
  assert.deepEqual(audit.detail.after, { name: '12월 1일 배송 회차', schedule: SHIFTED_21 });
  // 다른 회차는 그대로
  assert.equal(h.fake.docs.get(`saleRounds/${OTHER_ROUND}`).name, '11월 특별 회차');
  assert.match(h.output(), /result: rescheduled/);
  assert.match(h.output(), /after\.name: 12월 1일 배송 회차/);
  assert.match(h.output(), /after\.orderOpenAt: 2026-11-22 10:00 KST/);
  assert.match(h.output(), /after\.deliveryEndAt: 2026-12-01 09:00 KST/);
});

test('reschedule: 이름 없이 명시 일정만 주면 schedule·updatedAt만 바꾼다', async () => {
  const h = harness({
    seed: seeded(),
    env: {
      ROUND_MODE: 'reschedule',
      ROUND_SCHEDULE:
        '2026-11-22 10:00|2026-11-30 00:00|2026-11-30 07:00|2026-12-01 00:00|2026-12-01 09:00',
    },
  });
  assert.equal(await h.run(), 0);
  assert.deepEqual(Object.keys(h.fake.writes[0][2]).sort(), ['schedule', 'updatedAt']);
  assert.equal(h.fake.docs.get(`saleRounds/${ROUND}`).name, '11월 10일 배송 회차');
  assert.equal(auditsOf(h)[0].detail.shiftDays, null);
  assert.equal(auditsOf(h)[0].detail.after.name, '11월 10일 배송 회차');
});

test('reschedule: 새 이름이 같은 매장의 살아 있는 다른 회차와 같으면 아무것도 바꾸지 않고 exit 1', async () => {
  const h = harness({
    seed: {
      ...seeded(),
      [`saleRounds/${OTHER_ROUND}`]: existingRound({ id: OTHER_ROUND, name: '11월 특별 회차' }),
    },
    env: { ROUND_MODE: 'reschedule', ROUND_SHIFT_DAYS: '21', ROUND_NAME: '11월 특별 회차' },
  });
  assert.equal(await h.run(), 1);
  assert.match(h.output(), /result: name-taken/);
  assert.deepEqual(h.fake.writes, []);
  assert.deepEqual(h.fake.docs.get(`saleRounds/${ROUND}`).schedule, CURRENT_SCHEDULE);
});

test('reschedule: 취소·완료된 회차만 같은 이름이면 바꾼다', async () => {
  const h = harness({
    seed: {
      ...seeded(),
      [`saleRounds/${OTHER_ROUND}`]: existingRound({
        id: OTHER_ROUND,
        name: '12월 1일 배송 회차',
        status: 'CANCELLED',
      }),
    },
    env: { ROUND_MODE: 'reschedule', ROUND_SHIFT_DAYS: '21', ROUND_NAME: '12월 1일 배송 회차' },
  });
  assert.equal(await h.run(), 0);
  assert.equal(h.fake.docs.get(`saleRounds/${ROUND}`).name, '12월 1일 배송 회차');
});

test('reschedule: 이미 열렸거나 예약이 있는 회차는 트랜잭션 안에서 거부하고 아무것도 쓰지 않는다', async () => {
  for (const [overrides, pattern] of [
    [{ status: 'OPEN' }, /판매 예정/],
    [{ counters: { orderedItemQuantity: 1 } }, /예약 또는 주문/],
  ]) {
    const h = harness({
      seed: seeded(overrides),
      env: { ROUND_MODE: 'reschedule', ROUND_SHIFT_DAYS: '21' },
    });
    assert.equal(await h.run(), 1);
    assert.match(h.output(), pattern);
    assert.deepEqual(h.fake.writes, []);
    assert.equal(auditsOf(h).length, 0);
  }
  // 주문 시작 시각이 지난 SCHEDULED 회차(자동 OPEN)
  const h = harness({
    seed: seeded({ schedule: { ...CURRENT_SCHEDULE, orderOpenAt: '2026-10-27T01:00:00.000Z' } }),
    env: { ROUND_MODE: 'reschedule', ROUND_SHIFT_DAYS: '21' },
  });
  assert.equal(await h.run(), 1);
  assert.match(h.output(), /이미 지난/);
  assert.deepEqual(h.fake.writes, []);
});

test('--detail은 CI 환경에서 연결 전에 거부하고, 운영이 아닌 키도 연결 전에 거부한다', async () => {
  const ci = harness({ seed: seeded(), argv: ['--detail'], env: { GITHUB_ACTIONS: 'true' } });
  assert.equal(await ci.run(), 1);
  assert.equal(ci.connected(), 0);

  const staging = harness({ seed: seeded(), project: 'green-staging' });
  assert.equal(await staging.run(), 1);
  assert.equal(staging.connected(), 0);
  assert.match(staging.output(), /운영\(green-e4fe3\)이 아니어서/);

  const local = harness({ seed: seeded(), argv: ['--detail'] });
  assert.equal(await local.run(), 0);
  assert.match(local.output(), /roundIdPrefix: e8ca686f/);
  assert.match(local.output(), /storeIdPrefix: 80189070/);
});

test('reschedule 입력이 모자라면 연결 전에 거부한다', async () => {
  const h = harness({ seed: seeded(), env: { ROUND_MODE: 'reschedule' } });
  assert.equal(await h.run(), 1);
  assert.equal(h.connected(), 0);
  assert.match(h.output(), /하나만/);
});
