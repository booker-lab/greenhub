// Proof for GREENHUB-COORDINATION-DISPOSITION-STORE-07.
// Disposition persistence/state/fencing ONLY. No materialization, ACK/CONSUMED,
// cursor, emission, adapters, Astra/OpenCode, Control Tower loop, publication.
// All runtime state lives in isolated temp directories. No network required.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveCoordinationHome } from './coordination-home.mjs';
import {
  TASK_STATUS_RESULT_DELIVERED,
  validateResultEnvelope,
} from './task-envelope.mjs';
import {
  DISPOSITION_STATE_ADOPTED,
  DISPOSITION_STATE_BLOCKED,
  DISPOSITION_STATE_NEEDS_USER,
  DISPOSITION_STATE_PENDING,
  DISPOSITION_STATE_REJECTED,
  DISPOSITION_STATE_SUPERSEDED,
  buildCanonicalTransitionId,
  computeResultBinding,
  dispositionRef,
} from './disposition.mjs';
import { CoordinationStore } from './store.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(MODULE_DIRECTORY, '../..');
const STORE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'store.mjs')).href;

function makeHome(prefix = 'greenhub-disp-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'DISPOSITION_STORE_IMPLEMENTED',
    policyRefs: ['docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md'],
    evidenceRefs: ['git:live-main-read'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: {
      liveMainHint: null,
      requiredPolicies: ['AGENTS.md'],
    },
    ownedSurface: ['scripts/coordination/'],
    mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['disposition-durable', 'fencing-proof'],
    ...overrides,
  };
}

function controllableClock(startMs = 1_700_000_000_000) {
  let now = startMs;
  return {
    get now() {
      return now;
    },
    advance(ms) {
      now += ms;
    },
    provider() {
      return now;
    },
  };
}

function sampleResult(claim, overrides = {}) {
  return {
    taskId: claim.taskId,
    resultId: 'result-0001',
    workerId: claim.workerId,
    claimToken: claim.claimToken,
    claimGeneration: claim.generation,
    status: 'SUCCEEDED',
    summary: 'bounded executor output',
    proofRefs: ['store:read-back'],
    evidenceRefs: ['test:temp-home'],
    frictionObserved: ['NONE'],
    ...overrides,
  };
}

function driveToDelivered(store, taskId, resultId = 'result-0001') {
  store.createTask(sampleTaskInput(taskId));
  store.markReady(taskId);
  const claim = store.claimTask({ taskId, workerId: 'worker-a', leaseDurationMs: 60_000 });
  const delivered = store.deliverResult(sampleResult(claim, { resultId }));
  return { claim, delivered };
}

function ctParams(overrides = {}) {
  return {
    controlTowerToken: 'ct-token-001',
    controlTowerId: 'control-tower-1',
    policyRefs: ['policy:control-tower-verdict'],
    proofRefs: ['proof:result-readback'],
    evidenceRefs: ['evidence:result-binding'],
    ...overrides,
  };
}

function userGate(overrides = {}) {
  return {
    decisionRequestId: 'dec-req-001',
    questionVersion: 'v1',
    requiredAuthority: 'PRODUCT_OWNER',
    ...overrides,
  };
}

test('1. RESULT_DELIVERED does not automatically create ADOPTED', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToDelivered(store, 'DISP01A');
    assert.equal(store.readTask('DISP01A').status, TASK_STATUS_RESULT_DELIVERED);
    assert.throws(() => store.readCurrentDisposition('DISP01A'), (error) => error?.code === 'DISPOSITION_NOT_FOUND');
    assert.equal(existsSync(join(home, 'tasks', 'DISP01A', 'disposition', 'current.json')), false);
  } finally {
    removeHome(home);
  }
});

