import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

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
  assert.match(source, /fetchPublicStoreProfile\(storeId\)/);
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

function loadResolveNavSalesMode() {
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'BottomNav.tsx',
  }).outputText;
  const navModule = { exports: {} };
  // 판정 함수만 검사하므로 화면 모듈은 빈 값으로 대신한다.
  const requireForTest = (specifier) =>
    specifier === '@greenhub/shared' ? { normalizeSalesMode: (value) => value } : {};
  new Function('require', 'module', 'exports', compiled)(
    requireForTest,
    navModule,
    navModule.exports,
  );
  return navModule.exports.resolveNavSalesMode;
}

test('판매 방식을 확인하는 동안이나 조회가 실패해도 내비게이션을 숨기지 않고 회차 판매 탭을 보인다', () => {
  const resolveNavSalesMode = loadResolveNavSalesMode();
  const legacyReady = { salesMode: 'legacy', status: 'ready' };

  // 조회 중·실패: 운영 판매 방식(회차 판매) 탭.
  assert.equal(resolveNavSalesMode(null, { salesMode: 'legacy', status: 'loading' }), 'round_direct');
  assert.equal(resolveNavSalesMode(null, { salesMode: 'legacy', status: 'error' }), 'round_direct');
  assert.equal(resolveNavSalesMode('연결이 불안정해요.', legacyReady), 'round_direct');
  // 확인된 판매 방식은 그대로 따른다(legacy는 확인됐을 때만).
  assert.equal(resolveNavSalesMode(null, legacyReady), 'legacy');
  assert.equal(
    resolveNavSalesMode(null, { salesMode: 'round_direct', status: 'ready' }),
    'round_direct',
  );

  assert.doesNotMatch(source, /return null;\s*\n\s*const tabs/);
  assert.match(source, /const salesMode = resolveNavSalesMode\(productsError, storeMode\);/);
  assert.match(source, /salesMode === 'round_direct' \? ROUND_DIRECT_TABS : LEGACY_TABS/);
});

test('인증되지 않았거나 세션을 확인하는 동안에는 장바구니 배지를 숨긴다', () => {
  assert.match(source, /useSession/);
  assert.match(source, /const \{ status: sessionStatus \} = useSession\(\);/);
  // 비회원 장바구니(guest-cart) 기능 토글이 켜졌을 때만 로그인 전 배지를 보인다.
  assert.match(
    source,
    /const visibleItemCount =\s+sessionStatus === 'authenticated' \|\| \(isFeatureOn\('guest-cart'\) && sessionStatus !== 'loading'\)\s+\? itemCount\s+: 0;/,
  );
  assert.match(source, /tab\.showBadge && visibleItemCount > 0/);
});

test('숨기는 경로에서는 상품·매장 조회 하위 컴포넌트를 마운트하지 않는다', () => {
  const outerStart = source.indexOf('export default function BottomNav()');
  const innerStart = source.indexOf('function VisibleBottomNav(');
  assert.notEqual(outerStart, -1);
  assert.notEqual(innerStart, -1);
  const outer = source.slice(outerStart, innerStart);
  const inner = source.slice(innerStart);

  // 바깥은 경로만 보고 숨기며, 조회 hook을 부르지 않는다.
  assert.match(
    outer,
    /if \(HIDDEN_PATHS\.some\(\(path\) => pathname\.startsWith\(path\)\)\) return null;/,
  );
  assert.match(outer, /<VisibleBottomNav pathname=\{pathname\} \/>/);
  assert.doesNotMatch(outer, /useProducts\(|useStoreMode\(|useCart\(|useSession\(/);
  // 조회는 보일 때 마운트되는 하위 컴포넌트에서만 한다.
  assert.match(inner, /useProducts\(\)/);
  assert.match(inner, /useStoreMode\(storeId, productsLoading\)/);
});

test('인증된 사용자의 장바구니 수량은 배지에 표시한다', () => {
  assert.match(source, /visibleItemCount > 99 \? '99\+' : visibleItemCount/);
});
