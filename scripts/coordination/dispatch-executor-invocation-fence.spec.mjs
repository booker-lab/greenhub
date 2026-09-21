// Proof for COORD-AUDIT-C03: executor invocation pre-boundary fencing /
// concurrent exactly-one invocation.
//
// Contract under proof:
//   P1  at most one process per dispatchId crosses the real adapter/executor
//       boundary, including simultaneous OS-process contenders
//   P2  contenders that did not obtain invocation authority never execute the
//       adapter/executor
//   P3  durable ACCEPTED / REJECTED / UNKNOWN invocation outcomes are terminal:
//       any restart performs zero executor boundary entries
//   P4  a durable structured result receipt is terminal: restart performs zero
//       executor boundary entries
//   P5  crash before the durable fence publication (boundary definitely not
//       crossed) is recoverable without duplicating an invocation
//   P6  crash around/after invocation with no durable evidence fails closed:
//       zero automatic reinvocation, zero durable writes, no time-based retry
//   P7  the durable fence is immutable, dispatchId-keyed, exact-shape, and
//       fail-closed; an invalid executor never poisons the one-way fence
//
// All runtime state lives in isolated temp directories. No network required.
// The boundary-entry counter is instrumented inside the fake executor itself,
// which sits exactly at the Task 29 adapter seam; multi-process entry counts
// are recorded as exclusive files in a shared gate directory.
//
// Pre-fix reproduction evidence (same multi-process construction, before this
// task's change, through the exact operator composition executeOperatorTask):
//   2 processes -> 2 executor boundary entries; 4 processes -> 4 entries; no
//   durable invocation outcome was ever produced. Post-fix the same
//   construction yields exactly one entry.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { persistExecutorInvocationAttempt } from './dispatch-executor-invocation-attempt.mjs';
import {
  CORRUPT_EXECUTOR_INVOCATION_FENCE,
  EXECUTOR_INVOCATION_FENCE_RUN_FIELDS,
  EXECUTOR_INVOCATION_FENCE_SCHEMA_VERSION,
  EXECUTOR_INVOCATION_FENCE_UNCERTAIN,
  executorInvocationFenceFilePath,
  invokeExecutorWithInvocationFence,
} from './dispatch-executor-invocation-fence.mjs';
import {
  EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
  EXECUTOR_INVOCATION_OUTCOME_REJECTED,
  EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION,
  EXECUTOR_INVOCATION_OUTCOME_UNKNOWN,
} from './dispatch-executor-invocation-outcome.mjs';
import { acceptReceiverDispatch } from './dispatch-receiver-acceptance.mjs';
import { prepareDispatchTransportRequest } from './dispatch-transport-contract.mjs';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import {
  executeOperatorTask,
  RUN_OUTCOME_EXECUTED,
  RUN_OUTCOME_EXECUTOR_REJECTED,
  RUN_OUTCOME_EXECUTOR_UNKNOWN,
} from './operator-cli.mjs';
import { CoordinationStore } from './store.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const FENCE_MODULE_PATH = join(MODULE_DIRECTORY, 'dispatch-executor-invocation-fence.mjs');
const OPERATOR_MODULE_PATH = join(MODULE_DIRECTORY, 'operator-cli.mjs');
const STORE_MODULE_PATH = join(MODULE_DIRECTORY, 'store.mjs');
const STORE_MODULE_URL = pathToFileURL(STORE_MODULE_PATH).href;
const OPERATOR_MODULE_URL = pathToFileURL(OPERATOR_MODULE_PATH).href;

const OPERATOR_WORKER_ID = 'operator-cli';
const OPERATOR_LEASE_MS = 900_000;
const FENCE_DIRNAME = 'executor-invocation-fences';

function makeHome(prefix = 'greenhub-c03-fence-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'READ_ONLY',
    desiredExitState: 'C03_FENCED_EXACTLY_ONE_INVOCATION',
    policyRefs: ['policy:c03'],
    evidenceRefs: ['evidence:c03'],
    contextRefs: ['context:c03'],
    authorityRequirement: { liveMainHint: null, requiredPolicies: ['AGENTS.md'] },
    ownedSurface: ['scripts/coordination/'],
    mutationBoundary: { allowsWrite: false, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['c03-fence-proof'],
    ...overrides,
  };
}

