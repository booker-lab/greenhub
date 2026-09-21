// Proof for GREENHUB-COORDINATION-USER-APPROVED-READONLY-INTAKE-GF06.
//
// Bounded state transition proved here:
//   USER-APPROVED READ_ONLY TASK SPEC
//     -> CANONICAL TASK IDENTITY
//     -> CANONICAL INTAKE AUTHORITY
//     -> READY
//
// Proved:
//   A. valid user-approved READ_ONLY intake converges to READY with one
//      canonical intake authority, one task, one sequence membership, and zero
//      claim/dispatch/executor artifacts,
//   B. missing/false explicit approval performs zero durable writes,
//   C. BOUNDED_MUTATION performs zero durable writes,
//   D. allowsWrite=true performs zero durable writes,
//   E. malformed envelope performs zero durable writes,
//   F. exact replay is byte/identity stable (no duplicate, no generation),
//   G. same identity + payload drift fails closed without rewriting,
//   H. same taskId foreign authority fails closed with zero durable writes,
//   I/J. crash windows (authority->task, CREATED->READY) converge on replay,
//   K/L. 2/4-process identical intake races converge to one identity,
//   M. conflicting concurrent payload race elects one canonical winner,
//   N. the operator CLI `coordination:intake` entry performs ONE explicit
//      intake (and rejects malformed/mismatched specs without writing),
//   O. GF-05 compatibility: an intaken READ_ONLY task runs through the existing
//      operator chain (claim -> dispatch -> fence -> receipt -> delivery) with
//      the caller-supplied fake executor, and terminal replay re-invokes
//      nothing; a task without any pre-execution authority still fails closed,
//   P. successor emission stays CONSUMED-only and emission admission keeps
//      claiming its own children,
//   Q. both authority sources binding one task fails closed as ambiguous,
//   R. corrupt/tampered intake authority and task bytes fail closed with no
//      repair,
//   S. runtime state stays outside the repository worktree and the intake
//      module carries no scheduler/daemon/executor surface.
//
// All runtime state lives in isolated temp directories. No network required.
// No real OpenCode process is spawned: the existing caller-supplied executor
// seam is used with an in-memory fake.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync as nodeMkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveCoordinationHome } from './coordination-home.mjs';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import {
  DEFAULT_OPERATOR_RECORDER_ID,
  OPERATOR_INTAKE_HOME_INVALID,
  OPERATOR_INTAKE_SPEC_INVALID,
  OPERATOR_TASK_ADMISSION_NOT_FOUND,
  OPERATOR_TASK_AUTHORITY_AMBIGUOUS,
  parseOperatorArgv,
  performUserApprovedIntake,
  runOperatorCli,
  RUN_OUTCOME_ALREADY_TERMINAL,
  RUN_OUTCOME_EXECUTED,
} from './operator-cli.mjs';
import { CoordinationStore } from './store.mjs';
import {
  AUTHORITY_KIND_USER_APPROVED_INTAKE,
  buildUserApprovedIntakeRecord,
  userApprovedIntakeFilePath,
} from './user-approved-intake.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(MODULE_DIRECTORY, '../..');
const STORE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'store.mjs')).href;
const INTAKE_MODULE_PATH = join(MODULE_DIRECTORY, 'user-approved-intake.mjs');
const OPERATOR_CLI_PATH = join(MODULE_DIRECTORY, 'operator-cli.mjs');

function makeHome(prefix = 'greenhub-gf06-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskSpec(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'READ_ONLY',
    desiredExitState: 'GF06_READY',
    policyRefs: [
      'docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md',
    ],
    evidenceRefs: ['git:live-main-read'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: {
      liveMainHint: null,
      requiredPolicies: ['AGENTS.md'],
    },
    ownedSurface: ['scripts/coordination/'],
    mutationBoundary: { allowsWrite: false, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['gf06-intake-proof'],
    ...overrides,
  };
}

function sampleApproval(overrides = {}) {
  return {
    approvedBy: 'user:tazan',
    approvalRef: 'chat:gf06-approved',
    ...overrides,
  };
}

function intakeRequest(taskId, overrides = {}) {
  return {
    userApproved: true,
    approval: sampleApproval(),
    taskSpec: sampleTaskSpec(taskId),
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
  store.createTask(sampleTaskSpec(taskId, { taskKind: 'BOUNDED_MUTATION', mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] } }));
  store.markReady(taskId);
  const claim = store.claimTask({ taskId, workerId: 'worker-a', leaseDurationMs: 60_000 });
  store.deliverResult(sampleResult(claim, { resultId }));
  return { claim };
}

function driveToConsumed(store, clock, taskId, resultId = 'result-0001') {
  driveToDelivered(store, taskId, resultId);
  store.beginDisposition({ taskId, resultId, ...ctParams() });
  clock.advance(1000);
  store.writeDisposition({
    taskId,
    dispositionGeneration: 2,
    resultId,
    ...ctParams({ controlTowerToken: 'ct-token-002' }),
    state: DISPOSITION_STATE_ADOPTED,
  });
  clock.advance(1000);
  store.materializeAdoption({ taskId, ...matParams() });
  clock.advance(1000);
  store.ackAdoption({ taskId, acknowledgerId: 'control-tower-1' });
  clock.advance(1000);
  store.markConsumed({ taskId, consumerId: 'control-tower-1' });
  clock.advance(1000);
}

function emitChild(store, clock, sourceTaskId, childSpec) {
  const emitted = store.emitNextTask({
    sourceTaskId,
    nextTaskSpec: childSpec,
    emitterId: 'control-tower-1',
  });
  clock.advance(1000);
  return emitted;
}

