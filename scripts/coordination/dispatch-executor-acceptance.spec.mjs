// Proof for GREENHUB-COORDINATION-DURABLE-EXECUTOR-ACCEPTANCE-26.
//
// DURABLE_EXECUTOR_ACCEPTANCE != ACK != receipt != sender acknowledgment
// != receiver acknowledgment != delivery confirmation != executor invocation
// != execution start != task status transition != scheduler decision
// != worker/executor selection != retry/resend authority
// != new generation/fencing authority != delivery success.
// read != accept != ACK != execute. accepted != invoked != started != completed.
//
// The acceptance entry is EXACTLY:
//   (dispatchId, store)
//     -> store capability gate (readReceiverDispatchDecision /
//        readExecutorDispatchAcceptance / createExecutorDispatchAcceptance)
//     -> readReceiverExecutorAcceptanceInput({ dispatchId, store })
//        [Task 25 verbatim: dispatchId identity first, durable receiver-decision
//         read, Task 24 validation; missing/corrupt input fails closed with
//         predecessor codes propagated UNCHANGED; no write]
//     -> existing acceptance: exact serialized replay or conflict (first wins)
//     -> unseen: OS exclusive-create under
//        <home>/executor-acceptances/<dispatchId>.json of the EXACT Task 24
//        record (no wrapper metadata; path authority = acceptance fact)
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
import * as executorAcceptanceModule from './dispatch-executor-acceptance.mjs';
import {
  acceptExecutorDispatchDecision,
  CORRUPT_EXECUTOR_DISPATCH_ACCEPTANCE,
  EXECUTOR_ACCEPTANCE_NEW_FIELDS,
  EXECUTOR_ACCEPTANCE_REPLAY_FIELDS,
  EXECUTOR_ACCEPTANCES_DIRNAME,
  EXECUTOR_DISPATCH_ACCEPTANCE_CONFLICT,
  ExecutorAcceptanceError,
  executorDispatchAcceptanceFilePath,
  INVALID_EXECUTOR_ACCEPTANCE_STORE,
} from './dispatch-executor-acceptance.mjs';
import { acceptReceiverDispatch } from './dispatch-receiver-acceptance.mjs';
import {
  CORRUPT_RECEIVER_DISPATCH_DECISION,
  persistReceiverDecision,
  RECEIVER_DECISION_VALUE,
  RECEIVER_DECISIONS_DIRNAME,
  receiverDispatchDecisionFilePath,
} from './dispatch-receiver-decision.mjs';
import {
  RECEIVER_DISPATCH_DECISION_NOT_FOUND,
  readReceiverExecutorAcceptanceInput,
} from './dispatch-receiver-executor-acceptance-input.mjs';
import {
  CORRUPT_TRANSPORT_REQUEST,
  prepareDispatchTransportRequest,
  TRANSPORT_REQUEST_FIELDS,
} from './dispatch-transport-contract.mjs';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import { CoordinationStore } from './store.mjs';
import { TASK_STATUS_CLAIMED } from './task-envelope.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = join(MODULE_DIRECTORY, 'dispatch-executor-acceptance.mjs');
const MODULE_URL = pathToFileURL(MODULE_PATH).href;
const STORE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'store.mjs')).href;

// Task 18~25 predecessor source/spec bytes are pinned to the exact live-main
// baseline this durable acceptance was built against. A change to any pinned
// file is a predecessor-contract change and must come from an explicitly
// predecessor-owning Task, never from this acceptance surface. store.mjs is
// the only composed predecessor file allowed to grow (additive primitives
// only), so it is not pinned; its untouched sections are covered by the
// byte-immutability proofs below.
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
});

const FORBIDDEN_NEW_ARTIFACT_DIRS = Object.freeze([
  'executor-acceptance-input',
  'executor-inputs',
  'receiver-consumption',
  'decision-consumed',
  'receipt',
  'receipts',
  'ack',
  'acks',
  'invocations',
  'scheduler',
  'queue',
  'retry',
  'backoff',
  'dispatched',
  'sent',
  'running',
  'execution',
]);

