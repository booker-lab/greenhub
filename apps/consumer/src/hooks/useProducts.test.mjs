import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./useProducts.ts', import.meta.url)), 'utf8');

test('소비자 상품 조회 훅은 shared SaleType을 사용한다', () => {
  assert.match(source, /SaleType/);
  assert.match(source, /saleType\?: SaleType/);
  assert.doesNotMatch(source, /saleType\?: ['"]group['"] \| ['"]direct['"]/);
});
