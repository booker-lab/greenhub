// Proof for COORD-AUDIT-C02: expired claim takeover concurrency safety.
//
// Contract under proof:
//   C1  exactly one authoritative takeover winner among concurrent contenders
//   C2  a contender that observed generation N can never delete a replacement
//       of generation N+1 (or later)
//   C3  canonical claim generation is monotonic across takeover (including the
//       crash window between the old-claim removal and the replacement create)
//   C4  a success return matches the durable canonical claim at return time
//   C5  the deterministic loser outcome stays LEASE_ACTIVE
//   C6  stale-claim result fencing is preserved (old token/generation)
//   C7  RESULT_DELIVERED tasks never gain a new claim/takeover
//
// The race window is placed deterministically with a child-process barrier:
// each child preloads a module that wraps `fs.unlinkSync` for the task's
// claim.json and blocks the takeover's delete step until the parent releases
// it. The parent drives the exact interleaving:
//   both contenders complete their re-read -> A deletes + recreates -> A
//   finishes -> B is released against a claim that has already been replaced.
// The barrier is test-only and never part of the store implementation.
//
// All runtime state lives in isolated temp directories. No network required.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CORRUPT_CLAIM_TAKEOVER_LOCK, CoordinationStore } from './store.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const STORE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'store.mjs')).href;

const TAKEOVER_LOCK_FILE_NAME = 'claim.takeover.lock';
const TAKEOVER_LOCK_SCHEMA_VERSION = 1;

