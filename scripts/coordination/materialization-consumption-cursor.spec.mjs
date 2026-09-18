// Proof for GREENHUB-COORDINATION-CANONICAL-MATERIALIZATION-CONSUMPTION-CURSOR-11.
// ADOPTED -> materialize -> readback -> ACK -> CONSUMED -> cursor ONLY.
// No next-task emission, scheduler, fan-out, adapters, Astra/OpenCode,
// autonomous loop, application code, publication automation, or 57C.
// All runtime state lives in isolated temp directories. No network required.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveCoordinationHome } from './coordination-home.mjs';
import { TASK_STATUS_RESULT_DELIVERED } from './task-envelope.mjs';
import {
  DISPOSITION_STATE_ADOPTED,
  DISPOSITION_STATE_BLOCKED,
  DISPOSITION_STATE_NEEDS_USER,
  DISPOSITION_STATE_PENDING,
  DISPOSITION_STATE_REJECTED,
  DISPOSITION_STATE_SUPERSEDED,
  buildCanonicalTransitionId,
  computeResultBinding,
} from './disposition.mjs';
import {
  CURSOR_SEQUENCE_CONTRACT,
  buildAckId,
  buildConsumedId,
  buildMaterializationId,
} from './materialization.mjs';
import { CoordinationStore } from './store.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(MODULE_DIRECTORY, '../..');
const STORE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'store.mjs')).href;

