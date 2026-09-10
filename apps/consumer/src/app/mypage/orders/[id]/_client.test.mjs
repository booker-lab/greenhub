import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./_client.tsx', import.meta.url), 'utf8');
const helperSource = await readFile(new URL('./_detail.ts', import.meta.url), 'utf8');
const hookSource = await readFile(
  new URL('../../../../hooks/useOrderStatus.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(helperSource, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: '_detail.ts',
}).outputText;

const helperModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  () => ({}),
  helperModule,
  helperModule.exports,
);

const { readOrderDetail, readRedeliveryPaymentResponse } = helperModule.exports;

const activeOrder = {
  id: 'round-order-active',
  orderNumber: '20260718-000001',
  schemaVersion: 2,
  roundId: 'round-1',
  roundName: '7월 3주차',
  storeId: 'store-1',
  userId: 'user-1',
  status: 'ACCEPTED',
  saleType: 'normal',
  deliveryMethod: 'direct',
  deliveryFee: 0,
  totalAmount: 130000,
  quantity: 3,
  deliveryAddress: {
    address: '경기도 이천시 중리천로 1',
    addressDetail: '201호',
    zipCode: '17373',
  },
  requestedDeliveryDate: '2026-07-21',
  orderItems: [
    {
      roundItemId: 'round-item-1',
      productId: 'product-1',
      productName: '미니 호접란',
      productImageUrl: null,
      unitPrice: 50000,
      quantity: 1,
      subtotalAmount: 50000,
    },
    {
      roundItemId: 'round-item-2',
      productId: 'product-2',
      productName: '대형 호접란',
      productImageUrl: null,
      unitPrice: 40000,
      quantity: 2,
      subtotalAmount: 80000,
    },
  ],
};

test('활성·보류·완료·취소 회차 주문 fixture는 상호 배타 상세 동작을 만든다', () => {
  const held = readOrderDetail(
    {
      ...activeOrder,
      id: 'round-order-held',
      status: 'DELIVERY_HELD',
      deliveryHold: {
        heldAt: '2026-07-21T01:00:00.000Z',
        reasonCode: 'ACCESS_UNAVAILABLE',
        reasonMessage: '공동현관 출입이 불가능합니다.',
        customerResponsible: true,
        redeliveryFee: 5000,
        nextContactAt: '2026-07-21T03:00:00.000Z',
        nextDeliveryAt: '2026-07-22T00:00:00.000Z',
        resolvedAt: null,
      },
      redeliveryPayment: {
        required: true,
        holdAt: '2026-07-21T01:00:00.000Z',
        chargeId: null,
        status: 'MISSING',
        canPay: true,
        paid: false,
        requiresRecovery: false,
      },
    },
    'round-order-held',
  );
  const delivered = readOrderDetail(
    {
      ...activeOrder,
      id: 'round-order-delivered',
      status: 'DELIVERED',
      deliveryPhotoUrl: 'https://storage.example.com/signed-delivery-photo.jpg?token=safe',
    },
    'round-order-delivered',
  );
  const active = readOrderDetail(activeOrder, activeOrder.id);
  const cancelled = readOrderDetail(
    {
      ...activeOrder,
      id: 'round-order-cancelled',
      status: 'CANCELLED',
      cancelReason: '고객 요청',
    },
    'round-order-cancelled',
  );

  assert.deepEqual(
    [held, delivered, active, cancelled].map((detail) => ({
      status: detail?.status,
      hasHold: detail?.deliveryHold !== null,
      hasPhoto: detail?.deliveryPhotoUrl !== null,
      canPay: detail?.redeliveryPayment.canPay,
      paymentStatus: detail?.redeliveryPayment.status,
      paymentRequired: detail?.redeliveryPayment.required,
      canCancel: detail?.canRequestCancellation,
    })),
    [
      {
        status: 'DELIVERY_HELD',
        hasHold: true,
        hasPhoto: false,
        canPay: true,
        paymentStatus: 'MISSING',
        paymentRequired: true,
        canCancel: true,
      },
      {
        status: 'DELIVERED',
        hasHold: false,
        hasPhoto: true,
        canPay: false,
        paymentStatus: 'NOT_REQUIRED',
        paymentRequired: false,
        canCancel: false,
      },
      {
        status: 'ACCEPTED',
        hasHold: false,
        hasPhoto: false,
        canPay: false,
        paymentStatus: 'NOT_REQUIRED',
        paymentRequired: false,
        canCancel: true,
      },
      {
        status: 'CANCELLED',
        hasHold: false,
        hasPhoto: false,
        canPay: false,
        paymentStatus: 'NOT_REQUIRED',
        paymentRequired: false,
        canCancel: false,
      },
    ],
  );
  assert.deepEqual(active?.items, [
    {
      id: 'round-item-1',
      productName: '미니 호접란',
      quantity: 1,
      subtotalAmount: 50000,
    },
    {
      id: 'round-item-2',
      productName: '대형 호접란',
      quantity: 2,
      subtotalAmount: 80000,
    },
  ]);
});

