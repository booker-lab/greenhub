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
export { parseCheckoutCart, resolveRoundCheckoutSchedule };`;
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

const { parseCheckoutCart, resolveRoundCheckoutSchedule } = pageModule.exports;

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