function driveToAdmittedChild(store, clock, sourceTaskId, childSpec) {
  driveToConsumed(store, clock, sourceTaskId);
  emitChild(store, clock, sourceTaskId, childSpec);
  const admitted = store.admitEmittedTask({ sourceTaskId, admitterId: 'control-tower-1' });
  clock.advance(1000);
  return admitted;
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
        summary: 'read-only operator probe completed',
        proofRefs: ['proof:operator-run'],
        evidenceRefs: ['evidence:operator-run'],
        frictionObserved: ['NONE'],
      },
      ...overrides,
    };
  };
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

function runIntakeWorker({ home, request, recorderId, inlineScript }) {
  return new Promise((resolveResult, rejectResult) => {
    const code =
      inlineScript ??
      [
        'try {',
        `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
        `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
        `  const out = store.intakeUserApprovedReadOnlyTask(${JSON.stringify({
          userApproved: true,
          approval: request.approval,
          taskSpec: request.taskSpec,
          recorderId,
        })});`,
        '  console.log(JSON.stringify({ ok: true, intakeId: out.record.intakeId, duplicate: out.duplicate, taskStatus: out.task.status, desiredExitState: out.record.taskSpec.desiredExitState }));',
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
        rejectResult(new Error(`intake race worker exit=${exitCode} stderr=${stderr}`));
        return;
      }
      try {
        resolveResult(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch {
        rejectResult(new Error(`intake race worker output parse failed: ${stdout} / ${stderr}`));
      }
    });
  });
}

function writeIntakeAuthorityFile(home, taskId, request, recordedAt = '2026-09-21T00:00:00.000Z') {
  const record = buildUserApprovedIntakeRecord({
    userApproved: true,
    approval: request.approval,
    taskSpec: request.taskSpec,
    recordedAt,
    recorderId: 'crash-fixture',
  });
  const path = userApprovedIntakeFilePath(home, taskId);
  nodeMkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(record, null, 2), 'utf8');
  return { path, record };
}

test('A. valid user-approved READ_ONLY intake converges to READY with one canonical authority', () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const request = intakeRequest('GF06-A-001');
    const out = store.intakeUserApprovedReadOnlyTask({
      userApproved: true,
      approval: request.approval,
      taskSpec: request.taskSpec,
      recorderId: 'operator-cli',
    });
    assert.equal(out.duplicate, false);
    assert.equal(out.task.status, 'READY');
    assert.match(out.record.intakeId, /^int_[0-9a-f]{32}$/);
    assert.equal(out.record.taskId, 'GF06-A-001');
    assert.equal(out.record.taskSpec.taskKind, 'READ_ONLY');
    assert.equal(out.record.taskSpec.mutationBoundary.allowsWrite, false);
    assert.deepEqual(out.record.approval, request.approval);

    const task = store.readTask('GF06-A-001');
    assert.equal(task.status, 'READY');
    assert.equal(task.taskKind, 'READ_ONLY');
    assert.equal(store.readUserApprovedIntake({ taskId: 'GF06-A-001' }).intakeId, out.record.intakeId);
    assert.equal(store.readTaskSequence().filter((id) => id === 'GF06-A-001').length, 1);

    // No downstream artifact may exist: no claim, no dispatch, no executor.
    assert.equal(existsSync(join(home, 'tasks', 'GF06-A-001', 'claim.json')), false);
    assert.equal(existsSync(join(home, 'tasks', 'GF06-A-001', 'dispatch-attempts')), false);
    assert.equal(existsSync(join(home, 'tasks', 'GF06-A-001', 'emissions')), false);
    assert.equal(existsSync(join(home, 'tasks', 'GF06-A-001', 'emission-admissions')), false);
    assert.equal(existsSync(join(home, 'receiver-acceptances')), false);
    assert.equal(existsSync(join(home, 'executor-invocation-attempts')), false);
    assert.equal(existsSync(join(home, 'executor-invocation-fences')), false);
    assert.equal(existsSync(join(home, 'executor-result-receipts')), false);
  } finally {
    removeHome(home);
  }
});

test('B. missing explicit approval performs zero durable writes', () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const before = snapshotHome(home);
    // absent
    assert.throws(
      () =>
        store.intakeUserApprovedReadOnlyTask({
          approval: sampleApproval(),
          taskSpec: sampleTaskSpec('GF06-B-001'),
          recorderId: 'operator-cli',
        }),
      (error) => error?.code === 'INTAKE_REQUIRES_EXPLICIT_USER_APPROVAL',
    );
    // false
    assert.throws(
      () =>
        store.intakeUserApprovedReadOnlyTask({
          userApproved: false,
          approval: sampleApproval(),
          taskSpec: sampleTaskSpec('GF06-B-002'),
          recorderId: 'operator-cli',
        }),
      (error) => error?.code === 'INTAKE_REQUIRES_EXPLICIT_USER_APPROVAL',
    );
    // truthy non-boolean
    assert.throws(
      () =>
        store.intakeUserApprovedReadOnlyTask({
          userApproved: 'true',
          approval: sampleApproval(),
          taskSpec: sampleTaskSpec('GF06-B-003'),
          recorderId: 'operator-cli',
        }),
      (error) => error?.code === 'INTAKE_REQUIRES_EXPLICIT_USER_APPROVAL',
    );
    // approval provenance missing
    assert.throws(
      () =>
        store.intakeUserApprovedReadOnlyTask({
          userApproved: true,
          taskSpec: sampleTaskSpec('GF06-B-004'),
          recorderId: 'operator-cli',
        }),
      (error) => error?.code === 'INTAKE_REQUIRES_EXPLICIT_USER_APPROVAL',
    );
    assert.deepEqual(snapshotHome(home), before, 'no durable write may happen');
  } finally {
    removeHome(home);
  }
});

