// Proof for GREENHUB-COORDINATION-RECEIVER-EXECUTOR-ACCEPTANCE-INPUT-25.
//
// READABLE_EXECUTOR_ACCEPTANCE_INPUT != executor acceptance != ACK != receipt
// != executor invocation != execution start != task status transition
// != scheduler decision != worker selection != retry/resend authority
// != delivery success.
// read != accept != ACK != execute.
//
// The read entry is EXACTLY:
//   (dispatchId, store)
//     -> dispatchId identity validation (Task 24 receiver-decision family)
//     -> require store.readReceiverDispatchDecision ONLY
//     -> store.readReceiverDispatchDecision(dispatchId)  [dispatchId ONLY,
//        at most once per call, no polling / re-read loop / fallback / scan]
//     -> null/undefined: RECEIVER_DISPATCH_DECISION_NOT_FOUND (read failure
//        only; no write, no auto-create, no Task 24 persist, no task mutation)
//     -> validateReceiverDecisionRecord(stored)           [Task 24 verbatim]
//     -> validated.dispatchId === dispatchId              [direct binding check]
//     -> frozen EXACT validated Task 24 durable decision record,
//        no wrapper metadata.
//
// The durable authority remains <home>/receiver-decisions/<dispatchId>.json.
// Task 25 creates no new durable artifact.
//
// All runtime state lives in isolated temp directories. No network required.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acceptReceiverDispatch } from './dispatch-receiver-acceptance.mjs';
import {
  CORRUPT_RECEIVER_DISPATCH_DECISION,
  persistReceiverDecision,
  RECEIVER_DECISION_RECORD_FIELDS,
  RECEIVER_DECISION_SCHEMA_VERSION,
  RECEIVER_DECISION_VALUE,
  RECEIVER_DECISIONS_DIRNAME,
  receiverDispatchDecisionFilePath,
  validateReceiverDecisionRecord,
} from './dispatch-receiver-decision.mjs';
import * as executorInputModule from './dispatch-receiver-executor-acceptance-input.mjs';
import {
  INVALID_RECEIVER_EXECUTOR_ACCEPTANCE_INPUT_STORE,
  RECEIVER_DISPATCH_DECISION_NOT_FOUND,
  ReceiverExecutorAcceptanceInputError,
  readReceiverExecutorAcceptanceInput,
} from './dispatch-receiver-executor-acceptance-input.mjs';
import {
  CORRUPT_TRANSPORT_REQUEST,
  prepareDispatchTransportRequest,
  TRANSPORT_REQUEST_FIELDS,
  validateTransportRequest,
} from './dispatch-transport-contract.mjs';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import { CoordinationStore } from './store.mjs';
import { TASK_STATUS_CLAIMED } from './task-envelope.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = join(MODULE_DIRECTORY, 'dispatch-receiver-executor-acceptance-input.mjs');
const MODULE_URL = pathToFileURL(MODULE_PATH).href;
const STORE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'store.mjs')).href;

// Task 18~24 predecessor source/spec bytes are pinned to the exact live-main
// baseline this read primitive was built against. A change to any pinned file
// is a predecessor-contract change and must come from an explicitly
// predecessor-owning Task, never from this read surface. store.mjs is not
// pinned (additive primitives-only growth precedent from Task 24); Task 25
// does not modify it at all.
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
  'dispatch-receiver-decision.mjs':
    'cd75cd57a632338de9c3babc4822ce5da1ed059f1bce14c2f5453be7cb52aa63',
  'dispatch-receiver-decision.spec.mjs':
    '0a62ddbe2da88d84585ad8db0807468145898ecb467df9431a8e3c7254be65bf',
});

const FORBIDDEN_NEW_ARTIFACT_DIRS = Object.freeze([
  'executor-acceptance-input',
  'executor-acceptances',
  'executor-input',
  'receiver-consumption',
  'decision-consumed',
  'receipt',
  'receipts',
  'ack',
  'acks',
]);