test('서버 redeliveryPayment 상태가 주문 상태와 독립적으로 결제 상태를 결정한다', () => {
  const hold = {
    heldAt: '2026-07-21T01:00:00.000Z',
    reasonCode: 'ACCESS_UNAVAILABLE',
    reasonMessage: '공동현관 출입이 불가능합니다.',
    customerResponsible: true,
    redeliveryFee: 5000,
    nextContactAt: '2026-07-21T03:00:00.000Z',
    nextDeliveryAt: '2026-07-22T00:00:00.000Z',
    resolvedAt: null,
  };
  const cases = [
    {
      name: 'DELIVERY_HELD + MISSING',
      status: 'DELIVERY_HELD',
      payment: {
        required: true,
        holdAt: hold.heldAt,
        chargeId: null,
        status: 'MISSING',
        canPay: true,
        paid: false,
        requiresRecovery: false,
      },
      expected: { status: 'MISSING', canPay: true, paid: false, requiresRecovery: false },
    },
    {
      name: 'PREPARING + MISSING',
      status: 'PREPARING',
      payment: {
        required: true,
        holdAt: hold.heldAt,
        chargeId: null,
        status: 'MISSING',
        canPay: true,
        paid: false,
        requiresRecovery: false,
      },
      expected: { status: 'MISSING', canPay: true, paid: false, requiresRecovery: false },
    },
    {
      name: 'PREPARING + PENDING',
      status: 'PREPARING',
      payment: {
        required: true,
        holdAt: hold.heldAt,
        chargeId: 'charge-pending',
        status: 'PENDING',
        canPay: true,
        paid: false,
        requiresRecovery: false,
      },
      expected: { status: 'PENDING', canPay: true, paid: false, requiresRecovery: false },
    },
    {
      name: 'PAID',
      status: 'PREPARING',
      payment: {
        required: true,
        holdAt: hold.heldAt,
        chargeId: 'charge-paid',
        status: 'PAID',
        canPay: false,
        paid: true,
        requiresRecovery: false,
      },
      expected: { status: 'PAID', canPay: false, paid: true, requiresRecovery: false },
    },
    {
      name: 'FAILED',
      status: 'PREPARING',
      payment: {
        required: true,
        holdAt: hold.heldAt,
        chargeId: 'charge-failed',
        status: 'FAILED',
        canPay: false,
        paid: false,
        requiresRecovery: true,
      },
      expected: { status: 'FAILED', canPay: false, paid: false, requiresRecovery: true },
    },
    {
      name: 'REFUNDED',
      status: 'PREPARING',
      payment: {
        required: true,
        holdAt: hold.heldAt,
        chargeId: 'charge-refunded',
        status: 'REFUNDED',
        canPay: false,
        paid: false,
        requiresRecovery: true,
      },
      expected: { status: 'REFUNDED', canPay: false, paid: false, requiresRecovery: true },
    },
    {
      name: 'MISMATCHED',
      status: 'PREPARING',
      payment: {
        required: true,
        holdAt: hold.heldAt,
        chargeId: 'charge-mismatched',
        status: 'MISMATCHED',
        canPay: false,
        paid: false,
        requiresRecovery: true,
      },
      expected: { status: 'MISMATCHED', canPay: false, paid: false, requiresRecovery: true },
    },
  ];

  for (const entry of cases) {
    const detail = readOrderDetail(
      {
        ...activeOrder,
        id: `round-order-${entry.name}`,
        status: entry.status,
        deliveryHold: hold,
        redeliveryPayment: entry.payment,
      },
      `round-order-${entry.name}`,
    );
    assert.ok(detail, entry.name);
    assert.equal(detail.redeliveryPayment.required, true, entry.name);
    assert.deepEqual(
      {
        status: detail.redeliveryPayment.status,
        canPay: detail.redeliveryPayment.canPay,
        paid: detail.redeliveryPayment.paid,
        requiresRecovery: detail.redeliveryPayment.requiresRecovery,
      },
      entry.expected,
      entry.name,
    );
  }
});

