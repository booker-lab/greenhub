import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimPendingPhotoLease,
  createPendingPhotoEntry,
  decidePendingPhotoOutcome,
  expirePendingPhoto,
  isPendingPhotoDue,
  isPendingPhotoStaleForOrderStatus,
  isUncertainPendingSendFailure,
  nextPendingPhotoWakeAt,
  PENDING_PHOTO_BACKOFF_MS,
  PENDING_PHOTO_LEASE_MS,
  PENDING_PHOTO_MAX_AGE_MS,
  PENDING_PHOTO_MESSAGES,
  PENDING_PHOTO_MIN_RESEND_GAP_MS,
  partitionPendingPhotosByUser,
  pendingPhotoBackoffMs,
  pendingPhotoBadgeKind,
  pendingPhotoBannerTitle,
  pendingPhotoKey,
  pendingPhotoLockName,
  pendingPhotoManualReadyAt,
  pendingPhotoStaleOrderIds,
  pendingPhotoStatusMessage,
  readPendingPhotoEntry,
  recordPendingPhotoSend,
  shouldEnqueuePendingPhoto,
  toPendingPhotoSummary,
} from './pending-photo-policy.ts';
import { isUncertainPhotoUploadFailure, PHOTO_UPLOAD_MESSAGES } from './photo-upload-policy.ts';

const NOW = Date.UTC(2026, 10, 13, 9, 0, 0);
const KEY = '0f8c2a4e-6d1b-4c3a-9e2f-7a5b8c9d0e1f';
const ALL_KINDS = [
  'NETWORK',
  'SERVER',
  'ACK_UNCONFIRMED',
  'TOO_LARGE',
  'STATE_CONFLICT',
  'AUTHORITY',
  'NOT_FOUND',
  'REJECTED',
];

function bytes(size = 16) {
  return new Uint8Array(size).fill(7).buffer;
}

function entry(overrides = {}) {
  return {
    v: 1,
    userId: 'driver-1',
    orderId: 'order-1',
    storeId: 'store-1',
    idempotencyKey: KEY,
    bytes: bytes(),
    createdAt: NOW,
    attempts: 1,
    lastAttemptAt: NOW,
    lastFailure: 'NETWORK',
    state: 'waiting',
    nextAttemptAt: NOW + 30_000,
    leaseUntil: 0,
    ...overrides,
  };
}

test('저장 키·잠금 이름은 사용자·주문 단위다', () => {
  assert.equal(pendingPhotoKey('driver-1', 'order-1'), 'driver-1:order-1');
  assert.equal(pendingPhotoLockName('order-1'), 'pending-photo:order-1');
});

test('대기열에는 보내기 전 실패와 불확실한 결과만 넣는다(확정 거절은 화면 안내 그대로)', () => {
  assert.equal(shouldEnqueuePendingPhoto({ phase: 'pre-send', reason: 'OFFLINE' }), true);
  assert.equal(shouldEnqueuePendingPhoto({ phase: 'pre-send', reason: 'ORDER_UNKNOWN' }), true);
  for (const kind of ALL_KINDS) {
    assert.equal(
      shouldEnqueuePendingPhoto({ phase: 'sent', failure: kind }),
      ['NETWORK', 'SERVER', 'ACK_UNCONFIRMED'].includes(kind),
      kind,
    );
    // 불확실 판정은 사진 화면 판정(photo-upload-policy)과 같다.
    assert.equal(isUncertainPendingSendFailure(kind), isUncertainPhotoUploadFailure(kind), kind);
  }
});

