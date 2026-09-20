// Proof for GREENHUB-COORDINATION-CANONICAL-RESULT-DELIVERY-FROM-RECEIPT-34.
//
// DURABLY_RECORDED_EXECUTOR_RESULT_RECEIPT(dispatchId)   [Task 33]
//   -> RESULT_DELIVERED(taskId)                          [this Task].
//
// RESULT_DELIVERED != ADOPTED != ACK != disposition != materialization
// != consumption cursor advancement != successor permission
// != task succeeded proof != mutation proof
// != global exactly-once executor invocation.
//
// The entry composes EXISTING canonical authorities only:
//   - Task 33 immutable receipt (six executor-authored evidence fields ONLY),
//   - Task 28 durable invocation attempt (workerId / claimGeneration binding),
//   - Task 15 admission-bound claim token authority (claimToken),
//   - deterministic `result_<dispatchId>` canonical result identity,
//   - store.deliverResult (canonical Result writer + live claim fencing),
//   - store clock (delivery timing authority).
//
// Proof map:
//   STORE. capability gate, dispatchId identity-first, deterministic result
//      identity, exact public export surface, module boundary statics.
//   A. valid SUCCEEDED receipt -> exactly one canonical Result, CLAIMED ->
//      RESULT_DELIVERED, receipt bytes unchanged, no extra inputs.
//   B. FAILED receipt -> canonical status FAILED (exit code never consulted).
//   C. BLOCKED receipt -> canonical status BLOCKED.
//   D. receipt evidence fields reflected byte/semantically unchanged.
//   E. workerId / claimToken / claimGeneration / deliveredAt sourced from
//      existing canonical authority, never from the receipt.
//   F. same dispatch replay -> same result, duplicate-safe, zero writes,
//      zero byte/mtime change, receipt unchanged, deliveredAt not rewritten.
//   G. stale claimGeneration -> delivery 0 (STALE_CLAIM) with zero writes.
//   H. wrong worker / foreign token / missing claim -> delivery 0.
//   I. missing / corrupt / schema-invalid / binding-mismatched receipt ->
//      delivery 0.
//   J. Task 32 outcome without Task 33 receipt -> delivery 0; Task 33
//      fail-closed semantics preserved.
//   K. already-delivered identical result -> idempotent read-only convergence.
//   L. already-delivered conflicting result -> fail closed, first canonical
//      result preserved (content, identity, and evidence conflicts).
//   M. no executor process invocation anywhere; no extra input authority.
//   N. no disposition / ACK / materialization / cursor mutation.
//   LIFECYCLE. non-deliverable lifecycle states fail closed with zero writes.
//   AUTH. missing / corrupt / key-mismatched durable dispatch authority ->
//      delivery 0.
//   O. Task 28~33 predecessor suites remain green (run externally).
//
// All runtime state lives in isolated temp directories. No test spawns any
// executor process: the Task 33 receipt is persisted through Task 33's own
// public entry with an in-memory fake structured executor.

import assert from 'node:assert/strict';
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
import { fileURLToPath } from 'node:url';
import { buildAdmissionBoundClaimToken } from './admission-bound-claim.mjs';
import { acceptExecutorDispatchDecision } from './dispatch-executor-acceptance.mjs';
import { persistExecutorInvocationAttempt } from './dispatch-executor-invocation-attempt.mjs';
import { EXECUTOR_INVOCATION_OUTCOME_ACCEPTED } from './dispatch-executor-invocation-outcome.mjs';
import { persistExecutorInvocationOutcome } from './dispatch-executor-invocation-outcome-persistence.mjs';
import { acceptReceiverDispatch } from './dispatch-receiver-acceptance.mjs';
import { persistReceiverDecision } from './dispatch-receiver-decision.mjs';
import { prepareDispatchTransportRequest } from './dispatch-transport-contract.mjs';
import * as deliveryModule from './executor-result-delivery.mjs';
import {
  CORRUPT_EXECUTOR_RESULT_DELIVERY,
  EXECUTOR_RESULT_DELIVERY_AUTHORED_RESULT_FIELDS,
  EXECUTOR_RESULT_DELIVERY_CONFLICT,
  EXECUTOR_RESULT_DELIVERY_DISPATCH_AUTHORITY_NOT_FOUND,
  EXECUTOR_RESULT_DELIVERY_NEW_FIELDS,
  EXECUTOR_RESULT_DELIVERY_REPLAY_FIELDS,
  EXECUTOR_RESULT_DELIVERY_RESULT_ID_PREFIX,
  EXECUTOR_RESULT_DELIVERY_TASK_BINDING_MISMATCH,
  EXECUTOR_RESULT_DELIVERY_TASK_STATE_NOT_DELIVERABLE,
  EXECUTOR_RESULT_RECEIPT_NOT_FOUND,
  ExecutorResultDeliveryError,
  INVALID_EXECUTOR_RESULT_DELIVERY_DISPATCH_ID,
  INVALID_EXECUTOR_RESULT_DELIVERY_STORE,
  assertValidExecutorResultDeliveryDispatchId,
  buildExecutorResultId,
  deliverExecutorResultReceipt,
} from './executor-result-delivery.mjs';
import {
  EXECUTOR_RESULT_RECEIPT_FIELDS,
  EXECUTOR_RESULT_RECEIPT_STATUS_BLOCKED,
  EXECUTOR_RESULT_RECEIPT_STATUS_FAILED,
  EXECUTOR_RESULT_RECEIPT_STATUS_SUCCEEDED,
  EXECUTOR_RESULT_RECEIPTS_DIRNAME,
  executorResultReceiptFilePath,
  persistExecutorResultReceipt,
} from './executor-result-receipt.mjs';
import { CoordinationStore } from './store.mjs';
import {
  TASK_STATUS_CLAIMED,
  TASK_STATUS_READY,
  TASK_STATUS_RESULT_DELIVERED,
} from './task-envelope.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = join(MODULE_DIRECTORY, 'executor-result-delivery.mjs');
const MODULE_SOURCE = readFileSync(MODULE_PATH, 'utf8');

const DELIVERY_STORE_CAPABILITIES = Object.freeze([
  'readExecutorResultReceipt',
  'readExecutorInvocationAttempt',
  'readTask',
  'readResult',
  'deliverResult',
]);

const OTHER_DISPATCH_ID = `dsp_${'f'.repeat(64)}`;

function errorWithCode(code) {
  return (error) => error instanceof Error && error.code === code;
}

