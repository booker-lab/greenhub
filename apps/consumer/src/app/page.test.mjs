import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(testDirectory, 'page.tsx'), 'utf8');

test('홈 화면이 사업자 footer를 가져와 상품 목록 다음에 렌더링한다', () => {
  assert.match(pageSource, /import BusinessInfoFooter from '@\/components\/BusinessInfoFooter';/);

  const productListIndex = pageSource.indexOf('<HomeProductList />');
  const footerIndex = pageSource.indexOf('<BusinessInfoFooter />');

  assert.notEqual(productListIndex, -1);
  assert.notEqual(footerIndex, -1);
  assert.ok(footerIndex > productListIndex);
});

test('운영 관계 안내를 배너 다음과 상품 목록 앞에 렌더링한다', () => {
  assert.match(
    pageSource,
    /import BusinessRelationshipNotice from '@\/components\/BusinessRelationshipNotice';/,
  );

  const bannerIndex = pageSource.indexOf('<HeroBanner />');
  const noticeIndex = pageSource.indexOf('<BusinessRelationshipNotice />');
  const productListIndex = pageSource.indexOf('<HomeProductList />');

  assert.notEqual(bannerIndex, -1);
  assert.notEqual(noticeIndex, -1);
  assert.notEqual(productListIndex, -1);
  assert.ok(noticeIndex > bannerIndex);
  assert.ok(noticeIndex < productListIndex);
});

test('고정 하단 navigation 위에서 footer 마지막 줄까지 접근할 여백을 둔다', () => {
  assert.match(pageSource, /<Container[^>]*pb=\{96\}/);
});