function makeHome(prefix = 'greenhub-mat11-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'MATERIALIZATION_READBACK_CONSUMPTION_CURSOR_IMPLEMENTED',
    policyRefs: ['docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md'],
    evidenceRefs: ['git:live-main-read'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: {
      liveMainHint: null,
      requiredPolicies: ['AGENTS.md'],
    },
    ownedSurface: ['scripts/coordination/'],
    mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['materialization-readback', 'ack-consumed-cursor-proof'],
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

function driveToDelivered(store, taskId, resultId = 'result-0001') {
  store.createTask(sampleTaskInput(taskId));
  store.markReady(taskId);
  const claim = store.claimTask({ taskId, workerId: 'worker-a', leaseDurationMs: 60_000 });
  const delivered = store.deliverResult(sampleResult(claim, { resultId }));
  return { claim, delivered };
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

function driveToAdopted(store, clock, taskId, resultId = 'result-0001') {
  const { delivered } = driveToDelivered(store, taskId, resultId);
  store.beginDisposition({ taskId, resultId, ...ctParams() });
  clock.advance(1000);
  const adopted = store.writeDisposition({
    taskId,
    dispositionGeneration: 2,
    resultId,
    ...ctParams({ controlTowerToken: 'ct-token-002' }),
    state: DISPOSITION_STATE_ADOPTED,
  });
  return { delivered, adopted };
}

// ---------------------------------------------------------------------------
// A. ADOPTED happy path
// ---------------------------------------------------------------------------

test('A. ADOPTED happy path: materialize -> readback -> ACK -> CONSUMED -> cursor', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { delivered, adopted } = driveToAdopted(store, clock, 'MAT11A01', 'result-a01');
    assert.equal(adopted.record.state, DISPOSITION_STATE_ADOPTED);

    clock.advance(1000);
    const materialized = store.materializeAdoption({ taskId: 'MAT11A01', ...matParams() });
    assert.equal(materialized.duplicate, false);
    const mat = materialized.record;
    assert.equal(mat.taskId, 'MAT11A01');
    assert.equal(mat.resultId, 'result-a01');
    assert.equal(mat.state, DISPOSITION_STATE_ADOPTED);
    assert.equal(mat.dispositionGeneration, 2);
    assert.equal(mat.dispositionRef, 'MAT11A01@2');
    assert.equal(mat.claimGeneration, delivered.record.claimGeneration);
    assert.equal(mat.resultBinding, computeResultBinding(delivered.record));
    assert.equal(
      mat.canonicalTransitionId,
      buildCanonicalTransitionId({ taskId: 'MAT11A01', dispositionGeneration: 2, resultId: 'result-a01' }),
    );
    assert.equal(
      mat.materializationId,
      buildMaterializationId({ taskId: 'MAT11A01', dispositionGeneration: 2, resultId: 'result-a01' }),
    );
    assert.equal(mat.schemaVersion, '1');
    assert.ok(mat.materializedAt);
    assert.equal(existsSync(join(home, 'tasks', 'MAT11A01', 'materialization.json')), true);

    // Durable reopen/read-back via a fresh store instance.
    const reopened = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const readback = reopened.verifyMaterializationReadback('MAT11A01');
    assert.equal(readback.ok, true);
    assert.deepEqual(readback.record, mat);
    assert.deepEqual(reopened.readMaterialization('MAT11A01'), mat);

    // ACK only after read-back.
    clock.advance(1000);
    const acked = reopened.ackAdoption({ taskId: 'MAT11A01', acknowledgerId: 'control-tower-1', proofRefs: ['proof:readback-pass'] });
    assert.equal(acked.duplicate, false);
    assert.equal(acked.record.taskId, 'MAT11A01');
    assert.equal(acked.record.materializationId, mat.materializationId);
    assert.equal(acked.record.ackId, buildAckId({ taskId: 'MAT11A01', materializationId: mat.materializationId }));
    assert.equal(acked.record.resultBinding, mat.resultBinding);
    assert.equal(existsSync(join(home, 'tasks', 'MAT11A01', 'ack.json')), true);

    // CONSUMED only after ACK.
    clock.advance(1000);
    const consumed = reopened.markConsumed({ taskId: 'MAT11A01', consumerId: 'control-tower-1', proofRefs: ['proof:ack-valid'] });
    assert.equal(consumed.duplicate, false);
    assert.equal(consumed.record.materializationId, mat.materializationId);
    assert.equal(consumed.record.ackId, acked.record.ackId);
    assert.equal(
      consumed.record.consumedId,
      buildConsumedId({ taskId: 'MAT11A01', materializationId: mat.materializationId, ackId: acked.record.ackId }),
    );
    assert.equal(existsSync(join(home, 'tasks', 'MAT11A01', 'consumed.json')), true);
    assert.equal(reopened.isConsumed('MAT11A01'), true);

    // Cursor advances over the single consumed task.
    clock.advance(1000);
    const cursor = reopened.advanceCursor({ orderedTaskIds: ['MAT11A01'], evaluatorId: 'control-tower-1' });
    assert.equal(cursor.record.watermarkTaskId, 'MAT11A01');
    assert.deepEqual(cursor.record.consumedThrough, ['MAT11A01']);
    assert.equal(cursor.record.sequenceContract, CURSOR_SEQUENCE_CONTRACT);
    assert.equal(existsSync(join(home, 'consumption', 'cursor.json')), true);
    assert.deepEqual(reopened.readCursor().watermarkTaskId, 'MAT11A01');

    // Raw evidence preserved.
    assert.equal(store.readResult('MAT11A01').resultId, 'result-a01');
    assert.equal(store.readCurrentDisposition('MAT11A01').state, DISPOSITION_STATE_ADOPTED);
    assert.equal(adopted.record.resultId, 'result-a01');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// B. non-adopted refusal
// ---------------------------------------------------------------------------

test('B. non-adopted dispositions refuse materialization', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });

    // PENDING gen1.
    driveToDelivered(store, 'MAT11B01', 'result-b01');
    store.beginDisposition({ taskId: 'MAT11B01', resultId: 'result-b01', ...ctParams() });
    assert.throws(() => store.materializeAdoption({ taskId: 'MAT11B01', ...matParams() }), (error) => error?.code === 'MATERIALIZATION_NOT_ELIGIBLE');

    // BLOCKED gen2.
    driveToDelivered(store, 'MAT11B02', 'result-b02');
    store.beginDisposition({ taskId: 'MAT11B02', resultId: 'result-b02', ...ctParams() });
    clock.advance(1000);
    store.writeDisposition({ taskId: 'MAT11B02', dispositionGeneration: 2, resultId: 'result-b02', ...ctParams({ controlTowerToken: 'ct-002' }), state: DISPOSITION_STATE_BLOCKED });
    assert.throws(() => store.materializeAdoption({ taskId: 'MAT11B02', ...matParams() }), (error) => error?.code === 'MATERIALIZATION_NOT_ELIGIBLE');

    // NEEDS_USER_DECISION gen2.
    driveToDelivered(store, 'MAT11B03', 'result-b03');
    store.beginDisposition({ taskId: 'MAT11B03', resultId: 'result-b03', ...ctParams() });
    clock.advance(1000);
    store.writeDisposition({
      taskId: 'MAT11B03',
      dispositionGeneration: 2,
      resultId: 'result-b03',
      ...ctParams({ controlTowerToken: 'ct-002' }),
      state: DISPOSITION_STATE_NEEDS_USER,
      userDecision: { decisionRequestId: 'dec-1', questionVersion: 'v1', requiredAuthority: 'OWNER' },
    });
    assert.throws(() => store.materializeAdoption({ taskId: 'MAT11B03', ...matParams() }), (error) => error?.code === 'MATERIALIZATION_NOT_ELIGIBLE');

    // REJECTED gen2.
    driveToDelivered(store, 'MAT11B04', 'result-b04');
    store.beginDisposition({ taskId: 'MAT11B04', resultId: 'result-b04', ...ctParams() });
    clock.advance(1000);
    store.writeDisposition({ taskId: 'MAT11B04', dispositionGeneration: 2, resultId: 'result-b04', ...ctParams({ controlTowerToken: 'ct-002' }), state: DISPOSITION_STATE_REJECTED });
    assert.throws(() => store.materializeAdoption({ taskId: 'MAT11B04', ...matParams() }), (error) => error?.code === 'MATERIALIZATION_NOT_ELIGIBLE');

    // SUPERSEDED gen2.
    driveToDelivered(store, 'MAT11B05', 'result-b05');
    store.beginDisposition({ taskId: 'MAT11B05', resultId: 'result-b05', ...ctParams() });
    clock.advance(1000);
    store.writeDisposition({ taskId: 'MAT11B05', dispositionGeneration: 2, resultId: 'result-b05', ...ctParams({ controlTowerToken: 'ct-002' }), state: DISPOSITION_STATE_SUPERSEDED });
    assert.throws(() => store.materializeAdoption({ taskId: 'MAT11B05', ...matParams() }), (error) => error?.code === 'MATERIALIZATION_NOT_ELIGIBLE');

    // No materialization files leaked for refused tasks.
    for (const taskId of ['MAT11B01', 'MAT11B02', 'MAT11B03', 'MAT11B04', 'MAT11B05']) {
      assert.equal(existsSync(join(home, 'tasks', taskId, 'materialization.json')), false);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// C. corrupt / missing fail-closed
// ---------------------------------------------------------------------------

test('C1. missing result / missing disposition fails closed', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    store.createTask(sampleTaskInput('MAT11C01'));
    store.markReady('MAT11C01');
    assert.throws(() => store.materializeAdoption({ taskId: 'MAT11C01', ...matParams() }), (error) =>
      ['MATERIALIZATION_NOT_ELIGIBLE', 'DISPOSITION_NOT_FOUND', 'DISPOSITION_TASK_NOT_DELIVERED'].includes(error?.code),
    );
    assert.throws(() => store.ackAdoption({ taskId: 'MAT11C01', acknowledgerId: 'ct-1' }), (error) =>
      ['ACK_NOT_READY', 'MATERIALIZATION_NOT_ELIGIBLE', 'DISPOSITION_NOT_FOUND'].includes(error?.code),
    );
    assert.throws(() => store.markConsumed({ taskId: 'MAT11C01', consumerId: 'ct-1' }), (error) =>
      ['CONSUMED_NOT_READY', 'MATERIALIZATION_NOT_ELIGIBLE', 'ACK_NOT_FOUND'].includes(error?.code),
    );
  } finally {
    removeHome(home);
  }
});

test('C2. corrupt result blocks materialization read-back', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdopted(store, clock, 'MAT11C02', 'result-c02');
    clock.advance(1000);
    store.materializeAdoption({ taskId: 'MAT11C02', ...matParams() });
    const tampered = { ...store.readResult('MAT11C02'), summary: 'tampered executor output' };
    writeFileSync(join(home, 'tasks', 'MAT11C02', 'result.json'), JSON.stringify(tampered, null, 2), 'utf8');
    assert.throws(() => store.verifyMaterializationReadback('MAT11C02'), (error) =>
      ['CORRUPT_MATERIALIZATION', 'CORRUPT_RESULT', 'DISPOSITION_RESULT_BINDING_MISMATCH'].includes(error?.code),
    );
    assert.throws(() => store.ackAdoption({ taskId: 'MAT11C02', acknowledgerId: 'ct-1' }), (error) => error != null);
  } finally {
    removeHome(home);
  }
});

