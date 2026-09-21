// Proof for GREENHUB-COORDINATION-RUNNABLE-OCCURRENCE-GF03.
// Runnable occurrence + atomic claim boundary ONLY:
//   APPROVED TASK (canonical emission-bound admission authority)
//     -> RUNNABLE OCCURRENCE (deterministic derived projection)
//     -> ATOMIC CLAIM WINNER (existing exclusive-create/generation contract).
//
// Explicitly NOT implemented here (and asserted absent):
//   scheduler, queue polling, READY scan (oldest/newest/next), priority,
//   fairness, worker registry, worker/executor selection, automatic workerId
//   inference, dispatch, transport, executor invocation, process spawn of
//   executors, OpenCode/Codex/Astra invocation, daemon, cron, watcher,
//   retry/backoff/resend, fan-out, autonomous loop, durable occurrence records,
//   executionGeneration/runnableGeneration/schedulerGeneration, Git branch/ref
//   lifecycle state, publication state.
// readRunnableOccurrence() != claimTask() != claimAdmittedTask()
//   != admitEmittedTask() != emitNextTask() != scheduleNextTask()
//   != dispatchNextTask() != decideNextTask().
// All runtime state lives in isolated temp directories. No network required.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildAdmissionBoundClaimToken } from './admission-bound-claim.mjs';
import { resolveCoordinationHome } from './coordination-home.mjs';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import { DEFAULT_EMISSION_SLOT } from './next-task-emission.mjs';
import * as runnableOccurrence from './runnable-occurrence.mjs';
import {
  BLOCKED_RUNNABLE_OCCURRENCE_FIELDS,
  buildRunnableOccurrenceId,
  buildRunnableOccurrenceRecord,
  RUNNABLE_OCCURRENCE_ID_PREFIX,
  RUNNABLE_OCCURRENCE_RECORD_FIELDS,
  RUNNABLE_OCCURRENCE_SCHEMA_VERSION,
  RUNNABLE_OCCURRENCE_STATE_CLAIMED,
  RUNNABLE_OCCURRENCE_STATE_RUNNABLE,
  RUNNABLE_OCCURRENCE_STATE_TERMINAL,
  RunnableOccurrenceValidationError,
  validateRunnableOccurrenceRecord,
} from './runnable-occurrence.mjs';
import { CoordinationStore } from './store.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const STORE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'store.mjs')).href;

const VALID_SPEC_BINDING = `sha256:${'a'.repeat(64)}`;

function makeHome(prefix = 'greenhub-occurrence-gf03-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'RUNNABLE_OCCURRENCE_PROVED',
    policyRefs: [
      'docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md',
    ],
    evidenceRefs: ['git:live-main-read'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: {
      liveMainHint: null,
      requiredPolicies: ['AGENTS.md'],
    },
    ownedSurface: ['scripts/coordination/'],
    mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['runnable-occurrence-proof'],
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

function driveToConsumed(store, clock, taskId, resultId = 'result-0001') {
  driveToDelivered(store, taskId, resultId);
  store.beginDisposition({ taskId, resultId, ...ctParams() });
  clock.advance(1000);
  store.writeDisposition({
    taskId,
    dispositionGeneration: 2,
    resultId,
    ...ctParams({ controlTowerToken: 'ct-token-002' }),
    state: DISPOSITION_STATE_ADOPTED,
  });
  clock.advance(1000);
  store.materializeAdoption({ taskId, ...matParams() });
  clock.advance(1000);
  store.ackAdoption({ taskId, acknowledgerId: 'control-tower-1' });
  clock.advance(1000);
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

function emissionPath(home, sourceTaskId, slot = DEFAULT_EMISSION_SLOT) {
  return join(home, 'tasks', sourceTaskId, 'emissions', `${slot}.json`);
}

function admissionPath(home, sourceTaskId, slot = DEFAULT_EMISSION_SLOT) {
  return join(home, 'tasks', sourceTaskId, 'emission-admissions', `${slot}.json`);
}

function claimPath(home, taskId) {
  return join(home, 'tasks', taskId, 'claim.json');
}

function childTaskPath(home, taskId) {
  return join(home, 'tasks', taskId, 'task.json');
}

function readJsonAt(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJsonAt(path, document) {
  writeFileSync(path, JSON.stringify(document, null, 2), 'utf8');
}

function snapshotHome(home) {
  const out = {};
  const recurse = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = [...entries].sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of sorted) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        recurse(full);
      } else if (entry.isFile()) {
        out[full.slice(home.length + 1)] = readFileSync(full, 'utf8');
      }
    }
  };
  recurse(home);
  return out;
}

function expectedOccurrenceId(admission) {
  return buildRunnableOccurrenceId({
    admissionId: admission.admissionId,
    nextTaskId: admission.nextTaskId,
    nextTaskSpecBinding: admission.nextTaskSpecBinding,
  });
}

function runChildProcess({ code, env = {}, preloadUrl = null }) {
  const args = preloadUrl
    ? ['--import', preloadUrl, '--input-type=module', '-e', code]
    : ['--input-type=module', '-e', code];
  const child = spawn(process.execPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, ...env },
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
      const line = stdout
        .split('\n')
        .reverse()
        .find((entry) => entry.trim().length > 0);
      resolveResult({
        exitCode,
        stdout,
        stderr,
        parsed: line ? JSON.parse(line) : null,
      });
    });
  });
  return { exitPromise };
}

function claimWorkerCode({ home, sourceTaskId, workerId, nowMs }) {
  return [
    'try {',
    `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
    `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
    `  const out = store.claimAdmittedTask({ sourceTaskId: ${JSON.stringify(sourceTaskId)}, emissionSlot: 'next', workerId: ${JSON.stringify(workerId)}, leaseDurationMs: 60000, nowMs: ${JSON.stringify(nowMs)} });`,
    '  console.log(JSON.stringify({ ok: true, workerId: out.claim.workerId, token: out.claim.claimToken, generation: out.claim.generation, duplicate: out.duplicate, terminal: out.terminal }));',
    '} catch (error) {',
    '  console.log(JSON.stringify({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error) }));',
    '}',
  ].join('\n');
}

function readOccurrenceWorkerCode({ home, sourceTaskId }) {
  return [
    'try {',
    `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
    `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
    `  const occurrence = store.readRunnableOccurrence({ sourceTaskId: ${JSON.stringify(sourceTaskId)} });`,
    '  console.log(JSON.stringify({ ok: true, occurrence }));',
    '} catch (error) {',
    '  console.log(JSON.stringify({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error) }));',
    '}',
  ].join('\n');
}

