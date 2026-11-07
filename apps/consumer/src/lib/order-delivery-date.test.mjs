import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./order-delivery-date.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'order-delivery-date.ts',
}).outputText;
const dateModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  () => {
    throw new Error('예상하지 못한 모듈 요청');
  },
  dateModule,
  dateModule.exports,
);
const { formatOrderDeliveryDate } = dateModule.exports;

const detailSource = await readFile(
  new URL('../app/mypage/orders/[id]/_client.tsx', import.meta.url),
  'utf8',
);

test('달력 날짜(YYYY-MM-DD)는 월·일·요일로 보인다', () => {
  assert.equal(formatOrderDeliveryDate('2026-11-10'), '11월 10일(화)');
  assert.equal(formatOrderDeliveryDate('2026-07-21'), '7월 21일(화)');
  assert.equal(formatOrderDeliveryDate('2027-01-01'), '1월 1일(금)');
  assert.equal(formatOrderDeliveryDate(' 2026-11-10 '), '11월 10일(화)');
});

test('시각이 붙은 ISO 값은 한국 시간 날짜로 읽는다', () => {
  // UTC 15:00 = 다음 날 한국 0시
  assert.equal(formatOrderDeliveryDate('2026-11-09T15:00:00.000Z'), '11월 10일(화)');
  assert.equal(formatOrderDeliveryDate('2026-11-10T14:59:59Z'), '11월 10일(화)');
  assert.equal(formatOrderDeliveryDate('2026-11-10T15:00:00Z'), '11월 11일(수)');
  assert.equal(formatOrderDeliveryDate('2026-11-10T09:00:00+09:00'), '11월 10일(화)');
});

test('읽을 수 없는 값은 null이다', () => {
  for (const value of [
    null,
    undefined,
    '',
    '   ',
    20261110,
    '2026-02-30',
    '2026-13-01',
    '2026/11/10',
    'Nov 10 2026',
    '2026-11-10Tnot-a-time',
  ]) {
    assert.equal(formatOrderDeliveryDate(value), null, String(value));
  }
});

test('주문 상세 배송 예정일은 ISO 원문 대신 이 형식으로 보인다', () => {
  assert.match(
    detailSource,
    /import \{ formatOrderDeliveryDate \} from '@\/lib\/order-delivery-date'/,
  );
  assert.match(detailSource, /formatOrderDeliveryDate\(detail\.requestedDeliveryDate\)/);
  assert.doesNotMatch(detailSource, /\{detail\.requestedDeliveryDate\.slice\(0, 10\)\}/);
});
