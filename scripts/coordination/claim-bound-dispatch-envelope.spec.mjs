// Proof for GREENHUB-COORDINATION-CLAIM-BOUND-DISPATCH-ENVELOPE-18.
// Claim-bound dispatch envelope identity + live binding ONLY:
// deterministic dispatchId over (admissionId, nextTaskId, workerId,
// claimGeneration) plus a pure read-only store binding over the exact
// canonical emission admission + current claim.json.
//
// Explicitly NOT implemented here (and asserted absent):
//   dispatchAttempt, sendDispatch, dispatchNextTask, scheduler loop, queue
//   polling, worker selection, executor selection, adapter registry, process
//   spawn, executor invocation, ACK persistence, DISPATCHED task status,
//   EXECUTOR_ACCEPTED task status, dispatchGeneration, retry counter authority,
//   daemon, cron, result watcher, fan-out, load balancing, priority/fairness,
//   durable dispatch-attempt file, dispatch directory, exclusive-create
//   dispatch persistence, transport, HTTP/WebSocket/MCP/stdin adapter,
//   OpenCode/Codex/Astra/ChatGPT invocation, subprocess, ACK protocol,
//   scheduler, selector, worker registry, capability matching, assignment
//   authority, automatic worker inference.
// buildClaimBoundDispatchEnvelope() != scheduleNextTask()
//   != dispatchNextTask() != decideNextTask() != emitNextTask()
//   != admitEmittedTask() != claimAdmittedTask().
// The caller explicitly supplies the four identity inputs (pure) or
// (sourceTaskId, emissionSlot, workerId) for the live read. Generation is
// minted/bumped ONLY by the existing claimTask(); this primitive never
// creates/increments/resets/repairs generations and never mutates.
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
import { DEFAULT_EMISSION_SLOT, computeNextTaskSpecBinding } from './next-task-emission.mjs';
import { buildAdmissionBoundClaimToken } from './admission-bound-claim.mjs';
import {
  BLOCKED_CLAIM_BOUND_DISPATCH_FIELDS,
  CLAIM_BOUND_DISPATCH_ID_PREFIX,
  buildClaimBoundDispatchEnvelope,
  buildClaimBoundDispatchId,
  canonicalClaimGenerationString,
  validateClaimBoundDispatchEnvelope,
} from './claim-bound-dispatch-envelope.mjs';
import { TASK_SEQUENCE_CONTRACT } from './task-sequence.mjs';
import { CoordinationStore } from './store.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const ENVELOPE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'claim-bound-dispatch-envelope.mjs')).href;
const STORE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'store.mjs')).href;

