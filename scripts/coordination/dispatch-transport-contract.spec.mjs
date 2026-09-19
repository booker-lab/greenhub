// Proof for GREENHUB-COORDINATION-DURABLE-ATTEMPT-BOUND-TRANSPORT-CONTRACT-20.
// Transport entry is EXACTLY one path:
//
//   (sourceTaskId, dispatchId)
//     -> store.readDispatchAttempt()            [EXISTING Task 19 durable]
//     -> envelopeFromDispatchAttemptRecord()    [Task 19 helper]
//     -> store.verifyClaimBoundDispatchEnvelope [Task 18 live revalidation]
//     -> store.readTask(record.nextTaskId)      [exact child binding]
//     -> deterministic immutable request
//     -> explicit caller-supplied adapter (at most once, no retry, no ACK).
//
// Explicitly NOT implemented here (and asserted absent):
//   concrete HTTP / WebSocket / MCP / stdin-stdout adapter, OpenCode / Codex /
//   Astra / ChatGPT invocation, child_process / spawn / exec, executor
//   invocation, scheduler, READY scan, queue scan, polling loop, daemon, cron,
//   worker selection, worker registry, capability matching, automatic claiming,
//   lease extension, retry, backoff, resend policy, delivery retry counter,
//   ACK protocol, ACK persistence, sent/dispatched persistence, DISPATCHED /
//   EXECUTOR_ACCEPTED status, new task status, result watcher, deliverResult
//   changes, result authority changes, claim/admission/emission mutation,
//   dispatchGeneration / sendGeneration / attemptGeneration / retryGeneration /
//   deliveryGeneration (any new generation authority).
//
// prepareDispatchTransportRequest() != sendDispatch().
// "request prepared" != "sent" != "accepted" != "executing".
// claimGeneration stays the SOLE fencing generation. All runtime state lives
// in isolated temp directories. No network required.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveCoordinationHome } from './coordination-home.mjs';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import {
  BLOCKED_TRANSPORT_REQUEST_FIELDS,
  CORRUPT_TRANSPORT_REQUEST,
  INVALID_TRANSPORT_ADAPTER,
  TRANSPORT_REQUEST_FIELDS,
  TRANSPORT_REQUEST_SCHEMA_VERSION,
  invokeDispatchTransportAdapter,
  prepareDispatchTransportRequest,
  validateTransportRequest,
} from './dispatch-transport-contract.mjs';
import { CoordinationStore } from './store.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const CONTRACT_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'dispatch-transport-contract.mjs')).href;
const STORE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'store.mjs')).href;

