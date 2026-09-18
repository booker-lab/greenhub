// Proof for GREENHUB-COORDINATION-DURABLE-CORE-01.
// Lifecycle under test: TASK CREATED -> READY -> CLAIMED -> RESULT_DELIVERED.
// All runtime state lives in isolated temp directories. The repository worktree
// is never used as runtime state. No network, queue daemon, or provider calls.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveCoordinationHome } from './coordination-home.mjs';
import {
  TASK_STATUS_CLAIMED,
  TASK_STATUS_READY,
  TASK_STATUS_RESULT_DELIVERED,
  validateTaskEnvelope,
} from './task-envelope.mjs';
import { CoordinationStore } from './store.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(MODULE_DIRECTORY, '../..');
const STORE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'store.mjs')).href;

function makeHome(prefix = 'greenhub-coord-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'READ_ONLY',
    desiredExitState: 'RESULT_DELIVERED',
    policyRefs: ['docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md'],
    evidenceRefs: ['git:live-main-read'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: {
      liveMainHint: null,
      requiredPolicies: ['AGENTS.md'],
    },
    ownedSurface: ['scripts/coordination/'],
    mutationBoundary: { allowsWrite: false, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['durable-read', 'atomic-claim'],
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
    summary: 'bounded read-only probe completed',
    proofRefs: ['store:read-back'],
    evidenceRefs: ['test:temp-home'],
    frictionObserved: ['NONE'],
    ...overrides,
  };
}

test('A. Task durability: READY task survives store instance recreation', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const first = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    first.createTask(sampleTaskInput('DURABLECOREA01'));
    first.markReady('DURABLECOREA01');

    const second = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const reread = second.readTask('DURABLECOREA01');
    assert.equal(reread.status, TASK_STATUS_READY);
    assert.equal(reread.taskId, 'DURABLECOREA01');
    validateTaskEnvelope(reread);
  } finally {
    removeHome(home);
  }
});

test('B. Concurrent claim: exactly one of two claimants wins (in-process)', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const setup = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    setup.createTask(sampleTaskInput('DURABLECOREB01'));
    setup.markReady('DURABLECOREB01');

    const attempt = (workerId) =>
      Promise.resolve().then(() => {
        const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
        return store.claimTask({ taskId: 'DURABLECOREB01', workerId, leaseDurationMs: 60_000 });
      });

    const results = await Promise.allSettled([attempt('worker-a'), attempt('worker-b')]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.match(String(rejected[0].reason?.message ?? rejected[0].reason), /valid lease|acquisition race/i);
    assert.equal(rejected[0].reason?.code, 'LEASE_ACTIVE');

    const stored = new CoordinationStore({ dir: home }).readClaim('DURABLECOREB01');
    assert.equal(stored.generation, 1);
    assert.ok(['worker-a', 'worker-b'].includes(stored.workerId));
  } finally {
    removeHome(home);
  }
});

function runClaimRaceWorker({ home, taskId, workerId }) {
  return new Promise((resolveResult, rejectResult) => {
    const code = [
      'try {',
      `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
      `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
      `  const claim = store.claimTask({ taskId: ${JSON.stringify(taskId)}, workerId: ${JSON.stringify(workerId)}, leaseDurationMs: 60000 });`,
      '  console.log(JSON.stringify({ ok: true, workerId: claim.workerId, generation: claim.generation }));',
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
        rejectResult(new Error(`claim race worker exit=${exitCode} stderr=${stderr}`));
        return;
      }
      try {
        resolveResult(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch (error) {
        rejectResult(new Error(`claim race worker output parse failed: ${stdout} / ${stderr}`));
      }
    });
  });
}

test('B-race. Two OS processes racing a claim produce exactly one owner', { timeout: 30_000 }, async () => {
  const home = makeHome('greenhub-coord-race-');
  try {
    const setup = new CoordinationStore({ dir: home });
    setup.createTask(sampleTaskInput('DURABLECOREBR01'));
    setup.markReady('DURABLECOREBR01');
    const [first, second] = await Promise.all([
      runClaimRaceWorker({ home, taskId: 'DURABLECOREBR01', workerId: 'race-a' }),
      runClaimRaceWorker({ home, taskId: 'DURABLECOREBR01', workerId: 'race-b' }),
    ]);
    const winners = [first, second].filter((result) => result.ok === true);
    const losers = [first, second].filter((result) => result.ok !== true);
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.equal(losers[0].code, 'LEASE_ACTIVE');

    const stored = setup.readClaim('DURABLECOREBR01');
    assert.equal(stored.workerId, winners[0].workerId);
    assert.equal(stored.generation, 1);
  } finally {
    removeHome(home);
  }
});