test('C3. corrupt disposition blocks materialization', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdopted(store, clock, 'MAT11C03', 'result-c03');
    writeFileSync(join(home, 'tasks', 'MAT11C03', 'disposition', 'generations', '2.json'), '{not-json', 'utf8');
    assert.throws(() => store.materializeAdoption({ taskId: 'MAT11C03', ...matParams() }), (error) => error != null);
  } finally {
    removeHome(home);
  }
});

test('C4. materialization corruption fails closed with no auto-repair', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdopted(store, clock, 'MAT11C04', 'result-c04');
    clock.advance(1000);
    const before = store.materializeAdoption({ taskId: 'MAT11C04', ...matParams() });
    writeFileSync(join(home, 'tasks', 'MAT11C04', 'materialization.json'), '{broken', 'utf8');
    assert.throws(() => store.verifyMaterializationReadback('MAT11C04'), (error) => error?.code === 'CORRUPT_MATERIALIZATION');
    assert.throws(() => store.ackAdoption({ taskId: 'MAT11C04', acknowledgerId: 'ct-1' }), (error) => error != null);
    assert.equal(readFileSync(join(home, 'tasks', 'MAT11C04', 'materialization.json'), 'utf8'), '{broken');
    void before;
  } finally {
    removeHome(home);
  }
});

