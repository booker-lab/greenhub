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

// 회차 마감 판정은 실제 checkout-round-closed 모듈(일정 판정은 round-schedule-label)로 만든다.
const libCompilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 };
const scheduleLabelModule = { exports: {} };
new Function(
  'module',
  'exports',
  ts.transpileModule(
    await readFile(new URL('../../lib/round-schedule-label.ts', import.meta.url), 'utf8'),
    { compilerOptions: libCompilerOptions },
  ).outputText,
)(scheduleLabelModule, scheduleLabelModule.exports);
const roundClosedModule = { exports: {} };
new Function(
  'require',
  'module',
  'exports',
  ts.transpileModule(
    await readFile(new URL('../../lib/checkout-round-closed.ts', import.meta.url), 'utf8'),
    { compilerOptions: libCompilerOptions },
  ).outputText,
)(
  (specifier) => {
    if (specifier === '@/lib/round-schedule-label') return scheduleLabelModule.exports;
    throw new Error(`예상하지 못한 회차 마감 모듈 요청: ${specifier}`);
  },
  roundClosedModule,
  roundClosedModule.exports,
);

const source = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');
const testableSource = `${source}
export { CartCheckoutContent, parseCheckoutCart, RoundClosedNotice, resolveRoundCheckoutSchedule, resolveRoundScheduleError, resolveSingleCheckoutAmount, SingleCheckoutContent, staleRoundsDetail };`;
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
  if (specifier === '@/lib/checkout-round-closed') return roundClosedModule.exports;
  if (specifier === '@/lib/checkout-prefill') {
    return { pickCheckoutPrefill: () => ({}), prefillAddress: (c) => c, prefillPhone: (c) => c };
  }
  if (specifier === '@/lib/payment-redirect') return {};
  if (specifier === '@/lib/payment-checkout-draft') {
    return {
      checkoutDraftCartKey: () => '',
      clearCheckoutDraft: () => {},
      loadCheckoutDraft: () => null,
      readCheckoutDraftStorage: () => null,
      saveCheckoutDraft: () => {},
    };
  }
  if (specifier === '@/lib/payment-page-guard') return { attachPaymentPageGuard: () => () => {} };
  if (specifier === '@/lib/payment-failure-message') {
    return { paymentFailureMessage: () => '결제를 취소했어요. 장바구니는 그대로 남아 있어요.' };
  }
  if (specifier === '@/lib/korean-mobile-phone') {
    return { isKoreanMobilePhone: () => true, ROUND_DELIVERY_PHONE_ERROR: '' };
  }
  if (specifier === '@/lib/api-base-url') {
    return { getApiBaseUrl: () => 'http://localhost:3000' };
  }
  if (specifier === '@/lib/load-error-message') {
    return { CONNECTION_UNSTABLE_MESSAGE: '연결이 불안정해요. 잠시 후 다시 시도해 주세요.' };
  }
  if (specifier === '@/lib/portone-config') {
    return {
      readPortonePaymentConfiguration: () => ({
        portoneStoreId: 'portone-store',
        channelKey: 'kakao-channel',
        paymentMethod: 'kakaopay',
      }),
      buildPortonePayMethodRequest: () => ({
        payMethod: 'EASY_PAY',
        easyPay: { easyPayProvider: 'KAKAOPAY' },
      }),
    };
  }
  // 벤치마킹 비교 기능 모듈: 이 테스트에서는 모두 꺼진 상태로 둔다.
  if (specifier === '@/components/benchmark/GiftFields') {
    return { EMPTY_GIFT: { enabled: false }, giftPayload: () => null };
  }
  if (specifier === '@/components/benchmark/PackageLabelFields') {
    return { EMPTY_PACKAGE_LABEL: { enabled: false, text: '' }, packageLabelPayload: () => null };
  }
  if (specifier === '@/lib/features') return { isFeatureOn: () => false };
  if (specifier === '@/lib/round-schedule-label') return { formatRoundTime: () => null };
  if (
    specifier === '@greenhub/ui/components/button' ||
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

const {
  parseCheckoutCart,
  resolveRoundCheckoutSchedule,
  resolveRoundScheduleError,
  resolveSingleCheckoutAmount,
  staleRoundsDetail,
} = pageModule.exports;

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
  // 결제창이 끝나면 이 시도가 저장한 기록만 지운다. 같은 탭 복귀 뒤 새 결제의 기록은 남긴다.
  assert.match(
    legacyCheckoutSource,
    /clearOwnPendingOrderPayment\(browser\?\.storage \?\? null, pending\)/,
  );
  assert.doesNotMatch(legacyCheckoutSource, /savePendingOrderPayment\([^)]*, null\)/);
});

