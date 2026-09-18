// Proof for GREENHUB-COORDINATION-DURABLE-DISPATCH-ATTEMPT-19.
// Immutable durable dispatch-attempt persistence ONLY, over the exact LIVE
// Task 18 claim-bound dispatch envelope:
//
//   CURRENT LIVE CLAIM -> TASK 18 ENVELOPE -> IMMUTABLE DURABLE ATTEMPT.
//
// Explicitly NOT implemented here (and asserted absent):
//   sendDispatch, dispatchNextTask, transport adapter, HTTP/WebSocket/MCP/
//   stdin-stdout transport, OpenCode/Codex/Astra/ChatGPT invocation,
//   child_process, spawn, exec, executor process, worker registry, worker
//   selection, capability matching, queue scan, READY scan, scheduler loop,
//   polling loop, daemon, cron, fan-out, load balancing, priority/fairness,
//   retry/backoff policy, ACK protocol, ACK persistence, executor acceptance,
//   DISPATCHED task status, EXECUTOR_ACCEPTED task status, task status mutation,
//   claim creation/takeover/extension, automatic claim, admission mutation,
//   emission mutation, result watcher, deliverResult changes, result authority
//   changes, publication automation framework.
//
// persistDispatchAttempt() != sendDispatch() != dispatchNextTask().
// "attempt persisted" != "sent" != "accepted" != "executing".
// The caller explicitly supplies (sourceTaskId, emissionSlot, workerId);
// generation authority stays SOLELY claimGeneration (no dispatchGeneration,
// attemptGeneration, retryGeneration, retryCount, scheduler-owned attempt
// number, incrementing sequence, backoff, retry policy, resend count).
// All runtime state lives in isolated temp directories. No network required.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveCoordinationHome } from './coordination-home.mjs';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import { DEFAULT_EMISSION_SLOT } from './next-task-emission.mjs';
import {
  buildClaimBoundDispatchEnvelope,
  validateClaimBoundDispatchEnvelope,
} from './claim-bound-dispatch-envelope.mjs';
import {
  BLOCKED_DISPATCH_ATTEMPT_FIELDS,
  DISPATCH_ATTEMPT_RECORD_FIELDS,
  DISPATCH_ATTEMPT_SCHEMA_VERSION,
  assertValidDispatchAttemptId,
  buildDispatchAttemptRecord,
  dispatchAttemptFilePath,
  envelopeFromDispatchAttemptRecord,
  validateDispatchAttemptRecord,
} from './dispatch-attempt.mjs';
import { CoordinationStore } from './store.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const ATTEMPT_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'dispatch-attempt.mjs')).href;
const STORE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'store.mjs')).href;