function makeHome(prefix = 'greenhub-executor-result-delivery34-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'READ_ONLY',
    desiredExitState: 'CANONICAL_RESULT_DELIVERY_PROVED',
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
    proofRequirement: ['canonical-result-delivery-proof'],
    ...overrides,
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
    summary: 'bounded source closure output',
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
    state: 'ADOPTED',
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

function driveToEmitted(
  store,
  clock,
  sourceTaskId,
  childTaskId,
  sourceResultId = 'result-0001',
  childSpec,
) {
  driveToConsumed(store, clock, sourceTaskId, sourceResultId);
  const out = store.emitNextTask({
    sourceTaskId,
    nextTaskSpec: childSpec ?? sampleTaskInput(childTaskId),
    emitterId: 'control-tower-1',
  });
  clock.advance(1000);
  return out;
}

function driveToAdmitted(
  store,
  clock,
  sourceTaskId,
  childTaskId,
  sourceResultId = 'result-0001',
  childSpec,
) {
  const emitted = driveToEmitted(
    store,
    clock,
    sourceTaskId,
    childTaskId,
    sourceResultId,
    childSpec,
  );
  const admitted = store.admitEmittedTask({ sourceTaskId, admitterId: 'control-tower-1' });
  clock.advance(1000);
  return { emitted, admitted };
}

function driveToClaimed(
  store,
  clock,
  sourceTaskId,
  childTaskId,
  sourceResultId = 'result-0001',
  workerId = 'worker-a',
  childSpec,
) {
  const setup = driveToAdmitted(store, clock, sourceTaskId, childTaskId, sourceResultId, childSpec);
  const claimed = store.claimAdmittedTask({ sourceTaskId, workerId });
  clock.advance(1000);
  return { ...setup, claimed };
}

function driveToAttempt(
  store,
  clock,
  sourceTaskId,
  childTaskId,
  sourceResultId = 'result-0001',
  workerId = 'worker-a',
  childSpec,
) {
  const setup = driveToClaimed(
    store,
    clock,
    sourceTaskId,
    childTaskId,
    sourceResultId,
    workerId,
    childSpec,
  );
  const attempt = store.persistDispatchAttempt({ sourceTaskId, workerId });
  clock.advance(1000);
  return { ...setup, attempt };
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

// Full Task 18~28 durable chain ending with the durable Task 28 executor
// invocation attempt, then (optionally) the exact Task 33 receipt recorded
// through Task 33's own public entry with an in-memory fake structured
// executor. No executor process is ever spawned.
async function setupReceiptChain({
  prefix = 'greenhub-executor-result-delivery34-',
  sourceTaskId,
  childTaskId,
  workerId = 'worker-a',
  status = EXECUTOR_RESULT_RECEIPT_STATUS_SUCCEEDED,
  summary = 'bounded executor result evidence',
  proofRefs = ['proof:structured-result'],
  evidenceRefs = ['evidence:structured-result'],
  frictionObserved = ['NONE'],
  recordReceipt = true,
} = {}) {
  const home = makeHome(prefix);
  const clock = controllableClock();
  const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
  const { attempt } = driveToAttempt(
    store,
    clock,
    sourceTaskId,
    childTaskId,
    `result-${sourceTaskId.toLowerCase()}`,
    workerId,
  );
  const request = prepareDispatchTransportRequest({
    store,
    sourceTaskId,
    dispatchId: attempt.dispatchId,
  });
  await acceptReceiverDispatch({ request, store });
  await persistReceiverDecision({ dispatchId: attempt.dispatchId, store });
  await acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store });
  await persistExecutorInvocationAttempt({ dispatchId: attempt.dispatchId, store });
  const dispatchId = attempt.dispatchId;
  const authority = store.readExecutorInvocationAttempt(dispatchId);
  let receipt = null;
  if (recordReceipt) {
    const persisted = await persistExecutorResultReceipt({
      dispatchId,
      store,
      executor: async () => ({
        schemaVersion: 1,
        dispatchId,
        outcome: EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
        result: {
          taskId: childTaskId,
          status,
          summary,
          proofRefs: [...proofRefs],
          evidenceRefs: [...evidenceRefs],
          frictionObserved: [...frictionObserved],
        },
      }),
    });
    receipt = persisted.receipt;
  }
  return {
    home,
    clock,
    store,
    attempt,
    authority,
    dispatchId,
    child: childTaskId,
    workerId,
    receipt,
  };
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

function snapshotHomeStats(home) {
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
        const stat = statSync(full);
        out[full.slice(home.length + 1)] = { size: stat.size, mtimeMs: stat.mtimeMs };
      }
    }
  };
  walk(home);
  return out;
}

function changedKeys(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [];
  for (const key of keys) {
    if (before[key] !== after[key]) changed.push(key);
  }
  return changed.sort();
}

// Boundary greps inspect functional code only; header/line comments
// legitimately document forbidden names as prohibitions.
function codeOnly(source) {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    })
    .join('\n');
}

function receiptPath(home, dispatchId) {
  return executorResultReceiptFilePath(home, dispatchId);
}

function taskJsonPath(home, taskId) {
  return join(home, 'tasks', taskId, 'task.json');
}

function claimJsonPath(home, taskId) {
  return join(home, 'tasks', taskId, 'claim.json');
}

function resultJsonPath(home, taskId) {
  return join(home, 'tasks', taskId, 'result.json');
}

function resultsDir(home, taskId) {
  return join(home, 'tasks', taskId, 'results');
}

