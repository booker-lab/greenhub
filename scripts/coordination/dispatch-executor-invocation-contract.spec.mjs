// Proof for GREENHUB-COORDINATION-EXECUTOR-INVOCATION-ADAPTER-CONTRACT-29.
//
// DURABLE_EXECUTOR_INVOCATION_ATTEMPT(dispatchId)
//   -> CALLER_SUPPLIED_EXECUTOR_ADAPTER_INVOCATION(dispatchId).
//
// CALLER_SUPPLIED_EXECUTOR_ADAPTER_INVOCATION != global exactly-once
// invocation != delivery success != executor received/accepted/started != task
// started/completed != ACK received != receipt persisted != execution start
// != task status transition != scheduler decision != worker/executor selection
// != retry/resend authority != new generation/fencing authority.
// read != invoke != ACK != execute.
//
// The entry is EXACTLY, in this validation order:
//   (dispatchId, store, adapter)
//     1. dispatchId identity validation [Task 28 family; invalid -> no store
//        access, no adapter call]
//     2. adapter capability validation [invalid -> no store read, no call]
//     3. store capability gate [readExecutorInvocationAttempt ONLY]
//     4. store.readExecutorInvocationAttempt(dispatchId) [dispatchId is the
//        ONLY lookup key; at most one read; no polling/scan/fallback]
//     5. missing -> EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND [Task 29-native read
//        failure only; zero writes; never retry/availability/ACK/transport]
//     6. Task 28 record validation via Task 27 validateExecutorInvocationInputRecord
//        VERBATIM [predecessor codes propagate UNCHANGED; no repair]
//     7. validated.dispatchId === dispatchId [binding re-check]
//     8. caller-supplied adapter(EXACT validated record) AT MOST ONCE per API
//        call [no internal retry, no fallback adapter]
//     9. adapter return/rejection propagated UNCHANGED
//
// This Task proves ONLY the bounded invocation contract over the canonical
// Task 28 durable record. It explicitly does NOT prove concrete executor
// integration, delivery success, ACK receipt, executor start, task RUNNING,
// exactly-once execution, or a retry system.
//
// Proof map:
//   A. exact canonical record -> adapter; adapter value -> caller unchanged.
//   B. dispatchId is the only lookup key (proxy store).
//   C. invalid dispatchId -> zero store access, zero adapter calls.
//   D. invalid/missing adapter -> zero store reads, zero calls; order stated.
//   E. missing Task 28 attempt -> NOT_FOUND, zero adapter calls, zero writes.
//   F. corrupt Task 28 attempt -> fail closed, zero calls, bytes preserved.
//   G. dispatchId/path-record binding mismatch -> fail closed, zero calls.
//   H. at-most-once per API call; multiple API calls stay possible.
//   I. adapter throw/reject -> exact propagation, zero retry, zero 2nd call.
//   J. adapter return value passthrough without normalization/wrapper.
//   K. every predecessor durable byte + task/claim state unchanged; no store
//      surface gain; no forbidden artifact.
//   L. production module static boundary (no transport/process/fs/retry).
//   M. no ACK/receipt/execution status token added to durable state.
//   N. claimGeneration stays the SOLE generation field.
//   O. retained Task 18~28 predecessor source/spec bytes unchanged.
//
// All runtime state lives in isolated temp directories. No network required.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as invocationAttemptModule from './dispatch-executor-invocation-attempt.mjs';
import {
  CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
  EXECUTOR_INVOCATION_ATTEMPTS_DIRNAME,
  ExecutorInvocationAttemptError,
  executorInvocationAttemptFilePath,
  persistExecutorInvocationAttempt,
} from './dispatch-executor-invocation-attempt.mjs';
import * as invocationContractModule from './dispatch-executor-invocation-contract.mjs';
import {
  EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND,
  ExecutorInvocationContractError,
  INVALID_EXECUTOR_INVOCATION_ADAPTER,
  INVALID_EXECUTOR_INVOCATION_CONTRACT_STORE,
  invokeExecutorInvocationAdapter,
} from './dispatch-executor-invocation-contract.mjs';
import {
  buildExecutorInvocationInputRecord,
  CORRUPT_EXECUTOR_INVOCATION_INPUT,
  readExecutorInvocationInput,
} from './dispatch-executor-invocation-input.mjs';
import {
  acceptReceiverDispatch,
  receiverDispatchAcceptanceFilePath,
} from './dispatch-receiver-acceptance.mjs';
import { RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND } from './dispatch-receiver-decision-input.mjs';
import {
  CORRUPT_TRANSPORT_REQUEST,
  prepareDispatchTransportRequest,
} from './dispatch-transport-contract.mjs';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import { CoordinationStore } from './store.mjs';
import { TASK_STATUS_CLAIMED } from './task-envelope.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = join(MODULE_DIRECTORY, 'dispatch-executor-invocation-contract.mjs');

