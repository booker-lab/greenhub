import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

// 마감 시각·상태 판정은 실제 round-schedule-label 모듈(isRoundOrderClosed)을 쓴다.
const scheduleModule = { exports: {} };
new Function(
  'module',
  'exports',
  transpile(await readFile(new URL('./round-schedule-label.ts', import.meta.url), 'utf8')),
)(scheduleModule, scheduleModule.exports);

const closedModule = { exports: {} };
new Function(
  'require',
  'module',
  'exports',
  transpile(await readFile(new URL('./checkout-round-closed.ts', import.meta.url), 'utf8')),
)(
  (specifier) => {
    if (specifier === '@/lib/round-schedule-label') return scheduleModule.exports;
    throw new Error(`예상하지 못한 회차 마감 모듈 요청: ${specifier}`);
  },
  closedModule,
  closedModule.exports,
);
const {
  ROUND_ORDER_CLOSED_MESSAGE,
  isCheckoutRoundClosed,
  isRoundOrderClosedRejection,
  msUntilRoundOrderClose,
} = closedModule.exports;

const contractSource = await readFile(
  new URL('../../../api/src/sale-rounds/sale-round-state.contract.ts', import.meta.url),
  'utf8',
);

const CLOSE_AT = '2026-11-08T15:00:00.000Z';
const CLOSE_AT_MS = Date.parse(CLOSE_AT);
const openRound = { status: 'OPEN', schedule: { orderCloseAt: CLOSE_AT } };

test('마감 안내는 고객 기준 해요체 한 문장이다', () => {
  assert.equal(ROUND_ORDER_CLOSED_MESSAGE, '이번 회차 주문이 마감됐어요.');
});

test('주문 생성 409 거절 중 회차 주문 창이 닫힌 응답만 마감으로 본다', () => {
  assert.equal(
    isRoundOrderClosedRejection(409, { message: '현재 주문 가능한 회차가 아닙니다.' }),
    true,
  );
  assert.equal(isRoundOrderClosedRejection(409, { message: '주문 마감된 회차입니다.' }), true);
  assert.equal(
    isRoundOrderClosedRejection(409, {
      statusCode: 409,
      error: 'Conflict',
      message: ' 현재 주문 가능한 회차가 아닙니다. ',
    }),
    true,
  );

  // 상태 코드가 다르면 문구가 같아도 마감으로 보지 않는다.
  for (const status of [400, 404, 422, 500]) {
    assert.equal(
      isRoundOrderClosedRejection(status, { message: '현재 주문 가능한 회차가 아닙니다.' }),
      false,
    );
  }
  // 같은 409라도 다른 거절(수량 한도·시작 전·결제 시도 충돌)은 마감 안내로 바꾸지 않는다.
  for (const message of [
    '이번 회차 배송지 한도가 마감되었습니다.',
    '회차 상품 수량이 마감되었습니다.',
    '주문 시작 전인 회차입니다.',
    '취소 처리 중인 회차에는 주문할 수 없습니다.',
    '같은 결제 시도 ID에 다른 주문 내용이 요청되었습니다.',
  ]) {
    assert.equal(isRoundOrderClosedRejection(409, { message }), false, message);
  }
  // 본문이 없거나 손상되면 마감으로 보지 않는다.
  for (const body of [
    null,
    undefined,
    {},
    [],
    'text',
    { message: ['현재 주문 가능한 회차가 아닙니다.'] },
  ]) {
    assert.equal(isRoundOrderClosedRejection(409, body), false);
  }
});

test('마감으로 보는 문구는 API 회차 주문 창 계약에 실제로 있는 문구다', () => {
  const start = contractSource.indexOf('export function assertOrderWindowOpen');
  const end = contractSource.indexOf('export function assertManualOpenEligible', start);
  const orderWindowSource = contractSource.slice(start, end);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  for (const message of ['현재 주문 가능한 회차가 아닙니다.', '주문 마감된 회차입니다.']) {
    assert.ok(
      orderWindowSource.includes(`new ConflictException('${message}')`),
      `${message}: 409 Conflict 문구`,
    );
    assert.equal(isRoundOrderClosedRejection(409, { message }), true);
  }
});

test('주문 마감 시각까지 남은 시간을 타이머로 걸 수 있을 때만 돌려준다', () => {
  assert.equal(msUntilRoundOrderClose(CLOSE_AT, CLOSE_AT_MS - 60_000), 60_000);
  assert.equal(msUntilRoundOrderClose(CLOSE_AT, CLOSE_AT_MS - 1), 1);
  assert.equal(msUntilRoundOrderClose(CLOSE_AT, CLOSE_AT_MS), null);
  assert.equal(msUntilRoundOrderClose(CLOSE_AT, CLOSE_AT_MS + 1), null);
  assert.equal(msUntilRoundOrderClose('not-a-date', CLOSE_AT_MS), null);
  assert.equal(msUntilRoundOrderClose(CLOSE_AT, Number.NaN), null);
  // setTimeout 최대 지연(2^31-1ms)보다 먼 마감은 타이머를 걸지 않는다.
  assert.equal(msUntilRoundOrderClose(CLOSE_AT, CLOSE_AT_MS - 2_147_483_647), 2_147_483_647);
  assert.equal(msUntilRoundOrderClose(CLOSE_AT, CLOSE_AT_MS - 2_147_483_648), null);
});

test('마감 거절 응답이나 지나간 마감 시각·닫힌 상태면 마감 안내를 보인다', () => {
  const base = { round: openRound, closedByOrderResponse: false, paymentInFlight: false };

  assert.equal(isCheckoutRoundClosed({ ...base, nowMillis: CLOSE_AT_MS - 1 }), false);
  assert.equal(isCheckoutRoundClosed({ ...base, nowMillis: CLOSE_AT_MS }), true);
  assert.equal(
    isCheckoutRoundClosed({ ...base, nowMillis: CLOSE_AT_MS - 1, closedByOrderResponse: true }),
    true,
  );
  for (const status of ['CLOSED', 'COMPLETED', 'CANCELLED']) {
    assert.equal(
      isCheckoutRoundClosed({
        ...base,
        round: { ...openRound, status },
        nowMillis: CLOSE_AT_MS - 1,
      }),
      true,
      status,
    );
  }
  // 회차를 아직 모르면 일정으로는 판정하지 않고 거절 응답만 본다.
  assert.equal(isCheckoutRoundClosed({ ...base, round: null, nowMillis: CLOSE_AT_MS }), false);
  assert.equal(
    isCheckoutRoundClosed({
      ...base,
      round: null,
      nowMillis: CLOSE_AT_MS,
      closedByOrderResponse: true,
    }),
    true,
  );
});

test('주문 생성·결제창이 진행 중이면 마감 안내로 바꾸지 않고 결과를 기다린다', () => {
  assert.equal(
    isCheckoutRoundClosed({
      round: openRound,
      nowMillis: CLOSE_AT_MS + 1,
      closedByOrderResponse: true,
      paymentInFlight: true,
    }),
    false,
  );
});