test('C. Lease protection: valid lease rejects a second worker', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    store.createTask(sampleTaskInput('DURABLECOREC01'));
    store.markReady('DURABLECOREC01');
    const owner = store.claimTask({ taskId: 'DURABLECOREC01', workerId: 'worker-a', leaseDurationMs: 60_000 });
    assert.equal(owner.generation, 1);

    clock.advance(10_000);
    assert.throws(
      () => store.claimTask({ taskId: 'DURABLECOREC01', workerId: 'worker-b', leaseDurationMs: 60_000 }),
      (error) => error?.code === 'LEASE_ACTIVE',
    );

    const stored = store.readClaim('DURABLECOREC01');
    assert.equal(stored.workerId, 'worker-a');
    assert.equal(stored.claimToken, owner.claimToken);
    assert.equal(store.readTask('DURABLECOREC01').status, TASK_STATUS_CLAIMED);
  } finally {
    removeHome(home);
  }
});

test('D. Lease takeover: a new worker can claim after expiry with bumped generation', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    store.createTask(sampleTaskInput('DURABLECORED01'));
    store.markReady('DURABLECORED01');
    const first = store.claimTask({ taskId: 'DURABLECORED01', workerId: 'worker-a', leaseDurationMs: 5_000 });
    assert.equal(first.generation, 1);

    clock.advance(6_000);
    const second = store.claimTask({ taskId: 'DURABLECORED01', workerId: 'worker-b', leaseDurationMs: 5_000 });
    assert.equal(second.workerId, 'worker-b');
    assert.equal(second.generation, 2);
    assert.notEqual(second.claimToken, first.claimToken);

    const stored = store.readClaim('DURABLECORED01');
    assert.equal(stored.generation, 2);
    assert.equal(stored.workerId, 'worker-b');
  } finally {
    removeHome(home);
  }
});

test('E. Fencing: stale worker RESULT after takeover is rejected', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    store.createTask(sampleTaskInput('DURABLECORE01E'));
    store.markReady('DURABLECORE01E');
    const first = store.claimTask({ taskId: 'DURABLECORE01E', workerId: 'worker-a', leaseDurationMs: 5_000 });
    clock.advance(6_000);
    const second = store.claimTask({ taskId: 'DURABLECORE01E', workerId: 'worker-b', leaseDurationMs: 60_000 });
    assert.equal(second.generation, 2);

    assert.throws(() => store.deliverResult(sampleResult(first, { resultId: 'stale-attempt' })), (error) => {
      assert.equal(error?.code, 'STALE_CLAIM');
      return true;
    });

    // No canonical result was adopted from the stale worker.
    assert.throws(() => store.readResult('DURABLECORE01E'), (error) => error?.code === 'RESULT_NOT_FOUND');
    assert.equal(store.readTask('DURABLECORE01E').status, TASK_STATUS_CLAIMED);
  } finally {
    removeHome(home);
  }
});

test('F. Result durability: current claimant RESULT is stored and re-readable', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    store.createTask(sampleTaskInput('DURABLECORE01F'));
    store.markReady('DURABLECORE01F');
    const claim = store.claimTask({ taskId: 'DURABLECORE01F', workerId: 'worker-a', leaseDurationMs: 60_000 });

    const delivered = store.deliverResult(sampleResult(claim, { resultId: 'result-f-1' }));
    assert.equal(delivered.duplicate, false);
    assert.equal(delivered.alreadyDelivered, false);
    assert.equal(delivered.record.resultId, 'result-f-1');

    const reopened = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const reread = reopened.readResult('DURABLECORE01F');
    assert.equal(reread.resultId, 'result-f-1');
    assert.equal(reread.claimGeneration, 1);
    assert.equal(reread.summary, 'bounded read-only probe completed');
    assert.deepEqual(reread.frictionObserved, ['NONE']);
    assert.equal(reopened.readResultById('DURABLECORE01F', 'result-f-1').resultId, 'result-f-1');
    assert.equal(reopened.readTask('DURABLECORE01F').status, TASK_STATUS_RESULT_DELIVERED);
  } finally {
    removeHome(home);
  }
});

