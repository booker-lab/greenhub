import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./_client.tsx', import.meta.url), 'utf8');
const helperSource = await readFile(new URL('./_detail.ts', import.meta.url), 'utf8');
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
      canPay: detail?.canPayRedeliveryFee,
      canCancel: detail?.canRequestCancellation,
    })),
    [
      {
        status: 'DELIVERY_HELD',
        hasHold: true,
        hasPhoto: false,
        canPay: true,
        canCancel: true,
      },
      {
        status: 'DELIVERED',
        hasHold: false,
        hasPhoto: true,
        canPay: false,
        canCancel: false,
      },
      {
        status: 'ACCEPTED',
        hasHold: false,
        hasPhoto: false,
        canPay: false,
        canCancel: true,
      },
      {
        status: 'CANCELLED',
        hasHold: false,
        hasPhoto: false,
        canPay: false,
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
    },
  );

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
  assert.doesNotMatch(source, /firebase\/storage|uploadBytes|getDownloadURL/);
});
