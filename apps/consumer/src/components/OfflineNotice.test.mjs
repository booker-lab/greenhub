import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./OfflineNotice.tsx', import.meta.url), 'utf8');
const layoutSource = await readFile(new URL('../app/layout.tsx', import.meta.url), 'utf8');
const bottomNavSource = await readFile(new URL('./BottomNav.tsx', import.meta.url), 'utf8');
const ctaBarSource = await readFile(new URL('./ProductCTABar.tsx', import.meta.url), 'utf8');

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'OfflineNotice.tsx',
}).outputText;
const noticeModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  () => ({}),
  noticeModule,
  noticeModule.exports,
);
const { offlineNoticeBottomOffset, subscribeOnlineStatus } = noticeModule.exports;

test('online·offline 이벤트마다 알리고, 구독을 끝내면 더 알리지 않는다', () => {
  const target = new EventTarget();
  let calls = 0;
  const unsubscribe = subscribeOnlineStatus(target, () => {
    calls += 1;
  });
  target.dispatchEvent(new Event('offline'));
  target.dispatchEvent(new Event('online'));
  assert.equal(calls, 2);

  unsubscribe();
  target.dispatchEvent(new Event('offline'));
  assert.equal(calls, 2);
});

test('연결이 끊기면 navigator.onLine으로 판정해 안내 띠를 보이고, 서버 첫 화면은 연결된 것으로 본다', () => {
  assert.match(source, /^'use client';/);
  assert.match(source, /useSyncExternalStore\(subscribe, getSnapshot, getServerSnapshot\)/);
  assert.match(source, /return navigator\.onLine;/);
  assert.match(source, /function getServerSnapshot\(\) \{\s*return true;/);
  assert.match(source, /if \(online\) return null;/);
  assert.match(source, /인터넷 연결을 확인해 주세요\./);
  // 색은 기존 토큰만 쓴다.
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/);
});

test('루트 layout은 Providers 안에서 오프라인 안내를 연결하고 요청 헤더를 읽지 않는다', () => {
  assert.match(layoutSource, /import OfflineNotice from '@\/components\/OfflineNotice';/);
  const providers = layoutSource.slice(
    layoutSource.indexOf('<Providers>'),
    layoutSource.indexOf('</Providers>'),
  );
  assert.match(providers, /<OfflineNotice \/>/);
  assert.doesNotMatch(layoutSource, /next\/headers|headers\(\)|cookies\(\)/);
});

test('오프라인 띠는 상단 바를 가리지 않게 아래에 두고, 하단 고정 바 바로 위에 띄운다', () => {
  const NAV = 'calc(64px + env(safe-area-inset-bottom))';
  const CTA = 'calc(74px + env(safe-area-inset-bottom))';
  for (const pathname of ['/', '/category', '/cart', '/search', '/mypage', '/mypage/orders/o-1']) {
    assert.equal(offlineNoticeBottomOffset(pathname), NAV, pathname);
  }
  // 상품 상세는 하단 내비 대신 구매 바(ProductCTABar)가 있다.
  assert.equal(offlineNoticeBottomOffset('/products/p-1'), CTA);
  // 결제·주문 완료는 하단 고정 바가 없다.
  assert.equal(offlineNoticeBottomOffset('/checkout'), '0px');
  assert.equal(offlineNoticeBottomOffset('/order/success'), '0px');

  assert.doesNotMatch(source, /\btop: 0\b/);
  assert.match(source, /position: 'fixed',\s*bottom,/);
  assert.match(source, /offlineNoticeBottomOffset\(pathname\)/);
});

test('하단 내비가 숨는 화면 목록과 하단 바 높이는 BottomNav·ProductCTABar와 같다', () => {
  const hidden = (text, name) => {
    const match = text.match(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`));
    assert.ok(match, name);
    return JSON.parse(match[1].replaceAll("'", '"'));
  };
  assert.deepEqual(
    hidden(source, 'BOTTOM_NAV_HIDDEN_PATHS'),
    hidden(bottomNavSource, 'HIDDEN_PATHS'),
  );
  assert.match(bottomNavSource, /height: 'calc\(64px \+ env\(safe-area-inset-bottom\)\)'/);
  // 구매 바: 위아래 12px 여백 + 큰 버튼(h-12.5 = 50px) = 74px.
  assert.match(ctaBarSource, /padding: '12px 16px'/);
  assert.match(ctaBarSource, /size="lg"/);
});
