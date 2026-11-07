import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

// 연결 실패 판정은 실제 load-error-message 모듈을 쓴다.
const loadErrorModule = { exports: {} };
new Function(
  'module',
  'exports',
  transpile(await readFile(new URL('./load-error-message.ts', import.meta.url), 'utf8')),
)(loadErrorModule, loadErrorModule.exports);

const messagesModule = { exports: {} };
new Function(
  'require',
  'module',
  'exports',
  transpile(await readFile(new URL('./checkout-messages.ts', import.meta.url), 'utf8')),
)(
  (specifier) => {
    if (specifier === '@/lib/load-error-message') return loadErrorModule.exports;
    throw new Error(`예상하지 못한 결제 문구 모듈 요청: ${specifier}`);
  },
  messagesModule,
  messagesModule.exports,
);
const {
  CHECKOUT_PAYMENT_FAILED_MESSAGE,
  CHECKOUT_PAYMENT_UNAVAILABLE_MESSAGE,
  ORDER_CREATE_FAILED_MESSAGE,
  checkoutPaymentErrorMessage,
} = messagesModule.exports;

test('결제 오류 문구는 고객 기준 해요체이고 설정·서버 같은 내부 말을 쓰지 않는다', () => {
  assert.equal(
    CHECKOUT_PAYMENT_UNAVAILABLE_MESSAGE,
    '지금은 결제를 시작할 수 없어요. 잠시 후 다시 시도해 주세요.',
  );
  assert.equal(ORDER_CREATE_FAILED_MESSAGE, '주문을 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
  assert.equal(
    CHECKOUT_PAYMENT_FAILED_MESSAGE,
    '결제를 진행하지 못했어요. 잠시 후 다시 시도해 주세요.',
  );
  for (const message of [
    CHECKOUT_PAYMENT_UNAVAILABLE_MESSAGE,
    ORDER_CREATE_FAILED_MESSAGE,
    CHECKOUT_PAYMENT_FAILED_MESSAGE,
  ]) {
    assert.doesNotMatch(message, /니다|설정|서버|[A-Za-z]/);
  }
});

test('연결 실패 원문은 연결 안내로, 문구 없는 오류는 일반 안내로 바꾼다', () => {
  const connection = '연결이 불안정해요. 잠시 후 다시 시도해 주세요.';
  assert.equal(checkoutPaymentErrorMessage(new TypeError('Failed to fetch')), connection);
  assert.equal(checkoutPaymentErrorMessage(new TypeError('Load failed')), connection);
  assert.equal(checkoutPaymentErrorMessage(new Error('')), CHECKOUT_PAYMENT_FAILED_MESSAGE);
  assert.equal(checkoutPaymentErrorMessage('문자열'), CHECKOUT_PAYMENT_FAILED_MESSAGE);
  assert.equal(checkoutPaymentErrorMessage(null), CHECKOUT_PAYMENT_FAILED_MESSAGE);
  // 이미 고객 문구로 만든 오류는 그대로 쓴다.
  assert.equal(
    checkoutPaymentErrorMessage(new Error('결제를 취소했어요. 장바구니는 그대로 남아 있어요.')),
    '결제를 취소했어요. 장바구니는 그대로 남아 있어요.',
  );
});
