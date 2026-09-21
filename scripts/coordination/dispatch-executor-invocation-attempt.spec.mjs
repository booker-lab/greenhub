// Proof for GREENHUB-COORDINATION-DURABLE-EXECUTOR-INVOCATION-ATTEMPT-28.
//
// DURABLE_EXECUTOR_INVOCATION_ATTEMPT != executor invocation != ACK != receipt
// != delivery confirmation != execution start != task status transition
// != scheduler decision != worker/executor selection != retry/resend authority
// != new generation/fencing authority != executor availability
// != delivery success.
// read != persist != invoke != ACK != execute.
// persisted != invoked != started != completed: the durable record is evidence
// that the caller reached this persistence boundary ONLY; it is NEVER evidence
// that any executor was actually invoked.
//
// The entry is EXACTLY:
//   (dispatchId, store)
//     -> store capability gate (readReceiverDispatchAcceptance /
//        readExecutorInvocationAttempt / createExecutorInvocationAttempt)
//     -> readExecutorInvocationInput({ dispatchId, store })
//        [Task 27 verbatim: dispatchId identity validation, durable
//         receiver-acceptance read via the Task 23 direct derivation,
//         canonical invocation input record construction/validation, direct
//         binding re-check; missing/corrupt input fails closed with
//         predecessor codes propagated UNCHANGED; zero writes; zero
//         auto-repair]
//     -> existing attempt: exact serialized replay or conflict (first wins)
//     -> unseen: OS exclusive-create under
//        <home>/executor-invocation-attempts/<dispatchId>.json of the EXACT
//        Task 27 input (no wrapper metadata; path authority = attempt fact)
//     -> durable read-back verification
//     -> race loser: winner re-read (replay / conflict / corrupt fail closed)
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
import * as invocationAttemptModule from './dispatch-executor-invocation-attempt.mjs';
import {
  CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
  EXECUTOR_INVOCATION_ATTEMPT_CONFLICT,
  EXECUTOR_INVOCATION_ATTEMPT_NEW_FIELDS,
  EXECUTOR_INVOCATION_ATTEMPT_REPLAY_FIELDS,
  EXECUTOR_INVOCATION_ATTEMPTS_DIRNAME,
  ExecutorInvocationAttemptError,
  executorInvocationAttemptFilePath,
  INVALID_EXECUTOR_INVOCATION_ATTEMPT_STORE,
  persistExecutorInvocationAttempt,
} from './dispatch-executor-invocation-attempt.mjs';
import {
  buildExecutorInvocationInputRecord,
  CORRUPT_EXECUTOR_INVOCATION_INPUT,
  EXECUTOR_INVOCATION_INPUT_DECISION_VALUE,
  readExecutorInvocationInput,
} from './dispatch-executor-invocation-input.mjs';
import {
  acceptReceiverDispatch,
  CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
  receiverDispatchAcceptanceFilePath,
} from './dispatch-receiver-acceptance.mjs';
import { RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND } from './dispatch-receiver-decision-input.mjs';
import {
  CORRUPT_TRANSPORT_REQUEST,
  prepareDispatchTransportRequest,
  TRANSPORT_REQUEST_FIELDS,
} from './dispatch-transport-contract.mjs';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import { CoordinationStore } from './store.mjs';
import { TASK_STATUS_CLAIMED } from './task-envelope.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = join(MODULE_DIRECTORY, 'dispatch-executor-invocation-attempt.mjs');
const MODULE_URL = pathToFileURL(MODULE_PATH).href;
const STORE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'store.mjs')).href;

// Retained Task 18~23/27 predecessor source/spec bytes are pinned to the exact
// live-main baseline this durable invocation attempt was built against (GF-02
// direct-composition revision). A change to any pinned file is a
// predecessor-contract change and must come from an explicitly
// predecessor-owning Task, never from this durable surface. The retired Task
// 24/25/26 receiver-decision / executor-acceptance families and their specs are
// deleted by GF-02, so their pins are intentionally absent. store.mjs is the
// only composed predecessor file allowed to grow (additive primitives only),
// so it is not pinned; its composed sections are covered by the
// byte-immutability proofs below.
//
// Single Task 28 boundary adaptation (semantic-neutral, predecessor-owner
// reviewed by Control Tower, retained through the GF-02 direct-composition
// revision): dispatch-executor-invocation-input.spec.mjs previously asserted
// `store.readExecutorInvocationAttempt === undefined` and
// `store.createExecutorInvocationAttempt === undefined`. Those two absence
// assertions pinned the NEXT (Task 28) task's store surface, which this Task
// owns by contract; the test's own intent ("Task 27 adds no store primitive of
// its own") is preserved. No further Task 27 assertion relaxation is claimed by
// this durable surface.
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
});

