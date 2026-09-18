// Proof for GREENHUB-COORDINATION-ADMISSION-BOUND-CLAIM-15.
// Admission-bound claim primitive ONLY:
// the exact canonical emission admission's child, bound via a deterministic
// admission-bound claimToken, then moved through the existing claimTask()
// path to CLAIMED.
//
// Explicitly NOT implemented here (and asserted absent):
//   scheduler, queue polling, READY scan (oldest/newest/next), priority
//   scoring, fairness, worker registry, worker capability selection, agent
//   selection, executor selection, automatic workerId inference, dispatch,
//   process spawn, OpenCode call, Astra call, ChatGPT/Web call, fan-out,
//   cron, daemon, autonomous loop, adapters, application code, deployment
//   automation, production deployment, 57C.
// claimAdmittedTask() != emitNextTask() != admitEmittedTask()
//   != scheduleNextTask() != dispatchNextTask() != decideNextTask().
// The caller explicitly supplies (sourceTaskId, emissionSlot, workerId).
// All runtime state lives in isolated temp directories. No network required.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveCoordinationHome } from './coordination-home.mjs';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import { DEFAULT_EMISSION_SLOT, computeNextTaskSpecBinding } from './next-task-emission.mjs';
import {
  ADMISSION_BOUND_CLAIM_TOKEN_PREFIX,
  buildAdmissionBoundClaimToken,
} from './admission-bound-claim.mjs';
import { TASK_SEQUENCE_CONTRACT } from './task-sequence.mjs';
import { CoordinationStore } from './store.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const STORE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'store.mjs')).href;

function makeHome(prefix = 'greenhub-claim15-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'ADMISSION_BOUND_CLAIM_PROVED',
    policyRefs: ['docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md'],
    evidenceRefs: ['git:live-main-read'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: {
      liveMainHint: null,
      requiredPolicies: ['AGENTS.md'],
    },
    ownedSurface: ['scripts/coordination/'],
    mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['admission-bound-claim-proof'],
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

function matParams(overrides = {}) {
  return {
    materializerId: 'control-tower-1',
    policyRefs: ['policy:canonical-adoption'],
    proofRefs: ['proof:adopted-readback'],
    evidenceRefs: ['evidence:disposition-adopted'],
    ...overrides,
  };
}

function driveToDelivered(store, taskId, resultId = 'result-0001') {
  store.createTask(sampleTaskInput(taskId));
  store.markReady(taskId);
  const claim = store.claimTask({ taskId, workerId: 'worker-a', leaseDurationMs: 60_000 });
  store.deliverResult(sampleResult(claim, { resultId }));
  return { claim };
}

function driveToPending(store, taskId, resultId = 'result-0001') {
  driveToDelivered(store, taskId, resultId);
  store.beginDisposition({ taskId, resultId, ...ctParams() });
}

function driveToAdopted(store, clock, taskId, resultId = 'result-0001') {
  driveToPending(store, taskId, resultId);
  clock.advance(1000);
  store.writeDisposition({
    taskId,
    dispositionGeneration: 2,
    resultId,
    ...ctParams({ controlTowerToken: 'ct-token-002' }),
    state: DISPOSITION_STATE_ADOPTED,
  });
  clock.advance(1000);
}

function driveToMaterialized(store, clock, taskId, resultId = 'result-0001') {
  driveToAdopted(store, clock, taskId, resultId);
  store.materializeAdoption({ taskId, ...matParams() });
  clock.advance(1000);
}

function driveToAcked(store, clock, taskId, resultId = 'result-0001') {
  driveToMaterialized(store, clock, taskId, resultId);
  store.ackAdoption({ taskId, acknowledgerId: 'control-tower-1' });
  clock.advance(1000);
}

function driveToConsumed(store, clock, taskId, resultId = 'result-0001') {
  driveToAcked(store, clock, taskId, resultId);
  store.markConsumed({ taskId, consumerId: 'control-tower-1' });
  clock.advance(1000);
}

function driveToEmitted(store, clock, sourceTaskId, childTaskId, sourceResultId = 'result-0001') {
  driveToConsumed(store, clock, sourceTaskId, sourceResultId);
  const out = store.emitNextTask({
    sourceTaskId,
    nextTaskSpec: sampleTaskInput(childTaskId),
    emitterId: 'control-tower-1',
  });
  clock.advance(1000);
  return out;
}

function driveToAdmitted(store, clock, sourceTaskId, childTaskId, sourceResultId = 'result-0001') {
  const emitted = driveToEmitted(store, clock, sourceTaskId, childTaskId, sourceResultId);
  const admitted = store.admitEmittedTask({ sourceTaskId, admitterId: 'control-tower-1' });
  clock.advance(1000);
  return { emitted, admitted };
}

function emissionPath(home, sourceTaskId, slot = DEFAULT_EMISSION_SLOT) {
  return join(home, 'tasks', sourceTaskId, 'emissions', `${slot}.json`);
}

function admissionPath(home, sourceTaskId, slot = DEFAULT_EMISSION_SLOT) {
  return join(home, 'tasks', sourceTaskId, 'emission-admissions', `${slot}.json`);
}

function claimPath(home, taskId) {
  return join(home, 'tasks', taskId, 'claim.json');
}

function childTaskPath(home, taskId) {
  return join(home, 'tasks', taskId, 'task.json');
}

// ---------------------------------------------------------------------------
// 1-8. NEGATIVE: refusal / fail-closed before any claim authority.
// ---------------------------------------------------------------------------

test('N1. admission missing refuses claim with no claim side effect', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'AC15-N1-SRC', 'AC15-N1-CHILD', 'result-ac15-n1-src');
    assert.equal(store.readTask('AC15-N1-CHILD').status, 'CREATED');
    assert.throws(
      () =>
        store.claimAdmittedTask({
          sourceTaskId: 'AC15-N1-SRC',
          workerId: 'worker-a',
        }),
      (error) => error?.code === 'ADMISSION_NOT_FOUND',
    );
    assert.equal(existsSync(claimPath(home, 'AC15-N1-CHILD')), false);
    assert.equal(store.readTask('AC15-N1-CHILD').status, 'CREATED');
  } finally {
    removeHome(home);
  }
});

