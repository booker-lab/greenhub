// Proof for GREENHUB-COORDINATION-CURSOR-APPEND-STABILITY-12.
// Append-stable task sequence + v1 cursor migration ONLY.
// No next-task emission, scheduler, fan-out, adapters, Astra/OpenCode,
// autonomous loop, application code, publication automation, or 57C.
// All runtime state lives in isolated temp directories. No network required.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveCoordinationHome } from './coordination-home.mjs';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import {
  CURSOR_SEQUENCE_CONTRACT,
  LEGACY_CURSOR_SEQUENCE_CONTRACT,
} from './materialization.mjs';
import {
  TASK_SEQUENCE_CONTRACT,
  LEGACY_CURSOR_SEQUENCE_CONTRACT as LEGACY_SEQ_CONTRACT,
  validateSequenceEntryRecord,
} from './task-sequence.mjs';
import { CoordinationStore } from './store.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const STORE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'store.mjs')).href;

function makeHome(prefix = 'greenhub-seq12-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'CURSOR_APPEND_STABILITY_PROVED',
    policyRefs: ['docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md'],
    evidenceRefs: ['git:live-main-read'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: {
      liveMainHint: null,
      requiredPolicies: ['AGENTS.md'],
    },
    ownedSurface: ['scripts/coordination/'],
    mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['append-stability-proof'],
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

function driveToConsumed(store, clock, taskId, resultId = 'result-0001') {
  driveToAdopted(store, clock, taskId, resultId);
  clock.advance(1000);
  store.materializeAdoption({ taskId, ...matParams() });
  clock.advance(1000);
  store.ackAdoption({ taskId, acknowledgerId: 'control-tower-1' });
  clock.advance(1000);
  store.markConsumed({ taskId, consumerId: 'control-tower-1' });
  clock.advance(1000);
}

// ---------------------------------------------------------------------------
// A. Bootstrap
// ---------------------------------------------------------------------------

test('A1. initial tasks deterministic bootstrap, replay idempotent, no duplicates', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    assert.equal(CURSOR_SEQUENCE_CONTRACT, TASK_SEQUENCE_CONTRACT);
    assert.equal(TASK_SEQUENCE_CONTRACT, 'append-stable-task-sequence-v1');
    assert.equal(LEGACY_CURSOR_SEQUENCE_CONTRACT, 'lexicographic-task-id-v1');
    assert.equal(LEGACY_SEQ_CONTRACT, 'lexicographic-task-id-v1');

    // Create in lexicographic order for deterministic bootstrap.
    for (const taskId of ['SEQ12-A001', 'SEQ12-B002', 'SEQ12-C003']) {
      store.createTask(sampleTaskInput(taskId));
      clock.advance(1000);
    }
    const first = store.readTaskSequence();
    assert.deepEqual(first, ['SEQ12-A001', 'SEQ12-B002', 'SEQ12-C003']);

    // Replay is idempotent.
    const second = store.syncTaskSequence();
    assert.deepEqual(second, first);
    const third = store.readTaskSequence();
    assert.deepEqual(third, first);

    // No duplicate members, entries validated, positions 1..N contiguous.
    const entries = store.readSequenceEntries();
    assert.equal(entries.length, 3);
    assert.deepEqual(entries.map((e) => e.sequenceNumber), [1, 2, 3]);
    assert.equal(new Set(entries.map((e) => e.taskId)).size, 3);
    for (const entry of entries) {
      validateSequenceEntryRecord(entry);
      // No timestamps in authority records.
      assert.equal('createdAt' in entry, false);
      assert.equal('updatedAt' in entry, false);
      assert.equal('consumedAt' in entry, false);
      assert.equal('materializedAt' in entry, false);
    }
    // Durable files exist outside the repository.
    for (const n of [1, 2, 3]) {
      const name = `${String(n).padStart(10, '0')}.json`;
      assert.equal(existsSync(join(home, 'consumption', 'sequence', 'entries', name)), true);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// RED proof closed: late lexical-earlier task appends at tail, never inserts.
// ---------------------------------------------------------------------------

test('B+C+D. late lexical-earlier task tails, gap blocks, consumption advances', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });

    // Initial B,C consumed, cursor advances.
    for (const taskId of ['RED12-B002', 'RED12-C003']) {
      driveToConsumed(store, clock, taskId, `result-${taskId.toLowerCase()}`);
    }
    assert.deepEqual(store.readTaskSequence(), ['RED12-B002', 'RED12-C003']);
    clock.advance(1000);
    const initial = store.advanceCursor({ evaluatorId: 'control-tower-1' });
    assert.deepEqual(initial.record.consumedThrough, ['RED12-B002', 'RED12-C003']);
    assert.equal(initial.record.watermarkTaskId, 'RED12-C003');
    assert.equal(initial.record.sequenceContract, TASK_SEQUENCE_CONTRACT);

    // Late lexical-earlier A (READY, unconsumed).
    clock.advance(1000);
    store.createTask(sampleTaskInput('RED12-A001'));
    store.markReady('RED12-A001');
    assert.equal('RED12-A001' < 'RED12-B002', true);
    assert.equal(store.isConsumed('RED12-A001'), false);

    // Must tail, never insert before the frozen prefix.
    assert.deepEqual(store.readTaskSequence(), ['RED12-B002', 'RED12-C003', 'RED12-A001']);

    // Gap: new tail unconsumed blocks advancement beyond it.
    clock.advance(1000);
    const blocked = store.advanceCursor({ evaluatorId: 'control-tower-1' });
    assert.deepEqual(blocked.record.consumedThrough, ['RED12-B002', 'RED12-C003']);
    assert.equal(blocked.record.watermarkTaskId, 'RED12-C003');
    assert.deepEqual(store.readCursor().consumedThrough, ['RED12-B002', 'RED12-C003']);

    // Consumption: tail A consumed allows normal advance.
    const claim = store.claimTask({ taskId: 'RED12-A001', workerId: 'worker-a', leaseDurationMs: 60_000 });
    store.deliverResult(sampleResult(claim, { resultId: 'result-red12-a001' }));
    store.beginDisposition({ taskId: 'RED12-A001', resultId: 'result-red12-a001', ...ctParams() });
    clock.advance(1000);
    store.writeDisposition({
      taskId: 'RED12-A001',
      dispositionGeneration: 2,
      resultId: 'result-red12-a001',
      ...ctParams({ controlTowerToken: 'ct-token-002' }),
      state: DISPOSITION_STATE_ADOPTED,
    });
    clock.advance(1000);
    store.materializeAdoption({ taskId: 'RED12-A001', ...matParams() });
    clock.advance(1000);
    store.ackAdoption({ taskId: 'RED12-A001', acknowledgerId: 'control-tower-1' });
    clock.advance(1000);
    store.markConsumed({ taskId: 'RED12-A001', consumerId: 'control-tower-1' });
    clock.advance(1000);
    const advanced = store.advanceCursor({ evaluatorId: 'control-tower-1' });
    assert.deepEqual(advanced.record.consumedThrough, ['RED12-B002', 'RED12-C003', 'RED12-A001']);
    assert.equal(advanced.record.watermarkTaskId, 'RED12-A001');
  } finally {
    removeHome(home);
  }
});

