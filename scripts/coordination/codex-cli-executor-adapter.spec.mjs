// Proof for GREENHUB-COORDINATION-CONCRETE-CODEX-CLI-EXECUTOR-ADAPTER-31.
//
// VALIDATED TASK 28 EXECUTOR INVOCATION ATTEMPT (handed over by Task 29)
//   -> Task 29 caller-supplied adapter invocation
//   -> concrete Codex CLI process boundary                      [this Task]
//   -> exact Task 30 outcome contract { schemaVersion: 1, dispatchId, outcome }.
//
// CONCRETE CODEX CLI INVOCATION != task started != task RUNNING != task
// completed != code modified != tests passed != result delivered != ACK
// persisted != executor receipt != retry permission != global exactly-once
// execution.
//
// Deliberately NO whole-file SHA256 predecessor pin chain: predecessor
// immutability is proven by the publication delta (git changed-path proof:
// only the two new Task 31 files), by running the Task 29/30 suites and the
// Task 24~30 predecessor chain, and by the static/behavioral boundary
// assertions below (the production module imports the Task 30 outcome
// vocabulary and nothing else from the coordination durable chain).
//
// Proof map:
//   A. the adapter consumes ONLY the exact Task 28 record handed over by
//      Task 29; no store / durable read of its own.
//   B. exact argv: absolute configured executable, fixed flags, --cd workdir,
//      payload as ONE argv element; no shell interpolation; the task payload
//      never changes command/options/cwd; minimized environment boundary.
//   C. at-most-once: invalid config/record => zero runner calls; an ambiguous
//      result never produces a second invocation.
//   D. ACCEPTED mapping (exit code 0).
//   E. REJECTED mapping (non-zero exit code), never a task failure meaning.
//   F. UNKNOWN mapping (no observable exit status), never a retry.
//   G. malformed runner results fail closed; start-failed is a typed
//      configuration/process-start error, never UNKNOWN; no retry.
//   H. runner sync throw: exact identity propagation.
//   I. runner async rejection: exact identity propagation.
//   J. dispatchId exact preservation; invalid record identity => zero calls.
//   K. no new identity/generation: exactly { schemaVersion, dispatchId,
//      outcome }; claimGeneration stays the SOLE fencing generation.
//   L. no durable mutation: coordination home byte+stat snapshot unchanged.
//   M. task remains CLAIMED; no RUNNING/ACKED status authority.
//   N. no ACK/receipt/result persistence or new artifact namespace.
//   O. no registry/selection/fallback/retry; static process boundary; exact
//      exported surface.
//   P. Task 30 composition:
//      invokeExecutorAndValidateOutcome({ dispatchId, store, adapter })
//      works exactly once and returns the canonical Task 30 outcome.
//   Q. predecessor regression: Task 29/30 public surfaces unchanged.
//
// No test in this file spawns a real Codex CLI process: every runner is an
// injected fake. All runtime state lives in isolated temp directories.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CODEX_CLI_EXECUTOR_ENV_ALLOWLIST,
  CODEX_CLI_EXECUTOR_PROCESS_START_FAILED,
  CodexCliExecutorAdapterError,
  createCodexCliExecutorAdapter,
  INVALID_CODEX_CLI_EXECUTOR_ADAPTER_CONFIGURATION,
  INVALID_CODEX_CLI_EXECUTOR_RUNNER_RESULT,
  INVALID_CODEX_CLI_EXECUTOR_TASK28_RECORD,
} from './codex-cli-executor-adapter.mjs';
import {
  acceptExecutorDispatchDecision,
  executorDispatchAcceptanceFilePath,
} from './dispatch-executor-acceptance.mjs';
import {
  EXECUTOR_INVOCATION_ATTEMPTS_DIRNAME,
  persistExecutorInvocationAttempt,
} from './dispatch-executor-invocation-attempt.mjs';
import { invokeExecutorInvocationAdapter } from './dispatch-executor-invocation-contract.mjs';
import { readExecutorInvocationInput } from './dispatch-executor-invocation-input.mjs';
import {
  EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
  EXECUTOR_INVOCATION_OUTCOME_FIELDS,
  EXECUTOR_INVOCATION_OUTCOME_REJECTED,
  EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION,
  EXECUTOR_INVOCATION_OUTCOME_UNKNOWN,
  EXECUTOR_INVOCATION_OUTCOME_VALUES,
  invokeExecutorAndValidateOutcome,
} from './dispatch-executor-invocation-outcome.mjs';
import { acceptReceiverDispatch } from './dispatch-receiver-acceptance.mjs';
import { persistReceiverDecision } from './dispatch-receiver-decision.mjs';
import { prepareDispatchTransportRequest } from './dispatch-transport-contract.mjs';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import { CoordinationStore } from './store.mjs';
import { TASK_STATUS_CLAIMED } from './task-envelope.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = join(MODULE_DIRECTORY, 'codex-cli-executor-adapter.mjs');

const FAKE_EXECUTABLE = resolve(process.cwd(), 'fake-codex-cli', 'codex.exe');
const FAKE_WORKDIR = resolve(process.cwd(), 'fake-workdir');

const FORBIDDEN_NEW_ARTIFACT_DIRS = Object.freeze([
  'outcomes',
  'invocation-outcomes',
  'executor-invocation-outcomes',
  'executor-invocations',
  'invocations',
  'adapter-runs',
  'executor-runs',
  'process-records',
  'pids',
  'scheduler',
  'queue',
  'retry',
  'backoff',
  'ack',
  'acks',
  'receipt',
  'receipts',
  'dispatched',
  'sent',
  'running',
  'execution',
]);

const FORBIDDEN_OUTCOME_TOKENS = Object.freeze([
  'acknowledgedAt',
  'acknowledgedBy',
  'ackDispatch',
  'receipt',
  'resultId',
  'disposition',
  'executionStarted',
  'executionAllowed',
  'executorInvoked',
  'executorStarted',
  'invokedAt',
  'startedAt',
  'completedAt',
  'attemptedAt',
  'receivedAt',
  'acceptedAt',
  'retryCount',
  'attemptNumber',
  'pid',
  'hostname',
  'endpoint',
  'workerId',
  'executorId',
  'executorGeneration',
  'invocationGeneration',
  'executionGeneration',
  'retryGeneration',
  'generation',
  'status',
]);

