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

const { isDeliveryHoldActive, readOrderDetail, readRedeliveryPaymentResponse } =
  helperModule.exports;

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
        canCancel: false,
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

test('회차 주문 직접 취소는 주문 마감 전에만 존재하는 PENDING·ACCEPTED에서만 노출한다', () => {
  const holdFields = {
    deliveryHold: {
      heldAt: '2026-07-21T01:00:00.000Z',
      reasonCode: 'WEATHER',
      reasonMessage: '기상 악화로 배송을 보류합니다.',
      customerResponsible: false,
      redeliveryFee: null,
      nextContactAt: null,
      nextDeliveryAt: null,
      resolvedAt: null,
    },
  };
  const statuses = [
    'PENDING',
    'ACCEPTED',
    'PREPARING',
    'DELIVERY_HELD',
    'DELIVERING',
    'DELIVERED',
    'REVIEWED',
    'CANCELLED',
  ];
  const result = Object.fromEntries(
    statuses.map((status) => {
      const detail = readOrderDetail(
        {
          ...activeOrder,
          id: `round-order-${status}`,
          status,
          ...(status === 'DELIVERY_HELD' ? holdFields : {}),
        },
        `round-order-${status}`,
      );
      assert.ok(detail, status);
      return [status, detail.canRequestCancellation];
    }),
  );
  assert.deepEqual(result, {
    PENDING: true,
    ACCEPTED: true,
    PREPARING: false,
    DELIVERY_HELD: false,
    DELIVERING: false,
    DELIVERED: false,
    REVIEWED: false,
    CANCELLED: false,
  });
});

test('해제된 배송 보류는 경고로 남기지 않고 결제 후 배송 재개 대기 보류는 유지한다', () => {
  const baseHold = {
    heldAt: '2026-07-21T01:00:00.000Z',
    reasonCode: 'ACCESS_UNAVAILABLE',
    reasonMessage: '공동현관 출입이 불가능합니다.',
    customerResponsible: true,
    redeliveryFee: 5000,
    nextContactAt: null,
    nextDeliveryAt: null,
  };
  const paidPayment = {
    required: true,
    holdAt: '2026-07-21T01:00:00.000Z',
    chargeId: 'charge-1',
    status: 'PAID',
    canPay: false,
    paid: true,
    requiresRecovery: false,
  };
  const read = (name, overrides) =>
    readOrderDetail(
      { ...activeOrder, id: `round-order-${name}`, ...overrides },
      `round-order-${name}`,
    );

  const held = read('held', {
    status: 'DELIVERY_HELD',
    deliveryHold: { ...baseHold, resolvedAt: null },
    redeliveryPayment: {
      ...paidPayment,
      chargeId: null,
      status: 'MISSING',
      canPay: true,
      paid: false,
    },
  });
  const awaitingResume = read('awaiting-resume', {
    status: 'PREPARING',
    deliveryHold: { ...baseHold, resolvedAt: null },
    redeliveryPayment: paidPayment,
  });
  const delivered = read('delivered', {
    status: 'DELIVERED',
    deliveryHold: { ...baseHold, resolvedAt: '2026-07-22T02:00:00.000Z' },
  });
  const resumedFree = read('resumed-free', {
    status: 'PREPARING',
    deliveryHold: {
      ...baseHold,
      customerResponsible: false,
      redeliveryFee: null,
      resolvedAt: '2026-07-21T05:00:00.000Z',
    },
  });
  const invalidResolvedAt = read('invalid-resolved', {
    status: 'PREPARING',
    deliveryHold: { ...baseHold, resolvedAt: 'not-a-date' },
    redeliveryPayment: paidPayment,
  });

  assert.equal(held?.deliveryHold?.resolvedAt, null);
  assert.equal(delivered?.deliveryHold?.resolvedAt, '2026-07-22T02:00:00.000Z');
  // 결제 요청 시각(S-15): 요청 전 보류는 null로 읽고, 요청 뒤 보류는 그 시각을 읽는다.
  assert.equal(held?.deliveryHold?.paymentRequestedAt, null);
  const requested = read('requested', {
    status: 'PREPARING',
    deliveryHold: {
      ...baseHold,
      resolvedAt: null,
      paymentRequestedAt: '2026-07-21T03:00:00.000Z',
    },
    redeliveryPayment: paidPayment,
  });
  assert.equal(requested?.deliveryHold?.paymentRequestedAt, '2026-07-21T03:00:00.000Z');
  const brokenRequest = read('broken-request', {
    status: 'PREPARING',
    deliveryHold: { ...baseHold, resolvedAt: null, paymentRequestedAt: 'not-a-date' },
    redeliveryPayment: paidPayment,
  });
  assert.equal(brokenRequest?.deliveryHold?.paymentRequestedAt, null);
  assert.deepEqual(
    [held, awaitingResume, delivered, resumedFree, invalidResolvedAt].map((detail) =>
      detail ? isDeliveryHoldActive(detail) : 'unreadable',
    ),
    [true, true, false, false, true],
  );
  assert.equal(awaitingResume?.redeliveryPayment.paid, true);
  assert.equal(isDeliveryHoldActive({ status: 'DELIVERY_HELD', deliveryHold: null }), false);
  assert.equal(
    isDeliveryHoldActive({
      status: 'DELIVERY_HELD',
      deliveryHold: { ...baseHold, resolvedAt: '2026-07-21T05:00:00.000Z' },
    }),
    true,
  );
  assert.ok(source.includes('{detail.deliveryHold && isDeliveryHoldActive(detail) && ('));
});