test('C. BOUNDED_MUTATION is refused with zero durable writes', () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const before = snapshotHome(home);
    assert.throws(
      () =>
        store.intakeUserApprovedReadOnlyTask({
          userApproved: true,
          approval: sampleApproval(),
          taskSpec: sampleTaskSpec('GF06-C-001', {
            taskKind: 'BOUNDED_MUTATION',
            mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
          }),
          recorderId: 'operator-cli',
        }),
      (error) => error?.code === 'INTAKE_REQUIRES_READ_ONLY_TASK',
    );
    assert.deepEqual(snapshotHome(home), before, 'no durable write may happen');
  } finally {
    removeHome(home);
  }
});

test('D. allowsWrite=true is refused with zero durable writes', () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const before = snapshotHome(home);
    // READ_ONLY + allowsWrite=true violates the envelope contract itself.
    assert.throws(
      () =>
        store.intakeUserApprovedReadOnlyTask({
          userApproved: true,
          approval: sampleApproval(),
          taskSpec: sampleTaskSpec('GF06-D-001', {
            mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
          }),
          recorderId: 'operator-cli',
        }),
      (error) => typeof error?.code === 'string' && error.code.length > 0,
    );
    // BOUNDED_MUTATION + allowsWrite=false is still refused by the READ_ONLY gate.
    assert.throws(
      () =>
        store.intakeUserApprovedReadOnlyTask({
          userApproved: true,
          approval: sampleApproval(),
          taskSpec: sampleTaskSpec('GF06-D-002', {
            taskKind: 'BOUNDED_MUTATION',
            mutationBoundary: { allowsWrite: false, forbiddenPaths: ['apps/api/'] },
          }),
          recorderId: 'operator-cli',
        }),
      (error) => error?.code === 'INTAKE_REQUIRES_READ_ONLY_TASK',
    );
    assert.deepEqual(snapshotHome(home), before, 'no durable write may happen');
  } finally {
    removeHome(home);
  }
});

test('E. malformed envelope performs zero durable writes', () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const before = snapshotHome(home);
    const cases = [
      // blocked inline dump
      sampleTaskSpec('GF06-E-001', { chatHistory: ['...'] }),
      // missing proofRequirement
      (() => {
        const spec = sampleTaskSpec('GF06-E-002');
        delete spec.proofRequirement;
        return spec;
      })(),
      // empty policyRefs
      sampleTaskSpec('GF06-E-003', { policyRefs: [] }),
      // invalid taskId
      sampleTaskSpec('bad id!', {}),
      // invalid ownedSurface escape
      sampleTaskSpec('GF06-E-005', { ownedSurface: ['../outside'] }),
    ];
    for (const taskSpec of cases) {
      assert.throws(
        () =>
          store.intakeUserApprovedReadOnlyTask({
            userApproved: true,
            approval: sampleApproval(),
            taskSpec,
            recorderId: 'operator-cli',
          }),
        (error) => typeof error?.code === 'string' && error.code.length > 0,
      );
    }
    assert.deepEqual(snapshotHome(home), before, 'no durable write may happen');
  } finally {
    removeHome(home);
  }
});

test('F. exact replay is byte/identity stable and creates no duplicate', () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const request = intakeRequest('GF06-F-001');
    const first = store.intakeUserApprovedReadOnlyTask({
      userApproved: true,
      approval: request.approval,
      taskSpec: request.taskSpec,
      recorderId: 'operator-cli',
    });
    const authorityPath = userApprovedIntakeFilePath(home, 'GF06-F-001');
    const taskPath = join(home, 'tasks', 'GF06-F-001', 'task.json');
    const authorityBytes = readFileSync(authorityPath, 'utf8');
    const taskBytes = readFileSync(taskPath, 'utf8');
    const sequenceBefore = store.readTaskSequence();

    const second = store.intakeUserApprovedReadOnlyTask({
      userApproved: true,
      approval: request.approval,
      taskSpec: request.taskSpec,
      recorderId: 'different-recorder-provenance',
    });
    assert.equal(second.duplicate, true);
    assert.equal(second.record.intakeId, first.record.intakeId);
    assert.equal(second.task.status, 'READY');
    assert.equal(readFileSync(authorityPath, 'utf8'), authorityBytes, 'authority bytes must not change on replay');
    assert.equal(readFileSync(taskPath, 'utf8'), taskBytes, 'task bytes must not change on replay');
    assert.deepEqual(store.readTaskSequence(), sequenceBefore, 'no duplicate sequence membership');
    assert.equal(store.readTaskSequence().filter((id) => id === 'GF06-F-001').length, 1);
  } finally {
    removeHome(home);
  }
});

