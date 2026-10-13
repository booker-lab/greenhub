import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const cartSource = await readFile(new URL('../../hooks/useCart.ts', import.meta.url), 'utf8');
const compiledCart = ts.transpileModule(cartSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const cartModule = { exports: {} };
const cartRequire = (specifier) => {
  if (specifier === 'react') {
    return {
      useCallback: (callback) => callback,
      useSyncExternalStore: () => [],
    };
  }
  throw new Error(`예상하지 못한 장바구니 모듈 요청: ${specifier}`);
};
new Function('require', 'module', 'exports', compiledCart)(
  cartRequire,
  cartModule,
  cartModule.exports,
);

const source = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');
const testableSource = `${source}
export { parseCheckoutCart, resolveRoundCheckoutSchedule, resolveSingleCheckoutAmount, SingleCheckoutContent };`;
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
      Suspense: () => null,
      useEffect: () => {},
      useRef: (initial) => ({ current: initial }),
      useState: (initial) => [initial, () => {}],
    };
  }
  if (specifier === 'react/jsx-runtime') {
    return { Fragment: Symbol('Fragment'), jsx: () => null, jsxs: () => null };
  }
  if (specifier === '@/hooks/useCart') return cartModule.exports;
  if (specifier === '@/hooks/usePayment') return { usePayment: () => ({}) };
  if (specifier === '@/hooks/useSaleRounds') return { useSaleRounds: () => ({}) };
  if (specifier === '@/lib/acquisition') return { getAcquisitionSnapshot: () => null };
  if (specifier === '@/lib/cartValidation') return { getCartValidationError: () => null };
  if (specifier === '@/lib/checkout-prefill') {
    return { pickCheckoutPrefill: () => ({}), prefillAddress: (c) => c, prefillPhone: (c) => c };
  }
  if (specifier === '@/lib/payment-redirect') return {};
  if (specifier === '@/lib/api-base-url') {
    return { getApiBaseUrl: () => 'http://localhost:3000' };
  }
  if (specifier === '@/lib/portone-config') {
    return {
      readPortonePaymentConfiguration: () => ({
        portoneStoreId: 'portone-store',
        channelKey: 'kakao-channel',
        easyPayProvider: 'KAKAOPAY',
      }),
    };
  }
  if (
    specifier === '@mantine/core' ||
    specifier === 'next/navigation' ||
    specifier === 'next/script' ||
    specifier === 'next-auth/react' ||
    specifier === './_components/CheckoutForm'
  ) {
    return {};
  }
  throw new Error(`예상하지 못한 결제 페이지 모듈 요청: ${specifier}`);
};
new Function('require', 'module', 'exports', compiled)(
  requireForTest,
  pageModule,
  pageModule.exports,
);

const { parseCheckoutCart, resolveRoundCheckoutSchedule, resolveSingleCheckoutAmount } =
  pageModule.exports;

