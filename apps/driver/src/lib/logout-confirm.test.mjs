import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { logoutConfirmMessage, summarizeActiveDeliveries } from './logout-confirm.ts';

const profileSource = await readFile(new URL('../app/profile/page.tsx', import.meta.url), 'utf8');
const logoutButtonSource = await readFile(
  new URL('../app/profile/logout-button.tsx', import.meta.url),
  'utf8',
);

test('목록 응답에서 배송 중·보류 주문만 센다', () => {
  assert.deepEqual(
    summarizeActiveDeliveries([
      { status: 'PREPARING' },
      { status: 'DELIVERING' },
      { status: 'DELIVERING' },
      { status: 'DELIVERY_HELD' },
      null,
      'x',
    ]),
    { delivering: 2, held: 1 },
  );
  assert.deepEqual(summarizeActiveDeliveries([]), { delivering: 0, held: 0 });
});

test('목록이 아닌 응답은 셀 수 없어 확인 없이 로그아웃한다', () => {
  for (const payload of [null, undefined, {}, 'orders', { orders: [] }]) {
    assert.equal(summarizeActiveDeliveries(payload), null);
    assert.equal(logoutConfirmMessage(summarizeActiveDeliveries(payload)), null);
  }
});

test('배송 중·보류 주문이 있을 때만 확인 문구를 만든다', () => {
  assert.equal(logoutConfirmMessage({ delivering: 0, held: 0 }), null);
  assert.equal(
    logoutConfirmMessage({ delivering: 3, held: 0 }),
    '배송 중인 주문 3건이 있어요. 로그아웃할까요?',
  );
  assert.equal(
    logoutConfirmMessage({ delivering: 0, held: 2 }),
    '보류 중인 주문 2건이 있어요. 로그아웃할까요?',
  );
  assert.equal(
    logoutConfirmMessage({ delivering: 1, held: 1 }),
    '배송 중인 주문 1건, 보류 중인 주문 1건이 있어요. 로그아웃할까요?',
  );
});

test('내 정보 로그아웃은 refresh token 폐기 흐름을 지키고 확인 창은 클라이언트 컴포넌트가 맡는다', () => {
  assert.match(
    profileSource,
    /await revokeApiSession\(\);\s*await signOut\(\{ redirectTo: '\/login' \}\);/,
  );
  assert.match(profileSource, /<LogoutButton[\s\S]*confirmMessage=\{logoutConfirmMessage\(/);
  assert.match(logoutButtonSource, /^'use client';/);
  // 확인 문구가 없으면 바로 제출한다(확인 없이 기존대로).
  assert.match(logoutButtonSource, /type=\{confirmMessage \? 'button' : 'submit'\}/);
  assert.match(logoutButtonSource, /requestSubmit\(\)/);
});

test('내 정보에 운영팀 연락처(전화 링크·운영 시간)를 보인다', () => {
  assert.match(profileSource, /DRIVER_OPS_CONTACT\.phoneHref/);
  assert.match(profileSource, /DRIVER_OPS_CONTACT\.phone\b/);
  assert.match(profileSource, /DRIVER_OPS_CONTACT\.hours/);
  assert.match(profileSource, /운영팀에 연락/);
});
