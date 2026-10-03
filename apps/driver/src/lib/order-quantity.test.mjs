import assert from 'node:assert/strict';
import test from 'node:test';
import { orderItemsLabel } from './order-quantity.ts';

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
