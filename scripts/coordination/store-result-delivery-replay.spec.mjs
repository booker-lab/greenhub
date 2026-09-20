// Proof for COORD-AUDIT-C01: interrupted result delivery crash recovery and
// exact replay convergence in CoordinationStore.deliverResult.
//
// Contract under test:
//   - stored per-id / canonical Result bytes are never rewritten, deleted, or
//     regenerated (first-winner authority preserved),
//   - an exact semantic replay of a stored result converges the missing
//     canonical and terminal steps without re-invoking any executor,
//   - the replay identity covers the full semantic payload (proofRefs,
//     evidenceRefs, frictionObserved, usage, and an explicitly authored
//     deliveredAt); a different payload for the same resultId fails closed
//     with DUPLICATE_RESULT_ID_CONFLICT,
//   - live claim fencing is preserved for fresh delivery and for per-id-only
//     convergence; canonical-existing convergence repairs only the lagging
//     terminal task projection of an already-won delivery.
// No scheduler, daemon, polling, retry worker, executor invocation, new
// durable namespace, or new durable file exists here. All runtime state lives
// in isolated temp directories; the repository worktree is never used.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CoordinationStore } from './store.mjs';
import {
  RESULT_SCHEMA_VERSION,
  TASK_STATUS_CLAIMED,
  TASK_STATUS_RESULT_DELIVERED,
  validateResultEnvelope,
} from './task-envelope.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const STORE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'store.mjs')).href;

const BASE_USAGE = Object.freeze({
  provider: 'none',
  model: 'none',
  inputTokens: 'UNKNOWN',
  outputTokens: 'UNKNOWN',
});

function makeHome(prefix = 'greenhub-result-replay-c01-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
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

function sampleTaskInput(taskId) {
  return {
    taskId,
    taskKind: 'READ_ONLY',
    desiredExitState: 'RESULT_DELIVERED',
    policyRefs: ['docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md'],
    evidenceRefs: ['git:live-main-read'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: { liveMainHint: null, requiredPolicies: ['AGENTS.md'] },
    ownedSurface: ['scripts/coordination/'],
    mutationBoundary: { allowsWrite: false, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['durable-read', 'atomic-claim'],
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
    summary: 'bounded read-only probe completed',
    proofRefs: ['store:read-back'],
    evidenceRefs: ['test:temp-home'],
    frictionObserved: ['NONE'],
    ...overrides,
  };
}

function taskPath(home, taskId) {
  return join(home, 'tasks', taskId, 'task.json');
}

function claimPath(home, taskId) {
  return join(home, 'tasks', taskId, 'claim.json');
}

function resultPath(home, taskId) {
  return join(home, 'tasks', taskId, 'result.json');
}

function perIdPath(home, taskId, resultId) {
  return join(home, 'tasks', taskId, 'results', `${resultId}.json`);
}

/** Byte snapshot of every file under the coordination home (write-amplification guard). */
function snapshotTree(home) {
  const entries = {};
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        entries[full.slice(home.length)] = readFileSync(full, 'utf8');
      }
    }
  };
  walk(home);
  return entries;
}

function driveToClaimed(store, taskId, workerId = 'worker-a', leaseDurationMs = 60_000) {
  store.createTask(sampleTaskInput(taskId));
  store.markReady(taskId);
  return store.claimTask({ taskId, workerId, leaseDurationMs });
}

/** Deterministic interrupted-state fixture: only the per-id record was published. */
function writeInterruptedPerIdResult(home, store, claim, overrides = {}) {
  const record = validateResultEnvelope({
    schemaVersion: RESULT_SCHEMA_VERSION,
    resultId: 'result-0001',
    taskId: claim.taskId,
    workerId: claim.workerId,
    claimToken: claim.claimToken,
    claimGeneration: claim.generation,
    status: 'SUCCEEDED',
    summary: 'bounded read-only probe completed',
    proofRefs: ['store:read-back'],
    evidenceRefs: ['test:temp-home'],
    frictionObserved: ['NONE'],
    deliveredAt: store.nowIso(),
    ...overrides,
  });
  const path = perIdPath(home, claim.taskId, record.resultId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(record, null, 2), 'utf8');
  return record;
}

// ---------------------------------------------------------------------------
// T1. FIRST DELIVERY.
// ---------------------------------------------------------------------------

