// Proof for GREENHUB-COORDINATION-CONTROL-TOWER-RESULT-INTAKE-GF07.
//
// Closes the last manual transport in the coordination cycle:
//   RESULT_DELIVERED(taskId)
//     -> CONTROL_TOWER_RESULT_AVAILABLE(taskId)   [PENDING_DISPOSITION gen 1]
// without human copy/paste of result JSON into the Control Tower.
//
// Proved here:
//   A. derive verifies canonical result/task/claim/authority binding, is
//      deterministic, and performs zero durable writes,
//   B. coordination:run automatically performs the Control Tower result intake
//      after delivery; terminal replay converges with zero executor
//      invocations and zero durable byte changes,
//   C. the emission-admission authority path performs the same intake with its
//      own authority binding,
//   D. crash window A (RESULT_DELIVERED before intake) recovers through run
//      replay and through the explicit `coordination:return` command,
//   E. crash window C (generation record durable, current pointer missing)
//      converges byte-identically without creating a second generation,
//   F. two concurrent OS-process intakes produce exactly ONE canonical
//      generation-1 disposition (no duplicate, no last-writer-wins),
//   G. corrupt canonical result / corrupt disposition authority fails closed
//      with zero repair and zero overwrite,
//   H. an existing later Control Tower verdict generation is never rewound or
//      duplicated by intake replay,
//   I. a BOUNDED_MUTATION delivered result is intaken without executor or
//      publication authority,
//   J. static boundaries: no scheduler/polling/daemon/child process/Git/GitHub
//      in the intake owner, no repository runtime artifacts, package command.
//
// All runtime state lives in isolated temp directories. No network, no real
// executor process: the executor seam is the existing caller-supplied function.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildAdmissionBoundClaimToken } from './admission-bound-claim.mjs';
import {
  buildControlTowerResultIntakeId,
  CONTROL_TOWER_RESULT_INTAKE_AUTHORITY_BINDING_MISMATCH,
  CONTROL_TOWER_RESULT_INTAKE_NOT_DELIVERED,
  deriveControlTowerResultIntake,
  performControlTowerResultIntake,
  validateControlTowerResultIntakeRecord,
} from './control-tower-result-intake.mjs';
import {
  computeResultBinding,
  DISPOSITION_STATE_ADOPTED,
  DISPOSITION_STATE_PENDING,
} from './disposition.mjs';
import { parseOperatorArgv, runOperatorCli } from './operator-cli.mjs';
import { CoordinationStore } from './store.mjs';
import { TASK_KIND_BOUNDED_MUTATION } from './task-envelope.mjs';
import {
  AUTHORITY_KIND_EMISSION_ADMISSION,
  AUTHORITY_KIND_USER_APPROVED_INTAKE,
  USER_APPROVED_INTAKE_DISPATCH_SLOT,
} from './user-approved-intake.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(MODULE_DIRECTORY, '../..');
const OPERATOR_CLI_PATH = join(MODULE_DIRECTORY, 'operator-cli.mjs');
const INTAKE_MODULE_PATH = join(MODULE_DIRECTORY, 'control-tower-result-intake.mjs');

function makeHome(prefix = 'greenhub-gf07-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function captureStream() {
  const stream = { text: '' };
  stream.write = (chunk) => {
    stream.text += String(chunk);
    return true;
  };
  return stream;
}

function snapshotHome(home) {
  const out = {};
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = [...entries].sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of sorted) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const stat = statSync(full);
        out[full.slice(home.length + 1)] = {
          content: readFileSync(full, 'utf8'),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        };
      }
    }
  };
  walk(home);
  return out;
}

function runCliProcess(args, env) {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(process.execPath, [OPERATOR_CLI_PATH, ...args], {
      cwd: REPOSITORY_ROOT,
      env,
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
    child.once('close', (code) => resolveResult({ code, stdout, stderr }));
  });
}

