import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');
const testableSource = `${source}
export {
  buildRoundCartValidationRequest,
  cartItemKey,
  resolveRoundCartBatchValidation,
  resolveRoundCartValidation,
  selectCheckoutItems,
};`;
const compiled = ts.transpileModule(testableSource, {
  compilerOptions: {
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'page.tsx',
}).outputText;

const pageModule = { exports: {} };
const requireForTest = (specifier) => {
  if (specifier === 'react') {
    return {
      useEffect: () => {},
      useMemo: (factory) => factory(),
      useState: (initial) => [initial, () => {}],
    };
  }
  if (specifier === 'react/jsx-runtime') {
    return { jsx: () => null, jsxs: () => null };
  }
  if (specifier === '@/hooks/useCart') {
    return {
      isRoundCartItem: (item) =>
        typeof item?.roundId === 'string' &&
        typeof item?.roundItemId === 'string' &&
        item.roundPrice === item.price,
      useCart: () => ({ items: [] }),
    };
  }
  if (
    specifier === 'next/link' ||
    specifier === 'next/navigation' ||
    specifier === 'next-auth/react' ||
    specifier === '@mantine/core'
  ) {
    return {};
  }
  throw new Error(`예상하지 못한 모듈 요청: ${specifier}`);
};

new Function('require', 'module', 'exports', compiled)(
  requireForTest,
  pageModule,
  pageModule.exports,
);

const {
  buildRoundCartValidationRequest,
  cartItemKey,
  resolveRoundCartBatchValidation,
  resolveRoundCartValidation,
  selectCheckoutItems,
} = pageModule.exports;

const roundItem = {
  productId: 'product-1',
  name: '이번 주 호접란',
  price: 23000,
  image: '',
  quantity: 2,
  saleType: 'normal',
  deliveryMethod: 'direct',
  storeId: 'store-1',
  roundId: 'round-1',
  roundItemId: 'round-item-1',
  roundPrice: 23000,
};

const matchingResponse = {
  ok: true,
  salesMode: 'round_direct',
  roundId: 'round-1',
  itemQuantityTotal: 2,
  totalAmount: 46000,
  items: [
    {
      roundItemId: 'round-item-1',
      productId: 'product-1',
      productName: '이번 주 호접란',
      unitPrice: 23000,
      quantity: 2,
      subtotalAmount: 46000,
    },
  ],
};

test('검증 요청은 저장된 회차 관계와 수량을 그대로 사용하고 임의 회차를 만들지 않는다', () => {
  const request = buildRoundCartValidationRequest(roundItem);

  assert.equal(request.roundId, 'round-1');
  assert.equal(request.productId, 'product-1');
  assert.equal(request.quantity, 2);
  assert.deepEqual(request.roundItems, [{ roundItemId: 'round-item-1', quantity: 2 }]);
  assert.doesNotMatch(JSON.stringify(request), /round-(?:open|current|default)/);
});

test('서버 응답의 회차·상품·수량·가격·합계가 모두 일치한 항목만 결제 가능하다', () => {
  assert.deepEqual(resolveRoundCartValidation(roundItem, matchingResponse), {
    status: 'eligible',
    currentUnitPrice: 23000,
  });
});

test('여러 항목은 회차 전체 수량과 금액까지 함께 검증한 결과만 결제 가능하다', () => {
  const anotherRoundItem = {
    ...roundItem,
    productId: 'product-2',
    roundItemId: 'round-item-2',
    quantity: 1,
  };
  const response = {
    ...matchingResponse,
    itemQuantityTotal: 3,
    totalAmount: 69000,
    items: [
      matchingResponse.items[0],
      {
        ...matchingResponse.items[0],
        roundItemId: 'round-item-2',
        productId: 'product-2',
        quantity: 1,
        subtotalAmount: 23000,
      },
    ],
  };

  assert.deepEqual(resolveRoundCartBatchValidation([roundItem, anotherRoundItem], response), {
    [cartItemKey(roundItem)]: { status: 'eligible', currentUnitPrice: 23000 },
    [cartItemKey(anotherRoundItem)]: { status: 'eligible', currentUnitPrice: 23000 },
  });
  assert.deepEqual(
    resolveRoundCartBatchValidation(
      [roundItem, anotherRoundItem],
      { ...response, itemQuantityTotal: 2 },
    ),
    {
      [cartItemKey(roundItem)]: {
        status: 'unavailable',
        reason: '서버 검증 응답을 확인할 수 없습니다.',
      },
      [cartItemKey(anotherRoundItem)]: {
        status: 'unavailable',
        reason: '서버 검증 응답을 확인할 수 없습니다.',
      },
    },
  );
});

test('서버 가격이 변경된 항목은 현재 가격을 알리되 결제 대상에서 제외한다', () => {
  const response = {
    ...matchingResponse,
    totalAmount: 50000,
    items: [{ ...matchingResponse.items[0], unitPrice: 25000, subtotalAmount: 50000 }],
  };

  assert.deepEqual(resolveRoundCartValidation(roundItem, response), {
    status: 'price_changed',
    currentUnitPrice: 25000,
    reason: '가격이 변경되어 확인이 필요합니다.',
  });
});

test('회차 관계가 다르거나 응답이 손상되면 기존 항목을 구매 가능으로 간주하지 않는다', () => {
  const wrongRound = { ...matchingResponse, roundId: 'round-2' };
  const wrongProduct = {
    ...matchingResponse,
    items: [{ ...matchingResponse.items[0], productId: 'product-2' }],
  };
  const brokenAmount = { ...matchingResponse, totalAmount: 1 };

  for (const response of [wrongRound, wrongProduct, brokenAmount, null]) {
    assert.deepEqual(resolveRoundCartValidation(roundItem, response), {
      status: 'unavailable',
      reason: '서버 검증 응답을 확인할 수 없습니다.',
    });
  }
});

test('마감·품절·구매 불가 서버 사유를 항목별 제외 사유로 정규화한다', () => {
  assert.deepEqual(resolveRoundCartValidation(roundItem, null, '주문 마감된 회차입니다.'), {
    status: 'unavailable',
    reason: '판매가 마감되었습니다.',
  });
  assert.deepEqual(resolveRoundCartValidation(roundItem, null, '회차 상품 수량이 마감되었습니다.'), {
    status: 'unavailable',
    reason: '요청한 수량을 구매할 수 없습니다.',
  });
  assert.deepEqual(resolveRoundCartValidation(roundItem, null, '구매할 수 없는 회차 상품입니다.'), {
    status: 'unavailable',
    reason: '판매가 마감되었습니다.',
  });
});

test('결제 대상은 같은 회차의 서버 검증 통과 항목만 포함하고 legacy 항목은 보존한다', () => {
  const anotherRoundItem = {
    ...roundItem,
    productId: 'product-2',
    roundItemId: 'round-item-2',
  };
  const validationByKey = {
    [cartItemKey(roundItem)]: { status: 'eligible', currentUnitPrice: 23000 },
    [cartItemKey(anotherRoundItem)]: {
      status: 'unavailable',
      reason: '판매가 마감되었습니다.',
    },
  };
  const legacyItem = {
    ...roundItem,
    roundId: undefined,
    roundItemId: undefined,
    roundPrice: undefined,
  };

  assert.deepEqual(selectCheckoutItems([roundItem, anotherRoundItem], validationByKey), [roundItem]);
  assert.deepEqual(selectCheckoutItems([legacyItem], {}), [legacyItem]);
});

test('화면은 기존 검증 API와 인증을 사용하고 제외 항목을 장바구니에서 삭제하지 않는다', () => {
  assert.match(source, /\/orders\/validate-cart/);
  assert.match(source, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(source, /isRoundCartItem/);
  assert.match(source, /가격이 변경/);
  assert.match(source, /판매가 마감/);
  assert.match(source, /결제 대상에서 제외/);
  assert.match(source, /JSON\.stringify\(checkoutItems\)/);
  assert.doesNotMatch(source, /clearCart\(\).*validate/s);
});