function sampleMutationTaskInput(taskId, overrides = {}) {
  return {
    ...sampleTaskInput(taskId),
    taskKind: 'BOUNDED_MUTATION',
    mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
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
  store.createTask(sampleMutationTaskInput(taskId));
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

/**
 * Drive the EXISTING operator chain up to (and including) the durable Task 28
 * invocation attempt, WITHOUT crossing the executor boundary. Returns the exact
 * claim-bound dispatchId the fenced entry must own.
 */
async function driveToInvocationAttempt({
  store,
  sourceTaskId,
  childTaskId,
  persistInvocationAttempt = true,
}) {
  const claimed = store.claimAdmittedTask({
    sourceTaskId,
    emissionSlot: 'next',
    workerId: OPERATOR_WORKER_ID,
    leaseDurationMs: OPERATOR_LEASE_MS,
  });
  assert.equal(claimed.claim.taskId, childTaskId, 'claim must bind the named child task');
  const attempt = store.persistDispatchAttempt({
    sourceTaskId,
    emissionSlot: 'next',
    workerId: OPERATOR_WORKER_ID,
  });
  const dispatchId = attempt.dispatchId;
  const request = await prepareDispatchTransportRequest({ store, sourceTaskId, dispatchId });
  await acceptReceiverDispatch({ request, store });
  if (persistInvocationAttempt) {
    await persistExecutorInvocationAttempt({ dispatchId, store });
  }
  return { claim: claimed.claim, dispatchId };
}

function structuredPayload(taskId, overrides = {}) {
  return {
    taskId,
    status: 'SUCCEEDED',
    summary: 'read-only fenced invocation completed',
    proofRefs: ['proof:c03-fence'],
    evidenceRefs: ['evidence:c03-fence'],
    frictionObserved: ['NONE'],
    ...overrides,
  };
}

function fakeStructuredExecutor(counter, outcomes = {}) {
  return async function fakeExecutor(task28Record) {
    counter.calls += 1;
    if (typeof outcomes.onCall === 'function') await outcomes.onCall(counter.calls, task28Record);
    const outcome = outcomes.outcome ?? EXECUTOR_INVOCATION_OUTCOME_ACCEPTED;
    if (outcome !== EXECUTOR_INVOCATION_OUTCOME_ACCEPTED) {
      return { schemaVersion: 1, dispatchId: task28Record.dispatchId, outcome, result: null };
    }
    return {
      schemaVersion: 1,
      dispatchId: task28Record.dispatchId,
      outcome: EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
      result: structuredPayload(task28Record.decisionInput.task.taskId, outcomes.resultOverrides),
    };
  };
}

function validReceipt(dispatchId, taskId, overrides = {}) {
  return {
    schemaVersion: 1,
    dispatchId,
    taskId,
    status: 'SUCCEEDED',
    summary: 'read-only fenced invocation completed',
    proofRefs: ['proof:c03-fence'],
    evidenceRefs: ['evidence:c03-fence'],
    frictionObserved: ['NONE'],
    ...overrides,
  };
}

function outcomeRecord(dispatchId, outcome) {
  return { schemaVersion: EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION, dispatchId, outcome };
}

function fenceRecord(dispatchId) {
  return { schemaVersion: EXECUTOR_INVOCATION_FENCE_SCHEMA_VERSION, dispatchId };
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

function codeOnly(source) {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    })
    .join('\n');
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForFile(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await delay(5);
  }
  return false;
}

function runChildProcess({ code, env = {}, preloadUrl = null }) {
  const args = preloadUrl
    ? ['--import', preloadUrl, '--input-type=module', '-e', code]
    : ['--input-type=module', '-e', code];
  const child = spawn(process.execPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, ...env },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exitPromise = new Promise((resolveResult, rejectResult) => {
    child.once('error', rejectResult);
    child.once('close', (exitCode) => {
      const line = stdout
        .split('\n')
        .reverse()
        .find((entry) => entry.trim().length > 0);
      resolveResult({
        exitCode,
        stdout,
        stderr,
        parsed: line ? JSON.parse(line) : null,
      });
    });
  });
  return { child, exitPromise };
}

// ---------------------------------------------------------------------------
// A. single invocation normal path
// ---------------------------------------------------------------------------

test('A. one operator run crosses the executor boundary exactly once and persists fence, outcome, and receipt', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmittedChild(store, clock, 'C03F-SRC-A001', sampleTaskInput('C03F-CHILD-A001'));
    const counter = { calls: 0 };

    const projection = await executeOperatorTask({
      store,
      taskId: 'C03F-CHILD-A001',
      sourceTaskId: 'C03F-SRC-A001',
      workerId: OPERATOR_WORKER_ID,
      leaseDurationMs: OPERATOR_LEASE_MS,
      executor: fakeStructuredExecutor(counter),
    });

    assert.equal(counter.calls, 1, 'exactly one executor boundary entry');
    assert.equal(projection.executorInvocations, 1);
    assert.equal(projection.outcome, RUN_OUTCOME_EXECUTED);
    assert.equal(projection.executorOutcome, EXECUTOR_INVOCATION_OUTCOME_ACCEPTED);
    assert.equal(projection.receipt.status, 'SUCCEEDED');
    assert.equal(projection.taskStatus, 'RESULT_DELIVERED');

    const dispatchId = projection.dispatchId;
    assert.deepEqual(store.readExecutorInvocationFence(dispatchId), fenceRecord(dispatchId));
    assert.deepEqual(
      store.readExecutorInvocationOutcome(dispatchId),
      outcomeRecord(dispatchId, EXECUTOR_INVOCATION_OUTCOME_ACCEPTED),
    );
    assert.equal(store.readExecutorResultReceipt(dispatchId).status, 'SUCCEEDED');

    // Invocation-stage replay: the fence winner is permanent authority.
    const replayCounter = { calls: 0 };
    const replay = await invokeExecutorWithInvocationFence({
      dispatchId,
      store,
      executor: fakeStructuredExecutor(replayCounter),
    });
    assert.equal(replayCounter.calls, 0, 'replay performs zero executor boundary entries');
    assert.equal(replay.executorInvoked, false);
    assert.equal(replay.exactReplay, true);
    assert.equal(replay.outcome, EXECUTOR_INVOCATION_OUTCOME_ACCEPTED);
    assert.equal(replay.receipt.status, 'SUCCEEDED');
    assert.deepEqual(Object.keys(replay), [...EXECUTOR_INVOCATION_FENCE_RUN_FIELDS]);
    assert.equal(Object.isFrozen(replay), true);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// B/C/D. durable outcome replay (ACCEPTED / REJECTED / UNKNOWN)
// ---------------------------------------------------------------------------

test('B. a durable ACCEPTED invocation outcome replays with zero executor boundary entries', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmittedChild(store, clock, 'C03F-SRC-B001', sampleTaskInput('C03F-CHILD-B001'));
    const { dispatchId } = await driveToInvocationAttempt({
      store,
      sourceTaskId: 'C03F-SRC-B001',
      childTaskId: 'C03F-CHILD-B001',
    });
    store.createExecutorInvocationOutcome(
      outcomeRecord(dispatchId, EXECUTOR_INVOCATION_OUTCOME_ACCEPTED),
    );
    const before = snapshotHome(home);
    const counter = { calls: 0 };

    const replayed = await invokeExecutorWithInvocationFence({
      dispatchId,
      store,
      executor: fakeStructuredExecutor(counter),
    });

    assert.equal(counter.calls, 0);
    assert.equal(replayed.outcome, EXECUTOR_INVOCATION_OUTCOME_ACCEPTED);
    assert.equal(replayed.executorInvoked, false);
    assert.equal(replayed.exactReplay, true);
    assert.equal(replayed.receipt, null);
    assert.equal(store.readExecutorInvocationFence(dispatchId), null, 'replay never fences');
    assert.deepEqual(snapshotHome(home), before, 'replay writes zero durable bytes');
  } finally {
    removeHome(home);
  }
});

