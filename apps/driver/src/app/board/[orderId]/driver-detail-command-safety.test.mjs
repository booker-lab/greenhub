import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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

// E. 403/409 → 자동 재전송 0회 → 상태 재확인 UX.
test('E. 403/409는 자동 재전송 없이 authoritative read로 수렴한다', () => {
  // detail: 403/409 분기가 readDetail 수렴 + return이며 PATCH를 추가 호출하지 않는다.
  const branchAt = detailSource.indexOf('res.status === 403 || res.status === 409');
  assert.ok(branchAt !== -1, '403/409 분기가 있어야 한다');
  const branchBlock = detailSource.slice(branchAt, branchAt + 700);
  assert.match(branchBlock, new RegExp(CONVERGENCE_MESSAGE.replace(/\./g, '\\.')));
  assert.match(branchBlock, /await readDetail\(token\)/);
  assert.match(branchBlock, /return;/);
  assert.doesNotMatch(branchBlock, /method: 'PATCH'/);
  // modal: 403/409 분기가 convergence reread 유도 + return이며 PATCH를 추가 호출하지 않는다.
  const modalBranchAt = holdModalSource.indexOf('response.status === 403 || response.status === 409');
  assert.ok(modalBranchAt !== -1, 'modal 403/409 분기가 있어야 한다');
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
