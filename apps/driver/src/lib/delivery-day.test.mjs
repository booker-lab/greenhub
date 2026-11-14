import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDeliveryDayLabel, isSameSeoulDay } from './delivery-day.ts';

// 2026-11-08(일) 서울 오전 8시 = UTC 11-07 23:00. 서울 날짜로는 8일이다.
const NOW_SEOUL_MORNING = new Date('2026-11-07T23:00:00.000Z');

test('오늘(서울 날짜) 배송이면 행에 날짜를 쓰지 않는다', () => {
  // 서울 11-08 10:00
  assert.equal(formatDeliveryDayLabel('2026-11-08T01:00:00.000Z', NOW_SEOUL_MORNING), null);
  // 서울 11-08 00:00(UTC로는 전날)도 오늘이다.
  assert.equal(formatDeliveryDayLabel('2026-11-07T15:00:00.000Z', NOW_SEOUL_MORNING), null);
});

test('오늘이 아닌 배송일은 "11월 10일(화)"처럼 쓴다', () => {
  assert.equal(
    formatDeliveryDayLabel('2026-11-10T01:00:00.000Z', NOW_SEOUL_MORNING),
    '11월 10일(화)',
  );
  // 지난 회차(보류 주문)도 날짜를 쓴다. 서울 11-07 23:59는 어제다.
  assert.equal(
    formatDeliveryDayLabel('2026-11-07T14:59:00.000Z', NOW_SEOUL_MORNING),
    '11월 7일(토)',
  );
});

test('서울 날짜로 판정해 UTC 날짜가 같아도 서울 날짜가 다르면 다른 날이다', () => {
  // 둘 다 UTC 11-07이지만 서울로는 11-07 23:00과 11-08 08:00이다.
  assert.equal(isSameSeoulDay('2026-11-07T14:00:00.000Z', '2026-11-07T23:00:00.000Z'), false);
  assert.equal(
    formatDeliveryDayLabel('2026-11-07T14:00:00.000Z', NOW_SEOUL_MORNING),
    '11월 7일(토)',
  );
  // UTC 날짜는 다르지만 서울 날짜가 같으면 같은 날이다.
  assert.equal(isSameSeoulDay('2026-11-07T15:00:00.000Z', '2026-11-08T14:59:59.000Z'), true);
});

test('해가 다르면 연도를 붙인다', () => {
  assert.equal(
    formatDeliveryDayLabel('2027-01-03T01:00:00.000Z', new Date('2026-12-30T01:00:00.000Z')),
    '2027년 1월 3일(일)',
  );
});

test('배송일이 없거나 읽을 수 없으면 쓰지 않는다', () => {
  for (const value of [undefined, null, '', '   ', 'not-a-date', 0n, {}]) {
    assert.equal(formatDeliveryDayLabel(value, NOW_SEOUL_MORNING), null, String(value));
  }
  assert.equal(formatDeliveryDayLabel('2026-11-10T01:00:00.000Z', new Date(Number.NaN)), null);
});