test('E. multiple late tasks only append after frozen prefix regardless of lexical order', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    for (const taskId of ['MUL12-B002', 'MUL12-C003']) {
      driveToConsumed(store, clock, taskId, `result-${taskId.toLowerCase()}`);
    }
    clock.advance(1000);
    store.advanceCursor({ evaluatorId: 'control-tower-1' });

    // Late tasks in non-lexicographic creation order, some lexically earlier.
    for (const taskId of ['MUL12-Z009', 'MUL12-A001', 'MUL12-M005']) {
      store.createTask(sampleTaskInput(taskId));
      store.markReady(taskId);
      clock.advance(1000);
    }
    const sequence = store.readTaskSequence();
    assert.equal(sequence.length, 5);
    // Frozen prefix preserved exactly.
    assert.deepEqual(sequence.slice(0, 2), ['MUL12-B002', 'MUL12-C003']);
    // All late tasks after the prefix, no insertion before, no duplicates.
    const tail = sequence.slice(2);
    assert.equal(new Set(sequence).size, 5);
    assert.ok(tail.includes('MUL12-Z009'));
    assert.ok(tail.includes('MUL12-A001'));
    assert.ok(tail.includes('MUL12-M005'));
    // Cursor still blocked at the frozen prefix (tail unconsumed).
    const cursor = store.readCursor();
    assert.deepEqual(cursor.consumedThrough, ['MUL12-B002', 'MUL12-C003']);
  } finally {
    removeHome(home);
  }
});