test('redeliveryPayment이 없거나 손상된 경우 기존 주문은 보존하고 결제 가능 상태로 승격하지 않는다', () => {
  const malformed = [
    {
      ...activeOrder,
      status: 'PREPARING',
      deliveryHold: {
        heldAt: '2026-07-21T01:00:00.000Z',
        reasonCode: 'ACCESS_UNAVAILABLE',
        reasonMessage: '공동현관 출입이 불가능합니다.',
        customerResponsible: true,
        redeliveryFee: 5000,
        nextContactAt: null,
        nextDeliveryAt: null,
        resolvedAt: null,
      },
      redeliveryPayment: {
        required: true,
        holdAt: '2026-07-21T01:00:00.000Z',
        chargeId: null,
        status: 'UNKNOWN',
        canPay: true,
        paid: false,
        requiresRecovery: false,
      },
    },
    {
      ...activeOrder,
      redeliveryPayment: null,
    },
  ];

  assert.equal(readOrderDetail(malformed[0], activeOrder.id), null);
  assert.equal(readOrderDetail(malformed[1], activeOrder.id), null);

  const legacy = readOrderDetail(activeOrder, activeOrder.id);
  assert.equal(legacy?.redeliveryPayment.status, 'NOT_REQUIRED');
  assert.equal(legacy?.redeliveryPayment.canPay, false);

  const notRequired = readOrderDetail(
    {
      ...activeOrder,
      redeliveryPayment: {
        required: false,
        holdAt: null,
        chargeId: null,
        status: 'NOT_REQUIRED',
        canPay: false,
        paid: false,
        requiresRecovery: false,
      },
    },
    activeOrder.id,
  );
  assert.equal(notRequired?.redeliveryPayment.status, 'NOT_REQUIRED');
  assert.equal(notRequired?.redeliveryPayment.canPay, false);
});

test('완료·리뷰 상태에서만 HTTPS 서명 사진 URL을 표시한다', () => {
  const signedUrl = 'https://storage.example.com/signed-photo.jpg?expires=900';

  for (const status of ['DELIVERED', 'REVIEWED']) {
    const detail = readOrderDetail(
      {
        ...activeOrder,
        status,
        deliveryPhotoUrl: signedUrl,
      },
      activeOrder.id,
    );
    assert.equal(detail?.deliveryPhotoUrl, signedUrl);
  }

  const active = readOrderDetail(
    {
      ...activeOrder,
      deliveryPhotoUrl: signedUrl,
    },
    activeOrder.id,
  );
  assert.equal(active?.deliveryPhotoUrl, null);

  for (const deliveryPhotoUrl of [
    'http://storage.example.com/public-photo.jpg',
    'gs://bucket/deliveryPhotos/order/photo.jpg',
    '/deliveryPhotos/order/photo.jpg',
  ]) {
    assert.equal(
      readOrderDetail(
        {
          ...activeOrder,
          status: 'DELIVERED',
          deliveryPhotoUrl,
        },
        activeOrder.id,
      ),
      null,
    );
  }
});

