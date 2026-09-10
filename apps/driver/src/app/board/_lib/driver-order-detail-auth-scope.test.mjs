import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  isDriverOrderCommandAllowed,
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
  assert.match(detailSource, /readKey, readDetail\]/);
  assert.match(detailSource, /setOrder\(payload\)/);
});

// 9. orderId scope change → 이전 order/PII leak 없음.
test('orderId·auth scope 변경은 이전 주문·PII·read 상태를 새 scope에 남기지 않는다', () => {
  assert.match(detailSource, /readScopeRef/);
  assert.match(detailSource, /orderId\}::\$\{token\}/);
  assert.match(detailSource, /readScopeRef\.current !== nextScope/);
  assert.match(detailSource, /setReadbackWarning\(null\)/);
  // scope 경로에서 order·ref·error가 함께 초기화된다.
  const scopeAt = detailSource.indexOf('readScopeRef.current !== nextScope');
  const scopeBlock = detailSource.slice(scopeAt, scopeAt + 800);
  assert.match(scopeBlock, /hasOrderRef\.current = false/);
  assert.match(scopeBlock, /setOrder\(null\)/);
  assert.match(scopeBlock, /setReadError\(null\)/);
  assert.match(scopeBlock, /setReadLoading\(true\)/);
  // token 상실도 같은 무효화 경로를 탄다.
  assert.match(detailSource, /__no_token__/);
  assert.match(helperSource, /AUTH_ERROR/);
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
