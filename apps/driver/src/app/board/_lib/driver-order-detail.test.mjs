import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildDriverOrderDetailScope,
  classifyDriverOrderCommandError,
  classifyDriverOrderReadError,
  DriverOrderReadError,
  isDriverOrderCommandAuthLoss,
  isDriverOrderCommandContinuationCurrent,
  isDriverOrderStatusAck,
  readDriverOrderCommandErrorCodeFromResponse,
  readDriverOrderErrorCode,
  toDriverOrderNetworkError,
  toDriverOrderReadError,
} from './driver-order-detail.ts';

test('404은 NOT_FOUND로 분류한다', () => {
  assert.equal(classifyDriverOrderReadError(404), 'NOT_FOUND');
  assert.equal(toDriverOrderReadError(404).kind, 'NOT_FOUND');
});

test('401·403은 AUTH_ERROR로 분류한다', () => {
  assert.equal(classifyDriverOrderReadError(401), 'AUTH_ERROR');
  assert.equal(classifyDriverOrderReadError(403), 'AUTH_ERROR');
  assert.equal(toDriverOrderReadError(401).kind, 'AUTH_ERROR');
  assert.equal(toDriverOrderReadError(403).kind, 'AUTH_ERROR');
});

test('5xx·기타 non-ok는 FETCH_ERROR로 분류한다', () => {
  for (const status of [400, 429, 500, 502, 503]) {
    assert.equal(classifyDriverOrderReadError(status), 'FETCH_ERROR');
    assert.equal(toDriverOrderReadError(status).kind, 'FETCH_ERROR');
  }
});

test('network exception은 FETCH_ERROR가 된다', () => {
  const error = toDriverOrderNetworkError();
  assert.ok(error instanceof DriverOrderReadError);
  assert.equal(error.kind, 'FETCH_ERROR');
  assert.equal(error.status, null);
});

test('semantic ACK: orderId와 status가 모두 일치해야 true', () => {
  assert.equal(
    isDriverOrderStatusAck({ orderId: 'o1', status: 'DELIVERING' }, 'o1', 'DELIVERING'),
    true,
  );
});

test('semantic ACK: orderId 불일치는 false', () => {
  assert.equal(
    isDriverOrderStatusAck({ orderId: 'other', status: 'DELIVERING' }, 'o1', 'DELIVERING'),
    false,
  );
});

test('semantic ACK: status 불일치는 false', () => {
  assert.equal(
    isDriverOrderStatusAck({ orderId: 'o1', status: 'PREPARING' }, 'o1', 'DELIVERING'),
    false,
  );
});

test('detail scope는 orderId·user·role·token을 모두 구분한다', () => {
  const base = { orderId: 'o1', userId: 'u1', role: 'driver', token: 't1' };
  assert.equal(buildDriverOrderDetailScope(base), buildDriverOrderDetailScope(base));
  assert.notEqual(
    buildDriverOrderDetailScope(base),
    buildDriverOrderDetailScope({ ...base, orderId: 'o2' }),
  );
  assert.notEqual(
    buildDriverOrderDetailScope(base),
    buildDriverOrderDetailScope({ ...base, userId: 'u2' }),
  );
  assert.notEqual(
    buildDriverOrderDetailScope(base),
    buildDriverOrderDetailScope({ ...base, role: 'admin' }),
  );
  assert.notEqual(
    buildDriverOrderDetailScope(base),
    buildDriverOrderDetailScope({ ...base, token: 't2' }),
  );
  assert.notEqual(
    buildDriverOrderDetailScope(base),
    buildDriverOrderDetailScope({ orderId: 'o1', userId: null, role: null, token: null }),
  );
});

test('command 401·403만 authority loss다 (legacy fail-closed fallback)', () => {
  assert.equal(isDriverOrderCommandAuthLoss(401), true);
  assert.equal(isDriverOrderCommandAuthLoss(403), true);
  for (const status of [404, 409, 422, 500]) {
    assert.equal(isDriverOrderCommandAuthLoss(status), false);
  }
});

test('command continuation은 동일 seq·scope일 때만 current다', () => {
  const scope = buildDriverOrderDetailScope({
    orderId: 'o1',
    userId: 'u1',
    role: 'driver',
    token: 't1',
  });
  const other = buildDriverOrderDetailScope({
    orderId: 'o1',
    userId: 'u2',
    role: 'driver',
    token: 't2',
  });
  assert.equal(
    isDriverOrderCommandContinuationCurrent({
      snapshotSeq: 1,
      snapshotScope: scope,
      currentSeq: 1,
      currentScope: scope,
    }),
    true,
  );
  assert.equal(
    isDriverOrderCommandContinuationCurrent({
      snapshotSeq: 1,
      snapshotScope: scope,
      currentSeq: 2,
      currentScope: scope,
    }),
    false,
  );
  assert.equal(
    isDriverOrderCommandContinuationCurrent({
      snapshotSeq: 1,
      snapshotScope: scope,
      currentSeq: 1,
      currentScope: other,
    }),
    false,
  );
  assert.equal(
    isDriverOrderCommandContinuationCurrent({
      snapshotSeq: 1,
      snapshotScope: scope,
      currentSeq: 1,
      currentScope: null,
    }),
    false,
  );
});

