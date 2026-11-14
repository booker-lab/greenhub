import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./_client.tsx', import.meta.url), 'utf8');
const statusLabelSource = await readFile(
  new URL('../../lib/order-status.ts', import.meta.url),
  'utf8',
);
const transpileForTest = (code, fileName) =>
  ts.transpileModule(code, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName,
  }).outputText;
// 주문 상태 이름표는 실제 공용 표(@/lib/order-status)를 읽어 목록 판정에 쓴다.
const statusLabelModule = { exports: {} };
new Function(
  'require',
  'module',
  'exports',
  transpileForTest(statusLabelSource, 'order-status.ts'),
)(
  () => {
    throw new Error('예상하지 못한 주문 상태 이름표 모듈 요청');
  },
  statusLabelModule,
  statusLabelModule.exports,
);
const testableSource = `${source}
export { readOrderListSummary };`;
const compiled = transpileForTest(testableSource, '_client.tsx');

const clientModule = { exports: {} };
const requireForTest = (specifier) => {
  if (specifier === 'react') {
    return { useEffect: () => {} };
  }
  if (specifier === 'react/jsx-runtime') {
    return { Fragment: Symbol('Fragment'), jsx: () => null, jsxs: () => null };
  }
  if (
    specifier === '@greenhub/ui/components/button' ||
    specifier === '@greenhub/ui/components/status-dot' ||
    specifier === 'lucide-react' ||
    specifier === 'next-auth/react' ||
    specifier === 'next/navigation' ||
    specifier === 'next/link' ||
    specifier === '@/hooks/useOrders' ||
    specifier === '@/components/A2HSButton' ||
    specifier === '@/components/ResilientImage' ||
    specifier === '@/lib/publicBusinessInfo'
  ) {
    return {};
  }
  // 벤치마킹 비교 기능 토글: 이 테스트에서는 꺼진 상태로 둔다.
  if (specifier === '@/lib/features') return { isFeatureOn: () => false };
  if (specifier === '@/lib/order-status') return statusLabelModule.exports;
  // 결제 확인 중 카드 설명(lib/order-pending-payment.ts, 자체 테스트가 따로 있다).
  if (specifier === '@/lib/order-pending-payment') {
    return { orderListPendingPaymentNotice: () => null };
  }
  // 주문 카드 첫 줄·주문한 날 라벨(lib/order-card-line.ts, 자체 테스트가 따로 있다).
  if (specifier === '@/lib/order-card-line') {
    return { orderCardHeadline: () => null, orderCardOrderedLabel: () => null };
  }
  // 비로그인 복귀 주소 함수(mypage/_login.ts, 자체 테스트가 따로 있다).
  if (specifier === './_login') return { currentMyPageLoginUrl: () => '/login' };
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
    representativeImageUrl: null,
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
      representativeImageUrl: null,
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
  assert.equal(statusLabelModule.exports.ORDER_STATUS_LABELS.DELIVERY_HELD, '배송 보류');
  assert.match(source, /from '@\/lib\/order-status'/);
  assert.match(source, /summary\.representativeName/);
  assert.match(source, /summary\.additionalProductCount/);
  assert.match(source, /summary\.productCount/);
  assert.match(source, /summary\.totalQuantity/);
});

test('MY 내 정보는 알림 내역은 제공하지만 파일럿 마케팅 설정 진입은 제공하지 않는다', () => {
  assert.match(source, /router\.push\('\/mypage\/notifications'\)/);
  assert.match(source, />\s*알림 내역\s*<\/p>/s);
  assert.doesNotMatch(source, /router\.push\('\/mypage\/notifications\/settings'\)/);
  assert.doesNotMatch(source, /마케팅 알림 설정/);
});

test('대표(첫) 상품의 주문 시점 사진 주소를 썸네일로 쓴다', () => {
  const withImages = {
    ...multiItemOrder,
    orderItems: multiItemOrder.orderItems.map((item, index) => ({
      ...item,
      productImageUrl:
        index === 0 ? 'https://example.test/first.jpg' : 'https://example.test/second.jpg',
    })),
  };
  assert.equal(
    readOrderListSummary(withImages)?.representativeImageUrl,
    'https://example.test/first.jpg',
  );

  const blankFirst = {
    ...multiItemOrder,
    orderItems: multiItemOrder.orderItems.map((item, index) => ({
      ...item,
      productImageUrl: index === 0 ? '   ' : 'https://example.test/second.jpg',
    })),
  };
  assert.equal(readOrderListSummary(blankFirst)?.representativeImageUrl, null);
});

