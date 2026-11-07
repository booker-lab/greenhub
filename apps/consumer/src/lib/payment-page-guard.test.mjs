import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./payment-page-guard.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'payment-page-guard.ts',
}).outputText;
const guardModule = { exports: {} };
new Function('module', 'exports', compiled)(guardModule, guardModule.exports);
const { attachPaymentPageGuard, shouldResetPaymentOnPageShow, shouldWarnBeforeUnload } =
  guardModule.exports;

const PHASES = ['idle', 'creating', 'paying', 'done', 'error'];

test('이탈 확인창은 주문 생성 중에만 띄우고 결제사 이동(paying)에서는 띄우지 않는다', () => {
  assert.deepEqual(
    PHASES.filter((phase) => shouldWarnBeforeUnload(phase)),
    ['creating'],
  );
});

test('메모리에서 복원된 페이지(persisted)의 결제사 이동 단계만 결제 전 상태로 되돌린다', () => {
  assert.deepEqual(
    PHASES.filter((phase) => shouldResetPaymentOnPageShow(phase, true)),
    ['paying'],
  );
  for (const phase of PHASES) assert.equal(shouldResetPaymentOnPageShow(phase, false), false);
});

function createTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type, listener) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((candidate) => candidate !== listener),
      );
    },
    dispatch(type, init = {}) {
      const event = {
        type,
        defaultPrevented: false,
        returnValue: undefined,
        preventDefault() {
          this.defaultPrevented = true;
        },
        ...init,
      };
      for (const listener of listeners.get(type) ?? []) listener(event);
      return event;
    },
  };
}

test('붙인 경고는 이벤트 순간의 단계로 판단하고, 떼면 더 이상 반응하지 않는다', () => {
  const target = createTarget();
  let phase = 'creating';
  let restored = 0;
  const detach = attachPaymentPageGuard(target, {
    getPhase: () => phase,
    onRestore: () => {
      restored += 1;
    },
  });

  const creating = target.dispatch('beforeunload');
  assert.equal(creating.defaultPrevented, true);
  assert.equal(creating.returnValue, '');

  // 렌더를 기다리지 않고 단계가 바뀐 즉시 결제사 이동은 막지 않는다.
  phase = 'paying';
  const paying = target.dispatch('beforeunload');
  assert.equal(paying.defaultPrevented, false);
  assert.equal(paying.returnValue, undefined);

  target.dispatch('pageshow', { persisted: false });
  assert.equal(restored, 0);
  target.dispatch('pageshow', { persisted: true });
  assert.equal(restored, 1);

  phase = 'idle';
  target.dispatch('pageshow', { persisted: true });
  assert.equal(restored, 1);

  detach();
  phase = 'creating';
  assert.equal(target.dispatch('beforeunload').defaultPrevented, false);
  phase = 'paying';
  target.dispatch('pageshow', { persisted: true });
  assert.equal(restored, 1);
});
