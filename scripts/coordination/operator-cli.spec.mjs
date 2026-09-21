// Proof for GREENHUB-COORDINATION-OPERATOR-CLI-35.
// Thin operator CLI over the EXISTING durable coordination authorities:
//   coordination:status / coordination:inspect / coordination:run.
//
// Proved here:
//   - status performs zero writes (bytes + mtimes unchanged),
//   - inspect performs zero writes,
//   - absent optional later-stage records are represented as absent (never fabricated),
//   - corrupt authority fails closed with a canonical code and no stack dump,
//   - run executes at most ONE operator-requested READ_ONLY task boundary,
//   - a mutation-capable task is refused by the current READ_ONLY capability
//     BEFORE any claim or durable mutation (zero executor invocations),
//   - identical inspection produces deterministic semantic output,
//   - the coordination home stays outside the repository worktree,
//   - no daemon/timer/polling behavior exists in the operator CLI,
//   - the package.json operator commands exist.
//
// All runtime state lives in isolated temp directories. No network required.
// The fake executor in this spec is injected at the existing Task 33 executor
// seam (caller-supplied function); no process is spawned for execution tests.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveCoordinationHome } from './coordination-home.mjs';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import {
  buildConfiguredExecutor,
  collectStatusOverview,
  collectTaskInspection,
  OPERATOR_ARGUMENT_INVALID,
  OPERATOR_EXECUTOR_NOT_CONFIGURED,
  parseOperatorArgv,
  RUN_OUTCOME_ALREADY_TERMINAL,
  RUN_OUTCOME_EXECUTED,
  runOperatorCli,
  UNSUPPORTED_OPERATOR_EXECUTION_CAPABILITY,
} from './operator-cli.mjs';
import { CoordinationStore } from './store.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(MODULE_DIRECTORY, '../..');
const OPERATOR_CLI_PATH = join(MODULE_DIRECTORY, 'operator-cli.mjs');

function makeHome(prefix = 'greenhub-operator35-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'READ_ONLY',
    desiredExitState: 'OPERATOR_RUN_PROVED',
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
    mutationBoundary: { allowsWrite: false, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['operator-cli-proof'],
    ...overrides,
  };
}

function sampleMutationTaskInput(taskId, overrides = {}) {
  return {
    ...sampleTaskInput(taskId),
    taskKind: 'BOUNDED_MUTATION',
    mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
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
  store.createTask(sampleMutationTaskInput(taskId));
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

function emitChild(store, clock, sourceTaskId, childSpec) {
  const emitted = store.emitNextTask({
    sourceTaskId,
    nextTaskSpec: childSpec,
    emitterId: 'control-tower-1',
  });
  clock.advance(1000);
  return emitted;
}

function driveToAdmittedChild(store, clock, sourceTaskId, childSpec) {
  driveToConsumed(store, clock, sourceTaskId);
  emitChild(store, clock, sourceTaskId, childSpec);
  const admitted = store.admitEmittedTask({ sourceTaskId, admitterId: 'control-tower-1' });
  clock.advance(1000);
  return admitted;
}

function fakeStructuredExecutor(counter, overrides = {}) {
  return async function fakeExecutor(task28Record) {
    counter.calls += 1;
    return {
      schemaVersion: 1,
      dispatchId: task28Record.dispatchId,
      outcome: 'ACCEPTED',
      result: {
        taskId: task28Record.decisionInput.task.taskId,
        status: 'SUCCEEDED',
        summary: 'read-only operator probe completed',
        proofRefs: ['proof:operator-run'],
        evidenceRefs: ['evidence:operator-run'],
        frictionObserved: ['NONE'],
      },
      ...overrides,
    };
  };
}

function captureStream() {
  const stream = { text: '' };
  stream.write = (chunk) => {
    stream.text += String(chunk);
    return true;
  };
  return stream;
}

function snapshotHome(home) {
  const out = {};
  const walk = (directory) => {
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
        walk(full);
      } else if (entry.isFile()) {
        const stat = statSync(full);
        out[full.slice(home.length + 1)] = {
          content: readFileSync(full, 'utf8'),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        };
      }
    }
  };
  walk(home);
  return out;
}

function runCliProcess(args, env) {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(process.execPath, [OPERATOR_CLI_PATH, ...args], {
      env,
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
    child.once('close', (code) => resolveResult({ code, stdout, stderr }));
  });
}