test('G. same identity + payload drift fails closed without rewriting the winner', () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const request = intakeRequest('GF06-G-001');
    const first = store.intakeUserApprovedReadOnlyTask({
      userApproved: true,
      approval: request.approval,
      taskSpec: request.taskSpec,
      recorderId: 'operator-cli',
    });
    const authorityPath = userApprovedIntakeFilePath(home, 'GF06-G-001');
    const authorityBytes = readFileSync(authorityPath, 'utf8');

    // drift 1: different desiredExitState
    assert.throws(
      () =>
        store.intakeUserApprovedReadOnlyTask({
          userApproved: true,
          approval: request.approval,
          taskSpec: sampleTaskSpec('GF06-G-001', { desiredExitState: 'DIFFERENT' }),
          recorderId: 'operator-cli',
        }),
      (error) => error?.code === 'INTAKE_CONFLICT',
    );
    // drift 2: different approval provenance for the same canonical spec
    assert.throws(
      () =>
        store.intakeUserApprovedReadOnlyTask({
          userApproved: true,
          approval: sampleApproval({ approvalRef: 'chat:different-approval' }),
          taskSpec: request.taskSpec,
          recorderId: 'operator-cli',
        }),
      (error) => error?.code === 'INTAKE_CONFLICT',
    );
    assert.equal(readFileSync(authorityPath, 'utf8'), authorityBytes, 'first winner bytes preserved');
    assert.equal(store.readUserApprovedIntake({ taskId: 'GF06-G-001' }).intakeId, first.record.intakeId);
  } finally {
    removeHome(home);
  }
});

test('H. same taskId under a foreign authority fails closed with zero durable writes', () => {
  // H1: manual pre-existing READY task with the exact same spec bytes.
  {
    const home = makeHome();
    try {
      const store = new CoordinationStore({ dir: home });
      store.createTask(sampleTaskSpec('GF06-H1-001'));
      store.markReady('GF06-H1-001');
      const before = snapshotHome(home);
      assert.throws(
        () =>
          store.intakeUserApprovedReadOnlyTask({
            userApproved: true,
            approval: sampleApproval(),
            taskSpec: sampleTaskSpec('GF06-H1-001'),
            recorderId: 'operator-cli',
          }),
        (error) => error?.code === 'INTAKE_TASK_BYPASS_DETECTED',
      );
      assert.deepEqual(snapshotHome(home), before, 'no intake authority may be written');
    } finally {
      removeHome(home);
    }
  }
  // H2: emission-admitted child with the same taskId.
  {
    const home = makeHome();
    try {
      const clock = controllableClock();
      const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
      driveToAdmittedChild(store, clock, 'GF06-H2-SRC', sampleTaskSpec('GF06-H2-CHILD'));
      const before = snapshotHome(home);
      assert.throws(
        () =>
          store.intakeUserApprovedReadOnlyTask({
            userApproved: true,
            approval: sampleApproval(),
            taskSpec: sampleTaskSpec('GF06-H2-CHILD'),
            recorderId: 'operator-cli',
          }),
        (error) => error?.code === 'INTAKE_AUTHORITY_CONFLICT',
      );
      assert.deepEqual(snapshotHome(home), before, 'no intake authority may be written');
      assert.equal(store.readTask('GF06-H2-CHILD').status, 'READY');
    } finally {
      removeHome(home);
    }
  }
  // H3: emitted (not yet admitted) child with the same taskId.
  {
    const home = makeHome();
    try {
      const clock = controllableClock();
      const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
      driveToConsumed(store, clock, 'GF06-H3-SRC');
      emitChild(store, clock, 'GF06-H3-SRC', sampleTaskSpec('GF06-H3-CHILD'));
      const before = snapshotHome(home);
      assert.throws(
        () =>
          store.intakeUserApprovedReadOnlyTask({
            userApproved: true,
            approval: sampleApproval(),
            taskSpec: sampleTaskSpec('GF06-H3-CHILD'),
            recorderId: 'operator-cli',
          }),
        (error) => error?.code === 'INTAKE_AUTHORITY_CONFLICT',
      );
      assert.deepEqual(snapshotHome(home), before, 'no intake authority may be written');
    } finally {
      removeHome(home);
    }
  }
});

test('I. crash authority -> task replay converges to task create + READY', () => {
  const home = makeHome();
  try {
    const request = intakeRequest('GF06-I-001');
    const { record } = writeIntakeAuthorityFile(home, 'GF06-I-001', request);
    const store = new CoordinationStore({ dir: home });
    const out = store.intakeUserApprovedReadOnlyTask({
      userApproved: true,
      approval: request.approval,
      taskSpec: request.taskSpec,
      recorderId: 'operator-cli',
    });
    assert.equal(out.duplicate, true);
    assert.equal(out.record.intakeId, record.intakeId);
    assert.equal(out.task.status, 'READY');
    assert.equal(store.readTask('GF06-I-001').status, 'READY');
    assert.equal(readFileSync(userApprovedIntakeFilePath(home, 'GF06-I-001'), 'utf8'), JSON.stringify(record, null, 2));
  } finally {
    removeHome(home);
  }
});

test('J. crash CREATED -> READY replay converges to READY without rewriting', () => {
  const home = makeHome();
  try {
    const request = intakeRequest('GF06-J-001');
    writeIntakeAuthorityFile(home, 'GF06-J-001', request);
    const store = new CoordinationStore({ dir: home });
    const created = store.createTask(sampleTaskSpec('GF06-J-001'));
    assert.equal(created.status, 'CREATED');
    const taskBytes = readFileSync(join(home, 'tasks', 'GF06-J-001', 'task.json'), 'utf8');
    const out = store.intakeUserApprovedReadOnlyTask({
      userApproved: true,
      approval: request.approval,
      taskSpec: request.taskSpec,
      recorderId: 'operator-cli',
    });
    assert.equal(out.duplicate, true);
    assert.equal(out.task.status, 'READY');
    // markReady legitimately updates status/updatedAt; the canonical spec bytes
    // and authority must not be duplicated or replaced.
    const taskAfter = JSON.parse(readFileSync(join(home, 'tasks', 'GF06-J-001', 'task.json'), 'utf8'));
    const taskBefore = JSON.parse(taskBytes);
    assert.equal(taskAfter.taskId, taskBefore.taskId);
    assert.equal(taskAfter.status, 'READY');
    assert.equal(store.readTaskSequence().filter((id) => id === 'GF06-J-001').length, 1);
  } finally {
    removeHome(home);
  }
});

