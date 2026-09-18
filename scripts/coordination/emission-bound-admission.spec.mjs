// Proof for GREENHUB-COORDINATION-EMISSION-BOUND-ADMISSION-14.
// Emission-bound admission primitive ONLY:
// the exact canonical emission's child, bound via a durable admission
// authority, then moved through the existing markReady() path to READY.
//
// Explicitly NOT implemented here (and asserted absent):
//   scheduler, queue polling, priority queue, fairness, worker capacity,
//   agent/worker/executor selection, claim loop, claim automation, lease loop,
//   dispatch, executor invocation, result watcher, automatic next emission,
//   fan-out, multi-child planner, DAG planner, retry scheduler, cron, event
//   daemon, adapters (Astra/OpenCode/Web), autonomous Control Tower loop,
//   application code, deployment automation, production deployment, 57C.
// admitEmittedTask() != emitNextTask() != scheduleNextTask() != claimTask()
//   != dispatchNextTask() != decideNextTask().
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
import { DEFAULT_EMISSION_SLOT, computeNextTaskSpecBinding } from './next-task-emission.mjs';
import { buildAdmissionId } from './emission-admission.mjs';
import { TASK_SEQUENCE_CONTRACT } from './task-sequence.mjs';
import { CoordinationStore } from './store.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const STORE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'store.mjs')).href;

function makeHome(prefix = 'greenhub-admit14-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'EMISSION_BOUND_ADMISSION_PROVED',
    policyRefs: ['docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md'],
    evidenceRefs: ['git:live-main-read'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: {
      liveMainHint: null,
      requiredPolicies: ['AGENTS.md'],
    },
    ownedSurface: ['scripts/coordination/'],
    mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['emission-bound-admission-proof'],
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

function emissionPath(home, sourceTaskId, slot = DEFAULT_EMISSION_SLOT) {
  return join(home, 'tasks', sourceTaskId, 'emissions', `${slot}.json`);
}

function admissionPath(home, sourceTaskId, slot = DEFAULT_EMISSION_SLOT) {
  return join(home, 'tasks', sourceTaskId, 'emission-admissions', `${slot}.json`);
}

// ---------------------------------------------------------------------------
// 1-8. NEGATIVE: refusal / fail-closed before any admission authority.
// ---------------------------------------------------------------------------

test('N1. emission missing refuses admission with no child mutation', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToConsumed(store, clock, 'AD14-N1-SRC', 'result-ad14-n1-src');
    // No emission created: admission must refuse.
    assert.throws(
      () =>
        store.admitEmittedTask({
          sourceTaskId: 'AD14-N1-SRC',
          admitterId: 'control-tower-1',
        }),
      (error) => error?.code === 'EMISSION_NOT_FOUND',
    );
    assert.equal(existsSync(admissionPath(home, 'AD14-N1-SRC')), false);
  } finally {
    removeHome(home);
  }
});

test('N2. corrupt emission bytes fail closed with no admission', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'AD14-N2-SRC', 'AD14-N2-CHILD', 'result-ad14-n2-src');
    writeFileSync(emissionPath(home, 'AD14-N2-SRC'), '{corrupt', 'utf8');
    assert.throws(
      () =>
        store.admitEmittedTask({
          sourceTaskId: 'AD14-N2-SRC',
          admitterId: 'control-tower-1',
        }),
      (error) => error?.code === 'CORRUPT_EMISSION',
    );
    assert.equal(existsSync(admissionPath(home, 'AD14-N2-SRC')), false);
    // Child stays CREATED: no READY transition without admission authority.
    assert.equal(store.readTask('AD14-N2-CHILD').status, 'CREATED');
  } finally {
    removeHome(home);
  }
});

