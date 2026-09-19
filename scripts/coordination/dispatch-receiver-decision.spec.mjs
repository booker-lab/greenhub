// Proof for GREENHUB-COORDINATION-DURABLE-RECEIVER-DECISION-24.
//
// DURABLE_RECEIVER_DECISION != ACK != receipt != sender acknowledgment
// != executor acceptance != execution start != task status transition
// != scheduler decision != worker selection != retry authority
// != delivery success.
// persist != ACK != execute.
//
// The decision entry is EXACTLY:
//   (dispatchId, store)
//     -> store capability gate (readReceiverDispatchAcceptance /
//        readReceiverDispatchDecision / createReceiverDispatchDecision)
//     -> readReceiverDecisionInput({ dispatchId, store })  [Task 23 verbatim:
//        dispatchId identity first, durable acceptance read, Task 20
//        validation, direct dispatchId binding re-check]
//     -> buildReceiverDecisionRecord(input)                [deterministic]
//     -> existing record: exact serialized replay or conflict (first wins)
//     -> unseen: OS exclusive-create under
//        <home>/receiver-decisions/<dispatchId>.json
//     -> durable read-back verification
//     -> race loser: winner re-read (replay / conflict / corrupt fail closed)
//
// All runtime state lives in isolated temp directories. No network required.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  acceptReceiverDispatch,
  receiverDispatchAcceptanceFilePath,
} from './dispatch-receiver-acceptance.mjs';
import * as decisionModule from './dispatch-receiver-decision.mjs';
import {
  BLOCKED_RECEIVER_DECISION_FIELDS,
  buildReceiverDecisionRecord,
  CORRUPT_RECEIVER_DISPATCH_DECISION,
  INVALID_RECEIVER_DECISION_STORE,
  persistReceiverDecision,
  RECEIVER_DECISION_CONFLICT,
  RECEIVER_DECISION_RECORD_FIELDS,
  RECEIVER_DECISION_SCHEMA_VERSION,
  RECEIVER_DECISION_VALUE,
  RECEIVER_DECISIONS_DIRNAME,
  ReceiverDecisionError,
  receiverDispatchDecisionFilePath,
  validateReceiverDecisionRecord,
} from './dispatch-receiver-decision.mjs';
import {
  RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND,
  readReceiverDecisionInput,
} from './dispatch-receiver-decision-input.mjs';
import {
  CORRUPT_TRANSPORT_REQUEST,
  prepareDispatchTransportRequest,
  validateTransportRequest,
} from './dispatch-transport-contract.mjs';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import { CoordinationStore } from './store.mjs';
import { TASK_STATUS_CLAIMED } from './task-envelope.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = join(MODULE_DIRECTORY, 'dispatch-receiver-decision.mjs');
const MODULE_URL = pathToFileURL(MODULE_PATH).href;
const STORE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'store.mjs')).href;

// Task 18~23 predecessor source/spec bytes are pinned to the exact live-main
// baseline this decision primitive was built against. A change to any pinned
// file is a predecessor-contract change and must come from an explicitly
// predecessor-owning Task, never from this decision surface. store.mjs is the
// only composed predecessor file allowed to grow (additive primitives only),
// so it is not pinned; its untouched sections are covered by the byte
// immutability proofs below.
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