test('새 항목은 보낸 키·바이트를 그대로 두고 불확실 결과면 30초 이후에 처음 다시 보낸다', () => {
  const photo = bytes(32);
  const sent = createPendingPhotoEntry({
    userId: 'driver-1',
    orderId: 'order-1',
    storeId: 'store-1',
    idempotencyKey: KEY,
    bytes: photo,
    now: NOW,
    random: 0,
    input: { phase: 'sent', failure: 'NETWORK' },
  });
  assert.ok(sent);
  assert.equal(sent.bytes, photo);
  assert.equal(sent.idempotencyKey, KEY);
  assert.equal(sent.attempts, 1);
  assert.equal(sent.lastAttemptAt, NOW);
  assert.equal(sent.state, 'waiting');
  assert.equal(sent.nextAttemptAt, NOW + 30_000);
  assert.equal(sent.leaseUntil, 0);

  const offline = createPendingPhotoEntry({
    userId: 'driver-1',
    orderId: 'order-1',
    storeId: null,
    idempotencyKey: KEY,
    bytes: photo,
    now: NOW,
    random: 0.5,
    input: { phase: 'pre-send', reason: 'OFFLINE' },
  });
  assert.equal(offline.storeId, null);
  assert.equal(offline.attempts, 0);
  assert.equal(offline.lastAttemptAt, 0);
  assert.equal(offline.nextAttemptAt, NOW);

  // 확정 거절은 항목을 만들지 않는다.
  assert.equal(
    createPendingPhotoEntry({
      userId: 'driver-1',
      orderId: 'order-1',
      storeId: 'store-1',
      idempotencyKey: KEY,
      bytes: photo,
      now: NOW,
      random: 0,
      input: { phase: 'sent', failure: 'STATE_CONFLICT' },
    }),
    null,
  );
  // 형식이 맞지 않는 키·주문 ID면 만들지 않는다.
  assert.equal(
    createPendingPhotoEntry({
      userId: 'driver-1',
      orderId: 'order/1',
      storeId: 'store-1',
      idempotencyKey: KEY,
      bytes: photo,
      now: NOW,
      random: 0,
      input: { phase: 'sent', failure: 'NETWORK' },
    }),
    null,
  );
});

test('재시도 간격은 30초·1분·2분·5분 상한이고 흔들림은 더하기만 한다', () => {
  assert.deepEqual(PENDING_PHOTO_BACKOFF_MS, [30_000, 60_000, 120_000, 300_000]);
  assert.equal(pendingPhotoBackoffMs(0, 0), 30_000);
  assert.equal(pendingPhotoBackoffMs(1, 0), 60_000);
  assert.equal(pendingPhotoBackoffMs(2, 0), 120_000);
  assert.equal(pendingPhotoBackoffMs(3, 0), 300_000);
  assert.equal(pendingPhotoBackoffMs(50, 0), 300_000);
  assert.equal(pendingPhotoBackoffMs(0, 1), 36_000);
  assert.equal(pendingPhotoBackoffMs(3, 1), 360_000);
  for (const random of [-1, 2, Number.NaN]) {
    const value = pendingPhotoBackoffMs(0, random);
    assert.ok(value >= 30_000 && value <= 36_000, String(random));
  }
});

test('깨진 항목은 버린다(fail-closed)', () => {
  assert.ok(readPendingPhotoEntry(entry()));
  assert.ok(readPendingPhotoEntry(entry(), 'driver-1:order-1'));
  const broken = [
    null,
    'x',
    entry({ v: 2 }),
    entry({ userId: '' }),
    entry({ orderId: '../order' }),
    entry({ orderId: 'a:b' }),
    entry({ storeId: 'store/1' }),
    entry({ idempotencyKey: 'short' }),
    entry({ idempotencyKey: 'bad key with spaces' }),
    entry({ bytes: null }),
    entry({ bytes: new ArrayBuffer(0) }),
    entry({ bytes: new Uint8Array(4) }),
    entry({ bytes: new ArrayBuffer(5 * 1024 * 1024 + 1) }),
    entry({ state: 'done' }),
    entry({ lastFailure: 'AUTHORITY' }),
    entry({ lastFailure: 'WHATEVER' }),
    entry({ state: 'failed', lastFailure: 'AUTHORITY' }), // 멈춘 항목에 바이트가 남아 있다
    entry({ state: 'failed', bytes: null, lastFailure: 'NETWORK' }),
    entry({ attempts: -1 }),
    entry({ attempts: 1.5 }),
    entry({ createdAt: Number.NaN }),
    entry({ nextAttemptAt: '1' }),
    entry({ leaseUntil: undefined }),
    entry({ lastAttemptAt: Number.POSITIVE_INFINITY }),
  ];
  for (const value of broken)
    assert.equal(readPendingPhotoEntry(value), null, JSON.stringify(value));
  // 저장 키가 사용자·주문과 다르면 버린다.
  assert.equal(readPendingPhotoEntry(entry(), 'driver-2:order-1'), null);
  // 멈춘 항목은 바이트 없이 유효하다.
  assert.ok(readPendingPhotoEntry(entry({ state: 'failed', bytes: null, lastFailure: 'EXPIRED' })));
  // 토큰 같은 모르는 필드는 읽은 항목에 남기지 않는다.
  const read = readPendingPhotoEntry({ ...entry(), accessToken: 'secret', address: '어딘가' });
  assert.equal('accessToken' in read, false);
  assert.equal('address' in read, false);
  assert.equal('bytes' in toPendingPhotoSummary(read), false);
});

