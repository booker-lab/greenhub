import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  OFFLINE_NAVIGATION_MESSAGE,
  readOnlineStatus,
  subscribeOnlineStatus,
} from './online-status.ts';

const bottomNavSource = await readFile(
  new URL('../components/BottomNav.tsx', import.meta.url),
  'utf8',
);

test('신호가 없다고 확실할 때(onLine === false)만 끊긴 것으로 본다', () => {
  assert.equal(readOnlineStatus({ onLine: false }), false);
  assert.equal(readOnlineStatus({ onLine: true }), true);
  // 모르면(서버 렌더·속성 없음) 이동을 막지 않는다.
  assert.equal(readOnlineStatus({}), true);
  assert.equal(readOnlineStatus(undefined), true);
  assert.equal(readOnlineStatus(null), true);
});

test("'online'·'offline' 이벤트를 듣고, 그만두면 둘 다 뗀다", () => {
  const target = new EventTarget();
  let calls = 0;
  const unsubscribe = subscribeOnlineStatus(target, () => {
    calls += 1;
  });
  target.dispatchEvent(new Event('offline'));
  target.dispatchEvent(new Event('online'));
  assert.equal(calls, 2);
  unsubscribe();
  target.dispatchEvent(new Event('offline'));
  target.dispatchEvent(new Event('online'));
  assert.equal(calls, 2);
  // 창이 없으면(서버) 아무것도 하지 않는다.
  assert.doesNotThrow(() => subscribeOnlineStatus(null, () => {})());
});

test('하단 탭은 신호가 없으면 이동을 막고 앱 안에서 안내한다(S-01)', () => {
  assert.equal(OFFLINE_NAVIGATION_MESSAGE, '신호가 잡히면 이동할 수 있어요.');
  const at = bottomNavSource.indexOf('function guardOfflineNavigation(');
  assert.ok(at !== -1);
  const guard = bottomNavSource.slice(at, bottomNavSource.indexOf('\n}\n', at));
  // 누를 때마다 지금 상태를 읽는다(신호가 잡히면 바로 다시 옮길 수 있다).
  assert.match(
    guard,
    /readOnlineStatus\(typeof navigator === 'undefined' \? null : navigator\)\) return;/,
  );
  assert.match(guard, /event\.preventDefault\(\);/);
  assert.match(guard, /toast\.add\(\{ description: OFFLINE_NAVIGATION_MESSAGE \}\)/);
  assert.match(bottomNavSource, /onClick=\{guardOfflineNavigation\}/);
});