// DRIVER-DETAIL-COMMAND-ERROR-CODE-CLIENT-CONVERGENCE-01 pure contract.
// status + stable error-code → client recovery classification.

// 1. 401 → AUTHORITY_LOSS (code 무관).
test('1. 401은 code와 무관하게 AUTHORITY_LOSS다', () => {
  assert.equal(classifyDriverOrderCommandError({ status: 401, code: null }), 'AUTHORITY_LOSS');
  assert.equal(
    classifyDriverOrderCommandError({ status: 401, code: 'DRIVER_ORDER_STATE_CONFLICT' }),
    'AUTHORITY_LOSS',
  );
  assert.equal(
    classifyDriverOrderCommandError({ status: 401, code: 'DRIVER_ORDER_AUTHORITY_DENIED' }),
    'AUTHORITY_LOSS',
  );
  assert.equal(
    classifyDriverOrderCommandError({ status: 401, code: 'DRIVER_ORDER_NOT_FOUND' }),
    'AUTHORITY_LOSS',
  );
});

// 2. 403 + AUTHORITY_DENIED → AUTHORITY_LOSS.
test('2. 403 + DRIVER_ORDER_AUTHORITY_DENIED는 AUTHORITY_LOSS다', () => {
  assert.equal(
    classifyDriverOrderCommandError({ status: 403, code: 'DRIVER_ORDER_AUTHORITY_DENIED' }),
    'AUTHORITY_LOSS',
  );
});

// 3. 403 + STATE_CONFLICT → STATE_CONFLICT (auth-loss 아님).
test('3. 403 + DRIVER_ORDER_STATE_CONFLICT는 STATE_CONFLICT이며 auth-loss가 아니다', () => {
  assert.equal(
    classifyDriverOrderCommandError({ status: 403, code: 'DRIVER_ORDER_STATE_CONFLICT' }),
    'STATE_CONFLICT',
  );
  assert.notEqual(
    classifyDriverOrderCommandError({ status: 403, code: 'DRIVER_ORDER_STATE_CONFLICT' }),
    'AUTHORITY_LOSS',
  );
});

// 4. 409 + STATE_CONFLICT → STATE_CONFLICT.
test('4. 409 + DRIVER_ORDER_STATE_CONFLICT는 STATE_CONFLICT다', () => {
  assert.equal(
    classifyDriverOrderCommandError({ status: 409, code: 'DRIVER_ORDER_STATE_CONFLICT' }),
    'STATE_CONFLICT',
  );
});

// 5. 404 + NOT_FOUND → NOT_FOUND.
test('5. 404 + DRIVER_ORDER_NOT_FOUND는 NOT_FOUND다', () => {
  assert.equal(
    classifyDriverOrderCommandError({ status: 404, code: 'DRIVER_ORDER_NOT_FOUND' }),
    'NOT_FOUND',
  );
});

// 6. unknown/missing-code 403 → fail-closed AUTHORITY_LOSS.
test('6. code 없는 unknown 403은 fail-closed AUTHORITY_LOSS다', () => {
  assert.equal(classifyDriverOrderCommandError({ status: 403, code: null }), 'AUTHORITY_LOSS');
  assert.equal(
    classifyDriverOrderCommandError({ status: 403, code: undefined }),
    'AUTHORITY_LOSS',
  );
  assert.equal(classifyDriverOrderCommandError({ status: 403, code: 'SOME_UNKNOWN' }), 'AUTHORITY_LOSS');
  assert.equal(classifyDriverOrderCommandError({ status: 403, code: '' }), 'AUTHORITY_LOSS');
});

