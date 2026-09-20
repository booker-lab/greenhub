// Proof for GREENHUB-COORDINATION-DURABLE-EXECUTOR-INVOCATION-OUTCOME-32.
//
// VALIDATED_EXECUTOR_INVOCATION_OUTCOME(dispatchId)         [Task 30]
//   -> DURABLY_RECORDED_EXECUTOR_INVOCATION_OUTCOME(dispatchId)  [Task 32].
//
// DURABLY_RECORDED_EXECUTOR_INVOCATION_OUTCOME != task started != task RUNNING
// != task completed != task succeeded != executor receipt persisted != semantic
// task acceptance != result produced != ACK != global delivery success
// != retry permission != global exactly-once executor invocation.
//
// The entry is EXACTLY one composition path:
//   (dispatchId, store, adapter)
//     1. store capability gate (readExecutorInvocationOutcome /
//        createExecutorInvocationOutcome / readExecutorResultReceipt ONLY)
//     2. dispatchId identity validation (Task 28 identity family verbatim)
//     3. store.readExecutorInvocationOutcome(dispatchId) — durable-first
//     4. existing valid durable outcome -> authoritative replay: zero adapter
//        invocations, zero writes, zero byte/mtime change, never retry
//     5. outcome absent -> store.readExecutorResultReceipt(dispatchId)
//        cross-boundary fence: an existing valid Task 33 receipt fails closed
//        (EXECUTOR_INVOCATION_OUTCOME_ABSENT_FOR_RECORDED_RECEIPT) with zero
//        adapter invocations, zero writes, and no repair; this is the exact
//        mirror of Task 33's recorded-outcome fence
//     6. neither record exists -> invokeExecutorAndValidateOutcome({ dispatchId,
//        store, adapter }) exactly once [Task 30 verbatim]
//     7. OS exclusive-create of the EXACT canonical Task 30 outcome under
//        <home>/executor-invocation-outcomes/<dispatchId>.json
//     8. exact durable read-back verification
//     9. race loser -> winner re-read: same = idempotent convergence,
//        different valid = fail-closed conflict, corrupt = fail closed;
//        the first durable winner is preserved
//   Adapter/process throw or rejection reaches the caller with the exact same
//   value: never converted to UNKNOWN/REJECTED, never caught, never retried,
//   and never persisted.
//
// Global exactly-once executor invocation is NOT claimed: two concurrent
// processes can both observe an absent durable outcome AND an absent durable
// receipt and both enter Task 30; OS exclusive-create serializes only the
// durable outcome winner.
//
// Proof map:
//   A. ACCEPTED is persisted exactly (three fields, exclusive-create, one call).
//   B. REJECTED is persisted exactly.
//   C. UNKNOWN is persisted exactly; UNKNOWN is not retry permission.
//   D. existing durable ACCEPTED: zero adapter calls, zero writes.
//   E. existing durable REJECTED: zero adapter calls, zero writes.
//   F. existing durable UNKNOWN: zero adapter calls, zero writes.
//   G. unseen dispatchId: Task 30 composed exactly once (single attempt read,
//      single receipt fence read, single adapter invocation, single durable
//      outcome read before create).
//   H. created record is verified by exact durable read-back; a tampered or
//      vanished read-back fails closed.
//   I. exclusive-create race loser with the same valid winner converges
//      idempotently (first winner untouched).
//   J. exclusive-create race loser with a different valid winner fails closed
//      and the first durable winner is preserved; corrupt winner fails closed.
//   K. corrupt existing outcome: fail closed, zero adapter calls, zero repair.
//   L. invalid Task 30 outcome: fail closed, zero durable writes.
//   M. adapter throw/rejection: exact identity propagation, zero durable writes.
//   N. Codex CLI process-start failure: typed error propagation, zero durable
//      outcome.
//   O. task stays CLAIMED: no status transition, claim/lease untouched.
//   P. no ACK/receipt/result/disposition artifact or store primitive.
//   Q. no new generation authority.
//   R. no retry/fallback/registry authority (static + behavioral).
//   S. Task 24~31 predecessor surfaces and semantics stay intact.
//   T. durable replay never changes bytes or mtimes.
//   U. cross-boundary receipt fence: a durable Task 33 receipt (all status
//      values) refuses the outcome entry with zero adapter calls, zero writes,
//      unchanged receipt/attempt bytes; corrupt/mismatched receipts fail
//      closed; outcome + receipt both present still replays the outcome
//      read-only; the mirror Task 33 fence stays intact.
//   CONCURRENCY. two real processes -> exactly one durable winner, each entered
//      path invokes the adapter at most once, total invocation may be 2.
//   STORE. durable read/create primitives: missing -> null, exact canonical,
//      exclusive-create, key/binding mismatch and corruption fail closed.
//   STORE-STATIC. store section uses exclusive-create and the exact durable
//      value validator only; the store never invokes Task 30 or an adapter.
//   STATIC. production module boundary + exact exported surface.
//
// All runtime state lives in isolated temp directories. No network required.

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
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CODEX_CLI_EXECUTOR_PROCESS_START_FAILED,
  CodexCliExecutorAdapterError,
  createCodexCliExecutorAdapter,
} from './codex-cli-executor-adapter.mjs';
import {
  acceptExecutorDispatchDecision,
  executorDispatchAcceptanceFilePath,
} from './dispatch-executor-acceptance.mjs';
import {
  CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
  EXECUTOR_INVOCATION_ATTEMPTS_DIRNAME,
  executorInvocationAttemptFilePath,
  persistExecutorInvocationAttempt,
} from './dispatch-executor-invocation-attempt.mjs';
import {
  EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND,
  ExecutorInvocationContractError,
  invokeExecutorInvocationAdapter,
} from './dispatch-executor-invocation-contract.mjs';
import * as outcomeModule from './dispatch-executor-invocation-outcome.mjs';
import {
  EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
  EXECUTOR_INVOCATION_OUTCOME_FIELDS,
  EXECUTOR_INVOCATION_OUTCOME_REJECTED,
  EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION,
  EXECUTOR_INVOCATION_OUTCOME_VALUES,
  ExecutorInvocationOutcomeError,
  INVALID_EXECUTOR_INVOCATION_OUTCOME,
  invokeExecutorAndValidateOutcome,
} from './dispatch-executor-invocation-outcome.mjs';
import * as persistenceModule from './dispatch-executor-invocation-outcome-persistence.mjs';
import {
  CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
  EXECUTOR_INVOCATION_OUTCOMES_DIRNAME,
  EXECUTOR_INVOCATION_OUTCOME_ABSENT_FOR_RECORDED_RECEIPT,
  EXECUTOR_INVOCATION_OUTCOME_CONFLICT,
  EXECUTOR_INVOCATION_OUTCOME_PERSISTENCE_NEW_FIELDS,
  EXECUTOR_INVOCATION_OUTCOME_PERSISTENCE_REPLAY_FIELDS,
  ExecutorInvocationOutcomePersistenceError,
  INVALID_EXECUTOR_INVOCATION_OUTCOME_STORE,
  executorInvocationOutcomeFilePath,
  persistExecutorInvocationOutcome,
  validateExecutorInvocationOutcomeRecord,
} from './dispatch-executor-invocation-outcome-persistence.mjs';
import { acceptReceiverDispatch } from './dispatch-receiver-acceptance.mjs';
import {
  persistReceiverDecision,
  receiverDispatchDecisionFilePath,
} from './dispatch-receiver-decision.mjs';
import { prepareDispatchTransportRequest } from './dispatch-transport-contract.mjs';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import {
  CORRUPT_EXECUTOR_RESULT_RECEIPT,
  EXECUTOR_RESULT_RECEIPTS_DIRNAME,
  EXECUTOR_RESULT_RECEIPT_ABSENT_FOR_RECORDED_OUTCOME,
  EXECUTOR_RESULT_RECEIPT_SCHEMA_VERSION,
  EXECUTOR_RESULT_RECEIPT_STATUS_BLOCKED,
  EXECUTOR_RESULT_RECEIPT_STATUS_FAILED,
  EXECUTOR_RESULT_RECEIPT_STATUS_SUCCEEDED,
  persistExecutorResultReceipt,
} from './executor-result-receipt.mjs';
import { CoordinationStore } from './store.mjs';
import { TASK_STATUS_CLAIMED } from './task-envelope.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = join(MODULE_DIRECTORY, 'dispatch-executor-invocation-outcome-persistence.mjs');
const STORE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'store.mjs')).href;
const MODULE_URL = pathToFileURL(MODULE_PATH).href;