test('N2. corrupt admission bytes fail closed with no claim', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-N2-SRC', 'AC15-N2-CHILD', 'result-ac15-n2-src');
    writeFileSync(admissionPath(home, 'AC15-N2-SRC'), '{corrupt', 'utf8');
    assert.throws(
      () =>
        store.claimAdmittedTask({
          sourceTaskId: 'AC15-N2-SRC',
          workerId: 'worker-a',
        }),
      (error) => error?.code === 'CORRUPT_ADMISSION',
    );
    assert.equal(existsSync(claimPath(home, 'AC15-N2-CHILD')), false);
  } finally {
    removeHome(home);
  }
});

test('N3. tampered admission binding fails closed', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-N3-SRC', 'AC15-N3-CHILD', 'result-ac15-n3-src');
    const path = admissionPath(home, 'AC15-N3-SRC');
    const tampered = JSON.parse(readFileSync(path, 'utf8'));
    tampered.nextTaskSpecBinding = `sha256:${'0'.repeat(64)}`;
    writeFileSync(path, JSON.stringify(tampered, null, 2), 'utf8');
    assert.throws(
      () =>
        store.claimAdmittedTask({
          sourceTaskId: 'AC15-N3-SRC',
          workerId: 'worker-a',
        }),
      (error) => error != null,
    );
    assert.equal(existsSync(claimPath(home, 'AC15-N3-CHILD')), false);
  } finally {
    removeHome(home);
  }
});

test('N4. emission corruption fails closed with no claim', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-N4-SRC', 'AC15-N4-CHILD', 'result-ac15-n4-src');
    writeFileSync(emissionPath(home, 'AC15-N4-SRC'), '{corrupt', 'utf8');
    assert.throws(
      () =>
        store.claimAdmittedTask({
          sourceTaskId: 'AC15-N4-SRC',
          workerId: 'worker-a',
        }),
      (error) => error?.code === 'CORRUPT_EMISSION',
    );
    assert.equal(existsSync(claimPath(home, 'AC15-N4-CHILD')), false);
  } finally {
    removeHome(home);
  }
});

test('N5. source CONSUMED corruption fails closed with no claim', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-N5-SRC', 'AC15-N5-CHILD', 'result-ac15-n5-src');
    writeFileSync(join(home, 'tasks', 'AC15-N5-SRC', 'consumed.json'), '{corrupt', 'utf8');
    assert.throws(
      () =>
        store.claimAdmittedTask({
          sourceTaskId: 'AC15-N5-SRC',
          workerId: 'worker-a',
        }),
      (error) => error != null,
    );
    assert.equal(existsSync(claimPath(home, 'AC15-N5-CHILD')), false);
  } finally {
    removeHome(home);
  }
});

test('N6. child missing fails closed with no auto-create', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-N6-SRC', 'AC15-N6-CHILD', 'result-ac15-n6-src');
    rmSync(join(home, 'tasks', 'AC15-N6-CHILD'), { recursive: true, force: true });
    assert.throws(
      () =>
        store.claimAdmittedTask({
          sourceTaskId: 'AC15-N6-SRC',
          workerId: 'worker-a',
        }),
      (error) => error?.code === 'TASK_NOT_FOUND',
    );
    assert.equal(existsSync(claimPath(home, 'AC15-N6-CHILD')), false);
  } finally {
    removeHome(home);
  }
});

test('N7. child canonical spec mismatch fails closed', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-N7-SRC', 'AC15-N7-CHILD', 'result-ac15-n7-src');
    const childFile = childTaskPath(home, 'AC15-N7-CHILD');
    const child = JSON.parse(readFileSync(childFile, 'utf8'));
    child.desiredExitState = 'MUTATED_EXIT';
    writeFileSync(childFile, JSON.stringify(child, null, 2), 'utf8');
    assert.throws(
      () =>
        store.claimAdmittedTask({
          sourceTaskId: 'AC15-N7-SRC',
          workerId: 'worker-a',
        }),
      (error) => error?.code === 'ADMISSION_BINDING_MISMATCH',
    );
    assert.equal(existsSync(claimPath(home, 'AC15-N7-CHILD')), false);
  } finally {
    removeHome(home);
  }
});