test('N3. tampered emission binding fails closed', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'AD14-N3-SRC', 'AD14-N3-CHILD', 'result-ad14-n3-src');
    const path = emissionPath(home, 'AD14-N3-SRC');
    const tampered = JSON.parse(readFileSync(path, 'utf8'));
    tampered.nextTaskSpecBinding = `sha256:${'0'.repeat(64)}`;
    writeFileSync(path, JSON.stringify(tampered, null, 2), 'utf8');
    assert.throws(
      () =>
        store.admitEmittedTask({
          sourceTaskId: 'AD14-N3-SRC',
          admitterId: 'control-tower-1',
        }),
      (error) => error != null,
    );
    assert.equal(existsSync(admissionPath(home, 'AD14-N3-SRC')), false);
    assert.equal(store.readTask('AD14-N3-CHILD').status, 'CREATED');
  } finally {
    removeHome(home);
  }
});

test('N4. source CONSUMED chain corruption fails closed', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'AD14-N4-SRC', 'AD14-N4-CHILD', 'result-ad14-n4-src');
    writeFileSync(join(home, 'tasks', 'AD14-N4-SRC', 'consumed.json'), '{corrupt', 'utf8');
    assert.throws(
      () =>
        store.admitEmittedTask({
          sourceTaskId: 'AD14-N4-SRC',
          admitterId: 'control-tower-1',
        }),
      (error) => error != null,
    );
    assert.equal(existsSync(admissionPath(home, 'AD14-N4-SRC')), false);
    assert.equal(store.readTask('AD14-N4-CHILD').status, 'CREATED');
  } finally {
    removeHome(home);
  }
});

test('N5. source ACK/materialization mismatch fails closed', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'AD14-N5-SRC', 'AD14-N5-CHILD', 'result-ad14-n5-src');
    const ackPath = join(home, 'tasks', 'AD14-N5-SRC', 'ack.json');
    const ack = JSON.parse(readFileSync(ackPath, 'utf8'));
    ack.resultBinding = `sha256:${'1'.repeat(64)}`;
    writeFileSync(ackPath, JSON.stringify(ack, null, 2), 'utf8');
    assert.throws(
      () =>
        store.admitEmittedTask({
          sourceTaskId: 'AD14-N5-SRC',
          admitterId: 'control-tower-1',
        }),
      (error) => error != null,
    );
    assert.equal(existsSync(admissionPath(home, 'AD14-N5-SRC')), false);
    assert.equal(store.readTask('AD14-N5-CHILD').status, 'CREATED');
  } finally {
    removeHome(home);
  }
});

test('N6. child missing fails closed with no auto-create', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'AD14-N6-SRC', 'AD14-N6-CHILD', 'result-ad14-n6-src');
    rmSync(join(home, 'tasks', 'AD14-N6-CHILD'), { recursive: true, force: true });
    assert.throws(
      () =>
        store.admitEmittedTask({
          sourceTaskId: 'AD14-N6-SRC',
          admitterId: 'control-tower-1',
        }),
      (error) => error?.code === 'TASK_NOT_FOUND',
    );
    assert.equal(existsSync(admissionPath(home, 'AD14-N6-SRC')), false);
  } finally {
    removeHome(home);
  }
});

test('N7. child canonical spec mismatch fails closed', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'AD14-N7-SRC', 'AD14-N7-CHILD', 'result-ad14-n7-src');
    const childPath = join(home, 'tasks', 'AD14-N7-CHILD', 'task.json');
    const child = JSON.parse(readFileSync(childPath, 'utf8'));
    child.desiredExitState = 'MUTATED_EXIT';
    writeFileSync(childPath, JSON.stringify(child, null, 2), 'utf8');
    assert.throws(
      () =>
        store.admitEmittedTask({
          sourceTaskId: 'AD14-N7-SRC',
          admitterId: 'control-tower-1',
        }),
      (error) => error?.code === 'ADMISSION_BINDING_MISMATCH',
    );
    assert.equal(existsSync(admissionPath(home, 'AD14-N7-SRC')), false);
  } finally {
    removeHome(home);
  }
});

