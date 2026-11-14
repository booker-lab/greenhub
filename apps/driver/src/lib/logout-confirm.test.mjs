import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  logoutConfirmMessage,
  pendingPhotoLogoutSentence,
  summarizeActiveDeliveries,
} from './logout-confirm.ts';

const profileSource = await readFile(new URL('../app/profile/page.tsx', import.meta.url), 'utf8');
const providersSource = await readFile(new URL('../app/providers.tsx', import.meta.url), 'utf8');
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
  // 확인 문구는 이 기기 대기열의 사진 수가 필요해 클라이언트 컴포넌트가 만든다.
  assert.match(profileSource, /<LogoutButton[\s\S]*activeDeliveries=\{activeDeliveries\}/);
  assert.match(
    logoutButtonSource,
    /const confirmMessage = logoutConfirmMessage\(activeDeliveries, pendingPhotoLabels\);/,
  );
  assert.match(logoutButtonSource, /^'use client';/);
  // 확인 문구가 없으면 바로 제출한다(확인 없이 기존대로).
  assert.match(logoutButtonSource, /type=\{confirmMessage \? 'button' : 'submit'\}/);
  assert.match(logoutButtonSource, /requestSubmit\(\)/);
});

test('올리지 못한 사진이 있으면 지워지고 그 배송은 완료되지 않는다는 결과와 할 일을 쓴다(S-09)', () => {
  const TAIL =
    '이 지워지고 그 배송은 완료되지 않아요. 신호가 잡힌 뒤 로그아웃해 주세요. 그래도 로그아웃할까요?';
  assert.equal(
    logoutConfirmMessage(null, ['101동 1203호']),
    `올리지 못한 사진 1건(101동 1203호)${TAIL}`,
  );
  assert.equal(
    logoutConfirmMessage({ delivering: 0, held: 0 }, ['101동 1203호', '102동 304호']),
    `올리지 못한 사진 2건(101동 1203호, 102동 304호)${TAIL}`,
  );
  // 주소 표시는 둘까지 쓰고 나머지는 "외 n건"이다(주소를 모르는 사진도 센다).
  assert.equal(
    logoutConfirmMessage(null, ['101동 1203호', '102동 304호', '103동 1호', null]),
    `올리지 못한 사진 4건(101동 1203호, 102동 304호 외 2건)${TAIL}`,
  );
  assert.equal(
    logoutConfirmMessage(null, [null, '101동 1203호']),
    `올리지 못한 사진 2건(101동 1203호 외 1건)${TAIL}`,
  );
  // 주소를 모르는 이전 항목만 있으면 건수만 쓴다.
  assert.equal(logoutConfirmMessage(null, [null, null]), `올리지 못한 사진 2건${TAIL}`);
  assert.equal(
    logoutConfirmMessage({ delivering: 3, held: 0 }, ['101동 1203호']),
    `배송 중인 주문 3건이 있어요. 올리지 못한 사진 1건(101동 1203호)${TAIL}`,
  );
  assert.equal(
    logoutConfirmMessage({ delivering: 1, held: 1 }, [null]),
    `배송 중인 주문 1건, 보류 중인 주문 1건이 있어요. 올리지 못한 사진 1건${TAIL}`,
  );
  // 사진이 없으면 예전 문구 그대로다.
  assert.equal(logoutConfirmMessage(null, []), null);
  assert.equal(logoutConfirmMessage(null), null);
  assert.equal(
    logoutConfirmMessage({ delivering: 2, held: 0 }, []),
    '배송 중인 주문 2건이 있어요. 로그아웃할까요?',
  );
});

test('대기 사진 안내 한 문장', () => {
  assert.equal(pendingPhotoLogoutSentence([]), null);
  assert.equal(
    pendingPhotoLogoutSentence(['101동 1203호', '102동 304호', '103동 1호']),
    '올리지 못한 사진 3건(101동 1203호, 102동 304호 외 1건)이 지워지고 그 배송은 완료되지 않아요. 신호가 잡힌 뒤 로그아웃해 주세요.',
  );
});

test('명시적 로그아웃은 이 기기의 사진 업로드 대기열을 지우고 제출한다', () => {
  // 올리지 못한 사진마다 주소 표시를 읽어 확인 문구에 쓴다.
  assert.match(logoutButtonSource, /const pendingPhotoLabels = usePendingPhotoLogoutLabels\(\);/);
  // 확인 창: 지운 뒤 제출한다.
  assert.match(
    logoutButtonSource,
    /void clearPendingPhotoQueue\(\)\.finally\(\(\) =>\s*formRef\.current\?\.requestSubmit\(\),?\s*\);/,
  );
  // 바로 제출(확인 문구 없음·건수를 읽기 전)도 제출과 함께 지운다.
  assert.match(
    logoutButtonSource,
    /onSubmit=\{\(\) => \{\s*void clearPendingPhotoQueue\(\);\s*\}\}/,
  );
  // 세션 만료로 끝나는 로그아웃(providers)은 대기열을 지우지 않는다(사용자 ID에 묶인 채 멈춤).
  assert.doesNotMatch(providersSource, /clearPendingPhotoQueue/);
});

test('내 정보에 운영팀 연락처(전화 링크·운영 시간)를 보인다', () => {
  assert.match(profileSource, /DRIVER_OPS_CONTACT\.phoneHref/);
  assert.match(profileSource, /DRIVER_OPS_CONTACT\.phone\b/);
  assert.match(profileSource, /DRIVER_OPS_CONTACT\.hours/);
  assert.match(profileSource, /운영팀에 연락/);
});
