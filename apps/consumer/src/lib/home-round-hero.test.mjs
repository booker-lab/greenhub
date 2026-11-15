import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

// 시각 계산·문구는 실제 공용 도우미(round-schedule-label, round-countdown)를 읽어 쓴다.
async function load(file, requireMap = {}) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const module = { exports: {} };
  new Function('require', 'module', 'exports', transpile(source))(
    (specifier) => {
      if (specifier in requireMap) return requireMap[specifier];
      throw new Error(`예상하지 못한 모듈 요청: ${specifier}`);
    },
    module,
    module.exports,
  );
  return module.exports;
}
const label = await load('./round-schedule-label.ts');
const countdown = await load('./round-countdown.ts');
const { homeRoundHeroState } = await load('./home-round-hero.ts', {
  '@/lib/round-schedule-label': label,
  '@/lib/round-countdown': countdown,
});

// 주문 11월 9일(월) 오전 10시 ~ 11월 15일(일) 밤 12시, 경매 11월 16일(월) 오전 5시, 도착 11월 17일(화) 오전 9시(KST)
const schedule = {
  orderOpenAt: '2026-11-09T01:00:00.000Z',
  orderCloseAt: '2026-11-15T15:00:00.000Z',
  auctionAt: '2026-11-15T20:00:00.000Z',
  deliveryStartAt: '2026-11-16T21:00:00.000Z',
  deliveryEndAt: '2026-11-17T00:00:00.000Z',
  timezone: 'Asia/Seoul',
};
const OPEN_MS = Date.parse(schedule.orderOpenAt);
const CLOSE_MS = Date.parse(schedule.orderCloseAt);
const round = (status, overrides = {}) => ({ status, schedule: { ...schedule, ...overrides } });
const currentKeys = (state) => state.steps.filter((step) => step.current).map((step) => step.key);

test('주문 받는 중: 배송일 제목, 마감까지 세는 알약, 지금 단계는 주문', () => {
  const state = homeRoundHeroState(round('OPEN'), CLOSE_MS - 60_000);
  assert.equal(state.kind, 'open');
  assert.equal(state.deliveryDate, '11월 17일');
  assert.deepEqual(state.countdown, { label: '마감까지', at: schedule.orderCloseAt });
  assert.deepEqual(currentKeys(state), ['order']);
  assert.deepEqual(
    state.steps.map((step) => [step.label, step.time]),
    [
      ['주문', '11월 9일(월) 오전 10시부터'],
      ['마감', '11월 15일(일) 밤 12시까지'],
      ['새벽 경매', '11월 16일(월) 오전 5시'],
      ['문 앞', '11월 17일(화) 오전 9시까지'],
    ],
  );
});

test('판매 예정: 주문 시작까지 세고 아직 어느 단계도 지금이 아니다', () => {
  const state = homeRoundHeroState(round('SCHEDULED'), OPEN_MS - 3_600_000);
  assert.equal(state.kind, 'scheduled');
  assert.equal(state.deliveryDate, '11월 17일');
  assert.deepEqual(state.countdown, { label: '주문 시작까지', at: schedule.orderOpenAt });
  assert.deepEqual(currentKeys(state), []);
});

test('마감 시각이 지난 OPEN 회차는 서버 상태가 바뀌기 전에도 마감 뒤로 본다', () => {
  for (const now of [CLOSE_MS, CLOSE_MS + 60_000]) {
    const state = homeRoundHeroState(round('OPEN'), now);
    assert.equal(state.kind, 'closed');
    assert.equal('countdown' in state, false);
    assert.deepEqual(currentKeys(state), ['close']);
    // 지난 마감에는 "까지"를 붙이지 않는다.
    assert.equal(state.steps[1].time, '11월 15일(일) 밤 12시');
  }
  assert.equal(homeRoundHeroState(round('OPEN'), CLOSE_MS - 1).kind, 'open');
});

