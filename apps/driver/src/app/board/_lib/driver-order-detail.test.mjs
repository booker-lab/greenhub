import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyDriverOrderReadError,
  DriverOrderReadError,
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