function crashLinkPreloadPath(home, { token, mode }) {
  const safeToken = token.replace(/[^A-Za-z0-9]/g, '-');
  const preloadPath = join(home, `gf03-crash-${mode}-${safeToken}-preload.mjs`);
  const lines = [
    "import fs from 'node:fs';",
    'const token = process.env.GREENHUB_GF03_LINK_TOKEN;',
    'const markerPath = process.env.GREENHUB_GF03_CRASH_MARKER;',
    'const crashMode = process.env.GREENHUB_GF03_LINK_MODE;',
    'if (token && markerPath) {',
    '  const originalLinkSync = fs.linkSync;',
    '  fs.linkSync = (target, linkPath, ...rest) => {',
    '    if (typeof linkPath === "string" && linkPath.includes(token)) {',
    '      if (crashMode === "after") {',
    '        const result = originalLinkSync(target, linkPath, ...rest);',
    '        fs.writeFileSync(markerPath, "after:" + token, "utf8");',
    '        process.exit(70);',
    '      }',
    '      fs.writeFileSync(markerPath, "before:" + token, "utf8");',
    '      process.exit(70);',
    '    }',
    '    return originalLinkSync(target, linkPath, ...rest);',
    '  };',
    '}',
  ];
  writeFileSync(preloadPath, lines.join('\n'), 'utf8');
  return pathToFileURL(preloadPath).href;
}

// ---------------------------------------------------------------------------
// U. pure contract: identity, exact shape, fail-closed validation.
// ---------------------------------------------------------------------------

test('U1. occurrence identity is deterministic and forks only on the admission binding', () => {
  const admissionId = 'adm_0123456789abcdef0123456789abcdef';
  const first = buildRunnableOccurrenceId({
    admissionId,
    nextTaskId: 'GF03-U1-CHILD',
    nextTaskSpecBinding: VALID_SPEC_BINDING,
  });
  assert.equal(
    first,
    buildRunnableOccurrenceId({
      admissionId,
      nextTaskId: 'GF03-U1-CHILD',
      nextTaskSpecBinding: VALID_SPEC_BINDING,
    }),
  );
  assert.match(first, new RegExp(`^${RUNNABLE_OCCURRENCE_ID_PREFIX}[0-9a-f]{64}$`));
  assert.notEqual(
    first,
    buildRunnableOccurrenceId({
      admissionId: 'adm_ffffffffffffffffffffffffffffffff',
      nextTaskId: 'GF03-U1-CHILD',
      nextTaskSpecBinding: VALID_SPEC_BINDING,
    }),
  );
  assert.notEqual(
    first,
    buildRunnableOccurrenceId({
      admissionId,
      nextTaskId: 'GF03-U1-OTHER',
      nextTaskSpecBinding: VALID_SPEC_BINDING,
    }),
  );
  assert.notEqual(
    first,
    buildRunnableOccurrenceId({
      admissionId,
      nextTaskId: 'GF03-U1-CHILD',
      nextTaskSpecBinding: `sha256:${'b'.repeat(64)}`,
    }),
  );
  const record = buildRunnableOccurrenceRecord({
    sourceTaskId: 'GF03-U1-SRC',
    emissionSlot: 'next',
    emissionId: 'emt_0123456789abcdef0123456789abcdef',
    admissionId,
    nextTaskId: 'GF03-U1-CHILD',
    nextTaskSpecBinding: VALID_SPEC_BINDING,
    occurrenceState: RUNNABLE_OCCURRENCE_STATE_RUNNABLE,
    claim: null,
  });
  assert.deepEqual(Object.keys(record), [...RUNNABLE_OCCURRENCE_RECORD_FIELDS]);
  assert.equal(Object.isFrozen(record), true);
  assert.equal(record.occurrenceId, first);
  assert.equal(record.claim, null);
  assert.deepEqual(validateRunnableOccurrenceRecord(record), record);
});

test('U2. occurrence projection validation is exact-shape and fail-closed', () => {
  const base = buildRunnableOccurrenceRecord({
    sourceTaskId: 'GF03-U2-SRC',
    emissionSlot: 'next',
    emissionId: 'emt_0123456789abcdef0123456789abcdef',
    admissionId: 'adm_0123456789abcdef0123456789abcdef',
    nextTaskId: 'GF03-U2-CHILD',
    nextTaskSpecBinding: VALID_SPEC_BINDING,
    occurrenceState: RUNNABLE_OCCURRENCE_STATE_RUNNABLE,
    claim: null,
  });
  const clone = () => JSON.parse(JSON.stringify(base));
  const expectCode = (action, code) => {
    assert.throws(
      action,
      (error) => error instanceof RunnableOccurrenceValidationError && error.code === code,
    );
  };

  expectCode(
    () =>
      validateRunnableOccurrenceRecord({
        ...clone(),
        occurrenceId: `${RUNNABLE_OCCURRENCE_ID_PREFIX}${'0'.repeat(64)}`,
      }),
    'RUNNABLE_OCCURRENCE_BINDING_MISMATCH',
  );
  expectCode(
    () => validateRunnableOccurrenceRecord({ ...clone(), schemaVersion: '2' }),
    'INVALID_SCHEMA_VERSION',
  );
  expectCode(
    () => validateRunnableOccurrenceRecord({ ...clone(), occurrenceState: 'SCHEDULED' }),
    'INVALID_RUNNABLE_OCCURRENCE',
  );
  const reordered = clone();
  const reorderedKeys = Object.keys(reordered);
  const [firstKey, secondKey] = reorderedKeys;
  reorderedKeys[0] = secondKey;
  reorderedKeys[1] = firstKey;
  const swapped = {};
  for (const key of reorderedKeys) swapped[key] = reordered[key];
  expectCode(() => validateRunnableOccurrenceRecord(swapped), 'INVALID_RUNNABLE_OCCURRENCE');
  const missing = clone();
  delete missing.claim;
  expectCode(() => validateRunnableOccurrenceRecord(missing), 'INVALID_RUNNABLE_OCCURRENCE');
  expectCode(
    () =>
      validateRunnableOccurrenceRecord({
        ...clone(),
        occurrenceState: RUNNABLE_OCCURRENCE_STATE_RUNNABLE,
        claim: { workerId: 'worker-a', claimGeneration: 1 },
      }),
    'INVALID_RUNNABLE_OCCURRENCE',
  );
  expectCode(
    () =>
      validateRunnableOccurrenceRecord({
        ...clone(),
        occurrenceState: RUNNABLE_OCCURRENCE_STATE_CLAIMED,
        claim: null,
      }),
    'INVALID_RUNNABLE_OCCURRENCE',
  );
  expectCode(
    () =>
      validateRunnableOccurrenceRecord({
        ...clone(),
        occurrenceState: RUNNABLE_OCCURRENCE_STATE_CLAIMED,
        claim: { workerId: 'worker-a', claimGeneration: 0 },
      }),
    'INVALID_RUNNABLE_OCCURRENCE',
  );
  expectCode(
    () =>
      validateRunnableOccurrenceRecord({
        ...clone(),
        occurrenceState: RUNNABLE_OCCURRENCE_STATE_CLAIMED,
        claim: { workerId: 'worker-a', claimGeneration: 1, claimToken: 'leak' },
      }),
    'CONTEXT_BUDGET_EXCEEDED',
  );
  expectCode(
    () => validateRunnableOccurrenceRecord({ ...clone(), claimToken: 'leak' }),
    'CONTEXT_BUDGET_EXCEEDED',
  );
  expectCode(
    () => validateRunnableOccurrenceRecord({ ...clone(), scheduler: {} }),
    'CONTEXT_BUDGET_EXCEEDED',
  );
  expectCode(
    () => validateRunnableOccurrenceRecord({ ...clone(), executionGeneration: 1 }),
    'CONTEXT_BUDGET_EXCEEDED',
  );
  expectCode(
    () => validateRunnableOccurrenceRecord({ ...clone(), emissionSlot: 'bad slot!' }),
    'INVALID_RUNNABLE_OCCURRENCE_SLOT',
  );
  expectCode(
    () => validateRunnableOccurrenceRecord({ ...clone(), nextTaskId: 'bad id!' }),
    'INVALID_TASK_ID',
  );
  expectCode(
    () => validateRunnableOccurrenceRecord({ ...clone(), nextTaskSpecBinding: 'sha256:xyz' }),
    'INVALID_RUNNABLE_OCCURRENCE',
  );
  // CLAIMED with the exact binding validates and freezes the claim projection.
  const claimed = validateRunnableOccurrenceRecord({
    ...clone(),
    occurrenceState: RUNNABLE_OCCURRENCE_STATE_CLAIMED,
    claim: { workerId: 'worker-a', claimGeneration: 3 },
  });
  assert.deepEqual(claimed.claim, { workerId: 'worker-a', claimGeneration: 3 });
  assert.equal(Object.isFrozen(claimed.claim), true);
});

