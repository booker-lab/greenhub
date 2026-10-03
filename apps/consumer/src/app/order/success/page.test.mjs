import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');
const testableSource = `${source}
export { isReceivedStatus, parseOrderId, readSuccessOrder, resolveSuccessOrderId };`;
const compiled = ts.transpileModule(testableSource, {
  compilerOptions: {
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'page.tsx',
}).outputText;

const redirectSource = await readFile(
  new URL('../../../lib/payment-redirect.ts', import.meta.url),
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
  if (specifier === '@/lib/payment-redirect') return redirectModule.exports;
  if (specifier === '@/hooks/useCart') return { useCart: () => ({ removeRoundItems: () => {} }) };
  if (specifier === 'react/jsx-runtime') {
    return { Fragment: Symbol('Fragment'), jsx: () => null, jsxs: () => null };
  }
  if (
    specifier === '@mantine/core' ||
    specifier === 'lucide-react' ||
    specifier === 'next/navigation' ||
    specifier === 'next-auth/react' ||
    specifier === '@/hooks/useOrderStatus'
  ) {
    return {};
  }
  throw new Error(`예상하지 못한 주문 완료 페이지 모듈 요청: ${specifier}`);
};
new Function('require', 'module', 'exports', compiled)(
  requireForTest,
  pageModule,
  pageModule.exports,
);

const { isReceivedStatus, parseOrderId, readSuccessOrder, resolveSuccessOrderId } =
  pageModule.exports;
const { parsePaymentRedirectResult } = redirectModule.exports;

const roundOrder = {
  id: 'round-order-1',
  orderNumber: '20260721-000123',
  schemaVersion: 2,
  roundId: 'round-1',
  status: 'ACCEPTED',
  saleType: 'normal',
  deliveryMethod: 'direct',
  deliveryFee: 0,
  totalAmount: 69000,
  orderItems: [
    {
      roundItemId: 'round-item-1',
      productId: 'product-1',
      productName: '호접란 하나',
      productImageUrl: null,
      unitPrice: 23000,
      quantity: 2,
      subtotalAmount: 46000,
    },
    {
      roundItemId: 'round-item-2',
      productId: 'product-2',
      productName: '호접란 둘',
      productImageUrl: null,
      unitPrice: 23000,
      quantity: 1,
      subtotalAmount: 23000,
    },
  ],
};

test('안전한 단일 orderId만 주문 조회 식별자로 사용한다', () => {
  assert.equal(parseOrderId(['round-order-1']), 'round-order-1');

  for (const values of [
    [],
    [''],
    [' round-order-1'],
    ['round/order-1'],
    ['round-order-1', 'another-order'],
    ['a'.repeat(129)],
  ]) {
    assert.equal(parseOrderId(values), null);
  }
});

test('서버 회차 주문 응답의 주문번호와 다중 상품 요약을 정본으로 읽는다', () => {
  assert.deepEqual(readSuccessOrder(roundOrder, 'round-order-1'), {
    orderNumber: '20260721-000123',
    isRoundOrder: true,
    items: [
      {
        id: 'round-item-1',
        productName: '호접란 하나',
        quantity: 2,
        subtotalAmount: 46000,
      },
      {
        id: 'round-item-2',
        productName: '호접란 둘',
        quantity: 1,
        subtotalAmount: 23000,
      },
    ],
    totalQuantity: 3,
    totalAmount: 69000,
  });
});

test('요청 식별자 불일치와 손상된 회차 주문 응답은 성공으로 간주하지 않는다', () => {
  const invalidOrders = [
    { ...roundOrder, id: 'another-order' },
    { ...roundOrder, orderNumber: '' },
    { ...roundOrder, roundId: '' },
    { ...roundOrder, status: 'PENDING' },
    { ...roundOrder, orderItems: [] },
    {
      ...roundOrder,
      orderItems: [
        roundOrder.orderItems[0],
        { ...roundOrder.orderItems[1], roundItemId: 'round-item-1' },
      ],
    },
    {
      ...roundOrder,
      orderItems: [roundOrder.orderItems[0], { ...roundOrder.orderItems[1], subtotalAmount: 1 }],
    },
    { ...roundOrder, totalAmount: 1 },
  ];

  for (const order of invalidOrders) {
    assert.equal(readSuccessOrder(order, 'round-order-1'), null);
  }
});

test('기존 단일 상품·legacy 성공 화면은 서버 주문번호가 없으면 orderId를 사용한다', () => {
  assert.deepEqual(
    readSuccessOrder(
      {
        id: 'legacy-order-1',
        status: 'RECRUITING',
        schemaVersion: 1,
      },
      'legacy-order-1',
    ),
    {
      orderNumber: 'legacy-order-1',
      isRoundOrder: false,
      items: [],
      totalQuantity: 0,
      totalAmount: 0,
    },
  );
  assert.match(source, /공동구매 목표 달성 시 주문이 확정됩니다/);
});

test('회차 성공 화면은 화요일 오전 9시 문 앞 배송 약속과 서버 상품 요약을 표시한다', () => {
  assert.match(source, /회차 주문번호/);
  assert.match(source, /주문 상품/);
  assert.match(source, /화요일 오전 9시까지 문 앞 배송/);
  assert.match(source, /successOrder\.items\.map/);
});

test('결제 확인·성공·취소 외 유효 상태는 접수 안내 화면으로 수렴한다', () => {
  const received = [
    'CONFIRMED',
    'PREPARING',
    'DELIVERING',
    'DELIVERY_HELD',
    'HUB_ARRIVED',
    'PICKED_UP',
    'DELIVERED',
    'REVIEWED',
  ];
  for (const status of received) {
    assert.equal(isReceivedStatus(status), true, status);
  }
  for (const status of ['PENDING', 'ACCEPTED', 'RECRUITING', 'CANCELLED', 'UNKNOWN']) {
    assert.equal(isReceivedStatus(status), false, status);
  }
  // 진행 상태 주문도 성공 응답 판정에서 제외되어 오류 화면으로 가지 않는다.
  assert.equal(readSuccessOrder({ ...roundOrder, status: 'PREPARING' }, 'round-order-1'), null);
  assert.match(source, /주문이 접수되었습니다/);
  assert.match(source, /isReceived && validOrder && !errorMessage/);
  assert.equal(source.match(/<OrderResultActions/g)?.length, 2);
});

test('모바일 결제 리다이렉트 성공 복귀는 paymentId(= 주문 ID)로 서버 주문 상태를 조회한다', () => {
  const resolve = (search) => {
    const params = new URLSearchParams(search);
    return resolveSuccessOrderId(params.getAll('orderId'), parsePaymentRedirectResult(params));
  };
  assert.equal(resolve('orderId=order-1'), 'order-1');
  assert.equal(resolve('paymentId=order-1'), 'order-1');
  assert.equal(resolve('paymentId=order-1&transactionType=PAYMENT&txId=tx-1'), 'order-1');
  assert.equal(resolve('orderId=order-1&paymentId=order-1'), 'order-1');
  // 서로 다른 식별자·실패·손상 복귀는 주문 조회 대상으로 쓰지 않는다.
  assert.equal(resolve('orderId=order-1&paymentId=order-2'), null);
  assert.equal(resolve('paymentId=order-1&code=FAILURE_TYPE_PG&message=취소'), null);
  assert.equal(resolve('paymentId=a&paymentId=b'), null);
  assert.equal(resolve(''), null);
});

test('리다이렉트 실패 복귀는 성공 화면 대신 실패 안내와 재시도 경로를, 성공은 서버 조회 화면을 쓴다', () => {
  assert.match(source, /결제가 완료되지 않았습니다/);
  assert.match(source, /router\.replace\(retryPath\)/);
  // 결제 전 기록은 한 번만 꺼내고, 성공 복귀일 때만 결제한 회차 상품과 checkout_cart를 정리한다.
  assert.match(source, /takePendingOrderPayment\(/);
  const confirmGuard = source.indexOf("resolved.kind === 'confirm'");
  const removal = source.indexOf('removeRoundItems(resolved.roundItemIds)');
  assert.ok(confirmGuard >= 0 && confirmGuard < removal);
  assert.match(source, /removeItem\('checkout_cart'\)/);
  // 복귀 쿼리가 있으면 orderId가 없어도 홈으로 보내지 않는다.
  assert.match(source, /if \(!orderId && !redirectSearch\) router\.replace\('\/'\)/);
});
