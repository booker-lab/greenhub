import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./session-login.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function('module', 'exports', compiled)(module, module.exports);
const { buildSessionExpiredLoginUrl, isSessionExpiredReason, hasActiveSession, loginErrorMessage } =
  module.exports;

const parse = (url) => {
  const parsed = new URL(url, 'https://shop.example.test');
  return {
    pathname: parsed.pathname,
    callbackUrl: parsed.searchParams.get('callbackUrl'),
    reason: parsed.searchParams.get('reason'),
  };
};

test('세션 만료: 보던 경로+쿼리를 복귀 주소로 싣고 만료 이유를 붙인다', () => {
  assert.deepEqual(parse(buildSessionExpiredLoginUrl('/cart', '')), {
    pathname: '/login',
    callbackUrl: '/cart',
    reason: 'expired',
  });
  assert.deepEqual(
    parse(buildSessionExpiredLoginUrl('/checkout', '?productId=p1&quantity=2')),
    { pathname: '/login', callbackUrl: '/checkout?productId=p1&quantity=2', reason: 'expired' },
  );
  assert.equal(
    parse(buildSessionExpiredLoginUrl('/search', '?q=%ED%98%B8%EC%A0%91%EB%9E%80')).callbackUrl,
    '/search?q=%ED%98%B8%EC%A0%91%EB%9E%80',
  );
});

test('세션 만료: 만든 주소는 로그인 화면의 상대 경로이고 복귀 주소는 인코딩된다', () => {
  const url = buildSessionExpiredLoginUrl('/order/success', '?orderId=o1&x=a b');
  assert.ok(url.startsWith('/login?'), url);
  assert.ok(!url.startsWith('//'), url);
  assert.equal(parse(url).callbackUrl, '/order/success?orderId=o1&x=a b');
});

test('세션 만료: 홈이면 복귀 주소를 싣지 않는다', () => {
  assert.equal(buildSessionExpiredLoginUrl('/', ''), '/login?reason=expired');
  assert.equal(buildSessionExpiredLoginUrl('', ''), '/login?reason=expired');
  assert.equal(buildSessionExpiredLoginUrl('/', '?'), '/login?reason=expired');
});

test('세션 만료: 이미 로그인 화면이면 로그인 화면을 겹쳐 싣지 않고 기존 복귀 주소를 잇는다', () => {
  assert.deepEqual(parse(buildSessionExpiredLoginUrl('/login', '?callbackUrl=%2Fcart')), {
    pathname: '/login',
    callbackUrl: '/cart',
    reason: 'expired',
  });
  assert.equal(buildSessionExpiredLoginUrl('/login', ''), '/login?reason=expired');
  assert.equal(buildSessionExpiredLoginUrl('/login/', '?reason=expired'), '/login?reason=expired');
  assert.equal(
    parse(buildSessionExpiredLoginUrl('/login', '?callbackUrl=%2Fmypage&reason=expired'))
      .callbackUrl,
    '/mypage',
  );
});

test('세션 만료 이유 판정은 expired만 참이다', () => {
  assert.equal(isSessionExpiredReason('expired'), true);
  for (const value of [null, undefined, '', 'Expired', 'expired ', 'other']) {
    assert.equal(isSessionExpiredReason(value), false, String(value));
  }
});

test('로그인 화면을 건너뛸 세션: 소비자·관리자 역할이 있고 토큰 오류가 없을 때만', () => {
  assert.equal(hasActiveSession({ user: { role: 'consumer' } }), true);
  assert.equal(hasActiveSession({ user: { role: 'admin', tokenError: false } }), true);
  for (const session of [
    null,
    undefined,
    {},
    { user: null },
    { user: {} },
    { user: { role: '' } },
    { user: { role: 'driver' } },
    { user: { role: 'seller' } },
    { user: { role: 'consumer', tokenError: true } },
  ]) {
    assert.equal(hasActiveSession(session), false, JSON.stringify(session));
  }
});

test('로그인 실패 표시(error)를 손님 안내로 바꾸고 오류 이름은 보이지 않는다', () => {
  const phone = '010-0000-0000';
  assert.equal(loginErrorMessage(null, phone), null);
  assert.equal(loginErrorMessage('', phone), null);
  assert.equal(loginErrorMessage('CredentialsSignin', phone), '이메일 또는 비밀번호를 확인해 주세요.');
  for (const error of ['AccessDenied', 'Configuration', 'OAuthCallbackError', '<script>']) {
    const message = loginErrorMessage(error, phone);
    assert.match(message, /^카카오 로그인을 마치지 못했어요\./, error);
    assert.match(message, /010-0000-0000/, error);
    assert.ok(!message.includes(error), error);
  }
});
