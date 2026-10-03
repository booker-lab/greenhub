import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  classifyPhotoUploadFailure,
  computeScaledSize,
  DELIVERY_PHOTO_SERVER_MAX_BYTES,
  DELIVERY_PHOTO_TARGET_MAX_BYTES,
  decideIdempotencyKey,
  isDeliveryPhotoAck,
  isUncertainPhotoUploadFailure,
  JPEG_ENCODE_STEPS,
  PHOTO_UPLOAD_MESSAGES,
  photoEncodeFailureMessage,
  photoUploadFailureMessage,
  planNextEncodeStep,
  readDriverOrderStatus,
  resolvePhotoUploadFailure,
} from './photo-upload-policy.ts';

const controllerSource = await readFile(
  new URL('../../../../../../api/src/orders/delivery-photos.controller.ts', import.meta.url),
  'utf8',
);

// ── 축소 크기 ─────────────────────────────────────────────

test('축소: 긴 변이 maxEdge를 넘으면 비율을 유지해 줄인다 (가로·세로 모두)', () => {
  assert.deepEqual(computeScaledSize(4032, 3024, 2048), { width: 2048, height: 1536 });
  assert.deepEqual(computeScaledSize(3024, 4032, 2048), { width: 1536, height: 2048 });
  assert.deepEqual(computeScaledSize(4000, 1000, 1600), { width: 1600, height: 400 });
});

test('축소: 이미 작은 사진은 확대하지 않는다', () => {
  assert.deepEqual(computeScaledSize(1280, 720, 2048), { width: 1280, height: 720 });
  assert.deepEqual(computeScaledSize(2048, 2048, 2048), { width: 2048, height: 2048 });
});

test('축소: 극단 비율도 최소 1px을 보장한다', () => {
  assert.deepEqual(computeScaledSize(100000, 10, 2048), { width: 2048, height: 1 });
});

test('축소: 잘못된 원본 크기는 null', () => {
  for (const [w, h] of [
    [0, 100],
    [100, 0],
    [-1, 100],
    [Number.NaN, 100],
    [100, Number.POSITIVE_INFINITY],
  ]) {
    assert.equal(computeScaledSize(w, h, 2048), null);
  }
});

test('인코딩 단계: 긴 변·품질이 단계마다 낮아지고 첫 단계는 1600~2048px·품질 0.8 이하', () => {
  assert.ok(JPEG_ENCODE_STEPS.length >= 2, '한 번 이상 더 낮출 단계가 있어야 한다');
  assert.ok(JPEG_ENCODE_STEPS[0].maxEdge <= 2048 && JPEG_ENCODE_STEPS[0].maxEdge >= 1600);
  assert.ok(JPEG_ENCODE_STEPS[0].quality <= 0.8);
  for (let i = 1; i < JPEG_ENCODE_STEPS.length; i += 1) {
    assert.ok(JPEG_ENCODE_STEPS[i].maxEdge < JPEG_ENCODE_STEPS[i - 1].maxEdge);
    assert.ok(JPEG_ENCODE_STEPS[i].quality < JPEG_ENCODE_STEPS[i - 1].quality);
  }
});

test('인코딩 단계: 목표 크기 이하면 accept, 넘으면 다음 단계, 마지막이면 give-up', () => {
  assert.equal(planNextEncodeStep(0, 800_000), 'accept');
  assert.equal(planNextEncodeStep(0, DELIVERY_PHOTO_TARGET_MAX_BYTES), 'accept');
  assert.equal(planNextEncodeStep(0, DELIVERY_PHOTO_TARGET_MAX_BYTES + 1), 'retry');
  assert.equal(planNextEncodeStep(JPEG_ENCODE_STEPS.length - 1, 9_000_000), 'give-up');
  assert.equal(planNextEncodeStep(0, 0), 'retry');
});

test('앱 목표 크기는 서버 한도보다 작고, 서버 한도는 컨트롤러 값과 같다', () => {
  assert.ok(DELIVERY_PHOTO_TARGET_MAX_BYTES < DELIVERY_PHOTO_SERVER_MAX_BYTES);
  assert.match(controllerSource, /const DELIVERY_PHOTO_MAX_BYTES = 5 \* 1024 \* 1024;/);
  assert.equal(DELIVERY_PHOTO_SERVER_MAX_BYTES, 5 * 1024 * 1024);
});

test('인코딩 실패 안내는 원인별로 다르다', () => {
  const messages = new Set(
    ['DECODE_FAILED', 'ENCODE_FAILED', 'TOO_LARGE'].map((reason) =>
      photoEncodeFailureMessage(reason),
    ),
  );
  assert.equal(messages.size, 3);
});

// ── 오류 분류 ─────────────────────────────────────────────

test('분류: 413은 크기 초과', () => {
  assert.equal(classifyPhotoUploadFailure({ kind: 'http', status: 413, code: null }), 'TOO_LARGE');
});

