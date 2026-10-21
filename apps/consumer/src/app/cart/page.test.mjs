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
  validateRoundCartItems,
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
      useRef: (current) => ({ current }),
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
  if (specifier === '@/lib/cartValidation') {
    return {
      getCartItemValidationIssues: () => [],
      getCartValidationError: () => null,
    };
  }
  // 팔도감 벤치마킹 비교 기능(기능 토글이 꺼진 운영 기본값으로 검사한다).
  if (specifier === '@/lib/features') {
    return { isFeatureOn: () => false };
  }
  if (specifier === '@/components/benchmark/CartExtras') {
    return {};
  }
  if (specifier === '@/components/ResilientImage') {
    return { default: () => null, PRODUCT_IMAGE_FALLBACK: '/images/product-placeholder.png' };
  }
  if (specifier === '@/lib/api-base-url') {
    return { getApiBaseUrl: () => 'http://localhost:3000' };
  }
  if (
    specifier === 'next/link' ||
    specifier === 'next/navigation' ||
    specifier === 'next-auth/react' ||
    specifier === '@mantine/core' ||
    specifier === 'lucide-react' ||
    specifier === '@/hooks/useSaleRounds' ||
    specifier === '@/lib/round-schedule-label'
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
  validateRoundCartItems,
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

test('공개 회차에서 품절인 상품은 품절 태그를 달고 결제 제외는 서버 검증이 정한다', () => {
  assert.match(
    source,
    /candidate\.id === roundItem\.roundItemId && candidate\.status === 'SOLD_OUT'/,
  );
  assert.match(source, /\{soldOut && \(/);
  assert.match(source, /품절\s*<\/span>/);
  // 결제 대상은 여전히 서버 검증(eligible)만으로 고른다.
  assert.match(
    source,
    /items\.filter\(\(item\) => validationByKey\[cartItemKey\(item\)\]\?\.status === 'eligible'\)/,
  );
});

test('legacy 필수 정보가 없으면 현재 장바구니 화면에서 수정 후 결제로만 진행한다', () => {
  assert.match(source, /getCartItemValidationIssues/);
  assert.match(source, /getCartValidationError/);
  assert.match(source, /hasLegacyValidationIssues/);
  assert.match(source, /다시 선택하기/);
  assert.match(
    source,
    /disabled=\{checkoutItems\.length === 0 \|\| isChecking \|\| hasLegacyValidationIssues\}/,
  );
  assert.match(
    source,
    /if \(checkoutItems\.length === 0 \|\| isChecking \|\| hasLegacyValidationIssues\) return;/,
  );
});

function stubFetch(handler) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    const { status, json } = handler(body);
    return { ok: status < 400, json: async () => json };
  };
  return { requests, restore: () => (globalThis.fetch = original) };
}

const secondRoundItem = {
  ...roundItem,
  productId: 'product-2',
  roundItemId: 'round-item-2',
  quantity: 1,
};
const serverItemFor = (item) => ({
  roundItemId: item.roundItemId,
  productId: item.productId,
  productName: item.name,
  unitPrice: item.price,
  quantity: item.quantity,
  subtotalAmount: item.price * item.quantity,
});
const okResponseFor = (items) => ({
  ok: true,
  salesMode: 'round_direct',
  roundId: 'round-1',
  itemQuantityTotal: items.reduce((sum, item) => sum + item.quantity, 0),
  totalAmount: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
  items: items.map(serverItemFor),
});

test('묶음 검증이 통과하면 상품별 검증 없이 요청 1회로 끝낸다', async () => {
  const items = [roundItem, secondRoundItem];
  const stub = stubFetch(() => ({ status: 201, json: okResponseFor(items) }));
  try {
    const resolved = await validateRoundCartItems(items, 'token', new AbortController().signal);
    assert.equal(stub.requests.length, 1);
    assert.equal(stub.requests[0].roundItems.length, 2);
    assert.deepEqual(resolved, {
      [cartItemKey(roundItem)]: { status: 'eligible', currentUnitPrice: 23000 },
      [cartItemKey(secondRoundItem)]: { status: 'eligible', currentUnitPrice: 23000 },
    });
  } finally {
    stub.restore();
  }
});

test('묶음 검증이 실패하면 상품별로 다시 확인해 안 되는 상품만 제외한다', async () => {
  const items = [roundItem, secondRoundItem];
  const stub = stubFetch((body) => {
    const ids = body.roundItems.map((item) => item.roundItemId);
    if (ids.includes('round-item-2')) {
      return { status: 409, json: { message: '회차 상품 수량이 마감되었습니다.' } };
    }
    return { status: 201, json: okResponseFor([roundItem]) };
  });
  try {
    const resolved = await validateRoundCartItems(items, 'token', new AbortController().signal);
    // 묶음 1회 + 상품별 2회. 통과한 상품이 1개라 다시 묶어 보내지 않는다.
    assert.equal(stub.requests.length, 3);
    assert.deepEqual(resolved, {
      [cartItemKey(roundItem)]: { status: 'eligible', currentUnitPrice: 23000 },
      [cartItemKey(secondRoundItem)]: {
        status: 'unavailable',
        reason: '요청한 수량을 구매할 수 없습니다.',
      },
    });
  } finally {
    stub.restore();
  }
});

test('상품이 1개면 실패해도 같은 요청을 다시 보내지 않는다', async () => {
  const stub = stubFetch(() => ({ status: 400, json: { message: '주문 마감된 회차입니다.' } }));
  try {
    const resolved = await validateRoundCartItems(
      [roundItem],
      'token',
      new AbortController().signal,
    );
    assert.equal(stub.requests.length, 1);
    assert.deepEqual(resolved, {
      [cartItemKey(roundItem)]: { status: 'unavailable', reason: '판매가 마감되었습니다.' },
    });
  } finally {
    stub.restore();
  }
});

test('수량 변경은 마지막 수량만 검증하도록 요청을 잠시 미룬다', () => {
  assert.match(source, /VALIDATION_DEBOUNCE_MS = 300/);
  assert.match(source, /clearTimeout\(timer\)/);
});