function invocationAttemptPath(home, dispatchId) {
  return join(home, 'executor-invocation-attempts', `${dispatchId}.json`);
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJsonFile(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
}

function directReceipt(dispatchId, taskId, overrides = {}) {
  return {
    schemaVersion: 1,
    dispatchId,
    taskId,
    status: EXECUTOR_RESULT_RECEIPT_STATUS_SUCCEEDED,
    summary: 'direct durable receipt bytes',
    proofRefs: ['proof:direct-receipt'],
    evidenceRefs: ['evidence:direct-receipt'],
    frictionObserved: ['NONE'],
    ...overrides,
  };
}

function assertNoCanonicalDelivery(home, child) {
  assert.equal(existsSync(resultJsonPath(home, child)), false);
  assert.equal(existsSync(resultsDir(home, child)), false);
  assert.equal(readJsonFile(taskJsonPath(home, child)).status, TASK_STATUS_CLAIMED);
}

// Caller-supplied recording store: records every capability call and delegates
// to the real CoordinationStore. Optional overrides replace one capability.
function recordingStore(store, overrides = {}) {
  const calls = [];
  const captured = {};
  const wrapper = {};
  for (const name of DELIVERY_STORE_CAPABILITIES) {
    const override = overrides[name];
    wrapper[name] = (...args) => {
      calls.push(name);
      captured[name] = args;
      return override ? override(...args) : store[name](...args);
    };
  }
  return { store: wrapper, calls, captured };
}

async function expectFailure(promise, code, label) {
  await assert.rejects(promise, errorWithCode(code), label);
}

// ---------------------------------------------------------------------------
// STORE. CAPABILITY GATE / IDENTITY / RESULT IDENTITY / STATIC SURFACE.
// ---------------------------------------------------------------------------

test('STORE.1 missing store or any missing required capability fails closed with zero calls', async () => {
  await expectFailure(
    deliverExecutorResultReceipt({ dispatchId: `dsp_${'a'.repeat(64)}`, store: null }),
    INVALID_EXECUTOR_RESULT_DELIVERY_STORE,
    'null store',
  );
  for (const missing of DELIVERY_STORE_CAPABILITIES) {
    const calls = [];
    const store = {};
    for (const name of DELIVERY_STORE_CAPABILITIES) {
      if (name === missing) continue;
      store[name] = (...args) => {
        calls.push({ name, args });
        return null;
      };
    }
    await expectFailure(
      deliverExecutorResultReceipt({ dispatchId: `dsp_${'a'.repeat(64)}`, store }),
      INVALID_EXECUTOR_RESULT_DELIVERY_STORE,
      `missing ${missing}`,
    );
    assert.deepEqual(calls, [], `capability gate must not call anything (missing ${missing})`);
  }
});

test('STORE.2 invalid dispatchId fails closed before any durable read', async () => {
  const calls = [];
  const base = {};
  for (const name of DELIVERY_STORE_CAPABILITIES) {
    base[name] = () => {
      calls.push(name);
      return null;
    };
  }
  const invalidIds = [undefined, null, '', 'not-a-dispatch-id', `dsp_${'A'.repeat(64)}`, `dsp_${'a'.repeat(63)}`];
  for (const dispatchId of invalidIds) {
    await expectFailure(
      deliverExecutorResultReceipt({ dispatchId, store: base }),
      INVALID_EXECUTOR_RESULT_DELIVERY_DISPATCH_ID,
      String(dispatchId),
    );
  }
  assert.deepEqual(calls, []);
});

test('STORE.3 result identity is deterministic, dispatch-bound, and one-to-one', () => {
  const dispatchA = `dsp_${'1'.repeat(64)}`;
  const dispatchB = `dsp_${'2'.repeat(64)}`;
  assert.equal(buildExecutorResultId(dispatchA), `${EXECUTOR_RESULT_DELIVERY_RESULT_ID_PREFIX}${dispatchA}`);
  assert.equal(buildExecutorResultId(dispatchA), buildExecutorResultId(dispatchA));
  assert.notEqual(buildExecutorResultId(dispatchA), buildExecutorResultId(dispatchB));
  assert.equal(buildExecutorResultId(dispatchA).includes('/'), false);
  assert.equal(buildExecutorResultId(dispatchA).includes('\\'), false);
  assert.equal(buildExecutorResultId(dispatchA).includes('..'), false);
  assert.ok(buildExecutorResultId(dispatchA).length <= 128);
  assert.equal(assertValidExecutorResultDeliveryDispatchId(dispatchA), dispatchA);
  assert.throws(() => buildExecutorResultId('nope'), errorWithCode(INVALID_EXECUTOR_RESULT_DELIVERY_DISPATCH_ID));
});

test('STORE.4 public export surface is exact and delivery-error class is exposed', () => {
  const expected = [
    'CORRUPT_EXECUTOR_RESULT_DELIVERY',
    'EXECUTOR_RESULT_DELIVERY_AUTHORED_RESULT_FIELDS',
    'EXECUTOR_RESULT_DELIVERY_CONFLICT',
    'EXECUTOR_RESULT_DELIVERY_DISPATCH_AUTHORITY_NOT_FOUND',
    'EXECUTOR_RESULT_DELIVERY_NEW_FIELDS',
    'EXECUTOR_RESULT_DELIVERY_REPLAY_FIELDS',
    'EXECUTOR_RESULT_DELIVERY_RESULT_ID_PREFIX',
    'EXECUTOR_RESULT_DELIVERY_TASK_BINDING_MISMATCH',
    'EXECUTOR_RESULT_DELIVERY_TASK_STATE_NOT_DELIVERABLE',
    'EXECUTOR_RESULT_RECEIPT_NOT_FOUND',
    'ExecutorResultDeliveryError',
    'INVALID_EXECUTOR_RESULT_DELIVERY_DISPATCH_ID',
    'INVALID_EXECUTOR_RESULT_DELIVERY_STORE',
    'assertValidExecutorResultDeliveryDispatchId',
    'buildExecutorResultId',
    'deliverExecutorResultReceipt',
  ];
  assert.deepEqual(Object.keys(deliveryModule).sort(), expected.sort());
  assert.equal(CORRUPT_EXECUTOR_RESULT_DELIVERY, 'CORRUPT_EXECUTOR_RESULT_DELIVERY');
  assert.equal(
    new ExecutorResultDeliveryError('x').code,
    CORRUPT_EXECUTOR_RESULT_DELIVERY,
  );
  assert.equal(
    new ExecutorResultDeliveryError('x', { code: 'OTHER' }).code,
    'OTHER',
  );
});

test('STATIC. no executor process / write / ACK / disposition / clock / random authority exists', () => {
  const functional = codeOnly(MODULE_SOURCE);
  const forbidden = [
    'node:child_process',
    'child_process',
    'spawn',
    'execFile',
    'execSync',
    'randomUUID',
    'Date.now',
    'performance.now',
    'process.pid',
    'hostname',
    'createExecutorResultReceipt',
    'persistExecutorResultReceipt',
    'persistExecutorInvocationOutcome',
    'createExecutorInvocationOutcome',
    'createExecutorInvocationAttempt',
    'invokeExecutorInvocationAdapter',
    'invokeExecutorAndValidateOutcome',
    'writeFileSync',
    'mkdirSync',
    'openSync',
    'acknowledge',
    'beginDisposition',
    'writeDisposition',
    'materializeAdoption',
    'markConsumed',
    'syncCursor',
    'readExecutorInvocationOutcome',
    'readClaim',
    'readDispatchAttempt',
  ];
  for (const token of forbidden) {
    assert.equal(functional.includes(token), false, `module must not contain "${token}"`);
  }
  assert.equal(MODULE_SOURCE.includes('node:fs'), false);
});

// ---------------------------------------------------------------------------
// A. VALID SUCCEEDED RECEIPT -> EXACTLY ONE CANONICAL RESULT.
// ---------------------------------------------------------------------------

test('A.1 valid SUCCEEDED receipt delivers exactly one canonical result and CLAIMED -> RESULT_DELIVERED', async () => {
  const setup = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-a-',
    sourceTaskId: 'DLV34-A-SRC',
    childTaskId: 'DLV34-A-CHILD',
  });
  const { home, clock, store, attempt, authority, dispatchId, child, receipt } = setup;
  try {
    const receiptBefore = readFileSync(receiptPath(home, dispatchId), 'utf8');
    const before = snapshotHomeBytes(home);
    const clockNow = clock.now;
    const delivery = await deliverExecutorResultReceipt({ dispatchId, store });
    const resultId = buildExecutorResultId(dispatchId);

    assert.deepEqual(Object.keys(delivery), [...EXECUTOR_RESULT_DELIVERY_NEW_FIELDS]);
    assert.equal(Object.isFrozen(delivery), true);
    assert.equal(delivery.dispatchId, dispatchId);
    assert.equal(delivery.taskId, child);
    assert.equal(delivery.resultId, resultId);
    assert.equal(delivery.newlyDelivered, true);

    const task = await store.readTask(child);
    assert.equal(task.status, TASK_STATUS_RESULT_DELIVERED);

    const canonical = await store.readResult(child);
    const perId = await store.readResultById(child, resultId);
    assert.deepEqual(canonical, perId);
    assert.deepEqual(delivery.result, canonical);
    assert.equal(Object.isFrozen(canonical), true);

    assert.equal(canonical.resultId, resultId);
    assert.equal(canonical.taskId, child);
    assert.equal(canonical.status, EXECUTOR_RESULT_RECEIPT_STATUS_SUCCEEDED);
    assert.equal(canonical.summary, receipt.summary);
    assert.deepEqual(canonical.proofRefs, receipt.proofRefs);
    assert.deepEqual(canonical.evidenceRefs, receipt.evidenceRefs);
    assert.deepEqual(canonical.frictionObserved, receipt.frictionObserved);
    assert.equal(canonical.workerId, authority.decisionInput.workerId);
    assert.equal(canonical.workerId, attempt.workerId);
    assert.equal(canonical.claimGeneration, authority.decisionInput.claimGeneration);
    assert.equal(canonical.claimGeneration, attempt.claimGeneration);
    assert.equal(
      canonical.claimToken,
      buildAdmissionBoundClaimToken({
        admissionId: authority.decisionInput.admissionId,
        nextTaskId: child,
        workerId: authority.decisionInput.workerId,
      }),
    );
    assert.equal(canonical.deliveredAt, new Date(clockNow).toISOString());
    assert.equal(Object.hasOwn(canonical, 'usage'), false);

    // Exactly one canonical result: the per-id file and the terminal result are
    // byte-identical and no other result id exists.
    assert.deepEqual(readdirSync(resultsDir(home, child)), [`${resultId}.json`]);
    assert.equal(
      readFileSync(resultJsonPath(home, child), 'utf8'),
      readFileSync(join(resultsDir(home, child), `${resultId}.json`), 'utf8'),
    );

    // Only task.json / result.json / results/<resultId>.json may change.
    const after = snapshotHomeBytes(home);
    assert.deepEqual(
      changedKeys(before, after),
      [
        join('tasks', child, 'result.json'),
        join('tasks', child, 'results', `${resultId}.json`),
        join('tasks', child, 'task.json'),
      ].sort(),
    );

    // The Task 33 receipt stays the immutable executor evidence.
    assert.equal(readFileSync(receiptPath(home, dispatchId), 'utf8'), receiptBefore);
  } finally {
    removeHome(home);
  }
});