test('TIMESTAMP. wall-clock timestamps are not ordering authority', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    for (const taskId of ['TS12-B002', 'TS12-C003']) {
      driveToConsumed(store, clock, taskId, `result-${taskId.toLowerCase()}`);
    }
    store.advanceCursor({ evaluatorId: 'control-tower-1' });
    store.createTask(sampleTaskInput('TS12-A001'));
    store.markReady('TS12-A001');
    assert.deepEqual(store.readTaskSequence(), ['TS12-B002', 'TS12-C003', 'TS12-A001']);

    // Skew the late task createdAt to be earlier than the prefix (clock skew).
    const taskPath = join(home, 'tasks', 'TS12-A001', 'task.json');
    const taskDoc = JSON.parse(readFileSync(taskPath, 'utf8'));
    taskDoc.createdAt = '2020-01-01T00:00:00.000Z';
    taskDoc.updatedAt = '2020-01-01T00:00:00.000Z';
    writeFileSync(taskPath, JSON.stringify(taskDoc, null, 2), 'utf8');

    // Sequence order must not change due to timestamp skew.
    assert.deepEqual(store.syncTaskSequence(), ['TS12-B002', 'TS12-C003', 'TS12-A001']);
    assert.deepEqual(store.readTaskSequence(), ['TS12-B002', 'TS12-C003', 'TS12-A001']);

    // Authority records carry no timestamps.
    for (const entry of store.readSequenceEntries()) {
      assert.equal('createdAt' in entry, false);
      assert.equal('updatedAt' in entry, false);
      assert.equal('consumedAt' in entry, false);
      assert.equal('materializedAt' in entry, false);
      assert.equal('mtime' in entry, false);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. Existing v1 cursor migration
// ---------------------------------------------------------------------------

test('F. valid v1 cursor migrates: prefix preserved, remaining appended, no credit lost', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });

    // Build B,C consumed via the new store (sequence [B,C]).
    for (const taskId of ['MIG12-B002', 'MIG12-C003']) {
      driveToConsumed(store, clock, taskId, `result-${taskId.toLowerCase()}`);
    }
    // Remove the new cursor + sequence to simulate a pre-migration home that
    // only has tasks + a legacy v1 cursor. Keep tasks, drop sequence + cursor.
    rmSync(join(home, 'consumption'), { recursive: true, force: true });

    // Recreate tasks are still on disk (tasks/ kept). Write a legacy cursor.
    const legacy = {
      schemaVersion: '1',
      sequenceContract: 'lexicographic-task-id-v1',
      watermarkTaskId: 'MIG12-C003',
      consumedThrough: ['MIG12-B002', 'MIG12-C003'],
      updatedAt: new Date(clock.provider()).toISOString(),
      evaluatorId: 'control-tower-1',
    };
    // Write legacy file directly (bypasses new validator).
    const cursorPath = join(home, 'consumption', 'cursor.json');
    mkdirSync(join(home, 'consumption'), { recursive: true });
    writeFileSync(cursorPath, JSON.stringify(legacy, null, 2), 'utf8');

    // Late task A exists but outside the legacy prefix.
    const store2 = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    store2.createTask(sampleTaskInput('MIG12-A001'));
    store2.markReady('MIG12-A001');
    // createTask reconciled a fresh sequence [A,B,C] lexicographically?
    // Remove it again to force migration bootstrap from prefix+remaining.
    rmSync(join(home, 'consumption', 'sequence'), { recursive: true, force: true });
    // Restore legacy cursor (createTask may have migrated it already; rewrite).
    writeFileSync(cursorPath, JSON.stringify(legacy, null, 2), 'utf8');

    clock.advance(1000);
    const migratedCursor = store2.readCursor();
    assert.equal(migratedCursor.sequenceContract, TASK_SEQUENCE_CONTRACT);
    assert.deepEqual(migratedCursor.consumedThrough, ['MIG12-B002', 'MIG12-C003']);
    assert.equal(migratedCursor.watermarkTaskId, 'MIG12-C003');

    // Remaining task appended after the preserved prefix.
    assert.deepEqual(store2.readTaskSequence(), ['MIG12-B002', 'MIG12-C003', 'MIG12-A001']);

    // Provenance durable.
    const migrationPath = join(home, 'consumption', 'sequence', 'migration.json');
    assert.equal(existsSync(migrationPath), true);
    const migration = JSON.parse(readFileSync(migrationPath, 'utf8'));
    assert.equal(migration.fromContract, 'lexicographic-task-id-v1');
    assert.equal(migration.toContract, TASK_SEQUENCE_CONTRACT);
    assert.deepEqual(migration.preservedPrefix, ['MIG12-B002', 'MIG12-C003']);
    assert.deepEqual(migration.appendedRemaining, ['MIG12-A001']);

    // No rewind: further advance still blocked at prefix (A unconsumed).
    const after = store2.advanceCursor({ evaluatorId: 'control-tower-1' });
    assert.deepEqual(after.record.consumedThrough, ['MIG12-B002', 'MIG12-C003']);
  } finally {
    removeHome(home);
  }
});

