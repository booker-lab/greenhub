import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./useCart.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const cartModule = { exports: {} };
const requireForTest = (specifier) => {
  if (specifier === 'react') {
    return {
      useCallback: (callback) => callback,
      useSyncExternalStore: () => [],
    };
  }
  throw new Error(`예상하지 못한 모듈 요청: ${specifier}`);
};

new Function('require', 'module', 'exports', compiled)(
  requireForTest,
  cartModule,
  cartModule.exports,
);

const { addCartItem, isRoundCartItem, parseCartSnapshot } = cartModule.exports;

const legacyItem = {
  productId: 'product-1',
  name: '기존 호접란',
  price: 25000,
  image: '',
  quantity: 1,
  saleType: 'normal',
  deliveryMethod: 'direct',
  storeId: 'store-1',
};

const roundItem = {
  ...legacyItem,
  name: '이번 주 호접란',
  price: 23000,
  roundId: 'round-1',
  roundItemId: 'round-item-1',
  roundPrice: 23000,
};

test('기존 CartItem과 기존 localStorage 배열을 계속 읽는다', () => {
  assert.deepEqual(parseCartSnapshot(JSON.stringify([legacyItem])), [legacyItem]);
});

test('완전한 회차 계약만 회차 장바구니 항목으로 복원한다', () => {
  const [restored] = parseCartSnapshot(JSON.stringify([roundItem]));

  assert.equal(isRoundCartItem(restored), true);
  assert.equal(restored.roundId, 'round-1');
  assert.equal(restored.roundItemId, 'round-item-1');
  assert.equal(restored.roundPrice, 23000);
});

test('손상되거나 불완전한 저장 데이터는 구매 가능한 회차 항목으로 승격하지 않는다', () => {
  const [partial] = parseCartSnapshot(
    JSON.stringify([{ ...legacyItem, roundId: 'round-1', roundPrice: 25000 }]),
  );
  const [priceMismatch] = parseCartSnapshot(
    JSON.stringify([
      {
        ...roundItem,
        price: 22000,
      },
    ]),
  );

  assert.equal(isRoundCartItem(partial), false);
  assert.equal('roundId' in partial, false);
  assert.equal(isRoundCartItem(priceMismatch), false);
  assert.deepEqual(parseCartSnapshot('{깨진 JSON'), []);
  assert.deepEqual(parseCartSnapshot(JSON.stringify({ items: [roundItem] })), []);
});

test('불완전한 신규 회차 입력은 legacy 항목으로 낮춰 담지 않는다', () => {
  const partialInput = {
    ...roundItem,
    roundItemId: undefined,
  };
  const priceMismatchInput = {
    ...roundItem,
    price: 22000,
  };

  assert.deepEqual(addCartItem([], partialInput), {
    ok: false,
    reason: 'invalid_item',
    items: [],
  });
  assert.deepEqual(addCartItem([], priceMismatchInput), {
    ok: false,
    reason: 'invalid_item',
    items: [],
  });
});

test('같은 회차의 서로 다른 회차 상품은 한 장바구니에 함께 담는다', () => {
  const anotherRoundItem = {
    ...roundItem,
    productId: 'product-2',
    name: '이번 주 다른 호접란',
    roundItemId: 'round-item-2',
  };
  const result = addCartItem([roundItem], anotherRoundItem);

  assert.equal(result.ok, true);
  assert.deepEqual(result.items, [roundItem, anotherRoundItem]);
});

test('동일 항목 판정에 회차 상품 식별자를 포함한다', () => {
  const sameProductDifferentRoundItem = {
    ...roundItem,
    roundItemId: 'round-item-2',
  };
  const separated = addCartItem([roundItem], sameProductDifferentRoundItem);
  const merged = addCartItem([roundItem], { ...roundItem, quantity: 2 });

  assert.equal(separated.ok, true);
  assert.equal(separated.items.length, 2);
  assert.equal(merged.ok, true);
  assert.equal(merged.items.length, 1);
  assert.equal(merged.items[0].quantity, 3);
});

test('다른 회차 상품은 기존 장바구니를 덮어쓰거나 혼합하지 않는다', () => {
  const differentRoundItem = {
    ...roundItem,
    roundId: 'round-2',
    roundItemId: 'round-item-2',
  };
  const result = addCartItem([roundItem], differentRoundItem);

  assert.deepEqual(result, {
    ok: false,
    reason: 'different_round',
    items: [roundItem],
  });
});

test('legacy 항목과 회차 항목은 서로 혼합하지 않는다', () => {
  const roundIntoLegacy = addCartItem([legacyItem], roundItem);
  const legacyIntoRound = addCartItem([roundItem], legacyItem);

  assert.equal(roundIntoLegacy.ok, false);
  assert.equal(roundIntoLegacy.reason, 'incompatible_cart');
  assert.deepEqual(roundIntoLegacy.items, [legacyItem]);
  assert.equal(legacyIntoRound.ok, false);
  assert.equal(legacyIntoRound.reason, 'incompatible_cart');
  assert.deepEqual(legacyIntoRound.items, [roundItem]);
});

test('저장소에 이미 혼합된 회차 데이터는 구매 가능한 장바구니로 복원하지 않는다', () => {
  const mixedRounds = [
    roundItem,
    {
      ...roundItem,
      productId: 'product-2',
      roundId: 'round-2',
      roundItemId: 'round-item-2',
    },
  ];

  assert.deepEqual(parseCartSnapshot(JSON.stringify(mixedRounds)), []);
  assert.deepEqual(parseCartSnapshot(JSON.stringify([legacyItem, roundItem])), []);
});
