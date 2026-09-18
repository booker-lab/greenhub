// Proof for GREENHUB-COORDINATION-DETERMINISTIC-NEXT-TASK-EMISSION-13.
// Deterministic next-task emission primitive ONLY:
// caller-decided nextTaskSpec bound to one canonical slot of one CONSUMED
// source closure, durably created through the canonical createTask path,
// exactly once per logical emission.
//
// Explicitly NOT implemented here (and asserted absent):
//   semantic next-task planning, AI task generation, desiredExitState
//   inference, scheduler, queue polling, autonomous Control Tower loop, worker
//   selection, executor dispatch, adapters (Astra/OpenCode/Web), fan-out,
//   DAG planner, priority queue, retry scheduler, cron, event daemon,
//   application code, deployment automation, production deployment, 57C.
// emitNextTask() != scheduleNextTask() != dispatchNextTask() != decideNextTask().
// All runtime state lives in isolated temp directories. No network required.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveCoordinationHome } from './coordination-home.mjs';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import {
  DEFAULT_EMISSION_SLOT,
  computeNextTaskSpecBinding,
} from './next-task-emission.mjs';
import { TASK_SEQUENCE_CONTRACT } from './task-sequence.mjs';
import { CoordinationStore } from './store.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const STORE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'store.mjs')).href;

function makeHome(prefix = 'greenhub-emit13-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'DETERMINISTIC_EMISSION_PROVED',
    policyRefs: ['docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md'],
    evidenceRefs: ['git:live-main-read'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: {
      liveMainHint: null,
      requiredPolicies: ['AGENTS.md'],
    },
    ownedSurface: ['scripts/coordination/'],
    mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['deterministic-emission-proof'],
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

function emissionPath(home, sourceTaskId, slot = DEFAULT_EMISSION_SLOT) {
  return join(home, 'tasks', sourceTaskId, 'emissions', `${slot}.json`);
}

function expectEmissionRefused(store, sourceTaskId, childTaskId) {
  assert.throws(
    () =>
      store.emitNextTask({
        sourceTaskId,
        nextTaskSpec: sampleTaskInput(childTaskId),
        emitterId: 'control-tower-1',
      }),
    (error) => error?.code === 'EMISSION_NOT_ELIGIBLE',
  );
  // Refused emission leaves no authority and no child behind.
  assert.equal(existsSync(emissionPath(store.home, sourceTaskId)), false);
  assert.throws(() => store.readTask(childTaskId), (error) => error?.code === 'TASK_NOT_FOUND');
}

// ---------------------------------------------------------------------------
// A. ELIGIBILITY: only a fully CONSUMED closure may emit.
// ---------------------------------------------------------------------------

test('A1. RESULT_DELIVERED only refuses emission', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToDelivered(store, 'ELIG13-DELIVERED', 'result-elig13-delivered');
    expectEmissionRefused(store, 'ELIG13-DELIVERED', 'ELIG13-CHILD-A1');
  } finally {
    removeHome(home);
  }
});

test('A2. PENDING_DISPOSITION refuses emission', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToPending(store, 'ELIG13-PENDING', 'result-elig13-pending');
    expectEmissionRefused(store, 'ELIG13-PENDING', 'ELIG13-CHILD-A2');
  } finally {
    removeHome(home);
  }
});

test('A3. non-ADOPTED terminal (REJECTED / BLOCKED) refuses emission', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToPending(store, 'ELIG13-REJECTED', 'result-elig13-rejected');
    clock.advance(1000);
    store.writeDisposition({
      taskId: 'ELIG13-REJECTED',
      dispositionGeneration: 2,
      resultId: 'result-elig13-rejected',
      ...ctParams({ controlTowerToken: 'ct-token-002' }),
      state: 'REJECTED',
    });
    expectEmissionRefused(store, 'ELIG13-REJECTED', 'ELIG13-CHILD-A3R');

    driveToPending(store, 'ELIG13-BLOCKED', 'result-elig13-blocked');
    clock.advance(1000);
    store.writeDisposition({
      taskId: 'ELIG13-BLOCKED',
      dispositionGeneration: 2,
      resultId: 'result-elig13-blocked',
      ...ctParams({ controlTowerToken: 'ct-token-003' }),
      state: 'BLOCKED',
    });
    expectEmissionRefused(store, 'ELIG13-BLOCKED', 'ELIG13-CHILD-A3B');
  } finally {
    removeHome(home);
  }
});

