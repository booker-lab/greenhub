import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  classifyDriverOrderCommandError,
  isDriverOrderCommandAllowed,
  readDriverOrderErrorCode,
  shouldPreserveDriverOrderOnReadError,
} from '../_lib/driver-order-detail.ts';

// DRIVER-DETAIL-COMMAND-INFLIGHT-STALE-GUARD-01 focused regression.
// Driver 주문 상세 command의 UX 안전계약만 검증한다:
// ref 기반 in-flight guard, CTA disabled normalization, HoldModal stale guard,
// 403/409 convergence, readback uncertainty no-resend.
// photo flow·server·FSM·board refresh 계약은 건드리지 않는다.
const detailSource = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');
const holdModalSource = await readFile(
  new URL('./_components/DeliveryHoldModal.tsx', import.meta.url),
  'utf8',
);

const CONVERGENCE_MESSAGE = '이미 상태가 변경되었을 수 있습니다. 최신 상태를 다시 확인합니다.';

// 수렴 메시지는 상수로 단일 정의되어 양 경로에서 공유된다.
test('수렴 메시지는 단일 상수로 정의된다', () => {
  assert.match(
    holdModalSource,
    /HOLD_STALE_CONVERGENCE_MESSAGE =\s*\n\s*'이미 상태가 변경되었을 수 있습니다\. 최신 상태를 다시 확인합니다\.'/,
  );
  assert.match(detailSource, new RegExp(CONVERGENCE_MESSAGE.replace(/\./g, '\\.')));
});

// A. 빠른 double-submit → PATCH 1회: ref 기반 in-flight guard가 dispatch authority다.
test('A. updateStatus는 ref 기반 in-flight guard로 double-submit PATCH를 차단한다', () => {
  assert.match(detailSource, /const inFlightRef = useRef\(false\)/);
  const fnAt = detailSource.indexOf('async function updateStatus');
  assert.ok(fnAt !== -1, 'updateStatus가 있어야 한다');
  const guardAt = detailSource.indexOf('if (inFlightRef.current) return', fnAt);
  const armAt = detailSource.indexOf('inFlightRef.current = true', fnAt);
  const patchAt = detailSource.indexOf("method: 'PATCH'", fnAt);
  const releaseAt = detailSource.indexOf('inFlightRef.current = false', fnAt);
  assert.ok(guardAt !== -1 && armAt !== -1 && patchAt !== -1 && releaseAt !== -1);
  // guard → arm → PATCH 순서: 동일 frame 두 번째 호출은 dispatch 전에 복귀한다.
  assert.ok(guardAt < armAt, 'guard가 arm보다 먼저다');
  assert.ok(armAt < patchAt, 'arm이 PATCH dispatch보다 먼저다');
  // 해제는 finally에서만: 모든 종료 경로가 여기를 거친다.
  const finallyAt = detailSource.indexOf('} finally {', fnAt);
  assert.ok(finallyAt !== -1 && finallyAt < releaseAt, 'in-flight 해제는 finally에서 한다');
  assert.match(detailSource, /모든 종료 경로에서 in-flight를 해제한다/);
});

// B. loading 중 CTA → disabled: 모든 status mutation CTA가 명시적으로 disabled다.
test('B. PATCH dispatch CTA는 loading 중 명시적으로 disabled다', () => {
  const buttons = detailSource.split('<Button');
  const dispatchButtons = buttons.filter((chunk) => chunk.includes('updateStatus(') && chunk.includes('onClick'));
  // 배송 재개·수거 완료/배송 시작·배송 완료 dispatch 버튼이 존재한다.
  assert.ok(dispatchButtons.length >= 4, `dispatch 버튼이 4개 이상이어야 한다 (${dispatchButtons.length})`);
  for (const chunk of dispatchButtons) {
    assert.match(
      chunk,
      /disabled=\{loading \|\| !commandsAllowed\}/,
      'dispatch CTA는 disabled={loading || !commandsAllowed}여야 한다',
    );
  }
  // 사진 촬영 네비게이션(비-PATCH)은 기존 fail-closed disabled를 유지한다.
  const navButtons = buttons.filter(
    (chunk) => chunk.includes('/photo') && chunk.includes('router.push'),
  );
  assert.ok(navButtons.length >= 2, '사진 네비게이션 버튼이 유지되어야 한다');
  for (const chunk of navButtons) {
    assert.match(chunk, /disabled=\{!commandsAllowed\}/);
  }
});

