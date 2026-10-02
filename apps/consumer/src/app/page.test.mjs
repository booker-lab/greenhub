import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(testDirectory, 'page.tsx'), 'utf8');

test('홈 화면이 사업자 footer를 가져와 상품 목록 다음에 렌더링한다', () => {
  assert.match(pageSource, /import BusinessInfoFooter from '@\/components\/BusinessInfoFooter';/);

  const productListIndex = pageSource.indexOf('<HomeProductList');
  const footerIndex = pageSource.indexOf('<BusinessInfoFooter />');

  assert.notEqual(productListIndex, -1);
  assert.notEqual(footerIndex, -1);
  assert.ok(footerIndex > productListIndex);
});

// 디자인 기준(docs/specs/frontend/design-standard.md §5): 머리띠 → 마감 띠 → 배너 → 상품.
// 사업자 관계 안내(카카오 채널 승인 증빙)는 홈에 계속 두되 상품 목록과 footer 사이로 옮겼다.
test('배너는 상품 목록 위에, 운영 관계 안내는 상품 목록과 footer 사이에 렌더링한다', () => {
  assert.match(
    pageSource,
    /import BusinessRelationshipNotice from '@\/components\/BusinessRelationshipNotice';/,
  );
  assert.match(pageSource, /<HomeProductList banner=\{<HeroBanner \/>\} \/>/);

  const headerIndex = pageSource.indexOf('<HomeHeader />');
  const productListIndex = pageSource.indexOf('<HomeProductList');
  const noticeIndex = pageSource.indexOf('<BusinessRelationshipNotice />');
  const footerIndex = pageSource.indexOf('<BusinessInfoFooter />');

  assert.notEqual(headerIndex, -1);
  assert.notEqual(noticeIndex, -1);
  assert.ok(headerIndex < productListIndex);
  assert.ok(noticeIndex > productListIndex);
  assert.ok(noticeIndex < footerIndex);
});

test('고정 하단 navigation 위에서 footer 마지막 줄까지 접근할 여백을 둔다', () => {
  assert.match(pageSource, /<Container[^>]*pb=\{96\}/);
});
