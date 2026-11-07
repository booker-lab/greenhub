import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./payment-readiness.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'payment-readiness.ts',
}).outputText;
const readinessModule = { exports: {} };
new Function('module', 'exports', compiled)(readinessModule, readinessModule.exports);
const { PAY_BLOCKER_MESSAGES, roundPayBlockers } = readinessModule.exports;

const ready = {
  hasAddress: true,
  isIcheonAddress: true,
  phoneValid: true,
  giftReady: true,
  packageLabelReady: true,
  detailsConfirmed: true,
};

test('조건이 모두 갖춰지면 빠진 조건이 없다', () => {
  assert.deepEqual(roundPayBlockers(ready), []);
});

test('배송지·연락처가 채워져 있어도 확인 체크가 빠지면 그 이유를 보인다', () => {
  assert.deepEqual(roundPayBlockers({ ...ready, detailsConfirmed: false }), [
    '주문 상품·수량·회차 가격을 확인하고 체크해 주세요.',
  ]);
});

test('주소가 없으면 주소 입력을, 이천시가 아니면 이천시 주소를 안내한다(둘 중 하나만)', () => {
  assert.deepEqual(roundPayBlockers({ ...ready, hasAddress: false, isIcheonAddress: false }), [
    PAY_BLOCKER_MESSAGES.address,
  ]);
  assert.deepEqual(roundPayBlockers({ ...ready, isIcheonAddress: false }), [
    PAY_BLOCKER_MESSAGES.icheon,
  ]);
});

test('빠진 조건은 화면 순서(배송지 → 연락처 → 선물·라벨 → 확인 체크)대로 모두 보인다', () => {
  assert.deepEqual(
    roundPayBlockers({
      hasAddress: true,
      isIcheonAddress: false,
      phoneValid: false,
      giftReady: false,
      packageLabelReady: false,
      detailsConfirmed: false,
    }),
    [
      PAY_BLOCKER_MESSAGES.icheon,
      PAY_BLOCKER_MESSAGES.phone,
      PAY_BLOCKER_MESSAGES.gift,
      PAY_BLOCKER_MESSAGES.packageLabel,
      PAY_BLOCKER_MESSAGES.confirm,
    ],
  );
});

test('안내 문구는 해요체 고객 문구이고 내부 표현·영문 코드를 쓰지 않는다', () => {
  for (const message of Object.values(PAY_BLOCKER_MESSAGES)) {
    assert.match(message, /(주세요|있어요)[.)]*$/);
    assert.doesNotMatch(message, /서버|파일럿|[A-Za-z]/);
  }
});
