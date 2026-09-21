// Proof for GREENHUB-COORDINATION-OPENCODE-READONLY-STRUCTURED-RESULT-EXECUTOR-GF05.
// The ONE concrete OpenCode CLI structured-result executor composed with the
// EXISTING Task 33 receipt contract.
//
// Proved here (mock runner only; NO real OpenCode process is spawned):
//   - configuration fails closed before any process boundary,
//   - the READ_ONLY task gate fails closed BEFORE process start,
//   - exactly one process boundary is crossed per call and the task payload is
//     ONE argv element (executable / workdir / agent / model / permissions are
//     never task-selectable),
//   - the child environment is a fixed allowlist with adapter-authored
//     OPENCODE_* values applied LAST (an explicit env map cannot weaken them),
//   - the structured result is the FINAL assistant text of the `--format json`
//     event stream; exit 0 alone is never SUCCEEDED,
//   - missing / malformed / oversized / mismatched structured output fails
//     closed with the existing Task 33 meanings,
//   - the Task 33 receipt contract records the exact six-field payload and a
//     wrong taskId is a fail-closed binding mismatch.
//
// All runtime state lives in isolated temp directories.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import { persistExecutorInvocationAttempt } from './dispatch-executor-invocation-attempt.mjs';
import { acceptReceiverDispatch } from './dispatch-receiver-acceptance.mjs';
import { prepareDispatchTransportRequest } from './dispatch-transport-contract.mjs';
import {
  INVALID_EXECUTOR_STRUCTURED_RESULT,
  MISSING_EXECUTOR_STRUCTURED_RESULT,
  persistExecutorResultReceipt,
} from './executor-result-receipt.mjs';
import {
  createOpenCodeCliStructuredResultExecutor,
  INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION,
  INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
  MAX_OPENCODE_CLI_STDOUT_BYTES,
  OPENCODE_CLI_EXECUTOR_CONFIG_CONTENT_ENV_KEY,
  OPENCODE_CLI_EXECUTOR_DISABLE_PROJECT_CONFIG_ENV_KEY,
  OPENCODE_CLI_EXECUTOR_ENV_ALLOWLIST,
  OPENCODE_CLI_EXECUTOR_PROCESS_START_FAILED,
  OPENCODE_CLI_EXECUTOR_PURE_ENV_KEY,
  OPENCODE_CLI_EXECUTOR_REQUIRES_READ_ONLY_TASK,
  OPENCODE_READONLY_AGENT_NAME,
} from './opencode-cli-executor-adapter.mjs';
import { CoordinationStore } from './store.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const ADAPTER_PATH = join(MODULE_DIRECTORY, 'opencode-cli-executor-adapter.mjs');
const FAKE_EXECUTABLE = process.platform === 'win32' ? 'C:\\fake\\opencode.exe' : '/fake/opencode';
const FAKE_WORKDIR = process.platform === 'win32' ? 'C:\\fake\\workdir' : '/fake/workdir';
const FAKE_MODEL = 'opencode-go/deepseek-v4.1-flash';

