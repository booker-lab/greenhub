// Proof for GREENHUB-COORDINATION-OPENCODE-READONLY-STRUCTURED-RESULT-EXECUTOR-GF05
// hardened by GF-12R-OPENCODE-STRUCTURED-OUTPUT-HARDENING.
// The ONE concrete OpenCode SDK structured-result executor composed with the
// EXISTING Task 33 receipt contract.
//
// Proved here (injected server-runner / SDK-client seams only; NO real OpenCode
// server and NO model call is made by this spec):
//   - configuration fails closed before any process boundary,
//   - the READ_ONLY task gate fails closed BEFORE process start,
//   - exactly one adapter-started server process and exactly one structured
//     prompt per invocation (no retry, no fallback model, no second call),
//   - the child environment is a fixed allowlist with adapter-authored
//     OPENCODE_* values applied LAST (an explicit env map cannot weaken them),
//   - the validated object is read from the assistant structured channel ONLY;
//     prose text is never parsed and can never become accepted output,
//   - StructuredOutputError / missing / malformed / oversized structured output
//     fails closed with the existing Task 33 meanings,
//   - the server process is deterministically stopped on success and on every
//     failure (including non-loopback baseUrl and prompt rejection),
//   - the Task 33 receipt contract records the exact six-field payload, a wrong
//     taskId is a fail-closed binding mismatch, and malformed payloads are
//     never recorded.
//
// All runtime state lives in isolated temp directories.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { persistExecutorInvocationAttempt } from './dispatch-executor-invocation-attempt.mjs';
import { acceptReceiverDispatch } from './dispatch-receiver-acceptance.mjs';
import { prepareDispatchTransportRequest } from './dispatch-transport-contract.mjs';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import {
  INVALID_EXECUTOR_STRUCTURED_RESULT,
  MISSING_EXECUTOR_STRUCTURED_RESULT,
  persistExecutorResultReceipt,
} from './executor-result-receipt.mjs';
import {
  createOpenCodeCliStructuredResultExecutor,
  DEFAULT_OPENCODE_SERVER_START_TIMEOUT_MS,
  defaultOpenCodeServerRunner,
  INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION,
  INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
  OPENCODE_CLI_EXECUTOR_CONFIG_CONTENT_ENV_KEY,
  OPENCODE_CLI_EXECUTOR_DISABLE_PROJECT_CONFIG_ENV_KEY,
  OPENCODE_CLI_EXECUTOR_ENV_ALLOWLIST,
  OPENCODE_CLI_EXECUTOR_PROCESS_START_FAILED,
  OPENCODE_CLI_EXECUTOR_PURE_ENV_KEY,
  OPENCODE_CLI_EXECUTOR_REQUEST_FAILED,
  OPENCODE_CLI_EXECUTOR_REQUIRES_READ_ONLY_TASK,
  OPENCODE_READONLY_AGENT_NAME,
  OPENCODE_SERVER_HOSTNAME,
  OPENCODE_SERVER_PORT,
  OPENCODE_SERVER_READY_LINE_PREFIX,
  OPENCODE_SERVER_START_TIMEOUT_ERROR_CODE,
} from './opencode-cli-executor-adapter.mjs';
import { CoordinationStore } from './store.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const ADAPTER_PATH = join(MODULE_DIRECTORY, 'opencode-cli-executor-adapter.mjs');
const ADAPTER_SOURCE = readFileSync(ADAPTER_PATH, 'utf8')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const FAKE_EXECUTABLE = process.platform === 'win32' ? 'C:\\fake\\opencode.exe' : '/fake/opencode';
const FAKE_WORKDIR = process.platform === 'win32' ? 'C:\\fake\\workdir' : '/fake/workdir';
const FAKE_MODEL = 'opencode-go/deepseek-v4.1-flash';
const FAKE_BASE_URL = 'http://127.0.0.1:43210';

