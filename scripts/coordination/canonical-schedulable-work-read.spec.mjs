// Proof for GREENHUB-COORDINATION-CANONICAL-SCHEDULABLE-WORK-READ-17A.
// Canonical schedulable-work read primitive ONLY:
// the exact canonical admission's projection for a caller-supplied
// (sourceTaskId, emissionSlot), re-verified live against the durable
// authority, returned as a frozen pure-read projection.
//
// Explicitly NOT implemented here (and asserted absent):
//   listReadyTasks, findReadyTask, nextReady, oldestReady, newestReady,
//   priority scheduling, queue polling, scheduler loop, daemon, cron, fan-out,
//   automatic claim, worker selection, worker inference, worker registry,
//   assignment record, dispatch, dispatch attempt, executor adapter,
//   executor invocation, process spawn, result watcher.
// readCanonicalSchedulableWork() != scheduleNextTask() != dispatchNextTask()
//   != decideNextTask() != emitNextTask() != admitEmittedTask()
//   != claimAdmittedTask().
// All runtime state lives in isolated temp directories. No network required.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveCoordinationHome } from './coordination-home.mjs';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import { DEFAULT_EMISSION_SLOT, computeNextTaskSpecBinding } from './next-task-emission.mjs';
import { TASK_SEQUENCE_CONTRACT } from './task-sequence.mjs';
import * as schedulableWorkRead from './canonical-schedulable-work-read.mjs';
import { validateSchedulableWorkProjection } from './canonical-schedulable-work-read.mjs';
import { CoordinationStore } from './store.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const STORE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'store.mjs')).href;

function makeHome(prefix = 'greenhub-schedread17-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'CANONICAL_SCHEDULABLE_WORK_READ_PROVED',
    policyRefs: ['docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md'],
    evidenceRefs: ['git:live-main-read'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: {
      liveMainHint: null,
      requiredPolicies: ['AGENTS.md'],
    },
    ownedSurface: ['scripts/coordination/'],
    mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['canonical-schedulable-work-read-proof'],
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

function driveToClaimed(store, clock, sourceTaskId, childTaskId, sourceResultId = 'result-0001') {
  const setup = driveToAdmitted(store, clock, sourceTaskId, childTaskId, sourceResultId);
  const claimed = store.claimAdmittedTask({ sourceTaskId, workerId: 'worker-a' });
  clock.advance(1000);
  return { ...setup, claimed };
}

function driveToTerminal(store, clock, sourceTaskId, childTaskId, sourceResultId = 'result-0001') {
  const setup = driveToClaimed(store, clock, sourceTaskId, childTaskId, sourceResultId);
  store.deliverResult(sampleResult(setup.claimed.claim, { taskId: childTaskId, resultId: 'result-child-0001' }));
  clock.advance(1000);
  return setup;
}

function admissionPath(home, sourceTaskId, slot = DEFAULT_EMISSION_SLOT) {
  return join(home, 'tasks', sourceTaskId, 'emission-admissions', `${slot}.json`);
}

function emissionPath(home, sourceTaskId, slot = DEFAULT_EMISSION_SLOT) {
  return join(home, 'tasks', sourceTaskId, 'emissions', `${slot}.json`);
}

function childTaskPath(home, taskId) {
  return join(home, 'tasks', taskId, 'task.json');
}

function claimPath(home, taskId) {
  return join(home, 'tasks', taskId, 'claim.json');
}

function sequenceEntriesDirectory(home) {
  return join(home, 'consumption', 'sequence', 'entries');
}

function snapshotHomeBytes(home) {
  const out = {};
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of sorted) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        out[full.slice(home.length + 1)] = readFileSync(full, 'utf8');
      }
    }
  };
  walk(home);
  return out;
}

