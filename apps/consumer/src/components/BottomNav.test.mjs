import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./BottomNav.tsx', import.meta.url), 'utf8');

function readConstantBlock(name, nextName) {
  const start = source.indexOf(`const ${name}`);
  const end = source.indexOf(`const ${nextName}`, start);

  assert.notEqual(start, -1, `${name} 선언이 필요합니다.`);
  assert.notEqual(end, -1, `${nextName} 선언이 필요합니다.`);
  return source.slice(start, end);
}

test('공개 상품의 storeId와 공개 스토어 salesMode로 내비게이션을 분기한다', () => {
  assert.match(source, /product\.storeId/);
  assert.match(source, /getDoc\(doc\(db, 'stores', storeId\)\)/);
  assert.match(source, /normalizeSalesMode/);
  assert.match(source, /salesMode === 'round_direct'/);
});

test('round_direct 내비게이션은 홈·상품·장바구니·MY 네 항목만 제공한다', () => {
  const roundDirectTabs = readConstantBlock('ROUND_DIRECT_TABS', 'LEGACY_TABS');

  assert.match(roundDirectTabs, /href: '\/', label: '홈'/);
  assert.match(roundDirectTabs, /href: '\/category', label: '상품'/);
  assert.match(roundDirectTabs, /href: '\/cart', label: '장바구니'/);
  assert.match(roundDirectTabs, /href: '\/mypage', label: 'MY'/);
  assert.doesNotMatch(roundDirectTabs, /groupbuy|공구|공동구매|Users/);
  assert.equal((roundDirectTabs.match(/href:/g) ?? []).length, 4);
});

test('legacy 내비게이션은 기존 다섯 항목과 경로를 보존한다', () => {
  const legacyTabs = readConstantBlock('LEGACY_TABS', 'HIDDEN_PATHS');

  assert.match(legacyTabs, /href: '\/', label: '홈'/);
  assert.match(legacyTabs, /href: '\/category', label: '카테고리'/);
  assert.match(legacyTabs, /href: '\/groupbuy', label: '공구'/);
  assert.match(legacyTabs, /href: '\/cart', label: '장바구니'/);
  assert.match(legacyTabs, /href: '\/mypage', label: 'MY'/);
  assert.equal((legacyTabs.match(/href:/g) ?? []).length, 5);
});

test('판매 모드 확인 전에는 기존 내비게이션을 노출하지 않는다', () => {
  assert.match(source, /if \(productsError \|\| storeMode\.status !== 'ready'\) return null;/);
  assert.match(
    source,
    /storeMode\.salesMode === 'round_direct' \? ROUND_DIRECT_TABS : LEGACY_TABS/,
  );
});

test('인증되지 않았거나 세션을 확인하는 동안에는 장바구니 배지를 숨긴다', () => {
  assert.match(source, /useSession/);
  assert.match(source, /const \{ status: sessionStatus \} = useSession\(\);/);
  assert.match(
    source,
    /const visibleItemCount = sessionStatus === 'authenticated' \? itemCount : 0;/,
  );
  assert.match(source, /tab\.showBadge && visibleItemCount > 0/);
});

test('인증된 사용자의 장바구니 수량은 배지에 표시한다', () => {
  assert.match(source, /visibleItemCount > 99 \? '99\+' : visibleItemCount/);
});