const FORBIDDEN_DURABLE_TOKENS = Object.freeze([
  'acceptedAt',
  'rejectedAt',
  'unknownAt',
  'invokedAt',
  'startedAt',
  'completedAt',
  'attemptedAt',
  'createdAt',
  'updatedAt',
  'pid',
  'hostname',
  'workerId',
  'executorId',
  'retryCount',
  'attemptNumber',
  'invocationGeneration',
  'executorGeneration',
  'executionGeneration',
  'retryGeneration',
  'generation',
  'status',
  'receipt',
  'resultId',
  'disposition',
]);

function makeHome(prefix = 'greenhub-executor-invocation-outcome32-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'DURABLE_EXECUTOR_INVOCATION_OUTCOME_PROVED',
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
    mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['durable-executor-invocation-outcome-proof'],
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

function driveToClaimed(
  store,
  clock,
  sourceTaskId,
  childTaskId,
  sourceResultId = 'result-0001',
  workerId = 'worker-a',
) {
  const setup = driveToAdmitted(store, clock, sourceTaskId, childTaskId, sourceResultId);
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
) {
  const setup = driveToClaimed(store, clock, sourceTaskId, childTaskId, sourceResultId, workerId);
  const attempt = store.persistDispatchAttempt({ sourceTaskId, workerId });
  clock.advance(1000);
  return { ...setup, attempt };
}

// Task 32 setup: the full Task 18~28 durable chain ends with the durable Task
// 28 executor invocation attempt (the exact record Task 29 hands to Task 30).
// NO durable Task 32 outcome exists yet.
async function setupAccepted(prefix, sourceTaskId, childTaskId) {
  const home = makeHome(prefix);
  const clock = controllableClock();
  const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
  const { attempt } = driveToAttempt(
    store,
    clock,
    sourceTaskId,
    childTaskId,
    `result-${sourceTaskId.toLowerCase()}`,
  );
  const request = prepareDispatchTransportRequest({
    store,
    sourceTaskId,
    dispatchId: attempt.dispatchId,
  });
  const accepted = await acceptReceiverDispatch({ request, store });
  assert.equal(accepted.newlyAccepted, true);
  const decided = await persistReceiverDecision({ dispatchId: attempt.dispatchId, store });
  assert.equal(decided.newlyDecided, true);
  const executorAccepted = await acceptExecutorDispatchDecision({
    dispatchId: attempt.dispatchId,
    store,
  });
  assert.equal(executorAccepted.newlyAccepted, true);
  const persisted = await persistExecutorInvocationAttempt({
    dispatchId: attempt.dispatchId,
    store,
  });
  assert.equal(persisted.newlyPersisted, true);
  return { home, clock, store, attempt, dispatchId: attempt.dispatchId };
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

function outcomePath(home, dispatchId) {
  return executorInvocationOutcomeFilePath(home, dispatchId);
}

function listOutcomeFiles(home) {
  try {
    return [...readdirSync(join(home, EXECUTOR_INVOCATION_OUTCOMES_DIRNAME))].sort();
  } catch {
    return [];
  }
}

function expectedRecordBytes(record) {
  return JSON.stringify(record, null, 2);
}

function writeOutcomeBytes(home, dispatchId, bytes) {
  const path = outcomePath(home, dispatchId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes, 'utf8');
  return path;
}

function validOutcome(dispatchId, outcome) {
  return { schemaVersion: 1, dispatchId, outcome };
}

function countingAdapter(impl) {
  const calls = [];
  const adapter = async (record) => {
    calls.push({ record });
    return impl(record, calls.length);
  };
  return { calls, adapter };
}

// Strongest "no alternate primitive consulted" probe: every function-valued
// property invocation is recorded with its arguments.
function proxyCountingStore(target) {
  const calls = [];
  const store = new Proxy(target, {
    get(object, property, receiver) {
      const value = Reflect.get(object, property, receiver);
      if (typeof value === 'function') {
        return (...args) => {
          calls.push({ op: property, args });
          return value.apply(object, args);
        };
      }
      return value;
    },
  });
  return { calls, store };
}

function seedOutcome(store, dispatchId, outcome) {
  const created = store.createExecutorInvocationOutcome(validOutcome(dispatchId, outcome));
  assert.deepEqual(created, { created: true });
}

// A valid Task 33 durable executor result receipt (the cross-boundary fence
// authority) for this spec's dispatchId/child task.
function validReceipt(dispatchId, taskId, overrides = {}) {
  return {
    schemaVersion: EXECUTOR_RESULT_RECEIPT_SCHEMA_VERSION,
    dispatchId,
    taskId,
    status: EXECUTOR_RESULT_RECEIPT_STATUS_SUCCEEDED,
    summary: 'bounded structured executor evidence',
    proofRefs: ['proof:structured-result'],
    evidenceRefs: ['evidence:structured-result'],
    frictionObserved: ['NONE'],
    ...overrides,
  };
}

function receiptPath(home, dispatchId) {
  return join(home, EXECUTOR_RESULT_RECEIPTS_DIRNAME, `${dispatchId}.json`);
}

// Simulates a lost exclusive-create race deterministically: the first durable
// read reports "unseen" even though a real winner already exists on disk; then
// create delegates to the real store and loses; winner reads delegate.
function raceLoserStore(store) {
  const calls = [];
  let reads = 0;
  const wrapper = {
    readExecutorInvocationOutcome: (dispatchId) => {
      reads += 1;
      calls.push({ op: 'readExecutorInvocationOutcome', readIndex: reads });
      if (reads === 1) return null;
      return store.readExecutorInvocationOutcome(dispatchId);
    },
    createExecutorInvocationOutcome: (record) => {
      calls.push({ op: 'createExecutorInvocationOutcome' });
      return store.createExecutorInvocationOutcome(record);
    },
    readExecutorInvocationAttempt: (dispatchId) => {
      calls.push({ op: 'readExecutorInvocationAttempt' });
      return store.readExecutorInvocationAttempt(dispatchId);
    },
    readExecutorResultReceipt: (dispatchId) => {
      calls.push({ op: 'readExecutorResultReceipt' });
      return store.readExecutorResultReceipt(dispatchId);
    },
  };
  return { calls, store: wrapper };
}

function runFreshOutcomeWorker({ home, dispatchId, outcome }) {
  return new Promise((resolveResult, rejectResult) => {
    const code = [
      'try {',
      `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
      `  const { persistExecutorInvocationOutcome } = await import(${JSON.stringify(MODULE_URL)});`,
      '  let adapterCalls = 0;',
      '  const adapter = async (record) => {',
      '    adapterCalls += 1;',
      `    return { schemaVersion: 1, dispatchId: record.dispatchId, outcome: ${JSON.stringify(outcome)} };`,
      '  };',
      `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
      `  const result = await persistExecutorInvocationOutcome({ dispatchId: ${JSON.stringify(dispatchId)}, store, adapter });`,
      `  const record = store.readExecutorInvocationOutcome(${JSON.stringify(dispatchId)});`,
      '  console.log(JSON.stringify({ ok: true, result, record, adapterCalls }));',
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
      const line = stdout.split('\n').reverse().find((entry) => entry.trim().length > 0);
      if (!line) {
        rejectResult(new Error(`outcome worker produced no output (exit=${exitCode}): ${stderr}`));
        return;
      }
      resolveResult(JSON.parse(line));
    });
  });
}

async function assertExactPersistence(prefix, sourceTaskId, childTaskId, outcome) {
  const { home, store, dispatchId } = await setupAccepted(prefix, sourceTaskId, childTaskId);
  try {
    const before = snapshotHomeBytes(home);
    const { calls, adapter } = countingAdapter(() => validOutcome(dispatchId, outcome));
    const result = await persistExecutorInvocationOutcome({ dispatchId, store, adapter });

    // Exact minimal result shape, frozen.
    assert.deepEqual(result, { dispatchId, newlyRecorded: true, outcome });
    assert.deepEqual(Object.keys(result), [...EXECUTOR_INVOCATION_OUTCOME_PERSISTENCE_NEW_FIELDS]);
    assert.equal(Object.isFrozen(result), true);

    // Exactly one adapter invocation with the EXACT Task 28 record.
    assert.equal(calls.length, 1);
    assert.equal(
      JSON.stringify(calls[0].record),
      JSON.stringify(store.readExecutorInvocationAttempt(dispatchId)),
    );

    // The durable value is EXACTLY the three-field Task 30 outcome.
    const path = outcomePath(home, dispatchId);
    const record = validOutcome(dispatchId, outcome);
    assert.equal(readFileSync(path, 'utf8'), expectedRecordBytes(record));
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), record);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(path, 'utf8'))), [
      'schemaVersion',
      'dispatchId',
      'outcome',
    ]);
    assert.deepEqual(store.readExecutorInvocationOutcome(dispatchId), record);
    assert.equal(Object.isFrozen(store.readExecutorInvocationOutcome(dispatchId)), true);
    for (const token of FORBIDDEN_DURABLE_TOKENS) {
      assert.equal(readFileSync(path, 'utf8').includes(token), false, token);
    }

    // Exactly one new durable path: the outcome record.
    const after = snapshotHomeBytes(home);
    const added = Object.keys(after).filter((name) => !(name in before));
    assert.deepEqual(added, [join(EXECUTOR_INVOCATION_OUTCOMES_DIRNAME, `${dispatchId}.json`)]);
    assert.deepEqual(listOutcomeFiles(home), [`${dispatchId}.json`]);

    // The attempt and receiver-decision domains stay byte-identical.
    assert.equal(readFileSync(outcomePath(home, dispatchId), 'utf8'), expectedRecordBytes(record));
    assert.equal(existsSync(executorInvocationAttemptFilePath(home, dispatchId)), true);
    assert.equal(existsSync(executorDispatchAcceptanceFilePath(home, dispatchId)), true);
    assert.equal(existsSync(receiverDispatchDecisionFilePath(home, dispatchId)), true);
  } finally {
    removeHome(home);
  }
}