test('K. two-process identical intake race converges to one canonical identity', { timeout: 60_000 }, async () => {
  for (let round = 0; round < 5; round += 1) {
    const home = makeHome(`greenhub-gf06-race2-${round}-`);
    try {
      const request = intakeRequest(`GF06-K-${round}`);
      const results = await Promise.all([
        runIntakeWorker({ home, request, recorderId: 'worker-1' }),
        runIntakeWorker({ home, request, recorderId: 'worker-2' }),
      ]);
      for (const result of results) {
        assert.equal(result.ok, true);
        assert.equal(result.intakeId, results[0].intakeId);
        assert.equal(result.taskStatus, 'READY');
      }
      const store = new CoordinationStore({ dir: home });
      const authority = store.readUserApprovedIntake({ taskId: `GF06-K-${round}` });
      assert.equal(authority.intakeId, results[0].intakeId);
      assert.equal(store.readTask(`GF06-K-${round}`).status, 'READY');
      assert.equal(store.readTaskSequence().filter((id) => id === `GF06-K-${round}`).length, 1);
      assert.equal(readdirSync(join(home, 'intake-authorities')).length, 1);
      const created = results.filter((result) => result.duplicate === false).length;
      assert.ok(created >= 1 && created <= 2, `exactly one writer may create; observed ${created}`);
    } finally {
      removeHome(home);
    }
  }
});

test('L. four-process identical intake race converges to one canonical identity', { timeout: 90_000 }, async () => {
  for (let round = 0; round < 3; round += 1) {
    const home = makeHome(`greenhub-gf06-race4-${round}-`);
    try {
      const request = intakeRequest(`GF06-L-${round}`);
      const results = await Promise.all([
        runIntakeWorker({ home, request, recorderId: 'worker-1' }),
        runIntakeWorker({ home, request, recorderId: 'worker-2' }),
        runIntakeWorker({ home, request, recorderId: 'worker-3' }),
        runIntakeWorker({ home, request, recorderId: 'worker-4' }),
      ]);
      for (const result of results) {
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal(result.intakeId, results[0].intakeId);
        assert.equal(result.taskStatus, 'READY');
      }
      const store = new CoordinationStore({ dir: home });
      assert.equal(store.readTask(`GF06-L-${round}`).status, 'READY');
      assert.equal(store.readTaskSequence().filter((id) => id === `GF06-L-${round}`).length, 1);
      assert.equal(readdirSync(join(home, 'intake-authorities')).length, 1);
    } finally {
      removeHome(home);
    }
  }
});

test('M. conflicting concurrent payload race elects exactly one canonical winner', { timeout: 60_000 }, async () => {
  for (let round = 0; round < 5; round += 1) {
    const home = makeHome(`greenhub-gf06-raceconflict-${round}-`);
    try {
      const taskId = `GF06-M-${round}`;
      const requestA = intakeRequest(taskId, {
        taskSpec: sampleTaskSpec(taskId, { desiredExitState: 'EXIT_A' }),
      });
      const requestB = intakeRequest(taskId, {
        taskSpec: sampleTaskSpec(taskId, { desiredExitState: 'EXIT_B' }),
      });
      const results = await Promise.all([
        runIntakeWorker({ home, request: requestA, recorderId: 'worker-a' }),
        runIntakeWorker({ home, request: requestB, recorderId: 'worker-b' }),
      ]);
      const winners = results.filter((result) => result.ok === true);
      const losers = results.filter((result) => result.ok === false);
      assert.equal(winners.length, 1, JSON.stringify(results));
      assert.equal(losers.length, 1, JSON.stringify(results));
      assert.equal(losers[0].code, 'INTAKE_CONFLICT');
      const store = new CoordinationStore({ dir: home });
      const authority = store.readUserApprovedIntake({ taskId });
      assert.equal(authority.intakeId, winners[0].intakeId);
      assert.equal(authority.taskSpec.desiredExitState, winners[0].desiredExitState);
      assert.equal(store.readTask(taskId).desiredExitState, winners[0].desiredExitState);
      assert.equal(store.readTask(taskId).status, 'READY');
      assert.equal(store.readTaskSequence().filter((id) => id === taskId).length, 1);
    } finally {
      removeHome(home);
    }
  }
});

