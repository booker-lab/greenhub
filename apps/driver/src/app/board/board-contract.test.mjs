import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const boardSource = await readFile(new URL('./_client.tsx', import.meta.url), 'utf8');
const cardSource = await readFile(new URL('../../components/OrderCard.tsx', import.meta.url), 'utf8');
const detailSource = await readFile(new URL('./[orderId]/page.tsx', import.meta.url), 'utf8');
const photoSource = await readFile(new URL('./[orderId]/photo/page.tsx', import.meta.url), 'utf8');

test('수거 대기 보드는 PREPARING의 direct와 hub만 조회하고 parcel은 제외한다', () => {
  assert.match(boardSource, /where\(\s*['"]status['"]\s*,\s*['"]==['"]\s*,\s*['"]PREPARING['"]\s*\)/);
  assert.match(
    boardSource,
    /where\(\s*['"]deliveryMethod['"]\s*,\s*['"]in['"]\s*,\s*\[\s*['"]direct['"]\s*,\s*['"]hub['"]\s*\]\s*\)/,
  );
  assert.match(boardSource, /where\(\s*['"]driverId['"]\s*,\s*['"]==['"]\s*,\s*null\s*\)/);
  assert.doesNotMatch(
    boardSource,
    /where\(\s*['"]deliveryMethod['"]\s*,\s*['"]==['"]\s*,\s*['"]direct['"]\s*\)/,
  );
  assert.doesNotMatch(boardSource, /['"]parcel['"]/);
});

test('담당 기사 ID가 있을 때만 배송 중·보류 주문을 함께 구독한다', () => {
  assert.match(boardSource, /if\s*\(\s*!driverId\s*\)/);
  assert.match(
    boardSource,
    /where\(\s*['"]status['"]\s*,\s*['"]in['"]\s*,\s*\[\s*['"]DELIVERING['"]\s*,\s*['"]DELIVERY_HELD['"]\s*\]\s*\)/,
  );
  assert.match(boardSource, /where\(\s*['"]driverId['"]\s*,\s*['"]==['"]\s*,\s*driverId\s*\)/);
  assert.doesNotMatch(
    boardSource,
    /:\s*\[\s*where\(\s*['"]status['"]\s*,\s*['"]==['"]\s*,\s*['"]DELIVERING['"]/,
  );
});

test('주문 카드는 안정적인 test id와 배송 보류 상태 배지를 제공한다', () => {
  assert.match(cardSource, /data-testid=\{`driver-order-\$\{order\.id\}`\}/);
  assert.match(cardSource, /order\.status\s*===\s*['"]DELIVERY_HELD['"]/);
  assert.match(cardSource, />\s*배송 보류\s*</);
});

test('보류 주문 상세은 검증된 상태 API로 배송을 재개한다', () => {
  assert.match(detailSource, /isHeld[\s\S]*updateStatus\(['"]DELIVERING['"]\)/);
  assert.match(detailSource, />\s*배송 재개\s*</);
  assert.match(detailSource, /result\.orderId\s*!==\s*orderId\s*\|\|\s*result\.status\s*!==\s*status/);
  assert.match(detailSource, /배송 완료 사진 촬영/);
});

test('사진 화면은 heading과 촬영·최종 완료 버튼의 접근 가능한 이름을 제공한다', () => {
  assert.match(photoSource, /<Title[^>]*order=\{1\}[^>]*>/);
  assert.match(photoSource, /배송 완료 사진/);
  assert.match(photoSource, /aria-label=['"]사진 촬영['"]/);
  assert.match(photoSource, />\s*사진 촬영\s*</);
  assert.match(photoSource, /['"]사진을 등록하고 배송 완료['"]/);
  assert.match(photoSource, /disabled=\{[^}]*!captured/);
});