test('2. Disposition cannot reference missing RESULT', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    store.createTask(sampleTaskInput('DISP02A'));
    store.markReady('DISP02A');
    assert.throws(
      () => store.beginDisposition({ taskId: 'DISP02A', ...ctParams() }),
      (error) => ['DISPOSITION_TASK_NOT_DELIVERED', 'DISPOSITION_MISSING_RESULT'].includes(error?.code),
    );

    driveToDelivered(store, 'DISP02B', 'result-02b');
    assert.throws(
      () =>
        store.beginDisposition({
          taskId: 'DISP02B',
          resultId: 'result-that-does-not-exist',
          ...ctParams(),
        }),
      (error) => error?.code === 'DISPOSITION_RESULT_MISMATCH',
    );
  } finally {
    removeHome(home);
  }
});

test('3. First disposition generation persists durably', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { delivered } = driveToDelivered(store, 'DISP03A', 'result-03a');
    const written = store.beginDisposition({ taskId: 'DISP03A', resultId: 'result-03a', ...ctParams() });
    assert.equal(written.duplicate, false);
    assert.equal(written.record.dispositionGeneration, 1);
    assert.equal(written.record.state, DISPOSITION_STATE_PENDING);
    assert.equal(written.record.taskId, 'DISP03A');
    assert.equal(written.record.resultId, 'result-03a');
    assert.equal(written.record.claimGeneration, delivered.record.claimGeneration);
    assert.equal(written.record.resultBinding, computeResultBinding(delivered.record));
    assert.equal(
      written.record.canonicalTransitionId,
      buildCanonicalTransitionId({
        taskId: 'DISP03A',
        dispositionGeneration: 1,
        resultId: 'result-03a',
      }),
    );
    assert.equal(dispositionRef('DISP03A', 1), 'DISP03A@1');
    assert.equal(existsSync(join(home, 'tasks', 'DISP03A', 'disposition', 'generations', '1.json')), true);
    assert.equal(existsSync(join(home, 'tasks', 'DISP03A', 'disposition', 'current.json')), true);
    // RESULT remains separate immutable input evidence.
    const canonical = store.readResult('DISP03A');
    validateResultEnvelope(canonical);
    assert.equal(canonical.resultId, 'result-03a');
  } finally {
    removeHome(home);
  }
});

test('4. Store recreation can reread disposition', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const first = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToDelivered(first, 'DISP04A', 'result-04a');
    const written = first.beginDisposition({ taskId: 'DISP04A', resultId: 'result-04a', ...ctParams() });

    const second = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const current = second.readCurrentDisposition('DISP04A');
    const generation = second.readDispositionGeneration('DISP04A', 1);
    assert.deepEqual(current, written.record);
    assert.deepEqual(generation, written.record);
  } finally {
    removeHome(home);
  }
});

test('5. Same disposition replay is idempotent', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToDelivered(store, 'DISP05A', 'result-05a');
    const params = { taskId: 'DISP05A', resultId: 'result-05a', ...ctParams() };
    const first = store.beginDisposition(params);
    assert.equal(first.duplicate, false);
    const replay = store.beginDisposition(params);
    assert.equal(replay.duplicate, true);
    assert.deepEqual(replay.record, first.record);
    assert.equal(store.readCurrentDisposition('DISP05A').dispositionGeneration, 1);
  } finally {
    removeHome(home);
  }
});

test('6. Same generation conflicting payload fails DISPOSITION_CONFLICT', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToDelivered(store, 'DISP06A', 'result-06a');
    store.beginDisposition({ taskId: 'DISP06A', resultId: 'result-06a', ...ctParams() });
    assert.throws(
      () =>
        store.beginDisposition({
          taskId: 'DISP06A',
          resultId: 'result-06a',
          ...ctParams({ controlTowerToken: 'ct-token-DIFFERENT' }),
        }),
      (error) => error?.code === 'DISPOSITION_CONFLICT',
    );
    // Winner is never overwritten.
    assert.equal(store.readCurrentDisposition('DISP06A').controlTowerToken, 'ct-token-001');
  } finally {
    removeHome(home);
  }
});

