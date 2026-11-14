import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadModule(fileName, requireForTest) {
  const source = await readFile(new URL(`./${fileName}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(requireForTest, loaded, loaded.exports);
  return loaded.exports;
}

// 날짜 글자는 실제 order-delivery-date 모듈로 만든다.
const deliveryDateModule = await loadModule('order-delivery-date.ts', () => {
  throw new Error('예상하지 못한 모듈 요청');
});
const { orderCardHeadline, orderCardMethodLine, orderCardOrderedLabel } = await loadModule(
  'order-card-line.ts',
  (specifier) => {
    if (specifier === '@/lib/order-delivery-date') return deliveryDateModule;
    throw new Error(`예상하지 못한 모듈 요청: ${specifier}`);
  },
);

const DATE = '2026-11-10';
const roundOrder = (status, extra = {}) => ({
  status,
  saleType: 'normal',
  deliveryMethod: 'direct',
  requestedDeliveryDate: DATE,
  ...extra,
});

const UPCOMING = ['PENDING', 'ACCEPTED', 'PREPARING', 'DELIVERING', 'DELIVERY_HELD'];
const ARRIVED = ['DELIVERED', 'REVIEWED'];
// 도착을 약속하지 않는 상태: 배송 종결, 공동구매·거점 전용 상태, 모르는 값.
const NO_ARRIVAL_PROMISE = [
  'CLOSED_UNDELIVERED',
  'RECRUITING',
  'CONFIRMED',
  'HUB_ARRIVED',
  'PICKED_UP',
  'UNKNOWN',
  '',
  null,
  undefined,
  // 객체 원형의 속성 이름을 상태로 잘못 읽지 않는다.
  'toString',
  'constructor',
];
const ALL_STATUSES = [...UPCOMING, ...ARRIVED, 'CANCELLED', ...NO_ARRIVAL_PROMISE];

test('회차 직배송 주문은 진행 중이면 "도착 예정", 배송 완료·구매 확정이면 "도착"을 첫 줄에 쓴다', () => {
  for (const status of UPCOMING) {
    assert.equal(orderCardHeadline(roundOrder(status)), '11월 10일(화) 도착 예정', status);
  }
  for (const status of ARRIVED) {
    assert.equal(orderCardHeadline(roundOrder(status)), '11월 10일(화) 도착', status);
  }
});

test('취소된 회차 직배송 주문은 첫 줄을 숨긴다', () => {
  assert.equal(orderCardHeadline(roundOrder('CANCELLED')), null);
});

test('도착을 약속할 수 없는 상태는 도착일 대신 수령 방식을 쓴다', () => {
  for (const status of NO_ARRIVAL_PROMISE) {
    assert.equal(orderCardHeadline(roundOrder(status)), '직배송', String(status));
  }
});

test('택배·거점 픽업 주문은 상태·도착일과 상관없이 수령 방식을 쓴다', () => {
  for (const status of ALL_STATUSES) {
    for (const requestedDeliveryDate of [DATE, null, undefined, '']) {
      assert.equal(
        orderCardHeadline(roundOrder(status, { deliveryMethod: 'parcel', requestedDeliveryDate })),
        '택배',
      );
      assert.equal(
        orderCardHeadline(roundOrder(status, { deliveryMethod: 'hub', requestedDeliveryDate })),
        '거점 픽업',
      );
    }
  }
});

test('공동구매 주문은 도착일이 있어도 "[공동구매]" 머리 글자와 수령 방식을 쓴다', () => {
  for (const status of ALL_STATUSES) {
    assert.equal(orderCardHeadline(roundOrder(status, { saleType: 'group' })), '[공동구매] 직배송');
    assert.equal(
      orderCardHeadline(roundOrder(status, { saleType: 'group', deliveryMethod: 'parcel' })),
      '[공동구매] 택배',
    );
    assert.equal(
      orderCardHeadline(roundOrder(status, { saleType: 'group', deliveryMethod: 'hub' })),
      '[공동구매] 거점 픽업',
    );
  }
  assert.equal(orderCardMethodLine({ saleType: 'group', deliveryMethod: 'hub' }), '[공동구매] 거점 픽업');
});

test('도착일을 읽지 못한 직배송 주문은 지금처럼 수령 방식을 쓴다(취소 포함)', () => {
  const unreadable = [
    null,
    undefined,
    '',
    '   ',
    '2026-13-40',
    '2026-02-30',
    '11월 10일',
    '2026/11/10',
    'not-a-date',
    '2026-11-10T99:99:99Z',
    20261110,
    {},
    Number.NaN,
  ];
  for (const requestedDeliveryDate of unreadable) {
    for (const status of [...UPCOMING, ...ARRIVED, 'CANCELLED']) {
      assert.equal(
        orderCardHeadline(roundOrder(status, { requestedDeliveryDate })),
        '직배송',
        `${status} / ${String(requestedDeliveryDate)}`,
      );
    }
  }
  // 수령 방식 값이 없거나 모르는 값이면 지금처럼 직배송으로 쓰고, 도착일은 쓰지 않는다.
  assert.equal(orderCardHeadline({ status: 'ACCEPTED', requestedDeliveryDate: DATE }), '직배송');
  assert.equal(
    orderCardHeadline(roundOrder('ACCEPTED', { deliveryMethod: 'quick' })),
    '직배송',
  );
  assert.equal(orderCardHeadline({}), '직배송');
});

test('시각이 붙은 도착일은 한국 시간 날짜로 쓴다', () => {
  assert.equal(
    orderCardHeadline(roundOrder('DELIVERING', { requestedDeliveryDate: '2026-11-09T15:00:00.000Z' })),
    '11월 10일(화) 도착 예정',
  );
});

test('긴 상품 이름·큰 금액이 있어도 첫 줄에는 날짜 글자만 들어가고 null·undefined·NaN 글자가 없다', () => {
  const extras = {
    productName: '가'.repeat(30),
    totalAmount: 9_999_999,
    orderItems: [{ productId: 'p-1', productName: '가'.repeat(30), quantity: 99 }],
  };
  const lines = [];
  for (const status of ALL_STATUSES) {
    for (const deliveryMethod of ['direct', 'parcel', 'hub', undefined]) {
      for (const saleType of ['normal', 'group', undefined]) {
        for (const requestedDeliveryDate of [DATE, null, '', '2026-13-40', undefined]) {
          const line = orderCardHeadline({
            ...extras,
            status,
            deliveryMethod,
            saleType,
            requestedDeliveryDate,
          });
          if (line !== null) lines.push(line);
        }
      }
    }
  }
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.doesNotMatch(line, /null|undefined|NaN/);
    assert.ok(line.trim().length > 0 && line === line.trim(), JSON.stringify(line));
    assert.ok(line.length <= 16, line);
  }
  assert.equal(orderCardHeadline(roundOrder('ACCEPTED', extras)), '11월 10일(화) 도착 예정');
});

test('오른쪽 위 날짜에는 "주문" 라벨을 붙이고, 읽을 수 없으면 라벨만 남기지 않는다', () => {
  // 화면은 브라우저 현지 시각으로 쓰므로 현지 시각 정오로 만든다(테스트 시간대와 무관).
  assert.equal(orderCardOrderedLabel(new Date(2026, 10, 6, 12).toISOString()), '11월 6일 주문');
  assert.equal(orderCardOrderedLabel(new Date(2027, 0, 1, 12).toISOString()), '1월 1일 주문');
  for (const value of [null, undefined, '', '   ', 'not-a-date', 0, Number.NaN, {}, { seconds: 1 }]) {
    assert.equal(orderCardOrderedLabel(value), null, String(value));
  }
});