const firstRoundItem = {
  productId: 'product-1',
  name: '호접란 하나',
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

const secondRoundItem = {
  ...firstRoundItem,
  productId: 'product-2',
  name: '호접란 둘',
  quantity: 1,
  roundItemId: 'round-item-2',
};

const round = {
  id: 'round-1',
  storeId: 'store-1',
  status: 'OPEN',
  schedule: {
    orderOpenAt: '2026-07-12T15:00:00.000Z',
    orderCloseAt: '2026-07-19T15:00:00.000Z',
    auctionAt: '2026-07-20T00:00:00.000Z',
    deliveryStartAt: '2026-07-20T15:00:00.000Z',
    deliveryEndAt: '2026-07-21T00:00:00.000Z',
    timezone: 'Asia/Seoul',
  },
  items: [
    {
      id: 'round-item-1',
      roundId: 'round-1',
      storeId: 'store-1',
      productId: 'product-1',
      roundPrice: 23000,
    },
    {
      id: 'round-item-2',
      roundId: 'round-1',
      storeId: 'store-1',
      productId: 'product-2',
      roundPrice: 23000,
    },
  ],
};

test('checkout_cart의 검증된 같은 회차 배열과 기존 legacy 배열을 구분해 복원한다', () => {
  const roundCart = parseCheckoutCart(JSON.stringify([firstRoundItem, secondRoundItem]));
  const legacyCart = parseCheckoutCart(
    JSON.stringify([
      {
        productId: 'legacy-product',
        name: '기존 상품',
        price: 25000,
        image: '',
        quantity: 1,
        saleType: 'normal',
        deliveryMethod: 'parcel',
        storeId: 'store-1',
      },
    ]),
  );

  assert.equal(roundCart.kind, 'round');
  assert.deepEqual(roundCart.items, [firstRoundItem, secondRoundItem]);
  assert.equal(legacyCart.kind, 'legacy');
});

test('빈 배열·손상 입력·불완전 회차·다른 회차 혼합은 결제 입력으로 복원하지 않는다', () => {
  const invalidValues = [
    null,
    '',
    '{깨진 JSON',
    JSON.stringify([]),
    JSON.stringify([{ ...firstRoundItem, roundItemId: undefined }]),
    JSON.stringify([firstRoundItem, { ...secondRoundItem, roundId: 'round-2' }]),
    JSON.stringify([
      firstRoundItem,
      {
        ...secondRoundItem,
        roundId: undefined,
        roundItemId: undefined,
        roundPrice: undefined,
      },
    ]),
  ];

  for (const value of invalidValues) {
    assert.equal(parseCheckoutCart(value).kind, 'invalid');
  }
});

test('검증된 회차 관계와 같은 한국 배송일에서만 requestedDeliveryDate를 결정한다', () => {
  assert.deepEqual(resolveRoundCheckoutSchedule([firstRoundItem, secondRoundItem], [round]), {
    round,
    requestedDeliveryDate: '2026-07-21',
  });
});

test('회차·스토어·상품·가격 관계 또는 배송 일정이 어긋나면 임의 배송일을 만들지 않는다', () => {
  const invalidRounds = [
    { ...round, id: 'round-2' },
    { ...round, storeId: 'store-2' },
    { ...round, items: round.items.slice(0, 1) },
    {
      ...round,
      items: [round.items[0], { ...round.items[1], roundPrice: 1 }],
    },
    {
      ...round,
      schedule: { ...round.schedule, timezone: 'UTC' },
    },
    {
      ...round,
      schedule: {
        ...round.schedule,
        deliveryEndAt: '2026-07-22T00:00:00.000Z',
      },
    },
  ];

  for (const invalidRound of invalidRounds) {
    assert.equal(
      resolveRoundCheckoutSchedule([firstRoundItem, secondRoundItem], [invalidRound]),
      null,
    );
  }
});

test('회차 장바구니는 usePayment 회차 계약과 단일 주문 ID 완료 경로에 연결한다', () => {
  const start = source.indexOf('function RoundCartCheckoutContent');
  const end = source.indexOf('function CartCheckoutContent', start);
  const roundCheckoutSource = source.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(roundCheckoutSource, /usePayment\(\{/);
  assert.match(roundCheckoutSource, /roundItems: cartItems/);
  assert.doesNotMatch(roundCheckoutSource, /for \(const item of cartItems\)/);
  assert.match(roundCheckoutSource, /state !== 'done' \|\| !orderId/);
  assert.match(roundCheckoutSource, /removeItem\('checkout_cart'\)/);
  assert.match(roundCheckoutSource, /\/order\/success\?orderId=\$\{orderId\}/);
  assert.doesNotMatch(roundCheckoutSource, /marketingConsent|marketingAgreedAt/);
  assert.ok(
    roundCheckoutSource.indexOf("state !== 'done' || !orderId") <
      roundCheckoutSource.indexOf("removeItem('checkout_cart')"),
  );
});

test('회차 결제 완료 뒤 결제한 회차 상품만 로컬 장바구니에서 제거한다', () => {
  const start = source.indexOf('function RoundCartCheckoutContent');
  const end = source.indexOf('function CartCheckoutContent', start);
  const roundCheckoutSource = source.slice(start, end);

  assert.match(roundCheckoutSource, /const \{ removeRoundItems \} = useCart\(\)/);
  assert.match(
    roundCheckoutSource,
    /removeRoundItems\(cartItems\.map\(\(item\) => item\.roundItemId\)\)/,
  );
  assert.doesNotMatch(roundCheckoutSource, /clearCart/);
  const doneGuard = roundCheckoutSource.indexOf("state !== 'done' || !orderId");
  const removal = roundCheckoutSource.indexOf('removeRoundItems(cartItems');
  const redirect = roundCheckoutSource.indexOf('router.replace(`/order/success');
  assert.ok(doneGuard < removal && removal < redirect);
});

test('회차 checkout은 mount 뒤 재검증한 유입 스냅샷만 주문 요청에 포함한다', () => {
  const start = source.indexOf('function RoundCartCheckoutContent');
  const end = source.indexOf('function CartCheckoutContent', start);
  const roundCheckoutSource = source.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(source, /import \{ getAcquisitionSnapshot \} from '@\/lib\/acquisition'/);
  assert.match(roundCheckoutSource, /useState<OrderAcquisitionSnapshot \| null>\(null\)/);
  assert.match(
    roundCheckoutSource,
    /useEffect\(\(\) => \{\s*setAcquisition\(getAcquisitionSnapshot\(\)\);\s*\}, \[\]\);/s,
  );
  assert.match(roundCheckoutSource, /\.\.\.\(acquisition \? \{ acquisition \} : \{\}\)/);
  assert.doesNotMatch(roundCheckoutSource, /JSON\.parse\(.*acquisition/s);
});

test('legacy checkout은 기존 PortOne 공개 설정 검증 뒤에만 SDK를 호출한다', () => {
  const start = source.indexOf('function LegacyCartCheckoutContent');
  const end = source.indexOf('function RoundCartCheckoutContent', start);
  const legacyCheckoutSource = source.slice(start, end);
  const guard = legacyCheckoutSource.indexOf('readPortonePaymentConfiguration(paymentMethod)');
  const sdkImport = legacyCheckoutSource.indexOf("await import('@portone/browser-sdk/v2')");

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.ok(guard >= 0 && guard < sdkImport);
  assert.match(legacyCheckoutSource, /storeId: configuration\.portoneStoreId/);
  assert.match(legacyCheckoutSource, /channelKey: configuration\.channelKey/);
});

test('legacy checkout은 장바구니 필수 정보가 없으면 결제 호출 전에 차단한다', () => {
  const start = source.indexOf('function LegacyCartCheckoutContent');
  const end = source.indexOf('function RoundCartCheckoutContent', start);
  const legacyCheckoutSource = source.slice(start, end);

  assert.match(legacyCheckoutSource, /getCartValidationError\(cartItems\)/);
  assert.match(legacyCheckoutSource, /!cartValidationError/);
  assert.match(legacyCheckoutSource, /if \(cartValidationError\)/);
  assert.match(legacyCheckoutSource, /setError\(cartValidationError\)/);
});

test('legacy checkout도 모바일 리다이렉트 복귀 URL과 남은 미결제 상품 수를 결제 전에 남긴다', () => {
  const start = source.indexOf('function LegacyCartCheckoutContent');
  const end = source.indexOf('function RoundCartCheckoutContent', start);
  const legacyCheckoutSource = source.slice(start, end);

  assert.match(
    legacyCheckoutSource,
    /buildPaymentRedirectUrl\(browser\.origin, ORDER_PAYMENT_REDIRECT_PATH\)/,
  );
  assert.match(legacyCheckoutSource, /\.\.\.\(redirectUrl \? \{ redirectUrl \} : \{\}\)/);
  assert.match(legacyCheckoutSource, /unpaidItemCount: cartItems\.length - index - 1/);
  // 앞 상품이 결제된 뒤의 실패는 같은 장바구니 재결제(중복 주문)로 안내하지 않는다.
  assert.match(legacyCheckoutSource, /retryPath: index === 0 \?/);
  const save = legacyCheckoutSource.indexOf('savePendingOrderPayment(');
  const sdkCall = legacyCheckoutSource.indexOf('PortOne.requestPayment(');
  assert.ok(save >= 0 && save < sdkCall);
});

function CheckoutFormStub() {
  return null;
}

/**
 * 단건 checkout을 최소 훅 런타임으로 그려 CheckoutForm에 넘긴 값을 기록한다.
 * 첫 렌더 뒤 effect(상품 조회)를 실행하고, 조회가 끝나면 다시 그린다.
 */
function createSingleCheckoutHarness(search) {
  const slots = [];
  const effects = [];
  const renders = [];
  let cursor = 0;
  const requireForRender = (specifier) => {
    if (specifier === 'react') {
      return {
        Suspense: () => null,
        useEffect: (effect) => {
          effects.push(effect);
        },
        useRef: (initial) => ({ current: initial }),
        useState: (initial) => {
          const index = cursor++;
          if (!(index in slots)) slots[index] = initial;
          return [
            slots[index],
            (next) => {
              slots[index] = typeof next === 'function' ? next(slots[index]) : next;
            },
          ];
        },
      };
    }
    if (specifier === 'react/jsx-runtime') {
      const jsx = (type, props) => {
        if (type === CheckoutFormStub) renders.push(props);
        return null;
      };
      return { Fragment: Symbol('Fragment'), jsx, jsxs: jsx };
    }
    if (specifier === 'next/navigation') {
      return {
        useRouter: () => ({ replace: () => {} }),
        useSearchParams: () => new URLSearchParams(search),
      };
    }
    if (specifier === 'next-auth/react') return { useSession: () => ({ data: null }) };
    if (specifier === '@/hooks/usePayment') {
      return {
        usePayment: () => ({ state: 'idle', orderId: null, error: null, requestPayment: () => {} }),
      };
    }
    if (specifier === './_components/CheckoutForm') {
      return { __esModule: true, default: CheckoutFormStub };
    }
    return requireForTest(specifier);
  };
  const renderModule = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    requireForRender,
    renderModule,
    renderModule.exports,
  );

  return {
    render() {
      cursor = 0;
      renderModule.exports.SingleCheckoutContent();
      return renders.at(-1);
    },
    async runEffectsAndSettle() {
      for (const effect of effects.splice(0)) effect();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

async function withFetch(fetchImpl, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const serverProduct = {
  id: 'product-1',
  storeId: 'store-1',
  name: '서버 상품',
  price: 25000,
  saleType: 'normal',
};

test('단건 checkout은 URL totalAmount를 무시하고 서버 상품 가격으로만 결제 금액을 표시한다', async () => {
  const base = 'productId=product-1&quantity=2&saleType=normal&deliveryMethod=parcel';
  for (const search of [base, `${base}&totalAmount=1`, `${base}&totalAmount=99999999`]) {
    const requestedUrls = [];
    await withFetch(
      async (url) => {
        requestedUrls.push(url);
        return { ok: true, json: async () => serverProduct };
      },
      async () => {
        const harness = createSingleCheckoutHarness(search);

        const beforeFetch = harness.render();
        assert.equal(beforeFetch.totalAmount, null, `${search}: 조회 전에는 확인 중`);
        assert.equal(beforeFetch.error, null);

        await harness.runEffectsAndSettle();
        const afterFetch = harness.render();
        assert.equal(afterFetch.totalAmount, 50000, `${search}: 서버 가격 x 수량`);
        assert.equal(afterFetch.error, null);
      },
    );
    assert.deepEqual(requestedUrls, ['http://localhost:3000/products/product-1']);
  }
});

test('단건 checkout은 상품 조회에 실패하면 URL 금액 대신 금액을 숨기고 오류를 안내한다', async () => {
  await withFetch(
    async () => ({ ok: false, json: async () => ({}) }),
    async () => {
      const harness = createSingleCheckoutHarness(
        'productId=product-1&quantity=1&saleType=normal&deliveryMethod=parcel&totalAmount=1000',
      );
      harness.render();
      await harness.runEffectsAndSettle();
      const rendered = harness.render();
      assert.equal(rendered.totalAmount, 0);
      assert.match(rendered.error, /상품 정보를 불러오지 못했습니다/);
    },
  );
});

test('단건 checkout 표시 금액은 서버 가격과 정수 수량이 모두 유효할 때만 계산한다', () => {
  assert.equal(resolveSingleCheckoutAmount(null, 2, false), null);
  assert.equal(resolveSingleCheckoutAmount(null, 2, true), 0);
  assert.equal(resolveSingleCheckoutAmount({ price: 25000 }, 2, true), 0);
  assert.equal(resolveSingleCheckoutAmount({ price: 25000 }, 3, false), 75000);
  for (const quantity of [0, -1, 1.5, Number.NaN]) {
    assert.equal(resolveSingleCheckoutAmount({ price: 25000 }, quantity, false), 0);
  }
  for (const price of [-1, 1.5, '25000', undefined]) {
    assert.equal(resolveSingleCheckoutAmount({ price }, 1, false), 0);
  }
  assert.equal(resolveSingleCheckoutAmount({ price: Number.MAX_SAFE_INTEGER }, 2, false), 0);
});

test('단건 checkout은 URL의 totalAmount 쿼리를 읽지 않는다', () => {
  const start = source.indexOf('function SingleCheckoutContent');
  const end = source.indexOf('function LegacyCartCheckoutContent', start);
  const singleCheckoutSource = source.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.doesNotMatch(source, /params\.get\('totalAmount'\)/);
  assert.match(
    singleCheckoutSource,
    /resolveSingleCheckoutAmount\(product, quantity, productUnavailable\)/,
  );
});