function makeHome(prefix = 'greenhub-decision24-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'DURABLE_RECEIVER_DECISION_PROVED',
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
    proofRequirement: ['durable-receiver-decision-proof'],
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

function decisionDir(home) {
  return join(home, RECEIVER_DECISIONS_DIRNAME);
}

function decisionPath(home, dispatchId) {
  return receiverDispatchDecisionFilePath(home, dispatchId);
}

function listDecisionFiles(home) {
  try {
    return [...readdirSync(decisionDir(home))].sort();
  } catch {
    return [];
  }
}

function countingDecisionStore(store) {
  const calls = [];
  const wrapper = {
    readReceiverDispatchAcceptance: (dispatchId, ...rest) => {
      calls.push({ op: 'readAcceptance', dispatchId, rest });
      return store.readReceiverDispatchAcceptance(dispatchId);
    },
    readReceiverDispatchDecision: (dispatchId, ...rest) => {
      calls.push({ op: 'readDecision', dispatchId, rest });
      return store.readReceiverDispatchDecision(dispatchId);
    },
    createReceiverDispatchDecision: (record, ...rest) => {
      calls.push({ op: 'createDecision', record, rest });
      return store.createReceiverDispatchDecision(record);
    },
  };
  return { calls, store: wrapper };
}

// Acceptance reader returns a caller-chosen request while decision durable
// primitives stay real: simulates same-dispatchId different-binding input.
function swappedAcceptanceStore(store, requestByCall) {
  let index = 0;
  return {
    readReceiverDispatchAcceptance: () => {
      const value = requestByCall[index];
      index += 1;
      if (value === undefined) {
        throw new Error('swapped acceptance reader exhausted');
      }
      return value;
    },
    readReceiverDispatchDecision: (dispatchId) => store.readReceiverDispatchDecision(dispatchId),
    createReceiverDispatchDecision: (record) => store.createReceiverDispatchDecision(record),
  };
}

function runFreshDecisionWorker({ home, dispatchId, includeRecord = false }) {
  return new Promise((resolveResult, rejectResult) => {
    const code = [
      'try {',
      `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
      `  const { persistReceiverDecision } = await import(${JSON.stringify(MODULE_URL)});`,
      `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
      `  const out = await persistReceiverDecision({ dispatchId: ${JSON.stringify(dispatchId)}, store });`,
      includeRecord
        ? `  const record = store.readReceiverDispatchDecision(${JSON.stringify(dispatchId)});`
        : '  const record = null;',
      '  console.log(JSON.stringify({ ok: true, result: out, record }));',
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
        rejectResult(new Error(`decision worker exit=${exitCode} stderr=${stderr}`));
        return;
      }
      try {
        resolveResult(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch (_error) {
        rejectResult(new Error(`decision worker output parse failed: ${stdout} / ${stderr}`));
      }
    });
  });
}

function expectedRecordBytes(record) {
  return JSON.stringify(record, null, 2);
}

// ---------------------------------------------------------------------------
// A. HAPPY PATH: Task 23 input -> exactly one durable decision -> read-back.
// ---------------------------------------------------------------------------

test('A. durable accepted input persists exactly one receiver decision with exact durable read-back', async () => {
  const { home, store, attempt, request } = await setupAccepted(
    'greenhub-decision24-a-',
    'DD24-A-SRC',
    'DD24-A-CHILD',
  );
  try {
    const input = await readReceiverDecisionInput({ dispatchId: attempt.dispatchId, store });
    assert.deepEqual(input, request);

    const before = snapshotHomeBytes(home);
    const { calls, store: spyStore } = countingDecisionStore(store);

    const result = await persistReceiverDecision({
      dispatchId: attempt.dispatchId,
      store: spyStore,
    });

    // Minimal frozen outcome: no ACK, no executor acceptance, no status.
    assert.deepEqual(result, { dispatchId: attempt.dispatchId, newlyDecided: true });
    assert.ok(Object.isFrozen(result));
    assert.deepEqual(Object.keys(result), ['dispatchId', 'newlyDecided']);

    // Exactly one durable record at the dispatchId-only path.
    assert.deepEqual(listDecisionFiles(home), [`${attempt.dispatchId}.json`]);
    const path = decisionPath(home, attempt.dispatchId);
    const bytes = readFileSync(path, 'utf8');
    const stored = store.readReceiverDispatchDecision(attempt.dispatchId);

    // Exact schema and exact input binding; no wrapper metadata.
    assert.deepEqual(Object.keys(stored), [...RECEIVER_DECISION_RECORD_FIELDS]);
    assert.equal(stored.schemaVersion, RECEIVER_DECISION_SCHEMA_VERSION);
    assert.equal(stored.dispatchId, attempt.dispatchId);
    assert.equal(stored.decision, RECEIVER_DECISION_VALUE);
    assert.deepEqual(stored.decisionInput, input);
    assert.equal(JSON.stringify(stored.decisionInput), JSON.stringify(input));
    assert.deepEqual(validateTransportRequest(stored.decisionInput), input);
    assert.ok(Object.isFrozen(stored));
    assert.ok(Object.isFrozen(stored.decisionInput));

    // Durable read-back: canonical bytes reopen to the exact validated record.
    assert.equal(bytes, expectedRecordBytes(stored));
    assert.deepEqual(validateReceiverDecisionRecord(JSON.parse(bytes)), stored);
    assert.deepEqual(stored, buildReceiverDecisionRecord(input));

    // Task 23 entry was used with dispatchId only, and the record write went
    // through the store create primitive once.
    assert.equal(calls[0].op, 'readAcceptance');
    assert.equal(calls[0].dispatchId, attempt.dispatchId);
    assert.deepEqual(calls[0].rest, []);
    assert.equal(calls.filter((call) => call.op === 'createDecision').length, 1);
    const createCall = calls.find((call) => call.op === 'createDecision');
    assert.deepEqual(createCall.record, stored);
    assert.deepEqual(createCall.rest, []);

    // Only new durable path is the decision file: no ACK, no receipt, no
    // generation, no task status mutation.
    const after = snapshotHomeBytes(home);
    const added = Object.keys(after).filter((name) => !(name in before));
    assert.deepEqual(added, [join(RECEIVER_DECISIONS_DIRNAME, `${attempt.dispatchId}.json`)]);
    assert.equal(store.readTask('DD24-A-CHILD').status, TASK_STATUS_CLAIMED);
    assert.equal(existsSync(join(home, 'tasks', 'DD24-A-CHILD', 'ack.json')), false);
    assert.equal(existsSync(join(home, 'tasks', 'DD24-A-CHILD', 'receipt.json')), false);
    assert.equal(existsSync(join(home, 'tasks', 'DD24-A-CHILD', 'receiver-ack.json')), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// B. EXACT REPLAY: no rewrite, no new file, no generation increment.
// ---------------------------------------------------------------------------

test('B. exact replay is idempotent: byte-identical record under clock/process skew with no rewrite', async () => {
  const { home, clock, store, attempt, request } = await setupAccepted(
    'greenhub-decision24-b-',
    'DD24-B-SRC',
    'DD24-B-CHILD',
  );
  try {
    const first = await persistReceiverDecision({ dispatchId: attempt.dispatchId, store });
    assert.equal(first.newlyDecided, true);
    const path = decisionPath(home, attempt.dispatchId);
    const bytes = readFileSync(path, 'utf8');
    const mtimeMs = statSync(path).mtimeMs;

    const replayOne = await persistReceiverDecision({ dispatchId: attempt.dispatchId, store });

    clock.advance(365 * 86_400_000);
    const skewedStore = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const replayTwo = await persistReceiverDecision({
      dispatchId: attempt.dispatchId,
      store: skewedStore,
    });

    clock.advance(-2 * 365 * 86_400_000);
    const clonedStore = {
      readReceiverDispatchAcceptance: (dispatchId) =>
        JSON.parse(JSON.stringify(store.readReceiverDispatchAcceptance(dispatchId))),
      readReceiverDispatchDecision: (dispatchId) =>
        JSON.parse(JSON.stringify(store.readReceiverDispatchDecision(dispatchId))),
      createReceiverDispatchDecision: (record) => store.createReceiverDispatchDecision(record),
    };
    const replayThree = await persistReceiverDecision({
      dispatchId: attempt.dispatchId,
      store: clonedStore,
    });

    for (const replay of [replayOne, replayTwo, replayThree]) {
      assert.deepEqual(replay, {
        dispatchId: attempt.dispatchId,
        newlyDecided: false,
        exactReplay: true,
      });
      assert.ok(Object.isFrozen(replay));
      assert.deepEqual(Object.keys(replay), ['dispatchId', 'newlyDecided', 'exactReplay']);
    }

    // No rewrite, no byte change, no new file, no generation increment.
    assert.equal(readFileSync(path, 'utf8'), bytes);
    assert.equal(statSync(path).mtimeMs, mtimeMs);
    assert.deepEqual(listDecisionFiles(home), [`${attempt.dispatchId}.json`]);
    const stored = store.readReceiverDispatchDecision(attempt.dispatchId);
    assert.equal(stored.decisionInput.claimGeneration, request.claimGeneration);
    assert.equal(Object.hasOwn(stored, 'decisionGeneration'), false);
    assert.equal(Object.hasOwn(stored, 'receiverGeneration'), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// C. FRESH PROCESS: byte-identical durable record and replay outcome.
// ---------------------------------------------------------------------------

test('C. fresh process replays the durable decision byte-identically', {
  timeout: 60_000,
}, async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-decision24-c-',
    'DD24-C-SRC',
    'DD24-C-CHILD',
  );
  try {
    const first = await persistReceiverDecision({ dispatchId: attempt.dispatchId, store });
    assert.equal(first.newlyDecided, true);
    const bytes = readFileSync(decisionPath(home, attempt.dispatchId), 'utf8');

    const worker = await runFreshDecisionWorker({
      home,
      dispatchId: attempt.dispatchId,
      includeRecord: true,
    });
    assert.equal(worker.ok, true, JSON.stringify(worker));
    assert.deepEqual(worker.result, {
      dispatchId: attempt.dispatchId,
      newlyDecided: false,
      exactReplay: true,
    });
    assert.equal(
      JSON.stringify(worker.record),
      JSON.stringify(store.readReceiverDispatchDecision(attempt.dispatchId)),
    );
    assert.equal(readFileSync(decisionPath(home, attempt.dispatchId), 'utf8'), bytes);
    assert.deepEqual(listDecisionFiles(home), [`${attempt.dispatchId}.json`]);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// D. CONCURRENT SAME-INPUT CREATE (single process).
// ---------------------------------------------------------------------------

test('D. concurrent same-input persists converge on exactly one durable record', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-decision24-d-',
    'DD24-D-SRC',
    'DD24-D-CHILD',
  );
  try {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        persistReceiverDecision({ dispatchId: attempt.dispatchId, store }),
      ),
    );
    const winners = results.filter((entry) => entry.newlyDecided === true);
    const replays = results.filter(
      (entry) => entry.newlyDecided === false && entry.exactReplay === true,
    );
    assert.equal(winners.length, 1);
    assert.equal(replays.length, 5);
    for (const entry of results) {
      assert.equal(entry.dispatchId, attempt.dispatchId);
      assert.ok(Object.isFrozen(entry));
    }

    // Exactly one immutable record; the winner request binds the input.
    assert.deepEqual(listDecisionFiles(home), [`${attempt.dispatchId}.json`]);
    const stored = store.readReceiverDispatchDecision(attempt.dispatchId);
    assert.equal(
      readFileSync(decisionPath(home, attempt.dispatchId), 'utf8'),
      expectedRecordBytes(stored),
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. CONCURRENT CREATE ACROSS SEPARATE PROCESSES (OS exclusive-create race).
// ---------------------------------------------------------------------------

test('E. separate-process race yields exactly one OS exclusive-create winner', {
  timeout: 120_000,
}, async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-decision24-e-',
    'DD24-E-SRC',
    'DD24-E-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () =>
        runFreshDecisionWorker({ home, dispatchId: attempt.dispatchId }),
      ),
    );
    for (const outcome of outcomes) {
      assert.equal(outcome.ok, true, JSON.stringify(outcome));
    }
    const winners = outcomes.filter((outcome) => outcome.result.newlyDecided === true);
    const replays = outcomes.filter(
      (outcome) => outcome.result.newlyDecided === false && outcome.result.exactReplay === true,
    );
    assert.equal(winners.length, 1, JSON.stringify(outcomes));
    assert.equal(replays.length, 5);

    assert.deepEqual(listDecisionFiles(home), [`${attempt.dispatchId}.json`]);
    const stored = store.readReceiverDispatchDecision(attempt.dispatchId);
    assert.equal(
      readFileSync(decisionPath(home, attempt.dispatchId), 'utf8'),
      expectedRecordBytes(stored),
    );

    // Decision file is the only new durable path.
    const after = snapshotHomeBytes(home);
    const added = Object.keys(after).filter((name) => !(name in before));
    assert.equal(added.length, 1);
    assert.ok(added[0].includes(`${attempt.dispatchId}.json`));
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. MISSING INPUT: Task 23 failure only, zero decision side effect.
// ---------------------------------------------------------------------------

test('F. missing Task 23 input fails with the predecessor code and writes nothing', async () => {
  const home = makeHome('greenhub-decision24-f-');
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'DD24-F-SRC',
      'DD24-F-CHILD',
      'result-dd24-f-src',
    );
    assert.equal(store.readReceiverDispatchAcceptance(attempt.dispatchId), null);
    const before = snapshotHomeBytes(home);
    const { calls, store: spyStore } = countingDecisionStore(store);

    await assert.rejects(
      persistReceiverDecision({ dispatchId: attempt.dispatchId, store: spyStore }),
      (error) => error?.code === RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND,
    );

    // Acceptance read happened exactly once with dispatchId only; no decision
    // read, no decision create, no acceptance auto-creation, no retry.
    const acceptanceReads = calls.filter((call) => call.op === 'readAcceptance');
    assert.equal(acceptanceReads.length, 1);
    assert.equal(acceptanceReads[0].dispatchId, attempt.dispatchId);
    assert.deepEqual(acceptanceReads[0].rest, []);
    assert.equal(
      calls.some((call) => call.op === 'createDecision'),
      false,
    );
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.equal(existsSync(decisionDir(home)), false);
    assert.equal(store.readReceiverDispatchAcceptance(attempt.dispatchId), null);
    assert.equal(store.readTask('DD24-F-CHILD').status, TASK_STATUS_CLAIMED);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// G. INVALID IDENTITY / INVALID STORE.
// ---------------------------------------------------------------------------

test('G. invalid dispatchId and invalid stores fail closed before any decision access', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-decision24-g-',
    'DD24-G-SRC',
    'DD24-G-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);

    // Invalid identity: Task 23 identity validation runs first; the reader is
    // never invoked and no decision capability is touched.
    let acceptanceReads = 0;
    const countingAcceptanceStore = {
      readReceiverDispatchAcceptance: (dispatchId) => {
        acceptanceReads += 1;
        return store.readReceiverDispatchAcceptance(dispatchId);
      },
      readReceiverDispatchDecision: (dispatchId) => store.readReceiverDispatchDecision(dispatchId),
      createReceiverDispatchDecision: (record) => store.createReceiverDispatchDecision(record),
    };
    for (const invalidId of [
      undefined,
      null,
      '',
      'not-a-dispatch-id',
      'dsp_',
      `dsp_${'a'.repeat(63)}`,
      `dsp_${'A'.repeat(64)}`,
      `../dsp_${'a'.repeat(64)}`,
      42,
      {},
    ]) {
      await assert.rejects(
        persistReceiverDecision({ dispatchId: invalidId, store: countingAcceptanceStore }),
        (error) => error != null,
      );
    }
    assert.equal(acceptanceReads, 0);

    // Invalid stores: fail with the decision-native store code; no read, no
    // write, no probe invocation.
    let probeCalls = 0;
    const invalidStores = [
      undefined,
      null,
      'store',
      42,
      {},
      { readReceiverDispatchAcceptance: () => null },
      { readReceiverDispatchDecision: () => null },
      { createReceiverDispatchDecision: () => ({ created: true }) },
      {
        readReceiverDispatchAcceptance: () => {
          probeCalls += 1;
          return null;
        },
        readReceiverDispatchDecision: 7,
        createReceiverDispatchDecision: 7,
      },
    ];
    for (const invalidStore of invalidStores) {
      await assert.rejects(
        persistReceiverDecision({ dispatchId: attempt.dispatchId, store: invalidStore }),
        (error) =>
          error instanceof ReceiverDecisionError && error.code === INVALID_RECEIVER_DECISION_STORE,
      );
    }
    assert.equal(probeCalls, 0);
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.equal(existsSync(decisionPath(home, attempt.dispatchId)), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// H. CORRUPT INPUT: predecessor codes propagate, zero decision persistence.
// ---------------------------------------------------------------------------

test('H. corrupt Task 23/20/22 input fails closed with predecessor codes and no decision file', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-decision24-h-',
    'DD24-H-SRC',
    'DD24-H-CHILD',
  );
  try {
    const path = acceptancePath(home, attempt.dispatchId);
    const pristineBytes = readFileSync(path, 'utf8');
    const request = JSON.parse(pristineBytes);
    const variants = [
      {
        name: 'unparseable acceptance bytes',
        bytes: '{ not json',
        code: 'CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE',
      },
      {
        name: 'valid JSON, invalid transport request',
        bytes: JSON.stringify({ hello: 'not-a-transport-request' }, null, 2),
        code: CORRUPT_TRANSPORT_REQUEST,
      },
      {
        name: 'binding drift (workerId tamper)',
        bytes: JSON.stringify({ ...request, workerId: 'worker-tampered' }, null, 2),
        code: 'DISPATCH_BINDING_MISMATCH',
      },
      {
        name: 'generation smuggling',
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
        persistReceiverDecision({ dispatchId: attempt.dispatchId, store }),
        (error) => error?.code === variant.code,
        variant.name,
      );
      // No decision file, no repair, no predecessor rewrite.
      assert.equal(existsSync(decisionDir(home)), false, variant.name);
      assert.equal(readFileSync(path, 'utf8'), variant.bytes, variant.name);
    }

    // Restoring the exact acceptance bytes re-enables the decision path.
    writeFileSync(path, pristineBytes, 'utf8');
    const result = await persistReceiverDecision({ dispatchId: attempt.dispatchId, store });
    assert.equal(result.newlyDecided, true);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// I. CORRUPT DURABLE DECISION: fail closed, bytes preserved, no repair.
// ---------------------------------------------------------------------------

test('I. corrupt durable decision fails closed with exact bytes preserved and no repair', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-decision24-i-',
    'DD24-I-SRC',
    'DD24-I-CHILD',
  );
  try {
    const path = decisionPath(home, attempt.dispatchId);
    mkdirSync(decisionDir(home), { recursive: true });
    await persistReceiverDecision({ dispatchId: attempt.dispatchId, store });
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
    ];

    for (const variant of variants) {
      writeFileSync(path, variant.bytes, 'utf8');
      await assert.rejects(
        persistReceiverDecision({ dispatchId: attempt.dispatchId, store }),
        (error) => error?.code === variant.code,
        variant.name,
      );
      // Fail closed with zero repair, overwrite, truncation, delete, rewrite.
      assert.equal(readFileSync(path, 'utf8'), variant.bytes, variant.name);
      assert.deepEqual(listDecisionFiles(home), [`${attempt.dispatchId}.json`], variant.name);
    }

    // Wrong-key record under this dispatchId path also fails closed.
    const otherHome = await setupAccepted(
      'greenhub-decision24-i2-',
      'DD24-I2-SRC',
      'DD24-I2-CHILD',
    );
    try {
      const otherPath = decisionPath(otherHome.home, otherHome.attempt.dispatchId);
      await persistReceiverDecision({
        dispatchId: otherHome.attempt.dispatchId,
        store: otherHome.store,
      });
      const foreignBytes = readFileSync(otherPath, 'utf8');
      writeFileSync(path, foreignBytes, 'utf8');
      await assert.rejects(
        persistReceiverDecision({ dispatchId: attempt.dispatchId, store }),
        (error) => error?.code === CORRUPT_RECEIVER_DISPATCH_DECISION,
      );
      assert.equal(readFileSync(path, 'utf8'), foreignBytes);
    } finally {
      removeHome(otherHome.home);
    }

    // A valid good record still replays once restored, and the store read
    // fails closed for wrong identities, corrupt bytes, and missing records.
    writeFileSync(path, goodBytes, 'utf8');
    const replay = await persistReceiverDecision({ dispatchId: attempt.dispatchId, store });
    assert.deepEqual(replay, {
      dispatchId: attempt.dispatchId,
      newlyDecided: false,
      exactReplay: true,
    });
    assert.equal(store.readReceiverDispatchDecision(attempt.dispatchId) !== null, true);
    assert.throws(
      () => store.readReceiverDispatchDecision('not-a-dispatch-id'),
      (error) => error?.code === CORRUPT_RECEIVER_DISPATCH_DECISION,
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// J. CONFLICT: same dispatchId + different valid binding fails closed.
// ---------------------------------------------------------------------------

test('J. different valid binding under the same dispatchId fails closed with first winner preserved', async () => {
  const { home, store, attempt, request } = await setupAccepted(
    'greenhub-decision24-j-',
    'DD24-J-SRC',
    'DD24-J-CHILD',
  );
  try {
    const path = decisionPath(home, attempt.dispatchId);
    const first = await persistReceiverDecision({ dispatchId: attempt.dispatchId, store });
    assert.equal(first.newlyDecided, true);
    const winnerBytes = readFileSync(path, 'utf8');
    const winner = store.readReceiverDispatchDecision(attempt.dispatchId);

    // Different valid Task 20 request with the SAME dispatchId (provenance
    // tamper that still validates) exposed through a caller-supplied
    // acceptance reader; the durable decision winner must never change.
    const alternate = validateTransportRequest({ ...request, sourceTaskId: 'DD24-J-OTHER' });
    assert.equal(alternate.dispatchId, request.dispatchId);
    const swappedStore = swappedAcceptanceStore(store, [alternate]);
    await assert.rejects(
      persistReceiverDecision({ dispatchId: attempt.dispatchId, store: swappedStore }),
      (error) =>
        error instanceof ReceiverDecisionError && error.code === RECEIVER_DECISION_CONFLICT,
    );
    assert.equal(readFileSync(path, 'utf8'), winnerBytes);
    assert.deepEqual(store.readReceiverDispatchDecision(attempt.dispatchId), winner);
    assert.deepEqual(listDecisionFiles(home), [`${attempt.dispatchId}.json`]);

    // Direct store create of the conflicting candidate cannot overwrite.
    const candidate = buildReceiverDecisionRecord(alternate);
    assert.deepEqual(store.createReceiverDispatchDecision(candidate), { created: false });
    assert.equal(readFileSync(path, 'utf8'), winnerBytes);

    // Acceptance replacement simulation: candidate must still conflict.
    writeFileSync(acceptancePath(home, attempt.dispatchId), JSON.stringify(alternate, null, 2));
    await assert.rejects(
      persistReceiverDecision({ dispatchId: attempt.dispatchId, store }),
      (error) => error?.code === RECEIVER_DECISION_CONFLICT,
    );
    assert.equal(readFileSync(path, 'utf8'), winnerBytes);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// K. NO PREDECESSOR MUTATION.
// ---------------------------------------------------------------------------

test('K. decision persistence leaves every predecessor durable byte identical', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-decision24-k-',
    'DD24-K-SRC',
    'DD24-K-CHILD',
  );
  try {
    const fixedPaths = {
      sourceTask: join(home, 'tasks', 'DD24-K-SRC', 'task.json'),
      childTask: join(home, 'tasks', 'DD24-K-CHILD', 'task.json'),
      childClaim: join(home, 'tasks', 'DD24-K-CHILD', 'claim.json'),
      emission: join(home, 'tasks', 'DD24-K-SRC', 'emissions', 'next.json'),
      admission: join(home, 'tasks', 'DD24-K-SRC', 'emission-admissions', 'next.json'),
      attempt: join(home, 'tasks', 'DD24-K-SRC', 'dispatch-attempts', `${attempt.dispatchId}.json`),
      sourceResult: join(home, 'tasks', 'DD24-K-SRC', 'result.json'),
      sourceDisposition: join(home, 'tasks', 'DD24-K-SRC', 'disposition', 'current.json'),
      materialization: join(home, 'tasks', 'DD24-K-SRC', 'materialization.json'),
      ack: join(home, 'tasks', 'DD24-K-SRC', 'ack.json'),
      consumed: join(home, 'tasks', 'DD24-K-SRC', 'consumed.json'),
      acceptance: acceptancePath(home, attempt.dispatchId),
    };
    const beforeBytes = {};
    for (const [name, path] of Object.entries(fixedPaths)) {
      beforeBytes[name] = readFileSync(path, 'utf8');
    }
    const before = snapshotHomeBytes(home);

    const first = await persistReceiverDecision({ dispatchId: attempt.dispatchId, store });
    assert.equal(first.newlyDecided, true);
    await persistReceiverDecision({ dispatchId: attempt.dispatchId, store });

    for (const [name, path] of Object.entries(fixedPaths)) {
      assert.equal(
        readFileSync(path, 'utf8'),
        beforeBytes[name],
        `${name} must stay byte-identical`,
      );
    }
    const after = snapshotHomeBytes(home);
    const added = Object.keys(after).filter((name) => !(name in before));
    assert.equal(added.length, 1);
    assert.ok(added[0].includes(`${attempt.dispatchId}.json`));
    assert.equal(added[0].includes(RECEIVER_DECISIONS_DIRNAME), true);
    assert.equal(store.readTask('DD24-K-CHILD').status, TASK_STATUS_CLAIMED);
    assert.deepEqual(
      store.readDispatchAttempt({ sourceTaskId: 'DD24-K-SRC', dispatchId: attempt.dispatchId }),
      attempt,
    );

    // No ACK / receipt / consumed / executor artifact for the child and no
    // process/timestamp metadata inside the decision record.
    const record = store.readReceiverDispatchDecision(attempt.dispatchId);
    const recordJson = JSON.stringify(record);
    for (const forbidden of [
      '"ack"',
      '"acknowledgedAt"',
      '"receipt"',
      '"executor"',
      '"scheduler"',
      '"retry"',
      '"decidedAt"',
      '"decided"',
      '"executionAllowed"',
    ]) {
      assert.equal(recordJson.includes(forbidden), false, `${forbidden} must not appear`);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// L. DETERMINISM: same input + dispatchId -> identical durable representation.
// ---------------------------------------------------------------------------

test('L. decision identity/content is clock-free, process-free, and canonical', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-decision24-l-',
    'DD24-L-SRC',
    'DD24-L-CHILD',
  );
  try {
    const input = await readReceiverDecisionInput({ dispatchId: attempt.dispatchId, store });
    const baseline = buildReceiverDecisionRecord(input);
    assert.ok(Object.isFrozen(baseline));
    assert.deepEqual(Object.keys(baseline), [...RECEIVER_DECISION_RECORD_FIELDS]);
    for (let replay = 0; replay < 10; replay += 1) {
      const out = buildReceiverDecisionRecord(JSON.parse(JSON.stringify(input)));
      assert.equal(JSON.stringify(out), JSON.stringify(baseline));
      assert.deepEqual(out, baseline);
    }
    // Pure builder takes no clock: identity is input-derived only.
    const skewed = buildReceiverDecisionRecord(input);
    assert.equal(JSON.stringify(skewed), JSON.stringify(baseline));
    assert.equal(baseline.decisionInput.claimGeneration, input.claimGeneration);
    assert.equal(baseline.dispatchId, input.dispatchId);
    assert.equal(baseline.decision, RECEIVER_DECISION_VALUE);

    // Durable read-back under clock skew and fresh stores is byte-stable.
    const first = await persistReceiverDecision({ dispatchId: attempt.dispatchId, store });
    assert.equal(first.newlyDecided, true);
    const bytes = readFileSync(decisionPath(home, attempt.dispatchId), 'utf8');
    const freshStore = new CoordinationStore({ dir: home });
    assert.equal(
      JSON.stringify(freshStore.readReceiverDispatchDecision(attempt.dispatchId)),
      JSON.stringify(baseline),
    );
    assert.equal(readFileSync(decisionPath(home, attempt.dispatchId), 'utf8'), bytes);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// M. FORBIDDEN BOUNDARY (source boundary, code only) + store surface.
// ---------------------------------------------------------------------------

test('M. production module has no ACK/executor/scheduler/retry/new-generation/fs/transport authority', () => {
  const code = codeOnly(readFileSync(MODULE_PATH, 'utf8'));
  // Remove prohibition literals (blocked-field names quoted in the source):
  // occurrences elsewhere in functional code remain detectable.
  let scopedCode = code;
  for (const literal of BLOCKED_RECEIVER_DECISION_FIELDS) {
    scopedCode = scopedCode.split(`'${literal}'`).join('').split(`"${literal}"`).join('');
  }
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
    assert.equal(scopedCode.includes(forbidden), false, `code must not contain ${forbidden}`);
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
    'TASK_STATUS_DISPATCHED',
    'TASK_STATUS_ACCEPTED',
  ]) {
    assert.equal(code.includes(status), false, `${status} must not exist in code`);
  }
  // The decision boundary composes the Task 23 entry and the Task 20
  // validator verbatim, and only persists through the store primitive.
  assert.ok(code.includes('readReceiverDecisionInput('));
  assert.ok(code.includes('store.readReceiverDispatchDecision('));
  assert.ok(code.includes('store.createReceiverDispatchDecision('));
  assert.ok(code.includes('validateTransportRequest('));

  // Exported surface: only the documented constants/helpers/entry + error.
  const exportedFunctions = Object.entries(decisionModule)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(exportedFunctions, [
    'ReceiverDecisionError',
    'assertValidReceiverDecisionDispatchId',
    'buildReceiverDecisionRecord',
    'persistReceiverDecision',
    'receiverDecisionFileName',
    'receiverDispatchDecisionFilePath',
    'validateReceiverDecisionRecord',
  ]);
  assert.equal(typeof ReceiverDecisionError, 'function');
});

test('M2. store exposes the minimal receiver-decision primitive and keeps forbidden authority absent', () => {
  const home = makeHome('greenhub-decision24-m2-');
  try {
    const store = new CoordinationStore({ dir: home });
    assert.equal(typeof store.readReceiverDispatchDecision, 'function');
    assert.equal(typeof store.createReceiverDispatchDecision, 'function');
    assert.equal(typeof store.readReceiverDispatchAcceptance, 'function');
    assert.equal(typeof store.createReceiverDispatchAcceptance, 'function');
    for (const forbidden of [
      'acknowledgeDispatch',
      'ackDispatch',
      'executeTask',
      'executeDispatch',
      'scheduleNextTask',
      'selectWorker',
      'inferWorker',
      'retryDispatch',
      'resendDispatch',
      'backoffDispatch',
      'decideNextTask',
    ]) {
      assert.equal(store[forbidden], undefined, `store.${forbidden} must not exist`);
    }

    // The durable domain uses OS exclusive-create and never exists()->write().
    const storeSource = readFileSync(join(MODULE_DIRECTORY, 'store.mjs'), 'utf8');
    const start = storeSource.indexOf('Durable receiver dispatch decision domain');
    const end = storeSource.indexOf('Claim-bound dispatch envelope domain', start);
    assert.ok(start > 0 && end > start, 'decision domain section must exist');
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
// N. PREDECESSOR IMMUTABILITY + full durable read-only composition.
// ---------------------------------------------------------------------------

test('N. Task 18~23 predecessor source/spec bytes are unchanged', () => {
  for (const [name, expected] of Object.entries(PREDECESSOR_SHA256)) {
    const actual = createHash('sha256')
      .update(readFileSync(join(MODULE_DIRECTORY, name)))
      .digest('hex');
    assert.equal(actual, expected, `${name} must stay byte-identical`);
  }
});

test('O. one dispatchId carries at most one immutable decision across every path', async () => {
  const { home, store, attempt } = await setupAccepted(
    'greenhub-decision24-o-',
    'DD24-O-SRC',
    'DD24-O-CHILD',
  );
  try {
    // First create wins; all later attempts from any angle replay or conflict.
    const created = await persistReceiverDecision({ dispatchId: attempt.dispatchId, store });
    assert.equal(created.newlyDecided, true);
    const path = decisionPath(home, attempt.dispatchId);
    const bytes = readFileSync(path, 'utf8');

    const replayCalls = await Promise.all([
      persistReceiverDecision({ dispatchId: attempt.dispatchId, store }),
      persistReceiverDecision({ dispatchId: attempt.dispatchId, store }),
      persistReceiverDecision({ dispatchId: attempt.dispatchId, store }),
    ]);
    for (const replay of replayCalls) {
      assert.equal(replay.newlyDecided, false);
      assert.equal(replay.exactReplay, true);
    }
    assert.equal(readFileSync(path, 'utf8'), bytes);
    assert.deepEqual(listDecisionFiles(home), [`${attempt.dispatchId}.json`]);

    // Store primitives reject invalid records before any write.
    for (const invalidRecord of [
      null,
      'not-a-record',
      {},
      { ...store.readReceiverDispatchDecision(attempt.dispatchId), decision: 'NOPE' },
      { ...store.readReceiverDispatchDecision(attempt.dispatchId), decidedAt: 'now' },
    ]) {
      let observed;
      try {
        store.createReceiverDispatchDecision(invalidRecord);
      } catch (error) {
        observed = error;
      }
      assert.notEqual(observed, undefined, 'invalid record must fail closed');
    }
    assert.equal(readFileSync(path, 'utf8'), bytes);
    assert.deepEqual(listDecisionFiles(home), [`${attempt.dispatchId}.json`]);
  } finally {
    removeHome(home);
  }
});
