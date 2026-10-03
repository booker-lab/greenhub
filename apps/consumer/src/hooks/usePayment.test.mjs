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

const redirectSource = await readFile(
  new URL('../lib/payment-redirect.ts', import.meta.url),
  'utf8',
);
const redirectModule = { exports: {} };
new Function(
  'module',
  'exports',
  ts.transpileModule(redirectSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
)(redirectModule, redirectModule.exports);
const {
  PENDING_ORDER_PAYMENT_STORAGE_KEY,
  parsePaymentRedirectResult,
  resolveOrderPaymentReturn,
  takePendingOrderPayment,
} = redirectModule.exports;

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

function loadHook({ paymentResponses = [], onPayment } = {}) {
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
    if (specifier === '@/lib/payment-redirect') return redirectModule.exports;
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
          if (onPayment) return onPayment(parameters);
          return paymentResponses.shift();
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

function jsonResponse(body, ok = true, status = ok ? 200 : 400) {
  return {
    ok,
    status,
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

function createRoundHook(roundItems = [firstRoundItem, secondRoundItem], hookOptions = {}) {
  const loaded = loadHook(hookOptions);
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

test('회차 주문 요청사항은 있을 때만 주문 요청에 담는다', async () => {
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return jsonResponse(successfulRoundResponse);
  };

  for (const orderRequest of [
    { ...deliveryRequest, requestNote: '받는 분 김그린 / 선물 문구: 개업 축하' },
    deliveryRequest,
  ]) {
    const loaded = loadHook();
    // biome-ignore lint/correctness/useHookAtTopLevel: React를 모의한 훅 계약 단위 테스트다.
    const result = loaded.usePayment({
      storeId: 'store-1',
      orderRequest,
      roundItems: [firstRoundItem, secondRoundItem],
      accessToken: 'access-token',
      paymentMethod: 'kakaopay',
    });
    await result.requestPayment();
  }

  assert.equal(bodies[0].requestNote, '받는 분 김그린 / 선물 문구: 개업 축하');
  assert.equal(Object.hasOwn(bodies[1], 'requestNote'), false);
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

test('결제창 취소·실패(code 응답) 뒤 재시도는 새 clientOrderRequestId로 주문한다', async () => {
  const requestBodies = [];
  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(init.body));
    return jsonResponse(successfulRoundResponse);
  };
  const { result, paymentCalls, stateChanges } = createRoundHook(undefined, {
    paymentResponses: [{ code: 'FAILURE_TYPE_PG', message: '사용자가 결제를 취소했습니다.' }],
  });

  await result.requestPayment();
  assert.equal(stateChanges.at(-1), 'error');
  await result.requestPayment();

  assert.equal(requestBodies.length, 2);
  assert.notEqual(requestBodies[0].clientOrderRequestId, requestBodies[1].clientOrderRequestId);
  assert.equal(paymentCalls.length, 2);
  assert.equal(stateChanges.at(-1), 'done');
});

test('서버가 4xx로 확정 거절하면 다음 시도는 새 clientOrderRequestId를 쓴다', async () => {
  for (const status of [400, 401, 403, 404, 409, 422]) {
    const requestBodies = [];
    let attempt = 0;
    globalThis.fetch = async (_url, init) => {
      requestBodies.push(JSON.parse(init.body));
      attempt += 1;
      if (attempt === 1) {
        return jsonResponse(
          { message: '같은 결제 시도 ID에 다른 주문 내용이 요청되었습니다.' },
          false,
          status,
        );
      }
      return jsonResponse(successfulRoundResponse);
    };
    const { result, paymentCalls } = createRoundHook();

    await result.requestPayment();
    await result.requestPayment();

    assert.equal(requestBodies.length, 2);
    assert.notEqual(
      requestBodies[0].clientOrderRequestId,
      requestBodies[1].clientOrderRequestId,
      `${status} 거절 뒤에는 새 ID여야 한다`,
    );
    assert.equal(paymentCalls.length, 1);
  }
});

test('5xx·408·429·응답 손상처럼 처리 여부가 불확실하면 같은 clientOrderRequestId를 유지한다', async () => {
  const uncertainResponses = [
    jsonResponse({ message: '서버 오류' }, false, 500),
    jsonResponse({ message: '게이트웨이 시간 초과' }, false, 504),
    jsonResponse({ message: '요청 시간 초과' }, false, 408),
    jsonResponse({ message: '요청이 너무 많습니다' }, false, 429),
    jsonResponse({ ...successfulRoundResponse, orderId: '' }),
  ];
  for (const uncertain of uncertainResponses) {
    const requestBodies = [];
    let attempt = 0;
    globalThis.fetch = async (_url, init) => {
      requestBodies.push(JSON.parse(init.body));
      attempt += 1;
      return attempt === 1 ? uncertain : jsonResponse(successfulRoundResponse);
    };
    const { result } = createRoundHook();

    await result.requestPayment();
    await result.requestPayment();

    assert.equal(requestBodies.length, 2);
    assert.equal(requestBodies[0].clientOrderRequestId, requestBodies[1].clientOrderRequestId);
  }
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

function installBrowser() {
  const values = new Map();
  const sessionStorage = {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  globalThis.window = {
    location: {
      origin: 'https://shop.example',
      pathname: '/checkout',
      search: '?from=cart',
    },
    sessionStorage,
  };
  return {
    values,
    sessionStorage,
    restore() {
      delete globalThis.window;
    },
  };
}

function mountRoundPayment(loaded, orderRequest = deliveryRequest) {
  // biome-ignore lint/correctness/useHookAtTopLevel: React를 모의한 훅 계약 단위 테스트다.
  return loaded.usePayment({
    storeId: 'store-1',
    orderRequest,
    roundItems: [firstRoundItem, secondRoundItem],
    accessToken: 'access-token',
    paymentMethod: 'kakaopay',
  });
}

const leaveForRedirect = () => new Promise(() => {});
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('브라우저에서는 현재 origin 기준 redirectUrl을 넘기고 PC Promise 흐름은 그대로 완료한다', async () => {
  const browser = installBrowser();
  try {
    const bodies = [];
    globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return jsonResponse(successfulRoundResponse);
    };
    let pendingDuringPayment = null;
    const loaded = loadHook({
      onPayment: () => {
        pendingDuringPayment = browser.values.get(PENDING_ORDER_PAYMENT_STORAGE_KEY);
        return { transactionType: 'PAYMENT', txId: 'tx-1', paymentId: 'order-1' };
      },
    });
    const result = mountRoundPayment(loaded, {
      ...deliveryRequest,
      requestNote: '문 앞에 놓아 주세요',
    });

    await result.requestPayment();

    assert.equal(bodies[0].requestNote, '문 앞에 놓아 주세요');
    assert.equal(loaded.paymentCalls[0].redirectUrl, 'https://shop.example/order/success');
    assert.equal(Object.hasOwn(loaded.paymentCalls[0], 'forceRedirect'), false);
    const pending = JSON.parse(pendingDuringPayment);
    assert.equal(pending.paymentId, 'order-1');
    assert.deepEqual(pending.roundItemIds, ['round-item-1', 'round-item-2']);
    assert.equal(pending.clearCheckoutCart, true);
    assert.equal(pending.retryPath, '/checkout?from=cart');
    // 결제 시도 ID·연락처·요청사항은 복귀용 기록에 남기지 않는다.
    assert.equal(pendingDuringPayment.includes(bodies[0].clientOrderRequestId), false);
    assert.equal(pendingDuringPayment.includes('010-1234-5678'), false);
    assert.equal(pendingDuringPayment.includes('문 앞에'), false);
    // Promise로 끝났으므로 복귀용 기록은 지운다.
    assert.equal(browser.values.has(PENDING_ORDER_PAYMENT_STORAGE_KEY), false);
    assert.equal(loaded.stateChanges.at(-1), 'done');
  } finally {
    browser.restore();
  }
});

test('모바일 리다이렉트 뒤 실패·취소로 돌아와 다시 결제하면 새 clientOrderRequestId로 주문한다', async () => {
  const browser = installBrowser();
  try {
    const bodies = [];
    globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return jsonResponse(successfulRoundResponse);
    };
    // 1) 모바일: 결제사로 이동하면 Promise는 끝나지 않고 페이지가 사라진다.
    const leaving = loadHook({ onPayment: leaveForRedirect });
    void mountRoundPayment(leaving, {
      ...deliveryRequest,
      requestNote: '첫 요청',
    }).requestPayment();
    await settle();
    assert.equal(leaving.paymentCalls.length, 1);
    assert.equal(bodies[0].requestNote, '첫 요청');
    assert.ok(browser.values.has(PENDING_ORDER_PAYMENT_STORAGE_KEY));

    // 2) code 쿼리로 복귀: 실패로 해석하고 재시도 경로만 준다(장바구니 정리 없음).
    const returned = resolveOrderPaymentReturn(
      parsePaymentRedirectResult(
        new URLSearchParams('paymentId=order-1&code=FAILURE_TYPE_PG&message=취소'),
      ),
      takePendingOrderPayment(browser.sessionStorage, Date.now()),
    );
    assert.deepEqual(returned, {
      kind: 'failure',
      message: '취소',
      retryPath: '/checkout?from=cart',
    });

    // 3) 새로 로드된 체크아웃에서 내용을 바꿔 다시 결제해도 새 ID라
    //    409(같은 결제 시도 ID에 다른 주문 내용)가 나지 않는다.
    const reloaded = loadHook({
      onPayment: () => ({ transactionType: 'PAYMENT', txId: 'tx-2', paymentId: 'order-1' }),
    });
    await mountRoundPayment(reloaded, {
      ...deliveryRequest,
      deliveryPhone: '010-9999-0000',
      requestNote: '바꾼 요청',
    }).requestPayment();

    assert.equal(bodies.length, 2);
    assert.notEqual(bodies[0].clientOrderRequestId, bodies[1].clientOrderRequestId);
    assert.equal(bodies[1].requestNote, '바꾼 요청');
    assert.equal(reloaded.stateChanges.at(-1), 'done');
  } finally {
    browser.restore();
  }
});

test('모바일 리다이렉트 성공 쿼리는 서버 조회 대상 주문 ID와 결제한 회차 상품만 넘긴다', async () => {
  const browser = installBrowser();
  try {
    globalThis.fetch = async () => jsonResponse(successfulRoundResponse);
    const leaving = loadHook({ onPayment: leaveForRedirect });
    void mountRoundPayment(leaving).requestPayment();
    await settle();

    const returned = resolveOrderPaymentReturn(
      parsePaymentRedirectResult(
        new URLSearchParams('paymentId=order-1&transactionType=PAYMENT&txId=tx-1'),
      ),
      takePendingOrderPayment(browser.sessionStorage, Date.now()),
    );
    assert.deepEqual(returned, {
      kind: 'confirm',
      orderId: 'order-1',
      roundItemIds: ['round-item-1', 'round-item-2'],
      clearCheckoutCart: true,
      unpaidItemCount: 0,
    });
    // 성공 쿼리만으로 'done'이 되지 않는다(주문 완료 화면이 서버 상태 조회로 확정).
    assert.notEqual(leaving.stateChanges.at(-1), 'done');
  } finally {
    browser.restore();
  }
});

test('브라우저 밖(origin 없음)에서는 redirectUrl 없이 기존 Promise 계약을 유지한다', async () => {
  globalThis.fetch = async () => jsonResponse(successfulRoundResponse);
  const { result, paymentCalls } = createRoundHook();
  await result.requestPayment();
  assert.equal(Object.hasOwn(paymentCalls[0], 'redirectUrl'), false);
});