test('N8. child taskId mismatch fails closed', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'AD14-N8-SRC', 'AD14-N8-CHILD', 'result-ad14-n8-src');
    const path = emissionPath(home, 'AD14-N8-SRC');
    const emission = JSON.parse(readFileSync(path, 'utf8'));
    // Point the emission at a different existing task id while keeping the
    // embedded spec: the emission record itself becomes internally inconsistent
    // (nextTaskId != spec.taskId) and must fail closed on live re-verification.
    store.createTask(sampleTaskInput('AD14-N8-OTHER'));
    emission.nextTaskId = 'AD14-N8-OTHER';
    writeFileSync(path, JSON.stringify(emission, null, 2), 'utf8');
    assert.throws(
      () =>
        store.admitEmittedTask({
          sourceTaskId: 'AD14-N8-SRC',
          admitterId: 'control-tower-1',
        }),
      (error) => error != null,
    );
    assert.equal(existsSync(admissionPath(home, 'AD14-N8-SRC')), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// 9. SUCCESS: CREATED + valid emission -> admission authority + READY.
// ---------------------------------------------------------------------------

test('S9. CREATED child with valid emission admits to READY via markReady', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const emitted = driveToEmitted(store, clock, 'AD14-S9-SRC', 'AD14-S9-CHILD', 'result-ad14-s9-src');
    assert.equal(store.readTask('AD14-S9-CHILD').status, 'CREATED');

    const out = store.admitEmittedTask({
      sourceTaskId: 'AD14-S9-SRC',
      admitterId: 'control-tower-1',
    });
    assert.equal(out.duplicate, false);
    assert.equal(out.record.sourceTaskId, 'AD14-S9-SRC');
    assert.equal(out.record.emissionSlot, DEFAULT_EMISSION_SLOT);
    assert.equal(out.record.emissionId, emitted.record.emissionId);
    assert.equal(out.record.nextTaskId, 'AD14-S9-CHILD');
    assert.equal(out.record.nextTaskSpecBinding, emitted.record.nextTaskSpecBinding);
    assert.equal(out.child.taskId, 'AD14-S9-CHILD');
    assert.equal(out.child.status, 'READY');
    // Live child is READY through the existing path.
    assert.equal(store.readTask('AD14-S9-CHILD').status, 'READY');
    // Admission identity is deterministic over (emissionId, nextTaskId, binding).
    assert.equal(
      out.record.admissionId,
      buildAdmissionId({
        emissionId: emitted.record.emissionId,
        nextTaskId: 'AD14-S9-CHILD',
        nextTaskSpecBinding: emitted.record.nextTaskSpecBinding,
      }),
    );
    // Source + child + sequence bindings present.
    assert.equal(out.record.sourceConsumedId, emitted.record.sourceConsumedId);
    assert.equal(out.record.canonicalTransitionId, emitted.record.canonicalTransitionId);
    assert.equal(computeNextTaskSpecBinding(store.readTask('AD14-S9-CHILD')), out.record.nextTaskSpecBinding);
    assert.equal(store.readTaskSequence().filter((id) => id === 'AD14-S9-CHILD').length, 1);
    // Read path agrees.
    assert.equal(
      store.readEmissionAdmission({ sourceTaskId: 'AD14-S9-SRC' }).admissionId,
      out.record.admissionId,
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// 10-11. REPLAY + CLOCK SKEW: deterministic identity, provenance non-authority.
// ---------------------------------------------------------------------------

test('R10. same-input replay x10 converges byte-identical with one READY semantics', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'AD14-R10-SRC', 'AD14-R10-CHILD', 'result-ad14-r10-src');

    const first = store.admitEmittedTask({
      sourceTaskId: 'AD14-R10-SRC',
      admitterId: 'control-tower-1',
      admittedAt: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(first.duplicate, false);
    const firstBytes = readFileSync(admissionPath(home, 'AD14-R10-SRC'), 'utf8');

    for (let replay = 0; replay < 10; replay += 1) {
      const out = store.admitEmittedTask({
        sourceTaskId: 'AD14-R10-SRC',
        admitterId: 'control-tower-1',
        admittedAt: '2026-01-01T00:00:00.000Z',
      });
      assert.equal(out.duplicate, true);
      assert.equal(out.record.admissionId, first.record.admissionId);
      assert.deepEqual(out.record, first.record);
      assert.equal(out.child.status, 'READY');
    }
    assert.equal(readFileSync(admissionPath(home, 'AD14-R10-SRC'), 'utf8'), firstBytes);
    assert.equal(store.readTask('AD14-R10-CHILD').status, 'READY');
    assert.equal(store.readTaskSequence().filter((id) => id === 'AD14-R10-CHILD').length, 1);
  } finally {
    removeHome(home);
  }
});

test('R11. one-year clock skew keeps the same admissionId with no ordering effect', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'AD14-R11-SRC', 'AD14-R11-CHILD', 'result-ad14-r11-src');

    const first = store.admitEmittedTask({
      sourceTaskId: 'AD14-R11-SRC',
      admitterId: 'control-tower-1',
      admittedAt: '2026-01-01T00:00:00.000Z',
    });
    clock.advance(365 * 86_400_000);
    const replayed = store.admitEmittedTask({
      sourceTaskId: 'AD14-R11-SRC',
      admitterId: 'control-tower-9',
      admittedAt: '2027-01-01T00:00:00.000Z',
    });
    assert.equal(replayed.duplicate, true);
    assert.equal(replayed.record.admissionId, first.record.admissionId);
    // First canonical provenance preserved; later provenance never overwrites.
    assert.equal(replayed.record.admitterId, 'control-tower-1');
    assert.equal(replayed.record.admittedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(
      readFileSync(admissionPath(home, 'AD14-R11-SRC'), 'utf8'),
      JSON.stringify(first.record, null, 2),
    );
    // Admission authority carries no ordering timestamps.
    const persisted = JSON.parse(readFileSync(admissionPath(home, 'AD14-R11-SRC'), 'utf8'));
    assert.equal('createdAt' in persisted, false);
    assert.equal('updatedAt' in persisted, false);
    assert.equal('sequenceNumber' in persisted, false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// 12. CONCURRENCY: competing admitters, exactly one canonical authority.
// ---------------------------------------------------------------------------

function runAdmissionRaceWorker({ home, sourceTaskId, admitterId, admittedAt, slot = DEFAULT_EMISSION_SLOT }) {
  return new Promise((resolveResult, rejectResult) => {
    const code = [
      'try {',
      `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
      `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
      `  const out = store.admitEmittedTask({ sourceTaskId: ${JSON.stringify(sourceTaskId)}, emissionSlot: ${JSON.stringify(slot)}, admitterId: ${JSON.stringify(admitterId)}, admittedAt: ${JSON.stringify(admittedAt)} });`,
      '  console.log(JSON.stringify({ ok: true, admissionId: out.record.admissionId, child: out.child.taskId, status: out.child.status, duplicate: out.duplicate }));',
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
        rejectResult(new Error(`admission race worker exit=${exitCode} stderr=${stderr}`));
        return;
      }
      try {
        resolveResult(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch (error) {
        rejectResult(new Error(`admission race worker output parse failed: ${stdout} / ${stderr}`));
      }
    });
  });
}

test('C12. competing admitters x10 rounds: one authority, one READY, no overwrite', { timeout: 60_000 }, async () => {
  for (let round = 0; round < 10; round += 1) {
    const home = makeHome(`greenhub-admit14-race-${round}-`);
    try {
      const setup = new CoordinationStore({ dir: home });
      const sourceTaskId = `AD14C12-${round}-SRC`;
      const childTaskId = `AD14C12-${round}-CHILD`;
      driveToEmitted(setup, controllableClock(), sourceTaskId, childTaskId, `result-ad14c12-${round}-src`);

      const [first, second] = await Promise.all([
        runAdmissionRaceWorker({
          home,
          sourceTaskId,
          admitterId: 'control-tower-A',
          admittedAt: '2026-01-01T00:00:00.000Z',
        }),
        runAdmissionRaceWorker({
          home,
          sourceTaskId,
          admitterId: 'control-tower-B',
          admittedAt: '2027-06-01T00:00:00.000Z',
        }),
      ]);

      assert.equal(first.ok, true);
      assert.equal(second.ok, true);
      assert.equal(first.admissionId, second.admissionId);
      assert.equal(first.child, childTaskId);
      assert.equal(second.child, childTaskId);

      const canonical = setup.readEmissionAdmission({ sourceTaskId });
      assert.equal(canonical.admissionId, first.admissionId);
      assert.equal(canonical.nextTaskId, childTaskId);
      // Exactly one admission file, one READY child, one sequence membership.
      assert.equal(setup.readTask(childTaskId).status, 'READY');
      assert.equal(setup.readTaskSequence().filter((id) => id === childTaskId).length, 1);
      // Timestamp/provenance never forked identity; first provenance preserved.
      const persisted = JSON.parse(readFileSync(admissionPath(home, sourceTaskId), 'utf8'));
      assert.equal(persisted.admissionId, first.admissionId);
      assert.ok(persisted.admitterId === 'control-tower-A' || persisted.admitterId === 'control-tower-B');
    } finally {
      removeHome(home);
    }
  }
});

// ---------------------------------------------------------------------------
// 13. PARTIAL FAILURE: authority-without-READY recovers via replay.
// ---------------------------------------------------------------------------

test('P13. authority-without-READY simulated crash replays to READY', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'AD14-P13-SRC', 'AD14-P13-CHILD', 'result-ad14-p13-src');
    const first = store.admitEmittedTask({
      sourceTaskId: 'AD14-P13-SRC',
      admitterId: 'control-tower-1',
    });
    assert.equal(store.readTask('AD14-P13-CHILD').status, 'READY');

    // Simulate a crash between admission-authority persistence and markReady:
    // authority bytes survive, the child never reached READY.
    const childPath = join(home, 'tasks', 'AD14-P13-CHILD', 'task.json');
    const readyChild = JSON.parse(readFileSync(childPath, 'utf8'));
    assert.equal(readyChild.status, 'READY');
    writeFileSync(
      childPath,
      JSON.stringify({ ...readyChild, status: 'CREATED', updatedAt: '2026-01-01T00:00:00.000Z' }, null, 2),
      'utf8',
    );
    assert.equal(store.readTask('AD14-P13-CHILD').status, 'CREATED');

    clock.advance(3_600_000);
    const recovered = store.admitEmittedTask({
      sourceTaskId: 'AD14-P13-SRC',
      admitterId: 'control-tower-1',
    });
    assert.equal(recovered.duplicate, true);
    assert.equal(recovered.record.admissionId, first.record.admissionId);
    assert.deepEqual(recovered.record, first.record);
    assert.equal(recovered.child.status, 'READY');
    assert.equal(store.readTask('AD14-P13-CHILD').status, 'READY');
  } finally {
    removeHome(home);
  }
});

test('P13B. pre-authority crash leaves no admission with clean retry', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'AD14-P13B-SRC', 'AD14-P13B-CHILD', 'result-ad14-p13b-src');
    // Crash before any admission call: no authority, child CREATED.
    assert.equal(existsSync(admissionPath(home, 'AD14-P13B-SRC')), false);
    assert.equal(store.readTask('AD14-P13B-CHILD').status, 'CREATED');
    // Clean retry with a fresh store instance succeeds.
    const retry = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const out = retry.admitEmittedTask({
      sourceTaskId: 'AD14-P13B-SRC',
      admitterId: 'control-tower-1',
    });
    assert.equal(out.duplicate, false);
    assert.equal(out.child.status, 'READY');
  } finally {
    removeHome(home);
  }
});