test('A.2 canonical result carries exactly the authored fields plus deliveredAt', async () => {
  const { home, store, dispatchId, child } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-a2-',
    sourceTaskId: 'DLV34-A2-SRC',
    childTaskId: 'DLV34-A2-CHILD',
  });
  try {
    await deliverExecutorResultReceipt({ dispatchId, store });
    const canonical = await store.readResult(child);
    assert.deepEqual(
      Object.keys(canonical).sort(),
      [...EXECUTOR_RESULT_DELIVERY_AUTHORED_RESULT_FIELDS, 'deliveredAt'].sort(),
    );
  } finally {
    removeHome(home);
  }
});

test('A.3 entry ignores extra executor / stdout / exitCode inputs (no such authority exists)', async () => {
  const { home, store, dispatchId, child } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-a3-',
    sourceTaskId: 'DLV34-A3-SRC',
    childTaskId: 'DLV34-A3-CHILD',
  });
  try {
    let executorCalls = 0;
    const delivery = await deliverExecutorResultReceipt({
      dispatchId,
      store,
      executor: () => {
        executorCalls += 1;
        return { bogus: true };
      },
      stdout: 'not evidence',
      stderr: 'not evidence',
      exitCode: 7,
      workerId: 'foreign-worker',
      claimToken: 'foreign-token',
      claimGeneration: 99,
    });
    assert.equal(executorCalls, 0);
    assert.equal(delivery.newlyDelivered, true);
    const canonical = await store.readResult(child);
    assert.equal(canonical.workerId, 'worker-a');
    assert.notEqual(canonical.claimToken, 'foreign-token');
    assert.equal(canonical.claimGeneration, 1);
    assert.equal((await store.readTask(child)).status, TASK_STATUS_RESULT_DELIVERED);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// B/C/D. STATUS MAPPING AND EVIDENCE PASS-THROUGH.
// ---------------------------------------------------------------------------

test('B. FAILED receipt is delivered as canonical status FAILED', async () => {
  const { home, store, dispatchId, child } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-b-',
    sourceTaskId: 'DLV34-B-SRC',
    childTaskId: 'DLV34-B-CHILD',
    status: EXECUTOR_RESULT_RECEIPT_STATUS_FAILED,
    summary: 'executor reported bounded failure',
  });
  try {
    const delivery = await deliverExecutorResultReceipt({ dispatchId, store });
    assert.equal(delivery.result.status, EXECUTOR_RESULT_RECEIPT_STATUS_FAILED);
    assert.equal((await store.readResult(child)).status, EXECUTOR_RESULT_RECEIPT_STATUS_FAILED);
    assert.equal((await store.readTask(child)).status, TASK_STATUS_RESULT_DELIVERED);
  } finally {
    removeHome(home);
  }
});

test('C. BLOCKED receipt is delivered as canonical status BLOCKED', async () => {
  const { home, store, dispatchId, child } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-c-',
    sourceTaskId: 'DLV34-C-SRC',
    childTaskId: 'DLV34-C-CHILD',
    status: EXECUTOR_RESULT_RECEIPT_STATUS_BLOCKED,
    summary: 'executor reported blocked state',
  });
  try {
    const delivery = await deliverExecutorResultReceipt({ dispatchId, store });
    assert.equal(delivery.result.status, EXECUTOR_RESULT_RECEIPT_STATUS_BLOCKED);
    assert.equal((await store.readResult(child)).status, EXECUTOR_RESULT_RECEIPT_STATUS_BLOCKED);
    assert.equal((await store.readTask(child)).status, TASK_STATUS_RESULT_DELIVERED);
  } finally {
    removeHome(home);
  }
});