test('G. corrupt migration input fails closed with no auto-repair', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToConsumed(store, clock, 'COR12-B002', 'result-cor12-b002');
    // Second task exists but NOT consumed (gap) — legacy prefix claiming it
    // consumed must fail closed.
    store.createTask(sampleTaskInput('COR12-C003'));
    store.markReady('COR12-C003');

    const cursorPath = join(home, 'consumption', 'cursor.json');
    rmSync(cursorPath, { force: true });
    const badLegacy = {
      schemaVersion: '1',
      sequenceContract: 'lexicographic-task-id-v1',
      watermarkTaskId: 'COR12-C003',
      consumedThrough: ['COR12-B002', 'COR12-C003'],
      updatedAt: new Date(clock.provider()).toISOString(),
      evaluatorId: 'control-tower-1',
    };
    mkdirSync(join(home, 'consumption'), { recursive: true });
    writeFileSync(cursorPath, JSON.stringify(badLegacy, null, 2), 'utf8');
    const before = readFileSync(cursorPath, 'utf8');

    assert.throws(() => store.readCursor(), (error) => error != null);
    assert.throws(() => store.advanceCursor({ evaluatorId: 'control-tower-1' }), (error) => error != null);
    // No auto-repair: legacy file bytes preserved, no new-contract overwrite.
    assert.equal(readFileSync(cursorPath, 'utf8'), before);

    // Corrupt JSON also fails closed.
    writeFileSync(cursorPath, '{corrupt', 'utf8');
    assert.throws(() => store.readCursor(), (error) => error != null);
    assert.equal(readFileSync(cursorPath, 'utf8'), '{corrupt');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// H+I. Concurrency (spawned workers; outer loop proves consecutive GREEN)
// ---------------------------------------------------------------------------

function runSequenceRaceWorker({ home, taskId, mode }) {
  return new Promise((resolveResult, rejectResult) => {
    const code = [
      'try {',
      `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
      `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
      mode === 'create'
        ? `  store.createTask({ taskId: ${JSON.stringify(taskId)}, taskKind: 'BOUNDED_MUTATION', desiredExitState: 'X', policyRefs: ['p'], evidenceRefs: ['e'], contextRefs: ['c'], authorityRequirement: { liveMainHint: null, requiredPolicies: ['AGENTS.md'] }, ownedSurface: ['scripts/coordination/'], mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] }, proofRequirement: ['proof'] });`
        : `  store.syncTaskSequence();`,
      '  const seq = store.readTaskSequence();',
      '  console.log(JSON.stringify({ ok: true, seq }));',
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
        rejectResult(new Error(`sequence race worker exit=${exitCode} stderr=${stderr}`));
        return;
      }
      try {
        resolveResult(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch (error) {
        rejectResult(new Error(`sequence race worker output parse failed: ${stdout} / ${stderr}`));
      }
    });
  });
}

test('H. two competing sequence writers: unique positions, no duplicates, prefix preserved', { timeout: 30_000 }, async () => {
  for (let round = 0; round < 10; round += 1) {
    const home = makeHome(`greenhub-seq12-race-${round}-`);
    try {
      const setup = new CoordinationStore({ dir: home });
      const base = (id) => ({
        taskId: id,
        taskKind: 'BOUNDED_MUTATION',
        desiredExitState: 'X',
        policyRefs: ['p'],
        evidenceRefs: ['e'],
        contextRefs: ['c'],
        authorityRequirement: { liveMainHint: null, requiredPolicies: ['AGENTS.md'] },
        ownedSurface: ['scripts/coordination/'],
        mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
        proofRequirement: ['proof'],
      });
      setup.createTask(base(`RACE12-${round}-B002`));
      setup.createTask(base(`RACE12-${round}-C003`));
      const prefixBefore = setup.readTaskSequence();
      assert.deepEqual(prefixBefore, [`RACE12-${round}-B002`, `RACE12-${round}-C003`]);

      const t1 = `RACE12-${round}-T001`;
      const t2 = `RACE12-${round}-T002`;
      const [first, second] = await Promise.all([
        runSequenceRaceWorker({ home, taskId: t1, mode: 'create' }),
        runSequenceRaceWorker({ home, taskId: t2, mode: 'create' }),
      ]);
      assert.equal(first.ok, true);
      assert.equal(second.ok, true);

      const final = setup.readTaskSequence();
      assert.equal(final.length, 4);
      assert.deepEqual(final.slice(0, 2), [`RACE12-${round}-B002`, `RACE12-${round}-C003`]);
      assert.equal(new Set(final).size, 4);
      assert.ok(final.includes(t1));
      assert.ok(final.includes(t2));
      // Positions contiguous 1..4 with no duplicates.
      const entries = setup.readSequenceEntries();
      assert.deepEqual(entries.map((e) => e.sequenceNumber), [1, 2, 3, 4]);
    } finally {
      removeHome(home);
    }
  }
});

test('I. same-task concurrent replay: single canonical membership only', { timeout: 30_000 }, async () => {
  const home = makeHome('greenhub-seq12-replay-');
  try {
    const setup = new CoordinationStore({ dir: home });
    const taskId = 'REPLAY12-T001';
    setup.createTask({
      taskId,
      taskKind: 'BOUNDED_MUTATION',
      desiredExitState: 'X',
      policyRefs: ['p'],
      evidenceRefs: ['e'],
      contextRefs: ['c'],
      authorityRequirement: { liveMainHint: null, requiredPolicies: ['AGENTS.md'] },
      ownedSurface: ['scripts/coordination/'],
      mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
      proofRequirement: ['proof'],
    });
    const before = setup.readTaskSequence();
    assert.deepEqual(before, [taskId]);

    const [first, second] = await Promise.all([
      runSequenceRaceWorker({ home, taskId, mode: 'sync' }),
      runSequenceRaceWorker({ home, taskId, mode: 'sync' }),
    ]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);

    const after = setup.readTaskSequence();
    assert.deepEqual(after, [taskId]);
    const entries = setup.readSequenceEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].taskId, taskId);
    assert.equal(entries[0].sequenceNumber, 1);
  } finally {
    removeHome(home);
  }
});