// Task 18~28 predecessor source/spec bytes are pinned to the exact live-main
// baseline this invocation contract was built against. A change to any pinned
// file is a predecessor-contract change and must come from an explicitly
// predecessor-owning Task, never from this bounded invocation surface.
// store.mjs is the only composed predecessor file allowed to grow (additive
// primitives only), so it is not pinned; it is additionally proven untouched
// by this Task (no new store primitive, no byte change requirement).
const PREDECESSOR_SHA256 = Object.freeze({
  'claim-bound-dispatch-envelope.mjs':
    '5007584743e70f73a8076990718ae81223200a4b71b0600078ed8bf975ca3133',
  'claim-bound-dispatch-envelope.spec.mjs':
    '3936347ddc6b0162ada1b09d33ad3501d173e4782e418fed71b6e1e9b3ef9026',
  'dispatch-attempt.mjs': '233e1964dd4fc9d4b89069087490f72a01ffd42f5014ab2bc05d114d84010565',
  'dispatch-attempt.spec.mjs': '0b51a7db51407afb39d3f89f66e1bdb97b08c4e1aadfe456855e39da29d8d47b',
  'dispatch-transport-contract.mjs':
    '38430829f0f561685f349b7470a62a2e30ce2202422048457518eab8a450fee1',
  'dispatch-transport-contract.spec.mjs':
    'abeaf409b4f336c7c6d76f7c9a0b3832c81d0cd0664cc13aae42ca61497a2a44',
  'dispatch-receiver-idempotency-read.mjs':
    '7b5de3e5c199a96dece818b9b008603b7007791fd62989a0ab75144a25627aae',
  'dispatch-receiver-idempotency-read.spec.mjs':
    '7490ad79b6ca84abcf1449cbbbe863485296127c3ba12d558758b8b20cdb0c52',
  'dispatch-receiver-acceptance.mjs':
    'ef8aa0325dde85281220bbb0659dc5a1901d959e5371a2dcbfe7d483701d1321',
  'dispatch-receiver-acceptance.spec.mjs':
    '4a7704559bfa6037b55433a2b9dc0c4022f8110121aeece4d3b5535f6bb257d3',
  'dispatch-receiver-decision-input.mjs':
    'e4c660412fdb7cdab0d3c8cb505aa08e73a8a192c08886fbf50ba6b9c8957226',
  'dispatch-receiver-decision-input.spec.mjs':
    'cd77a8d8ecf83244cc0c6c32ab734d68cfcf5ed9b876cacf2fad8bc3b958bddf',
  'dispatch-executor-invocation-input.mjs':
    'be5d8936eff0816b51d8df2f50c03a398f1a3e3291e22c1511fc0820045d9cc6',
  'dispatch-executor-invocation-input.spec.mjs':
    '47b69a35846950dee36644ddb146fa859bea45d448e12d5f23cc04ddf0122450',
  'dispatch-executor-invocation-attempt.mjs':
    'e96271e28141ed33e03e9bfd8fce680166e189d6e965ee4d5a3f4d45cc12c395',
  'dispatch-executor-invocation-attempt.spec.mjs':
    '8a49aa9c3bdc6fb798c365dcb155f4ce466ab47c16695a6e9c9a1b234dce8de6',
});

