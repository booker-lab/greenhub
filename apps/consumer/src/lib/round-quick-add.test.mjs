import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./round-quick-add.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function('module', 'exports', compiled)(module, module.exports);
const { canQuickAdd, roundItemCartInput, cartAddFailureMessage } = module.exports;

const item = {
  id: 'round-item-1',
  roundId: 'round-1',
  storeId: 'store-1',
  productId: 'product-1',
  productNameSnapshot: '호접란 화이트 2대',
  productImageUrlSnapshot: null,
  roundPrice: 39000,
  status: 'ACTIVE',
};

test('주문 받는 중인 현재 회차의 판매 중 상품만 바로 담을 수 있다', () => {
  assert.equal(canQuickAdd(item, 'OPEN', false), true);
  assert.equal(canQuickAdd(item, 'OPEN', true), false);
  for (const status of ['SCHEDULED', 'CLOSED', 'COMPLETED', 'CANCELLED', 'DRAFT']) {
    assert.equal(canQuickAdd(item, status, false), false);
  }
  for (const status of ['SOLD_OUT', 'CLOSED', 'HIDDEN']) {
    assert.equal(canQuickAdd({ status }, 'OPEN', false), false);
  }
});

test('회차 상품을 회차 가격과 세 회차 식별자가 있는 장바구니 항목으로 만든다', () => {
  assert.deepEqual(roundItemCartInput(item), {
    productId: 'product-1',
    name: '호접란 화이트 2대',
    price: 39000,
    image: '',
    quantity: 1,
    saleType: 'normal',
    deliveryMethod: 'direct',
    storeId: 'store-1',
    roundId: 'round-1',
    roundItemId: 'round-item-1',
    roundPrice: 39000,
  });
  assert.equal(roundItemCartInput(item, 3).quantity, 3);
});

test('담기 실패 이유마다 다음 행동을 알려주는 문구를 쓴다', () => {
  assert.match(cartAddFailureMessage('different_round'), /같은 회차 상품만/);
  assert.match(cartAddFailureMessage('incompatible_cart'), /함께 담을 수 없습니다/);
  assert.match(cartAddFailureMessage('invalid_item'), /담지 못했습니다/);
});