test('7. Stale generation fails STALE_DISPOSITION_GENERATION', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToDelivered(store, 'DISP07A', 'result-07a');
    store.beginDisposition({ taskId: 'DISP07A', resultId: 'result-07a', ...ctParams() });
    clock.advance(1000);
    store.writeDisposition({
      taskId: 'DISP07A',
      dispositionGeneration: 2,
      resultId: 'result-07a',
      ...ctParams({ controlTowerToken: 'ct-token-002' }),
      state: DISPOSITION_STATE_BLOCKED,
    });
    assert.equal(store.readCurrentDisposition('DISP07A').dispositionGeneration, 2);
    assert.throws(
      () =>
        store.writeDisposition({
          taskId: 'DISP07A',
          dispositionGeneration: 1,
          resultId: 'result-07a',
          ...ctParams(),
          state: DISPOSITION_STATE_PENDING,
        }),
      (error) => error?.code === 'STALE_DISPOSITION_GENERATION',
    );
  } finally {
    removeHome(home);
  }
});

function runDispositionRaceWorker({ home, taskId, generation, controlTowerToken, state }) {
  return new Promise((resolveResult, rejectResult) => {
    const code = [
      'try {',
      `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
      `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
      `  const out = store.writeDisposition({ taskId: ${JSON.stringify(taskId)}, dispositionGeneration: ${generation}, resultId: 'result-08a', controlTowerToken: ${JSON.stringify(controlTowerToken)}, controlTowerId: 'control-tower-1', state: ${JSON.stringify(state)}, policyRefs: ['policy:race'], proofRefs: ['proof:race'], evidenceRefs: ['evidence:race'] });`,
      '  console.log(JSON.stringify({ ok: true, duplicate: out.duplicate, token: out.record.controlTowerToken }));',
      '} catch (error) {',
      '  console.log(JSON.stringify({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error) }));',
      '}',
    ].join('\n');
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', rejectResult);
    child.once('close', (exitCode) => {
      if (exitCode !== 0) {
        rejectResult(new Error(`disposition race worker exit=${exitCode} stderr=${stderr}`));
        return;
      }
      try {
        resolveResult(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch (error) {
        rejectResult(new Error(`disposition race worker output parse failed: ${stdout} / ${stderr}`));
      }
    });
  });
}

test('8. Two competing writers: exactly one canonical winner', { timeout: 30_000 }, async () => {
  const home = makeHome('greenhub-disp-race-');
  try {
    const setup = new CoordinationStore({ dir: home });
    driveToDelivered(setup, 'DISP08A', 'result-08a');
    setup.beginDisposition({ taskId: 'DISP08A', resultId: 'result-08a', ...ctParams() });

    const [first, second] = await Promise.all([
      runDispositionRaceWorker({
        home,
        taskId: 'DISP08A',
        generation: 2,
        controlTowerToken: 'ct-race-A',
        state: DISPOSITION_STATE_BLOCKED,
      }),
      runDispositionRaceWorker({
        home,
        taskId: 'DISP08A',
        generation: 2,
        controlTowerToken: 'ct-race-B',
        state: DISPOSITION_STATE_BLOCKED,
      }),
    ]);
    const winners = [first, second].filter((result) => result.ok === true);
    const losers = [first, second].filter((result) => result.ok !== true);
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.equal(losers[0].code, 'DISPOSITION_CONFLICT');

    const stored = setup.readCurrentDisposition('DISP08A');
    assert.equal(stored.dispositionGeneration, 2);
    assert.equal(stored.controlTowerToken, winners[0].token);
    assert.ok(['ct-race-A', 'ct-race-B'].includes(stored.controlTowerToken));
  } finally {
    removeHome(home);
  }
});

test('9. Generation history remains immutable', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToDelivered(store, 'DISP09A', 'result-09a');
    store.beginDisposition({ taskId: 'DISP09A', resultId: 'result-09a', ...ctParams() });
    const beforeRaw = readFileSync(join(home, 'tasks', 'DISP09A', 'disposition', 'generations', '1.json'), 'utf8');
    clock.advance(1000);
    store.writeDisposition({
      taskId: 'DISP09A',
      dispositionGeneration: 2,
      resultId: 'result-09a',
      ...ctParams({ controlTowerToken: 'ct-token-002' }),
      state: DISPOSITION_STATE_BLOCKED,
    });
    const afterRaw = readFileSync(join(home, 'tasks', 'DISP09A', 'disposition', 'generations', '1.json'), 'utf8');
    assert.equal(afterRaw, beforeRaw);
    assert.equal(store.readDispositionGeneration('DISP09A', 1).state, DISPOSITION_STATE_PENDING);
    assert.equal(store.readCurrentDisposition('DISP09A').state, DISPOSITION_STATE_BLOCKED);
  } finally {
    removeHome(home);
  }
});

