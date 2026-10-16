import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// 옵션 시트(벤치마킹 비교 기능)로 고른 옵션을 장바구니가 보존·검증하는지.
const source = await readFile(new URL('./useCart.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const cartModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  (specifier) => {
    if (specifier === 'react') return { useCallback: (cb) => cb, useSyncExternalStore: () => [] };
    throw new Error(`예상하지 못한 모듈 요청: ${specifier}`);
  },
  cartModule,
  cartModule.exports,
);
const { addCartItem, isRoundCartItem, parseCartSnapshot } = cartModule.exports;

const base = {
  productId: 'product-1',
  name: '빅립',
  image: '',
  saleType: 'normal',
  deliveryMethod: 'direct',
  storeId: 'store-1',
  roundId: 'round-1',
  roundItemId: 'round-item-1',
  roundPrice: 30000,
};
const withCeramic = {
  ...base,
  price: 38000,
  optionChoiceIds: ['ceramic'],
  optionLabel: '화분: 도자기 화분',
  optionPriceDelta: 8000,
};

test('옵션 금액을 더한 가격을 회차 상품으로 인정하고 옵션 필드를 보존한다', () => {
  const result = addCartItem([], { ...withCeramic, quantity: 1 });
  assert.equal(result.ok, true);
  assert.equal(isRoundCartItem(result.items[0]), true);
  assert.deepEqual(result.items[0].optionChoiceIds, ['ceramic']);
  const restored = parseCartSnapshot(JSON.stringify(result.items));
  assert.equal(restored[0].optionPriceDelta, 8000);
});

test('가격과 옵션 금액이 맞지 않거나 옵션 필드가 깨지면 담지 않는다', () => {
  assert.equal(addCartItem([], { ...withCeramic, price: 30000, quantity: 1 }).ok, false);
  assert.equal(addCartItem([], { ...withCeramic, optionChoiceIds: 'ceramic', quantity: 1 }).ok, false);
});

test('같은 회차 상품을 다른 옵션으로 다시 담으면 새 옵션으로 바꾸고 수량을 더한다', () => {
  const first = addCartItem([], { ...base, price: 30000, quantity: 1 });
  const second = addCartItem(first.items, { ...withCeramic, quantity: 2 });
  assert.equal(second.ok, true);
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].quantity, 3);
  assert.equal(second.items[0].price, 38000);
  assert.deepEqual(second.items[0].optionChoiceIds, ['ceramic']);
});