test('ACK는 끝, 불확실은 간격을 두고 다시(보낸 횟수 증가), 확정 거절은 멈추고 바이트를 지운다', () => {
  assert.deepEqual(
    decidePendingPhotoOutcome({ entry: entry(), result: { kind: 'ack' }, now: NOW, random: 0 }),
    { action: 'done' },
  );

  for (const failure of ['NETWORK', 'SERVER', 'ACK_UNCONFIRMED']) {
    const outcome = decidePendingPhotoOutcome({
      entry: entry({ attempts: 2 }),
      result: { kind: 'failure', failure, status: failure === 'NETWORK' ? null : 503 },
      now: NOW,
      random: 0,
    });
    assert.equal(outcome.action, 'retry');
    assert.equal(outcome.entry.attempts, 3);
    assert.equal(outcome.entry.lastAttemptAt, NOW);
    assert.equal(outcome.entry.lastFailure, failure);
    assert.equal(outcome.entry.nextAttemptAt, NOW + 120_000);
    assert.equal(outcome.entry.state, 'waiting');
    assert.equal(outcome.entry.idempotencyKey, KEY);
    assert.ok(outcome.entry.bytes);
  }

  const terminal = [
    [{ failure: 'AUTHORITY', status: 403 }, 'AUTHORITY', PENDING_PHOTO_MESSAGES.AUTHORITY],
    [{ failure: 'NOT_FOUND', status: 404 }, 'NOT_FOUND', PHOTO_UPLOAD_MESSAGES.NOT_FOUND],
    [{ failure: 'TOO_LARGE', status: 413 }, 'TOO_LARGE', PHOTO_UPLOAD_MESSAGES.TOO_LARGE],
    [{ failure: 'REJECTED', status: 400 }, 'REJECTED', PHOTO_UPLOAD_MESSAGES.REJECTED],
  ];
  for (const [result, failure, message] of terminal) {
    const outcome = decidePendingPhotoOutcome({
      entry: entry(),
      result: { kind: 'failure', ...result },
      now: NOW,
      random: 0,
    });
    assert.equal(outcome.action, 'fail', failure);
    assert.equal(outcome.entry.state, 'failed');
    assert.equal(outcome.entry.bytes, null);
    assert.equal(outcome.entry.lastFailure, failure);
    assert.ok(readPendingPhotoEntry(outcome.entry));
    assert.equal(pendingPhotoStatusMessage(outcome.entry, NOW), message);
  }
  assert.equal(PENDING_PHOTO_MESSAGES.AUTHORITY, '처리 권한이 없어요');
});

test('401은 같은 사용자의 유효한 세션을 기다리며 멈춘다(SESSION)', () => {
  const outcome = decidePendingPhotoOutcome({
    entry: entry({ attempts: 1 }),
    result: { kind: 'failure', failure: 'AUTHORITY', status: 401 },
    now: NOW,
    random: 0,
  });
  assert.equal(outcome.action, 'retry');
  assert.equal(outcome.entry.lastFailure, 'SESSION');
  assert.ok(outcome.entry.bytes);
  assert.equal(pendingPhotoStatusMessage(outcome.entry, NOW), PENDING_PHOTO_MESSAGES.SESSION);
});

