// Proof for GREENHUB-COORDINATION-EXECUTOR-INVOCATION-INPUT-27
// (GF-02 direct composition revision).
//
// READABLE_EXECUTOR_INVOCATION_INPUT != executor invocation != executor
// acceptance != ACK != receipt != execution start != task status transition
// != scheduler decision != worker/executor selection != retry/resend authority
// != delivery success.
// read != invoke != accept != ACK != execute.
//
// The read entry is EXACTLY:
//   (dispatchId, store)
//     -> dispatchId identity validation (Task 22 receiver-acceptance identity
//        family; invalid identities fail closed as CORRUPT_EXECUTOR_INVOCATION_INPUT)
//     -> require store.readReceiverDispatchAcceptance ONLY
//     -> readReceiverDecisionInput({ dispatchId, store })  [Task 23 verbatim:
//        dispatchId-only durable receiver-acceptance read, Task 20
//        validateTransportRequest, direct dispatchId binding re-check]
//     -> null/undefined durable receiver acceptance:
//        RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND (read failure only; no write,
//        no auto-create, no durable receiver-decision / executor-acceptance
//        reconstruction)
//     -> buildExecutorInvocationInputRecord(request)  [deterministic canonical
//        record from the EXACT validated Task 20 request only]
//     -> frozen canonical record
//        { schemaVersion, dispatchId, decision, decisionInput }, no wrapper
//        metadata.
//
// The durable authority remains <home>/receiver-acceptances/<dispatchId>.json
// (Task 22). There is NO receiver-decision / executor-acceptance durable
// family: Task 27 creates no new durable artifact and modifies no store
// primitive.
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
import * as invocationInputModule from './dispatch-executor-invocation-input.mjs';
import {
  buildExecutorInvocationInputRecord,
  CORRUPT_EXECUTOR_INVOCATION_INPUT,
  EXECUTOR_INVOCATION_INPUT_DECISION_VALUE,
  EXECUTOR_INVOCATION_INPUT_RECORD_FIELDS,
  EXECUTOR_INVOCATION_INPUT_SCHEMA_VERSION,
  ExecutorInvocationInputError,
  INVALID_EXECUTOR_INVOCATION_INPUT_STORE,
  readExecutorInvocationInput,
  validateExecutorInvocationInputRecord,
} from './dispatch-executor-invocation-input.mjs';
import {
  acceptReceiverDispatch,
  CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
  RECEIVER_ACCEPTANCES_DIRNAME,
  receiverDispatchAcceptanceFilePath,
} from './dispatch-receiver-acceptance.mjs';
import {
  RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND,
  ReceiverDecisionInputError,
} from './dispatch-receiver-decision-input.mjs';
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

// Task 18~23 predecessor source/spec bytes are pinned to the exact live-main
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

// GF-02 direct composition setup: source -> child claim -> durable dispatch
// attempt -> Task 20 request -> Task 22 durable receiver acceptance. The
// durable receiver acceptance IS the Task 27 predecessor; there is NO
// receiver-decision / executor-acceptance durable family.
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
  return { home, clock, store, attempt, request };
}

