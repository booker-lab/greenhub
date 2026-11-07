import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./_login.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: '_login.ts',
}).outputText;
const loginModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  () => {
    throw new Error('예상하지 못한 모듈 요청');
  },
  loginModule,
  loginModule.exports,
);
const { buildMyPageLoginUrl, currentMyPageLoginUrl } = loginModule.exports;

const parse = (url) => {
  const parsed = new URL(url, 'https://shop.example.test');
  return {
    pathname: parsed.pathname,
    callbackUrl: parsed.searchParams.get('callbackUrl'),
    reason: parsed.searchParams.get('reason'),
  };
};

test('비로그인 MY 화면: 보던 경로+쿼리를 복귀 주소로 싣고 만료 이유는 붙이지 않는다', () => {
  assert.deepEqual(parse(buildMyPageLoginUrl('/mypage', '')), {
    pathname: '/login',
    callbackUrl: '/mypage',
    reason: null,
  });
  assert.deepEqual(parse(buildMyPageLoginUrl('/mypage/orders/order-1', '?paymentId=p1&code=X')), {
    pathname: '/login',
    callbackUrl: '/mypage/orders/order-1?paymentId=p1&code=X',
    reason: null,
  });
  assert.equal(
    buildMyPageLoginUrl('/mypage/notifications/settings', ''),
    '/login?callbackUrl=%2Fmypage%2Fnotifications%2Fsettings',
  );
  // 앞 '?'가 없는 쿼리도 같게 싣는다.
  assert.equal(
    parse(buildMyPageLoginUrl('/mypage/addresses', 'from=checkout')).callbackUrl,
    '/mypage/addresses?from=checkout',
  );
});

test('홈이나 빈 경로는 복귀 주소 없이 로그인 화면으로 보낸다', () => {
  assert.equal(buildMyPageLoginUrl('/', ''), '/login');
  assert.equal(buildMyPageLoginUrl('', ''), '/login');
});

test('이미 로그인 화면이면 그 화면의 복귀 주소를 이어 쓰고 로그인 화면을 겹쳐 싣지 않는다', () => {
  assert.equal(
    parse(buildMyPageLoginUrl('/login', '?callbackUrl=%2Fmypage%2Fwithdraw')).callbackUrl,
    '/mypage/withdraw',
  );
  assert.equal(buildMyPageLoginUrl('/login/', ''), '/login');
  assert.equal(buildMyPageLoginUrl('/login', '?reason=expired'), '/login');
});

test('현재 주소를 읽어 만들고, 읽을 수 없으면 MY로 돌아오게 한다', () => {
  assert.equal(
    currentMyPageLoginUrl({ pathname: '/mypage/purchase-history', search: '' }),
    '/login?callbackUrl=%2Fmypage%2Fpurchase-history',
  );
  // node 테스트에는 window가 없다.
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(currentMyPageLoginUrl(), '/login?callbackUrl=%2Fmypage');
});

// 비로그인일 때 로그인으로 보내는 MY 화면 일곱 곳은 모두 복귀 주소를 싣는다(C-09 후속).
const LOGIN_REDIRECT_SITES = [
  ['./_client.tsx', /router\.replace\(currentMyPageLoginUrl\(\)\)/, "'./_login'"],
  ['./notifications/_client.tsx', /router\.replace\(currentMyPageLoginUrl\(\)\)/, "'../_login'"],
  [
    './notifications/settings/page.tsx',
    /router\.replace\(currentMyPageLoginUrl\(\)\)/,
    "'../../_login'",
  ],
  ['./withdraw/_client.tsx', /router\.replace\(currentMyPageLoginUrl\(\)\)/, "'../_login'"],
  ['./addresses/_client.tsx', /router\.replace\(currentMyPageLoginUrl\(\)\)/, "'../_login'"],
  ['./purchase-history/page.tsx', /router\.replace\(currentMyPageLoginUrl\(\)\)/, "'../_login'"],
  ['./orders/[id]/_client.tsx', /router\.push\(currentMyPageLoginUrl\(\)\)/, "'../../_login'"],
];

test('MY 화면 일곱 곳은 비로그인일 때 복귀 주소를 실어 로그인으로 보낸다', async () => {
  for (const [path, call, importPath] of LOGIN_REDIRECT_SITES) {
    const screen = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.match(screen, call, path);
    assert.ok(
      screen.includes(`import { currentMyPageLoginUrl } from ${importPath};`),
      `${path}: 복귀 주소 함수를 불러와야 한다`,
    );
    // 복귀 주소 없이 로그인으로 보내는 호출이 남지 않는다.
    assert.doesNotMatch(screen, /router\.(replace|push)\(\s*['"`]\/login/, path);
    // 단순 비로그인은 세션 만료 안내를 붙이지 않는다.
    assert.doesNotMatch(screen, /buildSessionExpiredLoginUrl|reason=expired/, path);
  }
});