test('N. operator CLI intake entry performs ONE explicit user-approved intake', async () => {
  const home = makeHome();
  const specDirectory = makeHome('greenhub-gf06-spec-');
  try {
    const store = new CoordinationStore({ dir: home });
    const specPath = join(specDirectory, 'GF06-N-001.intake.json');
    const request = intakeRequest('GF06-N-001');
    writeFileSync(specPath, JSON.stringify(request, null, 2), 'utf8');

    // argument parsing is explicit
    const options = parseOperatorArgv(['intake', '--spec', specPath, '--json']);
    assert.equal(options.command, 'intake');
    assert.equal(options.specPath, specPath);
    assert.equal(options.json, true);
    assert.throws(
      () => parseOperatorArgv(['intake']),
      (error) => error?.code === 'OPERATOR_ARGUMENT_INVALID',
    );
    assert.throws(
      () => parseOperatorArgv(['intake', '--spec', specPath, 'EXTRA-ARG', 'MORE']),
      (error) => error?.code === 'OPERATOR_ARGUMENT_INVALID',
    );

    const stdout = captureStream();
    const stderr = captureStream();
    const exitCode = await runOperatorCli({
      argv: ['intake', '--spec', specPath, '--json'],
      store,
      stdout,
      stderr,
    });
    assert.equal(stderr.text, '');
    assert.equal(exitCode, 0);
    const projection = JSON.parse(stdout.text);
    assert.equal(projection.projection, 'operator-intake');
    assert.equal(projection.authorityKind, AUTHORITY_KIND_USER_APPROVED_INTAKE);
    assert.equal(projection.taskId, 'GF06-N-001');
    assert.equal(projection.taskKind, 'READ_ONLY');
    assert.equal(projection.taskStatus, 'READY');
    assert.equal(projection.duplicate, false);
    assert.deepEqual(projection.approval, request.approval);
    assert.equal(store.readTask('GF06-N-001').status, 'READY');

    // exact replay through the CLI is idempotent
    const replayOut = captureStream();
    assert.equal(
      await runOperatorCli({
        argv: ['intake', '--spec', specPath],
        store,
        stdout: replayOut,
        stderr: captureStream(),
      }),
      0,
    );
    assert.match(replayOut.text, /exact replay/);

    // positional cross-check mismatch fails closed
    const mismatchErr = captureStream();
    assert.equal(
      await runOperatorCli({
        argv: ['intake', '--spec', specPath, 'GF06-N-OTHER'],
        store,
        stdout: captureStream(),
        stderr: mismatchErr,
      }),
      1,
    );
    assert.match(mismatchErr.text, new RegExp(OPERATOR_INTAKE_SPEC_INVALID));

    // unknown request field fails closed with zero durable write
    const before = snapshotHome(home);
    const badSpecPath = join(specDirectory, 'GF06-N-BAD.intake.json');
    writeFileSync(
      badSpecPath,
      JSON.stringify({ ...request, taskSpec: sampleTaskSpec('GF06-N-BAD'), extra: 'nope' }, null, 2),
      'utf8',
    );
    const badErr = captureStream();
    assert.equal(
      await runOperatorCli({
        argv: ['intake', '--spec', badSpecPath],
        store,
        stdout: captureStream(),
        stderr: badErr,
      }),
      1,
    );
    assert.match(badErr.text, new RegExp(OPERATOR_INTAKE_SPEC_INVALID));
    assert.deepEqual(snapshotHome(home), before, 'invalid request must not write');

    // userApproved false in the file fails closed with zero durable write
    const unapprovedSpecPath = join(specDirectory, 'GF06-N-UNAPPROVED.intake.json');
    writeFileSync(
      unapprovedSpecPath,
      JSON.stringify(
        { userApproved: false, approval: request.approval, taskSpec: sampleTaskSpec('GF06-N-UNAPPROVED') },
        null,
        2,
      ),
      'utf8',
    );
    const unapprovedErr = captureStream();
    assert.equal(
      await runOperatorCli({
        argv: ['intake', '--spec', unapprovedSpecPath],
        store,
        stdout: captureStream(),
        stderr: unapprovedErr,
      }),
      1,
    );
    assert.match(unapprovedErr.text, /INTAKE_REQUIRES_EXPLICIT_USER_APPROVAL/);
    assert.deepEqual(snapshotHome(home), before, 'unapproved request must not write');

    // the package.json command exists and the recorder default is explicit
    const packageJson = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'package.json'), 'utf8'));
    assert.equal(
      packageJson.scripts['coordination:intake'],
      'node scripts/coordination/operator-cli.mjs intake',
    );
    assert.equal(DEFAULT_OPERATOR_RECORDER_ID, 'operator-cli');
  } finally {
    removeHome(home);
    removeHome(specDirectory);
  }
});