test('CLOSED 회차는 시각과 상관없이 마감 뒤이고 배송일 제목은 남는다', () => {
  const state = homeRoundHeroState(round('CLOSED'), OPEN_MS);
  assert.equal(state.kind, 'closed');
  assert.equal(state.deliveryDate, '11월 17일');
  assert.equal('countdown' in state, false);
  assert.deepEqual(currentKeys(state), ['close']);
});

test('회차가 없거나 완료·취소·초안이면 제목 구역을 두지 않는다', () => {
  assert.deepEqual(homeRoundHeroState(null, CLOSE_MS), { kind: 'none' });
  assert.deepEqual(homeRoundHeroState(undefined, CLOSE_MS), { kind: 'none' });
  for (const status of ['COMPLETED', 'CANCELLED', 'DRAFT']) {
    assert.deepEqual(homeRoundHeroState(round(status), CLOSE_MS - 60_000), { kind: 'none' });
  }
  assert.deepEqual(homeRoundHeroState({ status: 'OPEN' }, CLOSE_MS), { kind: 'none' });
});

test('도착일을 읽지 못하면 제목 구역을 두지 않는다', () => {
  for (const deliveryEndAt of ['not-a-date', '', null, undefined, 0]) {
    assert.deepEqual(homeRoundHeroState(round('OPEN', { deliveryEndAt }), CLOSE_MS - 60_000), {
      kind: 'none',
    });
  }
});

test('자정 도착은 전날 날짜로 제목을 쓴다(기존 0시대 규칙)', () => {
  // 2026-11-17 00:00 KST → 11월 16일, 2026-11-17 00:30 KST → 11월 16일
  for (const deliveryEndAt of ['2026-11-16T15:00:00.000Z', '2026-11-16T15:30:00.000Z']) {
    const state = homeRoundHeroState(round('OPEN', { deliveryEndAt }), CLOSE_MS - 60_000);
    assert.equal(state.deliveryDate, '11월 16일');
  }
  // 2026-12-01 00:00 KST → 11월 30일(월을 넘긴다)
  const monthEnd = homeRoundHeroState(
    round('OPEN', { deliveryEndAt: '2026-11-30T15:00:00.000Z' }),
    CLOSE_MS - 60_000,
  );
  assert.equal(monthEnd.deliveryDate, '11월 30일');
  assert.equal(monthEnd.steps[3].time, '11월 30일(월) 밤 12시까지');
});

test('잘못된 일정 값은 알약을 빼고 날짜 자리에 확인 중 문구를 쓴다(null·NaN 글자 없음)', () => {
  const open = homeRoundHeroState(
    round('OPEN', { orderCloseAt: 'not-a-date', auctionAt: null, orderOpenAt: undefined }),
    CLOSE_MS + 60_000,
  );
  // 마감 시각을 읽지 못하면 상태로만 판단한다(주문 받는 중).
  assert.equal(open.kind, 'open');
  assert.equal(open.countdown, null);
  assert.deepEqual(
    open.steps.map((step) => step.time),
    ['일정 확인 중', '일정 확인 중', '일정 확인 중', '11월 17일(화) 오전 9시까지'],
  );

  const scheduled = homeRoundHeroState(round('SCHEDULED', { orderOpenAt: 'not-a-date' }), OPEN_MS);
  assert.equal(scheduled.kind, 'scheduled');
  assert.equal(scheduled.countdown, null);

  const closed = homeRoundHeroState(round('CLOSED', { orderCloseAt: 'not-a-date' }), OPEN_MS);
  assert.equal(closed.kind, 'closed');
  assert.equal(closed.steps[1].time, '일정 확인 중');

  for (const state of [open, scheduled, closed]) {
    assert.doesNotMatch(JSON.stringify(state), /null일|NaN|undefined|Invalid/);
  }
});

test('지금 시각을 읽지 못해도 회차 상태로 판단한다', () => {
  assert.equal(homeRoundHeroState(round('OPEN'), Number.NaN).kind, 'open');
  assert.equal(homeRoundHeroState(round('CLOSED'), Number.NaN).kind, 'closed');
});