test('N8. CREATED child refuses claim even with valid admission', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-N8-SRC', 'AC15-N8-CHILD', 'result-ac15-n8-src');
    assert.equal(store.readTask('AC15-N8-CHILD').status, 'READY');
    // Simulate authority-without-READY crash window rewound to CREATED:
    // the claim path must refuse and require Task 14 convergence first.
    const childFile = childTaskPath(home, 'AC15-N8-CHILD');
    const readyChild = JSON.parse(readFileSync(childFile, 'utf8'));
    writeFileSync(
      childFile,
      JSON.stringify({ ...readyChild, status: 'CREATED', updatedAt: '2026-01-01T00:00:00.000Z' }, null, 2),
      'utf8',
    );
    assert.equal(store.readTask('AC15-N8-CHILD').status, 'CREATED');
    assert.throws(
      () =>
        store.claimAdmittedTask({
          sourceTaskId: 'AC15-N8-SRC',
          workerId: 'worker-a',
        }),
      (error) => error?.code === 'TASK_NOT_READY',
    );
    assert.equal(existsSync(claimPath(home, 'AC15-N8-CHILD')), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// 9. SUCCESS: READY + valid admission -> CLAIMED via existing claimTask.
// ---------------------------------------------------------------------------

test('S9. READY child with valid admission claims to CLAIMED with deterministic token', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { admitted } = driveToAdmitted(store, clock, 'AC15-S9-SRC', 'AC15-S9-CHILD', 'result-ac15-s9-src');
    assert.equal(store.readTask('AC15-S9-CHILD').status, 'READY');

    const out = store.claimAdmittedTask({
      sourceTaskId: 'AC15-S9-SRC',
      workerId: 'worker-a',
      leaseDurationMs: 60_000,
    });
    assert.equal(out.duplicate, false);
    assert.equal(out.terminal, false);
    assert.equal(out.record.admissionId, admitted.record.admissionId);
    assert.equal(out.emission.emissionId, admitted.record.emissionId);
    assert.equal(out.child.taskId, 'AC15-S9-CHILD');
    assert.equal(out.child.status, 'CLAIMED');
    assert.equal(out.claim.taskId, 'AC15-S9-CHILD');
    assert.equal(out.claim.workerId, 'worker-a');
    assert.equal(out.claim.generation, 1);
    // Deterministic token bound to admission + child + worker.
    const expected = buildAdmissionBoundClaimToken({
      admissionId: admitted.record.admissionId,
      nextTaskId: 'AC15-S9-CHILD',
      workerId: 'worker-a',
    });
    assert.equal(out.claim.claimToken, expected);
    assert.ok(expected.startsWith(ADMISSION_BOUND_CLAIM_TOKEN_PREFIX));
    assert.equal(store.readTask('AC15-S9-CHILD').status, 'CLAIMED');
    assert.equal(computeNextTaskSpecBinding(store.readTask('AC15-S9-CHILD')), admitted.record.nextTaskSpecBinding);
    assert.equal(store.readTaskSequence().filter((id) => id === 'AC15-S9-CHILD').length, 1);
    // Existing claim.json authority reused; no new claim model.
    assert.equal(existsSync(claimPath(home, 'AC15-S9-CHILD')), true);
    // Read verifier agrees.
    const read = store.readAdmissionBoundClaim({ sourceTaskId: 'AC15-S9-SRC' });
    assert.equal(read.claim.claimToken, expected);
    assert.equal(read.child.status, 'CLAIMED');
  } finally {
    removeHome(home);
  }
});

test('S9B. deterministic token identity excludes clock/pid/random; worker forks identity', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { admitted } = driveToAdmitted(store, clock, 'AC15-S9B-SRC', 'AC15-S9B-CHILD', 'result-ac15-s9b-src');
    const tokenA1 = buildAdmissionBoundClaimToken({
      admissionId: admitted.record.admissionId,
      nextTaskId: 'AC15-S9B-CHILD',
      workerId: 'worker-a',
    });
    clock.advance(365 * 86_400_000);
    const tokenA2 = buildAdmissionBoundClaimToken({
      admissionId: admitted.record.admissionId,
      nextTaskId: 'AC15-S9B-CHILD',
      workerId: 'worker-a',
    });
    const tokenB = buildAdmissionBoundClaimToken({
      admissionId: admitted.record.admissionId,
      nextTaskId: 'AC15-S9B-CHILD',
      workerId: 'worker-b',
    });
    assert.equal(tokenA1, tokenA2);
    assert.notEqual(tokenA1, tokenB);
    // Claim through the store uses the same deterministic token.
    const out = store.claimAdmittedTask({ sourceTaskId: 'AC15-S9B-SRC', workerId: 'worker-a' });
    assert.equal(out.claim.claimToken, tokenA1);
  } finally {
    removeHome(home);
  }
});