test('C. a durable REJECTED invocation outcome replays and an operator restart never re-invokes', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmittedChild(store, clock, 'C03F-SRC-C001', sampleTaskInput('C03F-CHILD-C001'));
    const counter = { calls: 0 };

    const first = await executeOperatorTask({
      store,
      taskId: 'C03F-CHILD-C001',
      sourceTaskId: 'C03F-SRC-C001',
      workerId: OPERATOR_WORKER_ID,
      leaseDurationMs: OPERATOR_LEASE_MS,
      executor: fakeStructuredExecutor(counter, {
        outcome: EXECUTOR_INVOCATION_OUTCOME_REJECTED,
      }),
    });
    assert.equal(counter.calls, 1);
    assert.equal(first.outcome, RUN_OUTCOME_EXECUTOR_REJECTED);
    assert.equal(first.receipt, null);
    assert.equal(first.taskStatus, 'CLAIMED');
    assert.deepEqual(
      store.readExecutorInvocationOutcome(first.dispatchId),
      outcomeRecord(first.dispatchId, EXECUTOR_INVOCATION_OUTCOME_REJECTED),
    );

    const before = snapshotHome(home);
    const second = await executeOperatorTask({
      store,
      taskId: 'C03F-CHILD-C001',
      sourceTaskId: 'C03F-SRC-C001',
      workerId: OPERATOR_WORKER_ID,
      leaseDurationMs: OPERATOR_LEASE_MS,
      executor: fakeStructuredExecutor(counter),
    });
    assert.equal(counter.calls, 1, 'REJECTED is terminal: restart performs zero boundary entries');
    assert.equal(second.outcome, RUN_OUTCOME_EXECUTOR_REJECTED);
    assert.equal(second.executorInvocations, 0);
    assert.equal(second.receipt, null);
    assert.deepEqual(snapshotHome(home), before, 'terminal replay writes zero durable bytes');
  } finally {
    removeHome(home);
  }
});

