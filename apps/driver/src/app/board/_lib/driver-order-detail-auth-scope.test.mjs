import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildDriverOrderDetailScope,
  classifyDriverOrderCommandError,
  isDriverOrderCommandAllowed,
  isDriverOrderCommandContinuationCurrent,
  readDriverOrderErrorCode,
  shouldPreserveDriverOrderOnReadError,
} from './driver-order-detail.ts';

const detailSource = await readFile(
  new URL('../[orderId]/page.tsx', import.meta.url),
  'utf8',
);
const helperSource = await readFile(new URL('./driver-order-detail.ts', import.meta.url), 'utf8');

// 1. initial success: fresh read가 order를 확정한다.
test('fresh authoritative read는 order를 확정하고 error·readback을 해소한다', () => {
  assert.match(detailSource, /hasOrderRef\.current = true/);
  assert.match(detailSource, /setOrder\(payload\)/);
  assert.match(detailSource, /setReadError\(null\)/);
  assert.match(detailSource, /setReadbackWarning\(null\)/);
});

// 2. initial 401/403 → protected data 없음 (pure 정책).
test('initial 401/403은 이전 order 없이 AUTH_ERROR이며 order를 보존하지 않는다', () => {
  assert.equal(shouldPreserveDriverOrderOnReadError('AUTH_ERROR', false), false);
  assert.equal(shouldPreserveDriverOrderOnReadError('AUTH_ERROR', true), false);
  assert.equal(
    isDriverOrderCommandAllowed({
      hasOrder: false,
      readErrorKind: 'AUTH_ERROR',
      hasReadbackWarning: false,
    }),
    false,
  );
});

// 2b. initial 401/403 → protected data 없음 (render 계약).
test('AUTH_ERROR 초기 실패는 주문 없음 분기로 끝나고 PII·CTA를 렌더하지 않는다', () => {
  assert.match(detailSource, /if \(!order\)/);
  assert.match(detailSource, /로그인 정보를 다시 확인해 주세요/);
  const guardAt = detailSource.indexOf('if (!order)');
  for (const pii of ['order.address', 'order.buyerPhone', 'order.sellerPhone']) {
    assert.ok(
      detailSource.indexOf(pii) > guardAt,
      `${pii}는 !order 가드 이후에만 렌더되어야 한다`,
    );
  }
  for (const cta of ['배송 재개', '수거 완료 / 배송 시작', '배송 완료', '거점 도착', '배송 보류']) {
    assert.ok(
      detailSource.indexOf(cta) > guardAt,
      `${cta}는 !order 가드 이후에만 렌더되어야 한다`,
    );
  }
});

