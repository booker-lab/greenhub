import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const holdLimitModule = { exports: {} };
new Function(
  'module',
  'exports',
  ts.transpileModule(await readFile(new URL('./checkout-hold-limit.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
)(holdLimitModule, holdLimitModule.exports);
const {
  CHECKOUT_HOLD_LIMIT_MESSAGE,
  CHECKOUT_HOLD_LIMIT_ORDERS_LABEL,
  CHECKOUT_HOLD_LIMIT_ORDERS_PATH,
  isCheckoutHoldLimitRejection,
} = holdLimitModule.exports;

// 판정과 안내가 기대는 API 사실(한도 거절 문구·만료 15분)을 API 원본에서 직접 읽어 확인한다.
const capacitySource = await readFile(
  new URL('../../../api/src/orders/order-capacity.service.ts', import.meta.url),
  'utf8',
);
const apiHoldLimitMessage = capacitySource.match(
  /const ACTIVE_CHECKOUT_HOLD_LIMIT_MESSAGE =\s*'([^']+)'/,
)?.[1];

test('API의 결제 예약 한도 거절 문구를 그대로 알아본다', () => {
  assert.ok(apiHoldLimitMessage, 'API 한도 거절 문구를 찾지 못했다');
  assert.equal(isCheckoutHoldLimitRejection(409, { message: apiHoldLimitMessage }), true);
  assert.equal(
    isCheckoutHoldLimitRejection(409, {
      statusCode: 409,
      error: 'Conflict',
      message: ` ${apiHoldLimitMessage} `,
    }),
    true,
  );
});

test('상태 코드·문구·본문 형식이 다르면 예약 한도 거절로 보지 않는다', () => {
  for (const status of [400, 404, 408, 422, 429, 500]) {
    assert.equal(
      isCheckoutHoldLimitRejection(status, { message: apiHoldLimitMessage }),
      false,
      `${status}`,
    );
  }
  // 1인 상한·회차 마감·결제 시도 ID 충돌처럼 다른 409는 한도 거절이 아니다.
  for (const message of [
    "'호접란' 상품은 이번 회차에 한 분당 2개까지 주문할 수 있어요. 수량을 줄여 다시 시도해 주세요.",
    '현재 주문 가능한 회차가 아닙니다.',
    '같은 결제 시도 ID에 다른 주문 내용이 요청되었습니다.',
    '이번 회차 배송지 한도가 마감되었습니다.',
  ]) {
    assert.equal(isCheckoutHoldLimitRejection(409, { message }), false, message);
  }
  for (const body of [null, undefined, 'x', [], {}, { message: 1 }, { message: null }]) {
    assert.equal(isCheckoutHoldLimitRejection(409, body), false, JSON.stringify(body));
  }
});

test('안내의 "최대 15분"은 API 예약 만료 시간과 같고, 한도는 만료된 예약을 세지 않는다', () => {
  assert.match(capacitySource, /expiresAt: new Date\(nowMillis \+ 15 \* 60_000\)\.toISOString\(\)/);
  assert.match(capacitySource, /MAX_ACTIVE_CHECKOUT_HOLDS_PER_USER_ROUND = 3;/);
  assert.match(
    capacitySource,
    /return !\(new Date\(held\.expiresAt \?\? ''\)\.getTime\(\) <= nowMillis\);/,
  );
  assert.match(CHECKOUT_HOLD_LIMIT_MESSAGE, /최대 15분/);
});

test('안내는 고객 기준 해요체이고 내부 용어·영문 원문이 없으며 주문 내역으로 보낸다', () => {
  assert.equal(
    CHECKOUT_HOLD_LIMIT_MESSAGE,
    '결제를 마치지 않은 이전 결제 시도가 있어 지금은 결제할 수 없어요. 이전 결제 시도가 정리되면(최대 15분) 다시 결제할 수 있어요.',
  );
  for (const text of [CHECKOUT_HOLD_LIMIT_MESSAGE, CHECKOUT_HOLD_LIMIT_ORDERS_LABEL]) {
    assert.doesNotMatch(text, /니다|서버|예약|한도|[A-Za-z]/, text);
  }
  assert.equal(CHECKOUT_HOLD_LIMIT_ORDERS_LABEL, '주문 내역 보기');
  assert.equal(CHECKOUT_HOLD_LIMIT_ORDERS_PATH, '/mypage');
});