test('손상된 회차 orderItems와 상태별 스냅샷을 임의 상세 동작으로 승격하지 않는다', () => {
  const invalidOrders = [
    { ...activeOrder, id: '다른-주문' },
    { ...activeOrder, orderItems: [] },
    {
      ...activeOrder,
      orderItems: [
        activeOrder.orderItems[0],
        { ...activeOrder.orderItems[1], roundItemId: 'round-item-1' },
      ],
    },
    {
      ...activeOrder,
      orderItems: [{ ...activeOrder.orderItems[0], subtotalAmount: 1 }],
    },
    {
      ...activeOrder,
      status: 'DELIVERY_HELD',
      deliveryHold: { reasonMessage: '최상위 추정값을 사용하면 안 됩니다.' },
    },
    {
      ...activeOrder,
      status: 'DELIVERED',
      deliveryPhotoUrl: 'javascript:alert(1)',
    },
  ];

  for (const order of invalidOrders) {
    assert.equal(readOrderDetail(order, activeOrder.id), null);
  }
});

test('정규화된 단일 legacy·공동구매·거점픽업 주문 상세 계약을 보존한다', () => {
  const legacy = readOrderDetail(
    {
      id: 'legacy-order-1',
      storeId: 'store-legacy',
      userId: 'user-1',
      status: 'HUB_ARRIVED',
      saleType: 'group',
      deliveryMethod: 'hub',
      deliveryFee: 3000,
      totalAmount: 23000,
      quantity: 2,
      pickupCode: '123456',
      deliveryAddress: {
        address: '경기도 이천시 거점',
        addressDetail: '',
        zipCode: '17373',
      },
      orderItems: [
        {
          roundItemId: null,
          productId: 'legacy-product-1',
          productName: '기존 공동구매 상품',
          productImageUrl: null,
          unitPrice: 10000,
          quantity: 2,
          subtotalAmount: 20000,
        },
      ],
    },
    'legacy-order-1',
  );

  assert.equal(legacy?.isRoundOrder, false);
  assert.equal(legacy?.canRequestCancellation, false);
  assert.deepEqual(legacy?.items, [
    {
      id: 'legacy-product-1',
      productName: '기존 공동구매 상품',
      quantity: 2,
      subtotalAmount: 20000,
    },
  ]);
});

test('재배송비 결제 응답은 서버 스냅샷 금액과 PortOne 식별자가 일치할 때만 허용한다', () => {
  assert.deepEqual(
    readRedeliveryPaymentResponse(
      {
        id: 'charge-1',
        orderId: 'round-order-held',
        storeId: 'store-1',
        userId: 'user-1',
        type: 'REDELIVERY_FEE',
        status: 'PENDING',
        amount: 5000,
        customerResponsible: true,
        portonePaymentId: 'order-charge-charge-1',
        portonePaymentParams: {
          paymentId: 'order-charge-charge-1',
          amount: 5000,
          name: '고객 사유 재배송비',
        },
      },
      {
        orderId: 'round-order-held',
        storeId: 'store-1',
        amount: 5000,
      },
    ),
    {
      paymentId: 'order-charge-charge-1',
      amount: 5000,
      name: '고객 사유 재배송비',
      status: 'PENDING',
    },
  );

  const paid = readRedeliveryPaymentResponse(
    {
      id: 'charge-1',
      orderId: 'round-order-held',
      storeId: 'store-1',
      type: 'REDELIVERY_FEE',
      status: 'PAID',
      amount: 5000,
      customerResponsible: true,
      portonePaymentId: 'order-charge-charge-1',
      portonePaymentParams: {
        paymentId: 'order-charge-charge-1',
        amount: 5000,
        name: '고객 사유 재배송비',
      },
    },
    { orderId: 'round-order-held', storeId: 'store-1', amount: 5000 },
  );
  assert.equal(paid.status, 'PAID');

  const invalidResponses = [
    { portonePaymentParams: null },
    {
      orderId: '다른-주문',
      storeId: 'store-1',
      amount: 5000,
      type: 'REDELIVERY_FEE',
      status: 'PENDING',
      customerResponsible: true,
      portonePaymentParams: {
        paymentId: 'order-charge-charge-1',
        amount: 5000,
        name: '고객 사유 재배송비',
      },
    },
    {
      orderId: 'round-order-held',
      storeId: 'store-1',
      amount: 1,
      type: 'REDELIVERY_FEE',
      status: 'PENDING',
      customerResponsible: true,
      portonePaymentParams: {
        paymentId: 'order-charge-charge-1',
        amount: 1,
        name: '고객 사유 재배송비',
      },
    },
  ];

  for (const response of invalidResponses) {
    assert.throws(() =>
      readRedeliveryPaymentResponse(response, {
        orderId: 'round-order-held',
        storeId: 'store-1',
        amount: 5000,
      }),
    );
  }
});