// 3. success → refresh 401/403 → 이전 order 제거.
test('refresh 401/403은 authority loss로 이전 order를 즉시 제거한다', () => {
  assert.match(detailSource, /shouldPreserveDriverOrderOnReadError\(failure\.kind/);
  assert.match(detailSource, /hasOrderRef\.current = false/);
  assert.match(detailSource, /setOrder\(null\)/);
  // 이전의 무조건 stale 유지 흐름은 남아 있지 않다.
  assert.doesNotMatch(detailSource, /후속 refresh 실패는 기존 order를 지우지 않고/);
  assert.equal(shouldPreserveDriverOrderOnReadError('AUTH_ERROR', true), false);
});

// 4. success → 404 → 이전 order 제거.
test('refresh 404는 authoritative absence로 이전 order를 유지하지 않는다', () => {
  assert.equal(shouldPreserveDriverOrderOnReadError('NOT_FOUND', true), false);
  assert.equal(shouldPreserveDriverOrderOnReadError('NOT_FOUND', false), false);
  assert.equal(
    isDriverOrderCommandAllowed({
      hasOrder: true,
      readErrorKind: 'NOT_FOUND',
      hasReadbackWarning: false,
    }),
    false,
  );
});

// 5. success → network/5xx → stale 표시 정책.
test('FETCH_ERROR만 stale 유지가 허용되고 이전 정보 표시·retry를 제공한다', () => {
  assert.equal(shouldPreserveDriverOrderOnReadError('FETCH_ERROR', true), true);
  assert.equal(shouldPreserveDriverOrderOnReadError('FETCH_ERROR', false), false);
  assert.match(detailSource, /이전 정보 표시 중/);
  assert.match(detailSource, /다시 확인/);
  assert.match(detailSource, /readError\.kind === 'FETCH_ERROR'/);
});

// 6. AUTH_ERROR에서 CTA 없음.
test('AUTH_ERROR에서는 order가 제거되어 CTA가 계산·실행되지 않는다', () => {
  assert.match(detailSource, /if \(!order\)/);
  assert.match(detailSource, /isDriverOrderCommandAllowed\(\{/);
  assert.equal(
    isDriverOrderCommandAllowed({
      hasOrder: false,
      readErrorKind: 'AUTH_ERROR',
      hasReadbackWarning: false,
    }),
    false,
  );
  assert.equal(
    isDriverOrderCommandAllowed({
      hasOrder: true,
      readErrorKind: 'AUTH_ERROR',
      hasReadbackWarning: false,
    }),
    false,
  );
});

// 7. stale FETCH_ERROR에서 위험 command 정책 검증.
test('stale FETCH_ERROR·readback 미확인 상태에서는 command가 fail-closed된다', () => {
  assert.equal(
    isDriverOrderCommandAllowed({
      hasOrder: true,
      readErrorKind: 'FETCH_ERROR',
      hasReadbackWarning: false,
    }),
    false,
  );
  assert.equal(
    isDriverOrderCommandAllowed({
      hasOrder: true,
      readErrorKind: null,
      hasReadbackWarning: true,
    }),
    false,
  );
  assert.equal(
    isDriverOrderCommandAllowed({
      hasOrder: true,
      readErrorKind: null,
      hasReadbackWarning: false,
    }),
    true,
  );
  assert.match(detailSource, /const commandsAllowed = isDriverOrderCommandAllowed/);
  assert.match(detailSource, /disabled=\{!commandsAllowed\}/);
  assert.match(detailSource, /disabled=\{loading \|\| !commandsAllowed\}/);
});

// 8. retry → success.
test('FETCH 실패는 retry 키로 재조회하고 fresh 성공으로 수렴한다', () => {
  assert.match(detailSource, /다시 시도/);
  assert.match(detailSource, /다시 확인/);
  assert.match(detailSource, /setReadKey\(\(key\)\s*=>\s*key\s*\+\s*1\)/);
  assert.match(detailSource, /readKey,/);
  assert.match(detailSource, /readDetail,/);
  assert.match(detailSource, /setOrder\(payload\)/);
});

// 9. orderId scope change → 이전 order/PII leak 없음.
test('orderId·auth scope 변경은 이전 주문·PII·read 상태를 새 scope에 남기지 않는다', () => {
  assert.match(detailSource, /readScopeRef/);
  assert.match(detailSource, /buildDriverOrderDetailScope\(\{/);
  assert.match(detailSource, /userId: session\?\.user\.id/);
  assert.match(detailSource, /role: session\?\.user\.role/);
  assert.match(detailSource, /token: session\?\.user\.accessToken/);
  assert.match(detailSource, /readScopeRef\.current !== nextScope/);
  assert.match(detailSource, /setReadbackWarning\(null\)/);
  // scope 경로에서 order·ref·error가 함께 초기화된다.
  const scopeAt = detailSource.indexOf('readScopeRef.current !== nextScope');
  const scopeBlock = detailSource.slice(scopeAt, scopeAt + 800);
  assert.match(scopeBlock, /hasOrderRef\.current = false/);
  assert.match(scopeBlock, /setOrder\(null\)/);
  assert.match(scopeBlock, /setReadError\(null\)/);
  assert.match(scopeBlock, /setReadLoading\(true\)/);
  // command sequence도 함께 무효화된다.
  assert.match(scopeBlock, /commandSeqRef\.current \+= 1/);
  // 새 scope가 command loading을 직접 해제한다: stale finally는 guard되므로
  // 여기서 해제하지 않으면 이전 command의 loading이 새 scope에 남는다.
  assert.match(scopeBlock, /setLoading\(false\)/);
  // token 상실도 같은 무효화 경로를 탄다.
  assert.match(detailSource, /if \(!token\)/);
  const noTokenAt = detailSource.indexOf('if (!token)');
  const noTokenBlock = detailSource.slice(noTokenAt, noTokenAt + 900);
  assert.match(noTokenBlock, /commandSeqRef\.current \+= 1/);
  assert.match(noTokenBlock, /setLoading\(false\)/);
  assert.match(helperSource, /__no_token__/);
  assert.match(helperSource, /__no_user__/);
  assert.match(helperSource, /__no_role__/);
  assert.match(helperSource, /AUTH_ERROR/);
  // pure scope identity: orderId + user + role + token을 구분한다.
  assert.equal(
    buildDriverOrderDetailScope({ orderId: 'o1', userId: 'u1', role: 'driver', token: 't1' }),
    buildDriverOrderDetailScope({ orderId: 'o1', userId: 'u1', role: 'driver', token: 't1' }),
  );
  assert.notEqual(
    buildDriverOrderDetailScope({ orderId: 'o1', userId: 'u1', role: 'driver', token: 't1' }),
    buildDriverOrderDetailScope({ orderId: 'o1', userId: 'u2', role: 'driver', token: 't1' }),
  );
  assert.notEqual(
    buildDriverOrderDetailScope({ orderId: 'o1', userId: 'u1', role: 'driver', token: 't1' }),
    buildDriverOrderDetailScope({ orderId: 'o1', userId: 'u1', role: 'admin', token: 't1' }),
  );
  assert.notEqual(
    buildDriverOrderDetailScope({ orderId: 'o1', userId: 'u1', role: 'driver', token: 't1' }),
    buildDriverOrderDetailScope({ orderId: 'o1', userId: 'u1', role: 'driver', token: 't2' }),
  );
  assert.notEqual(
    buildDriverOrderDetailScope({ orderId: 'o1', userId: 'u1', role: 'driver', token: 't1' }),
    buildDriverOrderDetailScope({ orderId: 'o2', userId: 'u1', role: 'driver', token: 't1' }),
  );
});

// 10. 기존 redelivery payment gate 회귀 없음.
test('redelivery payment gate 계약이 그대로 유지된다', () => {
  assert.match(detailSource, /isDeliveryStartAllowed\(order\.redeliveryPayment\)/);
  assert.match(detailSource, /deliveryStartAllowed \?/);
  assert.match(detailSource, /getRedeliveryPaymentPresentation\(order\.redeliveryPayment\)/);
  assert.match(detailSource, /disabled/);
  assert.doesNotMatch(detailSource, /canPay/);
  assert.doesNotMatch(detailSource, /orderCharges/);
});

// 11. 기존 command ACK/readback semantics 회귀 없음.
test('command ACK 후 authoritative GET 수렴·readback 분리 계약이 유지된다', () => {
  assert.match(detailSource, /isDriverOrderStatusAck\(result,\s*orderId,\s*status\)/);
  assert.match(detailSource, /setOrder\(fresh\)/);
  assert.match(detailSource, /readbackWarning/);
  assert.match(detailSource, /처리는 완료되었지만 최신 상태를 확인하지 못했습니다/);
  assert.match(detailSource, /상태 다시 확인/);
  assert.match(detailSource, /readDetail\(token\)/);
  assert.doesNotMatch(detailSource, /setTimeout\(updateStatus/);
  assert.doesNotMatch(detailSource, /setInterval/);
});

// R1. fresh order → command PATCH 401 → order/PII clear → AUTH_REQUIRED → CTA 없음.
// 401은 envelope code와 무관하게 authority loss다.
test('R1. command PATCH 401은 authority loss로 이전 order를 즉시 제거한다', () => {
  assert.equal(classifyDriverOrderCommandError({ status: 401, code: null }), 'AUTHORITY_LOSS');
  assert.match(detailSource, /if \(res\.status === 401\)/);
  const authAt = detailSource.indexOf('if (res.status === 401)');
  assert.ok(authAt !== -1, 'command 401 auth-loss 분기가 있어야 한다');
  const authBlock = detailSource.slice(authAt, authAt + 600);
  assert.match(authBlock, /hasOrderRef\.current = false/);
  assert.match(authBlock, /setOrder\(null\)/);
  assert.match(authBlock, /kind: 'AUTH_ERROR'/);
  assert.match(authBlock, /setReadbackWarning\(null\)/);
  // generic 오류만 띄우고 이전 order를 유지하는 흐름이 auth branch에 없음을 보장한다.
  assert.doesNotMatch(authBlock, /오류가 발생했습니다/);
});

// R2. fresh order → command PATCH 403는 error-code로 AUTHORITY/STATE를 구분한다.
// 403 + AUTHORITY_DENIED/unknown → AUTHORITY_LOSS, 403 + STATE_CONFLICT → STATE_CONFLICT.
test('R2. command PATCH 403은 error-code로 authority/state를 구분한다', () => {
  assert.equal(
    classifyDriverOrderCommandError({ status: 403, code: 'DRIVER_ORDER_AUTHORITY_DENIED' }),
    'AUTHORITY_LOSS',
  );
  assert.equal(
    classifyDriverOrderCommandError({ status: 403, code: 'DRIVER_ORDER_STATE_CONFLICT' }),
    'STATE_CONFLICT',
  );
  assert.equal(classifyDriverOrderCommandError({ status: 403, code: null }), 'AUTHORITY_LOSS');
  assert.equal(readDriverOrderErrorCode({ code: 'DRIVER_ORDER_ALREADY_APPLIED' }), null);
  // detail은 status-only helper 분기가 아니라 error-code aware classifier를 사용한다.
  assert.match(detailSource, /classifyDriverOrderCommandError\(\{/);
  assert.match(detailSource, /readDriverOrderCommandErrorCodeFromResponse\(res\)/);
  assert.match(detailSource, /recovery === 'AUTHORITY_LOSS'/);
  assert.match(detailSource, /recovery === 'STATE_CONFLICT'/);
  assert.match(detailSource, /recovery === 'NOT_FOUND'/);
  // 403 STATE를 AUTH_ERROR로 오분류하지 않는다: STATE 분기는 GET 수렴이다.
  const stateAt = detailSource.indexOf("recovery === 'STATE_CONFLICT'");
  assert.ok(stateAt !== -1, 'STATE_CONFLICT 분기가 있어야 한다');
  const stateBlock = detailSource.slice(stateAt, stateAt + 600);
  assert.match(stateBlock, /await readDetail\(token\)/);
  assert.doesNotMatch(stateBlock, /kind: 'AUTH_ERROR'/);
  // 구 status-only 403 auth-loss 직접 분기는 남지 않는다.
  assert.doesNotMatch(detailSource, /isDriverOrderCommandAuthLoss\(res\.status\)/);
});

// R3. A scope command → B user/token/role 전환 → A ACK/readback이 B에 반영되지 않음.
test('R3. 이전 auth scope command continuation은 새 scope UI를 변경하지 않는다', () => {
  assert.match(detailSource, /const commandSeqRef = useRef\(0\)/);
  assert.match(detailSource, /const cmdSeq = commandSeqRef\.current/);
  assert.match(detailSource, /const cmdScope = buildDriverOrderDetailScope/);
  assert.match(detailSource, /liveScopeRef/);
  assert.match(detailSource, /isDriverOrderCommandContinuationCurrent\(\{/);
  assert.match(detailSource, /if \(!isCommandCurrent\(\)\) return;/);
  // pure generation+scope binding: 동일할 때만 current다.
  const scopeA = buildDriverOrderDetailScope({
    orderId: 'o1',
    userId: 'u1',
    role: 'driver',
    token: 't1',
  });
  const scopeB = buildDriverOrderDetailScope({
    orderId: 'o1',
    userId: 'u2',
    role: 'driver',
    token: 't2',
  });
  assert.equal(
    isDriverOrderCommandContinuationCurrent({
      snapshotSeq: 1,
      snapshotScope: scopeA,
      currentSeq: 1,
      currentScope: scopeA,
    }),
    true,
  );
  assert.equal(
    isDriverOrderCommandContinuationCurrent({
      snapshotSeq: 1,
      snapshotScope: scopeA,
      currentSeq: 1,
      currentScope: scopeB,
    }),
    false,
  );
  assert.equal(
    isDriverOrderCommandContinuationCurrent({
      snapshotSeq: 1,
      snapshotScope: scopeA,
      currentSeq: 2,
      currentScope: scopeA,
    }),
    false,
  );
  // ACK/readback/notification이 모두 가드된다.
  const cmdAt = detailSource.indexOf('const isCommandCurrent');
  assert.ok(cmdAt !== -1);
  const tail = detailSource.slice(cmdAt);
  assert.match(tail, /setOrder\(fresh\)/);
  assert.match(tail, /setReadbackWarning/);
  assert.match(tail, /notifications\.show/);
  assert.match(tail, /router\.replace/);
  assert.match(tail, /await readDetail\(token\)/);
});

// R4. A orderId command → 다른 orderId 이동 → 덮어쓰기·navigation 금지.
test('R4. 이전 orderId command 결과는 새 order detail을 덮거나 이동시키지 않는다', () => {
  assert.match(detailSource, /const cmdOrderId = orderId/);
  assert.match(detailSource, /cmdOrderId === liveScopeRef/);
  // navigation은 scope/sequence 가드 뒤에만 있다.
  const navAt = detailSource.indexOf("router.replace('/board?tab=preparing')");
  assert.ok(navAt !== -1, 'terminal navigation이 있어야 한다');
  const navWindow = detailSource.slice(Math.max(0, navAt - 300), navAt);
  assert.match(navWindow, /isCommandCurrent/);
  // orderId가 scope identity에 포함된다.
  assert.match(helperSource, /orderId/);
  assert.notEqual(
    buildDriverOrderDetailScope({ orderId: 'o1', userId: 'u1', role: 'driver', token: 't1' }),
    buildDriverOrderDetailScope({ orderId: 'o2', userId: 'u1', role: 'driver', token: 't1' }),
  );
});

// R5. old command finally → 새 scope loading/command 상태를 해제하지 않음.
test('R5. stale command finally는 새 scope의 loading·in-flight를 덮지 않는다', () => {
  const finallyAt = detailSource.indexOf('} finally {');
  assert.ok(finallyAt !== -1, 'finally가 있어야 한다');
  const finallyBlock = detailSource.slice(finallyAt, finallyAt + 600);
  assert.match(finallyBlock, /if \(!isCommandCurrent\(\)\) return;/);
  assert.match(finallyBlock, /inFlightRef\.current = false/);
  assert.match(finallyBlock, /setLoading\(false\)/);
  const guardAt = finallyBlock.indexOf('if (!isCommandCurrent()) return;');
  const releaseAt = finallyBlock.indexOf('inFlightRef.current = false');
  assert.ok(guardAt !== -1 && guardAt < releaseAt, 'finally 해제는 가드 뒤에만 한다');
});

// R6. fresh same-scope 정상 command → semantic ACK → authoritative GET → fresh order.
test('R6. 정상 command는 semantic ACK 후 authoritative GET으로 수렴한다', () => {
  assert.match(detailSource, /isDriverOrderStatusAck\(result,\s*orderId,\s*status\)/);
  assert.match(detailSource, /setOrder\(fresh\)/);
  // detail PATCH는 상태 전환 1회뿐이며 자동 resend 타이머가 없다.
  const patchCount = (detailSource.match(/method: 'PATCH'/g) ?? []).length;
  assert.equal(patchCount, 1, 'detail PATCH는 상태 전환 1회뿐이다');
  assert.doesNotMatch(detailSource, /setTimeout\(updateStatus/);
  assert.doesNotMatch(detailSource, /setInterval/);
});

// R7. ACK 성공 → readback network/5xx 실패 → 자동 resend 없음·warning 유지·fail-closed.
test('R7. readback 실패는 자동 재전송 없이 warning과 fail-closed를 유지한다', () => {
  assert.match(detailSource, /처리는 완료되었지만 최신 상태를 확인하지 못했습니다/);
  assert.match(detailSource, /setReadbackWarning\(message\)/);
  assert.match(detailSource, /hasReadbackWarning: readbackWarning !== null/);
  assert.equal(
    isDriverOrderCommandAllowed({
      hasOrder: true,
      readErrorKind: null,
      hasReadbackWarning: true,
    }),
    false,
  );
  const patchCount = (detailSource.match(/method: 'PATCH'/g) ?? []).length;
  assert.equal(patchCount, 1, 'readback 실패가 PATCH 재전송을 만들지 않는다');
});

// R8. read refresh 401/403/404/FETCH_ERROR 기존 계약 회귀 없음.
test('R8. detail read auth·absence·stale 계약이 그대로 유지된다', () => {
  assert.equal(shouldPreserveDriverOrderOnReadError('AUTH_ERROR', true), false);
  assert.equal(shouldPreserveDriverOrderOnReadError('NOT_FOUND', true), false);
  assert.equal(shouldPreserveDriverOrderOnReadError('FETCH_ERROR', true), true);
  assert.match(detailSource, /shouldPreserveDriverOrderOnReadError\(failure\.kind/);
  assert.match(detailSource, /이전 정보 표시 중/);
});

// R9. redelivery payment gate 회귀 없음.
test('R9. redelivery payment gate가 command 변경과 무관하게 유지된다', () => {
  assert.match(detailSource, /isDeliveryStartAllowed\(order\.redeliveryPayment\)/);
  assert.match(detailSource, /getRedeliveryPaymentPresentation\(order\.redeliveryPayment\)/);
  assert.doesNotMatch(detailSource, /canPay/);
  assert.doesNotMatch(detailSource, /orderCharges/);
});
