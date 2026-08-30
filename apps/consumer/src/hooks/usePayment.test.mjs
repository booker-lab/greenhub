import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./usePayment.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'usePayment.ts',
}).outputText;

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL,
  storeId: process.env.NEXT_PUBLIC_PORTONE_STORE_ID,
  kakaoChannel: process.env.NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY,
  naverChannel: process.env.NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY,
};

process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test';
process.env.NEXT_PUBLIC_PORTONE_STORE_ID = 'portone-store';
process.env.NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY = 'kakao-channel';
process.env.NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY = 'naver-channel';

test.after(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries({
    NEXT_PUBLIC_API_URL: originalEnvironment.apiUrl,
    NEXT_PUBLIC_PORTONE_STORE_ID: originalEnvironment.storeId,
    NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY: originalEnvironment.kakaoChannel,
    NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY: originalEnvironment.naverChannel,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function loadHook() {
  const paymentCalls = [];
  const stateChanges = [];
  const paymentModule = { exports: {} };
  const requireForTest = (specifier) => {
    if (specifier === 'react') {
      return {
        useRef: (initial) => ({ current: initial }),
        useState: (initial) => [
          initial,
          (next) => {
            stateChanges.push(next);
          },
        ],
      };
    }
    if (specifier === '@/hooks/useCart') {
      return {
        isRoundCartItem: (item) =>
          typeof item?.roundId === 'string' &&
          typeof item?.roundItemId === 'string' &&
          item.roundPrice === item.price,
      };
    }
    if (specifier === '@/lib/api-base-url') {
      return { getApiBaseUrl: () => process.env.NEXT_PUBLIC_API_URL };
    }
    if (specifier === '@/lib/portone-config') {
      return {
        readPortonePaymentConfiguration: (paymentMethod) => ({
          portoneStoreId: process.env.NEXT_PUBLIC_PORTONE_STORE_ID,
          channelKey:
            paymentMethod === 'naverpay'
              ? process.env.NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY
              : process.env.NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY,
          easyPayProvider: paymentMethod === 'naverpay' ? 'NAVERPAY' : 'KAKAOPAY',
        }),
      };
    }
    if (specifier === '@portone/browser-sdk/v2') {
      return {
        requestPayment: async (parameters) => {
          paymentCalls.push(parameters);
          return undefined;
        },
      };
    }
    throw new Error(`예상하지 못한 모듈 요청: ${specifier}`);
  };

  new Function('require', 'module', 'exports', compiled)(
    requireForTest,
    paymentModule,
    paymentModule.exports,
  );
  return {
    usePayment: paymentModule.exports.usePayment,
    paymentCalls,
    stateChanges,
  };
}

function jsonResponse(body, ok = true) {
  return {
    ok,
    json: async () => body,
  };
}

const deliveryRequest = {
  deliveryAddress: {
    address: '경기도 이천시 창전동',
    addressDetail: '101호',
    zipCode: '17369',
  },
  deliveryPhone: '010-1234-5678',
};

const legacyOrderRequest = {
  ...deliveryRequest,
  productId: 'legacy-product',
  quantity: 1,
  saleType: 'normal',
  deliveryMethod: 'parcel',
};

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

const successfulRoundResponse = {
  orderId: 'order-1',
  portonePaymentParams: {
    name: '호접란 하나 외',
    amount: 69000,
    buyerName: '구매자',
  },
};

function createRoundHook(roundItems = [firstRoundItem, secondRoundItem]) {
  const loaded = loadHook();
  // biome-ignore lint/correctness/useHookAtTopLevel: React를 모의한 훅 계약 단위 테스트다.
  const result = loaded.usePayment({
    storeId: 'store-1',
    orderRequest: deliveryRequest,
    roundItems,
    accessToken: 'access-token',
    paymentMethod: 'kakaopay',
  });
  return { ...loaded, result };
}

test('검증된 같은 회차 상품 전체를 주문 한 번과 PortOne 결제 한 번으로 처리한다', async () => {
  const fetchCalls = [];
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, init });
    return jsonResponse(successfulRoundResponse);
  };
  const { result, paymentCalls } = createRoundHook();

  await result.requestPayment();

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://api.example.test/stores/store-1/orders');
  const body = JSON.parse(fetchCalls[0].init.body);
  assert.equal(body.roundId, 'round-1');
  assert.deepEqual(body.roundItems, [
    { roundItemId: 'round-item-1', quantity: 2 },
    { roundItemId: 'round-item-2', quantity: 1 },
  ]);
  assert.equal(body.productId, 'product-1');
  assert.equal(body.quantity, 2);
  assert.equal(body.saleType, 'normal');
  assert.equal(body.deliveryMethod, 'direct');
  assert.equal(Object.hasOwn(body, 'marketingConsent'), false);
  assert.match(body.clientOrderRequestId, /^[A-Za-z0-9:_-]{8,128}$/);
  assert.equal(paymentCalls.length, 1);
  assert.equal(paymentCalls[0].paymentId, 'order-1');
  assert.equal(paymentCalls[0].totalAmount, 69000);
});