// Durable dispatch attempt exists but NO receiver acceptance at all.
async function setupAttemptOnly(prefix, sourceTaskId, childTaskId) {
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

// The production module's BLOCKED_EXECUTOR_INVOCATION_INPUT_FIELDS declaration
// enumerates forbidden authority names as DATA: their presence is the explicit
// exclusion contract, not smuggled authority. Strip exactly that declaration
// before the authority-token scan so the scan keeps guarding functional code;
// the blocked-field contract itself is proven through the exported validator.
const BLOCKED_FIELDS_DECLARATION =
  /export const BLOCKED_EXECUTOR_INVOCATION_INPUT_FIELDS = Object\.freeze\(\[[\s\S]*?\]\);/;

function authorityCode(source) {
  return codeOnly(source).replace(BLOCKED_FIELDS_DECLARATION, '');
}

function receiverAcceptancePath(home, dispatchId) {
  return receiverDispatchAcceptanceFilePath(home, dispatchId);
}

function listReceiverAcceptanceFiles(home) {
  try {
    return [...readdirSync(join(home, RECEIVER_ACCEPTANCES_DIRNAME))].sort();
  } catch {
    return [];
  }
}

function countingStore(reader) {
  const calls = [];
  return {
    calls,
    store: {
      readReceiverDispatchAcceptance: (dispatchId, ...rest) => {
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
// A. HAPPY PATH: one durable receiver acceptance -> exact frozen canonical
// invocation input record.
// ---------------------------------------------------------------------------

test('A. durable receiver acceptance reads as the exact frozen canonical invocation input record with dispatchId-only at-most-once lookup', async () => {
  const { home, store, attempt, request } = await setupAccepted(
    'greenhub-executor-invocation-input27-a-',
    'EII27-A-SRC',
    'EII27-A-CHILD',
  );
  try {
    const durableBytes = readFileSync(receiverAcceptancePath(home, attempt.dispatchId), 'utf8');
    const expected = buildExecutorInvocationInputRecord(request);
    const before = snapshotHomeBytes(home);
    const { calls, store: spyStore } = countingStore((dispatchId) =>
      store.readReceiverDispatchAcceptance(dispatchId),
    );

    const result = await readExecutorInvocationInput({
      dispatchId: attempt.dispatchId,
      store: spyStore,
    });

    // The returned value is the EXACT canonical record built from the durable
    // receiver-acceptance request: no wrapper metadata, fixed key order,
    // frozen.
    assert.deepEqual(result, expected);
    assert.deepEqual(result, buildExecutorInvocationInputRecord(request));
    assert.equal(JSON.stringify(result), JSON.stringify(expected));
    assert.deepEqual(Object.keys(result), [...EXECUTOR_INVOCATION_INPUT_RECORD_FIELDS]);
    assert.deepEqual(Object.keys(result), [
      'schemaVersion',
      'dispatchId',
      'decision',
      'decisionInput',
    ]);
    assert.equal(result.schemaVersion, EXECUTOR_INVOCATION_INPUT_SCHEMA_VERSION);
    assert.equal(result.dispatchId, attempt.dispatchId);
    assert.equal(result.decision, EXECUTOR_INVOCATION_INPUT_DECISION_VALUE);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.decisionInput));
    assert.deepEqual(validateTransportRequest(result.decisionInput), request);

    // The returned record serializes to the exact durable receiver-acceptance
    // bytes: Task 22 persists the exact validated Task 20 request.
    assert.equal(JSON.stringify(result.decisionInput, null, 2), durableBytes);
    assert.deepEqual(JSON.parse(durableBytes), request);
    assert.equal(JSON.stringify(result.decisionInput), JSON.stringify(request));

    // dispatchId ONLY, exactly one argument, at most once.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].dispatchId, attempt.dispatchId);
    assert.deepEqual(calls[0].rest, []);

    // No mutation anywhere: every durable byte is identical, no new file.
    const after = snapshotHomeBytes(home);
    assert.deepEqual(after, before);
    assert.deepEqual(listReceiverAcceptanceFiles(home), [`${attempt.dispatchId}.json`]);
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
    assert.equal(calls[0].op, 'readReceiverDispatchAcceptance');
    assert.deepEqual(calls[0].args, [attempt.dispatchId]);

    // No alternate store capability was even consulted (no task/claim/
    // admission/emission/dispatch-attempt/receiver-decision/executor-acceptance/
    // invocation-attempt/result/ACK/scheduler read).
    const consulted = [...new Set(reads)];
    assert.deepEqual(consulted, ['readReceiverDispatchAcceptance']);

    // Invalid identities fail closed BEFORE any store property access or
    // reader invocation with the Task 27 identity-family code.
    const {
      reads: invalidReads,
      calls: invalidCalls,
      store: invalidSpy,
    } = proxyCountingStore({
      readReceiverDispatchAcceptance: () => {
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
        (error) => error?.code === CORRUPT_EXECUTOR_INVOCATION_INPUT,
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
// C. MISSING PREDECESSOR: explicit read failure with zero write / auto-create.
// ---------------------------------------------------------------------------

test('C. missing durable receiver acceptance is RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND with zero write and no auto-create', async () => {
  const { home, store, attempt } = await setupAttemptOnly(
    'greenhub-executor-invocation-input27-c-',
    'EII27-C-SRC',
    'EII27-C-CHILD',
  );
  try {
    // The durable dispatch attempt exists, but the Task 22 durable receiver
    // acceptance predecessor does not.
    assert.equal(store.readReceiverDispatchAcceptance(attempt.dispatchId), null);
    assert.equal(existsSync(receiverAcceptancePath(home, attempt.dispatchId)), false);

    const before = snapshotHomeBytes(home);
    const { calls, store: spyStore } = countingStore((dispatchId) =>
      store.readReceiverDispatchAcceptance(dispatchId),
    );

    await assert.rejects(
      readExecutorInvocationInput({ dispatchId: attempt.dispatchId, store: spyStore }),
      (error) =>
        error instanceof ReceiverDecisionInputError &&
        error.code === RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND,
    );

    // The read happened exactly once with dispatchId only and caused zero
    // write, zero auto-create, zero receiver-decision / executor-acceptance
    // reconstruction, zero task mutation.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].dispatchId, attempt.dispatchId);
    assert.deepEqual(calls[0].rest, []);
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.equal(existsSync(receiverAcceptancePath(home, attempt.dispatchId)), false);
    assert.equal(store.readReceiverDispatchAcceptance(attempt.dispatchId), null);
    assert.equal(store.readTask('EII27-C-CHILD').status, TASK_STATUS_CLAIMED);

    // A dispatchId with only a durable dispatch attempt (no receiver
    // acceptance) is the same single read failure meaning: Task 27 never
    // reconstructs the retired receiver-decision / executor-acceptance durable
    // families.
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
      (error) =>
        error instanceof ReceiverDecisionInputError &&
        error.code === RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND,
    );
    assert.equal(existsSync(receiverAcceptancePath(home, pending.attempt.dispatchId)), false);

    // null and undefined from a caller-supplied reader are the same single
    // read failure meaning.
    for (const missing of [null, undefined]) {
      const spy = countingStore(() => missing);
      await assert.rejects(
        readExecutorInvocationInput({ dispatchId: attempt.dispatchId, store: spy.store }),
        (error) =>
          error instanceof ReceiverDecisionInputError &&
          error.code === RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND,
      );
      assert.equal(spy.calls.length, 1);
    }
    assert.deepEqual(snapshotHomeBytes(home), beforeSecond);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// D. INVALID STORE: fails before the receiver-acceptance read, zero mutation.
// ---------------------------------------------------------------------------

test('D. store without readReceiverDispatchAcceptance fails before any read and mutates nothing', async () => {
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
      { readReceiverDispatchAcceptance: 7 },
      { readReceiverAcceptance: () => null },
      {
        readDispatchAttempt: () => {
          probeCalls += 1;
          return null;
        },
      },
      {
        readDispatchAttempt: () => {
          probeCalls += 1;
          return null;
        },
        readReceiverDispatchAcceptance: 'not-a-function',
        createReceiverDispatchAcceptance: () => ({ created: true }),
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
    // an invalid store still yields the Task 27 identity-family code.
    await assert.rejects(
      readExecutorInvocationInput({ dispatchId: 'not-a-dispatch-id', store: undefined }),
      (error) =>
        error instanceof ExecutorInvocationInputError &&
        error?.code === CORRUPT_EXECUTOR_INVOCATION_INPUT,
    );

    // No read, no write, no auto-create, no acceptance mutation.
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.deepEqual(listReceiverAcceptanceFiles(home), [`${attempt.dispatchId}.json`]);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. CORRUPTION: Task 22/20/18/19 semantics propagate fail-closed, no repair.
// ---------------------------------------------------------------------------

test('E. corrupt durable receiver acceptance fails closed with exact bytes preserved and no repair', async () => {
  const { home, store, attempt, request } = await setupAccepted(
    'greenhub-executor-invocation-input27-e-',
    'EII27-E-SRC',
    'EII27-E-CHILD',
  );
  try {
    const path = receiverAcceptancePath(home, attempt.dispatchId);
    const goodBytes = readFileSync(path, 'utf8');
    const goodRequest = validateTransportRequest(request);

    const variants = [
      {
        name: 'unparseable bytes',
        bytes: '{ not json',
        code: CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
      },
      {
        name: 'valid JSON wrong shape',
        bytes: JSON.stringify({ hello: 'not-a-transport-request' }, null, 2),
        code: CORRUPT_TRANSPORT_REQUEST,
      },
      {
        name: 'unsupported schemaVersion',
        bytes: JSON.stringify({ ...goodRequest, schemaVersion: '2' }, null, 2),
        code: CORRUPT_TRANSPORT_REQUEST,
      },
      {
        name: 'key order drift',
        bytes: JSON.stringify(
          {
            dispatchId: goodRequest.dispatchId,
            schemaVersion: goodRequest.schemaVersion,
            sourceTaskId: goodRequest.sourceTaskId,
            emissionSlot: goodRequest.emissionSlot,
            admissionId: goodRequest.admissionId,
            nextTaskId: goodRequest.nextTaskId,
            workerId: goodRequest.workerId,
            claimGeneration: goodRequest.claimGeneration,
            task: goodRequest.task,
          },
          null,
          2,
        ),
        code: CORRUPT_TRANSPORT_REQUEST,
      },
      {
        name: 'blocked timestamp field',
        bytes: JSON.stringify({ ...goodRequest, createdAt: 'now' }, null, 2),
        code: CORRUPT_TRANSPORT_REQUEST,
      },
      {
        name: 'smuggled generation field',
        bytes: JSON.stringify({ ...goodRequest, generation: 1 }, null, 2),
        code: CORRUPT_TRANSPORT_REQUEST,
      },
      {
        name: 'extra smuggled field',
        bytes: JSON.stringify({ ...goodRequest, invocationGeneration: 1 }, null, 2),
        code: CORRUPT_TRANSPORT_REQUEST,
      },
      {
        name: 'tampered binding (workerId)',
        bytes: JSON.stringify({ ...goodRequest, workerId: 'worker-tampered' }, null, 2),
        code: 'DISPATCH_BINDING_MISMATCH',
      },
      {
        name: 'not-claimed child',
        bytes: JSON.stringify(
          { ...goodRequest, task: { ...goodRequest.task, status: 'READY' } },
          null,
          2,
        ),
        code: 'TASK_NOT_CLAIMED',
      },
      {
        name: 'terminal child',
        bytes: JSON.stringify(
          { ...goodRequest, task: { ...goodRequest.task, status: 'RESULT_DELIVERED' } },
          null,
          2,
        ),
        code: 'TASK_TERMINAL',
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
        listReceiverAcceptanceFiles(home),
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

    // Caller-supplied stores bypass the store validator: the Task 23
    // derivation re-validates the raw request and still fails closed with the
    // same predecessor codes.
    const corruptFromCallerStore = [
      {
        record: { hello: 'not-a-transport-request' },
        code: CORRUPT_TRANSPORT_REQUEST,
      },
      {
        record: { ...goodRequest, schemaVersion: '2' },
        code: CORRUPT_TRANSPORT_REQUEST,
      },
      {
        record: { ...goodRequest, createdAt: 'now' },
        code: CORRUPT_TRANSPORT_REQUEST,
      },
      {
        record: { ...goodRequest, invocationGeneration: 1 },
        code: CORRUPT_TRANSPORT_REQUEST,
      },
      {
        record: { ...goodRequest, workerId: 'worker-tampered' },
        code: 'DISPATCH_BINDING_MISMATCH',
      },
    ];
    for (const { record, code } of corruptFromCallerStore) {
      await assert.rejects(
        readExecutorInvocationInput({
          dispatchId: attempt.dispatchId,
          store: { readReceiverDispatchAcceptance: () => record },
        }),
        (error) => error?.code === code,
      );
    }

    // Restoring the exact durable bytes re-enables the read.
    writeFileSync(path, goodBytes, 'utf8');
    const rebuilt = buildExecutorInvocationInputRecord(request);
    const restored = await readExecutorInvocationInput({
      dispatchId: attempt.dispatchId,
      store,
    });
    assert.deepEqual(restored, rebuilt);
    assert.equal(JSON.stringify(restored.decisionInput, null, 2), goodBytes);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. WRONG DISPATCH BINDING: caller-supplied/spy store cannot redirect.
// ---------------------------------------------------------------------------

test('F. a valid receiver acceptance for another dispatchId fails closed and never becomes the result', async () => {
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
    const foreign = second.store.readReceiverDispatchAcceptance(second.attempt.dispatchId);
    assert.ok(foreign);
    assert.notEqual(foreign.dispatchId, first.attempt.dispatchId);
    assert.deepEqual(validateTransportRequest(foreign), second.request);

    // Spy store returns a structurally valid receiver acceptance bound to a
    // different dispatchId: the Task 23 direct binding re-check fails closed.
    await assert.rejects(
      readExecutorInvocationInput({
        dispatchId: first.attempt.dispatchId,
        store: { readReceiverDispatchAcceptance: () => foreign },
      }),
      (error) =>
        error instanceof ReceiverDecisionInputError &&
        error.code === CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
    );

    // Fabricated canonical record whose own dispatchId claims the requested
    // identity but whose decisionInput is bound elsewhere: Task 27's record
    // validator rejects it, and the read path also rejects the fabricated
    // object as an invalid transport request, so it never becomes the result.
    const fabricated = {
      schemaVersion: EXECUTOR_INVOCATION_INPUT_SCHEMA_VERSION,
      dispatchId: first.attempt.dispatchId,
      decision: EXECUTOR_INVOCATION_INPUT_DECISION_VALUE,
      decisionInput: foreign,
    };
    assert.throws(
      () => validateExecutorInvocationInputRecord(fabricated),
      (error) =>
        error instanceof ExecutorInvocationInputError &&
        error.code === CORRUPT_EXECUTOR_INVOCATION_INPUT,
    );
    await assert.rejects(
      readExecutorInvocationInput({
        dispatchId: first.attempt.dispatchId,
        store: { readReceiverDispatchAcceptance: () => fabricated },
      }),
      (error) => error?.code === CORRUPT_TRANSPORT_REQUEST,
    );

    // The durable winner for the requested dispatchId is untouched.
    const winner = first.store.readReceiverDispatchAcceptance(first.attempt.dispatchId);
    assert.equal(winner.dispatchId, first.attempt.dispatchId);
    assert.equal(JSON.stringify(winner), JSON.stringify(first.request));
    assert.equal(existsSync(receiverAcceptancePath(first.home, first.attempt.dispatchId)), true);
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
    const built = buildExecutorInvocationInputRecord(request);
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

    // Exact canonical representation: the returned record serializes to the
    // built record and the durable receiver-acceptance bytes (no projection,
    // no normalization, no wrapper).
    assert.equal(JSON.stringify(result, null, 2), JSON.stringify(built, null, 2));
    assert.equal(JSON.stringify(result), JSON.stringify(built));
    assert.equal(
      JSON.stringify(result.decisionInput, null, 2),
      readFileSync(receiverAcceptancePath(home, attempt.dispatchId), 'utf8'),
    );
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
    assert.deepEqual(store.readReceiverDispatchAcceptance(attempt.dispatchId), request);
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
      JSON.stringify(store.readResultById('EII27-H-SRC', 'result-eii27-h-src')),
      resultBefore,
    );
    assert.equal(JSON.stringify(store.readCurrentDisposition('EII27-H-SRC')), dispositionBefore);
    assert.equal(existsSync(receiverAcceptancePath(home, dispatchId)), true);
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
  const authority = authorityCode(raw);
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
    assert.equal(authority.includes(forbidden), false, `code must not contain ${forbidden}`);
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

  // The read boundary gates on the Task 22 durable receiver-acceptance store
  // primitive and composes the Task 23 read derivation + the Task 27 record
  // builder/validator verbatim; it never touches the retired receiver-decision
  // or executor-acceptance store primitives or writers.
  assert.match(code, /store\.readReceiverDispatchAcceptance\s*!==\s*'function'/);
  assert.ok(code.includes('readReceiverDecisionInput('));
  assert.ok(code.includes('buildExecutorInvocationInputRecord('));
  assert.ok(code.includes('validateExecutorInvocationInputRecord('));
  assert.ok(code.includes('assertValidExecutorInvocationInputDispatchId('));
  assert.equal(code.includes('store.readReceiverDispatchDecision('), false);
  assert.equal(code.includes('store.readExecutorDispatchAcceptance('), false);
  assert.equal(code.includes('store.createExecutorDispatchAcceptance('), false);
  assert.equal(code.includes('node:path'), false);

  // Exported surface: the read entry + record builder/validator + identity
  // assertion + the single error class.
  const exportedFunctions = Object.entries(invocationInputModule)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(exportedFunctions, [
    'ExecutorInvocationInputError',
    'assertValidExecutorInvocationInputDispatchId',
    'buildExecutorInvocationInputRecord',
    'readExecutorInvocationInput',
    'validateExecutorInvocationInputRecord',
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
    // the Task 28 durable executor invocation attempt surface that precedes
    // this Task 27 read surface; this test keeps proving only that Task 27
    // adds no store primitive of its own and removes none of them.
    assert.equal(typeof store.readExecutorInvocationAttempt, 'function');
    assert.equal(typeof store.createExecutorInvocationAttempt, 'function');
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
// J. PREDECESSOR IMMUTABILITY: Task 18~23 source/spec bytes unchanged.
// ---------------------------------------------------------------------------

test('J. Task 18~23 predecessor source/spec bytes are unchanged', () => {
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
      assert.deepEqual(out.result, first);
    }
    assert.equal(first.decision, EXECUTOR_INVOCATION_INPUT_DECISION_VALUE);
    assert.equal(first.schemaVersion, EXECUTOR_INVOCATION_INPUT_SCHEMA_VERSION);
  } finally {
    removeHome(home);
  }
});
