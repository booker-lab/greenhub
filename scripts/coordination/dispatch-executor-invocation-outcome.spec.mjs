// Proof for GREENHUB-COORDINATION-EXECUTOR-INVOCATION-OUTCOME-CONTRACT-30.
//
// DURABLE_EXECUTOR_INVOCATION_ATTEMPT(dispatchId)
//   -> CALLER_SUPPLIED_EXECUTOR_ADAPTER_INVOCATION(dispatchId)   [Task 29]
//   -> VALIDATED_EXECUTOR_INVOCATION_OUTCOME(dispatchId)         [Task 30].
//
// VALIDATED_EXECUTOR_INVOCATION_OUTCOME != concrete executor integration
// != executor receipt proof != executor started != task started != task RUNNING
// != task result != ACK != durable receipt != retry permission != global
// exactly-once execution.
//
// The entry is EXACTLY one composition path:
//   (dispatchId, store, adapter)
//     1. invokeExecutorInvocationAdapter({ dispatchId, store, adapter }) exactly
//        once [Task 29 verbatim: identity/capability/store/read/record/binding
//        validation, at most one adapter invocation, unchanged propagation]
//     2. the adapter's returned value is validated against the exact minimal
//        outcome contract; no adapter re-invocation, no durable re-read
//     3. success -> frozen canonical { schemaVersion: 1, dispatchId, outcome }
//   Adapter throw/rejection reaches the caller with the exact same value:
//   never converted to UNKNOWN/REJECTED/ACCEPTED, never caught or retried.
//
// Deliberately NO whole-file SHA256 predecessor pin chain: Task 29's
// friction_observed showed that byte pins block future semantic-neutral
// predecessor maintenance. Predecessor immutability is proven instead by the
// publication delta (git changed-path proof: only the two new Task 30 files),
// by running the Task 29 suite and the Task 18~29 predecessor suites, and by
// the static/behavioral boundary assertions below (the production module
// imports the Task 29 entry ONLY; no store.mjs and no predecessor mutation
// module is imported or composed).
//
// Proof map:
//   A. ACCEPTED outcome valid; adapter receives the exact Task 28 record.
//   B. REJECTED outcome valid.
//   C. UNKNOWN outcome valid (explicit protocol outcome, never a retry).
//   D. invalid schemaVersion fail closed, no retry, no mutation.
//   D2. non-record / non-plain values fail closed; null-prototype accepted.
//   E. invalid/missing outcome fail closed.
//   F. extra key / wrong key set fail closed; key order is not semantic.
//   G. returned dispatchId mismatch fail closed (incl. valid foreign record).
//   H. adapter sync throw: exact identity propagation (incl. thrown outcome).
//   I. adapter Promise rejection: exact identity propagation.
//   J. at-most-once per API call; validation failure never re-invokes.
//   K. no alternate durable input read before the adapter invocation.
//   L. success / validation failure / throw leave every durable byte and
//      task/claim state unchanged.
//   M. task stays CLAIMED; no CLAIMED -> RUNNING; no status token authority.
//   N. no ACK/receipt/result/disposition mutation or new artifact namespace.
//   O. production module static boundary + exact exported surface.
//   P. no new generation authority; claimGeneration stays the sole generation.
//   Q. Task 29 public surface intact; Task 30 imports the Task 29 entry ONLY.
//   F2. Task 29 fail-closed errors propagate unchanged through Task 30.
//
// All runtime state lives in isolated temp directories. No network required.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  acceptExecutorDispatchDecision,
  executorDispatchAcceptanceFilePath,
} from './dispatch-executor-acceptance.mjs';
import {
  CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
  EXECUTOR_INVOCATION_ATTEMPTS_DIRNAME,
  ExecutorInvocationAttemptError,
  executorInvocationAttemptFilePath,
  persistExecutorInvocationAttempt,
} from './dispatch-executor-invocation-attempt.mjs';
import {
  EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND,
  ExecutorInvocationContractError,
  INVALID_EXECUTOR_INVOCATION_ADAPTER,
  INVALID_EXECUTOR_INVOCATION_CONTRACT_STORE,
  invokeExecutorInvocationAdapter,
} from './dispatch-executor-invocation-contract.mjs';
import { readExecutorInvocationInput } from './dispatch-executor-invocation-input.mjs';
import * as outcomeModule from './dispatch-executor-invocation-outcome.mjs';
import {
  EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
  EXECUTOR_INVOCATION_OUTCOME_FIELDS,
  EXECUTOR_INVOCATION_OUTCOME_REJECTED,
  EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION,
  EXECUTOR_INVOCATION_OUTCOME_UNKNOWN,
  EXECUTOR_INVOCATION_OUTCOME_VALUES,
  ExecutorInvocationOutcomeError,
  INVALID_EXECUTOR_INVOCATION_OUTCOME,
  invokeExecutorAndValidateOutcome,
} from './dispatch-executor-invocation-outcome.mjs';
import { acceptReceiverDispatch } from './dispatch-receiver-acceptance.mjs';
import {
  persistReceiverDecision,
  receiverDispatchDecisionFilePath,
} from './dispatch-receiver-decision.mjs';
import { prepareDispatchTransportRequest } from './dispatch-transport-contract.mjs';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import { CoordinationStore } from './store.mjs';
import { TASK_STATUS_CLAIMED } from './task-envelope.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = join(MODULE_DIRECTORY, 'dispatch-executor-invocation-outcome.mjs');

const FORBIDDEN_NEW_ARTIFACT_DIRS = Object.freeze([
  'outcomes',
  'invocation-outcomes',
  'executor-invocation-outcomes',
  'executor-invocation-outcome',
  'invocation-contract',
  'invocation-contracts',
  'executor-invocations',
  'invocations',
  'scheduler',
  'queue',
  'retry',
  'backoff',
  'ack',
  'acks',
  'receipt',
  'receipts',
  'dispatched',
  'sent',
  'running',
  'execution',
]);