function makeHome(prefix = 'greenhub-codex-cli-adapter31-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'CONCRETE_CODEX_CLI_EXECUTOR_ADAPTER_PROVED',
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
    proofRequirement: ['codex-cli-executor-adapter-proof'],
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

function driveToEmitted(
  store,
  clock,
  sourceTaskId,
  childTaskId,
  sourceResultId = 'result-0001',
  nextTaskOverrides = {},
) {
  driveToConsumed(store, clock, sourceTaskId, sourceResultId);
  const out = store.emitNextTask({
    sourceTaskId,
    nextTaskSpec: sampleTaskInput(childTaskId, nextTaskOverrides),
    emitterId: 'control-tower-1',
  });
  clock.advance(1000);
  return out;
}

function driveToAdmitted(
  store,
  clock,
  sourceTaskId,
  childTaskId,
  sourceResultId = 'result-0001',
  nextTaskOverrides = {},
) {
  const emitted = driveToEmitted(
    store,
    clock,
    sourceTaskId,
    childTaskId,
    sourceResultId,
    nextTaskOverrides,
  );
  const admitted = store.admitEmittedTask({ sourceTaskId, admitterId: 'control-tower-1' });
  clock.advance(1000);
  return { emitted, admitted };
}

function driveToClaimed(
  store,
  clock,
  sourceTaskId,
  childTaskId,
  sourceResultId = 'result-0001',
  nextTaskOverrides = {},
  workerId = 'worker-a',
) {
  const setup = driveToAdmitted(
    store,
    clock,
    sourceTaskId,
    childTaskId,
    sourceResultId,
    nextTaskOverrides,
  );
  const claimed = store.claimAdmittedTask({ sourceTaskId, workerId });
  clock.advance(1000);
  return { ...setup, claimed };
}

function driveToAttempt(
  store,
  clock,
  sourceTaskId,
  childTaskId,
  sourceResultId = 'result-0001',
  nextTaskOverrides = {},
  workerId = 'worker-a',
) {
  const setup = driveToClaimed(
    store,
    clock,
    sourceTaskId,
    childTaskId,
    sourceResultId,
    nextTaskOverrides,
    workerId,
  );
  const attempt = store.persistDispatchAttempt({ sourceTaskId, workerId });
  clock.advance(1000);
  return { ...setup, attempt };
}

// Task 31 setup: the full Task 18~28 durable chain ends with the durable Task
// 28 executor invocation attempt, which is the EXACT record Task 29 hands to
// the adapter.
async function setupAccepted(prefix, sourceTaskId, childTaskId, nextTaskOverrides = {}) {
  const home = makeHome(prefix);
  const clock = controllableClock();
  const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
  const { attempt } = driveToAttempt(
    store,
    clock,
    sourceTaskId,
    childTaskId,
    `result-${sourceTaskId.toLowerCase()}`,
    nextTaskOverrides,
  );
  const request = prepareDispatchTransportRequest({
    store,
    sourceTaskId,
    dispatchId: attempt.dispatchId,
  });
  const accepted = await acceptReceiverDispatch({ request, store });
  assert.equal(accepted.newlyAccepted, true);
  const decided = await persistReceiverDecision({ dispatchId: attempt.dispatchId, store });
  assert.equal(decided.newlyDecided, true);
  const executorAccepted = await acceptExecutorDispatchDecision({
    dispatchId: attempt.dispatchId,
    store,
  });
  assert.equal(executorAccepted.newlyAccepted, true);
  const persisted = await persistExecutorInvocationAttempt({
    dispatchId: attempt.dispatchId,
    store,
  });
  assert.equal(persisted.newlyPersisted, true);
  return { home, clock, store, attempt, dispatchId: attempt.dispatchId };
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

function snapshotHomeStats(home) {
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
        const stat = statSync(full);
        out[full.slice(home.length + 1)] = { size: stat.size, mtimeMs: stat.mtimeMs };
      }
    }
  };
  walk(home);
  return out;
}

// Boundary greps inspect functional code only; header/line comments
// legitimately document forbidden names as prohibitions.
function codeOnly(source) {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    })
    .join('\n');
}

function listAttemptFiles(home) {
  try {
    return [...readdirSync(join(home, EXECUTOR_INVOCATION_ATTEMPTS_DIRNAME))].sort();
  } catch {
    return [];
  }
}

// Strongest "no alternate primitive consulted" probe: every property access on
// the store is recorded as an ordered event, and every function-valued
// property invocation is recorded with its arguments.
function eventRecordingStore(target) {
  const events = [];
  const store = new Proxy(target, {
    get(object, property, receiver) {
      if (typeof property === 'string') events.push(`get:${property}`);
      const value = Reflect.get(object, property, receiver);
      if (typeof value === 'function') {
        return (...args) => {
          events.push(`call:${property}`);
          return value.apply(object, args);
        };
      }
      return value;
    },
  });
  return { events, store };
}

function fakeRunner(responder) {
  const calls = [];
  const runner = (request) => {
    calls.push(request);
    return typeof responder === 'function' ? responder(calls.length) : responder;
  };
  return { calls, runner };
}

function makeAdapter(runner, overrides = {}) {
  return createCodexCliExecutorAdapter({
    executablePath: FAKE_EXECUTABLE,
    workdir: FAKE_WORKDIR,
    runner,
    ...overrides,
  });
}

function adapterErrorWithCode(code) {
  return (error) => error instanceof CodexCliExecutorAdapterError && error.code === code;
}

function assertCanonicalOutcome(result, dispatchId, outcome) {
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(Object.keys(result), ['schemaVersion', 'dispatchId', 'outcome']);
  assert.equal(result.schemaVersion, EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION);
  assert.equal(result.dispatchId, dispatchId);
  assert.equal(result.outcome, outcome);
}

// ---------------------------------------------------------------------------
// A. EXACT TASK 28 RECORD INPUT; NO ALTERNATE STORE/STATE READ.
// ---------------------------------------------------------------------------

