// Proof for GREENHUB-COORDINATION-RECEIVER-IDEMPOTENCY-ACCEPTANCE-READ-CONTRACT-21.
//
// read != accept != ACK != persist != dispatch != execute.
// The receiver asks exactly one READ-ONLY question about ONE validated Task 20
// transport request, keyed ONLY by request.dispatchId:
//   - fresh key        -> { dispatchId, previouslyObserved: false }
//   - exact same input -> { dispatchId, previouslyObserved: true, exactReplay: true }
//   - same key + other -> fail closed (RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT)
//
// Explicitly NOT implemented here (and asserted absent):
//   receiver persistence / receiver-attempt.json / receiver-ack.json /
//   acceptance.json / dispatch-receipt.json, ACK protocol, ACK persistence,
//   acknowledgeDispatch, ackDispatch, accepted persistence, receiver acceptance
//   writer, writeAcceptedDispatch, persistAcceptedDispatch, DISPATCHED /
//   EXECUTOR_ACCEPTED / ACCEPTED / RECEIVED / EXECUTING status, any new task
//   status, retry, resend, backoff, retry counter/policy, transportGeneration /
//   sendGeneration / attemptGeneration / retryGeneration / deliveryGeneration /
//   receiverGeneration / acceptanceGeneration (any new generation authority),
//   scheduler, READY scan, queue scan, polling, daemon, cron, worker selection,
//   worker registry, capability matching, adapter selection, HTTP, WebSocket,
//   MCP, stdin/stdout concrete protocol, fetch, grpc, mqtt, child_process,
//   spawn, exec, OpenCode/Codex/Astra/ChatGPT invocation, executor invocation,
//   task/claim/admission/emission/result mutation.
//
// All runtime state lives in isolated temp directories. No network required.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveCoordinationHome } from './coordination-home.mjs';
import * as receiverReadModule from './dispatch-receiver-idempotency-read.mjs';
import {
  DispatchReceiverIdempotencyReadError,
  INVALID_RECEIVER_ACCEPTANCE_READER,
  RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT,
  RECEIVER_READ_REPLAY_FIELDS,
  RECEIVER_READ_UNSEEN_FIELDS,
  readReceiverDispatchAcceptance,
} from './dispatch-receiver-idempotency-read.mjs';
import {
  CORRUPT_TRANSPORT_REQUEST,
  prepareDispatchTransportRequest,
  validateTransportRequest,
} from './dispatch-transport-contract.mjs';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import { CoordinationStore } from './store.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = join(MODULE_DIRECTORY, 'dispatch-receiver-idempotency-read.mjs');

function makeHome(prefix = 'greenhub-receiver-read21-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'RECEIVER_IDEMPOTENCY_READ_PROVED',
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
    proofRequirement: ['receiver-idempotency-read-proof'],
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

// Task 20 friction lesson: boundary greps must inspect functional code only.
// Header/line comments legitimately document forbidden names as prohibitions.
function codeOnly(source) {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    })
    .join('\n');
}

function deliveredChildPath(home, taskId) {
  return join(home, 'tasks', taskId, 'task.json');
}

// ---------------------------------------------------------------------------
// A. FRESH KEY
// ---------------------------------------------------------------------------

test('A. fresh key: reader gets only dispatchId, yields an unseen observation, zero mutation', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE21-A-SRC',
      'DE21-A-CHILD',
      'result-de21-a-src',
    );
    const request = prepareRequest(store, 'DE21-A-SRC', attempt.dispatchId);
    const before = snapshotHomeBytes(home);
    let calls = 0;
    const seenKeys = [];
    const result = await readReceiverDispatchAcceptance({
      request,
      reader: (key) => {
        calls += 1;
        seenKeys.push(key);
        return null;
      },
    });
    assert.deepEqual(result, { dispatchId: attempt.dispatchId, previouslyObserved: false });
    assert.deepEqual(Object.keys(result), [...RECEIVER_READ_UNSEEN_FIELDS]);
    assert.ok(Object.isFrozen(result));
    assert.equal(calls, 1);
    assert.deepEqual(seenKeys, [attempt.dispatchId]);
    assert.equal('exactReplay' in result, false);
    assert.deepEqual(snapshotHomeBytes(home), before);
    // An async reader resolving undefined also means unseen.
    const asyncResult = await readReceiverDispatchAcceptance({
      request,
      reader: async () => undefined,
    });
    assert.deepEqual(asyncResult, { dispatchId: attempt.dispatchId, previouslyObserved: false });
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// B. EXACT REPLAY
// ---------------------------------------------------------------------------

