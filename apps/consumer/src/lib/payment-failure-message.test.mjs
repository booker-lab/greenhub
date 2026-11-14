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
const {
  PAYMENT_CANCELED_MESSAGE,
  PAYMENT_NOT_COMPLETED_MESSAGE,
  failedPaymentNotice,
  isPaymentCanceled,
  paymentFailureMessage,
  paymentFailureNotice,
} = failureModule.exports;

test('결제창 취소는 PG 원문 코드 대신 장바구니가 남아 있다는 고객 문구로 바꾼다', () => {
  assert.equal(PAYMENT_CANCELED_MESSAGE, '결제를 취소했어요. 장바구니는 그대로 남아 있어요.');
  for (const failure of [
    { code: 'FAILURE_TYPE_PG', message: '[PAY_PROCESS_CANCELED] 사용자가 결제를 취소하였습니다' },
    { code: 'FAILURE_TYPE_PG', message: 'canceled', pgCode: 'PAY_PROCESS_CANCELED' },
    { code: 'USER_CANCEL' },
    { code: 'FAILURE_TYPE_PG', message: '결제를 취소했습니다' },
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

test('취소라는 글자가 있어도 고객이 결제창을 닫지 않은 PG 실패는 취소로 보지 않는다', () => {
  for (const message of ['취소된 카드입니다', '[CARD_ERROR] 거래 취소 불가 카드입니다']) {
    assert.equal(
      paymentFailureMessage({ code: 'FAILURE_TYPE_PG', message }),
      PAYMENT_NOT_COMPLETED_MESSAGE,
    );
  }
  assert.equal(
    paymentFailureMessage({ code: 'FAILURE_TYPE_PG', message: '사용자가 결제를 취소하였습니다' }),
    PAYMENT_CANCELED_MESSAGE,
  );
});

test('종류 판정: 취소 코드·대괄호 취소 코드는 canceled, "취소된 카드입니다"는 failed다', () => {
  const cases = [
    // 취소 코드(code·pgCode 어느 쪽에 와도)
    [{ code: 'PAY_PROCESS_CANCELED' }, 'canceled'],
    [{ code: 'FAILURE_TYPE_PG', pgCode: 'PAY_PROCESS_CANCELED' }, 'canceled'],
    // 대괄호 코드가 든 메시지
    [
      { code: 'FAILURE_TYPE_PG', message: '[PAY_PROCESS_CANCELED] 사용자가 결제를 취소하였습니다' },
      'canceled',
    ],
    [{ code: 'FAILURE_TYPE_PG', message: '[PAY_PROCESS_CANCELED]' }, 'canceled'],
    // '취소'라는 글자가 있어도 고객이 결제창을 닫은 것이 아니다
    [{ code: 'FAILURE_TYPE_PG', message: '취소된 카드입니다' }, 'failed'],
    [{ code: 'FAILURE_TYPE_PG', message: '[PG_ERROR] 취소된 카드입니다' }, 'failed'],
  ];
  for (const [failure, kind] of cases) {
    assert.equal(isPaymentCanceled(failure), kind === 'canceled', JSON.stringify(failure));
    const notice = paymentFailureNotice(failure);
    assert.equal(notice.kind, kind, JSON.stringify(failure));
    // 문구는 paymentFailureMessage와 언제나 같다(반환 계약 유지).
    assert.equal(notice.message, paymentFailureMessage(failure));
    assert.equal(
      notice.message,
      kind === 'canceled' ? PAYMENT_CANCELED_MESSAGE : PAYMENT_NOT_COMPLETED_MESSAGE,
    );
  }
});

test('종류 판정 극한 입력: 값이 없거나 문자열이 아니면 취소로 보지 않는다', () => {
  for (const failure of [
    {},
    { code: null, message: null, pgCode: null },
    { code: '', message: '', pgCode: '' },
    { code: 123, message: { text: 'CANCEL' }, pgCode: ['CANCEL'] },
  ]) {
    assert.equal(isPaymentCanceled(failure), false, JSON.stringify(failure));
    assert.deepEqual(paymentFailureNotice(failure), {
      kind: 'failed',
      message: PAYMENT_NOT_COMPLETED_MESSAGE,
    });
  }
});

test('취소가 아닌 안내는 받은 문구 그대로 failed로 묶는다', () => {
  assert.deepEqual(failedPaymentNotice('주문을 만들지 못했어요. 잠시 후 다시 시도해 주세요.'), {
    kind: 'failed',
    message: '주문을 만들지 못했어요. 잠시 후 다시 시도해 주세요.',
  });
  // 문구가 취소 안내와 같아도 종류를 문구로 다시 가리지 않는다.
  assert.equal(failedPaymentNotice(PAYMENT_CANCELED_MESSAGE).kind, 'failed');
});