test('A. the adapter consumes ONLY the exact Task 28 record handed over by Task 29 and reads no durable state of its own', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-codex-cli-adapter31-a-',
    'CCEA31-A-SRC',
    'CCEA31-A-CHILD',
  );
  try {
    const record = store.readExecutorInvocationAttempt(dispatchId);
    const { calls, runner } = fakeRunner({ kind: 'exited', code: 0 });
    const adapter = makeAdapter(runner);

    // The narrow configuration boundary rejects a store-shaped field: this
    // module has no durable read path at all.
    assert.throws(
      () =>
        createCodexCliExecutorAdapter({
          executablePath: FAKE_EXECUTABLE,
          workdir: FAKE_WORKDIR,
          runner,
          store,
        }),
      adapterErrorWithCode(INVALID_CODEX_CLI_EXECUTOR_ADAPTER_CONFIGURATION),
    );

    const result = await adapter(record);

    assert.equal(calls.length, 1);
    assert.deepEqual(Object.keys(calls[0]), ['command', 'args', 'cwd', 'env']);
    assert.equal(calls[0].args.length, 7);
    // The prompt is EXACTLY the passed record (no wrapper metadata, no
    // reconstruction, no re-read): canonical compact JSON as one argv element.
    assert.equal(calls[0].args[6], JSON.stringify(record));
    assert.deepEqual(JSON.parse(calls[0].args[6]), store.readExecutorInvocationAttempt(dispatchId));
    // The execution payload authority record.decisionInput.task travels
    // verbatim from the durable bytes.
    const durableBytes = JSON.parse(
      readFileSync(join(home, EXECUTOR_INVOCATION_ATTEMPTS_DIRNAME, `${dispatchId}.json`), 'utf8'),
    );
    assert.deepEqual(
      JSON.parse(calls[0].args[6]).decisionInput.task,
      durableBytes.decisionInput.task,
    );
    assertCanonicalOutcome(result, dispatchId, EXECUTOR_INVOCATION_OUTCOME_ACCEPTED);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// B. EXACT ARGV; NO SHELL INTERPOLATION; TASK PAYLOAD CANNOT MOVE THE BOUNDARY.
// ---------------------------------------------------------------------------

const SHELL_METACHARACTER_EXIT_STATE = 'noop; $(touch pwned) & `id` %PATH% !BANG!';
const SHELL_METACHARACTER_PROOF =
  '$(touch INJECTED) `touch INJECTED` & | ; > < "quoted" \'single\' %COMSPEC% !DELAYED!';

test('B. exact shell-free argv with fixed executable/workdir and the Task 28 record as ONE payload argument', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-codex-cli-adapter31-b-',
    'CCEA31-B-SRC',
    'CCEA31-B-CHILD',
    {
      desiredExitState: SHELL_METACHARACTER_EXIT_STATE,
      proofRequirement: [SHELL_METACHARACTER_PROOF],
    },
  );
  try {
    process.env.GREENHUB_TASK31_PLANTED_SECRET = 'planted-secret-value';
    const record = store.readExecutorInvocationAttempt(dispatchId);
    // A hostile record variant whose envelope tries to move the process
    // boundary: none of these may influence command/args/cwd/env.
    const hostileRecord = {
      ...record,
      decisionInput: {
        ...record.decisionInput,
        task: {
          ...record.decisionInput.task,
          executablePath: resolve(process.cwd(), 'hostile', 'calc.exe'),
          workdir: resolve(process.cwd(), 'hostile-workdir'),
          cwd: resolve(process.cwd(), 'hostile-cwd'),
          command: 'hostile.exe --flag',
          env: { GREENHUB_HOSTILE: '1' },
          runner: 'hostile-runner',
        },
      },
    };
    const { calls, runner } = fakeRunner({ kind: 'exited', code: 0 });
    const adapter = makeAdapter(runner);

    const first = await adapter(hostileRecord);
    assertCanonicalOutcome(first, dispatchId, EXECUTOR_INVOCATION_OUTCOME_ACCEPTED);

    assert.equal(calls.length, 1);
    const call = calls[0];
    // Executable is EXACTLY the configured absolute path: no prefix, no
    // appended args, no shell wrapper, nothing from the task payload.
    assert.equal(call.command, FAKE_EXECUTABLE);
    // Fixed argv prefix: subcommand, read-only sandbox, ephemeral session,
    // explicit working root, then the payload as ONE element.
    assert.deepEqual(call.args.slice(0, 6), [
      'exec',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--cd',
      FAKE_WORKDIR,
    ]);
    assert.equal(call.args.length, 7);
    assert.equal(call.args[6], JSON.stringify(hostileRecord));
    // Shell metacharacters, quotes, and hostile boundary keys travel verbatim
    // inside the JSON payload: they are data, not shell syntax. JSON escaping
    // is the only transformation and the values round-trip exactly.
    const delivered = JSON.parse(call.args[6]);
    assert.equal(delivered.decisionInput.task.desiredExitState, SHELL_METACHARACTER_EXIT_STATE);
    assert.equal(delivered.decisionInput.task.proofRequirement[0], SHELL_METACHARACTER_PROOF);
    assert.ok(call.args[6].includes('hostile.exe --flag'));
    // cwd is the configured workdir and matches the --cd working root.
    assert.equal(call.cwd, FAKE_WORKDIR);
    assert.equal(call.args[4], '--cd');
    assert.equal(call.args[5], call.cwd);

    // Environment boundary: fixed allowlist projection only; a planted
    // operator variable outside the allowlist never reaches the child.
    const envKeys = Object.keys(call.env);
    for (const key of envKeys) {
      assert.ok(CODEX_CLI_EXECUTOR_ENV_ALLOWLIST.includes(key), key);
    }
    assert.equal(envKeys.includes('GREENHUB_TASK31_PLANTED_SECRET'), false);
    assert.equal(Object.getPrototypeOf(call.env), null);
    assert.ok(Object.isFrozen(call.env));

    // A different payload (the exact durable record) never moves the boundary.
    const second = await adapter(record);
    assertCanonicalOutcome(second, dispatchId, EXECUTOR_INVOCATION_OUTCOME_ACCEPTED);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].command, FAKE_EXECUTABLE);
    assert.deepEqual(calls[1].args.slice(0, 6), calls[0].args.slice(0, 6));
    assert.equal(calls[1].cwd, FAKE_WORKDIR);
    assert.notEqual(calls[1].args[6], calls[0].args[6]);

    // Static shell-safety boundary: argv-only spawn with shell explicitly off;
    // no shell-string execution primitives exist in the module.
    const code = codeOnly(readFileSync(MODULE_PATH, 'utf8'));
    assert.ok(code.includes('shell: false'));
    for (const forbidden of [
      'shell: true',
      'exec(',
      'execSync(',
      'execFile(',
      'execFileSync(',
      'spawnSync(',
      'fork(',
      'cmd.exe',
      'powershell',
      '/bin/sh',
      'bash -c',
    ]) {
      assert.equal(code.includes(forbidden), false, `code must not contain ${forbidden}`);
    }
    const spawnOccurrences = code.split('spawn(').length - 1;
    assert.equal(spawnOccurrences, 1);
  } finally {
    delete process.env.GREENHUB_TASK31_PLANTED_SECRET;
    removeHome(home);
  }
});

