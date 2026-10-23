import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./option-availability.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function('module', 'exports', compiled)(module, module.exports);
const {
  toAvailabilityMap,
  choiceRemaining,
  isChoiceSoldOut,
  choiceStockLabel,
  firstAvailableChoiceId,
  maxQuantityFor,
} = module.exports;

test('응답을 선택지별 남은 수량으로 읽고 모양이 틀린 항목은 버린다', () => {
  assert.deepEqual(
    toAvailabilityMap({
      choices: [
        { choiceId: 'white', remainingQuantity: 3 },
        { choiceId: 'black', remainingQuantity: -1 },
        { choiceId: 'broken', remainingQuantity: '2' },
        null,
      ],
    }),
    { white: 3, black: 0 },
  );
  assert.deepEqual(toAvailabilityMap(null), {});
});

test('재고에 연결되지 않은 선택지는 제한이 없다', () => {
  const map = { white: 0 };
  assert.equal(choiceRemaining(map, 'plastic'), null);
  assert.equal(choiceRemaining(null, 'white'), null);
  assert.equal(isChoiceSoldOut(map, 'white'), true);
  assert.equal(isChoiceSoldOut(map, 'plastic'), false);
});

test('품절과 적게 남은 수량만 안내한다', () => {
  assert.equal(choiceStockLabel(0), '품절');
  assert.equal(choiceStockLabel(3), '3개 남음');
  assert.equal(choiceStockLabel(5), '5개 남음');
  assert.equal(choiceStockLabel(6), null);
  assert.equal(choiceStockLabel(null), null);
});

test('처음 고를 선택지는 품절을 건너뛴다', () => {
  const choices = [{ id: 'white' }, { id: 'black' }];
  assert.equal(firstAvailableChoiceId(choices, { white: 0, black: 2 }), 'black');
  assert.equal(firstAvailableChoiceId(choices, { white: 0, black: 0 }), '');
  assert.equal(firstAvailableChoiceId(choices, null), 'white');
});

test('담을 수 있는 수량은 고른 선택지의 남은 수량을 넘지 않는다', () => {
  assert.equal(maxQuantityFor({ white: 2 }, ['white', 'none']), 2);
  assert.equal(maxQuantityFor({ white: 2 }, ['none']), 99);
  assert.equal(maxQuantityFor({ white: 0 }, ['white']), 0);
});