test('D. receipt evidence fields are reflected byte/semantically unchanged', async () => {
  const summary = 'VERBATIM evidence: 공백  and punctuation !@#$%^&*()';
  const proofRefs = ['proof:alpha', 'proof:beta/…', 'proof:long-'.padEnd(120, 'x')];
  const evidenceRefs = ['evidence:one', 'evidence:two'];
  const frictionObserved = ['NONE', 'friction:verbatim'];
  const { home, store, dispatchId, child, receipt } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-d-',
    sourceTaskId: 'DLV34-D-SRC',
    childTaskId: 'DLV34-D-CHILD',
    summary,
    proofRefs,
    evidenceRefs,
    frictionObserved,
  });
  try {
    await deliverExecutorResultReceipt({ dispatchId, store });
    const canonical = await store.readResult(child);
    assert.equal(canonical.summary, receipt.summary);
    assert.deepEqual(canonical.proofRefs, proofRefs);
    assert.deepEqual(canonical.evidenceRefs, evidenceRefs);
    assert.deepEqual(canonical.frictionObserved, frictionObserved);
    assert.deepEqual(JSON.parse(readFileSync(resultJsonPath(home, child), 'utf8')).proofRefs, proofRefs);
    assert.deepEqual(JSON.parse(readFileSync(resultJsonPath(home, child), 'utf8')).evidenceRefs, evidenceRefs);
    assert.deepEqual(JSON.parse(readFileSync(resultJsonPath(home, child), 'utf8')).frictionObserved, frictionObserved);
    assert.equal(JSON.parse(readFileSync(resultJsonPath(home, child), 'utf8')).summary, summary);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. COORDINATION-OWNED AUTHORITY SOURCING.
// ---------------------------------------------------------------------------

test('E.1 receipt schema cannot author workerId / claimToken / claimGeneration', async () => {
  assert.deepEqual([...EXECUTOR_RESULT_RECEIPT_FIELDS], [
    'schemaVersion',
    'dispatchId',
    'taskId',
    'status',
    'summary',
    'proofRefs',
    'evidenceRefs',
    'frictionObserved',
  ]);
  for (const forbidden of ['workerId', 'claimToken', 'claimGeneration', 'resultId', 'deliveredAt', 'usage']) {
    assert.equal(EXECUTOR_RESULT_RECEIPT_FIELDS.includes(forbidden), false, forbidden);
  }
  const { home, store, dispatchId, child, authority } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-e1-',
    sourceTaskId: 'DLV34-E1-SRC',
    childTaskId: 'DLV34-E1-CHILD',
    workerId: 'worker-authority',
  });
  try {
    await deliverExecutorResultReceipt({ dispatchId, store });
    const canonical = await store.readResult(child);
    assert.equal(canonical.workerId, 'worker-authority');
    assert.equal(canonical.workerId, authority.decisionInput.workerId);
    assert.equal(canonical.claimGeneration, authority.decisionInput.claimGeneration);
    assert.equal(
      canonical.claimToken,
      buildAdmissionBoundClaimToken({
        admissionId: authority.decisionInput.admissionId,
        nextTaskId: authority.decisionInput.nextTaskId,
        workerId: authority.decisionInput.workerId,
      }),
    );
  } finally {
    removeHome(home);
  }
});

test('E.2 deliverResult receives exactly the authority-composed envelope', async () => {
  const { home, store, dispatchId, child, authority } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-e2-',
    sourceTaskId: 'DLV34-E2-SRC',
    childTaskId: 'DLV34-E2-CHILD',
  });
  try {
    const { store: recorded, captured } = recordingStore(store);
    const delivery = await deliverExecutorResultReceipt({ dispatchId, store: recorded });
    assert.equal(delivery.newlyDelivered, true);
    const envelope = captured.deliverResult[0];
    assert.deepEqual(Object.keys(envelope), [...EXECUTOR_RESULT_DELIVERY_AUTHORED_RESULT_FIELDS]);
    assert.equal(envelope.resultId, buildExecutorResultId(dispatchId));
    assert.equal(envelope.taskId, child);
    assert.equal(envelope.workerId, authority.decisionInput.workerId);
    assert.equal(envelope.claimGeneration, authority.decisionInput.claimGeneration);
    assert.equal(
      envelope.claimToken,
      buildAdmissionBoundClaimToken({
        admissionId: authority.decisionInput.admissionId,
        nextTaskId: authority.decisionInput.nextTaskId,
        workerId: authority.decisionInput.workerId,
      }),
    );
    assert.equal(Object.hasOwn(envelope, 'deliveredAt'), false);
    assert.equal(Object.hasOwn(envelope, 'usage'), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F/K. REPLAY AND IDEMPOTENT CONVERGENCE.
// ---------------------------------------------------------------------------

test('F.1 same dispatch replay converges with zero writes and unchanged receipt', async () => {
  const { home, clock, store, dispatchId, child } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-f1-',
    sourceTaskId: 'DLV34-F1-SRC',
    childTaskId: 'DLV34-F1-CHILD',
  });
  try {
    const first = await deliverExecutorResultReceipt({ dispatchId, store });
    const bytesAfterFirst = snapshotHomeBytes(home);
    const statsAfterFirst = snapshotHomeStats(home);
    const receiptAfterFirst = readFileSync(receiptPath(home, dispatchId), 'utf8');
    const deliveredAt = first.result.deliveredAt;

    clock.advance(3_600_000);
    const replay = await deliverExecutorResultReceipt({ dispatchId, store });

    assert.deepEqual(Object.keys(replay), [...EXECUTOR_RESULT_DELIVERY_REPLAY_FIELDS]);
    assert.equal(replay.dispatchId, dispatchId);
    assert.equal(replay.taskId, child);
    assert.equal(replay.resultId, first.resultId);
    assert.equal(replay.newlyDelivered, false);
    assert.equal(replay.exactReplay, true);
    assert.deepEqual(replay.result, first.result);
    assert.equal(replay.result.deliveredAt, deliveredAt);
    assert.deepEqual(snapshotHomeBytes(home), bytesAfterFirst);
    assert.deepEqual(snapshotHomeStats(home), statsAfterFirst);
    assert.equal(readFileSync(receiptPath(home, dispatchId), 'utf8'), receiptAfterFirst);
    assert.equal((await store.readTask(child)).status, TASK_STATUS_RESULT_DELIVERED);
  } finally {
    removeHome(home);
  }
});

test('F.2 replay converges read-only even after the claim is removed (no re-fencing on replay)', async () => {
  const { home, store, dispatchId, child } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-f2-',
    sourceTaskId: 'DLV34-F2-SRC',
    childTaskId: 'DLV34-F2-CHILD',
  });
  try {
    const first = await deliverExecutorResultReceipt({ dispatchId, store });
    rmSync(claimJsonPath(home, child));
    const before = snapshotHomeBytes(home);
    const replay = await deliverExecutorResultReceipt({ dispatchId, store });
    assert.equal(replay.exactReplay, true);
    assert.equal(replay.newlyDelivered, false);
    assert.deepEqual(replay.result, first.result);
    assert.deepEqual(snapshotHomeBytes(home), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// G/H. LIVE CLAIM / FENCING FAILURE -> DELIVERY 0.
// ---------------------------------------------------------------------------

test('G. stale claimGeneration fails closed with STALE_CLAIM and zero writes', async () => {
  const { home, store, dispatchId, child, authority } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-g1-',
    sourceTaskId: 'DLV34-G1-SRC',
    childTaskId: 'DLV34-G1-CHILD',
  });
  try {
    const claim = readJsonFile(claimJsonPath(home, child));
    claim.generation = authority.decisionInput.claimGeneration + 1;
    writeJsonFile(claimJsonPath(home, child), claim);
    const before = snapshotHomeBytes(home);
    await expectFailure(
      deliverExecutorResultReceipt({ dispatchId, store }),
      'STALE_CLAIM',
    );
    assert.deepEqual(snapshotHomeBytes(home), before);
    assertNoCanonicalDelivery(home, child);
  } finally {
    removeHome(home);
  }
});

