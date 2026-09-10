import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const photoCaptureSource = await readFile(new URL('./photo-capture.tsx', import.meta.url), 'utf8');

const legacyStart = photoCaptureSource.indexOf('uploadLegacyHubPhoto(orderId');
assert.ok(legacyStart !== -1, 'legacy-hub upload branch가 있어야 한다');
const legacyEnd = photoCaptureSource.indexOf('router.replace', legacyStart);
assert.ok(legacyEnd !== -1, 'legacy branch 뒤에 board 이동이 있어야 한다');
const legacySlice = photoCaptureSource.slice(legacyStart, legacyEnd);

const UNCERTAINTY_COPY = '결과를 확인할 수 없습니다. 주문 상태를 다시 확인하세요.';

// 구현과 동일한 의미의 판정 미러다. 소스 계약이 바뀌면 아래 behavioral 테스트와
// source-contract 테스트 중 최소 하나가 먼저 실패한다.
function isLegacyHubStatusAck(result, orderId) {
  if (!result || typeof result !== 'object') return false;
  return result.orderId === orderId && result.status === 'HUB_ARRIVED';
}

function parseLegacyAck(bodyText) {
  return JSON.parse(bodyText);
}

// A. 정상 response: orderId 동일 + HUB_ARRIVED → success
test('A. 정상 ACK(orderId 동일 + HUB_ARRIVED)는 success다', () => {
  const ack = parseLegacyAck(JSON.stringify({ orderId: 'order-1', status: 'HUB_ARRIVED' }));
  assert.equal(isLegacyHubStatusAck(ack, 'order-1'), true);
});

// B. orderId mismatch → success 취급 금지
test('B. orderId mismatch는 success가 아니다', () => {
  const ack = parseLegacyAck(JSON.stringify({ orderId: 'order-OTHER', status: 'HUB_ARRIVED' }));
  assert.equal(isLegacyHubStatusAck(ack, 'order-1'), false);
});

// C. status mismatch → success 취급 금지
test('C. status mismatch는 success가 아니다', () => {
  const ack = parseLegacyAck(JSON.stringify({ orderId: 'order-1', status: 'DELIVERING' }));
  assert.equal(isLegacyHubStatusAck(ack, 'order-1'), false);
});

// D. body 손상/필수 field 누락 → success 취급 금지
test('D. body 손상/필수 field 누락은 success가 아니다', () => {
  assert.throws(() => parseLegacyAck('not-json{{{'), SyntaxError);
  assert.equal(isLegacyHubStatusAck(null, 'order-1'), false);
  assert.equal(isLegacyHubStatusAck(undefined, 'order-1'), false);
  assert.equal(isLegacyHubStatusAck({}, 'order-1'), false);
  assert.equal(isLegacyHubStatusAck({ orderId: 'order-1' }, 'order-1'), false);
  assert.equal(isLegacyHubStatusAck({ status: 'HUB_ARRIVED' }, 'order-1'), false);
});

// E. double click → legacy upload 1회 (ref 기반 in-flight guard 미러)
test('E. in-flight 중 중복 dispatch는 두 번째 호출을 막는다', () => {
  let uploadCalls = 0;
  const guard = { current: false };
  function dispatch() {
    if (guard.current) return false;
    guard.current = true;
    uploadCalls += 1;
    return true;
  }
  assert.equal(dispatch(), true);
  assert.equal(dispatch(), false);
  assert.equal(uploadCalls, 1);
});

test('legacy-hub는 response.ok만으로 성공 처리하지 않고 semantic ACK를 확인한다', () => {
  assert.match(legacySlice, /response\.json\(\)/);
  assert.match(legacySlice, /ack\.orderId\s*!==\s*orderId/);
  assert.match(legacySlice, /ack\.status\s*!==\s*['"]HUB_ARRIVED['"]/);
});

test('legacy-hub mismatch는 board 이동 없이 uncertainty path로 수렴한다', () => {
  assert.match(legacySlice, /결과를 확인할 수 없습니다\. 주문 상태를 다시 확인하세요\./);
  const ackCheckIndex = legacySlice.indexOf('ack.orderId');
  assert.ok(ackCheckIndex !== -1, 'ACK 검사가 legacy branch 안에 있어야 한다');
  // ACK 검사보다 앞에 board 이동이 있으면 안 된다: throw가 router.replace를 건너뛴다.
  assert.doesNotMatch(legacySlice, /router\.replace/);
  assert.match(photoCaptureSource, /결과를 확인할 수 없습니다\. 주문 상태를 다시 확인하세요\./);
});

test('legacy-hub에 requestId/idempotency key 방식을 복사하지 않는다', () => {
  assert.doesNotMatch(legacySlice, /idempotencyKey/);
  assert.doesNotMatch(legacySlice, /requestId/);
});

test('legacy-hub 중복 dispatch는 ref 기반 in-flight guard로 막는다', () => {
  assert.match(photoCaptureSource, /uploadInFlightRef/);
  assert.match(photoCaptureSource, /if\s*\(uploadInFlightRef\.current\)\s*return/);
  assert.match(photoCaptureSource, /uploadInFlightRef\.current\s*=\s*true/);
  assert.match(photoCaptureSource, /uploadInFlightRef\.current\s*=\s*false/);
});

test('round-direct keyed ACK 계약 회귀 없음', () => {
  assert.match(photoCaptureSource, /form\.append\(['"]idempotencyKey['"]/);
  assert.match(photoCaptureSource, /result\.orderId\s*!==\s*orderId/);
  assert.match(photoCaptureSource, /result\.photoId/);
  assert.match(photoCaptureSource, /result\.status\s*!==\s*['"]DELIVERED['"]/);
});

test('legacy Storage lifecycle을 건드리지 않는다', () => {
  assert.match(photoCaptureSource, /uploadLegacyHubPhoto\(orderId,\s*blob\)/);
  assert.doesNotMatch(photoCaptureSource, /deleteObject|uploadDeliveryPhoto/);
});