test('C5. ACK without read-back and CONSUMED without ACK are refused', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    // RESULT_DELIVERED only.
    driveToDelivered(store, 'MAT11C05', 'result-c05');
    assert.throws(() => store.ackAdoption({ taskId: 'MAT11C05', acknowledgerId: 'ct-1' }), (error) =>
      ['ACK_NOT_READY', 'MATERIALIZATION_NOT_ELIGIBLE'].includes(error?.code),
    );
    // ADOPTED without materialization.
    driveToAdopted(store, clock, 'MAT11C06', 'result-c06');
    assert.throws(() => store.ackAdoption({ taskId: 'MAT11C06', acknowledgerId: 'ct-1' }), (error) => error?.code === 'ACK_NOT_READY');
    assert.throws(() => store.markConsumed({ taskId: 'MAT11C06', consumerId: 'ct-1' }), (error) => error?.code === 'CONSUMED_NOT_READY');
    // Materialized but not ACKed.
    clock.advance(1000);
    store.materializeAdoption({ taskId: 'MAT11C06', ...matParams() });
    assert.throws(() => store.markConsumed({ taskId: 'MAT11C06', consumerId: 'ct-1' }), (error) => error?.code === 'CONSUMED_NOT_READY');
  } finally {
    removeHome(home);
  }
});

