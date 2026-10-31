import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { NextRequest } = require('next/server');
const { unstable_doesMiddlewareMatch } = require('next/experimental/testing/server');

async function loadTs(path, resolveImport) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: path,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(resolveImport, loaded, loaded.exports);
  return loaded.exports;
}

// auth() 래퍼는 세션을 request.auth에 싣고 콜백을 부른다. 테스트는 세션만 바꿔 끼운다.
const state = { session: null, authPaths: [] };
const authMock = {
  auth: (handler) => async (request, ctx) => {
    state.authPaths.push(request.nextUrl.pathname);
    return handler(Object.assign(request, { auth: state.session }), ctx);
  },
};

const policy = await loadTs('./lib/content-security-policy.ts', (specifier) => {
  if (specifier === '@greenhub/shared') return require('@greenhub/shared');
  throw new Error(`unexpected module request in test: ${specifier}`);
});
const { config, proxy } = await loadTs('./proxy.ts', (specifier) => {
  if (specifier === 'next/server') return require('next/server');
  if (specifier === '@/auth') return authMock;
  if (specifier === '@/lib/content-security-policy') return policy;
  throw new Error(`unexpected module request in test: ${specifier}`);
});

async function run(path) {
  state.authPaths = [];
  return proxy(new NextRequest(`https://shop.example.test${path}`), {});
}

function nonceOf(response) {
  const header = response.headers.get('content-security-policy-report-only') ?? '';
  const match = header.match(/'nonce-([A-Za-z0-9+/=]+)'/);
  assert.ok(match, `nonce missing in: ${header}`);
  return match[1];
}

test('로그인하지 않은 사용자를 보호 경로에서 복귀 주소와 함께 /login으로 보낸다', async () => {
  state.session = null;
  for (const path of [
    '/cart',
    '/mypage',
    '/mypage/orders/o-1',
    '/checkout?from=cart',
    '/order/success',
  ]) {
    const response = await run(path);
    assert.equal(response.status, 307, path);
    const location = new URL(response.headers.get('location'));
    assert.equal(location.pathname, '/login');
    assert.equal(location.searchParams.get('callbackUrl'), path);
  }
});

test('기사 세션은 보호 경로에서 /login으로 보낸다', async () => {
  state.session = { user: { role: 'driver' } };
  const response = await run('/cart');
  assert.equal(response.headers.get('location'), 'https://shop.example.test/login');
});

test('로그인한 소비자는 보호 경로를 통과하며 CSP nonce가 요청 헤더로 넘어간다', async () => {
  state.session = { user: { role: 'consumer' } };
  const response = await run('/mypage');
  assert.equal(response.headers.get('location'), null);
  const nonce = nonceOf(response);
  assert.equal(response.headers.get('x-middleware-request-x-nonce'), nonce);
  assert.match(
    response.headers.get('x-middleware-request-content-security-policy'),
    new RegExp(`'nonce-${nonce.replace(/[+/=]/g, '\\$&')}'`),
  );
});

test('공개 경로는 세션을 읽지 않고 리다이렉트하지 않는다', async () => {
  state.session = null;
  for (const path of ['/', '/login', '/products/p-1', '/orders', '/carts']) {
    const response = await run(path);
    assert.equal(response.headers.get('location'), null, path);
    assert.equal(response.headers.get('x-middleware-next'), '1');
    assert.deepEqual(state.authPaths, [], path);
  }
});

test('Report-Only 헤더에 요청마다 새 nonce를 싣고 강제 CSP 헤더는 붙이지 않는다', async () => {
  const first = await run('/');
  const second = await run('/');
  assert.notEqual(nonceOf(first), nonceOf(second));
  assert.equal(first.headers.get('content-security-policy'), null);
  assert.match(first.headers.get('content-security-policy-report-only'), /'strict-dynamic'/);
  assert.match(
    first.headers.get('content-security-policy-report-only'),
    /report-uri \/api\/csp-report/,
  );
});

test('matcher는 보호 경로와 로그인 화면에서만 실행되고 보호 경로는 프리페치에서도 실행된다', () => {
  const matches = (url, headers) => unstable_doesMiddlewareMatch({ config, url, headers });
  for (const path of ['/login', '/cart', '/mypage', '/mypage/orders/o-1', '/checkout', '/order/success']) {
    assert.equal(matches(path), true, path);
  }
  assert.equal(matches('/cart', { 'next-router-prefetch': '1' }), true);
});

test('matcher는 정적 공개 화면에서는 실행되지 않아 CDN이 바로 응답한다', () => {
  for (const path of [
    '/',
    '/products/p-1',
    '/category',
    '/search',
    '/store/s-1',
    '/groupbuy',
    '/guarantee',
    '/partner',
    '/terms',
    '/privacy',
  ]) {
    assert.equal(unstable_doesMiddlewareMatch({ config, url: path }), false, path);
  }
});

test('matcher는 API, Next 정적 파일, 서비스워커, 매니페스트, 이미지에서는 실행되지 않는다', () => {
  for (const path of [
    '/api/csp-report',
    '/api/auth/session',
    '/_next/static/chunks/main.js',
    '/_next/image?url=x',
    '/favicon.ico',
    '/sw.js',
    '/swe-worker-abc.js',
    '/workbox-1a2b3c.js',
    '/manifest.json',
    '/icons/icon-192x192.png',
    '/images/hero.webp',
  ]) {
    assert.equal(unstable_doesMiddlewareMatch({ config, url: path }), false, path);
  }
});
