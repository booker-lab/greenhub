import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const API = 'https://api.example.test';
const transpile = (source, fileName) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName,
  }).outputText;
const serverCode = transpile(
  await readFile(new URL('./home-server.ts', import.meta.url), 'utf8'),
  'home-server.ts',
);
const selectionCode = transpile(
  await readFile(new URL('../components/home-store-selection.ts', import.meta.url), 'utf8'),
  'home-store-selection.ts',
);
const pageSource = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');

function run(code, require) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  return module.exports;
}
const selection = run(selectionCode, () => {
  throw new Error('home-store-selection은 다른 모듈을 쓰지 않는다');
});
const { loadHomeStoreHint } = run(serverCode, (specifier) => {
  if (specifier === '@/components/home-store-selection') return selection;
  if (specifier === '@/lib/api-base-url') return { getApiBaseUrl: () => API };
  throw new Error(`예상하지 못한 모듈: ${specifier}`);
});

function withFetch(t, handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return handler();
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('활성 상품이 한 매장 것뿐이면 그 storeId를 단서로 준다(10분 캐시·짧은 제한 시간)', async (t) => {
  const calls = withFetch(t, () => json([{ storeId: 'store-1' }, { storeId: 'store-1' }]));
  assert.equal(await loadHomeStoreHint(), 'store-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API}/products?isActive=true`);
  assert.deepEqual(calls[0].init.next, { revalidate: 600 });
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test('{ items } 형태 응답도 읽는다', async (t) => {
  withFetch(t, () => json({ items: [{ storeId: 'store-1' }] }));
  assert.equal(await loadHomeStoreHint(), 'store-1');
});

test('매장이 여럿이거나 상품이 없거나 형식이 다르면 단서를 주지 않는다', async (t) => {
  let body = [{ storeId: 'store-1' }, { storeId: 'store-2' }];
  withFetch(t, () => json(body));
  assert.equal(await loadHomeStoreHint(), null);
  body = [];
  assert.equal(await loadHomeStoreHint(), null);
  body = { message: 'x' };
  assert.equal(await loadHomeStoreHint(), null);
  body = [{ storeId: 7 }, null];
  assert.equal(await loadHomeStoreHint(), null);
});

test('API 오류·연결 실패·시간 초과는 단서 없음(null)으로 끝낸다', async (t) => {
  let mode = 'status';
  withFetch(t, () => {
    if (mode === 'status') return json({}, 503);
    throw new DOMException('시간 초과', 'TimeoutError');
  });
  assert.equal(await loadHomeStoreHint(), null);
  mode = 'throw';
  assert.equal(await loadHomeStoreHint(), null);
});

test('홈 페이지는 단서 조회를 상품 목록과 다른 Suspense에 두어 상품 목록 하이드레이션을 막지 않는다', () => {
  assert.match(pageSource, /const storeId = await loadHomeStoreHint\(\);/);
  assert.match(pageSource, /<HomeStorePrefetch storeId=\{storeId\} \/>/);
  assert.match(
    pageSource,
    /<Suspense fallback=\{null\}>\s*<HomeStoreHint \/>\s*<\/Suspense>\s*<Suspense fallback=\{null\}>\s*<HomeProductList /,
  );
  // 페이지 자체는 단서를 기다리지 않는다.
  assert.match(pageSource, /export default function HomePage\(\)/);
});