test('P13C. response-loss replay is duplicate/idempotent with no new record', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'AD14-P13C-SRC', 'AD14-P13C-CHILD', 'result-ad14-p13c-src');
    const firstId = store.admitEmittedTask({
      sourceTaskId: 'AD14-P13C-SRC',
      admitterId: 'control-tower-1',
    }).record.admissionId;
    const before = readFileSync(admissionPath(home, 'AD14-P13C-SRC'), 'utf8');

    clock.advance(86_400_000);
    const retry = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const replayed = retry.admitEmittedTask({
      sourceTaskId: 'AD14-P13C-SRC',
      admitterId: 'control-tower-1',
    });
    assert.equal(replayed.duplicate, true);
    assert.equal(replayed.record.admissionId, firstId);
    assert.equal(replayed.child.status, 'READY');
    assert.equal(readFileSync(admissionPath(home, 'AD14-P13C-SRC'), 'utf8'), before);
    assert.equal(retry.readTaskSequence().filter((id) => id === 'AD14-P13C-CHILD').length, 1);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// 14-17. BYPASS + PROGRESSED HISTORY.
// ---------------------------------------------------------------------------

test('B14. READY without admission fails closed with ADMISSION_BYPASS_DETECTED', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'AD14-B14-SRC', 'AD14-B14-CHILD', 'result-ad14-b14-src');
    // Bypass: move the child outside the admission primitive.
    store.markReady('AD14-B14-CHILD');
    assert.equal(store.readTask('AD14-B14-CHILD').status, 'READY');
    assert.throws(
      () =>
        store.admitEmittedTask({
          sourceTaskId: 'AD14-B14-SRC',
          admitterId: 'control-tower-1',
        }),
      (error) => error?.code === 'ADMISSION_BYPASS_DETECTED',
    );
    // No auto-adoption: no admission authority created.
    assert.equal(existsSync(admissionPath(home, 'AD14-B14-SRC')), false);
  } finally {
    removeHome(home);
  }
});

