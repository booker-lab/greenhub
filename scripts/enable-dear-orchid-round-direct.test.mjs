import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTransitionPlan,
  EXPECTED_PROJECT_ID,
  expectedConfirmation,
  loadCredentialRecord,
  parseOptions,
  run,
  TARGET_STORE_ID,
  TARGET_STORE_NAME,
} from './enable-dear-orchid-round-direct.mjs';

function target(overrides = {}) {
  const data = {
    id: TARGET_STORE_ID,
    name: TARGET_STORE_NAME,
    ownerId: 'owner-1',
    status: 'active',
    ...overrides.data,
  };
  if (overrides.salesModePresent) data.salesMode = overrides.salesMode;
  return {
    id: overrides.id ?? TARGET_STORE_ID,
    data,
    salesModePresent: overrides.salesModePresent ?? false,
    updateTimeMillis: 1_781_153_935_830,
  };
}

test('dry-run 옵션은 기본 변경 예정값을 round_direct로 고정한다', () => {
  assert.deepEqual(parseOptions(['--dry-run']), {
    apply: false,
    dryRun: true,
    targetMode: 'round_direct',
    confirmation: null,
  });
});

test('대상 없음과 다중 대상을 모두 거부한다', () => {
  assert.throws(
    () =>
      buildTransitionPlan({
        candidates: [],
        targetMode: 'round_direct',
        apply: false,
        confirmation: null,
      }),
    /대상 없음/,
  );
  assert.throws(
    () =>
      buildTransitionPlan({
        candidates: [target(), target({ id: 'duplicate-store' })],
        targetMode: 'round_direct',
        apply: false,
        confirmation: null,
      }),
    /다중 대상/,
  );
});

test('미설정 salesMode는 legacy 호환값으로만 해석한다', () => {
  const plan = buildTransitionPlan({
    candidates: [target()],
    targetMode: 'round_direct',
    apply: false,
    confirmation: null,
  });

  assert.equal(plan.rawCurrentMode, '미설정');
  assert.equal(plan.currentMode, 'legacy');
  assert.equal(plan.targetMode, 'round_direct');
});

test('이미 round_direct인 대상은 재실행을 거부한다', () => {
  assert.throws(
    () =>
      buildTransitionPlan({
        candidates: [target({ salesModePresent: true, salesMode: 'round_direct' })],
        targetMode: 'round_direct',
        apply: false,
        confirmation: null,
      }),
    /이미 round_direct/,
  );
});

test('허용되지 않은 현재 salesMode는 손상 상태로 거부한다', () => {
  assert.throws(
    () =>
      buildTransitionPlan({
        candidates: [target({ salesModePresent: true, salesMode: 'broken' })],
        targetMode: 'round_direct',
        apply: false,
        confirmation: null,
      }),
    /현재 상태 손상/,
  );
});

test('실제 변경은 정확한 확인 플래그 없이는 거부한다', () => {
  assert.throws(
    () =>
      buildTransitionPlan({
        candidates: [target()],
        targetMode: 'round_direct',
        apply: true,
        confirmation: null,
      }),
    /확인 플래그 누락/,
  );
  assert.throws(
    () =>
      buildTransitionPlan({
        candidates: [target()],
        targetMode: 'round_direct',
        apply: true,
        confirmation: '잘못된-확인',
      }),
    /확인 플래그 불일치/,
  );
});

test('정확한 확인값은 storeId와 현재·변경 모드를 모두 포함한다', () => {
  assert.equal(
    expectedConfirmation(TARGET_STORE_ID, 'legacy', 'round_direct'),
    `${TARGET_STORE_ID}:legacy:round_direct`,
  );
});

test('인증 정보가 없으면 로컬 연결 전에 거부한다', () => {
  assert.throws(
    () =>
      loadCredentialRecord({
        env: {},
        credentialPath: '존재하지-않는-인증.json',
        exists: () => false,
      }),
    /인증 누락/,
  );
});

test('dry-run은 조회 결과를 출력하되 변경 어댑터를 호출하지 않는다', async () => {
  let applyCalls = 0;
  const output = [];

  const result = await run(['--dry-run'], {
    loadCredential: () => ({
      record: { project_id: EXPECTED_PROJECT_ID },
      source: '테스트 인증',
    }),
    connect: () => ({
      findTargets: async () => [target()],
      applyTransition: async () => {
        applyCalls += 1;
      },
    }),
    log: (line) => output.push(line),
  });

  assert.equal(applyCalls, 0);
  assert.equal(result.changed, false);
  assert.match(output.join('\n'), /외부 상태 변경: 없음/);
  assert.match(output.join('\n'), new RegExp(TARGET_STORE_ID));
});

test('실제 변경 경로는 확인 플래그가 정확할 때만 어댑터를 호출한다', async () => {
  let applyCalls = 0;
  const confirmation = expectedConfirmation(TARGET_STORE_ID, 'legacy', 'round_direct');

  const result = await run(['--apply', '--target-mode=round_direct', `--confirm=${confirmation}`], {
    loadCredential: () => ({
      record: { project_id: EXPECTED_PROJECT_ID },
      source: '테스트 인증',
    }),
    connect: () => ({
      findTargets: async () => [target()],
      applyTransition: async () => {
        applyCalls += 1;
        return buildTransitionPlan({
          candidates: [target()],
          targetMode: 'round_direct',
          apply: true,
          confirmation,
        });
      },
    }),
    log: () => {},
  });

  assert.equal(applyCalls, 1);
  assert.equal(result.changed, true);
});

test('롤백 경로는 round_direct에서 legacy로만 명확히 출력한다', () => {
  const plan = buildTransitionPlan({
    candidates: [target()],
    targetMode: 'round_direct',
    apply: false,
    confirmation: null,
  });

  assert.equal(plan.rollbackTargetMode, 'legacy');
  assert.match(plan.rollbackCommand, /--target-mode=legacy/);
  assert.match(plan.rollbackCommand, new RegExp(`${TARGET_STORE_ID}:round_direct:legacy`));
});