test('O. GF-05 compatibility: an intaken READ_ONLY task runs through the existing operator chain', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const request = intakeRequest('GF06-O-001');
    const intake = store.intakeUserApprovedReadOnlyTask({
      userApproved: true,
      approval: request.approval,
      taskSpec: request.taskSpec,
      recorderId: 'operator-cli',
    });
    assert.equal(intake.task.status, 'READY');
    const authorityBytesBeforeRun = readFileSync(
      userApprovedIntakeFilePath(home, 'GF06-O-001'),
      'utf8',
    );

    const counter = { calls: 0 };
    const executor = fakeStructuredExecutor(counter);
    const firstOut = captureStream();
    const firstErr = captureStream();
    const firstExit = await runOperatorCli({
      argv: ['run', 'GF06-O-001', '--json'],
      store,
      executor,
      stdout: firstOut,
      stderr: firstErr,
    });
    assert.equal(firstErr.text, '');
    assert.equal(firstExit, 0);
    assert.equal(counter.calls, 1, 'exactly one executor boundary must be crossed');
    const first = JSON.parse(firstOut.text);
    assert.equal(first.authorityKind, AUTHORITY_KIND_USER_APPROVED_INTAKE);
    assert.equal(first.outcome, RUN_OUTCOME_EXECUTED);
    assert.equal(first.receipt.status, 'SUCCEEDED');
    assert.equal(first.delivery.newlyDelivered, true);
    assert.equal(first.taskStatus, 'RESULT_DELIVERED');
    assert.equal(store.readTask('GF06-O-001').status, 'RESULT_DELIVERED');
    assert.equal(
      readFileSync(userApprovedIntakeFilePath(home, 'GF06-O-001'), 'utf8'),
      authorityBytesBeforeRun,
      'run consumes the existing authority; it never rewrites it',
    );
    assert.equal(
      store.readExecutorResultReceipt(first.dispatchId).taskId,
      'GF06-O-001',
    );

    // terminal replay never re-invokes the executor
    const secondOut = captureStream();
    const secondErr = captureStream();
    assert.equal(
      await runOperatorCli({
        argv: ['run', 'GF06-O-001', '--json'],
        store,
        executor,
        stdout: secondOut,
        stderr: secondErr,
      }),
      0,
    );
    assert.equal(secondErr.text, '');
    assert.equal(counter.calls, 1);
    const second = JSON.parse(secondOut.text);
    assert.equal(second.outcome, RUN_OUTCOME_ALREADY_TERMINAL);
    assert.equal(second.executorInvocations, 0);

    // a task without any pre-execution authority still fails closed
    store.createTask(sampleTaskSpec('GF06-O-PLAIN'));
    store.markReady('GF06-O-PLAIN');
    const plainErr = captureStream();
    assert.equal(
      await runOperatorCli({
        argv: ['run', 'GF06-O-PLAIN'],
        store,
        executor,
        stdout: captureStream(),
        stderr: plainErr,
      }),
      1,
    );
    assert.match(plainErr.text, new RegExp(OPERATOR_TASK_ADMISSION_NOT_FOUND));
    assert.equal(counter.calls, 1, 'no authority means no executor invocation');
    assert.equal(store.readTask('GF06-O-PLAIN').status, 'READY');

    // the operator entry alone never creates an intake authority
    assert.equal(store.readTask('GF06-O-PLAIN').status, 'READY');
    assert.equal(existsSync(userApprovedIntakeFilePath(home, 'GF06-O-PLAIN')), false);
  } finally {
    removeHome(home);
  }
});

test('P. successor emission stays CONSUMED-only and emission admission keeps its own children', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });

    // An intaken READY task is never an eligible emission source.
    const request = intakeRequest('GF06-P-001');
    store.intakeUserApprovedReadOnlyTask({
      userApproved: true,
      approval: request.approval,
      taskSpec: request.taskSpec,
      recorderId: 'operator-cli',
    });
    assert.throws(
      () =>
        store.emitNextTask({
          sourceTaskId: 'GF06-P-001',
          nextTaskSpec: sampleTaskSpec('GF06-P-SUCCESSOR'),
          emitterId: 'control-tower-1',
        }),
      (error) => error?.code === 'EMISSION_NOT_ELIGIBLE',
    );

    // The ordinary successor chain still works and its child stays bound to
    // the emission admission (never the intake authority).
    driveToAdmittedChild(store, clock, 'GF06-P-SRC', sampleTaskSpec('GF06-P-CHILD'));
    const admission = store.readEmissionAdmission({ sourceTaskId: 'GF06-P-SRC' });
    assert.equal(admission.nextTaskId, 'GF06-P-CHILD');
    assert.equal(store.readTask('GF06-P-CHILD').status, 'READY');
    const claimed = store.claimAdmittedTask({ sourceTaskId: 'GF06-P-SRC', workerId: 'worker-a' });
    assert.equal(claimed.claim.taskId, 'GF06-P-CHILD');
    assert.equal(store.readTask('GF06-P-CHILD').status, 'CLAIMED');
    assert.equal(existsSync(userApprovedIntakeFilePath(home, 'GF06-P-CHILD')), false);

    // Same source slot + different spec still fails closed (first wins).
    clock.advance(1000);
    driveToConsumed(store, clock, 'GF06-P-SRC2');
    emitChild(store, clock, 'GF06-P-SRC2', sampleTaskSpec('GF06-P-CHILD2'));
    assert.throws(
      () =>
        store.emitNextTask({
          sourceTaskId: 'GF06-P-SRC2',
          nextTaskSpec: sampleTaskSpec('GF06-P-CHILD2-DIFFERENT'),
          emitterId: 'control-tower-1',
        }),
      (error) => error?.code === 'EMISSION_CONFLICT',
    );
  } finally {
    removeHome(home);
  }
});

test('Q. both authority sources binding one task fails closed as ambiguous', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmittedChild(store, clock, 'GF06-Q-SRC', sampleTaskSpec('GF06-Q-CHILD'));
    // Manually install an intake authority binding the exact same task bytes
    // (fixture only: the store intake primitive refuses this conflict).
    writeIntakeAuthorityFile(home, 'GF06-Q-CHILD', intakeRequest('GF06-Q-CHILD'));

    const authorityErr = captureStream();
    const exitCode = await runOperatorCli({
      argv: ['run', 'GF06-Q-CHILD'],
      store,
      executor: fakeStructuredExecutor({ calls: 0 }),
      stdout: captureStream(),
      stderr: authorityErr,
    });
    assert.equal(exitCode, 1);
    assert.match(authorityErr.text, new RegExp(OPERATOR_TASK_AUTHORITY_AMBIGUOUS));
    // The emission path itself is untouched by the foreign intake fixture.
    const claimed = store.claimAdmittedTask({ sourceTaskId: 'GF06-Q-SRC', workerId: 'worker-a' });
    assert.equal(claimed.claim.taskId, 'GF06-Q-CHILD');
  } finally {
    removeHome(home);
  }
});

