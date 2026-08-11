import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(testDirectory, 'seed-e2e-orders.mjs'), 'utf8');

test('두 E2E 상품에 공개 제외용 testOnly 표식을 강제한다', () => {
  const markers = source.match(/testOnly: true/g) ?? [];
  assert.equal(markers.length, 2);
});

test('소비자 배송 슬롯 시드가 시험용 상품의 상점을 선택하지 않는다', () => {
  assert.match(source, /find\(\(product\) => product\.data\(\)\.testOnly !== true\)/);
});