test('기존 서버 취소·재배송비·주문 사진 조회 계약만 사용한다', () => {
  assert.match(source, /\/orders\/\$\{detail\.id\}\/cancel/);
  assert.match(source, /\/orders\/\$\{detail\.id\}\/redelivery-fee/);
  assert.match(source, /@portone\/browser-sdk\/v2/);
  assert.match(source, /deliveryPhotoUrl/);
  assert.match(source, /redeliveryPayment\.canPay/);
  assert.match(source, /redeliveryPayment\.paid/);
  assert.match(source, /redeliveryPayment\.required/);
  assert.match(source, /!detail\.redeliveryPayment\.requiresRecovery/);
  assert.match(source, /await refetch\(\)/);
  assert.doesNotMatch(source, /canPayRedeliveryFee/);
  assert.doesNotMatch(source, /setPaymentDone/);
  assert.doesNotMatch(source, /firebase\/storage|uploadBytes|getDownloadURL/);

  const portoneCall = source.indexOf('PortOne.requestPayment');
  assert.ok(portoneCall > 0);
  const portoneSuccessGate = source.indexOf('await refetch()', portoneCall);
  assert.ok(portoneSuccessGate > portoneCall);
  assert.ok(source.indexOf('latestDetail?.redeliveryPayment.paid') > portoneSuccessGate);
  assert.match(hookSource, /refetch/);
  assert.match(hookSource, /requestSequence/);
  assert.match(hookSource, /AbortController/);
});

const hookCompiled = ts.transpileModule(hookSource, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'useOrderStatus.ts',
}).outputText;

const hookModule = { exports: {} };
new Function(
  'require',
  'module',
  'exports',
  hookCompiled,
)(
  (specifier) => {
    if (specifier === 'react') {
      return {
        useCallback: (fn) => fn,
        useEffect: () => {},
        useRef: () => ({ current: null }),
        useState: (initial) => [initial, () => {}],
      };
    }
    if (specifier === '@/lib/api-base-url') {
      return { getApiBaseUrl: () => 'http://test.invalid' };
    }
    return {};
  },
  hookModule,
  hookModule.exports,
);

const { classifyOrderDetailFetchFailure, getOrderDetailReadErrorMessage } = hookModule.exports;

test('주문 상세 읽기 실패는 auth/network/server로 결정적으로 구분된다', () => {
  assert.equal(classifyOrderDetailFetchFailure({ httpStatus: 401, hasResponse: true }), 'auth');
  assert.equal(classifyOrderDetailFetchFailure({ httpStatus: 403, hasResponse: true }), 'auth');
  assert.equal(
    classifyOrderDetailFetchFailure({ httpStatus: null, hasResponse: false }),
    'network',
  );
  assert.equal(
    classifyOrderDetailFetchFailure({ httpStatus: undefined, hasResponse: false }),
    'network',
  );
  assert.equal(classifyOrderDetailFetchFailure({ httpStatus: 500, hasResponse: true }), 'server');
  assert.equal(classifyOrderDetailFetchFailure({ httpStatus: 502, hasResponse: true }), 'server');
  assert.equal(classifyOrderDetailFetchFailure({ httpStatus: 400, hasResponse: true }), 'server');
  assert.equal(
    classifyOrderDetailFetchFailure({ httpStatus: null, hasResponse: true }),
    'server',
  );

  const authMessage = getOrderDetailReadErrorMessage('auth');
  const networkMessage = getOrderDetailReadErrorMessage('network');
  const serverMessage = getOrderDetailReadErrorMessage('server');
  assert.match(authMessage, /로그인|권한/);
  assert.match(networkMessage, /네트워크/);
  assert.match(serverMessage, /잠시 후 다시 시도/);
  assert.ok(new Set([authMessage, networkMessage, serverMessage]).size === 3);
});

