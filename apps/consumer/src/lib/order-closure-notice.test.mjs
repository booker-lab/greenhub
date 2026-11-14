import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

// 기한 계산은 실제 공유 패키지(빌드 산출물)를 그대로 쓴다.
const require = createRequire(import.meta.url);
const shared = require('../../../../packages/shared/dist/cjs/index.js');

async function loadModule() {
  const fileName = 'order-closure-notice.ts';
  const source = await readFile(new URL(`./${fileName}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    (specifier) => {
      assert.equal(specifier, '@greenhub/shared');
      return shared;
    },
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

const { customerFaultClosureWarning, CLOSED_UNDELIVERED_MESSAGE, RECEIPT_REFUSED_CLOSURE_WARNING } =
  await loadModule();

const base = {
  isRoundOrder: true,
  deliveryMethod: 'direct',
  status: 'DELIVERY_HELD',
  deliveryHold: {
    // 서울 11월 10일 보류, 13일 15:00 결제 요청 → 요청일부터 세어 16일까지 결제(S-15)
    heldAt: '2026-11-10T06:00:00.000Z',
    reasonCode: 'CUSTOMER_UNREACHABLE',
    customerResponsible: true,
    resolvedAt: null,
    paymentRequestedAt: '2026-11-13T06:00:00.000Z',
  },
  redeliveryPaid: false,
  closureEnabled: true,
};

test('재배송비를 기다리는 고객 책임 보류는 결제 요청일로 센 결제 마지막 날과 종결 가능성을 알린다', () => {
  assert.equal(
    customerFaultClosureWarning(base),
    '11월 16일까지 재배송비를 결제하지 않으면 환불 없이 주문이 종결될 수 있어요.',
  );
  assert.equal(
    customerFaultClosureWarning({ ...base, status: 'PREPARING' }),
    '11월 16일까지 재배송비를 결제하지 않으면 환불 없이 주문이 종결될 수 있어요.',
  );
});

test('서울 새벽(UTC 전날) 결제 요청도 서울 날짜로 기한을 센다', () => {
  assert.equal(
    customerFaultClosureWarning({
      ...base,
      deliveryHold: { ...base.deliveryHold, paymentRequestedAt: '2026-11-12T15:30:00.000Z' },
    }),
    '11월 16일까지 재배송비를 결제하지 않으면 환불 없이 주문이 종결될 수 있어요.',
  );
});

test('판매자가 결제 요청을 보내기 전에는 종결 안내를 보이지 않는다(S-15)', () => {
  const { paymentRequestedAt: _requested, ...beforeRequest } = base.deliveryHold;
  for (const deliveryHold of [
    beforeRequest,
    { ...base.deliveryHold, paymentRequestedAt: null },
    { ...base.deliveryHold, paymentRequestedAt: 'broken' },
  ]) {
    assert.equal(customerFaultClosureWarning({ ...base, deliveryHold }), null);
  }
});

test('수령 거부는 결제 요청 전에도 바로 종결될 수 있다고 알린다', () => {
  const { paymentRequestedAt: _requested, ...beforeRequest } = base.deliveryHold;
  assert.equal(
    customerFaultClosureWarning({
      ...base,
      deliveryHold: { ...beforeRequest, reasonCode: 'RECEIPT_REFUSED' },
    }),
    RECEIPT_REFUSED_CLOSURE_WARNING,
  );
});

test('수령 거부는 판매자가 바로 종결할 수 있다고 알린다', () => {
  assert.equal(
    customerFaultClosureWarning({
      ...base,
      deliveryHold: { ...base.deliveryHold, reasonCode: 'RECEIPT_REFUSED' },
    }),
    RECEIPT_REFUSED_CLOSURE_WARNING,
  );
  assert.equal(RECEIPT_REFUSED_CLOSURE_WARNING, '판매자가 환불 없이 주문을 종결할 수 있어요.');
});

test('기상·상품 파손·고객 책임 아님·결제 완료·해소·택배·옛 주문은 경고하지 않는다', () => {
  const cases = [
    { ...base, deliveryHold: { ...base.deliveryHold, reasonCode: 'WEATHER' } },
    { ...base, deliveryHold: { ...base.deliveryHold, reasonCode: 'PRODUCT_DAMAGED' } },
    { ...base, deliveryHold: { ...base.deliveryHold, customerResponsible: false } },
    { ...base, deliveryHold: { ...base.deliveryHold, resolvedAt: '2026-11-14T00:00:00.000Z' } },
    { ...base, redeliveryPaid: true },
    { ...base, deliveryMethod: 'parcel' },
    { ...base, isRoundOrder: false },
    { ...base, status: 'DELIVERING' },
    { ...base, deliveryHold: null },
  ];
  for (const input of cases) assert.equal(customerFaultClosureWarning(input), null);
});

test('고객 사유 종결 기능이 꺼져 있으면(없음 포함) 수령 거부·재배송비 미결제 경고를 모두 숨긴다(H1)', () => {
  const { closureEnabled: _enabled, ...missing } = base;
  const receiptRefused = { ...base.deliveryHold, reasonCode: 'RECEIPT_REFUSED' };
  for (const input of [
    { ...base, closureEnabled: false },
    missing,
    { ...base, closureEnabled: 'true' },
    { ...base, closureEnabled: false, deliveryHold: receiptRefused },
    { ...missing, deliveryHold: receiptRefused },
  ]) {
    assert.equal(customerFaultClosureWarning(input), null);
  }
});

test('종결 안내는 환불되지 않는 이유와 상품 처리를 알린다', () => {
  assert.equal(
    CLOSED_UNDELIVERED_MESSAGE,
    '고객 사유(수령 거부·재배송비 미결제)로 배송하지 못해 주문이 종결됐어요. 살아 있는 꽃이라 다시 판매할 수 없어 결제 금액은 환불되지 않고, 상품은 판매자가 처리해요.',
  );
});