test('10. BLOCKED -> new PENDING generation works when explicitly re-evaluated', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToDelivered(store, 'DISP10A', 'result-10a');
    store.beginDisposition({ taskId: 'DISP10A', resultId: 'result-10a', ...ctParams() });
    clock.advance(1000);
    const blocked = store.writeDisposition({
      taskId: 'DISP10A',
      dispositionGeneration: 2,
      resultId: 'result-10a',
      ...ctParams({ controlTowerToken: 'ct-token-002' }),
      state: DISPOSITION_STATE_BLOCKED,
    });
    assert.equal(blocked.record.state, DISPOSITION_STATE_BLOCKED);
    clock.advance(1000);
    const pending = store.writeDisposition({
      taskId: 'DISP10A',
      dispositionGeneration: 3,
      resultId: 'result-10a',
      ...ctParams({ controlTowerToken: 'ct-token-003' }),
      state: DISPOSITION_STATE_PENDING,
    });
    assert.equal(pending.record.state, DISPOSITION_STATE_PENDING);
    assert.equal(pending.record.supersedes, 2);
    assert.equal(store.readCurrentDisposition('DISP10A').dispositionGeneration, 3);
  } finally {
    removeHome(home);
  }
});

test('11. NEEDS_USER_DECISION is durable across process/store recreation', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const first = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToDelivered(first, 'DISP11A', 'result-11a');
    first.beginDisposition({ taskId: 'DISP11A', resultId: 'result-11a', ...ctParams() });
    clock.advance(1000);
    first.writeDisposition({
      taskId: 'DISP11A',
      dispositionGeneration: 2,
      resultId: 'result-11a',
      ...ctParams({ controlTowerToken: 'ct-token-002' }),
      state: DISPOSITION_STATE_NEEDS_USER,
      userDecision: userGate(),
    });
    const second = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const reread = second.readCurrentDisposition('DISP11A');
    assert.equal(reread.state, DISPOSITION_STATE_NEEDS_USER);
    assert.deepEqual(reread.userDecision, userGate());
    assert.equal(reread.dispositionGeneration, 2);
  } finally {
    removeHome(home);
  }
});

test('12. Resolved authority can return through new PENDING without rewriting history', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToDelivered(store, 'DISP12A', 'result-12a');
    store.beginDisposition({ taskId: 'DISP12A', resultId: 'result-12a', ...ctParams() });
    clock.advance(1000);
    store.writeDisposition({
      taskId: 'DISP12A',
      dispositionGeneration: 2,
      resultId: 'result-12a',
      ...ctParams({ controlTowerToken: 'ct-token-002' }),
      state: DISPOSITION_STATE_NEEDS_USER,
      userDecision: userGate(),
    });
    const gateBefore = store.readDispositionGeneration('DISP12A', 2);
    clock.advance(1000);
    const returned = store.writeDisposition({
      taskId: 'DISP12A',
      dispositionGeneration: 3,
      resultId: 'result-12a',
      ...ctParams({ controlTowerToken: 'ct-token-003' }),
      state: DISPOSITION_STATE_PENDING,
      userDecision: userGate({ decisionRecordRef: 'decision:record-2026-001' }),
    });
    assert.equal(returned.record.state, DISPOSITION_STATE_PENDING);
    assert.equal(returned.record.userDecision.decisionRecordRef, 'decision:record-2026-001');
    assert.deepEqual(store.readDispositionGeneration('DISP12A', 2), gateBefore);
    assert.equal(store.readCurrentDisposition('DISP12A').dispositionGeneration, 3);
  } finally {
    removeHome(home);
  }
});

