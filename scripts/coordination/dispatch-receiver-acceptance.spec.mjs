// Proof for GREENHUB-COORDINATION-DURABLE-RECEIVER-ACCEPTANCE-22.
//
// RECEIVER ACCEPTANCE != ACK != sender acknowledgment != executor acceptance
// != execution start != task status transition != retry authority
// != delivery success.
// read != accept != ACK != execute.
//
// The acceptance entry is EXACTLY:
//   EXACT validated Task 20 transport request
//     -> Task 21 readReceiverDispatchAcceptance (dispatchId-only reader)
//     -> already observed exact request: idempotent replay, no write
//     -> unseen: OS exclusive-create of the EXACT request itself under
//        <home>/receiver-acceptances/<dispatchId>.json
//     -> durable read-back verification
//     -> race loser: winner re-read, same request = replay /
//        different valid request = RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT /
//        corrupt winner = fail closed (never overwrite).
// LOOKUP KEY = dispatchId ONLY. No wrapper metadata, no timestamps, no ACK,
// no new generation authority, no executor/scheduler/retry, no concrete
// transport. No task/claim/admission/emission/attempt/result mutation.
//
// All runtime state lives in isolated temp directories. No network required.

import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveCoordinationHome } from './coordination-home.mjs';
import * as receiverAcceptanceModule from './dispatch-receiver-acceptance.mjs';
import {
  acceptReceiverDispatch,
  CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
  DispatchReceiverAcceptanceError,
  INVALID_RECEIVER_ACCEPTANCE_STORE,
  RECEIVER_ACCEPTANCE_NEW_FIELDS,
  RECEIVER_ACCEPTANCE_REPLAY_FIELDS,
  RECEIVER_ACCEPTANCES_DIRNAME,
  receiverDispatchAcceptanceFilePath,
} from './dispatch-receiver-acceptance.mjs';
import {
  RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT,
  readReceiverDispatchAcceptance,
} from './dispatch-receiver-idempotency-read.mjs';
import {
  CORRUPT_TRANSPORT_REQUEST,
  prepareDispatchTransportRequest,
  validateTransportRequest,
} from './dispatch-transport-contract.mjs';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import { CoordinationStore } from './store.mjs';
import { TASK_STATUS_CLAIMED, TASK_STATUSES } from './task-envelope.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = join(MODULE_DIRECTORY, 'dispatch-receiver-acceptance.mjs');