test('A. status performs zero writes and reports existing lifecycle truth', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToDelivered(store, 'OPSCLI-STATUS001');
    store.createTask(sampleTaskInput('OPSCLI-STATUS002'));
    store.markReady('OPSCLI-STATUS002');

    const before = snapshotHome(home);
    const stdout = captureStream();
    const stderr = captureStream();
    const exitCode = await runOperatorCli({ argv: ['status'], store, stdout, stderr });
    assert.equal(exitCode, 0);
    assert.equal(stderr.text, '');
    assert.match(stdout.text, /OPSCLI-STATUS001/);
    assert.match(stdout.text, /OPSCLI-STATUS002/);
    assert.match(stdout.text, /RESULT_DELIVERED/);
    assert.match(stdout.text, /READY/);
    assert.deepEqual(snapshotHome(home), before, 'status must not write anything');

    const jsonStdout = captureStream();
    const jsonExit = await runOperatorCli({
      argv: ['status', '--json'],
      store,
      stdout: jsonStdout,
      stderr: captureStream(),
    });
    assert.equal(jsonExit, 0);
    assert.deepEqual(snapshotHome(home), before, 'status --json must not write anything');
    const projection = JSON.parse(jsonStdout.text);
    assert.equal(projection.projection, 'operator-status');
    assert.equal(projection.taskCount, 2);
    assert.equal(projection.home, home);
    const delivered = projection.tasks.find((task) => task.taskId === 'OPSCLI-STATUS001');
    assert.equal(delivered.status, 'RESULT_DELIVERED');
    assert.equal(delivered.canonicalResult, true);
    assert.equal(delivered.claim, true);
    const ready = projection.tasks.find((task) => task.taskId === 'OPSCLI-STATUS002');
    assert.equal(ready.status, 'READY');
    assert.equal(ready.canonicalResult, false);
    assert.equal(ready.consumed, false);
  } finally {
    removeHome(home);
  }
});

test('B. inspect performs zero writes and represents absent later-stage records as absent', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    store.createTask(sampleTaskInput('OPSCLI-INSPECT01'));

    const before = snapshotHome(home);
    const first = captureStream();
    const exitCode = await runOperatorCli({
      argv: ['inspect', 'OPSCLI-INSPECT01'],
      store,
      stdout: first,
      stderr: captureStream(),
    });
    assert.equal(exitCode, 0);
    assert.match(first.text, /task:\s+present/);
    assert.match(first.text, /claim:\s+\(absent\)/);
    assert.match(first.text, /canonical:\s+\(absent\)/);
    assert.match(first.text, /receipt:\s+\(absent\)/);
    assert.deepEqual(snapshotHome(home), before, 'inspect must not write anything');

    const jsonStdout = captureStream();
    await runOperatorCli({
      argv: ['inspect', 'OPSCLI-INSPECT01', '--json'],
      store,
      stdout: jsonStdout,
      stderr: captureStream(),
    });
    const projection = JSON.parse(jsonStdout.text);
    assert.equal(projection.projection, 'operator-inspection');
    assert.equal(projection.task.status, 'CREATED');
    assert.equal(projection.claim, null);
    assert.equal(projection.canonicalResult, null);
    assert.equal(projection.disposition, null);
    assert.equal(projection.materialization, null);
    assert.equal(projection.ack, null);
    assert.equal(projection.consumed, null);
    assert.equal(projection.executorResultReceipt, null);
    assert.deepEqual(snapshotHome(home), before, 'inspect --json must not write anything');
  } finally {
    removeHome(home);
  }
});

test('C. identical inspection produces deterministic semantic output', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToConsumed(store, clock, 'OPSCLI-DETERM001');

    const firstJson = captureStream();
    const secondJson = captureStream();
    assert.equal(
      await runOperatorCli({
        argv: ['inspect', 'OPSCLI-DETERM001', '--json'],
        store,
        stdout: firstJson,
        stderr: captureStream(),
      }),
      0,
    );
    assert.equal(
      await runOperatorCli({
        argv: ['inspect', 'OPSCLI-DETERM001', '--json'],
        store,
        stdout: secondJson,
        stderr: captureStream(),
      }),
      0,
    );
    assert.equal(firstJson.text, secondJson.text);

    const firstHuman = captureStream();
    const secondHuman = captureStream();
    await runOperatorCli({
      argv: ['inspect', 'OPSCLI-DETERM001'],
      store,
      stdout: firstHuman,
      stderr: captureStream(),
    });
    await runOperatorCli({
      argv: ['inspect', 'OPSCLI-DETERM001'],
      store,
      stdout: secondHuman,
      stderr: captureStream(),
    });
    assert.equal(firstHuman.text, secondHuman.text);

    const projection = JSON.parse(firstJson.text);
    assert.equal(projection.disposition.state, 'ADOPTED');
    assert.equal(typeof projection.consumed.consumedId, 'string');
    assert.equal(projection.ack !== null, true);
    assert.equal(projection.materialization !== null, true);
  } finally {
    removeHome(home);
  }
});