const FORBIDDEN_OUTCOME_TOKENS = Object.freeze([
  'acknowledgedAt',
  'acknowledgedBy',
  'ackDispatch',
  'receipt',
  'resultId',
  'disposition',
  'executionStarted',
  'executionAllowed',
  'executorInvoked',
  'executorStarted',
  'invokedAt',
  'startedAt',
  'completedAt',
  'attemptedAt',
  'receivedAt',
  'acceptedAt',
  'retryCount',
  'attemptNumber',
  'pid',
  'hostname',
  'endpoint',
  'workerId',
  'executorId',
  'executorGeneration',
  'invocationGeneration',
  'executionGeneration',
  'retryGeneration',
  'generation',
  'status',
]);

function makeHome(prefix = 'greenhub-executor-invocation-outcome30-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'EXECUTOR_INVOCATION_OUTCOME_CONTRACT_PROVED',
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
    proofRequirement: ['executor-invocation-outcome-contract-proof'],
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

// Task 30 setup: source -> child claim -> durable dispatch attempt -> Task 20
// request -> Task 22 durable receiver acceptance -> Task 24 durable receiver
// decision -> Task 26 durable executor acceptance -> Task 27 readable
// invocation input. The Task 28 durable invocation attempt is NOT persisted
// here.
async function setupInputOnly(prefix, sourceTaskId, childTaskId) {
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
  const input = await readExecutorInvocationInput({ dispatchId: attempt.dispatchId, store });
  return { home, clock, store, attempt, request, input };
}

// Same as setupInputOnly plus the Task 28 durable invocation attempt.
async function setupAccepted(prefix, sourceTaskId, childTaskId) {
  const context = await setupInputOnly(prefix, sourceTaskId, childTaskId);
  const persisted = await persistExecutorInvocationAttempt({
    dispatchId: context.attempt.dispatchId,
    store: context.store,
  });
  assert.equal(persisted.newlyPersisted, true);
  return context;
}

// Two independent accepted+attempted pipelines in ONE home: used to prove the
// returned-dispatchId binding check with a fully valid foreign outcome.
async function setupTwoAccepted(prefix, sourceA, childA, sourceB, childB) {
  const home = makeHome(prefix);
  const clock = controllableClock();
  const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
  const records = [];
  for (const [sourceTaskId, childTaskId] of [
    [sourceA, childA],
    [sourceB, childB],
  ]) {
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
    records.push({ sourceTaskId, childTaskId, attempt });
  }
  return { home, clock, store, first: records[0], second: records[1] };
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

function attemptDir(home) {
  return join(home, EXECUTOR_INVOCATION_ATTEMPTS_DIRNAME);
}

function attemptPath(home, dispatchId) {
  return executorInvocationAttemptFilePath(home, dispatchId);
}

function executorAcceptancePath(home, dispatchId) {
  return executorDispatchAcceptanceFilePath(home, dispatchId);
}

function decisionPath(home, dispatchId) {
  return receiverDispatchDecisionFilePath(home, dispatchId);
}

function listAttemptFiles(home) {
  try {
    return [...readdirSync(attemptDir(home))].sort();
  } catch {
    return [];
  }
}

// Strongest "no alternate primitive consulted" probe: every property access on
// the store is recorded as an ordered event, and every function-valued
// property invocation is recorded with its arguments.
function eventRecordingStore(target) {
  const events = [];
  const store = new Proxy(target, {
    get(object, property, receiver) {
      if (typeof property === 'string') events.push(`get:${property}`);
      const value = Reflect.get(object, property, receiver);
      if (typeof value === 'function') {
        return (...args) => {
          events.push(`call:${property}`);
          return value.apply(object, args);
        };
      }
      return value;
    },
  });
  return { events, store };
}

function countingAdapter(responder) {
  const calls = [];
  const adapter = (...args) => {
    calls.push({ args });
    return responder(...args);
  };
  return { calls, adapter };
}

function validOutcome(dispatchId, outcome, overrides = {}) {
  return { schemaVersion: 1, dispatchId, outcome, ...overrides };
}

function invalidOutcomeError(error) {
  return (
    error instanceof ExecutorInvocationOutcomeError &&
    error.code === INVALID_EXECUTOR_INVOCATION_OUTCOME
  );
}

function collectKeys(value, out = []) {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, out);
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      out.push(key);
      collectKeys(entry, out);
    }
  }
  return out;
}

function assertCanonicalOutcome(result, dispatchId, outcome) {
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(Object.keys(result), ['schemaVersion', 'dispatchId', 'outcome']);
  assert.equal(result.schemaVersion, EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION);
  assert.equal(result.dispatchId, dispatchId);
  assert.equal(result.outcome, outcome);
}

// ---------------------------------------------------------------------------
// A. ACCEPTED OUTCOME VALID + EXACT TASK 29 COMPOSITION.
// ---------------------------------------------------------------------------