const FORBIDDEN_NEW_ARTIFACT_DIRS = Object.freeze([
  'invocation-input',
  'invocation-inputs',
  'invocation-attempts',
  'executor-invocations',
  'executor-invocation-inputs',
  'invocations',
  'invocation-contract',
  'invocation-contracts',
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

function makeHome(prefix = 'greenhub-executor-invocation-contract29-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'EXECUTOR_INVOCATION_ADAPTER_CONTRACT_PROVED',
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
    proofRequirement: ['executor-invocation-adapter-contract-proof'],
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

// Task 29 setup: source -> child claim -> durable dispatch attempt -> Task 20
// request -> Task 22 durable receiver acceptance -> Task 27 readable
// invocation input (direct composition over the durable receiver acceptance).
// The Task 28 durable invocation attempt is NOT persisted here.
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
// dispatchId/path-record binding check with a fully valid foreign record.
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

function listAttemptFiles(home) {
  try {
    return [...readdirSync(attemptDir(home))].sort();
  } catch {
    return [];
  }
}

function expectedRecordBytes(record) {
  return JSON.stringify(record, null, 2);
}

// Strongest "no alternate primitive consulted" probe: every property access on
// the store is recorded, and every function-valued property invocation is
// recorded with its arguments.
function proxyCountingStore(target) {
  const reads = [];
  const calls = [];
  const store = new Proxy(target, {
    get(object, property, receiver) {
      if (typeof property === 'string') reads.push(property);
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
  return { reads, calls, store };
}

function countingAdapter(returnValue = undefined) {
  const calls = [];
  const adapter = (...args) => {
    calls.push({ args });
    return returnValue;
  };
  return { calls, adapter };
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

// ---------------------------------------------------------------------------
// A. EXACT CANONICAL RECORD -> ADAPTER; ADAPTER VALUE -> CALLER.
// ---------------------------------------------------------------------------

test('A. adapter receives the exact canonical Task 28 durable record and the caller receives the adapter value unchanged', async () => {
  const { home, store, attempt, input } = await setupAccepted(
    'greenhub-executor-invocation-contract29-a-',
    'EIC29-A-SRC',
    'EIC29-A-CHILD',
  );
  try {
    const sentinel = Object.freeze({ marker: 'ADAPTER_RETURN_SENTINEL' });
    const { calls, adapter } = countingAdapter(sentinel);
    const before = snapshotHomeBytes(home);
    const result = await invokeExecutorInvocationAdapter({
      dispatchId: attempt.dispatchId,
      store,
      adapter,
    });

    // Adapter value is propagated without normalization or wrapping.
    assert.equal(result, sentinel);

    // Exactly one invocation, one positional argument: the record itself.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.length, 1);
    const record = calls[0].args[0];
    assert.ok(Object.isFrozen(record));
    assert.deepEqual(Object.keys(record), [
      'schemaVersion',
      'dispatchId',
      'decision',
      'decisionInput',
    ]);

    // The adapter sees the EXACT canonical durable record: byte-equivalent to
    // the store read, the Task 27 readable input, and the durable file.
    assert.equal(
      JSON.stringify(record),
      JSON.stringify(store.readExecutorInvocationAttempt(attempt.dispatchId)),
    );
    assert.equal(JSON.stringify(record), JSON.stringify(input));
    assert.equal(
      readFileSync(attemptPath(home, attempt.dispatchId), 'utf8'),
      expectedRecordBytes(record),
    );

    // dispatchId + inherited bindings + SOLE fencing generation preserved.
    assert.equal(record.dispatchId, attempt.dispatchId);
    assert.equal(record.decisionInput.dispatchId, attempt.dispatchId);
    assert.equal(record.decisionInput.sourceTaskId, 'EIC29-A-SRC');
    assert.equal(record.decisionInput.nextTaskId, 'EIC29-A-CHILD');
    assert.equal(record.decisionInput.workerId, 'worker-a');
    assert.equal(record.decisionInput.admissionId, attempt.admissionId);
    assert.equal(record.decisionInput.emissionSlot, attempt.emissionSlot);
    assert.equal(record.decisionInput.claimGeneration, 1);

    // No wrapper metadata is added around the record.
    for (const wrapper of [
      'record',
      'adapter',
      'request',
      'invokedAt',
      'attemptedAt',
      'pid',
      'hostname',
      'executorGeneration',
      'invocationGeneration',
      'retryGeneration',
      'attemptNumber',
      'retryCount',
      'receipt',
      'ack',
    ]) {
      assert.equal(Object.hasOwn(record, wrapper), false, wrapper);
    }

    // The invocation itself performs ZERO durable writes.
    assert.deepEqual(snapshotHomeBytes(home), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// B. dispatchId-ONLY LOOKUP: exactly the required primitive is consulted.
// ---------------------------------------------------------------------------

test('B. dispatchId is the only lookup key: one dispatchId-keyed read and no alternate authority', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-contract29-b-',
    'EIC29-B-SRC',
    'EIC29-B-CHILD',
  );
  try {
    const { reads, calls, store: proxyStore } = proxyCountingStore(store);
    const { calls: adapterCalls, adapter } = countingAdapter('adapter-ok');
    const result = await invokeExecutorInvocationAdapter({
      dispatchId: attempt.dispatchId,
      store: proxyStore,
      adapter,
    });
    assert.equal(result, 'adapter-ok');
    assert.equal(adapterCalls.length, 1);

    // Exactly one store capability is even consulted, and exactly one
    // dispatchId-only read happens per API call.
    assert.deepEqual([...new Set(reads)].sort(), ['readExecutorInvocationAttempt']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].op, 'readExecutorInvocationAttempt');
    assert.deepEqual(calls[0].args, [attempt.dispatchId]);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// C. INVALID DISPATCHID: zero store access, zero adapter calls.
// ---------------------------------------------------------------------------

test('C. invalid dispatchId fails closed before any store access or adapter call', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-contract29-c-',
    'EIC29-C-SRC',
    'EIC29-C-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const { calls: adapterCalls, adapter } = countingAdapter('never');
    const { reads, calls, store: probeStore } = proxyCountingStore(store);

    for (const invalidId of [
      undefined,
      null,
      '',
      'not-a-dispatch-id',
      'dsp_',
      `dsp_${'a'.repeat(63)}`,
      `dsp_${'a'.repeat(65)}`,
      `dsp_${'A'.repeat(64)}`,
      `dsp_${'g'.repeat(64)}`,
      `../dsp_${'a'.repeat(64)}`,
      42,
      {},
    ]) {
      await assert.rejects(
        invokeExecutorInvocationAdapter({
          dispatchId: invalidId,
          store: probeStore,
          adapter,
        }),
        (error) =>
          error instanceof ExecutorInvocationAttemptError &&
          error.code === CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
      );
    }
    await assert.rejects(invokeExecutorInvocationAdapter(), (error) => error != null);
    await assert.rejects(
      invokeExecutorInvocationAdapter({
        dispatchId: attempt.dispatchId,
        store: undefined,
        adapter: undefined,
      }),
      (error) => error?.code === INVALID_EXECUTOR_INVOCATION_ADAPTER,
    );

    assert.equal(reads.length, 0);
    assert.equal(calls.length, 0);
    assert.equal(adapterCalls.length, 0);
    assert.deepEqual(snapshotHomeBytes(home), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// D. INVALID ADAPTER: zero store reads, zero adapter calls, order stated.
// ---------------------------------------------------------------------------

test('D. invalid/missing adapter fails closed before any store read; invalid store never calls the adapter', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-contract29-d-',
    'EIC29-D-SRC',
    'EIC29-D-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);

    // Order proof: adapter capability is validated BEFORE store access, so an
    // invalid adapter performs zero store property reads.
    for (const invalidAdapter of [undefined, null, 'adapter', 42, {}, [], true]) {
      const { reads, calls, store: probeStore } = proxyCountingStore(store);
      await assert.rejects(
        invokeExecutorInvocationAdapter({
          dispatchId: attempt.dispatchId,
          store: probeStore,
          adapter: invalidAdapter,
        }),
        (error) =>
          error instanceof ExecutorInvocationContractError &&
          error.code === INVALID_EXECUTOR_INVOCATION_ADAPTER,
      );
      assert.equal(reads.length, 0);
      assert.equal(calls.length, 0);
    }

    // An invalid adapter wins over an invalid store (validation order).
    await assert.rejects(
      invokeExecutorInvocationAdapter({
        dispatchId: attempt.dispatchId,
        store: undefined,
        adapter: undefined,
      }),
      (error) => error?.code === INVALID_EXECUTOR_INVOCATION_ADAPTER,
    );

    // Invalid stores: fail with the invocation-contract-native store code and
    // never call the (valid) adapter.
    let adapterCalls = 0;
    const validAdapter = () => {
      adapterCalls += 1;
      return null;
    };
    for (const invalidStore of [
      undefined,
      null,
      'store',
      42,
      {},
      { readExecutorInvocationAttempt: 7 },
      { readExecutorInvocationAttempt: undefined },
      { readReceiverDispatchAcceptance: () => null },
    ]) {
      await assert.rejects(
        invokeExecutorInvocationAdapter({
          dispatchId: attempt.dispatchId,
          store: invalidStore,
          adapter: validAdapter,
        }),
        (error) =>
          error instanceof ExecutorInvocationContractError &&
          error.code === INVALID_EXECUTOR_INVOCATION_CONTRACT_STORE,
      );
    }
    assert.equal(adapterCalls, 0);
    assert.deepEqual(snapshotHomeBytes(home), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. MISSING TASK 28 ATTEMPT: Task 29-native read failure, zero writes.
// ---------------------------------------------------------------------------

test('E. missing Task 28 durable attempt fails with EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND, zero adapter calls, zero mutation', async () => {
  const { home, store, attempt, input } = await setupInputOnly(
    'greenhub-executor-invocation-contract29-e-',
    'EIC29-E-SRC',
    'EIC29-E-CHILD',
  );
  try {
    // Task 22 durable receiver acceptance + Task 27 readable input exist; the
    // Task 28 durable invocation attempt does not.
    assert.equal(store.readReceiverDispatchAcceptance(attempt.dispatchId) !== null, true);
    assert.equal(input.dispatchId, attempt.dispatchId);
    assert.equal(store.readExecutorInvocationAttempt(attempt.dispatchId), null);

    const before = snapshotHomeBytes(home);
    let reads = 0;
    const probeStore = {
      readExecutorInvocationAttempt: (dispatchId) => {
        reads += 1;
        return store.readExecutorInvocationAttempt(dispatchId);
      },
    };
    const { calls: adapterCalls, adapter } = countingAdapter('never');

    for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
      await assert.rejects(
        invokeExecutorInvocationAdapter({
          dispatchId: attempt.dispatchId,
          store: probeStore,
          adapter,
        }),
        (error) =>
          error instanceof ExecutorInvocationContractError &&
          error.code === EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND,
      );
    }

    // Read-failure meaning ONLY: never retry / executor unavailable / ACK
    // timeout / task failure / scheduler failure; distinct from the retained
    // Task 23 predecessor missing-record code.
    assert.notEqual(EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND, RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND);
    assert.equal(reads, 2);
    assert.equal(adapterCalls.length, 0);

    // Zero writes: no attempt auto-created, no attempt directory, no
    // predecessor mutation.
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.equal(existsSync(attemptDir(home)), false);
    assert.equal(existsSync(attemptPath(home, attempt.dispatchId)), false);
    assert.equal(store.readExecutorInvocationAttempt(attempt.dispatchId), null);
    assert.equal(store.readTask('EIC29-E-CHILD').status, TASK_STATUS_CLAIMED);
    assert.equal(store.readClaim('EIC29-E-CHILD').generation, 1);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. CORRUPT TASK 28 RECORD: fail closed, zero calls, bytes preserved.
// ---------------------------------------------------------------------------

test('F. corrupt Task 28 durable attempt fails closed with predecessor codes, zero adapter calls, and no repair', async () => {
  const { home, store, attempt, request } = await setupAccepted(
    'greenhub-executor-invocation-contract29-f-',
    'EIC29-F-SRC',
    'EIC29-F-CHILD',
  );
  try {
    const path = attemptPath(home, attempt.dispatchId);
    const pristineBytes = readFileSync(path, 'utf8');
    const goodRecord = store.readExecutorInvocationAttempt(attempt.dispatchId);
    const variants = [
      {
        name: 'unparseable bytes',
        bytes: '{ not json',
        code: CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
      },
      {
        name: 'valid JSON wrong shape',
        bytes: JSON.stringify({ hello: 'not-an-attempt' }, null, 2),
        code: CORRUPT_EXECUTOR_INVOCATION_INPUT,
      },
      {
        name: 'key order drift',
        bytes: JSON.stringify(
          {
            dispatchId: goodRecord.dispatchId,
            schemaVersion: goodRecord.schemaVersion,
            decision: goodRecord.decision,
            decisionInput: goodRecord.decisionInput,
          },
          null,
          2,
        ),
        code: CORRUPT_EXECUTOR_INVOCATION_INPUT,
      },
      {
        name: 'decision value drift',
        bytes: JSON.stringify({ ...goodRecord, decision: 'ACK' }, null, 2),
        code: CORRUPT_EXECUTOR_INVOCATION_INPUT,
      },
      {
        name: 'blocked timestamp field',
        bytes: JSON.stringify({ ...goodRecord, attemptedAt: 'now' }, null, 2),
        code: CORRUPT_EXECUTOR_INVOCATION_INPUT,
      },
      {
        name: 'new generation smuggling',
        bytes: JSON.stringify({ ...goodRecord, invocationGeneration: 1 }, null, 2),
        code: CORRUPT_EXECUTOR_INVOCATION_INPUT,
      },
      {
        name: 'inner request tamper (workerId)',
        bytes: JSON.stringify(
          { ...goodRecord, decisionInput: { ...request, workerId: 'worker-tampered' } },
          null,
          2,
        ),
        code: 'DISPATCH_BINDING_MISMATCH',
      },
      {
        name: 'inner generation smuggling',
        bytes: JSON.stringify(
          { ...goodRecord, decisionInput: { ...request, attemptGeneration: 1 } },
          null,
          2,
        ),
        code: CORRUPT_TRANSPORT_REQUEST,
      },
    ];

    for (const variant of variants) {
      writeFileSync(path, variant.bytes, 'utf8');
      let adapterCalls = 0;
      const adapter = () => {
        adapterCalls += 1;
        return 'never';
      };
      await assert.rejects(
        invokeExecutorInvocationAdapter({
          dispatchId: attempt.dispatchId,
          store,
          adapter,
        }),
        (error) => error?.code === variant.code,
        variant.name,
      );
      // Zero adapter calls, zero repair, exact corrupt bytes preserved.
      assert.equal(adapterCalls, 0, variant.name);
      assert.equal(readFileSync(path, 'utf8'), variant.bytes, variant.name);
      assert.deepEqual(listAttemptFiles(home), [`${attempt.dispatchId}.json`], variant.name);
    }

    // Restoring the exact durable bytes re-enables the invocation path.
    writeFileSync(path, pristineBytes, 'utf8');
    const { calls, adapter } = countingAdapter('restored');
    const result = await invokeExecutorInvocationAdapter({
      dispatchId: attempt.dispatchId,
      store,
      adapter,
    });
    assert.equal(result, 'restored');
    assert.equal(calls.length, 1);
    assert.equal(readFileSync(path, 'utf8'), pristineBytes);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// G. BINDING MISMATCH: dispatchId/path-record drift fails closed.
// ---------------------------------------------------------------------------

test('G. dispatchId/path-record binding mismatch fails closed with zero adapter calls and no repair', async () => {
  const { home, store, first, second } = await setupTwoAccepted(
    'greenhub-executor-invocation-contract29-g-',
    'EIC29-G-SRC-A',
    'EIC29-G-CHILD-A',
    'EIC29-G-SRC-B',
    'EIC29-G-CHILD-B',
  );
  try {
    const foreignRecord = store.readExecutorInvocationAttempt(second.attempt.dispatchId);
    assert.equal(foreignRecord.dispatchId, second.attempt.dispatchId);
    assert.notEqual(second.attempt.dispatchId, first.attempt.dispatchId);

    // (1) Caller-supplied store returns a FULLY VALID record bound to a
    // different dispatchId: the Task 29 binding re-check fails closed.
    let adapterCalls = 0;
    const adapter = () => {
      adapterCalls += 1;
      return 'never';
    };
    const foreignStore = { readExecutorInvocationAttempt: () => foreignRecord };
    await assert.rejects(
      invokeExecutorInvocationAdapter({
        dispatchId: first.attempt.dispatchId,
        store: foreignStore,
        adapter,
      }),
      (error) =>
        error instanceof ExecutorInvocationContractError &&
        error.code === CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
    );
    assert.equal(adapterCalls, 0);

    // (2) Real store: a valid foreign record written under this dispatchId's
    // path fails closed at the store read and is never repaired.
    const firstPath = attemptPath(home, first.attempt.dispatchId);
    const firstBytes = readFileSync(firstPath, 'utf8');
    writeFileSync(firstPath, expectedRecordBytes(foreignRecord), 'utf8');
    await assert.rejects(
      invokeExecutorInvocationAdapter({
        dispatchId: first.attempt.dispatchId,
        store,
        adapter,
      }),
      (error) => error?.code === CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
    );
    assert.equal(adapterCalls, 0);
    assert.equal(readFileSync(firstPath, 'utf8'), expectedRecordBytes(foreignRecord));
    writeFileSync(firstPath, firstBytes, 'utf8');

    // (3) Caller-supplied store returns a corrupt record without throwing: the
    // Task 29 re-validation fails closed with the Task 27 code.
    const corruptStore = { readExecutorInvocationAttempt: () => ({ hello: 'nope' }) };
    await assert.rejects(
      invokeExecutorInvocationAdapter({
        dispatchId: first.attempt.dispatchId,
        store: corruptStore,
        adapter,
      }),
      (error) => error?.code === CORRUPT_EXECUTOR_INVOCATION_INPUT,
    );
    assert.equal(adapterCalls, 0);

    // The restored exact record still invokes the adapter exactly once.
    const { calls, adapter: goodAdapter } = countingAdapter('ok');
    await invokeExecutorInvocationAdapter({
      dispatchId: first.attempt.dispatchId,
      store,
      adapter: goodAdapter,
    });
    assert.equal(calls.length, 1);
    assert.equal(readFileSync(firstPath, 'utf8'), firstBytes);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// H. AT-MOST-ONCE PER API CALL (global exactly-once NOT claimed).
// ---------------------------------------------------------------------------

test('H. one API call invokes the adapter exactly once; repeated API calls can invoke again (no exactly-once claim)', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-contract29-h-',
    'EIC29-H-SRC',
    'EIC29-H-CHILD',
  );
  try {
    const { calls, adapter } = countingAdapter('ok');
    const received = [];
    const recordingAdapter = (...args) => {
      received.push(args[0]);
      return adapter(...args);
    };

    for (let index = 0; index < 3; index += 1) {
      const result = await invokeExecutorInvocationAdapter({
        dispatchId: attempt.dispatchId,
        store,
        adapter: recordingAdapter,
      });
      assert.equal(result, 'ok');
      assert.equal(calls.length, index + 1);
    }

    // Per API call: exactly one adapter invocation. Across three external API
    // calls: three invocations, each with the identical canonical record.
    // This API never claims global exactly-once invocation.
    assert.equal(calls.length, 3);
    assert.equal(received.length, 3);
    const canonical = JSON.stringify(store.readExecutorInvocationAttempt(attempt.dispatchId));
    for (const record of received) {
      assert.equal(JSON.stringify(record), canonical);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// I. ADAPTER THROW/REJECT: exact propagation, zero retry, zero 2nd call.
// ---------------------------------------------------------------------------

test('I. adapter throw/reject propagates unchanged with zero retry, zero second call, and zero mutation', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-contract29-i-',
    'EIC29-I-SRC',
    'EIC29-I-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);

    // Synchronous throw: the exact sentinel error object reaches the caller.
    const syncSentinel = new Error('adapter exploded (sync)');
    let syncCalls = 0;
    const syncAdapter = () => {
      syncCalls += 1;
      throw syncSentinel;
    };
    await assert.rejects(
      invokeExecutorInvocationAdapter({
        dispatchId: attempt.dispatchId,
        store,
        adapter: syncAdapter,
      }),
      (error) => error === syncSentinel,
    );
    assert.equal(syncCalls, 1);

    // Asynchronous rejection: the exact sentinel error object reaches the
    // caller.
    const asyncSentinel = new Error('adapter rejected (async)');
    let asyncCalls = 0;
    const asyncAdapter = async () => {
      asyncCalls += 1;
      throw asyncSentinel;
    };
    await assert.rejects(
      invokeExecutorInvocationAdapter({
        dispatchId: attempt.dispatchId,
        store,
        adapter: asyncAdapter,
      }),
      (error) => error === asyncSentinel,
    );
    assert.equal(asyncCalls, 1);

    // Non-Error rejection values propagate unchanged too.
    let valueCalls = 0;
    const valueAdapter = () => {
      valueCalls += 1;
      throw 'adapter-string-failure';
    };
    await assert.rejects(
      invokeExecutorInvocationAdapter({
        dispatchId: attempt.dispatchId,
        store,
        adapter: valueAdapter,
      }),
      (error) => error === 'adapter-string-failure',
    );
    assert.equal(valueCalls, 1);

    // No retry, no second adapter call, no durable side effect, and the
    // contract still works afterwards (failures leave no retry marker).
    assert.deepEqual(snapshotHomeBytes(home), before);
    const { calls, adapter } = countingAdapter('recovered');
    const result = await invokeExecutorInvocationAdapter({
      dispatchId: attempt.dispatchId,
      store,
      adapter,
    });
    assert.equal(result, 'recovered');
    assert.equal(calls.length, 1);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// J. ADAPTER RETURN VALUE: passthrough without normalization/wrapper.
// ---------------------------------------------------------------------------

test('J. adapter return values are propagated to the caller without normalization or wrapper', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-contract29-j-',
    'EIC29-J-SRC',
    'EIC29-J-CHILD',
  );
  try {
    const sentinel = Object.freeze({ nested: { value: 7 } });
    for (const value of [sentinel, undefined, null, 42, 'ok', false]) {
      const { calls, adapter } = countingAdapter(value);
      const result = await invokeExecutorInvocationAdapter({
        dispatchId: attempt.dispatchId,
        store,
        adapter,
      });
      assert.equal(result, value);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].args.length, 1);
    }

    // Async adapters resolve with the exact value.
    const asyncSentinel = Object.freeze(['async-sentinel']);
    const asyncAdapter = async () => asyncSentinel;
    const asyncResult = await invokeExecutorInvocationAdapter({
      dispatchId: attempt.dispatchId,
      store,
      adapter: asyncAdapter,
    });
    assert.equal(asyncResult, asyncSentinel);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// K. NO MUTATION: every durable byte + task/claim state unchanged.
// ---------------------------------------------------------------------------

test('K. invocation leaves every predecessor durable byte identical, adds no store surface, and creates no forbidden artifact', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-contract29-k-',
    'EIC29-K-SRC',
    'EIC29-K-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const beforeStats = snapshotHomeStats(home);
    const taskBefore = store.readTask('EIC29-K-CHILD');
    const claimBefore = store.readClaim('EIC29-K-CHILD');
    const attemptBytes = readFileSync(attemptPath(home, attempt.dispatchId), 'utf8');

    // Successful invocation: zero added paths, every byte identical.
    const { adapter } = countingAdapter('ok');
    await invokeExecutorInvocationAdapter({ dispatchId: attempt.dispatchId, store, adapter });
    const afterSuccess = snapshotHomeBytes(home);
    assert.deepEqual(Object.keys(afterSuccess).sort(), Object.keys(before).sort());
    for (const [name, value] of Object.entries(before)) {
      assert.equal(afterSuccess[name], value, name);
    }
    assert.deepEqual(snapshotHomeStats(home), beforeStats);

    // Failed invocation: still zero mutation.
    const failingAdapter = () => {
      throw new Error('no durable effect');
    };
    await assert.rejects(
      invokeExecutorInvocationAdapter({
        dispatchId: attempt.dispatchId,
        store,
        adapter: failingAdapter,
      }),
      (error) => error?.message === 'no durable effect',
    );
    assert.deepEqual(snapshotHomeBytes(home), afterSuccess);
    assert.deepEqual(snapshotHomeStats(home), beforeStats);

    // Target domains are present and byte-stable. The retired receiver-decision
    // and executor-acceptance durable files no longer exist: their invariant is
    // expressed directly as the invocation-attempt bytes being EXACTLY the Task
    // 27 canonical record built from the durable receiver-acceptance bytes.
    assert.equal(readFileSync(attemptPath(home, attempt.dispatchId), 'utf8'), attemptBytes);
    const acceptanceBytes = readFileSync(
      receiverDispatchAcceptanceFilePath(home, attempt.dispatchId),
      'utf8',
    );
    assert.deepEqual(JSON.parse(attemptBytes).decisionInput, JSON.parse(acceptanceBytes));
    assert.equal(
      attemptBytes,
      expectedRecordBytes(buildExecutorInvocationInputRecord(JSON.parse(acceptanceBytes))),
    );

    // Task/claim state unchanged: no CLAIMED -> RUNNING, no lease/generation
    // movement.
    const taskAfter = store.readTask('EIC29-K-CHILD');
    const claimAfter = store.readClaim('EIC29-K-CHILD');
    assert.equal(taskAfter.status, taskBefore.status);
    assert.equal(taskAfter.status, TASK_STATUS_CLAIMED);
    assert.equal(claimAfter.generation, claimBefore.generation);
    assert.equal(claimAfter.claimToken, claimBefore.claimToken);

    // No ACK/receipt/invocation/scheduler/retry/execution artifact exists.
    for (const forbiddenDir of FORBIDDEN_NEW_ARTIFACT_DIRS) {
      assert.equal(existsSync(join(home, forbiddenDir)), false, forbiddenDir);
    }

    // No Task 29 store primitive was added anywhere.
    for (const forbidden of [
      'invokeExecutorInvocationAdapter',
      'invokeExecutor',
      'executeTask',
      'executeDispatch',
      'acknowledgeExecutor',
      'acknowledgeDispatch',
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
// L. PRODUCTION MODULE STATIC BOUNDARY.
// ---------------------------------------------------------------------------

test('L. production module carries no concrete executor/transport/process/fs/retry authority', () => {
  const raw = readFileSync(MODULE_PATH, 'utf8');
  const code = codeOnly(raw);
  for (const forbidden of [
    "from 'node:fs'",
    "from 'node:child_process'",
    "from 'node:net'",
    "from 'node:http'",
    "from 'node:https'",
    "from 'node:worker_threads'",
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
  for (const status of [
    "'DISPATCHED'",
    '"DISPATCHED"',
    "'EXECUTOR_ACCEPTED'",
    '"EXECUTOR_ACCEPTED"',
    "'RUNNING'",
    '"RUNNING"',
    "'EXECUTING'",
    '"EXECUTING"',
    "'INVOKED'",
    '"INVOKED"',
    "'ACKED'",
    '"ACKED"',
    'TASK_STATUS_RUNNING',
    'TASK_STATUS_ACCEPTED',
  ]) {
    assert.equal(code.includes(status), false, `${status} must not exist in code`);
  }

  // The contract composes the Task 28 identity/read primitive and the Task 27
  // public validator verbatim; it never reads the durable receiver acceptance,
  // never persists anything, and never reconstructs Task 27 input.
  assert.ok(code.includes('store.readExecutorInvocationAttempt('));
  assert.ok(code.includes('validateExecutorInvocationInputRecord('));
  assert.ok(code.includes('assertValidExecutorInvocationAttemptDispatchId('));
  assert.equal(code.includes('store.readExecutorDispatchAcceptance('), false);
  assert.equal(code.includes('store.createExecutorInvocationAttempt('), false);
  assert.equal(code.includes('persistExecutorInvocationAttempt('), false);
  assert.equal(code.includes('readExecutorInvocationInput('), false);

  // Exported surface: constants + error class + single invocation entry only.
  const exportedFunctions = Object.entries(invocationContractModule)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(exportedFunctions, [
    'ExecutorInvocationContractError',
    'invokeExecutorInvocationAdapter',
  ]);
  assert.equal(typeof ExecutorInvocationContractError, 'function');
  assert.equal(typeof invocationContractModule.invokeExecutorInvocationAdapter, 'function');
  assert.equal(EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND, 'EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND');
  assert.equal(
    INVALID_EXECUTOR_INVOCATION_CONTRACT_STORE,
    'INVALID_EXECUTOR_INVOCATION_CONTRACT_STORE',
  );
  assert.equal(INVALID_EXECUTOR_INVOCATION_ADAPTER, 'INVALID_EXECUTOR_INVOCATION_ADAPTER');

  // The Task 28 predecessor export surface stays untouched.
  assert.equal(typeof invocationAttemptModule.persistExecutorInvocationAttempt, 'function');
  assert.equal(
    typeof invocationAttemptModule.assertValidExecutorInvocationAttemptDispatchId,
    'function',
  );
});

// ---------------------------------------------------------------------------
// M. NO ACK/RECEIPT/EXECUTION STATUS TOKEN ADDED TO DURABLE STATE.
// ---------------------------------------------------------------------------

test('M. invocation adds no ACK/receipt/execution status token to any durable state', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-contract29-m-',
    'EIC29-M-SRC',
    'EIC29-M-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const received = [];
    const adapter = (record) => {
      received.push(record);
      return 'ok';
    };
    await invokeExecutorInvocationAdapter({ dispatchId: attempt.dispatchId, store, adapter });
    assert.equal(received.length, 1);

    // No durable write happened at all: identical paths, identical bytes.
    const after = snapshotHomeBytes(home);
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
    for (const [name, value] of Object.entries(before)) {
      assert.equal(after[name], value, name);
    }
    assert.deepEqual(listAttemptFiles(home), [`${attempt.dispatchId}.json`]);

    // The adapter-received canonical record carries no ACK/receipt/execution
    // status token.
    const recordJson = JSON.stringify(received[0]);
    for (const token of [
      'acknowledgedAt',
      'acknowledgedBy',
      'ackDispatch',
      'receipt',
      'executionStarted',
      'executionAllowed',
      'executorInvoked',
      'executorStarted',
      'invokedAt',
      'startedAt',
      'completedAt',
      'attemptedAt',
      'receivedAt',
      'retryCount',
      'attemptNumber',
    ]) {
      assert.equal(recordJson.includes(token), false, token);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// N. claimGeneration STAYS THE SOLE GENERATION FIELD.
// ---------------------------------------------------------------------------

test('N. claimGeneration stays the sole generation/fencing field in the invoked record', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-contract29-n-',
    'EIC29-N-SRC',
    'EIC29-N-CHILD',
  );
  try {
    const received = [];
    const adapter = (record) => {
      received.push(record);
      return 'ok';
    };
    await invokeExecutorInvocationAdapter({ dispatchId: attempt.dispatchId, store, adapter });
    const record = received[0];

    const generationKeys = [
      ...new Set(collectKeys(record).filter((key) => /generation/i.test(key))),
    ];
    assert.deepEqual(generationKeys, ['claimGeneration']);
    assert.equal(record.decisionInput.claimGeneration, 1);

    // Functional code creates no new generation authority.
    const code = codeOnly(readFileSync(MODULE_PATH, 'utf8'));
    assert.equal(code.includes('Generation'), false);
    assert.equal(code.includes('claimGeneration'), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// O. PREDECESSOR IMMUTABILITY: Task 18~28 source/spec bytes unchanged.
// ---------------------------------------------------------------------------

test('O. Task 18~28 predecessor source/spec bytes are unchanged', () => {
  for (const [name, expected] of Object.entries(PREDECESSOR_SHA256)) {
    const actual = createHash('sha256')
      .update(readFileSync(join(MODULE_DIRECTORY, name)))
      .digest('hex');
    assert.equal(actual, expected, `${name} must stay byte-identical`);
  }
});