test('분류: 409·403 + STATE_CONFLICT 코드, 코드 없는 409는 상태 충돌', () => {
  for (const status of [403, 409]) {
    assert.equal(
      classifyPhotoUploadFailure({ kind: 'http', status, code: 'DRIVER_ORDER_STATE_CONFLICT' }),
      'STATE_CONFLICT',
    );
  }
  assert.equal(
    classifyPhotoUploadFailure({ kind: 'http', status: 409, code: null }),
    'STATE_CONFLICT',
  );
});

test('분류: 401·AUTHORITY_DENIED·코드 없는 403은 권한', () => {
  assert.equal(classifyPhotoUploadFailure({ kind: 'http', status: 401, code: null }), 'AUTHORITY');
  assert.equal(
    classifyPhotoUploadFailure({
      kind: 'http',
      status: 403,
      code: 'DRIVER_ORDER_AUTHORITY_DENIED',
    }),
    'AUTHORITY',
  );
  assert.equal(classifyPhotoUploadFailure({ kind: 'http', status: 403, code: null }), 'AUTHORITY');
});

test('분류: 404·NOT_FOUND 코드는 주문 없음', () => {
  assert.equal(classifyPhotoUploadFailure({ kind: 'http', status: 404, code: null }), 'NOT_FOUND');
  assert.equal(
    classifyPhotoUploadFailure({ kind: 'http', status: 404, code: 'DRIVER_ORDER_NOT_FOUND' }),
    'NOT_FOUND',
  );
});

test('분류: 5xx·408·429는 서버(불확실), 네트워크·응답 불일치도 불확실', () => {
  for (const status of [500, 502, 503, 504, 408, 429]) {
    const kind = classifyPhotoUploadFailure({ kind: 'http', status, code: null });
    assert.equal(kind, 'SERVER');
    assert.equal(isUncertainPhotoUploadFailure(kind), true);
  }
  assert.equal(classifyPhotoUploadFailure({ kind: 'network' }), 'NETWORK');
  assert.equal(classifyPhotoUploadFailure({ kind: 'ack' }), 'ACK_UNCONFIRMED');
  assert.equal(isUncertainPhotoUploadFailure('NETWORK'), true);
  assert.equal(isUncertainPhotoUploadFailure('ACK_UNCONFIRMED'), true);
});

test('분류: 그 밖의 4xx는 확정 거절', () => {
  assert.equal(classifyPhotoUploadFailure({ kind: 'http', status: 400, code: null }), 'REJECTED');
  for (const kind of ['TOO_LARGE', 'STATE_CONFLICT', 'AUTHORITY', 'NOT_FOUND', 'REJECTED']) {
    assert.equal(isUncertainPhotoUploadFailure(kind), false);
  }
});

test('안내: 원인마다 문구가 다르고 예전 뭉뚱그린 문구를 쓰지 않는다', () => {
  const kinds = [
    'TOO_LARGE',
    'NETWORK',
    'SERVER',
    'AUTHORITY',
    'NOT_FOUND',
    'REJECTED',
    'STATE_CONFLICT',
  ];
  const messages = kinds.map((kind) => photoUploadFailureMessage(kind));
  assert.equal(new Set(messages).size, kinds.length);
  for (const message of messages) assert.notEqual(message, '업로드 실패. 다시 시도해주세요.');
  // 불확실한 실패는 같은 사진 재시도를 안내한다(재촬영하면 새 키가 된다).
  assert.match(photoUploadFailureMessage('NETWORK'), /같은 사진으로 다시 시도/);
  assert.match(photoUploadFailureMessage('SERVER'), /같은 사진으로 다시 시도/);
  assert.match(photoUploadFailureMessage('ACK_UNCONFIRMED'), /같은 사진으로 다시 시도/);
  assert.match(PHOTO_UPLOAD_MESSAGES.STATE_CONFLICT_STUCK, /판매자 또는 운영팀에 연락/);
});

// ── 멱등 키 ───────────────────────────────────────────────

test('키: 처음 업로드는 새 키', () => {
  assert.equal(
    decideIdempotencyKey({ hasKey: false, photoChanged: true, lastFailure: null }),
    'renew',
  );
});

test('키: 재촬영·다른 사진은 직전 실패와 무관하게 새 키 (같은 키·다른 사진은 서버 409)', () => {
  for (const lastFailure of [null, 'NETWORK', 'SERVER', 'TOO_LARGE', 'STATE_CONFLICT']) {
    assert.equal(decideIdempotencyKey({ hasKey: true, photoChanged: true, lastFailure }), 'renew');
  }
});

test('키: 같은 사진의 불확실 실패(네트워크·5xx·응답 미확인) 재시도는 같은 키', () => {
  for (const lastFailure of ['NETWORK', 'SERVER', 'ACK_UNCONFIRMED']) {
    assert.equal(decideIdempotencyKey({ hasKey: true, photoChanged: false, lastFailure }), 'reuse');
  }
});

