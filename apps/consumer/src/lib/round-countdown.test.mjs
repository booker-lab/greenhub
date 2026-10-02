import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./round-countdown.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function('module', 'exports', compiled)(module, module.exports);
const { countdownTarget, formatCountdown, deliveryDayTag } = module.exports;

const schedule = {
  orderOpenAt: '2026-11-01T01:00:00.000Z',
  orderCloseAt: '2026-11-08T15:00:00.000Z',
};

test('주문 받는 중이면 마감까지, 판매 예정이면 주문 시작까지 센다', () => {
  assert.deepEqual(countdownTarget('OPEN', schedule), {
    label: '이번 회차 마감까지',
    at: schedule.orderCloseAt,
  });
  assert.deepEqual(countdownTarget('SCHEDULED', schedule), {
    label: '주문 시작까지',
    at: schedule.orderOpenAt,
  });
});

test('마감·완료·취소·초안 회차는 띠를 숨긴다', () => {
  for (const status of ['CLOSED', 'COMPLETED', 'CANCELLED', 'DRAFT']) {
    assert.equal(countdownTarget(status, schedule), null);
  }
});

test('띠 문구는 홈의 "주문 마감" 안내와 겹치지 않는다', () => {
  for (const status of ['OPEN', 'SCHEDULED']) {
    assert.doesNotMatch(countdownTarget(status, schedule).label, /주문 마감/);
  }
});

test('남은 시간은 하루 이상이면 일수를 붙이고 시·분·초는 두 자리로 맞춘다', () => {
  const ms = (d, h, m, s) => (((d * 24 + h) * 60 + m) * 60 + s) * 1000;
  assert.equal(formatCountdown(ms(2, 14, 32, 7)), '2일 14:32:07');
  assert.equal(formatCountdown(ms(0, 3, 5, 9)), '03:05:09');
  assert.equal(formatCountdown(ms(0, 0, 0, 0) + 999), '00:00:00');
});

test('이미 지났거나 잘못된 값이면 00:00:00', () => {
  assert.equal(formatCountdown(-5000), '00:00:00');
  assert.equal(formatCountdown(Number.NaN), '00:00:00');
});

test('배송 태그는 한국시간 요일을 쓴다', () => {
  // 2026-11-09T15:00Z = 11월 10일(화) 00:00 KST
  assert.equal(deliveryDayTag('2026-11-09T15:00:00.000Z'), '화 아침 도착');
  assert.equal(deliveryDayTag('not-a-date'), null);
});