test('13. Corrupt generation fails closed', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToDelivered(store, 'DISP13A', 'result-13a');
    store.beginDisposition({ taskId: 'DISP13A', resultId: 'result-13a', ...ctParams() });
    writeFileSync(join(home, 'tasks', 'DISP13A', 'disposition', 'generations', '1.json'), '{not-json', 'utf8');
    assert.throws(() => store.readCurrentDisposition('DISP13A'), (error) => error?.code === 'CORRUPT_DISPOSITION');
    assert.throws(() => store.readDispositionGeneration('DISP13A', 1), (error) => error?.code === 'CORRUPT_DISPOSITION');
    // No automatic repair: corruption is still on disk.
    assert.equal(readFileSync(join(home, 'tasks', 'DISP13A', 'disposition', 'generations', '1.json'), 'utf8'), '{not-json');
  } finally {
    removeHome(home);
  }
});

test('14. Corrupt current pointer fails closed', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToDelivered(store, 'DISP14A', 'result-14a');
    store.beginDisposition({ taskId: 'DISP14A', resultId: 'result-14a', ...ctParams() });
    writeFileSync(join(home, 'tasks', 'DISP14A', 'disposition', 'current.json'), '{broken', 'utf8');
    assert.throws(() => store.readCurrentDisposition('DISP14A'), (error) => error?.code === 'CORRUPT_DISPOSITION');
  } finally {
    removeHome(home);
  }
});

test('15. Result binding mismatch fails closed', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToDelivered(store, 'DISP15A', 'result-15a');
    store.beginDisposition({ taskId: 'DISP15A', resultId: 'result-15a', ...ctParams() });
    // Tamper the canonical result with a different valid envelope (same ids, new summary).
    const tampered = {
      ...store.readResult('DISP15A'),
      summary: 'tampered executor output with different bytes',
    };
    writeFileSync(join(home, 'tasks', 'DISP15A', 'result.json'), JSON.stringify(tampered, null, 2), 'utf8');
    assert.throws(() => store.readCurrentDisposition('DISP15A'), (error) => error?.code === 'DISPOSITION_RESULT_BINDING_MISMATCH');
  } finally {
    removeHome(home);
  }
});

test('16. Reference-first/context-budget violations rejected', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToDelivered(store, 'DISP16A', 'result-16a');
    store.beginDisposition({ taskId: 'DISP16A', resultId: 'result-16a', ...ctParams() });
    clock.advance(1000);
    assert.throws(
      () =>
        store.writeDisposition({
          taskId: 'DISP16A',
          dispositionGeneration: 2,
          resultId: 'result-16a',
          ...ctParams({ controlTowerToken: 'ct-token-002' }),
          state: DISPOSITION_STATE_BLOCKED,
          chatHistory: 'entire chat history embedded',
        }),
      (error) => error?.code === 'CONTEXT_BUDGET_EXCEEDED',
    );
    assert.throws(
      () =>
        store.writeDisposition({
          taskId: 'DISP16A',
          dispositionGeneration: 2,
          resultId: 'result-16a',
          ...ctParams({ controlTowerToken: 'ct-token-002' }),
          state: DISPOSITION_STATE_NEEDS_USER,
          userDecision: { ...userGate(), chatHistory: 'embedded transcript' },
        }),
      (error) => error?.code === 'CONTEXT_BUDGET_EXCEEDED',
    );
    assert.throws(
      () =>
        store.writeDisposition({
          taskId: 'DISP16A',
          dispositionGeneration: 2,
          resultId: 'result-16a',
          ...ctParams({ controlTowerToken: 'ct-token-002' }),
          state: DISPOSITION_STATE_BLOCKED,
          proofRefs: ['x'.repeat(600)],
        }),
      (error) => error?.code === 'CONTEXT_BUDGET_EXCEEDED',
    );
    // Failed writes left no generation 2 behind.
    assert.throws(() => store.readDispositionGeneration('DISP16A', 2), (error) => error?.code === 'DISPOSITION_NOT_FOUND');
  } finally {
    removeHome(home);
  }
});