test('D. corrupt durable authority fails closed without a stack dump', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    store.createTask(sampleTaskInput('OPSCLI-CORRUPT01'));
    writeFileSync(
      join(home, 'tasks', 'OPSCLI-CORRUPT01', 'result.json'),
      '{ not valid json',
      'utf8',
    );

    const stdout = captureStream();
    const stderr = captureStream();
    const exitCode = await runOperatorCli({
      argv: ['inspect', 'OPSCLI-CORRUPT01'],
      store,
      stdout,
      stderr,
    });
    assert.equal(exitCode, 1);
    assert.match(stderr.text, /CORRUPT_RESULT/);
    assert.match(stderr.text, /OPSCLI-CORRUPT01/);
    assert.doesNotMatch(stderr.text, /\n\s+at /, 'no stack traces by default');
    assert.doesNotMatch(stderr.text, /CoordinationStoreError/);
  } finally {
    removeHome(home);
  }
});

test('E. run executes exactly one READ_ONLY task boundary and replays terminally without re-invoking the executor', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmittedChild(store, clock, 'OPSCLI-SOURCE001', sampleTaskInput('OPSCLI-CHILD001'));
    const sequenceBefore = store.readTaskSequence();

    const counter = { calls: 0 };
    const executor = fakeStructuredExecutor(counter);
    const firstOut = captureStream();
    const firstErr = captureStream();
    const firstExit = await runOperatorCli({
      argv: ['run', 'OPSCLI-CHILD001', '--json'],
      store,
      executor,
      stdout: firstOut,
      stderr: firstErr,
    });
    assert.equal(firstErr.text, '');
    assert.equal(firstExit, 0);
    assert.equal(counter.calls, 1, 'exactly one executor boundary must be crossed');
    const first = JSON.parse(firstOut.text);
    assert.equal(first.outcome, RUN_OUTCOME_EXECUTED);
    assert.equal(first.executorOutcome, 'ACCEPTED');
    assert.equal(first.receipt.status, 'SUCCEEDED');
    assert.equal(first.delivery.newlyDelivered, true);
    assert.equal(first.taskStatus, 'RESULT_DELIVERED');
    assert.equal(store.readTask('OPSCLI-CHILD001').status, 'RESULT_DELIVERED');
    const receipt = store.readExecutorResultReceipt(first.dispatchId);
    assert.ok(receipt !== null);
    assert.equal(receipt.taskId, 'OPSCLI-CHILD001');
    const canonicalResult = store.readResult('OPSCLI-CHILD001');
    assert.equal(canonicalResult.resultId, first.delivery.resultId);
    assert.equal(canonicalResult.summary, 'read-only operator probe completed');

    const secondOut = captureStream();
    const secondErr = captureStream();
    const secondExit = await runOperatorCli({
      argv: ['run', 'OPSCLI-CHILD001', '--json'],
      store,
      executor,
      stdout: secondOut,
      stderr: secondErr,
    });
    assert.equal(secondErr.text, '');
    assert.equal(secondExit, 0);
    assert.equal(counter.calls, 1, 'terminal replay must not re-invoke the executor');
    const second = JSON.parse(secondOut.text);
    assert.equal(second.outcome, RUN_OUTCOME_ALREADY_TERMINAL);
    assert.equal(second.executorInvocations, 0);

    assert.deepEqual(
      store.readTaskSequence(),
      sequenceBefore,
      'no recursive successor task may be created',
    );
    const inspection = collectTaskInspection({ store, taskId: 'OPSCLI-CHILD001' });
    assert.equal(inspection.executorResultReceipt.dispatchId, first.dispatchId);
    assert.equal(inspection.executorResultReceipt.status, 'SUCCEEDED');
  } finally {
    removeHome(home);
  }
});