test('G. lease-expired takeover to generation+1 fails closed with zero writes', async () => {
  const { home, clock, store, dispatchId, child } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-g2-',
    sourceTaskId: 'DLV34-G2-SRC',
    childTaskId: 'DLV34-G2-CHILD',
  });
  try {
    clock.advance(120_000);
    const takenOver = store.claimTask({
      taskId: child,
      workerId: 'worker-b',
      leaseDurationMs: 60_000,
    });
    assert.equal(takenOver.workerId, 'worker-b');
    assert.equal(takenOver.generation, 2);
    const before = snapshotHomeBytes(home);
    await expectFailure(
      deliverExecutorResultReceipt({ dispatchId, store }),
      'STALE_CLAIM',
    );
    assert.deepEqual(snapshotHomeBytes(home), before);
    assertNoCanonicalDelivery(home, child);
  } finally {
    removeHome(home);
  }
});

test('H.1 wrong worker binding fails closed with STALE_CLAIM and zero writes', async () => {
  const { home, store, dispatchId, child } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-h1-',
    sourceTaskId: 'DLV34-H1-SRC',
    childTaskId: 'DLV34-H1-CHILD',
  });
  try {
    const claim = readJsonFile(claimJsonPath(home, child));
    claim.workerId = 'worker-b';
    writeJsonFile(claimJsonPath(home, child), claim);
    const before = snapshotHomeBytes(home);
    await expectFailure(deliverExecutorResultReceipt({ dispatchId, store }), 'STALE_CLAIM');
    assert.deepEqual(snapshotHomeBytes(home), before);
    assertNoCanonicalDelivery(home, child);
  } finally {
    removeHome(home);
  }
});

test('H.2 foreign claim token fails closed with STALE_CLAIM and zero writes', async () => {
  const { home, store, dispatchId, child } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-h2-',
    sourceTaskId: 'DLV34-H2-SRC',
    childTaskId: 'DLV34-H2-CHILD',
  });
  try {
    const claim = readJsonFile(claimJsonPath(home, child));
    claim.claimToken = 'manual-foreign-token-0001';
    writeJsonFile(claimJsonPath(home, child), claim);
    const before = snapshotHomeBytes(home);
    await expectFailure(deliverExecutorResultReceipt({ dispatchId, store }), 'STALE_CLAIM');
    assert.deepEqual(snapshotHomeBytes(home), before);
    assertNoCanonicalDelivery(home, child);
  } finally {
    removeHome(home);
  }
});

test('H.3 missing authoritative claim fails closed with zero writes', async () => {
  const { home, store, dispatchId, child } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-h3-',
    sourceTaskId: 'DLV34-H3-SRC',
    childTaskId: 'DLV34-H3-CHILD',
  });
  try {
    rmSync(claimJsonPath(home, child));
    const before = snapshotHomeBytes(home);
    await expectFailure(deliverExecutorResultReceipt({ dispatchId, store }), 'STALE_CLAIM');
    assert.deepEqual(snapshotHomeBytes(home), before);
    assertNoCanonicalDelivery(home, child);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// I. RECEIPT FAIL-CLOSED CASES -> DELIVERY 0.
// ---------------------------------------------------------------------------

test('I.1 missing receipt fails closed with EXECUTOR_RESULT_RECEIPT_NOT_FOUND and zero writes', async () => {
  const { home, store, dispatchId, child } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-i1-',
    sourceTaskId: 'DLV34-I1-SRC',
    childTaskId: 'DLV34-I1-CHILD',
    recordReceipt: false,
  });
  try {
    const before = snapshotHomeBytes(home);
    await expectFailure(
      deliverExecutorResultReceipt({ dispatchId, store }),
      EXECUTOR_RESULT_RECEIPT_NOT_FOUND,
    );
    assert.deepEqual(snapshotHomeBytes(home), before);
    assertNoCanonicalDelivery(home, child);
  } finally {
    removeHome(home);
  }
});

test('I.2 corrupt receipt bytes fail closed with CORRUPT_EXECUTOR_RESULT_RECEIPT and zero writes', async () => {
  const { home, store, dispatchId, child } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-i2-',
    sourceTaskId: 'DLV34-I2-SRC',
    childTaskId: 'DLV34-I2-CHILD',
  });
  try {
    writeFileSync(receiptPath(home, dispatchId), '{"schemaVersion": 1,', 'utf8');
    const before = snapshotHomeBytes(home);
    await expectFailure(
      deliverExecutorResultReceipt({ dispatchId, store }),
      'CORRUPT_EXECUTOR_RESULT_RECEIPT',
    );
    assert.deepEqual(snapshotHomeBytes(home), before);
    assertNoCanonicalDelivery(home, child);
  } finally {
    removeHome(home);
  }
});

test('I.3 schema-invalid receipts (extra field / bad status / smuggled authority) fail closed', async () => {
  const cases = [
    ['extra workerId field', directReceipt('', '', {})],
    ['invalid status', directReceipt('', '', { status: 'OK' })],
    ['missing frictionObserved', directReceipt('', '')],
  ];
  for (const [label, template] of cases) {
    const { home, store, dispatchId, child } = await setupReceiptChain({
      prefix: 'greenhub-executor-result-delivery34-i3-',
      sourceTaskId: 'DLV34-I3-SRC',
      childTaskId: 'DLV34-I3-CHILD',
      recordReceipt: false,
    });
    try {
      let record;
      if (label === 'extra workerId field') {
        record = { ...directReceipt(dispatchId, child), workerId: 'worker-a' };
      } else if (label === 'invalid status') {
        record = directReceipt(dispatchId, child, { status: 'OK' });
      } else {
        record = directReceipt(dispatchId, child);
        delete record.frictionObserved;
      }
      mkdirSync(dirname(receiptPath(home, dispatchId)), { recursive: true });
      writeJsonFile(receiptPath(home, dispatchId), record);
      const before = snapshotHomeBytes(home);
      await expectFailure(
        deliverExecutorResultReceipt({ dispatchId, store }),
        'CORRUPT_EXECUTOR_RESULT_RECEIPT',
        label,
      );
      assert.deepEqual(snapshotHomeBytes(home), before, label);
      assertNoCanonicalDelivery(home, child);
    } finally {
      removeHome(home);
    }
  }
});

test('I.4 receipt key/binding mismatch fails closed with zero writes', async () => {
  const { home, store, dispatchId, child } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-i4-',
    sourceTaskId: 'DLV34-I4-SRC',
    childTaskId: 'DLV34-I4-CHILD',
    recordReceipt: false,
  });
  try {
    mkdirSync(dirname(receiptPath(home, dispatchId)), { recursive: true });
    writeJsonFile(receiptPath(home, dispatchId), directReceipt(OTHER_DISPATCH_ID, child));
    const before = snapshotHomeBytes(home);
    await expectFailure(
      deliverExecutorResultReceipt({ dispatchId, store }),
      'CORRUPT_EXECUTOR_RESULT_RECEIPT',
    );
    assert.deepEqual(snapshotHomeBytes(home), before);
    assertNoCanonicalDelivery(home, child);
  } finally {
    removeHome(home);
  }
});