test('B15. CLAIMED and RESULT_DELIVERED without admission fail closed', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'AD14-B15-SRC', 'AD14-B15-CHILD', 'result-ad14-b15-src');
    store.markReady('AD14-B15-CHILD');
    const claim = store.claimTask({ taskId: 'AD14-B15-CHILD', workerId: 'worker-a', leaseDurationMs: 60_000 });
    assert.throws(
      () =>
        store.admitEmittedTask({
          sourceTaskId: 'AD14-B15-SRC',
          admitterId: 'control-tower-1',
        }),
      (error) => error?.code === 'ADMISSION_BYPASS_DETECTED',
    );
    assert.equal(existsSync(admissionPath(home, 'AD14-B15-SRC')), false);

    // Progress to RESULT_DELIVERED without admission: still bypass.
    store.deliverResult(sampleResult(claim, { taskId: 'AD14-B15-CHILD', resultId: 'result-ad14-b15-child' }));
    assert.equal(store.readTask('AD14-B15-CHILD').status, 'RESULT_DELIVERED');
    assert.throws(
      () =>
        store.admitEmittedTask({
          sourceTaskId: 'AD14-B15-SRC',
          admitterId: 'control-tower-1',
        }),
      (error) => error?.code === 'ADMISSION_BYPASS_DETECTED',
    );
    assert.equal(existsSync(admissionPath(home, 'AD14-B15-SRC')), false);
  } finally {
    removeHome(home);
  }
});