test('T1. first delivery keeps the existing lifecycle (per-id + canonical + RESULT_DELIVERED)', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const claim = driveToClaimed(store, 'C01T1');
    const delivered = store.deliverResult(sampleResult(claim, { resultId: 'result-c01-t1' }));

    assert.equal(delivered.duplicate, false);
    assert.equal(delivered.alreadyDelivered, false);
    assert.equal(delivered.record.resultId, 'result-c01-t1');
    assert.equal(store.readTask('C01T1').status, TASK_STATUS_RESULT_DELIVERED);
    assert.deepEqual(
      JSON.parse(readFileSync(resultPath(home, 'C01T1'), 'utf8')),
      { ...delivered.record },
    );
    assert.deepEqual(
      JSON.parse(readFileSync(perIdPath(home, 'C01T1', 'result-c01-t1'), 'utf8')),
      { ...delivered.record },
    );
    assert.deepEqual(store.readResult('C01T1'), delivered.record);
    assert.deepEqual(store.readResultById('C01T1', 'result-c01-t1'), delivered.record);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// T2/R1. PER-ID-ONLY INTERRUPTION.
// ---------------------------------------------------------------------------

test('T2/R1. per-id-only interruption: exact replay publishes canonical + RESULT_DELIVERED from stored authority', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const claim = driveToClaimed(store, 'C01T2');
    const stored = writeInterruptedPerIdResult(home, store, claim, { resultId: 'result-c01-t2' });
    const storedBytes = readFileSync(perIdPath(home, 'C01T2', 'result-c01-t2'), 'utf8');
    assert.throws(() => store.readResult('C01T2'), (error) => error?.code === 'RESULT_NOT_FOUND');

    // Replay arrives later (clock moved) through a fresh store instance.
    clock.advance(3_600_000);
    const reopened = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const replay = reopened.deliverResult(sampleResult(claim, { resultId: 'result-c01-t2' }));

    assert.equal(replay.duplicate, true);
    assert.equal(replay.alreadyDelivered, false);
    assert.deepEqual({ ...replay.record }, { ...stored });
    assert.equal(readFileSync(perIdPath(home, 'C01T2', 'result-c01-t2'), 'utf8'), storedBytes);
    assert.deepEqual(JSON.parse(readFileSync(resultPath(home, 'C01T2'), 'utf8')), { ...stored });
    assert.deepEqual(reopened.readResult('C01T2'), stored);
    assert.equal(reopened.readTask('C01T2').status, TASK_STATUS_RESULT_DELIVERED);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// T3/R2. CANONICAL-WITHOUT-TERMINAL INTERRUPTION.
// ---------------------------------------------------------------------------

test('T3/R2. canonical-without-terminal interruption: exact replay converges RESULT_DELIVERED with zero byte change', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const claim = driveToClaimed(store, 'C01T3');
    const first = store.deliverResult(sampleResult(claim, { resultId: 'result-c01-t3' }));

    // Simulate a crash between canonical result publication and the terminal task write.
    const task = JSON.parse(readFileSync(taskPath(home, 'C01T3'), 'utf8'));
    writeFileSync(
      taskPath(home, 'C01T3'),
      JSON.stringify({ ...task, status: TASK_STATUS_CLAIMED }, null, 2),
      'utf8',
    );
    const canonicalBytes = readFileSync(resultPath(home, 'C01T3'), 'utf8');
    const perIdBytes = readFileSync(perIdPath(home, 'C01T3', 'result-c01-t3'), 'utf8');
    const claimBytes = readFileSync(claimPath(home, 'C01T3'), 'utf8');

    clock.advance(3_600_000);
    const replay = store.deliverResult(sampleResult(claim, { resultId: 'result-c01-t3' }));

    assert.equal(replay.duplicate, true);
    assert.equal(replay.alreadyDelivered, false);
    assert.deepEqual({ ...replay.record }, { ...first.record });
    assert.equal(readFileSync(resultPath(home, 'C01T3'), 'utf8'), canonicalBytes);
    assert.equal(readFileSync(perIdPath(home, 'C01T3', 'result-c01-t3'), 'utf8'), perIdBytes);
    assert.equal(readFileSync(claimPath(home, 'C01T3'), 'utf8'), claimBytes);
    assert.equal(store.readTask('C01T3').status, TASK_STATUS_RESULT_DELIVERED);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// T4. EXACT REPLAY AFTER COMPLETED DELIVERY.
// ---------------------------------------------------------------------------

test('T4. exact replay after completed delivery performs zero writes and preserves all bytes', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const claim = driveToClaimed(store, 'C01T4');
    store.deliverResult(sampleResult(claim, { resultId: 'result-c01-t4' }));
    const before = snapshotTree(home);

    clock.advance(3_600_000);
    const replay = store.deliverResult(sampleResult(claim, { resultId: 'result-c01-t4' }));

    assert.equal(replay.duplicate, true);
    assert.equal(replay.alreadyDelivered, true);
    assert.deepEqual(snapshotTree(home), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// R3 + T5-T9. SEMANTIC PAYLOAD MISMATCH.
// ---------------------------------------------------------------------------

test('R3/T5-T9. semantic payload mismatch against a stored per-id result fails closed and never converges', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const claim = driveToClaimed(store, 'C01T5');
    writeInterruptedPerIdResult(home, store, claim, { resultId: 'result-c01-t5', usage: BASE_USAGE });
    const storedBytes = readFileSync(perIdPath(home, 'C01T5', 'result-c01-t5'), 'utf8');

    const mutations = [
      ['summary', { summary: 'different summary' }],
      ['proofRefs', { proofRefs: ['store:other-proof'] }],
      ['evidenceRefs', { evidenceRefs: ['test:other-evidence'] }],
      ['frictionObserved', { frictionObserved: ['CHANGED'] }],
      ['usage', { usage: { ...BASE_USAGE, inputTokens: 7 } }],
      ['status', { status: 'FAILED' }],
      ['deliveredAt', { deliveredAt: '2001-01-01T00:00:00.000Z' }],
    ];
    for (const [label, override] of mutations) {
      assert.throws(
        () =>
          store.deliverResult(
            sampleResult(claim, { resultId: 'result-c01-t5', usage: BASE_USAGE, ...override }),
          ),
        (error) => {
          assert.equal(error?.code, 'DUPLICATE_RESULT_ID_CONFLICT', label);
          return true;
        },
        label,
      );
      // Fail-closed: the interruption state is untouched and never converges.
      assert.throws(() => store.readResult('C01T5'), (error) => error?.code === 'RESULT_NOT_FOUND');
      assert.equal(store.readTask('C01T5').status, TASK_STATUS_CLAIMED);
      assert.equal(readFileSync(perIdPath(home, 'C01T5', 'result-c01-t5'), 'utf8'), storedBytes);
    }
  } finally {
    removeHome(home);
  }
});

test('T5b. same resultId with a changed payload after canonical delivery is a conflict, not a replay', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const claim = driveToClaimed(store, 'C01T5B');
    store.deliverResult(sampleResult(claim, { resultId: 'result-c01-t5b', usage: BASE_USAGE }));
    const before = snapshotTree(home);

    for (const override of [
      { summary: 'different summary' },
      { proofRefs: ['store:other-proof'] },
      { evidenceRefs: ['test:other-evidence'] },
      { frictionObserved: ['CHANGED'] },
      { usage: { ...BASE_USAGE, outputTokens: 7 } },
      { deliveredAt: '2001-01-01T00:00:00.000Z' },
    ]) {
      assert.throws(
        () =>
          store.deliverResult(
            sampleResult(claim, { resultId: 'result-c01-t5b', usage: BASE_USAGE, ...override }),
          ),
        (error) => error?.code === 'DUPLICATE_RESULT_ID_CONFLICT',
      );
    }
    assert.deepEqual(snapshotTree(home), before);
    assert.equal(store.readResult('C01T5B').summary, 'bounded read-only probe completed');
  } finally {
    removeHome(home);
  }
});

test('T9. usage presence is part of the replay identity in both directions', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const claim = driveToClaimed(store, 'C01T9');
    writeInterruptedPerIdResult(home, store, claim, { resultId: 'result-c01-t9' });
    const storedBytes = readFileSync(perIdPath(home, 'C01T9', 'result-c01-t9'), 'utf8');

    // Stored record has no usage: a replay that fabricates usage is a conflict.
    assert.throws(
      () => store.deliverResult(sampleResult(claim, { resultId: 'result-c01-t9', usage: BASE_USAGE })),
      (error) => error?.code === 'DUPLICATE_RESULT_ID_CONFLICT',
    );
    assert.equal(readFileSync(perIdPath(home, 'C01T9', 'result-c01-t9'), 'utf8'), storedBytes);

    // Exact replay (no usage on either side) still converges.
    const replay = store.deliverResult(sampleResult(claim, { resultId: 'result-c01-t9' }));
    assert.equal(replay.duplicate, true);
    assert.equal(replay.record.usage, undefined);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// T10. FIRST-WINNER AUTHORITY.
// ---------------------------------------------------------------------------

test('T10. a different resultId after the canonical winner preserves first-winner authority', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const claim = driveToClaimed(store, 'C01T10');
    store.deliverResult(sampleResult(claim, { resultId: 'result-c01-t10-a' }));
    const before = snapshotTree(home);

    const late = store.deliverResult(
      sampleResult(claim, { resultId: 'result-c01-t10-b', summary: 'late second result' }),
    );

    assert.equal(late.duplicate, false);
    assert.equal(late.alreadyDelivered, true);
    assert.equal(late.record.resultId, 'result-c01-t10-a');
    assert.deepEqual(snapshotTree(home), before);
    assert.equal(store.readResult('C01T10').resultId, 'result-c01-t10-a');
    assert.equal(store.readResult('C01T10').summary, 'bounded read-only probe completed');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// T11. FENCING.
// ---------------------------------------------------------------------------

test('T11. stale claim fencing is preserved for fresh delivery and for per-id-only convergence', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const claim = driveToClaimed(store, 'C01T11', 'worker-a', 5_000);
    writeInterruptedPerIdResult(home, store, claim, { resultId: 'result-c01-t11' });
    const perIdBytes = readFileSync(perIdPath(home, 'C01T11', 'result-c01-t11'), 'utf8');

    clock.advance(6_000);
    const takeover = store.claimTask({ taskId: 'C01T11', workerId: 'worker-b', leaseDurationMs: 60_000 });
    assert.equal(takeover.generation, 2);

    // Fresh stale delivery is refused before any write.
    assert.throws(
      () => store.deliverResult(sampleResult(claim, { resultId: 'result-c01-t11-stale' })),
      (error) => error?.code === 'STALE_CLAIM',
    );
    // Exact replay of the pre-takeover stored result must not converge the task.
    assert.throws(
      () => store.deliverResult(sampleResult(claim, { resultId: 'result-c01-t11' })),
      (error) => error?.code === 'STALE_CLAIM',
    );

    assert.throws(() => store.readResult('C01T11'), (error) => error?.code === 'RESULT_NOT_FOUND');
    assert.equal(store.readTask('C01T11').status, TASK_STATUS_CLAIMED);
    assert.equal(readFileSync(perIdPath(home, 'C01T11', 'result-c01-t11'), 'utf8'), perIdBytes);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// T12. DUPLICATE DELIVERY CONVERGENCE.
// ---------------------------------------------------------------------------

test('T12. duplicate deliveries converge to one stored winner without byte churn', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const claim = driveToClaimed(store, 'C01T12');
    const stored = writeInterruptedPerIdResult(home, store, claim, { resultId: 'result-c01-t12' });

    const first = store.deliverResult(sampleResult(claim, { resultId: 'result-c01-t12' }));
    assert.equal(first.duplicate, true);
    const afterFirst = snapshotTree(home);

    const second = store.deliverResult(sampleResult(claim, { resultId: 'result-c01-t12' }));
    assert.equal(second.duplicate, true);
    assert.equal(second.alreadyDelivered, true);
    assert.deepEqual({ ...second.record }, { ...stored });
    assert.deepEqual(snapshotTree(home), afterFirst);
    assert.equal(store.readTask('C01T12').status, TASK_STATUS_RESULT_DELIVERED);
  } finally {
    removeHome(home);
  }
});

/** Child-process worker: one real concurrent duplicate delivery attempt. */
function runDuplicateDeliveryWorker({ home, payload }) {
  return new Promise((resolveResult, rejectResult) => {
    const code = [
      'try {',
      `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
      `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
      `  const delivered = store.deliverResult(${JSON.stringify(payload)});`,
      '  console.log(JSON.stringify({ ok: true, duplicate: delivered.duplicate, alreadyDelivered: delivered.alreadyDelivered, resultId: delivered.record.resultId }));',
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
        rejectResult(new Error(`delivery worker exited ${exitCode}: ${stderr}`));
        return;
      }
      resolveResult(JSON.parse(stdout.trim().split('\n').pop()));
    });
  });
}