test('I.5 receipt taskId not bound to the durable dispatch fails closed with delivery 0', async () => {
  const { home, store, dispatchId, child } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-i5-',
    sourceTaskId: 'DLV34-I5-SRC',
    childTaskId: 'DLV34-I5-CHILD',
    recordReceipt: false,
  });
  try {
    mkdirSync(dirname(receiptPath(home, dispatchId)), { recursive: true });
    writeJsonFile(receiptPath(home, dispatchId), directReceipt(dispatchId, 'OTHER-BOUND-TASK'));
    const before = snapshotHomeBytes(home);
    await expectFailure(
      deliverExecutorResultReceipt({ dispatchId, store }),
      EXECUTOR_RESULT_DELIVERY_TASK_BINDING_MISMATCH,
    );
    assert.deepEqual(snapshotHomeBytes(home), before);
    assertNoCanonicalDelivery(home, child);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// J. TASK 32 OUTCOME WITHOUT TASK 33 RECEIPT.
// ---------------------------------------------------------------------------

test('J. Task 32 outcome without Task 33 receipt never becomes a delivery', async () => {
  const { home, store, dispatchId, child } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-j-',
    sourceTaskId: 'DLV34-J-SRC',
    childTaskId: 'DLV34-J-CHILD',
    recordReceipt: false,
  });
  try {
    const recorded = await persistExecutorInvocationOutcome({
      dispatchId,
      store,
      adapter: async () => ({
        schemaVersion: 1,
        dispatchId,
        outcome: EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
      }),
    });
    assert.equal(recorded.newlyRecorded, true);

    const before = snapshotHomeBytes(home);
    await expectFailure(
      deliverExecutorResultReceipt({ dispatchId, store }),
      EXECUTOR_RESULT_RECEIPT_NOT_FOUND,
    );
    assert.deepEqual(snapshotHomeBytes(home), before);
    assertNoCanonicalDelivery(home, child);

    // Task 33 fail-closed semantics stay intact: the recorded outcome without
    // a receipt is still never auto-repaired and never re-invoked.
    let executorCalls = 0;
    await expectFailure(
      persistExecutorResultReceipt({
        dispatchId,
        store,
        executor: async () => {
          executorCalls += 1;
          return { bogus: true };
        },
      }),
      'EXECUTOR_RESULT_RECEIPT_ABSENT_FOR_RECORDED_OUTCOME',
    );
    assert.equal(executorCalls, 0);
    assert.equal(existsSync(receiptPath(home, dispatchId)), false);

    // No receipt was fabricated and no canonical result appeared: the delivery
    // path stays blocked on the missing Task 33 receipt.
    await expectFailure(
      deliverExecutorResultReceipt({ dispatchId, store }),
      EXECUTOR_RESULT_RECEIPT_NOT_FOUND,
    );
    assertNoCanonicalDelivery(home, child);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// L. ALREADY-DELIVERED CONFLICT -> FAIL CLOSED, FIRST PRESERVED.
// ---------------------------------------------------------------------------

test('L.1 conflicting canonical content fails closed and the first result is preserved', async () => {
  const { home, store, dispatchId, child } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-l1-',
    sourceTaskId: 'DLV34-L1-SRC',
    childTaskId: 'DLV34-L1-CHILD',
  });
  try {
    await deliverExecutorResultReceipt({ dispatchId, store });
    const existing = readJsonFile(resultJsonPath(home, child));
    existing.summary = 'foreign overwrite attempt';
    writeJsonFile(resultJsonPath(home, child), existing);
    const foreignBytes = readFileSync(resultJsonPath(home, child), 'utf8');
    const before = snapshotHomeBytes(home);
    await expectFailure(
      deliverExecutorResultReceipt({ dispatchId, store }),
      EXECUTOR_RESULT_DELIVERY_CONFLICT,
    );
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.equal(readFileSync(resultJsonPath(home, child), 'utf8'), foreignBytes);
    assert.equal((await store.readTask(child)).status, TASK_STATUS_RESULT_DELIVERED);
  } finally {
    removeHome(home);
  }
});

test('L.2 already-delivered different resultId fails closed and the first result is preserved', async () => {
  const { home, clock, store, dispatchId, child } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-l2-',
    sourceTaskId: 'DLV34-L2-SRC',
    childTaskId: 'DLV34-L2-CHILD',
  });
  try {
    const claim = store.readClaim(child);
    const foreign = {
      schemaVersion: '1',
      resultId: 'result-foreign-first-winner',
      taskId: child,
      workerId: claim.workerId,
      claimToken: claim.claimToken,
      claimGeneration: claim.generation,
      status: EXECUTOR_RESULT_RECEIPT_STATUS_SUCCEEDED,
      summary: 'foreign canonical result',
      proofRefs: ['proof:foreign'],
      evidenceRefs: [],
      frictionObserved: [],
      deliveredAt: new Date(clock.now).toISOString(),
    };
    writeJsonFile(resultJsonPath(home, child), foreign);
    const foreignBytes = readFileSync(resultJsonPath(home, child), 'utf8');
    const before = snapshotHomeBytes(home);
    await expectFailure(
      deliverExecutorResultReceipt({ dispatchId, store }),
      EXECUTOR_RESULT_DELIVERY_CONFLICT,
    );
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.equal(readFileSync(resultJsonPath(home, child), 'utf8'), foreignBytes);
    assert.equal(existsSync(resultsDir(home, child)), false);
    assert.equal((await store.readTask(child)).status, TASK_STATUS_CLAIMED);
  } finally {
    removeHome(home);
  }
});