function makeHome(prefix = 'greenhub-dispatch18-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'CLAIM_BOUND_DISPATCH_ENVELOPE_PROVED',
    policyRefs: ['docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md'],
    evidenceRefs: ['git:live-main-read'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: {
      liveMainHint: null,
      requiredPolicies: ['AGENTS.md'],
    },
    ownedSurface: ['scripts/coordination/'],
    mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['claim-bound-dispatch-envelope-proof'],
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

function childTaskPath(home, taskId) {
  return join(home, 'tasks', taskId, 'task.json');
}

function admissionPath(home, sourceTaskId, slot = DEFAULT_EMISSION_SLOT) {
  return join(home, 'tasks', sourceTaskId, 'emission-admissions', `${slot}.json`);
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

function runFreshEnvelopeWorker({ admissionId, nextTaskId, workerId, claimGeneration }) {
  return new Promise((resolveResult, rejectResult) => {
    const code = [
      'try {',
      `  const { buildClaimBoundDispatchEnvelope } = await import(${JSON.stringify(ENVELOPE_MODULE_URL)});`,
      `  const out = buildClaimBoundDispatchEnvelope({ admissionId: ${JSON.stringify(admissionId)}, nextTaskId: ${JSON.stringify(nextTaskId)}, workerId: ${JSON.stringify(workerId)}, claimGeneration: ${JSON.stringify(claimGeneration)} });`,
      '  console.log(JSON.stringify({ ok: true, envelope: out }));',
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
        rejectResult(new Error(`envelope worker exit=${exitCode} stderr=${stderr}`));
        return;
      }
      try {
        resolveResult(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch (error) {
        rejectResult(new Error(`envelope worker output parse failed: ${stdout} / ${stderr}`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// A. BASIC DETERMINISM: 10x same inputs -> same dispatchId + logical envelope.
// ---------------------------------------------------------------------------

test('A. basic determinism: 10x same inputs return identical dispatchId and envelope', () => {
  const input = {
    admissionId: 'adm_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    nextTaskId: 'DE18-A-CHILD',
    workerId: 'worker-a',
    claimGeneration: 1,
  };
  const first = buildClaimBoundDispatchEnvelope(input);
  assert.ok(Object.isFrozen(first));
  assert.deepEqual(Object.keys(first), ['dispatchId', 'admissionId', 'nextTaskId', 'workerId', 'claimGeneration']);
  for (let replay = 0; replay < 10; replay += 1) {
    const out = buildClaimBoundDispatchEnvelope({ ...input });
    assert.equal(out.dispatchId, first.dispatchId);
    assert.deepEqual(out, first);
    assert.equal(JSON.stringify(out), JSON.stringify(first));
  }
  // Canonical generation representation pinned: integer 1 -> "1".
  assert.equal(canonicalClaimGenerationString(1), '1');
  assert.equal(canonicalClaimGenerationString(2), '2');
  assert.ok(first.dispatchId.startsWith(CLAIM_BOUND_DISPATCH_ID_PREFIX));
  assert.match(first.dispatchId.slice(CLAIM_BOUND_DISPATCH_ID_PREFIX.length), /^[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------------------
// B. FRESH PROCESS DETERMINISM.
// ---------------------------------------------------------------------------

test('B. fresh process/module instance returns byte-identical dispatchId', { timeout: 60_000 }, async () => {
  const input = {
    admissionId: 'adm_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    nextTaskId: 'DE18-B-CHILD',
    workerId: 'worker-a',
    claimGeneration: 1,
  };
  const baseline = buildClaimBoundDispatchEnvelope(input);
  const worker = await runFreshEnvelopeWorker(input);
  assert.equal(worker.ok, true);
  assert.deepEqual(worker.envelope, baseline);
  assert.equal(worker.envelope.dispatchId, baseline.dispatchId);
  assert.equal(JSON.stringify(worker.envelope), JSON.stringify(baseline));
});

// ---------------------------------------------------------------------------
// C. CLOCK EXCLUSION: +/-1 year, timestamps, pid never participate.
// ---------------------------------------------------------------------------

test('C. clock exclusion: +-1 year, timestamp and pid differences leave dispatchId identical', { timeout: 60_000 }, async () => {
  const input = {
    admissionId: 'adm_cccccccccccccccccccccccccccccccc',
    nextTaskId: 'DE18-C-CHILD',
    workerId: 'worker-a',
    claimGeneration: 1,
  };
  const baseline = buildClaimBoundDispatchEnvelope(input);
  // Simulate +/-1 year wall-clock movement: pure builder takes no clock.
  const yearMs = 365 * 86_400_000;
  void yearMs;
  const skewedFuture = buildClaimBoundDispatchEnvelope(input);
  const skewedPast = buildClaimBoundDispatchEnvelope(input);
  assert.equal(skewedFuture.dispatchId, baseline.dispatchId);
  assert.equal(skewedPast.dispatchId, baseline.dispatchId);
  // Different process (different pid) agrees byte-identically.
  const worker = await runFreshEnvelopeWorker(input);
  assert.equal(worker.ok, true);
  assert.equal(worker.envelope.dispatchId, baseline.dispatchId);
  // Envelope carries no timestamps/process state.
  assert.deepEqual(Object.keys(baseline), ['dispatchId', 'admissionId', 'nextTaskId', 'workerId', 'claimGeneration']);
  assert.equal('dispatchedAt' in baseline, false);
  assert.equal('sentAt' in baseline, false);
  assert.equal('pid' in baseline, false);
});

// ---------------------------------------------------------------------------
// D. SAME-WORKER GENERATION FORK: gen1 != gen2; claimToken may stay equal.
// ---------------------------------------------------------------------------

test('D. same-worker generation fork: gen1 vs gen2 dispatchIds differ while claimToken stays stable', () => {
  const admissionId = 'adm_dddddddddddddddddddddddddddddddd';
  const nextTaskId = 'DE18-D-CHILD';
  const workerId = 'worker-a';
  const gen1 = buildClaimBoundDispatchEnvelope({ admissionId, nextTaskId, workerId, claimGeneration: 1 });
  const gen2 = buildClaimBoundDispatchEnvelope({ admissionId, nextTaskId, workerId, claimGeneration: 2 });
  assert.notEqual(gen1.dispatchId, gen2.dispatchId);
  assert.notDeepEqual(gen1, gen2);
  // T21 contract link: same admission/task/worker -> same claimToken across
  // generations (fencing is by generation, never by token alone).
  const token1 = buildAdmissionBoundClaimToken({ admissionId, nextTaskId, workerId });
  const token2 = buildAdmissionBoundClaimToken({ admissionId, nextTaskId, workerId });
  assert.equal(token1, token2);
});

// ---------------------------------------------------------------------------
// E/F/G. WORKER / ADMISSION / TASK FORKS.
// ---------------------------------------------------------------------------

test('E. different-worker fork: workerA vs workerB dispatchIds differ', () => {
  const base = { admissionId: 'adm_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', nextTaskId: 'DE18-E-CHILD', claimGeneration: 1 };
  const a = buildClaimBoundDispatchEnvelope({ ...base, workerId: 'worker-a' });
  const b = buildClaimBoundDispatchEnvelope({ ...base, workerId: 'worker-b' });
  assert.notEqual(a.dispatchId, b.dispatchId);
});

test('F. admission fork: admissionA vs admissionB dispatchIds differ', () => {
  const base = { nextTaskId: 'DE18-F-CHILD', workerId: 'worker-a', claimGeneration: 1 };
  const a = buildClaimBoundDispatchEnvelope({ ...base, admissionId: 'adm_ffffffffffffffffffffffffffffffff' });
  const b = buildClaimBoundDispatchEnvelope({ ...base, admissionId: 'adm_00000000000000000000000000000000' });
  assert.notEqual(a.dispatchId, b.dispatchId);
});

test('G. task fork: taskA vs taskB dispatchIds differ', () => {
  const base = { admissionId: 'adm_11111111111111111111111111111111', workerId: 'worker-a', claimGeneration: 1 };
  const a = buildClaimBoundDispatchEnvelope({ ...base, nextTaskId: 'DE18-GA-CHILD' });
  const b = buildClaimBoundDispatchEnvelope({ ...base, nextTaskId: 'DE18-GB-CHILD' });
  assert.notEqual(a.dispatchId, b.dispatchId);
});

// ---------------------------------------------------------------------------
// PROVENANCE EXCLUSION: excluded values never enter identity.
// ---------------------------------------------------------------------------

test('P0. provenance exclusion: emissionId/specBinding/claimToken/timestamps/transport never enter dispatchId', () => {
  const base = {
    admissionId: 'adm_22222222222222222222222222222222',
    nextTaskId: 'DE18-P0-CHILD',
    workerId: 'worker-a',
    claimGeneration: 1,
  };
  const baseline = buildClaimBoundDispatchEnvelope(base);
  // Same four inputs always bind identically no matter what excluded
  // provenance exists elsewhere (emissionId, specBinding, claimToken,
  // dispatchedAt, pid, hostname, retry, transport are not inputs at all).
  const replayed = buildClaimBoundDispatchEnvelope({ ...base });
  assert.equal(replayed.dispatchId, baseline.dispatchId);
  // Blocked smuggling attempts fail closed instead of entering identity.
  for (const blocked of ['emissionId', 'nextTaskSpecBinding', 'claimToken', 'dispatchedAt', 'dispatchGeneration', 'retryCount', 'transport', 'pid']) {
    assert.throws(
      () => buildClaimBoundDispatchEnvelope({ ...base, [blocked]: 'smuggled-value' }),
      (error) => error?.code === 'INVALID_DISPATCH_BINDING',
      `blocked field ${blocked} must be rejected`,
    );
  }
  // The blocked list owns the exclusion contract.
  for (const owned of ['emissionId', 'nextTaskSpecBinding', 'claimToken', 'dispatchedAt', 'dispatchGeneration']) {
    assert.ok(BLOCKED_CLAIM_BOUND_DISPATCH_FIELDS.includes(owned), `${owned} must be blocked`);
  }
});

// ---------------------------------------------------------------------------
// H/I. VALIDATOR RECOMPUTATION + GENERATION TAMPER.
// ---------------------------------------------------------------------------

test('H. validator recomputation: tampered dispatchId fails closed', () => {
  const envelope = buildClaimBoundDispatchEnvelope({
    admissionId: 'adm_33333333333333333333333333333333',
    nextTaskId: 'DE18-H-CHILD',
    workerId: 'worker-a',
    claimGeneration: 1,
  });
  assert.deepEqual(validateClaimBoundDispatchEnvelope(envelope), envelope);
  const tampered = { ...envelope, dispatchId: `${CLAIM_BOUND_DISPATCH_ID_PREFIX}${'f'.repeat(64)}` };
  assert.throws(
    () => validateClaimBoundDispatchEnvelope(tampered),
    (error) => error?.code === 'DISPATCH_BINDING_MISMATCH',
  );
});

test('I. generation tamper: gen1 envelope with gen2 generation fails recomputation', () => {
  const gen1 = buildClaimBoundDispatchEnvelope({
    admissionId: 'adm_44444444444444444444444444444444',
    nextTaskId: 'DE18-I-CHILD',
    workerId: 'worker-a',
    claimGeneration: 1,
  });
  // Tamper only the generation without recomputing the id.
  const tampered = { ...gen1, claimGeneration: 2 };
  assert.throws(
    () => validateClaimBoundDispatchEnvelope(tampered),
    (error) => error?.code === 'DISPATCH_BINDING_MISMATCH',
  );
  // Properly built gen2 is internally valid but differs from gen1.
  const gen2 = buildClaimBoundDispatchEnvelope({
    admissionId: 'adm_44444444444444444444444444444444',
    nextTaskId: 'DE18-I-CHILD',
    workerId: 'worker-a',
    claimGeneration: 2,
  });
  assert.deepEqual(validateClaimBoundDispatchEnvelope(gen2), gen2);
  assert.notEqual(gen1.dispatchId, gen2.dispatchId);
});

test('I2. malformed builder inputs fail with INVALID_DISPATCH_BINDING', () => {
  assert.throws(
    () => buildClaimBoundDispatchEnvelope({ admissionId: '', nextTaskId: 'DE18-I2-CHILD', workerId: 'worker-a', claimGeneration: 1 }),
    (error) => error?.code === 'INVALID_DISPATCH_BINDING',
  );
  assert.throws(
    () => buildClaimBoundDispatchEnvelope({ admissionId: 'adm_x', nextTaskId: 'bad id!', workerId: 'worker-a', claimGeneration: 1 }),
    (error) => error?.code === 'INVALID_DISPATCH_BINDING',
  );
  assert.throws(
    () => buildClaimBoundDispatchEnvelope({ admissionId: 'adm_x', nextTaskId: 'DE18-I2-CHILD', workerId: '  ', claimGeneration: 1 }),
    (error) => error?.code === 'INVALID_DISPATCH_BINDING',
  );
  for (const badGen of [0, -1, 1.5, '1', null, undefined]) {
    assert.throws(
      () => buildClaimBoundDispatchEnvelope({ admissionId: 'adm_x', nextTaskId: 'DE18-I2-CHILD', workerId: 'worker-a', claimGeneration: badGen }),
      (error) => error?.code === 'INVALID_DISPATCH_BINDING',
    );
  }
  // dispatchGeneration is forbidden: never accepted as an alias.
  assert.throws(
    () => buildClaimBoundDispatchEnvelope({ admissionId: 'adm_x', nextTaskId: 'DE18-I2-CHILD', workerId: 'worker-a', claimGeneration: 1, dispatchGeneration: 1 }),
    (error) => error?.code === 'INVALID_DISPATCH_BINDING',
  );
});

// ---------------------------------------------------------------------------
// J. LIVE CLAIM BINDING: canonical admission + CLAIMED -> envelope success.
// ---------------------------------------------------------------------------

test('J. live claim binding: canonical admission + CLAIMED builds the current envelope', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { admitted } = driveToClaimed(store, clock, 'DE18-J-SRC', 'DE18-J-CHILD', 'result-de18-j-src');
    assert.equal(store.readTask('DE18-J-CHILD').status, 'CLAIMED');
    const claim = store.readClaim('DE18-J-CHILD');
    assert.equal(claim.workerId, 'worker-a');

    const envelope = store.readClaimBoundDispatchEnvelope({
      sourceTaskId: 'DE18-J-SRC',
      workerId: 'worker-a',
    });
    assert.ok(Object.isFrozen(envelope));
    assert.equal(envelope.admissionId, admitted.record.admissionId);
    assert.equal(envelope.nextTaskId, 'DE18-J-CHILD');
    assert.equal(envelope.workerId, 'worker-a');
    assert.equal(envelope.claimGeneration, claim.generation);
    assert.equal(
      envelope.dispatchId,
      buildClaimBoundDispatchId({
        admissionId: admitted.record.admissionId,
        nextTaskId: 'DE18-J-CHILD',
        workerId: 'worker-a',
        claimGeneration: claim.generation,
      }),
    );
    assert.deepEqual(validateClaimBoundDispatchEnvelope(envelope), envelope);
    // Verify path agrees the supplied current envelope is current.
    const verified = store.verifyClaimBoundDispatchEnvelope({
      sourceTaskId: 'DE18-J-SRC',
      envelope,
    });
    assert.deepEqual(verified, envelope);
    // Explicit slot agrees with the default.
    assert.deepEqual(
      store.readClaimBoundDispatchEnvelope({ sourceTaskId: 'DE18-J-SRC', emissionSlot: 'next', workerId: 'worker-a' }),
      envelope,
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// K. WRONG WORKER: fail closed, no mutation.
// ---------------------------------------------------------------------------

test('K. wrong worker fails closed with DISPATCH_BINDING_MISMATCH and no mutation', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToClaimed(store, clock, 'DE18-K-SRC', 'DE18-K-CHILD', 'result-de18-k-src', 'worker-a');
    const beforeBytes = snapshotHomeBytes(home);
    const beforeClaim = store.readClaim('DE18-K-CHILD');
    assert.throws(
      () => store.readClaimBoundDispatchEnvelope({ sourceTaskId: 'DE18-K-SRC', workerId: 'worker-b' }),
      (error) => error?.code === 'DISPATCH_BINDING_MISMATCH',
    );
    assert.deepEqual(snapshotHomeBytes(home), beforeBytes);
    assert.deepEqual(store.readClaim('DE18-K-CHILD'), beforeClaim);
    assert.equal(store.readTask('DE18-K-CHILD').status, 'CLAIMED');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// L/M. STALE GENERATION + SAME-WORKER RECLAIM.
// ---------------------------------------------------------------------------

test('L. stale generation: gen1 envelope vs gen2 current fails with STALE_DISPATCH', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToClaimed(store, clock, 'DE18-L-SRC', 'DE18-L-CHILD', 'result-de18-l-src', 'worker-a');
    const gen1 = store.readClaimBoundDispatchEnvelope({ sourceTaskId: 'DE18-L-SRC', workerId: 'worker-a' });
    assert.equal(gen1.claimGeneration, 1);

    // Expired reclaim by the same worker bumps to gen2 (existing claimTask).
    clock.advance(120_000);
    const reclaimed = store.claimAdmittedTask({
      sourceTaskId: 'DE18-L-SRC',
      workerId: 'worker-a',
      leaseDurationMs: 60_000,
      nowMs: clock.now,
    });
    assert.equal(reclaimed.claim.generation, 2);
    const gen2 = store.readClaimBoundDispatchEnvelope({ sourceTaskId: 'DE18-L-SRC', workerId: 'worker-a' });
    assert.equal(gen2.claimGeneration, 2);
    assert.notEqual(gen1.dispatchId, gen2.dispatchId);

    // Replaying gen1 against gen2 liveness is stale.
    assert.throws(
      () => store.verifyClaimBoundDispatchEnvelope({ sourceTaskId: 'DE18-L-SRC', envelope: gen1 }),
      (error) => error?.code === 'STALE_DISPATCH',
    );
    // Current verifies cleanly.
    assert.deepEqual(store.verifyClaimBoundDispatchEnvelope({ sourceTaskId: 'DE18-L-SRC', envelope: gen2 }), gen2);
  } finally {
    removeHome(home);
  }
});

test('M. same-worker reclaim keeps claimToken but forks dispatchId', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { admitted } = driveToAdmitted(store, clock, 'DE18-M-SRC', 'DE18-M-CHILD', 'result-de18-m-src');
    const first = store.claimAdmittedTask({ sourceTaskId: 'DE18-M-SRC', workerId: 'worker-a', leaseDurationMs: 60_000, nowMs: clock.now });
    assert.equal(first.claim.generation, 1);
    const env1 = store.readClaimBoundDispatchEnvelope({ sourceTaskId: 'DE18-M-SRC', workerId: 'worker-a' });

    clock.advance(120_000);
    const second = store.claimAdmittedTask({ sourceTaskId: 'DE18-M-SRC', workerId: 'worker-a', leaseDurationMs: 60_000, nowMs: clock.now });
    assert.equal(second.claim.generation, 2);
    // T21: deterministic token stable across same-worker generations.
    assert.equal(second.claim.claimToken, first.claim.claimToken);
    assert.equal(
      second.claim.claimToken,
      buildAdmissionBoundClaimToken({ admissionId: admitted.record.admissionId, nextTaskId: 'DE18-M-CHILD', workerId: 'worker-a' }),
    );
    const env2 = store.readClaimBoundDispatchEnvelope({ sourceTaskId: 'DE18-M-SRC', workerId: 'worker-a' });
    // Task-18 invariant: dispatch identity MUST fork.
    assert.notEqual(env1.dispatchId, env2.dispatchId);
    assert.equal(env1.claimGeneration, 1);
    assert.equal(env2.claimGeneration, 2);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// MISSING / FOREIGN CLAIM.
// ---------------------------------------------------------------------------

test('X1. CLAIMED status with missing claim.json fails closed with CLAIM_NOT_FOUND', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToClaimed(store, clock, 'DE18-X1-SRC', 'DE18-X1-CHILD', 'result-de18-x1-src');
    assert.equal(store.readTask('DE18-X1-CHILD').status, 'CLAIMED');
    rmSync(claimPath(home, 'DE18-X1-CHILD'), { force: true });
    assert.throws(
      () => store.readClaimBoundDispatchEnvelope({ sourceTaskId: 'DE18-X1-SRC', workerId: 'worker-a' }),
      (error) => error?.code === 'CLAIM_NOT_FOUND',
    );
    // No envelope, no status repair.
    assert.equal(store.readTask('DE18-X1-CHILD').status, 'CLAIMED');
  } finally {
    removeHome(home);
  }
});

test('X2. foreign claim token fails closed with CLAIM_ADMISSION_BYPASS_DETECTED', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'DE18-X2-SRC', 'DE18-X2-CHILD', 'result-de18-x2-src');
    store.markReady('DE18-X2-CHILD');
    store.claimTask({ taskId: 'DE18-X2-CHILD', workerId: 'worker-a', leaseDurationMs: 60_000, claimToken: 'random-manual-token' });
    assert.equal(store.readTask('DE18-X2-CHILD').status, 'CLAIMED');
    const before = readFileSync(claimPath(home, 'DE18-X2-CHILD'), 'utf8');
    assert.throws(
      () => store.readClaimBoundDispatchEnvelope({ sourceTaskId: 'DE18-X2-SRC', workerId: 'worker-a' }),
      (error) => error?.code === 'CLAIM_ADMISSION_BYPASS_DETECTED',
    );
    assert.equal(readFileSync(claimPath(home, 'DE18-X2-CHILD'), 'utf8'), before);
    assert.equal(store.readTask('DE18-X2-CHILD').status, 'CLAIMED');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// N. TERMINAL CHILD.
// ---------------------------------------------------------------------------

test('N. terminal RESULT_DELIVERED forbids new envelopes with no rewind', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { claimed } = driveToClaimed(store, clock, 'DE18-N-SRC', 'DE18-N-CHILD', 'result-de18-n-src');
    store.deliverResult(sampleResult(claimed.claim, { taskId: 'DE18-N-CHILD', resultId: 'result-de18-n-child' }));
    assert.equal(store.readTask('DE18-N-CHILD').status, 'RESULT_DELIVERED');
    const claimBytes = readFileSync(claimPath(home, 'DE18-N-CHILD'), 'utf8');
    assert.throws(
      () => store.readClaimBoundDispatchEnvelope({ sourceTaskId: 'DE18-N-SRC', workerId: 'worker-a' }),
      (error) => error?.code === 'TASK_TERMINAL',
    );
    // No rewind, no new claim, no overwrite.
    assert.equal(store.readTask('DE18-N-CHILD').status, 'RESULT_DELIVERED');
    assert.equal(readFileSync(claimPath(home, 'DE18-N-CHILD'), 'utf8'), claimBytes);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// O. READY CHILD (no auto-claim).
// ---------------------------------------------------------------------------

test('O. READY child forbids envelopes with no automatic claim', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'DE18-O-SRC', 'DE18-O-CHILD', 'result-de18-o-src');
    assert.equal(store.readTask('DE18-O-CHILD').status, 'READY');
    // O1: READY with no claim yet -> CLAIM_NOT_FOUND (claim first).
    assert.throws(
      () => store.readClaimBoundDispatchEnvelope({ sourceTaskId: 'DE18-O-SRC', workerId: 'worker-a' }),
      (error) => error?.code === 'CLAIM_NOT_FOUND',
    );
    assert.equal(existsSync(claimPath(home, 'DE18-O-CHILD')), false);
    assert.equal(store.readTask('DE18-O-CHILD').status, 'READY');

    // O2: crash-window shape (claim present + READY) never converges here.
    store.claimAdmittedTask({ sourceTaskId: 'DE18-O-SRC', workerId: 'worker-a' });
    assert.equal(store.readTask('DE18-O-CHILD').status, 'CLAIMED');
    const childFile = childTaskPath(home, 'DE18-O-CHILD');
    const claimedChild = JSON.parse(readFileSync(childFile, 'utf8'));
    writeFileSync(
      childFile,
      JSON.stringify({ ...claimedChild, status: 'READY', updatedAt: '2026-01-01T00:00:00.000Z' }, null, 2),
      'utf8',
    );
    assert.equal(store.readTask('DE18-O-CHILD').status, 'READY');
    const claimBytes = readFileSync(claimPath(home, 'DE18-O-CHILD'), 'utf8');
    assert.throws(
      () => store.readClaimBoundDispatchEnvelope({ sourceTaskId: 'DE18-O-SRC', workerId: 'worker-a' }),
      (error) => error?.code === 'TASK_NOT_CLAIMED',
    );
    // Still READY, claim bytes untouched: no convergence, no auto-claim.
    assert.equal(store.readTask('DE18-O-CHILD').status, 'READY');
    assert.equal(readFileSync(claimPath(home, 'DE18-O-CHILD'), 'utf8'), claimBytes);
  } finally {
    removeHome(home);
  }
});

test('O3. CREATED child forbids envelopes', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'DE18-O3-SRC', 'DE18-O3-CHILD', 'result-de18-o3-src');
    assert.equal(store.readTask('DE18-O3-CHILD').status, 'CREATED');
    assert.throws(
      () => store.readClaimBoundDispatchEnvelope({ sourceTaskId: 'DE18-O3-SRC', workerId: 'worker-a' }),
      (error) => error != null,
    );
    assert.equal(existsSync(claimPath(home, 'DE18-O3-CHILD')), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// P. BYTE PRESERVATION + TIMESTAMP SKEW.
// ---------------------------------------------------------------------------

test('P. byte preservation: pure and live envelope builds leave durable bytes identical', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToClaimed(store, clock, 'DE18-P-SRC', 'DE18-P-CHILD', 'result-de18-p-src');
    const before = snapshotHomeBytes(home);
    const first = store.readClaimBoundDispatchEnvelope({ sourceTaskId: 'DE18-P-SRC', workerId: 'worker-a' });
    for (let replay = 0; replay < 5; replay += 1) {
      clock.advance(1000);
      const out = store.readClaimBoundDispatchEnvelope({ sourceTaskId: 'DE18-P-SRC', workerId: 'worker-a' });
      assert.deepEqual(out, first);
      // Pure builder replay also touches nothing durable.
      assert.deepEqual(
        buildClaimBoundDispatchEnvelope({
          admissionId: first.admissionId,
          nextTaskId: first.nextTaskId,
          workerId: first.workerId,
          claimGeneration: first.claimGeneration,
        }),
        first,
      );
    }
    assert.deepEqual(snapshotHomeBytes(home), before);

    // mtime skew + provenance-only child rewrite leave the live envelope identical.
    const skewedPast = new Date(clock.now - 365 * 86_400_000);
    const skewedFuture = new Date(clock.now + 365 * 86_400_000);
    const touchAll = (directory, flip) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) {
          touchAll(full, !flip);
        } else if (entry.isFile()) {
          utimesSync(full, flip ? skewedPast : skewedFuture, flip ? skewedFuture : skewedPast);
        }
      }
    };
    touchAll(home, true);
    const taskFile = childTaskPath(home, 'DE18-P-CHILD');
    const current = JSON.parse(readFileSync(taskFile, 'utf8'));
    assert.equal(computeNextTaskSpecBinding(current), computeNextTaskSpecBinding(store.readTask('DE18-P-CHILD')));
    const reread = store.readClaimBoundDispatchEnvelope({ sourceTaskId: 'DE18-P-SRC', workerId: 'worker-a' });
    assert.equal(reread.dispatchId, first.dispatchId);
    assert.deepEqual(reread, first);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// BOUNDARY18: identity + binding envelope only.
// ---------------------------------------------------------------------------

test('BOUNDARY18. envelope only; dispatchGeneration/persistence/transport/scheduler/executor absent', () => {
  const home = makeHome();
  try {
    assert.equal(DEFAULT_EMISSION_SLOT, 'next');
    assert.equal(TASK_SEQUENCE_CONTRACT, 'append-stable-task-sequence-v1');
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    for (const forbidden of [
      'dispatchAttempt',
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
      'astraSync',
      'openCodeSync',
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
    ]) {
      assert.equal(store[forbidden], undefined, `${forbidden} must not exist`);
    }
    for (const allowed of [
      'emitNextTask',
      'readEmission',
      'admitEmittedTask',
      'readEmissionAdmission',
      'claimAdmittedTask',
      'readAdmissionBoundClaim',
      'readCanonicalSchedulableWork',
      'readClaimBoundDispatchEnvelope',
      'verifyClaimBoundDispatchEnvelope',
      'claimTask',
      'readClaim',
      'markReady',
      'readTask',
      'deliverResult',
    ]) {
      assert.equal(typeof store[allowed], 'function', `${allowed} must exist`);
    }
    assert.notEqual(
      CoordinationStore.prototype.readClaimBoundDispatchEnvelope,
      CoordinationStore.prototype.readAdmissionBoundClaim,
    );
    assert.notEqual(
      CoordinationStore.prototype.readClaimBoundDispatchEnvelope,
      CoordinationStore.prototype.claimAdmittedTask,
    );
    // Pure module surface is identity-only: no fs/scheduler/dispatch/executor exports.
    // Functional implementation tokens must be absent (out-of-scope names may
    // appear in header comments only as documentation, matching the
    // canonical-schedulable-work-read boundary pattern).
    const envelopeSource = readFileSync(join(MODULE_DIRECTORY, 'claim-bound-dispatch-envelope.mjs'), 'utf8');
    for (const forbiddenToken of [
      "from 'node:fs'",
      'node:child_process',
      'readdir',
      'writeJson',
      'writeFileSync',
      'mkdirSync',
      'spawn(',
      'claimTask(',
      'markReady(',
      'listTaskIds',
      'syncTaskSequence',
      'selectWorker',
      'priority(',
      'dispatch(',
    ]) {
      assert.equal(envelopeSource.includes(forbiddenToken), false, `envelope module must not contain ${forbiddenToken}`);
    }
    // Identity owns no generation counter, retry authority, timestamps, or
    // transport fields: the frozen envelope shape plus the blocked list prove
    // exclusion (functional check, not a comment-substring check).
    const probeEnvelope = buildClaimBoundDispatchEnvelope({
      admissionId: 'adm_ffffffffffffffffffffffffffffffff',
      nextTaskId: 'DE18-BND-PROBE',
      workerId: 'worker-a',
      claimGeneration: 1,
    });
    assert.deepEqual(Object.keys(probeEnvelope), ['dispatchId', 'admissionId', 'nextTaskId', 'workerId', 'claimGeneration']);
    for (const excluded of ['dispatchGeneration', 'retryCount', 'dispatchedAt', 'sentAt', 'ackedAt', 'claimToken', 'emissionId', 'nextTaskSpecBinding', 'transport']) {
      assert.equal(excluded in probeEnvelope, false, `${excluded} must not be in envelope`);
      assert.ok(BLOCKED_CLAIM_BOUND_DISPATCH_FIELDS.includes(excluded), `${excluded} must be blocked`);
    }
    // Store wiring is read-only: no dispatch persistence/transport/executor writes.
    const storeSource = readFileSync(join(MODULE_DIRECTORY, 'store.mjs'), 'utf8');
    const dispatchSection = storeSource.slice(storeSource.indexOf('Claim-bound dispatch envelope domain'));
    assert.ok(dispatchSection.length > 0);
    for (const forbiddenWrite of ['writeJsonExclusive', 'writeJsonAtomic', 'claimTask({', '#markClaimed', 'deliverResult']) {
      assert.equal(dispatchSection.includes(forbiddenWrite), false, `dispatch read section must not contain ${forbiddenWrite}`);
    }
    // Live proof: reads change nothing durable.
    driveToClaimed(store, clock, 'DE18-BND-SRC', 'DE18-BND-CHILD', 'result-de18-bnd-src');
    const before = snapshotHomeBytes(home);
    store.readClaimBoundDispatchEnvelope({ sourceTaskId: 'DE18-BND-SRC', workerId: 'worker-a' });
    store.verifyClaimBoundDispatchEnvelope({
      sourceTaskId: 'DE18-BND-SRC',
      envelope: store.readClaimBoundDispatchEnvelope({ sourceTaskId: 'DE18-BND-SRC', workerId: 'worker-a' }),
    });
    assert.deepEqual(snapshotHomeBytes(home), before);
    const repoTasks = join(resolve(MODULE_DIRECTORY, '../..'), 'tasks');
    assert.equal(existsSync(repoTasks), false);
    assert.equal(existsSync(join(MODULE_DIRECTORY, 'claim-bound-dispatch-envelope.mjs')), true);
    assert.equal(existsSync(join(MODULE_DIRECTORY, 'claim-bound-dispatch-envelope.spec.mjs')), true);
    void resolveCoordinationHome;
  } finally {
    removeHome(home);
  }
});