test('배송 보류 안내는 사유 코드별 고정 문구로 보이고 직접 적은 사유는 담당자 메모로 구분한다(C-28)', () => {
  const detail = readOrderDetail(
    {
      ...activeOrder,
      status: 'DELIVERY_HELD',
      deliveryHold: {
        heldAt: '2026-07-21T01:00:00.000Z',
        reasonCode: 'ADDRESS_ISSUE',
        reasonMessage: '동 호수 확인 필요',
        customerResponsible: true,
        redeliveryFee: 3000,
        nextContactAt: null,
        nextDeliveryAt: null,
      },
    },
    activeOrder.id,
  );
  assert.equal(detail?.deliveryHold?.reasonCode, 'ADDRESS_ISSUE');
  assert.ok(source.includes('title={deliveryHoldCopy?.title}'));
  assert.ok(source.includes('reasonCode: detail.deliveryHold.reasonCode'));
  assert.ok(source.includes('담당자 메모: {detail.deliveryHold.reasonMessage}'));
  assert.ok(source.includes('{REDELIVERY_UNPAID_NOTICE}'));
  // 내부 용어 '고객 책임: 해당/없음'과 '재배송비: n원' 줄은 고정 문구로 대신한다.
  assert.ok(!source.includes('고객 책임:'));
  assert.ok(!source.includes('재배송비: {'));
});

