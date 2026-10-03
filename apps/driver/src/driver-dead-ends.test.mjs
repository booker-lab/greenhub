import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isDriverHoldEntryVisible } from './app/board/_lib/driver-order-detail.ts';
import { DRIVER_ADMIN_ACCOUNT_ERROR, resolveDriverLoginNotice } from './app/login/login-notice.ts';

// 기사 상세·로그인 화면의 막다른 길 정리 계약.
// 1) 서버가 거부하는 상태에서 보류 버튼을 노출하지 않는다.
// 2) 인증 오류 화면에는 로그인으로 돌아가는 길이 있다.
// 3) 로그인 거절(?error=)을 로그인 화면이 안내한다.
// 4) 기사 앱은 기사(driver) 역할만 받는다(2026-10-04 결정). 관리자 계정은 로그인·기존 세션
//    모두 거절하고 로그인 화면 안내로 멈춘다.
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const detailSource = await read('./app/board/[orderId]/page.tsx');
const boardSource = await read('./app/board/_client.tsx');
const loginSource = await read('./app/login/page.tsx');
const authSource = await read('./auth.ts');
const proxySource = await read('./proxy.ts');
const apiScopeSource = await read('../../api/src/orders/driver-order-scope.service.ts');
const apiTransitionSource = await read('../../api/src/orders/orders.helpers.ts');
const apiAuthServiceSource = await read('../../api/src/auth/auth.service.ts');

test('보류 진입은 회차 직배송 DELIVERING에서만 보인다', () => {
  assert.equal(isDriverHoldEntryVisible({ status: 'DELIVERING', isRoundDirect: true }), true);
  for (const status of ['PREPARING', 'DELIVERY_HELD', 'DELIVERED', 'HUB_ARRIVED', '']) {
    assert.equal(isDriverHoldEntryVisible({ status, isRoundDirect: true }), false, status);
  }
  assert.equal(isDriverHoldEntryVisible({ status: 'DELIVERING', isRoundDirect: false }), false);
});

test('보류 노출 규칙의 근거인 서버 규칙이 그대로다', () => {
  // 기사 보류 출발 상태는 PREPARING·DELIVERING뿐이다.
  assert.match(apiTransitionSource, /PREPARING: \['DELIVERING', 'DELIVERY_HELD'\]/);
  assert.match(apiTransitionSource, /DELIVERING: \['HUB_ARRIVED', 'DELIVERED', 'DELIVERY_HELD'\]/);
  // 미배정 주문은 first claim(PREPARING → DELIVERING) 외 전이를 거부한다.
  assert.match(apiScopeSource, /미배정 주문은 first claim으로만 배송을 시작할 수 있습니다/);
  // 미배정 노출(discovery)은 PREPARING뿐이고, 나머지 노출은 본인 배정이다.
  assert.match(
    apiScopeSource,
    /if \(order\['status'\] !== 'PREPARING' \|\| order\['driverId'\] != null\) return false;/,
  );
  assert.match(apiScopeSource, /order\['driverId'\] === requesterId &&/);
});

test('상세의 보류 버튼은 노출 판정으로 감싸져 있다', () => {
  assert.match(
    detailSource,
    /const holdEntryVisible = isDriverHoldEntryVisible\(\{ status: order\.status, isRoundDirect \}\)/,
  );
  const holdButtonAt = detailSource.indexOf('onClick={() => setHoldOpened(true)}');
  assert.ok(holdButtonAt !== -1, '보류 버튼이 있어야 한다');
  const guardAt = detailSource.lastIndexOf('{holdEntryVisible && (', holdButtonAt);
  assert.ok(guardAt !== -1, '보류 버튼은 holdEntryVisible 가드 안에 있어야 한다');
  assert.equal(detailSource.match(/setHoldOpened\(true\)/g)?.length, 1);
});

