import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  addRecentCompletion,
  isRecentlyCompletedOrder,
  RECENT_COMPLETION_MAX_ENTRIES,
  RECENT_COMPLETION_STORAGE_KEY,
  RECENT_COMPLETION_TTL_MS,
  readRecentCompletions,
  rememberCompletedOrder,
  wasOrderRecentlyCompleted,
} from './recent-completion.ts';

// R-01: 이 기기에서 방금 완료로 수렴한 주문을 잠깐 기억해, 완료 직후 뒤로가기로 연 상세(404)가
// "배송을 마친 주문이에요."를 보이게 한다. 기억은 문구 선택에만 쓰고 서버 상태를 대신하지 않는다.
const detailSource = await readFile(new URL('../[orderId]/page.tsx', import.meta.url), 'utf8');

const NOW = Date.UTC(2026, 10, 10, 3, 0, 0);

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
}

test('R-01. 기록한 주문은 같은 사용자에게 30분 동안만 방금 완료한 주문이다', () => {
  assert.equal(RECENT_COMPLETION_TTL_MS, 30 * 60 * 1000);
  const storage = memoryStorage();
  assert.equal(rememberCompletedOrder({ orderId: 'o1', userId: 'u1', now: NOW, storage }), true);
  const read = (args) => wasOrderRecentlyCompleted({ storage, ...args });
  assert.equal(read({ orderId: 'o1', userId: 'u1', now: NOW }), true);
  assert.equal(read({ orderId: 'o1', userId: 'u1', now: NOW + RECENT_COMPLETION_TTL_MS - 1 }), true);
  // 만료.
  assert.equal(read({ orderId: 'o1', userId: 'u1', now: NOW + RECENT_COMPLETION_TTL_MS }), false);
  // 기록 시각보다 앞선 시계(되돌아감)는 믿지 않는다.
  assert.equal(read({ orderId: 'o1', userId: 'u1', now: NOW - 1 }), false);
  // 다른 주문.
  assert.equal(read({ orderId: 'o2', userId: 'u1', now: NOW }), false);
});

test('R-01. 다른 계정으로 바뀌었거나 사용자 ID가 없으면 기록하지도 맞다고 보지도 않는다', () => {
  const storage = memoryStorage();
  rememberCompletedOrder({ orderId: 'o1', userId: 'u1', now: NOW, storage });
  assert.equal(wasOrderRecentlyCompleted({ orderId: 'o1', userId: 'u2', now: NOW, storage }), false);
  for (const userId of [null, undefined, '']) {
    assert.equal(wasOrderRecentlyCompleted({ orderId: 'o1', userId, now: NOW, storage }), false);
    const empty = memoryStorage();
    assert.equal(rememberCompletedOrder({ orderId: 'o1', userId, now: NOW, storage: empty }), false);
    assert.equal(empty.values.size, 0);
  }
  assert.equal(rememberCompletedOrder({ orderId: '', userId: 'u1', now: NOW, storage }), false);
  assert.equal(
    isRecentlyCompletedOrder(
      [{ orderId: 'o1', userId: 'u1', completedAt: NOW }],
      { orderId: 'o1', userId: null },
      NOW,
    ),
    false,
  );
});

