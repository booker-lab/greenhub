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
  roundExtrasRound,
  selectCheckoutItems,
  validateRoundCartItems,
  validationRetryState,
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
    specifier === '@greenhub/ui/components/alert' ||
    specifier === '@greenhub/ui/components/badge' ||
    specifier === '@greenhub/ui/components/status-dot' ||
    specifier === '@greenhub/ui/components/button' ||
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
  roundExtrasRound,
  selectCheckoutItems,
  validateRoundCartItems,
  validationRetryState,
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
        reason: '구매 가능 여부를 아직 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
      },
      [cartItemKey(anotherRoundItem)]: {
        status: 'unavailable',
        reason: '구매 가능 여부를 아직 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
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
      reason: '구매 가능 여부를 아직 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
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

test('해결 방법이 든 서버 안내는 그대로, 옵션 미선택은 상품 화면 안내로, 기술 메시지는 일반 문구로 보인다', () => {
  const reasonOf = (message) => resolveRoundCartValidation(roundItem, null, message).reason;
  assert.equal(
    reasonOf('옵션을 묶음마다 하나씩 골라 주세요.'),
    '옵션을 골라야 하는 상품이에요. 상품 화면에서 옵션을 고른 뒤 다시 담아 주세요.',
  );
  for (const message of [
    '화분 흰색 2개만 남았어요. 수량을 줄이거나 다른 옵션을 골라 주세요.',
    '화분 흰색 다 팔렸어요. 다른 옵션을 골라 주세요.',
    '호접란 이번 회차에 한 분당 1개까지 주문할 수 있어요. 수량을 줄여 다시 시도해 주세요.',
    '이전 결제 시도를 아직 처리하고 있어요. 잠시 후 다시 시도하거나 주문 내역을 확인해 주세요.',
    '이 가게는 지금 주문을 받지 않아요.',
  ]) {
    assert.equal(reasonOf(message), message);
  }
  for (const message of ['roundItems.0.quantity must not be greater than 99', '가'.repeat(200)]) {
    assert.equal(reasonOf(message), '구매 가능 여부를 아직 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
});

test('확인 실패 사유는 내부 용어("서버") 없이 다시 시도할 수 있는 고객 문구로 보인다', () => {
  const reasonOf = (message) => resolveRoundCartValidation(roundItem, null, message).reason;
  // 메시지가 없거나 내부 용어가 든 안내는 일반 문구로 바꾼다.
  for (const message of [undefined, '서버 검증 실패', '서버 오류로 남았어요 확인이 어려워요.']) {
    const reason = message === undefined
      ? resolveRoundCartValidation(roundItem, null).reason
      : reasonOf(message);
    assert.equal(reason, '구매 가능 여부를 아직 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  // 화면 문구와 검증 실패 처리에 "서버"가 든 문자열이 남지 않는다(주석은 제외).
  const strings = source.match(/'[^'\n]*'/g) ?? [];
  assert.deepEqual(strings.filter((value) => value.includes('서버')), []);
  assert.doesNotMatch(source, /unavailableValidations\(roundItems, '[^']*'\)/);
});

test('내부 용어("서버")와 해결 방법이 함께 든 안내는 그 문장만 빼고 해결 방법을 보인다', () => {
  const reasonOf = (message) => resolveRoundCartValidation(roundItem, null, message).reason;
  assert.equal(
    reasonOf('서버에서 재고를 다시 확인했어요. 화분 흰색 2개만 남았어요. 수량을 줄여 주세요.'),
    '화분 흰색 2개만 남았어요. 수량을 줄여 주세요.',
  );
  assert.equal(
    reasonOf('호접란 이번 회차에 한 분당 1개까지 주문할 수 있어요. 서버 기준이에요.'),
    '호접란 이번 회차에 한 분당 1개까지 주문할 수 있어요.',
  );
  // 옵션 미선택은 내부 용어가 같이 있어도 상품 화면 안내로 보인다.
  assert.equal(
    reasonOf('서버 확인 결과예요. 옵션을 묶음마다 하나씩 골라 주세요.'),
    '옵션을 골라야 하는 상품이에요. 상품 화면에서 옵션을 고른 뒤 다시 담아 주세요.',
  );
  // 해결 방법이 내부 용어와 같은 문장에만 있으면 일반 문구로 바꾼다("서버"가 화면에 나가지 않는다).
  for (const message of [
    '서버 기준으로 화분 흰색 2개만 남았어요.',
    '서버 점검 중이에요. 잠시 후 이용해 주세요.',
  ]) {
    const reason = reasonOf(message);
    assert.doesNotMatch(reason, /서버/);
    assert.equal(reason, '구매 가능 여부를 아직 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  // 해결 안내 규칙을 내부 용어 검사보다 먼저 본다.
  const body = source.slice(source.indexOf('function unavailableReason'));
  assert.ok(
    body.indexOf('ACTIONABLE_SERVER_REASON.test(actionable)') <
      body.indexOf('INTERNAL_TERM.test(trimmed)'),
  );
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

test('회차 주문이 끝나면 지난 마감 시각 대신 마감 안내를 보이고 비로그인 주문 버튼을 막는다', () => {
  // 지금 회차가 바뀌어도(다음 회차 열림) 장바구니 회차를 받은 회차 목록에서 찾아 판정한다.
  assert.match(
    source,
    /saleRounds\.rounds\.find\(\(round\) => round\.id === firstRoundItem\.roundId\)/,
  );
  assert.match(source, /isRoundOrderClosed\(itemsRound, Date\.now\(\)\)/);
  assert.match(source, /roundOrderClosed\s+\? '이번 회차 주문이 마감됐어요\.'/);
  assert.match(source, /결제해야 이번 회차로 배송돼요\./);
  assert.match(source, /disabled=\{roundOrderClosed\}/);
  assert.match(source, /이번 회차 주문이 마감돼서 지금은 주문할 수 없어요\./);
});

test('회차 주문이 마감되면 도착 안내와 이번 회차 추가 제안을 숨기고, 마감 전에는 그대로 보인다', () => {
  const round = { id: 'round-1', status: 'OPEN' };
  assert.equal(roundExtrasRound(round, false), round);
  assert.equal(roundExtrasRound(round, true), null);
  assert.equal(roundExtrasRound(null, false), null);
  assert.equal(roundExtrasRound(null, true), null);
  // 1차 배치의 마감 판정(roundOrderClosed)을 그대로 쓰고, 두 안내 모두 판정 결과로만 그린다.
  assert.match(source, /const extrasRound = roundExtrasRound\(cartRound, roundOrderClosed\);/);
  assert.match(source, /\{extrasRound && <CartArrivalLine round=\{extrasRound\} \/>\}/);
  assert.match(source, /\{extrasRound && <CartUpsell round=\{extrasRound\} items=\{items\} \/>\}/);
  assert.doesNotMatch(source, /<CartArrivalLine round=\{cartRound\}|<CartUpsell round=\{cartRound\}/);
});

test('회차 안내와 상품별 확인 표시는 내부 용어("서버") 없이 고객 문구로 보인다', () => {
  assert.match(source, /이번 회차 상품을 한 번에 결제해요\./);
  assert.match(source, />\s*구매 가능\s*<\/p>/);
  assert.match(source, />\s*구매 가능 여부 확인 중\s*<\/p>/);
  assert.doesNotMatch(source, /서버 확인 완료|서버에서 확인해 한 번에 결제|서버에서 구매 가능 여부 확인 중/);
});

test('수량 1에서는 줄이기 버튼을 막아 확인 없이 상품이 빠지지 않게 한다', () => {
  const minusStart = source.indexOf('수량 줄이기`}');
  assert.notEqual(minusStart, -1);
  const minusButton = source.slice(minusStart, source.indexOf('</button>', minusStart));
  assert.match(minusButton, /disabled=\{item\.quantity <= 1\}/);
  assert.match(minusButton, /updateQuantity\(item\.productId, item\.quantity - 1\)/);
  // 삭제는 "삭제" 버튼(removeItem)으로만 한다.
  assert.match(source, /onClick=\{\(\) => removeItem\(item\.productId\)\}/);
});

test('수량 변경은 마지막 수량만 검증하도록 요청을 잠시 미룬다', () => {
  assert.match(source, /VALIDATION_DEBOUNCE_MS = 300/);
  assert.match(source, /clearTimeout\(timer\)/);
});

test('확인 요청이 실패한 상품이 있을 때만 "다시 확인"을 보이고, 확인하는 동안은 누를 수 없다', () => {
  const unverified = {
    status: 'unavailable',
    reason: '구매 가능 여부를 아직 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
  };
  const key = cartItemKey(roundItem);
  assert.equal(validationRetryState({ status: 'ready', items: { [key]: unverified } }), 'ready');
  // 다시 확인하는 동안은 앞선 실패 안내를 둔 채 버튼만 "확인 중"으로 막는다.
  assert.equal(
    validationRetryState({ status: 'loading', items: { [key]: unverified } }),
    'checking',
  );
  // 실패가 아니거나 다시 확인해도 바뀌지 않는 사유(마감·로그인 필요)면 버튼을 두지 않는다.
  for (const item of [
    { status: 'eligible', currentUnitPrice: 23000 },
    { status: 'price_changed', currentUnitPrice: 25000, reason: '가격이 변경되어 확인이 필요합니다.' },
    { status: 'unavailable', reason: '판매가 마감되었습니다.' },
    { status: 'unavailable', reason: '로그인 후 구매 가능 여부를 확인해 주세요.' },
  ]) {
    assert.equal(validationRetryState({ status: 'ready', items: { [key]: item } }), 'hidden');
  }
  assert.equal(validationRetryState({ status: 'loading', items: {} }), 'hidden');
  assert.equal(validationRetryState({ status: 'idle', items: {} }), 'hidden');
});

test('"다시 확인"은 같은 확인을 바로 다시 실행하고, 확인 중에는 다시 보내지 않는다', () => {
  // 다시 확인 횟수가 바뀌면 같은 검증 effect가 다시 실행된다.
  assert.match(source, /\}, \[accessToken, items, sessionStatus, retryCount\]\);/);
  assert.match(
    source,
    /const retry = useCallback\(\(\) => setRetryCount\(\(count\) => count \+ 1\), \[\]\);/,
  );
  // 다시 확인은 미루지 않고 바로 보내며, 결과가 오기 전까지 앞선 안내를 유지한다.
  assert.match(
    source,
    /const delay = !isRetry && validatedOnceRef\.current \? VALIDATION_DEBOUNCE_MS : 0;/,
  );
  assert.match(source, /items: isRetry \? previous\.items : \{\}/);
  const buttonStart = source.indexOf("{retryState !== 'hidden' && (");
  assert.notEqual(buttonStart, -1);
  const button = source.slice(buttonStart, source.indexOf('</Button>', buttonStart));
  assert.match(button, /disabled=\{retryState === 'checking'\}/);
  assert.match(button, /if \(retryState === 'ready'\) retryValidation\(\);/);
  assert.match(button, /'다시 확인하는 중' : '다시 확인'/);
});