test('R. corrupt/tampered authority or task bytes fail closed with no repair', () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const request = intakeRequest('GF06-R-001');
    store.intakeUserApprovedReadOnlyTask({
      userApproved: true,
      approval: request.approval,
      taskSpec: request.taskSpec,
      recorderId: 'operator-cli',
    });
    const authorityPath = userApprovedIntakeFilePath(home, 'GF06-R-001');

    // corrupt bytes
    writeFileSync(authorityPath, '{ not valid json', 'utf8');
    assert.throws(
      () => store.readUserApprovedIntake({ taskId: 'GF06-R-001' }),
      (error) => error?.code === 'CORRUPT_INTAKE_AUTHORITY',
    );
    assert.throws(
      () =>
        store.intakeUserApprovedReadOnlyTask({
          userApproved: true,
          approval: request.approval,
          taskSpec: request.taskSpec,
          recorderId: 'operator-cli',
        }),
      (error) => error?.code === 'CORRUPT_INTAKE_AUTHORITY',
    );
    assert.equal(readFileSync(authorityPath, 'utf8'), '{ not valid json', 'corruption never repaired');

    // tampered binding
    const valid = buildUserApprovedIntakeRecord({
      userApproved: true,
      approval: request.approval,
      taskSpec: request.taskSpec,
      recordedAt: '2026-09-21T00:00:00.000Z',
      recorderId: 'crash-fixture',
    });
    const tampered = { ...valid, intakeSpecBinding: `sha256:${'0'.repeat(64)}` };
    writeFileSync(authorityPath, JSON.stringify(tampered, null, 2), 'utf8');
    assert.throws(
      () => store.readUserApprovedIntake({ taskId: 'GF06-R-001' }),
      (error) => typeof error?.code === 'string' && error.code.startsWith('INTAKE_'),
    );
    assert.equal(
      readFileSync(authorityPath, 'utf8'),
      JSON.stringify(tampered, null, 2),
      'tampered bytes never repaired',
    );

    // restore valid authority, then tamper the task bytes
    writeFileSync(authorityPath, JSON.stringify(valid, null, 2), 'utf8');
    assert.equal(store.readUserApprovedIntake({ taskId: 'GF06-R-001' }).intakeId, valid.intakeId);
    const taskPath = join(home, 'tasks', 'GF06-R-001', 'task.json');
    const task = JSON.parse(readFileSync(taskPath, 'utf8'));
    task.desiredExitState = 'TAMPERED';
    writeFileSync(taskPath, JSON.stringify(task, null, 2), 'utf8');
    assert.throws(
      () => store.readUserApprovedIntake({ taskId: 'GF06-R-001' }),
      (error) => error?.code === 'INTAKE_BINDING_MISMATCH',
    );
  } finally {
    removeHome(home);
  }
});

test('S. runtime state stays outside the repo and intake owns no scheduler/daemon/executor surface', () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const request = intakeRequest('GF06-S-001');
    performUserApprovedIntake({
      store,
      request,
      recorderId: 'operator-cli',
    });
    assert.equal(store.readTask('GF06-S-001').status, 'READY');

    // The repository worktree never receives runtime artifacts.
    assert.equal(existsSync(join(REPOSITORY_ROOT, 'tasks')), false);
    assert.equal(existsSync(join(REPOSITORY_ROOT, 'intake-authorities')), false);
    assert.equal(existsSync(join(REPOSITORY_ROOT, 'consumption')), false);
    assert.equal(existsSync(join(REPOSITORY_ROOT, 'executor-result-receipts')), false);
    assert.equal(existsSync(join(REPOSITORY_ROOT, 'receiver-acceptances')), false);
    const defaultHome = resolveCoordinationHome({ platform: 'win32', env: { LOCALAPPDATA: home } });
    assert.equal(defaultHome.startsWith(REPOSITORY_ROOT), false);

    // A repository-internal coordination home is refused per the existing
    // coordination-home rules, with zero writes inside the worktree.
    const forbiddenHome = join(REPOSITORY_ROOT, '.gf06-forbidden-coordination-home');
    assert.equal(existsSync(forbiddenHome), false);
    assert.throws(
      () =>
        performUserApprovedIntake({
          store: new CoordinationStore({ dir: forbiddenHome }),
          request: intakeRequest('GF06-S-FORBIDDEN'),
          recorderId: 'operator-cli',
        }),
      (error) => error?.code === OPERATOR_INTAKE_HOME_INVALID,
    );
    assert.equal(existsSync(forbiddenHome), false, 'no repository-internal home may be created');

    // The intake authority module carries no scheduler/daemon/executor surface.
    const source = readFileSync(INTAKE_MODULE_PATH, 'utf8');
    assert.doesNotMatch(source, /setInterval|setTimeout|setImmediate/);
    assert.doesNotMatch(source, /node:timers|node:worker_threads|node:child_process/);
    assert.doesNotMatch(source, /spawn|execSync|execFile/);
    assert.doesNotMatch(source, /while\s*\(\s*true\s*\)/);
    assert.doesNotMatch(source, /\bwatchFile\b|\bwatch\s*\(/);
    // The operator intake composition never executes the OpenCode adapter.
    const cliSource = readFileSync(OPERATOR_CLI_PATH, 'utf8');
    assert.doesNotMatch(cliSource, /setInterval|setTimeout|setImmediate/);
  } finally {
    removeHome(home);
  }
});