test('L.3 same resultId with different evidence fails closed without any per-id write', async () => {
  const { home, clock, store, dispatchId, child, receipt } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-l3-',
    sourceTaskId: 'DLV34-L3-SRC',
    childTaskId: 'DLV34-L3-CHILD',
  });
  try {
    const claim = store.readClaim(child);
    const divergent = {
      schemaVersion: '1',
      resultId: buildExecutorResultId(dispatchId),
      taskId: child,
      workerId: claim.workerId,
      claimToken: claim.claimToken,
      claimGeneration: claim.generation,
      status: receipt.status,
      summary: receipt.summary,
      proofRefs: ['proof:divergent-evidence'],
      evidenceRefs: [...receipt.evidenceRefs],
      frictionObserved: [...receipt.frictionObserved],
      deliveredAt: new Date(clock.now).toISOString(),
    };
    writeJsonFile(resultJsonPath(home, child), divergent);
    const divergentBytes = readFileSync(resultJsonPath(home, child), 'utf8');
    const before = snapshotHomeBytes(home);
    await expectFailure(
      deliverExecutorResultReceipt({ dispatchId, store }),
      EXECUTOR_RESULT_DELIVERY_CONFLICT,
    );
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.equal(readFileSync(resultJsonPath(home, child), 'utf8'), divergentBytes);
    assert.equal(existsSync(resultsDir(home, child)), false);
    assert.equal((await store.readTask(child)).status, TASK_STATUS_CLAIMED);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// LIFECYCLE. NON-DELIVERABLE STATES -> DELIVERY 0.
// ---------------------------------------------------------------------------

test('LIFECYCLE.1 READY task lifecycle never delivers', async () => {
  const { home, store, dispatchId, child } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-lc1-',
    sourceTaskId: 'DLV34-LC1-SRC',
    childTaskId: 'DLV34-LC1-CHILD',
  });
  try {
    const task = readJsonFile(taskJsonPath(home, child));
    task.status = TASK_STATUS_READY;
    writeJsonFile(taskJsonPath(home, child), task);
    const before = snapshotHomeBytes(home);
    await expectFailure(
      deliverExecutorResultReceipt({ dispatchId, store }),
      EXECUTOR_RESULT_DELIVERY_TASK_STATE_NOT_DELIVERABLE,
    );
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.equal(existsSync(resultJsonPath(home, child)), false);
    assert.equal(existsSync(resultsDir(home, child)), false);
    assert.equal(readJsonFile(taskJsonPath(home, child)).status, TASK_STATUS_READY);
  } finally {
    removeHome(home);
  }
});

test('LIFECYCLE.2 RESULT_DELIVERED without a canonical result fails closed with no repair', async () => {
  const { home, store, dispatchId, child } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-lc2-',
    sourceTaskId: 'DLV34-LC2-SRC',
    childTaskId: 'DLV34-LC2-CHILD',
  });
  try {
    const task = readJsonFile(taskJsonPath(home, child));
    task.status = TASK_STATUS_RESULT_DELIVERED;
    writeJsonFile(taskJsonPath(home, child), task);
    const before = snapshotHomeBytes(home);
    await expectFailure(
      deliverExecutorResultReceipt({ dispatchId, store }),
      'RESULT_NOT_FOUND',
    );
    assert.deepEqual(snapshotHomeBytes(home), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// AUTH. DURABLE DISPATCH AUTHORITY FAIL-CLOSED CASES.
// ---------------------------------------------------------------------------

test('AUTH.1 missing durable dispatch authority fails closed with delivery 0', async () => {
  const { home, store, dispatchId, child } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-auth1-',
    sourceTaskId: 'DLV34-AUTH1-SRC',
    childTaskId: 'DLV34-AUTH1-CHILD',
  });
  try {
    rmSync(invocationAttemptPath(home, dispatchId));
    const before = snapshotHomeBytes(home);
    await expectFailure(
      deliverExecutorResultReceipt({ dispatchId, store }),
      EXECUTOR_RESULT_DELIVERY_DISPATCH_AUTHORITY_NOT_FOUND,
    );
    assert.deepEqual(snapshotHomeBytes(home), before);
    assertNoCanonicalDelivery(home, child);
  } finally {
    removeHome(home);
  }
});

test('AUTH.2 corrupt durable dispatch authority propagates predecessor codes with delivery 0', async () => {
  const { home, store, dispatchId, child } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-auth2-',
    sourceTaskId: 'DLV34-AUTH2-SRC',
    childTaskId: 'DLV34-AUTH2-CHILD',
  });
  try {
    writeFileSync(invocationAttemptPath(home, dispatchId), '{not json', 'utf8');
    const before = snapshotHomeBytes(home);
    await expectFailure(
      deliverExecutorResultReceipt({ dispatchId, store }),
      'CORRUPT_EXECUTOR_INVOCATION_ATTEMPT',
    );
    assert.deepEqual(snapshotHomeBytes(home), before);
    assertNoCanonicalDelivery(home, child);
  } finally {
    removeHome(home);
  }
});

test('AUTH.3 dispatch authority key/binding mismatch fails closed with delivery 0', async () => {
  const first = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-auth3-',
    sourceTaskId: 'DLV34-AUTH3-SRC',
    childTaskId: 'DLV34-AUTH3-CHILD',
  });
  const foreign = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-auth3-foreign-',
    sourceTaskId: 'DLV34-AUTH3-FSRC',
    childTaskId: 'DLV34-AUTH3-FCHILD',
  });
  try {
    const foreignAuthority = foreign.store.readExecutorInvocationAttempt(foreign.dispatchId);
    const { store: recorded, calls } = recordingStore(first.store, {
      readExecutorInvocationAttempt: () => foreignAuthority,
    });
    const before = snapshotHomeBytes(first.home);
    await expectFailure(
      deliverExecutorResultReceipt({ dispatchId: first.dispatchId, store: recorded }),
      'CORRUPT_EXECUTOR_INVOCATION_ATTEMPT',
    );
    assert.deepEqual(calls, ['readExecutorResultReceipt', 'readExecutorInvocationAttempt']);
    assert.deepEqual(snapshotHomeBytes(first.home), before);
    assertNoCanonicalDelivery(first.home, first.child);
  } finally {
    removeHome(first.home);
    removeHome(foreign.home);
  }
});

// ---------------------------------------------------------------------------
// N. NO DISPOSITION / ACK / MATERIALIZATION / CURSOR MUTATION.
// ---------------------------------------------------------------------------

test('N. delivery creates no disposition / ACK / materialization / cursor artifact', async () => {
  const { home, store, dispatchId, child } = await setupReceiptChain({
    prefix: 'greenhub-executor-result-delivery34-n-',
    sourceTaskId: 'DLV34-N-SRC',
    childTaskId: 'DLV34-N-CHILD',
  });
  try {
    const beforeKeys = Object.keys(snapshotHomeBytes(home));
    await deliverExecutorResultReceipt({ dispatchId, store });
    const afterKeys = Object.keys(snapshotHomeBytes(home));
    const added = afterKeys.filter((key) => !beforeKeys.includes(key));
    for (const key of added) {
      assert.equal(key.includes('disposition'), false, key);
      assert.equal(key.includes('ack'), false, key);
      assert.equal(key.includes('materialization'), false, key);
      assert.equal(key.includes('consumed'), false, key);
      assert.equal(key.includes('cursor'), false, key);
    }
    assert.deepEqual(
      added.sort(),
      [
        join('tasks', child, 'result.json'),
        join('tasks', child, 'results', `${buildExecutorResultId(dispatchId)}.json`),
      ].sort(),
    );
    assert.equal(existsSync(join(home, 'consumption', 'cursor.json')), false);
    assert.equal(existsSync(join(home, 'tasks', child, 'disposition')), false);
    assert.equal(existsSync(join(home, 'tasks', child, 'ack.json')), false);
    assert.equal(existsSync(join(home, 'tasks', child, 'materialization.json')), false);
    assert.equal(existsSync(join(home, 'tasks', child, 'consumed.json')), false);
  } finally {
    removeHome(home);
  }
});
