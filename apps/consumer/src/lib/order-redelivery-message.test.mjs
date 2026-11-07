import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadModule(fileName, modules = {}) {
  const source = await readFile(new URL(`./${fileName}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    (specifier) => {
      if (specifier in modules) return modules[specifier];
      throw new Error(`예상하지 못한 모듈 요청: ${specifier}`);
    },
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

const failureModule = await loadModule('payment-failure-message.ts');
const redirectModule = await loadModule('payment-redirect.ts');
const {
  REDELIVERY_PAYMENT_CANCELED_MESSAGE,
  REDELIVERY_PAYMENT_NEEDS_SUPPORT_MESSAGE,
  REDELIVERY_PAYMENT_NOT_COMPLETED_MESSAGE,
  REDELIVERY_PAYMENT_NOT_STARTED_MESSAGE,
  REDELIVERY_PAYMENT_UNCERTAIN_MESSAGE,
  customerRedeliveryPaymentReturn,
  redeliveryPaymentFailureMessage,
  redeliveryPaymentUnexpectedFailure,
} = await loadModule('order-redelivery-message.ts', {
  '@/lib/payment-failure-message': failureModule,
});
const { parsePaymentRedirectResult, resolveRedeliveryPaymentReturn } = redirectModule;

// 화면 문구에는 내부 표현·PG 원문이 없어야 한다.
const INTERNAL_WORDS = /서버|운영|PAY_PROCESS|CANCELED|\[|습니다/;

test('재배송비 고객 문구는 해요체이고 내부 표현이 없다', () => {
  assert.equal(REDELIVERY_PAYMENT_CANCELED_MESSAGE, '재배송비 결제를 취소했어요.');
  assert.equal(
    REDELIVERY_PAYMENT_NOT_COMPLETED_MESSAGE,
    '재배송비 결제가 완료되지 않았어요. 다시 결제해 주세요.',
  );
  assert.equal(REDELIVERY_PAYMENT_UNCERTAIN_MESSAGE, '재배송비 결제가 됐는지 아직 확인하지 못했어요.');
  assert.equal(
    REDELIVERY_PAYMENT_NEEDS_SUPPORT_MESSAGE,
    '재배송비 결제 상태를 확인하지 못했어요. 아래 고객센터로 문의해 주세요.',
  );
  for (const message of [
    REDELIVERY_PAYMENT_CANCELED_MESSAGE,
    REDELIVERY_PAYMENT_NOT_COMPLETED_MESSAGE,
    REDELIVERY_PAYMENT_UNCERTAIN_MESSAGE,
    REDELIVERY_PAYMENT_NEEDS_SUPPORT_MESSAGE,
    REDELIVERY_PAYMENT_NOT_STARTED_MESSAGE,
  ]) {
    assert.doesNotMatch(message, INTERNAL_WORDS);
    // 장바구니 결제 문구를 그대로 가져오지 않는다.
    assert.doesNotMatch(message, /장바구니/);
  }
});

test('결제창 취소는 주문 결제와 같은 규칙으로 가르고 PG 원문 대신 취소 문구를 보인다', () => {
  for (const failure of [
    { code: 'FAILURE_TYPE_PG', message: '[PAY_PROCESS_CANCELED] 사용자가 결제를 취소하였습니다' },
    { code: 'FAILURE_TYPE_PG', message: 'canceled', pgCode: 'PAY_PROCESS_CANCELED' },
    { code: 'USER_CANCEL' },
  ]) {
    assert.equal(redeliveryPaymentFailureMessage(failure), REDELIVERY_PAYMENT_CANCELED_MESSAGE);
  }
});

test('취소가 아닌 결제창 실패는 원문 없이 미완료 문구를 보인다', () => {
  for (const failure of [
    { code: 'FAILURE_TYPE_PG', message: '[CARD_LIMIT_EXCEEDED] 한도 초과' },
    { code: 'FAILURE_TYPE_PG', message: '취소된 카드입니다' },
    { code: null, message: null },
    {},
  ]) {
    assert.equal(redeliveryPaymentFailureMessage(failure), REDELIVERY_PAYMENT_NOT_COMPLETED_MESSAGE);
  }
});

test('모바일 복귀 실패·취소는 복귀 쿼리의 PG 원문 대신 고객 문구로 바뀐다', () => {
  const canceled = parsePaymentRedirectResult(
    new URLSearchParams({
      paymentId: 'redelivery-1',
      code: 'FAILURE_TYPE_PG',
      message: '[PAY_PROCESS_CANCELED] 사용자가 결제를 취소하였습니다',
    }),
  );
  assert.equal(canceled.kind, 'failure');
  assert.deepEqual(
    customerRedeliveryPaymentReturn(canceled, resolveRedeliveryPaymentReturn(canceled, false)),
    { kind: 'rejected', message: REDELIVERY_PAYMENT_CANCELED_MESSAGE },
  );

  const failed = parsePaymentRedirectResult(
    new URLSearchParams({
      paymentId: 'redelivery-1',
      code: 'FAILURE_TYPE_PG',
      message: '[CARD_LIMIT_EXCEEDED] 한도 초과',
    }),
  );
  const failedOutcome = customerRedeliveryPaymentReturn(
    failed,
    resolveRedeliveryPaymentReturn(failed, undefined),
  );
  assert.deepEqual(failedOutcome, {
    kind: 'rejected',
    message: REDELIVERY_PAYMENT_NOT_COMPLETED_MESSAGE,
  });
  assert.doesNotMatch(failedOutcome.message, /CARD_LIMIT|한도 초과/);
});

test('결과를 모르는 복귀(잘못된 쿼리·결제 확인 전)는 확인 안내 문구 하나로 보인다', () => {
  const invalid = parsePaymentRedirectResult(
    new URLSearchParams([
      ['paymentId', 'a'],
      ['paymentId', 'b'],
    ]),
  );
  assert.equal(invalid.kind, 'invalid');
  assert.deepEqual(
    customerRedeliveryPaymentReturn(invalid, resolveRedeliveryPaymentReturn(invalid, undefined)),
    { kind: 'uncertain', message: REDELIVERY_PAYMENT_UNCERTAIN_MESSAGE },
  );

  const success = parsePaymentRedirectResult(new URLSearchParams({ paymentId: 'redelivery-1' }));
  assert.deepEqual(
    customerRedeliveryPaymentReturn(success, resolveRedeliveryPaymentReturn(success, false)),
    { kind: 'uncertain', message: REDELIVERY_PAYMENT_UNCERTAIN_MESSAGE },
  );
});

test('판정(kind)은 바꾸지 않는다: 완료·확인 중·없음은 그대로 둔다', () => {
  const success = parsePaymentRedirectResult(new URLSearchParams({ paymentId: 'redelivery-1' }));
  assert.deepEqual(
    customerRedeliveryPaymentReturn(success, resolveRedeliveryPaymentReturn(success, true)),
    { kind: 'done' },
  );
  assert.deepEqual(
    customerRedeliveryPaymentReturn(success, resolveRedeliveryPaymentReturn(success, undefined)),
    { kind: 'reconciling' },
  );
  const none = { kind: 'none' };
  assert.deepEqual(customerRedeliveryPaymentReturn(none, { kind: 'none' }), { kind: 'none' });
  // 서버가 이미 결제 완료로 본 실패 쿼리는 완료로 둔다.
  const failed = parsePaymentRedirectResult(
    new URLSearchParams({ paymentId: 'redelivery-1', code: 'FAILURE_TYPE_PG' }),
  );
  assert.deepEqual(
    customerRedeliveryPaymentReturn(failed, resolveRedeliveryPaymentReturn(failed, true)),
    { kind: 'done' },
  );
});

test('결제창을 열기 전에 멈춘 예외는 결제를 시작하지 못했다고 안내한다', () => {
  assert.equal(
    REDELIVERY_PAYMENT_NOT_STARTED_MESSAGE,
    '재배송비 결제를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.',
  );
  // 결제 설정 누락·결제 모듈 불러오기 실패는 결제창이 열리기 전이라 결제된 것처럼 들리지 않게 한다.
  assert.deepEqual(redeliveryPaymentUnexpectedFailure('opening-window'), {
    kind: 'rejected',
    message: REDELIVERY_PAYMENT_NOT_STARTED_MESSAGE,
  });
  assert.doesNotMatch(REDELIVERY_PAYMENT_NOT_STARTED_MESSAGE, /확인하지 못했어요/);
});

test('결제 기록 요청·결제창 호출 이후·완료 확인 중 예외는 결과를 모르므로 상태 다시 확인을 안내한다', () => {
  for (const stage of ['requesting', 'paying', 'confirming']) {
    assert.deepEqual(
      redeliveryPaymentUnexpectedFailure(stage),
      { kind: 'uncertain', message: REDELIVERY_PAYMENT_UNCERTAIN_MESSAGE },
      stage,
    );
  }
});