test('불확실한 요청 뒤 상태 충돌은 30초 이후 한 번만 확인 재전송하고, 그래도 충돌이면 멈춘다', () => {
  const first = decidePendingPhotoOutcome({
    entry: entry({ attempts: 1, lastFailure: 'NETWORK' }),
    result: { kind: 'failure', failure: 'STATE_CONFLICT', status: 409 },
    now: NOW,
    random: 0,
  });
  assert.equal(first.action, 'retry');
  assert.equal(first.entry.lastFailure, 'CONFLICT_UNCONFIRMED');
  assert.ok(first.entry.nextAttemptAt - NOW >= PENDING_PHOTO_MIN_RESEND_GAP_MS);
  assert.ok(first.entry.bytes);

  const second = decidePendingPhotoOutcome({
    entry: first.entry,
    result: { kind: 'failure', failure: 'STATE_CONFLICT', status: 409 },
    now: first.entry.nextAttemptAt,
    random: 0,
  });
  assert.equal(second.action, 'fail');
  assert.equal(second.entry.lastFailure, 'STATE_CONFLICT');
  assert.equal(second.entry.bytes, null);
  assert.equal(
    pendingPhotoStatusMessage(second.entry, NOW),
    '주문 상태가 바뀌었어요. 목록에서 확인해 주세요',
  );

  // 확인 재전송이 ACK면 끝난다(겹친 같은 키 요청이 완료했다).
  assert.deepEqual(
    decidePendingPhotoOutcome({ entry: first.entry, result: { kind: 'ack' }, now: NOW, random: 0 }),
    { action: 'done' },
  );

  // 앞서 서버로 보낸 요청이 없었으면(보내기 전 실패로 넣은 항목) 바로 멈춘다.
  const fresh = decidePendingPhotoOutcome({
    entry: entry({ attempts: 0, lastAttemptAt: 0, lastFailure: 'OFFLINE' }),
    result: { kind: 'failure', failure: 'STATE_CONFLICT', status: 403 },
    now: NOW,
    random: 0,
  });
  assert.equal(fresh.action, 'fail');
});

test('12시간이 지나면 멈추고 바이트를 지운다. 다른 실행이 보내는 중이면 두고 본다', () => {
  const old = entry({ createdAt: NOW - PENDING_PHOTO_MAX_AGE_MS });
  const expired = expirePendingPhoto(old, NOW);
  assert.equal(expired.state, 'failed');
  assert.equal(expired.lastFailure, 'EXPIRED');
  assert.equal(expired.bytes, null);
  assert.equal(
    pendingPhotoStatusMessage(expired, NOW),
    '올리지 못한 채 12시간이 지났어요. 주문 화면에서 확인해 주세요',
  );
  assert.equal(
    expirePendingPhoto(entry({ createdAt: NOW - PENDING_PHOTO_MAX_AGE_MS + 1 }), NOW),
    null,
  );
  assert.equal(
    expirePendingPhoto({ ...old, state: 'sending', leaseUntil: NOW + 1_000 }, NOW),
    null,
  );
  assert.equal(expirePendingPhoto(expired, NOW), null);
  // 시계가 되돌아가 만든 시각이 미래여도 만료로 보지 않는다.
  assert.equal(expirePendingPhoto(entry({ createdAt: NOW + 60_000 }), NOW), null);
});

test('보낼 차례·보내는 중 표시·지금 올리기 가능 시각', () => {
  assert.equal(isPendingPhotoDue(entry({ nextAttemptAt: NOW }), NOW), true);
  assert.equal(isPendingPhotoDue(entry({ nextAttemptAt: NOW + 1 }), NOW), false);
  assert.equal(isPendingPhotoDue(entry({ state: 'sending', leaseUntil: NOW + 1 }), NOW), false);
  assert.equal(isPendingPhotoDue(entry({ state: 'sending', leaseUntil: NOW }), NOW), true);
  assert.equal(
    isPendingPhotoDue(entry({ state: 'failed', bytes: null, lastFailure: 'AUTHORITY' }), NOW),
    false,
  );

  // 지금 올리기: 간격은 건너뛰지만 불확실한 요청 뒤 30초는 지키고, 충돌 확인은 예정 시각을 지킨다.
  assert.equal(pendingPhotoManualReadyAt(entry({ lastAttemptAt: 0, attempts: 0 })), 0);
  assert.equal(pendingPhotoManualReadyAt(entry({ lastAttemptAt: NOW })), NOW + 30_000);
  assert.equal(
    pendingPhotoManualReadyAt(
      entry({ lastFailure: 'CONFLICT_UNCONFIRMED', nextAttemptAt: NOW + 45_000 }),
    ),
    NOW + 45_000,
  );
});

