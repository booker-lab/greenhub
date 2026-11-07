import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildDriverLoginPath,
  classifyKakaoLoginRejection,
  DRIVER_DEFAULT_RETURN_PATH,
  hasAuthSessionCookie,
  resolveDriverReturnPath,
  safeDriverReturnPath,
} from './login-redirect.ts';

test('같은 출처의 앱 경로는 경로·쿼리·해시 그대로 돌아갈 곳으로 받는다', () => {
  for (const path of [
    '/board',
    '/board/order-1',
    '/board/order-1/photo',
    '/board?tab=delivering',
    '/map?day=today#pin',
    '/profile',
    '/loginx',
    '/apix',
  ]) {
    assert.equal(safeDriverReturnPath(path), path, path);
  }
  // searchParams 배열 값은 첫 값만 본다.
  assert.equal(safeDriverReturnPath(['/map', '/profile']), '/map');
});

test('다른 출처·스킴·역슬래시·제어 문자는 거절한다', () => {
  for (const raw of [
    undefined,
    null,
    42,
    '',
    'board',
    'https://evil.example/board',
    'javascript:alert(1)',
    '//evil.example',
    '///evil.example',
    '/\\evil.example',
    '\\/evil.example',
    '/\t/evil.example',
    // 점 세그먼트를 정리하면 `//evil.example`(프로토콜 상대 주소)이 되는 값.
    '/.//evil.example',
    '/..//evil.example',
    '/%2e%2e//evil.example',
    '/%2E//evil.example',
    '/board/..//evil.example',
    '/board/../..//evil.example',
    '/board\n',
    `/${'a'.repeat(2048)}`,
  ]) {
    assert.equal(safeDriverReturnPath(raw), null, String(raw));
    assert.equal(resolveDriverReturnPath(raw), DRIVER_DEFAULT_RETURN_PATH, String(raw));
  }
});

test('로그인 화면과 API 경로는 돌아갈 곳이 아니다(자기 순환 방지)', () => {
  for (const raw of [
    '/login',
    '/login/',
    '/login?callbackUrl=%2Flogin',
    '/login#x',
    '/./login',
    '/board/../login',
    '/%6Cogin',
    '/api',
    '/api/auth/signout',
    '/%61pi/auth/session',
    '/%E0%A4%A',
  ]) {
    assert.equal(safeDriverReturnPath(raw), null, raw);
    assert.equal(resolveDriverReturnPath(raw), '/board', raw);
  }
});

test('로그인 화면 주소는 허용된 복귀 경로만 싣고 세션 만료면 reason=expired를 붙인다', () => {
  assert.equal(buildDriverLoginPath({}), '/login');
  // 기본 복귀 경로(/board)는 싣지 않는다.
  assert.equal(buildDriverLoginPath({ returnPath: '/board' }), '/login');
  assert.equal(
    buildDriverLoginPath({ returnPath: '/board/order-1' }),
    '/login?callbackUrl=%2Fboard%2Forder-1',
  );
  assert.equal(
    buildDriverLoginPath({ returnPath: '/board?tab=delivering', sessionEnded: true }),
    '/login?reason=expired&callbackUrl=%2Fboard%3Ftab%3Ddelivering',
  );
  assert.equal(buildDriverLoginPath({ sessionEnded: true }), '/login?reason=expired');
  // 로그인 화면 자신에서 세션이 끝나도 callbackUrl=/login을 만들지 않는다.
  assert.equal(
    buildDriverLoginPath({ returnPath: '/login?callbackUrl=%2Fmap', sessionEnded: true }),
    '/login?reason=expired',
  );
  assert.equal(buildDriverLoginPath({ returnPath: 'https://evil.example/board' }), '/login');
  // 만든 주소의 callbackUrl을 다시 읽으면 같은 경로로 돌아간다.
  const built = new URL(buildDriverLoginPath({ returnPath: '/map?day=today' }), 'https://d.test');
  assert.equal(resolveDriverReturnPath(built.searchParams.get('callbackUrl')), '/map?day=today');
});

test('Auth.js 세션 쿠키가 있었는지 이름으로만 판정한다', () => {
  assert.equal(hasAuthSessionCookie([]), false);
  assert.equal(hasAuthSessionCookie(['authjs.csrf-token', 'authjs.callback-url']), false);
  assert.equal(hasAuthSessionCookie(['authjs.session-token']), true);
  assert.equal(hasAuthSessionCookie(['__Secure-authjs.session-token']), true);
  assert.equal(hasAuthSessionCookie(['__Secure-authjs.session-token.0']), true);
  assert.equal(hasAuthSessionCookie(['xauthjs.session-token']), false);
  assert.equal(hasAuthSessionCookie(['authjs.session-token-x']), false);
});

test('카카오 로그인 API 거절을 안내 종류로 나눈다', () => {
  const codes = { adminAccountCode: 'ADMIN_CODE', approvalPendingCode: 'PENDING_CODE' };
  assert.equal(
    classifyKakaoLoginRejection({ status: 403, code: 'ADMIN_CODE', ...codes }),
    'admin-account',
  );
  assert.equal(
    classifyKakaoLoginRejection({ status: 403, code: 'PENDING_CODE', ...codes }),
    'approval-pending',
  );
  for (const code of [undefined, null, 'OTHER']) {
    assert.equal(classifyKakaoLoginRejection({ status: 403, code, ...codes }), 'other-role');
  }
  // 403이 아니면 code가 있어도 일반 실패(정지 401·일시 실패 5xx·429 등)다.
  for (const status of [400, 401, 429, 500, 502, 503]) {
    assert.equal(
      classifyKakaoLoginRejection({ status, code: 'PENDING_CODE', ...codes }),
      'failed',
      String(status),
    );
  }
});

test('세션이 끝나 로그아웃시키는 두 곳은 보던 경로와 만료 안내를 싣는다', async () => {
  const providers = await readFile(new URL('../app/providers.tsx', import.meta.url), 'utf8');
  assert.equal(
    providers.match(/signOut\(\{ callbackUrl: sessionEndedLoginUrl\(\) \}\)/g)?.length,
    2,
  );
  assert.doesNotMatch(providers, /callbackUrl: '\/login'/);
  assert.match(
    providers,
    /returnPath: `\$\{window\.location\.pathname\}\$\{window\.location\.search\}`,\s*sessionEnded: true,/,
  );
});