function makeHome(prefix = 'greenhub-c02-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'EXPIRED_CLAIM_TAKEOVER_RACE_SAFE',
    policyRefs: ['docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md'],
    evidenceRefs: ['git:live-main-read'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: { liveMainHint: null, requiredPolicies: ['AGENTS.md'] },
    ownedSurface: ['scripts/coordination/'],
    mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['deterministic-takeover-race-proof'],
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

function claimPath(home, taskId) {
  return join(home, 'tasks', taskId, 'claim.json');
}

function takeoverLockPath(home, taskId) {
  return join(home, 'tasks', taskId, TAKEOVER_LOCK_FILE_NAME);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sampleResult(claim, overrides = {}) {
  return {
    taskId: claim.taskId,
    resultId: 'result-0001',
    workerId: claim.workerId,
    claimToken: claim.claimToken,
    claimGeneration: claim.generation,
    status: 'SUCCEEDED',
    summary: 'bounded takeover probe completed',
    proofRefs: ['store:read-back'],
    evidenceRefs: ['test:temp-home'],
    frictionObserved: ['NONE'],
    ...overrides,
  };
}

function driveToExpiredClaim(store, clock, taskId, { leaseDurationMs = 1_000, workerId = 'gen1-owner' } = {}) {
  store.createTask(sampleTaskInput(taskId));
  store.markReady(taskId);
  const claim = store.claimTask({ taskId, workerId, leaseDurationMs });
  assert.equal(claim.generation, 1);
  clock.advance(leaseDurationMs + 1_000);
  return claim;
}

function assertNoResidualTakeoverLock(home, taskId) {
  assert.equal(
    existsSync(takeoverLockPath(home, taskId)),
    false,
    'no takeover lock may remain after a completed claim operation',
  );
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForFile(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (existsSync(path)) return true;
    if (Date.now() >= deadline) return false;
    await delay(5);
  }
}

/**
 * Test-only child preload: wrap fs.unlinkSync so the takeover delete of the
 * exact claim.json parks the child until the parent publishes `go-<label>`.
 * This places the contender at the precise "re-read complete, delete pending"
 * boundary the race needs; no timing/sleep assumption is involved.
 */
function writeBarrierPreload(home) {
  const preloadPath = join(home, 'c02-unlink-barrier-preload.mjs');
  const lines = [
    "import fs from 'node:fs';",
    'const claimPath = process.env.GREENHUB_C02_CLAIM_PATH;',
    'const gateDir = process.env.GREENHUB_C02_GATE_DIR;',
    'const label = process.env.GREENHUB_C02_LABEL;',
    'const waitCell = new Int32Array(new SharedArrayBuffer(4));',
    'if (claimPath && gateDir && label) {',
    '  const originalUnlinkSync = fs.unlinkSync;',
    '  fs.unlinkSync = (target, ...rest) => {',
    '    if (target === claimPath) {',
    '      fs.writeFileSync(`${gateDir}/arrived-${label}`, "arrived", "utf8");',
    '      const deadline = Date.now() + 30000;',
    '      while (!fs.existsSync(`${gateDir}/go-${label}`) && Date.now() < deadline) {',
    '        Atomics.wait(waitCell, 0, 0, 5);',
    '      }',
    '    }',
    '    return originalUnlinkSync(target, ...rest);',
    '  };',
    '}',
  ];
  writeFileSync(preloadPath, lines.join('\n'), 'utf8');
  return pathToFileURL(preloadPath).href;
}

/**
 * Spawn one real OS process running a single claimTask() takeover attempt.
 * Returns { label, exitPromise, child }; exitPromise resolves to the parsed
 * worker outcome.
 */
function spawnClaimChild({ home, taskId, workerId, nowMs, claimPath: childClaimPath, gateDir, preloadUrl }) {
  const code = [
    'try {',
    `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
    `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
    `  const claim = store.claimTask({ taskId: ${JSON.stringify(taskId)}, workerId: ${JSON.stringify(workerId)}, leaseDurationMs: 60000, nowMs: ${JSON.stringify(nowMs)} });`,
    '  console.log(JSON.stringify({ ok: true, workerId: claim.workerId, token: claim.claimToken, generation: claim.generation }));',
    '} catch (error) {',
    '  console.log(JSON.stringify({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error) }));',
    '}',
  ].join('\n');
  const child = spawn(process.execPath, ['--import', preloadUrl, '--input-type=module', '-e', code], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      GREENHUB_C02_CLAIM_PATH: childClaimPath,
      GREENHUB_C02_GATE_DIR: gateDir,
      GREENHUB_C02_LABEL: workerId,
    },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exitPromise = new Promise((resolveResult, rejectResult) => {
    child.once('error', rejectResult);
    child.once('close', (exitCode) => {
      if (exitCode !== 0) {
        rejectResult(new Error(`claim child ${workerId} exit=${exitCode} stderr=${stderr}`));
        return;
      }
      try {
        resolveResult({ label: workerId, ...JSON.parse(stdout.trim().split('\n').at(-1)) });
      } catch (error) {
        rejectResult(new Error(`claim child ${workerId} output parse failed: ${stdout} / ${stderr}`));
      }
    });
  });
  return { label: workerId, child, exitPromise };
}

function releaseGate(gateDir, label) {
  writeFileSync(join(gateDir, `go-${label}`), 'go', 'utf8');
}

// ---------------------------------------------------------------------------
// T1. READY first claim: generation 1, authority read-back, no residual lock.
// ---------------------------------------------------------------------------

test('T1. READY first claim keeps generation 1 and matches durable authority', () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    store.createTask(sampleTaskInput('C02T01'));
    store.markReady('C02T01');
    const claim = store.claimTask({ taskId: 'C02T01', workerId: 'worker-a', leaseDurationMs: 60_000 });
    assert.equal(claim.generation, 1);
    assert.deepEqual(store.readClaim('C02T01'), claim);
    assertNoResidualTakeoverLock(home, 'C02T01');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// T2. Active lease: a concurrent claimant loses with LEASE_ACTIVE.
// ---------------------------------------------------------------------------

test('T2. active lease concurrent claimant loses with LEASE_ACTIVE and no bytes change', () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    store.createTask(sampleTaskInput('C02T02'));
    store.markReady('C02T02');
    const owner = store.claimTask({ taskId: 'C02T02', workerId: 'worker-a', leaseDurationMs: 60_000 });
    const before = readFileSync(claimPath(home, 'C02T02'), 'utf8');
    assert.throws(
      () => store.claimTask({ taskId: 'C02T02', workerId: 'worker-b', leaseDurationMs: 60_000 }),
      (error) => error?.code === 'LEASE_ACTIVE',
    );
    assert.equal(readFileSync(claimPath(home, 'C02T02'), 'utf8'), before);
    assert.deepEqual(store.readClaim('C02T02'), owner);
    assertNoResidualTakeoverLock(home, 'C02T02');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// T3/T8. Expired single takeover: generation N+1, success return is authority.
// ---------------------------------------------------------------------------

test('T3/T8. expired single takeover bumps generation and the returned claim is the canonical authority', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToExpiredClaim(store, clock, 'C02T03');
    const takeover = store.claimTask({ taskId: 'C02T03', workerId: 'worker-b', leaseDurationMs: 60_000 });
    assert.equal(takeover.generation, 2);
    assert.equal(takeover.workerId, 'worker-b');
    assert.deepEqual(store.readClaim('C02T03'), takeover);
    assert.equal(store.readTask('C02T03').status, 'CLAIMED');
    assertNoResidualTakeoverLock(home, 'C02T03');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// T4/T6. Deterministic 2-process race at the re-read -> delete boundary.
// The parent parks both contenders, lets A complete its replacement, then
// releases B (whose earlier re-read still says the old generation N).
// ---------------------------------------------------------------------------

test(
  'T4/T6. deterministic 2-process expired takeover race elects exactly one authority and preserves the replacement',
  { timeout: 120_000 },
  async () => {
    const home = makeHome('greenhub-c02-race2-');
    try {
      const clock = controllableClock();
      const setup = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
      const taskId = 'C02R2TASK01';
      const gen1 = driveToExpiredClaim(setup, clock, taskId);
      const gateDir = join(home, 'c02-barrier');
      mkdirSync(gateDir, { recursive: true });
      const preloadUrl = writeBarrierPreload(home);
      const nowMs = clock.now + 60_000;

      const a = spawnClaimChild({
        home,
        taskId,
        workerId: 'race-a',
        nowMs,
        claimPath: claimPath(home, taskId),
        gateDir,
        preloadUrl,
      });
      const b = spawnClaimChild({
        home,
        taskId,
        workerId: 'race-b',
        nowMs,
        claimPath: claimPath(home, taskId),
        gateDir,
        preloadUrl,
      });

      // Both contenders must reach the re-read -> delete boundary. On the
      // fixed implementation only the lock holder can reach the delete, so
      // race-b's arrival timeout is the correct (single-owner) schedule.
      await Promise.all([
        waitForFile(join(gateDir, 'arrived-race-a'), 5_000),
        waitForFile(join(gateDir, 'arrived-race-b'), 2_000),
      ]);

      releaseGate(gateDir, 'race-a');
      const resultA = await a.exitPromise;

      // A's replacement is durable before the stale contender is released.
      const claimAfterA = setup.readClaim(taskId);
      assert.equal(claimAfterA.workerId, 'race-a');
      assert.equal(claimAfterA.generation, gen1.generation + 1);
      assert.equal(claimAfterA.claimToken, resultA.token);

      releaseGate(gateDir, 'race-b');
      const resultB = await b.exitPromise;

      const results = [resultA, resultB];
      const winners = results.filter((result) => result.ok === true);
      const losers = results.filter((result) => result.ok !== true);
      assert.equal(
        winners.length,
        1,
        `exactly one authoritative takeover winner expected; got ${JSON.stringify(results)}`,
      );
      assert.equal(losers.length, 1);
      assert.equal(losers[0].code, 'LEASE_ACTIVE');

      const canonical = setup.readClaim(taskId);
      assert.equal(canonical.generation, gen1.generation + 1);
      assert.equal(canonical.claimToken, winners[0].token);
      assert.equal(canonical.workerId, winners[0].workerId);
      // The loser's token must never be the canonical authority.
      assert.notEqual(canonical.claimToken, losers[0].token);
      assert.deepEqual(readJson(claimPath(home, taskId)), canonical);
      assertNoResidualTakeoverLock(home, taskId);
    } finally {
      removeHome(home);
    }
  },
);

// ---------------------------------------------------------------------------
// T5. Four concurrent takeover contenders -> exactly one authoritative winner.
// Sequential release maximizes the stale-delete opportunity for every
// contender while keeping the schedule deterministic.
// ---------------------------------------------------------------------------

test(
  'T5. four concurrent takeover contenders produce a single authoritative winner',
  { timeout: 180_000 },
  async () => {
    const home = makeHome('greenhub-c02-race4-');
    try {
      const clock = controllableClock();
      const setup = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
      const taskId = 'C02R4TASK01';
      const gen1 = driveToExpiredClaim(setup, clock, taskId);
      const gateDir = join(home, 'c02-barrier');
      mkdirSync(gateDir, { recursive: true });
      const preloadUrl = writeBarrierPreload(home);
      const nowMs = clock.now + 60_000;
      const labels = ['race-a', 'race-b', 'race-c', 'race-d'];

      const contenders = labels.map((workerId) =>
        spawnClaimChild({
          home,
          taskId,
          workerId,
          nowMs,
          claimPath: claimPath(home, taskId),
          gateDir,
          preloadUrl,
        }),
      );

      await Promise.all(labels.map((label) => waitForFile(join(gateDir, `arrived-${label}`), 3_000)));

      const results = [];
      for (const contender of contenders) {
        releaseGate(gateDir, contender.label);
        results.push(await contender.exitPromise);
      }

      const winners = results.filter((result) => result.ok === true);
      const losers = results.filter((result) => result.ok !== true);
      assert.equal(
        winners.length,
        1,
        `exactly one authoritative takeover winner expected; got ${JSON.stringify(results)}`,
      );
      assert.equal(losers.length, 3);
      for (const loser of losers) assert.equal(loser.code, 'LEASE_ACTIVE');

      const canonical = setup.readClaim(taskId);
      assert.equal(canonical.generation, gen1.generation + 1);
      assert.equal(canonical.claimToken, winners[0].token);
      assert.equal(canonical.workerId, winners[0].workerId);
      for (const loser of losers) assert.notEqual(canonical.claimToken, loser.token);
      assert.deepEqual(readJson(claimPath(home, taskId)), canonical);
      assertNoResidualTakeoverLock(home, taskId);
    } finally {
      removeHome(home);
    }
  },
);

// ---------------------------------------------------------------------------
// T7. Generation monotonicity, including the crash window where a takeover
// holder died after removing the expired claim but before publishing the
// replacement. The dead lock carries the base generation, so recovery creates
// N+1, never a rewound generation 1.
// ---------------------------------------------------------------------------

function spawnDeadPid() {
  return new Promise((resolvePid, rejectPid) => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore', windowsHide: true });
    child.once('error', rejectPid);
    child.once('close', () => resolvePid(child.pid));
  });
}

async function waitForProcessDeath(pid) {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === 'ESRCH') return true;
      throw error;
    }
    if (Date.now() >= deadline) return false;
    await delay(5);
  }
}

function writeTakeoverLockRecord(home, taskId, { ownerPid, baseGeneration, baseClaimToken }) {
  writeFileSync(
    takeoverLockPath(home, taskId),
    JSON.stringify(
      {
        schemaVersion: TAKEOVER_LOCK_SCHEMA_VERSION,
        taskId,
        lockId: 'manual-dead-holder-lock',
        ownerPid,
        baseGeneration,
        baseClaimToken,
        acquiredAt: '2026-01-01T00:00:00.000Z',
      },
      null,
      2,
    ),
    'utf8',
  );
}

test(
  'T7. generation is monotonic through stale-lock recovery of the remove/replace crash window',
  { timeout: 60_000 },
  async () => {
    const home = makeHome('greenhub-c02-monotonic-');
    try {
      const clock = controllableClock();
      const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
      const taskId = 'C02T07';
      const gen1 = driveToExpiredClaim(store, clock, taskId);

      const deadPid = await spawnDeadPid();
      assert.equal(await waitForProcessDeath(deadPid), true, 'probe pid must be dead before writing the lock');
      writeTakeoverLockRecord(home, taskId, {
        ownerPid: deadPid,
        baseGeneration: gen1.generation,
        baseClaimToken: gen1.claimToken,
      });
      // Crash window: the holder removed claim.json and never published N+1.
      rmSync(claimPath(home, taskId), { force: true });

      const recovered = store.claimTask({ taskId, workerId: 'recoverer', leaseDurationMs: 60_000 });
      assert.equal(
        recovered.generation,
        gen1.generation + 1,
        'crash-window recovery must publish baseGeneration + 1, never a rewound generation',
      );
      assert.deepEqual(store.readClaim(taskId), recovered);
      assertNoResidualTakeoverLock(home, taskId);
    } finally {
      removeHome(home);
    }
  },
);

test('T7b. a stale lock over a still-present expired claim is recovered with generation N+1', async () => {
  const home = makeHome('greenhub-c02-stale-');
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const taskId = 'C02T07B';
    const gen1 = driveToExpiredClaim(store, clock, taskId);
    const deadPid = await spawnDeadPid();
    assert.equal(await waitForProcessDeath(deadPid), true);
    writeTakeoverLockRecord(home, taskId, {
      ownerPid: deadPid,
      baseGeneration: gen1.generation,
      baseClaimToken: gen1.claimToken,
    });

    const takeover = store.claimTask({ taskId, workerId: 'recoverer', leaseDurationMs: 60_000 });
    assert.equal(takeover.generation, gen1.generation + 1);
    assert.deepEqual(store.readClaim(taskId), takeover);
    assertNoResidualTakeoverLock(home, taskId);
  } finally {
    removeHome(home);
  }
});

test('T7c. a live lock is never retired even when its base is superseded', () => {
  const home = makeHome('greenhub-c02-livelock-');
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const taskId = 'C02T07C';
    const gen1 = driveToExpiredClaim(store, clock, taskId);
    // Simulate a live holder by writing this process's own pid as the owner;
    // the base (generation 0) is already superseded by the canonical claim.
    writeTakeoverLockRecord(home, taskId, {
      ownerPid: process.pid,
      baseGeneration: 0,
      baseClaimToken: null,
    });
    const before = readFileSync(claimPath(home, taskId), 'utf8');

    assert.throws(
      () => store.claimTask({ taskId, workerId: 'loser', leaseDurationMs: 60_000 }),
      (error) => error?.code === 'LEASE_ACTIVE',
    );
    // The lock-holder-protected claim is never deleted by the loser.
    assert.equal(readFileSync(claimPath(home, taskId), 'utf8'), before);
    assert.deepEqual(store.readClaim(taskId), gen1);
    // The live lock itself is never retired by the loser either.
    assert.equal(existsSync(takeoverLockPath(home, taskId)), true);
    // Cleanup the injected lock.
    rmSync(takeoverLockPath(home, taskId), { force: true });
  } finally {
    removeHome(home);
  }
});