test('F. a mutation-capable task is refused by the READ_ONLY capability before any mutation', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmittedChild(
      store,
      clock,
      'OPSCLI-SOURCE002',
      sampleMutationTaskInput('OPSCLI-MUTATE001'),
    );
    const counter = { calls: 0 };
    const stdout = captureStream();
    const stderr = captureStream();
    const exitCode = await runOperatorCli({
      argv: ['run', 'OPSCLI-MUTATE001'],
      store,
      executor: fakeStructuredExecutor(counter),
      stdout,
      stderr,
    });
    assert.equal(exitCode, 1);
    assert.equal(counter.calls, 0, 'no executor boundary may be crossed for a mutation task');
    assert.match(stderr.text, new RegExp(UNSUPPORTED_OPERATOR_EXECUTION_CAPABILITY));
    assert.equal(store.readTask('OPSCLI-MUTATE001').status, 'READY');
    assert.equal(existsSync(join(home, 'tasks', 'OPSCLI-MUTATE001', 'claim.json')), false);
    assert.equal(existsSync(join(home, 'executor-result-receipts')), false);
    assert.equal(existsSync(join(home, 'executor-invocation-attempts')), false);
  } finally {
    removeHome(home);
  }
});

test('G. missing executor configuration fails closed before claim mutation', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmittedChild(store, clock, 'OPSCLI-SOURCE003', sampleTaskInput('OPSCLI-CHILD003'));
    const stdout = captureStream();
    const stderr = captureStream();
    const exitCode = await runOperatorCli({
      argv: ['run', 'OPSCLI-CHILD003'],
      env: {},
      store,
      stdout,
      stderr,
    });
    assert.equal(exitCode, 1);
    assert.match(stderr.text, new RegExp(OPERATOR_EXECUTOR_NOT_CONFIGURED));
    assert.match(stderr.text, /OPSCLI-CHILD003/);
    assert.match(stderr.text, /stage:\s+executor-config/);
    assert.equal(store.readTask('OPSCLI-CHILD003').status, 'READY');
    assert.equal(existsSync(join(home, 'tasks', 'OPSCLI-CHILD003', 'claim.json')), false);
    assert.throws(
      () => buildConfiguredExecutor({ opencodePath: null, model: null, workdir: null }, {}),
      (error) => error?.code === OPERATOR_EXECUTOR_NOT_CONFIGURED,
    );
    assert.throws(
      () =>
        buildConfiguredExecutor(
          { opencodePath: 'C:\\fake\\opencode.exe', model: null, workdir: null },
          {},
        ),
      (error) => error?.code === OPERATOR_EXECUTOR_NOT_CONFIGURED,
    );
    const configured = buildConfiguredExecutor(
      {
        opencodePath: process.platform === 'win32' ? 'C:\\fake\\opencode.exe' : '/fake/opencode',
        model: 'opencode-go/deepseek-v4.1-flash',
        workdir: null,
      },
      {},
    );
    assert.equal(typeof configured, 'function');
  } finally {
    removeHome(home);
  }
});

test('H. run requires the task to be emission-admitted and fails closed otherwise', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    store.createTask(sampleTaskInput('OPSCLI-PLAIN001'));
    store.markReady('OPSCLI-PLAIN001');
    const counter = { calls: 0 };
    const stderr = captureStream();
    const exitCode = await runOperatorCli({
      argv: ['run', 'OPSCLI-PLAIN001'],
      store,
      executor: fakeStructuredExecutor(counter),
      stdout: captureStream(),
      stderr,
    });
    assert.equal(exitCode, 1);
    assert.equal(counter.calls, 0);
    assert.match(stderr.text, /OPERATOR_TASK_ADMISSION_NOT_FOUND/);
    assert.equal(store.readTask('OPSCLI-PLAIN001').status, 'READY');
    assert.equal(existsSync(join(home, 'tasks', 'OPSCLI-PLAIN001', 'claim.json')), false);

    driveToAdmittedChild(store, clock, 'OPSCLI-SOURCE004', sampleTaskInput('OPSCLI-CHILD004'));
    const wrongSourceStderr = captureStream();
    const wrongSourceExit = await runOperatorCli({
      argv: ['run', 'OPSCLI-CHILD004', '--source', 'OPSCLI-SOURCE001'],
      store,
      executor: fakeStructuredExecutor(counter),
      stdout: captureStream(),
      stderr: wrongSourceStderr,
    });
    assert.equal(wrongSourceExit, 1);
    assert.equal(counter.calls, 0);
    assert.match(wrongSourceStderr.text, /ADMISSION_NOT_FOUND/);
    assert.equal(store.readTask('OPSCLI-CHILD004').status, 'READY');
    assert.equal(existsSync(join(home, 'tasks', 'OPSCLI-CHILD004', 'claim.json')), false);
  } finally {
    removeHome(home);
  }
});