test('U3. build rejects malformed identity inputs and blocked smuggling fields', () => {
  const expectCode = (action, code) => {
    assert.throws(
      action,
      (error) => error instanceof RunnableOccurrenceValidationError && error.code === code,
    );
  };
  expectCode(
    () =>
      buildRunnableOccurrenceId({
        admissionId: '',
        nextTaskId: 'X-1',
        nextTaskSpecBinding: VALID_SPEC_BINDING,
      }),
    'INVALID_RUNNABLE_OCCURRENCE',
  );
  expectCode(
    () =>
      buildRunnableOccurrenceId({
        admissionId: 'adm_x',
        nextTaskId: 'bad id',
        nextTaskSpecBinding: VALID_SPEC_BINDING,
      }),
    'INVALID_TASK_ID',
  );
  expectCode(
    () =>
      buildRunnableOccurrenceId({
        admissionId: 'adm_x',
        nextTaskId: 'X-1',
        nextTaskSpecBinding: 'nope',
      }),
    'INVALID_RUNNABLE_OCCURRENCE',
  );
  expectCode(
    () =>
      buildRunnableOccurrenceRecord({
        sourceTaskId: 'GF03-U3-SRC',
        emissionSlot: 'next',
        emissionId: 'emt_x',
        admissionId: 'adm_x',
        nextTaskId: 'GF03-U3-CHILD',
        nextTaskSpecBinding: VALID_SPEC_BINDING,
        occurrenceState: RUNNABLE_OCCURRENCE_STATE_RUNNABLE,
        claim: null,
        scheduler: 'smuggled',
      }),
    'CONTEXT_BUDGET_EXCEEDED',
  );
  expectCode(
    () =>
      buildRunnableOccurrenceRecord({
        sourceTaskId: 'GF03-U3-SRC',
        emissionSlot: 'next',
        emissionId: 'emt_x',
        admissionId: 'adm_x',
        nextTaskId: 'GF03-U3-CHILD',
        nextTaskSpecBinding: VALID_SPEC_BINDING,
        occurrenceState: RUNNABLE_OCCURRENCE_STATE_RUNNABLE,
        claim: {
          workerId: 'worker-a',
          claimGeneration: 1,
          leaseExpiresAt: '2099-01-01T00:00:00.000Z',
        },
      }),
    'CONTEXT_BUDGET_EXCEEDED',
  );
  for (const forbidden of [
    'claimToken',
    'generation',
    'executionGeneration',
    'runnableGeneration',
    'schedulerGeneration',
  ]) {
    assert.equal(
      BLOCKED_RUNNABLE_OCCURRENCE_FIELDS.includes(forbidden),
      true,
      `${forbidden} must be blocked`,
    );
  }
});

// ---------------------------------------------------------------------------
// A. ONE APPROVED TASK -> ONE RUNNABLE OCCURRENCE.
// ---------------------------------------------------------------------------

test('A1. one approved admission projects to exactly one RUNNABLE occurrence; reads are byte-stable', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'GF03-A1-SRC', 'GF03-A1-CHILD', 'result-gf03-a1-src');
    const admission = store.readEmissionAdmission({ sourceTaskId: 'GF03-A1-SRC' });

    const occurrence = store.readRunnableOccurrence({ sourceTaskId: 'GF03-A1-SRC' });
    assert.equal(occurrence.occurrenceState, RUNNABLE_OCCURRENCE_STATE_RUNNABLE);
    assert.equal(occurrence.claim, null);
    assert.equal(occurrence.occurrenceId, expectedOccurrenceId(admission));
    assert.equal(occurrence.admissionId, admission.admissionId);
    assert.equal(occurrence.nextTaskId, 'GF03-A1-CHILD');
    assert.equal(occurrence.nextTaskSpecBinding, admission.nextTaskSpecBinding);
    assert.equal(occurrence.sourceTaskId, 'GF03-A1-SRC');
    assert.equal(occurrence.emissionSlot, 'next');
    assert.equal(Object.isFrozen(occurrence), true);
    assert.deepEqual(Object.keys(occurrence), [...RUNNABLE_OCCURRENCE_RECORD_FIELDS]);

    const before = snapshotHome(home);
    const baseline = JSON.stringify(occurrence);
    for (let round = 0; round < 10; round += 1) {
      assert.equal(
        JSON.stringify(store.readRunnableOccurrence({ sourceTaskId: 'GF03-A1-SRC' })),
        baseline,
      );
    }
    assert.deepEqual(snapshotHome(home), before, 'reads must write zero durable bytes');
  } finally {
    removeHome(home);
  }
});

test('A2. fresh process reads the byte-identical occurrence projection', {
  timeout: 60_000,
}, async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'GF03-A2-SRC', 'GF03-A2-CHILD', 'result-gf03-a2-src');
    const baseline = JSON.stringify(store.readRunnableOccurrence({ sourceTaskId: 'GF03-A2-SRC' }));

    const child = runChildProcess({
      code: readOccurrenceWorkerCode({ home, sourceTaskId: 'GF03-A2-SRC' }),
    });
    const result = await child.exitPromise;
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.parsed.ok, true);
    assert.equal(JSON.stringify(result.parsed.occurrence), baseline);
  } finally {
    removeHome(home);
  }
});