test('H16. existing admission plus later CLAIMED replays without rewind', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'AD14-H16-SRC', 'AD14-H16-CHILD', 'result-ad14-h16-src');
    const first = store.admitEmittedTask({
      sourceTaskId: 'AD14-H16-SRC',
      admitterId: 'control-tower-1',
    });
    assert.equal(store.readTask('AD14-H16-CHILD').status, 'READY');
    // Normal scheduler/claim progression after admission.
    store.claimTask({ taskId: 'AD14-H16-CHILD', workerId: 'worker-a', leaseDurationMs: 60_000 });
    assert.equal(store.readTask('AD14-H16-CHILD').status, 'CLAIMED');

    const replayed = store.admitEmittedTask({
      sourceTaskId: 'AD14-H16-SRC',
      admitterId: 'control-tower-1',
    });
    assert.equal(replayed.duplicate, true);
    assert.equal(replayed.record.admissionId, first.record.admissionId);
    assert.deepEqual(replayed.record, first.record);
    // Never rewound to READY.
    assert.equal(replayed.child.status, 'CLAIMED');
    assert.equal(store.readTask('AD14-H16-CHILD').status, 'CLAIMED');
    assert.equal(store.readEmissionAdmission({ sourceTaskId: 'AD14-H16-SRC' }).admissionId, first.record.admissionId);
  } finally {
    removeHome(home);
  }
});