test('G. Duplicate delivery: same resultId is idempotent, terminal delivery is first-wins', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    store.createTask(sampleTaskInput('DURABLECORE01G'));
    store.markReady('DURABLECORE01G');
    const claim = store.claimTask({ taskId: 'DURABLECORE01G', workerId: 'worker-a', leaseDurationMs: 60_000 });

    const first = store.deliverResult(sampleResult(claim, { resultId: 'dup-1' }));
    assert.equal(first.duplicate, false);

    const retry = store.deliverResult(sampleResult(claim, { resultId: 'dup-1' }));
    assert.equal(retry.duplicate, true);
    assert.equal(retry.record.resultId, 'dup-1');
    assert.equal(retry.record.summary, first.record.summary);

    assert.throws(
      () => store.deliverResult(sampleResult(claim, { resultId: 'dup-1', summary: 'different payload' })),
      (error) => error?.code === 'DUPLICATE_RESULT_ID_CONFLICT',
    );

    const late = store.deliverResult(sampleResult(claim, { resultId: 'dup-2', summary: 'late second result' }));
    assert.equal(late.alreadyDelivered, true);
    assert.equal(late.record.resultId, 'dup-1');
    assert.equal(store.readResult('DURABLECORE01G').summary, 'bounded read-only probe completed');
  } finally {
    removeHome(home);
  }
});

test('Context budget: embedded dumps are rejected, refs are accepted', () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    assert.throws(
      () =>
        store.createTask(
          sampleTaskInput('DURABLECORECB1', {
            chatHistory: 'entire chat history embedded',
          }),
        ),
      (error) => error?.code === 'CONTEXT_BUDGET_EXCEEDED',
    );
    assert.throws(
      () =>
        store.createTask(
          sampleTaskInput('DURABLECORECB2', {
            contextRefs: ['x'.repeat(600)],
          }),
        ),
      (error) => error?.code === 'CONTEXT_BUDGET_EXCEEDED',
    );
    // Optional usage telemetry stays absent (UNKNOWN) unless explicitly provided.
    store.createTask(sampleTaskInput('DURABLECORECB3'));
    store.markReady('DURABLECORECB3');
    const claim = store.claimTask({ taskId: 'DURABLECORECB3', workerId: 'worker-a', leaseDurationMs: 60_000 });
    const delivered = store.deliverResult(sampleResult(claim, { resultId: 'cb-1' }));
    assert.equal(delivered.record.usage, undefined);
    const withUsage = sampleResult(claim, {
      resultId: 'cb-2-will-not-land',
      usage: { provider: 'none', model: 'none', inputTokens: 'UNKNOWN', outputTokens: 'UNKNOWN' },
    });
    // Terminal already delivered: deterministic first-wins, but the usage-shaped
    // payload itself validates (no fabricated counts are generated by the store).
    const late = store.deliverResult(withUsage);
    assert.equal(late.alreadyDelivered, true);
  } finally {
    removeHome(home);
  }
});

test('H. Repository cleanliness: runtime state never lands in the repository', () => {
  const fakeBase = makeHome('greenhub-coord-home-resolve-');
  try {
    const resolved = resolveCoordinationHome({
      platform: 'win32',
      env: { LOCALAPPDATA: fakeBase },
    });
    assert.equal(resolved, join(fakeBase, 'Greenhub', 'coordination'));
    assert.equal(resolved.startsWith(REPOSITORY_ROOT), false);

    const fromEnv = resolveCoordinationHome({
      env: { GREENHUB_COORDINATION_HOME: join(fakeBase, 'custom-home') },
    });
    assert.equal(fromEnv, join(fakeBase, 'custom-home'));

    const runtime = makeHome('greenhub-coord-runtime-');
    try {
      const store = new CoordinationStore({ dir: runtime });
      store.createTask(sampleTaskInput('DURABLECORE01H'));
      store.markReady('DURABLECORE01H');
      const claim = store.claimTask({ taskId: 'DURABLECORE01H', workerId: 'worker-a', leaseDurationMs: 60_000 });
      store.deliverResult(sampleResult(claim, { resultId: 'h-1' }));

      for (const artifact of ['task.json', 'claim.json', 'result.json']) {
        assert.equal(existsSync(join(MODULE_DIRECTORY, artifact)), false);
      }
      assert.equal(existsSync(join(REPOSITORY_ROOT, 'task.json')), false);

      // The only new files under the owned surface are this core's code/tests.
      const ownedEntries = ['coordination-home.mjs', 'task-envelope.mjs', 'store.mjs', 'durable-core.spec.mjs'];
      for (const entry of ownedEntries) {
        assert.equal(existsSync(join(MODULE_DIRECTORY, entry)), true);
      }
      void TASK_STATUS_READY;
      void TASK_STATUS_RESULT_DELIVERED;
    } finally {
      removeHome(runtime);
    }
  } finally {
    removeHome(fakeBase);
  }
});
