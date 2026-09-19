// Proof for GREENHUB-COORDINATION-RECEIVER-DECISION-INPUT-23.
//
// READABLE_RECEIVER_DECISION_INPUT != ACK != receipt != executor acceptance
// != execution start != task status transition != scheduler decision != worker
// selection != retry authority != delivery success.
// read != accept != ACK != execute.
//
// The read entry is EXACTLY:
//   (dispatchId, store)
//     -> dispatchId identity validation (Task 22 receiver-acceptance family)
//     -> store.readReceiverDispatchAcceptance(dispatchId)  [dispatchId ONLY,
//        at most once per call, no polling / re-read loop / fallback / scan]
//     -> null/undefined: RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND (read failure
//        only; no write, no Task 22 acceptance, no task mutation)
//     -> validateTransportRequest(stored)                  [Task 20 verbatim]
//     -> validated.dispatchId === dispatchId               [direct binding check]
//     -> frozen EXACT validated Task 20 request, no wrapper metadata.
//
// All runtime state lives in isolated temp directories. No network required.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
import {
  acceptReceiverDispatch,
  CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
  receiverDispatchAcceptanceFilePath,
} from './dispatch-receiver-acceptance.mjs';
import * as decisionInputModule from './dispatch-receiver-decision-input.mjs';
import {
  INVALID_RECEIVER_DECISION_INPUT_STORE,
  RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND,
  ReceiverDecisionInputError,
  readReceiverDecisionInput,
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
const MODULE_PATH = join(MODULE_DIRECTORY, 'dispatch-receiver-decision-input.mjs');

// Task 18~22 predecessor source/spec bytes are pinned to the exact live-main
// baseline this read primitive was built against. A change to any pinned file
// is a predecessor-contract change and must come from an explicitly
// predecessor-owning Task, never from this read surface.
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
});