test('B2. explicit caller-supplied env replaces the allowlist projection exactly', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-codex-cli-adapter31-b2-',
    'CCEA31-B2-SRC',
    'CCEA31-B2-CHILD',
  );
  try {
    const record = store.readExecutorInvocationAttempt(dispatchId);
    const { calls, runner } = fakeRunner({ kind: 'exited', code: 0 });
    const adapter = makeAdapter(runner, { env: { CODEX_HOME: 'C:\\fake-codex-home' } });
    const result = await adapter(record);
    assertCanonicalOutcome(result, dispatchId, EXECUTOR_INVOCATION_OUTCOME_ACCEPTED);
    assert.deepEqual(Object.keys(calls[0].env), ['CODEX_HOME']);
    assert.equal(calls[0].env.CODEX_HOME, 'C:\\fake-codex-home');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// C. AT-MOST-ONCE: INVALID CONFIG/RECORD => ZERO CALLS; NO SECOND CALL.
// ---------------------------------------------------------------------------

test('C. one adapter call invokes the runner at most once; invalid configuration and invalid records invoke it zero times', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-codex-cli-adapter31-c-',
    'CCEA31-C-SRC',
    'CCEA31-C-CHILD',
  );
  try {
    const record = store.readExecutorInvocationAttempt(dispatchId);

    // Invalid configuration fails closed at creation: no adapter, no runner.
    const { calls: unusedCalls, runner } = fakeRunner({ kind: 'exited', code: 0 });
    const invalidConfigurations = [
      {},
      { executablePath: FAKE_EXECUTABLE },
      { workdir: FAKE_WORKDIR },
      { executablePath: 'codex.exe', workdir: FAKE_WORKDIR },
      { executablePath: FAKE_EXECUTABLE, workdir: 'relative-workdir' },
      { executablePath: '   ', workdir: FAKE_WORKDIR },
      { executablePath: FAKE_EXECUTABLE, workdir: FAKE_WORKDIR, runner: 'not-a-function' },
      { executablePath: FAKE_EXECUTABLE, workdir: FAKE_WORKDIR, runner: null },
      { executablePath: FAKE_EXECUTABLE, workdir: FAKE_WORKDIR, env: 'not-a-record' },
      { executablePath: FAKE_EXECUTABLE, workdir: FAKE_WORKDIR, env: { A: 1 } },
      { executablePath: FAKE_EXECUTABLE, workdir: FAKE_WORKDIR, env: { 'A=B': 'x' } },
      { executablePath: FAKE_EXECUTABLE, workdir: FAKE_WORKDIR, model: 'gpt-6-astra' },
      { executablePath: FAKE_EXECUTABLE, workdir: FAKE_WORKDIR, store },
    ].map((configuration) =>
      Object.hasOwn(configuration, 'runner') ? configuration : { ...configuration, runner },
    );
    for (const configuration of invalidConfigurations) {
      assert.throws(
        () => createCodexCliExecutorAdapter(configuration),
        adapterErrorWithCode(INVALID_CODEX_CLI_EXECUTOR_ADAPTER_CONFIGURATION),
        JSON.stringify(Object.keys(configuration)),
      );
    }
    // Also invalid shapes of the whole configuration object.
    for (const configuration of [null, 42, 'config', []]) {
      assert.throws(
        () => createCodexCliExecutorAdapter(configuration),
        adapterErrorWithCode(INVALID_CODEX_CLI_EXECUTOR_ADAPTER_CONFIGURATION),
      );
    }

    // Invalid record input rejects BEFORE any process invocation.
    const adapter = makeAdapter(runner);
    const invalidRecords = [
      undefined,
      null,
      42,
      'record',
      [],
      {},
      { dispatchId: '' },
      { dispatchId: 42, decisionInput: { task: {} } },
      { dispatchId: 'dsp_x', decisionInput: null },
      { dispatchId: 'dsp_x', decisionInput: {} },
      { dispatchId: 'dsp_x', decisionInput: { task: null } },
      { dispatchId: 'dsp_x', decisionInput: { task: [] } },
      new (class FakeRecord {
        constructor() {
          this.dispatchId = 'dsp_x';
        }
      })(),
    ];
    for (const invalidRecord of invalidRecords) {
      await assert.rejects(
        adapter(invalidRecord),
        adapterErrorWithCode(INVALID_CODEX_CLI_EXECUTOR_TASK28_RECORD),
        String(invalidRecord),
      );
    }
    assert.equal(unusedCalls.length, 0);

    // Valid input: exactly one invocation per adapter call.
    const first = await adapter(record);
    assertCanonicalOutcome(first, dispatchId, EXECUTOR_INVOCATION_OUTCOME_ACCEPTED);
    assert.equal(unusedCalls.length, 1);

    // An ambiguous result never produces a second invocation.
    const { calls: ambiguousCalls, runner: ambiguousRunner } = fakeRunner({
      kind: 'terminated-without-exit-status',
    });
    const ambiguousAdapter = makeAdapter(ambiguousRunner);
    const ambiguous = await ambiguousAdapter(record);
    assertCanonicalOutcome(ambiguous, dispatchId, EXECUTOR_INVOCATION_OUTCOME_UNKNOWN);
    assert.equal(ambiguousCalls.length, 1);

    // A rejected result never produces a second invocation either.
    const { calls: rejectedCalls, runner: rejectedRunner } = fakeRunner({
      kind: 'exited',
      code: 1,
    });
    const rejectedAdapter = makeAdapter(rejectedRunner);
    const rejected = await rejectedAdapter(record);
    assertCanonicalOutcome(rejected, dispatchId, EXECUTOR_INVOCATION_OUTCOME_REJECTED);
    assert.equal(rejectedCalls.length, 1);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// D. ACCEPTED MAPPING.
// ---------------------------------------------------------------------------

test('D. exit code 0 maps to the exact ACCEPTED outcome record', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-codex-cli-adapter31-d-',
    'CCEA31-D-SRC',
    'CCEA31-D-CHILD',
  );
  try {
    const record = store.readExecutorInvocationAttempt(dispatchId);
    const { calls, runner } = fakeRunner({ kind: 'exited', code: 0 });
    const result = await makeAdapter(runner)(record);

    assert.equal(calls.length, 1);
    assertCanonicalOutcome(result, dispatchId, EXECUTOR_INVOCATION_OUTCOME_ACCEPTED);
    // ACCEPTED carries no start/completion/ACK/receipt/status metadata.
    const resultJson = JSON.stringify(result);
    for (const token of FORBIDDEN_OUTCOME_TOKENS) {
      assert.equal(resultJson.includes(token), false, token);
    }
    assert.equal(EXECUTOR_INVOCATION_OUTCOME_VALUES.includes(result.outcome), true);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. REJECTED MAPPING.
// ---------------------------------------------------------------------------

test('E. non-zero exit codes map to REJECTED without any task failure meaning', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-codex-cli-adapter31-e-',
    'CCEA31-E-SRC',
    'CCEA31-E-CHILD',
  );
  try {
    const record = store.readExecutorInvocationAttempt(dispatchId);
    for (const code of [1, 2, 64, 127, 255, 9009]) {
      const { calls, runner } = fakeRunner({ kind: 'exited', code });
      const result = await makeAdapter(runner)(record);
      assert.equal(calls.length, 1, `code ${code}`);
      assertCanonicalOutcome(result, dispatchId, EXECUTOR_INVOCATION_OUTCOME_REJECTED);
    }
    // REJECTED is a process-boundary report ONLY: the task never moved.
    assert.equal(store.readTask('CCEA31-E-CHILD').status, TASK_STATUS_CLAIMED);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. UNKNOWN MAPPING (EXPLICIT, NEVER A RETRY).
// ---------------------------------------------------------------------------

test('F. an unobservable exit status maps to the explicit UNKNOWN outcome and never triggers a retry', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-codex-cli-adapter31-f-',
    'CCEA31-F-SRC',
    'CCEA31-F-CHILD',
  );
  try {
    const record = store.readExecutorInvocationAttempt(dispatchId);
    const { calls, runner } = fakeRunner({ kind: 'terminated-without-exit-status' });
    const result = await makeAdapter(runner)(record);
    assert.equal(calls.length, 1);
    assertCanonicalOutcome(result, dispatchId, EXECUTOR_INVOCATION_OUTCOME_UNKNOWN);
    // UNKNOWN creates no durable retry marker or new attempt.
    assert.deepEqual(listAttemptFiles(home), [`${dispatchId}.json`]);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// G. MALFORMED RUNNER RESULT / START FAILURE: FAIL CLOSED, NO RETRY.
// ---------------------------------------------------------------------------

test('G. malformed runner results fail closed and process start failures are typed errors, never UNKNOWN', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-codex-cli-adapter31-g-',
    'CCEA31-G-SRC',
    'CCEA31-G-CHILD',
  );
  try {
    const record = store.readExecutorInvocationAttempt(dispatchId);

    const malformed = [
      undefined,
      null,
      42,
      'exited',
      [],
      new Map(),
      new Date(0),
      {},
      { kind: 'exited' },
      { kind: 'exited', code: '0' },
      { kind: 'exited', code: 1.5 },
      { kind: 'exited', code: 0, signal: null },
      { kind: 'exited', code: 0, outcome: 'ACCEPTED' },
      { kind: 'terminated-without-exit-status', signal: 'SIGKILL' },
      { kind: 'start-failed' },
      { kind: 'start-failed', errorCode: '' },
      { kind: 'start-failed', errorCode: 42 },
      { kind: 'accepted' },
      { kind: 'REJECTED' },
    ];
    for (const result of malformed) {
      const { calls, runner } = fakeRunner(result);
      await assert.rejects(
        makeAdapter(runner)(record),
        adapterErrorWithCode(INVALID_CODEX_CLI_EXECUTOR_RUNNER_RESULT),
        String(result),
      );
      assert.equal(calls.length, 1, String(result));
    }

    // A symbol-keyed runner result is malformed too.
    const symbolResult = { kind: 'exited', code: 0, [Symbol('smuggled')]: 1 };
    const { calls: symbolCalls, runner: symbolRunner } = fakeRunner(symbolResult);
    await assert.rejects(
      makeAdapter(symbolRunner)(record),
      adapterErrorWithCode(INVALID_CODEX_CLI_EXECUTOR_RUNNER_RESULT),
    );
    assert.equal(symbolCalls.length, 1);

    // Process start failure is a configuration/process-start error, never a
    // protocol outcome and never UNKNOWN.
    for (const errorCode of ['ENOENT', 'EACCES', 'EPERM', 'EMFILE']) {
      const { calls, runner } = fakeRunner({ kind: 'start-failed', errorCode });
      await assert.rejects(
        makeAdapter(runner)(record),
        adapterErrorWithCode(CODEX_CLI_EXECUTOR_PROCESS_START_FAILED),
        errorCode,
      );
      assert.equal(calls.length, 1, errorCode);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// H. RUNNER SYNC THROW: EXACT IDENTITY PROPAGATION.
// ---------------------------------------------------------------------------

test('H. a synchronous runner throw reaches the caller with the exact same value and is never normalized', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-codex-cli-adapter31-h-',
    'CCEA31-H-SRC',
    'CCEA31-H-CHILD',
  );
  try {
    const record = store.readExecutorInvocationAttempt(dispatchId);

    const errorSentinel = new Error('runner exploded (sync)');
    const stringSentinel = 'runner-string-failure';
    const outcomeShapedSentinel = { schemaVersion: 1, dispatchId, outcome: 'ACCEPTED' };

    for (const sentinel of [errorSentinel, stringSentinel, outcomeShapedSentinel]) {
      const { calls, runner } = fakeRunner(() => {
        throw sentinel;
      });
      await assert.rejects(makeAdapter(runner)(record), (error) => error === sentinel);
      assert.equal(calls.length, 1);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// I. RUNNER ASYNC REJECTION: EXACT IDENTITY PROPAGATION.
// ---------------------------------------------------------------------------

test('I. a rejected runner promise reaches the caller with the exact same value and is never converted to UNKNOWN', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-codex-cli-adapter31-i-',
    'CCEA31-I-SRC',
    'CCEA31-I-CHILD',
  );
  try {
    const record = store.readExecutorInvocationAttempt(dispatchId);

    const asyncSentinel = new Error('runner rejected (async)');
    await assert.rejects(
      makeAdapter(async () => {
        throw asyncSentinel;
      })(record),
      (error) => error === asyncSentinel,
    );

    const rejectedSentinel = Object.freeze({ marker: 'REJECTED_SENTINEL' });
    let rejectionCalls = 0;
    const rejectingRunner = () => {
      rejectionCalls += 1;
      return Promise.reject(rejectedSentinel);
    };
    await assert.rejects(
      makeAdapter(rejectingRunner)(record),
      (error) => error === rejectedSentinel,
    );
    assert.equal(rejectionCalls, 1);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// J. DISPATCHID EXACT PRESERVATION; INVALID RECORD IDENTITY => ZERO CALLS.
// ---------------------------------------------------------------------------

test('J. the outcome carries the exact dispatchId and never creates a new identity', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-codex-cli-adapter31-j-',
    'CCEA31-J-SRC',
    'CCEA31-J-CHILD',
  );
  try {
    const record = store.readExecutorInvocationAttempt(dispatchId);
    assert.match(dispatchId, /^dsp_[0-9a-f]{64}$/);
    assert.equal(dispatchId, record.dispatchId);

    const { calls, runner } = fakeRunner({ kind: 'exited', code: 0 });
    const result = await makeAdapter(runner)(record);
    assert.equal(result.dispatchId, dispatchId);
    assert.equal(typeof result.dispatchId, 'string');
    assert.equal(JSON.stringify(result).includes(`${dispatchId}-`), false);
    assert.equal(calls.length, 1);

    // Non-string / empty dispatchId identities never reach the runner.
    const { calls: invalidCalls, runner: invalidRunner } = fakeRunner({ kind: 'exited', code: 0 });
    const adapter = makeAdapter(invalidRunner);
    for (const dispatchIdVariant of [undefined, null, 42, '', '   ', {}, []]) {
      await assert.rejects(
        adapter({ ...record, dispatchId: dispatchIdVariant }),
        adapterErrorWithCode(INVALID_CODEX_CLI_EXECUTOR_TASK28_RECORD),
      );
    }
    assert.equal(invalidCalls.length, 0);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// K. NO NEW GENERATION / IDENTITY AUTHORITY.
// ---------------------------------------------------------------------------

test('K. the outcome is exactly (schemaVersion, dispatchId, outcome) and claimGeneration stays the sole generation', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-codex-cli-adapter31-k-',
    'CCEA31-K-SRC',
    'CCEA31-K-CHILD',
  );
  try {
    const record = store.readExecutorInvocationAttempt(dispatchId);
    const claimGeneration = record.decisionInput.claimGeneration;
    assert.ok(Number.isInteger(claimGeneration) && claimGeneration >= 1);

    const { calls, runner } = fakeRunner({ kind: 'exited', code: 0 });
    const result = await makeAdapter(runner)(record);

    assert.ok(Object.isFrozen(result));
    assert.deepEqual(Object.getOwnPropertyNames(result), [
      'schemaVersion',
      'dispatchId',
      'outcome',
    ]);
    assert.deepEqual(Object.getOwnPropertyNames(result), [...EXECUTOR_INVOCATION_OUTCOME_FIELDS]);
    const resultJson = JSON.stringify(result);
    assert.equal(resultJson.includes('generation'), false);
    assert.equal(resultJson.includes('claimGeneration'), false);
    assert.equal(resultJson.includes('counter'), false);

    // The fencing generation is inherited verbatim inside the delivered
    // record; the adapter adds no generation of its own.
    const delivered = JSON.parse(calls[0].args[6]);
    assert.equal(delivered.decisionInput.claimGeneration, claimGeneration);
    assert.equal(delivered.dispatchId, dispatchId);
    assert.equal(delivered.decisionInput.nextTaskId, record.decisionInput.nextTaskId);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// L. NO DURABLE MUTATION.
// ---------------------------------------------------------------------------

test('L. every outcome path leaves every durable byte and task/claim state unchanged', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-codex-cli-adapter31-l-',
    'CCEA31-L-SRC',
    'CCEA31-L-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const beforeStats = snapshotHomeStats(home);
    const taskBefore = store.readTask('CCEA31-L-CHILD');
    const claimBefore = store.readClaim('CCEA31-L-CHILD');
    const record = store.readExecutorInvocationAttempt(dispatchId);

    for (const responder of [
      { kind: 'exited', code: 0 },
      { kind: 'exited', code: 1 },
      { kind: 'terminated-without-exit-status' },
    ]) {
      const { runner } = fakeRunner(responder);
      await makeAdapter(runner)(record);
      assert.deepEqual(snapshotHomeBytes(home), before);
      assert.deepEqual(snapshotHomeStats(home), beforeStats);
    }

    // Fail-closed paths are equally side-effect free.
    const { runner: throwingRunner } = fakeRunner(() => {
      throw new Error('no durable effect');
    });
    await assert.rejects(makeAdapter(throwingRunner)(record));
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.deepEqual(snapshotHomeStats(home), beforeStats);

    const taskAfter = store.readTask('CCEA31-L-CHILD');
    const claimAfter = store.readClaim('CCEA31-L-CHILD');
    assert.equal(taskAfter.status, taskBefore.status);
    assert.equal(claimAfter.generation, claimBefore.generation);
    assert.equal(claimAfter.claimToken, claimBefore.claimToken);

    // Durable target domains are present and byte-stable.
    assert.deepEqual(listAttemptFiles(home), [`${dispatchId}.json`]);
    assert.ok(existsSync(executorDispatchAcceptanceFilePath(home, dispatchId)));
    for (const forbiddenDir of FORBIDDEN_NEW_ARTIFACT_DIRS) {
      assert.equal(existsSync(join(home, forbiddenDir)), false, forbiddenDir);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// M. TASK STAYS CLAIMED; NO STATUS AUTHORITY.
// ---------------------------------------------------------------------------

test('M. the task stays CLAIMED on every outcome and the module carries no RUNNING/ACKED status authority', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-codex-cli-adapter31-m-',
    'CCEA31-M-SRC',
    'CCEA31-M-CHILD',
  );
  try {
    const record = store.readExecutorInvocationAttempt(dispatchId);
    for (const responder of [
      { kind: 'exited', code: 0 },
      { kind: 'exited', code: 3 },
      { kind: 'terminated-without-exit-status' },
    ]) {
      const { runner } = fakeRunner(responder);
      await makeAdapter(runner)(record);
      assert.equal(store.readTask('CCEA31-M-CHILD').status, TASK_STATUS_CLAIMED);
    }

    const code = codeOnly(readFileSync(MODULE_PATH, 'utf8'));
    for (const status of [
      "'RUNNING'",
      '"RUNNING"',
      "'EXECUTING'",
      '"EXECUTING"',
      "'INVOKED'",
      '"INVOKED"',
      "'ACKED'",
      '"ACKED"',
      "'COMPLETED'",
      '"COMPLETED"',
      'TASK_STATUS_RUNNING',
      'TASK_STATUS_ACCEPTED',
      'markRunning',
      'setTaskStatus',
    ]) {
      assert.equal(code.includes(status), false, `${status} must not exist in code`);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// N. NO ACK/RECEIPT/RESULT PERSISTENCE.
// ---------------------------------------------------------------------------

test('N. no ACK/receipt/result artifact, store primitive, or new namespace is created', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-codex-cli-adapter31-n-',
    'CCEA31-N-SRC',
    'CCEA31-N-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const record = store.readExecutorInvocationAttempt(dispatchId);
    const { runner } = fakeRunner({ kind: 'exited', code: 0 });
    const result = await makeAdapter(runner)(record);

    const resultJson = JSON.stringify(result);
    for (const token of FORBIDDEN_OUTCOME_TOKENS) {
      assert.equal(resultJson.includes(token), false, token);
    }

    const after = snapshotHomeBytes(home);
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
    for (const [name, value] of Object.entries(before)) {
      assert.equal(after[name], value, name);
    }

    for (const forbidden of [
      'persistExecutorInvocationOutcome',
      'createAdapterRun',
      'createProcessRecord',
      'acknowledgeExecutor',
      'acknowledgeDispatch',
      'recordInvocation',
      'recordExecutorStarted',
      'invokeExecutor',
      'executeTask',
      'executeDispatch',
      'selectExecutor',
      'selectWorker',
      'scheduleExecutor',
      'retryDispatch',
      'resendDispatch',
      'invocationCounter',
      'retryCounter',
    ]) {
      assert.equal(store[forbidden], undefined, `store.${forbidden} must not exist`);
    }
    assert.equal(typeof store.readExecutorInvocationAttempt, 'function');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// O. STATIC BOUNDARY: NO REGISTRY/SELECTION/FALLBACK/RETRY; EXACT EXPORTS.
// ---------------------------------------------------------------------------

test('O. the module carries no registry/selection/fallback/retry/fs authority and exports exactly one factory', async () => {
  const module = await import('./codex-cli-executor-adapter.mjs');
  const raw = readFileSync(MODULE_PATH, 'utf8');
  const code = codeOnly(raw);

  for (const forbidden of [
    "from 'node:fs'",
    "from 'node:net'",
    "from 'node:http'",
    "from 'node:https'",
    "from 'node:worker_threads'",
    "from 'node:crypto'",
    "from './store.mjs'",
    'writeFile',
    'mkdir',
    'rmSync',
    'unlink',
    'rename',
    'appendFile',
    'createWriteStream',
    'fetch(',
    'WebSocket',
    'XMLHttpRequest',
    'http.request(',
    'grpc',
    'retry',
    'backoff',
    'resend',
    'secondAttempt',
    'selectExecutor',
    'selectWorker',
    'executorRegistry',
    'adapterRegistry',
    'workerRegistry',
    'registry',
    'capabilityMatch',
    'fallback',
    'autoSelect',
    'endpointDiscovery',
    'environmentSelection',
    'polling',
    'daemon',
    'cron',
    'scheduler',
    'Date.now',
    'new Date',
    'performance.now',
    'randomUUID',
    'Math.random',
    'setTimeout',
    'setInterval',
    'process.pid',
    'process.platform',
    'invokeExecutorInvocationAdapter',
    'invokeExecutorAndValidateOutcome',
    'persistExecutorInvocationAttempt',
    'readExecutorInvocationInput',
    'readExecutorInvocationAttempt',
    'validateReceiverDecisionRecord',
    'store.',
    'require(',
  ]) {
    assert.equal(code.includes(forbidden), false, `code must not contain ${forbidden}`);
  }

  // The ONLY imports are the process spawn primitive, path resolution, and the
  // Task 30 outcome vocabulary.
  const importSpecifiers = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(importSpecifiers, [
    'node:child_process',
    'node:path',
    './dispatch-executor-invocation-outcome.mjs',
  ]);
  // Environment access exists ONLY through the fixed allowlist projection.
  assert.equal(code.split('process.env').length - 1, 1);

  const exportedFunctions = Object.entries(module)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(exportedFunctions, [
    'CodexCliExecutorAdapterError',
    'createCodexCliExecutorAdapter',
  ]);
  assert.equal(typeof createCodexCliExecutorAdapter, 'function');
  assert.equal(typeof CodexCliExecutorAdapterError, 'function');

  // Error codes and the environment allowlist are frozen constants.
  assert.equal(
    INVALID_CODEX_CLI_EXECUTOR_ADAPTER_CONFIGURATION,
    'INVALID_CODEX_CLI_EXECUTOR_ADAPTER_CONFIGURATION',
  );
  assert.equal(
    INVALID_CODEX_CLI_EXECUTOR_TASK28_RECORD,
    'INVALID_CODEX_CLI_EXECUTOR_TASK28_RECORD',
  );
  assert.equal(
    INVALID_CODEX_CLI_EXECUTOR_RUNNER_RESULT,
    'INVALID_CODEX_CLI_EXECUTOR_RUNNER_RESULT',
  );
  assert.equal(CODEX_CLI_EXECUTOR_PROCESS_START_FAILED, 'CODEX_CLI_EXECUTOR_PROCESS_START_FAILED');
  assert.ok(Object.isFrozen(CODEX_CLI_EXECUTOR_ENV_ALLOWLIST));
  assert.ok(CODEX_CLI_EXECUTOR_ENV_ALLOWLIST.includes('PATH'));
  assert.ok(CODEX_CLI_EXECUTOR_ENV_ALLOWLIST.includes('CODEX_HOME'));
});

// ---------------------------------------------------------------------------
// P. TASK 30 COMPOSITION.
// ---------------------------------------------------------------------------

test('P. invokeExecutorAndValidateOutcome composes the concrete adapter exactly once and returns the canonical Task 30 outcome', async () => {
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-codex-cli-adapter31-p-',
    'CCEA31-P-SRC',
    'CCEA31-P-CHILD',
  );
  try {
    const before = snapshotHomeBytes(home);
    const { events, store: probeStore } = eventRecordingStore(store);
    const calls = [];
    const runner = (request) => {
      events.push('runner');
      calls.push(request);
      return calls.length === 1
        ? { kind: 'exited', code: 0 }
        : { kind: 'terminated-without-exit-status' };
    };
    const adapter = makeAdapter(runner);

    const accepted = await invokeExecutorAndValidateOutcome({
      dispatchId,
      store: probeStore,
      adapter,
    });
    assertCanonicalOutcome(accepted, dispatchId, EXECUTOR_INVOCATION_OUTCOME_ACCEPTED);
    assert.equal(calls.length, 1);

    // Exactly one store capability is consulted, exactly one dispatchId-keyed
    // read happens, and the single runner call follows it.
    const reads = events.filter((event) => event.startsWith('get:'));
    const storeCalls = events.filter((event) => event.startsWith('call:'));
    assert.deepEqual([...new Set(reads)], ['get:readExecutorInvocationAttempt']);
    assert.deepEqual(storeCalls, ['call:readExecutorInvocationAttempt']);
    const readIndex = events.indexOf('call:readExecutorInvocationAttempt');
    const runnerIndex = events.indexOf('runner');
    assert.ok(readIndex < runnerIndex);
    assert.equal(events.filter((event) => event === 'runner').length, 1);

    // A second composition call observes the ambiguous boundary: still AT MOST
    // ONE process invocation per API call.
    const unknown = await invokeExecutorAndValidateOutcome({
      dispatchId,
      store: probeStore,
      adapter,
    });
    assertCanonicalOutcome(unknown, dispatchId, EXECUTOR_INVOCATION_OUTCOME_UNKNOWN);
    assert.equal(calls.length, 2);
    assert.equal(events.filter((event) => event.startsWith('call:')).length, 2);

    // The whole composition mutates zero durable bytes and never invokes the
    // Task 29 adapter more than once per API call.
    assert.deepEqual(snapshotHomeBytes(home), before);
    assert.equal(store.readTask('CCEA31-P-CHILD').status, TASK_STATUS_CLAIMED);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// Q. PREDECESSOR REGRESSION: TASK 29/30 SURFACES UNCHANGED.
// ---------------------------------------------------------------------------

test('Q. Task 29 and Task 30 public surfaces are intact and the adapter reuses the exact Task 30 outcome vocabulary', async () => {
  assert.equal(typeof invokeExecutorInvocationAdapter, 'function');
  assert.equal(typeof invokeExecutorAndValidateOutcome, 'function');
  assert.deepEqual([...EXECUTOR_INVOCATION_OUTCOME_VALUES], ['ACCEPTED', 'REJECTED', 'UNKNOWN']);
  assert.deepEqual(
    [...EXECUTOR_INVOCATION_OUTCOME_FIELDS],
    ['schemaVersion', 'dispatchId', 'outcome'],
  );
  assert.equal(EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION, 1);
  assert.equal(EXECUTOR_INVOCATION_OUTCOME_ACCEPTED, 'ACCEPTED');
  assert.equal(EXECUTOR_INVOCATION_OUTCOME_REJECTED, 'REJECTED');
  assert.equal(EXECUTOR_INVOCATION_OUTCOME_UNKNOWN, 'UNKNOWN');

  // The Task 29 read-only input primitive remains the durable authority; the
  // adapter did not add a reader or a writer.
  const { home, store, dispatchId } = await setupAccepted(
    'greenhub-codex-cli-adapter31-q-',
    'CCEA31-Q-SRC',
    'CCEA31-Q-CHILD',
  );
  try {
    const input = await readExecutorInvocationInput({ dispatchId, store });
    assert.equal(input.dispatchId, dispatchId);
    const { runner } = fakeRunner({ kind: 'exited', code: 0 });
    const result = await makeAdapter(runner)(store.readExecutorInvocationAttempt(dispatchId));
    assertCanonicalOutcome(result, dispatchId, EXECUTOR_INVOCATION_OUTCOME_ACCEPTED);
    assert.equal(store.readTask('CCEA31-Q-CHILD').status, TASK_STATUS_CLAIMED);
  } finally {
    removeHome(home);
  }
});