test('C6. cursor with gap never skips; corrupt prefix fails closed', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    for (const taskId of ['MAT11C10', 'MAT11C11']) {
      driveToAdopted(store, clock, taskId, `result-${taskId.toLowerCase()}`);
      clock.advance(1000);
      store.materializeAdoption({ taskId, ...matParams() });
      clock.advance(1000);
      store.ackAdoption({ taskId, acknowledgerId: 'control-tower-1' });
      clock.advance(1000);
    }
    // Consume only the second; first remains a gap.
    store.markConsumed({ taskId: 'MAT11C11', consumerId: 'control-tower-1' });
    assert.equal(store.isConsumed('MAT11C10'), false);
    assert.equal(store.isConsumed('MAT11C11'), true);
    clock.advance(1000);
    const cursor = store.advanceCursor({ orderedTaskIds: ['MAT11C10', 'MAT11C11'], evaluatorId: 'control-tower-1' });
    assert.equal(cursor.record.watermarkTaskId, null);
    assert.deepEqual(cursor.record.consumedThrough, []);

    // Close the gap, then the watermark advances contiguously.
    store.markConsumed({ taskId: 'MAT11C10', consumerId: 'control-tower-1' });
    clock.advance(1000);
    const advanced = store.advanceCursor({ orderedTaskIds: ['MAT11C10', 'MAT11C11'], evaluatorId: 'control-tower-1' });
    assert.equal(advanced.record.watermarkTaskId, 'MAT11C11');
    assert.deepEqual(advanced.record.consumedThrough, ['MAT11C10', 'MAT11C11']);

    // Corrupt the consumed marker: cursor revalidation fails closed.
    writeFileSync(join(home, 'tasks', 'MAT11C10', 'consumed.json'), '{corrupt', 'utf8');
    assert.throws(() => store.readCursor(), (error) => error != null);
    assert.throws(() => store.advanceCursor({ orderedTaskIds: ['MAT11C10', 'MAT11C11'], evaluatorId: 'control-tower-1' }), (error) => error != null);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// D. idempotency
// ---------------------------------------------------------------------------

test('D. same materialization / ACK / consumed / cursor replay is idempotent', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdopted(store, clock, 'MAT11D01', 'result-d01');
    clock.advance(1000);
    const firstMat = store.materializeAdoption({ taskId: 'MAT11D01', ...matParams() });
    assert.equal(firstMat.duplicate, false);
    const replayMat = store.materializeAdoption({ taskId: 'MAT11D01', ...matParams() });
    assert.equal(replayMat.duplicate, true);
    assert.deepEqual(replayMat.record, firstMat.record);

    clock.advance(1000);
    const firstAck = store.ackAdoption({ taskId: 'MAT11D01', acknowledgerId: 'control-tower-1', proofRefs: ['proof:rb'] });
    const replayAck = store.ackAdoption({ taskId: 'MAT11D01', acknowledgerId: 'control-tower-1', proofRefs: ['proof:rb'] });
    assert.equal(replayAck.duplicate, true);
    assert.deepEqual(replayAck.record, firstAck.record);

    clock.advance(1000);
    const firstCon = store.markConsumed({ taskId: 'MAT11D01', consumerId: 'control-tower-1', proofRefs: ['proof:ack'] });
    const replayCon = store.markConsumed({ taskId: 'MAT11D01', consumerId: 'control-tower-1', proofRefs: ['proof:ack'] });
    assert.equal(replayCon.duplicate, true);
    assert.deepEqual(replayCon.record, firstCon.record);

    clock.advance(1000);
    const firstCursor = store.advanceCursor({ orderedTaskIds: ['MAT11D01'], evaluatorId: 'control-tower-1' });
    const replayCursor = store.advanceCursor({ orderedTaskIds: ['MAT11D01'], evaluatorId: 'control-tower-1' });
    assert.equal(replayCursor.duplicate, true);
    assert.deepEqual(replayCursor.record.consumedThrough, firstCursor.record.consumedThrough);
    assert.equal(replayCursor.record.watermarkTaskId, firstCursor.record.watermarkTaskId);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. conflicts
// ---------------------------------------------------------------------------

test('E. same materialization identity with different payload conflicts', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdopted(store, clock, 'MAT11E01', 'result-e01');
    clock.advance(1000);
    store.materializeAdoption({ taskId: 'MAT11E01', ...matParams() });
    assert.throws(
      () => store.materializeAdoption({ taskId: 'MAT11E01', ...matParams({ materializerId: 'control-tower-DIFFERENT' }) }),
      (error) => error?.code === 'MATERIALIZATION_CONFLICT',
    );
    assert.throws(
      () => store.materializeAdoption({ taskId: 'MAT11E01', ...matParams({ policyRefs: ['policy:different'] }) }),
      (error) => error?.code === 'MATERIALIZATION_CONFLICT',
    );
    // Winner preserved.
    assert.equal(store.readMaterialization('MAT11E01').materializerId, 'control-tower-1');

    // ACK conflict as well.
    clock.advance(1000);
    store.ackAdoption({ taskId: 'MAT11E01', acknowledgerId: 'control-tower-1', proofRefs: ['proof:a'] });
    assert.throws(
      () => store.ackAdoption({ taskId: 'MAT11E01', acknowledgerId: 'control-tower-1', proofRefs: ['proof:b'] }),
      (error) => error?.code === 'ACK_CONFLICT',
    );
  } finally {
    removeHome(home);
  }
});