test('보내는 중 표시는 살아 있으면 잡지 않고, 탭 사이 잠금을 쥐었으면 남은 표시를 이어받는다', () => {
  const claimed = claimPendingPhotoLease(entry(), NOW, { lockHeld: false });
  assert.equal(claimed.state, 'sending');
  assert.equal(claimed.leaseUntil, NOW + PENDING_PHOTO_LEASE_MS);
  assert.equal(claimPendingPhotoLease(claimed, NOW + 1_000, { lockHeld: false }), null);
  assert.ok(claimPendingPhotoLease(claimed, NOW + 1_000, { lockHeld: true }));
  assert.ok(claimPendingPhotoLease(claimed, NOW + PENDING_PHOTO_LEASE_MS, { lockHeld: false }));
  assert.equal(
    claimPendingPhotoLease(entry({ state: 'failed', bytes: null, lastFailure: 'EXPIRED' }), NOW, {
      lockHeld: true,
    }),
    null,
  );
});

test('사용자별로 나누고, 다음 깨울 시각은 기다리는 항목만 본다', () => {
  const mine = entry();
  const other = entry({ userId: 'driver-2' });
  assert.deepEqual(partitionPendingPhotosByUser([mine, other], 'driver-1'), {
    mine: [mine],
    others: [other],
  });
  assert.equal(nextPendingPhotoWakeAt([]), null);
  assert.equal(
    nextPendingPhotoWakeAt([
      entry({ nextAttemptAt: NOW + 60_000 }),
      entry({ state: 'sending', leaseUntil: NOW + 10_000 }),
      entry({ state: 'failed', bytes: null, lastFailure: 'AUTHORITY', nextAttemptAt: NOW }),
    ]),
    NOW + 10_000,
  );
});

test('배지·안내 문구', () => {
  assert.equal(pendingPhotoBadgeKind(entry(), NOW), 'waiting');
  assert.equal(
    pendingPhotoBadgeKind(entry({ state: 'sending', leaseUntil: NOW + 1 }), NOW),
    'sending',
  );
  // 끝난 보내는 중 표시(닫힌 탭)는 대기로 보인다.
  assert.equal(pendingPhotoBadgeKind(entry({ state: 'sending', leaseUntil: NOW }), NOW), 'waiting');
  assert.equal(
    pendingPhotoBadgeKind(entry({ state: 'failed', bytes: null, lastFailure: 'AUTHORITY' }), NOW),
    'failed',
  );
  assert.equal(
    PENDING_PHOTO_MESSAGES.ENQUEUED,
    '사진을 휴대폰에 저장했어요. 신호가 잡히면 앱이 자동으로 올려요. 앱을 열어 두면 더 빨리 올라가요.',
  );
  assert.equal(PENDING_PHOTO_MESSAGES.COMPLETED, '배송 완료 사진을 올렸어요');
  assert.equal(pendingPhotoBannerTitle(3), '처리 중인 사진 3건');
  assert.equal(pendingPhotoStatusMessage(entry(), NOW), PENDING_PHOTO_MESSAGES.WAITING);
  // 화면 안내와 같은 문구를 쓴다.
  assert.equal(PENDING_PHOTO_MESSAGES.NOT_FOUND, PHOTO_UPLOAD_MESSAGES.NOT_FOUND);
  assert.equal(PENDING_PHOTO_MESSAGES.TOO_LARGE, PHOTO_UPLOAD_MESSAGES.TOO_LARGE);
  assert.equal(PENDING_PHOTO_MESSAGES.REJECTED, PHOTO_UPLOAD_MESSAGES.REJECTED);
});