test('A3. clock skew never enters occurrence identity or the durable claim projection', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'GF03-A3-SRC', 'GF03-A3-CHILD', 'result-gf03-a3-src');
    const beforeClaim = JSON.stringify(
      store.readRunnableOccurrence({ sourceTaskId: 'GF03-A3-SRC' }),
    );

    const claimed = store.claimAdmittedTask({ sourceTaskId: 'GF03-A3-SRC', workerId: 'worker-a' });
    const beforeSkew = JSON.stringify(
      store.readRunnableOccurrence({ sourceTaskId: 'GF03-A3-SRC' }),
    );
    assert.equal(JSON.parse(beforeSkew).occurrenceState, RUNNABLE_OCCURRENCE_STATE_CLAIMED);

    clock.advance(365 * 86_400_000);
    const forward = store.readRunnableOccurrence({ sourceTaskId: 'GF03-A3-SRC' });
    assert.equal(
      JSON.stringify(forward),
      beforeSkew,
      'one-year clock skew must not change the projection',
    );
    clock.advance(-2 * 365 * 86_400_000);
    const backward = store.readRunnableOccurrence({ sourceTaskId: 'GF03-A3-SRC' });
    assert.equal(
      JSON.stringify(backward),
      beforeSkew,
      'negative clock skew must not change the projection',
    );
    assert.equal(JSON.parse(beforeSkew).claim.workerId, 'worker-a');
    assert.equal(JSON.parse(beforeSkew).claim.claimGeneration, claimed.claim.generation);
    // The pre-claim RUNNABLE projection shares the same occurrence identity.
    assert.equal(JSON.parse(beforeClaim).occurrenceId, JSON.parse(beforeSkew).occurrenceId);
  } finally {
    removeHome(home);
  }
});

test('A4. exact replay of the same approval converges with zero durable byte churn', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const { admitted } = driveToAdmitted(
      store,
      clock,
      'GF03-A4-SRC',
      'GF03-A4-CHILD',
      'result-gf03-a4-src',
    );
    const baselineOccurrence = JSON.stringify(
      store.readRunnableOccurrence({ sourceTaskId: 'GF03-A4-SRC' }),
    );
    const before = snapshotHome(home);

    const replay = store.admitEmittedTask({
      sourceTaskId: 'GF03-A4-SRC',
      admitterId: 'control-tower-1',
    });
    assert.equal(replay.duplicate, true);
    assert.equal(replay.record.admissionId, admitted.record.admissionId);
    assert.equal(
      JSON.stringify(store.readRunnableOccurrence({ sourceTaskId: 'GF03-A4-SRC' })),
      baselineOccurrence,
    );
    assert.deepEqual(
      snapshotHome(home),
      before,
      'exact approval replay must not rewrite durable bytes',
    );
  } finally {
    removeHome(home);
  }
});

test('A5. approval replay converges a pre-READY crash window to the same occurrence', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'GF03-A5-SRC', 'GF03-A5-CHILD', 'result-gf03-a5-src');
    const admission = store.readEmissionAdmission({ sourceTaskId: 'GF03-A5-SRC' });

    // Emulate the crash window between admission authority publication and the
    // READY convergence: authority bytes survive, the child never reached READY.
    const childFile = childTaskPath(home, 'GF03-A5-CHILD');
    const child = readJsonAt(childFile);
    assert.equal(child.status, 'READY');
    writeJsonAt(childFile, { ...child, status: 'CREATED', updatedAt: '2026-01-01T00:00:00.000Z' });
    assert.throws(
      () => store.readRunnableOccurrence({ sourceTaskId: 'GF03-A5-SRC' }),
      (error) => error?.code === 'TASK_NOT_READY',
    );

    const replay = store.admitEmittedTask({
      sourceTaskId: 'GF03-A5-SRC',
      admitterId: 'control-tower-1',
    });
    assert.equal(replay.duplicate, true);
    assert.equal(replay.record.admissionId, admission.admissionId);
    assert.equal(store.readTask('GF03-A5-CHILD').status, 'READY');
    const occurrence = store.readRunnableOccurrence({ sourceTaskId: 'GF03-A5-SRC' });
    assert.equal(occurrence.occurrenceState, RUNNABLE_OCCURRENCE_STATE_RUNNABLE);
    assert.equal(occurrence.occurrenceId, expectedOccurrenceId(admission));
  } finally {
    removeHome(home);
  }
});

test('A6. conflicting approval input fails closed with the first winner preserved', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'GF03-A6-SRC', 'GF03-A6-CHILD', 'result-gf03-a6-src');
    const emissionFile = emissionPath(home, 'GF03-A6-SRC');
    const beforeBytes = readFileSync(emissionFile, 'utf8');

    assert.throws(
      () =>
        store.emitNextTask({
          sourceTaskId: 'GF03-A6-SRC',
          nextTaskSpec: sampleTaskInput('GF03-A6-OTHER', {
            desiredExitState: 'CONFLICTING_EXIT_STATE',
          }),
          emitterId: 'control-tower-1',
        }),
      (error) => error?.code === 'EMISSION_CONFLICT',
    );
    assert.equal(
      readFileSync(emissionFile, 'utf8'),
      beforeBytes,
      'first approval bytes must be preserved',
    );

    const replay = store.emitNextTask({
      sourceTaskId: 'GF03-A6-SRC',
      nextTaskSpec: sampleTaskInput('GF03-A6-CHILD'),
      emitterId: 'control-tower-1',
    });
    assert.equal(replay.duplicate, true);
    assert.equal(
      readFileSync(emissionFile, 'utf8'),
      beforeBytes,
      'exact replay must not rewrite the winner',
    );
    const admission = store.admitEmittedTask({
      sourceTaskId: 'GF03-A6-SRC',
      admitterId: 'control-tower-1',
    });
    const occurrence = store.readRunnableOccurrence({ sourceTaskId: 'GF03-A6-SRC' });
    assert.equal(occurrence.occurrenceId, expectedOccurrenceId(admission.record));
    assert.equal(occurrence.nextTaskId, 'GF03-A6-CHILD');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// C. ATOMIC CLAIM: exactly one winner across OS processes.
// ---------------------------------------------------------------------------

test('C1. two OS processes racing one occurrence elect exactly one winner', {
  timeout: 120_000,
}, async () => {
  for (let round = 0; round < 6; round += 1) {
    const home = makeHome(`greenhub-gf03-race2-${round}-`);
    try {
      const clock = controllableClock();
      const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
      driveToAdmitted(
        store,
        clock,
        `GF03C1-${round}-SRC`,
        `GF03C1-${round}-CHILD`,
        `result-gf03c1-${round}-src`,
      );
      const admission = store.readEmissionAdmission({ sourceTaskId: `GF03C1-${round}-SRC` });
      const beforeOccurrence = JSON.stringify(
        store.readRunnableOccurrence({ sourceTaskId: `GF03C1-${round}-SRC` }),
      );
      const nowMs = 1_700_000_000_000 + round * 1000;

      const first = runChildProcess({
        code: claimWorkerCode({
          home,
          sourceTaskId: `GF03C1-${round}-SRC`,
          workerId: 'worker-a',
          nowMs,
        }),
      });
      const second = runChildProcess({
        code: claimWorkerCode({
          home,
          sourceTaskId: `GF03C1-${round}-SRC`,
          workerId: 'worker-b',
          nowMs,
        }),
      });
      const results = await Promise.all([first.exitPromise, second.exitPromise]);
      const parsed = results.map((result) => result.parsed);
      const winners = parsed.filter((result) => result.ok === true);
      const losers = parsed.filter((result) => result.ok === false);
      assert.equal(winners.length, 1);
      assert.equal(losers.length, 1);
      assert.equal(losers[0].code, 'LEASE_ACTIVE');
      assert.equal(winners[0].generation, 1);

      const canonical = store.readClaim(`GF03C1-${round}-CHILD`);
      assert.equal(canonical.generation, 1);
      assert.equal(canonical.workerId, winners[0].workerId);
      assert.equal(
        canonical.claimToken,
        buildAdmissionBoundClaimToken({
          admissionId: admission.admissionId,
          nextTaskId: `GF03C1-${round}-CHILD`,
          workerId: canonical.workerId,
        }),
      );
      assert.equal(store.readTask(`GF03C1-${round}-CHILD`).status, 'CLAIMED');
      const occurrence = store.readRunnableOccurrence({ sourceTaskId: `GF03C1-${round}-SRC` });
      assert.equal(occurrence.occurrenceState, RUNNABLE_OCCURRENCE_STATE_CLAIMED);
      assert.equal(occurrence.claim.workerId, winners[0].workerId);
      assert.equal(occurrence.claim.claimGeneration, 1);
      assert.equal(JSON.parse(beforeOccurrence).occurrenceId, occurrence.occurrenceId);
    } finally {
      removeHome(home);
    }
  }
});