test('I. the operator CLI module contains no daemon/timer/polling behavior', () => {
  const source = readFileSync(OPERATOR_CLI_PATH, 'utf8');
  assert.doesNotMatch(source, /setInterval|setTimeout|setImmediate/);
  assert.doesNotMatch(source, /node:timers|node:worker_threads/);
  assert.doesNotMatch(source, /while\s*\(\s*true\s*\)/);
  assert.doesNotMatch(source, /\bwatchFile\b|\bwatch\s*\(/);
});

test('J. package.json exposes the operator commands and the CLI resolves its home outside the repo', async () => {
  const packageJson = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts['coordination:status'],
    'node scripts/coordination/operator-cli.mjs status',
  );
  assert.equal(
    packageJson.scripts['coordination:inspect'],
    'node scripts/coordination/operator-cli.mjs inspect',
  );
  assert.equal(
    packageJson.scripts['coordination:run'],
    'node scripts/coordination/operator-cli.mjs run',
  );

  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    store.createTask(sampleTaskInput('OPSCLI-HOME001'));
    const env = { ...process.env, GREENHUB_COORDINATION_HOME: home };
    const spawned = await runCliProcess(['status', '--json'], env);
    assert.equal(spawned.code, 0);
    const projection = JSON.parse(spawned.stdout);
    assert.equal(projection.home, home);
    assert.equal(projection.tasks[0].taskId, 'OPSCLI-HOME001');

    const defaultHome = resolveCoordinationHome({ platform: 'win32', env: { LOCALAPPDATA: home } });
    assert.equal(existsSync(join(REPOSITORY_ROOT, 'tasks')), false);
    assert.equal(existsSync(join(REPOSITORY_ROOT, 'consumption')), false);
    assert.equal(existsSync(join(REPOSITORY_ROOT, 'executor-result-receipts')), false);
    assert.equal(existsSync(join(REPOSITORY_ROOT, 'coordination')), false);
    assert.equal(defaultHome.startsWith(REPOSITORY_ROOT), false);
  } finally {
    removeHome(home);
  }
});

test('K. argument parsing is explicit and fails closed on invalid input', () => {
  const runOptions = parseOperatorArgv([
    'run',
    'OPSCLI-CHILD001',
    '--source',
    'OPSCLI-SOURCE001',
    '--slot',
    'next',
    '--json',
  ]);
  assert.equal(runOptions.command, 'run');
  assert.equal(runOptions.taskId, 'OPSCLI-CHILD001');
  assert.equal(runOptions.sourceTaskId, 'OPSCLI-SOURCE001');
  assert.equal(runOptions.emissionSlot, 'next');
  assert.equal(runOptions.json, true);
  const inspectOptions = parseOperatorArgv(['inspect', 'OPSCLI-CHILD001']);
  assert.equal(inspectOptions.command, 'inspect');
  assert.equal(inspectOptions.taskId, 'OPSCLI-CHILD001');
  const executorOptions = parseOperatorArgv([
    'run',
    'OPSCLI-CHILD001',
    '--opencode',
    'C:\\tools\\opencode.exe',
    '--model',
    'opencode-go/deepseek-v4.1-flash',
    '--workdir',
    'C:\\repo',
  ]);
  assert.equal(executorOptions.opencodePath, 'C:\\tools\\opencode.exe');
  assert.equal(executorOptions.model, 'opencode-go/deepseek-v4.1-flash');
  assert.equal(executorOptions.workdir, 'C:\\repo');
  assert.throws(
    () => parseOperatorArgv(['run', 'OPSCLI-CHILD001', '--codex', 'C:\\tools\\codex.exe']),
    (error) => error?.code === OPERATOR_ARGUMENT_INVALID,
  );
  assert.throws(
    () => parseOperatorArgv(['run', 'OPSCLI-CHILD001', '--lease-ms', '0']),
    (error) => error?.code === OPERATOR_ARGUMENT_INVALID,
  );
  assert.throws(
    () => parseOperatorArgv(['inspect']),
    (error) => error?.code === OPERATOR_ARGUMENT_INVALID,
  );
  assert.throws(
    () => parseOperatorArgv(['deploy']),
    (error) => error?.code === OPERATOR_ARGUMENT_INVALID,
  );
});

test('L. status fail-closed overview is available as a direct projection', () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    store.createTask(sampleTaskInput('OPSCLI-DIRECT001'));
    const projection = collectStatusOverview({ store });
    assert.equal(projection.tasks.length, 1);
    assert.equal(projection.tasks[0].taskId, 'OPSCLI-DIRECT001');
    assert.equal(projection.tasks[0].status, 'CREATED');
    assert.equal(projection.tasks[0].sequencePosition, 1);
  } finally {
    removeHome(home);
  }
});