function makeHome(prefix = 'greenhub-gf12r-opencode-spec-') {
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

function fakeTask28Record({
  taskId = 'GF12R-ADAPTER-CHILD',
  dispatchId = 'dispatch_gf12r_unit_01',
} = {}) {
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

function structuredPayload(taskId, overrides = {}) {
  return {
    taskId,
    status: 'SUCCEEDED',
    summary: 'opencode read-only structured probe completed',
    proofRefs: ['opencode:structured-output'],
    evidenceRefs: ['opencode:session-prompt-json-schema'],
    frictionObserved: ['NONE'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Seams: bounded server runner + typed SDK client (no real process/model).
// ---------------------------------------------------------------------------

function fakeServerRunner(observation = {}) {
  const calls = [];
  const stops = [];
  const runner = async (call) => {
    calls.push({ ...call, args: [...call.args] });
    if (observation.startFailed === true) {
      return { kind: 'start-failed', errorCode: observation.errorCode ?? 'ENOENT' };
    }
    if (observation.verbatim === true) return observation.result;
    return {
      kind: 'started',
      baseUrl: observation.baseUrl ?? FAKE_BASE_URL,
      stop: async () => {
        stops.push('stop');
        if (observation.stopThrows === true) throw new Error('stop failure');
      },
    };
  };
  return { calls, stops, runner };
}

function assistantMessageResult(payload, overrides = {}, channel = 'structured') {
  const info = {
    id: 'msg_assistant_unit',
    role: 'assistant',
    ...overrides.info,
  };
  if (channel === 'structured') {
    if (payload !== undefined) info.structured = payload;
  } else if (channel === 'structured_output') {
    if (payload !== undefined) info.structured_output = payload;
  }
  if (overrides.error !== undefined) info.error = overrides.error;
  return {
    data: { info, parts: overrides.parts ?? [] },
    error: undefined,
  };
}

function fakeSdkClient(observation = {}) {
  const calls = { create: [], prompt: [] };
  const options = [];
  const factory = async (factoryOptions) => {
    options.push(factoryOptions);
    const client = {
      session: {
        create: async (call) => {
          calls.create.push(call);
          if (observation.createThrows !== undefined) throw observation.createThrows;
          if (observation.createResult !== undefined) return observation.createResult;
          return { data: { id: 'ses_unit_01' }, error: undefined };
        },
        prompt: async (call) => {
          calls.prompt.push(call);
          if (observation.promptThrows !== undefined) throw observation.promptThrows;
          if (observation.promptResult !== undefined) return observation.promptResult;
          return assistantMessageResult(
            observation.payload,
            observation,
            observation.channel ?? 'structured',
          );
        },
      },
    };
    return client;
  };
  return { calls, options, factory };
}

function makeExecutor({ runner, clientFactory, env, model = FAKE_MODEL } = {}) {
  return createOpenCodeCliStructuredResultExecutor({
    executablePath: FAKE_EXECUTABLE,
    workdir: FAKE_WORKDIR,
    model,
    ...(runner === undefined ? {} : { runner }),
    ...(clientFactory === undefined ? {} : { clientFactory }),
    ...(env === undefined ? {} : { env }),
  });
}

async function waitFor(predicate, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
}

async function fetchSucceeds(url) {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// A. Configuration fail-closed (zero process invocations).
// ---------------------------------------------------------------------------

test('A1. invalid executor configuration fails closed before any process boundary', () => {
  const cases = [
    {
      configuration: {
        executablePath: 'relative/opencode',
        workdir: FAKE_WORKDIR,
        model: FAKE_MODEL,
      },
      label: 'relative executable path',
    },
    {
      configuration: {
        executablePath: FAKE_EXECUTABLE,
        workdir: 'relative/workdir',
        model: FAKE_MODEL,
      },
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
        model: 'no-provider',
      },
      label: 'model without provider/model form',
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
    {
      configuration: {
        executablePath: FAKE_EXECUTABLE,
        workdir: FAKE_WORKDIR,
        model: FAKE_MODEL,
        clientFactory: 'not-a-function',
      },
      label: 'non-function clientFactory',
    },
  ];
  for (const { configuration, label } of cases) {
    assert.throws(
      () => createOpenCodeCliStructuredResultExecutor(configuration),
      (error) => error?.code === INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION,
      label,
    );
  }
  assert.throws(
    () => createOpenCodeCliStructuredResultExecutor(null),
    (error) => error?.code === INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION,
  );
});

test('A2/G. invalid Task 28 input or a non-READ_ONLY task fails closed BEFORE any process start', async () => {
  const runner = fakeServerRunner();
  const client = fakeSdkClient({ payload: structuredPayload('GF12R-ADAPTER-CHILD') });
  const executor = makeExecutor({ runner: runner.runner, clientFactory: client.factory });

  await assert.rejects(
    () => executor(null),
    (error) => error?.code === INVALID_EXECUTOR_STRUCTURED_RESULT,
  );
  await assert.rejects(
    () => executor({ dispatchId: 'dispatch_gf12r_unit_01' }),
    (error) => error?.code === INVALID_EXECUTOR_STRUCTURED_RESULT,
  );
  await assert.rejects(
    () =>
      executor({
        dispatchId: 'dispatch_gf12r_unit_01',
        decisionInput: {
          task: { taskId: 'GF12R-ADAPTER-CHILD', taskKind: 'BOUNDED_MUTATION' },
        },
      }),
    (error) => error?.code === OPENCODE_CLI_EXECUTOR_REQUIRES_READ_ONLY_TASK,
  );
  assert.equal(runner.calls.length, 0, 'no server process may start before validation');
  assert.equal(client.calls.create.length, 0, 'no SDK session may be created before validation');
  assert.equal(client.calls.prompt.length, 0, 'no prompt may be sent before validation');
});

// ---------------------------------------------------------------------------
// B. The single fenced invocation: server argv, environment, payload isolation.
// ---------------------------------------------------------------------------

test('B1. exactly one server start and one structured prompt with fixed argv/body', async () => {
  const record = fakeTask28Record({ taskId: 'GF12R-ADAPTER-ARGV01' });
  const payload = structuredPayload('GF12R-ADAPTER-ARGV01');
  const runner = fakeServerRunner();
  const client = fakeSdkClient({ payload });
  const executor = makeExecutor({ runner: runner.runner, clientFactory: client.factory });

  const envelope = await executor(record);
  assert.equal(runner.calls.length, 1, 'exactly one server process per invocation');
  assert.equal(runner.stops.length, 1, 'the server is stopped exactly once');
  const call = runner.calls[0];
  assert.equal(call.command, FAKE_EXECUTABLE);
  assert.deepEqual(call.args, [
    'serve',
    `--hostname=${OPENCODE_SERVER_HOSTNAME}`,
    `--port=${OPENCODE_SERVER_PORT}`,
  ]);
  assert.equal(call.cwd, FAKE_WORKDIR);

  assert.equal(client.calls.create.length, 1, 'exactly one session create');
  assert.equal(client.calls.prompt.length, 1, 'exactly one structured prompt');
  assert.equal(client.calls.create[0].query.directory, FAKE_WORKDIR);
  assert.equal(typeof client.calls.create[0].body.title, 'string');

  const promptCall = client.calls.prompt[0];
  assert.equal(promptCall.path.id, 'ses_unit_01');
  assert.equal(promptCall.body.agent, OPENCODE_READONLY_AGENT_NAME);
  assert.deepEqual(promptCall.body.model, {
    providerID: 'opencode-go',
    modelID: 'deepseek-v4.1-flash',
  });
  assert.deepEqual(promptCall.body.parts, [{ type: 'text', text: JSON.stringify(record) }]);
  assert.equal(promptCall.body.format.type, 'json_schema');
  assert.equal(promptCall.body.format.retryCount, undefined, 'retryCount is never requested');
  const schema = promptCall.body.format.schema;
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    'taskId',
    'status',
    'summary',
    'proofRefs',
    'evidenceRefs',
    'frictionObserved',
  ]);
  assert.deepEqual(schema.properties.status.enum, ['SUCCEEDED', 'FAILED', 'BLOCKED']);
  assert.equal(schema.properties.taskId.minLength, 1);
  assert.equal(schema.properties.summary.minLength, 1);
  assert.equal(schema.properties.proofRefs.items.minLength, 1);
  assert.equal(schema.properties.evidenceRefs.items.minLength, 1);
  assert.equal(schema.properties.frictionObserved.items.minLength, 1);

  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.dispatchId, record.dispatchId);
  assert.equal(envelope.outcome, 'ACCEPTED');
  assert.deepEqual(envelope.result, payload);
});

test('B2. the child environment carries the adapter-authored read-only boundary', async () => {
  const record = fakeTask28Record({ taskId: 'GF12R-ADAPTER-ENV001' });
  const runner = fakeServerRunner();
  const client = fakeSdkClient({ payload: structuredPayload('GF12R-ADAPTER-ENV001') });
  const executor = makeExecutor({
    runner: runner.runner,
    clientFactory: client.factory,
    env: {
      PATH: 'C:\\fake-path',
      OPENCODE_CONFIG_CONTENT: '{"permission":{"edit":"allow"}}',
      OPENCODE_PURE: '0',
      OPENCODE_DISABLE_PROJECT_CONFIG: '0',
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
  assert.match(agent.prompt, /StructuredOutput/);
  assert.deepEqual(config.provider, {
    'opencode-go': {
      models: {
        'deepseek-v4.1-flash': { options: { thinking: { type: 'disabled' } } },
      },
    },
  });
  for (const name of Object.keys(env)) {
    const isAllowlisted = OPENCODE_CLI_EXECUTOR_ENV_ALLOWLIST.includes(name);
    const isAuthored = name.startsWith('OPENCODE_');
    assert.equal(isAllowlisted || isAuthored, true, `unexpected environment variable ${name}`);
  }
});

test('B5. the DeepSeek thinking-disabled option is adapter-authored, fixed, and model-scoped', async () => {
  const cases = [
    { model: 'opencode-go/deepseek-v4.1-flash', expected: true },
    { model: 'opencode-go/deepseek-v4-pro', expected: true },
    { model: 'opencode-go/glm-5.3', expected: false },
    { model: 'opencode/deepseek-v4.1-flash', expected: false },
  ];
  for (const { model, expected } of cases) {
    const runner = fakeServerRunner();
    const client = fakeSdkClient({ payload: structuredPayload('GF12R-ADAPTER-MODEL01') });
    const executor = makeExecutor({ runner: runner.runner, clientFactory: client.factory, model });
    await executor(fakeTask28Record({ taskId: 'GF12R-ADAPTER-MODEL01' }));
    const config = JSON.parse(runner.calls[0].env[OPENCODE_CLI_EXECUTOR_CONFIG_CONTENT_ENV_KEY]);
    if (expected) {
      const scopedModels = Object.values(config.provider['opencode-go'].models);
      assert.equal(scopedModels.length, 1, model);
      assert.deepEqual(scopedModels[0], { options: { thinking: { type: 'disabled' } } }, model);
    } else {
      assert.equal(config.provider, undefined, model);
    }
  }
});

test('B3. the task payload cannot select the executable, workdir, agent, model, baseUrl, or permissions', async () => {
  const record = fakeTask28Record({ taskId: 'GF12R-ADAPTER-ISO001' });
  record.decisionInput.task.executablePath = 'C:\\evil\\opencode.exe';
  record.decisionInput.task.workdir = 'C:\\evil';
  record.decisionInput.task.model = 'evil/model';
  record.decisionInput.task.agent = 'build';
  record.decisionInput.task.permission = { edit: 'allow' };
  record.decisionInput.task.baseUrl = 'https://evil.example';
  const payload = structuredPayload('GF12R-ADAPTER-ISO001');
  const runner = fakeServerRunner();
  const client = fakeSdkClient({ payload });
  const executor = makeExecutor({ runner: runner.runner, clientFactory: client.factory });

  await executor(record);
  const call = runner.calls[0];
  assert.equal(call.command, FAKE_EXECUTABLE);
  assert.equal(call.cwd, FAKE_WORKDIR);
  assert.equal(call.args.includes('C:\\evil\\opencode.exe'), false);
  assert.equal(call.args.includes('build'), false);
  assert.equal(
    call.args.some((argument) => argument.includes('evil.example')),
    false,
  );
  const config = JSON.parse(call.env[OPENCODE_CLI_EXECUTOR_CONFIG_CONTENT_ENV_KEY]);
  assert.equal(config.agent[OPENCODE_READONLY_AGENT_NAME].model, FAKE_MODEL);
  assert.equal(config.agent[OPENCODE_READONLY_AGENT_NAME].permission.edit, 'deny');
  assert.equal(client.calls.prompt[0].body.agent, OPENCODE_READONLY_AGENT_NAME);
  assert.deepEqual(client.calls.prompt[0].body.model, {
    providerID: 'opencode-go',
    modelID: 'deepseek-v4.1-flash',
  });
  assert.equal(
    client.options[0].baseUrl,
    FAKE_BASE_URL,
    'the client is bound to the adapter-started loopback server only',
  );
  assert.equal(client.options[0].directory, FAKE_WORKDIR);
});

test('B4. malformed, non-loopback, or unsupported server runner observations fail closed', async () => {
  const record = fakeTask28Record({ taskId: 'GF12R-ADAPTER-RUNNER1' });

  const startFailed = fakeServerRunner({ startFailed: true, errorCode: 'ENOENT' });
  await assert.rejects(
    () =>
      makeExecutor({
        runner: startFailed.runner,
        clientFactory: fakeSdkClient({}).factory,
      })(record),
    (error) => error?.code === OPENCODE_CLI_EXECUTOR_PROCESS_START_FAILED,
  );

  const missingStop = fakeServerRunner({
    verbatim: true,
    result: { kind: 'started', baseUrl: FAKE_BASE_URL },
  });
  await assert.rejects(
    () =>
      makeExecutor({
        runner: missingStop.runner,
        clientFactory: fakeSdkClient({}).factory,
      })(record),
    (error) => error?.code === INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
  );

  const unsupportedKind = fakeServerRunner({
    verbatim: true,
    result: { kind: 'exited', code: 0 },
  });
  await assert.rejects(
    () =>
      makeExecutor({
        runner: unsupportedKind.runner,
        clientFactory: fakeSdkClient({}).factory,
      })(record),
    (error) => error?.code === INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
  );

  const remote = fakeServerRunner({ baseUrl: 'https://evil.example' });
  const remoteClient = fakeSdkClient({ payload: structuredPayload('GF12R-ADAPTER-RUNNER1') });
  await assert.rejects(
    () => makeExecutor({ runner: remote.runner, clientFactory: remoteClient.factory })(record),
    (error) => error?.code === INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
  );
  assert.equal(remote.stops.length, 1, 'a rejected endpoint is still cleaned up');
  assert.equal(remoteClient.calls.create.length, 0, 'the record is never sent off-loopback');

  const throwingRunner = async () => {
    throw new Error('runner failure propagated unchanged');
  };
  await assert.rejects(
    () =>
      makeExecutor({ runner: throwingRunner, clientFactory: fakeSdkClient({}).factory })(record),
    /runner failure propagated unchanged/,
  );
});

// ---------------------------------------------------------------------------
// C. Structured result extraction and fail-closed parsing.
// ---------------------------------------------------------------------------

test('C1. the exact six-field structured object is ACCEPTED from the structured channel', async () => {
  const record = fakeTask28Record({ taskId: 'GF12R-ADAPTER-PARSE1' });
  const payload = structuredPayload('GF12R-ADAPTER-PARSE1');
  const runner = fakeServerRunner();
  const client = fakeSdkClient({ payload });
  const executor = makeExecutor({ runner: runner.runner, clientFactory: client.factory });

  const envelope = await executor(record);
  assert.equal(envelope.outcome, 'ACCEPTED');
  assert.deepEqual(envelope.result, payload);
  assert.deepEqual(Object.keys(envelope.result).sort(), [
    'evidenceRefs',
    'frictionObserved',
    'proofRefs',
    'status',
    'summary',
    'taskId',
  ]);
  assert.equal(runner.stops.length, 1);
});

test('C1b. the documented structured_output alias is the same exact structured channel', async () => {
  const record = fakeTask28Record({ taskId: 'GF12R-ADAPTER-PARSE2' });
  const payload = structuredPayload('GF12R-ADAPTER-PARSE2');
  const runner = fakeServerRunner();
  const client = fakeSdkClient({ payload, channel: 'structured_output' });
  const executor = makeExecutor({ runner: runner.runner, clientFactory: client.factory });

  const envelope = await executor(record);
  assert.equal(envelope.outcome, 'ACCEPTED');
  assert.deepEqual(envelope.result, payload);
});

test('C2. StructuredOutputError fails closed with no synthetic result and cleanup', async () => {
  const record = fakeTask28Record({ taskId: 'GF12R-ADAPTER-ERROR1' });
  const runner = fakeServerRunner();
  const client = fakeSdkClient({
    promptResult: assistantMessageResult(undefined, {
      error: {
        name: 'StructuredOutputError',
        data: { message: 'Model did not produce structured output', retries: 0 },
      },
    }),
  });
  const executor = makeExecutor({ runner: runner.runner, clientFactory: client.factory });

  await assert.rejects(
    () => executor(record),
    (error) => error?.code === INVALID_EXECUTOR_STRUCTURED_RESULT,
  );
  assert.equal(runner.stops.length, 1, 'the server is stopped even when the model fails');
  assert.equal(client.calls.prompt.length, 1, 'no second prompt exists');
});

test('C3. missing or null structured output fails closed as MISSING', async () => {
  for (const observation of [{ payload: undefined }, { payload: null }]) {
    const runner = fakeServerRunner();
    const client = fakeSdkClient(observation);
    const executor = makeExecutor({ runner: runner.runner, clientFactory: client.factory });
    await assert.rejects(
      () => executor(fakeTask28Record()),
      (error) => error?.code === MISSING_EXECUTOR_STRUCTURED_RESULT,
      JSON.stringify(observation.payload),
    );
    assert.equal(runner.stops.length, 1);
  }
});

test('C4. non-object structured output fails closed as INVALID', async () => {
  for (const payload of ['{"taskId":"x"}', 42, [1, 2, 3], true]) {
    const runner = fakeServerRunner();
    const client = fakeSdkClient({ payload });
    const executor = makeExecutor({ runner: runner.runner, clientFactory: client.factory });
    await assert.rejects(
      () => executor(fakeTask28Record()),
      (error) => error?.code === INVALID_EXECUTOR_STRUCTURED_RESULT,
      JSON.stringify(payload),
    );
    assert.equal(runner.stops.length, 1);
  }
});

test('C5. any other assistant error fails closed as INVALID', async () => {
  const runner = fakeServerRunner();
  const client = fakeSdkClient({
    promptResult: assistantMessageResult(undefined, {
      error: {
        name: 'APIError',
        data: { message: 'provider exploded', isRetryable: false },
      },
    }),
  });
  const executor = makeExecutor({ runner: runner.runner, clientFactory: client.factory });
  await assert.rejects(
    () => executor(fakeTask28Record()),
    (error) => error?.code === INVALID_EXECUTOR_STRUCTURED_RESULT,
  );
  assert.equal(runner.stops.length, 1);
});

test('C6. dual structured channels must agree', async () => {
  const taskId = 'GF12R-ADAPTER-DUAL01';
  const payload = structuredPayload(taskId);
  const channelInfo = {
    info: { structured: payload, structured_output: payload },
  };
  const agreeingRunner = fakeServerRunner();
  const agreeingClient = fakeSdkClient({
    promptResult: { data: { info: channelInfo.info, parts: [] }, error: undefined },
  });
  const agreeing = makeExecutor({
    runner: agreeingRunner.runner,
    clientFactory: agreeingClient.factory,
  });
  const accepted = await agreeing(fakeTask28Record({ taskId }));
  assert.equal(accepted.outcome, 'ACCEPTED');
  assert.deepEqual(accepted.result, payload);

  const disagreeingRunner = fakeServerRunner();
  const disagreeingClient = fakeSdkClient({
    promptResult: {
      data: {
        info: {
          structured: payload,
          structured_output: structuredPayload(taskId, { status: 'FAILED' }),
        },
        parts: [],
      },
      error: undefined,
    },
  });
  const disagreeing = makeExecutor({
    runner: disagreeingRunner.runner,
    clientFactory: disagreeingClient.factory,
  });
  await assert.rejects(
    () => disagreeing(fakeTask28Record({ taskId })),
    (error) => error?.code === INVALID_EXECUTOR_STRUCTURED_RESULT,
  );
  assert.equal(disagreeingRunner.stops.length, 1);
});

test('C7. SDK transport/request failures fail closed and still clean up the server', async () => {
  const cases = [
    {
      observation: { createResult: { data: undefined, error: { name: 'BadRequest' } } },
      label: 'session create error result',
    },
    {
      observation: { createResult: { data: {}, error: undefined } },
      label: 'session create without identity',
    },
    {
      observation: { promptResult: { data: undefined, error: { name: 'BadRequest' } } },
      label: 'prompt error result',
    },
    {
      observation: { promptResult: { data: {}, error: undefined } },
      label: 'prompt without assistant info',
    },
  ];
  for (const { observation, label } of cases) {
    const runner = fakeServerRunner();
    const client = fakeSdkClient(observation);
    const executor = makeExecutor({ runner: runner.runner, clientFactory: client.factory });
    await assert.rejects(
      () => executor(fakeTask28Record()),
      (error) => error?.code === OPENCODE_CLI_EXECUTOR_REQUEST_FAILED,
      label,
    );
    assert.equal(runner.stops.length, 1, label);
  }

  const promptThrowsRunner = fakeServerRunner();
  const promptThrowsClient = fakeSdkClient({ promptThrows: new Error('socket closed') });
  const promptThrows = makeExecutor({
    runner: promptThrowsRunner.runner,
    clientFactory: promptThrowsClient.factory,
  });
  await assert.rejects(() => promptThrows(fakeTask28Record()), /socket closed/);
  assert.equal(promptThrowsRunner.stops.length, 1);
  assert.equal(promptThrowsClient.calls.prompt.length, 1, 'a throw is never retried');

  const factoryThrowsRunner = fakeServerRunner();
  const factoryThrows = makeExecutor({
    runner: factoryThrowsRunner.runner,
    clientFactory: async () => {
      throw new Error('client factory failed');
    },
  });
  await assert.rejects(() => factoryThrows(fakeTask28Record()), /client factory failed/);
  assert.equal(factoryThrowsRunner.stops.length, 1);
});

// ---------------------------------------------------------------------------
// D. Prose is never output.
// ---------------------------------------------------------------------------

test('D1. prose text, even JSON-looking prose, can never become accepted output', async () => {
  const prose = JSON.stringify(structuredPayload('GF12R-ADAPTER-PARSE3'));
  const runner = fakeServerRunner();
  const client = fakeSdkClient({
    promptResult: {
      data: {
        info: { id: 'msg_prose', role: 'assistant' },
        parts: [
          {
            id: 'prt_1',
            type: 'text',
            text: `Here is the result:\n\n\`\`\`json\n${prose}\n\`\`\`\n`,
          },
        ],
      },
      error: undefined,
    },
  });
  const executor = makeExecutor({ runner: runner.runner, clientFactory: client.factory });
  await assert.rejects(
    () => executor(fakeTask28Record({ taskId: 'GF12R-ADAPTER-PARSE3' })),
    (error) => error?.code === MISSING_EXECUTOR_STRUCTURED_RESULT,
  );
  assert.equal(runner.stops.length, 1);
});

test('D2. a valid structured channel wins over prose parts and prose is never included', async () => {
  const taskId = 'GF12R-ADAPTER-PARSE4';
  const payload = structuredPayload(taskId);
  const runner = fakeServerRunner();
  const client = fakeSdkClient({
    promptResult: {
      data: {
        info: { id: 'msg_mixed', role: 'assistant', structured: payload },
        parts: [{ id: 'prt_1', type: 'text', text: 'I called the StructuredOutput tool.' }],
      },
      error: undefined,
    },
  });
  const executor = makeExecutor({ runner: runner.runner, clientFactory: client.factory });
  const envelope = await executor(fakeTask28Record({ taskId }));
  assert.equal(envelope.outcome, 'ACCEPTED');
  assert.deepEqual(envelope.result, payload);
  assert.equal(JSON.stringify(envelope.result).includes('StructuredOutput tool'), false);
});

test('D3. the adapter contains no prose JSON extraction mechanism', () => {
  assert.doesNotMatch(ADAPTER_SOURCE, /JSON\.parse/);
  assert.doesNotMatch(ADAPTER_SOURCE, /```/);
  assert.doesNotMatch(
    ADAPTER_SOURCE,
    /parseStructuredResultText|extractFinalAssistantText|finalAssistantText/,
  );
  assert.doesNotMatch(ADAPTER_SOURCE, /stripMarkdown|markdownFence/i);
});

// ---------------------------------------------------------------------------
// E/F. Composition with the EXISTING Task 33 durable receipt contract.
// ---------------------------------------------------------------------------

test('E1. the exact six-field payload is durably recorded by the existing receipt contract', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const setup = await setupInvocationAttempt(
      store,
      clock,
      'GF12R-SPEC-SRC01',
      'GF12R-SPEC-CHILD01',
    );
    const payload = structuredPayload('GF12R-SPEC-CHILD01', {
      summary: 'read package.json over the read-only boundary',
      proofRefs: ['opencode:structured-output'],
      evidenceRefs: ['opencode:session-prompt-json-schema'],
    });
    const runner = fakeServerRunner();
    const client = fakeSdkClient({ payload });
    const executor = makeExecutor({ runner: runner.runner, clientFactory: client.factory });

    const persisted = await persistExecutorResultReceipt({
      dispatchId: setup.dispatchId,
      store,
      executor,
    });
    assert.equal(persisted.newlyRecorded, true);
    assert.equal(persisted.outcome, 'ACCEPTED');
    assert.equal(runner.calls.length, 1);
    assert.equal(runner.stops.length, 1);
    assert.equal(persisted.receipt.dispatchId, setup.dispatchId);
    assert.equal(persisted.receipt.taskId, 'GF12R-SPEC-CHILD01');
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

test('E2. a structured-result taskId mismatch is fail-closed downstream and no receipt is recorded', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    const setup = await setupInvocationAttempt(
      store,
      clock,
      'GF12R-SPEC-SRC02',
      'GF12R-SPEC-CHILD02',
    );
    const runner = fakeServerRunner();
    const client = fakeSdkClient({ payload: structuredPayload('GF12R-SPEC-WRONG02') });
    const executor = makeExecutor({ runner: runner.runner, clientFactory: client.factory });

    await assert.rejects(
      () => persistExecutorResultReceipt({ dispatchId: setup.dispatchId, store, executor }),
      (error) => error?.code === 'EXECUTOR_STRUCTURED_RESULT_BINDING_MISMATCH',
    );
    assert.equal(store.readExecutorResultReceipt(setup.dispatchId), null);
    assert.equal(runner.stops.length, 1);
  } finally {
    removeHome(home);
  }
});

test('F1. unknown fields, invalid enum, empty strings, and ref violations fail closed downstream', async () => {
  const childId = 'GF12R-SPEC-CHILD03';
  const variants = [
    { label: 'unknown field', payload: structuredPayload(childId, { extraField: 'x' }) },
    { label: 'invalid status enum', payload: structuredPayload(childId, { status: 'DONE' }) },
    { label: 'empty summary', payload: structuredPayload(childId, { summary: '' }) },
    { label: 'empty proofRef entry', payload: structuredPayload(childId, { proofRefs: [''] }) },
    { label: 'non-array proofRefs', payload: structuredPayload(childId, { proofRefs: 'ref' }) },
    {
      label: 'non-string evidenceRef entry',
      payload: structuredPayload(childId, { evidenceRefs: [7] }),
    },
    {
      label: 'non-array frictionObserved',
      payload: structuredPayload(childId, { frictionObserved: 'NONE' }),
    },
    {
      label: 'empty frictionObserved entry',
      payload: structuredPayload(childId, { frictionObserved: [''] }),
    },
  ];
  for (const variant of variants) {
    const home = makeHome();
    try {
      const clock = controllableClock();
      const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
      const setup = await setupInvocationAttempt(store, clock, 'GF12R-SPEC-SRC03', childId);
      const runner = fakeServerRunner();
      const client = fakeSdkClient({ payload: variant.payload });
      const executor = makeExecutor({ runner: runner.runner, clientFactory: client.factory });
      await assert.rejects(
        () => persistExecutorResultReceipt({ dispatchId: setup.dispatchId, store, executor }),
        (error) => error?.code === INVALID_EXECUTOR_STRUCTURED_RESULT,
        variant.label,
      );
      assert.equal(store.readExecutorResultReceipt(setup.dispatchId), null, variant.label);
      assert.equal(runner.stops.length, 1, variant.label);
    } finally {
      removeHome(home);
    }
  }
});

test('F2. StructuredOutputError or missing structured output records no receipt', async () => {
  const cases = [
    {
      label: 'StructuredOutputError',
      observation: {
        promptResult: assistantMessageResult(undefined, {
          error: {
            name: 'StructuredOutputError',
            data: { message: 'Model did not produce structured output', retries: 0 },
          },
        }),
      },
      code: INVALID_EXECUTOR_STRUCTURED_RESULT,
    },
    {
      label: 'missing structured output',
      observation: { payload: undefined },
      code: MISSING_EXECUTOR_STRUCTURED_RESULT,
    },
  ];
  for (const { label, observation, code } of cases) {
    const home = makeHome();
    try {
      const clock = controllableClock();
      const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
      const setup = await setupInvocationAttempt(
        store,
        clock,
        'GF12R-SPEC-SRC04',
        'GF12R-SPEC-CHILD04',
      );
      const runner = fakeServerRunner();
      const client = fakeSdkClient(observation);
      const executor = makeExecutor({ runner: runner.runner, clientFactory: client.factory });
      await assert.rejects(
        () => persistExecutorResultReceipt({ dispatchId: setup.dispatchId, store, executor }),
        (error) => error?.code === code,
        label,
      );
      assert.equal(store.readExecutorResultReceipt(setup.dispatchId), null, label);
      assert.equal(runner.stops.length, 1, label);
    } finally {
      removeHome(home);
    }
  }
});

// ---------------------------------------------------------------------------
// H. No retry, no fallback model, no second coordination invocation.
// ---------------------------------------------------------------------------

test('H1. each invocation crosses the boundary at most once and never retries internally', async () => {
  const runner = fakeServerRunner();
  const client = fakeSdkClient({
    promptResult: assistantMessageResult(undefined, {
      error: { name: 'StructuredOutputError', data: { message: 'no output', retries: 0 } },
    }),
  });
  const executor = makeExecutor({ runner: runner.runner, clientFactory: client.factory });

  await assert.rejects(() => executor(fakeTask28Record({ taskId: 'GF12R-ADAPTER-NORETRY1' })));
  assert.equal(runner.calls.length, 1, 'one server start');
  assert.equal(client.calls.create.length, 1, 'one session create');
  assert.equal(client.calls.prompt.length, 1, 'one prompt even when the model fails');

  await assert.rejects(() => executor(fakeTask28Record({ taskId: 'GF12R-ADAPTER-NORETRY2' })));
  assert.equal(runner.calls.length, 2, 'a new explicit call starts its own single server');
  assert.equal(client.calls.create.length, 2);
  assert.equal(client.calls.prompt.length, 2);
  assert.equal(runner.stops.length, 2, 'every started server is stopped');
});

test('H2. no fallback/retry/scheduler surface exists in the adapter source', () => {
  assert.doesNotMatch(ADAPTER_SOURCE, /retryCount/);
  assert.doesNotMatch(ADAPTER_SOURCE, /\bretry\b|\bbackoff\b|\bresend\b/i);
  assert.doesNotMatch(ADAPTER_SOURCE, /setInterval|setImmediate|node:timers|node:worker_threads/);
  assert.doesNotMatch(ADAPTER_SOURCE, /fallback/i);
  assert.doesNotMatch(ADAPTER_SOURCE, /executorRegistry|executorSelection|fallbackExecutor/);
  assert.ok(DEFAULT_OPENCODE_SERVER_START_TIMEOUT_MS > 0);
  assert.equal(
    (ADAPTER_SOURCE.match(/setTimeout\(/g) ?? []).length,
    1,
    'one bounded readiness deadline',
  );
});

// ---------------------------------------------------------------------------
// I. Deterministic server/process cleanup.
// ---------------------------------------------------------------------------

test('I1. the server is stopped exactly once on success and on every failure mode', async () => {
  const scenarios = [
    { label: 'success', observation: { payload: structuredPayload('GF12R-ADAPTER-CHILD') } },
    {
      label: 'StructuredOutputError',
      observation: {
        promptResult: assistantMessageResult(undefined, {
          error: { name: 'StructuredOutputError', data: { message: 'no output', retries: 0 } },
        }),
      },
    },
    { label: 'missing structured output', observation: { payload: undefined } },
    { label: 'prompt throw', observation: { promptThrows: new Error('socket closed') } },
    {
      label: 'create error',
      observation: { createResult: { data: undefined, error: { name: 'BadRequest' } } },
    },
  ];
  for (const { label, observation } of scenarios) {
    const runner = fakeServerRunner();
    const client = fakeSdkClient(observation);
    const executor = makeExecutor({ runner: runner.runner, clientFactory: client.factory });
    try {
      await executor(fakeTask28Record());
    } catch {
      // Fail-closed outcomes are asserted elsewhere; cleanup is the subject here.
    }
    assert.equal(runner.stops.length, 1, label);
    assert.equal(client.calls.prompt.length <= 1, true, label);
  }

  const nonLoopback = fakeServerRunner({ baseUrl: 'http://192.168.0.10:43210' });
  const nonLoopbackClient = fakeSdkClient({});
  try {
    await makeExecutor({
      runner: nonLoopback.runner,
      clientFactory: nonLoopbackClient.factory,
    })(fakeTask28Record());
  } catch {
    // Expected fail-closed.
  }
  assert.equal(nonLoopback.stops.length, 1);
  assert.equal(nonLoopbackClient.calls.create.length, 0);

  const startFailed = fakeServerRunner({ startFailed: true });
  try {
    await makeExecutor({ runner: startFailed.runner, clientFactory: fakeSdkClient({}).factory })(
      fakeTask28Record(),
    );
  } catch {
    // Expected fail-closed.
  }
  assert.equal(startFailed.stops.length, 0, 'no handle exists for a failed start');
});

test('I2. the default server runner parses readiness and terminates the real process tree', async () => {
  const script = [
    "const http = require('node:http');",
    "const server = http.createServer((req, res) => { res.end('ok'); });",
    "server.listen(0, '127.0.0.1', () => {",
    `console.log('${OPENCODE_SERVER_READY_LINE_PREFIX} on http://127.0.0.1:' + server.address().port);`,
    '});',
    'setInterval(() => {}, 1000);',
  ].join(' ');
  const started = await defaultOpenCodeServerRunner({
    command: process.execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    env: process.env,
    startTimeoutMs: 5000,
  });
  assert.equal(started.kind, 'started');
  assert.match(started.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(await fetchSucceeds(started.baseUrl), true);
  await started.stop();
  await started.stop();
  const closed = await waitFor(async () => !(await fetchSucceeds(started.baseUrl)));
  assert.equal(closed, true, 'the server port must be closed after stop');
});

test('I3. the default server runner fails closed and cleans up on timeout, early exit, and missing executable', async () => {
  const directory = makeHome('greenhub-gf12r-runner-');
  try {
    const portFile = join(directory, 'port.txt');
    const timeoutScript = [
      "const http = require('node:http');",
      "const fs = require('node:fs');",
      `const portFile = ${JSON.stringify(portFile)};`,
      'const server = http.createServer(() => {});',
      "server.listen(0, '127.0.0.1', () => { fs.writeFileSync(portFile, String(server.address().port)); });",
      'setInterval(() => {}, 1000);',
    ].join(' ');
    const timedOut = await defaultOpenCodeServerRunner({
      command: process.execPath,
      args: ['-e', timeoutScript],
      cwd: directory,
      env: process.env,
      startTimeoutMs: 1500,
    });
    assert.equal(timedOut.kind, 'start-failed');
    assert.equal(timedOut.errorCode, OPENCODE_SERVER_START_TIMEOUT_ERROR_CODE);
    const boundPort = Number(readFileSync(portFile, 'utf8'));
    const closed = await waitFor(
      async () => !(await fetchSucceeds(`http://127.0.0.1:${boundPort}`)),
    );
    assert.equal(closed, true, 'the timed-out server process must be terminated');

    const exited = await defaultOpenCodeServerRunner({
      command: process.execPath,
      args: ['-e', 'process.exit(3)'],
      cwd: directory,
      env: process.env,
      startTimeoutMs: 5000,
    });
    assert.equal(exited.kind, 'start-failed');
    assert.match(exited.errorCode, /EXITED_BEFORE_READY_3/);

    const missing = await defaultOpenCodeServerRunner({
      command: join(directory, 'greenhub-missing-opencode.exe'),
      args: ['serve'],
      cwd: directory,
      env: process.env,
      startTimeoutMs: 5000,
    });
    assert.equal(missing.kind, 'start-failed');
    assert.equal(typeof missing.errorCode, 'string');
    assert.notEqual(missing.errorCode.length, 0);
  } finally {
    removeHome(directory);
  }
});
