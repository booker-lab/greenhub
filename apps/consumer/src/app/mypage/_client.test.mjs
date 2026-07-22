import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./_client.tsx', import.meta.url), 'utf8');
const testableSource = `${source}
export { readOrderListSummary };`;
const compiled = ts.transpileModule(testableSource, {
  compilerOptions: {
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: '_client.tsx',
}).outputText;

const clientModule = { exports: {} };
const requireForTest = (specifier) => {
  if (specifier === 'react') {
    return { useEffect: () => {} };
  }
  if (specifier === 'react/jsx-runtime') {
    return { Fragment: Symbol('Fragment'), jsx: () => null, jsxs: () => null };
  }
  if (
    specifier === '@mantine/core' ||
    specifier === 'next-auth/react' ||
    specifier === 'next/navigation' ||
    specifier === '@/hooks/useOrders' ||
    specifier === '@/components/A2HSButton'
  ) {
    return {};
  }
  throw new Error(`예상하지 못한 MY 주문 목록 모듈 요청: ${specifier}`);
};
new Function('require', 'module', 'exports', compiled)(
  requireForTest,
  clientModule,
  clientModule.exports,
);

const { readOrderListSummary } = clientModule.exports;

const multiItemOrder = {
  id: 'round-order-1',
  schemaVersion: 2,
  roundId: 'round-1',
  status: 'ACCEPTED',
  quantity: 3,
  productName: '클라이언트 임의 대표명',
  orderItems: [
    {
      roundItemId: 'round-item-1',
      productId: 'product-1',
      productName: '호접란 하나',
      quantity: 2,
    },
    {
      roundItemId: 'round-item-2',
      productId: 'product-2',
      productName: '호접란 둘',
      quantity: 1,
    },
  ],
};

test('서버가 정규화한 다중 orderItems로 대표명과 상품 수를 만든다', () => {
  assert.deepEqual(readOrderListSummary(multiItemOrder), {
    representativeName: '호접란 하나',
    additionalProductCount: 1,
    productCount: 2,
    totalQuantity: 3,
  });
});

test('서버가 정규화한 단일 legacy orderItems 계약을 보존한다', () => {
  assert.deepEqual(
    readOrderListSummary({
      id: 'legacy-order-1',
      status: 'DELIVERED',
      quantity: 2,
      productName: '과거 저장 필드',
      orderItems: [
        {
          productId: 'legacy-product-1',
          productName: '레거시 호접란',
          quantity: 2,
        },
      ],
    }),
    {
      representativeName: '레거시 호접란',
      additionalProductCount: 0,
      productCount: 1,
      totalQuantity: 2,
    },
  );
});

test('손상된 orderItems나 주문 최상위 상품명을 대표명으로 승격하지 않는다', () => {
  const invalidOrders = [
    null,
    { ...multiItemOrder, id: '' },
    { ...multiItemOrder, status: 'UNKNOWN' },
    { ...multiItemOrder, orderItems: [] },
    { ...multiItemOrder, orderItems: null },
    {
      ...multiItemOrder,
      orderItems: [{ ...multiItemOrder.orderItems[0], productName: '   ' }],
    },
    {
      ...multiItemOrder,
      orderItems: [{ ...multiItemOrder.orderItems[0], quantity: 0 }],
    },
    {
      ...multiItemOrder,
      orderItems: [
        multiItemOrder.orderItems[0],
        { ...multiItemOrder.orderItems[1], roundItemId: 'round-item-1' },
      ],
    },
  ];

  for (const order of invalidOrders) {
    assert.equal(readOrderListSummary(order), null);
  }
});

test('배송 보류 상태와 서버 상품 요약을 주문 카드에 명확히 표시한다', () => {
  assert.match(source, /DELIVERY_HELD:\s*'배송 보류'/);
  assert.match(source, /summary\.representativeName/);
  assert.match(source, /summary\.additionalProductCount/);
  assert.match(source, /summary\.productCount/);
  assert.match(source, /summary\.totalQuantity/);
});

test('MY 내 정보는 알림 내역과 별도로 마케팅 알림 설정 진입을 제공한다', () => {
  assert.match(source, /router\.push\('\/mypage\/notifications'\)/);
  assert.match(source, />\s*알림 내역\s*<\/Text>/s);
  assert.match(source, /router\.push\('\/mypage\/notifications\/settings'\)/);
  assert.match(source, />\s*마케팅 알림 설정\s*<\/Text>/s);
});