test('T7d. a corrupt takeover lock fails closed without mutating the claim', () => {
  const home = makeHome('greenhub-c02-corruptlock-');
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const taskId = 'C02T07D';
    driveToExpiredClaim(store, clock, taskId);
    writeFileSync(takeoverLockPath(home, taskId), '{not-json', 'utf8');
    const before = readFileSync(claimPath(home, taskId), 'utf8');

    assert.throws(
      () => store.claimTask({ taskId, workerId: 'worker-b', leaseDurationMs: 60_000 }),
      (error) => error?.code === CORRUPT_CLAIM_TAKEOVER_LOCK,
    );
    assert.equal(readFileSync(claimPath(home, taskId), 'utf8'), before);
    assert.deepEqual(store.readClaim(taskId).generation, 1);
  } finally {
    removeHome(home);
  }
});

test('T7e. a dead-owner lock with a superseded base is retired and takeover proceeds monotonically', async () => {
  const home = makeHome('greenhub-c02-obsoletelock-');
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const taskId = 'C02T07E';
    const gen1 = driveToExpiredClaim(store, clock, taskId);
    const deadPid = await spawnDeadPid();
    assert.equal(await waitForProcessDeath(deadPid), true);
    // A holder that died right after completing the first creation: its lock
    // guards a generation the claim has already moved past, but only the
    // provably dead owner makes it recoverable.
    writeTakeoverLockRecord(home, taskId, {
      ownerPid: deadPid,
      baseGeneration: 0,
      baseClaimToken: null,
    });

    const takeover = store.claimTask({ taskId, workerId: 'worker-b', leaseDurationMs: 60_000 });
    assert.equal(takeover.generation, gen1.generation + 1);
    assert.deepEqual(store.readClaim(taskId), takeover);
    assertNoResidualTakeoverLock(home, taskId);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// T9/T10. Result fencing: stale result rejected, winner result delivered.
// ---------------------------------------------------------------------------

test('T9/T10. stale claimant result is fenced after takeover and the winner result is delivered', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const taskId = 'C02T09';
    const stale = driveToExpiredClaim(store, clock, taskId);
    const winner = store.claimTask({ taskId, workerId: 'worker-b', leaseDurationMs: 60_000 });
    assert.equal(winner.generation, 2);

    assert.throws(
      () => store.deliverResult(sampleResult(stale, { resultId: 'stale-attempt' })),
      (error) => error?.code === 'STALE_CLAIM',
    );
    assert.throws(() => store.readResult(taskId), (error) => error?.code === 'RESULT_NOT_FOUND');

    const delivered = store.deliverResult(sampleResult(winner, { resultId: 'winner-result' }));
    assert.equal(delivered.duplicate, false);
    assert.equal(delivered.record.claimGeneration, 2);
    assert.equal(store.readTask(taskId).status, 'RESULT_DELIVERED');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// T11. Terminal safety: RESULT_DELIVERED tasks never gain a new claim.
// ---------------------------------------------------------------------------

test('T11. RESULT_DELIVERED task refuses new claims with TASK_TERMINAL and no byte change', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const taskId = 'C02T11';
    const claim = driveToExpiredClaim(store, clock, taskId);
    store.deliverResult(sampleResult(claim, { resultId: 'terminal-result' }));
    assert.equal(store.readTask(taskId).status, 'RESULT_DELIVERED');
    const before = readFileSync(claimPath(home, taskId), 'utf8');

    assert.throws(
      () => store.claimTask({ taskId, workerId: 'worker-b', leaseDurationMs: 60_000 }),
      (error) => error?.code === 'TASK_TERMINAL',
    );
    assert.equal(readFileSync(claimPath(home, taskId), 'utf8'), before);
    assertNoResidualTakeoverLock(home, taskId);
  } finally {
    removeHome(home);
  }
});