// 7. malformed error body → crash 없음, null, 자동 resend 없음 (분류는 fail-closed).
test('7. malformed error body는 null이며 crash 없이 fail-closed 분류한다', async () => {
  assert.equal(readDriverOrderErrorCode(null), null);
  assert.equal(readDriverOrderErrorCode(undefined), null);
  assert.equal(readDriverOrderErrorCode('FORBIDDEN'), null);
  assert.equal(readDriverOrderErrorCode(403), null);
  assert.equal(readDriverOrderErrorCode({}), null);
  assert.equal(readDriverOrderErrorCode({ code: null }), null);
  assert.equal(readDriverOrderErrorCode({ code: 403 }), null);
  assert.equal(readDriverOrderErrorCode({ code: 'UNKNOWN_CODE' }), null);
  assert.equal(
    readDriverOrderErrorCode({ code: 'DRIVER_ORDER_AUTHORITY_DENIED' }),
    'DRIVER_ORDER_AUTHORITY_DENIED',
  );
  // Response json 파싱 실패도 throw 없이 null이다.
  const malformed = { json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } };
  assert.equal(await readDriverOrderCommandErrorCodeFromResponse(malformed), null);
  const emptyThrow = { json: async () => { throw new Error('empty body'); } };
  assert.equal(
    classifyDriverOrderCommandError({
      status: 409,
      code: await readDriverOrderCommandErrorCodeFromResponse(emptyThrow),
    }),
    'UNCERTAIN',
  );
  // 403 malformed는 authority protection을 낮추지 않는다.
  assert.equal(
    classifyDriverOrderCommandError({
      status: 403,
      code: await readDriverOrderCommandErrorCodeFromResponse(malformed),
    }),
    'AUTHORITY_LOSS',
  );
});

// 404 body 미판독/코드 없음은 새로운 성공 의미를 추론하지 않는다 (UNCERTAIN).
test('404 unknown 코드는 NOT_FOUND가 아니라 UNCERTAIN이다', () => {
  assert.equal(classifyDriverOrderCommandError({ status: 404, code: null }), 'UNCERTAIN');
  assert.equal(classifyDriverOrderCommandError({ status: 404, code: 'UNKNOWN' }), 'UNCERTAIN');
});

// 예상 밖 4xx/5xx + ratified 코드 없음은 UNCERTAIN이며 성공으로 추론하지 않는다.
test('unknown 4xx/5xx는 UNCERTAIN이며 성공·resend를 유도하지 않는다', () => {
  assert.equal(classifyDriverOrderCommandError({ status: 409, code: null }), 'UNCERTAIN');
  assert.equal(classifyDriverOrderCommandError({ status: 500, code: null }), 'UNCERTAIN');
  assert.equal(classifyDriverOrderCommandError({ status: 422, code: null }), 'UNCERTAIN');
  assert.equal(classifyDriverOrderCommandError({ status: 400, code: null }), 'UNCERTAIN');
});

// 12. DRIVER_ORDER_ALREADY_APPLIED를 client에서 새로 생성·추론하지 않는다.
test('12. DRIVER_ORDER_ALREADY_APPLIED는 인식하지 않으며 새 의미를 만들지 않는다', async () => {
  assert.equal(readDriverOrderErrorCode({ code: 'DRIVER_ORDER_ALREADY_APPLIED' }), null);
  assert.equal(
    classifyDriverOrderCommandError({ status: 409, code: 'DRIVER_ORDER_ALREADY_APPLIED' }),
    'UNCERTAIN',
  );
  assert.equal(
    classifyDriverOrderCommandError({ status: 403, code: 'DRIVER_ORDER_ALREADY_APPLIED' }),
    'AUTHORITY_LOSS',
  );
  const helperSource = await readFile(new URL('./driver-order-detail.ts', import.meta.url), 'utf8');
  // 새로 정의하지 않는다: const 정의나 union 타입 추가로 만들지 않는다.
  assert.doesNotMatch(helperSource, /export const \w*ALREADY_APPLIED/);
  assert.doesNotMatch(helperSource, /\|\s*'DRIVER_ORDER_ALREADY_APPLIED'/);
  assert.doesNotMatch(helperSource, /return\s*'DRIVER_ORDER_ALREADY_APPLIED'/);
});

// shared SSOT와 동일한 wire 문자열만 인식한다 (client UX 의미를 shared에 넣지 않음).
test('shared stable code와 동일한 wire 문자열을 소비한다', async () => {
  const helperSource = await readFile(new URL('./driver-order-detail.ts', import.meta.url), 'utf8');
  assert.match(helperSource, /DRIVER_ORDER_AUTHORITY_DENIED/);
  assert.match(helperSource, /DRIVER_ORDER_STATE_CONFLICT/);
  assert.match(helperSource, /DRIVER_ORDER_NOT_FOUND/);
  const sharedSource = await readFile(
    new URL('../../../../../../packages/shared/src/driver-order-error.types.ts', import.meta.url),
    'utf8',
  );
  for (const code of [
    'DRIVER_ORDER_AUTHORITY_DENIED',
    'DRIVER_ORDER_STATE_CONFLICT',
    'DRIVER_ORDER_NOT_FOUND',
  ]) {
    assert.match(sharedSource, new RegExp(code));
    assert.match(helperSource, new RegExp(code));
  }
  assert.doesNotMatch(sharedSource, /AUTHORITY_LOSS/);
  assert.doesNotMatch(sharedSource, /STATE_CONFLICT.*recovery|recovery.*STATE_CONFLICT/);
});