test('C2. four OS processes racing one occurrence elect exactly one winner', {
  timeout: 120_000,
}, async () => {
  for (let round = 0; round < 3; round += 1) {
    const home = makeHome(`greenhub-gf03-race4-${round}-`);
    try {
      const clock = controllableClock();
      const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
      driveToAdmitted(
        store,
        clock,
        `GF03C2-${round}-SRC`,
        `GF03C2-${round}-CHILD`,
        `result-gf03c2-${round}-src`,
      );
      const nowMs = 1_700_000_000_000 + round * 1000;
      const children = ['worker-a', 'worker-b', 'worker-c', 'worker-d'].map((workerId) =>
        runChildProcess({
          code: claimWorkerCode({ home, sourceTaskId: `GF03C2-${round}-SRC`, workerId, nowMs }),
        }),
      );
      const results = await Promise.all(children.map((child) => child.exitPromise));
      const parsed = results.map((result) => result.parsed);
      const winners = parsed.filter((result) => result.ok === true);
      const losers = parsed.filter((result) => result.ok === false);
      assert.equal(winners.length, 1);
      assert.equal(losers.length, 3);
      for (const loser of losers) assert.equal(loser.code, 'LEASE_ACTIVE');
      const canonical = store.readClaim(`GF03C2-${round}-CHILD`);
      assert.equal(canonical.generation, 1);
      assert.equal(canonical.workerId, winners[0].workerId);
      assert.equal(store.readTask(`GF03C2-${round}-CHILD`).status, 'CLAIMED');
    } finally {
      removeHome(home);
    }
  }
});

test('C3. loser claim never overwrites winner bytes, generation, or occurrence identity', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'GF03-C3-SRC', 'GF03-C3-CHILD', 'result-gf03-c3-src');
    const winner = store.claimAdmittedTask({ sourceTaskId: 'GF03-C3-SRC', workerId: 'worker-a' });
    const winnerBytes = readFileSync(claimPath(home, 'GF03-C3-CHILD'), 'utf8');
    const occurrenceBytes = JSON.stringify(
      store.readRunnableOccurrence({ sourceTaskId: 'GF03-C3-SRC' }),
    );

    assert.throws(
      () => store.claimAdmittedTask({ sourceTaskId: 'GF03-C3-SRC', workerId: 'worker-b' }),
      (error) => error?.code === 'LEASE_ACTIVE',
    );
    assert.equal(readFileSync(claimPath(home, 'GF03-C3-CHILD'), 'utf8'), winnerBytes);
    assert.deepEqual(store.readClaim('GF03-C3-CHILD'), winner.claim);
    assert.equal(store.readClaim('GF03-C3-CHILD').generation, 1);
    assert.equal(
      JSON.stringify(store.readRunnableOccurrence({ sourceTaskId: 'GF03-C3-SRC' })),
      occurrenceBytes,
    );
  } finally {
    removeHome(home);
  }
});

test('C4. winner replay keeps the claim, generation, bytes, and occurrence unchanged', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'GF03-C4-SRC', 'GF03-C4-CHILD', 'result-gf03-c4-src');
    const first = store.claimAdmittedTask({ sourceTaskId: 'GF03-C4-SRC', workerId: 'worker-a' });
    const claimBytes = readFileSync(claimPath(home, 'GF03-C4-CHILD'), 'utf8');
    const occurrenceBytes = JSON.stringify(
      store.readRunnableOccurrence({ sourceTaskId: 'GF03-C4-SRC' }),
    );

    const replay = store.claimAdmittedTask({ sourceTaskId: 'GF03-C4-SRC', workerId: 'worker-a' });
    assert.equal(replay.duplicate, true);
    assert.equal(replay.terminal, false);
    assert.deepEqual(replay.claim, first.claim);
    assert.equal(replay.claim.generation, 1);
    assert.equal(readFileSync(claimPath(home, 'GF03-C4-CHILD'), 'utf8'), claimBytes);
    assert.equal(
      JSON.stringify(store.readRunnableOccurrence({ sourceTaskId: 'GF03-C4-SRC' })),
      occurrenceBytes,
    );
  } finally {
    removeHome(home);
  }
});

test('C5. fresh-process winner replay converges to the same durable claim', {
  timeout: 60_000,
}, async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'GF03-C5-SRC', 'GF03-C5-CHILD', 'result-gf03-c5-src');
    const winner = store.claimAdmittedTask({ sourceTaskId: 'GF03-C5-SRC', workerId: 'worker-a' });
    const claimBytes = readFileSync(claimPath(home, 'GF03-C5-CHILD'), 'utf8');

    const child = runChildProcess({
      code: claimWorkerCode({
        home,
        sourceTaskId: 'GF03-C5-SRC',
        workerId: 'worker-a',
        nowMs: clock.now,
      }),
    });
    const result = await child.exitPromise;
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.parsed.ok, true);
    assert.equal(result.parsed.duplicate, true);
    assert.equal(result.parsed.generation, 1);
    assert.equal(result.parsed.token, winner.claim.claimToken);
    assert.equal(readFileSync(claimPath(home, 'GF03-C5-CHILD'), 'utf8'), claimBytes);
  } finally {
    removeHome(home);
  }
});

test('C6. foreign manual claim is never projected and fails closed', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'GF03-C6-SRC', 'GF03-C6-CHILD', 'result-gf03-c6-src');
    store.markReady('GF03-C6-CHILD');
    store.claimTask({
      taskId: 'GF03-C6-CHILD',
      workerId: 'worker-x',
      leaseDurationMs: 60_000,
      claimToken: 'random-manual-token',
    });
    const claimBytes = readFileSync(claimPath(home, 'GF03-C6-CHILD'), 'utf8');
    assert.throws(
      () => store.readRunnableOccurrence({ sourceTaskId: 'GF03-C6-SRC' }),
      (error) => error?.code === 'CLAIM_ADMISSION_BYPASS_DETECTED',
    );
    assert.equal(readFileSync(claimPath(home, 'GF03-C6-CHILD'), 'utf8'), claimBytes);
    assert.throws(
      () => store.claimAdmittedTask({ sourceTaskId: 'GF03-C6-SRC', workerId: 'worker-a' }),
      (error) => error?.code === 'CLAIM_ADMISSION_BYPASS_DETECTED',
    );
    assert.equal(readFileSync(claimPath(home, 'GF03-C6-CHILD'), 'utf8'), claimBytes);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// X. CRASH / RESTART boundaries.