test('주문 상세 hook은 404/auth와 일시 실패의 보관 정책을 구분한다', () => {
  assert.match(hookSource, /setStatus\('not-found'\)/);
  assert.match(hookSource, /setStatus\('found'\)/);
  assert.match(hookSource, /setStatus\(failure\)/);
  assert.match(hookSource, /classifyOrderDetailFetchFailure/);
  assert.match(hookSource, /getOrderDetailReadErrorMessage/);
  assert.match(hookSource, /res\.status === 404/);
  assert.match(hookSource, /httpStatus: res\.status/);
  assert.match(hookSource, /hasResponse: !\(e instanceof TypeError\)/);
  assert.match(hookSource, /if \(failure === 'auth'\)/);
  assert.match(hookSource, /if \(!accessToken\)/);
  assert.match(hookSource, /accessToken\?: string \| null/);
  // authoritative 404/auth는 이전 데이터를 비우고, 일시 실패는 stale을 유지한다.
  const authClearIndex = hookSource.indexOf("if (failure === 'auth')");
  assert.ok(authClearIndex > 0);
  assert.ok(hookSource.indexOf('setOrder(null)', authClearIndex) > authClearIndex);
  assert.ok(hookSource.indexOf('setOrder(null)', authClearIndex) < authClearIndex + 300);
});