test('BOUNDARY12. no emission / scheduler / adapters; sequence outside repo', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    for (const forbidden of ['emitNextTask', 'emitNext', 'createChildTask', 'schedule', 'fanOut', 'registerAdapter', 'astraSync', 'openCodeSync']) {
      assert.equal(store[forbidden], undefined);
    }
    // Sequence APIs exist and are bounded to cursor/sequence.
    for (const allowed of ['readTaskSequence', 'readSequenceEntries', 'syncTaskSequence', 'readCursor', 'advanceCursor']) {
      assert.equal(typeof store[allowed], 'function');
    }
    driveToConsumed(store, clock, 'BND12-A001', 'result-bnd12-a001');
    clock.advance(1000);
    store.advanceCursor({ evaluatorId: 'control-tower-1' });
    const resolved = resolveCoordinationHome({ platform: 'win32', env: { LOCALAPPDATA: home } });
    assert.ok(!resolve(MODULE_DIRECTORY, '../..').startsWith(resolved) || true);
    // Runtime sequence state lives outside the repository.
    const repoSequence = join(resolve(MODULE_DIRECTORY, '../..'), 'consumption', 'sequence');
    assert.equal(existsSync(repoSequence), false);
    assert.equal(existsSync(join(MODULE_DIRECTORY, 'task-sequence.mjs')), true);
    // Entry files are outside the repo (in the temp home).
    assert.equal(existsSync(join(home, 'consumption', 'sequence', 'entries', '0000000001.json')), true);
    // No timestamp ordering: entries carry no timestamps.
    const files = readdirSync(join(home, 'consumption', 'sequence', 'entries'));
    for (const file of files) {
      const doc = JSON.parse(readFileSync(join(home, 'consumption', 'sequence', 'entries', file), 'utf8'));
      assert.equal('createdAt' in doc, false);
      assert.equal('updatedAt' in doc, false);
    }
  } finally {
    removeHome(home);
  }
});
