import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./round-schedule-label.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function('module', 'exports', compiled)(module, module.exports);
const {
  formatRoundTime,
  formatRoundDay,
  formatOrderCloseLabel,
  formatOrderOpenLabel,
  formatOrderCloseStatus,
  isRoundOrderClosed,
  roundSectionTitle,
} = module.exports;

test('한국시간 자정은 전날 밤 12시로 표기한다', () => {
  // 2026-11-09 00:00 KST = 2026-11-08 15:00 UTC
  assert.equal(formatRoundTime('2026-11-08T15:00:00.000Z'), '11월 8일(일) 밤 12시');
  assert.equal(formatOrderCloseLabel('2026-11-08T15:00:00.000Z'), '11월 8일(일) 밤 12시까지');
});

test('오전·오후와 분을 한국시간으로 표기한다', () => {
  // 2026-11-01 10:00 KST
  assert.equal(formatOrderOpenLabel('2026-11-01T01:00:00.000Z'), '11월 1일(일) 오전 10시 주문 시작');
  // 2026-11-01 12:00 KST, 2026-11-01 15:30 KST
  assert.equal(formatRoundTime('2026-11-01T03:00:00.000Z'), '11월 1일(일) 오후 12시');
  assert.equal(formatRoundTime('2026-11-01T06:30:00.000Z'), '11월 1일(일) 오후 3시 30분');
});

test('0시대는 "오전 12시 n분"이 아니라 전날 "밤 12시 n분"으로 표기한다', () => {
  // 2026-11-07 00:09 KST = 2026-11-06 15:09 UTC
  assert.equal(formatRoundTime('2026-11-06T15:09:00.000Z'), '11월 6일(금) 밤 12시 9분');
  // 2026-11-09 00:44 KST
  assert.equal(formatRoundTime('2026-11-08T15:44:00.000Z'), '11월 8일(일) 밤 12시 44분');
  assert.equal(formatOrderCloseLabel('2026-11-08T15:44:00.000Z'), '11월 8일(일) 밤 12시 44분까지');
  // 낮 12시대는 그대로 오후 12시다. 2026-11-01 12:44 KST
  assert.equal(formatRoundTime('2026-11-01T03:44:00.000Z'), '11월 1일(일) 오후 12시 44분');
  // 오전 1시는 그대로 오전이다. 2026-11-09 01:00 KST
  assert.equal(formatRoundTime('2026-11-08T16:00:00.000Z'), '11월 9일(월) 오전 1시');
});

test('월말 자정도 전날 날짜로 넘긴다', () => {
  // 2026-12-01 00:00 KST
  assert.equal(formatRoundTime('2026-11-30T15:00:00.000Z'), '11월 30일(월) 밤 12시');
});

test('잘못된 값은 확인 중 문구로 대체한다', () => {
  assert.equal(formatRoundTime('not-a-date'), null);
  assert.equal(formatOrderCloseLabel('not-a-date'), '일정 확인 중');
  assert.equal(formatOrderOpenLabel('not-a-date'), '주문 시작 일정 확인 중');
});

test('주문 시작 전 회차만 판매 예정 제목을 쓴다', () => {
  assert.equal(roundSectionTitle('SCHEDULED'), '판매 예정');
  assert.equal(roundSectionTitle('OPEN'), '이번 주 판매');
  assert.equal(roundSectionTitle('CLOSED'), '이번 주 판매');
});

test('배송일은 "12월 1일(화)"로 쓰고 자정은 전날로 읽는다', () => {
  // 2026-12-01 09:00 KST
  assert.equal(formatRoundDay('2026-12-01T00:00:00.000Z'), '12월 1일(화)');
  // 2026-11-09 00:00 KST → 11월 8일(일)
  assert.equal(formatRoundDay('2026-11-08T15:00:00.000Z'), '11월 8일(일)');
  // 2026-11-09 00:30 KST도 formatRoundTime과 같이 전날로 읽는다.
  assert.equal(formatRoundDay('2026-11-08T15:30:00.000Z'), '11월 8일(일)');
  assert.equal(formatRoundDay('not-a-date'), null);
});

// 2026-11-07 00:09 KST
const CLOSE_AT = '2026-11-06T15:09:00.000Z';
const CLOSE_MS = Date.parse(CLOSE_AT);
const roundOf = (status, orderCloseAt = CLOSE_AT) => ({ status, schedule: { orderCloseAt } });

test('판매 중 회차는 주문 마감 시각이 지나야 끝난 것으로 본다(시계 주입)', () => {
  assert.equal(isRoundOrderClosed(roundOf('OPEN'), CLOSE_MS - 1), false);
  assert.equal(isRoundOrderClosed(roundOf('OPEN'), CLOSE_MS), true);
  assert.equal(isRoundOrderClosed(roundOf('OPEN'), CLOSE_MS + 60_000), true);
  assert.equal(isRoundOrderClosed(roundOf('SCHEDULED'), CLOSE_MS - 1), false);
});

test('마감·완료·취소 회차는 시각과 상관없이 끝났고, 잘못된 마감 시각은 상태로만 판단한다', () => {
  for (const status of ['CLOSED', 'COMPLETED', 'CANCELLED']) {
    assert.equal(isRoundOrderClosed(roundOf(status), CLOSE_MS - 60_000), true);
  }
  assert.equal(isRoundOrderClosed(roundOf('OPEN', 'not-a-date'), CLOSE_MS), false);
  assert.equal(isRoundOrderClosed(roundOf('CLOSED', 'not-a-date'), CLOSE_MS), true);
});

test('지난 주문 마감에는 "까지"를 붙이지 않고 "주문 마감됨"으로 쓴다', () => {
  assert.equal(formatOrderCloseStatus(CLOSE_AT, false), '주문 마감 11월 6일(금) 밤 12시 9분까지');
  assert.equal(formatOrderCloseStatus(CLOSE_AT, true), '주문 마감됨 · 11월 6일(금) 밤 12시 9분');
  assert.equal(formatOrderCloseStatus('not-a-date', false), '주문 마감 일정 확인 중');
  assert.equal(formatOrderCloseStatus('not-a-date', true), '주문 마감됨');
});