test('수령 거부·상품 파손 보류도 주문 상세가 보류 내용을 읽는다', () => {
  for (const [reasonCode, customerResponsible, redeliveryFee] of [
    ['RECEIPT_REFUSED', true, 10000],
    ['PRODUCT_DAMAGED', false, null],
  ]) {
    const detail = readOrderDetail(
      {
        ...activeOrder,
        status: 'DELIVERY_HELD',
        deliveryHold: {
          heldAt: '2026-07-21T01:00:00.000Z',
          reasonCode,
          reasonMessage: '현장 메모',
          customerResponsible,
          redeliveryFee,
          nextContactAt: null,
          nextDeliveryAt: null,
        },
      },
      activeOrder.id,
    );
    assert.equal(detail?.status, 'DELIVERY_HELD', reasonCode);
    assert.equal(detail?.deliveryHold?.reasonCode, reasonCode);
  }
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

test('고객 사유 종결 주문은 종결 기록(사유·시각)만 읽고 보류 경고·배송 현황을 숨긴다', () => {
  const closed = readOrderDetail(
    {
      ...activeOrder,
      id: 'round-order-closed',
      status: 'CLOSED_UNDELIVERED',
      deliveryHold: {
        heldAt: '2026-11-13T06:00:00.000Z',
        reasonCode: 'RECEIPT_REFUSED',
        reasonMessage: '수령 거부',
        customerResponsible: true,
        redeliveryFee: 5000,
        nextContactAt: null,
        nextDeliveryAt: null,
        resolvedAt: '2026-11-14T01:30:00.000Z',
      },
      customerFaultClosure: {
        reasonCode: 'RECEIPT_REFUSED',
        heldAt: '2026-11-13T06:00:00.000Z',
        redeliveryFee: 5000,
        closedAt: '2026-11-14T01:30:00.000Z',
      },
    },
    'round-order-closed',
  );
  assert.ok(closed);
  assert.equal(closed.status, 'CLOSED_UNDELIVERED');
  assert.deepEqual(closed.customerFaultClosure, {
    reasonCode: 'RECEIPT_REFUSED',
    closedAt: '2026-11-14T01:30:00.000Z',
  });
  assert.equal(closed.canRequestCancellation, false);
  assert.equal(isDeliveryHoldActive(closed), false);

  // 종결 기록 모양이 달라도 주문 상세는 읽고 기록만 비운다. 다른 상태 주문은 기록을 읽지 않는다.
  const malformed = readOrderDetail(
    { ...activeOrder, status: 'CLOSED_UNDELIVERED', customerFaultClosure: { reasonCode: 'X' } },
    activeOrder.id,
  );
  assert.equal(malformed?.customerFaultClosure, null);
  assert.equal(readOrderDetail(activeOrder, activeOrder.id)?.customerFaultClosure, null);

  // 화면: 종결 안내를 보이고 배송 현황 단계는 그리지 않는다.
  assert.match(source, /isClosedUndelivered && \(/);
  assert.match(source, /CLOSED_UNDELIVERED_MESSAGE/);
  assert.match(
    source,
    /!isCancelled && detail\.status !== 'DELIVERY_HELD' && !isClosedUndelivered/,
  );
  assert.match(source, /customerFaultClosureWarning\(/);
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
  assert.match(source, /찾을 수 없는 주문이에요\. 주문 번호를 확인하거나 주문 목록으로 돌아가 주세요\./);
  assert.match(source, /로그인이 필요해요\. 로그인하면 이 주문으로 돌아와요\./);
  assert.match(source, /이 주문을 볼 수 없어요\. 내 주문 목록에서 다시 골라 주세요\./);
  // 로그인한 채 거절된 경우(status 'auth')에는 로그인 버튼을 두지 않는다(같은 주문으로 되돌아와 무반응처럼 보임).
  assert.match(source, /const needsLogin = sessionStatus === 'unauthenticated';/);
  assert.match(source, /\{needsLogin && \(\s*<LoadingButton onClick=\{\(\) => router\.push\(currentMyPageLoginUrl\(\)\)\}/);
  assert.match(source, /주문 목록으로 돌아가기/);
  assert.match(source, /다시 시도/);
  assert.match(source, /status: sessionStatus/);
  assert.match(source, /handleRetry/);
  assert.match(source, /await refetch\(\)/);
  // 로그인으로 보낼 때 보던 주문 상세를 복귀 주소로 싣는다(C-09 후속, mypage/_login.test.mjs).
  assert.match(source, /router\.push\(currentMyPageLoginUrl\(\)\)/);
  assert.match(source, /주문 정보를 확인하지 못했어요\. 잠시 후 다시 시도/);
  // 일시 실패 안내는 훅의 오류 글자 대신 읽기 상태(status)에서 해요체 고객 문구를 고른다.
  assert.match(source, /\{orderDetailReadFailureMessage\(status\)\}/);
  assert.doesNotMatch(source, /\{error \?\?/);
  assert.match(hookSource, /네트워크 연결을 확인하고 다시 시도/);
  assert.match(hookSource, /주문 정보를 불러오지 못했어요\. 잠시 후 다시 시도/);
});

test('이전 데이터가 있는 refresh 실패는 stale을 유지하고 재시도를 노출한다', () => {
  assert.match(source, /const detail = orderId \? readOrderDetail\(order, orderId\) : null/);
  assert.match(source, /최신 정보를 불러오지 못했어요/);
  assert.match(source, /보이는 정보가 최신이 아닐 수 있어요/);
  assert.match(source, /\(status === 'network' \|\| status === 'server'\)/);
  assert.match(source, /loading=\{retrying\}/);
  // 자동 확인은 결제 확인 중(PENDING) 주문만 2분 안에서 하고, 그 밖에는 다시 시도(refetch)로 읽는다.
  assert.match(
    hookSource,
    /setTimeout\(\(\) => void fetchOrder\(\), ORDER_STATUS_POLL_INTERVAL_MS\)/,
  );
  assert.match(hookSource, /shouldPollOrderStatus\(lastStatus, Date\.now\(\) - pollStartedAt\)/);
  assert.doesNotMatch(hookSource, /setInterval/);
});

test('모바일 재배송비 결제 복귀는 서버 결제 확인 전까지 주문을 다시 읽는다', () => {
  // 주문 상태 자동 확인은 PENDING 주문만 하므로, 보류·준비 중 주문의 재배송비 결제는 화면이 따로 다시 읽는다.
  assert.match(source, /shouldRecheckRedeliveryPayment\(\s*redeliveryRedirect,\s*redeliveryPaid,/);
  assert.match(source, /ORDER_STATUS_POLL_MAX_MS/);
  const recheckAt = source.indexOf('if (!awaitingRedeliveryPaid) return;');
  assert.ok(recheckAt !== -1, '재확인 효과가 있어야 한다');
  const recheckBlock = source.slice(recheckAt, recheckAt + 2400);
  // 다시 읽기가 끝난 뒤에만 다음 확인을 예약하고, 화면을 떠나면 멈춘다.
  assert.match(recheckBlock, /void refetch\(\)\.finally\(scheduleRecheck\)/);
  assert.match(recheckBlock, /ORDER_STATUS_POLL_INTERVAL_MS/);
  assert.match(recheckBlock, /stopped = true/);
  assert.match(recheckBlock, /clearTimeout\(timer\)/);
  // 결제 명령을 자동으로 다시 보내지 않는다.
  assert.doesNotMatch(recheckBlock, /handleRedeliveryPayment/);
});

test('취소 사유는 내부 코드 대신 고객이 읽을 문장으로 보인다', () => {
  assert.match(source, /import \{ formatCancelReason \} from '@\/lib\/order-cancel-reason'/);
  assert.match(source, /const cancelReasonText = formatCancelReason\(detail\.cancelReason\)/);
  assert.match(source, /사유: \{cancelReasonText\}/);
  assert.doesNotMatch(source, /사유: \{detail\.cancelReason\}/);
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
  assert.match(source, /최신 상태를 확인하기 전까지 취소·구매 확정·재배송비 결제를 시작할 수 없어요/);
  // 세 명령 핸들러가 모두 stale 가드를 먼저 수행한다.
  assert.equal((source.match(/if \(isStaleRead\)/g) ?? []).length >= 3, true);
  assert.match(source, /disabled=\{cancelBusy \|\| isStaleRead \|\| cancelOutcome\.kind === 'reconcile-failed'\}/);
  assert.match(source, /disabled=\{redeliveryBusy \|\| isStaleRead\}/);
  assert.match(source, /showReviewReconcileWarning \|\| isStaleRead/);
  // stale이어도 기존 상세 표시 자체는 유지된다.
  assert.match(source, /보이는 정보가 최신이 아닐 수 있어요/);
  // 명령을 막을 때는 해요체 고객 문구 하나로 상태 확인을 안내한다.
  assert.equal((source.match(/setActionError\(ORDER_DETAIL_STALE_MESSAGE\)/g) ?? []).length, 3);
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
  assert.match(source, /취소 실패가 아니니 바로\s+다시 취소하지 말고/);
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
  assert.match(source, /확정 실패가 아니니 바로\s+다시 확정하지 말고/);
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
  assert.match(source, /'주문을 취소할 수 없어요\.'/);
  assert.match(source, /'구매 확정을 하지 못했어요\.'/);
  assert.match(source, /'재배송비 결제를 시작할 수 없어요\.'/);
  assert.match(source, /kind: 'rejected'/);
});

test('전송 불확실성은 blind 중복 재시도 대신 상태 확인을 우선한다', () => {
  assert.equal(classifyCommandFailure({ hasResponse: false }), 'uncertain');
  assert.equal(classifyCommandFailure({ httpStatus: null, hasResponse: false }), 'uncertain');
  assert.equal(classifyCommandFailure({ httpStatus: 500, hasResponse: true }), 'uncertain');
  assert.equal(classifyCommandFailure({ httpStatus: 503, hasResponse: true }), 'uncertain');

  // 결과를 모르면 명령마다 고객 문구 하나를 보이고 아래 '상태 다시 확인'으로 안내한다.
  assert.match(source, /const REVIEW_UNCERTAIN_MESSAGE = '구매 확정이 처리됐는지 아직 확인하지 못했어요\.'/);
  assert.match(source, /message: REVIEW_UNCERTAIN_MESSAGE/);
  assert.match(source, /message: REDELIVERY_PAYMENT_UNCERTAIN_MESSAGE/);
  assert.match(source, /redeliveryOutcome\.kind === 'uncertain'/);
  assert.match(source, /다시 요청하기 전에 아래 ‘상태 다시 확인’을 눌러 주세요/);
  assert.match(source, /상태 다시 확인/);
  // 동일 명령 자동 재전송을 하지 않는다.
  assert.doesNotMatch(source, /setTimeout\(.*handleCancel/);
  assert.doesNotMatch(source, /setTimeout\(.*handleConfirm/);
  assert.doesNotMatch(source, /setTimeout\(.*handleRedeliveryPayment/);
});

test('auth 전환 시 fail-closed가 보존된다', () => {
  assert.match(source, /sessionStatus === 'unauthenticated' \|\| status === 'auth'/);
  assert.match(source, /이 주문을 볼 수 없어요/);
  // 명령 핸들러는 토큰 없이 시작하지 않는다.
  assert.ok(source.indexOf('if (!session?.user?.accessToken || !detail?.canRequestCancellation)') > 0);
  assert.ok(source.indexOf('if (!session?.user?.accessToken || !detail)') > 0);
});

test('redelivery paid 확인 게이트가 보존된다', () => {
  assert.match(source, /latestDetail\?\.redeliveryPayment\.paid/);
  const paidGateAt = source.indexOf('if (!latestDetail?.redeliveryPayment.paid)');
  assert.ok(paidGateAt > 0);
  assert.match(
    source.slice(paidGateAt, paidGateAt + 200),
    /kind: 'uncertain',\s+message: REDELIVERY_PAYMENT_UNCERTAIN_MESSAGE/,
  );
  assert.match(source, /!detail\.redeliveryPayment\.requiresRecovery/);
  assert.match(source, /\{REDELIVERY_PAYMENT_NEEDS_SUPPORT_MESSAGE\}/);
  // done은 paid 수렴 뒤에만 기록된다.
  const paidGate = source.indexOf('latestDetail?.redeliveryPayment.paid');
  const redeliveryDone = source.indexOf("setRedeliveryOutcome({ kind: 'done' })");
  assert.ok(paidGate > source.indexOf('async function handleRedeliveryPayment'));
  assert.ok(redeliveryDone > paidGate);
  // PortOne 실제 호출 흐름은 그대로이며 테스트에서 실제 결제를 수행하지 않는다.
  assert.match(source, /PortOne\.requestPayment/);
  assert.doesNotMatch(source, /requestPayment\(\{\s*storeId:[^}]*test/i);
});

test('재배송비 결제는 모바일 리다이렉트로 이 주문 상세에 돌아오고 서버 paid로만 완료한다', () => {
  const handler = source.slice(source.indexOf('async function handleRedeliveryPayment'));
  assert.match(
    handler,
    /buildPaymentRedirectUrl\(browser\.origin, redeliveryPaymentRedirectPath\(detail\.id\)\)/,
  );
  assert.match(handler, /\.\.\.\(redirectUrl \? \{ redirectUrl \} : \{\}\)/);
  // 복귀 쿼리는 한 번만 읽고 주소에서 지운다.
  assert.match(
    source,
    /parsePaymentRedirectResult\(new URLSearchParams\(window\.location\.search\)\)/,
  );
  assert.match(source, /window\.history\.replaceState\(/);
  // 완료 판정은 서버 상태(redeliveryPayment.paid, stale 읽기 제외)를 거친다.
  assert.match(
    source,
    /const redeliveryPaid = detail && !isStaleRead \? detail\.redeliveryPayment\.paid : undefined/,
  );
  assert.match(source, /resolveRedeliveryPaymentReturn\(redeliveryRedirect, redeliveryPaid\)/);
});

test('재배송비 결제는 고른 결제수단(카드 포함)으로 결제창을 열고 카카오페이를 고정하지 않는다', () => {
  const handler = source.slice(source.indexOf('async function handleRedeliveryPayment'));
  assert.match(handler, /readPortonePaymentConfiguration\(redeliveryMethod\)/);
  assert.match(handler, /\.\.\.buildPortonePayMethodRequest\(configuration\.paymentMethod, \{/);
  assert.doesNotMatch(source, /readPortonePaymentConfiguration\('kakaopay'\)/);
  assert.doesNotMatch(source, /payMethod: 'EASY_PAY'/);
  // 선택지가 둘 이상일 때만 결제수단 선택을 보여 준다(채널 키 없는 수단은 숨김).
  assert.match(source, /PAYMENT_METHOD_OPTIONS\.length > 1 &&/);
});

test('재배송비 결제 뒤 서버 결제 확인을 요청한다(결제창 성공 직후 1번, 리다이렉트 복귀 대기 중 6·20·45초)', () => {
  // 결제창이 성공으로 끝나면 다시 읽기 전에 서버 확인을 한 번 요청한다.
  const reconcileIndex = source.indexOf(
    "setRedeliveryOutcome({ kind: 'reconciling' });\n      // 결제창이",
  );
  assert.ok(reconcileIndex > 0);
  const afterReconcile = source.slice(reconcileIndex, reconcileIndex + 400);
  assert.match(
    afterReconcile,
    /await requestRedeliveryPaymentCheck\(detail\.id, session\.user\.accessToken\);\s+const latestOrder = await refetch\(\)/,
  );
  // 리다이렉트 복귀 재확인 루프는 정해진 시점에만 확인을 보내고, 바뀌었다고 답하면 다시 읽는다.
  assert.match(
    source,
    /shouldCheckRedeliveryPayment\(Date\.now\(\) - startedAt, checksMade, ORDER_STATUS_POLL_MAX_MS\)/,
  );
  assert.match(source, /if \(settled && !stopped\) void refetch\(\);/);
  assert.match(source, /maybeCheckPayment\(\);\s+void refetch\(\)\.finally\(scheduleRecheck\);/);
  // 확인 경로는 주문 상세의 재배송비 확인 API다.
  assert.match(source, /redeliveryPaymentCheckPath\(orderId\)/);
  assert.match(source, /method: 'POST'/);
});

test('주문 취소 안내·확인창·실패 문구는 내부 동작 대신 고객 기준으로 말한다', () => {
  // 회차 주문 취소 안내와 확인창
  assert.match(source, /'주문 마감 전까지 취소할 수 있어요\. 결제한 수단으로 환불돼요\.'/);
  assert.match(source, /\? '주문을 취소할까요\?'/);
  // 결과를 모를 때는 고객 문구 하나로 '상태 다시 확인'을 안내한다.
  assert.match(source, /const CANCEL_UNCERTAIN_MESSAGE = '취소가 처리됐는지 아직 확인하지 못했어요\.'/);
  assert.match(source, /setActionError\(CANCEL_UNCERTAIN_MESSAGE\)/);
  assert.match(source, /취소가 접수됐어요\. 최신 주문 상태를 확인하고 있어요\./);
  // 취소 흐름에는 서버·검증 같은 내부 동작 설명이 남지 않는다.
  const handler = source.slice(
    source.indexOf('async function handleCancel'),
    source.indexOf('async function handleRedeliveryPayment'),
  );
  assert.doesNotMatch(handler, /서버|확정할 수 없습니다|검증하지 못했습니다/);
  assert.doesNotMatch(handler, /caught\.message : /);
  assert.doesNotMatch(source, /서버가 회차 마감 여부를 다시 확인/);
  assert.doesNotMatch(source, /서버에서 회차 마감 전인지 다시 확인/);
  assert.doesNotMatch(source, /서버에서 취소를 확인했습니다/);
  assert.doesNotMatch(source, /취소는 서버에서 확인됐지만/);
  assert.doesNotMatch(source, /중복 요청 전에 다시 시도로/);
  // 확인되지 않은 환불 기간 약속은 쓰지 않는다.
  assert.doesNotMatch(source, /영업일/);
});

test('주문 상세 하단에 주문번호와 함께 고객센터 전화 문의를 둔다', () => {
  assert.match(source, /import \{ PUBLIC_BUSINESS_INFO \} from '@\/lib\/publicBusinessInfo'/);
  const support = source.slice(source.indexOf('data-testid="order-support"'));
  assert.ok(support.length > 0 && source.includes('data-testid="order-support"'));
  assert.match(support, />\s*문의하기\s*</);
  assert.match(support, /주문번호 \{detail\.orderNumber\}/);
  assert.match(support, /<ButtonLink[^>]*href=\{PUBLIC_BUSINESS_INFO\.phoneHref\}/);
  assert.match(support, /전화로 문의하기 \{PUBLIC_BUSINESS_INFO\.phone\}/);
  // 번호를 화면 코드에 직접 적지 않는다.
  assert.doesNotMatch(source, /tel:\d|010-\d{4}-\d{4}/);
});

test('구매 확정·재배송비 흐름 문구는 내부 표현 대신 고객 문구로 말한다', () => {
  // '서버'·'운영 확인'·'확정할 수 없습니다'·'검증하지 못했습니다' 같은 내부 표현이 화면 문자열에 남지 않는다.
  const reviewHandler = source.slice(
    source.indexOf('async function handleConfirm'),
    source.indexOf("if (sessionStatus === 'loading'"),
  );
  const redeliveryHandler = source.slice(
    source.indexOf('async function handleRedeliveryPayment'),
    source.indexOf('async function handleConfirm'),
  );
  for (const handler of [reviewHandler, redeliveryHandler]) {
    assert.ok(handler.length > 0);
    assert.doesNotMatch(handler, /'[^'\n]*(서버|운영|확정할 수 없습니다|검증하지 못했습니다)[^'\n]*'/);
    // 내부 오류 글자(caught.message 원문)를 그대로 보이지 않는다.
    assert.doesNotMatch(handler, /caught\.message : /);
  }
  assert.doesNotMatch(source, /서버 확인 중\.\.\./);
  assert.match(source, /'결제 확인 중\.\.\.'/);
  assert.doesNotMatch(source, /서버에서 구매 확정을 확인했습니다/);
  assert.doesNotMatch(source, /구매 확정은 서버에서 확인됐지만/);
  assert.doesNotMatch(source, /운영 확인이 필요합니다/);
  assert.doesNotMatch(source, /서버 확인 전입니다/);
  assert.match(source, /구매 확정이 접수됐어요\. 최신 주문 상태를 확인하고 있어요\./);
  assert.match(source, /재배송비 결제가 완료됐어요\. 배송이 다시 시작되기를 기다리고 있어요\./);
  // 재배송비 결제가 실패·환불 상태면 결제 FAILED/REFUNDED 응답과 복구 필요 표시 모두 고객센터 안내로 보인다.
  assert.match(redeliveryHandler, /message: REDELIVERY_PAYMENT_NEEDS_SUPPORT_MESSAGE/);
  // 공동구매 취소 확인창·안내도 해요체로 말한다.
  assert.match(source, /'공동구매 참여를 취소할까요\?\\n취소하면 되돌릴 수 없어요\.'/);
  assert.match(source, /'모집 중인 공동구매 참여를 취소할 수 있어요\.'/);
  assert.doesNotMatch(source, /하시겠습니까/);
});

test('재배송비 결제창 실패·모바일 복귀는 PG 원문 대신 고객 문구로 보인다', () => {
  assert.match(
    source,
    /import \{[^}]*customerRedeliveryPaymentReturn[^}]*\} from '@\/lib\/order-redelivery-message'/,
  );
  const handler = source.slice(
    source.indexOf('async function handleRedeliveryPayment'),
    source.indexOf('async function handleConfirm'),
  );
  // PC 결제창 실패 응답은 원문 message를 쓰지 않고 같은 규칙의 고객 문구로 바꾼다.
  assert.match(handler, /message: redeliveryPaymentFailureMessage\(result\)/);
  assert.doesNotMatch(handler, /result\.message/);
  // 모바일 복귀 판정은 그대로 두고 문구만 고객 문구로 바꾼다.
  assert.match(
    source,
    /customerRedeliveryPaymentReturn\(\s*redeliveryRedirect,\s*resolveRedeliveryPaymentReturn\(redeliveryRedirect, redeliveryPaid\),\s*\)/,
  );
});

// 화면에 보이는 글자(문자열·템플릿 리터럴, JSX 글자)를 모은다. 주석은 AST에 없으므로 빠지고,
// API 응답 원문(body.message)은 리터럴이 아니므로 검사 대상이 아니다.
function collectScreenStrings(text, fileName) {
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const strings = [];
  const visit = (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      strings.push(node.text);
    } else if (ts.isJsxText(node)) {
      const value = node.getText().trim();
      if (value) strings.push(value);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return strings;
}

test('주문 상세 화면 문구는 해요체로 통일하고 합니다체가 다시 들어오지 않는다', () => {
  const strings = collectScreenStrings(source, '_client.tsx');
  // 수집이 실제로 동작하는지 확인한다(해요체 문구가 잡혀야 한다).
  assert.ok(strings.includes('주문이 취소됐어요'));
  assert.ok(strings.includes('찾을 수 없는 주문이에요. 주문 번호를 확인하거나 주문 목록으로 돌아가 주세요.'));
  const formal = strings.filter((value) => /니다|니까|십시오/.test(value));
  assert.deepEqual(formal, []);
  // 바뀐 조회 안내 문구는 같은 화면의 해요체 문구로 보인다.
  assert.doesNotMatch(source, /존재하지 않는 주문입니다/);
  assert.doesNotMatch(source, /주문이 취소되었습니다/);
  assert.doesNotMatch(source, /최신 상태 확인 후 다시 시도해 주세요/);
});

test('재배송비 결제의 예상하지 못한 예외는 결제창을 열기 전과 뒤를 나눠 안내한다', () => {
  const handler = source.slice(
    source.indexOf('async function handleRedeliveryPayment'),
    source.indexOf('async function handleConfirm'),
  );
  assert.match(handler, /let stage: RedeliveryPaymentStage = 'requesting';/);
  const openingAt = handler.indexOf("stage = 'opening-window';");
  const configAt = handler.indexOf('readPortonePaymentConfiguration(redeliveryMethod)');
  const sdkAt = handler.indexOf("await import('@portone/browser-sdk/v2')");
  const payingAt = handler.indexOf("stage = 'paying';");
  const requestAt = handler.indexOf('PortOne.requestPayment(');
  const confirmingAt = handler.indexOf("stage = 'confirming';");
  const reconcilingAt = handler.indexOf("setRedeliveryOutcome({ kind: 'reconciling' })");
  // 결제 설정 읽기·결제 모듈 불러오기는 결제창을 열기 전 단계에 있다.
  assert.ok(openingAt > 0 && openingAt < configAt && configAt < sdkAt && sdkAt < payingAt);
  // 결제창 호출부터는 결과를 모르는 단계이고, 완료 확인도 같은 단계로 본다.
  assert.ok(payingAt < requestAt && requestAt < confirmingAt && confirmingAt < reconcilingAt);
  // 마지막 catch는 단계로 문구를 고른다(모든 예외를 '확인하지 못했어요'로 묶지 않는다).
  assert.match(
    handler,
    /const outcome = redeliveryPaymentUnexpectedFailure\(stage\);\s+setRedeliveryOutcome\(outcome\);\s+setActionError\(outcome\.message\);/,
  );
  assert.doesNotMatch(
    handler,
    /setRedeliveryOutcome\(\{ kind: 'uncertain', message: REDELIVERY_PAYMENT_UNCERTAIN_MESSAGE \}\)/,
  );
  // 결과를 모를 때만 '상태 다시 확인'을 보인다(시작하지 못한 경우는 rejected라 다시 결제할 수 있다).
  const recheck = source.slice(
    source.indexOf('const needsStatusRecheck ='),
    source.indexOf('const showPickupCode ='),
  );
  assert.match(recheck, /redeliveryOutcome\.kind === 'uncertain'/);
  assert.doesNotMatch(recheck, /redeliveryOutcome\.kind === 'rejected'/);
});

test('결제 확인 중 주문은 배송 현황 단계 대신 결제 안내와 장바구니로 가기를 보이고 취소는 그대로 둔다', () => {
  assert.match(
    source,
    /import \{ isPaymentPendingOrder, orderDetailPendingPaymentGuide \} from '@\/lib\/order-pending-payment'/,
  );
  assert.match(source, /import Link from 'next\/link'/);
  // 고객이 취소한 뒤에는 결제 안내를 내지 않도록 화면의 취소 판단(isCancelled)을 함께 넘긴다.
  assert.match(
    source,
    /const pendingPaymentGuide = orderDetailPendingPaymentGuide\(detail\.status, \{\s+cancelled: isCancelled,\s+\}\);/,
  );
  const guideStart = source.indexOf('data-testid="order-pending-payment"');
  assert.ok(guideStart > 0);
  const guide = source.slice(guideStart, source.indexOf('</ButtonLink>', guideStart));
  assert.match(guide, /\{pendingPaymentGuide\.autoCancelNotice\}/);
  assert.match(guide, /\{pendingPaymentGuide\.retryHint\}/);
  assert.match(guide, /render=\{<Link href=\{pendingPaymentGuide\.cartHref\} \/>\}/);
  assert.match(guide, /\{pendingPaymentGuide\.cartLabel\}/);
  // 안내는 주문 상품보다 먼저 보인다.
  assert.ok(guideStart < source.indexOf('            주문 상품'));

  // 배송 현황 단계는 결제 확인 중일 때 그리지 않고 안내 문장으로 바꾼다.
  const timeline = source.slice(
    source.indexOf(
      "{!isCancelled && detail.status !== 'DELIVERY_HELD' && !isClosedUndelivered && (",
    ),
    source.indexOf('data-testid="order-support"'),
  );
  assert.match(
    timeline,
    /\{pendingPaymentGuide \? \([\s\S]*\{pendingPaymentGuide\.timelineNotice\}[\s\S]*\) : \(\s+<DeliverySteps active=\{currentStep\} labels=\{steps\.map\(orderTimelineStepLabel\)\} \/>\s+\)\}/,
  );

  // 기존 주문 취소(PENDING·ACCEPTED)는 그대로 유지한다.
  assert.match(helperSource, /new Set<OrderStatus>\(\['PENDING', 'ACCEPTED'\]\)/);
  assert.match(source, /\{detail\.isRoundOrder \? '주문 취소' : '공동구매 참여 취소'\}/);
});

test('결제를 마치지 않은 주문의 취소 안내는 환불을 약속하지 않는다(UX 감사 C-06)', () => {
  assert.match(source, /isPaymentPendingOrder\(detail\.status\)/);
  assert.match(source, /결제를 마치지 않은 주문이에요\. 필요 없으면 지금 취소할 수 있어요\./);
});
