import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const actionsSource = await readFile(new URL('./ProductActions.tsx', import.meta.url), 'utf8');
const roundSource = await readFile(
  new URL('./RoundDirectProductActions.tsx', import.meta.url),
  'utf8',
);
const legacySource = await readFile(new URL('./LegacyProductActions.tsx', import.meta.url), 'utf8');
const ctaSource = await readFile(
  new URL('../../../../components/ProductCTABar.tsx', import.meta.url),
  'utf8',
);
const pageSource = await readFile(new URL('../page.tsx', import.meta.url), 'utf8');

test('상품 상세은 검증한 회차 구매 계약을 ProductActions에 전달하고 legacy 호출을 보존한다', () => {
  assert.match(
    pageSource,
    /<ProductActions\s+product=\{product\}\s+roundProduct=\{roundProduct\}\s+\/>/s,
  );
  assert.match(pageSource, /<ProductActions product=\{product\} \/>/);
  assert.doesNotMatch(actionsSource, /useSaleRounds/);
});

test('round_direct와 legacy 구매 동작은 명시적인 별도 구성요소로 분리한다', () => {
  assert.match(actionsSource, /roundProduct \?/);
  assert.match(actionsSource, /<RoundDirectProductActions/);
  assert.match(actionsSource, /<LegacyProductActions/);
  assert.match(roundSource, /function RoundDirectProductActions/);
  assert.match(legacySource, /function LegacyProductActions/);
  assert.match(legacySource, /DeliveryDatePicker/);
  assert.match(legacySource, /useGroupProduct/);
  assert.match(legacySource, /\['direct', 'hub', 'parcel'\]/);
});

test('round_direct는 회차 가격과 직배송만 사용하고 legacy 선택 UI를 렌더링하지 않는다', () => {
  assert.match(roundSource, /roundProduct\.item\.roundPrice/);
  assert.match(roundSource, /deliveryMethod: 'direct'/);
  assert.doesNotMatch(roundSource, /deliveryLabels|DeliveryDatePicker|useGroupProduct/);
  assert.doesNotMatch(roundSource, /groupConsent|공동구매|택배|거점 픽업|배송 희망일/);
});

test('round_direct는 isPurchasable이 거짓이면 두 구매 동작을 모두 비활성화한다', () => {
  assert.match(roundSource, /canBuy=\{roundProduct\.isPurchasable\}/);
  assert.match(roundSource, /canAddToCart=\{roundProduct\.isPurchasable\}/);
  assert.match(roundSource, /addToCartLabel="장바구니 담기"/);
  assert.match(roundSource, /buyNowLabel="바로 구매"/);
  assert.match(ctaSource, /disabled=\{!canAddToCart\}/);
  assert.match(ctaSource, /disabled=\{!canBuy\}/);
});

test('round_direct는 검증된 회차 장바구니 계약만 저장하고 후속 결제 계약은 선행하지 않는다', () => {
  assert.match(roundSource, /roundId:\s*roundProduct\.item\.roundId/);
  assert.match(roundSource, /roundItemId:\s*roundProduct\.item\.id/);
  assert.match(roundSource, /roundPrice:\s*roundProduct\.item\.roundPrice/);
  assert.match(roundSource, /if \(!result\.ok\)/);
  assert.match(roundSource, /result\.reason === 'different_round'/);
  assert.doesNotMatch(roundSource, /schemaVersion\s*:/);
  assert.doesNotMatch(roundSource, /acquisition\s*:/);
});
