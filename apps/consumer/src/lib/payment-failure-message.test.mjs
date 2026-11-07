import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./payment-failure-message.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'payment-failure-message.ts',
}).outputText;
const failureModule = { exports: {} };
new Function('module', 'exports', compiled)(failureModule, failureModule.exports);
const { PAYMENT_CANCELED_MESSAGE, PAYMENT_NOT_COMPLETED_MESSAGE, paymentFailureMessage } =
  failureModule.exports;

test('결제창 취소는 PG 원문 코드 대신 장바구니가 남아 있다는 고객 문구로 바꾼다', () => {
  assert.equal(PAYMENT_CANCELED_MESSAGE, '결제를 취소했어요. 장바구니는 그대로 남아 있어요.');
  for (const failure of [
    { code: 'FAILURE_TYPE_PG', message: '[PAY_PROCESS_CANCELED] 사용자가 결제를 취소하였습니다' },
    { code: 'FAILURE_TYPE_PG', message: 'canceled', pgCode: 'PAY_PROCESS_CANCELED' },
    { code: 'USER_CANCEL' },
    { code: 'FAILURE_TYPE_PG', message: '취소' },
  ]) {
    assert.equal(paymentFailureMessage(failure), PAYMENT_CANCELED_MESSAGE);
  }
});

test('취소가 아닌 실패와 코드·메시지가 없는 실패는 기본 문구로 보인다', () => {
  for (const failure of [
    { code: 'FAILURE_TYPE_PG', message: '[CARD_LIMIT_EXCEEDED] 한도 초과' },
    { code: 'UNKNOWN', message: null },
    { code: null, message: undefined },
    {},
  ]) {
    assert.equal(paymentFailureMessage(failure), PAYMENT_NOT_COMPLETED_MESSAGE);
  }
});

test('고객 문구에는 PG 원문 코드·대괄호·영문 코드가 섞이지 않는다', () => {
  const messages = [
    paymentFailureMessage({ code: 'FAILURE_TYPE_PG', message: '[PAY_PROCESS_CANCELED] 취소' }),
    paymentFailureMessage({ code: 'FAILURE_TYPE_PG', message: '[PG_ERROR] 오류' }),
  ];
  for (const message of messages) {
    assert.doesNotMatch(message, /\[|\]|[A-Z_]{3,}/);
  }
});