test('ADOPTED / REJECTED / SUPERSEDED persistence + terminal sealing (no rewriting)', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    for (const [taskId, terminal] of [
      ['DISP17A', DISPOSITION_STATE_ADOPTED],
      ['DISP17B', DISPOSITION_STATE_REJECTED],
      ['DISP17C', DISPOSITION_STATE_SUPERSEDED],
    ]) {
      driveToDelivered(store, taskId, `result-${taskId.toLowerCase()}`);
      store.beginDisposition({ taskId, resultId: `result-${taskId.toLowerCase()}`, ...ctParams() });
      clock.advance(1000);
      const written = store.writeDisposition({
        taskId,
        dispositionGeneration: 2,
        resultId: `result-${taskId.toLowerCase()}`,
        ...ctParams({ controlTowerToken: 'ct-token-002' }),
        state: terminal,
      });
      assert.equal(written.record.state, terminal);
      assert.equal(store.readCurrentDisposition(taskId).state, terminal);
      // Terminal states cannot be rewritten in this task.
      clock.advance(1000);
      assert.throws(
        () =>
          store.writeDisposition({
            taskId,
            dispositionGeneration: 3,
            resultId: `result-${taskId.toLowerCase()}`,
            ...ctParams({ controlTowerToken: 'ct-token-003' }),
            state: DISPOSITION_STATE_PENDING,
          }),
        (error) => error?.code === 'DISPOSITION_ILLEGAL_TRANSITION',
      );
    }
  } finally {
    removeHome(home);
  }
});

test('canonicalTransitionId is deterministic (no timestamp/randomness)', () => {
  const first = buildCanonicalTransitionId({
    taskId: 'DISP18A',
    dispositionGeneration: 1,
    resultId: 'result-x',
  });
  const second = buildCanonicalTransitionId({
    taskId: 'DISP18A',
    dispositionGeneration: 1,
    resultId: 'result-x',
  });
  assert.equal(first, second);
  assert.match(first, /^dsp_[0-9a-f]{32}$/);
  const other = buildCanonicalTransitionId({
    taskId: 'DISP18A',
    dispositionGeneration: 2,
    resultId: 'result-x',
  });
  assert.notEqual(first, other);
});

test('Runtime state remains outside repository', () => {
  const fakeBase = makeHome('greenhub-disp-home-resolve-');
  try {
    const resolved = resolveCoordinationHome({
      platform: 'win32',
      env: { LOCALAPPDATA: fakeBase },
    });
    assert.equal(resolved, join(fakeBase, 'Greenhub', 'coordination'));
    assert.equal(resolved.startsWith(REPOSITORY_ROOT), false);

    const runtime = makeHome('greenhub-disp-runtime-');
    try {
      const store = new CoordinationStore({ dir: runtime });
      driveToDelivered(store, 'DISP19A', 'result-19a');
      store.beginDisposition({ taskId: 'DISP19A', resultId: 'result-19a', ...ctParams() });
      for (const artifact of ['task.json', 'claim.json', 'result.json']) {
        assert.equal(existsSync(join(MODULE_DIRECTORY, artifact)), false);
      }
      assert.equal(existsSync(join(REPOSITORY_ROOT, 'task.json')), false);
      assert.equal(existsSync(join(runtime, 'tasks', 'DISP19A', 'disposition', 'current.json')), true);

      const ownedEntries = [
        'coordination-home.mjs',
        'task-envelope.mjs',
        'store.mjs',
        'disposition.mjs',
        'durable-core.spec.mjs',
        'disposition.spec.mjs',
      ];
      for (const entry of ownedEntries) {
        assert.equal(existsSync(join(MODULE_DIRECTORY, entry)), true);
      }
    } finally {
      removeHome(runtime);
    }
  } finally {
    removeHome(fakeBase);
  }
});