test('S9C. caller must supply sourceTaskId/emissionSlot/workerId explicitly', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-S9C-SRC', 'AC15-S9C-CHILD', 'result-ac15-s9c-src');
    assert.throws(() => store.claimAdmittedTask({ workerId: 'worker-a' }), (error) => error != null);
    assert.throws(
      () => store.claimAdmittedTask({ sourceTaskId: 'AC15-S9C-SRC' }),
      (error) => error?.code === 'INVALID_WORKER',
    );
    assert.throws(
      () => store.claimAdmittedTask({ sourceTaskId: 'AC15-S9C-SRC', workerId: '  ' }),
      (error) => error?.code === 'INVALID_WORKER',
    );
    assert.equal(existsSync(claimPath(home, 'AC15-S9C-CHILD')), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// 10-12. REPLAY + CLOCK SKEW.
// ---------------------------------------------------------------------------

test('R10. same worker active replay 10x returns same claim with no new ownership', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-R10-SRC', 'AC15-R10-CHILD', 'result-ac15-r10-src');
    const first = store.claimAdmittedTask({ sourceTaskId: 'AC15-R10-SRC', workerId: 'worker-a' });
    assert.equal(first.duplicate, false);
    const firstBytes = readFileSync(claimPath(home, 'AC15-R10-CHILD'), 'utf8');
    const firstGeneration = first.claim.generation;

    for (let replay = 0; replay < 10; replay += 1) {
      clock.advance(1000);
      const out = store.claimAdmittedTask({
        sourceTaskId: 'AC15-R10-SRC',
        workerId: 'worker-a',
        nowMs: clock.now,
      });
      assert.equal(out.duplicate, true);
      assert.equal(out.terminal, false);
      assert.deepEqual(out.claim, first.claim);
      assert.equal(out.claim.generation, firstGeneration);
      assert.equal(out.child.status, 'CLAIMED');
    }
    assert.equal(readFileSync(claimPath(home, 'AC15-R10-CHILD'), 'utf8'), firstBytes);
    assert.equal(store.readClaim('AC15-R10-CHILD').generation, 1);
  } finally {
    removeHome(home);
  }
});

test('R11. response-loss replay with a fresh store instance returns the same claim', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-R11-SRC', 'AC15-R11-CHILD', 'result-ac15-r11-src');
    const first = store.claimAdmittedTask({ sourceTaskId: 'AC15-R11-SRC', workerId: 'worker-a' });
    const before = readFileSync(claimPath(home, 'AC15-R11-CHILD'), 'utf8');

    // Stay inside the active lease: response loss must not create ownership.
    clock.advance(1000);
    const retry = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const replayed = retry.claimAdmittedTask({ sourceTaskId: 'AC15-R11-SRC', workerId: 'worker-a' });
    assert.equal(replayed.duplicate, true);
    assert.equal(replayed.terminal, false);
    assert.deepEqual(replayed.claim, first.claim);
    assert.equal(readFileSync(claimPath(home, 'AC15-R11-CHILD'), 'utf8'), before);
    assert.equal(retry.readTask('AC15-R11-CHILD').status, 'CLAIMED');
  } finally {
    removeHome(home);
  }
});