// C. HoldModal double-submit → PATCH 1회: 로컬 submittingRef guard.
test('C. HoldModal은 submittingRef guard로 double-submit PATCH를 차단한다', () => {
  assert.match(holdModalSource, /const submittingRef = useRef\(false\)/);
  const fnAt = holdModalSource.indexOf('async function submit');
  assert.ok(fnAt !== -1, 'submit이 있어야 한다');
  const guardAt = holdModalSource.indexOf('if (submittingRef.current) return', fnAt);
  const armAt = holdModalSource.indexOf('submittingRef.current = true', fnAt);
  const patchAt = holdModalSource.indexOf("method: 'PATCH'", fnAt);
  const releaseAt = holdModalSource.indexOf('submittingRef.current = false', fnAt);
  assert.ok(guardAt !== -1 && armAt !== -1 && patchAt !== -1 && releaseAt !== -1);
  assert.ok(guardAt < patchAt, 'guard가 PATCH dispatch보다 먼저다');
  assert.ok(armAt < patchAt, 'arm이 PATCH dispatch보다 먼저다');
  const finallyAt = holdModalSource.indexOf('} finally {', fnAt);
  assert.ok(finallyAt !== -1 && finallyAt < releaseAt, 'submitting 해제는 finally에서 한다');
  // 저장 버튼도 명시적으로 disabled다.
  assert.match(holdModalSource, /배송 보류 저장/);
  assert.match(holdModalSource, /onClick=\{submit\} loading=\{loading\} disabled=\{loading\}/);
});

// D. modal open 뒤 order status 변경 → stale payload dispatch 0회.
test('D. HoldModal은 open 뒤 authority 이동 시 stale payload를 dispatch하지 않는다', () => {
  // 최소 prop으로 현재 order status를 전달받는다.
  assert.match(holdModalSource, /orderStatus: string/);
  assert.match(detailSource, /orderStatus=\{order\.status\}/);
  // 허용 범위는 PREPARING·DELIVERING뿐이다.
  const allowedLiteral = holdModalSource.match(/HOLD_COMMAND_ALLOWED_STATUSES = \[([^\]]*)\]/);
  assert.ok(allowedLiteral, '허용 상태 literal이 있어야 한다');
  assert.match(allowedLiteral[1], /'PREPARING'/);
  assert.match(allowedLiteral[1], /'DELIVERING'/);
  assert.doesNotMatch(allowedLiteral[1], /DELIVERED|DELIVERY_HELD|HUB_ARRIVED/);
  // submit 경로: stale 판정이 PATCH dispatch보다 먼저다.
  const fnAt = holdModalSource.indexOf('async function submit');
  const staleAt = holdModalSource.indexOf('isHoldCommandAllowedStatus(orderStatus)', fnAt);
  const patchAt = holdModalSource.indexOf("method: 'PATCH'", fnAt);
  assert.ok(staleAt !== -1 && staleAt < patchAt, 'stale guard가 dispatch보다 먼저다');
  const staleBlock = holdModalSource.slice(staleAt, patchAt);
  assert.match(staleBlock, /setError\(HOLD_STALE_CONVERGENCE_MESSAGE\)/);
  assert.match(staleBlock, /onConvergence\?\.\(\)/);
  assert.match(staleBlock, /onClose\(\)/);
  // open 중 authority 이탈을 감시하는 effect: reset 후 닫는다.
  assert.match(holdModalSource, /\[opened, orderStatus\]/);
  const effectAt = holdModalSource.indexOf('[opened, orderStatus]');
  const effectBlock = holdModalSource.slice(Math.max(0, effectAt - 600), effectAt);
  assert.match(effectBlock, /isHoldCommandAllowedStatus\(orderStatus\)/);
  assert.match(effectBlock, /resetHoldFormFields\(\)/);
  assert.match(effectBlock, /onClose\(\)/);
});

