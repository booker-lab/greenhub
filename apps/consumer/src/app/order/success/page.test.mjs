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

const cancelReasonSource = await readFile(
  new URL('../../../lib/order-cancel-reason.ts', import.meta.url),
  'utf8',
);
const cancelReasonModule = { exports: {} };
new Function(
  'module',
  'exports',
  ts.transpileModule(cancelReasonSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
)(cancelReasonModule, cancelReasonModule.exports);

const failureMessageSource = await readFile(
  new URL('../../../lib/payment-failure-message.ts', import.meta.url),
  'utf8',
);
const failureMessageModule = { exports: {} };
new Function(
  'module',
  'exports',
  ts.transpileModule(failureMessageSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
)(failureMessageModule, failureMessageModule.exports);

const draftSource = await readFile(
  new URL('../../../lib/payment-checkout-draft.ts', import.meta.url),
  'utf8',
);
const draftModule = { exports: {} };
new Function(
  'module',
  'exports',
  ts.transpileModule(draftSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
)(draftModule, draftModule.exports);

const orderStatusSource = await readFile(
  new URL('../../../lib/order-status.ts', import.meta.url),
  'utf8',
);
const orderStatusModule = { exports: {} };
new Function(
  'module',
  'exports',
  ts.transpileModule(orderStatusSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
)(orderStatusModule, orderStatusModule.exports);

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
  if (specifier === '@/lib/order-cancel-reason') return cancelReasonModule.exports;
  if (specifier === '@/lib/order-status') return orderStatusModule.exports;
  if (specifier === '@/lib/payment-failure-message') return failureMessageModule.exports;
  if (specifier === '@/lib/payment-checkout-draft') return draftModule.exports;
  if (specifier === '@/hooks/useCart') return { useCart: () => ({ removeRoundItems: () => {} }) };
  // 벤치마킹 비교 기능 모듈: 이 테스트에서는 꺼진 상태로 둔다.
  if (specifier === '@/components/benchmark/OrderSuccessGuide') return { default: () => null };
  if (specifier === '@/lib/features') return { isFeatureOn: () => false };
  if (specifier === 'react/jsx-runtime') {
    return { Fragment: Symbol('Fragment'), jsx: () => null, jsxs: () => null };
  }
  if (
    specifier === '@greenhub/ui/components/button' ||
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
  assert.match(source, /공동구매 목표를 달성하면 주문이 확정돼요\./);
});

test('회차 성공 화면은 화요일 오전 9시 문 앞 배송 약속과 서버 상품 요약을 표시한다', () => {
  assert.match(source, /회차 주문번호/);
  assert.match(source, /주문 상품/);
  assert.match(source, /화요일 오전 9시까지 문 앞에 배송해요\./);
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
  assert.match(source, /주문이 접수됐어요/);
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
  assert.match(source, /결제가 완료되지 않았어요/);
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

test('결제 취소 사유는 내부 코드 대신 고객이 읽을 문장으로 보인다', () => {
  assert.match(source, /import \{ formatCancelReason \} from '@\/lib\/order-cancel-reason'/);
  assert.match(
    source,
    /formatCancelReason\(validOrder\.cancelReason\) \?\? '결제를 처리하지 못했어요\.'/,
  );
  assert.doesNotMatch(source, /\? validOrder\.cancelReason/);
});

test('결제 확인 자동 갱신이 멈추면 늦어진다는 안내와 다시 확인 버튼을 보인다', () => {
  assert.match(source, /pollingExpired, refetch \} = useOrderStatus\(/);
  assert.match(source, /isPending && pollingExpired/);
  assert.match(source, /결제 확인이 늦어지고 있어요\. 잠시 후 다시 확인해 주세요\./);
  assert.match(source, /onClick=\{\(\) => void refetch\(\)\}/);
  assert.match(source, /다시 확인/);
});

test('결제 완료 화면은 결제 확인 중이 이어지면 서버 결제 확인을 켠 주문 상태 조회를 쓴다', () => {
  assert.match(
    source,
    /useOrderStatus\(\s*orderId,\s*session\?\.user\?\.accessToken,\s*\{ checkPendingPayment: true \},\s*\)/,
  );
});

test('리다이렉트 결제 실패 문구는 PG 원문 코드 대신 고객 문구로 보인다', () => {
  assert.match(source, /paymentFailureMessage\(paymentFailure\)/);
  assert.doesNotMatch(source, /paymentFailure\.message/);
  const { paymentFailureMessage } = failureMessageModule.exports;
  const failure = parsePaymentRedirectResult(
    new URLSearchParams(
      `paymentId=order-1&code=FAILURE_TYPE_PG&message=${encodeURIComponent(
        '[PAY_PROCESS_CANCELED] 사용자가 결제를 취소하였습니다',
      )}`,
    ),
  );
  assert.equal(failure.kind, 'failure');
  assert.equal(paymentFailureMessage(failure), '결제를 취소했어요. 장바구니는 그대로 남아 있어요.');
});

test('모바일 결제 성공 복귀는 checkout_cart와 함께 체크아웃 입력값을 지운다', () => {
  const confirmGuard = source.indexOf("resolved.kind === 'confirm'");
  const clear = source.indexOf('clearCheckoutDraft(browser?.storage ?? null)');
  assert.ok(confirmGuard >= 0 && confirmGuard < clear);
  const cartRemoval = source.indexOf("removeItem('checkout_cart')");
  assert.ok(cartRemoval < clear);
  assert.equal(source.match(/clearCheckoutDraft\(/g)?.length, 1);
});

test('주문 완료 화면은 공용 주문 상태 이름표를 써서 ACCEPTED를 MY·알림과 같은 결제 완료로 부른다', () => {
  const { ORDER_STATUS_LABELS } = orderStatusModule.exports;
  assert.equal(ORDER_STATUS_LABELS.ACCEPTED, '결제 완료');
  assert.match(source, /import \{ ORDER_STATUS_LABELS \} from '@\/lib\/order-status'/);
  assert.match(source, /\{ORDER_STATUS_LABELS\[validOrder\.status\]\}/);
  assert.match(
    source,
    /현재 상태: \{ORDER_STATUS_LABELS\[validOrder\.status\] \?\? '주문 진행 중'\}/,
  );
  // 화면 안에 따로 상태 이름표를 두지 않아 '주문 접수 완료' 같은 다른 이름이 다시 생기지 않는다.
  assert.doesNotMatch(source, /Partial<Record<OrderStatus, string>>\s*=\s*\{/);
  assert.doesNotMatch(source, /ACCEPTED:\s*'/);
  assert.doesNotMatch(source, /주문 접수 완료/);
});

// 화면에 보이는 글자(문자열·템플릿 리터럴, JSX 글자)를 모은다. 주석은 AST에 없으므로 빠지고,
// API 응답 원문은 리터럴이 아니므로 검사 대상이 아니다(주문 상세 _client.test.mjs와 같은 방식).
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

test('주문 완료 화면 문구는 해요체로 통일하고 합니다체·내부 용어가 다시 들어오지 않는다', () => {
  const strings = collectScreenStrings(source, 'page.tsx');
  // 수집이 실제로 동작하는지 확인한다(해요체 제목·안내가 잡혀야 한다).
  assert.ok(strings.includes('주문이 완료됐어요'));
  assert.ok(strings.includes('결제가 취소됐어요'));
  assert.ok(strings.includes('주문 정보를 확인할 수 없어요'));
  assert.ok(
    strings.includes('결제 결과를 확인하지 못했어요. 주문 내역에서 결제 상태를 확인해 주세요.'),
  );
  assert.ok(strings.includes('올바른 주문번호가 필요해요.'));
  assert.ok(strings.includes('주문 정보를 확인하지 못했어요. 주문 내역에서 다시 확인해 주세요.'));
  assert.deepEqual(
    strings.filter((value) => /니다|니까|십시오|서버/.test(value)),
    [],
  );
  // '주문 응답'처럼 내부 동작을 가리키는 말 대신 고객이 아는 '주문 정보'로 말한다.
  assert.doesNotMatch(source, /주문 응답/);
  // 오류 제목과 훅의 일시 실패 문구('주문 정보를 불러오지 못했어요…')가 같은 말을 반복하지 않는다.
  assert.doesNotMatch(source, /주문 정보를 불러올 수 없/);
});