const FORBIDDEN_NEW_ARTIFACT_DIRS = Object.freeze([
  'invocation-input',
  'invocation-inputs',
  'invocation-attempts',
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

function makeHome(prefix = 'greenhub-executor-invocation-attempt28-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'DURABLE_EXECUTOR_INVOCATION_ATTEMPT_PROVED',
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
    proofRequirement: ['durable-executor-invocation-attempt-proof'],
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

// Task 28 setup: source -> child claim -> durable dispatch attempt -> Task 20
// request -> Task 22 durable receiver acceptance -> Task 27 readable
// invocation input (direct composition over the durable receiver acceptance).
// NO Task 28 invocation attempt yet.
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
  const input = await readExecutorInvocationInput({ dispatchId: attempt.dispatchId, store });
  return { home, clock, store, attempt, request, input };
}

// Durable dispatch attempt exists but NO Task 22 receiver acceptance yet: the
// Task 27 readable invocation input is unavailable (missing predecessor).
async function setupUnaccepted(prefix, sourceTaskId, childTaskId) {
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

function attemptDir(home) {
  return join(home, EXECUTOR_INVOCATION_ATTEMPTS_DIRNAME);
}

function attemptPath(home, dispatchId) {
  return executorInvocationAttemptFilePath(home, dispatchId);
}

function receiverAcceptancePath(home, dispatchId) {
  return receiverDispatchAcceptanceFilePath(home, dispatchId);
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

// Same-dispatchId record that stays valid (Task 27/20 validation passes) but
// carries a different inner binding (task.desiredExitState): the canonical
// same-key/different-value conflict fixture, built from the durable Task 22
// receiver acceptance exactly as the direct composition does.
function differentValidRecord(store, dispatchId) {
  const good = JSON.parse(
    JSON.stringify(
      buildExecutorInvocationInputRecord(store.readReceiverDispatchAcceptance(dispatchId)),
    ),
  );
  good.decisionInput.task.desiredExitState = 'DIFFERENT_VALID_INVOCATION_ATTEMPT_BINDING';
  return good;
}

function countingStore(store) {
  const calls = [];
  const wrapper = {
    readReceiverDispatchAcceptance: (dispatchId, ...rest) => {
      calls.push({ op: 'readAcceptance', dispatchId, rest });
      return store.readReceiverDispatchAcceptance(dispatchId);
    },
    readExecutorInvocationAttempt: (dispatchId, ...rest) => {
      calls.push({ op: 'readAttempt', dispatchId, rest });
      return store.readExecutorInvocationAttempt(dispatchId);
    },
    createExecutorInvocationAttempt: (record, ...rest) => {
      calls.push({ op: 'createAttempt', record, rest });
      return store.createExecutorInvocationAttempt(record);
    },
  };
  return { calls, store: wrapper };
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

function runFreshAttemptWorker({ home, dispatchId, skewMs = 0 }) {
  return new Promise((resolveResult, rejectResult) => {
    const code = [
      'try {',
      `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
      `  const { persistExecutorInvocationAttempt } = await import(${JSON.stringify(MODULE_URL)});`,
      `  const skewedNow = Date.now() + ${skewMs};`,
      `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)}, nowProvider: () => skewedNow });`,
      `  const result = await persistExecutorInvocationAttempt({ dispatchId: ${JSON.stringify(dispatchId)}, store });`,
      `  const record = store.readExecutorInvocationAttempt(${JSON.stringify(dispatchId)});`,
      '  console.log(JSON.stringify({ ok: true, result, record }));',
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
        rejectResult(new Error(`invocation attempt worker exit=${exitCode} stderr=${stderr}`));
        return;
      }
      try {
        resolveResult(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch (_error) {
        rejectResult(
          new Error(`invocation attempt worker output parse failed: ${stdout} / ${stderr}`),
        );
      }
    });
  });
}

// ---------------------------------------------------------------------------
// A. HAPPY PATH: exact Task 27 input -> one durable attempt -> read-back.
// ---------------------------------------------------------------------------

test('A. durable invocation attempt persists the exact Task 27 input under dispatchId-only path authority', async () => {
  const { home, store, attempt, input } = await setupAccepted(
    'greenhub-executor-invocation-attempt28-a-',
    'EIA28-A-SRC',
    'EIA28-A-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const result = await persistExecutorInvocationAttempt({
      dispatchId: attempt.dispatchId,
      store,
    });
    assert.ok(Object.isFrozen(result));
    assert.deepEqual(Object.keys(result), [...EXECUTOR_INVOCATION_ATTEMPT_NEW_FIELDS]);
    assert.deepEqual(result, { dispatchId: attempt.dispatchId, newlyPersisted: true });

    // The durable value is EXACTLY the Task 27 readable invocation input:
    // byte-equal to the canonical Task 27 record built from the durable Task 22
    // receiver acceptance and to the Task 27 reader result. The
    // invocation-attempt fact is expressed by the path authority ONLY.
    const path = attemptPath(home, attempt.dispatchId);
    const stored = store.readExecutorInvocationAttempt(attempt.dispatchId);
    const viaTask27 = await readExecutorInvocationInput({ dispatchId: attempt.dispatchId, store });
    const builtFromAcceptance = buildExecutorInvocationInputRecord(
      store.readReceiverDispatchAcceptance(attempt.dispatchId),
    );
    assert.equal(readFileSync(path, 'utf8'), expectedRecordBytes(input));
    assert.equal(readFileSync(path, 'utf8'), expectedRecordBytes(builtFromAcceptance));
    assert.equal(JSON.stringify(stored), JSON.stringify(input));
    assert.equal(JSON.stringify(viaTask27), JSON.stringify(input));
    assert.deepEqual(viaTask27, builtFromAcceptance);
    assert.deepEqual(Object.keys(stored), [
      'schemaVersion',
      'dispatchId',
      'decision',
      'decisionInput',
    ]);
    assert.equal(stored.dispatchId, attempt.dispatchId);
    assert.equal(stored.decision, EXECUTOR_INVOCATION_INPUT_DECISION_VALUE);
    assert.deepEqual(Object.keys(stored.decisionInput), [...TRANSPORT_REQUEST_FIELDS]);

    // dispatchId binding + inherited Task 22/20 bindings + sole fencing
    // generation claimGeneration are preserved verbatim.
    assert.equal(stored.decisionInput.dispatchId, attempt.dispatchId);
    assert.equal(stored.decisionInput.sourceTaskId, 'EIA28-A-SRC');
    assert.equal(stored.decisionInput.nextTaskId, 'EIA28-A-CHILD');
    assert.equal(stored.decisionInput.workerId, 'worker-a');
    assert.equal(stored.decisionInput.admissionId, attempt.admissionId);
    assert.equal(stored.decisionInput.emissionSlot, attempt.emissionSlot);
    assert.equal(stored.decisionInput.claimGeneration, 1);
    assert.deepEqual(listAttemptFiles(home), [`${attempt.dispatchId}.json`]);

    // Exactly one new durable path: executor-invocation-attempts/<dispatchId>.json.
    const after = snapshotHomeBytes(home);
    const added = Object.keys(after).filter((name) => !(name in before));
    assert.equal(added.length, 1, JSON.stringify(added));
    assert.equal(
      added[0].replaceAll('\\', '/'),
      `${EXECUTOR_INVOCATION_ATTEMPTS_DIRNAME}/${attempt.dispatchId}.json`,
    );

    // No wrapper metadata and no new generation authority beyond the inherited
    // claimGeneration.
    for (const forbiddenField of [
      'attemptedAt',
      'invocationAttemptedAt',
      'invocationId',
      'executorId',
      'invocationReady',
      'invocationStarted',
      'executionAllowed',
      'executionStarted',
      'acceptedAt',
      'receivedAt',
      'createdAt',
      'updatedAt',
      'retryCount',
      'attemptNumber',
      'generation',
      'executorGeneration',
      'invocationGeneration',
      'executionGeneration',
      'attemptGeneration',
      'retryGeneration',
      'executorInvoked',
      'executorStarted',
      'newlyPersisted',
      'exactReplay',
    ]) {
      assert.equal(Object.hasOwn(stored, forbiddenField), false, forbiddenField);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// B. EXACT REPLAY: byte/mtime-identical, zero write, no alternate primitive.
// ---------------------------------------------------------------------------

test('B. exact replay is idempotent: byte/mtime-identical with zero write and dispatchId-only lookup', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-attempt28-b-',
    'EIA28-B-SRC',
    'EIA28-B-CHILD',
  );
  try {
    const { reads, calls, store: proxyStore } = proxyCountingStore(store);
    const first = await persistExecutorInvocationAttempt({
      dispatchId: attempt.dispatchId,
      store: proxyStore,
    });
    assert.deepEqual(first, { dispatchId: attempt.dispatchId, newlyPersisted: true });

    // First persist consults exactly the composed Task 27 receiver-acceptance
    // read plus the two invocation-attempt primitives; no alternate capability
    // is even consulted.
    assert.deepEqual([...new Set(reads)].sort(), [
      'createExecutorInvocationAttempt',
      'readExecutorInvocationAttempt',
      'readReceiverDispatchAcceptance',
    ]);
    assert.deepEqual(
      calls.map((call) => call.op),
      [
        'readReceiverDispatchAcceptance',
        'readExecutorInvocationAttempt',
        'createExecutorInvocationAttempt',
        'readExecutorInvocationAttempt',
      ],
    );
    for (const call of calls) {
      if (call.op === 'createExecutorInvocationAttempt') {
        assert.equal(call.args.length, 1);
        assert.equal(call.args[0].dispatchId, attempt.dispatchId);
        continue;
      }
      assert.equal(call.args.length, 1);
      assert.equal(call.args[0], attempt.dispatchId);
    }

    const path = attemptPath(home, attempt.dispatchId);
    const bytes = readFileSync(path, 'utf8');
    const fileStat = statSync(path);
    const homeBytes = snapshotHomeBytes(home);
    const homeStats = snapshotHomeStats(home);

    // Replay consults the composition read + the attempt read ONLY, and never
    // invokes create or reaches into any other primitive.
    const replayTrace = proxyCountingStore(store);
    const replay = await persistExecutorInvocationAttempt({
      dispatchId: attempt.dispatchId,
      store: replayTrace.store,
    });
    assert.ok(Object.isFrozen(replay));
    assert.deepEqual(Object.keys(replay), [...EXECUTOR_INVOCATION_ATTEMPT_REPLAY_FIELDS]);
    assert.deepEqual(replay, {
      dispatchId: attempt.dispatchId,
      newlyPersisted: false,
      exactReplay: true,
    });
    assert.deepEqual(
      replayTrace.calls.map((call) => call.op),
      ['readReceiverDispatchAcceptance', 'readExecutorInvocationAttempt'],
    );

    // write = 0, byte change = 0, mtime change = 0, task mutation = 0.
    assert.equal(readFileSync(path, 'utf8'), bytes);
    const replayedStat = statSync(path);
    assert.equal(replayedStat.size, fileStat.size);
    assert.equal(replayedStat.mtimeMs, fileStat.mtimeMs);
    assert.deepEqual(snapshotHomeBytes(home), homeBytes);
    assert.deepEqual(snapshotHomeStats(home), homeStats);
    assert.equal(store.readTask('EIA28-B-CHILD').status, TASK_STATUS_CLAIMED);
    assert.equal(store.readClaim('EIA28-B-CHILD').generation, 1);
    assert.equal(
      readFileSync(path, 'utf8'),
      expectedRecordBytes(store.readExecutorInvocationAttempt(attempt.dispatchId)),
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// C. FRESH PROCESS / CLOCK SKEW: deterministic representation.
// ---------------------------------------------------------------------------

test('C. fresh process, large clock skew, and repeated serialization are byte-identical', {
  timeout: 120_000,
}, async () => {
  const { home, store, attempt, input } = await setupAccepted(
    'greenhub-executor-invocation-attempt28-c-',
    'EIA28-C-SRC',
    'EIA28-C-CHILD',
  );
  try {
    const canonical = JSON.stringify(input);
    const path = attemptPath(home, attempt.dispatchId);

    // A fresh process performs the first-ever persistence under skew.
    const skewedCreate = await runFreshAttemptWorker({
      home,
      dispatchId: attempt.dispatchId,
      skewMs: 10 * 365 * 24 * 60 * 60 * 1000,
    });
    assert.equal(skewedCreate.ok, true, JSON.stringify(skewedCreate));
    assert.deepEqual(skewedCreate.result, {
      dispatchId: attempt.dispatchId,
      newlyPersisted: true,
    });
    assert.equal(JSON.stringify(skewedCreate.record), canonical);
    const bytes = readFileSync(path, 'utf8');
    assert.equal(bytes, expectedRecordBytes(input));

    // Replays in fresh processes under opposite skew stay byte-identical.
    for (const skewMs of [-10 * 365 * 24 * 60 * 60 * 1000, 0]) {
      const replay = await runFreshAttemptWorker({
        home,
        dispatchId: attempt.dispatchId,
        skewMs,
      });
      assert.equal(replay.ok, true, JSON.stringify(replay));
      assert.deepEqual(replay.result, {
        dispatchId: attempt.dispatchId,
        newlyPersisted: false,
        exactReplay: true,
      });
      assert.equal(JSON.stringify(replay.record), canonical);
      assert.equal(readFileSync(path, 'utf8'), bytes);
    }

    // In-process repeated serialization is identical too.
    const repeated = await persistExecutorInvocationAttempt({
      dispatchId: attempt.dispatchId,
      store,
    });
    assert.equal(repeated.exactReplay, true);
    assert.equal(
      JSON.stringify(await readExecutorInvocationInput({ dispatchId: attempt.dispatchId, store })),
      canonical,
    );
    assert.equal(readFileSync(path, 'utf8'), bytes);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// D. CONCURRENT SAME-INPUT PERSISTENCE (single process).
// ---------------------------------------------------------------------------

test('D. concurrent same-input persistence converges on exactly one durable record', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-attempt28-d-',
    'EIA28-D-SRC',
    'EIA28-D-CHILD',
  );
  try {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        persistExecutorInvocationAttempt({ dispatchId: attempt.dispatchId, store }),
      ),
    );
    const winners = results.filter((entry) => entry.newlyPersisted === true);
    const replays = results.filter(
      (entry) => entry.newlyPersisted === false && entry.exactReplay === true,
    );
    assert.equal(winners.length, 1);
    assert.equal(replays.length, 5);
    for (const entry of results) {
      assert.equal(entry.dispatchId, attempt.dispatchId);
      assert.ok(Object.isFrozen(entry));
    }

    assert.deepEqual(listAttemptFiles(home), [`${attempt.dispatchId}.json`]);
    const stored = store.readExecutorInvocationAttempt(attempt.dispatchId);
    assert.equal(
      readFileSync(attemptPath(home, attempt.dispatchId), 'utf8'),
      expectedRecordBytes(stored),
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. CONCURRENT PERSISTENCE ACROSS SEPARATE PROCESSES (OS exclusive-create).
// ---------------------------------------------------------------------------

test('E. separate-process race yields exactly one OS exclusive-create winner', {
  timeout: 120_000,
}, async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-attempt28-e-',
    'EIA28-E-SRC',
    'EIA28-E-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () =>
        runFreshAttemptWorker({ home, dispatchId: attempt.dispatchId }),
      ),
    );
    for (const outcome of outcomes) {
      assert.equal(outcome.ok, true, JSON.stringify(outcome));
    }
    const winners = outcomes.filter((outcome) => outcome.result.newlyPersisted === true);
    const replays = outcomes.filter(
      (outcome) => outcome.result.newlyPersisted === false && outcome.result.exactReplay === true,
    );
    assert.equal(winners.length, 1, JSON.stringify(outcomes));
    assert.equal(replays.length, 5);

    assert.deepEqual(listAttemptFiles(home), [`${attempt.dispatchId}.json`]);
    const stored = store.readExecutorInvocationAttempt(attempt.dispatchId);
    assert.equal(
      readFileSync(attemptPath(home, attempt.dispatchId), 'utf8'),
      expectedRecordBytes(stored),
    );

    // Exactly one new durable path; no temp artifacts, no other domain growth.
    const after = snapshotHomeBytes(home);
    const added = Object.keys(after).filter((name) => !(name in before));
    assert.equal(added.length, 1, JSON.stringify(added));
    assert.ok(added[0].includes(EXECUTOR_INVOCATION_ATTEMPTS_DIRNAME));
    assert.ok(added[0].includes(`${attempt.dispatchId}.json`));
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. MISSING PREDECESSOR: Task 27 read failure only, zero attempt side effect.
// ---------------------------------------------------------------------------

test('F. missing durable receiver acceptance fails with the predecessor read code and writes nothing', async () => {
  const { home, store, attempt } = await setupUnaccepted(
    'greenhub-executor-invocation-attempt28-f-',
    'EIA28-F-SRC',
    'EIA28-F-CHILD',
  );
  try {
    // The durable Task 22 receiver acceptance does not exist, so the Task 27
    // direct derivation reports the read failure.
    assert.equal(store.readReceiverDispatchAcceptance(attempt.dispatchId), null);
    assert.equal(store.readExecutorInvocationAttempt(attempt.dispatchId), null);
    const before = snapshotHomeBytes(home);
    const { calls, store: spyStore } = countingStore(store);

    // The Task 27 read error (class and code) propagates VERBATIM: a missing
    // predecessor is never re-interpreted as not-ready / retry / executor
    // unavailable.
    await assert.rejects(
      persistExecutorInvocationAttempt({ dispatchId: attempt.dispatchId, store: spyStore }),
      (error) => error?.code === RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND,
    );

    // The Task 27 composition read happened exactly once with dispatchId only;
    // no attempt read, no create, no auto-acceptance, no auto-attempt, no retry,
    // no receiver-acceptance reconstruction.
    const acceptanceReads = calls.filter((call) => call.op === 'readAcceptance');
    assert.equal(acceptanceReads.length, 1);
    assert.equal(acceptanceReads[0].dispatchId, attempt.dispatchId);
    assert.deepEqual(acceptanceReads[0].rest, []);
    assert.equal(
      calls.some((call) => call.op === 'readAttempt'),
      false,
    );
    assert.equal(
      calls.some((call) => call.op === 'createAttempt'),
      false,
    );
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.equal(existsSync(attemptDir(home)), false);
    assert.equal(store.readReceiverDispatchAcceptance(attempt.dispatchId), null);
    assert.equal(store.readExecutorInvocationAttempt(attempt.dispatchId), null);
    assert.equal(store.readTask('EIA28-F-CHILD').status, TASK_STATUS_CLAIMED);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// G. INVALID IDENTITY / INVALID STORE.
// ---------------------------------------------------------------------------

test('G. invalid dispatchId and invalid stores fail closed before any attempt access', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-attempt28-g-',
    'EIA28-G-SRC',
    'EIA28-G-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);

    // Invalid identity: the Task 27 composition validates first; no store
    // primitive is invoked (predecessor code propagates unchanged).
    let primitiveCalls = 0;
    const countingProbeStore = {
      readReceiverDispatchAcceptance: (dispatchId) => {
        primitiveCalls += 1;
        return store.readReceiverDispatchAcceptance(dispatchId);
      },
      readExecutorInvocationAttempt: (dispatchId) => {
        primitiveCalls += 1;
        return store.readExecutorInvocationAttempt(dispatchId);
      },
      createExecutorInvocationAttempt: (record) => {
        primitiveCalls += 1;
        return store.createExecutorInvocationAttempt(record);
      },
    };
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
        persistExecutorInvocationAttempt({ dispatchId: invalidId, store: countingProbeStore }),
        (error) => error?.code === CORRUPT_EXECUTOR_INVOCATION_INPUT,
      );
    }
    assert.equal(primitiveCalls, 0);

    // Invalid stores: fail with the invocation-attempt-native store code; no
    // read, no write, no probe invocation.
    let probeCalls = 0;
    const invalidStores = [
      undefined,
      null,
      'store',
      42,
      {},
      { readReceiverDispatchAcceptance: () => null },
      { readReceiverDispatchAcceptance: () => null, readExecutorInvocationAttempt: () => null },
      {
        readReceiverDispatchAcceptance: () => null,
        createExecutorInvocationAttempt: () => ({ created: true }),
      },
      {
        readReceiverDispatchAcceptance: () => {
          probeCalls += 1;
          return null;
        },
        readExecutorInvocationAttempt: 7,
        createExecutorInvocationAttempt: 7,
      },
    ];
    for (const invalidStore of invalidStores) {
      await assert.rejects(
        persistExecutorInvocationAttempt({ dispatchId: attempt.dispatchId, store: invalidStore }),
        (error) =>
          error instanceof ExecutorInvocationAttemptError &&
          error.code === INVALID_EXECUTOR_INVOCATION_ATTEMPT_STORE,
      );
    }
    assert.equal(probeCalls, 0);
    await assert.rejects(persistExecutorInvocationAttempt(), (error) => error != null);
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.equal(existsSync(attemptPath(home, attempt.dispatchId)), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// H. CORRUPT PREDECESSOR INPUT: predecessor codes propagate through the direct
// composition, zero attempt file.
// ---------------------------------------------------------------------------

test('H. corrupt durable Task 22 receiver acceptance fails closed with predecessor codes and no attempt file', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-attempt28-h-',
    'EIA28-H-SRC',
    'EIA28-H-CHILD',
  );
  try {
    const path = receiverAcceptancePath(home, attempt.dispatchId);
    const pristineBytes = readFileSync(path, 'utf8');
    const record = JSON.parse(pristineBytes);
    const variants = [
      {
        name: 'unparseable acceptance bytes',
        bytes: '{ not json',
        code: CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
      },
      {
        name: 'valid JSON, invalid acceptance record',
        bytes: JSON.stringify({ hello: 'not-an-acceptance' }, null, 2),
        code: CORRUPT_TRANSPORT_REQUEST,
      },
      {
        name: 'key order drift',
        bytes: JSON.stringify(
          {
            dispatchId: record.dispatchId,
            schemaVersion: record.schemaVersion,
            sourceTaskId: record.sourceTaskId,
            emissionSlot: record.emissionSlot,
            admissionId: record.admissionId,
            nextTaskId: record.nextTaskId,
            workerId: record.workerId,
            claimGeneration: record.claimGeneration,
            task: record.task,
          },
          null,
          2,
        ),
        code: CORRUPT_TRANSPORT_REQUEST,
      },
      {
        name: 'schema value drift',
        bytes: JSON.stringify({ ...record, schemaVersion: '2' }, null, 2),
        code: CORRUPT_TRANSPORT_REQUEST,
      },
      {
        name: 'blocked timestamp field',
        bytes: JSON.stringify({ ...record, dispatchedAt: 'now' }, null, 2),
        code: CORRUPT_TRANSPORT_REQUEST,
      },
      {
        name: 'extra smuggled field',
        bytes: JSON.stringify({ ...record, attemptGeneration: 2 }, null, 2),
        code: CORRUPT_TRANSPORT_REQUEST,
      },
      {
        name: 'binding tamper (workerId)',
        bytes: JSON.stringify({ ...record, workerId: 'worker-tampered' }, null, 2),
        code: 'DISPATCH_BINDING_MISMATCH',
      },
      {
        name: 'embedded task envelope binding tamper',
        bytes: JSON.stringify(
          { ...record, task: { ...record.task, taskId: 'EIA28-H-OTHER' } },
          null,
          2,
        ),
        code: 'DISPATCH_ATTEMPT_BINDING_MISMATCH',
      },
    ];

    for (const variant of variants) {
      writeFileSync(path, variant.bytes, 'utf8');
      await assert.rejects(
        persistExecutorInvocationAttempt({ dispatchId: attempt.dispatchId, store }),
        (error) => error?.code === variant.code,
        variant.name,
      );
      // No invocation-attempt file, no repair, no predecessor rewrite.
      assert.equal(existsSync(attemptDir(home)), false, variant.name);
      assert.equal(readFileSync(path, 'utf8'), variant.bytes, variant.name);
    }

    // Restoring the exact durable bytes re-enables the persistence path.
    writeFileSync(path, pristineBytes, 'utf8');
    const result = await persistExecutorInvocationAttempt({
      dispatchId: attempt.dispatchId,
      store,
    });
    assert.equal(result.newlyPersisted, true);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// I. CORRUPT DURABLE ATTEMPT: fail closed, bytes preserved, no repair.
// ---------------------------------------------------------------------------

test('I. corrupt durable invocation attempt fails closed with exact bytes preserved and no repair', async () => {
  const { home, store, attempt, request } = await setupAccepted(
    'greenhub-executor-invocation-attempt28-i-',
    'EIA28-I-SRC',
    'EIA28-I-CHILD',
  );
  try {
    await persistExecutorInvocationAttempt({ dispatchId: attempt.dispatchId, store });
    const path = attemptPath(home, attempt.dispatchId);
    const bytes = readFileSync(path, 'utf8');
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
        bytes: JSON.stringify({ ...goodRecord, decision: 'ACCEPTED' }, null, 2),
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
      await assert.rejects(
        persistExecutorInvocationAttempt({ dispatchId: attempt.dispatchId, store }),
        (error) => error?.code === variant.code,
        variant.name,
      );
      assert.equal(readFileSync(path, 'utf8'), variant.bytes, variant.name);
      assert.deepEqual(listAttemptFiles(home), [`${attempt.dispatchId}.json`], variant.name);
    }

    // Restoring the exact durable bytes re-enables exact replay.
    writeFileSync(path, bytes, 'utf8');
    const replay = await persistExecutorInvocationAttempt({
      dispatchId: attempt.dispatchId,
      store,
    });
    assert.deepEqual(replay, {
      dispatchId: attempt.dispatchId,
      newlyPersisted: false,
      exactReplay: true,
    });
    assert.equal(readFileSync(path, 'utf8'), bytes);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// J. SAME KEY / DIFFERENT VALID RECORD: conflict, first winner preserved.
// ---------------------------------------------------------------------------

test('J. different valid record under the same dispatchId fails closed with the first winner preserved', async () => {
  const { home, store, attempt, input } = await setupAccepted(
    'greenhub-executor-invocation-attempt28-j-',
    'EIA28-J-SRC',
    'EIA28-J-CHILD',
  );
  try {
    const different = differentValidRecord(store, attempt.dispatchId);

    // Existing different valid winner: conflict before any create.
    let createCalls = 0;
    const observedDifferentStore = {
      readReceiverDispatchAcceptance: (dispatchId) =>
        store.readReceiverDispatchAcceptance(dispatchId),
      readExecutorInvocationAttempt: () => different,
      createExecutorInvocationAttempt: () => {
        createCalls += 1;
        return { created: true };
      },
    };
    await assert.rejects(
      persistExecutorInvocationAttempt({
        dispatchId: attempt.dispatchId,
        store: observedDifferentStore,
      }),
      (error) => error?.code === EXECUTOR_INVOCATION_ATTEMPT_CONFLICT,
    );
    assert.equal(createCalls, 0);
    assert.equal(store.readExecutorInvocationAttempt(attempt.dispatchId), null);

    // First durable winner persists; a conflicting existing record never
    // overwrites it.
    const created = await persistExecutorInvocationAttempt({
      dispatchId: attempt.dispatchId,
      store,
    });
    assert.equal(created.newlyPersisted, true);
    const path = attemptPath(home, attempt.dispatchId);
    const winnerBytes = readFileSync(path, 'utf8');

    // Manually duplicating the durable file with a different valid record is
    // still a conflict and never repaired/overwritten by this surface.
    writeFileSync(path, JSON.stringify(different, null, 2), 'utf8');
    await assert.rejects(
      persistExecutorInvocationAttempt({ dispatchId: attempt.dispatchId, store }),
      (error) => error?.code === EXECUTOR_INVOCATION_ATTEMPT_CONFLICT,
    );
    assert.equal(readFileSync(path, 'utf8'), JSON.stringify(different, null, 2));

    // Exclusive-create race loser paths via a caller-supplied store:
    // (a) winner equals the candidate -> idempotent replay.
    let reads = 0;
    const raceReplayStore = {
      readReceiverDispatchAcceptance: (dispatchId) =>
        store.readReceiverDispatchAcceptance(dispatchId),
      readExecutorInvocationAttempt: () => {
        reads += 1;
        return reads === 1 ? null : input;
      },
      createExecutorInvocationAttempt: () => ({ created: false }),
    };
    const raceReplay = await persistExecutorInvocationAttempt({
      dispatchId: attempt.dispatchId,
      store: raceReplayStore,
    });
    assert.deepEqual(raceReplay, {
      dispatchId: attempt.dispatchId,
      newlyPersisted: false,
      exactReplay: true,
    });
    assert.equal(reads, 2);

    // (b) winner is a different valid record -> conflict.
    let conflictReads = 0;
    const raceConflictStore = {
      readReceiverDispatchAcceptance: (dispatchId) =>
        store.readReceiverDispatchAcceptance(dispatchId),
      readExecutorInvocationAttempt: () => {
        conflictReads += 1;
        return conflictReads === 1 ? null : different;
      },
      createExecutorInvocationAttempt: () => ({ created: false }),
    };
    await assert.rejects(
      persistExecutorInvocationAttempt({
        dispatchId: attempt.dispatchId,
        store: raceConflictStore,
      }),
      (error) => error?.code === EXECUTOR_INVOCATION_ATTEMPT_CONFLICT,
    );
    assert.equal(conflictReads, 2);

    // (c) winner vanished after the create race -> deterministic fail-closed.
    const raceVanishedStore = {
      readReceiverDispatchAcceptance: (dispatchId) =>
        store.readReceiverDispatchAcceptance(dispatchId),
      readExecutorInvocationAttempt: () => null,
      createExecutorInvocationAttempt: () => ({ created: false }),
    };
    await assert.rejects(
      persistExecutorInvocationAttempt({
        dispatchId: attempt.dispatchId,
        store: raceVanishedStore,
      }),
      (error) => error?.code === CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
    );

    // (d) read-back mismatch after a winning create -> fail closed.
    const badReadBackStore = {
      readReceiverDispatchAcceptance: (dispatchId) =>
        store.readReceiverDispatchAcceptance(dispatchId),
      readExecutorInvocationAttempt: () => different,
      createExecutorInvocationAttempt: () => ({ created: true }),
    };
    // observed (pre-create) is different here, so this is a straight conflict.
    await assert.rejects(
      persistExecutorInvocationAttempt({
        dispatchId: attempt.dispatchId,
        store: badReadBackStore,
      }),
      (error) => error?.code === EXECUTOR_INVOCATION_ATTEMPT_CONFLICT,
    );
    let readBackReads = 0;
    const readBackMismatchStore = {
      readReceiverDispatchAcceptance: (dispatchId) =>
        store.readReceiverDispatchAcceptance(dispatchId),
      readExecutorInvocationAttempt: () => {
        readBackReads += 1;
        return readBackReads === 1 ? null : different;
      },
      createExecutorInvocationAttempt: () => ({ created: true }),
    };
    await assert.rejects(
      persistExecutorInvocationAttempt({
        dispatchId: attempt.dispatchId,
        store: readBackMismatchStore,
      }),
      (error) => error?.code === CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
    );

    // Restoring the original winner re-enables exact replay.
    writeFileSync(path, winnerBytes, 'utf8');
    const replay = await persistExecutorInvocationAttempt({
      dispatchId: attempt.dispatchId,
      store,
    });
    assert.deepEqual(replay, {
      dispatchId: attempt.dispatchId,
      newlyPersisted: false,
      exactReplay: true,
    });
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// K. NO MUTATION: every predecessor durable byte stays identical.
// ---------------------------------------------------------------------------

test('K. persistence leaves every predecessor durable byte identical and no forbidden artifact', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-attempt28-k-',
    'EIA28-K-SRC',
    'EIA28-K-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const beforeStats = snapshotHomeStats(home);
    const taskBefore = store.readTask('EIA28-K-CHILD');
    const claimBefore = store.readClaim('EIA28-K-CHILD');

    const result = await persistExecutorInvocationAttempt({
      dispatchId: attempt.dispatchId,
      store,
    });
    assert.equal(result.newlyPersisted, true);

    // Only one added path; every pre-existing byte (task, claim, admission,
    // emission, dispatch attempt, receiver acceptance, results, dispositions)
    // is untouched.
    const after = snapshotHomeBytes(home);
    const added = Object.keys(after).filter((name) => !(name in before));
    assert.equal(added.length, 1, JSON.stringify(added));
    assert.ok(added[0].includes(EXECUTOR_INVOCATION_ATTEMPTS_DIRNAME));
    for (const [name, value] of Object.entries(before)) {
      assert.equal(after[name], value, name);
    }

    // Task is still CLAIMED; claim fencing generation is unchanged.
    const taskAfter = store.readTask('EIA28-K-CHILD');
    const claimAfter = store.readClaim('EIA28-K-CHILD');
    assert.equal(taskAfter.status, TASK_STATUS_CLAIMED);
    assert.equal(claimAfter.generation, claimBefore.generation);
    assert.equal(claimAfter.claimToken, claimBefore.claimToken);
    assert.equal(taskAfter.status, taskBefore.status);

    // No ACK/receipt/invocation/scheduler/retry/execution artifact exists.
    for (const forbiddenDir of FORBIDDEN_NEW_ARTIFACT_DIRS) {
      assert.equal(existsSync(join(home, forbiddenDir)), false, forbiddenDir);
    }

    // Replay is also mutation-free (stats identical for all files).
    const statsBefore = snapshotHomeStats(home);
    await persistExecutorInvocationAttempt({ dispatchId: attempt.dispatchId, store });
    assert.deepEqual(snapshotHomeStats(home), statsBefore);
    assert.deepEqual(snapshotHomeBytes(home), after);
    assert.ok(Object.keys(beforeStats).length > 0);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// L. CLOCK-FREE / PROCESS-FREE CANONICAL RESULT.
// ---------------------------------------------------------------------------

test('L. invocation-attempt identity/content is clock-free, process-free, and canonical', async () => {
  const { home, store, attempt, input } = await setupAccepted(
    'greenhub-executor-invocation-attempt28-l-',
    'EIA28-L-SRC',
    'EIA28-L-CHILD',
  );
  try {
    const first = await persistExecutorInvocationAttempt({
      dispatchId: attempt.dispatchId,
      store,
    });
    assert.equal(first.newlyPersisted, true);
    const path = attemptPath(home, attempt.dispatchId);
    const bytes = readFileSync(path, 'utf8');
    const baseline = JSON.parse(bytes);
    const baselineJson = JSON.stringify(baseline);

    // Large clock skew + a fresh store instance re-reads identically and
    // replays without a byte change.
    const skewedStore = new CoordinationStore({
      dir: home,
      nowProvider: () => 4_102_444_800_000,
    });
    const replay = await persistExecutorInvocationAttempt({
      dispatchId: attempt.dispatchId,
      store: skewedStore,
    });
    assert.deepEqual(replay, {
      dispatchId: attempt.dispatchId,
      newlyPersisted: false,
      exactReplay: true,
    });
    assert.equal(
      JSON.stringify(skewedStore.readExecutorInvocationAttempt(attempt.dispatchId)),
      baselineJson,
    );
    assert.equal(readFileSync(path, 'utf8'), bytes);
    assert.equal(JSON.stringify(input), baselineJson);

    // No clock/process/generation/wrapper/ACK/retry field exists anywhere in
    // the stored representation; path authority is the sole attempt marker.
    for (const forbiddenField of [
      'attemptedAt',
      'invocationAttemptedAt',
      'receivedAt',
      'createdAt',
      'updatedAt',
      'timestamp',
      'pid',
      'hostname',
      'uuid',
      'executorId',
      'executorGeneration',
      'invocationGeneration',
      'executionGeneration',
      'attemptGeneration',
      'retryGeneration',
      'retryCount',
      'attemptNumber',
      'receipt',
      'ack',
      'executionAllowed',
      'executionStarted',
      'executorStarted',
      'newlyPersisted',
      'exactReplay',
    ]) {
      assert.equal(Object.hasOwn(baseline, forbiddenField), false, forbiddenField);
    }
    assert.deepEqual(Object.keys(baseline), [
      'schemaVersion',
      'dispatchId',
      'decision',
      'decisionInput',
    ]);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// M. FORBIDDEN BOUNDARY (source boundary, code only) + entry composition.
// ---------------------------------------------------------------------------

test('M. production module carries no ACK/receipt/invocation/scheduler/retry/new-generation/fs/transport authority', () => {
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

  // The persistence boundary composes the Task 27 read verbatim and only
  // persists through its own store primitives.
  assert.ok(code.includes('readExecutorInvocationInput('));
  assert.ok(code.includes('store.readExecutorInvocationAttempt('));
  assert.ok(code.includes('store.createExecutorInvocationAttempt('));
  assert.ok(code.includes('assertValidExecutorInvocationAttemptDispatchId('));
  assert.ok(code.includes('assertValidReceiverAcceptanceDispatchId('));
  assert.equal(code.includes('store.readReceiverDispatchAcceptance('), false);
  assert.equal(code.includes('store.readExecutorDispatchAcceptance('), false);
  assert.equal(code.includes('validateReceiverDecisionRecord('), false);
  assert.equal(code.includes('validateExecutorInvocationInputRecord('), false);
  assert.equal(code.includes('node:path'), true);

  // Exported surface: constants/helpers/entry + error class only.
  const exportedFunctions = Object.entries(invocationAttemptModule)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(exportedFunctions, [
    'ExecutorInvocationAttemptError',
    'assertValidExecutorInvocationAttemptDispatchId',
    'executorInvocationAttemptFileName',
    'executorInvocationAttemptFilePath',
    'persistExecutorInvocationAttempt',
  ]);
  assert.equal(typeof ExecutorInvocationAttemptError, 'function');
  assert.equal(typeof invocationAttemptModule.persistExecutorInvocationAttempt, 'function');
});

test('M2. store exposes the minimal invocation-attempt primitive and keeps forbidden authority absent', () => {
  const home = makeHome('greenhub-executor-invocation-attempt28-m2-');
  try {
    const store = new CoordinationStore({ dir: home });
    assert.equal(typeof store.readExecutorInvocationAttempt, 'function');
    assert.equal(typeof store.createExecutorInvocationAttempt, 'function');
    assert.equal(typeof store.readReceiverDispatchAcceptance, 'function');
    for (const forbidden of [
      'acknowledgeDispatch',
      'ackDispatch',
      'executeTask',
      'executeDispatch',
      'invokeExecutor',
      'scheduleNextTask',
      'selectWorker',
      'selectExecutor',
      'inferWorker',
      'retryDispatch',
      'resendDispatch',
      'backoffDispatch',
      'decideNextTask',
      'invocationCounter',
      'retryCounter',
    ]) {
      assert.equal(store[forbidden], undefined, `store.${forbidden} must not exist`);
    }

    // The durable domain uses OS exclusive-create and never exists()->write().
    const storeSource = readFileSync(join(MODULE_DIRECTORY, 'store.mjs'), 'utf8');
    const start = storeSource.indexOf('Durable executor invocation attempt domain');
    const end = storeSource.indexOf('Claim-bound dispatch envelope domain', start);
    assert.ok(start > 0 && end > start, 'invocation-attempt domain section must exist');
    const section = storeSource.slice(start, end);
    assert.ok(section.includes('writeJsonExclusive('));
    assert.equal(section.includes('existsSync('), false);
    assert.equal(section.includes('writeJsonAtomic('), false);
    assert.equal(section.includes('validateExecutorInvocationInputRecord('), true);
    assert.equal(section.includes('createExecutorInvocationAttempt('), true);
    assert.equal(section.includes('readExecutorInvocationAttempt('), true);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// N. PREDECESSOR IMMUTABILITY: Task 18~23/27 source/spec bytes unchanged.
// ---------------------------------------------------------------------------

test('N. retained Task 18~23/27 predecessor source/spec bytes are unchanged', () => {
  for (const [name, expected] of Object.entries(PREDECESSOR_SHA256)) {
    const actual = createHash('sha256')
      .update(readFileSync(join(MODULE_DIRECTORY, name)))
      .digest('hex');
    assert.equal(actual, expected, `${name} must stay byte-identical`);
  }
});

// ---------------------------------------------------------------------------
// O. ONE DISPATCHID -> AT MOST ONE IMMUTABLE ATTEMPT ACROSS EVERY PATH.
// ---------------------------------------------------------------------------

test('O. one dispatchId carries at most one immutable attempt across every path', async () => {
  const { home, store, attempt, input } = await setupAccepted(
    'greenhub-executor-invocation-attempt28-o-',
    'EIA28-O-SRC',
    'EIA28-O-CHILD',
  );
  try {
    const created = await persistExecutorInvocationAttempt({
      dispatchId: attempt.dispatchId,
      store,
    });
    assert.equal(created.newlyPersisted, true);
    const path = attemptPath(home, attempt.dispatchId);
    const bytes = readFileSync(path, 'utf8');

    const replayCalls = await Promise.all([
      persistExecutorInvocationAttempt({ dispatchId: attempt.dispatchId, store }),
      persistExecutorInvocationAttempt({ dispatchId: attempt.dispatchId, store }),
      persistExecutorInvocationAttempt({ dispatchId: attempt.dispatchId, store }),
    ]);
    for (const replay of replayCalls) {
      assert.equal(replay.newlyPersisted, false);
      assert.equal(replay.exactReplay, true);
    }
    assert.equal(readFileSync(path, 'utf8'), bytes);
    assert.deepEqual(listAttemptFiles(home), [`${attempt.dispatchId}.json`]);

    // Store primitives reject invalid records before any write.
    for (const invalidRecord of [
      null,
      'not-a-record',
      {},
      { ...store.readExecutorInvocationAttempt(attempt.dispatchId), decision: 'NOPE' },
      { ...store.readExecutorInvocationAttempt(attempt.dispatchId), attemptedAt: 'now' },
    ]) {
      let observed;
      try {
        store.createExecutorInvocationAttempt(invalidRecord);
      } catch (error) {
        observed = error;
      }
      assert.notEqual(observed, undefined, 'invalid record must fail closed');
    }
    assert.equal(readFileSync(path, 'utf8'), bytes);
    assert.deepEqual(listAttemptFiles(home), [`${attempt.dispatchId}.json`]);

    // Store-level exclusive-create replay never rewrites the winner.
    const duplicate = store.createExecutorInvocationAttempt(input);
    assert.deepEqual(duplicate, { created: false });
    assert.equal(readFileSync(path, 'utf8'), bytes);

    // Store read with a different valid record is returned as-is, never a
    // repair; the entry layer then fails closed.
    const different = differentValidRecord(store, attempt.dispatchId);
    writeFileSync(path, JSON.stringify(different, null, 2), 'utf8');
    assert.equal(
      JSON.stringify(store.readExecutorInvocationAttempt(attempt.dispatchId)),
      JSON.stringify(different),
    );
    await assert.rejects(
      persistExecutorInvocationAttempt({ dispatchId: attempt.dispatchId, store }),
      (error) => error?.code === EXECUTOR_INVOCATION_ATTEMPT_CONFLICT,
    );
    writeFileSync(path, bytes, 'utf8');
    const restored = await persistExecutorInvocationAttempt({
      dispatchId: attempt.dispatchId,
      store,
    });
    assert.equal(restored.exactReplay, true);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// P. dispatchId-ONLY LOOKUP: exactly the required primitives are consulted.
// ---------------------------------------------------------------------------

test('P. persistence consults only dispatchId-keyed primitives and never an alternate authority', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-attempt28-p-',
    'EIA28-P-SRC',
    'EIA28-P-CHILD',
  );
  try {
    const { calls, store: spyStore } = proxyCountingStore(store);
    const result = await persistExecutorInvocationAttempt({
      dispatchId: attempt.dispatchId,
      store: spyStore,
    });
    assert.equal(result.newlyPersisted, true);

    assert.deepEqual(
      calls.map((call) => call.op),
      [
        'readReceiverDispatchAcceptance',
        'readExecutorInvocationAttempt',
        'createExecutorInvocationAttempt',
        'readExecutorInvocationAttempt',
      ],
    );
    for (const call of calls) {
      if (call.op === 'createExecutorInvocationAttempt') {
        assert.equal(call.args[0].dispatchId, attempt.dispatchId);
        assert.equal(call.args.length, 1);
        continue;
      }
      assert.equal(call.args[0], attempt.dispatchId);
      assert.equal(call.args.length, 1);
    }
    assert.equal(Object.hasOwn(result, 'sourceTaskId'), false);
    assert.equal(Object.hasOwn(result, 'workerId'), false);
    assert.equal(Object.hasOwn(result, 'admissionId'), false);
    assert.equal(existsSync(join(home, 'tasks')), true);
    assert.equal(existsSync(attemptDir(home)), true);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// Q. EXPLICIT HEARTBEAT: persist != invoke/start/ACK; no status transition.
// ---------------------------------------------------------------------------

test('Q. persistence is not invocation/ACK/execution: no status transition and no execution authority', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-executor-invocation-attempt28-q-',
    'EIA28-Q-SRC',
    'EIA28-Q-CHILD',
  );
  try {
    const taskBefore = store.readTask('EIA28-Q-CHILD');
    const taskBytesBefore = readFileSync(join(home, 'tasks', 'EIA28-Q-CHILD', 'task.json'), 'utf8');
    const homeBytesBefore = snapshotHomeBytes(home);
    await persistExecutorInvocationAttempt({ dispatchId: attempt.dispatchId, store });
    const taskAfter = store.readTask('EIA28-Q-CHILD');
    assert.equal(taskAfter.status, taskBefore.status);
    assert.equal(taskAfter.status, TASK_STATUS_CLAIMED);
    assert.equal(
      readFileSync(join(home, 'tasks', 'EIA28-Q-CHILD', 'task.json'), 'utf8'),
      taskBytesBefore,
    );

    // Persistence adds no ACK/receipt/execution artifact and the only new
    // durable path is the invocation-attempt record.
    const homeBytesAfter = snapshotHomeBytes(home);
    const added = Object.keys(homeBytesAfter).filter((name) => !(name in homeBytesBefore));
    assert.equal(added.length, 1, JSON.stringify(added));
    assert.ok(added[0].includes(EXECUTOR_INVOCATION_ATTEMPTS_DIRNAME));
    const attemptBytes = readFileSync(attemptPath(home, attempt.dispatchId), 'utf8');
    for (const token of [
      'executionStarted',
      'executionAllowed',
      'executorInvoked',
      'executorStarted',
      'invokedAt',
      'startedAt',
      'attemptedAt',
      'acknowledgedAt',
      'receivedAt',
    ]) {
      assert.equal(attemptBytes.includes(token), false, token);
    }
    assert.equal(store.readClaim('EIA28-Q-CHILD').generation, 1);
  } finally {
    removeHome(home);
  }
});