// E. error-code aware convergence: 401/AUTHORITY → auth-loss, STATE → GET 수렴, 자동 재전송 0회.
test('E. error-code aware command는 authority/state를 구분해 수렴하며 자동 재전송하지 않는다', () => {
  // pure: 401 → AUTHORITY_LOSS, 403 AUTHORITY → AUTHORITY_LOSS, 403 STATE → STATE_CONFLICT.
  assert.equal(classifyDriverOrderCommandError({ status: 401, code: null }), 'AUTHORITY_LOSS');
  assert.equal(
    classifyDriverOrderCommandError({ status: 403, code: 'DRIVER_ORDER_AUTHORITY_DENIED' }),
    'AUTHORITY_LOSS',
  );
  assert.equal(
    classifyDriverOrderCommandError({ status: 403, code: 'DRIVER_ORDER_STATE_CONFLICT' }),
    'STATE_CONFLICT',
  );
  assert.equal(
    classifyDriverOrderCommandError({ status: 409, code: 'DRIVER_ORDER_STATE_CONFLICT' }),
    'STATE_CONFLICT',
  );
  assert.equal(classifyDriverOrderCommandError({ status: 403, code: null }), 'AUTHORITY_LOSS');
  // detail: 401 분기가 먼저 clear + AUTH_ERROR + return이며 PATCH를 추가 호출하지 않는다.
  const auth401At = detailSource.indexOf('if (res.status === 401)');
  assert.ok(auth401At !== -1, 'detail 401 auth-loss 분기가 있어야 한다');
  const auth401Block = detailSource.slice(auth401At, auth401At + 600);
  assert.match(auth401Block, /hasOrderRef\.current = false/);
  assert.match(auth401Block, /setOrder\(null\)/);
  assert.match(auth401Block, /kind: 'AUTH_ERROR'/);
  assert.match(auth401Block, /return;/);
  assert.doesNotMatch(auth401Block, /method: 'PATCH'/);
  // detail: error-code aware classifier로 AUTHORITY_LOSS/STATE_CONFLICT/NOT_FOUND를 구분한다.
  assert.match(detailSource, /readDriverOrderCommandErrorCodeFromResponse\(res\)/);
  assert.match(detailSource, /classifyDriverOrderCommandError\(\{/);
  assert.match(detailSource, /recovery === 'AUTHORITY_LOSS'/);
  assert.match(detailSource, /recovery === 'STATE_CONFLICT'/);
  assert.match(detailSource, /recovery === 'NOT_FOUND'/);
  // detail: STATE_CONFLICT 분기가 readDetail 수렴 + return이며 PATCH를 추가 호출하지 않는다.
  const branchAt = detailSource.indexOf("recovery === 'STATE_CONFLICT'");
  assert.ok(branchAt !== -1, 'STATE_CONFLICT 분기가 있어야 한다');
  const branchBlock = detailSource.slice(branchAt, branchAt + 700);
  assert.match(branchBlock, new RegExp(CONVERGENCE_MESSAGE.replace(/\./g, '\\.')));
  assert.match(branchBlock, /await readDetail\(token\)/);
  assert.match(branchBlock, /return;/);
  assert.doesNotMatch(branchBlock, /method: 'PATCH'/);
  // 구 status-only 직접 분기는 남지 않는다.
  assert.doesNotMatch(detailSource, /isDriverOrderCommandAuthLoss\(res\.status\)/);
  assert.doesNotMatch(detailSource, /if \(res\.status === 409\)/);
  // modal: AUTHORITY_LOSS는 stale convergence로 오분류하지 않고 authority 경로로 보낸다.
  assert.match(holdModalSource, /recovery === 'AUTHORITY_LOSS'/);
  assert.match(holdModalSource, /onAuthorityLoss\?\.\(\)/);
  // modal: STATE_CONFLICT는 authority loss로 오분류하지 않고 stale convergence로 보낸다.
  assert.match(holdModalSource, /recovery === 'STATE_CONFLICT'/);
  const modalBranchAt = holdModalSource.indexOf("recovery === 'STATE_CONFLICT'");
  assert.ok(modalBranchAt !== -1, 'modal STATE_CONFLICT 분기가 있어야 한다');
  const modalBranchBlock = holdModalSource.slice(modalBranchAt, modalBranchAt + 600);
  assert.match(modalBranchBlock, /setError\(HOLD_STALE_CONVERGENCE_MESSAGE\)/);
  assert.match(modalBranchBlock, /onConvergence\?\.\(\)/);
  assert.match(modalBranchBlock, /return;/);
  assert.doesNotMatch(modalBranchBlock, /method: 'PATCH'/);
  // 일반적인 "실패했으니 다시 제출" 메시지로 처리하지 않는다.
  assert.doesNotMatch(modalBranchBlock, /다시 시도/);
  // 자동 재전송 타이머가 없다.
  assert.doesNotMatch(detailSource, /setTimeout\(updateStatus/);
  assert.doesNotMatch(detailSource, /setInterval/);
  assert.doesNotMatch(holdModalSource, /setTimeout\(submit/);
  assert.doesNotMatch(holdModalSource, /setInterval/);
  // parent는 modal 수렴 요청을 authoritative GET에 연결한다.
  assert.match(detailSource, /onConvergence=\{/);
  // parent는 modal authority-loss를 order clear + AUTH_ERROR + close로 수렴한다.
  assert.match(detailSource, /onAuthorityLoss=\{/);
  assert.match(holdModalSource, /onAuthorityLoss\?:/);
});

// F. ACK success + authoritative reread failure → PATCH 추가 호출 0회·warning·command disabled.
test('F. readback 불확실성은 PATCH 재호출 없이 warning과 fail-closed를 유지한다', () => {
  // detail의 PATCH는 status 전환 1회뿐이다.
  const patchCount = (detailSource.match(/method: 'PATCH'/g) ?? []).length;
  assert.equal(patchCount, 1, 'detail PATCH는 상태 전환 1회뿐이다');
  assert.match(detailSource, /readbackWarning/);
  assert.match(detailSource, /처리는 완료되었지만 최신 상태를 확인하지 못했습니다/);
  assert.match(detailSource, /상태 다시 확인/);
  // readbackWarning 존재 시 command가 fail-closed된다.
  assert.match(detailSource, /hasReadbackWarning: readbackWarning !== null/);
  // 이전 order를 최신이라고 주장하지 않는다: local 합성 없이 fresh GET으로만 수렴.
  assert.match(detailSource, /setOrder\(fresh\)/);
  assert.doesNotMatch(detailSource, /setOrder\(\{\s*\.\.\.order/);
});

// G. terminal ACK + reread loss → 기존 board convergence 계약 유지.
test('G. terminal ACK 뒤 readback loss에서도 board navigation 계약이 유지된다', () => {
  assert.match(detailSource, /const isTerminal = status === 'DELIVERED' \|\| status === 'HUB_ARRIVED'/);
  assert.match(detailSource, /terminal은 board가 fresh fetch하므로 navigation 계약을 유지한다/);
  assert.match(detailSource, /router\.replace\('\/board\?tab=preparing'\)/);
  // detail에 머물도록 바꾸지 않는다: terminal 분기에 return이 끼어들지 않는다.
  const terminalAt = detailSource.indexOf('} else if (isTerminal) {');
  assert.ok(terminalAt !== -1);
  const terminalBlock = detailSource.slice(terminalAt, terminalAt + 200);
  assert.doesNotMatch(terminalBlock, /return;/);
});

// 기존 안전계약 회귀 없음: commandsAllowed·ACK 검증·authoritative reread.
test('기존 command 안전계약이 유지된다', () => {
  assert.match(detailSource, /isDriverOrderCommandAllowed\(\{/);
  assert.match(detailSource, /isDriverOrderStatusAck\(result,\s*orderId,\s*status\)/);
  assert.match(detailSource, /\/driver\/orders\/\$\{encodeURIComponent\(orderId\)\}/);
  assert.match(holdModalSource, /result\.status !== 'DELIVERY_HELD'/);
  assert.match(holdModalSource, /onSaved\?\.\(\)/);
  // 성공 후 form reset.
  const successAt = holdModalSource.indexOf("result.status !== 'DELIVERY_HELD'");
  const successBlock = holdModalSource.slice(successAt, successAt + 500);
  assert.match(successBlock, /resetHoldFormFields\(\)/);
  assert.match(successBlock, /onClose\(\)/);
});



test('H1. STATUS uncertain constants exist without resend copy', () => {
  assert.match(detailSource, /STATUS_UNCERTAIN_CONVERGENCE_MESSAGE/);
  assert.match(detailSource, /STATUS_UNCERTAIN_READBACK_WARNING/);
  assert.match(
    detailSource,
    /\uBA85\uB839\uC774 \uCC98\uB9AC\uB418\uC5C8\uB294\uC9C0 \uD655\uC2E4\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4/,
  );
  assert.match(detailSource, /\uBC14\uB85C \uB2E4\uC2DC \uBCF4\uB0B4\uC9C0 \uB9C8\uC138\uC694/);
  assert.doesNotMatch(detailSource, /setTimeout\(updateStatus/);
  assert.doesNotMatch(detailSource, /setInterval/);
  const updateAt = detailSource.indexOf('async function updateStatus');
  const updateBlock = detailSource.slice(updateAt);
  assert.doesNotMatch(updateBlock, /color: 'red'/);
});

test('H2. STATUS F/G other 4xx-5xx converges with GET and no resend', () => {
  const fnAt = detailSource.indexOf('async function updateStatus');
  assert.ok(fnAt !== -1);
  const fgMarker = detailSource.indexOf('F/G:', fnAt);
  assert.ok(fgMarker !== -1);
  const fgBlock = detailSource.slice(fgMarker, fgMarker + 900);
  assert.match(fgBlock, /STATUS_UNCERTAIN_CONVERGENCE_MESSAGE/);
  assert.match(fgBlock, /setReadbackWarning\(STATUS_UNCERTAIN_READBACK_WARNING\)/);
  assert.match(fgBlock, /await readDetail\(token\)/);
  assert.match(fgBlock, /return;/);
  assert.doesNotMatch(fgBlock, /method: 'PATCH'/);
  assert.ok(
    fgBlock.indexOf('setReadbackWarning(STATUS_UNCERTAIN_READBACK_WARNING)') <
      fgBlock.indexOf('await readDetail(token)'),
  );
  const patchCount = (detailSource.match(/method: 'PATCH'/g) ?? []).length;
  assert.equal(patchCount, 1);
});

test('H3. STATUS B malformed JSON converges with GET and no resend', () => {
  const fnAt = detailSource.indexOf('async function updateStatus');
  const bMarker = detailSource.indexOf('malformed JSON', fnAt);
  assert.ok(bMarker !== -1);
  const bBlock = detailSource.slice(bMarker, bMarker + 900);
  assert.match(bBlock, /await res\.json\(\)/);
  assert.match(bBlock, /STATUS_UNCERTAIN_CONVERGENCE_MESSAGE/);
  assert.match(bBlock, /setReadbackWarning\(STATUS_UNCERTAIN_READBACK_WARNING\)/);
  assert.match(bBlock, /await readDetail\(token\)/);
  assert.match(bBlock, /return;/);
  assert.doesNotMatch(bBlock, /method: 'PATCH'/);
});

test('H4. STATUS C ACK mismatch converges with GET and no resend', () => {
  const fnAt = detailSource.indexOf('async function updateStatus');
  const cMarker = detailSource.indexOf('ACK orderId', fnAt);
  assert.ok(cMarker !== -1);
  const cBlock = detailSource.slice(cMarker, cMarker + 800);
  assert.match(cBlock, /isDriverOrderStatusAck\(result/);
  assert.match(cBlock, /STATUS_UNCERTAIN_CONVERGENCE_MESSAGE/);
  assert.match(cBlock, /setReadbackWarning\(STATUS_UNCERTAIN_READBACK_WARNING\)/);
  assert.match(cBlock, /await readDetail\(token\)/);
  assert.match(cBlock, /return;/);
  assert.doesNotMatch(cBlock, /method: 'PATCH'/);
});

test('H5. STATUS H network catch converges with GET without resend copy', () => {
  const fnAt = detailSource.indexOf('async function updateStatus');
  const navAt = detailSource.indexOf("router.replace('/board", fnAt);
  assert.ok(navAt !== -1);
  const catchAt = detailSource.indexOf('} catch {', navAt);
  assert.ok(catchAt !== -1);
  const hBlock = detailSource.slice(catchAt, catchAt + 900);
  assert.match(hBlock, /STATUS_UNCERTAIN_CONVERGENCE_MESSAGE/);
  assert.match(hBlock, /setReadbackWarning\(STATUS_UNCERTAIN_READBACK_WARNING\)/);
  assert.match(hBlock, /await readDetail\(token\)/);
  assert.doesNotMatch(hBlock, /method: 'PATCH'/);
  const hSetErrorAt = hBlock.indexOf('setReadbackWarning');
  assert.ok(hSetErrorAt !== -1);
});

test('H6. STATUS uncertain keeps fail-closed and manual GET without synthesis', () => {
  assert.match(detailSource, /setReadbackWarning\(STATUS_UNCERTAIN_READBACK_WARNING\)/);
  const recheckAt = detailSource.indexOf('recheck');
  assert.match(detailSource, /readDetail\(token\)/);
  assert.doesNotMatch(detailSource, /setOrder\(\{\s*\.\.\.order/);
  for (const marker of ['malformed JSON', 'ACK orderId', '403/409']) {
    const at = detailSource.indexOf(marker);
    assert.ok(at !== -1);
    const block = detailSource.slice(at, at + 900);
    assert.doesNotMatch(block, /router\.replace/);
  }
});

test('H7. HOLD uncertain constants exist without resend copy', () => {
  assert.match(holdModalSource, /HOLD_UNCERTAIN_CONVERGENCE_MESSAGE/);
  assert.match(holdModalSource, /HOLD_UNCERTAIN_READBACK_WARNING/);
  assert.match(detailSource, /HOLD_UNCERTAIN_READBACK_WARNING/);
  assert.doesNotMatch(
    holdModalSource,
    /주문 상태를 확인하고 다시 시도해주세요/,
  );
  assert.doesNotMatch(holdModalSource, /setTimeout\(submit/);
  assert.doesNotMatch(holdModalSource, /setInterval/);
});

test('H8. HOLD F/G other 4xx-5xx converges to parent GET and closes modal', () => {
  const fnAt = holdModalSource.indexOf('async function submit');
  assert.ok(fnAt !== -1);
  const fgMarker = holdModalSource.indexOf('F/G:', fnAt);
  assert.ok(fgMarker !== -1);
  const after = holdModalSource.slice(fgMarker, fgMarker + 1400);
  assert.match(after, /setError\(HOLD_UNCERTAIN_CONVERGENCE_MESSAGE\)/);
  assert.match(after, /onUncertainConvergence\?\.\(\)/);
  assert.match(after, /onClose\(\)/);
  assert.match(after, /return;/);
  const patchCount = (holdModalSource.match(/method: 'PATCH'/g) ?? []).length;
  assert.equal(patchCount, 1);
});

test('H9. HOLD B/C malformed and mismatch converge to parent GET', () => {
  const fnAt = holdModalSource.indexOf('async function submit');
  const bMarker = holdModalSource.indexOf('malformed JSON', fnAt);
  assert.ok(bMarker !== -1);
  const bBlock = holdModalSource.slice(bMarker, bMarker + 700);
  assert.match(bBlock, /await response\.json\(\)/);
  assert.match(bBlock, /setError\(HOLD_UNCERTAIN_CONVERGENCE_MESSAGE\)/);
  assert.match(bBlock, /onUncertainConvergence\?\.\(\)/);
  assert.match(bBlock, /onClose\(\)/);
  assert.doesNotMatch(bBlock, /method: 'PATCH'/);
  const cMarker = holdModalSource.indexOf('ACK orderId', fnAt);
  assert.ok(cMarker !== -1);
  const cBlock = holdModalSource.slice(cMarker, cMarker + 700);
  assert.match(cBlock, /result\.orderId !== orderId/);
  assert.match(cBlock, /setError\(HOLD_UNCERTAIN_CONVERGENCE_MESSAGE\)/);
  assert.match(cBlock, /onUncertainConvergence\?\.\(\)/);
  assert.match(cBlock, /onClose\(\)/);
  assert.doesNotMatch(cBlock, /method: 'PATCH'/);
});

test('H10. HOLD H network catch converges to parent GET and closes modal', () => {
  const fnAt = holdModalSource.indexOf('async function submit');
  const savedAt = holdModalSource.indexOf('onSaved', fnAt);
  assert.ok(savedAt !== -1);
  const catchAt = holdModalSource.indexOf('} catch {', savedAt);
  assert.ok(catchAt !== -1);
  const hBlock = holdModalSource.slice(catchAt, catchAt + 900);
  assert.match(hBlock, /setError\(HOLD_UNCERTAIN_CONVERGENCE_MESSAGE\)/);
  assert.match(hBlock, /onUncertainConvergence\?\.\(\)/);
  assert.match(hBlock, /onClose\(\)/);
  assert.doesNotMatch(hBlock, /method: 'PATCH'/);
});

test('H11. HOLD parent uncertain sets warning before GET and blocks resubmit', () => {
  assert.match(detailSource, /onUncertainConvergence=\{/);
  const at = detailSource.indexOf('onUncertainConvergence={');
  assert.ok(at !== -1);
  const block = detailSource.slice(at, at + 1000);
  assert.match(block, /setReadbackWarning\(HOLD_UNCERTAIN_READBACK_WARNING\)/);
  assert.match(block, /void readDetail\(token\)/);
  assert.ok(
    block.indexOf('setReadbackWarning(HOLD_UNCERTAIN_READBACK_WARNING)') <
      block.indexOf('void readDetail(token)'),
  );
  assert.match(detailSource, /disabled=\{loading \|\| !commandsAllowed\}/);
  assert.match(detailSource, /readDetail\(token\)/);
  assert.match(holdModalSource, /classifyDriverOrderCommandError\(\{/);
  assert.match(holdModalSource, /onSaved\?\.\(\)/);
});

test('H12. uncertain warning blocks risk commands at runtime', () => {
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
      readErrorKind: 'FETCH_ERROR',
      hasReadbackWarning: false,
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
  assert.equal(shouldPreserveDriverOrderOnReadError('FETCH_ERROR', true), true);
  assert.equal(shouldPreserveDriverOrderOnReadError('AUTH_ERROR', true), false);
  assert.equal(shouldPreserveDriverOrderOnReadError('NOT_FOUND', true), false);
});

// 8. DeliveryHoldModal authority 403 → stale-conflict 분기로 오분류하지 않음.
test('8. HoldModal authority 403은 stale 분기로 오분류하지 않는다', () => {
  assert.equal(
    classifyDriverOrderCommandError({ status: 403, code: 'DRIVER_ORDER_AUTHORITY_DENIED' }),
    'AUTHORITY_LOSS',
  );
  const authAt = holdModalSource.indexOf("recovery === 'AUTHORITY_LOSS'");
  assert.ok(authAt !== -1, 'modal AUTHORITY_LOSS 분기가 있어야 한다');
  const authBlock = holdModalSource.slice(authAt, authAt + 350);
  assert.match(authBlock, /onAuthorityLoss\?\.\(\)/);
  assert.match(authBlock, /onClose\(\)/);
  assert.doesNotMatch(authBlock, /onConvergence\?\.\(\)/);
  // parent는 authority-loss를 order clear + AUTH_ERROR + close로 수렴한다.
  const parentAt = detailSource.indexOf('onAuthorityLoss={');
  assert.ok(parentAt !== -1, 'parent onAuthorityLoss가 있어야 한다');
  const parentBlock = detailSource.slice(parentAt, parentAt + 800);
  assert.match(parentBlock, /hasOrderRef\.current = false/);
  assert.match(parentBlock, /setOrder\(null\)/);
  assert.match(parentBlock, /kind: 'AUTH_ERROR'/);
  assert.match(parentBlock, /setHoldOpened\(false\)/);
});

// 9. DeliveryHoldModal state-conflict 403 → authority loss로 오분류하지 않음.
test('9. HoldModal state-conflict 403은 authority loss로 오분류하지 않는다', () => {
  assert.equal(
    classifyDriverOrderCommandError({ status: 403, code: 'DRIVER_ORDER_STATE_CONFLICT' }),
    'STATE_CONFLICT',
  );
  const stateAt = holdModalSource.indexOf("recovery === 'STATE_CONFLICT'");
  assert.ok(stateAt !== -1);
  const stateBlock = holdModalSource.slice(stateAt, stateAt + 600);
  assert.match(stateBlock, /HOLD_STALE_CONVERGENCE_MESSAGE/);
  assert.match(stateBlock, /onConvergence\?\.\(\)/);
  assert.doesNotMatch(stateBlock, /onAuthorityLoss/);
  assert.doesNotMatch(stateBlock, /로그인 정보를 다시 확인해 주세요/);
});

// 10. 기존 409 race convergence 유지 (409 STATE → GET, resend 없음).
test('10. 기존 409 race convergence가 유지된다', () => {
  assert.equal(
    classifyDriverOrderCommandError({ status: 409, code: 'DRIVER_ORDER_STATE_CONFLICT' }),
    'STATE_CONFLICT',
  );
  assert.equal(readDriverOrderErrorCode({ code: 'DRIVER_ORDER_ALREADY_APPLIED' }), null);
  const patchCount = (detailSource.match(/method: 'PATCH'/g) ?? []).length;
  assert.equal(patchCount, 1, 'detail PATCH는 상태 전환 1회뿐이다');
  const holdPatchCount = (holdModalSource.match(/method: 'PATCH'/g) ?? []).length;
  assert.equal(holdPatchCount, 1, 'hold PATCH는 1회뿐이다');
  assert.doesNotMatch(detailSource, /setTimeout\(updateStatus/);
  assert.doesNotMatch(holdModalSource, /setTimeout\(submit/);
});