// ---------------------------------------------------------------------------

test('X1. crash before admission publication leaves no ghost claim and replays to the same occurrence', {
  timeout: 120_000,
}, async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'GF03-X1-SRC', 'GF03-X1-CHILD', 'result-gf03-x1-src');
    const markerPath = join(home, 'crash-marker-x1');
    const preloadUrl = crashLinkPreloadPath(home, { token: 'emission-admissions', mode: 'before' });

    const crashing = runChildProcess({
      preloadUrl,
      env: {
        GREENHUB_GF03_LINK_TOKEN: 'emission-admissions',
        GREENHUB_GF03_CRASH_MARKER: markerPath,
        GREENHUB_GF03_LINK_MODE: 'before',
      },
      code: [
        'try {',
        `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
        `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
        "  store.admitEmittedTask({ sourceTaskId: 'GF03-X1-SRC', admitterId: 'control-tower-1' });",
        '  console.log(JSON.stringify({ ok: true }));',
        '} catch (error) {',
        '  console.log(JSON.stringify({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error) }));',
        '}',
      ].join('\n'),
    });
    const crashed = await crashing.exitPromise;
    assert.equal(crashed.exitCode, 70, crashed.stderr);
    assert.equal(
      existsSync(markerPath),
      true,
      'the crash happened exactly at admission publication',
    );
    assert.equal(
      existsSync(admissionPath(home, 'GF03-X1-SRC')),
      false,
      'no admission authority was published',
    );
    assert.equal(existsSync(claimPath(home, 'GF03-X1-CHILD')), false, 'no ghost claim exists');
    assert.equal(store.readTask('GF03-X1-CHILD').status, 'CREATED');
    assert.throws(
      () => store.readRunnableOccurrence({ sourceTaskId: 'GF03-X1-SRC' }),
      (error) => error?.code === 'ADMISSION_NOT_FOUND',
    );

    const replay = store.admitEmittedTask({
      sourceTaskId: 'GF03-X1-SRC',
      admitterId: 'control-tower-1',
    });
    const occurrence = store.readRunnableOccurrence({ sourceTaskId: 'GF03-X1-SRC' });
    assert.equal(occurrence.occurrenceState, RUNNABLE_OCCURRENCE_STATE_RUNNABLE);
    assert.equal(occurrence.occurrenceId, expectedOccurrenceId(replay.record));
    const claimed = store.claimAdmittedTask({ sourceTaskId: 'GF03-X1-SRC', workerId: 'worker-a' });
    assert.equal(claimed.claim.generation, 1);
    assert.equal(store.readTask('GF03-X1-CHILD').status, 'CLAIMED');
  } finally {
    removeHome(home);
  }
});

test('X2. crash after admission authority but before READY converges to the same occurrence, no ghost claim', {
  timeout: 120_000,
}, async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToEmitted(store, clock, 'GF03-X2-SRC', 'GF03-X2-CHILD', 'result-gf03-x2-src');
    const markerPath = join(home, 'crash-marker-x2');
    const preloadUrl = crashLinkPreloadPath(home, { token: 'emission-admissions', mode: 'after' });

    const crashing = runChildProcess({
      preloadUrl,
      env: {
        GREENHUB_GF03_LINK_TOKEN: 'emission-admissions',
        GREENHUB_GF03_CRASH_MARKER: markerPath,
        GREENHUB_GF03_LINK_MODE: 'after',
      },
      code: [
        'try {',
        `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
        `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
        "  store.admitEmittedTask({ sourceTaskId: 'GF03-X2-SRC', admitterId: 'control-tower-1' });",
        '  console.log(JSON.stringify({ ok: true }));',
        '} catch (error) {',
        '  console.log(JSON.stringify({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error) }));',
        '}',
      ].join('\n'),
    });
    const crashed = await crashing.exitPromise;
    assert.equal(crashed.exitCode, 70, crashed.stderr);
    assert.equal(existsSync(markerPath), true);
    assert.equal(existsSync(admissionPath(home, 'GF03-X2-SRC')), true);
    assert.equal(
      store.readTask('GF03-X2-CHILD').status,
      'CREATED',
      'READY convergence never completed',
    );
    assert.equal(existsSync(claimPath(home, 'GF03-X2-CHILD')), false, 'no ghost claim exists');
    const admissionBytes = readFileSync(admissionPath(home, 'GF03-X2-SRC'), 'utf8');
    assert.throws(
      () => store.readRunnableOccurrence({ sourceTaskId: 'GF03-X2-SRC' }),
      (error) => error?.code === 'TASK_NOT_READY',
    );

    const replay = store.admitEmittedTask({
      sourceTaskId: 'GF03-X2-SRC',
      admitterId: 'control-tower-1',
    });
    assert.equal(replay.duplicate, true);
    assert.equal(
      readFileSync(admissionPath(home, 'GF03-X2-SRC'), 'utf8'),
      admissionBytes,
      'authority bytes preserved',
    );
    const occurrence = store.readRunnableOccurrence({ sourceTaskId: 'GF03-X2-SRC' });
    assert.equal(occurrence.occurrenceState, RUNNABLE_OCCURRENCE_STATE_RUNNABLE);
    assert.equal(occurrence.occurrenceId, expectedOccurrenceId(replay.record));
  } finally {
    removeHome(home);
  }
});

test('X3. crash before claim publication is rerunnable with the same occurrence identity', {
  timeout: 120_000,
}, async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'GF03-X3-SRC', 'GF03-X3-CHILD', 'result-gf03-x3-src');
    const baseline = JSON.stringify(store.readRunnableOccurrence({ sourceTaskId: 'GF03-X3-SRC' }));
    const markerPath = join(home, 'crash-marker-x3');
    const preloadUrl = crashLinkPreloadPath(home, { token: 'claim.json', mode: 'before' });

    const crashing = runChildProcess({
      preloadUrl,
      env: {
        GREENHUB_GF03_LINK_TOKEN: 'claim.json',
        GREENHUB_GF03_CRASH_MARKER: markerPath,
        GREENHUB_GF03_LINK_MODE: 'before',
      },
      code: claimWorkerCode({
        home,
        sourceTaskId: 'GF03-X3-SRC',
        workerId: 'crash-worker',
        nowMs: 1_700_000_000_000,
      }),
    });
    const crashed = await crashing.exitPromise;
    assert.equal(crashed.exitCode, 70, crashed.stderr);
    assert.equal(existsSync(markerPath), true);
    assert.equal(
      existsSync(claimPath(home, 'GF03-X3-CHILD')),
      false,
      'no claim authority was published',
    );
    const occurrence = store.readRunnableOccurrence({ sourceTaskId: 'GF03-X3-SRC' });
    assert.equal(occurrence.occurrenceState, RUNNABLE_OCCURRENCE_STATE_RUNNABLE);
    assert.equal(JSON.stringify(occurrence), baseline);

    const claimed = store.claimAdmittedTask({
      sourceTaskId: 'GF03-X3-SRC',
      workerId: 'worker-next',
    });
    assert.equal(claimed.claim.generation, 1);
    assert.equal(store.readTask('GF03-X3-CHILD').status, 'CLAIMED');
    const after = store.readRunnableOccurrence({ sourceTaskId: 'GF03-X3-SRC' });
    assert.equal(after.occurrenceState, RUNNABLE_OCCURRENCE_STATE_CLAIMED);
    assert.equal(after.claim.workerId, 'worker-next');
    assert.equal(after.occurrenceId, JSON.parse(baseline).occurrenceId);
  } finally {
    removeHome(home);
  }
});

