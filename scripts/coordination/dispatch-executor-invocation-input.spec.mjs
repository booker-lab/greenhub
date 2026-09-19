// Proof for GREENHUB-COORDINATION-EXECUTOR-INVOCATION-INPUT-27.
//
// READABLE_EXECUTOR_INVOCATION_INPUT != executor invocation != executor
// acceptance != ACK != receipt != execution start != task status transition
// != scheduler decision != worker/executor selection != retry/resend authority
// != delivery success.
// read != invoke != accept != ACK != execute.
//
// The read entry is EXACTLY:
//   (dispatchId, store)
//     -> dispatchId identity validation (Task 26 executor-acceptance family)
//     -> require store.readExecutorDispatchAcceptance ONLY
//     -> store.readExecutorDispatchAcceptance(dispatchId)  [dispatchId ONLY,
//        at most once per call, no polling / re-read loop / fallback / scan]
//     -> null/undefined: EXECUTOR_DISPATCH_ACCEPTANCE_NOT_FOUND (read failure
//        only; no write, no auto-create, no Task 24/25 reconstruction, no task
//        mutation)
//     -> validateReceiverDecisionRecord(stored)           [Task 24 verbatim]
//     -> validated.dispatchId === dispatchId              [direct binding check]
//     -> frozen EXACT validated Task 26 durable acceptance record,
//        no wrapper metadata.
//
// The durable authority remains <home>/executor-acceptances/<dispatchId>.json.
// Task 27 creates no new durable artifact and modifies no store primitive.
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
import {
  acceptExecutorDispatchDecision,
  CORRUPT_EXECUTOR_DISPATCH_ACCEPTANCE,
  EXECUTOR_ACCEPTANCES_DIRNAME,
  executorDispatchAcceptanceFilePath,
} from './dispatch-executor-acceptance.mjs';
import * as invocationInputModule from './dispatch-executor-invocation-input.mjs';
import {
  EXECUTOR_DISPATCH_ACCEPTANCE_NOT_FOUND,
  ExecutorInvocationInputError,
  INVALID_EXECUTOR_INVOCATION_INPUT_STORE,
  readExecutorInvocationInput,
} from './dispatch-executor-invocation-input.mjs';
import { acceptReceiverDispatch } from './dispatch-receiver-acceptance.mjs';
import {
  CORRUPT_RECEIVER_DISPATCH_DECISION,
  persistReceiverDecision,
  RECEIVER_DECISION_VALUE,
  receiverDispatchDecisionFilePath,
  validateReceiverDecisionRecord,
} from './dispatch-receiver-decision.mjs';
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
const MODULE_PATH = join(MODULE_DIRECTORY, 'dispatch-executor-invocation-input.mjs');
const MODULE_URL = pathToFileURL(MODULE_PATH).href;
const STORE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'store.mjs')).href;

// Task 18~26 predecessor source/spec bytes are pinned to the exact live-main
// baseline this read primitive was built against. A change to any pinned file
// is a predecessor-contract change and must come from an explicitly
// predecessor-owning Task, never from this read surface. store.mjs is the only
// composed predecessor file allowed to grow (additive primitives only), so it
// is not pinned; Task 27 does not modify it at all.
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
  'dispatch-receiver-executor-acceptance-input.mjs':
    '9a965e3d4af73b2f3b1db54e8c0ed58b97c83d18723c6d873e6e8c0977d58b0a',
  'dispatch-receiver-executor-acceptance-input.spec.mjs':
    '3c8d806102c0053a88c67b2cde4fc9bd671ce7ff8ea9e8e5c1b7a15f1c1ffb60',
  'dispatch-executor-acceptance.mjs':
    'ef74b58438011feff1141568ae76985ae751dad2ebbfe8f3712b1ae5e69adfe0',
  'dispatch-executor-acceptance.spec.mjs':
    '252a2faf7f3bf67c71b7ee4a3abbcd0b11601471fd3a86b39453f4ba8374beb3',
});