function sampleTaskSpec(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'READ_ONLY',
    desiredExitState: 'GF07_CONTROL_TOWER_AUTOMATIC_RETURN',
    policyRefs: [
      'docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md',
    ],
    evidenceRefs: ['read:package.json'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: { liveMainHint: null, requiredPolicies: ['AGENTS.md'] },
    ownedSurface: ['scripts/coordination/'],
    mutationBoundary: { allowsWrite: false, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['read:package.json'],
    ...overrides,
  };
}

function sampleMutationTaskSpec(taskId, overrides = {}) {
  return {
    ...sampleTaskSpec(taskId, overrides),
    taskKind: TASK_KIND_BOUNDED_MUTATION,
    mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
  };
}

function intakeTask(store, taskId, overrides = {}) {
  return store.intakeUserApprovedReadOnlyTask({
    userApproved: true,
    approval: { approvedBy: 'gf07-test-user', approvalRef: `gf07:test:${taskId}` },
    taskSpec: sampleTaskSpec(taskId, overrides),
    recorderId: 'gf07-test-recorder',
  });
}

function intakeAuthority(taskId, intakeId) {
  return {
    authorityKind: AUTHORITY_KIND_USER_APPROVED_INTAKE,
    authorityId: intakeId,
    sourceTaskId: taskId,
    emissionSlot: USER_APPROVED_INTAKE_DISPATCH_SLOT,
  };
}

function claimAndDeliverIntakeTask(store, taskId, { workerId = 'gf07-worker', resultId } = {}) {
  const claimed = store.claimUserApprovedIntakeTask({
    taskId,
    workerId,
    leaseDurationMs: 60_000,
  });
  const claim = claimed.claim;
  store.deliverResult({
    taskId,
    resultId: resultId ?? `result_${taskId.toLowerCase()}`,
    workerId: claim.workerId,
    claimToken: claim.claimToken,
    claimGeneration: claim.generation,
    status: 'SUCCEEDED',
    summary: `synthetic READ_ONLY probe for ${taskId}`,
    proofRefs: ['proof:gf07-synthetic-probe'],
    evidenceRefs: ['evidence:gf07-synthetic-probe'],
    frictionObserved: ['NONE'],
  });
  return claim;
}

function fakeStructuredExecutor(counter, overrides = {}) {
  return async function fakeExecutor(task28Record) {
    counter.calls += 1;
    return {
      schemaVersion: 1,
      dispatchId: task28Record.dispatchId,
      outcome: 'ACCEPTED',
      result: {
        taskId: task28Record.decisionInput.task.taskId,
        status: 'SUCCEEDED',
        summary: 'read-only automatic-return probe completed',
        proofRefs: ['proof:gf07-automatic-return'],
        evidenceRefs: ['evidence:gf07-automatic-return'],
        frictionObserved: ['NONE'],
      },
      ...overrides,
    };
  };
}

function controllableClock(startMs = 1_700_000_000_000) {
  let now = startMs;
  return {
    advance(ms) {
      now += ms;
    },
    provider() {
      return now;
    },
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

function driveToConsumed(store, clock, sourceTaskId, resultId = 'result-0001') {
  store.createTask(sampleMutationTaskSpec(sourceTaskId));
  store.markReady(sourceTaskId);
  const claim = store.claimTask({
    taskId: sourceTaskId,
    workerId: 'worker-source',
    leaseDurationMs: 60_000,
  });
  store.deliverResult({
    taskId: sourceTaskId,
    resultId,
    workerId: claim.workerId,
    claimToken: claim.claimToken,
    claimGeneration: claim.generation,
    status: 'SUCCEEDED',
    summary: 'bounded source output',
    proofRefs: ['store:read-back'],
    evidenceRefs: ['harness:temp-home'],
    frictionObserved: ['NONE'],
  });
  clock.advance(1000);
  store.beginDisposition({ taskId: sourceTaskId, resultId, ...ctParams() });
  clock.advance(1000);
  store.writeDisposition({
    taskId: sourceTaskId,
    dispositionGeneration: 2,
    resultId,
    ...ctParams({ controlTowerToken: 'ct-token-002' }),
    state: DISPOSITION_STATE_ADOPTED,
  });
  clock.advance(1000);
  store.materializeAdoption({ taskId: sourceTaskId, ...matParams() });
  clock.advance(1000);
  store.ackAdoption({ taskId: sourceTaskId, acknowledgerId: 'control-tower-1' });
  clock.advance(1000);
  store.markConsumed({ taskId: sourceTaskId, consumerId: 'control-tower-1' });
  clock.advance(1000);
}

function driveToAdmittedChild(store, clock, sourceTaskId, childSpec) {
  driveToConsumed(store, clock, sourceTaskId);
  store.emitNextTask({
    sourceTaskId,
    nextTaskSpec: childSpec,
    emitterId: 'control-tower-1',
  });
  clock.advance(1000);
  return store.admitEmittedTask({ sourceTaskId, admitterId: 'control-tower-1' });
}

function readOptionalDisposition(store, taskId) {
  try {
    return store.readCurrentDisposition(taskId);
  } catch (error) {
    if (error?.code === 'DISPOSITION_NOT_FOUND') return null;
    throw error;
  }
}

function dispositionPaths(home, taskId) {
  return {
    currentPath: join(home, 'tasks', taskId, 'disposition', 'current.json'),
    generationPath: join(home, 'tasks', taskId, 'disposition', 'generations', '1.json'),
    generationsDir: join(home, 'tasks', taskId, 'disposition', 'generations'),
  };
}

// ---------------------------------------------------------------------------
// A. derivation: binding, determinism, zero writes, fail-closed identity
// ---------------------------------------------------------------------------

test('A. derive verifies canonical result/task/claim/authority binding with zero writes', () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF07INTAKE-A001';
    const intake = intakeTask(store, taskId);
    claimAndDeliverIntakeTask(store, taskId, { resultId: 'result_gf07_a001' });
    const authority = intakeAuthority(taskId, intake.record.intakeId);
    const canonicalResult = store.readResult(taskId);
    const readyId = 'GF07INTAKE-A002';
    const readyIntake = intakeTask(store, readyId);

    const before = snapshotHome(home);
    const envelope = deriveControlTowerResultIntake({ store, taskId, authority });
    const replay = deriveControlTowerResultIntake({ store, taskId, authority });

    assert.equal(envelope.schemaVersion, '1');
    assert.equal(
      envelope.intakeId,
      buildControlTowerResultIntakeId({ taskId, resultId: 'result_gf07_a001' }),
    );
    assert.equal(envelope.taskId, taskId);
    assert.equal(envelope.taskKind, 'READ_ONLY');
    assert.equal(envelope.authorityKind, AUTHORITY_KIND_USER_APPROVED_INTAKE);
    assert.equal(envelope.authorityId, intake.record.intakeId);
    assert.equal(envelope.sourceTaskId, taskId);
    assert.equal(envelope.emissionSlot, USER_APPROVED_INTAKE_DISPATCH_SLOT);
    assert.equal(envelope.resultId, 'result_gf07_a001');
    assert.equal(envelope.resultBinding, computeResultBinding(canonicalResult));
    assert.equal(envelope.claimWorkerId, 'gf07-worker');
    assert.equal(envelope.claimGeneration, 1);
    assert.equal(envelope.dispositionRef, `${taskId}@1`);
    assert.equal(envelope.result.summary, `synthetic READ_ONLY probe for ${taskId}`);
    assert.equal(envelope.result.claimToken, canonicalResult.claimToken);
    assert.deepEqual(replay, envelope, 'derive is deterministic');

    assert.deepEqual(snapshotHome(home), before, 'derive performs zero durable writes');
    assert.equal(Object.isFrozen(validateControlTowerResultIntakeRecord(envelope)), true);

    // Wrong authority id fails closed with zero writes.
    assert.throws(
      () =>
        deriveControlTowerResultIntake({
          store,
          taskId,
          authority: { ...authority, authorityId: 'int_00000000000000000000000000000000' },
        }),
      (error) => error?.code === CONTROL_TOWER_RESULT_INTAKE_AUTHORITY_BINDING_MISMATCH,
    );
    // Intake authority is self-bound: a foreign source task id fails closed.
    assert.throws(
      () =>
        deriveControlTowerResultIntake({
          store,
          taskId,
          authority: { ...authority, sourceTaskId: 'GF07INTAKE-AOTHER' },
        }),
      (error) => error?.code === CONTROL_TOWER_RESULT_INTAKE_AUTHORITY_BINDING_MISMATCH,
    );
    // A missing authority binding fails closed before any read.
    assert.throws(
      () => deriveControlTowerResultIntake({ store, taskId, authority: null }),
      (error) => error?.code === 'INVALID_CONTROL_TOWER_RESULT_INTAKE_AUTHORITY',
    );
    // A not-yet-delivered task has no canonical result to hand over.
    assert.throws(
      () =>
        deriveControlTowerResultIntake({
          store,
          taskId: readyId,
          authority: intakeAuthority(readyId, readyIntake.record.intakeId),
        }),
      (error) => error?.code === CONTROL_TOWER_RESULT_INTAKE_NOT_DELIVERED,
    );
    assert.deepEqual(snapshotHome(home), before, 'all fail-closed paths write zero bytes');

    // Tampered canonical result (forged claim token) is not attributable and
    // fails closed without rewriting the durable bytes.
    const resultPath = join(home, 'tasks', taskId, 'result.json');
    const tampered = { ...canonicalResult, claimToken: 'forged-claim-token' };
    writeFileSync(resultPath, JSON.stringify(tampered, null, 2), 'utf8');
    const tamperedBytes = readFileSync(resultPath, 'utf8');
    assert.throws(
      () => deriveControlTowerResultIntake({ store, taskId, authority }),
      (error) => error?.code === CONTROL_TOWER_RESULT_INTAKE_AUTHORITY_BINDING_MISMATCH,
    );
    assert.equal(readFileSync(resultPath, 'utf8'), tamperedBytes, 'no repair by rewrite');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// B. automatic intake through coordination:run (user-approved intake authority)
// ---------------------------------------------------------------------------

test('B. coordination:run automatically hands a delivered result to the Control Tower and replay converges', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF07INTAKE-B001';
    const intake = intakeTask(store, taskId);
    const sequenceBefore = store.readTaskSequence();
    const counter = { calls: 0 };
    const executor = fakeStructuredExecutor(counter);

    const firstOut = captureStream();
    const firstErr = captureStream();
    const firstExit = await runOperatorCli({
      argv: ['run', taskId, '--json'],
      store,
      executor,
      stdout: firstOut,
      stderr: firstErr,
    });
    assert.equal(firstErr.text, '', firstErr.text);
    assert.equal(firstExit, 0);
    assert.equal(counter.calls, 1, 'exactly one executor boundary entry');
    const first = JSON.parse(firstOut.text);
    assert.equal(first.outcome, 'EXECUTED');
    assert.equal(first.taskStatus, 'RESULT_DELIVERED');
    assert.notEqual(first.controlTowerIntake, null);
    assert.equal(first.controlTowerIntake.newlyIntaken, true);
    assert.equal(first.controlTowerIntake.exactReplay, false);
    assert.equal(first.controlTowerIntake.dispositionRef, `${taskId}@1`);
    assert.equal(first.controlTowerIntake.dispositionState, DISPOSITION_STATE_PENDING);
    assert.equal(
      first.controlTowerIntake.intake.authorityId,
      intake.record.intakeId,
      'the intake envelope carries the exact authority binding',
    );
    assert.equal(first.controlTowerIntake.intake.resultId, first.delivery.resultId);
    assert.equal(first.controlTowerIntake.intake.result.status, 'SUCCEEDED');
    assert.equal(
      first.controlTowerIntake.intake.resultBinding,
      computeResultBinding(store.readResult(taskId)),
    );

    const disposition = store.readCurrentDisposition(taskId);
    assert.equal(disposition.state, DISPOSITION_STATE_PENDING);
    assert.equal(disposition.dispositionGeneration, 1);
    assert.equal(disposition.resultId, first.delivery.resultId);
    assert.equal(disposition.resultBinding, computeResultBinding(store.readResult(taskId)));
    assert.equal(disposition.claimGeneration, first.claimGeneration);
    assert.deepEqual(store.readTaskSequence(), sequenceBefore, 'no successor task may be created');

    // Terminal replay: zero executor invocations and zero durable byte change.
    const before = snapshotHome(home);
    const secondOut = captureStream();
    const secondErr = captureStream();
    const secondExit = await runOperatorCli({
      argv: ['run', taskId, '--json'],
      store,
      executor,
      stdout: secondOut,
      stderr: secondErr,
    });
    assert.equal(secondErr.text, '');
    assert.equal(secondExit, 0);
    assert.equal(counter.calls, 1, 'terminal replay must not re-invoke the executor');
    const second = JSON.parse(secondOut.text);
    assert.equal(second.outcome, 'ALREADY_TERMINAL');
    assert.equal(second.executorInvocations, 0);
    assert.equal(second.controlTowerIntake.newlyIntaken, false);
    assert.equal(second.controlTowerIntake.exactReplay, true);
    assert.deepEqual(snapshotHome(home), before, 'intake replay writes zero durable bytes');
    assert.deepEqual(store.readTaskSequence(), sequenceBefore);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// C. emission-admission authority path
// ---------------------------------------------------------------------------

test('C. the emission-admission authority path performs the same automatic intake with its own binding', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const sourceTaskId = 'GF07INTAKE-CSRC';
    const childTaskId = 'GF07INTAKE-C001';
    driveToAdmittedChild(store, clock, sourceTaskId, sampleTaskSpec(childTaskId));
    const admission = store.readEmissionAdmission({ sourceTaskId, emissionSlot: 'next' });
    const counter = { calls: 0 };
    const stdout = captureStream();
    const stderr = captureStream();
    const exitCode = await runOperatorCli({
      argv: ['run', childTaskId, '--json'],
      store,
      executor: fakeStructuredExecutor(counter),
      stdout,
      stderr,
    });
    assert.equal(stderr.text, '');
    assert.equal(exitCode, 0);
    assert.equal(counter.calls, 1);
    const projection = JSON.parse(stdout.text);
    assert.equal(projection.outcome, 'EXECUTED');
    assert.equal(projection.controlTowerIntake.newlyIntaken, true);
    assert.equal(
      projection.controlTowerIntake.intake.authorityKind,
      AUTHORITY_KIND_EMISSION_ADMISSION,
    );
    assert.equal(projection.controlTowerIntake.intake.authorityId, admission.admissionId);
    assert.equal(projection.controlTowerIntake.intake.sourceTaskId, sourceTaskId);
    assert.equal(projection.controlTowerIntake.intake.emissionSlot, 'next');
    assert.equal(store.readCurrentDisposition(childTaskId).state, DISPOSITION_STATE_PENDING);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// D. crash window A: delivery durable without intake
// ---------------------------------------------------------------------------

test('D. a crash between delivery and intake recovers through run replay and coordination:return', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const runTaskId = 'GF07INTAKE-D001';
    intakeTask(store, runTaskId);
    claimAndDeliverIntakeTask(store, runTaskId);
    assert.equal(readOptionalDisposition(store, runTaskId), null, 'no intake exists yet');

    // Recovery 1: rerunning `coordination:run` converges the terminal task and
    // performs the missing intake with zero executor invocations.
    const counter = { calls: 0 };
    const runOut = captureStream();
    const runExit = await runOperatorCli({
      argv: ['run', runTaskId, '--json'],
      store,
      executor: fakeStructuredExecutor(counter),
      stdout: runOut,
      stderr: captureStream(),
    });
    assert.equal(runExit, 0);
    assert.equal(counter.calls, 0, 'recovery never re-invokes an executor');
    const runProjection = JSON.parse(runOut.text);
    assert.equal(runProjection.outcome, 'ALREADY_TERMINAL');
    assert.equal(runProjection.controlTowerIntake.newlyIntaken, true);
    assert.equal(readOptionalDisposition(store, runTaskId).state, DISPOSITION_STATE_PENDING);

    // Recovery 2: the explicit `coordination:return` handover for an
    // already-delivered result.
    const returnTaskId = 'GF07INTAKE-D002';
    const returnIntake = intakeTask(store, returnTaskId);
    claimAndDeliverIntakeTask(store, returnTaskId, { resultId: 'result_gf07_d002' });
    const returnOut = captureStream();
    const returnErr = captureStream();
    const returnExit = await runOperatorCli({
      argv: ['return', returnTaskId, '--json'],
      store,
      stdout: returnOut,
      stderr: returnErr,
    });
    assert.equal(returnErr.text, '', returnErr.text);
    assert.equal(returnExit, 0);
    const returned = JSON.parse(returnOut.text);
    assert.equal(returned.projection, 'operator-control-tower-return');
    assert.equal(returned.authorityId, returnIntake.record.intakeId);
    assert.equal(returned.newlyIntaken, true);
    assert.equal(returned.disposition.dispositionRef, `${returnTaskId}@1`);
    assert.equal(returned.disposition.state, DISPOSITION_STATE_PENDING);
    assert.equal(returned.intake.resultId, 'result_gf07_d002');
    assert.equal(returned.intake.result.summary, `synthetic READ_ONLY probe for ${returnTaskId}`);

    const before = snapshotHome(home);
    const returnReplayOut = captureStream();
    const returnReplayExit = await runOperatorCli({
      argv: ['return', returnTaskId],
      store,
      stdout: returnReplayOut,
      stderr: captureStream(),
    });
    assert.equal(returnReplayExit, 0);
    assert.match(returnReplayOut.text, /exact replay/);
    assert.deepEqual(snapshotHome(home), before, 'return replay writes zero durable bytes');

    assert.equal(counter.calls, 0, 'no executor invocation anywhere in this recovery path');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. crash window C: generation durable, current pointer missing
// ---------------------------------------------------------------------------

test('E. a crash between the generation record and the current pointer converges byte-identically', () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF07INTAKE-E001';
    const intake = intakeTask(store, taskId);
    claimAndDeliverIntakeTask(store, taskId);
    const authority = intakeAuthority(taskId, intake.record.intakeId);

    const first = performControlTowerResultIntake({ store, taskId, authority });
    assert.equal(first.newlyIntaken, true);
    const paths = dispositionPaths(home, taskId);
    const generationBytes = readFileSync(paths.generationPath, 'utf8');
    const currentBytes = readFileSync(paths.currentPath, 'utf8');
    assert.equal(currentBytes, generationBytes, 'current pointer mirrors the generation winner');

    // Simulate the crash window: generation record durable, current pointer
    // never published.
    rmSync(paths.currentPath);
    assert.equal(readOptionalDisposition(store, taskId), null);

    const recovered = performControlTowerResultIntake({ store, taskId, authority });
    assert.equal(recovered.newlyIntaken, false);
    assert.equal(recovered.exactReplay, true);
    assert.equal(
      readFileSync(paths.generationPath, 'utf8'),
      generationBytes,
      'no second candidate',
    );
    assert.equal(readFileSync(paths.currentPath, 'utf8'), generationBytes, 'pointer restored');
    assert.deepEqual(readdirSync(paths.generationsDir).sort(), ['1.json']);
    assert.equal(store.readCurrentDisposition(taskId).state, DISPOSITION_STATE_PENDING);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. concurrent intake (two OS processes)
// ---------------------------------------------------------------------------

test('F. two concurrent intake processes produce exactly ONE canonical generation-1 disposition', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF07INTAKE-F001';
    intakeTask(store, taskId);
    claimAndDeliverIntakeTask(store, taskId);
    const resultBytes = JSON.stringify(store.readResult(taskId));
    const env = { ...process.env, GREENHUB_COORDINATION_HOME: home };

    const [first, second] = await Promise.all([
      runCliProcess(['return', taskId, '--json'], env),
      runCliProcess(['return', taskId, '--json'], env),
    ]);
    for (const [label, result] of [
      ['first', first],
      ['second', second],
    ]) {
      assert.equal(result.code, 0, `${label} return must exit 0: ${result.stderr}`);
      assert.equal(result.stderr, '', `${label} return stderr must be empty`);
    }
    const projections = [JSON.parse(first.stdout), JSON.parse(second.stdout)];
    const newlyIntaken = projections.filter((entry) => entry.newlyIntaken === true).length;
    const exactReplays = projections.filter((entry) => entry.exactReplay === true).length;
    assert.equal(newlyIntaken, 1, 'exactly one process creates the canonical disposition');
    assert.equal(exactReplays, 1, 'the losing process converges as an exact replay');

    const paths = dispositionPaths(home, taskId);
    assert.deepEqual(
      readdirSync(paths.generationsDir).sort(),
      ['1.json'],
      'no duplicate generation',
    );
    const generationBytes = readFileSync(paths.generationPath, 'utf8');
    assert.equal(readFileSync(paths.currentPath, 'utf8'), generationBytes);
    assert.equal(JSON.stringify(store.readResult(taskId)), resultBytes, 'result bytes stable');
    assert.equal(store.readCurrentDisposition(taskId).state, DISPOSITION_STATE_PENDING);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// G. corrupt authority fails closed
// ---------------------------------------------------------------------------

test('G. corrupt canonical result or corrupt disposition authority fails closed with no repair', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });

    // G1: corrupt canonical result -> CORRUPT_RESULT, no disposition written.
    const corruptResultTask = 'GF07INTAKE-G001';
    intakeTask(store, corruptResultTask);
    claimAndDeliverIntakeTask(store, corruptResultTask);
    const corruptResultPath = join(home, 'tasks', corruptResultTask, 'result.json');
    writeFileSync(corruptResultPath, '{ not valid json', 'utf8');
    const g1Err = captureStream();
    const g1Exit = await runOperatorCli({
      argv: ['return', corruptResultTask, '--json'],
      store,
      stdout: captureStream(),
      stderr: g1Err,
    });
    assert.equal(g1Exit, 1);
    assert.match(g1Err.text, /CORRUPT_RESULT/);
    assert.equal(existsSync(join(home, 'tasks', corruptResultTask, 'disposition')), false);
    assert.equal(readFileSync(corruptResultPath, 'utf8'), '{ not valid json');

    // G2: corrupt disposition current pointer -> CORRUPT_DISPOSITION.
    const corruptCurrentTask = 'GF07INTAKE-G002';
    const currentIntake = intakeTask(store, corruptCurrentTask);
    claimAndDeliverIntakeTask(store, corruptCurrentTask);
    performControlTowerResultIntake({
      store,
      taskId: corruptCurrentTask,
      authority: intakeAuthority(corruptCurrentTask, currentIntake.record.intakeId),
    });
    const currentPaths = dispositionPaths(home, corruptCurrentTask);
    const generationBytes = readFileSync(currentPaths.generationPath, 'utf8');
    writeFileSync(currentPaths.currentPath, '{ not valid json', 'utf8');
    const g2Err = captureStream();
    const g2Exit = await runOperatorCli({
      argv: ['return', corruptCurrentTask],
      store,
      stdout: captureStream(),
      stderr: g2Err,
    });
    assert.equal(g2Exit, 1);
    assert.match(g2Err.text, /CORRUPT_DISPOSITION/);
    assert.equal(readFileSync(currentPaths.currentPath, 'utf8'), '{ not valid json');
    assert.equal(readFileSync(currentPaths.generationPath, 'utf8'), generationBytes);

    // G3: corrupt disposition generation record -> CORRUPT_DISPOSITION.
    const corruptGenerationTask = 'GF07INTAKE-G003';
    const generationIntake = intakeTask(store, corruptGenerationTask);
    claimAndDeliverIntakeTask(store, corruptGenerationTask);
    performControlTowerResultIntake({
      store,
      taskId: corruptGenerationTask,
      authority: intakeAuthority(corruptGenerationTask, generationIntake.record.intakeId),
    });
    const generationPaths = dispositionPaths(home, corruptGenerationTask);
    writeFileSync(generationPaths.generationPath, '{ not valid json', 'utf8');
    const g3Err = captureStream();
    const g3Exit = await runOperatorCli({
      argv: ['return', corruptGenerationTask],
      store,
      stdout: captureStream(),
      stderr: g3Err,
    });
    assert.equal(g3Exit, 1);
    assert.match(g3Err.text, /CORRUPT_DISPOSITION/);
    assert.equal(readFileSync(generationPaths.generationPath, 'utf8'), '{ not valid json');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// H. an existing later Control Tower verdict generation is never disturbed
// ---------------------------------------------------------------------------

test('H. intake replay after a Control Tower verdict converges read-only and never rewinds', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF07INTAKE-H001';
    intakeTask(store, taskId);
    const counter = { calls: 0 };
    const executor = fakeStructuredExecutor(counter);
    const runOut = captureStream();
    assert.equal(
      await runOperatorCli({
        argv: ['run', taskId, '--json'],
        store,
        executor,
        stdout: runOut,
        stderr: captureStream(),
      }),
      0,
    );
    const projection = JSON.parse(runOut.text);
    assert.equal(projection.outcome, 'EXECUTED');
    assert.equal(counter.calls, 1);
    assert.equal(projection.controlTowerIntake.newlyIntaken, true);

    // The Control Tower exercises its own verdict authority (generation 2).
    const canonicalResult = store.readResult(taskId);
    store.writeDisposition({
      taskId,
      dispositionGeneration: 2,
      resultId: canonicalResult.resultId,
      ...ctParams({ controlTowerToken: 'ct-token-verdict', controlTowerId: 'control-tower-1' }),
      state: DISPOSITION_STATE_ADOPTED,
    });
    const paths = dispositionPaths(home, taskId);
    const before = snapshotHome(home);
    const generationBytes = readFileSync(paths.generationPath, 'utf8');

    // Intake replay must converge read-only on the ADOPTED generation.
    const returnOut = captureStream();
    const returnExit = await runOperatorCli({
      argv: ['return', taskId, '--json'],
      store,
      stdout: returnOut,
      stderr: captureStream(),
    });
    assert.equal(returnExit, 0);
    const returned = JSON.parse(returnOut.text);
    assert.equal(returned.exactReplay, true);
    assert.equal(returned.newlyIntaken, false);
    assert.equal(returned.disposition.dispositionGeneration, 2);
    assert.equal(returned.disposition.state, DISPOSITION_STATE_ADOPTED);
    assert.equal(returned.disposition.dispositionRef, `${taskId}@2`);

    const runReplayOut = captureStream();
    assert.equal(
      await runOperatorCli({
        argv: ['run', taskId, '--json'],
        store,
        executor,
        stdout: runReplayOut,
        stderr: captureStream(),
      }),
      0,
    );
    assert.equal(counter.calls, 1, 'terminal replay never re-invokes the executor');
    assert.equal(JSON.parse(runReplayOut.text).controlTowerIntake.exactReplay, true);

    assert.deepEqual(snapshotHome(home), before, 'no generation 3, no byte change');
    assert.equal(readFileSync(paths.generationPath, 'utf8'), generationBytes);
    assert.equal(store.readCurrentDisposition(taskId).state, DISPOSITION_STATE_ADOPTED);
    assert.equal(store.readCurrentDisposition(taskId).dispositionGeneration, 2);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// I. BOUNDED_MUTATION delivered result intake (no executor, no publication)
// ---------------------------------------------------------------------------

test('I. a BOUNDED_MUTATION delivered result is intaken without executor or publication authority', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const sourceTaskId = 'GF07INTAKE-ISRC';
    const childTaskId = 'GF07INTAKE-I001';
    driveToAdmittedChild(store, clock, sourceTaskId, sampleMutationTaskSpec(childTaskId));
    const admission = store.readEmissionAdmission({ sourceTaskId, emissionSlot: 'next' });
    const claimed = store.claimAdmittedTask({
      sourceTaskId,
      emissionSlot: 'next',
      workerId: 'worker-mutation',
      leaseDurationMs: 60_000,
    });
    assert.notEqual(claimed.terminal, true);
    store.deliverResult({
      taskId: childTaskId,
      resultId: 'result_gf07_i001',
      workerId: claimed.claim.workerId,
      claimToken: claimed.claim.claimToken,
      claimGeneration: claimed.claim.generation,
      status: 'SUCCEEDED',
      summary: 'bounded mutation candidate delivered',
      proofRefs: ['proof:gf07-mutation'],
      evidenceRefs: ['evidence:gf07-mutation'],
      frictionObserved: ['NONE'],
    });
    const performed = performControlTowerResultIntake({
      store,
      taskId: childTaskId,
      authority: {
        authorityKind: AUTHORITY_KIND_EMISSION_ADMISSION,
        authorityId: admission.admissionId,
        sourceTaskId,
        emissionSlot: 'next',
      },
    });
    assert.equal(performed.newlyIntaken, true);
    assert.equal(performed.intake.taskKind, TASK_KIND_BOUNDED_MUTATION);
    assert.equal(performed.intake.result.status, 'SUCCEEDED');
    const disposition = store.readCurrentDisposition(childTaskId);
    assert.equal(disposition.state, DISPOSITION_STATE_PENDING);
    assert.equal(
      disposition.controlTowerToken,
      'control-tower-result-intake',
      'the automatic intake records its own provenance, not a verdict',
    );
    // Everything above is a durable pointer only: no materialization/ACK/
    // consumption/publication record exists after intake.
    assert.equal(existsSync(join(home, 'tasks', childTaskId, 'materialization.json')), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// J. static boundaries, repository artifacts, package command
// ---------------------------------------------------------------------------

test('J. the intake owner stays scheduler/process/Git-free and package.json exposes coordination:return', async () => {
  const source = readFileSync(INTAKE_MODULE_PATH, 'utf8');
  assert.doesNotMatch(source, /setInterval|setTimeout|setImmediate/);
  assert.doesNotMatch(source, /node:child_process|node:worker_threads|node:net|node:http/);
  assert.doesNotMatch(source, /\bspawn\b|\bexecFile\b|\bwatchFile\b|\bwatch\s*\(/);
  assert.doesNotMatch(source, /while\s*\(\s*true\s*\)/);
  assert.doesNotMatch(source, /git\s+(ls-remote|fetch|push|rev-parse)/);
  assert.doesNotMatch(source, /Date\.now|new Date|performance\.now/);

  const operatorSource = readFileSync(OPERATOR_CLI_PATH, 'utf8');
  assert.ok(operatorSource.includes('performControlTowerResultIntake('));
  assert.ok(operatorSource.includes("options.command === 'return'"));

  const packageJson = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts['coordination:return'],
    'node scripts/coordination/operator-cli.mjs return',
  );

  const returnOptions = parseOperatorArgv(['return', 'GF07INTAKE-J001', '--json']);
  assert.equal(returnOptions.command, 'return');
  assert.equal(returnOptions.taskId, 'GF07INTAKE-J001');
  assert.equal(returnOptions.json, true);
  assert.throws(
    () => parseOperatorArgv(['return']),
    (error) => error?.code === 'OPERATOR_ARGUMENT_INVALID',
  );

  const usageOut = captureStream();
  assert.equal(
    await runOperatorCli({ argv: ['--help'], stdout: usageOut, stderr: captureStream() }),
    0,
  );
  assert.match(usageOut.text, /coordination:return/);

  // No runtime artifact may appear inside the repository worktree.
  assert.equal(existsSync(join(REPOSITORY_ROOT, 'tasks')), false);
  assert.equal(existsSync(join(REPOSITORY_ROOT, 'disposition')), false);
  assert.equal(existsSync(join(REPOSITORY_ROOT, 'executor-result-receipts')), false);
  assert.equal(existsSync(join(REPOSITORY_ROOT, 'coordination')), false);

  // The existing admission-bound claim token builder is the only attribution
  // rule: the intake envelope claim provenance matches the canonical claim.
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF07INTAKE-J001';
    const intake = intakeTask(store, taskId);
    const claim = claimAndDeliverIntakeTask(store, taskId);
    const authority = intakeAuthority(taskId, intake.record.intakeId);
    const envelope = deriveControlTowerResultIntake({ store, taskId, authority });
    const expectedToken = buildAdmissionBoundClaimToken({
      admissionId: intake.record.intakeId,
      nextTaskId: taskId,
      workerId: claim.workerId,
    });
    assert.equal(envelope.result.claimToken, expectedToken);
    assert.equal(envelope.claimGeneration, claim.generation);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// K. disposition candidate determinism (byte-level replay identity)
// ---------------------------------------------------------------------------

test('K. the intake disposition candidate is byte-deterministic and carries reference-first provenance', () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF07INTAKE-K001';
    const intake = intakeTask(store, taskId);
    claimAndDeliverIntakeTask(store, taskId);
    const authority = intakeAuthority(taskId, intake.record.intakeId);
    performControlTowerResultIntake({ store, taskId, authority });
    const generationBytes = readFileSync(dispositionPaths(home, taskId).generationPath, 'utf8');
    const record = JSON.parse(generationBytes);

    assert.equal(record.schemaVersion, '1');
    assert.equal(record.taskId, taskId);
    assert.equal(record.dispositionGeneration, 1);
    assert.equal(record.state, DISPOSITION_STATE_PENDING);
    assert.equal(record.controlTowerId, 'control-tower');
    assert.equal(record.controlTowerToken, 'control-tower-result-intake');
    assert.equal(record.decidedAt, store.readResult(taskId).deliveredAt);
    assert.equal(record.resultId, store.readResult(taskId).resultId);
    assert.equal(record.resultBinding, computeResultBinding(store.readResult(taskId)));
    assert.ok(record.policyRefs.includes('AGENTS.md'));
    assert.ok(record.proofRefs.some((entry) => entry.startsWith('canonical-result:')));
    assert.ok(record.evidenceRefs.some((entry) => entry.startsWith('authority:')));
    assert.equal(/timeline|transcript|chatHistory|ssot/i.test(generationBytes), false);
    assert.equal(
      JSON.parse(readFileSync(dispositionPaths(home, taskId).currentPath, 'utf8'))
        .dispositionGeneration,
      1,
    );
  } finally {
    removeHome(home);
  }
});