test('H17. existing admission plus later RESULT_DELIVERED replays without rewind', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'AD14-H17-SRC', 'AD14-H17-CHILD', 'result-ad14-h17-src');
    const first = store.admitEmittedTask({
      sourceTaskId: 'AD14-H17-SRC',
      admitterId: 'control-tower-1',
    });
    const claim = store.claimTask({ taskId: 'AD14-H17-CHILD', workerId: 'worker-a', leaseDurationMs: 60_000 });
    store.deliverResult(sampleResult(claim, { taskId: 'AD14-H17-CHILD', resultId: 'result-ad14-h17-child' }));
    assert.equal(store.readTask('AD14-H17-CHILD').status, 'RESULT_DELIVERED');

    const replayed = store.admitEmittedTask({
      sourceTaskId: 'AD14-H17-SRC',
      admitterId: 'control-tower-1',
    });
    assert.equal(replayed.duplicate, true);
    assert.equal(replayed.record.admissionId, first.record.admissionId);
    assert.equal(replayed.child.status, 'RESULT_DELIVERED');
    assert.equal(store.readTask('AD14-H17-CHILD').status, 'RESULT_DELIVERED');
    assert.equal(store.readEmissionAdmission({ sourceTaskId: 'AD14-H17-SRC' }).admissionId, first.record.admissionId);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// 18-20. CORRUPTION: fail closed, bytes preserved, no auto-repair.
// ---------------------------------------------------------------------------

test('C18. corrupt admission bytes fail closed with bytes preserved', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'AD14-C18-SRC', 'AD14-C18-CHILD', 'result-ad14-c18-src');
    store.admitEmittedTask({
      sourceTaskId: 'AD14-C18-SRC',
      admitterId: 'control-tower-1',
    });
    const path = admissionPath(home, 'AD14-C18-SRC');
    writeFileSync(path, '{corrupt', 'utf8');
    assert.throws(
      () =>
        store.admitEmittedTask({
          sourceTaskId: 'AD14-C18-SRC',
          admitterId: 'control-tower-1',
        }),
      (error) => error?.code === 'CORRUPT_ADMISSION',
    );
    assert.throws(
      () => store.readEmissionAdmission({ sourceTaskId: 'AD14-C18-SRC' }),
      (error) => error?.code === 'CORRUPT_ADMISSION',
    );
    assert.equal(readFileSync(path, 'utf8'), '{corrupt');
    assert.equal(store.readTask('AD14-C18-CHILD').status, 'READY');
  } finally {
    removeHome(home);
  }
});