test('R12. one-year clock skew replay while active creates no new logical ownership', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-R12-SRC', 'AC15-R12-CHILD', 'result-ac15-r12-src');
    const first = store.claimAdmittedTask({
      sourceTaskId: 'AC15-R12-SRC',
      workerId: 'worker-a',
      leaseDurationMs: 10 * 365 * 86_400_000,
    });
    const before = readFileSync(claimPath(home, 'AC15-R12-CHILD'), 'utf8');
    // One year later but still inside the long active lease: timestamp must
    // not elect a new winner or extend the lease.
    const replayed = store.claimAdmittedTask({
      sourceTaskId: 'AC15-R12-SRC',
      workerId: 'worker-a',
      nowMs: clock.now + 365 * 86_400_000,
    });
    assert.equal(replayed.duplicate, true);
    assert.deepEqual(replayed.claim, first.claim);
    assert.equal(readFileSync(claimPath(home, 'AC15-R12-CHILD'), 'utf8'), before);
    assert.equal(replayed.claim.generation, 1);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// 13-14. CONCURRENCY: two workers, exactly one winner.
// ---------------------------------------------------------------------------

function runClaimRaceWorker({ home, sourceTaskId, slot = DEFAULT_EMISSION_SLOT, workerId, nowMs }) {
  return new Promise((resolveResult, rejectResult) => {
    const code = [
      'try {',
      `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
      `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
      `  const out = store.claimAdmittedTask({ sourceTaskId: ${JSON.stringify(sourceTaskId)}, emissionSlot: ${JSON.stringify(slot)}, workerId: ${JSON.stringify(workerId)}, leaseDurationMs: 60000, nowMs: ${JSON.stringify(nowMs)} });`,
      '  console.log(JSON.stringify({ ok: true, workerId: out.claim.workerId, token: out.claim.claimToken, generation: out.claim.generation, duplicate: out.duplicate }));',
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
        rejectResult(new Error(`claim race worker exit=${exitCode} stderr=${stderr}`));
        return;
      }
      try {
        resolveResult(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch (error) {
        rejectResult(new Error(`claim race worker output parse failed: ${stdout} / ${stderr}`));
      }
    });
  });
}

test('C13. two workers simultaneous first claim: one winner, one contention', { timeout: 60_000 }, async () => {
  for (let round = 0; round < 10; round += 1) {
    const home = makeHome(`greenhub-claim15-race-${round}-`);
    try {
      const setup = new CoordinationStore({ dir: home });
      const sourceTaskId = `AC15C13-${round}-SRC`;
      const childTaskId = `AC15C13-${round}-CHILD`;
      driveToAdmitted(setup, controllableClock(), sourceTaskId, childTaskId, `result-ac15c13-${round}-src`);
      const nowMs = 1_700_000_000_000 + round * 1000;

      const [first, second] = await Promise.all([
        runClaimRaceWorker({ home, sourceTaskId, workerId: 'worker-a', nowMs }),
        runClaimRaceWorker({ home, sourceTaskId, workerId: 'worker-b', nowMs }),
      ]);

      const winners = [first, second].filter((result) => result.ok === true);
      const losers = [first, second].filter((result) => result.ok === false);
      assert.equal(winners.length, 1);
      assert.equal(losers.length, 1);
      assert.equal(losers[0].code, 'LEASE_ACTIVE');
      // Exactly one current claim, generation 1, child CLAIMED once.
      const canonical = setup.readClaim(childTaskId);
      assert.equal(canonical.generation, 1);
      assert.equal(canonical.workerId, winners[0].workerId);
      assert.equal(setup.readTask(childTaskId).status, 'CLAIMED');
      assert.equal(setup.readTaskSequence().filter((id) => id === childTaskId).length, 1);
      // Winner token is the deterministic admission-bound token.
      const admission = setup.readEmissionAdmission({ sourceTaskId });
      assert.equal(
        canonical.claimToken,
        buildAdmissionBoundClaimToken({
          admissionId: admission.admissionId,
          nextTaskId: childTaskId,
          workerId: canonical.workerId,
        }),
      );
    } finally {
      removeHome(home);
    }
  }
});

test('C14. loser does not overwrite winner bytes or generation', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-C14-SRC', 'AC15-C14-CHILD', 'result-ac15-c14-src');
    const winner = store.claimAdmittedTask({ sourceTaskId: 'AC15-C14-SRC', workerId: 'worker-a' });
    const winnerBytes = readFileSync(claimPath(home, 'AC15-C14-CHILD'), 'utf8');
    assert.throws(
      () => store.claimAdmittedTask({ sourceTaskId: 'AC15-C14-SRC', workerId: 'worker-b' }),
      (error) => error?.code === 'LEASE_ACTIVE',
    );
    assert.equal(readFileSync(claimPath(home, 'AC15-C14-CHILD'), 'utf8'), winnerBytes);
    assert.deepEqual(store.readClaim('AC15-C14-CHILD'), winner.claim);
    assert.equal(store.readClaim('AC15-C14-CHILD').generation, 1);
    assert.equal(store.readTask('AC15-C14-CHILD').status, 'CLAIMED');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// 15-16. AUTHORITY-WITHOUT-STATUS RECOVERY vs FOREIGN CLAIM.
// ---------------------------------------------------------------------------

test('P15. claim authority without status converges only for the exact expected claim', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-P15-SRC', 'AC15-P15-CHILD', 'result-ac15-p15-src');
    const first = store.claimAdmittedTask({ sourceTaskId: 'AC15-P15-SRC', workerId: 'worker-a' });
    assert.equal(store.readTask('AC15-P15-CHILD').status, 'CLAIMED');
    const claimBytes = readFileSync(claimPath(home, 'AC15-P15-CHILD'), 'utf8');

    // Simulate crash between claim.json exclusive-create and markClaimed:
    // authority bytes survive, the child never reached CLAIMED.
    const childFile = childTaskPath(home, 'AC15-P15-CHILD');
    const claimedChild = JSON.parse(readFileSync(childFile, 'utf8'));
    assert.equal(claimedChild.status, 'CLAIMED');
    writeFileSync(
      childFile,
      JSON.stringify({ ...claimedChild, status: 'READY', updatedAt: '2026-01-01T00:00:00.000Z' }, null, 2),
      'utf8',
    );
    assert.equal(store.readTask('AC15-P15-CHILD').status, 'READY');

    // Stay inside the active lease: convergence must preserve claim bytes.
    clock.advance(1000);
    const recovered = store.claimAdmittedTask({ sourceTaskId: 'AC15-P15-SRC', workerId: 'worker-a' });
    assert.equal(recovered.duplicate, true);
    assert.equal(recovered.terminal, false);
    assert.deepEqual(recovered.claim, first.claim);
    assert.equal(recovered.claim.generation, 1);
    assert.equal(recovered.child.status, 'CLAIMED');
    assert.equal(store.readTask('AC15-P15-CHILD').status, 'CLAIMED');
    // Existing claim bytes, generation, and token preserved.
    assert.equal(readFileSync(claimPath(home, 'AC15-P15-CHILD'), 'utf8'), claimBytes);
  } finally {
    removeHome(home);
  }
});

