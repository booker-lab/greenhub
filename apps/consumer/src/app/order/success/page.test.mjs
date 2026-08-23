import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');
const testableSource = `${source}
export { parseOrderId, readSuccessOrder };`;
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
    };
  }
  if (specifier === 'react/jsx-runtime') {
    return { Fragment: Symbol('Fragment'), jsx: () => null, jsxs: () => null };
  }
  if (
    specifier === '@mantine/core' ||
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

const { parseOrderId, readSuccessOrder } = pageModule.exports;

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