test('B. exact replay: same validated request under the same key is an idempotent observation, zero mutation', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE21-B-SRC',
      'DE21-B-CHILD',
      'result-de21-b-src',
    );
    const request = prepareRequest(store, 'DE21-B-SRC', attempt.dispatchId);
    const before = snapshotHomeBytes(home);
    let calls = 0;
    const clone = JSON.parse(JSON.stringify(request));
    const result = await readReceiverDispatchAcceptance({
      request,
      reader: () => {
        calls += 1;
        return clone;
      },
    });
    assert.deepEqual(result, {
      dispatchId: attempt.dispatchId,
      previouslyObserved: true,
      exactReplay: true,
    });
    assert.deepEqual(Object.keys(result), [...RECEIVER_READ_REPLAY_FIELDS]);
    assert.ok(Object.isFrozen(result));
    assert.equal(calls, 1);
    assert.deepEqual(snapshotHomeBytes(home), before);
    // A reader returning the still-validated incoming object replays identically.
    const again = await readReceiverDispatchAcceptance({ request: clone, reader: () => request });
    assert.deepEqual(again, result);
    assert.equal(JSON.stringify(again), JSON.stringify(result));
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// C. SAME DISPATCH ID / DIFFERENT REQUEST
// ---------------------------------------------------------------------------