function runReadWorker({ home, sourceTaskId, slot = DEFAULT_EMISSION_SLOT }) {
  return new Promise((resolveResult, rejectResult) => {
    const code = [
      'try {',
      `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
      `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
      `  const out = store.readCanonicalSchedulableWork({ sourceTaskId: ${JSON.stringify(sourceTaskId)}, emissionSlot: ${JSON.stringify(slot)} });`,
      '  console.log(JSON.stringify({ ok: true, projection: out }));',
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
        rejectResult(new Error(`schedulable-work read worker exit=${exitCode} stderr=${stderr}`));
        return;
      }
      try {
        resolveResult(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch (error) {
        rejectResult(new Error(`schedulable-work read worker output parse failed: ${stdout} / ${stderr}`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// D. ADMITTED + READY: exact projection.
// ---------------------------------------------------------------------------

test('D. admitted + READY returns the exact canonical projection', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { emitted, admitted } = driveToAdmitted(store, clock, 'SW17-D-SRC', 'SW17-D-CHILD', 'result-sw17-d-src');
    assert.equal(DEFAULT_EMISSION_SLOT, 'next');
    assert.equal(store.readTask('SW17-D-CHILD').status, 'READY');

    const projection = store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-D-SRC' });
    assert.equal(projection.sourceTaskId, 'SW17-D-SRC');
    assert.equal(projection.emissionSlot, 'next');
    assert.equal(projection.emissionId, emitted.record.emissionId);
    assert.equal(projection.admissionId, admitted.record.admissionId);
    assert.equal(projection.nextTaskId, 'SW17-D-CHILD');
    assert.equal(projection.nextTaskSpecBinding, emitted.record.nextTaskSpecBinding);
    assert.equal(projection.nextTaskSpecBinding, admitted.record.nextTaskSpecBinding);
    assert.equal(projection.childStatus, 'READY');
    // Sequence position is the live canonical membership, exactly one.
    const entries = store.readSequenceEntries();
    const matches = entries.filter((entry) => entry.taskId === 'SW17-D-CHILD');
    assert.equal(matches.length, 1);
    assert.equal(projection.sequencePosition, matches[0].sequenceNumber);
    // Projection is validated and frozen.
    assert.ok(Object.isFrozen(projection));
    assert.deepEqual(validateSchedulableWorkProjection(projection), projection);
    // Default slot reuses the canonical default meaning.
    assert.deepEqual(
      store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-D-SRC', emissionSlot: 'next' }),
      projection,
    );
    // Child binding independently recomputed matches the projection.
    assert.equal(computeNextTaskSpecBinding(store.readTask('SW17-D-CHILD')), projection.nextTaskSpecBinding);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// A. DETERMINISTIC REPLAY: 10x byte/logical-equivalent, zero byte mutation.
// ---------------------------------------------------------------------------

test('A. deterministic replay 10x returns byte-equivalent projection with zero byte mutation', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'SW17-A-SRC', 'SW17-A-CHILD', 'result-sw17-a-src');
    const baseline = JSON.stringify(store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-A-SRC' }));
    const beforeBytes = snapshotHomeBytes(home);
    for (let replay = 0; replay < 10; replay += 1) {
      clock.advance(1000);
      const out = store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-A-SRC' });
      assert.equal(JSON.stringify(out), baseline);
      assert.deepEqual(out, JSON.parse(baseline));
    }
    assert.deepEqual(snapshotHomeBytes(home), beforeBytes);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// B. FRESH PROCESS / MODULE REPLAY.
// ---------------------------------------------------------------------------

test('B. fresh store instance and fresh process replay return the same projection', { timeout: 60_000 }, async () => {
  const home = makeHome('greenhub-schedread17-fresh-');
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'SW17-B-SRC', 'SW17-B-CHILD', 'result-sw17-b-src');
    const baseline = store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-B-SRC' });

    const fresh = new CoordinationStore({ dir: home });
    assert.deepEqual(
      fresh.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-B-SRC' }),
      baseline,
    );

    const worker = await runReadWorker({ home, sourceTaskId: 'SW17-B-SRC' });
    assert.equal(worker.ok, true);
    assert.deepEqual(worker.projection, baseline);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// C. CLOCK SKEW: +/-1 year readers observe identical identity/order.
// ---------------------------------------------------------------------------

test('C. clock skew +/-1 year leaves identity and order identical', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'SW17-C-SRC', 'SW17-C-CHILD', 'result-sw17-c-src');
    const baseline = store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-C-SRC' });

    const yearMs = 365 * 86_400_000;
    const past = new CoordinationStore({ dir: home, nowProvider: () => clock.now - yearMs });
    const future = new CoordinationStore({ dir: home, nowProvider: () => clock.now + yearMs });
    assert.deepEqual(past.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-C-SRC' }), baseline);
    assert.deepEqual(future.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-C-SRC' }), baseline);
    assert.equal(baseline.sequencePosition, store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-C-SRC' }).sequencePosition);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. ADMITTED + CLAIMED: same identity + CLAIMED, no rewind.
// ---------------------------------------------------------------------------

test('E. admitted + CLAIMED returns the same identity with CLAIMED and no rewind', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { emitted, admitted } = driveToAdmitted(store, clock, 'SW17-E-SRC', 'SW17-E-CHILD', 'result-sw17-e-src');
    const beforeReady = store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-E-SRC' });
    assert.equal(beforeReady.childStatus, 'READY');

    const claimed = store.claimAdmittedTask({ sourceTaskId: 'SW17-E-SRC', workerId: 'worker-a' });
    assert.equal(claimed.child.status, 'CLAIMED');
    const claimBytesBefore = readFileSync(claimPath(home, 'SW17-E-CHILD'), 'utf8');

    const projection = store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-E-SRC' });
    assert.equal(projection.sourceTaskId, 'SW17-E-SRC');
    assert.equal(projection.emissionId, emitted.record.emissionId);
    assert.equal(projection.admissionId, admitted.record.admissionId);
    assert.equal(projection.nextTaskId, 'SW17-E-CHILD');
    assert.equal(projection.nextTaskSpecBinding, beforeReady.nextTaskSpecBinding);
    assert.equal(projection.sequencePosition, beforeReady.sequencePosition);
    assert.equal(projection.childStatus, 'CLAIMED');
    // No rewind: child stays CLAIMED, claim bytes untouched by the pure read.
    assert.equal(store.readTask('SW17-E-CHILD').status, 'CLAIMED');
    assert.equal(readFileSync(claimPath(home, 'SW17-E-CHILD'), 'utf8'), claimBytesBefore);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. TERMINAL RESULT_DELIVERED: terminal as-is, no READY recreation.
// ---------------------------------------------------------------------------

test('F. terminal RESULT_DELIVERED reads terminal with no READY recreation', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { emitted, admitted } = driveToAdmitted(store, clock, 'SW17-F-SRC', 'SW17-F-CHILD', 'result-sw17-f-src');
    const claimed = store.claimAdmittedTask({ sourceTaskId: 'SW17-F-SRC', workerId: 'worker-a' });
    store.deliverResult(sampleResult(claimed.claim, { taskId: 'SW17-F-CHILD', resultId: 'result-sw17-f-child' }));
    assert.equal(store.readTask('SW17-F-CHILD').status, 'RESULT_DELIVERED');

    const projection = store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-F-SRC' });
    assert.equal(projection.emissionId, emitted.record.emissionId);
    assert.equal(projection.admissionId, admitted.record.admissionId);
    assert.equal(projection.nextTaskId, 'SW17-F-CHILD');
    assert.equal(projection.childStatus, 'RESULT_DELIVERED');
    // Terminal stays terminal across replays: never rewound, never READY.
    const replayed = store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-F-SRC' });
    assert.deepEqual(replayed, projection);
    assert.equal(store.readTask('SW17-F-CHILD').status, 'RESULT_DELIVERED');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// G. READY WITHOUT ADMISSION: fail-closed (bypass); CREATED is pre-admission.
// ---------------------------------------------------------------------------

test('G. READY without admission fails closed with ADMISSION_BYPASS_DETECTED', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'SW17-G-SRC', 'SW17-G-CHILD', 'result-sw17-g-src');
    // Pre-admission CREATED state is NOT a bypass: admission simply absent.
    assert.equal(store.readTask('SW17-G-CHILD').status, 'CREATED');
    assert.throws(
      () => store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-G-SRC' }),
      (error) => error?.code === 'ADMISSION_NOT_FOUND',
    );
    // Manual READY without canonical admission authority is a bypass.
    store.markReady('SW17-G-CHILD');
    assert.equal(store.readTask('SW17-G-CHILD').status, 'READY');
    assert.throws(
      () => store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-G-SRC' }),
      (error) => error?.code === 'ADMISSION_BYPASS_DETECTED',
    );
    // Fail-closed leaves no authority behind and no child mutation.
    assert.equal(existsSync(admissionPath(home, 'SW17-G-SRC')), false);
    assert.equal(store.readTask('SW17-G-CHILD').status, 'READY');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// H. EMISSION / ADMISSION MISMATCH: fail-closed.
// ---------------------------------------------------------------------------

test('H. emission/admission drift fails closed with no repair', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'SW17-H-SRC', 'SW17-H-CHILD', 'result-sw17-h-src');
    const baseline = store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-H-SRC' });

    // H1: tampered admission emission binding.
    const admissionFile = admissionPath(home, 'SW17-H-SRC');
    const admissionBefore = readFileSync(admissionFile, 'utf8');
    const tamperedAdmission = JSON.parse(admissionBefore);
    tamperedAdmission.emissionId = 'emt_deadbeefdeadbeefdeadbeefdeadbeef';
    writeFileSync(admissionFile, JSON.stringify(tamperedAdmission, null, 2), 'utf8');
    assert.throws(
      () => store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-H-SRC' }),
      (error) => error != null,
    );
    assert.equal(readFileSync(admissionFile, 'utf8'), JSON.stringify(tamperedAdmission, null, 2));
    // Restore and prove the canonical projection is intact again.
    writeFileSync(admissionFile, admissionBefore, 'utf8');
    assert.deepEqual(store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-H-SRC' }), baseline);

    // H2: tampered emission closure binding.
    const emissionFile = emissionPath(home, 'SW17-H-SRC');
    const emissionBefore = readFileSync(emissionFile, 'utf8');
    const tamperedEmission = JSON.parse(emissionBefore);
    tamperedEmission.resultBinding = `sha256:${'3'.repeat(64)}`;
    writeFileSync(emissionFile, JSON.stringify(tamperedEmission, null, 2), 'utf8');
    assert.throws(
      () => store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-H-SRC' }),
      (error) => error != null,
    );
    assert.equal(readFileSync(emissionFile, 'utf8'), JSON.stringify(tamperedEmission, null, 2));
    writeFileSync(emissionFile, emissionBefore, 'utf8');
    assert.deepEqual(store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-H-SRC' }), baseline);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// I. CHILD SPEC TAMPER: fail-closed.
// ---------------------------------------------------------------------------

test('I. child spec tamper fails closed with no repair', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'SW17-I-SRC', 'SW17-I-CHILD', 'result-sw17-i-src');
    const baseline = store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-I-SRC' });

    const taskFile = childTaskPath(home, 'SW17-I-CHILD');
    const taskBefore = readFileSync(taskFile, 'utf8');
    const tampered = { ...JSON.parse(taskBefore), desiredExitState: 'TAMPERED_EXIT_STATE' };
    writeFileSync(taskFile, JSON.stringify(tampered, null, 2), 'utf8');
    assert.notEqual(computeNextTaskSpecBinding(JSON.parse(readFileSync(taskFile, 'utf8'))), baseline.nextTaskSpecBinding);
    assert.throws(
      () => store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-I-SRC' }),
      (error) => error?.code === 'ADMISSION_BINDING_MISMATCH',
    );
    // No repair: tampered bytes preserved, canonical authority untouched.
    assert.equal(readFileSync(taskFile, 'utf8'), JSON.stringify(tampered, null, 2));
    writeFileSync(taskFile, taskBefore, 'utf8');
    assert.deepEqual(store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-I-SRC' }), baseline);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// J. SEQUENCE MEMBERSHIP MISSING: fail-closed, no sync repair.
// ---------------------------------------------------------------------------

test('J. missing sequence membership fails closed with no sync repair', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'SW17-J-SRC', 'SW17-J-CHILD', 'result-sw17-j-src');
    const entries = store.readSequenceEntries();
    const childEntry = entries.find((entry) => entry.taskId === 'SW17-J-CHILD');
    assert.ok(childEntry);
    // The admitted child is the tail entry: removing it leaves a valid prefix
    // with zero membership for the child (no gap, no corruption elsewhere).
    assert.equal(childEntry.sequenceNumber, entries.length);
    const entryFile = join(
      sequenceEntriesDirectory(home),
      `${String(childEntry.sequenceNumber).padStart(10, '0')}.json`,
    );
    assert.equal(existsSync(entryFile), true);
    rmSync(entryFile, { force: true });
    assert.throws(
      () => store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-J-SRC' }),
      (error) => error?.code === 'CORRUPT_SEQUENCE',
    );
    // Pure read performs no sync repair: the entry stays absent.
    assert.equal(existsSync(entryFile), false);
    assert.equal(store.readTask('SW17-J-CHILD').status, 'READY');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// K. DUPLICATE / INVALID SEQUENCE MEMBERSHIP: fail-closed.
// ---------------------------------------------------------------------------

test('K. duplicate sequence membership fails closed', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'SW17-K-SRC', 'SW17-K-CHILD', 'result-sw17-k-src');
    const before = store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-K-SRC' });
    const entries = store.readSequenceEntries();
    const nextSeq = entries[entries.length - 1].sequenceNumber + 1;
    const duplicateFile = join(sequenceEntriesDirectory(home), `${String(nextSeq).padStart(10, '0')}.json`);
    writeFileSync(
      duplicateFile,
      JSON.stringify({ schemaVersion: '1', sequenceNumber: nextSeq, taskId: 'SW17-K-CHILD' }, null, 2),
      'utf8',
    );
    assert.throws(
      () => store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-K-SRC' }),
      (error) => error != null,
    );
    // Duplicate membership never resolves to a projection.
    assert.throws(
      () => store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-K-SRC' }),
      (error) => error?.code === 'CORRUPT_SEQUENCE',
    );
    assert.equal(before.childStatus, 'READY');
    assert.equal(before.nextTaskId, 'SW17-K-CHILD');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// L. UNRELATED READY SIBLING: exact source+slot projection unaffected.
// ---------------------------------------------------------------------------

test('L. unrelated READY sibling leaves the exact projection unaffected', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    // Lexically-earlier manual sibling exists before the canonical chain and
    // is READY: it must never be selected by this exact-slot read.
    store.createTask(sampleTaskInput('SW17-L-SIBLING'));
    store.markReady('SW17-L-SIBLING');
    driveToAdmitted(store, clock, 'SW17-L-SRC', 'SW17-L-CHILD', 'result-sw17-l-src');
    assert.equal(store.readTask('SW17-L-SIBLING').status, 'READY');

    const projection = store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-L-SRC' });
    assert.equal(projection.nextTaskId, 'SW17-L-CHILD');
    assert.equal(projection.childStatus, 'READY');
    const entries = store.readSequenceEntries();
    assert.equal(entries.filter((entry) => entry.taskId === 'SW17-L-CHILD').length, 1);
    assert.equal(
      projection.sequencePosition,
      entries.find((entry) => entry.taskId === 'SW17-L-CHILD').sequenceNumber,
    );
    // The sibling keeps its own position; the projection never points at it.
    assert.notEqual(projection.nextTaskId, 'SW17-L-SIBLING');
    assert.notEqual(
      projection.sequencePosition,
      entries.find((entry) => entry.taskId === 'SW17-L-SIBLING').sequenceNumber,
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// M. TIMESTAMP / DIRECTORY ORDER: identity unaffected.
// ---------------------------------------------------------------------------

test('M. timestamp and directory-order changes leave identity unaffected', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'SW17-M-SRC', 'SW17-M-CHILD', 'result-sw17-m-src');
    const baseline = JSON.stringify(store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-M-SRC' }));

    // Skew every durable file mtime by +/-1 year (provenance only).
    const skewedPast = new Date(clock.now - 365 * 86_400_000);
    const skewedFuture = new Date(clock.now + 365 * 86_400_000);
    const touchAll = (directory, flip) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) {
          touchAll(full, !flip);
        } else if (entry.isFile()) {
          utimesSync(full, flip ? skewedPast : skewedFuture, flip ? skewedFuture : skewedPast);
        }
      }
    };
    touchAll(home, true);
    // Rewrite the child envelope with fresh provenance timestamps only: the
    // canonical spec fields (and therefore the binding) are unchanged.
    const taskFile = childTaskPath(home, 'SW17-M-CHILD');
    const current = JSON.parse(readFileSync(taskFile, 'utf8'));
    writeFileSync(
      taskFile,
      JSON.stringify({ ...current, updatedAt: new Date(clock.now + 2 * 365 * 86_400_000).toISOString() }, null, 2),
      'utf8',
    );
    // Newer manual task directory appears after the canonical chain.
    store.createTask(sampleTaskInput('SW17-M-LATE'));
    touchAll(home, false);

    const reread = store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-M-SRC' });
    assert.equal(JSON.stringify(reread), baseline);
    assert.deepEqual(reread, JSON.parse(baseline));
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// BOUNDARY17: schedulable-work read added, selector/scheduler absent.
// ---------------------------------------------------------------------------

test('BOUNDARY17. exact-slot read only; scan/select/schedule/dispatch/worker-inference/priority absent', () => {
  const home = makeHome();
  try {
    assert.equal(DEFAULT_EMISSION_SLOT, 'next');
    assert.equal(TASK_SEQUENCE_CONTRACT, 'append-stable-task-sequence-v1');
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    for (const forbidden of [
      'listReadyTasks',
      'findReadyTask',
      'nextReady',
      'oldestReady',
      'newestReady',
      'scheduleNextTask',
      'schedule',
      'pollQueue',
      'runScheduler',
      'autonomousLoop',
      'dispatchNextTask',
      'dispatch',
      'decideNextTask',
      'planNextTask',
      'generateNextTask',
      'fanOut',
      'createChildTask',
      'registerAdapter',
      'astraSync',
      'openCodeSync',
      'claimNextTask',
      'autoClaim',
      'selectWorker',
      'selectExecutor',
      'selectAgent',
      'inferWorker',
      'workerRegistry',
      'registerWorker',
      'pollReady',
      'priorityScore',
      'fairnessScore',
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
      'readCanonicalSchedulableWork',
      'claimTask',
      'readClaim',
      'markReady',
      'readTask',
      'readTaskSequence',
      'readSequenceEntries',
      'readCursor',
      'advanceCursor',
    ]) {
      assert.equal(typeof store[allowed], 'function', `${allowed} must exist`);
    }
    assert.notEqual(
      CoordinationStore.prototype.readCanonicalSchedulableWork,
      CoordinationStore.prototype.readEmissionAdmission,
    );
    assert.notEqual(
      CoordinationStore.prototype.readCanonicalSchedulableWork,
      CoordinationStore.prototype.claimAdmittedTask,
    );
    // The read module surface is projection-only: no selector/scheduler/
    // dispatch/worker/priority/fan-out exports, no fs/process imports.
    const exportKeys = Object.keys(schedulableWorkRead).sort();
    assert.deepEqual(exportKeys, [
      'BLOCKED_SCHEDULABLE_WORK_INLINE_FIELDS',
      'MAX_SCHEDULABLE_WORK_ID_FIELD_LENGTH',
      'MAX_SCHEDULABLE_WORK_JSON_BYTES',
      'SCHEDULABLE_WORK_PROJECTION_FIELDS',
      'SCHEDULABLE_WORK_SCHEMA_VERSION',
      'SchedulableWorkValidationError',
      'assertValidSchedulableSlot',
      'buildSchedulableWorkProjection',
      'validateSchedulableWorkProjection',
    ]);
    const moduleSource = readFileSync(join(MODULE_DIRECTORY, 'canonical-schedulable-work-read.mjs'), 'utf8');
    // Functional scan/mutation/dispatch tokens must be absent from the pure
    // read module (out-of-scope names appear in comments only as documentation).
    for (const forbiddenToken of [
      "from 'node:fs'",
      'node:child_process',
      'readdir',
      'writeJson',
      'writeFileSync',
      'mkdirSync',
      'spawn(',
      'claimTask(',
      'markReady(',
      'listTaskIds',
      'syncTaskSequence',
      'selectWorker',
      'priority(',
      'dispatch(',
    ]) {
      assert.equal(moduleSource.includes(forbiddenToken), false, `read module must not contain ${forbiddenToken}`);
    }
    // Pure read across the full lifecycle leaves zero byte changes.
    driveToAdmitted(store, clock, 'SW17-N-SRC', 'SW17-N-CHILD', 'result-sw17-n-src');
    const beforeBytes = snapshotHomeBytes(home);
    store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-N-SRC' });
    store.claimAdmittedTask({ sourceTaskId: 'SW17-N-SRC', workerId: 'worker-a' });
    store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-N-SRC' });
    const claimed = store.readClaim('SW17-N-CHILD');
    store.deliverResult(sampleResult(claimed, { taskId: 'SW17-N-CHILD', resultId: 'result-sw17-n-child' }));
    store.readCanonicalSchedulableWork({ sourceTaskId: 'SW17-N-SRC' });
    const afterReadsOnly = snapshotHomeBytes(home);
    // Only the claim + result writes differ; the three pure reads changed nothing.
    const changedByReads = Object.keys(afterReadsOnly).filter((key) => afterReadsOnly[key] !== beforeBytes[key]);
    assert.deepEqual(changedByReads.sort(), [claimPath(home, 'SW17-N-CHILD').slice(home.length + 1), childTaskPath(home, 'SW17-N-CHILD').slice(home.length + 1), join('tasks', 'SW17-N-CHILD', 'result.json'), join('tasks', 'SW17-N-CHILD', 'results', 'result-sw17-n-child.json')].sort());
    const repoTasks = join(resolve(MODULE_DIRECTORY, '../..'), 'tasks');
    assert.equal(existsSync(repoTasks), false);
    assert.equal(existsSync(join(MODULE_DIRECTORY, 'canonical-schedulable-work-read.mjs')), true);
    assert.equal(existsSync(join(MODULE_DIRECTORY, 'canonical-schedulable-work-read.spec.mjs')), true);
    void resolveCoordinationHome;
  } finally {
    removeHome(home);
  }
});
