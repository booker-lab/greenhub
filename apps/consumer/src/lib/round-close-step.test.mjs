import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

// 판정·표기는 실제 공용 도우미(@/lib/round-schedule-label)를 읽어 쓴다.
const labelSource = await readFile(new URL('./round-schedule-label.ts', import.meta.url), 'utf8');
const labelModule = { exports: {} };
new Function('module', 'exports', transpile(labelSource))(labelModule, labelModule.exports);

const source = await readFile(new URL('./round-close-step.ts', import.meta.url), 'utf8');
const stepModule = { exports: {} };
new Function('require', 'module', 'exports', transpile(source))(
  (specifier) => {
    if (specifier === '@/lib/round-schedule-label') return labelModule.exports;
    throw new Error(`예상하지 못한 모듈 요청: ${specifier}`);
  },
  stepModule,
  stepModule.exports,
);
const { roundOrderCloseStep } = stepModule.exports;

// 2026-11-07 18:00 KST = 2026-11-07 09:00 UTC
const closeAt = '2026-11-07T09:00:00.000Z';
const closeMillis = Date.parse(closeAt);
const round = (status, orderCloseAt = closeAt) => ({ status, schedule: { orderCloseAt } });

test('마감 전 판매 중·판매 예정 회차는 "~까지"로 마감 시각을 알린다', () => {
  for (const status of ['OPEN', 'SCHEDULED']) {
    assert.deepEqual(roundOrderCloseStep(round(status), closeMillis - 1), {
      label: '주문 마감',
      value: '11월 7일(토) 오후 6시까지',
    });
  }
});

test('마감 시각이 지나면 판매 중 상태여도 "까지" 없이 마감됨과 시각만 보인다', () => {
  for (const now of [closeMillis, closeMillis + 60_000]) {
    const step = roundOrderCloseStep(round('OPEN'), now);
    assert.deepEqual(step, { label: '주문 마감됨', value: '11월 7일(토) 오후 6시' });
    assert.doesNotMatch(step.value, /까지/);
  }
});

test('마감·완료·취소 회차는 마감 시각 전이라도 마감됨으로 보인다', () => {
  for (const status of ['CLOSED', 'COMPLETED', 'CANCELLED']) {
    assert.deepEqual(roundOrderCloseStep(round(status), closeMillis - 60_000), {
      label: '주문 마감됨',
      value: '11월 7일(토) 오후 6시',
    });
  }
});

test('마감 시각이 잘못되면 상태로만 판단하고 일정 확인 중으로 보인다', () => {
  assert.deepEqual(roundOrderCloseStep(round('OPEN', 'invalid'), closeMillis), {
    label: '주문 마감',
    value: '일정 확인 중',
  });
  assert.deepEqual(roundOrderCloseStep(round('CLOSED', 'invalid'), closeMillis), {
    label: '주문 마감됨',
    value: '일정 확인 중',
  });
});