test('T12b. concurrent duplicate deliveries elect exactly one stored winner and converge', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const claim = driveToClaimed(store, 'C01T12B');
    const payload = sampleResult(claim, { resultId: 'result-c01-t12b' });

    const outcomes = await Promise.all([
      runDuplicateDeliveryWorker({ home, payload }),
      runDuplicateDeliveryWorker({ home, payload }),
      runDuplicateDeliveryWorker({ home, payload }),
      runDuplicateDeliveryWorker({ home, payload }),
    ]);

    for (const outcome of outcomes) {
      assert.equal(outcome.ok, true, JSON.stringify(outcome));
      assert.equal(outcome.resultId, 'result-c01-t12b');
    }
    assert.equal(outcomes.filter((outcome) => outcome.duplicate === false).length, 1);

    const reopened = new CoordinationStore({ dir: home });
    assert.equal(reopened.readTask('C01T12B').status, TASK_STATUS_RESULT_DELIVERED);
    const canonical = reopened.readResult('C01T12B');
    const perId = reopened.readResultById('C01T12B', 'result-c01-t12b');
    assert.deepEqual({ ...canonical }, { ...perId });
    assert.equal(
      readFileSync(resultPath(home, 'C01T12B'), 'utf8'),
      readFileSync(perIdPath(home, 'C01T12B', 'result-c01-t12b'), 'utf8'),
    );
  } finally {
    removeHome(home);
  }
});
