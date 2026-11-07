import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

// 판정·표기는 실제 공용 도우미(@/lib/round-schedule-label)를 읽어 쓴다.
const labelSource = await readFile(new URL('./round-schedule-label.ts', import.meta.url), 'utf8');
const labelModule = { exports: {} };
new Function('module', 'exports', transpile(labelSource))(labelModule, labelModule.exports);

const source = await readFile(new URL('./round-next-notice.ts', import.meta.url), 'utf8');
const noticeModule = { exports: {} };
new Function('require', 'module', 'exports', transpile(source))(
  (specifier) => {
    if (specifier === '@/lib/round-schedule-label') return labelModule.exports;
    throw new Error(`예상하지 못한 모듈 요청: ${specifier}`);
  },
  noticeModule,
  noticeModule.exports,
);
const { findNextRoundAfterClose, formatNextRoundNotice } = noticeModule.exports;

// 2026-11-07 18:00 KST = 2026-11-07 09:00 UTC
const closeAt = '2026-11-07T09:00:00.000Z';
const afterClose = Date.parse(closeAt) + 60_000;
const round = (id, status, orderOpenAt, orderCloseAt) => ({
  id,
  status,
  schedule: { orderOpenAt, orderCloseAt },
});
const closed = round('r1', 'CLOSED', '2026-11-01T01:00:00.000Z', closeAt);
// 2026-11-14 10:00 KST
const nextWeek = round('r2', 'SCHEDULED', '2026-11-14T01:00:00.000Z', '2026-11-15T09:00:00.000Z');
// 2026-11-21 10:00 KST
const twoWeeks = round('r3', 'SCHEDULED', '2026-11-21T01:00:00.000Z', '2026-11-22T09:00:00.000Z');

test('마감된 회차 뒤 주문 시작 전 판매 예정 회차 중 가장 먼저 열리는 회차를 고른다', () => {
  assert.equal(findNextRoundAfterClose([twoWeeks, closed, nextWeek], closed, afterClose), nextWeek);
});

test('판매 중 상태여도 기기 시계로 마감이 지났으면 다음 회차를 찾는다', () => {
  const openPastClose = { ...closed, status: 'OPEN' };
  assert.equal(findNextRoundAfterClose([openPastClose, nextWeek], openPastClose, afterClose), nextWeek);
});

test('보이는 회차가 아직 주문을 받는 중이면 안내하지 않는다', () => {
  const open = { ...closed, status: 'OPEN' };
  assert.equal(findNextRoundAfterClose([open, nextWeek], open, Date.parse(closeAt) - 1), null);
});

test('다음 회차가 없으면 안내하지 않는다(보이는 회차·지난 회차·시작 시각이 지났거나 잘못된 회차)', () => {
  const completed = round('r0', 'COMPLETED', '2026-10-25T01:00:00.000Z', '2026-10-31T09:00:00.000Z');
  const startedScheduled = round('r4', 'SCHEDULED', '2026-11-07T08:00:00.000Z', '2026-11-08T09:00:00.000Z');
  const invalid = round('r5', 'SCHEDULED', 'not-a-date', '2026-11-08T09:00:00.000Z');
  const draftLike = round('r6', 'CANCELLED', '2026-11-14T01:00:00.000Z', '2026-11-15T09:00:00.000Z');
  assert.equal(
    findNextRoundAfterClose([closed, completed, startedScheduled, invalid, draftLike], closed, afterClose),
    null,
  );
  assert.equal(findNextRoundAfterClose([], closed, afterClose), null);
  assert.equal(findNextRoundAfterClose([nextWeek], null, afterClose), null);
  assert.equal(findNextRoundAfterClose([nextWeek], closed, Number.NaN), null);
});

test('주문 시작 시각이 정확히 지금이면 다음 회차로 보지 않는다', () => {
  const openingNow = round('r7', 'SCHEDULED', new Date(afterClose).toISOString(), '2026-11-15T09:00:00.000Z');
  assert.equal(findNextRoundAfterClose([openingNow], closed, afterClose), null);
});

test('다음 회차 안내는 회차 일정 표기로 주문 시작 시각을 쓴다', () => {
  assert.equal(formatNextRoundNotice(nextWeek), '다음 회차는 11월 14일(토) 오전 10시에 주문을 받아요');
});

test('0시대 주문 시작은 전날 밤 12시로 읽히게 쓴다', () => {
  // 2026-11-15 00:30 KST = 2026-11-14 15:30 UTC
  const midnight = round('r8', 'SCHEDULED', '2026-11-14T15:30:00.000Z', '2026-11-16T09:00:00.000Z');
  assert.equal(formatNextRoundNotice(midnight), '다음 회차는 11월 14일(토) 밤 12시 30분에 주문을 받아요');
});

test('시작 시각을 읽을 수 없으면 안내 문구를 만들지 않는다', () => {
  assert.equal(formatNextRoundNotice(round('r9', 'SCHEDULED', 'bad', 'bad')), null);
});