function makeHome(prefix = 'greenhub-transport20-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'DURABLE_ATTEMPT_BOUND_TRANSPORT_PROVED',
    policyRefs: ['docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md'],
    evidenceRefs: ['git:live-main-read'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: {
      liveMainHint: null,
      requiredPolicies: ['AGENTS.md'],
    },
    ownedSurface: ['scripts/coordination/'],
    mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['durable-attempt-bound-transport-proof'],
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

function driveToClaimed(store, clock, sourceTaskId, childTaskId, sourceResultId = 'result-0001', workerId = 'worker-a') {
  const setup = driveToAdmitted(store, clock, sourceTaskId, childTaskId, sourceResultId);
  const claimed = store.claimAdmittedTask({ sourceTaskId, workerId });
  clock.advance(1000);
  return { ...setup, claimed };
}

function driveToAttempt(store, clock, sourceTaskId, childTaskId, sourceResultId = 'result-0001', workerId = 'worker-a') {
  const setup = driveToClaimed(store, clock, sourceTaskId, childTaskId, sourceResultId, workerId);
  const attempt = store.persistDispatchAttempt({ sourceTaskId, workerId });
  clock.advance(1000);
  return { ...setup, attempt };
}

function claimPath(home, taskId) {
  return join(home, 'tasks', taskId, 'claim.json');
}

function attemptPath(home, sourceTaskId, dispatchId) {
  return join(home, 'tasks', sourceTaskId, 'dispatch-attempts', `${dispatchId}.json`);
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

function runFreshPrepareWorker({ home, sourceTaskId, dispatchId }) {
  return new Promise((resolveResult, rejectResult) => {
    const code = [
      'try {',
      `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
      `  const { prepareDispatchTransportRequest } = await import(${JSON.stringify(CONTRACT_MODULE_URL)});`,
      `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
      `  const out = prepareDispatchTransportRequest({ store, sourceTaskId: ${JSON.stringify(sourceTaskId)}, dispatchId: ${JSON.stringify(dispatchId)} });`,
      '  console.log(JSON.stringify({ ok: true, request: out }));',
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
        rejectResult(new Error(`prepare worker exit=${exitCode} stderr=${stderr}`));
        return;
      }
      try {
        resolveResult(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch (error) {
        rejectResult(new Error(`prepare worker output parse failed: ${stdout} / ${stderr}`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// D. HAPPY PATH: CURRENT claim + valid Task18 envelope + existing Task19
// attempt -> valid immutable request.
// ---------------------------------------------------------------------------

test('D. happy path prepares a valid immutable request bound to the durable attempt', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(store, clock, 'DE20-D-SRC', 'DE20-D-CHILD', 'result-de20-d-src');
    const request = prepareDispatchTransportRequest({ store, sourceTaskId: 'DE20-D-SRC', dispatchId: attempt.dispatchId });
    assert.ok(Object.isFrozen(request));
    assert.deepEqual(Object.keys(request), [...TRANSPORT_REQUEST_FIELDS]);
    assert.equal(request.schemaVersion, TRANSPORT_REQUEST_SCHEMA_VERSION);
    assert.equal(request.dispatchId, attempt.dispatchId);
    assert.equal(request.sourceTaskId, 'DE20-D-SRC');
    assert.equal(request.emissionSlot, 'next');
    assert.equal(request.admissionId, attempt.admissionId);
    assert.equal(request.nextTaskId, 'DE20-D-CHILD');
    assert.equal(request.workerId, 'worker-a');
    assert.equal(request.claimGeneration, 1);
    assert.equal(request.task.taskId, 'DE20-D-CHILD');
    assert.equal(request.task.status, 'CLAIMED');
    assert.ok(Object.isFrozen(request.task));
    assert.deepEqual(validateTransportRequest(request), request);
    assert.deepEqual(validateTransportRequest(JSON.parse(JSON.stringify(request))), request);
    // Adapter receives the frozen request with dispatchId as stable key.
    let seen;
    const result = await invokeDispatchTransportAdapter({
      request,
      adapter: async (input) => {
        seen = input;
        return { ok: true, dispatchId: input.dispatchId };
      },
    });
    assert.deepEqual(result, { ok: true, dispatchId: attempt.dispatchId });
    assert.equal(seen.dispatchId, attempt.dispatchId);
    assert.ok(Object.isFrozen(seen));
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// A. DETERMINISTIC REQUEST: repeated builds byte/semantic identical.
// ---------------------------------------------------------------------------

test('A. deterministic request: repeated prepares are byte/semantic identical and frozen', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(store, clock, 'DE20-A-SRC', 'DE20-A-CHILD', 'result-de20-a-src');
    const first = prepareDispatchTransportRequest({ store, sourceTaskId: 'DE20-A-SRC', dispatchId: attempt.dispatchId });
    assert.ok(Object.isFrozen(first));
    for (let replay = 0; replay < 10; replay += 1) {
      clock.advance(1000);
      const out = prepareDispatchTransportRequest({ store, sourceTaskId: 'DE20-A-SRC', dispatchId: attempt.dispatchId });
      assert.deepEqual(out, first);
      assert.equal(JSON.stringify(out), JSON.stringify(first));
      assert.ok(Object.isFrozen(out));
    }
    // Multi-instance replay against the same home agrees.
    const store2 = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    assert.deepEqual(
      prepareDispatchTransportRequest({ store: store2, sourceTaskId: 'DE20-A-SRC', dispatchId: attempt.dispatchId }),
      first,
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// B. FRESH-PROCESS DETERMINISM.
// ---------------------------------------------------------------------------

test('B. fresh process returns byte-identical request', { timeout: 60_000 }, async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(store, clock, 'DE20-B-SRC', 'DE20-B-CHILD', 'result-de20-b-src');
    const baseline = prepareDispatchTransportRequest({ store, sourceTaskId: 'DE20-B-SRC', dispatchId: attempt.dispatchId });
    const worker = await runFreshPrepareWorker({ home, sourceTaskId: 'DE20-B-SRC', dispatchId: attempt.dispatchId });
    assert.equal(worker.ok, true);
    assert.deepEqual(worker.request, baseline);
    assert.equal(JSON.stringify(worker.request), JSON.stringify(baseline));
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// C. CLOCK EXCLUSION.
// ---------------------------------------------------------------------------

test('C. clock skew leaves request identity/content identical and adds no clock metadata', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(store, clock, 'DE20-C-SRC', 'DE20-C-CHILD', 'result-de20-c-src');
    const baseline = prepareDispatchTransportRequest({ store, sourceTaskId: 'DE20-C-SRC', dispatchId: attempt.dispatchId });
    clock.advance(365 * 86_400_000);
    const skewedFuture = prepareDispatchTransportRequest({ store, sourceTaskId: 'DE20-C-SRC', dispatchId: attempt.dispatchId });
    clock.advance(-2 * 365 * 86_400_000);
    const skewedPast = prepareDispatchTransportRequest({ store, sourceTaskId: 'DE20-C-SRC', dispatchId: attempt.dispatchId });
    assert.equal(JSON.stringify(skewedFuture), JSON.stringify(baseline));
    assert.equal(JSON.stringify(skewedPast), JSON.stringify(baseline));
    for (const excluded of ['createdAt', 'preparedAt', 'transportedAt', 'dispatchedAt', 'sentAt', 'ackedAt', 'persistedAt', 'timestamp', 'wallClock', 'clock', 'mtime', 'pid', 'hostname', 'transportGeneration', 'sendGeneration', 'attemptGeneration', 'retryGeneration', 'deliveryGeneration', 'transport', 'adapter']) {
      assert.equal(excluded in baseline, false, `${excluded} must not be in request`);
    }
    for (const blocked of ['transportGeneration', 'sendGeneration', 'attemptGeneration', 'retryGeneration', 'deliveryGeneration', 'createdAt', 'persistedAt', 'dispatchedAt', 'sentAt', 'transport', 'adapter', 'scheduler']) {
      assert.ok(BLOCKED_TRANSPORT_REQUEST_FIELDS.includes(blocked), `${blocked} must be blocked`);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. MISSING ATTEMPT: NO adapter call / no mutation.
// ---------------------------------------------------------------------------

test('E. missing attempt fails closed with DISPATCH_ATTEMPT_NOT_FOUND and zero adapter call', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToClaimed(store, clock, 'DE20-E-SRC', 'DE20-E-CHILD', 'result-de20-e-src');
    const live = store.readClaimBoundDispatchEnvelope({ sourceTaskId: 'DE20-E-SRC', workerId: 'worker-a' });
    const beforeBytes = snapshotHomeBytes(home);
    // A well-formed but never-persisted dispatchId: flip the last hex digit.
    const last = live.dispatchId.at(-1);
    const flipped = last === '0' ? '1' : '0';
    const missingId = `${live.dispatchId.slice(0, -1)}${flipped}`;
    let adapterCalls = 0;
    assert.throws(
      () => prepareDispatchTransportRequest({ store, sourceTaskId: 'DE20-E-SRC', dispatchId: missingId }),
      (error) => error?.code === 'DISPATCH_ATTEMPT_NOT_FOUND',
    );
    assert.deepEqual(snapshotHomeBytes(home), beforeBytes);
    assert.equal(adapterCalls, 0);
    void adapterCalls;
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. CORRUPT ATTEMPT: NO adapter call / no repair / no overwrite.
// ---------------------------------------------------------------------------

test('F. corrupt attempt fails closed with no repair and zero adapter call', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(store, clock, 'DE20-F-SRC', 'DE20-F-CHILD', 'result-de20-f-src');
    const target = attemptPath(home, 'DE20-F-SRC', attempt.dispatchId);
    writeFileSync(target, '{corrupt-json', 'utf8');
    const corruptBytes = readFileSync(target, 'utf8');
    const beforeClaim = store.readClaim('DE20-F-CHILD');
    assert.throws(
      () => prepareDispatchTransportRequest({ store, sourceTaskId: 'DE20-F-SRC', dispatchId: attempt.dispatchId }),
      (error) => error?.code === 'CORRUPT_DISPATCH_ATTEMPT',
    );
    assert.equal(readFileSync(target, 'utf8'), corruptBytes);
    assert.deepEqual(store.readClaim('DE20-F-CHILD'), beforeClaim);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// G. STALE GENERATION: gen1 attempt + claim takeover gen2 -> STALE_DISPATCH.
// ---------------------------------------------------------------------------

test('G. stale generation attempt is fenced with STALE_DISPATCH and zero request', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt: d1 } = driveToAttempt(store, clock, 'DE20-G-SRC', 'DE20-G-CHILD', 'result-de20-g-src');
    assert.equal(d1.claimGeneration, 1);
    clock.advance(120_000);
    const reclaimed = store.claimAdmittedTask({
      sourceTaskId: 'DE20-G-SRC',
      workerId: 'worker-a',
      leaseDurationMs: 60_000,
      nowMs: clock.now,
    });
    assert.equal(reclaimed.claim.generation, 2);
    const d2 = store.persistDispatchAttempt({ sourceTaskId: 'DE20-G-SRC', workerId: 'worker-a' });
    assert.equal(d2.claimGeneration, 2);
    assert.notEqual(d1.dispatchId, d2.dispatchId);
    // Old durable attempt is stale against CURRENT live envelope.
    assert.throws(
      () => prepareDispatchTransportRequest({ store, sourceTaskId: 'DE20-G-SRC', dispatchId: d1.dispatchId }),
      (error) => error?.code === 'STALE_DISPATCH',
    );
    // Current generation still prepares.
    const current = prepareDispatchTransportRequest({ store, sourceTaskId: 'DE20-G-SRC', dispatchId: d2.dispatchId });
    assert.equal(current.dispatchId, d2.dispatchId);
    assert.equal(current.claimGeneration, 2);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// H. WORKER DRIFT: current claim worker != durable worker -> fail closed.
// ---------------------------------------------------------------------------

test('H. worker drift fails closed and prepares zero request', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(store, clock, 'DE20-H-SRC', 'DE20-H-CHILD', 'result-de20-h-src', 'worker-a');
    clock.advance(120_000);
    const reclaimed = store.claimAdmittedTask({
      sourceTaskId: 'DE20-H-SRC',
      workerId: 'worker-b',
      leaseDurationMs: 60_000,
      nowMs: clock.now,
    });
    assert.equal(reclaimed.claim.workerId, 'worker-b');
    assert.throws(
      () => prepareDispatchTransportRequest({ store, sourceTaskId: 'DE20-H-SRC', dispatchId: attempt.dispatchId }),
      (error) => error?.code === 'DISPATCH_BINDING_MISMATCH' || error?.code === 'STALE_DISPATCH',
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// I. TERMINAL CHILD: RESULT_DELIVERED -> transport ZERO.
// ---------------------------------------------------------------------------

test('I. terminal RESULT_DELIVERED child yields TASK_TERMINAL and zero request', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt, claimed } = driveToAttempt(store, clock, 'DE20-I-SRC', 'DE20-I-CHILD', 'result-de20-i-src');
    store.deliverResult(sampleResult(claimed.claim, { taskId: 'DE20-I-CHILD', resultId: 'result-de20-i-child' }));
    assert.equal(store.readTask('DE20-I-CHILD').status, 'RESULT_DELIVERED');
    const beforeBytes = snapshotHomeBytes(home);
    assert.throws(
      () => prepareDispatchTransportRequest({ store, sourceTaskId: 'DE20-I-SRC', dispatchId: attempt.dispatchId }),
      (error) => error?.code === 'TASK_TERMINAL',
    );
    assert.deepEqual(snapshotHomeBytes(home), beforeBytes);
    // validateTransportRequest with a terminal task also refuses.
    const terminalTask = store.readTask('DE20-I-CHILD');
    const tampered = {
      schemaVersion: TRANSPORT_REQUEST_SCHEMA_VERSION,
      dispatchId: attempt.dispatchId,
      sourceTaskId: attempt.sourceTaskId,
      emissionSlot: attempt.emissionSlot,
      admissionId: attempt.admissionId,
      nextTaskId: attempt.nextTaskId,
      workerId: attempt.workerId,
      claimGeneration: attempt.claimGeneration,
      task: terminalTask,
    };
    assert.throws(() => validateTransportRequest(tampered), (error) => error?.code === 'TASK_TERMINAL');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// J. READY / CREATED CHILD -> TASK_NOT_CLAIMED.
// ---------------------------------------------------------------------------

test('J. READY and CREATED children yield TASK_NOT_CLAIMED and zero request', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(store, clock, 'DE20-J-SRC', 'DE20-J-CHILD', 'result-de20-j-src');
    // Crash-window shape: claim present + READY task.
    const childFile = join(home, 'tasks', 'DE20-J-CHILD', 'task.json');
    const claimedChild = JSON.parse(readFileSync(childFile, 'utf8'));
    writeFileSync(
      childFile,
      JSON.stringify({ ...claimedChild, status: 'READY', updatedAt: '2026-01-01T00:00:00.000Z' }, null, 2),
      'utf8',
    );
    assert.equal(store.readTask('DE20-J-CHILD').status, 'READY');
    assert.throws(
      () => prepareDispatchTransportRequest({ store, sourceTaskId: 'DE20-J-SRC', dispatchId: attempt.dispatchId }),
      (error) => error?.code === 'TASK_NOT_CLAIMED',
    );
    // CREATED envelope never validates into a request either.
    const readyTask = store.readTask('DE20-J-CHILD');
    const createdLike = { ...readyTask, status: 'CREATED' };
    const probe = {
      schemaVersion: TRANSPORT_REQUEST_SCHEMA_VERSION,
      dispatchId: attempt.dispatchId,
      sourceTaskId: attempt.sourceTaskId,
      emissionSlot: attempt.emissionSlot,
      admissionId: attempt.admissionId,
      nextTaskId: attempt.nextTaskId,
      workerId: attempt.workerId,
      claimGeneration: attempt.claimGeneration,
      task: createdLike,
    };
    assert.throws(() => validateTransportRequest(probe), (error) => error?.code === 'TASK_NOT_CLAIMED');
    const readyProbe = { ...probe, task: readyTask };
    assert.throws(() => validateTransportRequest(readyProbe), (error) => error?.code === 'TASK_NOT_CLAIMED');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// K. TASK BINDING: attempt.nextTaskId vs read task identity exact match.
// ---------------------------------------------------------------------------

test('K. task binding drift fails closed with DISPATCH_ATTEMPT_BINDING_MISMATCH', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(store, clock, 'DE20-K-SRC', 'DE20-K-CHILD', 'result-de20-k-src');
    // Swap the child file payload to a different valid taskId.
    const childFile = join(home, 'tasks', 'DE20-K-CHILD', 'task.json');
    const child = JSON.parse(readFileSync(childFile, 'utf8'));
    writeFileSync(childFile, JSON.stringify({ ...child, taskId: 'DE20-K-OTHER' }, null, 2), 'utf8');
    assert.throws(
      () => prepareDispatchTransportRequest({ store, sourceTaskId: 'DE20-K-SRC', dispatchId: attempt.dispatchId }),
      (error) => error?.code === 'DISPATCH_ATTEMPT_BINDING_MISMATCH' || error?.code === 'ADMISSION_BINDING_MISMATCH',
    );
  } finally {
    removeHome(home);
  }
});

test('K2. validate rejects nextTaskId/task.taskId mismatch without I/O', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(store, clock, 'DE20-K2-SRC', 'DE20-K2-CHILD', 'result-de20-k2-src');
    const request = prepareDispatchTransportRequest({ store, sourceTaskId: 'DE20-K2-SRC', dispatchId: attempt.dispatchId });
    const otherTask = { ...request.task, taskId: 'DE20-K2-OTHER' };
    const tampered = { ...request, task: otherTask };
    assert.throws(
      () => validateTransportRequest(tampered),
      (error) => error?.code === 'DISPATCH_ATTEMPT_BINDING_MISMATCH',
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// L. ADAPTER EXPLICITNESS: caller-supplied only, no registry/selection.
// ---------------------------------------------------------------------------

test('L. adapter is explicit caller-supplied only; malformed adapters never run', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(store, clock, 'DE20-L-SRC', 'DE20-L-CHILD', 'result-de20-l-src');
    const request = prepareDispatchTransportRequest({ store, sourceTaskId: 'DE20-L-SRC', dispatchId: attempt.dispatchId });
    // Missing / non-function adapters fail closed before any call.
    await assert.rejects(
      invokeDispatchTransportAdapter({ request }),
      (error) => error?.code === INVALID_TRANSPORT_ADAPTER,
    );
    await assert.rejects(
      invokeDispatchTransportAdapter({ request, adapter: 'worker-a' }),
      (error) => error?.code === INVALID_TRANSPORT_ADAPTER,
    );
    await assert.rejects(
      invokeDispatchTransportAdapter({ request, adapter: { send: async () => ({}) } }),
      (error) => error?.code === INVALID_TRANSPORT_ADAPTER,
    );
    // Malformed requests never reach the adapter.
    let calls = 0;
    const fake = async () => {
      calls += 1;
      return { ok: true };
    };
    await assert.rejects(
      invokeDispatchTransportAdapter({ request: { ...request, workerId: '' }, adapter: fake }),
      (error) => error != null,
    );
    assert.equal(calls, 0);
    // The valid caller-supplied fake runs and sees the frozen request.
    let seen;
    const out = await invokeDispatchTransportAdapter({
      request,
      adapter: async (input) => {
        seen = input;
        return { delivered: input.dispatchId };
      },
    });
    assert.deepEqual(out, { delivered: attempt.dispatchId });
    assert.equal(seen.dispatchId, attempt.dispatchId);
    assert.ok(Object.isFrozen(seen));
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// M. SINGLE INVOCATION: at most one adapter call per invoke, no retry.
// ---------------------------------------------------------------------------

test('M. one invoke calls the adapter exactly once with no internal retry', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(store, clock, 'DE20-M-SRC', 'DE20-M-CHILD', 'result-de20-m-src');
    const request = prepareDispatchTransportRequest({ store, sourceTaskId: 'DE20-M-SRC', dispatchId: attempt.dispatchId });
    let calls = 0;
    const seenDispatchIds = [];
    const out = await invokeDispatchTransportAdapter({
      request,
      adapter: async (input) => {
        calls += 1;
        seenDispatchIds.push(input.dispatchId);
        return { ok: true };
      },
    });
    assert.deepEqual(out, { ok: true });
    assert.equal(calls, 1);
    assert.deepEqual(seenDispatchIds, [attempt.dispatchId]);
    // Sync adapters also run exactly once.
    let syncCalls = 0;
    const syncOut = await invokeDispatchTransportAdapter({
      request,
      adapter: (input) => {
        syncCalls += 1;
        return { ok: input.dispatchId };
      },
    });
    assert.deepEqual(syncOut, { ok: attempt.dispatchId });
    assert.equal(syncCalls, 1);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// N. ADAPTER FAILURE: throw/reject propagates, zero retry, zero mutation.
// ---------------------------------------------------------------------------

test('N. adapter throw/reject propagates with zero retry and zero durable mutation', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(store, clock, 'DE20-N-SRC', 'DE20-N-CHILD', 'result-de20-n-src');
    const request = prepareDispatchTransportRequest({ store, sourceTaskId: 'DE20-N-SRC', dispatchId: attempt.dispatchId });
    const beforeBytes = snapshotHomeBytes(home);
    const beforeClaim = readFileSync(claimPath(home, 'DE20-N-CHILD'), 'utf8');
    const beforeTask = readFileSync(join(home, 'tasks', 'DE20-N-CHILD', 'task.json'), 'utf8');
    const beforeAttempt = readFileSync(attemptPath(home, 'DE20-N-SRC', attempt.dispatchId), 'utf8');
    let syncCalls = 0;
    await assert.rejects(
      invokeDispatchTransportAdapter({
        request,
        adapter: () => {
          syncCalls += 1;
          throw new Error('fake-transport-down');
        },
      }),
      (error) => /fake-transport-down/.test(String(error?.message)),
    );
    assert.equal(syncCalls, 1);
    let asyncCalls = 0;
    await assert.rejects(
      invokeDispatchTransportAdapter({
        request,
        adapter: async () => {
          asyncCalls += 1;
          throw new Error('fake-transport-reject');
        },
      }),
      (error) => /fake-transport-reject/.test(String(error?.message)),
    );
    assert.equal(asyncCalls, 1);
    // Zero durable side effects: claim/task/attempt bytes identical, no ACK.
    assert.deepEqual(snapshotHomeBytes(home), beforeBytes);
    assert.equal(readFileSync(claimPath(home, 'DE20-N-CHILD'), 'utf8'), beforeClaim);
    assert.equal(readFileSync(join(home, 'tasks', 'DE20-N-CHILD', 'task.json'), 'utf8'), beforeTask);
    assert.equal(readFileSync(attemptPath(home, 'DE20-N-SRC', attempt.dispatchId), 'utf8'), beforeAttempt);
    assert.equal(existsSync(join(home, 'tasks', 'DE20-N-CHILD', 'ack.json')), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// O. REPLAY CONTRACT: same request re-invokable, dispatchId is stable key,
// exactly-once NOT claimed.
// ---------------------------------------------------------------------------

test('O. replay is allowed with the stable dispatchId key; exactly-once is not claimed', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(store, clock, 'DE20-O-SRC', 'DE20-O-CHILD', 'result-de20-o-src');
    const request = prepareDispatchTransportRequest({ store, sourceTaskId: 'DE20-O-SRC', dispatchId: attempt.dispatchId });
    const seenKeys = [];
    const fake = async (input) => {
      seenKeys.push(input.dispatchId);
      return { ok: true, key: input.dispatchId };
    };
    const first = await invokeDispatchTransportAdapter({ request, adapter: fake });
    const second = await invokeDispatchTransportAdapter({ request: JSON.parse(JSON.stringify(request)), adapter: fake });
    assert.deepEqual(first, { ok: true, key: attempt.dispatchId });
    assert.deepEqual(second, { ok: true, key: attempt.dispatchId });
    assert.deepEqual(seenKeys, [attempt.dispatchId, attempt.dispatchId]);
    // The contract claims no exactly-once: no such field/authority exists.
    assert.equal('exactlyOnce' in request, false);
    assert.equal('exactly-once' in request, false);
    assert.equal('deliveryGuarantee' in request, false);
    const contractSource = readFileSync(join(MODULE_DIRECTORY, 'dispatch-transport-contract.mjs'), 'utf8');
    assert.ok(contractSource.includes('Exactly-once is NOT claimed') || contractSource.includes('exactly-once'));
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// P. DIRECT-BYPASS ABSENCE: no claim/envelope/task -> send path.
// ---------------------------------------------------------------------------

test('P. direct claim/envelope/task to send bypass does not exist', () => {
  const contractSource = readFileSync(join(MODULE_DIRECTORY, 'dispatch-transport-contract.mjs'), 'utf8');
  // Functional code only: header comments document the forbidden ordering
  // (CLAIM -> SEND) as a prohibition, not an API (Task 19 boundary pattern).
  const codeOnly = contractSource.split('\n').filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*')).join('\n');
  // Entry surface is exactly prepare (store+ids), validate, invoke.
  assert.equal(typeof prepareDispatchTransportRequest, 'function');
  assert.equal(typeof validateTransportRequest, 'function');
  assert.equal(typeof invokeDispatchTransportAdapter, 'function');
  // No bypass builder exists: creating a request from claim/worker/envelope/task alone.
  for (const forbidden of [
    'buildFromClaim',
    'createFromClaim',
    'prepareFromClaim',
    'requestFromClaim',
    'buildFromEnvelope',
    'createFromEnvelope',
    'requestFromEnvelope',
    'buildFromTask',
    'createFromTask',
    'requestFromTask',
    'claimToSend',
    'envelopeToSend',
    'taskToSend',
    'sendDispatch',
    'dispatchNextTask',
  ]) {
    assert.equal(codeOnly.includes(`${forbidden}(`), false, `${forbidden}() must not exist`);
    assert.equal(codeOnly.includes(`function ${forbidden}`), false, `${forbidden} must not exist`);
  }
  // prepare() signature starts at the durable attempt: it must read it.
  assert.ok(contractSource.includes('store.readDispatchAttempt'));
  assert.ok(contractSource.includes('store.verifyClaimBoundDispatchEnvelope'));
  assert.ok(contractSource.includes('store.readTask'));
  // invoke() never touches the store: no mutation surface.
  const invokeSection = contractSource.slice(contractSource.indexOf('export async function invokeDispatchTransportAdapter'));
  assert.ok(invokeSection.length > 0);
  for (const forbiddenWrite of ['readDispatchAttempt', 'verifyClaimBoundDispatchEnvelope', 'readTask(', '.claimTask', 'deliverResult(', 'writeJson', 'markReady(']) {
    assert.equal(invokeSection.includes(forbiddenWrite), false, `invoke section must not contain ${forbiddenWrite}`);
  }
});

// ---------------------------------------------------------------------------
// MALFORMED REQUEST / ADAPTER FAIL-CLOSED.
// ---------------------------------------------------------------------------

test('Q. malformed transport request and adapter fail closed with zero adapter call', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { attempt } = driveToAttempt(store, clock, 'DE20-Q-SRC', 'DE20-Q-CHILD', 'result-de20-q-src');
    const request = prepareDispatchTransportRequest({ store, sourceTaskId: 'DE20-Q-SRC', dispatchId: attempt.dispatchId });
    let calls = 0;
    const fake = async () => {
      calls += 1;
      return { ok: true };
    };
    // Extra smuggled generation field.
    assert.throws(
      () => validateTransportRequest({ ...request, transportGeneration: 1 }),
      (error) => error?.code === CORRUPT_TRANSPORT_REQUEST,
    );
    // Tampered dispatchId.
    const last = request.dispatchId.at(-1);
    const flipped = last === '0' ? '1' : '0';
    assert.throws(
      () => validateTransportRequest({ ...request, dispatchId: `${request.dispatchId.slice(0, -1)}${flipped}` }),
      (error) => error?.code === 'DISPATCH_BINDING_MISMATCH',
    );
    // Missing task.
    const { task: _dropped, ...withoutTask } = request;
    void _dropped;
    assert.throws(() => validateTransportRequest(withoutTask), (error) => error != null);
    // Malformed adapter with a valid request.
    await assert.rejects(
      invokeDispatchTransportAdapter({ request, adapter: null }),
      (error) => error?.code === INVALID_TRANSPORT_ADAPTER,
    );
    assert.equal(calls, 0);
    // Malformed request never reaches even a valid adapter.
    await assert.rejects(
      invokeDispatchTransportAdapter({ request: { ...request, claimGeneration: 0 }, adapter: fake }),
      (error) => error != null,
    );
    assert.equal(calls, 0);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// BOUNDARY20: transport contract only; concrete transports/scheduler/
// executor/ACK/status/retry/generation absent; store untouched surface.
// ---------------------------------------------------------------------------

test('BOUNDARY20. transport contract only; concrete transport/scheduler/executor/ACK/status/retry/generation absent', () => {
  const home = makeHome();
  try {
    assert.equal(TRANSPORT_REQUEST_SCHEMA_VERSION, '1');
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    for (const forbidden of [
      'sendDispatch',
      'dispatchNextTask',
      'dispatch',
      'scheduleNextTask',
      'schedule',
      'pollQueue',
      'runScheduler',
      'autonomousLoop',
      'decideNextTask',
      'planNextTask',
      'generateNextTask',
      'fanOut',
      'createChildTask',
      'registerAdapter',
      'adapterRegistry',
      'selectAdapter',
      'detectAdapter',
      'selectWorker',
      'selectExecutor',
      'selectAgent',
      'inferWorker',
      'workerRegistry',
      'registerWorker',
      'pollReady',
      'oldestReady',
      'nextReady',
      'newestReady',
      'priorityScore',
      'fairnessScore',
      'acknowledgeDispatch',
      'ackDispatch',
      'retryDispatch',
      'backoffDispatch',
      'resendDispatch',
    ]) {
      assert.equal(store[forbidden], undefined, `store.${forbidden} must not exist`);
    }
    for (const allowed of [
      'persistDispatchAttempt',
      'readDispatchAttempt',
      'readClaimBoundDispatchEnvelope',
      'verifyClaimBoundDispatchEnvelope',
      'readTask',
      'readClaim',
      'claimTask',
      'markReady',
      'deliverResult',
    ]) {
      assert.equal(typeof store[allowed], 'function', `store.${allowed} must exist`);
    }
    // Pure contract module surface is request+invoke only: no fs/scheduler/
    // dispatch/executor/network exports. Functional tokens only (header
    // comments may document out-of-scope names, matching Task 19 pattern).
    const contractSource = readFileSync(join(MODULE_DIRECTORY, 'dispatch-transport-contract.mjs'), 'utf8');
    // No concrete transport protocol implementation (functional tokens).
    const codeLines = contractSource.split('\n').filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'));
    const codeOnly = codeLines.join('\n');
    for (const forbiddenToken of [
      "from 'node:fs'",
      'node:child_process',
      'writeFileSync',
      'mkdirSync',
      'spawn(',
      'fetch(',
      'WebSocket(',
      'new WebSocket',
      'XMLHttpRequest',
    ]) {
      assert.equal(codeOnly.includes(forbiddenToken), false, `contract code must not contain ${forbiddenToken}`);
    }
    for (const forbiddenImpl of ['http.request(', 'https.request(', 'new WebSocket(', 'EventSource(', 'grpc.', 'mqtt.']) {
      assert.equal(codeOnly.includes(forbiddenImpl), false, `contract code must not contain ${forbiddenImpl}`);
    }
    // No new generation / retry / ACK / status authority in code.
    for (const forbiddenField of ['transportGeneration', 'sendGeneration', 'attemptGeneration', 'retryGeneration', 'deliveryGeneration', "'DISPATCHED'", '"DISPATCHED"', "'EXECUTOR_ACCEPTED'", '"EXECUTOR_ACCEPTED"', 'TASK_STATUS_DISPATCHED', 'ACK_PROTOCOL', 'ackProtocol']) {
      const occurrences = codeOnly.split(forbiddenField).length - 1;
      // Blocked-field list entries are allowed exactly as prohibition literals;
      // any other functional use is forbidden.
      if (BLOCKED_TRANSPORT_REQUEST_FIELDS.includes(forbiddenField.replaceAll("'", '').replaceAll('"', ''))) continue;
      assert.equal(occurrences, 0, `contract code must not contain ${forbiddenField}`);
    }
    // Request owns no new generation/retry/timestamp/transport fields.
    driveToAttempt(store, clock, 'DE20-BND-SRC', 'DE20-BND-CHILD', 'result-de20-bnd-src');
    const attempt = store.persistDispatchAttempt({ sourceTaskId: 'DE20-BND-SRC', workerId: 'worker-a' });
    const request = prepareDispatchTransportRequest({ store, sourceTaskId: 'DE20-BND-SRC', dispatchId: attempt.dispatchId });
    assert.deepEqual(Object.keys(request), [...TRANSPORT_REQUEST_FIELDS]);
    for (const excluded of ['transportGeneration', 'sendGeneration', 'attemptGeneration', 'retryGeneration', 'deliveryGeneration', 'retryCount', 'createdAt', 'persistedAt', 'dispatchedAt', 'sentAt', 'ackedAt', 'claimToken', 'emissionId', 'nextTaskSpecBinding', 'transport', 'adapter', 'scheduler']) {
      assert.equal(excluded in request, false, `${excluded} must not be in request`);
      assert.ok(BLOCKED_TRANSPORT_REQUEST_FIELDS.includes(excluded), `${excluded} must be blocked`);
    }
    // Repository isolation: temp home only.
    assert.ok(home.startsWith(tmpdir()));
    void resolveCoordinationHome;
    void STORE_MODULE_URL;
  } finally {
    removeHome(home);
  }
});
