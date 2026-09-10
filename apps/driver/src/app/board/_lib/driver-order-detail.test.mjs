import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDriverOrderDetailScope,
  classifyDriverOrderReadError,
  DriverOrderReadError,
  isDriverOrderCommandAuthLoss,
  isDriverOrderCommandContinuationCurrent,
  isDriverOrderStatusAck,
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

test('command 401·403만 authority loss다', () => {
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