const FORBIDDEN_NEW_ARTIFACT_DIRS = Object.freeze([
  'invocation-input',
  'invocation-inputs',
  'executor-invocations',
  'executor-invocation-inputs',
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

function makeHome(prefix = 'greenhub-executor-invocation-input27-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'READABLE_EXECUTOR_INVOCATION_INPUT_PROVED',
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
    proofRequirement: ['readable-executor-invocation-input-proof'],
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

// End-to-end Task 26 durable executor-acceptance setup: source -> child claim
// -> durable dispatch attempt -> Task 20 request -> Task 22 durable acceptance
// -> Task 24 durable receiver decision -> Task 26 durable executor acceptance.
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
  return { home, clock, store, attempt, request };
}

// Task 24 durable receiver decision exists but NO Task 26 executor acceptance.
async function setupDecidedOnly(prefix, sourceTaskId, childTaskId) {
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

function executorAcceptancePath(home, dispatchId) {
  return executorDispatchAcceptanceFilePath(home, dispatchId);
}

function listExecutorAcceptanceFiles(home) {
  try {
    return [...readdirSync(join(home, EXECUTOR_ACCEPTANCES_DIRNAME))].sort();
  } catch {
    return [];
  }
}

function decisionPath(home, dispatchId) {
  return receiverDispatchDecisionFilePath(home, dispatchId);
}

function countingStore(reader) {
  const calls = [];
  return {
    calls,
    store: {
      readExecutorDispatchAcceptance: (dispatchId, ...rest) => {
        calls.push({ dispatchId, rest });
        return reader(dispatchId);
      },
    },
  };
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

function runFreshInvocationInputWorker({ home, dispatchId, skewMs = 0 }) {
  return new Promise((resolveResult, rejectResult) => {
    const code = [
      'try {',
      `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
      `  const { readExecutorInvocationInput } = await import(${JSON.stringify(MODULE_URL)});`,
      `  const skewedNow = Date.now() + ${skewMs};`,
      `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)}, nowProvider: () => skewedNow });`,
      `  const result = await readExecutorInvocationInput({ dispatchId: ${JSON.stringify(dispatchId)}, store });`,
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
        rejectResult(new Error(`invocation input worker exit=${exitCode} stderr=${stderr}`));
        return;
      }
      try {
        resolveResult(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch (_error) {
        rejectResult(
          new Error(`invocation input worker output parse failed: ${stdout} / ${stderr}`),
        );
      }
    });
  });
}

// ---------------------------------------------------------------------------
// A. HAPPY PATH: one durable Task 26 acceptance -> exact frozen readable input.
// ---------------------------------------------------------------------------

test('A. durable executor acceptance reads as the exact frozen Task 26 record with dispatchId-only at-most-once lookup', async () => {
  const { home, store, attempt, request } = await setupAccepted(
    'greenhub-executor-invocation-input27-a-',
    'EII27-A-SRC',
    'EII27-A-CHILD',
  );
  try {
    const durable = store.readExecutorDispatchAcceptance(attempt.dispatchId);
    const before = snapshotHomeBytes(home);
    const { calls, store: spyStore } = countingStore((dispatchId) =>
      store.readExecutorDispatchAcceptance(dispatchId),
    );

    const result = await readExecutorInvocationInput({
      dispatchId: attempt.dispatchId,
      store: spyStore,
    });

    // The returned value is the EXACT validated Task 26 durable acceptance:
    // no wrapper metadata, fixed key order, frozen.
    assert.deepEqual(result, durable);
    assert.deepEqual(result, validateReceiverDecisionRecord(durable));
    assert.equal(JSON.stringify(result), JSON.stringify(durable));
    assert.deepEqual(Object.keys(result), [
      'schemaVersion',
      'dispatchId',
      'decision',
      'decisionInput',
    ]);
    assert.equal(result.dispatchId, attempt.dispatchId);
    assert.equal(result.decision, RECEIVER_DECISION_VALUE);
    assert.ok(Object.isFrozen(result));
    assert.deepEqual(validateTransportRequest(result.decisionInput), request);

    // Exact serialized representation: the returned record serializes to the
    // exact durable bytes of executor-acceptances/<dispatchId>.json.
    assert.equal(
      JSON.stringify(result, null, 2),
      readFileSync(executorAcceptancePath(home, attempt.dispatchId), 'utf8'),
    );

    // dispatchId ONLY, exactly one argument, at most once.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].dispatchId, attempt.dispatchId);
    assert.deepEqual(calls[0].rest, []);

    // No mutation anywhere: every durable byte is identical, no new file.
    const after = snapshotHomeBytes(home);
    assert.deepEqual(after, before);
    assert.deepEqual(listExecutorAcceptanceFiles(home), [`${attempt.dispatchId}.json`]);
    assert.equal(store.readTask('EII27-A-CHILD').status, TASK_STATUS_CLAIMED);
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
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-input27-b-',
    'EII27-B-SRC',
    'EII27-B-CHILD',
  );
  try {
    const { reads, calls, store: proxyStore } = proxyCountingStore(store);
    const result = await readExecutorInvocationInput({
      dispatchId: attempt.dispatchId,
      store: proxyStore,
    });
    assert.equal(result.dispatchId, attempt.dispatchId);

    // Exactly one function invocation, with dispatchId as the only argument.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].op, 'readExecutorDispatchAcceptance');
    assert.deepEqual(calls[0].args, [attempt.dispatchId]);

    // No alternate store capability was even consulted (no task/claim/
    // admission/emission/attempt/receiver-acceptance/receiver-decision/result/
    // ACK/scheduler read).
    const consulted = [...new Set(reads)];
    assert.deepEqual(consulted, ['readExecutorDispatchAcceptance']);

    // Invalid identities fail closed BEFORE any store property access or
    // reader invocation (Task 26 identity family code propagates).
    const {
      reads: invalidReads,
      calls: invalidCalls,
      store: invalidSpy,
    } = proxyCountingStore({
      readExecutorDispatchAcceptance: () => {
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
        readExecutorInvocationInput({ dispatchId: invalidId, store: invalidSpy }),
        (error) => error?.code === CORRUPT_EXECUTOR_DISPATCH_ACCEPTANCE,
      );
    }
    await assert.rejects(readExecutorInvocationInput(), (error) => error != null);
    assert.equal(invalidCalls.length, 0);
    assert.equal(invalidReads.length, 0);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// C. MISSING ACCEPTANCE: explicit read failure with zero write / auto-create.
// ---------------------------------------------------------------------------

test('C. missing durable executor acceptance is EXECUTOR_DISPATCH_ACCEPTANCE_NOT_FOUND with zero write and no auto-create', async () => {
  const { home, store, attempt } = await setupDecidedOnly(
    'greenhub-executor-invocation-input27-c-',
    'EII27-C-SRC',
    'EII27-C-CHILD',
  );
  try {
    // The Task 24 durable receiver decision exists, but the Task 26 durable
    // executor acceptance does not.
    assert.equal(
      store.readReceiverDispatchDecision(attempt.dispatchId).decision,
      RECEIVER_DECISION_VALUE,
    );
    assert.equal(store.readExecutorDispatchAcceptance(attempt.dispatchId), null);
    assert.equal(existsSync(executorAcceptancePath(home, attempt.dispatchId)), false);

    const before = snapshotHomeBytes(home);
    const { calls, store: spyStore } = countingStore((dispatchId) =>
      store.readExecutorDispatchAcceptance(dispatchId),
    );

    await assert.rejects(
      readExecutorInvocationInput({ dispatchId: attempt.dispatchId, store: spyStore }),
      (error) =>
        error instanceof ExecutorInvocationInputError &&
        error.code === EXECUTOR_DISPATCH_ACCEPTANCE_NOT_FOUND,
    );

    // The read happened exactly once with dispatchId only and caused zero
    // write, zero auto-create, zero Task 24/25 reconstruction, zero acceptance
    // creation, zero task mutation.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].dispatchId, attempt.dispatchId);
    assert.deepEqual(calls[0].rest, []);
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.equal(existsSync(executorAcceptancePath(home, attempt.dispatchId)), false);
    assert.equal(store.readExecutorDispatchAcceptance(attempt.dispatchId), null);
    assert.equal(store.readTask('EII27-C-CHILD').status, TASK_STATUS_CLAIMED);
    assert.equal(
      store.readReceiverDispatchDecision(attempt.dispatchId).decision,
      RECEIVER_DECISION_VALUE,
    );

    // A dispatchId with only a durable dispatch attempt (no receiver decision,
    // no executor acceptance) is the same single read failure meaning: Task 27
    // never falls back to Task 24/25 reconstruction.
    const clock = controllableClock();
    const pending = driveToAttempt(
      store,
      clock,
      'EII27-C2-SRC',
      'EII27-C2-CHILD',
      'result-eii27-c2-src',
    );
    const beforeSecond = snapshotHomeBytes(home);
    await assert.rejects(
      readExecutorInvocationInput({ dispatchId: pending.attempt.dispatchId, store }),
      (error) => error.code === EXECUTOR_DISPATCH_ACCEPTANCE_NOT_FOUND,
    );
    assert.equal(existsSync(executorAcceptancePath(home, pending.attempt.dispatchId)), false);

    // null and undefined from a caller-supplied reader are the same single
    // read failure meaning.
    for (const missing of [null, undefined]) {
      const spy = countingStore(() => missing);
      await assert.rejects(
        readExecutorInvocationInput({ dispatchId: attempt.dispatchId, store: spy.store }),
        (error) => error.code === EXECUTOR_DISPATCH_ACCEPTANCE_NOT_FOUND,
      );
      assert.equal(spy.calls.length, 1);
    }
    assert.deepEqual(snapshotHomeBytes(home), beforeSecond);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// D. INVALID STORE: fails before the acceptance read, with zero mutation.
// ---------------------------------------------------------------------------

test('D. store without readExecutorDispatchAcceptance fails before any read and mutates nothing', async () => {
  const { home, attempt } = await setupAccepted(
    'greenhub-executor-invocation-input27-d-',
    'EII27-D-SRC',
    'EII27-D-CHILD',
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
      { readExecutorDispatchAcceptance: 7 },
      { readExecutorAcceptance: () => null },
      {
        readReceiverDispatchDecision: () => {
          probeCalls += 1;
          return null;
        },
      },
      {
        readReceiverDispatchDecision: () => {
          probeCalls += 1;
          return null;
        },
        readExecutorDispatchAcceptance: 'not-a-function',
        createExecutorDispatchAcceptance: () => ({ created: true }),
      },
    ];
    for (const invalidStore of invalidStores) {
      await assert.rejects(
        readExecutorInvocationInput({
          dispatchId: attempt.dispatchId,
          store: invalidStore,
        }),
        (error) =>
          error instanceof ExecutorInvocationInputError &&
          error.code === INVALID_EXECUTOR_INVOCATION_INPUT_STORE,
      );
    }
    assert.equal(probeCalls, 0);

    // Identity validation precedes the store gate: an invalid dispatchId with
    // an invalid store still yields the Task 26 identity-family code.
    await assert.rejects(
      readExecutorInvocationInput({ dispatchId: 'not-a-dispatch-id', store: undefined }),
      (error) => error?.code === CORRUPT_EXECUTOR_DISPATCH_ACCEPTANCE,
    );

    // No read, no write, no auto-create, no acceptance mutation.
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.deepEqual(listExecutorAcceptanceFiles(home), [`${attempt.dispatchId}.json`]);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. CORRUPTION: Task 26/24/20 semantics propagate fail-closed, no repair.
// ---------------------------------------------------------------------------

test('E. corrupt durable acceptance fails closed with exact bytes preserved and no repair', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-input27-e-',
    'EII27-E-SRC',
    'EII27-E-CHILD',
  );
  try {
    const path = executorAcceptancePath(home, attempt.dispatchId);
    const goodBytes = readFileSync(path, 'utf8');
    const goodRecord = store.readExecutorDispatchAcceptance(attempt.dispatchId);
    const request = JSON.parse(JSON.stringify(goodRecord.decisionInput));

    const variants = [
      {
        name: 'unparseable bytes',
        bytes: '{ not json',
        code: CORRUPT_EXECUTOR_DISPATCH_ACCEPTANCE,
      },
      {
        name: 'valid JSON wrong shape',
        bytes: JSON.stringify({ hello: 'not-an-acceptance' }, null, 2),
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
        bytes: JSON.stringify({ ...goodRecord, acceptedAt: 'now' }, null, 2),
        code: CORRUPT_RECEIVER_DISPATCH_DECISION,
      },
      {
        name: 'decision value drift',
        bytes: JSON.stringify({ ...goodRecord, decision: 'ACK' }, null, 2),
        code: CORRUPT_RECEIVER_DISPATCH_DECISION,
      },
      {
        name: 'extra smuggled field',
        bytes: JSON.stringify({ ...goodRecord, invocationGeneration: 2 }, null, 2),
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
          { ...goodRecord, decisionInput: { ...request, invocationGeneration: 1 } },
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
        readExecutorInvocationInput({ dispatchId: attempt.dispatchId, store }),
        (error) => error?.code === variant.code,
        variant.name,
      );
      // Fail closed with zero repair, overwrite, truncation, delete, rewrite.
      assert.equal(readFileSync(path, 'utf8'), variant.bytes, variant.name);
      assert.deepEqual(
        listExecutorAcceptanceFiles(home),
        [`${attempt.dispatchId}.json`],
        variant.name,
      );
      for (const forbiddenDir of FORBIDDEN_NEW_ARTIFACT_DIRS) {
        assert.equal(
          existsSync(join(home, forbiddenDir)),
          false,
          `${variant.name}: ${forbiddenDir}`,
        );
      }
    }

    // Caller-supplied stores bypass the store validator: the reader's own
    // Task 24 validator reuse still fails closed with predecessor codes.
    const corruptFromCallerStore = [
      {
        record: { ...goodRecord, decision: 'ACK' },
        code: CORRUPT_RECEIVER_DISPATCH_DECISION,
      },
      {
        record: { ...goodRecord, acceptedAt: 'now' },
        code: CORRUPT_RECEIVER_DISPATCH_DECISION,
      },
      {
        record: { ...goodRecord, schemaVersion: '2' },
        code: CORRUPT_RECEIVER_DISPATCH_DECISION,
      },
      {
        record: { ...goodRecord, decisionInput: { ...request, workerId: 'worker-tampered' } },
        code: 'DISPATCH_BINDING_MISMATCH',
      },
      {
        record: { ...goodRecord, decisionInput: { hello: 'not-a-transport-request' } },
        code: CORRUPT_TRANSPORT_REQUEST,
      },
    ];
    for (const { record, code } of corruptFromCallerStore) {
      await assert.rejects(
        readExecutorInvocationInput({
          dispatchId: attempt.dispatchId,
          store: { readExecutorDispatchAcceptance: () => record },
        }),
        (error) => error?.code === code,
      );
    }

    // Restoring the exact durable bytes re-enables the read.
    writeFileSync(path, goodBytes, 'utf8');
    const restored = await readExecutorInvocationInput({
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

test('F. a valid acceptance for another dispatchId fails closed and never becomes the result', async () => {
  const first = await setupAccepted(
    'greenhub-executor-invocation-input27-f1-',
    'EII27-F1-SRC',
    'EII27-F1-CHILD',
  );
  const second = await setupAccepted(
    'greenhub-executor-invocation-input27-f2-',
    'EII27-F2-SRC',
    'EII27-F2-CHILD',
  );
  try {
    const foreign = second.store.readExecutorDispatchAcceptance(second.attempt.dispatchId);
    assert.ok(foreign);
    assert.notEqual(foreign.dispatchId, first.attempt.dispatchId);

    // Spy store returns a structurally valid acceptance bound to a different
    // dispatchId: direct binding re-check fails closed.
    await assert.rejects(
      readExecutorInvocationInput({
        dispatchId: first.attempt.dispatchId,
        store: { readExecutorDispatchAcceptance: () => foreign },
      }),
      (error) =>
        error instanceof ExecutorInvocationInputError &&
        error.code === CORRUPT_EXECUTOR_DISPATCH_ACCEPTANCE,
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
      readExecutorInvocationInput({
        dispatchId: first.attempt.dispatchId,
        store: { readExecutorDispatchAcceptance: () => fabricated },
      }),
      (error) => error?.code === CORRUPT_RECEIVER_DISPATCH_DECISION,
    );
    assert.throws(
      () => validateReceiverDecisionRecord(fabricated),
      (error) => error?.code === CORRUPT_RECEIVER_DISPATCH_DECISION,
    );

    // The durable winner for the requested dispatchId is untouched.
    const winner = first.store.readExecutorDispatchAcceptance(first.attempt.dispatchId);
    assert.equal(winner.dispatchId, first.attempt.dispatchId);
    assert.equal(JSON.stringify(winner.decisionInput), JSON.stringify(first.request));
  } finally {
    removeHome(first.home);
    removeHome(second.home);
  }
});

// ---------------------------------------------------------------------------
// G. EXACT PREDECESSOR BINDING: Task 20 decisionInput + sole generation.
// ---------------------------------------------------------------------------

test('G. decisionInput preserves every Task 20 field and claimGeneration exactly', async () => {
  const { home, store, attempt, request } = await setupAccepted(
    'greenhub-executor-invocation-input27-g-',
    'EII27-G-SRC',
    'EII27-G-CHILD',
  );
  try {
    const result = await readExecutorInvocationInput({
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
    assert.equal(input.sourceTaskId, 'EII27-G-SRC');
    assert.equal(input.nextTaskId, 'EII27-G-CHILD');
    assert.equal(input.workerId, 'worker-a');
    assert.equal(input.admissionId, attempt.admissionId);
    assert.equal(input.emissionSlot, attempt.emissionSlot);

    // Exact durable representation: the returned record serializes to the
    // exact durable bytes (no projection, no normalization, no wrapper).
    const bytes = readFileSync(executorAcceptancePath(home, attempt.dispatchId), 'utf8');
    assert.equal(JSON.stringify(result, null, 2), bytes);
    assert.equal(JSON.stringify(result), JSON.stringify(JSON.parse(bytes)));
    assert.equal(JSON.stringify(result.decisionInput), JSON.stringify(request));

    // No wrapper metadata and no new generation authority beyond the inherited
    // claimGeneration.
    for (const forbiddenField of [
      'invocationId',
      'executorId',
      'workerId',
      'invocationReady',
      'executionAllowed',
      'acceptedAt',
      'invocationAt',
      'receivedAt',
      'createdAt',
      'updatedAt',
      'retryCount',
      'deliveryCount',
      'attemptNumber',
      'generation',
      'executorGeneration',
      'invocationGeneration',
      'executionGeneration',
      'acceptanceGeneration',
      'deliveryGeneration',
      'retryGeneration',
      'executorAccepted',
      'acceptedByExecutor',
      'executionStarted',
    ]) {
      assert.equal(Object.hasOwn(result, forbiddenField), false, forbiddenField);
    }
    // workerId legitimately exists only inside the Task 20 decisionInput.
    assert.equal(Object.hasOwn(input, 'workerId'), true);
    assert.equal(
      store.readReceiverDispatchDecision(attempt.dispatchId).decision,
      RECEIVER_DECISION_VALUE,
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// H. READ-ONLY PROOF: byte-identical snapshot, no new files, no mtime change.
// ---------------------------------------------------------------------------

test('H. coordination-home bytes, files, and mtimes are identical after reads', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-input27-h-',
    'EII27-H-SRC',
    'EII27-H-CHILD',
  );
  try {
    const dispatchId = attempt.dispatchId;
    const beforeBytes = snapshotHomeBytes(home);
    const beforeStats = snapshotHomeStats(home);
    const taskBefore = JSON.stringify(store.readTask('EII27-H-CHILD'));
    const claimBefore = JSON.stringify(store.readClaim('EII27-H-CHILD'));
    const attemptBefore = JSON.stringify(
      store.readDispatchAttempt({ sourceTaskId: 'EII27-H-SRC', dispatchId }),
    );
    const receiverAcceptanceBefore = JSON.stringify(
      store.readReceiverDispatchAcceptance(dispatchId),
    );
    const receiverDecisionBefore = JSON.stringify(store.readReceiverDispatchDecision(dispatchId));
    const executorAcceptanceBefore = JSON.stringify(
      store.readExecutorDispatchAcceptance(dispatchId),
    );
    const resultBefore = JSON.stringify(store.readResultById('EII27-H-SRC', 'result-eii27-h-src'));
    const dispositionBefore = JSON.stringify(store.readCurrentDisposition('EII27-H-SRC'));

    for (let replay = 0; replay < 3; replay += 1) {
      const result = await readExecutorInvocationInput({ dispatchId, store });
      assert.equal(result.dispatchId, dispatchId);
    }

    assert.deepEqual(snapshotHomeBytes(home), beforeBytes);
    assert.deepEqual(snapshotHomeStats(home), beforeStats);
    assert.equal(JSON.stringify(store.readTask('EII27-H-CHILD')), taskBefore);
    assert.equal(store.readTask('EII27-H-CHILD').status, TASK_STATUS_CLAIMED);
    assert.equal(JSON.stringify(store.readClaim('EII27-H-CHILD')), claimBefore);
    assert.equal(
      JSON.stringify(store.readDispatchAttempt({ sourceTaskId: 'EII27-H-SRC', dispatchId })),
      attemptBefore,
    );
    assert.equal(
      JSON.stringify(store.readReceiverDispatchAcceptance(dispatchId)),
      receiverAcceptanceBefore,
    );
    assert.equal(
      JSON.stringify(store.readReceiverDispatchDecision(dispatchId)),
      receiverDecisionBefore,
    );
    assert.equal(
      JSON.stringify(store.readExecutorDispatchAcceptance(dispatchId)),
      executorAcceptanceBefore,
    );
    assert.equal(
      JSON.stringify(store.readResultById('EII27-H-SRC', 'result-eii27-h-src')),
      resultBefore,
    );
    assert.equal(JSON.stringify(store.readCurrentDisposition('EII27-H-SRC')), dispositionBefore);
    assert.equal(existsSync(executorAcceptancePath(home, dispatchId)), true);
    assert.equal(existsSync(decisionPath(home, dispatchId)), true);
    for (const forbiddenDir of FORBIDDEN_NEW_ARTIFACT_DIRS) {
      assert.equal(existsSync(join(home, forbiddenDir)), false, forbiddenDir);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// I. FORBIDDEN BOUNDARY + exported surface.
// ---------------------------------------------------------------------------

test('I. production module carries no ACK/receipt/invocation/scheduler/retry/new-generation/fs/transport authority', () => {
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
    'spawn(',
    'exec(',
    'execFile(',
    'fork(',
    'child_process',
    'fetch(',
    'WebSocket(',
    'XMLHttpRequest',
    'http.request(',
    'grpc.',
    'mqtt.',
    'scheduler',
    'scheduleNextTask',
    'polling',
    'daemon',
    'cron',
    'retry',
    'backoff',
    'resend',
    'executionAllowed',
    'executionStarted',
    'executeTask',
    'invokeExecutor',
    'executorInvoked',
    'executorInvocation',
    'invocationStarted',
    'invocationReady',
    'workerSelected',
    'selectWorker',
    'selectExecutor',
    'workerRegistry',
    'executorRegistry',
    'adapterRegistry',
    'capabilityMatch',
    'executorGeneration',
    'invocationGeneration',
    'executionGeneration',
    'acceptanceGeneration',
    'deliveryGeneration',
    'retryGeneration',
    'persistReceiverDecision',
    'acceptReceiverDispatch',
    'createReceiverDispatchDecision',
    'createExecutorDispatchAcceptance',
    'acceptExecutorDispatchDecision',
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
    'new Map(',
    'new Set(',
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

  // The read boundary composes the Task 26 identity/read primitive and the
  // Task 24 public validator verbatim; it never touches the receiver-decision
  // store or the executor-acceptance write primitive.
  assert.ok(code.includes('store.readExecutorDispatchAcceptance('));
  assert.ok(code.includes('validateReceiverDecisionRecord('));
  assert.ok(code.includes('assertValidExecutorAcceptanceDispatchId('));
  assert.equal(code.includes('store.readReceiverDispatchDecision('), false);
  assert.equal(code.includes('store.createExecutorDispatchAcceptance('), false);
  assert.equal(code.includes('node:path'), false);

  // Exported surface: the single read entry + error class only.
  const exportedFunctions = Object.entries(invocationInputModule)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(exportedFunctions, [
    'ExecutorInvocationInputError',
    'readExecutorInvocationInput',
  ]);
  assert.equal(typeof ExecutorInvocationInputError, 'function');
  assert.equal(typeof invocationInputModule.readExecutorInvocationInput, 'function');
});

test('I2. store surface gains no Task 27 invocation/execution primitive', async () => {
  const home = makeHome('greenhub-executor-invocation-input27-i2-');
  try {
    const store = new CoordinationStore({ dir: home });
    assert.equal(store.readExecutorInvocationInput, undefined);
    assert.equal(store.createExecutorInvocationInput, undefined);
    // readExecutorInvocationAttempt / createExecutorInvocationAttempt belong to
    // the Task 28 durable executor invocation attempt surface; this test keeps
    // proving only that Task 27 adds no store primitive of its own.
    assert.equal(store.invokeExecutor, undefined);
    assert.equal(store.executeTask, undefined);
    assert.equal(store.acknowledgeExecutor, undefined);
    assert.equal(store.selectExecutor, undefined);
    assert.equal(store.scheduleExecutor, undefined);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// J. PREDECESSOR IMMUTABILITY: Task 18~26 source/spec bytes unchanged.
// ---------------------------------------------------------------------------

test('J. Task 18~26 predecessor source/spec bytes are unchanged', () => {
  for (const [name, expected] of Object.entries(PREDECESSOR_SHA256)) {
    const actual = createHash('sha256')
      .update(readFileSync(join(MODULE_DIRECTORY, name)))
      .digest('hex');
    assert.equal(actual, expected, `${name} must stay byte-identical`);
  }
});

// ---------------------------------------------------------------------------
// K. REPEATABILITY / FRESH PROCESS: identical canonical return.
// ---------------------------------------------------------------------------

test('K. repeat reads, fresh process, and large clock skew produce the identical canonical return', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-input27-k-',
    'EII27-K-SRC',
    'EII27-K-CHILD',
  );
  try {
    const first = await readExecutorInvocationInput({
      dispatchId: attempt.dispatchId,
      store,
    });
    const canonical = JSON.stringify(first);
    for (let replay = 0; replay < 3; replay += 1) {
      const repeated = await readExecutorInvocationInput({
        dispatchId: attempt.dispatchId,
        store,
      });
      assert.equal(JSON.stringify(repeated), canonical);
    }
    const yearMs = 365 * 24 * 60 * 60 * 1000;
    for (const skewMs of [0, 10 * yearMs, -10 * yearMs]) {
      const out = await runFreshInvocationInputWorker({
        home,
        dispatchId: attempt.dispatchId,
        skewMs,
      });
      assert.equal(out.ok, true, JSON.stringify(out));
      assert.equal(JSON.stringify(out.result), canonical);
      assert.deepEqual(out.result, JSON.parse(canonical));
    }
    assert.equal(first.decision, RECEIVER_DECISION_VALUE);
  } finally {
    removeHome(home);
  }
});