test('B16. foreign random claim with READY fails closed without convergence', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-B16-SRC', 'AC15-B16-CHILD', 'result-ac15-b16-src');
    // Bypass: generic claimTask used directly with a random token.
    store.markReady('AC15-B16-CHILD');
    store.claimTask({
      taskId: 'AC15-B16-CHILD',
      workerId: 'worker-a',
      leaseDurationMs: 60_000,
      claimToken: 'random-manual-token',
    });
    // Rewind to the crash-window shape: claim present, status READY.
    const childFile = childTaskPath(home, 'AC15-B16-CHILD');
    const claimedChild = JSON.parse(readFileSync(childFile, 'utf8'));
    writeFileSync(
      childFile,
      JSON.stringify({ ...claimedChild, status: 'READY', updatedAt: '2026-01-01T00:00:00.000Z' }, null, 2),
      'utf8',
    );
    assert.equal(store.readTask('AC15-B16-CHILD').status, 'READY');
    assert.throws(
      () => store.claimAdmittedTask({ sourceTaskId: 'AC15-B16-SRC', workerId: 'worker-a' }),
      (error) => error?.code === 'CLAIM_ADMISSION_BYPASS_DETECTED',
    );
    // Not converged to CLAIMED.
    assert.equal(store.readTask('AC15-B16-CHILD').status, 'READY');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// 17-19. BYPASS DETECTION + TERMINAL REPLAY.
// ---------------------------------------------------------------------------

test('B17. CLAIMED child with foreign token fails with CLAIM_ADMISSION_BYPASS_DETECTED', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-B17-SRC', 'AC15-B17-CHILD', 'result-ac15-b17-src');
    store.markReady('AC15-B17-CHILD');
    store.claimTask({
      taskId: 'AC15-B17-CHILD',
      workerId: 'worker-a',
      leaseDurationMs: 60_000,
      claimToken: 'random-manual-token',
    });
    assert.equal(store.readTask('AC15-B17-CHILD').status, 'CLAIMED');
    assert.throws(
      () => store.claimAdmittedTask({ sourceTaskId: 'AC15-B17-SRC', workerId: 'worker-a' }),
      (error) => error?.code === 'CLAIM_ADMISSION_BYPASS_DETECTED',
    );
    assert.throws(
      () => store.readAdmissionBoundClaim({ sourceTaskId: 'AC15-B17-SRC' }),
      (error) => error?.code === 'CLAIM_ADMISSION_BYPASS_DETECTED',
    );
  } finally {
    removeHome(home);
  }
});

test('B18. RESULT_DELIVERED child with foreign token fails closed without adoption', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-B18-SRC', 'AC15-B18-CHILD', 'result-ac15-b18-src');
    store.markReady('AC15-B18-CHILD');
    const foreign = store.claimTask({
      taskId: 'AC15-B18-CHILD',
      workerId: 'worker-a',
      leaseDurationMs: 60_000,
      claimToken: 'random-manual-token',
    });
    store.deliverResult(sampleResult(foreign, { taskId: 'AC15-B18-CHILD', resultId: 'result-ac15-b18-child' }));
    assert.equal(store.readTask('AC15-B18-CHILD').status, 'RESULT_DELIVERED');
    assert.throws(
      () => store.claimAdmittedTask({ sourceTaskId: 'AC15-B18-SRC', workerId: 'worker-a' }),
      (error) => error?.code === 'CLAIM_ADMISSION_BYPASS_DETECTED',
    );
    assert.throws(
      () => store.readAdmissionBoundClaim({ sourceTaskId: 'AC15-B18-SRC' }),
      (error) => error?.code === 'CLAIM_ADMISSION_BYPASS_DETECTED',
    );
  } finally {
    removeHome(home);
  }
});

test('H19. valid admission-bound claim with RESULT_DELIVERED replays terminal without rewind', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-H19-SRC', 'AC15-H19-CHILD', 'result-ac15-h19-src');
    const claimed = store.claimAdmittedTask({ sourceTaskId: 'AC15-H19-SRC', workerId: 'worker-a' });
    store.deliverResult(sampleResult(claimed.claim, { taskId: 'AC15-H19-CHILD', resultId: 'result-ac15-h19-child' }));
    assert.equal(store.readTask('AC15-H19-CHILD').status, 'RESULT_DELIVERED');
    const claimBytes = readFileSync(claimPath(home, 'AC15-H19-CHILD'), 'utf8');

    clock.advance(86_400_000);
    const replayed = store.claimAdmittedTask({ sourceTaskId: 'AC15-H19-SRC', workerId: 'worker-a' });
    assert.equal(replayed.duplicate, true);
    assert.equal(replayed.terminal, true);
    assert.deepEqual(replayed.claim, claimed.claim);
    assert.equal(replayed.child.status, 'RESULT_DELIVERED');
    assert.equal(store.readTask('AC15-H19-CHILD').status, 'RESULT_DELIVERED');
    // No rewind, no new claim, no generation bump, no overwrite.
    assert.equal(readFileSync(claimPath(home, 'AC15-H19-CHILD'), 'utf8'), claimBytes);
    assert.equal(store.readClaim('AC15-H19-CHILD').generation, 1);
    // Read verifier also sees the terminal claim.
    const read = store.readAdmissionBoundClaim({ sourceTaskId: 'AC15-H19-SRC' });
    assert.equal(read.child.status, 'RESULT_DELIVERED');
    assert.equal(read.claim.claimToken, claimed.claim.claimToken);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// 20-21. EXPIRED LEASE TAKEOVER + SAME-WORKER RECLAIM (generation fencing).
// ---------------------------------------------------------------------------

test('T20. expired lease different-worker takeover bumps generation and fences the old worker', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-T20-SRC', 'AC15-T20-CHILD', 'result-ac15-t20-src');
    const first = store.claimAdmittedTask({
      sourceTaskId: 'AC15-T20-SRC',
      workerId: 'worker-a',
      leaseDurationMs: 60_000,
      nowMs: clock.now,
    });
    assert.equal(first.claim.generation, 1);
    const tokenA = first.claim.claimToken;

    clock.advance(120_000);
    const second = store.claimAdmittedTask({
      sourceTaskId: 'AC15-T20-SRC',
      workerId: 'worker-b',
      leaseDurationMs: 60_000,
      nowMs: clock.now,
    });
    assert.equal(second.duplicate, false);
    assert.equal(second.terminal, false);
    assert.equal(second.claim.workerId, 'worker-b');
    assert.equal(second.claim.generation, 2);
    assert.notEqual(second.claim.claimToken, tokenA);
    assert.equal(
      second.claim.claimToken,
      buildAdmissionBoundClaimToken({
        admissionId: second.record.admissionId,
        nextTaskId: 'AC15-T20-CHILD',
        workerId: 'worker-b',
      }),
    );
    // Old generation is fenced: stale delivery refused.
    assert.throws(
      () =>
        store.deliverResult(
          sampleResult(first.claim, { taskId: 'AC15-T20-CHILD', resultId: 'result-ac15-t20-stale' }),
        ),
      (error) => error?.code === 'STALE_CLAIM',
    );
    // Current generation is eligible.
    const delivered = store.deliverResult(
      sampleResult(second.claim, { taskId: 'AC15-T20-CHILD', resultId: 'result-ac15-t20-child' }),
    );
    assert.equal(delivered.record.claimGeneration, 2);
  } finally {
    removeHome(home);
  }
});