test('키: 같은 사진이라도 확정 거절(4xx) 뒤에는 새 키', () => {
  for (const lastFailure of ['TOO_LARGE', 'STATE_CONFLICT', 'AUTHORITY', 'NOT_FOUND', 'REJECTED']) {
    assert.equal(decideIdempotencyKey({ hasKey: true, photoChanged: false, lastFailure }), 'renew');
  }
});

// ── 실패 뒤 상태 재조회 ───────────────────────────────────

test('재조회: DELIVERED면 어떤 실패든 성공으로 수렴한다 (응답 유실)', () => {
  for (const failure of ['NETWORK', 'SERVER', 'ACK_UNCONFIRMED', 'STATE_CONFLICT', 'TOO_LARGE']) {
    assert.deepEqual(
      resolvePhotoUploadFailure({ failure, orderStatus: 'DELIVERED', finishAttempted: false }),
      { action: 'complete' },
    );
    assert.deepEqual(
      resolvePhotoUploadFailure({ failure, orderStatus: 'DELIVERED', finishAttempted: true }),
      { action: 'complete' },
    );
  }
});

test('재조회: DELIVERING + 사진 연결 충돌은 한 번만 완료 마무리를 시도하고, 실패하면 연락 안내', () => {
  assert.deepEqual(
    resolvePhotoUploadFailure({
      failure: 'STATE_CONFLICT',
      orderStatus: 'DELIVERING',
      finishAttempted: false,
    }),
    { action: 'finish-delivery' },
  );
  assert.deepEqual(
    resolvePhotoUploadFailure({
      failure: 'STATE_CONFLICT',
      orderStatus: 'DELIVERING',
      finishAttempted: true,
    }),
    { action: 'show', message: PHOTO_UPLOAD_MESSAGES.STATE_CONFLICT_STUCK },
  );
});

test('재조회: DELIVERING + 그 밖의 실패는 마무리 시도 없이 원인별 안내', () => {
  for (const failure of [
    'NETWORK',
    'SERVER',
    'ACK_UNCONFIRMED',
    'TOO_LARGE',
    'REJECTED',
    'AUTHORITY',
  ]) {
    assert.deepEqual(
      resolvePhotoUploadFailure({ failure, orderStatus: 'DELIVERING', finishAttempted: false }),
      { action: 'show', message: photoUploadFailureMessage(failure) },
    );
  }
});

test('재조회: 다른 상태(보류·취소 등)는 상태 변경 안내', () => {
  for (const orderStatus of ['DELIVERY_HELD', 'CANCELLED', 'PREPARING']) {
    assert.deepEqual(
      resolvePhotoUploadFailure({ failure: 'STATE_CONFLICT', orderStatus, finishAttempted: false }),
      { action: 'show', message: PHOTO_UPLOAD_MESSAGES.STATUS_CHANGED },
    );
  }
});

test('재조회 실패(null)는 성공을 추론하지 않고 원인 안내 + 상태 미확인 표시', () => {
  const resolution = resolvePhotoUploadFailure({
    failure: 'NETWORK',
    orderStatus: null,
    finishAttempted: false,
  });
  assert.equal(resolution.action, 'show');
  assert.equal(
    resolution.message,
    photoUploadFailureMessage('NETWORK') + PHOTO_UPLOAD_MESSAGES.STATUS_UNKNOWN_SUFFIX,
  );
});

// ── 응답 판독 ─────────────────────────────────────────────

test('업로드 ACK: orderId·photoId·DELIVERED가 모두 맞아야 성공', () => {
  assert.equal(
    isDeliveryPhotoAck({ orderId: 'o1', photoId: 'p1', status: 'DELIVERED' }, 'o1'),
    true,
  );
  assert.equal(
    isDeliveryPhotoAck({ orderId: 'o2', photoId: 'p1', status: 'DELIVERED' }, 'o1'),
    false,
  );
  assert.equal(
    isDeliveryPhotoAck({ orderId: 'o1', photoId: '', status: 'DELIVERED' }, 'o1'),
    false,
  );
  assert.equal(isDeliveryPhotoAck({ orderId: 'o1', status: 'DELIVERED' }, 'o1'), false);
  assert.equal(
    isDeliveryPhotoAck({ orderId: 'o1', photoId: 'p1', status: 'DELIVERING' }, 'o1'),
    false,
  );
  assert.equal(isDeliveryPhotoAck(null, 'o1'), false);
  assert.equal(isDeliveryPhotoAck('ok', 'o1'), false);
});

test('주문 재조회: 같은 주문의 문자열 상태만 읽는다', () => {
  assert.equal(readDriverOrderStatus({ id: 'o1', status: 'DELIVERED' }, 'o1'), 'DELIVERED');
  assert.equal(readDriverOrderStatus({ id: 'o2', status: 'DELIVERED' }, 'o1'), null);
  assert.equal(readDriverOrderStatus({ id: 'o1', status: 3 }, 'o1'), null);
  assert.equal(readDriverOrderStatus(null, 'o1'), null);
});