// ---------------------------------------------------------------------------
// A/B/C. ACCEPTED / REJECTED / UNKNOWN exact persistence.
// ---------------------------------------------------------------------------

test('A. ACCEPTED is persisted exactly: three fields, exclusive-create, one adapter call', async () => {
  await assertExactPersistence(
    'greenhub-executor-invocation-outcome32-a-',
    'EIOP32-A-SRC',
    'EIOP32-A-CHILD',
    EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
  );
});

test('B. REJECTED is persisted exactly: three fields, exclusive-create, one adapter call', async () => {
  await assertExactPersistence(
    'greenhub-executor-invocation-outcome32-b-',
    'EIOP32-B-SRC',
    'EIOP32-B-CHILD',
    EXECUTOR_INVOCATION_OUTCOME_REJECTED,
  );
});

test('C. UNKNOWN is persisted exactly and never becomes retry permission', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-executor-invocation-outcome32-c-',
    'EIOP32-C-SRC',
    'EIOP32-C-CHILD',
  );
  try {
    const { calls, adapter } = countingAdapter(() => validOutcome(dispatchId, 'UNKNOWN'));
    const result = await persistExecutorInvocationOutcome({ dispatchId, store, adapter });
    assert.deepEqual(result, { dispatchId, newlyRecorded: true, outcome: 'UNKNOWN' });
    assert.equal(calls.length, 1);
    assert.deepEqual(store.readExecutorInvocationOutcome(dispatchId), validOutcome(dispatchId, 'UNKNOWN'));

    // A later call with a would-be new adapter does not re-invoke and does not
    // treat UNKNOWN as retry permission.
    const replayAdapter = countingAdapter(() => {
      throw new Error('UNKNOWN replay must never re-invoke the executor');
    });
    const replay = await persistExecutorInvocationOutcome({
      dispatchId,
      store,
      adapter: replayAdapter.adapter,
    });
    assert.equal(replay.newlyRecorded, false);
    assert.equal(replay.exactReplay, true);
    assert.equal(replay.outcome, 'UNKNOWN');
    assert.equal(replayAdapter.calls.length, 0);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// D/E/F. Existing durable outcome: zero adapter calls, zero writes.
// ---------------------------------------------------------------------------

async function assertReplayWithoutWrites(prefix, sourceTaskId, childTaskId, outcome) {
  const { home, store, dispatchId } = await setupAccepted(prefix, sourceTaskId, childTaskId);
  try {
    seedOutcome(store, dispatchId, outcome);
    const bytesBefore = snapshotHomeBytes(home);
    const { calls, adapter } = countingAdapter(() => {
      throw new Error('adapter must never be called when a durable outcome exists');
    });
    const result = await persistExecutorInvocationOutcome({ dispatchId, store, adapter });
    assert.deepEqual(result, {
      dispatchId,
      newlyRecorded: false,
      exactReplay: true,
      outcome,
    });
    assert.deepEqual(Object.keys(result), [...EXECUTOR_INVOCATION_OUTCOME_PERSISTENCE_REPLAY_FIELDS]);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(calls.length, 0);
    assert.deepEqual(snapshotHomeBytes(home), bytesBefore);
    assert.deepEqual(listOutcomeFiles(home), [`${dispatchId}.json`]);
  } finally {
    removeHome(home);
  }
}

test('D. existing durable ACCEPTED replays with zero adapter calls and zero writes', async () => {
  await assertReplayWithoutWrites(
    'greenhub-executor-invocation-outcome32-d-',
    'EIOP32-D-SRC',
    'EIOP32-D-CHILD',
    'ACCEPTED',
  );
});

test('E. existing durable REJECTED replays with zero adapter calls and zero writes', async () => {
  await assertReplayWithoutWrites(
    'greenhub-executor-invocation-outcome32-e-',
    'EIOP32-E-SRC',
    'EIOP32-E-CHILD',
    'REJECTED',
  );
});

test('F. existing durable UNKNOWN replays with zero adapter calls and zero writes', async () => {
  await assertReplayWithoutWrites(
    'greenhub-executor-invocation-outcome32-f-',
    'EIOP32-F-SRC',
    'EIOP32-F-CHILD',
    'UNKNOWN',
  );
});

// ---------------------------------------------------------------------------
// G. Unseen: Task 30 composition exactly once.
// ---------------------------------------------------------------------------

test('G. unseen dispatchId composes Task 30 exactly once and consults only dispatchId-keyed primitives', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-executor-invocation-outcome32-g-',
    'EIOP32-G-SRC',
    'EIOP32-G-CHILD',
  );
  try {
    const { calls, store: spyStore } = proxyCountingStore(store);
    const { calls: adapterCalls, adapter } = countingAdapter(() =>
      validOutcome(dispatchId, 'ACCEPTED'),
    );
    const result = await persistExecutorInvocationOutcome({
      dispatchId,
      store: spyStore,
      adapter,
    });
    assert.equal(result.newlyRecorded, true);

    // Exactly one durable outcome read, one cross-boundary receipt fence read,
    // one Task 28 attempt read (Task 29/30 composition), one exclusive-create,
    // one read-back.
    assert.deepEqual(
      calls.map((call) => call.op),
      [
        'readExecutorInvocationOutcome',
        'readExecutorResultReceipt',
        'readExecutorInvocationAttempt',
        'createExecutorInvocationOutcome',
        'readExecutorInvocationOutcome',
      ],
    );
    for (const call of calls) {
      assert.equal(call.args.length, 1);
      if (call.op === 'createExecutorInvocationOutcome') {
        assert.deepEqual(Object.keys(call.args[0]), ['schemaVersion', 'dispatchId', 'outcome']);
        assert.equal(call.args[0].dispatchId, dispatchId);
        continue;
      }
      assert.equal(call.args[0], dispatchId);
    }

    // Task 30 was entered once: exactly one adapter invocation.
    assert.equal(adapterCalls.length, 1);
    assert.equal(adapterCalls[0].record.dispatchId, dispatchId);
    assert.equal(Object.hasOwn(result, 'sourceTaskId'), false);
    assert.equal(Object.hasOwn(result, 'workerId'), false);
    assert.equal(Object.hasOwn(result, 'admissionId'), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// H. Created record verified by exact durable read-back.
// ---------------------------------------------------------------------------

test('H. exclusive-create is verified by exact durable read-back; tampered or vanished read-back fails closed', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-executor-invocation-outcome32-h-',
    'EIOP32-H-SRC',
    'EIOP32-H-CHILD',
  );
  try {
    // Tampered read-back: the create really wins, but the read-back returns a
    // different valid outcome -> fail closed (never silently accepted).
    let reads = 0;
    const tampered = validOutcome(dispatchId, 'REJECTED');
    const tamperedStore = {
      readExecutorInvocationOutcome: (id) => {
        reads += 1;
        if (reads === 1) return null;
        if (reads === 2) return JSON.parse(JSON.stringify(tampered));
        return store.readExecutorInvocationOutcome(id);
      },
      createExecutorInvocationOutcome: (record) => store.createExecutorInvocationOutcome(record),
      readExecutorInvocationAttempt: (id) => store.readExecutorInvocationAttempt(id),
      readExecutorResultReceipt: (id) => store.readExecutorResultReceipt(id),
    };
    const { calls, adapter } = countingAdapter(() => validOutcome(dispatchId, 'ACCEPTED'));
    await assert.rejects(
      persistExecutorInvocationOutcome({ dispatchId, store: tamperedStore, adapter }),
      (error) =>
        error instanceof ExecutorInvocationOutcomePersistenceError &&
        error.code === CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
    );
    assert.equal(calls.length, 1);
    // The exclusive-create itself succeeded: the disk still carries the created
    // ACCEPTED record, and the read-back mismatch was detected (no repair).
    assert.deepEqual(store.readExecutorInvocationOutcome(dispatchId), validOutcome(dispatchId, 'ACCEPTED'));

    // Vanished read-back: create reports success but the record is not
    // readable afterwards -> fail closed.
    let vanishedReads = 0;
    const vanishedStore = {
      readExecutorInvocationOutcome: (id) => {
        vanishedReads += 1;
        if (vanishedReads === 1) return null;
        if (vanishedReads === 2) return null;
        return store.readExecutorInvocationOutcome(id);
      },
      createExecutorInvocationOutcome: () => ({ created: true }),
      readExecutorInvocationAttempt: (id) => store.readExecutorInvocationAttempt(id),
      readExecutorResultReceipt: (id) => store.readExecutorResultReceipt(id),
    };
    const { adapter: adapter2 } = countingAdapter(() => validOutcome(dispatchId, 'ACCEPTED'));
    await assert.rejects(
      persistExecutorInvocationOutcome({ dispatchId, store: vanishedStore, adapter: adapter2 }),
      (error) =>
        error instanceof ExecutorInvocationOutcomePersistenceError &&
        error.code === CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// I. Race loser + same valid winner: idempotent convergence.
// ---------------------------------------------------------------------------

test('I. exclusive-create race loser with the same valid winner converges idempotently', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-executor-invocation-outcome32-i-',
    'EIOP32-I-SRC',
    'EIOP32-I-CHILD',
  );
  try {
    seedOutcome(store, dispatchId, 'ACCEPTED');
    const bytesBefore = readFileSync(outcomePath(home, dispatchId), 'utf8');
    const { calls: storeCalls, store: raceStore } = raceLoserStore(store);
    const { calls, adapter } = countingAdapter(() => validOutcome(dispatchId, 'ACCEPTED'));
    const result = await persistExecutorInvocationOutcome({
      dispatchId,
      store: raceStore,
      adapter,
    });
    assert.deepEqual(result, {
      dispatchId,
      newlyRecorded: false,
      exactReplay: true,
      outcome: 'ACCEPTED',
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(
      storeCalls.map((call) => call.op),
      [
        'readExecutorInvocationOutcome',
        'readExecutorResultReceipt',
        'readExecutorInvocationAttempt',
        'createExecutorInvocationOutcome',
        'readExecutorInvocationOutcome',
      ],
    );
    assert.equal(readFileSync(outcomePath(home, dispatchId), 'utf8'), bytesBefore);
    assert.deepEqual(store.readExecutorInvocationOutcome(dispatchId), validOutcome(dispatchId, 'ACCEPTED'));
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// J. Race loser + different valid winner: fail-closed conflict, first wins.
// ---------------------------------------------------------------------------

test('J. race loser with a different valid winner fails closed and the first winner is preserved', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-executor-invocation-outcome32-j-',
    'EIOP32-J-SRC',
    'EIOP32-J-CHILD',
  );
  try {
    seedOutcome(store, dispatchId, 'REJECTED');
    const bytesBefore = readFileSync(outcomePath(home, dispatchId), 'utf8');
    const { store: raceStore } = raceLoserStore(store);
    const { calls, adapter } = countingAdapter(() => validOutcome(dispatchId, 'ACCEPTED'));
    await assert.rejects(
      persistExecutorInvocationOutcome({ dispatchId, store: raceStore, adapter }),
      (error) =>
        error instanceof ExecutorInvocationOutcomePersistenceError &&
        error.code === EXECUTOR_INVOCATION_OUTCOME_CONFLICT,
    );
    assert.equal(calls.length, 1);
    // The first durable winner is preserved byte-for-byte.
    assert.equal(readFileSync(outcomePath(home, dispatchId), 'utf8'), bytesBefore);
    assert.deepEqual(store.readExecutorInvocationOutcome(dispatchId), validOutcome(dispatchId, 'REJECTED'));

    // Corrupt winner: fail closed, never repaired.
    let reads = 0;
    const corruptWinnerStore = {
      readExecutorInvocationOutcome: (id) => {
        reads += 1;
        if (reads === 1) return null;
        if (reads === 2) return { hello: 'not-an-outcome' };
        return store.readExecutorInvocationOutcome(id);
      },
      createExecutorInvocationOutcome: (record) => store.createExecutorInvocationOutcome(record),
      readExecutorInvocationAttempt: (id) => store.readExecutorInvocationAttempt(id),
      readExecutorResultReceipt: (id) => store.readExecutorResultReceipt(id),
    };
    const { adapter: adapter2 } = countingAdapter(() => validOutcome(dispatchId, 'UNKNOWN'));
    await assert.rejects(
      persistExecutorInvocationOutcome({ dispatchId, store: corruptWinnerStore, adapter: adapter2 }),
      (error) =>
        error instanceof ExecutorInvocationOutcomePersistenceError &&
        error.code === CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
    );
    assert.equal(readFileSync(outcomePath(home, dispatchId), 'utf8'), bytesBefore);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// K. Corrupt existing outcome: zero adapter calls, zero repair.
// ---------------------------------------------------------------------------

test('K. corrupt existing outcome fails closed with zero adapter calls and zero repair', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-executor-invocation-outcome32-k-',
    'EIOP32-K-SRC',
    'EIOP32-K-CHILD',
  );
  try {
    const path = outcomePath(home, dispatchId);
    const valid = validOutcome(dispatchId, 'ACCEPTED');
    const otherDispatchId = `dsp_${'f'.repeat(64)}`;
    const variants = [
      { name: 'unparseable bytes', bytes: '{ not json' },
      { name: 'wrong shape', bytes: JSON.stringify({ hello: 'not-an-outcome' }, null, 2) },
      { name: 'extra field', bytes: JSON.stringify({ ...valid, acceptedAt: 'now' }, null, 2) },
      { name: 'invalid outcome', bytes: JSON.stringify({ ...valid, outcome: 'DONE' }, null, 2) },
      { name: 'string schemaVersion', bytes: JSON.stringify({ ...valid, schemaVersion: '1' }, null, 2) },
      {
        name: 'wrong key order',
        bytes: JSON.stringify({ outcome: 'ACCEPTED', dispatchId, schemaVersion: 1 }, null, 2),
      },
      {
        name: 'dispatchId/path mismatch',
        bytes: JSON.stringify(validOutcome(otherDispatchId, 'ACCEPTED'), null, 2),
      },
    ];
    for (const variant of variants) {
      writeOutcomeBytes(home, dispatchId, variant.bytes);
      const { calls, adapter } = countingAdapter(() => validOutcome(dispatchId, 'ACCEPTED'));
      await assert.rejects(
        persistExecutorInvocationOutcome({ dispatchId, store, adapter }),
        (error) => error?.code === CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
        variant.name,
      );
      assert.equal(calls.length, 0, variant.name);
      // Exact corrupt bytes preserved: no repair, no rewrite, no delete.
      assert.equal(readFileSync(path, 'utf8'), variant.bytes, variant.name);
      assert.deepEqual(listOutcomeFiles(home), [`${dispatchId}.json`], variant.name);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// L. Invalid Task 30 outcome: zero durable writes.
// ---------------------------------------------------------------------------

test('L. an invalid Task 30 adapter outcome fails closed with zero durable writes', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-executor-invocation-outcome32-l-',
    'EIOP32-L-SRC',
    'EIOP32-L-CHILD',
  );
  try {
    const valid = validOutcome(dispatchId, 'ACCEPTED');
    const foreign = validOutcome(`dsp_${'a'.repeat(64)}`, 'ACCEPTED');
    const variants = [
      { name: 'non-record null', value: null },
      { name: 'non-record string', value: 'ACCEPTED' },
      { name: 'string schemaVersion', value: { ...valid, schemaVersion: '1' } },
      { name: 'invalid outcome', value: { ...valid, outcome: 'DONE' } },
      { name: 'extra metadata field', value: { ...valid, retryCount: 0 } },
      { name: 'foreign dispatchId', value: foreign },
      { name: 'missing outcome', value: { schemaVersion: 1, dispatchId } },
    ];
    for (const variant of variants) {
      const before = snapshotHomeBytes(home);
      const { calls, adapter } = countingAdapter(() => variant.value);
      await assert.rejects(
        persistExecutorInvocationOutcome({ dispatchId, store, adapter }),
        (error) =>
          error instanceof ExecutorInvocationOutcomeError &&
          error.code === INVALID_EXECUTOR_INVOCATION_OUTCOME,
        variant.name,
      );
      assert.equal(calls.length, 1, variant.name);
      assert.deepEqual(snapshotHomeBytes(home), before, variant.name);
      assert.deepEqual(listOutcomeFiles(home), [], variant.name);
    }
    assert.equal(existsSync(outcomePath(home, dispatchId)), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// M. Adapter throw/rejection: exact identity propagation, zero writes.
// ---------------------------------------------------------------------------

test('M. adapter throw/rejection propagates with the exact identity and zero durable writes', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-executor-invocation-outcome32-m-',
    'EIOP32-M-SRC',
    'EIOP32-M-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);

    const thrown = new Error('adapter sentinel throw');
    const { adapter: throwingAdapter } = countingAdapter(() => {
      throw thrown;
    });
    await assert.rejects(
      persistExecutorInvocationOutcome({ dispatchId, store, adapter: throwingAdapter }),
      (error) => {
        assert.equal(error, thrown);
        return true;
      },
    );

    const rejectionSentinel = { code: 'ADAPTER_REJECTED_SENTINEL', detail: 'exact object identity' };
    const { adapter: rejectingAdapter } = countingAdapter(() => Promise.reject(rejectionSentinel));
    await assert.rejects(
      persistExecutorInvocationOutcome({ dispatchId, store, adapter: rejectingAdapter }),
      (error) => {
        assert.equal(error, rejectionSentinel);
        return true;
      },
    );

    // A rejected string identity is also preserved exactly.
    const { adapter: stringRejectAdapter } = countingAdapter(() => Promise.reject('sentinel-string'));
    await assert.rejects(
      persistExecutorInvocationOutcome({ dispatchId, store, adapter: stringRejectAdapter }),
      (error) => {
        assert.equal(error, 'sentinel-string');
        return true;
      },
    );

    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.deepEqual(listOutcomeFiles(home), []);
    assert.equal(existsSync(outcomePath(home, dispatchId)), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// N. Codex CLI process-start failure: typed propagation, zero durable outcome.
// ---------------------------------------------------------------------------

test('N. Codex CLI process-start failure propagates typed with a zero durable outcome', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-executor-invocation-outcome32-n-',
    'EIOP32-N-SRC',
    'EIOP32-N-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const adapter = createCodexCliExecutorAdapter({
      executablePath: join(tmpdir(), 'greenhub-nonexistent-codex.exe'),
      workdir: tmpdir(),
      runner: async () => ({ kind: 'start-failed', errorCode: 'ENOENT' }),
    });
    await assert.rejects(
      persistExecutorInvocationOutcome({ dispatchId, store, adapter }),
      (error) =>
        error instanceof CodexCliExecutorAdapterError &&
        error.code === CODEX_CLI_EXECUTOR_PROCESS_START_FAILED,
    );
    // Never converted to UNKNOWN/REJECTED, never persisted.
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.deepEqual(listOutcomeFiles(home), []);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// O. No task status mutation.
// ---------------------------------------------------------------------------

test('O. the task stays CLAIMED: no status transition and no claim mutation', async () => {
  const { home, store, attempt, dispatchId } = await setupAccepted(
    'greenhub-executor-invocation-outcome32-o-',
    'EIOP32-O-SRC',
    'EIOP32-O-CHILD',
  );
  try {
    const taskPath = join(home, 'tasks', 'EIOP32-O-CHILD', 'task.json');
    const taskBytesBefore = readFileSync(taskPath, 'utf8');
    const claimBefore = store.readClaim('EIOP32-O-CHILD');
    const childPath = join(home, 'tasks', 'EIOP32-O-CHILD', 'claim.json');
    const claimBytesBefore = readFileSync(childPath, 'utf8');

    const { adapter } = countingAdapter(() => validOutcome(dispatchId, 'ACCEPTED'));
    await persistExecutorInvocationOutcome({ dispatchId, store, adapter });
    await persistExecutorInvocationOutcome({ dispatchId, store, adapter });

    assert.equal(store.readTask('EIOP32-O-CHILD').status, TASK_STATUS_CLAIMED);
    assert.equal(readFileSync(taskPath, 'utf8'), taskBytesBefore);
    const claimAfter = store.readClaim('EIOP32-O-CHILD');
    assert.equal(claimAfter.generation, claimBefore.generation);
    assert.equal(claimAfter.claimToken, claimBefore.claimToken);
    assert.equal(claimAfter.leaseExpiresAt, claimBefore.leaseExpiresAt);
    assert.equal(readFileSync(childPath, 'utf8'), claimBytesBefore);
    assert.equal(attempt.dispatchId, dispatchId);

    // Functional code contains no status transition authority.
    const code = codeOnly(readFileSync(MODULE_PATH, 'utf8'));
    for (const status of [
      "'RUNNING'",
      '"RUNNING"',
      "'EXECUTING'",
      '"EXECUTING"',
      "'INVOKED'",
      '"INVOKED"',
      "'ACKED'",
      '"ACKED"',
      "'COMPLETED'",
      '"COMPLETED"',
      'TASK_STATUS_RUNNING',
      'TASK_STATUS_ACCEPTED',
      'markClaimed',
      'writeJsonAtomic',
    ]) {
      assert.equal(code.includes(status), false, `${status} must not exist in code`);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// P. No ACK/receipt/result/disposition.
// ---------------------------------------------------------------------------

test('P. no ACK/receipt/result/disposition artifact or store primitive is created', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-executor-invocation-outcome32-p-',
    'EIOP32-P-SRC',
    'EIOP32-P-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const { adapter } = countingAdapter(() => validOutcome(dispatchId, 'ACCEPTED'));
    await persistExecutorInvocationOutcome({ dispatchId, store, adapter });

    const after = snapshotHomeBytes(home);
    // The ONLY new path is the durable invocation outcome.
    assert.deepEqual(
      Object.keys(after).filter((name) => !(name in before)),
      [join(EXECUTOR_INVOCATION_OUTCOMES_DIRNAME, `${dispatchId}.json`)],
    );
    for (const forbidden of [
      'persistExecutorInvocationOutcome',
      'recordExecutorInvocationOutcome',
      'writeExecutorInvocationOutcome',
      'acknowledgeExecutor',
      'acknowledgeDispatch',
      'createReceipt',
      'persistReceipt',
      'recordExecutionStarted',
      'invokeExecutor',
      'executeTask',
      'executeDispatch',
      'selectExecutor',
      'selectWorker',
      'scheduleExecutor',
      'retryDispatch',
      'resendDispatch',
      'invocationCounter',
      'retryCounter',
    ]) {
      assert.equal(store[forbidden], undefined, `store.${forbidden} must not exist`);
    }
    assert.equal(typeof store.readExecutorInvocationOutcome, 'function');
    assert.equal(typeof store.createExecutorInvocationOutcome, 'function');
    assert.equal(typeof store.readExecutorInvocationAttempt, 'function');
    assert.equal(typeof store.readExecutorResultReceipt, 'function');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// Q. No new generation authority.
// ---------------------------------------------------------------------------

test('Q. no new generation/fencing authority is created', async () => {
  const { home, store, attempt, dispatchId } = await setupAccepted(
    'greenhub-executor-invocation-outcome32-q-',
    'EIOP32-Q-SRC',
    'EIOP32-Q-CHILD',
  );
  try {
    const { adapter } = countingAdapter(() => validOutcome(dispatchId, 'ACCEPTED'));
    const result = await persistExecutorInvocationOutcome({ dispatchId, store, adapter });
    assert.deepEqual(Object.keys(result).filter((key) => /generation/i.test(key)), []);

    const durable = JSON.parse(readFileSync(outcomePath(home, dispatchId), 'utf8'));
    assert.deepEqual(Object.keys(durable).filter((key) => /generation/i.test(key)), []);
    assert.equal(store.readClaim('EIOP32-Q-CHILD').generation, 1);
    assert.equal(attempt.dispatchId, dispatchId);

    // Functional code creates no generation authority.
    const code = codeOnly(readFileSync(MODULE_PATH, 'utf8'));
    assert.equal(code.includes('Generation'), false);
    assert.equal(code.includes('claimGeneration'), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// R. No retry/fallback/registry.
// ---------------------------------------------------------------------------

test('R. no retry/fallback/registry authority exists (static + behavioral)', async () => {
  const code = codeOnly(readFileSync(MODULE_PATH, 'utf8'));
  for (const forbidden of [
    'retry',
    'backoff',
    'resend',
    'secondAttempt',
    'fallback',
    'registry',
    'adapterRegistry',
    'workerRegistry',
    'executorRegistry',
    'capabilityMatch',
    'endpointDiscovery',
    'environmentSelection',
    'selectExecutor',
    'selectWorker',
    'scheduler',
    'polling',
    'daemon',
    'cron',
    'setTimeout',
    'setInterval',
    'Date.now',
    'new Date',
    'performance.now',
    'randomUUID',
    'Math.random',
    'process.pid',
    'process.env',
    'process.platform',
  ]) {
    assert.equal(code.includes(forbidden), false, `code must not contain ${forbidden}`);
  }

  // Behavioral: one entered path invokes the adapter AT MOST ONCE, including
  // after a failed validation and after a durable replay.
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-executor-invocation-outcome32-r-',
    'EIOP32-R-SRC',
    'EIOP32-R-CHILD',
  );
  try {
    const failing = countingAdapter(() => ({ ...validOutcome(dispatchId, 'ACCEPTED'), outcome: 'NOPE' }));
    await assert.rejects(persistExecutorInvocationOutcome({ dispatchId, store, adapter: failing.adapter }));
    assert.equal(failing.calls.length, 1);

    const { calls, adapter } = countingAdapter(() => validOutcome(dispatchId, 'UNKNOWN'));
    const first = await persistExecutorInvocationOutcome({ dispatchId, store, adapter });
    const second = await persistExecutorInvocationOutcome({ dispatchId, store, adapter });
    const third = await persistExecutorInvocationOutcome({ dispatchId, store, adapter });
    assert.equal(first.newlyRecorded, true);
    assert.equal(second.exactReplay, true);
    assert.equal(third.exactReplay, true);
    assert.equal(second.outcome, 'UNKNOWN');
    assert.equal(third.outcome, 'UNKNOWN');
    // UNKNOWN is durable but is never retry permission: exactly one invocation.
    assert.equal(calls.length, 1);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// S. Predecessor Task 24~31 semantics intact.
// ---------------------------------------------------------------------------

test('S. Task 24~31 predecessor surfaces and semantics stay intact', async () => {
  // Task 30 surface unchanged.
  assert.equal(typeof invokeExecutorAndValidateOutcome, 'function');
  assert.equal(EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION, 1);
  assert.deepEqual([...EXECUTOR_INVOCATION_OUTCOME_VALUES], ['ACCEPTED', 'REJECTED', 'UNKNOWN']);
  assert.deepEqual([...EXECUTOR_INVOCATION_OUTCOME_FIELDS], ['schemaVersion', 'dispatchId', 'outcome']);
  assert.equal(typeof ExecutorInvocationOutcomeError, 'function');
  assert.equal(typeof outcomeModule.invokeExecutorAndValidateOutcome, 'function');

  // Task 29 surface unchanged.
  assert.equal(typeof invokeExecutorInvocationAdapter, 'function');
  assert.equal(EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND, 'EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND');
  assert.equal(typeof ExecutorInvocationContractError, 'function');

  // Task 28 surface unchanged.
  assert.equal(typeof persistExecutorInvocationAttempt, 'function');
  assert.equal(EXECUTOR_INVOCATION_ATTEMPTS_DIRNAME, 'executor-invocation-attempts');
  assert.equal(CORRUPT_EXECUTOR_INVOCATION_ATTEMPT, 'CORRUPT_EXECUTOR_INVOCATION_ATTEMPT');

  // Task 31 surface unchanged.
  assert.equal(typeof createCodexCliExecutorAdapter, 'function');
  assert.equal(CODEX_CLI_EXECUTOR_PROCESS_START_FAILED, 'CODEX_CLI_EXECUTOR_PROCESS_START_FAILED');

  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-executor-invocation-outcome32-s-',
    'EIOP32-S-SRC',
    'EIOP32-S-CHILD',
  );
  try {
    // Task 30 still returns the exact canonical outcome when called directly.
    const { adapter } = countingAdapter(() => validOutcome(dispatchId, 'REJECTED'));
    const direct = await invokeExecutorAndValidateOutcome({ dispatchId, store, adapter });
    assert.deepEqual(direct, validOutcome(dispatchId, 'REJECTED'));

    // Predecessor store primitives still exist and behave.
    for (const name of [
      'readExecutorDispatchAcceptance',
      'createExecutorDispatchAcceptance',
      'readReceiverDispatchDecision',
      'readExecutorInvocationAttempt',
      'createExecutorInvocationAttempt',
    ]) {
      assert.equal(typeof store[name], 'function', name);
    }
    assert.equal(typeof store.readExecutorInvocationOutcome, 'function');
    assert.equal(typeof store.createExecutorInvocationOutcome, 'function');

    // The store's invocation-attempt domain still uses exclusive-create and
    // the Task 24 public validator; no exists()->write() pattern was added.
    const storeSource = readFileSync(join(MODULE_DIRECTORY, 'store.mjs'), 'utf8');
    const start = storeSource.indexOf('Durable executor invocation attempt domain');
    const end = storeSource.indexOf('Claim-bound dispatch envelope domain', start);
    assert.ok(start > 0 && end > start);
    const section = storeSource.slice(start, end);
    assert.ok(section.includes('writeJsonExclusive('));
    assert.equal(section.includes('existsSync('), false);
    assert.equal(section.includes('writeJsonAtomic('), false);
    assert.equal(section.includes('validateReceiverDecisionRecord('), true);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// T. Existing durable replay does not change bytes or mtimes.
// ---------------------------------------------------------------------------

test('T. existing durable replay does not change bytes or mtimes', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-executor-invocation-outcome32-t-',
    'EIOP32-T-SRC',
    'EIOP32-T-CHILD',
  );
  try {
    const { adapter } = countingAdapter(() => validOutcome(dispatchId, 'REJECTED'));
    const created = await persistExecutorInvocationOutcome({ dispatchId, store, adapter });
    assert.equal(created.newlyRecorded, true);
    const bytesAfterCreate = readFileSync(outcomePath(home, dispatchId), 'utf8');
    const statsAfterCreate = snapshotHomeStats(home);

    await delay(30);
    const { calls, adapter: replayAdapter } = countingAdapter(() => {
      throw new Error('replay must not invoke the executor');
    });
    const replayed = await persistExecutorInvocationOutcome({
      dispatchId,
      store,
      adapter: replayAdapter,
    });
    assert.equal(replayed.exactReplay, true);
    assert.equal(replayed.outcome, 'REJECTED');
    assert.equal(calls.length, 0);
    assert.equal(readFileSync(outcomePath(home, dispatchId), 'utf8'), bytesAfterCreate);
    assert.deepEqual(snapshotHomeStats(home), statsAfterCreate);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// U. Cross-boundary receipt fence: a durable Task 33 receipt refuses the
// outcome entry (exact mirror of Task 33's recorded-outcome fence).
// ---------------------------------------------------------------------------

test('U. a durable Task 33 receipt refuses the outcome entry with zero adapter calls and zero writes', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-executor-invocation-outcome32-u-',
    'EIOP32-U-SRC',
    'EIOP32-U-CHILD',
  );
  try {
    for (const status of [
      EXECUTOR_RESULT_RECEIPT_STATUS_SUCCEEDED,
      EXECUTOR_RESULT_RECEIPT_STATUS_FAILED,
      EXECUTOR_RESULT_RECEIPT_STATUS_BLOCKED,
    ]) {
      const path = receiptPath(home, dispatchId);
      rmSync(path, { force: true });
      const receipt = validReceipt(dispatchId, 'EIOP32-U-CHILD', { status });
      assert.deepEqual(store.createExecutorResultReceipt(receipt), { created: true });
      const receiptBytes = readFileSync(path, 'utf8');
      const before = snapshotHomeBytes(home);

      const { calls, adapter } = countingAdapter(() => {
        throw new Error('a recorded receipt must never re-invoke the executor');
      });
      await assert.rejects(
        persistExecutorInvocationOutcome({ dispatchId, store, adapter }),
        (error) =>
          error instanceof ExecutorInvocationOutcomePersistenceError &&
          error.code === EXECUTOR_INVOCATION_OUTCOME_ABSENT_FOR_RECORDED_RECEIPT,
        status,
      );
      assert.equal(calls.length, 0, status);
      assert.deepEqual(snapshotHomeBytes(home), before, status);
      assert.equal(readFileSync(path, 'utf8'), receiptBytes, status);
      assert.equal(store.readExecutorInvocationOutcome(dispatchId), null, status);
      assert.deepEqual(listOutcomeFiles(home), [], status);
      assert.equal(store.readTask('EIOP32-U-CHILD').status, TASK_STATUS_CLAIMED, status);
    }
  } finally {
    removeHome(home);
  }
});

test('U2. corrupt or mismatched durable receipts fail closed with zero adapter calls and zero writes', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-executor-invocation-outcome32-u2-',
    'EIOP32-U2-SRC',
    'EIOP32-U2-CHILD',
  );
  try {
    const path = receiptPath(home, dispatchId);
    mkdirSync(dirname(path), { recursive: true });
    const variants = [
      { name: 'unparseable bytes', bytes: '{ not json' },
      { name: 'wrong shape', bytes: JSON.stringify({ hello: 'not-a-receipt' }, null, 2) },
      {
        name: 'extra field',
        bytes: JSON.stringify(
          { ...validReceipt(dispatchId, 'EIOP32-U2-CHILD'), acceptedAt: 'now' },
          null,
          2,
        ),
      },
      {
        name: 'invalid status',
        bytes: JSON.stringify(
          { ...validReceipt(dispatchId, 'EIOP32-U2-CHILD'), status: 'DONE' },
          null,
          2,
        ),
      },
      {
        name: 'dispatchId/path mismatch',
        bytes: JSON.stringify(
          validReceipt(`dsp_${'a'.repeat(64)}`, 'EIOP32-U2-CHILD'),
          null,
          2,
        ),
      },
    ];
    for (const variant of variants) {
      writeFileSync(path, variant.bytes, 'utf8');
      const { calls, adapter } = countingAdapter(() => validOutcome(dispatchId, 'ACCEPTED'));
      await assert.rejects(
        persistExecutorInvocationOutcome({ dispatchId, store, adapter }),
        (error) => error?.code === CORRUPT_EXECUTOR_RESULT_RECEIPT,
        variant.name,
      );
      assert.equal(calls.length, 0, variant.name);
      assert.equal(readFileSync(path, 'utf8'), variant.bytes, variant.name);
      assert.deepEqual(listOutcomeFiles(home), [], variant.name);
      assert.equal(existsSync(outcomePath(home, dispatchId)), false, variant.name);
    }
  } finally {
    removeHome(home);
  }
});

test('U3. an existing durable outcome still replays read-only when a receipt also exists', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-executor-invocation-outcome32-u3-',
    'EIOP32-U3-SRC',
    'EIOP32-U3-CHILD',
  );
  try {
    seedOutcome(store, dispatchId, 'UNKNOWN');
    assert.deepEqual(
      store.createExecutorResultReceipt(validReceipt(dispatchId, 'EIOP32-U3-CHILD')),
      { created: true },
    );
    const before = snapshotHomeBytes(home);
    const { calls, adapter } = countingAdapter(() => {
      throw new Error('replay must not invoke the executor');
    });
    const replayed = await persistExecutorInvocationOutcome({ dispatchId, store, adapter });
    assert.equal(replayed.exactReplay, true);
    assert.equal(replayed.outcome, 'UNKNOWN');
    assert.equal(calls.length, 0);
    assert.deepEqual(snapshotHomeBytes(home), before);
  } finally {
    removeHome(home);
  }
});

test('U4. mirror fence: a recorded outcome without a receipt still refuses the Task 33 receipt entry', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-executor-invocation-outcome32-u4-',
    'EIOP32-U4-SRC',
    'EIOP32-U4-CHILD',
  );
  try {
    seedOutcome(store, dispatchId, 'ACCEPTED');
    const before = snapshotHomeBytes(home);
    let executorCalls = 0;
    await assert.rejects(
      persistExecutorResultReceipt({
        dispatchId,
        store,
        executor: async () => {
          executorCalls += 1;
          return { schemaVersion: 1, dispatchId, outcome: 'ACCEPTED', result: null };
        },
      }),
      (error) => error?.code === EXECUTOR_RESULT_RECEIPT_ABSENT_FOR_RECORDED_OUTCOME,
    );
    assert.equal(executorCalls, 0);
    assert.equal(existsSync(receiptPath(home, dispatchId)), false);
    assert.deepEqual(snapshotHomeBytes(home), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// CONCURRENCY. Two real processes: one durable winner; per-entered-path
// invocation is at most once, while cross-process total invocation is not
// globally serialized (documented limitation, never overclaimed).
// ---------------------------------------------------------------------------

test('CONCURRENCY. two concurrent processes yield one durable winner and at most one invocation per entered path', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-executor-invocation-outcome32-cx-',
    'EIOP32-CX-SRC',
    'EIOP32-CX-CHILD',
  );
  try {
    const [left, right] = await Promise.all([
      runFreshOutcomeWorker({ home, dispatchId, outcome: 'ACCEPTED' }),
      runFreshOutcomeWorker({ home, dispatchId, outcome: 'ACCEPTED' }),
    ]);
    assert.equal(left.ok, true, JSON.stringify(left));
    assert.equal(right.ok, true, JSON.stringify(right));

    const results = [left.result, right.result];
    assert.equal(results.filter((result) => result.newlyRecorded === true).length, 1);
    for (const result of results) {
      assert.equal(result.outcome, 'ACCEPTED');
      assert.equal(result.dispatchId, dispatchId);
      if (result.newlyRecorded === false) assert.equal(result.exactReplay, true);
    }
    // Each process that entered Task 30 invoked its adapter at most once.
    assert.ok(left.adapterCalls <= 1);
    assert.ok(right.adapterCalls <= 1);
    // The durable winner may have been produced before the other process read
    // it, but it can never be produced more than once.
    assert.deepEqual(store.readExecutorInvocationOutcome(dispatchId), validOutcome(dispatchId, 'ACCEPTED'));
    assert.equal(
      readFileSync(outcomePath(home, dispatchId), 'utf8'),
      expectedRecordBytes(validOutcome(dispatchId, 'ACCEPTED')),
    );
    assert.equal(store.readTask('EIOP32-CX-CHILD').status, TASK_STATUS_CLAIMED);
    assert.deepEqual(listOutcomeFiles(home), [`${dispatchId}.json`]);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// STORE. Durable read/create primitives.
// ---------------------------------------------------------------------------

test('STORE. durable outcome primitives: missing -> null, exact canonical, exclusive-create, fail closed', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-executor-invocation-outcome32-store-',
    'EIOP32-ST-SRC',
    'EIOP32-ST-CHILD',
  );
  try {
    assert.equal(store.readExecutorInvocationOutcome(dispatchId), null);

    const record = validOutcome(dispatchId, 'UNKNOWN');
    assert.deepEqual(store.createExecutorInvocationOutcome(record), { created: true });
    const read = store.readExecutorInvocationOutcome(dispatchId);
    assert.deepEqual(read, record);
    assert.equal(Object.isFrozen(read), true);
    const path = outcomePath(home, dispatchId);
    const bytes = readFileSync(path, 'utf8');
    assert.equal(bytes, expectedRecordBytes(record));

    // Exclusive-create replay never rewrites the winner.
    assert.deepEqual(store.createExecutorInvocationOutcome(record), { created: false });
    assert.equal(readFileSync(path, 'utf8'), bytes);
    assert.deepEqual(store.createExecutorInvocationOutcome(validOutcome(dispatchId, 'ACCEPTED')), {
      created: false,
    });
    assert.equal(readFileSync(path, 'utf8'), bytes);

    // Invalid records are rejected before any write.
    for (const invalidRecord of [
      null,
      'not-a-record',
      [],
      {},
      { ...record, outcome: 'DONE' },
      { ...record, acceptedAt: 'now' },
      { ...record, schemaVersion: '1' },
      { ...record, schemaVersion: 2 },
      { outcome: 'ACCEPTED', dispatchId, schemaVersion: 1 },
      validOutcome('not-an-id', 'ACCEPTED'),
    ]) {
      assert.throws(
        () => store.createExecutorInvocationOutcome(invalidRecord),
        (error) => error != null,
      );
    }
    assert.equal(readFileSync(path, 'utf8'), bytes);

    // Key/binding mismatch fails closed and never repairs.
    const otherDispatchId = `dsp_${'f'.repeat(64)}`;
    writeFileSync(path, expectedRecordBytes(validOutcome(otherDispatchId, 'ACCEPTED')), 'utf8');
    assert.throws(
      () => store.readExecutorInvocationOutcome(dispatchId),
      (error) => error.code === CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
    );
    assert.equal(
      readFileSync(path, 'utf8'),
      expectedRecordBytes(validOutcome(otherDispatchId, 'ACCEPTED')),
    );

    // Corrupt bytes fail closed and are preserved exactly.
    writeFileSync(path, '{ not json', 'utf8');
    assert.throws(
      () => store.readExecutorInvocationOutcome(dispatchId),
      (error) => error.code === CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
    );
    assert.equal(readFileSync(path, 'utf8'), '{ not json');

    // Invalid identity fails closed without touching the store.
    assert.throws(() => store.readExecutorInvocationOutcome('not-an-id'));
    assert.throws(() => store.createExecutorInvocationOutcome(validOutcome('not-an-id', 'ACCEPTED')));
  } finally {
    removeHome(home);
  }
});

test('STORE-STATIC. store section uses exclusive-create and the exact durable value validator only', () => {
  const storeSource = readFileSync(join(MODULE_DIRECTORY, 'store.mjs'), 'utf8');
  const start = storeSource.indexOf('Durable executor invocation outcome domain');
  const end = storeSource.indexOf('Claim-bound dispatch envelope domain', start);
  assert.ok(start > 0 && end > start, 'executor invocation outcome domain section must exist');
  const section = storeSource.slice(start, end);
  assert.ok(section.includes('writeJsonExclusive('));
  assert.equal(section.includes('existsSync('), false);
  assert.equal(section.includes('writeJsonAtomic('), false);
  assert.equal(section.includes('validateExecutorInvocationOutcomeRecord('), true);
  assert.equal(section.includes('readExecutorInvocationOutcome('), true);
  assert.equal(section.includes('createExecutorInvocationOutcome('), true);
  // The store layer never composes Task 30 or invokes an adapter.
  assert.equal(section.includes('invokeExecutorAndValidateOutcome('), false);
  assert.equal(section.includes('adapter('), false);
  assert.equal(section.includes('spawn('), false);
});

// ---------------------------------------------------------------------------
// STATIC. Production module boundary + exact exported surface.
// ---------------------------------------------------------------------------

test('STATIC. production module carries no concrete executor/transport/process/fs/retry authority and one narrow entry', async () => {
  const raw = readFileSync(MODULE_PATH, 'utf8');
  const code = codeOnly(raw);
  for (const forbidden of [
    "from 'node:fs'",
    "from 'node:child_process'",
    "from 'node:net'",
    "from 'node:http'",
    "from 'node:https'",
    "from 'node:crypto'",
    "from './store.mjs'",
    'child_process',
    'spawn(',
    'spawnSync(',
    'exec(',
    'execFile(',
    'execSync(',
    'fetch(',
    'WebSocket',
    'http.request(',
    'writeFile',
    'mkdir',
    'unlink',
    'rename',
    'appendFile',
    'createWriteStream',
    'retry',
    'backoff',
    'resend',
    'secondAttempt',
    'fallback',
    'registry',
    'selectExecutor',
    'selectWorker',
    'capabilityMatch',
    'endpointDiscovery',
    'environmentSelection',
    'polling',
    'daemon',
    'scheduler',
    'Date.now',
    'new Date',
    'performance.now',
    'randomUUID',
    'Math.random',
    'setTimeout',
    'setInterval',
    'process.pid',
    'process.env',
    'process.platform',
    'createHash',
    'sha256',
    'invokeExecutorInvocationAdapter(',
    'readExecutorInvocationAttempt(',
    'persistExecutorInvocationAttempt(',
    'readExecutorInvocationInput(',
    'require(',
  ]) {
    assert.equal(code.includes(forbidden), false, `code must not contain ${forbidden}`);
  }

  // The only composition is the Task 30 public entry, the Task 28 identity
  // family, and the Task 33 receipt validator (the cross-boundary fence reads
  // the receipt authority; no predecessor durable reader/mutator is imported
  // directly and the receipt namespace is never written).
  const importSpecifiers = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(importSpecifiers, [
    'node:path',
    './dispatch-executor-invocation-attempt.mjs',
    './dispatch-executor-invocation-outcome.mjs',
    './executor-result-receipt.mjs',
  ]);
  assert.ok(code.includes('invokeExecutorAndValidateOutcome('));
  assert.ok(code.includes('validateExecutorResultReceiptRecord('));
  assert.equal(code.includes('validateExecutorInvocationOutcome('), false);
  assert.equal(code.includes('validateReceiverDecisionRecord('), false);
  assert.equal(code.includes('readExecutorInvocationInput('), false);
  assert.equal(code.includes('createExecutorResultReceipt('), false);

  // Exported surface: constants + error class + narrow helpers + ONE entry.
  const exportedFunctions = Object.entries(persistenceModule)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(exportedFunctions, [
    'ExecutorInvocationOutcomePersistenceError',
    'assertValidExecutorInvocationOutcomeDispatchId',
    'executorInvocationOutcomeFileName',
    'executorInvocationOutcomeFilePath',
    'persistExecutorInvocationOutcome',
    'validateExecutorInvocationOutcomeRecord',
  ]);
  assert.equal(typeof persistExecutorInvocationOutcome, 'function');
  assert.equal(EXECUTOR_INVOCATION_OUTCOMES_DIRNAME, 'executor-invocation-outcomes');
  assert.equal(CORRUPT_EXECUTOR_INVOCATION_OUTCOME, 'CORRUPT_EXECUTOR_INVOCATION_OUTCOME');
  assert.equal(EXECUTOR_INVOCATION_OUTCOME_CONFLICT, 'EXECUTOR_INVOCATION_OUTCOME_CONFLICT');
  assert.equal(
    INVALID_EXECUTOR_INVOCATION_OUTCOME_STORE,
    'INVALID_EXECUTOR_INVOCATION_OUTCOME_STORE',
  );
  assert.equal(
    EXECUTOR_INVOCATION_OUTCOME_ABSENT_FOR_RECORDED_RECEIPT,
    'EXECUTOR_INVOCATION_OUTCOME_ABSENT_FOR_RECORDED_RECEIPT',
  );
  assert.deepEqual(
    [...EXECUTOR_INVOCATION_OUTCOME_PERSISTENCE_NEW_FIELDS],
    ['dispatchId', 'newlyRecorded', 'outcome'],
  );
  assert.deepEqual(
    [...EXECUTOR_INVOCATION_OUTCOME_PERSISTENCE_REPLAY_FIELDS],
    ['dispatchId', 'newlyRecorded', 'exactReplay', 'outcome'],
  );
  assert.deepEqual(
    Object.keys(validateExecutorInvocationOutcomeRecord(validOutcome(`dsp_${'b'.repeat(64)}`, 'ACCEPTED'))),
    ['schemaVersion', 'dispatchId', 'outcome'],
  );

  // Missing store capability fails closed before any durable read.
  await assert.rejects(
    persistExecutorInvocationOutcome({ dispatchId: `dsp_${'c'.repeat(64)}`, store: {}, adapter: () => {} }),
    (error) =>
      error instanceof ExecutorInvocationOutcomePersistenceError &&
      error.code === INVALID_EXECUTOR_INVOCATION_OUTCOME_STORE,
  );
});