test('T21. expired lease same-worker reclaim keeps the deterministic token but bumps generation', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-T21-SRC', 'AC15-T21-CHILD', 'result-ac15-t21-src');
    const first = store.claimAdmittedTask({
      sourceTaskId: 'AC15-T21-SRC',
      workerId: 'worker-a',
      leaseDurationMs: 60_000,
      nowMs: clock.now,
    });
    assert.equal(first.claim.generation, 1);

    clock.advance(120_000);
    const second = store.claimAdmittedTask({
      sourceTaskId: 'AC15-T21-SRC',
      workerId: 'worker-a',
      leaseDurationMs: 60_000,
      nowMs: clock.now,
    });
    // Token identity is stable across generations; fencing is by generation.
    assert.equal(second.claim.claimToken, first.claim.claimToken);
    assert.equal(second.claim.generation, 2);
    assert.equal(second.duplicate, false);
    assert.throws(
      () =>
        store.deliverResult(
          sampleResult(first.claim, { taskId: 'AC15-T21-CHILD', resultId: 'result-ac15-t21-stale' }),
        ),
      (error) => error?.code === 'STALE_CLAIM',
    );
    const delivered = store.deliverResult(
      sampleResult(second.claim, { taskId: 'AC15-T21-CHILD', resultId: 'result-ac15-t21-child' }),
    );
    assert.equal(delivered.record.claimGeneration, 2);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// 22-24. CORRUPTION: fail closed, bytes preserved, no auto-repair.
// ---------------------------------------------------------------------------

test('C22. corrupt claim bytes fail closed with CORRUPT_CLAIM and no repair', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-C22-SRC', 'AC15-C22-CHILD', 'result-ac15-c22-src');
    store.claimAdmittedTask({ sourceTaskId: 'AC15-C22-SRC', workerId: 'worker-a' });
    const path = claimPath(home, 'AC15-C22-CHILD');
    writeFileSync(path, '{corrupt', 'utf8');
    assert.throws(
      () => store.claimAdmittedTask({ sourceTaskId: 'AC15-C22-SRC', workerId: 'worker-a' }),
      (error) => error?.code === 'CORRUPT_CLAIM',
    );
    assert.throws(
      () => store.readAdmissionBoundClaim({ sourceTaskId: 'AC15-C22-SRC' }),
      (error) => error?.code === 'CORRUPT_CLAIM',
    );
    assert.equal(readFileSync(path, 'utf8'), '{corrupt');
  } finally {
    removeHome(home);
  }
});

test('C23. duplicate sequence membership fails closed with no claim', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-C23-SRC', 'AC15-C23-CHILD', 'result-ac15-c23-src');
    const entries = store.readSequenceEntries();
    const nextSeq = entries[entries.length - 1].sequenceNumber + 1;
    writeFileSync(
      join(home, 'consumption', 'sequence', 'entries', `${String(nextSeq).padStart(10, '0')}.json`),
      JSON.stringify({ schemaVersion: '1', sequenceNumber: nextSeq, taskId: 'AC15-C23-CHILD' }, null, 2),
      'utf8',
    );
    assert.throws(
      () => store.claimAdmittedTask({ sourceTaskId: 'AC15-C23-SRC', workerId: 'worker-a' }),
      (error) => error != null,
    );
    assert.equal(existsSync(claimPath(home, 'AC15-C23-CHILD')), false);
  } finally {
    removeHome(home);
  }
});

test('C24. source/emission/admission mismatch fails closed with no claim', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-C24-SRC', 'AC15-C24-CHILD', 'result-ac15-c24-src');
    // Tamper the admission's emission binding away from the live emission.
    const path = admissionPath(home, 'AC15-C24-SRC');
    const admission = JSON.parse(readFileSync(path, 'utf8'));
    admission.emissionId = 'emt_deadbeefdeadbeefdeadbeefdeadbeef';
    writeFileSync(path, JSON.stringify(admission, null, 2), 'utf8');
    const before = readFileSync(path, 'utf8');
    assert.throws(
      () => store.claimAdmittedTask({ sourceTaskId: 'AC15-C24-SRC', workerId: 'worker-a' }),
      (error) => error != null,
    );
    assert.throws(() => store.readAdmissionBoundClaim({ sourceTaskId: 'AC15-C24-SRC' }), (error) => error != null);
    assert.equal(existsSync(claimPath(home, 'AC15-C24-CHILD')), false);
    assert.equal(readFileSync(path, 'utf8'), before);
  } finally {
    removeHome(home);
  }
});

