import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

// 마감 판정은 실제 공용 도우미(@/lib/round-schedule-label)를 읽어 쓴다.
const labelSource = await readFile(new URL('./round-schedule-label.ts', import.meta.url), 'utf8');
const labelModule = { exports: {} };
new Function('module', 'exports', transpile(labelSource))(labelModule, labelModule.exports);

const source = await readFile(new URL('./round-product-state.ts', import.meta.url), 'utf8');
const stateModule = { exports: {} };
new Function('require', 'module', 'exports', transpile(source))(
  (specifier) => {
    if (specifier === '@/lib/round-schedule-label') return labelModule.exports;
    throw new Error(`예상하지 못한 모듈 요청: ${specifier}`);
  },
  stateModule,
  stateModule.exports,
);
const { resolveRoundProductAvailability } = stateModule.exports;

const closeAt = '2026-11-07T09:00:00.000Z';
const closeMillis = Date.parse(closeAt);
const round = (status, orderCloseAt = closeAt) => ({ status, schedule: { orderCloseAt } });
const item = (status) => ({ status });

test('마감 전 판매 중 회차의 판매 상품은 판매 중이고 구매할 수 있다', () => {
  assert.deepEqual(
    resolveRoundProductAvailability(round('OPEN'), item('ACTIVE'), closeMillis - 1),
    {
      state: 'current',
      isPurchasable: true,
    },
  );
});

test('판매 중 상태여도 주문 마감 시각이 지나면 판매 마감으로 보고 구매를 막는다', () => {
  for (const now of [closeMillis, closeMillis + 60_000]) {
    assert.deepEqual(resolveRoundProductAvailability(round('OPEN'), item('ACTIVE'), now), {
      state: 'closed',
      isPurchasable: false,
    });
  }
});

test('마감 시각이 지난 판매 중 회차의 품절 상품은 마감 회차와 같게 판매 마감으로 보인다', () => {
  assert.deepEqual(
    resolveRoundProductAvailability(round('OPEN'), item('SOLD_OUT'), closeMillis),
    resolveRoundProductAvailability(round('CLOSED'), item('SOLD_OUT'), closeMillis),
  );
  assert.equal(
    resolveRoundProductAvailability(round('OPEN'), item('SOLD_OUT'), closeMillis).state,
    'closed',
  );
});

test('마감 전 판매 중 회차의 품절 상품은 품절이고 구매할 수 없다', () => {
  assert.deepEqual(
    resolveRoundProductAvailability(round('OPEN'), item('SOLD_OUT'), closeMillis - 1),
    { state: 'sold_out', isPurchasable: false },
  );
});

test('판매 예정 회차는 마감 시각과 관계없이 지금처럼 현재 회차로 두되 구매는 막는다', () => {
  for (const now of [closeMillis - 1, closeMillis + 60_000]) {
    assert.deepEqual(resolveRoundProductAvailability(round('SCHEDULED'), item('ACTIVE'), now), {
      state: 'current',
      isPurchasable: false,
    });
    assert.deepEqual(resolveRoundProductAvailability(round('SCHEDULED'), item('SOLD_OUT'), now), {
      state: 'sold_out',
      isPurchasable: false,
    });
  }
});

test('마감·완료·취소 회차는 마감 시각 전이라도 판매 마감이다', () => {
  for (const status of ['CLOSED', 'COMPLETED', 'CANCELLED']) {
    for (const itemStatus of ['ACTIVE', 'SOLD_OUT', 'CLOSED']) {
      assert.deepEqual(
        resolveRoundProductAvailability(round(status), item(itemStatus), closeMillis - 60_000),
        { state: 'closed', isPurchasable: false },
      );
    }
  }
});

test('판매 중 회차에서 판매를 닫은 상품은 판매 마감이다', () => {
  assert.deepEqual(
    resolveRoundProductAvailability(round('OPEN'), item('CLOSED'), closeMillis - 1),
    {
      state: 'closed',
      isPurchasable: false,
    },
  );
});

test('마감 시각이 잘못된 판매 중 회차는 상태로만 판단한다', () => {
  assert.deepEqual(
    resolveRoundProductAvailability(round('OPEN', 'not-a-date'), item('ACTIVE'), closeMillis),
    { state: 'current', isPurchasable: true },
  );
});