test('X4. crash after claim exclusive-create preserves the durable winner and blocks overwrite', {
  timeout: 120_000,
}, async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'GF03-X4-SRC', 'GF03-X4-CHILD', 'result-gf03-x4-src');
    const markerPath = join(home, 'crash-marker-x4');
    const preloadUrl = crashLinkPreloadPath(home, { token: 'claim.json', mode: 'after' });

    const crashing = runChildProcess({
      preloadUrl,
      env: {
        GREENHUB_GF03_LINK_TOKEN: 'claim.json',
        GREENHUB_GF03_CRASH_MARKER: markerPath,
        GREENHUB_GF03_LINK_MODE: 'after',
      },
      code: claimWorkerCode({
        home,
        sourceTaskId: 'GF03-X4-SRC',
        workerId: 'crash-worker',
        nowMs: Date.now(),
      }),
    });
    const crashed = await crashing.exitPromise;
    assert.equal(crashed.exitCode, 70, crashed.stderr);
    assert.equal(existsSync(markerPath), true);
    assert.equal(
      existsSync(claimPath(home, 'GF03-X4-CHILD')),
      true,
      'claim authority was published',
    );
    assert.equal(
      store.readTask('GF03-X4-CHILD').status,
      'READY',
      'status convergence never completed',
    );
    const claimBytes = readFileSync(claimPath(home, 'GF03-X4-CHILD'), 'utf8');
    const persisted = JSON.parse(claimBytes);
    assert.equal(persisted.workerId, 'crash-worker');
    assert.equal(persisted.generation, 1);

    // The durable claim winner decides, not the un-converged status.
    const occurrence = store.readRunnableOccurrence({ sourceTaskId: 'GF03-X4-SRC' });
    assert.equal(occurrence.occurrenceState, RUNNABLE_OCCURRENCE_STATE_CLAIMED);
    assert.equal(occurrence.claim.workerId, 'crash-worker');
    assert.equal(occurrence.claim.claimGeneration, 1);

    // A different process must never overwrite the winner while the lease holds.
    assert.throws(
      () =>
        store.claimAdmittedTask({
          sourceTaskId: 'GF03-X4-SRC',
          workerId: 'worker-b',
          nowMs: Date.now(),
        }),
      (error) => error?.code === 'LEASE_ACTIVE',
    );
    assert.equal(readFileSync(claimPath(home, 'GF03-X4-CHILD'), 'utf8'), claimBytes);

    // The exact winner replay converges the missing status without touching bytes.
    const replay = store.claimAdmittedTask({
      sourceTaskId: 'GF03-X4-SRC',
      workerId: 'crash-worker',
      nowMs: Date.now(),
    });
    assert.equal(replay.duplicate, true);
    assert.equal(replay.claim.generation, 1);
    assert.equal(store.readTask('GF03-X4-CHILD').status, 'CLAIMED');
    assert.equal(readFileSync(claimPath(home, 'GF03-X4-CHILD'), 'utf8'), claimBytes);
  } finally {
    removeHome(home);
  }
});

test('X5. claim read-back interruption resolves from durable winner bytes, not child status', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'GF03-X5-SRC', 'GF03-X5-CHILD', 'result-gf03-x5-src');
    const first = store.claimAdmittedTask({ sourceTaskId: 'GF03-X5-SRC', workerId: 'worker-a' });
    const claimBytes = readFileSync(claimPath(home, 'GF03-X5-CHILD'), 'utf8');

    // Emulate the crash between claim.json exclusive-create and markClaimed.
    const childFile = childTaskPath(home, 'GF03-X5-CHILD');
    const child = readJsonAt(childFile);
    writeJsonAt(childFile, { ...child, status: 'READY', updatedAt: '2026-01-01T00:00:00.000Z' });

    const occurrence = store.readRunnableOccurrence({ sourceTaskId: 'GF03-X5-SRC' });
    assert.equal(occurrence.occurrenceState, RUNNABLE_OCCURRENCE_STATE_CLAIMED);
    assert.equal(occurrence.claim.workerId, 'worker-a');
    assert.equal(occurrence.claim.claimGeneration, first.claim.generation);
    assert.equal(readFileSync(claimPath(home, 'GF03-X5-CHILD'), 'utf8'), claimBytes);

    const replay = store.claimAdmittedTask({ sourceTaskId: 'GF03-X5-SRC', workerId: 'worker-a' });
    assert.equal(replay.duplicate, true);
    assert.equal(store.readTask('GF03-X5-CHILD').status, 'CLAIMED');
    assert.equal(readFileSync(claimPath(home, 'GF03-X5-CHILD'), 'utf8'), claimBytes);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. FAIL CLOSED: corruption, drift, terminal.
// ---------------------------------------------------------------------------

test('F1. corrupt admission bytes fail closed with no repair and no occurrence', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'GF03-F1-SRC', 'GF03-F1-CHILD', 'result-gf03-f1-src');
    const admissionFile = admissionPath(home, 'GF03-F1-SRC');
    writeFileSync(admissionFile, '{ not valid json', 'utf8');
    assert.throws(
      () => store.readRunnableOccurrence({ sourceTaskId: 'GF03-F1-SRC' }),
      (error) => error?.code === 'CORRUPT_ADMISSION',
    );
    assert.equal(readFileSync(admissionFile, 'utf8'), '{ not valid json', 'no auto-repair');
    assert.equal(existsSync(claimPath(home, 'GF03-F1-CHILD')), false);
  } finally {
    removeHome(home);
  }
});

test('F2. corrupt claim bytes fail closed and are never repaired or projected', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'GF03-F2-SRC', 'GF03-F2-CHILD', 'result-gf03-f2-src');
    const claimFile = claimPath(home, 'GF03-F2-CHILD');
    writeFileSync(claimFile, '{"broken":', 'utf8');
    assert.throws(
      () => store.readRunnableOccurrence({ sourceTaskId: 'GF03-F2-SRC' }),
      (error) => error?.code === 'CORRUPT_CLAIM',
    );
    assert.equal(readFileSync(claimFile, 'utf8'), '{"broken":', 'no auto-repair');
    assert.throws(
      () => store.claimAdmittedTask({ sourceTaskId: 'GF03-F2-SRC', workerId: 'worker-a' }),
      (error) => error?.code === 'CORRUPT_CLAIM',
    );
    assert.equal(readFileSync(claimFile, 'utf8'), '{"broken":');
  } finally {
    removeHome(home);
  }
});