function makeHome(prefix = 'greenhub-dispatch19-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'DURABLE_DISPATCH_ATTEMPT_PROVED',
    policyRefs: ['docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md'],
    evidenceRefs: ['git:live-main-read'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: {
      liveMainHint: null,
      requiredPolicies: ['AGENTS.md'],
    },
    ownedSurface: ['scripts/coordination/'],
    mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['durable-dispatch-attempt-proof'],
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

function claimPath(home, taskId) {
  return join(home, 'tasks', taskId, 'claim.json');
}

function attemptPath(home, sourceTaskId, dispatchId) {
  return join(home, 'tasks', sourceTaskId, 'dispatch-attempts', `${dispatchId}.json`);
}

function attemptDir(home, sourceTaskId) {
  return join(home, 'tasks', sourceTaskId, 'dispatch-attempts');
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

function listAttemptDispatchIds(home, sourceTaskId) {
  let names;
  try {
    names = readdirSync(attemptDir(home, sourceTaskId));
  } catch {
    return [];
  }
  return [...names].sort();
}

function runFreshAttemptWorker({ sourceTaskId, emissionSlot, envelope }) {
  return new Promise((resolveResult, rejectResult) => {
    const code = [
      'try {',
      `  const { buildDispatchAttemptRecord } = await import(${JSON.stringify(ATTEMPT_MODULE_URL)});`,
      `  const out = buildDispatchAttemptRecord({ sourceTaskId: ${JSON.stringify(sourceTaskId)}, emissionSlot: ${JSON.stringify(emissionSlot)}, envelope: ${JSON.stringify(envelope)} });`,
      '  console.log(JSON.stringify({ ok: true, record: out }));',
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
        rejectResult(new Error(`attempt worker exit=${exitCode} stderr=${stderr}`));
        return;
      }
      try {
        resolveResult(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch (error) {
        rejectResult(new Error(`attempt worker output parse failed: ${stdout} / ${stderr}`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// A. PURE RECORD DETERMINISM: same source/slot/envelope -> identical record.
// ---------------------------------------------------------------------------

test('A. pure record determinism: repeated builds return identical canonical record', () => {
  const envelope = buildClaimBoundDispatchEnvelope({
    admissionId: 'adm_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    nextTaskId: 'DE19-A-CHILD',
    workerId: 'worker-a',
    claimGeneration: 1,
  });
  const first = buildDispatchAttemptRecord({ sourceTaskId: 'DE19-A-SRC', emissionSlot: 'next', envelope });
  assert.ok(Object.isFrozen(first));
  assert.deepEqual(Object.keys(first), [...DISPATCH_ATTEMPT_RECORD_FIELDS]);
  assert.equal(first.schemaVersion, DISPATCH_ATTEMPT_SCHEMA_VERSION);
  assert.equal(first.sourceTaskId, 'DE19-A-SRC');
  assert.equal(first.emissionSlot, 'next');
  assert.equal(first.dispatchId, envelope.dispatchId);
  assert.equal(first.admissionId, envelope.admissionId);
  assert.equal(first.nextTaskId, 'DE19-A-CHILD');
  assert.equal(first.workerId, 'worker-a');
  assert.equal(first.claimGeneration, 1);
  for (let replay = 0; replay < 10; replay += 1) {
    const out = buildDispatchAttemptRecord({ sourceTaskId: 'DE19-A-SRC', emissionSlot: 'next', envelope: { ...envelope } });
    assert.deepEqual(out, first);
    assert.equal(JSON.stringify(out), JSON.stringify(first));
  }
  assert.deepEqual(validateDispatchAttemptRecord(first), first);
  assert.deepEqual(validateDispatchAttemptRecord(JSON.parse(JSON.stringify(first))), first);
});

// ---------------------------------------------------------------------------
// B. FRESH PROCESS REPLAY.
// ---------------------------------------------------------------------------

test('B. fresh process returns byte-identical record', { timeout: 60_000 }, async () => {
  const envelope = buildClaimBoundDispatchEnvelope({
    admissionId: 'adm_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    nextTaskId: 'DE19-B-CHILD',
    workerId: 'worker-a',
    claimGeneration: 1,
  });
  const baseline = buildDispatchAttemptRecord({ sourceTaskId: 'DE19-B-SRC', emissionSlot: 'next', envelope });
  const worker = await runFreshAttemptWorker({ sourceTaskId: 'DE19-B-SRC', emissionSlot: 'next', envelope });
  assert.equal(worker.ok, true);
  assert.deepEqual(worker.record, baseline);
  assert.equal(JSON.stringify(worker.record), JSON.stringify(baseline));
});

// ---------------------------------------------------------------------------
// C. CLOCK EXCLUSION: wall-clock/mtime never enter record identity.
// ---------------------------------------------------------------------------

test('C. clock exclusion: wall-clock skew and mtime skew leave record identity identical', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToClaimed(store, clock, 'DE19-C-SRC', 'DE19-C-CHILD', 'result-de19-c-src');
    const envelope = store.readClaimBoundDispatchEnvelope({ sourceTaskId: 'DE19-C-SRC', workerId: 'worker-a' });
    const baseline = buildDispatchAttemptRecord({ sourceTaskId: 'DE19-C-SRC', emissionSlot: 'next', envelope });
    // +/-1 year wall-clock movement: pure builder takes no clock.
    clock.advance(365 * 86_400_000);
    const skewedFuture = buildDispatchAttemptRecord({ sourceTaskId: 'DE19-C-SRC', emissionSlot: 'next', envelope });
    clock.advance(-2 * 365 * 86_400_000);
    const skewedPast = buildDispatchAttemptRecord({ sourceTaskId: 'DE19-C-SRC', emissionSlot: 'next', envelope });
    assert.equal(JSON.stringify(skewedFuture), JSON.stringify(baseline));
    assert.equal(JSON.stringify(skewedPast), JSON.stringify(baseline));
    // Record carries no timestamp/process/retry/transport fields.
    for (const excluded of ['createdAt', 'persistedAt', 'dispatchedAt', 'sentAt', 'ackedAt', 'mtime', 'pid', 'hostname', 'retryCount', 'dispatchGeneration', 'transport']) {
      assert.equal(excluded in baseline, false, `${excluded} must not be in record`);
    }
    // Persisted readback is mtime-invariant: skew mtimes, reread identical.
    const persisted = store.persistDispatchAttempt({ sourceTaskId: 'DE19-C-SRC', workerId: 'worker-a' });
    assert.deepEqual(persisted, baseline);
    const skewedPastDate = new Date(clock.now - 365 * 86_400_000);
    const skewedFutureDate = new Date(clock.now + 365 * 86_400_000);
    utimesSync(attemptPath(home, 'DE19-C-SRC', persisted.dispatchId), skewedPastDate, skewedFutureDate);
    const reread = store.readDispatchAttempt({ sourceTaskId: 'DE19-C-SRC', dispatchId: persisted.dispatchId });
    assert.deepEqual(reread, baseline);
    assert.equal(JSON.stringify(reread), JSON.stringify(baseline));
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// D. NORMAL LIVE PERSIST: canonical admission + CLAIMED -> one exact attempt.
// ---------------------------------------------------------------------------

test('D. normal live persist creates exactly one immutable attempt', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToClaimed(store, clock, 'DE19-D-SRC', 'DE19-D-CHILD', 'result-de19-d-src');
    assert.equal(store.readTask('DE19-D-CHILD').status, 'CLAIMED');
    const claimBefore = store.readClaim('DE19-D-CHILD');
    const taskBefore = store.readTask('DE19-D-CHILD');
    const beforeBytes = snapshotHomeBytes(home);

    const envelope = store.readClaimBoundDispatchEnvelope({ sourceTaskId: 'DE19-D-SRC', workerId: 'worker-a' });
    const attempt = store.persistDispatchAttempt({ sourceTaskId: 'DE19-D-SRC', workerId: 'worker-a' });
    assert.ok(Object.isFrozen(attempt));
    assert.deepEqual(Object.keys(attempt), [...DISPATCH_ATTEMPT_RECORD_FIELDS]);
    assert.equal(attempt.sourceTaskId, 'DE19-D-SRC');
    assert.equal(attempt.emissionSlot, 'next');
    assert.equal(attempt.dispatchId, envelope.dispatchId);
    assert.equal(attempt.admissionId, envelope.admissionId);
    assert.equal(attempt.nextTaskId, 'DE19-D-CHILD');
    assert.equal(attempt.workerId, 'worker-a');
    assert.equal(attempt.claimGeneration, claimBefore.generation);

    // Exact path + byte content.
    const expectedPath = dispatchAttemptFilePath(home, 'DE19-D-SRC', envelope.dispatchId);
    assert.equal(expectedPath, attemptPath(home, 'DE19-D-SRC', envelope.dispatchId));
    assert.ok(existsSync(expectedPath));
    assert.equal(readFileSync(expectedPath, 'utf8'), JSON.stringify(attempt, null, 2));
    assert.deepEqual(store.readDispatchAttempt({ sourceTaskId: 'DE19-D-SRC', dispatchId: envelope.dispatchId }), attempt);
    assert.deepEqual(listAttemptDispatchIds(home, 'DE19-D-SRC'), [`${envelope.dispatchId}.json`]);

    // Claim/task/admission untouched (status stays CLAIMED, generation stable).
    assert.deepEqual(store.readClaim('DE19-D-CHILD'), claimBefore);
    assert.deepEqual(store.readTask('DE19-D-CHILD'), taskBefore);
    assert.equal(store.readTask('DE19-D-CHILD').status, 'CLAIMED');

    // Durable delta is exactly one new file (OS-agnostic path compare).
    const afterBytes = snapshotHomeBytes(home);
    const added = Object.keys(afterBytes).filter((key) => !(key in beforeBytes));
    assert.deepEqual(added, [join('tasks', 'DE19-D-SRC', 'dispatch-attempts', `${envelope.dispatchId}.json`)]);

    // Pure restore helper recovers the live envelope for future transport.
    const restored = envelopeFromDispatchAttemptRecord(attempt);
    assert.deepEqual(restored, envelope);
    assert.deepEqual(validateClaimBoundDispatchEnvelope(restored), envelope);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. IDEMPOTENT REPLAY: same current claim -> file bytes invariant.
// ---------------------------------------------------------------------------

test('E. idempotent replay leaves file bytes invariant', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToClaimed(store, clock, 'DE19-E-SRC', 'DE19-E-CHILD', 'result-de19-e-src');
    const first = store.persistDispatchAttempt({ sourceTaskId: 'DE19-E-SRC', workerId: 'worker-a' });
    const fileBytes = readFileSync(attemptPath(home, 'DE19-E-SRC', first.dispatchId), 'utf8');
    const afterFirst = snapshotHomeBytes(home);
    for (let replay = 0; replay < 5; replay += 1) {
      clock.advance(1000);
      const out = store.persistDispatchAttempt({ sourceTaskId: 'DE19-E-SRC', emissionSlot: 'next', workerId: 'worker-a' });
      assert.deepEqual(out, first);
      assert.equal(JSON.stringify(out), JSON.stringify(first));
    }
    assert.equal(readFileSync(attemptPath(home, 'DE19-E-SRC', first.dispatchId), 'utf8'), fileBytes);
    assert.deepEqual(snapshotHomeBytes(home), afterFirst);
    // Multi-instance replay against the same home agrees.
    const store2 = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    assert.deepEqual(store2.persistDispatchAttempt({ sourceTaskId: 'DE19-E-SRC', workerId: 'worker-a' }), first);
    assert.equal(readFileSync(attemptPath(home, 'DE19-E-SRC', first.dispatchId), 'utf8'), fileBytes);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. CONCURRENT CREATE: same dispatchId -> exactly one durable file.
// ---------------------------------------------------------------------------

test('F. concurrent create serializes to exactly one canonical file', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToClaimed(store, clock, 'DE19-F-SRC', 'DE19-F-CHILD', 'result-de19-f-src');
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        Promise.resolve().then(() =>
          store.persistDispatchAttempt({ sourceTaskId: 'DE19-F-SRC', workerId: 'worker-a' }),
        ),
      ),
    );
    for (const out of results) {
      assert.deepEqual(out, results[0]);
    }
    assert.deepEqual(listAttemptDispatchIds(home, 'DE19-F-SRC'), [`${results[0].dispatchId}.json`]);
    // Concurrent winners across independent store handles agree identically.
    const handles = Array.from({ length: 5 }, () => new CoordinationStore({ dir: home, nowProvider: () => clock.provider() }));
    const mixed = await Promise.all(handles.map((handle) => Promise.resolve().then(() => handle.persistDispatchAttempt({ sourceTaskId: 'DE19-F-SRC', workerId: 'worker-a' }))));
    for (const out of mixed) {
      assert.deepEqual(out, results[0]);
    }
    assert.deepEqual(listAttemptDispatchIds(home, 'DE19-F-SRC'), [`${results[0].dispatchId}.json`]);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// G. GENERATION FORK: gen1 D1 + gen2 D2 both preserved, stale fenced.
// ---------------------------------------------------------------------------

test('G. same-worker generation fork preserves both attempts and fences stale', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToClaimed(store, clock, 'DE19-G-SRC', 'DE19-G-CHILD', 'result-de19-g-src');
    const d1 = store.persistDispatchAttempt({ sourceTaskId: 'DE19-G-SRC', workerId: 'worker-a' });
    assert.equal(d1.claimGeneration, 1);
    const d1Bytes = readFileSync(attemptPath(home, 'DE19-G-SRC', d1.dispatchId), 'utf8');

    clock.advance(120_000);
    const reclaimed = store.claimAdmittedTask({
      sourceTaskId: 'DE19-G-SRC',
      workerId: 'worker-a',
      leaseDurationMs: 60_000,
      nowMs: clock.now,
    });
    assert.equal(reclaimed.claim.generation, 2);
    const d2 = store.persistDispatchAttempt({ sourceTaskId: 'DE19-G-SRC', workerId: 'worker-a' });
    assert.equal(d2.claimGeneration, 2);
    assert.notEqual(d1.dispatchId, d2.dispatchId);

    // Both durable histories exist; D1 untouched (no overwrite, no promotion).
    assert.deepEqual(listAttemptDispatchIds(home, 'DE19-G-SRC').sort(), [`${d1.dispatchId}.json`, `${d2.dispatchId}.json`].sort());
    assert.equal(readFileSync(attemptPath(home, 'DE19-G-SRC', d1.dispatchId), 'utf8'), d1Bytes);
    assert.deepEqual(store.readDispatchAttempt({ sourceTaskId: 'DE19-G-SRC', dispatchId: d1.dispatchId }), d1);
    assert.deepEqual(store.readDispatchAttempt({ sourceTaskId: 'DE19-G-SRC', dispatchId: d2.dispatchId }), d2);

    // Task 18 fencing: stale D1 envelope rejects as STALE_DISPATCH.
    const staleEnvelope = envelopeFromDispatchAttemptRecord(d1);
    assert.throws(
      () => store.verifyClaimBoundDispatchEnvelope({ sourceTaskId: 'DE19-G-SRC', envelope: staleEnvelope }),
      (error) => error?.code === 'STALE_DISPATCH',
    );
    const currentEnvelope = envelopeFromDispatchAttemptRecord(d2);
    assert.deepEqual(store.verifyClaimBoundDispatchEnvelope({ sourceTaskId: 'DE19-G-SRC', envelope: currentEnvelope }), currentEnvelope);

    // Re-persisting the current generation stays idempotent and never
    // resurrects D1 as current.
    assert.deepEqual(store.persistDispatchAttempt({ sourceTaskId: 'DE19-G-SRC', workerId: 'worker-a' }), d2);
    assert.equal(readFileSync(attemptPath(home, 'DE19-G-SRC', d1.dispatchId), 'utf8'), d1Bytes);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// H. WRONG WORKER: fail closed, durable delta 0.
// ---------------------------------------------------------------------------

test('H. wrong worker fails closed with DISPATCH_BINDING_MISMATCH and delta 0', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToClaimed(store, clock, 'DE19-H-SRC', 'DE19-H-CHILD', 'result-de19-h-src', 'worker-a');
    const beforeBytes = snapshotHomeBytes(home);
    const beforeClaim = store.readClaim('DE19-H-CHILD');
    assert.throws(
      () => store.persistDispatchAttempt({ sourceTaskId: 'DE19-H-SRC', workerId: 'worker-b' }),
      (error) => error?.code === 'DISPATCH_BINDING_MISMATCH',
    );
    assert.deepEqual(snapshotHomeBytes(home), beforeBytes);
    assert.deepEqual(store.readClaim('DE19-H-CHILD'), beforeClaim);
    assert.equal(store.readTask('DE19-H-CHILD').status, 'CLAIMED');
    assert.deepEqual(listAttemptDispatchIds(home, 'DE19-H-SRC'), []);
    // Missing workerId is never inferred.
    assert.throws(() => store.persistDispatchAttempt({ sourceTaskId: 'DE19-H-SRC' }), (error) => error != null);
    assert.throws(() => store.persistDispatchAttempt({ sourceTaskId: 'DE19-H-SRC', workerId: '  ' }), (error) => error != null);
    assert.deepEqual(snapshotHomeBytes(home), beforeBytes);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// I. READY / UNCLAIMED: fail closed, durable delta 0.
// ---------------------------------------------------------------------------

test('I. READY and unclaimed children forbid persistence with delta 0', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'DE19-I-SRC', 'DE19-I-CHILD', 'result-de19-i-src');
    assert.equal(store.readTask('DE19-I-CHILD').status, 'READY');
    const beforeBytes = snapshotHomeBytes(home);
    // I1: READY with no claim yet -> CLAIM_NOT_FOUND (claim first, never auto-claim).
    assert.throws(
      () => store.persistDispatchAttempt({ sourceTaskId: 'DE19-I-SRC', workerId: 'worker-a' }),
      (error) => error?.code === 'CLAIM_NOT_FOUND',
    );
    assert.deepEqual(snapshotHomeBytes(home), beforeBytes);
    assert.equal(existsSync(claimPath(home, 'DE19-I-CHILD')), false);

    // I2: crash-window shape (claim present + READY) -> TASK_NOT_CLAIMED.
    store.claimAdmittedTask({ sourceTaskId: 'DE19-I-SRC', workerId: 'worker-a' });
    assert.equal(store.readTask('DE19-I-CHILD').status, 'CLAIMED');
    const childFile = join(home, 'tasks', 'DE19-I-CHILD', 'task.json');
    const claimedChild = JSON.parse(readFileSync(childFile, 'utf8'));
    writeFileSync(
      childFile,
      JSON.stringify({ ...claimedChild, status: 'READY', updatedAt: '2026-01-01T00:00:00.000Z' }, null, 2),
      'utf8',
    );
    assert.equal(store.readTask('DE19-I-CHILD').status, 'READY');
    const crashBytes = snapshotHomeBytes(home);
    const crashClaim = readFileSync(claimPath(home, 'DE19-I-CHILD'), 'utf8');
    assert.throws(
      () => store.persistDispatchAttempt({ sourceTaskId: 'DE19-I-SRC', workerId: 'worker-a' }),
      (error) => error?.code === 'TASK_NOT_CLAIMED',
    );
    // Only the hand-crafted READY rewrite differs; no attempt file appears.
    const afterBytes = snapshotHomeBytes(home);
    assert.deepEqual(Object.keys(afterBytes).filter((key) => key.includes('dispatch-attempts')), []);
    assert.deepEqual(afterBytes, crashBytes);
    assert.equal(readFileSync(claimPath(home, 'DE19-I-CHILD'), 'utf8'), crashClaim);
    assert.equal(store.readTask('DE19-I-CHILD').status, 'READY');
    void beforeBytes;
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// J. TERMINAL: RESULT_DELIVERED forbids persistence, delta 0.
// ---------------------------------------------------------------------------

test('J. terminal RESULT_DELIVERED forbids persistence with delta 0', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { claimed } = driveToClaimed(store, clock, 'DE19-J-SRC', 'DE19-J-CHILD', 'result-de19-j-src');
    store.deliverResult(sampleResult(claimed.claim, { taskId: 'DE19-J-CHILD', resultId: 'result-de19-j-child' }));
    assert.equal(store.readTask('DE19-J-CHILD').status, 'RESULT_DELIVERED');
    const beforeBytes = snapshotHomeBytes(home);
    const claimBytes = readFileSync(claimPath(home, 'DE19-J-CHILD'), 'utf8');
    assert.throws(
      () => store.persistDispatchAttempt({ sourceTaskId: 'DE19-J-SRC', workerId: 'worker-a' }),
      (error) => error?.code === 'TASK_TERMINAL',
    );
    assert.deepEqual(snapshotHomeBytes(home), beforeBytes);
    assert.equal(readFileSync(claimPath(home, 'DE19-J-CHILD'), 'utf8'), claimBytes);
    assert.deepEqual(listAttemptDispatchIds(home, 'DE19-J-SRC'), []);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// K. MISSING / FOREIGN / CORRUPT CLAIM: fail closed, delta 0.
// ---------------------------------------------------------------------------

test('K1. missing claim.json fails closed with delta 0', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToClaimed(store, clock, 'DE19-K1-SRC', 'DE19-K1-CHILD', 'result-de19-k1-src');
    rmSync(claimPath(home, 'DE19-K1-CHILD'), { force: true });
    const beforeBytes = snapshotHomeBytes(home);
    assert.throws(
      () => store.persistDispatchAttempt({ sourceTaskId: 'DE19-K1-SRC', workerId: 'worker-a' }),
      (error) => error?.code === 'CLAIM_NOT_FOUND',
    );
    assert.deepEqual(snapshotHomeBytes(home), beforeBytes);
    assert.deepEqual(listAttemptDispatchIds(home, 'DE19-K1-SRC'), []);
  } finally {
    removeHome(home);
  }
});

test('K2. foreign claim token fails closed with delta 0', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'DE19-K2-SRC', 'DE19-K2-CHILD', 'result-de19-k2-src');
    store.markReady('DE19-K2-CHILD');
    store.claimTask({ taskId: 'DE19-K2-CHILD', workerId: 'worker-a', leaseDurationMs: 60_000, claimToken: 'random-manual-token' });
    const beforeBytes = snapshotHomeBytes(home);
    const claimBytes = readFileSync(claimPath(home, 'DE19-K2-CHILD'), 'utf8');
    assert.throws(
      () => store.persistDispatchAttempt({ sourceTaskId: 'DE19-K2-SRC', workerId: 'worker-a' }),
      (error) => error?.code === 'CLAIM_ADMISSION_BYPASS_DETECTED',
    );
    assert.deepEqual(snapshotHomeBytes(home), beforeBytes);
    assert.equal(readFileSync(claimPath(home, 'DE19-K2-CHILD'), 'utf8'), claimBytes);
    assert.deepEqual(listAttemptDispatchIds(home, 'DE19-K2-SRC'), []);
  } finally {
    removeHome(home);
  }
});

test('K3. corrupt claim.json fails closed with delta 0', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToClaimed(store, clock, 'DE19-K3-SRC', 'DE19-K3-CHILD', 'result-de19-k3-src');
    writeFileSync(claimPath(home, 'DE19-K3-CHILD'), '{not-json', 'utf8');
    const beforeBytes = snapshotHomeBytes(home);
    assert.throws(
      () => store.persistDispatchAttempt({ sourceTaskId: 'DE19-K3-SRC', workerId: 'worker-a' }),
      (error) => error?.code === 'CORRUPT_CLAIM',
    );
    assert.deepEqual(snapshotHomeBytes(home), beforeBytes);
    assert.deepEqual(listAttemptDispatchIds(home, 'DE19-K3-SRC'), []);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// L. PREEXISTING CORRUPT ATTEMPT: fail closed, no overwrite/repair.
// ---------------------------------------------------------------------------

test('L1. preexisting corrupt-JSON attempt fails closed without repair', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToClaimed(store, clock, 'DE19-L1-SRC', 'DE19-L1-CHILD', 'result-de19-l1-src');
    const attempt = store.persistDispatchAttempt({ sourceTaskId: 'DE19-L1-SRC', workerId: 'worker-a' });
    const target = attemptPath(home, 'DE19-L1-SRC', attempt.dispatchId);
    writeFileSync(target, '{corrupt-json', 'utf8');
    const corruptBytes = readFileSync(target, 'utf8');
    assert.throws(
      () => store.persistDispatchAttempt({ sourceTaskId: 'DE19-L1-SRC', workerId: 'worker-a' }),
      (error) => error?.code === 'CORRUPT_DISPATCH_ATTEMPT',
    );
    assert.equal(readFileSync(target, 'utf8'), corruptBytes);
    assert.throws(
      () => store.readDispatchAttempt({ sourceTaskId: 'DE19-L1-SRC', dispatchId: attempt.dispatchId }),
      (error) => error?.code === 'CORRUPT_DISPATCH_ATTEMPT',
    );
    assert.equal(readFileSync(target, 'utf8'), corruptBytes);
  } finally {
    removeHome(home);
  }
});

test('L2. preexisting tampered-binding attempt fails closed without overwrite', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToClaimed(store, clock, 'DE19-L2-SRC', 'DE19-L2-CHILD', 'result-de19-l2-src');
    const attempt = store.persistDispatchAttempt({ sourceTaskId: 'DE19-L2-SRC', workerId: 'worker-a' });
    const target = attemptPath(home, 'DE19-L2-SRC', attempt.dispatchId);
    // Valid JSON shape but tampered binding (generation flipped without id recompute).
    const tampered = { ...attempt, claimGeneration: attempt.claimGeneration + 99 };
    writeFileSync(target, JSON.stringify(tampered, null, 2), 'utf8');
    const tamperedBytes = readFileSync(target, 'utf8');
    assert.throws(
      () => store.persistDispatchAttempt({ sourceTaskId: 'DE19-L2-SRC', workerId: 'worker-a' }),
      (error) => error?.code === 'CORRUPT_DISPATCH_ATTEMPT' || error?.code === 'DISPATCH_BINDING_MISMATCH',
    );
    assert.equal(readFileSync(target, 'utf8'), tamperedBytes);
    assert.throws(
      () => store.readDispatchAttempt({ sourceTaskId: 'DE19-L2-SRC', dispatchId: attempt.dispatchId }),
      (error) => error != null,
    );
    assert.equal(readFileSync(target, 'utf8'), tamperedBytes);
  } finally {
    removeHome(home);
  }
});

test('L3. missing attempt reads as NOT_FOUND', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToClaimed(store, clock, 'DE19-L3-SRC', 'DE19-L3-CHILD', 'result-de19-l3-src');
    const envelope = store.readClaimBoundDispatchEnvelope({ sourceTaskId: 'DE19-L3-SRC', workerId: 'worker-a' });
    assert.throws(
      () => store.readDispatchAttempt({ sourceTaskId: 'DE19-L3-SRC', dispatchId: envelope.dispatchId }),
      (error) => error?.code === 'DISPATCH_ATTEMPT_NOT_FOUND',
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// M. PATH/RECORD BINDING TAMPER.
// ---------------------------------------------------------------------------

test('M1. dispatchId filename vs record binding mismatch fails closed', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToClaimed(store, clock, 'DE19-M1-SRC', 'DE19-M1-CHILD', 'result-de19-m1-src');
    const attempt = store.persistDispatchAttempt({ sourceTaskId: 'DE19-M1-SRC', workerId: 'worker-a' });
    // Build a second valid record for the same source with a different
    // generation fork: use a valid envelope with generation+99 is invalid, so
    // instead craft a valid record for a different binding by hand is hard;
    // simplest path/record tamper: file at D1 path holds a VALID record whose
    // dispatchId is a different well-formed id (recomputed for tampered gen
    // via a second live generation is unavailable here, so use a synthetic
    // valid record for another task and place it under this filename).
    const foreignEnvelope = buildClaimBoundDispatchEnvelope({
      admissionId: attempt.admissionId,
      nextTaskId: 'DE19-M1-CHILD',
      workerId: 'worker-a',
      claimGeneration: attempt.claimGeneration + 1,
    });
    const foreignRecord = buildDispatchAttemptRecord({ sourceTaskId: 'DE19-M1-SRC', emissionSlot: 'next', envelope: foreignEnvelope });
    assert.notEqual(foreignRecord.dispatchId, attempt.dispatchId);
    writeFileSync(attemptPath(home, 'DE19-M1-SRC', attempt.dispatchId), JSON.stringify(foreignRecord, null, 2), 'utf8');
    assert.throws(
      () => store.readDispatchAttempt({ sourceTaskId: 'DE19-M1-SRC', dispatchId: attempt.dispatchId }),
      (error) => error?.code === 'DISPATCH_ATTEMPT_BINDING_MISMATCH',
    );
  } finally {
    removeHome(home);
  }
});

test('M2. sourceTaskId path vs record mismatch fails closed', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToClaimed(store, clock, 'DE19-M2-SRC', 'DE19-M2-CHILD', 'result-de19-m2-src');
    const attempt = store.persistDispatchAttempt({ sourceTaskId: 'DE19-M2-SRC', workerId: 'worker-a' });
    const target = attemptPath(home, 'DE19-M2-SRC', attempt.dispatchId);
    const tampered = { ...attempt, sourceTaskId: 'DE19-M2-SRC2' };
    // sourceTaskId DE19-M2-SRC2 matches the ID pattern but differs from path.
    writeFileSync(target, JSON.stringify(tampered, null, 2), 'utf8');
    assert.throws(
      () => store.readDispatchAttempt({ sourceTaskId: 'DE19-M2-SRC', dispatchId: attempt.dispatchId }),
      (error) => error?.code === 'DISPATCH_ATTEMPT_BINDING_MISMATCH' || error?.code === 'CORRUPT_DISPATCH_ATTEMPT',
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// N. REPOSITORY ISOLATION.
// ---------------------------------------------------------------------------

test('N. all durable files stay in temp home, never in the repository', () => {
  const home = makeHome();
  try {
    assert.ok(home.startsWith(tmpdir()));
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToClaimed(store, clock, 'DE19-N-SRC', 'DE19-N-CHILD', 'result-de19-n-src');
    store.persistDispatchAttempt({ sourceTaskId: 'DE19-N-SRC', workerId: 'worker-a' });
    const bytes = snapshotHomeBytes(home);
    assert.ok(Object.keys(bytes).some((key) => key.includes('dispatch-attempts')));
    for (const key of Object.keys(bytes)) {
      assert.equal(key.includes('..'), false);
    }
    const repoTasks = join(resolve(MODULE_DIRECTORY, '../..'), 'tasks');
    assert.equal(existsSync(repoTasks), false);
    assert.equal(existsSync(join(MODULE_DIRECTORY, 'dispatch-attempt.mjs')), true);
    assert.equal(existsSync(join(MODULE_DIRECTORY, 'dispatch-attempt.spec.mjs')), true);
    void resolveCoordinationHome;
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// BOUNDARY19: persistence only; no transport/scheduler/executor/ACK/status.
// ---------------------------------------------------------------------------

test('BOUNDARY19. durable attempt only; transport/scheduler/executor/ACK/status/retry absent', () => {
  const home = makeHome();
  try {
    assert.equal(DEFAULT_EMISSION_SLOT, 'next');
    assert.equal(DISPATCH_ATTEMPT_SCHEMA_VERSION, '1');
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
      'sendAttempt',
      'transportAttempt',
      'deliverAttempt',
      'claimNextTask',
      'autoClaim',
      'listReadyTasks',
      'findReadyTask',
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
    ]) {
      assert.equal(store[forbidden], undefined, `${forbidden} must not exist`);
    }
    for (const allowed of [
      'persistDispatchAttempt',
      'readDispatchAttempt',
      'readClaimBoundDispatchEnvelope',
      'verifyClaimBoundDispatchEnvelope',
      'emitNextTask',
      'readEmission',
      'admitEmittedTask',
      'readEmissionAdmission',
      'claimAdmittedTask',
      'readAdmissionBoundClaim',
      'readCanonicalSchedulableWork',
      'claimTask',
      'readClaim',
      'markReady',
      'readTask',
      'deliverResult',
    ]) {
      assert.equal(typeof store[allowed], 'function', `${allowed} must exist`);
    }
    assert.notEqual(
      CoordinationStore.prototype.persistDispatchAttempt,
      CoordinationStore.prototype.readClaimBoundDispatchEnvelope,
    );
    // Pure module surface is record-only: no fs/scheduler/dispatch/executor exports.
    // Functional tokens only (header comments may document out-of-scope names,
    // matching the Task 18 boundary pattern).
    const attemptSource = readFileSync(join(MODULE_DIRECTORY, 'dispatch-attempt.mjs'), 'utf8');
    for (const forbiddenToken of [
      "from 'node:fs'",
      'node:child_process',
      'writeFileSync',
      'mkdirSync',
      'spawn(',
      'claimTask(',
      'markReady(',
      'deliverResult(',
      'fetch(',
      'WebSocket(',
      'new WebSocket',
    ]) {
      assert.equal(attemptSource.includes(forbiddenToken), false, `attempt module must not contain ${forbiddenToken}`);
    }
    // Record owns no generation counter, retry authority, timestamps, or
    // transport fields: the frozen shape plus the blocked list prove exclusion.
    const probeEnvelope = buildClaimBoundDispatchEnvelope({
      admissionId: 'adm_ffffffffffffffffffffffffffffffff',
      nextTaskId: 'DE19-BND-PROBE',
      workerId: 'worker-a',
      claimGeneration: 1,
    });
    const probe = buildDispatchAttemptRecord({ sourceTaskId: 'DE19-BND-SRC', emissionSlot: 'next', envelope: probeEnvelope });
    assert.deepEqual(Object.keys(probe), [...DISPATCH_ATTEMPT_RECORD_FIELDS]);
    for (const excluded of ['dispatchGeneration', 'attemptGeneration', 'retryGeneration', 'retryCount', 'createdAt', 'persistedAt', 'dispatchedAt', 'sentAt', 'ackedAt', 'claimToken', 'emissionId', 'nextTaskSpecBinding', 'transport', 'adapter', 'scheduler']) {
      assert.equal(excluded in probe, false, `${excluded} must not be in record`);
      assert.ok(BLOCKED_DISPATCH_ATTEMPT_FIELDS.includes(excluded), `${excluded} must be blocked`);
    }
    assert.throws(() => assertValidDispatchAttemptId('not-an-id'), (error) => error != null);
    // Store wiring persists exactly one domain: no claim/admission/task/result writes.
    // Functional tokens only (header comments may document out-of-scope names,
    // matching the Task 18 boundary pattern).
    const storeSource = readFileSync(join(MODULE_DIRECTORY, 'store.mjs'), 'utf8');
    const attemptSection = storeSource.slice(storeSource.indexOf('Durable dispatch-attempt domain'));
    assert.ok(attemptSection.length > 0);
    for (const forbiddenWrite of ['claimTask({', '#markClaimed', 'deliverResult(', 'writeJsonAtomic', "status: 'DISPATCHED'", "'DISPATCHED'", '"DISPATCHED"', "'EXECUTOR_ACCEPTED'", '"EXECUTOR_ACCEPTED"', 'TASK_STATUS_DISPATCHED', 'TASK_STATUS_EXECUTOR']) {
      assert.equal(attemptSection.includes(forbiddenWrite), false, `dispatch-attempt store section must not contain ${forbiddenWrite}`);
    }
    // Exclusive-create is the concurrency primitive (functional exists-check
    // then write is forbidden; documenting the pattern in comments is allowed).
    assert.ok(attemptSection.includes('writeJsonExclusive'));
    assert.equal(attemptSection.includes('existsSync('), false);
    assert.equal(attemptSection.includes('existsSync ('), false);
    // Task statuses unchanged: only the four canonical states (functional).
    assert.equal(storeSource.includes("'DISPATCHED'"), false);
    assert.equal(storeSource.includes('"DISPATCHED"'), false);
    assert.equal(storeSource.includes('TASK_STATUS_DISPATCHED'), false);
    assert.equal(storeSource.includes("'EXECUTOR_ACCEPTED'"), false);
    assert.equal(storeSource.includes('"EXECUTOR_ACCEPTED"'), false);
    assert.equal(storeSource.includes('TASK_STATUS_EXECUTOR'), false);
    // Live proof: successful persist changes exactly one file domain.
    driveToClaimed(store, clock, 'DE19-BND-SRC', 'DE19-BND-CHILD', 'result-de19-bnd-src');
    const before = snapshotHomeBytes(home);
    const persisted = store.persistDispatchAttempt({ sourceTaskId: 'DE19-BND-SRC', workerId: 'worker-a' });
    const after = snapshotHomeBytes(home);
    const added = Object.keys(after).filter((key) => !(key in before));
    assert.deepEqual(added, [join('tasks', 'DE19-BND-SRC', 'dispatch-attempts', `${persisted.dispatchId}.json`)]);
    const repoTasks = join(resolve(MODULE_DIRECTORY, '../..'), 'tasks');
    assert.equal(existsSync(repoTasks), false);
  } finally {
    removeHome(home);
  }
});
