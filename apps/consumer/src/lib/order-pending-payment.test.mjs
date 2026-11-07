import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./order-pending-payment.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'order-pending-payment.ts',
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  (specifier) => {
    throw new Error(`예상하지 못한 모듈 요청: ${specifier}`);
  },
  loaded,
  loaded.exports,
);
const {
  PENDING_PAYMENT_AUTO_CANCEL_NOTICE,
  PENDING_PAYMENT_CART_HREF,
  PENDING_PAYMENT_CART_LABEL,
  PENDING_PAYMENT_RETRY_HINT,
  PENDING_PAYMENT_TIMELINE_NOTICE,
  isPaymentPendingOrder,
  orderDetailPendingPaymentGuide,
  orderListPendingPaymentNotice,
} = loaded.exports;

const NON_PENDING_STATUSES = [
  'RECRUITING',
  'CONFIRMED',
  'ACCEPTED',
  'PREPARING',
  'DELIVERING',
  'DELIVERY_HELD',
  'HUB_ARRIVED',
  'PICKED_UP',
  'DELIVERED',
  'CANCELLED',
  'REVIEWED',
];

test('결제 확인 중(PENDING) 주문만 결제 미확정으로 본다', () => {
  assert.equal(isPaymentPendingOrder('PENDING'), true);
  for (const status of NON_PENDING_STATUSES) {
    assert.equal(isPaymentPendingOrder(status), false, status);
  }
  for (const value of [undefined, null, '', 'pending', 0, {}]) {
    assert.equal(isPaymentPendingOrder(value), false, String(value));
  }
});

test('MY 주문 목록은 PENDING 카드에만 자동 취소 설명 한 줄을 붙인다', () => {
  assert.equal(orderListPendingPaymentNotice('PENDING'), PENDING_PAYMENT_AUTO_CANCEL_NOTICE);
  for (const status of NON_PENDING_STATUSES) {
    assert.equal(orderListPendingPaymentNotice(status), null, status);
  }
});

test('주문 상세는 취소되지 않은 PENDING 주문에만 배송 현황 대신 안내와 장바구니 이동을 준다', () => {
  assert.deepEqual(orderDetailPendingPaymentGuide('PENDING', { cancelled: false }), {
    autoCancelNotice: PENDING_PAYMENT_AUTO_CANCEL_NOTICE,
    timelineNotice: PENDING_PAYMENT_TIMELINE_NOTICE,
    retryHint: PENDING_PAYMENT_RETRY_HINT,
    cartLabel: PENDING_PAYMENT_CART_LABEL,
    cartHref: PENDING_PAYMENT_CART_HREF,
  });
  // 고객이 취소해 화면이 '주문이 취소됐어요'를 보일 때는 결제 안내를 함께 내지 않는다.
  assert.equal(orderDetailPendingPaymentGuide('PENDING', { cancelled: true }), null);
  for (const status of NON_PENDING_STATUSES) {
    assert.equal(orderDetailPendingPaymentGuide(status, { cancelled: false }), null, status);
  }
});

test('안내 문구는 고객 기준 해요체이고 확인되지 않은 시간 약속을 하지 않는다', () => {
  assert.equal(
    PENDING_PAYMENT_AUTO_CANCEL_NOTICE,
    '결제를 마치지 않았다면 잠시 뒤 자동으로 취소돼요.',
  );
  assert.equal(PENDING_PAYMENT_TIMELINE_NOTICE, '결제가 확인되면 배송 현황이 보여요.');
  assert.equal(PENDING_PAYMENT_RETRY_HINT, '다시 주문하려면 장바구니에서 결제해 주세요.');
  assert.equal(PENDING_PAYMENT_CART_LABEL, '장바구니로 가기');
  assert.equal(PENDING_PAYMENT_CART_HREF, '/cart');
  for (const text of [
    PENDING_PAYMENT_AUTO_CANCEL_NOTICE,
    PENDING_PAYMENT_TIMELINE_NOTICE,
    PENDING_PAYMENT_RETRY_HINT,
  ]) {
    // 자동 취소는 결제사 조회 결과에 따라 늦어질 수 있어 숫자(분·시간)를 쓰지 않는다.
    assert.doesNotMatch(text, /\d/);
    assert.doesNotMatch(text, /서버|PENDING|[A-Za-z]/);
  }
});