test('주문 상세 화면은 not-found와 일시 실패를 같은 의미로 수렴시키지 않는다', () => {
  assert.match(source, /존재하지 않는 주문입니다/);
  assert.match(source, /로그인이 필요하거나 이 주문을 볼 권한이 없습니다/);
  assert.match(source, /주문 목록으로 돌아가기/);
  assert.match(source, /다시 시도/);
  assert.match(source, /status: sessionStatus/);
  assert.match(source, /handleRetry/);
  assert.match(source, /await refetch\(\)/);
  assert.match(source, /router\.push\('\/login'\)/);
  assert.match(source, /주문 정보를 확인할 수 없습니다\. 잠시 후 다시 시도/);
  assert.match(source, /\{error \?\?/);
  assert.match(hookSource, /네트워크 연결을 확인하고 다시 시도/);
  assert.match(hookSource, /주문 정보를 불러오지 못했습니다\. 잠시 후 다시 시도/);
});

test('이전 데이터가 있는 refresh 실패는 stale을 유지하고 재시도를 노출한다', () => {
  assert.match(source, /const detail = orderId \? readOrderDetail\(order, orderId\) : null/);
  assert.match(source, /최신 정보를 불러오지 못했습니다/);
  assert.match(source, /표시된 정보가 최신이 아닐 수 있습니다/);
  assert.match(source, /\(status === 'network' \|\| status === 'server'\)/);
  assert.match(source, /loading=\{retrying\}/);
  assert.match(hookSource, /setInterval\(\(\) => void fetchOrder\(\), 3000\)/);
});

const {
  classifyCommandFailure,
  hasAuthoritativeOrderStatus,
  isStaleOrderRead,
  readCommandConfirmation,
} = helperModule.exports;

test('stale network/server read는 표시를 유지하지만 최신 상태 명령을 차단한다', () => {
  assert.equal(isStaleOrderRead('network'), true);
  assert.equal(isStaleOrderRead('server'), true);
  assert.equal(isStaleOrderRead('found'), false);
  assert.equal(isStaleOrderRead('loading'), false);
  assert.equal(isStaleOrderRead('auth'), false);
  assert.equal(isStaleOrderRead('not-found'), false);

  assert.match(source, /isStaleOrderRead\(status\)/);
  assert.match(source, /최신 상태를 확인하기 전까지 취소·구매 확정·재배송비 결제를 시작할 수 없습니다/);
  // 세 명령 핸들러가 모두 stale 가드를 먼저 수행한다.
  assert.equal((source.match(/if \(isStaleRead\)/g) ?? []).length >= 3, true);
  assert.match(source, /disabled=\{cancelBusy \|\| isStaleRead \|\| cancelOutcome\.kind === 'reconcile-failed'\}/);
  assert.match(source, /disabled=\{redeliveryBusy \|\| isStaleRead\}/);
  assert.match(source, /showReviewReconcileWarning \|\| isStaleRead/);
  // stale이어도 기존 상세 표시 자체는 유지된다.
  assert.match(source, /표시된 정보가 최신이 아닐 수 있습니다/);
});

test('재시도 경로는 refetch를 호출하고 stale 해소를 전제로 actionability를 복원한다', () => {
  assert.match(source, /async function handleRetry\(\)/);
  assert.match(source, /await refetch\(\)/);
  // 재시도 버튼은 일시 busy에만 비활성화되고 영구 차단하지 않는다.
  assert.match(source, /disabled=\{retrying\}/);
});

test('cancel 확인 + 재조회 성공은 done으로 수렴한다', () => {
  assert.equal(readCommandConfirmation({ orderId: 'o1', status: 'CANCELLED' }, { orderId: 'o1', status: 'CANCELLED' }), true);
  assert.equal(readCommandConfirmation({ orderId: 'o1', status: 'REVIEWED' }, { orderId: 'o1', status: 'CANCELLED' }), false);
  assert.equal(readCommandConfirmation({ orderId: 'other', status: 'CANCELLED' }, { orderId: 'o1', status: 'CANCELLED' }), false);
  assert.equal(readCommandConfirmation(null, { orderId: 'o1', status: 'CANCELLED' }), false);

  const ack = source.indexOf("readCommandConfirmation(body, { orderId: detail.id, status: 'CANCELLED' })");
  assert.ok(ack > source.indexOf('async function handleCancel'));
  const reconciling = source.indexOf("setCancelOutcome({ kind: 'reconciling' })");
  assert.ok(reconciling > ack);
  const refetchAfterAck = source.indexOf('await refetch()', reconciling);
  assert.ok(refetchAfterAck > reconciling);
  assert.ok(
    source.indexOf("hasAuthoritativeOrderStatus(latestDetail, 'CANCELLED')", refetchAfterAck) >
      refetchAfterAck,
  );
  assert.ok(source.indexOf("setCancelOutcome({ kind: 'done' })") > refetchAfterAck);
});

test('cancel 확인 + 재조회 실패는 취소 실패가 되지 않는다', () => {
  assert.equal(hasAuthoritativeOrderStatus({ status: 'CANCELLED' }, 'CANCELLED'), true);
  assert.equal(hasAuthoritativeOrderStatus({ status: 'ACCEPTED' }, 'CANCELLED'), false);
  assert.equal(hasAuthoritativeOrderStatus(null, 'CANCELLED'), false);

  assert.match(source, /setCancelOutcome\(\{ kind: 'reconcile-failed' \}\)/);
  assert.match(source, /취소 확인됨 · 상태 재확인 필요/);
  assert.match(source, /취소 실패가\s+아니므로 바로 다시 취소하지 말고/);
  // 취소 배너는 authoritative CANCELLED 또는 reconcile된 done에서만 표시된다.
  assert.match(
    source,
    /const isCancelled = isAuthoritativelyCancelled \|\| cancelOutcome\.kind === 'done'/,
  );
  // reconcile-failed는 별도 경고이며 취소 실패 문구로 수렴하지 않는다.
  assert.doesNotMatch(source, /취소에 실패했습니다/);
});

test('review 확인 + 재조회 성공은 done으로 수렴한다', () => {
  assert.equal(readCommandConfirmation({ orderId: 'o1', status: 'REVIEWED' }, { orderId: 'o1', status: 'REVIEWED' }), true);
  assert.equal(readCommandConfirmation({ orderId: 'o1' }, { orderId: 'o1', status: 'REVIEWED' }), false);

  // 2xx만으로 확정하지 않고 응답 본문의 REVIEWED 확인을 요구한다.
  const ack = source.indexOf("readCommandConfirmation(body, { orderId: detail.id, status: 'REVIEWED' })");
  assert.ok(ack > source.indexOf('async function handleConfirm'));
  const reconciling = source.indexOf("setReviewOutcome({ kind: 'reconciling' })");
  assert.ok(reconciling > ack);
  assert.ok(
    source.indexOf("hasAuthoritativeOrderStatus(latestDetail, 'REVIEWED')") > reconciling,
  );
  assert.ok(source.indexOf("setReviewOutcome({ kind: 'done' })") > reconciling);
  assert.match(source, /구매 확정 완료/);
});

test('review 확인 + 재조회 실패는 확정 실패가 되지 않는다', () => {
  assert.match(source, /setReviewOutcome\(\{ kind: 'reconcile-failed' \}\)/);
  assert.match(source, /구매 확정 확인됨 · 상태 재확인 필요/);
  assert.match(source, /실패가 아니므로 바로 다시 확정하지 말고/);
  // reconcile-failed 동안 명령 버튼은 중복 확정을 막기 위해 비활성화된다.
  assert.match(source, /showReviewReconcileWarning/);
});

test('서버 확정 거부는 실패로 표면화된다', () => {
  assert.equal(classifyCommandFailure({ httpStatus: 400, hasResponse: true }), 'rejected');
  assert.equal(classifyCommandFailure({ httpStatus: 403, hasResponse: true }), 'rejected');
  assert.equal(classifyCommandFailure({ httpStatus: 404, hasResponse: true }), 'rejected');
  assert.equal(classifyCommandFailure({ httpStatus: 409, hasResponse: true }), 'rejected');
  assert.equal(classifyCommandFailure({ httpStatus: 422, hasResponse: true }), 'rejected');

  assert.match(source, /classifyCommandFailure\(\{ httpStatus: response\.status, hasResponse: true \}\)/);
  assert.match(source, /주문을 취소할 수 없습니다/);
  assert.match(source, /구매 확정에 실패했습니다/);
  assert.match(source, /재배송비 결제를 시작할 수 없습니다/);
  assert.match(source, /kind: 'rejected'/);
});

test('전송 불확실성은 blind 중복 재시도 대신 상태 확인을 우선한다', () => {
  assert.equal(classifyCommandFailure({ hasResponse: false }), 'uncertain');
  assert.equal(classifyCommandFailure({ httpStatus: null, hasResponse: false }), 'uncertain');
  assert.equal(classifyCommandFailure({ httpStatus: 500, hasResponse: true }), 'uncertain');
  assert.equal(classifyCommandFailure({ httpStatus: 503, hasResponse: true }), 'uncertain');

  assert.match(source, /결과를 확정할 수 없습니다\. 상태를 다시 확인해 주세요/);
  assert.match(source, /중복 결제 전에/);
  assert.match(source, /중복 요청 전에 다시 시도로 현재 상태를 확인해 주세요/);
  assert.match(source, /상태 다시 확인/);
  // 동일 명령 자동 재전송을 하지 않는다.
  assert.doesNotMatch(source, /setTimeout\(.*handleCancel/);
  assert.doesNotMatch(source, /setTimeout\(.*handleConfirm/);
  assert.doesNotMatch(source, /setTimeout\(.*handleRedeliveryPayment/);
});

test('auth 전환 시 fail-closed가 보존된다', () => {
  assert.match(source, /sessionStatus === 'unauthenticated' \|\| status === 'auth'/);
  assert.match(source, /로그인이 필요하거나 이 주문을 볼 권한이 없습니다/);
  // 명령 핸들러는 토큰 없이 시작하지 않는다.
  assert.ok(source.indexOf('if (!session?.user?.accessToken || !detail?.canRequestCancellation)') > 0);
  assert.ok(source.indexOf('if (!session?.user?.accessToken || !detail)') > 0);
});

test('redelivery paid 확인 게이트가 보존된다', () => {
  assert.match(source, /latestDetail\?\.redeliveryPayment\.paid/);
  assert.match(source, /서버 확인 전입니다/);
  assert.match(source, /!detail\.redeliveryPayment\.requiresRecovery/);
  assert.match(source, /재배송비 결제 상태를 확인할 수 없습니다\. 운영 확인이 필요합니다/);
  // done은 paid 수렴 뒤에만 기록된다.
  const paidGate = source.indexOf('latestDetail?.redeliveryPayment.paid');
  const redeliveryDone = source.indexOf("setRedeliveryOutcome({ kind: 'done' })");
  assert.ok(paidGate > source.indexOf('async function handleRedeliveryPayment'));
  assert.ok(redeliveryDone > paidGate);
  // PortOne 실제 호출 흐름은 그대로이며 테스트에서 실제 결제를 수행하지 않는다.
  assert.match(source, /PortOne\.requestPayment/);
  assert.doesNotMatch(source, /requestPayment\(\{\s*storeId:[^}]*test/i);
});