test('C. same dispatchId with a different valid request fails closed as a receiver idempotency conflict', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE21-C-SRC',
      'DE21-C-CHILD',
      'result-de21-c-src',
    );
    const request = prepareRequest(store, 'DE21-C-SRC', attempt.dispatchId);
    // Different provenance, same identity key: still a valid Task 20 request.
    const different = { ...request, sourceTaskId: 'DE21-C-OTHER' };
    assert.equal(validateTransportRequest(different).dispatchId, request.dispatchId);
    const before = snapshotHomeBytes(home);
    let calls = 0;
    await assert.rejects(
      readReceiverDispatchAcceptance({
        request,
        reader: () => {
          calls += 1;
          return different;
        },
      }),
      (error) => error?.code === RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT,
    );
    assert.equal(calls, 1);
    // Reverse direction conflicts too (incoming is never preferred).
    let reverseCalls = 0;
    await assert.rejects(
      readReceiverDispatchAcceptance({
        request: different,
        reader: () => {
          reverseCalls += 1;
          return request;
        },
      }),
      (error) => error?.code === RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT,
    );
    assert.equal(reverseCalls, 1);
    assert.deepEqual(snapshotHomeBytes(home), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// D. MALFORMED INCOMING
// ---------------------------------------------------------------------------

test('D. malformed incoming request fails closed before any reader invocation', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE21-D-SRC',
      'DE21-D-CHILD',
      'result-de21-d-src',
    );
    const request = prepareRequest(store, 'DE21-D-SRC', attempt.dispatchId);
    let calls = 0;
    const reader = () => {
      calls += 1;
      return null;
    };
    await assert.rejects(
      readReceiverDispatchAcceptance({ request: { ...request, transportGeneration: 1 }, reader }),
      (error) => error?.code === CORRUPT_TRANSPORT_REQUEST,
    );
    await assert.rejects(
      readReceiverDispatchAcceptance({ request: { ...request, workerId: '' }, reader }),
      (error) => error != null,
    );
    await assert.rejects(
      readReceiverDispatchAcceptance({ request: null, reader }),
      (error) => error != null,
    );
    await assert.rejects(readReceiverDispatchAcceptance({ reader }), (error) => error != null);
    assert.equal(calls, 0);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. MALFORMED OBSERVED REQUEST
// ---------------------------------------------------------------------------

test('E. corrupt observed request fails closed with zero mutation', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE21-E-SRC',
      'DE21-E-CHILD',
      'result-de21-e-src',
    );
    const request = prepareRequest(store, 'DE21-E-SRC', attempt.dispatchId);
    const before = snapshotHomeBytes(home);
    await assert.rejects(
      readReceiverDispatchAcceptance({
        request,
        reader: () => ({ ...request, task: { broken: true } }),
      }),
      (error) => error != null,
    );
    await assert.rejects(
      readReceiverDispatchAcceptance({ request, reader: () => 'not-a-request' }),
      (error) => error?.code === CORRUPT_TRANSPORT_REQUEST,
    );
    assert.deepEqual(snapshotHomeBytes(home), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. WRONG OBSERVED DISPATCH ID
// ---------------------------------------------------------------------------

test('F. reader returning a valid request under a different dispatchId fails closed', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt: first } = driveToAttempt(
      store,
      clock,
      'DE21-F-SRC1',
      'DE21-F-CHILD1',
      'result-de21-f1',
    );
    const { attempt: second } = driveToAttempt(
      store,
      clock,
      'DE21-F-SRC2',
      'DE21-F-CHILD2',
      'result-de21-f2',
    );
    const request1 = prepareRequest(store, 'DE21-F-SRC1', first.dispatchId);
    const request2 = prepareRequest(store, 'DE21-F-SRC2', second.dispatchId);
    assert.notEqual(request1.dispatchId, request2.dispatchId);
    const before = snapshotHomeBytes(home);
    let calls = 0;
    await assert.rejects(
      readReceiverDispatchAcceptance({
        request: request1,
        reader: () => {
          calls += 1;
          return request2;
        },
      }),
      (error) => error?.code === RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT,
    );
    assert.equal(calls, 1);
    assert.deepEqual(snapshotHomeBytes(home), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// G. TERMINAL / NOT-CLAIMED INPUT
// ---------------------------------------------------------------------------

test('G. terminal / not-claimed inputs cannot bypass Task 20 validation through receiver read', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE21-G-SRC',
      'DE21-G-CHILD',
      'result-de21-g-src',
    );
    const request = prepareRequest(store, 'DE21-G-SRC', attempt.dispatchId);
    let calls = 0;
    const reader = () => {
      calls += 1;
      return null;
    };
    await assert.rejects(
      readReceiverDispatchAcceptance({
        request: { ...request, task: { ...request.task, status: 'READY' } },
        reader,
      }),
      (error) => error?.code === 'TASK_NOT_CLAIMED',
    );
    await assert.rejects(
      readReceiverDispatchAcceptance({
        request: { ...request, task: { ...request.task, status: 'RESULT_DELIVERED' } },
        reader,
      }),
      (error) => error?.code === 'TASK_TERMINAL',
    );
    assert.equal(calls, 0);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// H. READER VALIDATION
// ---------------------------------------------------------------------------

test('H. invalid readers are rejected and never invoked', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE21-H-SRC',
      'DE21-H-CHILD',
      'result-de21-h-src',
    );
    const request = prepareRequest(store, 'DE21-H-SRC', attempt.dispatchId);
    for (const bad of [
      undefined,
      null,
      'worker-a',
      42,
      {},
      { read: () => null },
      [() => null],
      true,
    ]) {
      await assert.rejects(
        readReceiverDispatchAcceptance({ request, reader: bad }),
        (error) => error?.code === INVALID_RECEIVER_ACCEPTANCE_READER,
      );
    }
    // A valid caller-supplied function is the only accepted reader.
    let calls = 0;
    const out = await readReceiverDispatchAcceptance({
      request,
      reader: () => {
        calls += 1;
        return null;
      },
    });
    assert.equal(calls, 1);
    assert.equal(out.previouslyObserved, false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// I. ONE READ PER CALL
// ---------------------------------------------------------------------------

test('I. reader is invoked at most once per call for sync, async, replay, and conflict paths', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE21-I-SRC',
      'DE21-I-CHILD',
      'result-de21-i-src',
    );
    const request = prepareRequest(store, 'DE21-I-SRC', attempt.dispatchId);
    let syncCalls = 0;
    await readReceiverDispatchAcceptance({
      request,
      reader: () => {
        syncCalls += 1;
        return null;
      },
    });
    assert.equal(syncCalls, 1);
    let asyncCalls = 0;
    await readReceiverDispatchAcceptance({
      request,
      reader: async () => {
        asyncCalls += 1;
        return null;
      },
    });
    assert.equal(asyncCalls, 1);
    let replayCalls = 0;
    const replay = await readReceiverDispatchAcceptance({
      request,
      reader: async () => {
        replayCalls += 1;
        return JSON.parse(JSON.stringify(request));
      },
    });
    assert.equal(replayCalls, 1);
    assert.equal(replay.exactReplay, true);
    let conflictCalls = 0;
    await assert.rejects(
      readReceiverDispatchAcceptance({
        request,
        reader: async () => {
          conflictCalls += 1;
          return { ...request, sourceTaskId: 'DE21-I-OTHER' };
        },
      }),
      (error) => error?.code === RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT,
    );
    assert.equal(conflictCalls, 1);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// J. READER FAILURE PROPAGATION
// ---------------------------------------------------------------------------

test('J. reader throw/reject propagates unchanged with one call, no retry, zero mutation', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE21-J-SRC',
      'DE21-J-CHILD',
      'result-de21-j-src',
    );
    const request = prepareRequest(store, 'DE21-J-SRC', attempt.dispatchId);
    const before = snapshotHomeBytes(home);
    let syncCalls = 0;
    await assert.rejects(
      readReceiverDispatchAcceptance({
        request,
        reader: () => {
          syncCalls += 1;
          throw new Error('fake-reader-down');
        },
      }),
      (error) => /fake-reader-down/.test(String(error?.message)),
    );
    assert.equal(syncCalls, 1);
    const marker = new Error('fake-reader-reject');
    let asyncCalls = 0;
    await assert.rejects(
      readReceiverDispatchAcceptance({
        request,
        reader: async () => {
          asyncCalls += 1;
          throw marker;
        },
      }),
      (error) => error === marker,
    );
    assert.equal(asyncCalls, 1);
    assert.deepEqual(snapshotHomeBytes(home), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// K. DETERMINISM
// ---------------------------------------------------------------------------

test('K. identical request + reader result are deterministic under clock skew', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE21-K-SRC',
      'DE21-K-CHILD',
      'result-de21-k-src',
    );
    const request = prepareRequest(store, 'DE21-K-SRC', attempt.dispatchId);
    const reader = () => JSON.parse(JSON.stringify(request));
    const first = await readReceiverDispatchAcceptance({ request, reader });
    clock.advance(365 * 86_400_000);
    const second = await readReceiverDispatchAcceptance({ request, reader });
    clock.advance(-2 * 365 * 86_400_000);
    const third = await readReceiverDispatchAcceptance({ request, reader });
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.equal(JSON.stringify(second), JSON.stringify(third));
    assert.deepEqual(first, third);
    const unseenReader = () => null;
    const unseenFirst = await readReceiverDispatchAcceptance({ request, reader: unseenReader });
    clock.advance(10 * 86_400_000);
    const unseenSecond = await readReceiverDispatchAcceptance({ request, reader: unseenReader });
    assert.equal(JSON.stringify(unseenFirst), JSON.stringify(unseenSecond));
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// L. FROZEN RESULT
// ---------------------------------------------------------------------------

test('L. read observations are immutable/frozen', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE21-L-SRC',
      'DE21-L-CHILD',
      'result-de21-l-src',
    );
    const request = prepareRequest(store, 'DE21-L-SRC', attempt.dispatchId);
    const unseen = await readReceiverDispatchAcceptance({ request, reader: () => null });
    const replay = await readReceiverDispatchAcceptance({
      request,
      reader: () => JSON.parse(JSON.stringify(request)),
    });
    for (const result of [unseen, replay]) {
      assert.ok(Object.isFrozen(result));
      assert.throws(() => {
        result.previouslyObserved = 'mutated';
      }, TypeError);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// M. NO DURABLE MUTATION
// ---------------------------------------------------------------------------

test('M. no durable mutation: task/claim/attempt bytes unchanged and no receiver/ack/receipt files', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE21-M-SRC',
      'DE21-M-CHILD',
      'result-de21-m-src',
    );
    const request = prepareRequest(store, 'DE21-M-SRC', attempt.dispatchId);
    const before = snapshotHomeBytes(home);
    const childTaskPath = deliveredChildPath(home, 'DE21-M-CHILD');
    const claimFile = join(home, 'tasks', 'DE21-M-CHILD', 'claim.json');
    const attemptFile = join(
      home,
      'tasks',
      'DE21-M-SRC',
      'dispatch-attempts',
      `${attempt.dispatchId}.json`,
    );
    const beforeTask = readFileSync(childTaskPath, 'utf8');
    const beforeClaim = readFileSync(claimFile, 'utf8');
    const beforeAttempt = readFileSync(attemptFile, 'utf8');
    await readReceiverDispatchAcceptance({ request, reader: () => null });
    await readReceiverDispatchAcceptance({
      request,
      reader: () => JSON.parse(JSON.stringify(request)),
    });
    await assert.rejects(
      readReceiverDispatchAcceptance({
        request,
        reader: () => ({ ...request, sourceTaskId: 'DE21-M-OTHER' }),
      }),
      (error) => error?.code === RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT,
    );
    const after = snapshotHomeBytes(home);
    assert.deepEqual(after, before);
    assert.equal(readFileSync(childTaskPath, 'utf8'), beforeTask);
    assert.equal(readFileSync(claimFile, 'utf8'), beforeClaim);
    assert.equal(readFileSync(attemptFile, 'utf8'), beforeAttempt);
    for (const name of Object.keys(after)) {
      if (name in before) continue;
      assert.equal(
        /receiver|ack|acceptance|receipt/i.test(name),
        false,
        `new file ${name} must not exist`,
      );
    }
    assert.equal(existsSync(join(home, 'tasks', 'DE21-M-CHILD', 'ack.json')), false);
    assert.equal(existsSync(join(home, 'tasks', 'DE21-M-CHILD', 'receiver-attempt.json')), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// N. NO NETWORK / CONCRETE TRANSPORT (source boundary, code only)
// ---------------------------------------------------------------------------

test('N. production module has no concrete transport / network / executor path', () => {
  const code = codeOnly(readFileSync(MODULE_PATH, 'utf8'));
  for (const forbidden of [
    "from 'node:fs'",
    "from 'node:child_process'",
    "from 'node:net'",
    "from 'node:http'",
    "from 'node:https'",
    'node:child_process',
    'writeFileSync',
    'mkdirSync',
    'spawn(',
    'exec(',
    'fetch(',
    'WebSocket(',
    'new WebSocket',
    'XMLHttpRequest',
    'http.request(',
    'https.request(',
    'grpc.',
    'mqtt.',
  ]) {
    assert.equal(code.includes(forbidden), false, `code must not contain ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// O. NO ACK / STATUS / RETRY / GENERATION / SCHEDULER / WORKER AUTHORITY
// ---------------------------------------------------------------------------

test('O. no ACK / new status / retry / new generation / scheduler / worker selector authority exists', () => {
  const code = codeOnly(readFileSync(MODULE_PATH, 'utf8'));
  for (const forbidden of [
    'acknowledgeDispatch',
    'ackDispatch',
    'writeAcceptedDispatch',
    'persistAcceptedDispatch',
    'writeFileSync',
    'createAccepted',
    'receiverAttempt',
    'receiverAck',
    'retryDispatch',
    'backoffDispatch',
    'resendDispatch',
    'retryCount',
    'backoff',
    'resend',
    'transportGeneration',
    'sendGeneration',
    'attemptGeneration',
    'retryGeneration',
    'deliveryGeneration',
    'receiverGeneration',
    'acceptanceGeneration',
    'scheduleNextTask',
    'runScheduler',
    'selectWorker',
    'selectExecutor',
    'workerRegistry',
    'adapterRegistry',
  ]) {
    assert.equal(code.includes(forbidden), false, `${forbidden} must not exist in code`);
  }
  for (const status of [
    "'DISPATCHED'",
    '"DISPATCHED"',
    "'EXECUTOR_ACCEPTED'",
    '"EXECUTOR_ACCEPTED"',
    "'ACCEPTED'",
    "'RECEIVED'",
    "'EXECUTING'",
    'TASK_STATUS_DISPATCHED',
    'TASK_STATUS_ACCEPTED',
  ]) {
    assert.equal(code.includes(status), false, `${status} must not exist in code`);
  }
  // No internal registry / mutable lookup state.
  for (const forbidden of [
    'new Map(',
    'new Set(',
    'new WeakMap',
    'new WeakSet',
    '.set(',
    '.push(',
  ]) {
    assert.equal(code.includes(forbidden), false, `code must not contain ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// P. NO DIRECT BYPASS
// ---------------------------------------------------------------------------

test('P. no claim/taskId/workerId/admissionId/envelope-only entry can bypass a validated Task 20 request', () => {
  const code = codeOnly(readFileSync(MODULE_PATH, 'utf8'));
  for (const forbidden of [
    'readFromClaim',
    'readFromEnvelope',
    'readByTaskId',
    'readByWorkerId',
    'readByAdmissionId',
    'readByEnvelope',
    'dispatchIdOnly',
    'acceptByDispatchId',
    'acceptDispatch',
    'acknowledge(',
    'persistAccepted',
  ]) {
    assert.equal(code.includes(forbidden), false, `${forbidden} must not exist`);
  }
  // The read boundary composes the existing Task 20 validator: a validated
  // request is mandatory.
  assert.ok(code.includes('validateTransportRequest('));
  // Only the read boundary and the error class are exported functions.
  const exportedFunctions = Object.entries(receiverReadModule)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(exportedFunctions, [
    'DispatchReceiverIdempotencyReadError',
    'readReceiverDispatchAcceptance',
  ]);
  assert.equal(typeof DispatchReceiverIdempotencyReadError, 'function');
});

// ---------------------------------------------------------------------------
// BOUNDARY21. MINIMAL READ OBSERVATION FIELDS
// ---------------------------------------------------------------------------

test('BOUNDARY21. read observation fields are minimal and free of transport/clock/ACK metadata', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE21-BND-SRC',
      'DE21-BND-CHILD',
      'result-de21-bnd-src',
    );
    const request = prepareRequest(store, 'DE21-BND-SRC', attempt.dispatchId);
    const unseen = await readReceiverDispatchAcceptance({ request, reader: () => null });
    const replay = await readReceiverDispatchAcceptance({
      request,
      reader: () => JSON.parse(JSON.stringify(request)),
    });
    assert.deepEqual(Object.keys(unseen), [...RECEIVER_READ_UNSEEN_FIELDS]);
    assert.deepEqual(Object.keys(replay), [...RECEIVER_READ_REPLAY_FIELDS]);
    for (const result of [unseen, replay]) {
      for (const excluded of [
        'timestamp',
        'createdAt',
        'updatedAt',
        'ack',
        'acknowledged',
        'accepted',
        'executing',
        'received',
        'status',
        'retry',
        'retryCount',
        'generation',
        'transportGeneration',
        'acceptedPersistence',
        'endpoint',
        'adapter',
        'pid',
        'hostname',
        'random',
        'uuid',
        'transport',
      ]) {
        assert.equal(excluded in result, false, `${excluded} must not be in read result`);
      }
    }
    // Repository isolation: temp home only.
    assert.ok(home.startsWith(tmpdir()));
    void resolveCoordinationHome;
    void writeFileSync;
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// Q. COMPOSED REGRESSION SMOKE
// ---------------------------------------------------------------------------

test('Q. composed with Task 20 prepare/validate only: no bypass entry and no mutation', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE21-Q-SRC',
      'DE21-Q-CHILD',
      'result-de21-q-src',
    );
    const request = prepareRequest(store, 'DE21-Q-SRC', attempt.dispatchId);
    assert.deepEqual(validateTransportRequest(request), request);
    const before = snapshotHomeBytes(home);
    const result = await readReceiverDispatchAcceptance({ request, reader: () => request });
    assert.deepEqual(result, {
      dispatchId: attempt.dispatchId,
      previouslyObserved: true,
      exactReplay: true,
    });
    assert.deepEqual(snapshotHomeBytes(home), before);
    // Instance shape proves the read boundary is async but side-effect free.
    assert.equal(typeof readReceiverDispatchAcceptance, 'function');
  } finally {
    removeHome(home);
  }
});
