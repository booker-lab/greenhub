import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./_callback-url.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: '_callback-url.ts',
}).outputText;

const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  (specifier) => {
    throw new Error(`unexpected module request in test: ${specifier}`);
  },
  mod,
  mod.exports,
);
const { safeCallbackPath } = mod.exports;

const ORIGIN = 'https://shop.example.test';

test('같은 출처 상대 경로는 경로+쿼리+해시 그대로 허용한다', () => {
  for (const path of [
    '/',
    '/cart',
    '/checkout?from=cart',
    '/checkout?productId=p1&quantity=2&saleType=round',
    '/mypage/orders/abc123',
    '/order/success?orderId=o1#top',
    '/products/x%2Fy',
  ]) {
    assert.equal(safeCallbackPath(path, ORIGIN), path, path);
    assert.equal(safeCallbackPath(path), path, `${path} (출처 미지정)`);
  }
});

test('Auth.js가 만든 같은 출처 절대 주소는 상대 경로로 바꿔 허용한다', () => {
  assert.equal(
    safeCallbackPath(`${ORIGIN}/checkout?productId=p1`, ORIGIN),
    '/checkout?productId=p1',
  );
  assert.equal(safeCallbackPath(`${ORIGIN}/cart#a`, ORIGIN), '/cart#a');
  assert.equal(safeCallbackPath(ORIGIN, ORIGIN), '/');
});

test('출처를 모르면 절대 주소는 거부한다', () => {
  assert.equal(safeCallbackPath(`${ORIGIN}/cart`), '/');
});

test('비어 있거나 문자열이 아니면 홈으로 보낸다', () => {
  for (const value of [null, undefined, '', 123, {}]) {
    assert.equal(safeCallbackPath(value, ORIGIN), '/');
  }
});

test('다른 출처·프로토콜 상대·역슬래시·스킴·제어 문자는 거부한다', () => {
  for (const value of [
    'https://evil.com',
    'https://evil.com/cart',
    'http://shop.example.test/cart', // 프로토콜이 다르면 다른 출처
    'https://shop.example.test.evil.com/cart',
    'https://shop.example.test@evil.com/cart',
    '//evil.com',
    '//evil.com/cart',
    '///evil.com',
    '/\\evil.com',
    '/\\/evil.com',
    '\\\\evil.com',
    '/cart\\..\\..\\evil',
    '/\t/evil.com',
    '/\n/evil.com',
    '/\r\n/evil.com',
    ' /cart',
    'cart',
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'mailto:a@b.c',
    '\u0000/cart',
  ]) {
    assert.equal(safeCallbackPath(value, ORIGIN), '/', JSON.stringify(value));
  }
});

test('같은 출처 절대 주소라도 역슬래시나 제어 문자가 섞이면 거부한다', () => {
  assert.equal(safeCallbackPath(`${ORIGIN}/\\evil.com`, ORIGIN), '/');
  assert.equal(safeCallbackPath(`${ORIGIN}/\t/evil.com`, ORIGIN), '/');
});