test('F3. child spec tamper fails closed with no repair', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'GF03-F3-SRC', 'GF03-F3-CHILD', 'result-gf03-f3-src');
    const childFile = childTaskPath(home, 'GF03-F3-CHILD');
    const child = readJsonAt(childFile);
    writeJsonAt(childFile, { ...child, desiredExitState: 'TAMPERED_EXIT_STATE' });
    const tampered = readFileSync(childFile, 'utf8');
    assert.throws(
      () => store.readRunnableOccurrence({ sourceTaskId: 'GF03-F3-SRC' }),
      (error) => error?.code === 'ADMISSION_BINDING_MISMATCH',
    );
    assert.equal(readFileSync(childFile, 'utf8'), tampered, 'no auto-repair');
  } finally {
    removeHome(home);
  }
});

test('F4. progressed child without claim authority fails closed with CLAIM_NOT_FOUND', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'GF03-F4-SRC', 'GF03-F4-CHILD', 'result-gf03-f4-src');
    store.claimAdmittedTask({ sourceTaskId: 'GF03-F4-SRC', workerId: 'worker-a' });
    rmSync(claimPath(home, 'GF03-F4-CHILD'));
    assert.throws(
      () => store.readRunnableOccurrence({ sourceTaskId: 'GF03-F4-SRC' }),
      (error) => error?.code === 'CLAIM_NOT_FOUND',
    );
    assert.equal(
      existsSync(claimPath(home, 'GF03-F4-CHILD')),
      false,
      'claim is never auto-recreated',
    );
  } finally {
    removeHome(home);
  }
});

test('F5. terminal occurrence reads TERMINAL and refuses new claims without byte change', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'GF03-F5-SRC', 'GF03-F5-CHILD', 'result-gf03-f5-src');
    const claimed = store.claimAdmittedTask({ sourceTaskId: 'GF03-F5-SRC', workerId: 'worker-a' });
    store.deliverResult(sampleResult(claimed.claim, { resultId: 'result-gf03-f5-child' }));
    const claimBytes = readFileSync(claimPath(home, 'GF03-F5-CHILD'), 'utf8');
    const occurrence = store.readRunnableOccurrence({ sourceTaskId: 'GF03-F5-SRC' });
    assert.equal(occurrence.occurrenceState, RUNNABLE_OCCURRENCE_STATE_TERMINAL);
    assert.equal(occurrence.claim.workerId, 'worker-a');

    const replay = store.claimAdmittedTask({ sourceTaskId: 'GF03-F5-SRC', workerId: 'worker-b' });
    assert.equal(replay.duplicate, true);
    assert.equal(replay.terminal, true);
    assert.equal(replay.claim.workerId, 'worker-a');
    assert.equal(readFileSync(claimPath(home, 'GF03-F5-CHILD'), 'utf8'), claimBytes);
    assert.equal(
      JSON.stringify(store.readRunnableOccurrence({ sourceTaskId: 'GF03-F5-SRC' })),
      JSON.stringify(occurrence),
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// BOUNDARY. occurrence read composes existing authorities only.
// ---------------------------------------------------------------------------

test('BOUNDARY. no scheduler, no durable occurrence family, no second generation authority', () => {
  assert.equal(
    resolveCoordinationHome({ env: {}, platform: 'win32', override: null }).length > 0,
    true,
  );
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });

    const exportKeys = Object.keys(runnableOccurrence).sort();
    assert.deepEqual(exportKeys, [
      'BLOCKED_RUNNABLE_OCCURRENCE_FIELDS',
      'MAX_RUNNABLE_OCCURRENCE_ID_FIELD_LENGTH',
      'MAX_RUNNABLE_OCCURRENCE_JSON_BYTES',
      'RUNNABLE_OCCURRENCE_CLAIM_FIELDS',
      'RUNNABLE_OCCURRENCE_ID_PREFIX',
      'RUNNABLE_OCCURRENCE_RECORD_FIELDS',
      'RUNNABLE_OCCURRENCE_SCHEMA_VERSION',
      'RUNNABLE_OCCURRENCE_STATES',
      'RUNNABLE_OCCURRENCE_STATE_CLAIMED',
      'RUNNABLE_OCCURRENCE_STATE_RUNNABLE',
      'RUNNABLE_OCCURRENCE_STATE_TERMINAL',
      'RunnableOccurrenceValidationError',
      'assertValidRunnableOccurrenceSlot',
      'buildRunnableOccurrenceId',
      'buildRunnableOccurrenceRecord',
      'validateRunnableOccurrenceRecord',
    ]);
    assert.equal(RUNNABLE_OCCURRENCE_SCHEMA_VERSION, '1');
    assert.equal(DEFAULT_EMISSION_SLOT, 'next');

    const moduleSource = readFileSync(join(MODULE_DIRECTORY, 'runnable-occurrence.mjs'), 'utf8');
    for (const forbiddenToken of [
      "from 'node:fs'",
      'node:child_process',
      'readdir',
      'writeFileSync',
      'mkdirSync',
      'spawn(',
      'Date.now',
      'new Date(',
      'performance.now',
      'setTimeout',
      'setInterval',
    ]) {
      assert.equal(
        moduleSource.includes(forbiddenToken),
        false,
        `occurrence contract module must not contain ${forbiddenToken}`,
      );
    }
    assert.equal(
      moduleSource.includes('workerId'),
      true,
      'the projection names the worker binding',
    );
    assert.equal(
      moduleSource.includes('claimGeneration'),
      true,
      'the projection names the sole claim generation',
    );

    assert.equal(typeof store.readRunnableOccurrence, 'function');
    for (const forbidden of [
      'createRunnableOccurrence',
      'materializeRunnableOccurrence',
      'scheduleNextTask',
      'schedule',
      'dispatchNextTask',
      'claimNextTask',
      'autoClaim',
      'selectWorker',
      'selectExecutor',
      'inferWorker',
      'workerRegistry',
      'pollReady',
      'runScheduler',
      'autonomousLoop',
      'createOccurrence',
    ]) {
      assert.equal(store[forbidden], undefined, `${forbidden} must not exist`);
    }
    assert.notEqual(
      CoordinationStore.prototype.readRunnableOccurrence,
      CoordinationStore.prototype.claimAdmittedTask,
    );
    assert.notEqual(
      CoordinationStore.prototype.readRunnableOccurrence,
      CoordinationStore.prototype.readCanonicalSchedulableWork,
    );

    driveToAdmitted(store, clock, 'GF03-BND-SRC', 'GF03-BND-CHILD', 'result-gf03-bnd-src');
    const before = snapshotHome(home);
    const occurrence = store.readRunnableOccurrence({ sourceTaskId: 'GF03-BND-SRC' });
    assert.equal(occurrence.occurrenceState, RUNNABLE_OCCURRENCE_STATE_RUNNABLE);
    assert.deepEqual(snapshotHome(home), before, 'the occurrence read is zero-write');
    assert.equal(
      Object.values(snapshotHome(home)).some((content) => content.includes('occurrenceId')),
      false,
      'no durable occurrence record may exist',
    );
    assert.equal(
      Object.keys(snapshotHome(home)).some((path) => path.includes('occurrences')),
      false,
      'no durable occurrence namespace may exist',
    );
    assert.equal(
      Object.keys(occurrence).includes('generation') ||
        Object.keys(occurrence).includes('executionGeneration'),
      false,
      'no separate occurrence generation authority may exist',
    );
  } finally {
    removeHome(home);
  }
});