test('E2. reference-first violations rejected across the new domain', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdopted(store, clock, 'MAT11E02', 'result-e02');
    clock.advance(1000);
    assert.throws(
      () => store.materializeAdoption({ taskId: 'MAT11E02', ...matParams(), chatHistory: 'embedded' }),
      (error) => error?.code === 'CONTEXT_BUDGET_EXCEEDED',
    );
    assert.throws(
      () => store.materializeAdoption({ taskId: 'MAT11E02', ...matParams(), nextTasks: ['CHILD-1'] }),
      (error) => error?.code === 'CONTEXT_BUDGET_EXCEEDED',
    );
    assert.throws(
      () => store.materializeAdoption({ taskId: 'MAT11E02', ...matParams(), proofRefs: ['x'.repeat(600)] }),
      (error) => error?.code === 'CONTEXT_BUDGET_EXCEEDED',
    );
    assert.equal(existsSync(join(home, 'tasks', 'MAT11E02', 'materialization.json')), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. competing writers (focused; outer loop runs 10 consecutive GREEN)
// ---------------------------------------------------------------------------

function runMaterializationRaceWorker({ home, taskId, materializerId }) {
  return new Promise((resolveResult, rejectResult) => {
    const code = [
      'try {',
      `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
      `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
      `  const out = store.materializeAdoption({ taskId: ${JSON.stringify(taskId)}, materializerId: ${JSON.stringify(materializerId)}, policyRefs: ['policy:race'], proofRefs: ['proof:race'], evidenceRefs: ['evidence:race'] });`,
      '  console.log(JSON.stringify({ ok: true, duplicate: out.duplicate, materializer: out.record.materializerId }));',
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
        rejectResult(new Error(`materialization race worker exit=${exitCode} stderr=${stderr}`));
        return;
      }
      try {
        resolveResult(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch (error) {
        rejectResult(new Error(`materialization race worker output parse failed: ${stdout} / ${stderr}`));
      }
    });
  });
}

test('F. Two competing materialization writers: exactly one canonical winner', { timeout: 30_000 }, async () => {
  const home = makeHome('greenhub-mat11-race-');
  try {
    const setup = new CoordinationStore({ dir: home });
    const taskId = 'MAT11F01';
    setup.createTask(sampleTaskInput(taskId));
    setup.markReady(taskId);
    const claim = setup.claimTask({ taskId, workerId: 'worker-a', leaseDurationMs: 60_000 });
    setup.deliverResult(sampleResult(claim, { resultId: 'result-f01' }));
    setup.beginDisposition({ taskId, resultId: 'result-f01', ...ctParams() });
    setup.writeDisposition({
      taskId,
      dispositionGeneration: 2,
      resultId: 'result-f01',
      ...ctParams({ controlTowerToken: 'ct-token-002' }),
      state: DISPOSITION_STATE_ADOPTED,
    });

    const [first, second] = await Promise.all([
      runMaterializationRaceWorker({ home, taskId, materializerId: 'mat-race-A' }),
      runMaterializationRaceWorker({ home, taskId, materializerId: 'mat-race-B' }),
    ]);
    const winners = [first, second].filter((result) => result.ok === true);
    const losers = [first, second].filter((result) => result.ok !== true);
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.equal(losers[0].code, 'MATERIALIZATION_CONFLICT');

    const stored = setup.readMaterialization(taskId);
    assert.equal(stored.materializerId, winners[0].materializer);
    assert.ok(['mat-race-A', 'mat-race-B'].includes(stored.materializerId));
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// Cursor contract details
// ---------------------------------------------------------------------------

test('CURSOR. sequence contract pinned; order violations and rewind refused', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    assert.equal(CURSOR_SEQUENCE_CONTRACT, 'append-stable-task-sequence-v1');
    for (const taskId of ['MAT11G01', 'MAT11G02']) {
      driveToAdopted(store, clock, taskId, `result-${taskId.toLowerCase()}`);
      clock.advance(1000);
      store.materializeAdoption({ taskId, ...matParams() });
      clock.advance(1000);
      store.ackAdoption({ taskId, acknowledgerId: 'control-tower-1' });
      clock.advance(1000);
      store.markConsumed({ taskId, consumerId: 'control-tower-1' });
      clock.advance(1000);
    }
    // Unsorted / duplicate order inputs are refused, never silently reordered.
    assert.throws(
      () => store.advanceCursor({ orderedTaskIds: ['MAT11G02', 'MAT11G01'], evaluatorId: 'control-tower-1' }),
      (error) => error?.code === 'CURSOR_ORDER_VIOLATION',
    );
    assert.throws(
      () => store.advanceCursor({ orderedTaskIds: ['MAT11G01', 'MAT11G01'], evaluatorId: 'control-tower-1' }),
      (error) => error?.code === 'CURSOR_ORDER_VIOLATION',
    );
    const full = store.advanceCursor({ orderedTaskIds: ['MAT11G01', 'MAT11G02'], evaluatorId: 'control-tower-1' });
    assert.equal(full.record.watermarkTaskId, 'MAT11G02');
    // Stale subset view never rewinds the persisted watermark.
    const stale = store.advanceCursor({ orderedTaskIds: ['MAT11G01'], evaluatorId: 'control-tower-1' });
    assert.equal(stale.record.watermarkTaskId, 'MAT11G02');
    assert.deepEqual(store.readCursor().consumedThrough, ['MAT11G01', 'MAT11G02']);

    // Disposition-only / materialization-only / ACK-only tasks never advance.
    const home2 = makeHome('greenhub-mat11-noconsume-');
    try {
      const store2 = new CoordinationStore({ dir: home2, nowProvider: () => clock.provider() });
      driveToAdopted(store2, clock, 'MAT11G03', 'result-g03');
      const before = store2.advanceCursor({ orderedTaskIds: ['MAT11G03'], evaluatorId: 'control-tower-1' });
      assert.equal(before.record.watermarkTaskId, null);
      clock.advance(1000);
      store2.materializeAdoption({ taskId: 'MAT11G03', ...matParams() });
      const afterMat = store2.advanceCursor({ orderedTaskIds: ['MAT11G03'], evaluatorId: 'control-tower-1' });
      assert.equal(afterMat.record.watermarkTaskId, null);
      clock.advance(1000);
      store2.ackAdoption({ taskId: 'MAT11G03', acknowledgerId: 'control-tower-1' });
      const afterAck = store2.advanceCursor({ orderedTaskIds: ['MAT11G03'], evaluatorId: 'control-tower-1' });
      assert.equal(afterAck.record.watermarkTaskId, null);
    } finally {
      removeHome(home2);
    }
  } finally {
    removeHome(home);
  }
});

test('BOUNDARY. no emission / scheduler / adapters; app code untouched; evidence preserved', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    for (const forbidden of ['emitNextTask', 'emitNext', 'createChildTask', 'schedule', 'fanOut', 'registerAdapter', 'astraSync', 'openCodeSync']) {
      assert.equal(store[forbidden], undefined);
    }
    driveToAdopted(store, clock, 'MAT11H01', 'result-h01');
    clock.advance(1000);
    const mat = store.materializeAdoption({ taskId: 'MAT11H01', ...matParams() }).record;
    assert.equal('nextTasks' in mat, false);
    assert.equal('emission' in mat, false);
    assert.equal('emissionSlot' in mat, false);
    assert.equal('scheduler' in mat, false);
    clock.advance(1000);
    store.ackAdoption({ taskId: 'MAT11H01', acknowledgerId: 'control-tower-1' });
    clock.advance(1000);
    store.markConsumed({ taskId: 'MAT11H01', consumerId: 'control-tower-1' });
    // Raw evidence still present and unmodified.
    assert.equal(existsSync(join(home, 'tasks', 'MAT11H01', 'result.json')), true);
    assert.equal(existsSync(join(home, 'tasks', 'MAT11H01', 'disposition', 'generations', '1.json')), true);
    assert.equal(existsSync(join(home, 'tasks', 'MAT11H01', 'disposition', 'generations', '2.json')), true);
    assert.equal(existsSync(join(home, 'tasks', 'MAT11H01', 'materialization.json')), true);

    // Runtime state remains outside the repository.
    const fakeBase = makeHome('greenhub-mat11-home-resolve-');
    try {
      const resolved = resolveCoordinationHome({ platform: 'win32', env: { LOCALAPPDATA: fakeBase } });
      assert.equal(resolved, join(fakeBase, 'Greenhub', 'coordination'));
      assert.equal(resolved.startsWith(REPOSITORY_ROOT), false);
      for (const artifact of ['materialization.json', 'ack.json', 'consumed.json']) {
        assert.equal(existsSync(join(MODULE_DIRECTORY, artifact)), false);
      }
      assert.equal(existsSync(join(REPOSITORY_ROOT, 'materialization.json')), false);
      const ownedEntries = [
        'coordination-home.mjs',
        'task-envelope.mjs',
        'store.mjs',
        'disposition.mjs',
        'materialization.mjs',
        'durable-core.spec.mjs',
        'disposition.spec.mjs',
        'materialization-consumption-cursor.spec.mjs',
      ];
      for (const entry of ownedEntries) {
        assert.equal(existsSync(join(MODULE_DIRECTORY, entry)), true);
      }
      void TASK_STATUS_RESULT_DELIVERED;
      void DISPOSITION_STATE_PENDING;
      void DISPOSITION_STATE_BLOCKED;
      void DISPOSITION_STATE_NEEDS_USER;
      void DISPOSITION_STATE_REJECTED;
      void DISPOSITION_STATE_SUPERSEDED;
    } finally {
      removeHome(fakeBase);
    }
  } finally {
    removeHome(home);
  }
});