function makeHome(prefix = 'greenhub-gf05-opencode-spec-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function controllableClock(startMs = 1_700_000_000_000) {
  let now = startMs;
  return {
    advance(ms) {
      now += ms;
    },
    provider() {
      return now;
    },
  };
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'READ_ONLY',
    desiredExitState: 'REAL_OPENCODE_READONLY_PROBE',
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
    proofRequirement: ['opencode-readonly-executor-proof'],
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

function sampleSourceResult(claim, overrides = {}) {
  return {
    taskId: claim.taskId,
    resultId: 'result-0001',
    workerId: claim.workerId,
    claimToken: claim.claimToken,
    claimGeneration: claim.generation,
    status: 'SUCCEEDED',
    summary: 'bounded source output',
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

async function setupInvocationAttempt(store, clock, sourceTaskId, childTaskId) {
  store.createTask(sampleMutationTaskInput(sourceTaskId));
  store.markReady(sourceTaskId);
  const sourceClaim = store.claimTask({
    taskId: sourceTaskId,
    workerId: 'worker-source',
    leaseDurationMs: 60_000,
  });
  store.deliverResult(sampleSourceResult(sourceClaim));
  clock.advance(1000);
  store.beginDisposition({ taskId: sourceTaskId, resultId: 'result-0001', ...ctParams() });
  clock.advance(1000);
  store.writeDisposition({
    taskId: sourceTaskId,
    dispositionGeneration: 2,
    resultId: 'result-0001',
    ...ctParams({ controlTowerToken: 'ct-token-002' }),
    state: DISPOSITION_STATE_ADOPTED,
  });
  clock.advance(1000);
  store.materializeAdoption({ taskId: sourceTaskId, ...matParams() });
  clock.advance(1000);
  store.ackAdoption({ taskId: sourceTaskId, acknowledgerId: 'control-tower-1' });
  clock.advance(1000);
  store.markConsumed({ taskId: sourceTaskId, consumerId: 'control-tower-1' });
  clock.advance(1000);
  store.emitNextTask({
    sourceTaskId,
    nextTaskSpec: sampleTaskInput(childTaskId),
    emitterId: 'control-tower-1',
  });
  clock.advance(1000);
  const admitted = store.admitEmittedTask({ sourceTaskId, admitterId: 'control-tower-1' });
  clock.advance(1000);
  const claimed = store.claimAdmittedTask({ sourceTaskId, workerId: 'worker-a' });
  clock.advance(1000);
  const attempt = store.persistDispatchAttempt({ sourceTaskId, workerId: 'worker-a' });
  clock.advance(1000);
  const request = prepareDispatchTransportRequest({
    store,
    sourceTaskId,
    dispatchId: attempt.dispatchId,
  });
  const accepted = await acceptReceiverDispatch({ request, store });
  assert.equal(accepted.newlyAccepted, true);
  const persisted = await persistExecutorInvocationAttempt({
    dispatchId: attempt.dispatchId,
    store,
  });
  assert.equal(persisted.newlyPersisted, true);
  return {
    admitted,
    claim: claimed.claim,
    dispatchId: attempt.dispatchId,
    sourceTaskId,
    sourceTaskAdmission: admitted,
  };
}

function fakeTask28Record({ taskId = 'GF05-ADAPTER-CHILD', dispatchId = 'dispatch_adapter_unit_01' } = {}) {
  return {
    dispatchId,
    decisionInput: {
      task: {
        taskId,
        taskKind: 'READ_ONLY',
        mutationBoundary: { allowsWrite: false },
      },
    },
  };
}

function textEvent(partId, messageId, text) {
  return JSON.stringify({
    type: 'text',
    timestamp: 1,
    sessionID: 'ses_unit',
    part: {
      id: partId,
      messageID: messageId,
      sessionID: 'ses_unit',
      type: 'text',
      text,
    },
  });
}

function stepEvent(type) {
  return JSON.stringify({
    type,
    timestamp: 1,
    sessionID: 'ses_unit',
    part: { id: `prt_${type}`, messageID: 'msg_unit', sessionID: 'ses_unit', type },
  });
}

function structuredPayload(taskId, overrides = {}) {
  return {
    taskId,
    status: 'SUCCEEDED',
    summary: 'opencode read-only structured probe completed',
    proofRefs: ['opencode:stdout-structured-result'],
    evidenceRefs: ['opencode:run-format-json'],
    frictionObserved: ['NONE'],
    ...overrides,
  };
}

function eventStream(payload, { taskId = 'GF05-ADAPTER-CHILD' } = {}) {
  const body = payload === undefined ? structuredPayload(taskId) : payload;
  return [
    stepEvent('step-start'),
    textEvent('prt_text_1', 'msg_final', typeof body === 'string' ? body : JSON.stringify(body)),
    stepEvent('step-finish'),
    '',
  ].join('\n');
}

function fakeOpenCodeRunner(observation = {}) {
  const calls = [];
  const runner = async ({ command, args, cwd, env }) => {
    calls.push({ command, args: [...args], cwd, env });
    if (observation.verbatim === true) return observation.result;
    if (observation.throws === true) {
      throw new Error('runner failure propagated unchanged');
    }
    if (observation.kind === 'start-failed') {
      return { kind: 'start-failed', errorCode: observation.errorCode ?? 'ENOENT' };
    }
    if (observation.kind === 'terminated-without-exit-status') {
      return { kind: 'terminated-without-exit-status' };
    }
    return {
      kind: 'exited',
      code: observation.code ?? 0,
      stdout: observation.stdout ?? eventStream(observation.payload, observation),
      stdoutTruncated: observation.stdoutTruncated === true,
    };
  };
  return { calls, runner };
}

function makeExecutor(runner, overrides = {}) {
  return createOpenCodeCliStructuredResultExecutor({
    executablePath: FAKE_EXECUTABLE,
    workdir: FAKE_WORKDIR,
    model: FAKE_MODEL,
    runner,
    ...overrides,
  });
}

function capturingExecutor(inner) {
  const calls = [];
  return {
    calls,
    executor: async (record) => {
      calls.push(record);
      return inner(record);
    },
  };
}

// ---------------------------------------------------------------------------
// A. Configuration fail-closed (zero process invocations).
// ---------------------------------------------------------------------------

test('A1. invalid executor configuration fails closed before any process boundary', () => {
  const cases = [
    {
      configuration: { executablePath: 'relative/opencode', workdir: FAKE_WORKDIR, model: FAKE_MODEL },
      label: 'relative executable path',
    },
    {
      configuration: { executablePath: FAKE_EXECUTABLE, workdir: 'relative/workdir', model: FAKE_MODEL },
      label: 'relative workdir',
    },
    {
      configuration: { executablePath: FAKE_EXECUTABLE, workdir: FAKE_WORKDIR, model: '' },
      label: 'empty model',
    },
    {
      configuration: {
        executablePath: FAKE_EXECUTABLE,
        workdir: FAKE_WORKDIR,
        model: FAKE_MODEL,
        unknownField: true,
      },
      label: 'unknown configuration field',
    },
    {
      configuration: {
        executablePath: FAKE_EXECUTABLE,
        workdir: FAKE_WORKDIR,
        model: FAKE_MODEL,
        runner: 'not-a-function',
      },
      label: 'non-function runner',
    },
  ];
  for (const { configuration, label } of cases) {
    assert.throws(
      () => createOpenCodeCliStructuredResultExecutor(configuration),
      (error) =>
        error?.code === INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION,
      label,
    );
  }
  assert.throws(
    () => createOpenCodeCliStructuredResultExecutor(null),
    (error) => error?.code === INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION,
  );
});

test('A2. invalid Task 28 input or a non-READ_ONLY task fails closed BEFORE process start', async () => {
  const runner = fakeOpenCodeRunner();
  const executor = makeExecutor(runner.runner);

  await assert.rejects(
    () => executor(null),
    (error) => error?.code === INVALID_EXECUTOR_STRUCTURED_RESULT,
  );
  await assert.rejects(
    () => executor({ dispatchId: 'dispatch_adapter_unit_01' }),
    (error) => error?.code === INVALID_EXECUTOR_STRUCTURED_RESULT,
  );
  await assert.rejects(
    () =>
      executor({
        dispatchId: 'dispatch_adapter_unit_01',
        decisionInput: {
          task: { taskId: 'GF05-ADAPTER-CHILD', taskKind: 'BOUNDED_MUTATION' },
        },
      }),
    (error) => error?.code === OPENCODE_CLI_EXECUTOR_REQUIRES_READ_ONLY_TASK,
  );
  assert.equal(runner.calls.length, 0, 'no process may start before validation');
});

// ---------------------------------------------------------------------------
// B. The single process boundary: argv, environment, payload isolation.
// ---------------------------------------------------------------------------

test('B1. exactly one process invocation with the fixed argv and the record as ONE argv element', async () => {
  const record = fakeTask28Record({ taskId: 'GF05-ADAPTER-ARGV01' });
  const runner = fakeOpenCodeRunner({ payload: structuredPayload('GF05-ADAPTER-ARGV01') });
  const executor = makeExecutor(runner.runner);

  const envelope = await executor(record);
  assert.equal(runner.calls.length, 1, 'exactly one process boundary crossing');
  const call = runner.calls[0];
  assert.equal(call.command, FAKE_EXECUTABLE);
  assert.deepEqual(call.args, [
    'run',
    '--format',
    'json',
    '--pure',
    '--agent',
    OPENCODE_READONLY_AGENT_NAME,
    '--dir',
    FAKE_WORKDIR,
    JSON.stringify(record),
  ]);
  assert.equal(call.cwd, FAKE_WORKDIR);
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.dispatchId, record.dispatchId);
  assert.equal(envelope.outcome, 'ACCEPTED');
  assert.deepEqual(envelope.result, structuredPayload('GF05-ADAPTER-ARGV01'));
});

test('B2. the child environment carries the adapter-authored read-only boundary', async () => {
  const record = fakeTask28Record({ taskId: 'GF05-ADAPTER-ENV001' });
  const runner = fakeOpenCodeRunner({ payload: structuredPayload('GF05-ADAPTER-ENV001') });
  const executor = makeExecutor(runner.runner, {
    env: {
      PATH: 'C:\\fake-path',
      OPENCODE_CONFIG_CONTENT: '{"permission":{"edit":"allow"}}',
      OPENCODE_PURE: '0',
      SECRET_TOKEN: 'must-not-be-copied',
    },
  });

  await executor(record);
  assert.equal(runner.calls.length, 1);
  const env = runner.calls[0].env;
  assert.equal(env.PATH, 'C:\\fake-path');
  assert.equal(env.SECRET_TOKEN, undefined, 'non-allowlisted variables are dropped');
  assert.equal(env[OPENCODE_CLI_EXECUTOR_PURE_ENV_KEY], '1');
  assert.equal(env[OPENCODE_CLI_EXECUTOR_DISABLE_PROJECT_CONFIG_ENV_KEY], '1');
  const config = JSON.parse(env[OPENCODE_CLI_EXECUTOR_CONFIG_CONTENT_ENV_KEY]);
  assert.equal(config.share, 'disabled');
  assert.equal(config.permission.edit, 'deny');
  assert.equal(config.permission.bash, 'deny');
  assert.equal(config.permission.task, 'deny');
  const agent = config.agent[OPENCODE_READONLY_AGENT_NAME];
  assert.equal(agent.mode, 'primary');
  assert.equal(agent.model, FAKE_MODEL);
  assert.equal(agent.permission.edit, 'deny');
  assert.equal(agent.permission.bash, 'deny');
  assert.equal(agent.permission.external_directory, 'deny');
  assert.equal(agent.permission.skill, 'deny');
  assert.equal(typeof agent.prompt, 'string');
  assert.match(agent.prompt, /READ_ONLY/);
  for (const name of Object.keys(env)) {
    const isAllowlisted = OPENCODE_CLI_EXECUTOR_ENV_ALLOWLIST.includes(name);
    const isAuthored = name.startsWith('OPENCODE_');
    assert.equal(isAllowlisted || isAuthored, true, `unexpected environment variable ${name}`);
  }
});

test('B3. the task payload cannot select the executable, workdir, agent, model, or permissions', async () => {
  const record = fakeTask28Record({ taskId: 'GF05-ADAPTER-ISO001' });
  record.decisionInput.task.executablePath = 'C:\\evil\\opencode.exe';
  record.decisionInput.task.workdir = 'C:\\evil';
  record.decisionInput.task.model = 'evil/model';
  record.decisionInput.task.agent = 'build';
  record.decisionInput.task.permission = { edit: 'allow' };
  const runner = fakeOpenCodeRunner({ payload: structuredPayload('GF05-ADAPTER-ISO001') });
  const executor = makeExecutor(runner.runner);

  await executor(record);
  const call = runner.calls[0];
  assert.equal(call.command, FAKE_EXECUTABLE);
  assert.equal(call.cwd, FAKE_WORKDIR);
  assert.equal(call.args.includes('C:\\evil\\opencode.exe'), false);
  assert.equal(call.args.includes('build'), false);
  assert.equal(call.args.includes('--model'), false);
  const config = JSON.parse(call.env[OPENCODE_CLI_EXECUTOR_CONFIG_CONTENT_ENV_KEY]);
  assert.equal(config.agent[OPENCODE_READONLY_AGENT_NAME].model, FAKE_MODEL);
  assert.equal(config.agent[OPENCODE_READONLY_AGENT_NAME].permission.edit, 'deny');
});

// ---------------------------------------------------------------------------
// C. Structured result extraction and fail-closed parsing.
// ---------------------------------------------------------------------------

test('C1. the FINAL assistant message wins and cumulative part updates are not duplicated', async () => {
  const stdout = [
    stepEvent('step-start'),
    textEvent('prt_text_final', 'msg_final', '{"taskId":"GF05-ADAPTER-PARSE1","status":"SUCC'),
    textEvent('prt_text_final', 'msg_final', '{"taskId":"GF05-ADAPTER-PARSE1","status":"SUCCEEDED","summary":"final","proofRefs":["p"],"evidenceRefs":["e"],"frictionObserved":["NONE"]}'),
    stepEvent('step-finish'),
    '',
  ].join('\n');
  const runner = fakeOpenCodeRunner({ stdout });
  const executor = makeExecutor(runner.runner);
  const envelope = await executor(fakeTask28Record({ taskId: 'GF05-ADAPTER-PARSE1' }));
  assert.equal(envelope.outcome, 'ACCEPTED');
  assert.equal(envelope.result.status, 'SUCCEEDED');
  assert.equal(envelope.result.summary, 'final');
});

test('C2. an interim assistant message cannot shadow the final structured result', async () => {
  const stdout = [
    stepEvent('step-start'),
    textEvent('prt_interim', 'msg_interim', 'I will inspect the two files now.'),
    textEvent('prt_final', 'msg_final', JSON.stringify(structuredPayload('GF05-ADAPTER-PARSE2'))),
    stepEvent('step-finish'),
    '',
  ].join('\n');
  const runner = fakeOpenCodeRunner({ stdout });
  const executor = makeExecutor(runner.runner);
  const envelope = await executor(fakeTask28Record({ taskId: 'GF05-ADAPTER-PARSE2' }));
  assert.equal(envelope.outcome, 'ACCEPTED');
  assert.deepEqual(envelope.result, structuredPayload('GF05-ADAPTER-PARSE2'));
});

test('C3. missing, malformed, non-object, oversized, or non-JSON event output fails closed', async () => {
  const cases = [
    { label: 'no text events', stdout: `${stepEvent('step-start')}\n${stepEvent('step-finish')}\n`, code: MISSING_EXECUTOR_STRUCTURED_RESULT },
    { label: 'empty text', stdout: `${textEvent('p1', 'm1', '   ')}\n`, code: MISSING_EXECUTOR_STRUCTURED_RESULT },
    { label: 'non-JSON text', stdout: `${textEvent('p1', 'm1', 'not json')}\n`, code: INVALID_EXECUTOR_STRUCTURED_RESULT },
    { label: 'JSON array', stdout: `${textEvent('p1', 'm1', '[1,2,3]')}\n`, code: INVALID_EXECUTOR_STRUCTURED_RESULT },
    { label: 'non-JSON stdout line', stdout: `WARNING: something happened\n${textEvent('p1', 'm1', '{}')}\n`, code: INVALID_EXECUTOR_STRUCTURED_RESULT },
  ];
  for (const { label, stdout, code } of cases) {
    const runner = fakeOpenCodeRunner({ stdout });
    const executor = makeExecutor(runner.runner);
    await assert.rejects(
      () => executor(fakeTask28Record()),
      (error) => error?.code === code,
      label,
    );
  }

  const truncatedRunner = fakeOpenCodeRunner({
    payload: structuredPayload('GF05-ADAPTER-CHILD'),
    stdoutTruncated: true,
  });
  await assert.rejects(
    () => makeExecutor(truncatedRunner.runner)(fakeTask28Record()),
    (error) => error?.code === INVALID_EXECUTOR_STRUCTURED_RESULT,
  );
  assert.equal(MAX_OPENCODE_CLI_STDOUT_BYTES, 4 * 1024 * 1024);
});

// ---------------------------------------------------------------------------
// D. Process outcome mapping: exit code is never success evidence.
// ---------------------------------------------------------------------------

test('D1. non-zero exit is REJECTED, unobservable exit is UNKNOWN, start failure is typed', async () => {
  const rejectedRunner = fakeOpenCodeRunner({ code: 7 });
  const rejected = await makeExecutor(rejectedRunner.runner)(fakeTask28Record());
  assert.equal(rejected.outcome, 'REJECTED');
  assert.equal(rejected.result, null);

  const unknownRunner = fakeOpenCodeRunner({ kind: 'terminated-without-exit-status' });
  const unknown = await makeExecutor(unknownRunner.runner)(fakeTask28Record());
  assert.equal(unknown.outcome, 'UNKNOWN');
  assert.equal(unknown.result, null);

  const startFailedRunner = fakeOpenCodeRunner({ kind: 'start-failed', errorCode: 'ENOENT' });
  await assert.rejects(
    () => makeExecutor(startFailedRunner.runner)(fakeTask28Record()),
    (error) => error?.code === OPENCODE_CLI_EXECUTOR_PROCESS_START_FAILED,
  );
});

test('D2. malformed runner results and runner throws propagate fail-closed', async () => {
  const malformedRunner = fakeOpenCodeRunner({ verbatim: true, result: { kind: 'exited', code: 0 } });
  await assert.rejects(
    () => makeExecutor(malformedRunner.runner)(fakeTask28Record()),
    (error) => error?.code === INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
  );
  const extraKeyRunner = fakeOpenCodeRunner({
    verbatim: true,
    result: { kind: 'exited', code: 0, stdout: '', stdoutTruncated: false, extra: true },
  });
  await assert.rejects(
    () => makeExecutor(extraKeyRunner.runner)(fakeTask28Record()),
    (error) => error?.code === INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
  );
  const throwingRunner = fakeOpenCodeRunner({ throws: true });
  await assert.rejects(
    () => makeExecutor(throwingRunner.runner)(fakeTask28Record()),
    /runner failure propagated unchanged/,
  );
});

// ---------------------------------------------------------------------------
// E. Composition with the EXISTING Task 33 durable receipt contract.
// ---------------------------------------------------------------------------

test('E1. the exact six-field payload is durably recorded by the existing receipt contract', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const setup = await setupInvocationAttempt(store, clock, 'GF05-SPEC-SRC01', 'GF05-SPEC-CHILD01');
    const payload = structuredPayload('GF05-SPEC-CHILD01', {
      summary: 'read package.json and operator-cli.mjs over the read-only boundary',
      proofRefs: ['opencode:final-assistant-json'],
      evidenceRefs: ['opencode:run-format-json'],
    });
    const runner = fakeOpenCodeRunner({ payload });
    const { calls, executor } = capturingExecutor(makeExecutor(runner.runner));

    const persisted = await persistExecutorResultReceipt({
      dispatchId: setup.dispatchId,
      store,
      executor,
    });
    assert.equal(persisted.newlyRecorded, true);
    assert.equal(persisted.outcome, 'ACCEPTED');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].decisionInput.task.taskId, 'GF05-SPEC-CHILD01');
    assert.equal(persisted.receipt.dispatchId, setup.dispatchId);
    assert.equal(persisted.receipt.taskId, 'GF05-SPEC-CHILD01');
    assert.equal(persisted.receipt.status, 'SUCCEEDED');
    assert.equal(persisted.receipt.summary, payload.summary);
    assert.deepEqual(persisted.receipt.proofRefs, payload.proofRefs);
    assert.deepEqual(persisted.receipt.evidenceRefs, payload.evidenceRefs);
    assert.deepEqual(persisted.receipt.frictionObserved, payload.frictionObserved);
    assert.deepEqual(store.readExecutorResultReceipt(setup.dispatchId), persisted.receipt);
  } finally {
    removeHome(home);
  }
});