test('MY 내 정보에 공개 사업자 정보의 고객센터 전화 연결을 둔다', () => {
  assert.match(source, /import \{ PUBLIC_BUSINESS_INFO \} from '@\/lib\/publicBusinessInfo'/);
  assert.match(source, /<SupportCallLink \/>/);
  assert.match(source, /href=\{PUBLIC_BUSINESS_INFO\.phoneHref\}/);
  assert.match(source, /고객센터 전화 \{PUBLIC_BUSINESS_INFO\.phone\}/);
  assert.match(source, /상담 시간 \{PUBLIC_BUSINESS_INFO\.supportHours\}/);
  // 번호를 화면 코드에 직접 적지 않는다.
  assert.doesNotMatch(source, /tel:\d|010-\d{4}-\d{4}/);
});

test('앱 설치 제목은 설치 버튼이 그려질 때만 보인다', () => {
  const start = source.indexOf('data-testid="mypage-install"');
  assert.ok(start > 0);
  const section = source.slice(source.lastIndexOf('<div', start), source.indexOf('</div>', start));
  // 버튼이 없으면 묶음(제목 포함)을 숨기고, 버튼이 있을 때만 보인다.
  assert.match(section, /className="hidden has-\[button\]:block"/);
  assert.match(section, />\s*앱 설치\s*<\/h2>/);
  assert.match(section, /<A2HSButton \/>/);
});

test('주문이 없으면 안내와 함께 이번 회차(홈)로 가는 버튼을 준다', () => {
  const start = source.indexOf('{!loading && !error && orders.length === 0 && (');
  assert.ok(start > 0);
  const empty = source.slice(start, source.indexOf(')}', start));
  assert.match(empty, /아직 주문한 꽃이 없어요\./);
  assert.match(
    empty,
    /<ButtonLink render=\{<Link href="\/" \/>\}>이번 회차 보러 가기<\/ButtonLink>/,
  );
  assert.doesNotMatch(source, /주문 내역이 없습니다/);
});

test('결제 확인 중 주문 카드는 공용 판단 함수로 자동 취소 설명 한 줄을 붙인다', () => {
  assert.match(
    source,
    /import \{ orderListPendingPaymentNotice \} from '@\/lib\/order-pending-payment'/,
  );
  assert.match(source, /const pendingNotice = orderListPendingPaymentNotice\(order\.status\)/);
  const start = source.indexOf('data-testid="order-card-pending-notice"');
  assert.ok(start > 0);
  const notice = source.slice(source.lastIndexOf('{pendingNotice && (', start), source.indexOf(')}', start));
  assert.match(notice, /\{pendingNotice\}/);
  // 목록에서 숨기지 않는다: 카드 목록은 주문 상태로 거르지 않는다.
  assert.match(source, /\{orders\.map\(\(order\) => \(/);
  assert.doesNotMatch(source, /orders\.filter\(/);
});

test('주문 카드 첫 줄과 오른쪽 위 날짜는 공용 판단 함수가 고르고, 값이 없으면 줄을 그리지 않는다', () => {
  assert.match(
    source,
    /import \{ orderCardHeadline, orderCardOrderedLabel \} from '@\/lib\/order-card-line'/,
  );
  assert.match(source, /const headline = orderCardHeadline\(order\)/);
  assert.match(source, /const orderedLabel = orderCardOrderedLabel\(order\.createdAt\)/);
  // 취소 주문(첫 줄 숨김)·읽을 수 없는 주문 날짜에서 빈 줄을 남기지 않는다.
  assert.match(source, /\{headline && \(\s*<p[\s\S]*?\{headline\}\s*<\/p>\s*\)\}/);
  assert.match(source, /\{orderedLabel && \(\s*<p[\s\S]*?\{orderedLabel\}\s*<\/p>\s*\)\}/);
  // 라벨 없는 날짜와 화면 안 수령 방식 분기를 다시 두지 않는다.
  assert.doesNotMatch(source, /formatDate\(/);
  assert.doesNotMatch(source, /'직배송'|'택배'|'거점 픽업'/);
});