test('결제창 호출은 고른 결제수단으로 파라미터를 만들고 간편결제를 고정하지 않는다', () => {
  const start = source.indexOf('function LegacyCartCheckoutContent');
  const end = source.indexOf('function RoundCartCheckoutContent', start);
  const legacyCheckoutSource = source.slice(start, end);

  assert.match(legacyCheckoutSource, /readPortonePaymentConfiguration\(paymentMethod\)/);
  assert.match(
    legacyCheckoutSource,
    /\.\.\.buildPortonePayMethodRequest\(configuration\.paymentMethod, \{/,
  );
  assert.match(legacyCheckoutSource, /phone: deliveryPhone\.trim\(\)/);
  assert.doesNotMatch(source, /payMethod: 'EASY_PAY'/);
  // usePayment를 쓰는 단건·회차 결제도 구매자 정보를 넘긴다.
  assert.equal(
    source.match(/buyer: \{ name: session\?\.user\?\.name, phone: deliveryPhone\.trim\(\) \}/g)
      ?.length,
    2,
  );
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

test('회차 결제는 받는 분 연락처가 휴대폰 번호일 때만 결제 버튼을 연다', () => {
  const roundSection = source.slice(source.indexOf('function RoundCartCheckoutContent'));
  assert.match(
    roundSection,
    /const deliveryPhoneValid = isKoreanMobilePhone\(deliveryPhone\.trim\(\)\);/,
  );
  assert.match(roundSection, /deliveryPhoneValid &&\n\s+!!session;/);
  assert.match(
    roundSection,
    /deliveryPhoneError=\{deliveryPhoneValid \? null : ROUND_DELIVERY_PHONE_ERROR\}/,
  );
});

test('legacy checkout 결제창 실패는 PG 원문 대신 고객 문구로 보인다', () => {
  const start = source.indexOf('function LegacyCartCheckoutContent');
  const end = source.indexOf('function RoundCartCheckoutContent', start);
  const legacyCheckoutSource = source.slice(start, end);
  assert.match(legacyCheckoutSource, /setError\(paymentFailureMessage\(response\)\)/);
  assert.doesNotMatch(legacyCheckoutSource, /setError\(response\.message/);
});

/** 장바구니 checkout을 저장소에 결제 상품이 없는(invalid) 상태로 그려 화면 요소와 이동을 기록한다. */
function renderInvalidCartCheckout() {
  const elements = [];
  const pushes = [];
  const ButtonStub = () => null;
  const textOf = (children) =>
    (Array.isArray(children) ? children : [children])
      .filter((child) => typeof child === 'string')
      .join('');
  const requireForRender = (specifier) => {
    if (specifier === 'react') {
      return {
        Suspense: () => null,
        useEffect: () => {},
        useRef: (initial) => ({ current: initial }),
        useState: () => [{ kind: 'invalid', items: [] }, () => {}],
      };
    }
    if (specifier === 'react/jsx-runtime') {
      const jsx = (type, props) => {
        elements.push({ type, props, text: textOf(props?.children) });
        return null;
      };
      return { Fragment: Symbol('Fragment'), jsx, jsxs: jsx };
    }
    if (specifier === 'next/navigation') {
      return {
        useRouter: () => ({ push: (path) => pushes.push(path), replace: () => {} }),
        useSearchParams: () => new URLSearchParams('from=cart'),
      };
    }
    if (specifier === '@greenhub/ui/components/button') return { Button: ButtonStub };
    return requireForTest(specifier);
  };
  const renderModule = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    requireForRender,
    renderModule,
    renderModule.exports,
  );
  renderModule.exports.CartCheckoutContent();
  return { elements, pushes, buttons: elements.filter((element) => element.type === ButtonStub) };
}

test('결제할 장바구니 정보가 없으면 장바구니·홈으로 돌아갈 버튼을 보인다', () => {
  const { elements, pushes, buttons } = renderInvalidCartCheckout();

  assert.ok(
    elements.some((element) =>
      element.text.includes('결제할 상품 정보가 없어요. 장바구니에서 다시 결제해 주세요.'),
    ),
  );
  assert.deepEqual(
    buttons.map((button) => button.text),
    ['장바구니로 가기', '홈으로'],
  );
  // 장바구니로 가기가 주 버튼이고 홈으로는 보조(ghost) 버튼이다.
  assert.equal(buttons[0].props.variant, undefined);
  assert.equal(buttons[1].props.variant, 'ghost');
  for (const button of buttons) button.props.onClick();
  assert.deepEqual(pushes, ['/cart', '/']);
  assert.doesNotMatch(source, /결제할 장바구니 정보를 확인할 수 없습니다/);
});

test('legacy checkout은 결제 단계를 동기 값으로 갱신해 결제사 이동 때 이탈 확인창을 띄우지 않는다', () => {
  const start = source.indexOf('function LegacyCartCheckoutContent');
  const end = source.indexOf('function RoundCartCheckoutContent', start);
  const legacyCheckoutSource = source.slice(start, end);
  assert.match(legacyCheckoutSource, /attachPaymentPageGuard\(window, \{/);
  assert.match(legacyCheckoutSource, /getPhase: \(\) => phase\.current/);
  // 결제창 호출 전 단계는 렌더를 기다리지 않고 바뀐다.
  const paying = legacyCheckoutSource.indexOf("transition('paying')");
  const request = legacyCheckoutSource.indexOf('PortOne.requestPayment(');
  assert.ok(paying >= 0 && paying < request);
  assert.doesNotMatch(legacyCheckoutSource, /setState\('paying'\)/);
  // 같은 탭 복귀 뒤 늦게 끝난 이전 결제창 결과는 무시한다.
  assert.match(legacyCheckoutSource, /generation !== attemptGeneration\.current/);
});

test('장바구니 checkout은 결제사 화면에서 복원되면 결제 상품을 다시 읽는다', () => {
  const start = source.indexOf('function CartCheckoutContent');
  const cartSource = source.slice(start, source.indexOf('function CheckoutContent', start));
  assert.match(cartSource, /addEventListener\('pageshow', handlePageShow\)/);
  assert.match(cartSource, /if \(event\.persisted\) readCart\(\)/);
  assert.match(cartSource, /removeEventListener\('pageshow', handlePageShow\)/);
});

test('회차 checkout은 같은 계정·장바구니의 입력값을 복원하고 바뀔 때마다 탭 저장소에 남긴다', () => {
  const start = source.indexOf('function RoundCartCheckoutContent');
  const end = source.indexOf('function CartCheckoutContent', start);
  const roundCheckoutSource = source.slice(start, end);

  assert.match(roundCheckoutSource, /checkoutDraftCartKey\(cartItems\)/);
  // 기록은 로그인한 계정에 묶는다. 계정이 확인되기 전에는 읽지도 저장하지도 않는다.
  assert.match(roundCheckoutSource, /const userId = session\?\.user\?\.id \?\? ''/);
  assert.match(
    roundCheckoutSource,
    /loadCheckoutDraft\(\s+readCheckoutDraftStorage\(\),\s+draftCartKey,\s+userId,/,
  );
  assert.match(
    roundCheckoutSource,
    /\{ address, deliveryPhone, requestNote, packageLabel \},\s+draftCartKey,\s+userId,/,
  );
  assert.equal(
    roundCheckoutSource.match(/if \(!userId \|\| draftOwnerId (?:===|!==) userId\) return;/g)
      ?.length,
    2,
  );
  // 첫 렌더에서 바로 복원하지 않는다(다른 계정의 기록이 계정 확인 전에 보이지 않게).
  assert.doesNotMatch(roundCheckoutSource, /useState\(\(\) =>\s+loadCheckoutDraft/);
  // 복원은 자동 채움보다 먼저 일어나 자동 채움이 복원값 위에서 빈 칸만 채운다.
  const restore = roundCheckoutSource.indexOf('loadCheckoutDraft(');
  const prefill = roundCheckoutSource.indexOf('pickCheckoutPrefill(profile)');
  assert.ok(restore >= 0 && restore < prefill);
  // 저장된 배송지 자동 채움은 그대로 빈 칸만 채운다.
  assert.match(
    roundCheckoutSource,
    /setAddress\(\(current\) => prefillAddress\(current, prefill\)\)/,
  );
  assert.match(
    roundCheckoutSource,
    /setDeliveryPhone\(\(current\) => prefillPhone\(current, prefill\)\)/,
  );
  // 결제가 끝나면 checkout_cart와 함께 지운다.
  const done = roundCheckoutSource.indexOf("state !== 'done' || !orderId");
  const clear = roundCheckoutSource.indexOf('clearCheckoutDraft(readCheckoutDraftStorage())');
  assert.ok(done >= 0 && done < clear);
});

test('회차 확인 안내는 같은 뜻을 괄호로 반복하지 않고 해요체 한 문장으로 보인다', () => {
  const loadError = '판매 회차를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
  const connectionError = '연결이 불안정해요. 잠시 후 다시 시도해 주세요.';

  // 오래된 회차 정보: 원인 문구를 괄호로 덧붙이지 않는다.
  const stale = resolveRoundScheduleError('stale', loadError, true);
  assert.equal(
    stale,
    '최신 회차 정보를 불러오지 못해 지금은 결제할 수 없어요. 다시 시도한 뒤 결제해 주세요.',
  );
  assert.equal(resolveRoundScheduleError('stale', null, true), stale);
  assert.doesNotMatch(stale, /[()]/);

  // 조회 실패는 이미 고객 문구가 된 안내를 그대로 쓴다.
  assert.equal(resolveRoundScheduleError('error', loadError, false), loadError);

  // 조회는 됐지만 장바구니와 맞는 회차가 없을 때만 변경 안내를 보인다.
  const changed =
    '상품·가격·회차 정보가 바뀌어 결제할 수 없어요. 장바구니에서 바뀐 내용을 다시 확인해 주세요.';
  for (const status of ['success', 'empty', 'refreshing']) {
    assert.equal(resolveRoundScheduleError(status, null, false), changed);
    assert.equal(resolveRoundScheduleError(status, null, true), null);
  }
  assert.equal(resolveRoundScheduleError('loading', null, false), null);

  // 오래된 정보 상자 아래에는 뜻이 다른 원인(연결 불안정)만 덧붙인다.
  assert.equal(staleRoundsDetail(loadError), null);
  assert.equal(staleRoundsDetail(null), null);
  assert.equal(staleRoundsDetail(connectionError), connectionError);

  // 화면의 회차 안내에 합니다체가 남지 않는다.
  const start = source.indexOf('function RoundCartCheckoutContent');
  const end = source.indexOf('function CartCheckoutContent', start);
  const roundCheckoutSource = source.slice(start, end);
  assert.match(roundCheckoutSource, /최신 회차 정보를 불러오지 못했어요\./);
  assert.doesNotMatch(source, /최신 회차 정보를 불러오지 못했습니다/);
  assert.doesNotMatch(source, /이전 결과로는 결제할 수 없습니다/);
  assert.doesNotMatch(source, /회차 정보가 변경되어 결제할 수 없습니다/);
});

/** 회차 마감 안내를 그려 화면 요소와 이동을 기록한다. */
function renderRoundClosedNotice() {
  const elements = [];
  const pushes = [];
  const ButtonStub = () => null;
  const textOf = (children) =>
    (Array.isArray(children) ? children : [children])
      .filter((child) => typeof child === 'string')
      .join('');
  const requireForRender = (specifier) => {
    if (specifier === 'react/jsx-runtime') {
      const jsx = (type, props) => {
        elements.push({ type, props, text: textOf(props?.children) });
        return null;
      };
      return { Fragment: Symbol('Fragment'), jsx, jsxs: jsx };
    }
    if (specifier === '@greenhub/ui/components/button') return { Button: ButtonStub };
    return requireForTest(specifier);
  };
  const renderModule = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    requireForRender,
    renderModule,
    renderModule.exports,
  );
  renderModule.exports.RoundClosedNotice({
    onCart: () => pushes.push('/cart'),
    onHome: () => pushes.push('/'),
  });
  return { elements, pushes, buttons: elements.filter((element) => element.type === ButtonStub) };
}

test('회차 마감 안내는 마감 문구와 장바구니·홈으로 버튼을 보인다(C-13)', () => {
  const { elements, pushes, buttons } = renderRoundClosedNotice();

  const notice = elements.find((element) => element.props?.role === 'alert');
  assert.ok(notice, '마감 안내는 바로 읽히는 알림이다');
  assert.ok(elements.some((element) => element.text === '이번 회차 주문이 마감됐어요.'));
  assert.deepEqual(
    buttons.map((button) => button.text),
    ['장바구니로 가기', '홈으로'],
  );
  assert.equal(buttons[0].props.variant, undefined);
  assert.equal(buttons[1].props.variant, 'ghost');
  for (const button of buttons) button.props.onClick();
  assert.deepEqual(pushes, ['/cart', '/']);
  // 발송 기능이 없는 다음 회차 알림은 안내·버튼으로 약속하지 않는다.
  assert.ok(!elements.some((element) => /알림|소식/.test(element.text)));
});

test('회차 checkout은 마감 거절 응답·지나간 마감 시각에 결제 버튼을 끄고 마감 안내를 보인다(C-13)', () => {
  const start = source.indexOf('function RoundCartCheckoutContent');
  const end = source.indexOf('function CartCheckoutContent', start);
  const roundCheckoutSource = source.slice(start, end);

  assert.match(
    roundCheckoutSource,
    /const \{ state, orderId, error, roundOrderClosed, requestPayment \} = usePayment\(\{/,
  );
  assert.match(
    roundCheckoutSource,
    /isCheckoutRoundClosed\(\{\s*round: schedule\?\.round \?\? null,\s*nowMillis: Date\.now\(\),\s*closedByOrderResponse: roundOrderClosed,\s*paymentInFlight: isLoading \|\| state === 'done',\s*\}\)/,
  );
  // 화면을 연 채 마감 시각이 지나면 그 시각에 다시 그린다.
  assert.match(roundCheckoutSource, /msUntilRoundOrderClose\(orderCloseAt, Date\.now\(\)\)/);
  assert.match(roundCheckoutSource, /window\.clearTimeout\(timer\)/);
  // 결제 버튼을 끄고, 같은 뜻의 오류를 겹쳐 보이지 않고, 버튼 위에 안내를 둔다.
  assert.match(roundCheckoutSource, /const canPay =\s*!roundClosed &&/);
  assert.match(
    roundCheckoutSource,
    /const formError = roundClosed \? null : \(scheduleError \?\? error\);/,
  );
  assert.match(roundCheckoutSource, /error=\{formError\}/);
  assert.match(roundCheckoutSource, /closedNotice=\{\s*roundClosed \? \(\s*<RoundClosedNotice/);
  assert.match(roundCheckoutSource, /onCart=\{\(\) => router\.push\('\/cart'\)\}/);
  assert.match(roundCheckoutSource, /onHome=\{\(\) => router\.push\('\/'\)\}/);
});