test('A. ACCEPTED outcome is validated into a frozen canonical record over the exact Task 28 invocation', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-outcome30-a-',
    'EIOC30-A-SRC',
    'EIOC30-A-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const received = [];
    const { calls, adapter } = countingAdapter((record) => {
      received.push(record);
      return validOutcome(attempt.dispatchId, 'ACCEPTED');
    });
    const result = await invokeExecutorAndValidateOutcome({
      dispatchId: attempt.dispatchId,
      store,
      adapter,
    });

    // Exactly one adapter invocation; the adapter received the EXACT canonical
    // Task 28 durable record (Task 29 composition, no re-read/reconstruction).
    assert.equal(calls.length, 1);
    assert.equal(received.length, 1);
    assert.equal(
      JSON.stringify(received[0]),
      JSON.stringify(store.readExecutorInvocationAttempt(attempt.dispatchId)),
    );
    assert.equal(
      JSON.stringify(received[0], null, 2),
      readFileSync(attemptPath(home, attempt.dispatchId), 'utf8'),
    );

    // The canonical validated outcome is returned.
    assertCanonicalOutcome(result, attempt.dispatchId, EXECUTOR_INVOCATION_OUTCOME_ACCEPTED);

    // ACCEPTED means ONLY "adapter reported accepted at its own protocol
    // boundary": no start/completion/ACK/receipt/status metadata exists.
    const resultJson = JSON.stringify(result);
    for (const token of FORBIDDEN_OUTCOME_TOKENS) {
      assert.equal(resultJson.includes(token), false, token);
    }

    // Zero durable mutation.
    assert.deepEqual(snapshotHomeBytes(home), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// B. REJECTED OUTCOME VALID.
// ---------------------------------------------------------------------------

test('B. REJECTED outcome is validated into a frozen canonical record without any task failure meaning', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-outcome30-b-',
    'EIOC30-B-SRC',
    'EIOC30-B-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const { calls, adapter } = countingAdapter(() => validOutcome(attempt.dispatchId, 'REJECTED'));
    const result = await invokeExecutorAndValidateOutcome({
      dispatchId: attempt.dispatchId,
      store,
      adapter,
    });

    assert.equal(calls.length, 1);
    assertCanonicalOutcome(result, attempt.dispatchId, EXECUTOR_INVOCATION_OUTCOME_REJECTED);

    // REJECTED is a protocol-boundary report ONLY: no task result, no task
    // status change, no durable effect.
    assert.equal(store.readTask('EIOC30-B-CHILD').status, TASK_STATUS_CLAIMED);
    assert.deepEqual(snapshotHomeBytes(home), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// C. UNKNOWN OUTCOME VALID (explicit outcome, never a retry).
// ---------------------------------------------------------------------------

test('C. UNKNOWN outcome is validated as an explicit protocol outcome and never triggers a retry', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-outcome30-c-',
    'EIOC30-C-SRC',
    'EIOC30-C-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const { calls, adapter } = countingAdapter(() => validOutcome(attempt.dispatchId, 'UNKNOWN'));
    const result = await invokeExecutorAndValidateOutcome({
      dispatchId: attempt.dispatchId,
      store,
      adapter,
    });

    assert.equal(calls.length, 1);
    assertCanonicalOutcome(result, attempt.dispatchId, EXECUTOR_INVOCATION_OUTCOME_UNKNOWN);

    // UNKNOWN is not a retry permission: exactly one adapter invocation, no
    // durable retry marker, no second attempt.
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.deepEqual(listAttemptFiles(home), [`${attempt.dispatchId}.json`]);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// D. INVALID SCHEMA VERSION: fail closed, no retry, no mutation.
// ---------------------------------------------------------------------------

test('D. invalid schemaVersion fails closed with INVALID_EXECUTOR_INVOCATION_OUTCOME and no adapter retry', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-outcome30-d-',
    'EIOC30-D-SRC',
    'EIOC30-D-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    for (const schemaVersion of [2, '1', null, undefined, 0, -1, true, Number.NaN]) {
      const { calls, adapter } = countingAdapter(() =>
        validOutcome(attempt.dispatchId, 'ACCEPTED', { schemaVersion }),
      );
      await assert.rejects(
        invokeExecutorAndValidateOutcome({ dispatchId: attempt.dispatchId, store, adapter }),
        invalidOutcomeError,
        `schemaVersion ${String(schemaVersion)}`,
      );
      // Validation failure never re-invokes the adapter.
      assert.equal(calls.length, 1, `schemaVersion ${String(schemaVersion)}`);
    }
    assert.deepEqual(snapshotHomeBytes(home), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// D2. NON-RECORD / NON-PLAIN VALUES: fail closed; null prototype accepted.
// ---------------------------------------------------------------------------

test('D2. non-record and non-plain adapter return values fail closed; null-prototype records are valid', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-outcome30-d2-',
    'EIOC30-D2-SRC',
    'EIOC30-D2-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const dispatchId = attempt.dispatchId;

    class OutcomeLike {
      constructor() {
        this.schemaVersion = 1;
        this.dispatchId = dispatchId;
        this.outcome = 'ACCEPTED';
      }
    }
    const inherited = Object.create(validOutcome(dispatchId, 'ACCEPTED'));
    const accessor = {
      schemaVersion: 1,
      dispatchId,
      get outcome() {
        return 'ACCEPTED';
      },
    };
    const symbolKeyed = validOutcome(dispatchId, 'ACCEPTED', { [Symbol('smuggled')]: 1 });
    const nonEnumerableExtra = Object.defineProperty(
      validOutcome(dispatchId, 'ACCEPTED'),
      'hidden',
      { value: 1, enumerable: false },
    );
    const invalidValues = [
      undefined,
      null,
      42,
      'ACCEPTED',
      true,
      Symbol('outcome'),
      [],
      new Map(),
      new Date(0),
      () => 'ACCEPTED',
      new OutcomeLike(),
      inherited,
      accessor,
      symbolKeyed,
      nonEnumerableExtra,
    ];
    for (const value of invalidValues) {
      const { calls, adapter } = countingAdapter(() => value);
      await assert.rejects(
        invokeExecutorAndValidateOutcome({ dispatchId, store, adapter }),
        invalidOutcomeError,
      );
      assert.equal(calls.length, 1);
    }

    // Positive contrast: a null-prototype record with the exact fields is a
    // valid plain record and is rebuilt into the canonical frozen outcome.
    const nullPrototype = Object.assign(Object.create(null), validOutcome(dispatchId, 'ACCEPTED'));
    const { calls, adapter } = countingAdapter(() => nullPrototype);
    const result = await invokeExecutorAndValidateOutcome({ dispatchId, store, adapter });
    assert.equal(calls.length, 1);
    assertCanonicalOutcome(result, dispatchId, EXECUTOR_INVOCATION_OUTCOME_ACCEPTED);

    assert.deepEqual(snapshotHomeBytes(home), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. INVALID/MISSING OUTCOME VALUE: fail closed.
// ---------------------------------------------------------------------------

test('E. invalid or missing outcome values fail closed with no retry and no mutation', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-outcome30-e-',
    'EIOC30-E-SRC',
    'EIOC30-E-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const dispatchId = attempt.dispatchId;
    for (const outcome of [
      'accepted',
      'Accepted',
      'ACCEPTED ',
      ' ACCEPTED',
      'SUCCESS',
      'FAILURE',
      'RETRY',
      'UNKNOWN_PENDING',
      '',
      null,
      undefined,
      0,
      true,
      {},
      [],
    ]) {
      const { calls, adapter } = countingAdapter(() => validOutcome(dispatchId, outcome));
      await assert.rejects(
        invokeExecutorAndValidateOutcome({ dispatchId, store, adapter }),
        invalidOutcomeError,
        `outcome ${String(outcome)}`,
      );
      assert.equal(calls.length, 1, `outcome ${String(outcome)}`);
    }
    assert.deepEqual(snapshotHomeBytes(home), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. EXTRA KEY / WRONG KEY SET: fail closed; key order is not semantic.
// ---------------------------------------------------------------------------

test('F. extra keys and missing keys fail closed while key order stays non-semantic', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-outcome30-f-',
    'EIOC30-F-SRC',
    'EIOC30-F-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const dispatchId = attempt.dispatchId;

    const extraKeyVariants = [
      'acceptedAt',
      'invokedAt',
      'startedAt',
      'completedAt',
      'attemptedAt',
      'retryCount',
      'attemptNumber',
      'pid',
      'hostname',
      'endpoint',
      'workerId',
      'executorId',
      'executorGeneration',
      'invocationGeneration',
      'executionGeneration',
      'retryGeneration',
      'generation',
      'status',
      'ack',
      'receipt',
      'retry',
      'dispatched',
      'schema',
      'result',
      'taskStatus',
      'transport',
    ];
    for (const extraKey of extraKeyVariants) {
      const { calls, adapter } = countingAdapter(() =>
        validOutcome(dispatchId, 'ACCEPTED', { [extraKey]: 'smuggled' }),
      );
      await assert.rejects(
        invokeExecutorAndValidateOutcome({ dispatchId, store, adapter }),
        invalidOutcomeError,
        extraKey,
      );
      assert.equal(calls.length, 1, extraKey);
    }

    const missingKeyVariants = [
      { schemaVersion: 1, dispatchId },
      { dispatchId, outcome: 'ACCEPTED' },
      { schemaVersion: 1, outcome: 'ACCEPTED' },
      {},
    ];
    for (const value of missingKeyVariants) {
      const { calls, adapter } = countingAdapter(() => value);
      await assert.rejects(
        invokeExecutorAndValidateOutcome({ dispatchId, store, adapter }),
        invalidOutcomeError,
      );
      assert.equal(calls.length, 1);
    }

    // Positive contrast: key order is not semantically enforced for the
    // in-memory return value; the canonical record is rebuilt in fixed order.
    const reordered = { outcome: 'ACCEPTED', dispatchId, schemaVersion: 1 };
    const { adapter: reorderedAdapter } = countingAdapter(() => reordered);
    const reorderedResult = await invokeExecutorAndValidateOutcome({
      dispatchId,
      store,
      adapter: reorderedAdapter,
    });
    assertCanonicalOutcome(reorderedResult, dispatchId, EXECUTOR_INVOCATION_OUTCOME_ACCEPTED);

    // A frozen adapter return value is still a valid outcome.
    const frozen = Object.freeze(validOutcome(dispatchId, 'REJECTED'));
    const { adapter: frozenAdapter } = countingAdapter(() => frozen);
    const frozenResult = await invokeExecutorAndValidateOutcome({
      dispatchId,
      store,
      adapter: frozenAdapter,
    });
    assertCanonicalOutcome(frozenResult, dispatchId, EXECUTOR_INVOCATION_OUTCOME_REJECTED);

    assert.deepEqual(snapshotHomeBytes(home), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// G. RETURNED DISPATCHID MISMATCH: fail closed (incl. valid foreign identity).
// ---------------------------------------------------------------------------

test('G. returned dispatchId mismatch fails closed even for a fully valid foreign dispatchId', async () => {
  const { home, store, first, second } = await setupTwoAccepted(
    'greenhub-executor-invocation-outcome30-g-',
    'EIOC30-G-SRC-A',
    'EIOC30-G-CHILD-A',
    'EIOC30-G-SRC-B',
    'EIOC30-G-CHILD-B',
  );
  try {
    const before = snapshotHomeBytes(home);
    assert.notEqual(first.attempt.dispatchId, second.attempt.dispatchId);

    const mismatchValues = [
      second.attempt.dispatchId,
      `dsp_${'b'.repeat(64)}`,
      `${first.attempt.dispatchId} `,
      first.attempt.dispatchId.toUpperCase(),
      null,
      undefined,
      42,
    ];
    for (const dispatchId of mismatchValues) {
      const { calls, adapter } = countingAdapter(() => validOutcome(dispatchId, 'ACCEPTED'));
      await assert.rejects(
        invokeExecutorAndValidateOutcome({
          dispatchId: first.attempt.dispatchId,
          store,
          adapter,
        }),
        invalidOutcomeError,
        `dispatchId ${String(dispatchId)}`,
      );
      assert.equal(calls.length, 1);
    }
    assert.deepEqual(snapshotHomeBytes(home), before);

    // The matching identity still validates.
    const { adapter } = countingAdapter(() => validOutcome(first.attempt.dispatchId, 'UNKNOWN'));
    const result = await invokeExecutorAndValidateOutcome({
      dispatchId: first.attempt.dispatchId,
      store,
      adapter,
    });
    assertCanonicalOutcome(result, first.attempt.dispatchId, EXECUTOR_INVOCATION_OUTCOME_UNKNOWN);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// H. ADAPTER SYNC THROW: exact identity propagation.
// ---------------------------------------------------------------------------

test('H. adapter sync throw reaches the caller with the exact same value and is never normalized', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-outcome30-h-',
    'EIOC30-H-SRC',
    'EIOC30-H-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);

    const errorSentinel = new Error('adapter exploded (sync)');
    const stringSentinel = 'adapter-string-failure';
    // A thrown value that happens to be shaped like a valid outcome must
    // propagate as a throw, never be validated as a return.
    const thrownOutcomeSentinel = validOutcome(attempt.dispatchId, 'ACCEPTED');

    for (const sentinel of [errorSentinel, stringSentinel, thrownOutcomeSentinel]) {
      const { calls, adapter } = countingAdapter(() => {
        throw sentinel;
      });
      await assert.rejects(
        invokeExecutorAndValidateOutcome({ dispatchId: attempt.dispatchId, store, adapter }),
        (error) => error === sentinel,
      );
      assert.equal(calls.length, 1);
    }

    assert.deepEqual(snapshotHomeBytes(home), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// I. ADAPTER PROMISE REJECTION: exact identity propagation.
// ---------------------------------------------------------------------------

test('I. adapter Promise rejection reaches the caller with the exact same value and is never converted to UNKNOWN', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-outcome30-i-',
    'EIOC30-I-SRC',
    'EIOC30-I-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);

    const asyncSentinel = new Error('adapter rejected (async)');
    const rejectedSentinel = Object.freeze({ marker: 'REJECTED_SENTINEL' });

    const asyncAdapter = async () => {
      throw asyncSentinel;
    };
    await assert.rejects(
      invokeExecutorAndValidateOutcome({
        dispatchId: attempt.dispatchId,
        store,
        adapter: asyncAdapter,
      }),
      (error) => error === asyncSentinel,
    );

    let rejectionCalls = 0;
    const rejectingAdapter = () => {
      rejectionCalls += 1;
      return Promise.reject(rejectedSentinel);
    };
    await assert.rejects(
      invokeExecutorAndValidateOutcome({
        dispatchId: attempt.dispatchId,
        store,
        adapter: rejectingAdapter,
      }),
      (error) => error === rejectedSentinel,
    );
    assert.equal(rejectionCalls, 1);

    assert.deepEqual(snapshotHomeBytes(home), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// J. AT-MOST-ONCE PER API CALL: validation failure never re-invokes.
// ---------------------------------------------------------------------------

test('J. one API call invokes the adapter at most once and validation failure never triggers a retry', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-outcome30-j-',
    'EIOC30-J-SRC',
    'EIOC30-J-CHILD',
  );
  try {
    let invalidCalls = 0;
    const invalidAdapter = () => {
      invalidCalls += 1;
      return validOutcome(attempt.dispatchId, 'ACCEPTED', { schemaVersion: 2 });
    };
    await assert.rejects(
      invokeExecutorAndValidateOutcome({
        dispatchId: attempt.dispatchId,
        store,
        adapter: invalidAdapter,
      }),
      invalidOutcomeError,
    );
    assert.equal(invalidCalls, 1);

    // Repeated API calls are allowed to invoke again (no global exactly-once
    // claim), but each call still invokes exactly once.
    const { calls, adapter } = countingAdapter(() => validOutcome(attempt.dispatchId, 'ACCEPTED'));
    for (let index = 0; index < 3; index += 1) {
      const result = await invokeExecutorAndValidateOutcome({
        dispatchId: attempt.dispatchId,
        store,
        adapter,
      });
      assertCanonicalOutcome(result, attempt.dispatchId, EXECUTOR_INVOCATION_OUTCOME_ACCEPTED);
      assert.equal(calls.length, index + 1);
    }
    assert.equal(invalidCalls, 1);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// K. NO ALTERNATE DURABLE INPUT READ BEFORE THE ADAPTER INVOCATION.
// ---------------------------------------------------------------------------

test('K. the Task 29 composition is the only invocation path: one dispatchId-keyed read, before the adapter, with no alternate authority', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-outcome30-k-',
    'EIOC30-K-SRC',
    'EIOC30-K-CHILD',
  );
  try {
    const { events, store: probeStore } = eventRecordingStore(store);
    const received = [];
    const { calls, adapter } = countingAdapter((record) => {
      events.push('adapter');
      received.push(record);
      return validOutcome(attempt.dispatchId, 'ACCEPTED');
    });
    const result = await invokeExecutorAndValidateOutcome({
      dispatchId: attempt.dispatchId,
      store: probeStore,
      adapter,
    });

    assert.equal(calls.length, 1);
    assertCanonicalOutcome(result, attempt.dispatchId, EXECUTOR_INVOCATION_OUTCOME_ACCEPTED);

    // Exactly one store capability is even consulted, exactly one
    // dispatchId-only read happens, and the read precedes the adapter call.
    const reads = events.filter((event) => event.startsWith('get:'));
    const storeCalls = events.filter((event) => event.startsWith('call:'));
    assert.deepEqual([...new Set(reads)], ['get:readExecutorInvocationAttempt']);
    assert.deepEqual(storeCalls, ['call:readExecutorInvocationAttempt']);
    const adapterIndex = events.indexOf('adapter');
    assert.equal(adapterIndex, events.length - 1);
    assert.equal(storeCalls.length, 1);

    // The adapter received the exact canonical Task 28 record (composition
    // only; no Task 27/26/24/20 reconstruction).
    assert.equal(
      JSON.stringify(received[0]),
      JSON.stringify(store.readExecutorInvocationAttempt(attempt.dispatchId)),
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// L. NO DURABLE MUTATION: success / validation failure / throw.
// ---------------------------------------------------------------------------

test('L. success, validation failure, and thrown adapter all leave every durable byte and task/claim state unchanged', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-outcome30-l-',
    'EIOC30-L-SRC',
    'EIOC30-L-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const beforeStats = snapshotHomeStats(home);
    const taskBefore = store.readTask('EIOC30-L-CHILD');
    const claimBefore = store.readClaim('EIOC30-L-CHILD');
    const attemptBytes = readFileSync(attemptPath(home, attempt.dispatchId), 'utf8');

    // (1) Success.
    const { adapter: okAdapter } = countingAdapter(() =>
      validOutcome(attempt.dispatchId, 'ACCEPTED'),
    );
    await invokeExecutorAndValidateOutcome({
      dispatchId: attempt.dispatchId,
      store,
      adapter: okAdapter,
    });
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.deepEqual(snapshotHomeStats(home), beforeStats);

    // (2) Outcome validation failure.
    const { adapter: invalidAdapter } = countingAdapter(() => ({ nope: true }));
    await assert.rejects(
      invokeExecutorAndValidateOutcome({
        dispatchId: attempt.dispatchId,
        store,
        adapter: invalidAdapter,
      }),
      invalidOutcomeError,
    );
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.deepEqual(snapshotHomeStats(home), beforeStats);

    // (3) Thrown adapter.
    const { adapter: throwingAdapter } = countingAdapter(() => {
      throw new Error('no durable effect');
    });
    await assert.rejects(
      invokeExecutorAndValidateOutcome({
        dispatchId: attempt.dispatchId,
        store,
        adapter: throwingAdapter,
      }),
      (error) => error?.message === 'no durable effect',
    );
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.deepEqual(snapshotHomeStats(home), beforeStats);

    // Target durable domains are present and byte-stable.
    assert.equal(readFileSync(attemptPath(home, attempt.dispatchId), 'utf8'), attemptBytes);
    assert.equal(
      readFileSync(executorAcceptancePath(home, attempt.dispatchId), 'utf8'),
      attemptBytes,
    );
    assert.equal(readFileSync(decisionPath(home, attempt.dispatchId), 'utf8'), attemptBytes);
    assert.deepEqual(listAttemptFiles(home), [`${attempt.dispatchId}.json`]);

    // Task/claim state unchanged.
    const taskAfter = store.readTask('EIOC30-L-CHILD');
    const claimAfter = store.readClaim('EIOC30-L-CHILD');
    assert.equal(taskAfter.status, taskBefore.status);
    assert.equal(taskAfter.status, TASK_STATUS_CLAIMED);
    assert.equal(claimAfter.generation, claimBefore.generation);
    assert.equal(claimAfter.claimToken, claimBefore.claimToken);

    // No ACK/receipt/outcome/scheduler/retry/execution artifact exists.
    for (const forbiddenDir of FORBIDDEN_NEW_ARTIFACT_DIRS) {
      assert.equal(existsSync(join(home, forbiddenDir)), false, forbiddenDir);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// M. TASK STAYS CLAIMED; NO CLAIMED -> RUNNING; NO STATUS AUTHORITY.
// ---------------------------------------------------------------------------

test('M. the task stays CLAIMED after success and failure and the module carries no RUNNING/ACKED status authority', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-outcome30-m-',
    'EIOC30-M-SRC',
    'EIOC30-M-CHILD',
  );
  try {
    const claimBefore = store.readClaim('EIOC30-M-CHILD');
    const { adapter } = countingAdapter(() => validOutcome(attempt.dispatchId, 'ACCEPTED'));
    await invokeExecutorAndValidateOutcome({
      dispatchId: attempt.dispatchId,
      store,
      adapter,
    });
    assert.equal(store.readTask('EIOC30-M-CHILD').status, TASK_STATUS_CLAIMED);

    const { adapter: failingAdapter } = countingAdapter(() => ({ invalid: true }));
    await assert.rejects(
      invokeExecutorAndValidateOutcome({
        dispatchId: attempt.dispatchId,
        store,
        adapter: failingAdapter,
      }),
      invalidOutcomeError,
    );
    assert.equal(store.readTask('EIOC30-M-CHILD').status, TASK_STATUS_CLAIMED);

    const claimAfter = store.readClaim('EIOC30-M-CHILD');
    assert.equal(claimAfter.generation, claimBefore.generation);
    assert.equal(claimAfter.claimToken, claimBefore.claimToken);

    // Functional code creates no task-status authority.
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
    ]) {
      assert.equal(code.includes(status), false, `${status} must not exist in code`);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// N. NO ACK/RECEIPT/RESULT/DISPOSITION MUTATION.
// ---------------------------------------------------------------------------

test('N. no ACK/receipt/result/disposition artifact or store primitive is created by the outcome contract', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-outcome30-n-',
    'EIOC30-N-SRC',
    'EIOC30-N-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const { adapter } = countingAdapter(() => validOutcome(attempt.dispatchId, 'ACCEPTED'));
    const result = await invokeExecutorAndValidateOutcome({
      dispatchId: attempt.dispatchId,
      store,
      adapter,
    });

    // The validated outcome carries no ACK/receipt/result/disposition token.
    const resultJson = JSON.stringify(result);
    for (const token of FORBIDDEN_OUTCOME_TOKENS) {
      assert.equal(resultJson.includes(token), false, token);
    }

    // No new durable path at all.
    const after = snapshotHomeBytes(home);
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
    for (const [name, value] of Object.entries(before)) {
      assert.equal(after[name], value, name);
    }

    // No Task 30 store primitive or mutation entry was added.
    for (const forbidden of [
      'invokeExecutorAndValidateOutcome',
      'validateExecutorInvocationOutcome',
      'invokeExecutorInvocationAdapter',
      'invokeExecutor',
      'executeTask',
      'executeDispatch',
      'acknowledgeExecutor',
      'acknowledgeDispatch',
      'persistExecutorInvocationOutcome',
      'persistInvocationOutcome',
      'writeInvocationOutcome',
      'createInvocationOutcome',
      'selectExecutor',
      'selectWorker',
      'scheduleExecutor',
      'scheduleNextTask',
      'retryDispatch',
      'resendDispatch',
      'backoffDispatch',
      'invocationCounter',
      'retryCounter',
    ]) {
      assert.equal(store[forbidden], undefined, `store.${forbidden} must not exist`);
    }
    assert.equal(typeof store.readExecutorInvocationAttempt, 'function');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// O. PRODUCTION MODULE STATIC BOUNDARY + EXACT EXPORTED SURFACE.
// ---------------------------------------------------------------------------

test('O. production module carries no concrete executor/transport/process/fs/retry authority and one narrow entry', () => {
  const raw = readFileSync(MODULE_PATH, 'utf8');
  const code = codeOnly(raw);
  for (const forbidden of [
    "from 'node:fs'",
    "from 'node:child_process'",
    "from 'node:net'",
    "from 'node:http'",
    "from 'node:https'",
    "from 'node:worker_threads'",
    "from 'node:crypto'",
    "from './store.mjs'",
    'child_process',
    'spawn(',
    'spawnSync(',
    'exec(',
    'execFile(',
    'execSync(',
    'fork(',
    'fetch(',
    'WebSocket',
    'XMLHttpRequest',
    'http.request(',
    'grpc',
    'mqtt',
    'MCP',
    'stdio',
    'stdin',
    'stdout',
    'invokeExecutor(',
    'executeTask',
    'executeDispatch',
    'invokeOpenCode',
    'invokeCodex',
    'invokeAstra',
    'invokeChatGpt',
    'acknowledgeDispatch',
    'ackDispatch',
    'receipt',
    'scheduler',
    'scheduleNextTask',
    'decideNextTask',
    'polling',
    'daemon',
    'cron',
    'retry',
    'backoff',
    'resend',
    'executionAllowed',
    'executionStarted',
    'executorInvoked',
    'executorStarted',
    'invocationStarted',
    'invocationReady',
    'workerSelected',
    'selectWorker',
    'selectExecutor',
    'workerRegistry',
    'executorRegistry',
    'adapterRegistry',
    'capabilityMatch',
    'endpointDiscovery',
    'environmentSelection',
    'executorGeneration',
    'invocationGeneration',
    'executionGeneration',
    'attemptGeneration',
    'retryGeneration',
    'persistReceiverDecision',
    'acceptReceiverDispatch',
    'createReceiverDispatchDecision',
    'createExecutorDispatchAcceptance',
    'acceptExecutorDispatchDecision',
    'persistExecutorInvocationAttempt',
    'readExecutorInvocationInput',
    'writeDisposition',
    'deliverResult',
    'claimTask',
    'markReady',
    'createTask',
    'writeFileSync',
    'writeFile(',
    'mkdirSync',
    'rmSync',
    'unlink',
    'rename',
    'appendFile',
    'createWriteStream',
    'writeJsonExclusive',
    'Date.now',
    'new Date',
    'performance.now',
    'randomUUID',
    'Math.random',
    'setTimeout',
    'setInterval',
    'process.env',
    'process.pid',
    'process.platform',
    'new Map(',
    'new Set(',
    'node:path',
    'require(',
  ]) {
    assert.equal(code.includes(forbidden), false, `code must not contain ${forbidden}`);
  }

  // The only composition is the Task 29 public entry; no predecessor durable
  // reader/validator or mutation entry is imported.
  const importSpecifiers = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(importSpecifiers, ['./dispatch-executor-invocation-contract.mjs']);
  assert.ok(code.includes('invokeExecutorInvocationAdapter('));
  assert.equal(code.includes('store.readExecutorInvocationAttempt('), false);
  assert.equal(code.includes('validateReceiverDecisionRecord('), false);
  assert.equal(code.includes('readExecutorInvocationInput('), false);
  assert.equal(code.includes('persistExecutorInvocationAttempt('), false);

  // Exported surface: constants + error class + ONE narrow entry only.
  const exportedFunctions = Object.entries(outcomeModule)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(exportedFunctions, [
    'ExecutorInvocationOutcomeError',
    'invokeExecutorAndValidateOutcome',
  ]);
  assert.equal(typeof invokeExecutorAndValidateOutcome, 'function');
  assert.equal(EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION, 1);
  assert.deepEqual([...EXECUTOR_INVOCATION_OUTCOME_VALUES], ['ACCEPTED', 'REJECTED', 'UNKNOWN']);
  assert.deepEqual(
    [...EXECUTOR_INVOCATION_OUTCOME_FIELDS],
    ['schemaVersion', 'dispatchId', 'outcome'],
  );
  assert.equal(INVALID_EXECUTOR_INVOCATION_OUTCOME, 'INVALID_EXECUTOR_INVOCATION_OUTCOME');
  assert.equal(typeof ExecutorInvocationOutcomeError, 'function');
});

// ---------------------------------------------------------------------------
// P. NO NEW GENERATION AUTHORITY; claimGeneration STAYS THE SOLE GENERATION.
// ---------------------------------------------------------------------------

test('P. the outcome contract creates no new generation/fencing authority', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-outcome30-p-',
    'EIOC30-P-SRC',
    'EIOC30-P-CHILD',
  );
  try {
    const received = [];
    const { adapter } = countingAdapter((record) => {
      received.push(record);
      return validOutcome(attempt.dispatchId, 'UNKNOWN');
    });
    const result = await invokeExecutorAndValidateOutcome({
      dispatchId: attempt.dispatchId,
      store,
      adapter,
    });

    // The validated outcome has no generation-like key.
    const outcomeGenerationKeys = Object.keys(result).filter((key) => /generation/i.test(key));
    assert.deepEqual(outcomeGenerationKeys, []);

    // The Task 28 record reaching the adapter still carries claimGeneration as
    // its SOLE generation field.
    const generationKeys = [
      ...new Set(collectKeys(received[0]).filter((key) => /generation/i.test(key))),
    ];
    assert.deepEqual(generationKeys, ['claimGeneration']);
    assert.equal(received[0].decisionInput.claimGeneration, 1);

    // Functional code creates no new generation authority.
    const code = codeOnly(readFileSync(MODULE_PATH, 'utf8'));
    assert.equal(code.includes('Generation'), false);
    assert.equal(code.includes('claimGeneration'), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// Q. TASK 29 PUBLIC SURFACE INTACT; TASK 30 COMPOSES IT ONLY.
// ---------------------------------------------------------------------------

test('Q. Task 29 public behavior surface stays intact and is composed, never duplicated', () => {
  assert.equal(typeof invokeExecutorInvocationAdapter, 'function');
  assert.equal(EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND, 'EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND');
  assert.equal(INVALID_EXECUTOR_INVOCATION_ADAPTER, 'INVALID_EXECUTOR_INVOCATION_ADAPTER');
  assert.equal(
    INVALID_EXECUTOR_INVOCATION_CONTRACT_STORE,
    'INVALID_EXECUTOR_INVOCATION_CONTRACT_STORE',
  );
  assert.equal(typeof ExecutorInvocationContractError, 'function');

  // The production module imports the Task 29 entry ONLY (no store.mjs, no
  // predecessor durable module, no whole-file predecessor pin chain).
  const code = codeOnly(readFileSync(MODULE_PATH, 'utf8'));
  const importSpecifiers = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(importSpecifiers, ['./dispatch-executor-invocation-contract.mjs']);
  assert.equal(code.includes('createHash'), false);
  assert.equal(code.includes('sha256'), false);
});

// ---------------------------------------------------------------------------
// F2. TASK 29 FAIL-CLOSED ERRORS PROPAGATE UNCHANGED THROUGH TASK 30.
// ---------------------------------------------------------------------------

test('F2. Task 29 fail-closed errors propagate unchanged through the Task 30 entry with zero extra reads or calls', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-outcome30-f2-',
    'EIOC30-F2-SRC',
    'EIOC30-F2-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);

    // (1) Invalid dispatchId: Task 28 identity error, zero store access, zero
    // adapter calls.
    {
      const { events, store: probeStore } = eventRecordingStore(store);
      const { calls, adapter } = countingAdapter(() =>
        validOutcome(attempt.dispatchId, 'ACCEPTED'),
      );
      await assert.rejects(
        invokeExecutorAndValidateOutcome({
          dispatchId: 'not-a-dispatch-id',
          store: probeStore,
          adapter,
        }),
        (error) =>
          error instanceof ExecutorInvocationAttemptError &&
          error.code === CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
      );
      assert.equal(events.length, 0);
      assert.equal(calls.length, 0);
    }

    // (2) Invalid adapter: Task 29 adapter error, zero store reads.
    {
      const { events, store: probeStore } = eventRecordingStore(store);
      await assert.rejects(
        invokeExecutorAndValidateOutcome({
          dispatchId: attempt.dispatchId,
          store: probeStore,
          adapter: undefined,
        }),
        (error) =>
          error instanceof ExecutorInvocationContractError &&
          error.code === INVALID_EXECUTOR_INVOCATION_ADAPTER,
      );
      assert.equal(events.length, 0);
    }

    // (3) Invalid store: Task 29 store error, zero adapter calls.
    {
      const { calls, adapter } = countingAdapter(() =>
        validOutcome(attempt.dispatchId, 'ACCEPTED'),
      );
      await assert.rejects(
        invokeExecutorAndValidateOutcome({
          dispatchId: attempt.dispatchId,
          store: {},
          adapter,
        }),
        (error) =>
          error instanceof ExecutorInvocationContractError &&
          error.code === INVALID_EXECUTOR_INVOCATION_CONTRACT_STORE,
      );
      assert.equal(calls.length, 0);
    }

    assert.deepEqual(snapshotHomeBytes(home), before);

    // (4) Missing Task 28 durable attempt: Task 29-native read failure with
    // zero adapter calls and zero writes.
    const missing = await setupInputOnly(
      'greenhub-executor-invocation-outcome30-f2-missing-',
      'EIOC30-F2M-SRC',
      'EIOC30-F2M-CHILD',
    );
    try {
      const missingBefore = snapshotHomeBytes(missing.home);
      const { calls, adapter } = countingAdapter(() =>
        validOutcome(missing.attempt.dispatchId, 'ACCEPTED'),
      );
      await assert.rejects(
        invokeExecutorAndValidateOutcome({
          dispatchId: missing.attempt.dispatchId,
          store: missing.store,
          adapter,
        }),
        (error) =>
          error instanceof ExecutorInvocationContractError &&
          error.code === EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND,
      );
      assert.equal(calls.length, 0);
      assert.deepEqual(snapshotHomeBytes(missing.home), missingBefore);
      assert.equal(missing.store.readTask('EIOC30-F2M-CHILD').status, TASK_STATUS_CLAIMED);
    } finally {
      removeHome(missing.home);
    }
  } finally {
    removeHome(home);
  }
});