test('촬영 때 본 보류 표시(expectedHoldAt)는 항목에 남고, 없는 이전 항목은 그대로 읽는다(형식 버전 그대로)', () => {
  const legacy = readPendingPhotoEntry(entry());
  assert.ok(legacy);
  assert.equal('expectedHoldAt' in legacy, false);
  assert.equal(readPendingPhotoEntry(entry({ expectedHoldAt: null }))?.expectedHoldAt, null);
  assert.equal(
    readPendingPhotoEntry(entry({ expectedHoldAt: '2026-11-13T08:00:00.000Z' }))?.expectedHoldAt,
    '2026-11-13T08:00:00.000Z',
  );
  for (const broken of ['', 7, 'x'.repeat(41), {}]) {
    assert.equal(readPendingPhotoEntry(entry({ expectedHoldAt: broken })), null, String(broken));
  }
  const created = createPendingPhotoEntry({
    userId: 'driver-1',
    orderId: 'order-1',
    storeId: 'store-1',
    idempotencyKey: KEY,
    bytes: bytes(),
    now: NOW,
    random: 0,
    input: { phase: 'sent', failure: 'NETWORK' },
    expectedHoldAt: null,
  });
  assert.equal(created?.expectedHoldAt, null);
  const unknown = createPendingPhotoEntry({
    userId: 'driver-1',
    orderId: 'order-1',
    storeId: 'store-1',
    idempotencyKey: KEY,
    bytes: bytes(),
    now: NOW,
    random: 0,
    input: { phase: 'pre-send', reason: 'OFFLINE' },
  });
  assert.equal(unknown && 'expectedHoldAt' in unknown, false);
});

test('촬영 뒤 새 보류로 거절(STALE_HOLD)되면 다시 보내지 않고 바이트를 지운 채 멈춘다', () => {
  const outcome = decidePendingPhotoOutcome({
    entry: entry({ attempts: 2 }),
    result: { kind: 'failure', failure: 'STALE_HOLD', status: 409 },
    now: NOW,
    random: 0,
  });
  assert.equal(outcome.action, 'fail');
  assert.equal(outcome.entry.state, 'failed');
  assert.equal(outcome.entry.lastFailure, 'STALE_HOLD');
  assert.equal(outcome.entry.bytes, null);
  // 멈춘 STALE_HOLD 항목도 저장소에서 다시 읽힌다.
  assert.ok(readPendingPhotoEntry(outcome.entry));
  assert.equal(
    pendingPhotoStatusMessage(outcome.entry, NOW),
    '보류 뒤 다시 배송 중이라 예전 사진은 쓸 수 없어요. 사진을 다시 찍어 주세요.',
  );
  assert.equal(PENDING_PHOTO_MESSAGES.STALE_HOLD, PHOTO_UPLOAD_MESSAGES.STALE_HOLD);
});

test('주문 조회가 보류·수거 대기로 보인 대기 항목만 멈출 대상이다(완료·배송 중·멈춘 항목은 아니다)', () => {
  assert.equal(isPendingPhotoStaleForOrderStatus('DELIVERY_HELD'), true);
  assert.equal(isPendingPhotoStaleForOrderStatus('PREPARING'), true);
  for (const status of ['DELIVERING', 'DELIVERED', 'REVIEWED', undefined, null]) {
    assert.equal(isPendingPhotoStaleForOrderStatus(status), false, String(status));
  }
  const entries = [
    entry({ orderId: 'held' }),
    entry({ orderId: 'prep', state: 'sending', leaseUntil: NOW + 1 }),
    entry({ orderId: 'delivering' }),
    entry({ orderId: 'done' }),
    entry({ orderId: 'gone' }),
    entry({ orderId: 'held-failed', state: 'failed', bytes: null, lastFailure: 'EXPIRED' }),
  ].map(toPendingPhotoSummary);
  assert.deepEqual(
    pendingPhotoStaleOrderIds(entries, [
      { id: 'held', status: 'DELIVERY_HELD' },
      { id: 'prep', status: 'PREPARING' },
      { id: 'delivering', status: 'DELIVERING' },
      { id: 'done', status: 'DELIVERED' },
      { id: 'held-failed', status: 'DELIVERY_HELD' },
    ]),
    ['held', 'prep'],
  );
});

test('보내기 직전 기록은 보내는 중 항목에만 보낸 횟수·마지막 보낸 시각을 남긴다', () => {
  const sending = entry({
    state: 'sending',
    leaseUntil: NOW + PENDING_PHOTO_LEASE_MS,
    attempts: 1,
  });
  const recorded = recordPendingPhotoSend(sending, NOW + 5);
  assert.equal(recorded?.attempts, 2);
  assert.equal(recorded?.lastAttemptAt, NOW + 5);
  assert.equal(recorded?.state, 'sending');
  assert.equal(recordPendingPhotoSend(entry(), NOW), null);
});