test('R-01. 저장소가 막혀 있거나(접근 예외·없음) 값이 깨져 있으면 기록하지 않고 예전 문구로 남는다', () => {
  const throwing = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  assert.equal(rememberCompletedOrder({ orderId: 'o1', userId: 'u1', now: NOW, storage: throwing }), false);
  assert.equal(wasOrderRecentlyCompleted({ orderId: 'o1', userId: 'u1', now: NOW, storage: throwing }), false);
  assert.equal(rememberCompletedOrder({ orderId: 'o1', userId: 'u1', now: NOW, storage: null }), false);
  assert.equal(wasOrderRecentlyCompleted({ orderId: 'o1', userId: 'u1', now: NOW, storage: null }), false);
  // 브라우저 밖(window 없음)에서는 기본 저장소가 없다.
  assert.equal(rememberCompletedOrder({ orderId: 'o1', userId: 'u1', now: NOW }), false);
  assert.equal(wasOrderRecentlyCompleted({ orderId: 'o1', userId: 'u1', now: NOW }), false);

  for (const raw of ['not json', '{"orderId":"o1"}', 'null', '[1,"x",null]']) {
    assert.deepEqual(readRecentCompletions(raw, NOW), [], raw);
    const storage = memoryStorage({ [RECENT_COMPLETION_STORAGE_KEY]: raw });
    assert.equal(wasOrderRecentlyCompleted({ orderId: 'o1', userId: 'u1', now: NOW, storage }), false);
    // 깨진 값 위에도 새 기록은 남는다.
    assert.equal(rememberCompletedOrder({ orderId: 'o1', userId: 'u1', now: NOW, storage }), true);
    assert.equal(wasOrderRecentlyCompleted({ orderId: 'o1', userId: 'u1', now: NOW, storage }), true);
  }
  assert.deepEqual(readRecentCompletions(null, NOW), []);
  // 형식이 다른 항목만 버린다.
  assert.deepEqual(
    readRecentCompletions(
      JSON.stringify([
        { orderId: 'o1', userId: 'u1', completedAt: NOW },
        { orderId: 'o2', userId: 'u1', completedAt: 'x' },
        { orderId: '', userId: 'u1', completedAt: NOW },
      ]),
      NOW,
    ),
    [{ orderId: 'o1', userId: 'u1', completedAt: NOW }],
  );
});

test('R-01. 새 기록은 같은 주문·사용자의 이전 기록과 만료 기록을 버리고 상한까지만 남긴다', () => {
  const old = { orderId: 'old', userId: 'u1', completedAt: NOW - RECENT_COMPLETION_TTL_MS };
  const same = { orderId: 'o1', userId: 'u1', completedAt: NOW - 1000 };
  const otherUser = { orderId: 'o1', userId: 'u2', completedAt: NOW - 1000 };
  const next = addRecentCompletion([old, same, otherUser], { orderId: 'o1', userId: 'u1', completedAt: NOW }, NOW);
  assert.deepEqual(next, [otherUser, { orderId: 'o1', userId: 'u1', completedAt: NOW }]);

  const many = Array.from({ length: RECENT_COMPLETION_MAX_ENTRIES }, (_, index) => ({
    orderId: `o${index}`,
    userId: 'u1',
    completedAt: NOW,
  }));
  const capped = addRecentCompletion(many, { orderId: 'new', userId: 'u1', completedAt: NOW }, NOW);
  assert.equal(capped.length, RECENT_COMPLETION_MAX_ENTRIES);
  assert.equal(capped[0].orderId, 'o1');
  assert.equal(capped.at(-1).orderId, 'new');

  // 저장은 이 키 하나에 JSON 배열로 한다.
  const storage = memoryStorage();
  rememberCompletedOrder({ orderId: 'o1', userId: 'u1', now: NOW, storage });
  rememberCompletedOrder({ orderId: 'o1', userId: 'u1', now: NOW + 10, storage });
  assert.deepEqual(JSON.parse(storage.values.get(RECENT_COMPLETION_STORAGE_KEY)), [
    { orderId: 'o1', userId: 'u1', completedAt: NOW + 10 },
  ]);
});

test('R-01. 상세는 주문 없음일 때만 기억을 읽어 완료 안내·배송 중 탭을 고르고, 기록은 하지 않는다', () => {
  const guardAt = detailSource.indexOf('if (!order) {');
  const endAt = detailSource.indexOf('const isDelivering', guardAt);
  const block = detailSource.slice(guardAt, endAt);
  assert.match(
    block,
    /recentlyCompleted:\s*isNotFound && wasOrderRecentlyCompleted\(\{ orderId, userId: session\?\.user\.id \}\)/,
  );
  assert.match(block, /resolveDriverOrderNotFoundScreen\(\{/);
  assert.match(block, /: notFoundScreen\.message;/);
  assert.match(block, /onClick=\{\(\) => router\.replace\(notFoundScreen\.listHref\)\}/);
  // 인증 오류·조회 실패 문구와 버튼은 그대로다.
  assert.match(block, /'로그인 정보를 다시 확인해 주세요\.'/);
  assert.match(block, /'주문 정보를 불러오지 못했어요'/);
  // 기록은 사진 화면이 완료로 수렴할 때 한다(상세는 읽기만).
  assert.doesNotMatch(detailSource, /rememberCompletedOrder/);
});