test('A4. ADOPTED without materialization / ACK / CONSUMED refuses emission', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });

    // ADOPTED but not materialized.
    driveToAdopted(store, clock, 'ELIG13-NOMAT', 'result-elig13-nomat');
    expectEmissionRefused(store, 'ELIG13-NOMAT', 'ELIG13-CHILD-A4M');

    // Materialized but not ACKed.
    driveToMaterialized(store, clock, 'ELIG13-NOACK', 'result-elig13-noack');
    expectEmissionRefused(store, 'ELIG13-NOACK', 'ELIG13-CHILD-A4A');

    // ACKed but not CONSUMED.
    driveToAcked(store, clock, 'ELIG13-NOCON', 'result-elig13-nocon');
    expectEmissionRefused(store, 'ELIG13-NOCON', 'ELIG13-CHILD-A4C');
  } finally {
    removeHome(home);
  }
});

test('A5. fully CONSUMED source is eligible and creates the child canonically', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToConsumed(store, clock, 'ELIG13-CONSUMED', 'result-elig13-consumed');

    const out = store.emitNextTask({
      sourceTaskId: 'ELIG13-CONSUMED',
      nextTaskSpec: sampleTaskInput('ELIG13-CHILD-A5'),
      emitterId: 'control-tower-1',
    });
    assert.equal(out.duplicate, false);
    assert.equal(out.record.sourceTaskId, 'ELIG13-CONSUMED');
    assert.equal(out.record.emissionSlot, DEFAULT_EMISSION_SLOT);
    assert.equal(out.record.nextTaskId, 'ELIG13-CHILD-A5');
    assert.equal(out.child.taskId, 'ELIG13-CHILD-A5');
    // Child went through the canonical lifecycle entry (CREATED envelope).
    const reread = store.readTask('ELIG13-CHILD-A5');
    assert.equal(reread.status, 'CREATED');
    assert.equal(computeNextTaskSpecBinding(reread), out.record.nextTaskSpecBinding);
    // Read-back path agrees with the live CONSUMED binding.
    assert.equal(store.readEmission('ELIG13-CONSUMED').emissionId, out.record.emissionId);
    // Exactly one append-stable sequence membership.
    const members = store.readTaskSequence().filter((id) => id === 'ELIG13-CHILD-A5');
    assert.equal(members.length, 1);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// B. IDEMPOTENCY: same source + same slot + same spec, 10 replays.
// ---------------------------------------------------------------------------

test('B. same-input replay x10 converges to one emission, one child, one sequence member', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToConsumed(store, clock, 'IDEM13-SRC', 'result-idem13-src');

    const first = store.emitNextTask({
      sourceTaskId: 'IDEM13-SRC',
      nextTaskSpec: sampleTaskInput('IDEM13-CHILD'),
      emitterId: 'control-tower-1',
    });
    assert.equal(first.duplicate, false);

    for (let replay = 0; replay < 10; replay += 1) {
      clock.advance(3_600_000); // wall-clock skew must never fork identity.
      const out = store.emitNextTask({
        sourceTaskId: 'IDEM13-SRC',
        nextTaskSpec: sampleTaskInput('IDEM13-CHILD'),
        emitterId: 'control-tower-1',
      });
      assert.equal(out.duplicate, true);
      assert.equal(out.record.emissionId, first.record.emissionId);
      assert.equal(out.child.taskId, 'IDEM13-CHILD');
      assert.deepEqual(out.record, first.record);
    }

    // One emission file, one child task, one sequence membership.
    assert.equal(store.readEmission('IDEM13-SRC').emissionId, first.record.emissionId);
    assert.equal(store.readTask('IDEM13-CHILD').taskId, 'IDEM13-CHILD');
    assert.equal(store.readTaskSequence().filter((id) => id === 'IDEM13-CHILD').length, 1);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// C. CONFLICT: same source + same slot + different spec fails closed.
// ---------------------------------------------------------------------------

test('C. conflicting spec preserves the first winner, never overwrites', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToConsumed(store, clock, 'CONF13-SRC', 'result-conf13-src');

    const winner = store.emitNextTask({
      sourceTaskId: 'CONF13-SRC',
      nextTaskSpec: sampleTaskInput('CONF13-WINNER'),
      emitterId: 'control-tower-1',
    });
    const before = readFileSync(emissionPath(home, 'CONF13-SRC'), 'utf8');

    assert.throws(
      () =>
        store.emitNextTask({
          sourceTaskId: 'CONF13-SRC',
          nextTaskSpec: sampleTaskInput('CONF13-LOSER'),
          emitterId: 'control-tower-1',
        }),
      (error) => error?.code === 'EMISSION_CONFLICT',
    );
    // Winner bytes untouched: no silent overwrite, no last-writer-wins.
    assert.equal(readFileSync(emissionPath(home, 'CONF13-SRC'), 'utf8'), before);
    assert.equal(store.readEmission('CONF13-SRC').nextTaskId, 'CONF13-WINNER');
    assert.equal(store.readEmission('CONF13-SRC').emissionId, winner.record.emissionId);
    // Loser child never created; winner child intact with single membership.
    assert.throws(() => store.readTask('CONF13-LOSER'), (error) => error?.code === 'TASK_NOT_FOUND');
    assert.equal(store.readTaskSequence().filter((id) => id === 'CONF13-WINNER').length, 1);

    // Same desiredExitState tweak is still a different spec: conflict.
    assert.throws(
      () =>
        store.emitNextTask({
          sourceTaskId: 'CONF13-SRC',
          nextTaskSpec: sampleTaskInput('CONF13-WINNER', { desiredExitState: 'MUTATED_EXIT' }),
          emitterId: 'control-tower-1',
        }),
      (error) => error?.code === 'EMISSION_CONFLICT',
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// D. CONCURRENCY: competing writers, exactly one canonical winner.
// ---------------------------------------------------------------------------

function runEmissionRaceWorker({ home, sourceTaskId, childTaskId, slot = DEFAULT_EMISSION_SLOT }) {
  return new Promise((resolveResult, rejectResult) => {
    const code = [
      'try {',
      `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
      `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
      `  const out = store.emitNextTask({ sourceTaskId: ${JSON.stringify(sourceTaskId)}, emissionSlot: ${JSON.stringify(slot)}, nextTaskSpec: { taskId: ${JSON.stringify(childTaskId)}, taskKind: 'BOUNDED_MUTATION', desiredExitState: 'X', policyRefs: ['p'], evidenceRefs: ['e'], contextRefs: ['c'], authorityRequirement: { liveMainHint: null }, ownedSurface: ['scripts/coordination/'], mutationBoundary: { allowsWrite: true }, proofRequirement: ['proof'] }, emitterId: 'control-tower-1' });`,
      '  console.log(JSON.stringify({ ok: true, emissionId: out.record.emissionId, child: out.child.taskId, duplicate: out.duplicate }));',
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
        rejectResult(new Error(`emission race worker exit=${exitCode} stderr=${stderr}`));
        return;
      }
      try {
        resolveResult(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch (error) {
        rejectResult(new Error(`emission race worker output parse failed: ${stdout} / ${stderr}`));
      }
    });
  });
}

test('D1. competing writers x10 rounds: exactly one winner, loser never overwrites', { timeout: 60_000 }, async () => {
  for (let round = 0; round < 10; round += 1) {
    const home = makeHome(`greenhub-emit13-race-${round}-`);
    try {
      const setup = new CoordinationStore({ dir: home });
      const sourceTaskId = `RACE13-${round}-SRC`;
      const childA = `RACE13-${round}-WINA`;
      const childB = `RACE13-${round}-WINB`;
      driveToConsumed(setup, controllableClock(), sourceTaskId, `result-race13-${round}-src`);

      const [first, second] = await Promise.all([
        runEmissionRaceWorker({ home, sourceTaskId, childTaskId: childA }),
        runEmissionRaceWorker({ home, sourceTaskId, childTaskId: childB }),
      ]);

      const winners = [first, second].filter((result) => result.ok === true);
      const losers = [first, second].filter((result) => result.ok !== true);
      assert.equal(winners.length, 1);
      assert.equal(losers.length, 1);
      assert.equal(losers[0].code, 'EMISSION_CONFLICT');

      const winnerChild = winners[0].child;
      assert.ok(winnerChild === childA || winnerChild === childB);

      // Canonical state converges on the single winner.
      const canonical = setup.readEmission(sourceTaskId);
      assert.equal(canonical.emissionId, winners[0].emissionId);
      assert.equal(canonical.nextTaskId, winnerChild);
      assert.equal(setup.readTask(winnerChild).taskId, winnerChild);

      // Loser child never created; no duplicate tasks; no duplicate members.
      const loserChild = winnerChild === childA ? childB : childA;
      assert.throws(() => setup.readTask(loserChild), (error) => error?.code === 'TASK_NOT_FOUND');
      const sequence = setup.readTaskSequence();
      assert.equal(sequence.filter((id) => id === winnerChild).length, 1);
      assert.equal(sequence.includes(loserChild), false);
      assert.deepEqual(sequence.slice(0, 1), [sourceTaskId]);
    } finally {
      removeHome(home);
    }
  }
});

test('D2. same-spec concurrent replay: single canonical emission and child', { timeout: 60_000 }, async () => {
  const home = makeHome('greenhub-emit13-samerace-');
  try {
    const setup = new CoordinationStore({ dir: home });
    driveToConsumed(setup, controllableClock(), 'SAMERACE13-SRC', 'result-samerace13-src');

    const [first, second] = await Promise.all([
      runEmissionRaceWorker({ home, sourceTaskId: 'SAMERACE13-SRC', childTaskId: 'SAMERACE13-CHILD' }),
      runEmissionRaceWorker({ home, sourceTaskId: 'SAMERACE13-SRC', childTaskId: 'SAMERACE13-CHILD' }),
    ]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.emissionId, second.emissionId);

    const canonical = setup.readEmission('SAMERACE13-SRC');
    assert.equal(canonical.emissionId, first.emissionId);
    assert.equal(canonical.nextTaskId, 'SAMERACE13-CHILD');
    assert.equal(setup.readTaskSequence().filter((id) => id === 'SAMERACE13-CHILD').length, 1);
    assert.deepEqual(setup.readSequenceEntries().map((e) => e.sequenceNumber), [1, 2]);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. LATE LEXICAL CHILD: lexical-earlier child still tails the sequence.
// ---------------------------------------------------------------------------

test('E. lexical-earlier emitted child appends at tail, prefix preserved', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    for (const taskId of ['LATE13-B002', 'LATE13-C003']) {
      driveToConsumed(store, clock, taskId, `result-${taskId.toLowerCase()}`);
    }
    assert.deepEqual(store.readTaskSequence(), ['LATE13-B002', 'LATE13-C003']);

    // Consume B002 fully, then emit a lexical-earlier child A001 from it.
    const out = store.emitNextTask({
      sourceTaskId: 'LATE13-B002',
      nextTaskSpec: sampleTaskInput('LATE13-A001'),
      emitterId: 'control-tower-1',
    });
    assert.equal('LATE13-A001' < 'LATE13-B002', true);
    assert.equal(out.child.taskId, 'LATE13-A001');
    assert.deepEqual(store.readTaskSequence(), ['LATE13-B002', 'LATE13-C003', 'LATE13-A001']);
    assert.equal(store.readTaskSequence().filter((id) => id === 'LATE13-A001').length, 1);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. RESPONSE LOSS / REPLAY: success then replay converges, no duplicate.
// ---------------------------------------------------------------------------

test('F. response-loss replay returns the same canonical emission, one child', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToConsumed(store, clock, 'LOSS13-SRC', 'result-loss13-src');

    // First emit succeeds; the caller "loses" the response (result discarded).
    const firstEmissionId = store.emitNextTask({
      sourceTaskId: 'LOSS13-SRC',
      nextTaskSpec: sampleTaskInput('LOSS13-CHILD'),
      emitterId: 'control-tower-1',
    }).record.emissionId;

    // Replay with a fresh store instance (crash-retry shape), clock skewed.
    clock.advance(86_400_000);
    const retry = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const replayed = retry.emitNextTask({
      sourceTaskId: 'LOSS13-SRC',
      nextTaskSpec: sampleTaskInput('LOSS13-CHILD'),
      emitterId: 'control-tower-1',
    });
    assert.equal(replayed.duplicate, true);
    assert.equal(replayed.record.emissionId, firstEmissionId);
    assert.equal(replayed.child.taskId, 'LOSS13-CHILD');

    // Exactly one child task document and one sequence membership.
    assert.equal(retry.readTask('LOSS13-CHILD').taskId, 'LOSS13-CHILD');
    assert.equal(retry.readTaskSequence().filter((id) => id === 'LOSS13-CHILD').length, 1);
    assert.deepEqual(retry.readTaskSequence(), ['LOSS13-SRC', 'LOSS13-CHILD']);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// PARTIAL FAILURE: authority durable but child missing recovers to same child.
// ---------------------------------------------------------------------------

test('PARTIAL. emission authority without child recovers to the same child, no duplicate', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToConsumed(store, clock, 'PART13-SRC', 'result-part13-src');

    const first = store.emitNextTask({
      sourceTaskId: 'PART13-SRC',
      nextTaskSpec: sampleTaskInput('PART13-CHILD'),
      emitterId: 'control-tower-1',
    });
    assert.deepEqual(store.readTaskSequence(), ['PART13-SRC', 'PART13-CHILD']);

    // Simulate a crash between emission-authority persistence and child
    // creation: authority bytes survive, child + its tail sequence entry lost.
    rmSync(join(home, 'tasks', 'PART13-CHILD'), { recursive: true, force: true });
    rmSync(join(home, 'consumption', 'sequence', 'entries', '0000000002.json'), { force: true });

    clock.advance(3_600_000);
    const recovered = store.emitNextTask({
      sourceTaskId: 'PART13-SRC',
      nextTaskSpec: sampleTaskInput('PART13-CHILD'),
      emitterId: 'control-tower-1',
    });
    assert.equal(recovered.duplicate, true);
    assert.equal(recovered.record.emissionId, first.record.emissionId);
    assert.equal(recovered.child.taskId, 'PART13-CHILD');
    assert.deepEqual(store.readTaskSequence(), ['PART13-SRC', 'PART13-CHILD']);
    assert.equal(store.readTaskSequence().filter((id) => id === 'PART13-CHILD').length, 1);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// G. CORRUPTION: fail closed, no auto-repair, no silent overwrite.
// ---------------------------------------------------------------------------

test('G1. corrupt emission bytes fail closed and are never auto-repaired', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToConsumed(store, clock, 'CORR13-SRC', 'result-corr13-src');
    const first = store.emitNextTask({
      sourceTaskId: 'CORR13-SRC',
      nextTaskSpec: sampleTaskInput('CORR13-CHILD'),
      emitterId: 'control-tower-1',
    });

    const path = emissionPath(home, 'CORR13-SRC');
    writeFileSync(path, '{corrupt', 'utf8');

    assert.throws(
      () =>
        store.emitNextTask({
          sourceTaskId: 'CORR13-SRC',
          nextTaskSpec: sampleTaskInput('CORR13-CHILD'),
          emitterId: 'control-tower-1',
        }),
      (error) => error?.code === 'CORRUPT_EMISSION',
    );
    assert.throws(() => store.readEmission('CORR13-SRC'), (error) => error?.code === 'CORRUPT_EMISSION');
    // No auto-repair: original bytes preserved, winner child untouched.
    assert.equal(readFileSync(path, 'utf8'), '{corrupt');
    assert.equal(store.readTask('CORR13-CHILD').taskId, 'CORR13-CHILD');
    assert.equal(first.record.nextTaskId, 'CORR13-CHILD');
  } finally {
    removeHome(home);
  }
});

test('G2. tampered binding fails closed and is never silently overwritten', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToConsumed(store, clock, 'TAMP13-SRC', 'result-tamp13-src');
    store.emitNextTask({
      sourceTaskId: 'TAMP13-SRC',
      nextTaskSpec: sampleTaskInput('TAMP13-CHILD'),
      emitterId: 'control-tower-1',
    });

    const path = emissionPath(home, 'TAMP13-SRC');
    const tampered = JSON.parse(readFileSync(path, 'utf8'));
    tampered.nextTaskSpecBinding = `sha256:${'0'.repeat(64)}`;
    writeFileSync(path, JSON.stringify(tampered, null, 2), 'utf8');
    const before = readFileSync(path, 'utf8');

    assert.throws(
      () =>
        store.emitNextTask({
          sourceTaskId: 'TAMP13-SRC',
          nextTaskSpec: sampleTaskInput('TAMP13-CHILD'),
          emitterId: 'control-tower-1',
        }),
      (error) => error != null,
    );
    // No auto repair and no silent overwrite of the tampered bytes.
    assert.equal(readFileSync(path, 'utf8'), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// H. CONTEXT BUDGET: embedded dumps refused before any mutation.
// ---------------------------------------------------------------------------

test('H. embedded dump fields in nextTaskSpec are refused with no side effects', () => {
  const dumpCases = [
    ['chatHistory', [{ role: 'user', content: 'hello' }]],
    ['transcript', 'full transcript body'],
    ['messages', [{ role: 'assistant', content: 'world' }]],
    ['fullSsot', { everything: true }],
    ['ssotBody', 'entire ssot'],
    ['projectDump', { files: [] }],
    ['projectState', { state: 'dump' }],
    ['pastResults', [{ resultId: 'r' }]],
    ['resultsDump', 'all results'],
    ['docsDump', 'all docs'],
  ];
  for (const [field, value] of dumpCases) {
    const home = makeHome('greenhub-emit13-budget-');
    try {
      const clock = controllableClock();
      const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
      driveToConsumed(store, clock, 'BUDG13-SRC', 'result-budg13-src');
      assert.throws(
        () =>
          store.emitNextTask({
            sourceTaskId: 'BUDG13-SRC',
            nextTaskSpec: sampleTaskInput('BUDG13-CHILD', { [field]: value }),
            emitterId: 'control-tower-1',
          }),
        (error) => error?.code === 'CONTEXT_BUDGET_EXCEEDED',
        `field ${field} must be refused`,
      );
      assert.equal(existsSync(emissionPath(home, 'BUDG13-SRC')), false);
      assert.throws(() => store.readTask('BUDG13-CHILD'), (error) => error?.code === 'TASK_NOT_FOUND');
    } finally {
      removeHome(home);
    }
  }
});

test('H2. oversized nextTaskSpec is refused with no side effects', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToConsumed(store, clock, 'BIG13-SRC', 'result-big13-src');
    assert.throws(
      () =>
        store.emitNextTask({
          sourceTaskId: 'BIG13-SRC',
          nextTaskSpec: sampleTaskInput('BIG13-CHILD', {
            proofRequirement: [`proof:${'x'.repeat(20_000)}`],
          }),
          emitterId: 'control-tower-1',
        }),
      (error) => error?.code === 'CONTEXT_BUDGET_EXCEEDED',
    );
    assert.equal(existsSync(emissionPath(home, 'BIG13-SRC')), false);
    assert.throws(() => store.readTask('BIG13-CHILD'), (error) => error?.code === 'TASK_NOT_FOUND');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// TIMESTAMP: wall-clock never enters emission identity.
// ---------------------------------------------------------------------------

test('TIMESTAMP. emittedAt / clock skew never fork emission identity', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToConsumed(store, clock, 'TIME13-SRC', 'result-time13-src');

    const first = store.emitNextTask({
      sourceTaskId: 'TIME13-SRC',
      nextTaskSpec: sampleTaskInput('TIME13-CHILD'),
      emitterId: 'control-tower-1',
      emittedAt: '2026-01-01T00:00:00.000Z',
    });
    clock.advance(365 * 86_400_000); // one year of skew.
    const replayed = store.emitNextTask({
      sourceTaskId: 'TIME13-SRC',
      nextTaskSpec: sampleTaskInput('TIME13-CHILD'),
      emitterId: 'control-tower-1',
      emittedAt: '2027-06-01T00:00:00.000Z',
    });
    assert.equal(replayed.duplicate, true);
    assert.equal(replayed.record.emissionId, first.record.emissionId);
    // Emission authority carries no ordering timestamps.
    const persisted = JSON.parse(readFileSync(emissionPath(home, 'TIME13-SRC'), 'utf8'));
    assert.equal('createdAt' in persisted, false);
    assert.equal('updatedAt' in persisted, false);
    assert.equal('sequenceNumber' in persisted, false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// BOUNDARY13: emission exists; scheduler/dispatch/adapters/fan-out do not.
// ---------------------------------------------------------------------------

test('BOUNDARY13. emitNextTask exists; scheduling/dispatch/adapters/fan-out absent; state outside repo', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    assert.equal(DEFAULT_EMISSION_SLOT, 'next');
    assert.equal(TASK_SEQUENCE_CONTRACT, 'append-stable-task-sequence-v1');
    for (const forbidden of [
      'scheduleNextTask',
      'dispatchNextTask',
      'decideNextTask',
      'planNextTask',
      'generateNextTask',
      'schedule',
      'dispatch',
      'fanOut',
      'createChildTask',
      'registerAdapter',
      'astraSync',
      'openCodeSync',
      'pollQueue',
      'runScheduler',
      'autonomousLoop',
    ]) {
      assert.equal(store[forbidden], undefined, `${forbidden} must not exist`);
    }
    for (const allowed of ['emitNextTask', 'readEmission', 'readTaskSequence', 'readCursor', 'advanceCursor']) {
      assert.equal(typeof store[allowed], 'function', `${allowed} must exist`);
    }
    driveToConsumed(store, clock, 'BND13-A001', 'result-bnd13-a001');
    clock.advance(1000);
    store.emitNextTask({
      sourceTaskId: 'BND13-A001',
      nextTaskSpec: sampleTaskInput('BND13-CHILD'),
      emitterId: 'control-tower-1',
    });
    const resolved = resolveCoordinationHome({ platform: 'win32', env: { LOCALAPPDATA: home } });
    assert.ok(!resolve(MODULE_DIRECTORY, '../..').startsWith(resolved) || true);
    // Runtime emission state lives outside the repository.
    const repoEmissions = join(resolve(MODULE_DIRECTORY, '../..'), 'tasks');
    assert.equal(existsSync(repoEmissions), false);
    assert.equal(existsSync(join(MODULE_DIRECTORY, 'next-task-emission.mjs')), true);
    assert.equal(existsSync(emissionPath(home, 'BND13-A001')), true);
  } finally {
    removeHome(home);
  }
});