test('D. a durable UNKNOWN invocation outcome is never retry permission (zero executor boundary entries)', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmittedChild(store, clock, 'C03F-SRC-D001', sampleTaskInput('C03F-CHILD-D001'));
    const counter = { calls: 0 };

    const first = await executeOperatorTask({
      store,
      taskId: 'C03F-CHILD-D001',
      sourceTaskId: 'C03F-SRC-D001',
      workerId: OPERATOR_WORKER_ID,
      leaseDurationMs: OPERATOR_LEASE_MS,
      executor: fakeStructuredExecutor(counter, {
        outcome: EXECUTOR_INVOCATION_OUTCOME_UNKNOWN,
      }),
    });
    assert.equal(counter.calls, 1);
    assert.equal(first.outcome, RUN_OUTCOME_EXECUTOR_UNKNOWN);
    assert.equal(first.receipt, null);
    assert.deepEqual(
      store.readExecutorInvocationOutcome(first.dispatchId),
      outcomeRecord(first.dispatchId, EXECUTOR_INVOCATION_OUTCOME_UNKNOWN),
    );

    const before = snapshotHome(home);
    const second = await executeOperatorTask({
      store,
      taskId: 'C03F-CHILD-D001',
      sourceTaskId: 'C03F-SRC-D001',
      workerId: OPERATOR_WORKER_ID,
      leaseDurationMs: OPERATOR_LEASE_MS,
      executor: fakeStructuredExecutor(counter),
    });
    assert.equal(counter.calls, 1, 'UNKNOWN is terminal: restart performs zero boundary entries');
    assert.equal(second.outcome, RUN_OUTCOME_EXECUTOR_UNKNOWN);
    assert.equal(second.executorInvocations, 0);
    assert.deepEqual(snapshotHome(home), before, 'UNKNOWN replay writes zero durable bytes');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. durable structured result receipt replay
// ---------------------------------------------------------------------------

test('E. an existing durable result receipt replays with zero executor boundary entries', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmittedChild(store, clock, 'C03F-SRC-E001', sampleTaskInput('C03F-CHILD-E001'));
    const { dispatchId } = await driveToInvocationAttempt({
      store,
      sourceTaskId: 'C03F-SRC-E001',
      childTaskId: 'C03F-CHILD-E001',
    });
    store.createExecutorResultReceipt(validReceipt(dispatchId, 'C03F-CHILD-E001'));
    const before = snapshotHome(home);
    const counter = { calls: 0 };

    const replayed = await invokeExecutorWithInvocationFence({
      dispatchId,
      store,
      executor: fakeStructuredExecutor(counter),
    });

    assert.equal(counter.calls, 0);
    assert.equal(replayed.outcome, EXECUTOR_INVOCATION_OUTCOME_ACCEPTED);
    assert.equal(replayed.executorInvoked, false);
    assert.equal(replayed.exactReplay, true);
    assert.equal(replayed.receipt.taskId, 'C03F-CHILD-E001');
    assert.equal(store.readExecutorInvocationFence(dispatchId), null, 'replay never fences');
    assert.deepEqual(snapshotHome(home), before, 'replay writes zero durable bytes');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. fenced boundary without durable evidence fails closed
// ---------------------------------------------------------------------------

test('F. a fence without durable evidence fails closed with zero boundary entries and zero writes', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmittedChild(store, clock, 'C03F-SRC-F001', sampleTaskInput('C03F-CHILD-F001'));
    const { dispatchId } = await driveToInvocationAttempt({
      store,
      sourceTaskId: 'C03F-SRC-F001',
      childTaskId: 'C03F-CHILD-F001',
    });
    assert.deepEqual(store.createExecutorInvocationFence(fenceRecord(dispatchId)), {
      created: true,
    });
    const before = snapshotHome(home);
    const counter = { calls: 0 };

    await assert.rejects(
      invokeExecutorWithInvocationFence({
        dispatchId,
        store,
        executor: fakeStructuredExecutor(counter),
      }),
      (error) => error?.code === EXECUTOR_INVOCATION_FENCE_UNCERTAIN,
    );

    assert.equal(counter.calls, 0, 'uncertain boundary never executes the adapter');
    assert.equal(store.readExecutorInvocationOutcome(dispatchId), null);
    assert.equal(store.readExecutorResultReceipt(dispatchId), null);
    assert.deepEqual(snapshotHome(home), before, 'fail-closed path writes zero durable bytes');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// G/H. simultaneous OS-process races (2 and 4 contenders)
// ---------------------------------------------------------------------------

function raceChildCode({ home, gateDir, label, sourceTaskId, childTaskId }) {
  return [
    'try {',
    `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
    `  const { executeOperatorTask } = await import(${JSON.stringify(OPERATOR_MODULE_URL)});`,
    "  const fs = await import('node:fs');",
    `  const gateDir = ${JSON.stringify(gateDir)};`,
    `  const label = ${JSON.stringify(label)};`,
    '  const executor = async (record) => {',
    "    fs.writeFileSync(`${gateDir}/entered-${label}`, 'entered', 'utf8');",
    '    const deadline = Date.now() + 60000;',
    '    while (!fs.existsSync(`${gateDir}/go-${label}`) && Date.now() < deadline) {',
    '      await new Promise((resolve) => setTimeout(resolve, 5));',
    '    }',
    '    return {',
    '      schemaVersion: 1,',
    '      dispatchId: record.dispatchId,',
    "      outcome: 'ACCEPTED',",
    '      result: {',
    '        taskId: record.decisionInput.task.taskId,',
    "        status: 'SUCCEEDED',",
    "        summary: 'race executor output',",
    "        proofRefs: ['proof:c03-race'],",
    "        evidenceRefs: ['evidence:c03-race'],",
    "        frictionObserved: ['NONE'],",
    '      },',
    '    };',
    '  };',
    `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
    '  try {',
    '    const projection = await executeOperatorTask({',
    `      store, taskId: ${JSON.stringify(childTaskId)}, sourceTaskId: ${JSON.stringify(sourceTaskId)},`,
    `      workerId: ${JSON.stringify(OPERATOR_WORKER_ID)}, leaseDurationMs: ${OPERATOR_LEASE_MS}, executor,`,
    '    });',
    '    console.log(JSON.stringify({ ok: true, label, outcome: projection.outcome, executorInvocations: projection.executorInvocations, dispatchId: projection.dispatchId }));',
    '  } catch (error) {',
    '    console.log(JSON.stringify({ ok: false, label, code: error?.code ?? null, message: String(error?.message ?? error) }));',
    '  }',
    '} catch (error) {',
    "  console.log(JSON.stringify({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error), stage: 'bootstrap' }));",
    '}',
  ].join('\n');
}

test('G. two simultaneous OS processes racing one dispatchId cross the executor boundary exactly once', async () => {
  const home = makeHome();
  try {
    const gateDir = join(home, 'gate');
    mkdirSync(gateDir, { recursive: true });
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmittedChild(store, clock, 'C03F-SRC-G001', sampleTaskInput('C03F-CHILD-G001'));

    const labels = ['A', 'B'];
    const children = labels.map((label) => {
      const { exitPromise } = runChildProcess({
        code: raceChildCode({
          home,
          gateDir,
          label,
          sourceTaskId: 'C03F-SRC-G001',
          childTaskId: 'C03F-CHILD-G001',
        }),
      });
      return { label, exitPromise };
    });
    const settled = new Set();
    for (const child of children) {
      child.exitPromise.then(
        () => settled.add(child.label),
        () => settled.add(child.label),
      );
    }
    const deadline = Date.now() + 60_000;
    for (;;) {
      const enteredNow = readdirSync(gateDir).filter((name) => name.startsWith('entered-')).length;
      if (enteredNow + settled.size >= labels.length) break;
      if (Date.now() >= deadline) throw new Error('race scenario never settled');
      await delay(5);
    }

    const entered = readdirSync(gateDir).filter((name) => name.startsWith('entered-'));
    assert.equal(entered.length, 1, 'exactly one process may cross the executor boundary');
    for (const name of entered) {
      writeFileSync(join(gateDir, `go-${name.slice('entered-'.length)}`), 'go', 'utf8');
    }
    const results = (await Promise.all(children.map((child) => child.exitPromise))).map(
      (result) => result.parsed,
    );
    const winners = results.filter((entry) => entry.ok === true);
    const losers = results.filter((entry) => entry.ok === false);
    assert.equal(winners.length, 1);
    assert.equal(winners[0].executorInvocations, 1);
    assert.equal(winners[0].outcome, RUN_OUTCOME_EXECUTED);
    assert.equal(losers.length, 1);
    assert.equal(losers[0].code, EXECUTOR_INVOCATION_FENCE_UNCERTAIN);

    const dispatchId = winners[0].dispatchId;
    assert.deepEqual(store.readExecutorInvocationFence(dispatchId), fenceRecord(dispatchId));
    assert.equal(
      store.readExecutorInvocationOutcome(dispatchId).outcome,
      EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
    );
    assert.equal(store.readExecutorResultReceipt(dispatchId).status, 'SUCCEEDED');
  } finally {
    removeHome(home);
  }
});

test('H. four simultaneous OS processes racing one dispatchId cross the executor boundary exactly once', async () => {
  const home = makeHome();
  try {
    const gateDir = join(home, 'gate');
    mkdirSync(gateDir, { recursive: true });
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmittedChild(store, clock, 'C03F-SRC-H001', sampleTaskInput('C03F-CHILD-H001'));

    const labels = ['A', 'B', 'C', 'D'];
    const children = labels.map((label) => {
      const { exitPromise } = runChildProcess({
        code: raceChildCode({
          home,
          gateDir,
          label,
          sourceTaskId: 'C03F-SRC-H001',
          childTaskId: 'C03F-CHILD-H001',
        }),
      });
      return { label, exitPromise };
    });
    const settled = new Set();
    for (const child of children) {
      child.exitPromise.then(
        () => settled.add(child.label),
        () => settled.add(child.label),
      );
    }
    const deadline = Date.now() + 60_000;
    for (;;) {
      const enteredNow = readdirSync(gateDir).filter((name) => name.startsWith('entered-')).length;
      if (enteredNow + settled.size >= labels.length) break;
      if (Date.now() >= deadline) throw new Error('race scenario never settled');
      await delay(5);
    }

    const entered = readdirSync(gateDir).filter((name) => name.startsWith('entered-'));
    assert.equal(entered.length, 1, 'exactly one process may cross the executor boundary');
    for (const name of entered) {
      writeFileSync(join(gateDir, `go-${name.slice('entered-'.length)}`), 'go', 'utf8');
    }
    const results = (await Promise.all(children.map((child) => child.exitPromise))).map(
      (result) => result.parsed,
    );
    const winners = results.filter((entry) => entry.ok === true);
    const losers = results.filter((entry) => entry.ok === false);
    assert.equal(winners.length, 1);
    assert.equal(winners[0].executorInvocations, 1);
    assert.equal(losers.length, 3);
    for (const loser of losers) {
      assert.equal(loser.code, EXECUTOR_INVOCATION_FENCE_UNCERTAIN);
    }

    const dispatchId = winners[0].dispatchId;
    assert.deepEqual(store.readExecutorInvocationFence(dispatchId), fenceRecord(dispatchId));
    assert.equal(
      store.readExecutorInvocationOutcome(dispatchId).outcome,
      EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
    );
    assert.equal(store.readExecutorResultReceipt(dispatchId).status, 'SUCCEEDED');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// I/J. crash contracts
// ---------------------------------------------------------------------------

function crashBeforeFencePreloadPath(home) {
  const preloadPath = join(home, 'c03-crash-before-fence-preload.mjs');
  const lines = [
    "import fs from 'node:fs';",
    'const fenceDirToken = process.env.GREENHUB_C03_FENCE_DIR_TOKEN;',
    'const markerPath = process.env.GREENHUB_C03_CRASH_MARKER;',
    'if (fenceDirToken && markerPath) {',
    '  const originalLinkSync = fs.linkSync;',
    '  fs.linkSync = (target, linkPath, ...rest) => {',
    '    if (typeof linkPath === "string" && linkPath.includes(fenceDirToken)) {',
    '      fs.writeFileSync(markerPath, "crash-before-fence-publication", "utf8");',
    '      process.exit(70);',
    '    }',
    '    return originalLinkSync(target, linkPath, ...rest);',
    '  };',
    '}',
  ];
  writeFileSync(preloadPath, lines.join('\n'), 'utf8');
  return pathToFileURL(preloadPath).href;
}

test('I. crash before the durable fence publication is recoverable without duplicating the invocation', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmittedChild(store, clock, 'C03F-SRC-I001', sampleTaskInput('C03F-CHILD-I001'));
    const preloadUrl = crashBeforeFencePreloadPath(home);
    const markerPath = join(home, 'crash-marker-I');

    const gateDir = join(home, 'gate-I');
    mkdirSync(gateDir, { recursive: true });
    const crashing = runChildProcess({
      preloadUrl,
      env: { GREENHUB_C03_FENCE_DIR_TOKEN: FENCE_DIRNAME, GREENHUB_C03_CRASH_MARKER: markerPath },
      code: raceChildCode({
        home,
        gateDir,
        label: 'A',
        sourceTaskId: 'C03F-SRC-I001',
        childTaskId: 'C03F-CHILD-I001',
      }),
    });
    const crashed = await crashing.exitPromise;
    assert.equal(crashed.exitCode, 70, 'test child must crash at the fence publication');
    assert.equal(existsSync(markerPath), true, 'crash occurred exactly at fence publication');
    assert.equal(existsSync(join(home, 'gate-I', 'entered-A')), false, 'adapter was never entered');

    const dispatchId = store.readClaimBoundDispatchEnvelope({
      sourceTaskId: 'C03F-SRC-I001',
      emissionSlot: 'next',
      workerId: OPERATOR_WORKER_ID,
    }).dispatchId;
    assert.equal(store.readExecutorInvocationFence(dispatchId), null, 'no fence was published');
    assert.equal(store.readExecutorInvocationOutcome(dispatchId), null);
    assert.equal(store.readExecutorResultReceipt(dispatchId), null);

    const counter = { calls: 0 };
    const recovery = await executeOperatorTask({
      store,
      taskId: 'C03F-CHILD-I001',
      sourceTaskId: 'C03F-SRC-I001',
      workerId: OPERATOR_WORKER_ID,
      leaseDurationMs: OPERATOR_LEASE_MS,
      executor: fakeStructuredExecutor(counter),
    });
    assert.equal(counter.calls, 1, 'recovery crosses the boundary exactly once in total');
    assert.equal(recovery.outcome, RUN_OUTCOME_EXECUTED);
    assert.equal(recovery.executorInvocations, 1);
    assert.deepEqual(store.readExecutorInvocationFence(dispatchId), fenceRecord(dispatchId));
    assert.equal(
      store.readExecutorInvocationOutcome(dispatchId).outcome,
      EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
    );
    assert.equal(store.readExecutorResultReceipt(dispatchId).status, 'SUCCEEDED');
    assert.equal(store.readTask('C03F-CHILD-I001').status, 'RESULT_DELIVERED');
  } finally {
    removeHome(home);
  }
});

function crashInsideExecutorCode({ home, gateDir, label, sourceTaskId, childTaskId }) {
  return [
    'try {',
    `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
    `  const { executeOperatorTask } = await import(${JSON.stringify(OPERATOR_MODULE_URL)});`,
    "  const fs = await import('node:fs');",
    `  const gateDir = ${JSON.stringify(gateDir)};`,
    `  const label = ${JSON.stringify(label)};`,
    '  const executor = async () => {',
    "    fs.writeFileSync(`${gateDir}/entered-${label}`, 'entered', 'utf8');",
    '    process.exit(70);',
    '  };',
    `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
    '  await executeOperatorTask({',
    `    store, taskId: ${JSON.stringify(childTaskId)}, sourceTaskId: ${JSON.stringify(sourceTaskId)},`,
    `    workerId: ${JSON.stringify(OPERATOR_WORKER_ID)}, leaseDurationMs: ${OPERATOR_LEASE_MS}, executor,`,
    '  });',
    '  console.log(JSON.stringify({ ok: true, label }));',
    '} catch (error) {',
    '  console.log(JSON.stringify({ ok: false, label, code: error?.code ?? null, message: String(error?.message ?? error) }));',
    '}',
  ].join('\n');
}

test('J. crash around invocation without durable evidence fails closed with zero automatic reinvocation', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmittedChild(store, clock, 'C03F-SRC-J001', sampleTaskInput('C03F-CHILD-J001'));
    const gateDir = join(home, 'gate-J');
    mkdirSync(gateDir, { recursive: true });

    const crashing = runChildProcess({
      code: crashInsideExecutorCode({
        home,
        gateDir,
        label: 'A',
        sourceTaskId: 'C03F-SRC-J001',
        childTaskId: 'C03F-CHILD-J001',
      }),
    });
    const crashed = await crashing.exitPromise;
    const entered = await waitForFile(join(gateDir, 'entered-A'), 5_000);
    assert.equal(entered, true, 'the adapter/executor boundary was really entered');
    assert.equal(crashed.exitCode, 70);

    const dispatchId = store.readClaimBoundDispatchEnvelope({
      sourceTaskId: 'C03F-SRC-J001',
      emissionSlot: 'next',
      workerId: OPERATOR_WORKER_ID,
    }).dispatchId;
    assert.deepEqual(store.readExecutorInvocationFence(dispatchId), fenceRecord(dispatchId));
    assert.equal(store.readExecutorInvocationOutcome(dispatchId), null);
    assert.equal(store.readExecutorResultReceipt(dispatchId), null);

    const before = snapshotHome(home);
    const counter = { calls: 0 };
    await assert.rejects(
      executeOperatorTask({
        store,
        taskId: 'C03F-CHILD-J001',
        sourceTaskId: 'C03F-SRC-J001',
        workerId: OPERATOR_WORKER_ID,
        leaseDurationMs: OPERATOR_LEASE_MS,
        executor: fakeStructuredExecutor(counter),
      }),
      (error) => error?.code === EXECUTOR_INVOCATION_FENCE_UNCERTAIN,
    );
    assert.equal(counter.calls, 0, 'no automatic reinvocation exists');
    assert.deepEqual(
      snapshotHome(home),
      before,
      'the fail-closed restart writes zero durable bytes and never repairs the fence',
    );

    const directCounter = { calls: 0 };
    await assert.rejects(
      invokeExecutorWithInvocationFence({
        dispatchId,
        store,
        executor: fakeStructuredExecutor(directCounter),
      }),
      (error) => error?.code === EXECUTOR_INVOCATION_FENCE_UNCERTAIN,
    );
    assert.equal(directCounter.calls, 0);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// K/L/M. primitive contract, invalid executor, operator composition
// ---------------------------------------------------------------------------

test('K. the durable fence primitive is immutable, dispatchId-keyed, exact-shape, and fail-closed', async () => {
  const home = makeHome();
  const store = new CoordinationStore({ dir: home });
  const dispatchId = `dsp_${'a'.repeat(64)}`;
  const otherDispatchId = `dsp_${'b'.repeat(64)}`;
  try {
    assert.equal(store.readExecutorInvocationFence(dispatchId), null);
    assert.deepEqual(store.createExecutorInvocationFence(fenceRecord(dispatchId)), {
      created: true,
    });
    const stored = store.readExecutorInvocationFence(dispatchId);
    assert.deepEqual(stored, fenceRecord(dispatchId));
    assert.deepEqual(Object.keys(stored), ['schemaVersion', 'dispatchId']);
    assert.equal(Object.isFrozen(stored), true);
    const bytes = readFileSync(executorInvocationFenceFilePath(home, dispatchId), 'utf8');
    assert.equal(/\d{4}-\d{2}-\d{2}T/.test(bytes), false, 'no timestamps in the fence');
    assert.equal(bytes.includes('pid'), false);
    assert.equal(bytes.includes('hostname'), false);

    // First durable winner is immutable authority.
    const replay = store.createExecutorInvocationFence(fenceRecord(dispatchId));
    assert.deepEqual(replay, { created: false });
    assert.equal(readFileSync(executorInvocationFenceFilePath(home, dispatchId), 'utf8'), bytes);

    assert.throws(
      () => store.createExecutorInvocationFence({ ...fenceRecord(dispatchId), extra: true }),
      (error) => error?.code === CORRUPT_EXECUTOR_INVOCATION_FENCE,
    );
    assert.throws(
      () =>
        store.createExecutorInvocationFence({
          dispatchId,
          schemaVersion: EXECUTOR_INVOCATION_FENCE_SCHEMA_VERSION,
        }),
      (error) => error?.code === CORRUPT_EXECUTOR_INVOCATION_FENCE,
    );
    assert.throws(
      () => store.readExecutorInvocationFence('not-a-dispatch-id'),
      (error) => error?.code === CORRUPT_EXECUTOR_INVOCATION_FENCE,
    );

    // Corrupt bytes fail closed with no auto-repair.
    const corruptPath = executorInvocationFenceFilePath(home, otherDispatchId);
    mkdirSync(dirname(corruptPath), { recursive: true });
    writeFileSync(corruptPath, '{ not valid json', 'utf8');
    assert.throws(
      () => store.readExecutorInvocationFence(otherDispatchId),
      (error) => error?.code === CORRUPT_EXECUTOR_INVOCATION_FENCE,
    );
    assert.equal(readFileSync(corruptPath, 'utf8'), '{ not valid json');

    // Wrong-key record at the right path fails closed.
    const wrongKeyId = `dsp_${'c'.repeat(64)}`;
    const wrongKeyPath = executorInvocationFenceFilePath(home, wrongKeyId);
    mkdirSync(dirname(wrongKeyPath), { recursive: true });
    writeFileSync(wrongKeyPath, JSON.stringify(fenceRecord(dispatchId), null, 2), 'utf8');
    assert.throws(
      () => store.readExecutorInvocationFence(wrongKeyId),
      (error) => error?.code === CORRUPT_EXECUTOR_INVOCATION_FENCE,
    );
  } finally {
    removeHome(home);
  }
});

test('L. an invalid executor never poisons the one-way fence', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmittedChild(store, clock, 'C03F-SRC-L001', sampleTaskInput('C03F-CHILD-L001'));
    const { dispatchId } = await driveToInvocationAttempt({
      store,
      sourceTaskId: 'C03F-SRC-L001',
      childTaskId: 'C03F-CHILD-L001',
    });

    await assert.rejects(
      invokeExecutorWithInvocationFence({ dispatchId, store, executor: 'not-a-function' }),
      (error) => error?.code === 'INVALID_EXECUTOR_INVOCATION_ADAPTER',
    );
    assert.equal(store.readExecutorInvocationFence(dispatchId), null, 'fence stays unpoisoned');
    assert.equal(store.readExecutorInvocationOutcome(dispatchId), null);

    const counter = { calls: 0 };
    const result = await invokeExecutorWithInvocationFence({
      dispatchId,
      store,
      executor: fakeStructuredExecutor(counter),
    });
    assert.equal(counter.calls, 1);
    assert.equal(result.executorInvoked, true);
    assert.deepEqual(store.readExecutorInvocationFence(dispatchId), fenceRecord(dispatchId));
    assert.equal(
      store.readExecutorInvocationOutcome(dispatchId).outcome,
      EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
    );
  } finally {
    removeHome(home);
  }
});

test('N. a pre-invocation Task 29 validation failure never consumes the fence and stays recoverable', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmittedChild(store, clock, 'C03F-SRC-N001', sampleTaskInput('C03F-CHILD-N001'));
    const { dispatchId } = await driveToInvocationAttempt({
      store,
      sourceTaskId: 'C03F-SRC-N001',
      childTaskId: 'C03F-CHILD-N001',
      persistInvocationAttempt: false,
    });

    const counter = { calls: 0 };
    await assert.rejects(
      invokeExecutorWithInvocationFence({
        dispatchId,
        store,
        executor: fakeStructuredExecutor(counter),
      }),
      (error) => error?.code === 'EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND',
    );
    assert.equal(counter.calls, 0, 'the external executor was provably never entered');
    assert.equal(
      store.readExecutorInvocationFence(dispatchId),
      null,
      'a pre-invocation validation failure never consumes the one-way fence',
    );
    assert.equal(store.readExecutorInvocationOutcome(dispatchId), null);
    assert.equal(store.readExecutorResultReceipt(dispatchId), null);

    // Recovery: once the missing durable input exists, the boundary is still
    // acquirable and is crossed exactly once.
    await persistExecutorInvocationAttempt({ dispatchId, store });
    const recovered = await invokeExecutorWithInvocationFence({
      dispatchId,
      store,
      executor: fakeStructuredExecutor(counter),
    });
    assert.equal(counter.calls, 1);
    assert.equal(recovered.executorInvoked, true);
    assert.deepEqual(store.readExecutorInvocationFence(dispatchId), fenceRecord(dispatchId));
    assert.equal(
      store.readExecutorInvocationOutcome(dispatchId).outcome,
      EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
    );
  } finally {
    removeHome(home);
  }
});

test('M. the operator run composition uses the fenced boundary only and the fence module stays clock/process-free', () => {
  const operatorSource = codeOnly(readFileSync(OPERATOR_MODULE_PATH, 'utf8'));
  assert.ok(operatorSource.includes('invokeExecutorWithInvocationFence('));
  assert.equal(operatorSource.includes('persistExecutorResultReceipt('), false);

  const fenceSource = codeOnly(readFileSync(FENCE_MODULE_PATH, 'utf8'));
  assert.doesNotMatch(fenceSource, /Date\.now|new Date|performance\.now/);
  assert.doesNotMatch(fenceSource, /\bpid\b|hostname/);
  assert.doesNotMatch(fenceSource, /setInterval|setTimeout|setImmediate/);
  assert.doesNotMatch(fenceSource, /node:child_process|\bspawn\b|\bexecFile\b/);
  assert.ok(fenceSource.includes('createExecutorInvocationFence('));
  assert.ok(fenceSource.includes('createExecutorInvocationOutcome('));
});