function makeHome(prefix = 'greenhub-executor-acceptance26-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'DURABLE_EXECUTOR_ACCEPTANCE_PROVED',
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
    proofRequirement: ['durable-executor-acceptance-proof'],
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

// End-to-end Task 25 setup: source -> child claim -> durable dispatch attempt
// -> Task 20 request -> Task 22 durable acceptance -> Task 24 durable receiver
// decision (executor-acceptance input).
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

function decisionDir(home) {
  return join(home, RECEIVER_DECISIONS_DIRNAME);
}

function decisionPath(home, dispatchId) {
  return receiverDispatchDecisionFilePath(home, dispatchId);
}

function executorAcceptanceDir(home) {
  return join(home, EXECUTOR_ACCEPTANCES_DIRNAME);
}

function executorAcceptancePath(home, dispatchId) {
  return executorDispatchAcceptanceFilePath(home, dispatchId);
}

function listExecutorAcceptanceFiles(home) {
  try {
    return [...readdirSync(executorAcceptanceDir(home))].sort();
  } catch {
    return [];
  }
}

function expectedRecordBytes(record) {
  return JSON.stringify(record, null, 2);
}

// Same-dispatchId record that stays valid (Task 24/20 validation passes) but
// carries a different inner binding (task.desiredExitState): the canonical
// same-key/different-value conflict fixture.
function differentValidRecord(store, dispatchId) {
  const good = store.readReceiverDispatchDecision(dispatchId);
  const record = JSON.parse(JSON.stringify(good));
  record.decisionInput.task.desiredExitState = 'DIFFERENT_VALID_ACCEPTANCE_BINDING';
  return record;
}

function countingStore(store) {
  const calls = [];
  const wrapper = {
    readReceiverDispatchDecision: (dispatchId, ...rest) => {
      calls.push({ op: 'readDecision', dispatchId, rest });
      return store.readReceiverDispatchDecision(dispatchId);
    },
    readExecutorDispatchAcceptance: (dispatchId, ...rest) => {
      calls.push({ op: 'readAcceptance', dispatchId, rest });
      return store.readExecutorDispatchAcceptance(dispatchId);
    },
    createExecutorDispatchAcceptance: (record, ...rest) => {
      calls.push({ op: 'createAcceptance', record, rest });
      return store.createExecutorDispatchAcceptance(record);
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

function runFreshAcceptanceWorker({ home, dispatchId, includeRecord = false }) {
  return new Promise((resolveResult, rejectResult) => {
    const code = [
      'try {',
      `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
      `  const { acceptExecutorDispatchDecision } = await import(${JSON.stringify(MODULE_URL)});`,
      `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
      `  const out = await acceptExecutorDispatchDecision({ dispatchId: ${JSON.stringify(dispatchId)}, store });`,
      includeRecord
        ? `  const record = store.readExecutorDispatchAcceptance(${JSON.stringify(dispatchId)});`
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
        rejectResult(new Error(`acceptance worker exit=${exitCode} stderr=${stderr}`));
        return;
      }
      try {
        resolveResult(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch (_error) {
        rejectResult(new Error(`acceptance worker output parse failed: ${stdout} / ${stderr}`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// A. HAPPY PATH: Task 25 input -> exactly one durable acceptance -> read-back.
// ---------------------------------------------------------------------------

test('A. durable executor acceptance persists the exact Task 24 record under dispatchId-only path authority', async () => {
  const { home, store, attempt } = await setupDecided(
    'greenhub-executor-acceptance26-a-',
    'EA26-A-SRC',
    'EA26-A-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const result = await acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store });
    assert.ok(Object.isFrozen(result));
    assert.deepEqual(Object.keys(result), [...EXECUTOR_ACCEPTANCE_NEW_FIELDS]);
    assert.deepEqual(result, { dispatchId: attempt.dispatchId, newlyAccepted: true });

    // The durable value is EXACTLY the validated Task 24 record: byte-equal to
    // the receiver-decision file and to the Task 25 reader result. The
    // executor-acceptance fact is expressed by the path authority ONLY.
    const path = executorAcceptancePath(home, attempt.dispatchId);
    const stored = store.readExecutorDispatchAcceptance(attempt.dispatchId);
    const viaTask25 = await readReceiverExecutorAcceptanceInput({
      dispatchId: attempt.dispatchId,
      store,
    });
    assert.equal(
      readFileSync(path, 'utf8'),
      readFileSync(decisionPath(home, attempt.dispatchId), 'utf8'),
    );
    assert.equal(readFileSync(path, 'utf8'), expectedRecordBytes(stored));
    assert.equal(JSON.stringify(stored), JSON.stringify(viaTask25));
    assert.equal(stored.decision, RECEIVER_DECISION_VALUE);
    assert.deepEqual(Object.keys(stored), [
      'schemaVersion',
      'dispatchId',
      'decision',
      'decisionInput',
    ]);
    assert.deepEqual(Object.keys(stored.decisionInput), [...TRANSPORT_REQUEST_FIELDS]);
    assert.equal(stored.decisionInput.dispatchId, attempt.dispatchId);
    assert.equal(stored.decisionInput.claimGeneration, 1);
    assert.deepEqual(listExecutorAcceptanceFiles(home), [`${attempt.dispatchId}.json`]);

    // Exactly one new durable path: executor-acceptances/<dispatchId>.json.
    const after = snapshotHomeBytes(home);
    const added = Object.keys(after).filter((name) => !(name in before));
    assert.equal(added.length, 1, JSON.stringify(added));
    assert.equal(
      added[0].replaceAll('\\', '/'),
      `${EXECUTOR_ACCEPTANCES_DIRNAME}/${attempt.dispatchId}.json`,
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// B. EXACT REPLAY: byte/mtime-identical, zero write, zero task mutation.
// ---------------------------------------------------------------------------

test('B. exact replay is idempotent: byte/mtime-identical with zero write and zero task mutation', async () => {
  const { home, store, attempt } = await setupDecided(
    'greenhub-executor-acceptance26-b-',
    'EA26-B-SRC',
    'EA26-B-CHILD',
  );
  try {
    const first = await acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store });
    assert.equal(first.newlyAccepted, true);
    const path = executorAcceptancePath(home, attempt.dispatchId);
    const bytes = readFileSync(path, 'utf8');
    const fileStat = statSync(path);
    const homeBytes = snapshotHomeBytes(home);
    const homeStats = snapshotHomeStats(home);

    const replay = await acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store });
    assert.ok(Object.isFrozen(replay));
    assert.deepEqual(Object.keys(replay), [...EXECUTOR_ACCEPTANCE_REPLAY_FIELDS]);
    assert.deepEqual(replay, {
      dispatchId: attempt.dispatchId,
      newlyAccepted: false,
      exactReplay: true,
    });

    // write = 0, byte change = 0, mtime change = 0, task mutation = 0.
    assert.equal(readFileSync(path, 'utf8'), bytes);
    const replayedStat = statSync(path);
    assert.equal(replayedStat.size, fileStat.size);
    assert.equal(replayedStat.mtimeMs, fileStat.mtimeMs);
    assert.deepEqual(snapshotHomeBytes(home), homeBytes);
    assert.deepEqual(snapshotHomeStats(home), homeStats);
    assert.equal(store.readTask('EA26-B-CHILD').status, TASK_STATUS_CLAIMED);
    assert.equal(store.readClaim('EA26-B-CHILD').generation, 1);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// C. FRESH PROCESS: first acceptance + replay are process/clock-stable.
// ---------------------------------------------------------------------------

test('C. fresh process accepts/replays the durable record byte-identically', {
  timeout: 120_000,
}, async () => {
  const first = await setupDecided(
    'greenhub-executor-acceptance26-c1-',
    'EA26-C1-SRC',
    'EA26-C1-CHILD',
  );
  try {
    // A fresh process performs the first-ever acceptance: deterministic bytes.
    const created = await runFreshAcceptanceWorker({
      home: first.home,
      dispatchId: first.attempt.dispatchId,
      includeRecord: true,
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.deepEqual(created.result, { dispatchId: first.attempt.dispatchId, newlyAccepted: true });
    const path = executorAcceptancePath(first.home, first.attempt.dispatchId);
    const bytes = readFileSync(path, 'utf8');
    assert.equal(bytes, expectedRecordBytes(created.record));

    // Fresh-process replay with a different process clock is byte-identical.
    const replayed = await runFreshAcceptanceWorker({
      home: first.home,
      dispatchId: first.attempt.dispatchId,
      includeRecord: true,
    });
    assert.equal(replayed.ok, true, JSON.stringify(replayed));
    assert.deepEqual(replayed.result, {
      dispatchId: first.attempt.dispatchId,
      newlyAccepted: false,
      exactReplay: true,
    });
    assert.equal(readFileSync(path, 'utf8'), bytes);
    assert.equal(JSON.stringify(replayed.record), JSON.stringify(created.record));
  } finally {
    removeHome(first.home);
  }
});

// ---------------------------------------------------------------------------
// D. CONCURRENT SAME-INPUT ACCEPTANCE (single process).
// ---------------------------------------------------------------------------

test('D. concurrent same-input acceptance converges on exactly one durable record', async () => {
  const { home, store, attempt } = await setupDecided(
    'greenhub-executor-acceptance26-d-',
    'EA26-D-SRC',
    'EA26-D-CHILD',
  );
  try {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store }),
      ),
    );
    const winners = results.filter((entry) => entry.newlyAccepted === true);
    const replays = results.filter(
      (entry) => entry.newlyAccepted === false && entry.exactReplay === true,
    );
    assert.equal(winners.length, 1);
    assert.equal(replays.length, 5);
    for (const entry of results) {
      assert.equal(entry.dispatchId, attempt.dispatchId);
      assert.ok(Object.isFrozen(entry));
    }

    assert.deepEqual(listExecutorAcceptanceFiles(home), [`${attempt.dispatchId}.json`]);
    const stored = store.readExecutorDispatchAcceptance(attempt.dispatchId);
    assert.equal(
      readFileSync(executorAcceptancePath(home, attempt.dispatchId), 'utf8'),
      expectedRecordBytes(stored),
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. CONCURRENT ACCEPTANCE ACROSS SEPARATE PROCESSES (OS exclusive-create).
// ---------------------------------------------------------------------------

test('E. separate-process race yields exactly one OS exclusive-create winner', {
  timeout: 120_000,
}, async () => {
  const { home, store, attempt } = await setupDecided(
    'greenhub-executor-acceptance26-e-',
    'EA26-E-SRC',
    'EA26-E-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () =>
        runFreshAcceptanceWorker({ home, dispatchId: attempt.dispatchId }),
      ),
    );
    for (const outcome of outcomes) {
      assert.equal(outcome.ok, true, JSON.stringify(outcome));
    }
    const winners = outcomes.filter((outcome) => outcome.result.newlyAccepted === true);
    const replays = outcomes.filter(
      (outcome) => outcome.result.newlyAccepted === false && outcome.result.exactReplay === true,
    );
    assert.equal(winners.length, 1, JSON.stringify(outcomes));
    assert.equal(replays.length, 5);

    assert.deepEqual(listExecutorAcceptanceFiles(home), [`${attempt.dispatchId}.json`]);
    const stored = store.readExecutorDispatchAcceptance(attempt.dispatchId);
    assert.equal(
      readFileSync(executorAcceptancePath(home, attempt.dispatchId), 'utf8'),
      expectedRecordBytes(stored),
    );

    // Exactly one new durable path; no temp artifacts, no other domain growth.
    const after = snapshotHomeBytes(home);
    const added = Object.keys(after).filter((name) => !(name in before));
    assert.equal(added.length, 1, JSON.stringify(added));
    assert.ok(added[0].includes(EXECUTOR_ACCEPTANCES_DIRNAME));
    assert.ok(added[0].includes(`${attempt.dispatchId}.json`));
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. MISSING TASK 25 INPUT: predecessor code only, zero acceptance side effect.
// ---------------------------------------------------------------------------

test('F. missing durable receiver decision fails with the predecessor code and writes nothing', async () => {
  const home = makeHome('greenhub-executor-acceptance26-f-');
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(
      store,
      clock,
      'EA26-F-SRC',
      'EA26-F-CHILD',
      'result-ea26-f-src',
    );
    assert.equal(store.readReceiverDispatchDecision(attempt.dispatchId), null);
    const before = snapshotHomeBytes(home);
    const { calls, store: spyStore } = countingStore(store);

    await assert.rejects(
      acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store: spyStore }),
      (error) => error?.code === RECEIVER_DISPATCH_DECISION_NOT_FOUND,
    );

    // Task 25 read happened exactly once with dispatchId only; no executor
    // acceptance read/create, no auto-decision, no auto-acceptance, no retry.
    const decisionReads = calls.filter((call) => call.op === 'readDecision');
    assert.equal(decisionReads.length, 1);
    assert.equal(decisionReads[0].dispatchId, attempt.dispatchId);
    assert.deepEqual(decisionReads[0].rest, []);
    assert.equal(
      calls.some((call) => call.op === 'readAcceptance'),
      false,
    );
    assert.equal(
      calls.some((call) => call.op === 'createAcceptance'),
      false,
    );
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.equal(existsSync(executorAcceptanceDir(home)), false);
    assert.equal(store.readReceiverDispatchDecision(attempt.dispatchId), null);
    assert.equal(store.readTask('EA26-F-CHILD').status, TASK_STATUS_CLAIMED);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// G. INVALID IDENTITY / INVALID STORE.
// ---------------------------------------------------------------------------

test('G. invalid dispatchId and invalid stores fail closed before any acceptance access', async () => {
  const { home, store, attempt } = await setupDecided(
    'greenhub-executor-acceptance26-g-',
    'EA26-G-SRC',
    'EA26-G-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);

    // Invalid identity: Task 25 identity validation runs first; no store
    // primitive is touched (predecessor code propagates unchanged).
    let primitiveCalls = 0;
    const countingProbeStore = {
      readReceiverDispatchDecision: (dispatchId) => {
        primitiveCalls += 1;
        return store.readReceiverDispatchDecision(dispatchId);
      },
      readExecutorDispatchAcceptance: (dispatchId) => {
        primitiveCalls += 1;
        return store.readExecutorDispatchAcceptance(dispatchId);
      },
      createExecutorDispatchAcceptance: (record) => {
        primitiveCalls += 1;
        return store.createExecutorDispatchAcceptance(record);
      },
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
        acceptExecutorDispatchDecision({ dispatchId: invalidId, store: countingProbeStore }),
        (error) => error?.code === CORRUPT_RECEIVER_DISPATCH_DECISION,
      );
    }
    assert.equal(primitiveCalls, 0);

    // Invalid stores: fail with the acceptance-native store code; no read, no
    // write, no probe invocation.
    let probeCalls = 0;
    const invalidStores = [
      undefined,
      null,
      'store',
      42,
      {},
      { readReceiverDispatchDecision: () => null },
      { readReceiverDispatchDecision: () => null, readExecutorDispatchAcceptance: () => null },
      {
        readReceiverDispatchDecision: () => null,
        createExecutorDispatchAcceptance: () => ({ created: true }),
      },
      {
        readReceiverDispatchDecision: () => {
          probeCalls += 1;
          return null;
        },
        readExecutorDispatchAcceptance: 7,
        createExecutorDispatchAcceptance: 7,
      },
    ];
    for (const invalidStore of invalidStores) {
      await assert.rejects(
        acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store: invalidStore }),
        (error) =>
          error instanceof ExecutorAcceptanceError &&
          error.code === INVALID_EXECUTOR_ACCEPTANCE_STORE,
      );
    }
    assert.equal(probeCalls, 0);
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.equal(existsSync(executorAcceptancePath(home, attempt.dispatchId)), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// H. CORRUPT TASK 25 INPUT: predecessor codes propagate, zero persistence.
// ---------------------------------------------------------------------------

test('H. corrupt Task 25/24/20 input fails closed with predecessor codes and no acceptance file', async () => {
  const { home, store, attempt } = await setupDecided(
    'greenhub-executor-acceptance26-h-',
    'EA26-H-SRC',
    'EA26-H-CHILD',
  );
  try {
    const path = decisionPath(home, attempt.dispatchId);
    const pristineBytes = readFileSync(path, 'utf8');
    const record = JSON.parse(pristineBytes);
    const variants = [
      {
        name: 'unparseable decision bytes',
        bytes: '{ not json',
        code: CORRUPT_RECEIVER_DISPATCH_DECISION,
      },
      {
        name: 'valid JSON, invalid decision record',
        bytes: JSON.stringify({ hello: 'not-a-decision' }, null, 2),
        code: CORRUPT_RECEIVER_DISPATCH_DECISION,
      },
      {
        name: 'decision value drift',
        bytes: JSON.stringify({ ...record, decision: 'ACK' }, null, 2),
        code: CORRUPT_RECEIVER_DISPATCH_DECISION,
      },
      {
        name: 'blocked timestamp field',
        bytes: JSON.stringify({ ...record, acceptedAt: 'now' }, null, 2),
        code: CORRUPT_RECEIVER_DISPATCH_DECISION,
      },
      {
        name: 'inner request tamper (workerId)',
        bytes: JSON.stringify(
          { ...record, decisionInput: { ...record.decisionInput, workerId: 'worker-tampered' } },
          null,
          2,
        ),
        code: 'DISPATCH_BINDING_MISMATCH',
      },
      {
        name: 'inner generation smuggling',
        bytes: JSON.stringify(
          { ...record, decisionInput: { ...record.decisionInput, acceptanceGeneration: 1 } },
          null,
          2,
        ),
        code: CORRUPT_TRANSPORT_REQUEST,
      },
    ];

    for (const variant of variants) {
      writeFileSync(path, variant.bytes, 'utf8');
      await assert.rejects(
        acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store }),
        (error) => error?.code === variant.code,
        variant.name,
      );
      // No executor acceptance file, no repair, no predecessor rewrite.
      assert.equal(existsSync(executorAcceptanceDir(home)), false, variant.name);
      assert.equal(readFileSync(path, 'utf8'), variant.bytes, variant.name);
    }

    // Restoring the exact durable bytes re-enables the acceptance path.
    writeFileSync(path, pristineBytes, 'utf8');
    const result = await acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store });
    assert.equal(result.newlyAccepted, true);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// I. CORRUPT DURABLE ACCEPTANCE: fail closed, bytes preserved, no repair.
// ---------------------------------------------------------------------------

test('I. corrupt durable executor acceptance fails closed with exact bytes preserved and no repair', async () => {
  const { home, store, attempt } = await setupDecided(
    'greenhub-executor-acceptance26-i-',
    'EA26-I-SRC',
    'EA26-I-CHILD',
  );
  try {
    await acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store });
    const path = executorAcceptancePath(home, attempt.dispatchId);
    const bytes = readFileSync(path, 'utf8');
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
        name: 'decision value drift',
        bytes: JSON.stringify({ ...goodRecord, decision: 'ACCEPTED' }, null, 2),
        code: CORRUPT_RECEIVER_DISPATCH_DECISION,
      },
      {
        name: 'blocked timestamp field',
        bytes: JSON.stringify({ ...goodRecord, acceptedAt: 'now' }, null, 2),
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
          { ...goodRecord, decisionInput: { ...request, acceptanceGeneration: 1 } },
          null,
          2,
        ),
        code: CORRUPT_TRANSPORT_REQUEST,
      },
    ];

    for (const variant of variants) {
      writeFileSync(path, variant.bytes, 'utf8');
      await assert.rejects(
        acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store }),
        (error) => error?.code === variant.code,
        variant.name,
      );
      assert.equal(readFileSync(path, 'utf8'), variant.bytes, variant.name);
      assert.deepEqual(
        listExecutorAcceptanceFiles(home),
        [`${attempt.dispatchId}.json`],
        variant.name,
      );
    }

    // Restoring the exact durable bytes re-enables exact replay.
    writeFileSync(path, bytes, 'utf8');
    const replay = await acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store });
    assert.deepEqual(replay, {
      dispatchId: attempt.dispatchId,
      newlyAccepted: false,
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
  const { home, store, attempt } = await setupDecided(
    'greenhub-executor-acceptance26-j-',
    'EA26-J-SRC',
    'EA26-J-CHILD',
  );
  try {
    const different = differentValidRecord(store, attempt.dispatchId);
    let createCalls = 0;
    const spyStore = {
      readReceiverDispatchDecision: (dispatchId) => store.readReceiverDispatchDecision(dispatchId),
      readExecutorDispatchAcceptance: () => different,
      createExecutorDispatchAcceptance: () => {
        createCalls += 1;
        return { created: true };
      },
    };
    await assert.rejects(
      acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store: spyStore }),
      (error) => error?.code === EXECUTOR_DISPATCH_ACCEPTANCE_CONFLICT,
    );
    assert.equal(createCalls, 0);
    assert.equal(store.readExecutorDispatchAcceptance(attempt.dispatchId), null);

    // First durable winner persists; a conflicting incoming record never
    // overwrites it.
    const created = await acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store });
    assert.equal(created.newlyAccepted, true);
    const path = executorAcceptancePath(home, attempt.dispatchId);
    const winnerBytes = readFileSync(path, 'utf8');

    // Manually duplicating the durable file with a different valid record is
    // still a conflict and never repaired/overwritten by this surface.
    writeFileSync(path, JSON.stringify(different, null, 2), 'utf8');
    await assert.rejects(
      acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store }),
      (error) => error?.code === EXECUTOR_DISPATCH_ACCEPTANCE_CONFLICT,
    );
    assert.equal(readFileSync(path, 'utf8'), JSON.stringify(different, null, 2));

    // Restoring the original winner re-enables exact replay.
    writeFileSync(path, winnerBytes, 'utf8');
    const replay = await acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store });
    assert.deepEqual(replay, {
      dispatchId: attempt.dispatchId,
      newlyAccepted: false,
      exactReplay: true,
    });
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// K. NO MUTATION: every predecessor durable byte stays identical.
// ---------------------------------------------------------------------------

test('K. acceptance leaves every predecessor durable byte identical and no forbidden artifact', async () => {
  const { home, store, attempt } = await setupDecided(
    'greenhub-executor-acceptance26-k-',
    'EA26-K-SRC',
    'EA26-K-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const beforeStats = snapshotHomeStats(home);
    const taskBefore = store.readTask('EA26-K-CHILD');
    const claimBefore = store.readClaim('EA26-K-CHILD');

    const result = await acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store });
    assert.equal(result.newlyAccepted, true);

    // Only one added path; every pre-existing byte (task, claim, admission,
    // emission, dispatch attempt, receiver acceptance, receiver decision,
    // results, dispositions) is untouched.
    const after = snapshotHomeBytes(home);
    const added = Object.keys(after).filter((name) => !(name in before));
    assert.equal(added.length, 1, JSON.stringify(added));
    assert.ok(added[0].includes(EXECUTOR_ACCEPTANCES_DIRNAME));
    for (const [name, value] of Object.entries(before)) {
      assert.equal(after[name], value, name);
    }

    // Task is still CLAIMED; claim fencing generation is unchanged.
    const taskAfter = store.readTask('EA26-K-CHILD');
    const claimAfter = store.readClaim('EA26-K-CHILD');
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
    await acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store });
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

test('L. acceptance identity/content is clock-free, process-free, and canonical', async () => {
  const { home, store, attempt } = await setupDecided(
    'greenhub-executor-acceptance26-l-',
    'EA26-L-SRC',
    'EA26-L-CHILD',
  );
  try {
    const first = await acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store });
    assert.equal(first.newlyAccepted, true);
    const path = executorAcceptancePath(home, attempt.dispatchId);
    const bytes = readFileSync(path, 'utf8');
    const baseline = JSON.parse(bytes);
    const baselineJson = JSON.stringify(baseline);

    // Large clock skew + a fresh store instance re-reads identically and
    // replays without a byte change.
    const skewedStore = new CoordinationStore({
      dir: home,
      nowProvider: () => 4_102_444_800_000,
    });
    const replay = await acceptExecutorDispatchDecision({
      dispatchId: attempt.dispatchId,
      store: skewedStore,
    });
    assert.deepEqual(replay, {
      dispatchId: attempt.dispatchId,
      newlyAccepted: false,
      exactReplay: true,
    });
    assert.equal(
      JSON.stringify(skewedStore.readExecutorDispatchAcceptance(attempt.dispatchId)),
      baselineJson,
    );
    assert.equal(readFileSync(path, 'utf8'), bytes);

    // No clock/process/generation/wrapper field exists anywhere in the stored
    // representation; path authority is the sole acceptance marker.
    for (const forbiddenField of [
      'acceptedAt',
      'executorAcceptedAt',
      'receivedAt',
      'createdAt',
      'updatedAt',
      'timestamp',
      'pid',
      'hostname',
      'uuid',
      'executorId',
      'executorGeneration',
      'executionGeneration',
      'acceptanceGeneration',
      'deliveryGeneration',
      'retryGeneration',
      'retryCount',
      'receipt',
      'ack',
      'executionAllowed',
      'executionStarted',
      'newlyAccepted',
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

test('M. production module has no ACK/receipt/executor-invocation/scheduler/retry/new-generation/fs authority', () => {
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
    'spawn(',
    'exec(',
    'child_process',
    'fork(',
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
    'selectWorker',
    'workerRegistry',
    'executorRegistry',
    'adapterRegistry',
    'capabilityMatch',
    'executorGeneration',
    'executionGeneration',
    'acceptanceGeneration',
    'deliveryGeneration',
    'retryGeneration',
    'persistReceiverDecision',
    'acceptReceiverDispatch',
    'createReceiverDispatchDecision',
    'writeDisposition',
    'deliverResult',
    'claimTask',
    'markReady',
    'createTask',
    'writeFileSync',
    'mkdirSync',
    'rmSync',
    'appendFile',
    'createWriteStream',
    'writeJsonExclusive',
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
    'TASK_STATUS_RUNNING',
    'TASK_STATUS_ACCEPTED',
  ]) {
    assert.equal(code.includes(status), false, `${status} must not exist in code`);
  }

  // The acceptance boundary composes the Task 25 entry and only persists
  // through its own store primitives.
  assert.ok(code.includes('readReceiverExecutorAcceptanceInput('));
  assert.ok(code.includes('store.readExecutorDispatchAcceptance('));
  assert.ok(code.includes('store.createExecutorDispatchAcceptance('));
  assert.equal(code.includes('store.readReceiverDispatchDecision('), false);
  assert.equal(code.includes('validateReceiverDecisionRecord('), false);
  assert.equal(code.includes('node:path'), true);

  // Exported surface: only the documented constants/helpers/entry + error.
  const exportedFunctions = Object.entries(executorAcceptanceModule)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(exportedFunctions, [
    'ExecutorAcceptanceError',
    'acceptExecutorDispatchDecision',
    'assertValidExecutorAcceptanceDispatchId',
    'executorAcceptanceFileName',
    'executorDispatchAcceptanceFilePath',
  ]);
  assert.equal(typeof ExecutorAcceptanceError, 'function');
});

// ---------------------------------------------------------------------------
// M2. STORE SURFACE: minimal primitives, no forbidden authority, exclusive-only.
// ---------------------------------------------------------------------------

test('M2. store exposes the minimal executor-acceptance primitive and keeps forbidden authority absent', () => {
  const home = makeHome('greenhub-executor-acceptance26-m2-');
  try {
    const store = new CoordinationStore({ dir: home });
    assert.equal(typeof store.readExecutorDispatchAcceptance, 'function');
    assert.equal(typeof store.createExecutorDispatchAcceptance, 'function');
    assert.equal(typeof store.readReceiverDispatchDecision, 'function');
    assert.equal(typeof store.createReceiverDispatchDecision, 'function');
    for (const forbidden of [
      'acknowledgeDispatch',
      'ackDispatch',
      'executeTask',
      'executeDispatch',
      'invokeExecutor',
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
    const start = storeSource.indexOf('Durable executor dispatch acceptance domain');
    const end = storeSource.indexOf('Claim-bound dispatch envelope domain', start);
    assert.ok(start > 0 && end > start, 'executor-acceptance domain section must exist');
    const section = storeSource.slice(start, end);
    assert.ok(section.includes('writeJsonExclusive('));
    assert.equal(section.includes('existsSync('), false);
    assert.equal(section.includes('writeJsonAtomic('), false);
    assert.equal(section.includes('validateReceiverDecisionRecord('), true);
    assert.equal(section.includes('createExecutorDispatchAcceptance('), true);
    assert.equal(section.includes('readExecutorDispatchAcceptance('), true);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// N. PREDECESSOR IMMUTABILITY.
// ---------------------------------------------------------------------------

test('N. Task 18~25 predecessor source/spec bytes are unchanged', () => {
  for (const [name, expected] of Object.entries(PREDECESSOR_SHA256)) {
    const actual = createHash('sha256')
      .update(readFileSync(join(MODULE_DIRECTORY, name)))
      .digest('hex');
    assert.equal(actual, expected, `${name} must stay byte-identical`);
  }
});

// ---------------------------------------------------------------------------
// O. ONE DISPATCHID -> AT MOST ONE IMMUTABLE ACCEPTANCE ACROSS EVERY PATH.
// ---------------------------------------------------------------------------

test('O. one dispatchId carries at most one immutable acceptance across every path', async () => {
  const { home, store, attempt } = await setupDecided(
    'greenhub-executor-acceptance26-o-',
    'EA26-O-SRC',
    'EA26-O-CHILD',
  );
  try {
    const created = await acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store });
    assert.equal(created.newlyAccepted, true);
    const path = executorAcceptancePath(home, attempt.dispatchId);
    const bytes = readFileSync(path, 'utf8');

    const replayCalls = await Promise.all([
      acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store }),
      acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store }),
      acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store }),
    ]);
    for (const replay of replayCalls) {
      assert.equal(replay.newlyAccepted, false);
      assert.equal(replay.exactReplay, true);
    }
    assert.equal(readFileSync(path, 'utf8'), bytes);
    assert.deepEqual(listExecutorAcceptanceFiles(home), [`${attempt.dispatchId}.json`]);

    // Store primitives reject invalid records before any write.
    for (const invalidRecord of [
      null,
      'not-a-record',
      {},
      { ...store.readExecutorDispatchAcceptance(attempt.dispatchId), decision: 'NOPE' },
      { ...store.readExecutorDispatchAcceptance(attempt.dispatchId), acceptedAt: 'now' },
    ]) {
      let observed;
      try {
        store.createExecutorDispatchAcceptance(invalidRecord);
      } catch (error) {
        observed = error;
      }
      assert.notEqual(observed, undefined, 'invalid record must fail closed');
    }
    assert.equal(readFileSync(path, 'utf8'), bytes);
    assert.deepEqual(listExecutorAcceptanceFiles(home), [`${attempt.dispatchId}.json`]);

    // Store read with a different valid record is a conflict, never a repair.
    const different = differentValidRecord(store, attempt.dispatchId);
    writeFileSync(path, JSON.stringify(different, null, 2), 'utf8');
    assert.equal(
      JSON.stringify(store.readExecutorDispatchAcceptance(attempt.dispatchId)),
      JSON.stringify(different),
    );
    await assert.rejects(
      acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store }),
      (error) => error?.code === EXECUTOR_DISPATCH_ACCEPTANCE_CONFLICT,
    );
    writeFileSync(path, bytes, 'utf8');
    const restored = await acceptExecutorDispatchDecision({
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

test('P. acceptance consults only dispatchId-keyed primitives and never an alternate authority', async () => {
  const { home, store, attempt } = await setupDecided(
    'greenhub-executor-acceptance26-p-',
    'EA26-P-SRC',
    'EA26-P-CHILD',
  );
  try {
    const { calls, store: spyStore } = proxyCountingStore(store);
    const result = await acceptExecutorDispatchDecision({
      dispatchId: attempt.dispatchId,
      store: spyStore,
    });
    assert.equal(result.newlyAccepted, true);

    const invoked = calls.map((call) => call.op);
    assert.deepEqual(invoked, [
      'readReceiverDispatchDecision',
      'readExecutorDispatchAcceptance',
      'createExecutorDispatchAcceptance',
      'readExecutorDispatchAcceptance',
    ]);
    for (const call of calls) {
      const key = call.args[0];
      if (call.op === 'createExecutorDispatchAcceptance') {
        assert.equal(key.dispatchId, attempt.dispatchId);
        continue;
      }
      assert.equal(key, attempt.dispatchId);
      assert.equal(call.args.length, 1);
    }
    assert.equal(Object.hasOwn(result, 'sourceTaskId'), false);
    assert.equal(Object.hasOwn(result, 'workerId'), false);
    assert.equal(Object.hasOwn(result, 'admissionId'), false);
    assert.equal(existsSync(join(home, 'tasks')), true);
    assert.equal(existsSync(decisionDir(home)), true);
    assert.equal(existsSync(executorAcceptanceDir(home)), true);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// Q. EXPLICIT HEARTBEAT: read != accept, accepted != invoked/started.
// ---------------------------------------------------------------------------

test('Q. acceptance is not READ/RUNNING/invocation: no status transition and no execution authority', async () => {
  const { home, store, attempt } = await setupDecided(
    'greenhub-executor-acceptance26-q-',
    'EA26-Q-SRC',
    'EA26-Q-CHILD',
  );
  try {
    const taskBefore = store.readTask('EA26-Q-CHILD');
    const taskBytesBefore = readFileSync(join(home, 'tasks', 'EA26-Q-CHILD', 'task.json'), 'utf8');
    const homeBytesBefore = snapshotHomeBytes(home);
    await acceptExecutorDispatchDecision({ dispatchId: attempt.dispatchId, store });
    const taskAfter = store.readTask('EA26-Q-CHILD');
    assert.equal(taskAfter.status, taskBefore.status);
    assert.equal(taskAfter.status, TASK_STATUS_CLAIMED);
    assert.equal(
      readFileSync(join(home, 'tasks', 'EA26-Q-CHILD', 'task.json'), 'utf8'),
      taskBytesBefore,
    );

    // Acceptance adds no ACK/receipt/invocation/execution artifact and the
    // only new durable path is the executor-acceptance record.
    const homeBytesAfter = snapshotHomeBytes(home);
    const added = Object.keys(homeBytesAfter).filter((name) => !(name in homeBytesBefore));
    assert.equal(added.length, 1, JSON.stringify(added));
    assert.ok(added[0].includes(EXECUTOR_ACCEPTANCES_DIRNAME));
    for (const name of added) {
      for (const token of ['ack', 'receipt', 'execution', 'invocation', 'running']) {
        assert.equal(
          name.toLowerCase().includes(token),
          false,
          `${name} must not contain ${token}`,
        );
      }
    }
    const acceptanceBytes = readFileSync(executorAcceptancePath(home, attempt.dispatchId), 'utf8');
    for (const token of [
      'executionStarted',
      'executionAllowed',
      'executorInvoked',
      'invokedAt',
      'startedAt',
      'acceptedAt',
      'acknowledgedAt',
      'receivedAt',
    ]) {
      assert.equal(acceptanceBytes.includes(token), false, token);
    }
  } finally {
    removeHome(home);
  }
});
