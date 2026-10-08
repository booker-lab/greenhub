import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const componentDirectory = dirname(fileURLToPath(import.meta.url));
const source = (relativePath) => readFileSync(join(componentDirectory, relativePath), 'utf8');

const homeSource = source('HomeProductList.tsx');
const groupPageSource = source('../app/groupbuy/page.tsx');
const productCardSource = source('ProductCard.tsx');
const actionsSource = source('../app/products/[id]/_components/LegacyProductActions.tsx');
const ctaSource = source('ProductCTABar.tsx');

test('홈과 공동구매 목록은 공통 상태가 open인 상품만 진행 중으로 분류한다', () => {
  assert.match(homeSource, /getGroupBuyStatus\(product\.groupSummary\) === 'open'/);
  assert.match(groupPageSource, /getGroupBuyStatus\(product\.groupSummary, now\) === 'open'/);
  assert.match(
    groupPageSource,
    /현재 \{loading \? '\.\.\.' : `\$\{active\.length\}개`\} 공구 진행 중/,
  );
});

test('상품 카드는 모집기한 마감 상태를 모집 중과 구분한다', () => {
  assert.match(productCardSource, /status === 'expired'/);
  assert.match(productCardSource, /'모집 마감'/);
});

test('만료되거나 설정이 없는 공동구매는 장바구니와 결제 동선을 모두 차단한다', () => {
  // bf1f0f50 이후 조회 중·조회 실패도 함께 차단하지만, open이 아닌 상태(만료·설정 없음)
  // 차단은 그대로 판정식 안에 있어야 한다.
  assert.match(
    actionsSource,
    /isGroupUnavailable\s*=\s*isGroup && \([^)]*groupStatus !== 'open'\)/,
  );
  // 장바구니 담기·바로 결제 두 핸들러 모두 isGroupUnavailable이면 진행하지 않는다.
  assert.equal(
    actionsSource.match(/if \(isGroupUnavailable(?: \|\| [A-Za-z]+)*\) return;/g)?.length,
    2,
  );
  assert.match(ctaSource, /canAddToCart = !\(isGroup && isUnavailable\)/);
  assert.match(ctaSource, /disabled=\{!canAddToCart\}/);
  assert.match(ctaSource, /disabled=\{!canBuy\}/);
});