function makeHome(prefix = 'greenhub-executor-input25-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'READABLE_EXECUTOR_ACCEPTANCE_INPUT_PROVED',
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
    proofRequirement: ['readable-executor-acceptance-input-proof'],
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

function prepareRequest(store, sourceTaskId, dispatchId) {
  return prepareDispatchTransportRequest({ store, sourceTaskId, dispatchId });
}

// End-to-end Task 24 durable decision setup: source -> child claim -> durable
// dispatch attempt -> Task 20 request -> Task 22 durable acceptance ->
// Task 24 durable receiver decision.
async function setupDecided(prefix, sourceTaskId, childTaskId) {
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
  const request = prepareRequest(store, sourceTaskId, attempt.dispatchId);
  const accepted = await acceptReceiverDispatch({ request, store });
  assert.equal(accepted.newlyAccepted, true);
  const decided = await persistReceiverDecision({ dispatchId: attempt.dispatchId, store });
  assert.equal(decided.newlyDecided, true);
  return { home, clock, store, attempt, request };
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

function decisionPath(home, dispatchId) {
  return receiverDispatchDecisionFilePath(home, dispatchId);
}

function listDecisionFiles(home) {
  try {
    return [...readdirSync(join(home, RECEIVER_DECISIONS_DIRNAME))].sort();
  } catch {
    return [];
  }
}

function countingStore(reader) {
  const calls = [];
  return {
    calls,
    store: {
      readReceiverDispatchDecision: (dispatchId, ...rest) => {
        calls.push({ dispatchId, rest });
        return reader(dispatchId);
      },
    },
  };
}

// Strongest "no alternate primitive consulted" probe: every property access on
// the store is recorded, and every function-valued property invocation is
// recorded with its arity.
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

function runFreshExecutorInputWorker({ home, dispatchId, skewMs = 0 }) {
  return new Promise((resolveResult, rejectResult) => {
    const code = [
      'try {',
      `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
      `  const { readReceiverExecutorAcceptanceInput } = await import(${JSON.stringify(MODULE_URL)});`,
      `  const skewedNow = Date.now() + ${skewMs};`,
      `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)}, nowProvider: () => skewedNow });`,
      `  const result = await readReceiverExecutorAcceptanceInput({ dispatchId: ${JSON.stringify(dispatchId)}, store });`,
      '  console.log(JSON.stringify({ ok: true, result }));',
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
        rejectResult(new Error(`executor input worker exit=${exitCode} stderr=${stderr}`));
        return;
      }
      try {
        resolveResult(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch (_error) {
        rejectResult(new Error(`executor input worker output parse failed: ${stdout} / ${stderr}`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// A. HAPPY PATH: one durable Task 24 decision -> exact frozen readable input.
// ---------------------------------------------------------------------------

test('A. durable receiver decision reads as the exact frozen Task 24 record with dispatchId-only at-most-once lookup', async () => {
  const { home, store, attempt, request } = await setupDecided(
    'greenhub-executor-input25-a-',
    'EA25-A-SRC',
    'EA25-A-CHILD',
  );
  try {
    const durable = store.readReceiverDispatchDecision(attempt.dispatchId);
    const before = snapshotHomeBytes(home);
    const { calls, store: spyStore } = countingStore((dispatchId) =>
      store.readReceiverDispatchDecision(dispatchId),
    );

    const result = await readReceiverExecutorAcceptanceInput({
      dispatchId: attempt.dispatchId,
      store: spyStore,
    });

    // The returned value is the EXACT validated Task 24 record: no wrapper
    // metadata, fixed key order, frozen.
    assert.deepEqual(result, durable);
    assert.deepEqual(result, validateReceiverDecisionRecord(durable));
    assert.equal(JSON.stringify(result), JSON.stringify(durable));
    assert.deepEqual(Object.keys(result), [...RECEIVER_DECISION_RECORD_FIELDS]);
    assert.equal(result.schemaVersion, RECEIVER_DECISION_SCHEMA_VERSION);
    assert.equal(result.dispatchId, attempt.dispatchId);
    assert.equal(result.decision, RECEIVER_DECISION_VALUE);
    assert.ok(Object.isFrozen(result));
    assert.deepEqual(validateTransportRequest(result.decisionInput), request);

    // dispatchId ONLY, exactly one argument, at most once.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].dispatchId, attempt.dispatchId);
    assert.deepEqual(calls[0].rest, []);

    // No mutation anywhere: every durable byte is identical, no new file.
    const after = snapshotHomeBytes(home);
    assert.deepEqual(after, before);
    assert.deepEqual(listDecisionFiles(home), [`${attempt.dispatchId}.json`]);
    assert.equal(store.readTask('EA25-A-CHILD').status, TASK_STATUS_CLAIMED);
    for (const forbiddenDir of FORBIDDEN_NEW_ARTIFACT_DIRS) {
      assert.equal(existsSync(join(home, forbiddenDir)), false, forbiddenDir);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// B. LOOKUP CONTRACT: dispatchId is the sole key; no alternate primitive.
// ---------------------------------------------------------------------------

test('B. lookup uses dispatchId only, exactly once, and consults no alternate store primitive', async () => {
  const { home, store, attempt } = await setupDecided(
    'greenhub-executor-input25-b-',
    'EA25-B-SRC',
    'EA25-B-CHILD',
  );
  try {
    const { reads, calls, store: proxyStore } = proxyCountingStore(store);
    const result = await readReceiverExecutorAcceptanceInput({
      dispatchId: attempt.dispatchId,
      store: proxyStore,
    });
    assert.equal(result.dispatchId, attempt.dispatchId);

    // Exactly one function invocation, with dispatchId as the only argument.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].op, 'readReceiverDispatchDecision');
    assert.deepEqual(calls[0].args, [attempt.dispatchId]);

    // No alternate store capability was even consulted (no task/claim/
    // admission/emission/attempt/acceptance/result/ACK/scheduler read).
    const consulted = [...new Set(reads)];
    assert.deepEqual(consulted, ['readReceiverDispatchDecision']);

    // Invalid identities fail closed BEFORE any store property access or
    // reader invocation (Task 24 identity family code propagates).
    const {
      reads: invalidReads,
      calls: invalidCalls,
      store: invalidSpy,
    } = proxyCountingStore({
      readReceiverDispatchDecision: () => {
        throw new Error('reader must never be called for an invalid dispatchId');
      },
    });
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
        readReceiverExecutorAcceptanceInput({ dispatchId: invalidId, store: invalidSpy }),
        (error) => error?.code === CORRUPT_RECEIVER_DISPATCH_DECISION,
      );
    }
    await assert.rejects(readReceiverExecutorAcceptanceInput(), (error) => error != null);
    assert.equal(invalidCalls.length, 0);
    assert.equal(invalidReads.length, 0);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// C. MISSING DECISION: explicit read failure with zero write / auto-create.
// ---------------------------------------------------------------------------

test('C. missing durable decision is RECEIVER_DISPATCH_DECISION_NOT_FOUND with zero write and no auto-create', async () => {
  const { home, store, attempt, request } = await setupDecided(
    'greenhub-executor-input25-c-',
    'EA25-C-SRC',
    'EA25-C-CHILD',
  );
  try {
    assert.equal(existsSync(decisionPath(home, attempt.dispatchId)), true);

    // A dispatchId with a durable acceptance but no durable decision yet.
    const clock = controllableClock();
    const pending = driveToAttempt(
      store,
      clock,
      'EA25-C2-SRC',
      'EA25-C2-CHILD',
      'result-ea25-c2-src',
    );
    const pendingRequest = prepareRequest(store, 'EA25-C2-SRC', pending.attempt.dispatchId);
    await acceptReceiverDispatch({ request: pendingRequest, store });
    assert.equal(store.readReceiverDispatchDecision(pending.attempt.dispatchId), null);

    const before = snapshotHomeBytes(home);
    const { calls, store: spyStore } = countingStore((dispatchId) =>
      store.readReceiverDispatchDecision(dispatchId),
    );

    await assert.rejects(
      readReceiverExecutorAcceptanceInput({
        dispatchId: pending.attempt.dispatchId,
        store: spyStore,
      }),
      (error) =>
        error instanceof ReceiverExecutorAcceptanceInputError &&
        error.code === RECEIVER_DISPATCH_DECISION_NOT_FOUND,
    );

    // The read happened exactly once with dispatchId only and caused zero
    // write, zero auto-create, zero decision mutation, zero task mutation.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].dispatchId, pending.attempt.dispatchId);
    assert.deepEqual(calls[0].rest, []);
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.equal(existsSync(decisionPath(home, pending.attempt.dispatchId)), false);
    assert.equal(store.readReceiverDispatchDecision(pending.attempt.dispatchId), null);
    assert.equal(store.readTask('EA25-C2-CHILD').status, TASK_STATUS_CLAIMED);
    assert.deepEqual(
      store.readReceiverDispatchAcceptance(pending.attempt.dispatchId),
      pendingRequest,
    );
    assert.equal(
      store.readReceiverDispatchDecision(attempt.dispatchId).decision,
      RECEIVER_DECISION_VALUE,
    );

    // null and undefined from a caller-supplied reader are the same single
    // read failure meaning.
    for (const missing of [null, undefined]) {
      const spy = countingStore(() => missing);
      await assert.rejects(
        readReceiverExecutorAcceptanceInput({
          dispatchId: attempt.dispatchId,
          store: spy.store,
        }),
        (error) => error.code === RECEIVER_DISPATCH_DECISION_NOT_FOUND,
      );
      assert.equal(spy.calls.length, 1);
    }
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.equal(JSON.stringify(validateTransportRequest(request)), JSON.stringify(request));
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// D. INVALID STORE: fails before the decision read, with zero mutation.
// ---------------------------------------------------------------------------

test('D. store without readReceiverDispatchDecision fails before any read and mutates nothing', async () => {
  const { home, attempt } = await setupDecided(
    'greenhub-executor-input25-d-',
    'EA25-D-SRC',
    'EA25-D-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    let probeCalls = 0;
    const invalidStores = [
      undefined,
      null,
      'store',
      42,
      {},
      { readReceiverDispatchDecision: 7 },
      { readReceiverDecision: () => null },
      {
        readReceiverDispatchAcceptance: () => {
          probeCalls += 1;
          return null;
        },
      },
      {
        readReceiverDispatchAcceptance: () => {
          probeCalls += 1;
          return null;
        },
        readReceiverDispatchDecision: 'not-a-function',
        createReceiverDispatchDecision: () => ({ created: true }),
      },
    ];
    for (const invalidStore of invalidStores) {
      await assert.rejects(
        readReceiverExecutorAcceptanceInput({
          dispatchId: attempt.dispatchId,
          store: invalidStore,
        }),
        (error) =>
          error instanceof ReceiverExecutorAcceptanceInputError &&
          error.code === INVALID_RECEIVER_EXECUTOR_ACCEPTANCE_INPUT_STORE,
      );
    }
    assert.equal(probeCalls, 0);

    // Identity validation precedes the store gate: an invalid dispatchId with
    // an invalid store still yields the Task 24 identity-family code.
    await assert.rejects(
      readReceiverExecutorAcceptanceInput({ dispatchId: 'not-a-dispatch-id', store: undefined }),
      (error) => error?.code === CORRUPT_RECEIVER_DISPATCH_DECISION,
    );

    // No read, no write, no auto-create, no decision mutation.
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.deepEqual(listDecisionFiles(home), [`${attempt.dispatchId}.json`]);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. CORRUPT DECISION: Task 24 semantics propagate fail-closed, no repair.
// ---------------------------------------------------------------------------

test('E. corrupt durable decision fails closed with exact bytes preserved and no repair', async () => {
  const { home, store, attempt } = await setupDecided(
    'greenhub-executor-input25-e-',
    'EA25-E-SRC',
    'EA25-E-CHILD',
  );
  try {
    const path = decisionPath(home, attempt.dispatchId);
    const goodBytes = readFileSync(path, 'utf8');
    const goodRecord = store.readReceiverDispatchDecision(attempt.dispatchId);
    const request = JSON.parse(JSON.stringify(goodRecord.decisionInput));

    const variants = [
      { name: 'unparseable bytes', bytes: '{ not json', code: CORRUPT_RECEIVER_DISPATCH_DECISION },
      {
        name: 'valid JSON wrong shape',
        bytes: JSON.stringify({ hello: 'not-a-decision' }, null, 2),
        code: CORRUPT_RECEIVER_DISPATCH_DECISION,
      },
      {
        name: 'unsupported schemaVersion',
        bytes: JSON.stringify({ ...goodRecord, schemaVersion: '2' }, null, 2),
        code: CORRUPT_RECEIVER_DISPATCH_DECISION,
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
        code: CORRUPT_RECEIVER_DISPATCH_DECISION,
      },
      {
        name: 'blocked timestamp field',
        bytes: JSON.stringify({ ...goodRecord, decidedAt: 'now' }, null, 2),
        code: CORRUPT_RECEIVER_DISPATCH_DECISION,
      },
      {
        name: 'decision value drift',
        bytes: JSON.stringify({ ...goodRecord, decision: 'ACK' }, null, 2),
        code: CORRUPT_RECEIVER_DISPATCH_DECISION,
      },
      {
        name: 'extra smuggled field',
        bytes: JSON.stringify({ ...goodRecord, decisionGeneration: 2 }, null, 2),
        code: CORRUPT_RECEIVER_DISPATCH_DECISION,
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
          { ...goodRecord, decisionInput: { ...request, decisionGeneration: 1 } },
          null,
          2,
        ),
        code: CORRUPT_TRANSPORT_REQUEST,
      },
      {
        name: 'inner transport shape corruption',
        bytes: JSON.stringify(
          { ...goodRecord, decisionInput: { hello: 'not-a-transport-request' } },
          null,
          2,
        ),
        code: CORRUPT_TRANSPORT_REQUEST,
      },
    ];

    for (const variant of variants) {
      writeFileSync(path, variant.bytes, 'utf8');
      await assert.rejects(
        readReceiverExecutorAcceptanceInput({ dispatchId: attempt.dispatchId, store }),
        (error) => error?.code === variant.code,
        variant.name,
      );
      // Fail closed with zero repair, overwrite, truncation, delete, rewrite.
      assert.equal(readFileSync(path, 'utf8'), variant.bytes, variant.name);
      assert.deepEqual(listDecisionFiles(home), [`${attempt.dispatchId}.json`], variant.name);
      for (const forbiddenDir of FORBIDDEN_NEW_ARTIFACT_DIRS) {
        assert.equal(
          existsSync(join(home, forbiddenDir)),
          false,
          `${variant.name}: ${forbiddenDir}`,
        );
      }
    }

    // Restoring the exact durable bytes re-enables the read.
    writeFileSync(path, goodBytes, 'utf8');
    const restored = await readReceiverExecutorAcceptanceInput({
      dispatchId: attempt.dispatchId,
      store,
    });
    assert.deepEqual(restored, goodRecord);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. WRONG DISPATCH BINDING: caller-supplied/spy store cannot redirect.
// ---------------------------------------------------------------------------

test('F. a valid decision for another dispatchId fails closed and never becomes the result', async () => {
  const first = await setupDecided('greenhub-executor-input25-f1-', 'EA25-F1-SRC', 'EA25-F1-CHILD');
  const second = await setupDecided(
    'greenhub-executor-input25-f2-',
    'EA25-F2-SRC',
    'EA25-F2-CHILD',
  );
  try {
    const foreign = second.store.readReceiverDispatchDecision(second.attempt.dispatchId);
    assert.ok(foreign);
    assert.notEqual(foreign.dispatchId, first.attempt.dispatchId);

    // Spy store returns a structurally valid decision bound to a different
    // dispatchId: direct binding re-check fails closed.
    const redirectStore = { readReceiverDispatchDecision: () => foreign };
    await assert.rejects(
      readReceiverExecutorAcceptanceInput({
        dispatchId: first.attempt.dispatchId,
        store: redirectStore,
      }),
      (error) =>
        error instanceof ReceiverExecutorAcceptanceInputError &&
        error.code === CORRUPT_RECEIVER_DISPATCH_DECISION,
    );

    // Fabricated record whose own dispatchId claims the requested identity but
    // whose decisionInput is bound elsewhere: Task 24 validator rejects it.
    const fabricated = {
      schemaVersion: foreign.schemaVersion,
      dispatchId: first.attempt.dispatchId,
      decision: foreign.decision,
      decisionInput: foreign.decisionInput,
    };
    await assert.rejects(
      readReceiverExecutorAcceptanceInput({
        dispatchId: first.attempt.dispatchId,
        store: { readReceiverDispatchDecision: () => fabricated },
      }),
      (error) => error?.code === CORRUPT_RECEIVER_DISPATCH_DECISION,
    );
    assert.throws(
      () => validateReceiverDecisionRecord(fabricated),
      (error) => error?.code === CORRUPT_RECEIVER_DISPATCH_DECISION,
    );

    // The durable winner for the requested dispatchId is untouched.
    const winner = first.store.readReceiverDispatchDecision(first.attempt.dispatchId);
    assert.equal(winner.dispatchId, first.attempt.dispatchId);
    assert.equal(JSON.stringify(winner.decisionInput), JSON.stringify(first.request));
  } finally {
    removeHome(first.home);
    removeHome(second.home);
  }
});

// ---------------------------------------------------------------------------
// G. EXACT DECISION BINDING.
// ---------------------------------------------------------------------------

test('G. returned decision value is exactly RECEIVER_DECISION_BOUNDARY_PASSED and decisionInput deep-equals Task 24', async () => {
  const { home, store, attempt, request } = await setupDecided(
    'greenhub-executor-input25-g-',
    'EA25-G-SRC',
    'EA25-G-CHILD',
  );
  try {
    const result = await readReceiverExecutorAcceptanceInput({
      dispatchId: attempt.dispatchId,
      store,
    });
    const durable = store.readReceiverDispatchDecision(attempt.dispatchId);
    assert.equal(result.decision, 'RECEIVER_DECISION_BOUNDARY_PASSED');
    assert.equal(result.decision, RECEIVER_DECISION_VALUE);
    assert.deepEqual(result.decisionInput, durable.decisionInput);
    assert.deepEqual(result.decisionInput, request);
    assert.equal(JSON.stringify(result.decisionInput), JSON.stringify(durable.decisionInput));
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// H. TASK 20 INPUT PRESERVATION: no projection or reconstruction.
// ---------------------------------------------------------------------------

test('H. decisionInput preserves every Task 20 field and claimGeneration exactly', async () => {
  const { home, store, attempt, request } = await setupDecided(
    'greenhub-executor-input25-h-',
    'EA25-H-SRC',
    'EA25-H-CHILD',
  );
  try {
    const result = await readReceiverExecutorAcceptanceInput({
      dispatchId: attempt.dispatchId,
      store,
    });
    const input = result.decisionInput;
    assert.deepEqual(Object.keys(input), [...TRANSPORT_REQUEST_FIELDS]);
    for (const field of TRANSPORT_REQUEST_FIELDS) {
      assert.deepEqual(input[field], request[field], field);
    }
    assert.equal(input.claimGeneration, request.claimGeneration);
    assert.equal(typeof input.claimGeneration, 'number');
    assert.equal(input.dispatchId, attempt.dispatchId);
    assert.equal(input.sourceTaskId, 'EA25-H-SRC');
    assert.equal(input.nextTaskId, 'EA25-H-CHILD');
    assert.equal(input.workerId, 'worker-a');
    assert.equal(input.admissionId, attempt.admissionId);
    assert.equal(input.emissionSlot, attempt.emissionSlot);

    // Exact durable representation: the returned record serializes to the
    // exact durable bytes (no projection, no normalization, no wrapper).
    const bytes = readFileSync(decisionPath(home, attempt.dispatchId), 'utf8');
    assert.equal(JSON.stringify(result, null, 2), bytes);
    assert.equal(JSON.stringify(result), JSON.stringify(JSON.parse(bytes)));
    assert.equal(JSON.stringify(result.decisionInput), JSON.stringify(request));

    // No generation authority beyond the inherited claimGeneration.
    for (const forbiddenField of [
      'executorGeneration',
      'executionGeneration',
      'receiverGeneration',
      'acceptanceGeneration',
      'decisionGeneration',
      'deliveryGeneration',
      'retryGeneration',
      'executionAllowed',
      'executorAccepted',
      'acceptedByExecutor',
      'executionStarted',
    ]) {
      assert.equal(Object.hasOwn(result, forbiddenField), false, forbiddenField);
      assert.equal(Object.hasOwn(input, forbiddenField), false, forbiddenField);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// I. READ-ONLY PROOF: byte-identical snapshot, no new files, no mtime change.
// ---------------------------------------------------------------------------

test('I. coordination-home bytes, files, and mtimes are identical after reads', async () => {
  const { home, store, attempt } = await setupDecided(
    'greenhub-executor-input25-i-',
    'EA25-I-SRC',
    'EA25-I-CHILD',
  );
  try {
    const beforeBytes = snapshotHomeBytes(home);
    const beforeStats = snapshotHomeStats(home);
    for (let replay = 0; replay < 3; replay += 1) {
      const result = await readReceiverExecutorAcceptanceInput({
        dispatchId: attempt.dispatchId,
        store,
      });
      assert.equal(result.dispatchId, attempt.dispatchId);
    }
    assert.deepEqual(snapshotHomeBytes(home), beforeBytes);
    assert.deepEqual(snapshotHomeStats(home), beforeStats);
    assert.equal(existsSync(decisionPath(home, attempt.dispatchId)), true);
    assert.equal(store.readTask('EA25-I-CHILD').status, TASK_STATUS_CLAIMED);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// J. PREDECESSOR IMMUTABILITY: Task 18~24 source/spec bytes unchanged.
// ---------------------------------------------------------------------------

test('J. Task 18~24 predecessor source/spec bytes are unchanged', () => {
  for (const [name, expected] of Object.entries(PREDECESSOR_SHA256)) {
    const actual = createHash('sha256')
      .update(readFileSync(join(MODULE_DIRECTORY, name)))
      .digest('hex');
    assert.equal(actual, expected, `${name} must stay byte-identical`);
  }
});

// ---------------------------------------------------------------------------
// K. FORBIDDEN BOUNDARY + exported surface.
// ---------------------------------------------------------------------------

test('K. production module carries no ACK/executor-invocation/scheduler/retry/new-generation/fs-write/transport authority', () => {
  const raw = readFileSync(MODULE_PATH, 'utf8');
  const code = codeOnly(raw);
  for (const forbidden of [
    "from 'node:fs'",
    "from 'node:child_process'",
    "from 'node:net'",
    "from 'node:http'",
    "from 'node:https'",
    "from './store.mjs'",
    'acknowledge',
    'ackDispatch',
    'ack.json',
    'receipt',
    'executor',
    'spawn(',
    'exec(',
    'fork(',
    'child_process',
    'fetch(',
    'WebSocket(',
    'XMLHttpRequest',
    'http.request(',
    'invoke',
    'scheduler',
    'scheduleNextTask',
    'polling',
    'daemon',
    'cron',
    'retry',
    'backoff',
    'resend',
    'workerRegistry',
    'selectWorker',
    'capabilityMatch',
    'executorGeneration',
    'executionGeneration',
    'receiverGeneration',
    'acceptanceGeneration',
    'decisionGeneration',
    'deliveryGeneration',
    'retryGeneration',
    'executionAllowed',
    'executorAccepted',
    'acceptedByExecutor',
    'executionStarted',
    'writeFileSync',
    'writeFile(',
    'mkdirSync',
    'rmSync',
    'unlink',
    'rename',
    'appendFile',
    'createWriteStream',
    'writeJsonExclusive',
    'persistReceiverDecision',
    'createReceiverDispatchDecision',
    'acceptReceiverDispatch',
  ]) {
    assert.equal(code.includes(forbidden), false, `code must not contain ${forbidden}`);
  }
  for (const status of [
    "'DISPATCHED'",
    '"DISPATCHED"',
    "'EXECUTOR_ACCEPTED'",
    '"EXECUTOR_ACCEPTED"',
    "'ACCEPTED'",
    '"ACCEPTED"',
    "'RECEIVED'",
    "'EXECUTING'",
  ]) {
    assert.equal(code.includes(status), false, `${status} must not exist in code`);
  }

  // The read boundary composes the Task 24 public primitives verbatim.
  assert.ok(code.includes('store.readReceiverDispatchDecision('));
  assert.ok(code.includes('validateReceiverDecisionRecord('));
  assert.ok(code.includes('assertValidReceiverDecisionDispatchId('));

  // Exported surface: the single read entry + error class only.
  const exportedFunctions = Object.entries(executorInputModule)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(exportedFunctions, [
    'ReceiverExecutorAcceptanceInputError',
    'readReceiverExecutorAcceptanceInput',
  ]);
  assert.equal(typeof ReceiverExecutorAcceptanceInputError, 'function');
  assert.equal(typeof executorInputModule.readReceiverExecutorAcceptanceInput, 'function');
});

test('K2. store surface gains no Task 25 mutation/invocation primitive', async () => {
  const home = makeHome('greenhub-executor-input25-k2-');
  try {
    const store = new CoordinationStore({ dir: home });
    assert.equal(store.readReceiverExecutorAcceptanceInput, undefined);
    assert.equal(store.createReceiverExecutorAcceptanceInput, undefined);
    assert.equal(store.persistExecutorAcceptance, undefined);
    assert.equal(store.acceptExecutor, undefined);
    assert.equal(store.acknowledgeExecutor, undefined);
    assert.equal(store.selectExecutor, undefined);
    assert.equal(store.invokeExecutor, undefined);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// L. FRESH PROCESS / CLOCK SKEW: identical canonical return.
// ---------------------------------------------------------------------------

test('L. fresh process and large clock skew produce the identical canonical return', async () => {
  const { home, store, attempt } = await setupDecided(
    'greenhub-executor-input25-l-',
    'EA25-L-SRC',
    'EA25-L-CHILD',
  );
  try {
    const inProcess = await readReceiverExecutorAcceptanceInput({
      dispatchId: attempt.dispatchId,
      store,
    });
    const canonical = JSON.stringify(inProcess);
    const yearMs = 365 * 24 * 60 * 60 * 1000;
    for (const skewMs of [0, 10 * yearMs, -10 * yearMs]) {
      const out = await runFreshExecutorInputWorker({
        home,
        dispatchId: attempt.dispatchId,
        skewMs,
      });
      assert.equal(out.ok, true, JSON.stringify(out));
      assert.equal(JSON.stringify(out.result), canonical);
      assert.deepEqual(out.result, JSON.parse(canonical));
    }
    assert.equal(inProcess.decision, RECEIVER_DECISION_VALUE);
  } finally {
    removeHome(home);
  }
});
