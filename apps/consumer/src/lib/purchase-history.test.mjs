import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('./purchase-history.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled)(() => ({}), mod, mod.exports);
const { collectPurchaseHistory, PURCHASED_ORDER_STATUSES } = mod.exports;

const readTime = (value) =>
  typeof value === 'string' && value ? new Date(value).getTime() : Number.NaN;

function item(productId, productName, extra = {}) {
  return {
    roundItemId: `${productId}-ri`,
    productId,
    productName,
    productImageUrl: null,
    quantity: 1,
    ...extra,
  };
}

function order(id, status, createdAt, items) {
  return { id, status, createdAt, orderItems: items };
}

test('빈 목록이면 빈 배열', () => {
  assert.deepEqual(collectPurchaseHistory([], readTime), []);
});

test('취소·결제 전·모르는 상태 주문은 빼고 결제 뒤 상태만 센다', () => {
  const orders = [
    order('o1', 'CANCELLED', '2026-10-01T00:00:00Z', [item('p-cancel', '취소')]),
    order('o2', 'PENDING', '2026-10-02T00:00:00Z', [item('p-pending', '결제 전')]),
    order('o3', 'UNKNOWN', '2026-10-03T00:00:00Z', [item('p-unknown', '모름')]),
    order('o4', 'RECRUITING', '2026-10-04T00:00:00Z', [item('p-group', '공동구매')]),
    order('o5', 'DELIVERED', '2026-10-05T00:00:00Z', [item('p-done', '배송 완료')]),
    order('o6', 'REVIEWED', '2026-10-06T00:00:00Z', [item('p-reviewed', '구매 확정')]),
  ];
  const ids = collectPurchaseHistory(orders, readTime).map((e) => e.productId);
  assert.deepEqual(ids, ['p-reviewed', 'p-done', 'p-group']);
  assert.equal(PURCHASED_ORDER_STATUSES.has('CANCELLED'), false);
  assert.equal(PURCHASED_ORDER_STATUSES.has('PENDING'), false);
});

test('같은 상품은 하나로 합치고 주문 건수를 센다(수량 합이 아니다)', () => {
  const orders = [
    order('o1', 'ACCEPTED', '2026-10-02T00:00:00Z', [
      item('p1', '빅립 새 이름', { quantity: 3 }),
      item('p2', '만천홍'),
    ]),
    order('o2', 'DELIVERED', '2026-09-20T00:00:00Z', [item('p1', '빅립 옛 이름', { quantity: 5 })]),
    // 한 주문에 같은 상품이 두 줄이어도 한 번만 센다.
    order('o3', 'DELIVERED', '2026-09-10T00:00:00Z', [
      item('p1', '빅립', { roundItemId: 'a' }),
      item('p1', '빅립', { roundItemId: 'b' }),
    ]),
  ];
  const result = collectPurchaseHistory(orders, readTime);
  assert.equal(result.length, 2);
  const p1 = result.find((e) => e.productId === 'p1');
  assert.equal(p1.orderCount, 3);
  assert.equal(p1.productName, '빅립 새 이름');
  assert.equal(p1.lastPurchasedAt, new Date('2026-10-02T00:00:00Z').getTime());
});

test('마지막 구매일이 최근인 상품이 먼저 오고, 시각을 읽을 수 없으면 맨 뒤', () => {
  const orders = [
    order('o1', 'DELIVERED', '2026-09-01T00:00:00Z', [item('old', '오래된 꽃')]),
    order('o2', 'DELIVERED', '', [item('nodate', '날짜 없음')]),
    order('o3', 'DELIVERING', '2026-10-10T00:00:00Z', [item('new', '최근 꽃')]),
    order('o4', 'DELIVERED', '2026-08-01T00:00:00Z', [item('mid', '중간 꽃')]),
    order('o5', 'DELIVERED', '2026-09-15T00:00:00Z', [item('mid', '중간 꽃')]),
  ];
  const result = collectPurchaseHistory(orders, readTime);
  assert.deepEqual(
    result.map((e) => e.productId),
    ['new', 'mid', 'old', 'nodate'],
  );
  assert.equal(result.at(-1).lastPurchasedAt, null);
});

test('orderItems가 없는 옛 주문은 최상위 상품으로 센다', () => {
  const legacy = {
    id: 'l1',
    status: 'DELIVERED',
    createdAt: '2026-07-01T00:00:00Z',
    productId: 'p9',
    productName: '옛 난',
  };
  const result = collectPurchaseHistory([legacy, null, 'x'], readTime);
  assert.deepEqual(result, [
    {
      productId: 'p9',
      productName: '옛 난',
      productImageUrl: null,
      lastPurchasedAt: new Date('2026-07-01T00:00:00Z').getTime(),
      orderCount: 1,
    },
  ]);
});