function makeHome(prefix = 'greenhub-receiver-accept22-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'RECEIVER_ACCEPTANCE_PROVED',
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
    proofRequirement: ['receiver-acceptance-proof'],
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

function acceptanceDir(home) {
  return join(home, RECEIVER_ACCEPTANCES_DIRNAME);
}

function acceptancePath(home, dispatchId) {
  return receiverDispatchAcceptanceFilePath(home, dispatchId);
}

// ---------------------------------------------------------------------------
// A. FRESH ACCEPTANCE
// ---------------------------------------------------------------------------

test('A. fresh acceptance: exactly one exclusive durable create, exact read-back, zero unrelated mutation', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE22-A-SRC',
      'DE22-A-CHILD',
      'result-de22-a-src',
    );
    const request = prepareRequest(store, 'DE22-A-SRC', attempt.dispatchId);
    const path = acceptancePath(home, attempt.dispatchId);

    // Initial durable read = unseen (null), not an error.
    assert.equal(store.readReceiverDispatchAcceptance(attempt.dispatchId), null);

    const before = snapshotHomeBytes(home);
    const result = await acceptReceiverDispatch({ request, store });
    assert.deepEqual(result, { dispatchId: attempt.dispatchId, newlyAccepted: true });
    assert.deepEqual(Object.keys(result), [...RECEIVER_ACCEPTANCE_NEW_FIELDS]);
    assert.ok(Object.isFrozen(result));

    // Exactly one record at the dispatchId-only path, carrying the EXACT
    // validated Task 20 request itself (no wrapper metadata).
    assert.equal(existsSync(path), true);
    assert.deepEqual(readdirSync(acceptanceDir(home)), [`${attempt.dispatchId}.json`]);
    assert.equal(readFileSync(path, 'utf8'), JSON.stringify(request, null, 2));
    const reread = store.readReceiverDispatchAcceptance(attempt.dispatchId);
    assert.deepEqual(reread, request);
    assert.ok(Object.isFrozen(reread));
    assert.deepEqual(validateTransportRequest(reread), request);

    // Task 21 read semantics compose directly over the durable reader.
    const observation = await readReceiverDispatchAcceptance({
      request,
      reader: (key) => store.readReceiverDispatchAcceptance(key),
    });
    assert.deepEqual(observation, {
      dispatchId: attempt.dispatchId,
      previouslyObserved: true,
      exactReplay: true,
    });

    // Sequential exact replay: no rewrite, receiver-local replay outcome.
    const bytesAfterFirst = readFileSync(path, 'utf8');
    const replay = await acceptReceiverDispatch({ request, store });
    assert.deepEqual(replay, {
      dispatchId: attempt.dispatchId,
      newlyAccepted: false,
      exactReplay: true,
    });
    assert.deepEqual(Object.keys(replay), [...RECEIVER_ACCEPTANCE_REPLAY_FIELDS]);
    assert.ok(Object.isFrozen(replay));
    assert.equal(readFileSync(path, 'utf8'), bytesAfterFirst);

    // The ONLY added durable artifact is the acceptance record.
    const after = snapshotHomeBytes(home);
    for (const key of Object.keys(before)) {
      assert.equal(after[key], before[key], `${key} must stay byte-identical`);
    }
    const added = Object.keys(after).filter((key) => !(key in before));
    assert.deepEqual(added, [join(RECEIVER_ACCEPTANCES_DIRNAME, `${attempt.dispatchId}.json`)]);

    // No ACK / status transition / receipt on the child.
    assert.equal(existsSync(join(home, 'tasks', 'DE22-A-CHILD', 'ack.json')), false);
    assert.equal(existsSync(join(home, 'tasks', 'DE22-A-CHILD', 'receiver-ack.json')), false);
    assert.equal(store.readTask('DE22-A-CHILD').status, TASK_STATUS_CLAIMED);
    assert.deepEqual(TASK_STATUSES, ['CREATED', 'READY', 'CLAIMED', 'RESULT_DELIVERED']);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// B. EXACT REPLAY BYTE STABILITY
// ---------------------------------------------------------------------------

test('B. exact replay: byte-identical durable state, no rewrite, clock-skew independent', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE22-B-SRC',
      'DE22-B-CHILD',
      'result-de22-b-src',
    );
    const request = prepareRequest(store, 'DE22-B-SRC', attempt.dispatchId);
    const path = acceptancePath(home, attempt.dispatchId);

    const first = await acceptReceiverDispatch({ request, store });
    assert.equal(first.newlyAccepted, true);
    const bytes = readFileSync(path, 'utf8');

    const replayOne = await acceptReceiverDispatch({ request, store });
    assert.equal(readFileSync(path, 'utf8'), bytes);

    clock.advance(365 * 86_400_000);
    const replayTwo = await acceptReceiverDispatch({
      request: JSON.parse(JSON.stringify(request)),
      store,
    });
    assert.equal(readFileSync(path, 'utf8'), bytes);

    clock.advance(-2 * 365 * 86_400_000);
    const replayThree = await acceptReceiverDispatch({ request, store });
    assert.equal(readFileSync(path, 'utf8'), bytes);

    for (const replay of [replayOne, replayTwo, replayThree]) {
      assert.deepEqual(replay, {
        dispatchId: attempt.dispatchId,
        newlyAccepted: false,
        exactReplay: true,
      });
    }
    assert.equal(JSON.stringify(replayOne), JSON.stringify(replayTwo));
    assert.equal(JSON.stringify(replayTwo), JSON.stringify(replayThree));
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// C. SEQUENTIAL CONFLICT
// ---------------------------------------------------------------------------

test('C. same dispatchId + different valid request: fail closed, original winner preserved', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE22-C-SRC',
      'DE22-C-CHILD',
      'result-de22-c-src',
    );
    const request = prepareRequest(store, 'DE22-C-SRC', attempt.dispatchId);
    const path = acceptancePath(home, attempt.dispatchId);

    await acceptReceiverDispatch({ request, store });
    const winnerBytes = readFileSync(path, 'utf8');

    // Different provenance, same identity key: still a valid Task 20 request.
    const different = { ...request, sourceTaskId: 'DE22-C-OTHER' };
    assert.equal(validateTransportRequest(different).dispatchId, request.dispatchId);

    await assert.rejects(
      acceptReceiverDispatch({ request: different, store }),
      (error) => error?.code === RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT,
    );
    const reversed = { ...request, task: { ...request.task, evidenceRefs: ['git:other-read'] } };
    assert.equal(validateTransportRequest(reversed).dispatchId, request.dispatchId);
    await assert.rejects(
      acceptReceiverDispatch({ request: reversed, store }),
      (error) => error?.code === RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT,
    );

    // Winner preserved byte-for-byte; no second record.
    assert.equal(readFileSync(path, 'utf8'), winnerBytes);
    assert.deepEqual(store.readReceiverDispatchAcceptance(attempt.dispatchId), request);
    assert.deepEqual(readdirSync(acceptanceDir(home)), [`${attempt.dispatchId}.json`]);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// D. CONCURRENT EXACT REPLAY
// ---------------------------------------------------------------------------

test('D. concurrent exact accept: exactly one durable record, no overwrite, all callers converge', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE22-D-SRC',
      'DE22-D-CHILD',
      'result-de22-d-src',
    );
    const request = prepareRequest(store, 'DE22-D-SRC', attempt.dispatchId);
    const path = acceptancePath(home, attempt.dispatchId);

    const clones = Array.from({ length: 6 }, () => JSON.parse(JSON.stringify(request)));
    const results = await Promise.all(
      clones.map((clone) => acceptReceiverDispatch({ request: clone, store })),
    );

    const winners = results.filter((entry) => entry.newlyAccepted === true);
    const replays = results.filter(
      (entry) => entry.newlyAccepted === false && entry.exactReplay === true,
    );
    assert.equal(winners.length, 1);
    assert.equal(replays.length, 5);
    for (const entry of results) {
      assert.equal(entry.dispatchId, request.dispatchId);
      assert.ok(Object.isFrozen(entry));
    }
    const acceptedIdentities = new Set(results.map((entry) => entry.dispatchId));
    assert.deepEqual([...acceptedIdentities], [request.dispatchId]);

    // Exactly one immutable record; bytes are the exact validated request.
    assert.deepEqual(readdirSync(acceptanceDir(home)), [`${attempt.dispatchId}.json`]);
    assert.equal(readFileSync(path, 'utf8'), JSON.stringify(request, null, 2));
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. CONCURRENT CONFLICTING REQUESTS
// ---------------------------------------------------------------------------

test('E. concurrent same-key conflicting requests: exactly one immutable winner, losers conflict', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE22-E-SRC',
      'DE22-E-CHILD',
      'result-de22-e-src',
    );
    const request = prepareRequest(store, 'DE22-E-SRC', attempt.dispatchId);
    const path = acceptancePath(home, attempt.dispatchId);
    const alternate = { ...request, sourceTaskId: 'DE22-E-OTHER' };
    assert.equal(validateTransportRequest(alternate).dispatchId, request.dispatchId);

    const mixed = [request, alternate, request, alternate, request, alternate];
    const settled = await Promise.allSettled(
      mixed.map((candidate) => acceptReceiverDispatch({ request: candidate, store })),
    );
    const tagged = settled.map((outcome, index) => ({ outcome, request: mixed[index] }));
    const winners = tagged.filter(
      ({ outcome }) => outcome.status === 'fulfilled' && outcome.value.newlyAccepted === true,
    );
    const replays = tagged.filter(
      ({ outcome }) =>
        outcome.status === 'fulfilled' &&
        outcome.value.newlyAccepted === false &&
        outcome.value.exactReplay === true,
    );
    const conflicts = tagged.filter(({ outcome }) => outcome.status === 'rejected');

    // Exactly one exclusive-create winner; same-request callers converge via
    // exact replay; every different-request caller fails closed.
    assert.equal(winners.length, 1);
    assert.equal(replays.length, 2);
    assert.equal(conflicts.length, 3);
    for (const { outcome } of conflicts) {
      assert.equal(outcome.reason?.code, RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT);
    }

    const winner = winners[0].request;
    const loser = JSON.stringify(winner) === JSON.stringify(request) ? alternate : request;
    const winnerBytes = readFileSync(path, 'utf8');
    assert.equal(winnerBytes, JSON.stringify(winner, null, 2));
    assert.deepEqual(readdirSync(acceptanceDir(home)), [`${attempt.dispatchId}.json`]);

    // The loser can never overwrite the immutable winner.
    await assert.rejects(
      acceptReceiverDispatch({ request: loser, store }),
      (error) => error?.code === RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT,
    );
    assert.equal(readFileSync(path, 'utf8'), winnerBytes);
    assert.deepEqual(store.readReceiverDispatchAcceptance(attempt.dispatchId), winner);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. MALFORMED INCOMING
// ---------------------------------------------------------------------------

test('F. malformed / terminal / not-claimed incoming fails before any persistence', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE22-F-SRC',
      'DE22-F-CHILD',
      'result-de22-f-src',
    );
    const request = prepareRequest(store, 'DE22-F-SRC', attempt.dispatchId);
    const before = snapshotHomeBytes(home);

    await assert.rejects(
      acceptReceiverDispatch({ request: { ...request, transportGeneration: 1 }, store }),
      (error) => error?.code === CORRUPT_TRANSPORT_REQUEST,
    );
    await assert.rejects(
      acceptReceiverDispatch({ request: { ...request, workerId: '' }, store }),
      (error) => error != null,
    );
    await assert.rejects(
      acceptReceiverDispatch({
        request: { ...request, task: { ...request.task, status: 'READY' } },
        store,
      }),
      (error) => error?.code === 'TASK_NOT_CLAIMED',
    );
    await assert.rejects(
      acceptReceiverDispatch({
        request: { ...request, task: { ...request.task, status: 'RESULT_DELIVERED' } },
        store,
      }),
      (error) => error?.code === 'TASK_TERMINAL',
    );
    await assert.rejects(
      acceptReceiverDispatch({ request: null, store }),
      (error) => error != null,
    );
    await assert.rejects(
      acceptReceiverDispatch({ request: 'not-a-request', store }),
      (error) => error != null,
    );
    await assert.rejects(acceptReceiverDispatch({ store }), (error) => error != null);

    assert.equal(existsSync(acceptanceDir(home)), false);
    assert.deepEqual(snapshotHomeBytes(home), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// G. CORRUPT EXISTING ACCEPTANCE
// ---------------------------------------------------------------------------

test('G. corrupt existing acceptance fails closed with no repair, overwrite, or delete', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE22-G-SRC',
      'DE22-G-CHILD',
      'result-de22-g-src',
    );
    const request = prepareRequest(store, 'DE22-G-SRC', attempt.dispatchId);
    const path = acceptancePath(home, attempt.dispatchId);
    mkdirSync(acceptanceDir(home), { recursive: true });

    const unparseable = '{ not json';
    writeFileSync(path, unparseable, 'utf8');
    await assert.rejects(
      acceptReceiverDispatch({ request, store }),
      (error) => error?.code === CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
    );
    assert.equal(readFileSync(path, 'utf8'), unparseable);

    const invalidRecord = JSON.stringify({ hello: 'not-a-transport-request' }, null, 2);
    writeFileSync(path, invalidRecord, 'utf8');
    await assert.rejects(
      acceptReceiverDispatch({ request, store }),
      (error) => error?.code === CORRUPT_TRANSPORT_REQUEST,
    );
    assert.equal(readFileSync(path, 'utf8'), invalidRecord);

    // No auto-repair artifacts, no overwrite, exactly the corrupt record.
    assert.deepEqual(readdirSync(acceptanceDir(home)), [`${attempt.dispatchId}.json`]);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// H. WRONG-KEY / BINDING CORRUPTION
// ---------------------------------------------------------------------------

test('H. wrong-key / binding corruption fails closed with zero repair', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt: first } = driveToAttempt(
      store,
      clock,
      'DE22-H-SRC1',
      'DE22-H-CHILD1',
      'result-de22-h1',
    );
    const { attempt: second } = driveToAttempt(
      store,
      clock,
      'DE22-H-SRC2',
      'DE22-H-CHILD2',
      'result-de22-h2',
    );
    const requestFirst = prepareRequest(store, 'DE22-H-SRC1', first.dispatchId);
    const requestSecond = prepareRequest(store, 'DE22-H-SRC2', second.dispatchId);
    assert.notEqual(requestFirst.dispatchId, requestSecond.dispatchId);

    // A valid request stored under the WRONG dispatchId key.
    const pathFirst = acceptancePath(home, first.dispatchId);
    mkdirSync(acceptanceDir(home), { recursive: true });
    const foreignBytes = JSON.stringify(requestSecond, null, 2);
    writeFileSync(pathFirst, foreignBytes, 'utf8');
    await assert.rejects(
      acceptReceiverDispatch({ request: requestFirst, store }),
      (error) => error?.code === CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
    );
    assert.equal(readFileSync(pathFirst, 'utf8'), foreignBytes);
    assert.equal(existsSync(acceptancePath(home, second.dispatchId)), false);

    // Tampered binding inside the stored record (dispatchId no longer
    // recomputes from the four-tuple).
    const tampered = JSON.parse(JSON.stringify(requestFirst));
    tampered.workerId = 'worker-tampered';
    writeFileSync(pathFirst, JSON.stringify(tampered, null, 2), 'utf8');
    const tamperedBytes = readFileSync(pathFirst, 'utf8');
    await assert.rejects(
      acceptReceiverDispatch({ request: requestFirst, store }),
      (error) => error?.code === 'DISPATCH_BINDING_MISMATCH',
    );
    assert.equal(readFileSync(pathFirst, 'utf8'), tamperedBytes);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// I. TASK 21 READER COMPATIBILITY
// ---------------------------------------------------------------------------

test('I. Task 21 reader uses the durable reader for unseen / exact replay / conflict', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE22-I-SRC',
      'DE22-I-CHILD',
      'result-de22-i-src',
    );
    const request = prepareRequest(store, 'DE22-I-SRC', attempt.dispatchId);
    const reader = (dispatchId) => store.readReceiverDispatchAcceptance(dispatchId);

    const unseen = await readReceiverDispatchAcceptance({ request, reader });
    assert.deepEqual(unseen, { dispatchId: attempt.dispatchId, previouslyObserved: false });

    assert.equal((await acceptReceiverDispatch({ request, store })).newlyAccepted, true);

    const replay = await readReceiverDispatchAcceptance({ request, reader });
    assert.deepEqual(replay, {
      dispatchId: attempt.dispatchId,
      previouslyObserved: true,
      exactReplay: true,
    });

    const different = { ...request, sourceTaskId: 'DE22-I-OTHER' };
    await assert.rejects(
      readReceiverDispatchAcceptance({ request: different, reader }),
      (error) => error?.code === RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT,
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// J. DETERMINISTIC RESULT
// ---------------------------------------------------------------------------

test('J. results and durable bytes are deterministic under clock skew and across processes', async () => {
  const homeA = makeHome('greenhub-receiver-accept22-j1-');
  const homeB = makeHome('greenhub-receiver-accept22-j2-');
  try {
    const clockA = controllableClock();
    const clockB = controllableClock();
    const storeA = new CoordinationStore({ dir: homeA, nowProvider: () => clockA.provider() });
    const storeB = new CoordinationStore({ dir: homeB, nowProvider: () => clockB.provider() });
    const first = driveToAttempt(storeA, clockA, 'DE22-J-SRC', 'DE22-J-CHILD', 'result-de22-j');
    const second = driveToAttempt(storeB, clockB, 'DE22-J-SRC', 'DE22-J-CHILD', 'result-de22-j');
    const requestA = prepareRequest(storeA, 'DE22-J-SRC', first.attempt.dispatchId);
    const requestB = prepareRequest(storeB, 'DE22-J-SRC', second.attempt.dispatchId);
    assert.equal(JSON.stringify(requestA), JSON.stringify(requestB));

    const resultA = await acceptReceiverDispatch({ request: requestA, store: storeA });
    const resultB = await acceptReceiverDispatch({ request: requestB, store: storeB });
    assert.equal(JSON.stringify(resultA), JSON.stringify(resultB));
    assert.deepEqual(resultA, { dispatchId: requestA.dispatchId, newlyAccepted: true });

    const bytesA = readFileSync(acceptancePath(homeA, requestA.dispatchId), 'utf8');
    const bytesB = readFileSync(acceptancePath(homeB, requestB.dispatchId), 'utf8');
    assert.equal(bytesA, bytesB);
    assert.equal(bytesA, JSON.stringify(requestA, null, 2));

    // No receiver-acceptance wrapper metadata is persisted: the durable value
    // is the EXACT Task 20 request (which itself carries the Task Envelope
    // createdAt/updatedAt, never a new acceptance timestamp).
    for (const excluded of [
      'acceptedAt',
      'receivedAt',
      'timestamp',
      'pid',
      'hostname',
      'endpoint',
      'adapter',
      'receiverGeneration',
      'acceptanceGeneration',
      'deliveryGeneration',
      'retryGeneration',
    ]) {
      assert.equal(bytesA.includes(`"${excluded}"`), false, `${excluded} must not be persisted`);
    }
    assert.equal(bytesA.includes('"generation"'), false);

    // Replay through a store whose clock is skewed by +/- 1 year is identical.
    clockA.advance(365 * 86_400_000);
    const skewedStore = new CoordinationStore({ dir: homeA, nowProvider: () => clockA.provider() });
    const replayUp = await acceptReceiverDispatch({ request: requestA, store: skewedStore });
    clockA.advance(-2 * 365 * 86_400_000);
    const replayDown = await acceptReceiverDispatch({ request: requestA, store: skewedStore });
    assert.equal(JSON.stringify(replayUp), JSON.stringify(replayDown));
    assert.deepEqual(replayUp, {
      dispatchId: requestA.dispatchId,
      newlyAccepted: false,
      exactReplay: true,
    });
    assert.equal(readFileSync(acceptancePath(homeA, requestA.dispatchId), 'utf8'), bytesA);
  } finally {
    removeHome(homeA);
    removeHome(homeB);
  }
});

// ---------------------------------------------------------------------------
// K. FROZEN RESULT
// ---------------------------------------------------------------------------

test('K. acceptance results are frozen and mutation is rejected', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE22-K-SRC',
      'DE22-K-CHILD',
      'result-de22-k-src',
    );
    const request = prepareRequest(store, 'DE22-K-SRC', attempt.dispatchId);
    const newly = await acceptReceiverDispatch({ request, store });
    const replay = await acceptReceiverDispatch({ request, store });
    for (const result of [newly, replay]) {
      assert.ok(Object.isFrozen(result));
      assert.throws(() => {
        result.newlyAccepted = 'mutated';
      }, TypeError);
      assert.throws(() => {
        result.exactReplay = 'mutated';
      }, TypeError);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// L. NO UNRELATED DURABLE MUTATION
// ---------------------------------------------------------------------------

test('L. no unrelated durable mutation: task/claim/emission/admission/attempt bytes untouched', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE22-L-SRC',
      'DE22-L-CHILD',
      'result-de22-l-src',
    );
    const request = prepareRequest(store, 'DE22-L-SRC', attempt.dispatchId);
    const different = { ...request, sourceTaskId: 'DE22-L-OTHER' };

    const fixedPaths = {
      sourceTask: join(home, 'tasks', 'DE22-L-SRC', 'task.json'),
      childTask: join(home, 'tasks', 'DE22-L-CHILD', 'task.json'),
      childClaim: join(home, 'tasks', 'DE22-L-CHILD', 'claim.json'),
      emission: join(home, 'tasks', 'DE22-L-SRC', 'emissions', 'next.json'),
      admission: join(home, 'tasks', 'DE22-L-SRC', 'emission-admissions', 'next.json'),
      attempt: join(home, 'tasks', 'DE22-L-SRC', 'dispatch-attempts', `${attempt.dispatchId}.json`),
      sourceResult: join(home, 'tasks', 'DE22-L-SRC', 'result.json'),
    };
    const beforeBytes = {};
    for (const [name, path] of Object.entries(fixedPaths)) {
      beforeBytes[name] = readFileSync(path, 'utf8');
    }
    const before = snapshotHomeBytes(home);

    await acceptReceiverDispatch({ request, store });
    await acceptReceiverDispatch({ request, store });
    await assert.rejects(
      acceptReceiverDispatch({ request: different, store }),
      (error) => error?.code === RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT,
    );

    for (const [name, path] of Object.entries(fixedPaths)) {
      assert.equal(
        readFileSync(path, 'utf8'),
        beforeBytes[name],
        `${name} must stay byte-identical`,
      );
    }
    const after = snapshotHomeBytes(home);
    for (const key of Object.keys(before)) {
      assert.equal(after[key], before[key], `${key} must stay byte-identical`);
    }
    const added = Object.keys(after).filter((key) => !(key in before));
    assert.deepEqual(added, [join(RECEIVER_ACCEPTANCES_DIRNAME, `${attempt.dispatchId}.json`)]);

    // Sender-side dispatch attempt is untouched by receiver acceptance.
    assert.deepEqual(
      store.readDispatchAttempt({ sourceTaskId: 'DE22-L-SRC', dispatchId: attempt.dispatchId }),
      attempt,
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// M. FORBIDDEN AUTHORITY ABSENCE (source boundary, code only)
// ---------------------------------------------------------------------------

test('M. production module has no ACK / executor / scheduler / retry / new generation / concrete transport authority', () => {
  const code = codeOnly(readFileSync(MODULE_PATH, 'utf8'));
  for (const forbidden of [
    "from 'node:fs'",
    "from 'node:child_process'",
    "from 'node:net'",
    "from 'node:http'",
    "from 'node:https'",
    'acknowledge',
    'ackDispatch',
    'writeAck',
    'ack.json',
    'receipt',
    'executor',
    'spawn(',
    'exec(',
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
    'transportGeneration',
    'sendGeneration',
    'attemptGeneration',
    'retryGeneration',
    'deliveryGeneration',
    'receiverGeneration',
    'acceptanceGeneration',
    'selectWorker',
    'workerRegistry',
    'adapterRegistry',
    'new Map(',
    'new Set(',
    'writeFileSync',
    'mkdirSync',
  ]) {
    assert.equal(code.includes(forbidden), false, `code must not contain ${forbidden}`);
  }
  for (const status of [
    "'DISPATCHED'",
    '"DISPATCHED"',
    "'EXECUTOR_ACCEPTED'",
    "'ACCEPTED'",
    "'RECEIVED'",
    "'EXECUTING'",
    'TASK_STATUS_DISPATCHED',
    'TASK_STATUS_ACCEPTED',
  ]) {
    assert.equal(code.includes(status), false, `${status} must not exist in code`);
  }
  // The acceptance boundary composes the existing Task 20 validator and the
  // Task 21 read boundary verbatim.
  assert.ok(code.includes('validateTransportRequest('));
  assert.ok(code.includes('observeReceiverDispatchAcceptance('));
  // Only the acceptance boundary, the error class, and the path/identity
  // helpers are exported functions.
  const exportedFunctions = Object.entries(receiverAcceptanceModule)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(exportedFunctions, [
    'DispatchReceiverAcceptanceError',
    'acceptReceiverDispatch',
    'assertValidReceiverAcceptanceDispatchId',
    'receiverDispatchAcceptanceFileName',
    'receiverDispatchAcceptanceFilePath',
    'receiverDispatchAcceptanceRef',
  ]);
  assert.equal(typeof DispatchReceiverAcceptanceError, 'function');
});

// ---------------------------------------------------------------------------
// N. INPUT CONTRACT / DISPATCHID-ONLY LOOKUP
// ---------------------------------------------------------------------------

test('N. only a validated Task 20 request can be accepted; lookup key is dispatchId ONLY', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE22-N-SRC',
      'DE22-N-CHILD',
      'result-de22-n-src',
    );
    const request = prepareRequest(store, 'DE22-N-SRC', attempt.dispatchId);
    const before = snapshotHomeBytes(home);

    // Invalid stores are rejected before any durable read/write.
    for (const badStore of [
      undefined,
      null,
      'store',
      42,
      {},
      { readReceiverDispatchAcceptance: () => null },
    ]) {
      await assert.rejects(
        acceptReceiverDispatch({ request, store: badStore }),
        (error) => error?.code === INVALID_RECEIVER_ACCEPTANCE_STORE,
      );
    }
    assert.deepEqual(snapshotHomeBytes(home), before);

    // The durable reader receives dispatchId ONLY (one argument), and the
    // writer receives the EXACT validated request.
    const calls = [];
    const spyStore = {
      readReceiverDispatchAcceptance: (dispatchId, ...rest) => {
        calls.push({ op: 'read', dispatchId, rest });
        return store.readReceiverDispatchAcceptance(dispatchId);
      },
      createReceiverDispatchAcceptance: (candidate) => {
        calls.push({ op: 'create', candidate });
        return store.createReceiverDispatchAcceptance(candidate);
      },
    };
    const result = await acceptReceiverDispatch({ request, store: spyStore });
    assert.deepEqual(result, { dispatchId: attempt.dispatchId, newlyAccepted: true });
    assert.equal(calls[0].op, 'read');
    assert.equal(calls[0].dispatchId, attempt.dispatchId);
    assert.deepEqual(calls[0].rest, []);
    const createCall = calls.find((entry) => entry.op === 'create');
    assert.deepEqual(createCall.candidate, request);
    assert.deepEqual(validateTransportRequest(createCall.candidate), request);
    assert.equal(
      existsSync(join(home, RECEIVER_ACCEPTANCES_DIRNAME, `${attempt.dispatchId}.json`)),
      true,
    );

    // Repository isolation: temp home only.
    assert.ok(home.startsWith(tmpdir()));
    void resolveCoordinationHome;
  } finally {
    removeHome(home);
  }
});