function makeHome(prefix = 'greenhub-decision-input23-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'RECEIVER_DECISION_INPUT_PROVED',
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
    proofRequirement: ['receiver-decision-input-proof'],
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

// End-to-end durable acceptance setup: source -> child claim -> durable
// dispatch attempt -> Task 20 request -> Task 22 durable acceptance.
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
  const request = prepareRequest(store, sourceTaskId, attempt.dispatchId);
  const accepted = await acceptReceiverDispatch({ request, store });
  assert.equal(accepted.newlyAccepted, true);
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

function acceptancePath(home, dispatchId) {
  return receiverDispatchAcceptanceFilePath(home, dispatchId);
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

function fakeAcceptedStore(record) {
  return { readReceiverDispatchAcceptance: () => record };
}

// ---------------------------------------------------------------------------
// A. VALID ACCEPTED REQUEST -> EXACT IMMUTABLE DECISION INPUT
// ---------------------------------------------------------------------------

test('A. durable accepted request reads as exact immutable decision input with dispatchId-only at-most-once lookup', async () => {
  const { home, store, attempt, request } = await setupAccepted(
    'greenhub-decision23-a-',
    'DE23-A-SRC',
    'DE23-A-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const { calls, store: spyStore } = countingStore((dispatchId) =>
      store.readReceiverDispatchAcceptance(dispatchId),
    );

    const result = await readReceiverDecisionInput({
      dispatchId: attempt.dispatchId,
      store: spyStore,
    });

    // Exact durable request read: the returned value is the EXACT validated
    // Task 20 request itself, frozen, no wrapper metadata.
    assert.deepEqual(result, request);
    assert.equal(JSON.stringify(result), JSON.stringify(request));
    assert.deepEqual(Object.keys(result), [...TRANSPORT_REQUEST_FIELDS]);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.task));
    assert.deepEqual(validateTransportRequest(result), request);

    // dispatchId ONLY, exactly one argument, at most once.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].dispatchId, attempt.dispatchId);
    assert.deepEqual(calls[0].rest, []);

    // No mutation anywhere: every durable byte is identical, no new file.
    const after = snapshotHomeBytes(home);
    assert.deepEqual(after, before);
    assert.equal(
      readFileSync(acceptancePath(home, attempt.dispatchId), 'utf8'),
      JSON.stringify(request, null, 2),
    );
    assert.deepEqual(store.readReceiverDispatchAcceptance(attempt.dispatchId), request);

    // No task status transition, no ACK / receipt artifact.
    assert.equal(store.readTask('DE23-A-CHILD').status, TASK_STATUS_CLAIMED);
    assert.equal(existsSync(join(home, 'tasks', 'DE23-A-CHILD', 'ack.json')), false);
    assert.equal(existsSync(join(home, 'tasks', 'DE23-A-CHILD', 'receiver-ack.json')), false);
    assert.equal(existsSync(join(home, 'tasks', 'DE23-A-CHILD', 'receipt.json')), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// B. MISSING ACCEPTANCE
// ---------------------------------------------------------------------------

test('B. missing durable acceptance: RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND with zero write / auto-accept / Task 22 side effect', async () => {
  const home = makeHome('greenhub-decision23-b-');
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE23-B-SRC',
      'DE23-B-CHILD',
      'result-de23-b-src',
    );
    const request = prepareRequest(store, 'DE23-B-SRC', attempt.dispatchId);
    assert.equal(store.readReceiverDispatchAcceptance(attempt.dispatchId), null);

    const before = snapshotHomeBytes(home);
    const childTaskBytes = readFileSync(join(home, 'tasks', 'DE23-B-CHILD', 'task.json'), 'utf8');
    const { calls, store: spyStore } = countingStore((dispatchId) =>
      store.readReceiverDispatchAcceptance(dispatchId),
    );

    await assert.rejects(
      readReceiverDecisionInput({ dispatchId: attempt.dispatchId, store: spyStore }),
      (error) =>
        error instanceof ReceiverDecisionInputError &&
        error.code === RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND,
    );

    // The read itself happened exactly once, with dispatchId only.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].dispatchId, attempt.dispatchId);
    assert.deepEqual(calls[0].rest, []);

    // No write, no auto-accept, no Task 22 acceptance side effect, no task
    // mutation: the durable state is byte-identical and still unseen.
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.equal(existsSync(acceptancePath(home, attempt.dispatchId)), false);
    assert.equal(store.readReceiverDispatchAcceptance(attempt.dispatchId), null);
    assert.equal(
      readFileSync(join(home, 'tasks', 'DE23-B-CHILD', 'task.json'), 'utf8'),
      childTaskBytes,
    );
    assert.equal(store.readTask('DE23-B-CHILD').status, TASK_STATUS_CLAIMED);
    assert.deepEqual(validateTransportRequest(request).dispatchId, attempt.dispatchId);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// C. INVALID DISPATCHID
// ---------------------------------------------------------------------------

test('C. invalid dispatchId fails closed before the reader is ever invoked', async () => {
  const home = makeHome('greenhub-decision23-c-');
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAttempt(store, clock, 'DE23-C-SRC', 'DE23-C-CHILD', 'result-de23-c-src');
    const before = snapshotHomeBytes(home);
    const { calls, store: spyStore } = countingStore(() => {
      throw new Error('reader must never be called for an invalid dispatchId');
    });

    const invalidIds = [
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
    ];
    for (const invalidId of invalidIds) {
      await assert.rejects(
        readReceiverDecisionInput({ dispatchId: invalidId, store: spyStore }),
        (error) => error?.code === CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
      );
    }
    await assert.rejects(readReceiverDecisionInput(), (error) => error != null);

    // Reader never called; zero durable change.
    assert.equal(calls.length, 0);
    assert.deepEqual(snapshotHomeBytes(home), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// D. CORRUPT DURABLE RECORD
// ---------------------------------------------------------------------------

test('D. corrupt durable record fails closed; bytes preserved with no repair/delete/rewrite', async () => {
  const home = makeHome('greenhub-decision23-d-');
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DE23-D-SRC',
      'DE23-D-CHILD',
      'result-de23-d-src',
    );
    const request = prepareRequest(store, 'DE23-D-SRC', attempt.dispatchId);
    const path = acceptancePath(home, attempt.dispatchId);
    mkdirSync(join(home, 'receiver-acceptances'), { recursive: true });

    const variants = [
      {
        name: 'unparseable bytes',
        bytes: '{ not json',
        code: CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
      },
      {
        name: 'valid JSON, invalid transport request',
        bytes: JSON.stringify({ hello: 'not-a-transport-request' }, null, 2),
        code: CORRUPT_TRANSPORT_REQUEST,
      },
      {
        name: 'tampered binding (workerId)',
        bytes: JSON.stringify({ ...request, workerId: 'worker-tampered' }, null, 2),
        code: 'DISPATCH_BINDING_MISMATCH',
      },
      {
        name: 'unexpected extra field',
        bytes: JSON.stringify({ ...request, decisionGeneration: 1 }, null, 2),
        code: CORRUPT_TRANSPORT_REQUEST,
      },
      {
        name: 'not-claimed child',
        bytes: JSON.stringify({ ...request, task: { ...request.task, status: 'READY' } }, null, 2),
        code: 'TASK_NOT_CLAIMED',
      },
      {
        name: 'terminal child',
        bytes: JSON.stringify(
          { ...request, task: { ...request.task, status: 'RESULT_DELIVERED' } },
          null,
          2,
        ),
        code: 'TASK_TERMINAL',
      },
    ];

    for (const variant of variants) {
      writeFileSync(path, variant.bytes, 'utf8');
      await assert.rejects(
        readReceiverDecisionInput({ dispatchId: attempt.dispatchId, store }),
        (error) => error?.code === variant.code,
        variant.name,
      );
      // Fail closed with zero repair, overwrite, truncation, delete, or
      // rewrite: the exact corrupt bytes and the only file remain.
      assert.equal(readFileSync(path, 'utf8'), variant.bytes, variant.name);
      assert.deepEqual(
        readdirSync(join(home, 'receiver-acceptances')),
        [`${attempt.dispatchId}.json`],
        variant.name,
      );
    }

    // No repair artifact was created anywhere: exactly one record remains at
    // the dispatchId-only path and the child task is untouched.
    assert.deepEqual(readdirSync(join(home, 'receiver-acceptances')), [
      `${attempt.dispatchId}.json`,
    ]);
    assert.equal(store.readTask('DE23-D-CHILD').status, TASK_STATUS_CLAIMED);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. WRONG-KEY BINDING
// ---------------------------------------------------------------------------

test('E. wrong-key binding fails closed at the durable reader and at the module re-check', async () => {
  const home = makeHome('greenhub-decision23-e-');
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt: attemptOne } = driveToAttempt(
      store,
      clock,
      'DE23-E-SRC1',
      'DE23-E-CHILD1',
      'result-de23-e1',
    );
    const { attempt: attemptTwo } = driveToAttempt(
      store,
      clock,
      'DE23-E-SRC2',
      'DE23-E-CHILD2',
      'result-de23-e2',
    );
    const requestOne = prepareRequest(store, 'DE23-E-SRC1', attemptOne.dispatchId);
    const requestTwo = prepareRequest(store, 'DE23-E-SRC2', attemptTwo.dispatchId);
    assert.notEqual(requestOne.dispatchId, requestTwo.dispatchId);
    await acceptReceiverDispatch({ request: requestOne, store });
    await acceptReceiverDispatch({ request: requestTwo, store });

    // Module-level direct re-check: a caller-supplied store that returns a
    // valid request bound to a DIFFERENT dispatchId fails closed.
    await assert.rejects(
      readReceiverDecisionInput({
        dispatchId: requestOne.dispatchId,
        store: fakeAcceptedStore(requestTwo),
      }),
      (error) => error?.code === CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
    );

    // Durable-level wrong key: a valid foreign request under the requested
    // dispatchId path fails closed; bytes preserved for both records.
    const pathOne = acceptancePath(home, requestOne.dispatchId);
    const pathTwo = acceptancePath(home, requestTwo.dispatchId);
    const bytesTwo = readFileSync(pathTwo, 'utf8');
    writeFileSync(pathOne, bytesTwo, 'utf8');
    await assert.rejects(
      readReceiverDecisionInput({ dispatchId: requestOne.dispatchId, store }),
      (error) => error?.code === CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
    );
    assert.equal(readFileSync(pathOne, 'utf8'), bytesTwo);
    assert.equal(readFileSync(pathTwo, 'utf8'), bytesTwo);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. TASK 20 VALIDATION PROPAGATION
// ---------------------------------------------------------------------------

test('F. Task 20/18/19 validation codes propagate unchanged through the read', async () => {
  const { home, store, attempt, request } = await setupAccepted(
    'greenhub-decision23-f-',
    'DE23-F-SRC',
    'DE23-F-CHILD',
  );
  try {
    const dispatchId = attempt.dispatchId;
    const cases = [
      {
        name: 'generation smuggling',
        record: { ...request, transportGeneration: 1 },
        code: CORRUPT_TRANSPORT_REQUEST,
      },
      {
        name: 'invalid claimGeneration',
        record: { ...request, claimGeneration: 0 },
        code: CORRUPT_TRANSPORT_REQUEST,
      },
      {
        name: 'empty workerId',
        record: { ...request, workerId: '' },
        code: CORRUPT_TRANSPORT_REQUEST,
      },
      {
        name: 'binding drift (workerId tamper)',
        record: { ...request, workerId: 'worker-tampered' },
        code: 'DISPATCH_BINDING_MISMATCH',
      },
      {
        name: 'task envelope taskId drift',
        record: { ...request, task: { ...request.task, taskId: 'DE23-F-OTHER' } },
        code: 'DISPATCH_ATTEMPT_BINDING_MISMATCH',
      },
      {
        name: 'malformed task envelope',
        record: { ...request, task: null },
        code: 'INVALID_ENVELOPE',
      },
      {
        name: 'not-claimed child',
        record: { ...request, task: { ...request.task, status: 'CREATED' } },
        code: 'TASK_NOT_CLAIMED',
      },
      {
        name: 'terminal child',
        record: { ...request, task: { ...request.task, status: 'RESULT_DELIVERED' } },
        code: 'TASK_TERMINAL',
      },
      {
        name: 'non-request record',
        record: 'not-a-request',
        code: CORRUPT_TRANSPORT_REQUEST,
      },
    ];

    for (const entry of cases) {
      const { calls, store: readerStore } = countingStore(() => entry.record);
      await assert.rejects(
        readReceiverDecisionInput({ dispatchId, store: readerStore }),
        (error) => error?.code === entry.code,
        entry.name,
      );
      assert.equal(calls.length, 1, entry.name);
      assert.equal(calls[0].dispatchId, dispatchId, entry.name);
    }

    // Reader throw/reject propagates unchanged: no wrapping, no remapping,
    // no retry, zero durable side effect.
    const sentinel = new Error('durable reader failure');
    sentinel.code = CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE;
    let observed;
    try {
      await readReceiverDecisionInput({
        dispatchId,
        store: {
          readReceiverDispatchAcceptance: () => {
            throw sentinel;
          },
        },
      });
    } catch (error) {
      observed = error;
    }
    assert.equal(observed, sentinel);
    assert.deepEqual(store.readReceiverDispatchAcceptance(dispatchId), request);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// G. EXACT SHAPE (NO RECEIVER METADATA)
// ---------------------------------------------------------------------------

test('G. returned decision input has the exact Task 20 shape and no receiver metadata', async () => {
  const { home, store, attempt, request } = await setupAccepted(
    'greenhub-decision23-g-',
    'DE23-G-SRC',
    'DE23-G-CHILD',
  );
  try {
    const result = await readReceiverDecisionInput({ dispatchId: attempt.dispatchId, store });
    assert.deepEqual(Object.keys(result), [...TRANSPORT_REQUEST_FIELDS]);
    assert.equal(JSON.stringify(result), JSON.stringify(request));
    assert.ok(Object.isFrozen(result));

    const serialized = JSON.stringify(result);
    for (const excluded of [
      '"acceptedAt"',
      '"receivedAt"',
      '"decidedAt"',
      '"decision"',
      '"ack"',
      '"receipt"',
      '"executor"',
      '"workerSelector"',
      '"executionAllowed"',
      '"receiverGeneration"',
      '"acceptanceGeneration"',
      '"decisionGeneration"',
      '"executionGeneration"',
    ]) {
      assert.equal(serialized.includes(excluded), false, `${excluded} must not appear`);
    }
    assert.equal(Object.hasOwn(result, 'acceptedRequest'), false);
    assert.equal(Object.hasOwn(result, 'decisionGeneration'), false);
    assert.equal(result.claimGeneration, request.claimGeneration);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// H. READER INVOCATION CONTRACT
// ---------------------------------------------------------------------------

test('H. reader receives exactly dispatchId once per call; invalid stores never reach the reader', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-decision23-h-',
    'DE23-H-SRC',
    'DE23-H-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const { calls, store: spyStore } = countingStore((dispatchId) =>
      store.readReceiverDispatchAcceptance(dispatchId),
    );

    await readReceiverDecisionInput({ dispatchId: attempt.dispatchId, store: spyStore });
    await readReceiverDecisionInput({ dispatchId: attempt.dispatchId, store: spyStore });

    // Two calls -> exactly two invocations, one dispatchId argument each.
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.dispatchId, attempt.dispatchId);
      assert.deepEqual(call.rest, []);
    }

    // Invalid store capability: fail closed before any read; a probe reader
    // inside the invalid store is never called and durable bytes are untouched.
    let probeCalls = 0;
    const invalidStores = [
      undefined,
      null,
      'store',
      42,
      {},
      { readReceiverDispatchAcceptance: 7 },
      {
        readReceiverDispatchAcceptance: undefined,
        probe: () => {
          probeCalls += 1;
        },
      },
    ];
    for (const invalidStore of invalidStores) {
      await assert.rejects(
        readReceiverDecisionInput({ dispatchId: attempt.dispatchId, store: invalidStore }),
        (error) => error?.code === INVALID_RECEIVER_DECISION_INPUT_STORE,
      );
    }
    assert.equal(probeCalls, 0);
    assert.deepEqual(snapshotHomeBytes(home), before);

    // No fallback lookup / scan: the reader is the only data source and it is
    // invoked at most once per call (total unchanged by a second read of the
    // same dispatchId: 2 calls -> 2 invocations, verified above).
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// I. DETERMINISM
// ---------------------------------------------------------------------------

test('I. identical durable bytes + dispatchId produce identical serialized output under clock/process skew', async () => {
  const { home, clock, store, attempt } = await setupAccepted(
    'greenhub-decision23-i-',
    'DE23-I-SRC',
    'DE23-I-CHILD',
  );
  try {
    const first = await readReceiverDecisionInput({ dispatchId: attempt.dispatchId, store });

    clock.advance(365 * 86_400_000);
    const skewedUpStore = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const second = await readReceiverDecisionInput({
      dispatchId: attempt.dispatchId,
      store: skewedUpStore,
    });

    clock.advance(-2 * 365 * 86_400_000);
    const skewedDownStore = new CoordinationStore({
      dir: home,
      nowProvider: () => clock.provider(),
    });
    const third = await readReceiverDecisionInput({
      dispatchId: attempt.dispatchId,
      store: skewedDownStore,
    });

    // Same durable bytes read through a deep-clone-returning reader also
    // serialize identically: identity of the object never participates.
    const cloned = await readReceiverDecisionInput({
      dispatchId: attempt.dispatchId,
      store: {
        readReceiverDispatchAcceptance: () => JSON.parse(JSON.stringify(first)),
      },
    });

    const serialized = JSON.stringify(first);
    assert.equal(JSON.stringify(second), serialized);
    assert.equal(JSON.stringify(third), serialized);
    assert.equal(JSON.stringify(cloned), serialized);
    for (const result of [first, second, third, cloned]) {
      assert.ok(Object.isFrozen(result));
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// J. PREDECESSOR IMMUTABILITY
// ---------------------------------------------------------------------------

test('J. Task 18~22 predecessor source/spec bytes are unchanged', () => {
  for (const [name, expected] of Object.entries(PREDECESSOR_SHA256)) {
    const actual = createHash('sha256')
      .update(readFileSync(join(MODULE_DIRECTORY, name)))
      .digest('hex');
    assert.equal(actual, expected, `${name} must stay byte-identical`);
  }
});

// ---------------------------------------------------------------------------
// K. DURABLE STATE IMMUTABILITY
// ---------------------------------------------------------------------------

test('K. successful reads leave task/claim/emission/admission/attempt/result/acceptance bytes untouched', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-decision23-k-',
    'DE23-K-SRC',
    'DE23-K-CHILD',
  );
  try {
    const fixedPaths = {
      sourceTask: join(home, 'tasks', 'DE23-K-SRC', 'task.json'),
      childTask: join(home, 'tasks', 'DE23-K-CHILD', 'task.json'),
      childClaim: join(home, 'tasks', 'DE23-K-CHILD', 'claim.json'),
      emission: join(home, 'tasks', 'DE23-K-SRC', 'emissions', 'next.json'),
      admission: join(home, 'tasks', 'DE23-K-SRC', 'emission-admissions', 'next.json'),
      attempt: join(home, 'tasks', 'DE23-K-SRC', 'dispatch-attempts', `${attempt.dispatchId}.json`),
      sourceResult: join(home, 'tasks', 'DE23-K-SRC', 'result.json'),
      sourceDisposition: join(home, 'tasks', 'DE23-K-SRC', 'disposition', 'current.json'),
      acceptance: acceptancePath(home, attempt.dispatchId),
    };
    const beforeBytes = {};
    for (const [name, path] of Object.entries(fixedPaths)) {
      beforeBytes[name] = readFileSync(path, 'utf8');
    }
    const before = snapshotHomeBytes(home);

    await readReceiverDecisionInput({ dispatchId: attempt.dispatchId, store });
    await readReceiverDecisionInput({ dispatchId: attempt.dispatchId, store });

    for (const [name, path] of Object.entries(fixedPaths)) {
      assert.equal(
        readFileSync(path, 'utf8'),
        beforeBytes[name],
        `${name} must stay byte-identical`,
      );
    }
    const after = snapshotHomeBytes(home);
    assert.deepEqual(after, before);
    for (const name of Object.keys(after)) {
      if (name in before) continue;
      assert.equal(
        /decision|ack|receipt|executor|retry|scheduler/i.test(name),
        false,
        `new file ${name} must not exist`,
      );
    }
    assert.deepEqual(
      store.readDispatchAttempt({
        sourceTaskId: 'DE23-K-SRC',
        dispatchId: attempt.dispatchId,
      }),
      attempt,
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// L. FORBIDDEN BOUNDARY (source boundary, code only)
// ---------------------------------------------------------------------------

test('L. production module has no write / ACK / executor / scheduler / retry / new generation / concrete transport authority', () => {
  const code = codeOnly(readFileSync(MODULE_PATH, 'utf8'));
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
    'decisionGeneration',
    'executionGeneration',
    'executionAllowed',
    'selectWorker',
    'workerRegistry',
    'adapterRegistry',
    'new Map(',
    'new Set(',
    'writeFileSync',
    'mkdirSync',
    'rmSync',
    'appendFile',
    'createWriteStream',
    'writeJsonExclusive',
    'acceptReceiverDispatch',
    'createReceiverDispatchAcceptance',
  ]) {
    assert.equal(code.includes(forbidden), false, `code must not contain ${forbidden}`);
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
  // The read boundary composes the existing Task 20 validator and the
  // existing Task 22 durable reader verbatim.
  assert.ok(code.includes('validateTransportRequest('));
  assert.ok(code.includes('store.readReceiverDispatchAcceptance('));
  // Only the read boundary and the error class are exported functions.
  const exportedFunctions = Object.entries(decisionInputModule)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(exportedFunctions, ['ReceiverDecisionInputError', 'readReceiverDecisionInput']);
  assert.equal(typeof ReceiverDecisionInputError, 'function');
});
