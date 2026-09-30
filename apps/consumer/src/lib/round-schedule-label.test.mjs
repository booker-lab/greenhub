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
const { formatRoundTime, formatOrderCloseLabel, formatOrderOpenLabel, roundSectionTitle } =
  module.exports;

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
