import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./order-cancel-reason.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'order-cancel-reason.ts',
}).outputText;
const reasonModule = { exports: {} };
new Function('module', 'exports', compiled)(reasonModule, reasonModule.exports);
const { formatCancelReason } = reasonModule.exports;

test('서버 자동 취소 코드는 고객이 읽을 해요체 문장으로 바꾼다', () => {
  assert.equal(formatCancelReason('timeout'), '결제 시간이 지나 주문이 자동으로 취소됐어요');
  assert.equal(
    formatCancelReason('payment_failed'),
    '결제가 완료되지 않아 주문이 자동으로 취소됐어요',
  );
  assert.equal(
    formatCancelReason('amount_mismatch'),
    '결제 금액이 주문 금액과 달라 주문이 자동으로 취소되고 결제한 금액은 환불돼요',
  );
  assert.equal(
    formatCancelReason('payment_context_mismatch'),
    '결제 정보를 확인할 수 없어 주문이 자동으로 취소되고 결제한 금액은 환불돼요',
  );
});

test('알려진 코드는 모두 내부 코드 글자를 드러내지 않는다', () => {
  for (const code of ['timeout', 'payment_failed', 'amount_mismatch', 'payment_context_mismatch']) {
    const label = formatCancelReason(code);
    assert.ok(label);
    assert.doesNotMatch(label, /[a-z_]/);
    assert.match(label, /요$/);
  }
});

test('판매자·관리자가 적은 사유와 고정 문구는 그대로 보인다', () => {
  for (const reason of [
    '고객 요청',
    '소비자 취소',
    '판매자 취소',
    '판매 회차 취소',
    '관리자 강제 환불',
    '목표 수량 미달성으로 취소',
    '꽃대가 꺾여 출고할 수 없어 취소합니다',
  ]) {
    assert.equal(formatCancelReason(reason), reason);
  }
});

test('코드와 이름이 같은 Object 기본 속성도 자유 입력으로 취급한다', () => {
  assert.equal(formatCancelReason('constructor'), 'constructor');
  assert.equal(formatCancelReason('toString'), 'toString');
});

test('앞뒤 공백은 정리하고 빈 사유·문자열이 아닌 값은 null이다', () => {
  assert.equal(formatCancelReason(' timeout '), '결제 시간이 지나 주문이 자동으로 취소됐어요');
  assert.equal(formatCancelReason(' 고객 요청 '), '고객 요청');
  for (const value of ['', '   ', null, undefined, 0, {}, ['timeout']]) {
    assert.equal(formatCancelReason(value), null);
  }
});