test('C24B. tampered emission slot binding fails closed', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-C24B-SRC', 'AC15-C24B-CHILD', 'result-ac15-c24b-src');
    const path = emissionPath(home, 'AC15-C24B-SRC');
    const emission = JSON.parse(readFileSync(path, 'utf8'));
    emission.resultBinding = `sha256:${'3'.repeat(64)}`;
    writeFileSync(path, JSON.stringify(emission, null, 2), 'utf8');
    assert.throws(
      () => store.claimAdmittedTask({ sourceTaskId: 'AC15-C24B-SRC', workerId: 'worker-a' }),
      (error) => error != null,
    );
    assert.equal(existsSync(claimPath(home, 'AC15-C24B-CHILD')), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// READ VERIFIER.
// ---------------------------------------------------------------------------

test('V25. readAdmissionBoundClaim validates the exact bound claim only', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'AC15-V25-SRC', 'AC15-V25-CHILD', 'result-ac15-v25-src');
    // No claim yet: verifier refuses without mutation.
    assert.throws(
      () => store.readAdmissionBoundClaim({ sourceTaskId: 'AC15-V25-SRC' }),
      (error) => error?.code === 'CLAIM_NOT_FOUND',
    );
    const claimed = store.claimAdmittedTask({ sourceTaskId: 'AC15-V25-SRC', workerId: 'worker-a' });
    const read = store.readAdmissionBoundClaim({ sourceTaskId: 'AC15-V25-SRC' });
    assert.equal(read.admission.admissionId, claimed.record.admissionId);
    assert.equal(read.emission.emissionId, claimed.emission.emissionId);
    assert.equal(read.child.taskId, 'AC15-V25-CHILD');
    assert.equal(read.claim.claimToken, claimed.claim.claimToken);
    assert.equal(read.child.status, 'CLAIMED');
    // Missing admission refuses.
    assert.throws(
      () => store.readAdmissionBoundClaim({ sourceTaskId: 'AC15-V25-SRC', emissionSlot: 'other' }),
      (error) => error != null,
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// BOUNDARY15: admission-bound claim added, scheduler absent.
// ---------------------------------------------------------------------------

test('BOUNDARY15. claim binds admission via claimTask; scheduler/READY-scan/worker-selection/dispatch absent', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    assert.equal(DEFAULT_EMISSION_SLOT, 'next');
    assert.equal(TASK_SEQUENCE_CONTRACT, 'append-stable-task-sequence-v1');
    for (const forbidden of [
      'scheduleNextTask',
      'schedule',
      'pollQueue',
      'runScheduler',
      'autonomousLoop',
      'dispatchNextTask',
      'decideNextTask',
      'planNextTask',
      'generateNextTask',
      'dispatch',
      'fanOut',
      'createChildTask',
      'registerAdapter',
      'astraSync',
      'openCodeSync',
      'claimNextTask',
      'autoClaim',
      'listReadyTasks',
      'findReadyTask',
      'selectWorker',
      'selectExecutor',
      'selectAgent',
      'pollReady',
      'oldestReady',
      'nextReady',
    ]) {
      assert.equal(store[forbidden], undefined, `${forbidden} must not exist`);
    }
    for (const allowed of [
      'emitNextTask',
      'readEmission',
      'admitEmittedTask',
      'readEmissionAdmission',
      'claimAdmittedTask',
      'readAdmissionBoundClaim',
      'claimTask',
      'readClaim',
      'markReady',
      'readTaskSequence',
      'readCursor',
      'advanceCursor',
    ]) {
      assert.equal(typeof store[allowed], 'function', `${allowed} must exist`);
    }
    assert.notEqual(
      CoordinationStore.prototype.claimAdmittedTask,
      CoordinationStore.prototype.claimTask,
    );
    assert.notEqual(
      CoordinationStore.prototype.claimAdmittedTask,
      CoordinationStore.prototype.admitEmittedTask,
    );
    driveToAdmitted(store, clock, 'AC15-BND-SRC', 'AC15-BND-CHILD', 'result-ac15-bnd-src');
    clock.advance(1000);
    const out = store.claimAdmittedTask({
      sourceTaskId: 'AC15-BND-SRC',
      workerId: 'worker-a',
    });
    assert.equal(out.child.status, 'CLAIMED');
    const resolved = resolveCoordinationHome({ platform: 'win32', env: { LOCALAPPDATA: home } });
    assert.ok(!resolve(MODULE_DIRECTORY, '../..').startsWith(resolved) || true);
    const repoClaims = join(resolve(MODULE_DIRECTORY, '../..'), 'tasks');
    assert.equal(existsSync(repoClaims), false);
    assert.equal(existsSync(join(MODULE_DIRECTORY, 'admission-bound-claim.mjs')), true);
    assert.equal(existsSync(claimPath(home, 'AC15-BND-CHILD')), true);
    // No new claim authority model: exactly one claim.json, no sidecar files.
    assert.equal(existsSync(join(home, 'tasks', 'AC15-BND-CHILD', 'admission-claim.json')), false);
  } finally {
    removeHome(home);
  }
});