test('빈 배열·다른 회차 혼합·손상 항목은 주문 API 호출 전에 거부한다', async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return jsonResponse(successfulRoundResponse);
  };
  const invalidInputs = [
    [],
    [firstRoundItem, { ...secondRoundItem, roundId: 'round-2' }],
    [firstRoundItem, { ...secondRoundItem, quantity: 0 }],
    [firstRoundItem, { ...secondRoundItem, roundItemId: 'round-item-1' }],
    [firstRoundItem, { ...secondRoundItem, storeId: 'store-2' }],
    [firstRoundItem, { ...secondRoundItem, roundPrice: 1 }],
  ];

  for (const roundItems of invalidInputs) {
    const { result, paymentCalls, stateChanges } = createRoundHook(roundItems);
    await result.requestPayment();
    assert.equal(paymentCalls.length, 0);
    assert.equal(stateChanges.at(-1), 'error');
  }
  assert.equal(fetchCount, 0);
});

test('서버 주문 응답의 식별자·이름·금액이 손상되면 PortOne 결제를 시작하지 않는다', async () => {
  const brokenResponses = [
    { ...successfulRoundResponse, orderId: '' },
    { ...successfulRoundResponse, paymentId: 'another-payment' },
    {
      ...successfulRoundResponse,
      portonePaymentParams: { ...successfulRoundResponse.portonePaymentParams, name: '' },
    },
    {
      ...successfulRoundResponse,
      portonePaymentParams: {
        ...successfulRoundResponse.portonePaymentParams,
        paymentId: 'another-payment',
      },
    },
    {
      ...successfulRoundResponse,
      portonePaymentParams: { ...successfulRoundResponse.portonePaymentParams, amount: 1 },
    },
    { ...successfulRoundResponse, portonePaymentParams: null },
  ];

  for (const response of brokenResponses) {
    globalThis.fetch = async () => jsonResponse(response);
    const { result, paymentCalls, stateChanges } = createRoundHook();
    await result.requestPayment();
    assert.equal(paymentCalls.length, 0);
    assert.equal(stateChanges.at(-1), 'error');
  }
});

test('네트워크 오류 재시도에는 같은 clientOrderRequestId를 재사용한다', async () => {
  const requestBodies = [];
  let attempt = 0;
  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(init.body));
    attempt += 1;
    if (attempt === 1) throw new Error('일시적인 네트워크 오류');
    return jsonResponse(successfulRoundResponse);
  };
  const { result, paymentCalls } = createRoundHook();

  await result.requestPayment();
  await result.requestPayment();

  assert.equal(requestBodies.length, 2);
  assert.equal(requestBodies[0].clientOrderRequestId, requestBodies[1].clientOrderRequestId);
  assert.equal(paymentCalls.length, 1);
});

test('동시에 반복 클릭해도 주문과 결제는 한 번만 시작한다', async () => {
  let resolveFetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Promise((resolve) => {
      resolveFetch = resolve;
    });
  };
  const { result, paymentCalls } = createRoundHook();

  const first = result.requestPayment();
  const repeated = result.requestPayment();
  await Promise.resolve();
  assert.equal(fetchCount, 1);

  resolveFetch(jsonResponse(successfulRoundResponse));
  await Promise.all([first, repeated]);
  assert.equal(paymentCalls.length, 1);
});

test('기존 단일 상품 usePayment 요청 계약을 보존한다', async () => {
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return jsonResponse({
      orderId: 'legacy-order',
      portonePaymentParams: {
        name: '기존 상품',
        amount: 25000,
        buyerName: '구매자',
      },
    });
  };
  const loaded = loadHook();
  const result = loaded.usePayment({
    storeId: 'store-1',
    orderRequest: legacyOrderRequest,
    accessToken: 'access-token',
    paymentMethod: 'naverpay',
  });

  await result.requestPayment();

  assert.deepEqual(
    { ...requestBody, clientOrderRequestId: undefined },
    { ...legacyOrderRequest, clientOrderRequestId: undefined },
  );
  assert.match(requestBody.clientOrderRequestId, /^[A-Za-z0-9:_-]{8,128}$/);
  assert.equal(loaded.paymentCalls.length, 1);
  assert.equal(loaded.paymentCalls[0].paymentId, 'legacy-order');
  assert.equal(loaded.paymentCalls[0].channelKey, 'naver-channel');
});