test('E2. a structured-result taskId mismatch is fail-closed and no receipt is recorded', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const setup = await setupInvocationAttempt(store, clock, 'GF05-SPEC-SRC02', 'GF05-SPEC-CHILD02');
    const runner = fakeOpenCodeRunner({
      payload: structuredPayload('GF05-SPEC-WRONG02'),
    });
    const { executor } = capturingExecutor(makeExecutor(runner.runner));

    await assert.rejects(
      () => persistExecutorResultReceipt({ dispatchId: setup.dispatchId, store, executor }),
      (error) => error?.code === 'EXECUTOR_STRUCTURED_RESULT_BINDING_MISMATCH',
    );
    assert.equal(store.readExecutorResultReceipt(setup.dispatchId), null);
  } finally {
    removeHome(home);
  }
});

test('E3. a non-zero OpenCode exit is REJECTED and records no receipt', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const setup = await setupInvocationAttempt(store, clock, 'GF05-SPEC-SRC03', 'GF05-SPEC-CHILD03');
    const runner = fakeOpenCodeRunner({ code: 3 });
    const { executor } = capturingExecutor(makeExecutor(runner.runner));

    const persisted = await persistExecutorResultReceipt({
      dispatchId: setup.dispatchId,
      store,
      executor,
    });
    assert.equal(persisted.outcome, 'REJECTED');
    assert.equal(persisted.receipt, null);
    assert.equal(store.readExecutorResultReceipt(setup.dispatchId), null);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. No scheduler / queue / retry / fallback surface in this module.
// ---------------------------------------------------------------------------

test('F1. the adapter module contains no scheduler, retry, queue, registry, or fallback behavior', () => {
  const source = readFileSync(ADAPTER_PATH, 'utf8')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(source, /setInterval|setTimeout|setImmediate/);
  assert.doesNotMatch(source, /node:timers|node:worker_threads/);
  assert.doesNotMatch(source, /while\s*\(\s*true\s*\)/);
  assert.doesNotMatch(source, /\bretryCount\b|\bbackoff\b|\bresend\b/);
  assert.doesNotMatch(source, /executorRegistry|executorSelection|fallbackExecutor/);
});