test('상세 인증 오류 화면은 로그인으로 돌아가는 버튼을 제공한다', () => {
  const guardAt = detailSource.indexOf('if (!order) {');
  const endAt = detailSource.indexOf('const isDelivering', guardAt);
  const block = detailSource.slice(guardAt, endAt);
  assert.match(block, /readError\?\.kind === 'AUTH_ERROR' && \(/);
  assert.match(block, /signOut\(\{ redirectTo: '\/login' \}\)/);
  assert.match(block, /다시 로그인/);
});

test('보드 인증 필요 화면은 같은 토큰 재시도 외에 로그인 이동을 제공한다', () => {
  const authAt = boardSource.indexOf('authRequired ?');
  const nextAt = boardSource.indexOf('error && !hasSuccessfulRead', authAt);
  const block = boardSource.slice(authAt, nextAt);
  assert.match(block, /signOut\(\{ redirectTo: '\/login' \}\)/);
  assert.match(block, /다시 로그인/);
  assert.match(block, /다시 시도/);
});

test('로그인 안내 문구는 error·pending 값을 구분한다', () => {
  assert.equal(resolveDriverLoginNotice({}), null);
  assert.equal(resolveDriverLoginNotice({ error: '' }), null);

  const denied = resolveDriverLoginNotice({ error: 'AccessDenied' });
  assert.equal(denied?.kind, 'access-denied');
  assert.match(denied?.body ?? '', /관리자 승인 대기 중이거나 기사 계정이 아닙니다/);

  const admin = resolveDriverLoginNotice({ error: DRIVER_ADMIN_ACCOUNT_ERROR });
  assert.equal(admin?.kind, 'admin-account');
  assert.match(admin?.title ?? '', /관리자 계정은 기사 앱을 쓸 수 없습니다/);
  assert.match(admin?.body ?? '', /기사 계정으로 로그인해 주세요/);
  // 관리자 계정에는 세션이 생기지 않으므로 로그아웃 버튼 같은 세션 정리 수단을 두지 않는다.
  assert.equal('offerSignOut' in (admin ?? {}), false);

  assert.equal(resolveDriverLoginNotice({ pending: 'true' })?.kind, 'pending');
  assert.equal(resolveDriverLoginNotice({ error: ['AccessDenied', 'x'] })?.kind, 'access-denied');

  for (const error of ['CredentialsSignin', 'Configuration', 'OAuthCallbackError']) {
    const failed = resolveDriverLoginNotice({ error });
    assert.equal(failed?.kind, 'failed', error);
    // 오류 값·코드는 화면 문구에 그대로 노출하지 않는다.
    assert.doesNotMatch(`${failed?.title}${failed?.body}`, new RegExp(error));
  }
});

test('Auth.js 오류는 로그인 화면으로 오고 로그인 화면이 error를 읽는다', () => {
  assert.match(authSource, /pages:\s*\{\s*signIn: '\/login',[\s\S]{0,300}error: '\/login',\s*\}/);
  assert.match(loginSource, /resolveDriverLoginNotice\(\{ pending, error \}\)/);
  assert.doesNotMatch(loginSource, /signOut/);
});

test('기사 앱 허용 역할은 driver 하나다', () => {
  assert.match(authSource, /const DRIVER_APP_ROLE = 'driver';/);
  assert.match(authSource, /const SESSION_ALLOWED_ROLES = \[DRIVER_APP_ROLE\];/);
  // 이전 허용 목록(driver|admin)과 "admin은 승인 절차 없이 통과" 분기가 남지 않는다.
  assert.doesNotMatch(authSource, /\[\s*'driver',\s*'admin'\s*\]/);
  assert.doesNotMatch(authSource, /admin은 승인 절차 없이/);
});

test('카카오 로그인은 관리자 계정을 세션 없이 로그인 안내로 보낸다', () => {
  const start = authSource.indexOf('async signIn({ user, account })');
  const end = authSource.indexOf('jwt: async', start);
  const signInScope = authSource.slice(start, end);
  // API 거절(403 + 관리자 code)과 응답 역할 재확인 둘 다 안내 URL을 돌려준다.
  assert.match(
    signInScope,
    /res\.status === 403 &&[\s\S]{0,120}=== KAKAO_LOGIN_DRIVER_APP_ADMIN_ACCOUNT[\s\S]{0,60}return ADMIN_ACCOUNT_LOGIN_URL;/,
  );
  assert.match(signInScope, /if \(data\.user\.role === 'admin'\) return ADMIN_ACCOUNT_LOGIN_URL;/);
  assert.match(signInScope, /if \(data\.user\.role !== DRIVER_APP_ROLE\) return false;/);
  assert.match(authSource, /const ADMIN_ACCOUNT_LOGIN_URL = `\/login\?error=\$\{DRIVER_ADMIN_ACCOUNT_ERROR\}`;/);
  // 앱과 API의 관리자 거절 code가 같은 값이다.
  const appCode = authSource.match(/const KAKAO_LOGIN_DRIVER_APP_ADMIN_ACCOUNT = '([A-Z_]+)';/)?.[1];
  const apiCode = apiAuthServiceSource.match(
    /export const KAKAO_LOGIN_DRIVER_APP_ADMIN_ACCOUNT = '([A-Z_]+)';/,
  )?.[1];
  assert.ok(appCode, '앱 code 상수가 있어야 한다');
  assert.equal(appCode, apiCode);
  // API의 기사 앱(targetRole=driver) 허용 역할도 driver 하나다.
  assert.match(apiAuthServiceSource, /dto\.targetRole === 'driver'\s*\?[^\n]*\n\s*\['driver'\]\s*\n/);
});

test('기존 비기사 세션은 jwt 갱신 전에 끝난다', () => {
  const start = authSource.indexOf('jwt: async');
  const end = authSource.indexOf('verifySessionAuthority(accessToken', start);
  const jwtScope = authSource.slice(start, end);
  assert.match(jwtScope, /if \(token\.role !== DRIVER_APP_ROLE\) \{\s*return null;\s*\}/);
});

test('proxy는 남아 있는 관리자 세션도 기사 화면 대신 로그인 안내로 보낸다', () => {
  assert.match(proxySource, /session\.user\.role !== 'driver'/);
  assert.match(proxySource, /session\.user\.role === 'admin'/);
  assert.match(proxySource, /searchParams\.set\('error', DRIVER_ADMIN_ACCOUNT_ERROR\)/);
  assert.equal(DRIVER_ADMIN_ACCOUNT_ERROR, 'AdminAccount');
});
