import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./OfflineNotice.tsx', import.meta.url), 'utf8');
const layoutSource = await readFile(new URL('../app/layout.tsx', import.meta.url), 'utf8');

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
const { subscribeOnlineStatus } = noticeModule.exports;

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
