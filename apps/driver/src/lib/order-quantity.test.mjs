import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { orderItemLines, orderItemsLabel, orderItemsSummary } from './order-quantity.ts';

const cardSource = await readFile(new URL('../components/OrderCard.tsx', import.meta.url), 'utf8');
const detailSource = await readFile(
  new URL('../app/board/[orderId]/page.tsx', import.meta.url),
  'utf8',
);

test('수량이 1개면 상품 이름만, 2개 이상이면 총 개수를 붙인다', () => {
  assert.equal(orderItemsLabel('동양란 빅립', 1), '동양란 빅립');
  assert.equal(orderItemsLabel('동양란 만천홍', 2), '동양란 만천홍 · 총 2개');
});

test('"외 N건"처럼 상품 종류 수로 오해할 표기를 쓰지 않는다', () => {
  assert.doesNotMatch(orderItemsLabel('동양란 만천홍', 3), /외|×/);
});

test('이름·수량이 비었거나 잘못되면 안전하게 보인다', () => {
  assert.equal(orderItemsLabel(null, 2), '- · 총 2개');
  assert.equal(orderItemsLabel('  ', undefined), '-');
  assert.equal(orderItemsLabel('동양란 v3', Number.NaN), '동양란 v3');
});

test('상품 목록이 있으면 상품마다 한 줄로 이름과 개수를 보인다', () => {
  assert.deepEqual(
    orderItemLines([
      { productName: '동양란 만천홍', quantity: 2 },
      { productName: ' 호접란 ', quantity: 1 },
    ]),
    ['동양란 만천홍 · 2개', '호접란 · 1개'],
  );
  // 가격 등 다른 필드가 섞여 와도 이름·개수만 보인다.
  assert.deepEqual(orderItemLines([{ productName: '산세베리아', quantity: 3, unitPrice: 9000 }]), [
    '산세베리아 · 3개',
  ]);
  for (const line of orderItemLines([{ productName: '동양란', quantity: 4 }])) {
    assert.doesNotMatch(line, /외|×|원/);
  }
});

test('상품 목록이 없거나 하나라도 어긋나면 기존 한 줄 표기로 대신하도록 null이다', () => {
  for (const items of [
    undefined,
    null,
    [],
    'items',
    [{ productName: '동양란', quantity: 0 }],
    [{ productName: '동양란', quantity: 1.5 }],
    [{ productName: '동양란', quantity: '2' }],
    [{ productName: '  ', quantity: 1 }],
    [{ quantity: 1 }],
    [{ productName: '동양란', quantity: 1 }, null],
  ]) {
    assert.equal(orderItemLines(items), null, JSON.stringify(items));
  }
});

test('목록 카드와 상세는 상품 줄을 우선하고 없으면 기존 표기를 쓴다', () => {
  for (const source of [cardSource, detailSource]) {
    assert.match(source, /const itemLines = orderItemLines\(order\.items\)/);
    assert.match(source, /orderItemsLabel\(order\.productName, order\.quantity\)/);
  }
  assert.match(cardSource, /itemLines\s*\?\s*itemLines\.map\(/);
  assert.match(
    detailSource,
    /itemLines \? \(\s*<ItemLines lines=\{itemLines\} \/>/,
  );
});

test('목록 행 상품 요약은 한 종이면 개수, 여러 종이면 "외 N종 · 총 M개"로 줄인다', () => {
  assert.equal(orderItemsSummary([{ productName: '산세베리아', quantity: 3 }]), '산세베리아 · 3개');
  assert.equal(
    orderItemsSummary([
      { productName: 'E2E 호접란', quantity: 1 },
      { productName: 'E2E 미니 호접란', quantity: 1 },
    ]),
    'E2E 호접란 외 1종 · 총 2개',
  );
  assert.equal(
    orderItemsSummary([
      { productName: '동양란', quantity: 2 },
      { productName: '호접란', quantity: 1 },
      { productName: '난초', quantity: 4 },
    ]),
    '동양란 외 2종 · 총 7개',
  );
  assert.equal(orderItemsSummary(undefined), null);
  assert.equal(orderItemsSummary([{ productName: '', quantity: 1 }]), null);
});

test('목록 행은 상품 요약과 수거 시각을 둘째 줄과 따로 셋째 줄에 둔다', () => {
  assert.match(cardSource, /orderItemsSummary\(order\.items\) \?\? itemsText/);
  assert.match(cardSource, /className="shrink-0"/);
  assert.doesNotMatch(cardSource, /const second = \[/);
});