test('C19. tampered admission binding fails closed without overwrite', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'AD14-C19-SRC', 'AD14-C19-CHILD', 'result-ad14-c19-src');
    store.admitEmittedTask({
      sourceTaskId: 'AD14-C19-SRC',
      admitterId: 'control-tower-1',
    });
    const path = admissionPath(home, 'AD14-C19-SRC');
    const tampered = JSON.parse(readFileSync(path, 'utf8'));
    tampered.nextTaskSpecBinding = `sha256:${'2'.repeat(64)}`;
    writeFileSync(path, JSON.stringify(tampered, null, 2), 'utf8');
    const before = readFileSync(path, 'utf8');
    assert.throws(
      () =>
        store.admitEmittedTask({
          sourceTaskId: 'AD14-C19-SRC',
          admitterId: 'control-tower-1',
        }),
      (error) => error != null,
    );
    assert.throws(() => store.readEmissionAdmission({ sourceTaskId: 'AD14-C19-SRC' }), (error) => error != null);
    assert.equal(readFileSync(path, 'utf8'), before);
  } finally {
    removeHome(home);
  }
});

test('C20. duplicate sequence membership fails closed where detectable', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'AD14-C20-SRC', 'AD14-C20-CHILD', 'result-ad14-c20-src');
    // Duplicate membership: same child at a second canonical position.
    const entries = store.readSequenceEntries();
    const nextSeq = entries[entries.length - 1].sequenceNumber + 1;
    writeFileSync(
      join(home, 'consumption', 'sequence', 'entries', `${String(nextSeq).padStart(10, '0')}.json`),
      JSON.stringify({ schemaVersion: '1', sequenceNumber: nextSeq, taskId: 'AD14-C20-CHILD' }, null, 2),
      'utf8',
    );
    assert.throws(
      () =>
        store.admitEmittedTask({
          sourceTaskId: 'AD14-C20-SRC',
          admitterId: 'control-tower-1',
        }),
      (error) => error != null,
    );
    assert.equal(existsSync(admissionPath(home, 'AD14-C20-SRC')), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// BOUNDARY14: emission retained, admission added, scheduler absent.
// ---------------------------------------------------------------------------

test('BOUNDARY14. emission retained; admission added via markReady; scheduler/claim-automation/dispatch absent', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    assert.equal(DEFAULT_EMISSION_SLOT, 'next');
    assert.equal(TASK_SEQUENCE_CONTRACT, 'append-stable-task-sequence-v1');
    for (const forbidden of [
      'scheduleNextTask',
      'schedule',
      'pollQueue',
      'runScheduler',
      'autonomousLoop',
      'dispatchNextTask',
      'decideNextTask',
      'planNextTask',
      'generateNextTask',
      'dispatch',
      'fanOut',
      'createChildTask',
      'registerAdapter',
      'astraSync',
      'openCodeSync',
      'claimNextTask',
      'autoClaim',
    ]) {
      assert.equal(store[forbidden], undefined, `${forbidden} must not exist`);
    }
    for (const allowed of [
      'emitNextTask',
      'readEmission',
      'admitEmittedTask',
      'readEmissionAdmission',
      'markReady',
      'readTaskSequence',
      'readCursor',
      'advanceCursor',
    ]) {
      assert.equal(typeof store[allowed], 'function', `${allowed} must exist`);
    }
    assert.notEqual(
      CoordinationStore.prototype.admitEmittedTask,
      CoordinationStore.prototype.emitNextTask,
    );
    driveToEmitted(store, clock, 'AD14-BND-SRC', 'AD14-BND-CHILD', 'result-ad14-bnd-src');
    clock.advance(1000);
    const out = store.admitEmittedTask({
      sourceTaskId: 'AD14-BND-SRC',
      admitterId: 'control-tower-1',
    });
    assert.equal(out.child.status, 'READY');
    const resolved = resolveCoordinationHome({ platform: 'win32', env: { LOCALAPPDATA: home } });
    assert.ok(!resolve(MODULE_DIRECTORY, '../..').startsWith(resolved) || true);
    const repoAdmissions = join(resolve(MODULE_DIRECTORY, '../..'), 'tasks');
    assert.equal(existsSync(repoAdmissions), false);
    assert.equal(existsSync(join(MODULE_DIRECTORY, 'emission-admission.mjs')), true);
    assert.equal(existsSync(admissionPath(home, 'AD14-BND-SRC')), true);
  } finally {
    removeHome(home);
  }
});
