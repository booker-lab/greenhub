import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const API = 'https://api.example.test';
const APP = 'https://shop.example.test';

async function loadConfigModule() {
  const configUrl = new URL('../next.config.ts', import.meta.url);
  const source = await readFile(configUrl, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'next.config.ts',
  }).outputText;
  const module = { exports: {} };
  const previous = {
    api: process.env.NEXT_PUBLIC_API_URL,
    project: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    bucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  };
  process.env.NEXT_PUBLIC_API_URL = `${API}/`;
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'green-test';
  delete process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  try {
    new Function('require', 'module', 'exports', compiled)(
      createRequire(configUrl),
      module,
      module.exports,
    );
  } finally {
    for (const [key, name] of [
      ['api', 'NEXT_PUBLIC_API_URL'],
      ['project', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID'],
      ['bucket', 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'],
    ]) {
      if (previous[key] === undefined) delete process.env[name];
      else process.env[name] = previous[key];
    }
  }
  return module.exports;
}

const { networkOnlyRuntimeCaching, default: nextConfig } = await loadConfigModule();

test('보안 헤더와 이미지 최적화 허용 범위를 고정한다', async () => {
  assert.equal(nextConfig.poweredByHeader, false);
  assert.deepEqual(
    nextConfig.images.remotePatterns.map(({ pathname }) => pathname),
    ['/v0/b/green-test.appspot.com/o/**', '/v0/b/green-test.firebasestorage.app/o/**'],
  );
  const [{ headers }] = await nextConfig.headers();
  const csp = headers.find(({ key }) => key === 'Content-Security-Policy')?.value ?? '';
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.doesNotMatch(csp, /script-src|style-src|connect-src|default-src|form-action/);
});

function matchingRule(href, headers = {}) {
  const url = new URL(href);
  const request = new Request(href, { headers });
  const sameOrigin = url.origin === APP;
  return networkOnlyRuntimeCaching.find(({ urlPattern }) =>
    urlPattern instanceof RegExp ? urlPattern.test(href) : urlPattern({ url, request, sameOrigin }),
  );
}

test('API·인증·세션·배송 사진 요청은 NetworkOnly 규칙이 먼저 잡는다', () => {
  const cases = [
    [`${API}/auth/me`],
    [`${API}/users/me/addresses`],
    [`${API}/orders/my?limit=20`],
    ['https://other-api.example.test/notifications/me', { Authorization: 'Bearer t' }],
    [`${APP}/api/auth/session`],
    [
      'https://storage.googleapis.com/bucket/orders/o1/p1.jpg?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=abc',
    ],
    [
      'https://firebasestorage.googleapis.com/v0/b/green-test.appspot.com/o/deliveryPhotos%2Fo1_1.jpg?alt=media&token=t',
    ],
  ];
  for (const [href, headers] of cases) {
    const rule = matchingRule(href, headers);
    assert.ok(rule, `${href} 규칙 없음`);
    assert.equal(rule.handler, 'NetworkOnly', href);
  }
});

test('같은 출처 /api/* 규칙은 기본 "apis" 캐시 규칙을 대체한다', () => {
  assert.equal(matchingRule(`${APP}/api/auth/session`).options.cacheName, 'apis');
});

test('정적 자산·공개 상품 이미지는 NetworkOnly 규칙에 걸리지 않아 기본 캐시 규칙을 따른다', () => {
  for (const href of [
    `${APP}/_next/static/chunks/main.js`,
    `${APP}/fonts/PretendardVariable.woff2`,
    'https://firebasestorage.googleapis.com/v0/b/green-test.appspot.com/o/products%2Fa.jpg?alt=media',
  ]) {
    assert.equal(matchingRule(href), undefined, href);
  }
});

test('새 서비스워커 활성화 때 이전 개인 응답 런타임 캐시를 지운다', async () => {
  const source = await readFile(new URL('./index.js', import.meta.url), 'utf8');
  const listeners = new Map();
  const deleted = [];
  const self = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    caches: {
      delete: async (name) => {
        deleted.push(name);
        return true;
      },
    },
  };
  vm.runInNewContext(source, { self });

  let pending;
  listeners.get('activate')({
    waitUntil: (promise) => {
      pending = promise;
    },
  });
  await pending;

  assert.deepEqual(deleted.sort(), ['apis', 'cross-origin', 'pages-rsc', 'pages-rsc-prefetch']);
});
