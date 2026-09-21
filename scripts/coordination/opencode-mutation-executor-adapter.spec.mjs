// Proof for PM-03-OPENCODE-BOUNDED-MUTATION-EXECUTOR.
// The SEPARATE BOUNDED_MUTATION OpenCode executor adapter. The READ_ONLY
// adapter (opencode-cli-executor-adapter.mjs) is pinned unchanged and its
// behavior is re-verified here; no operator wiring, no candidate, no PR.
//
// Proved here (injected server-runner / SDK-client seams only; NO real OpenCode
// server, NO model call, NO production provider, NO GitHub mutation):
//   - configuration and capability gates fail closed BEFORE the process start,
//   - only BOUNDED_MUTATION with allowsWrite=true and a non-empty ownedSurface
//     is executable; READ_ONLY tasks are rejected,
//   - the surface must be a detached, clean git root at the expected baseline
//     SHA, separate from the canonical checkout,
//   - the child environment drops every credential-shaped variable, applies the
//     adapter-authored git safety configuration LAST, and the git push path
//     fails closed inside that environment (differential control push proof),
//   - the child OpenCode configuration grants exactly edit/bash and denies
//     webfetch/websearch/task/external_directory/skill/question,
//   - post-execution changed paths (modified/staged/untracked/deleted/renamed)
//     are adapter-observed and enforced against ownedSurface / forbiddenPaths /
//     maxPaths,
//   - commit / branch / ref / remote creation is a BOUNDARY_VIOLATION,
//   - malformed / missing / mismatched structured output fails closed,
//   - runner failures and timeouts never trigger a second process or prompt.
//
// All runtime state lives in isolated temp git surfaces under the OS temp dir.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createOpenCodeCliStructuredResultExecutor,
  OPENCODE_CLI_EXECUTOR_CONFIG_CONTENT_ENV_KEY as READ_ONLY_CONFIG_CONTENT_ENV_KEY,
  OPENCODE_CLI_EXECUTOR_REQUIRES_READ_ONLY_TASK,
} from './opencode-cli-executor-adapter.mjs';
import {
  BOUNDARY_VIOLATION,
  BOUNDARY_VIOLATION_KINDS,
  createOpenCodeMutationExecutorAdapter,
  DEFAULT_MUTATION_EXECUTION_TIMEOUT_MS,
  INVALID_OPENCODE_MUTATION_EXECUTOR_CONFIGURATION,
  INVALID_OPENCODE_MUTATION_EXECUTOR_INPUT,
  INVALID_OPENCODE_MUTATION_EXECUTOR_RUNNER_RESULT,
  INVALID_OPENCODE_MUTATION_EXECUTOR_STRUCTURED_RESULT,
  MISSING_OPENCODE_MUTATION_EXECUTOR_STRUCTURED_RESULT,
  MUTATION_EXECUTOR_RESULT_SCHEMA_VERSION,
  MUTATION_EXECUTOR_STRUCTURED_RESULT_FIELDS,
  OPENCODE_MUTATION_AGENT_NAME,
  OPENCODE_MUTATION_EXECUTOR_CONFIG_CONTENT_ENV_KEY,
  OPENCODE_MUTATION_EXECUTOR_DENIED_ENV_NAME_PATTERN,
  OPENCODE_MUTATION_EXECUTOR_DISABLE_PROJECT_CONFIG_ENV_KEY,
  OPENCODE_MUTATION_EXECUTOR_ENV_ALLOWLIST,
  OPENCODE_MUTATION_EXECUTOR_EXECUTION_TIMEOUT,
  OPENCODE_MUTATION_EXECUTOR_GIT_SAFETY_ENV,
  OPENCODE_MUTATION_EXECUTOR_PROCESS_START_FAILED,
  OPENCODE_MUTATION_EXECUTOR_PURE_ENV_KEY,
  OPENCODE_MUTATION_EXECUTOR_REQUEST_FAILED,
  OPENCODE_MUTATION_EXECUTOR_REQUIRES_BASELINE_HEAD,
  OPENCODE_MUTATION_EXECUTOR_REQUIRES_BOUNDED_MUTATION_TASK,
  OPENCODE_MUTATION_EXECUTOR_REQUIRES_CLEAN_SURFACE,
  OPENCODE_MUTATION_EXECUTOR_REQUIRES_DETACHED_HEAD,
  OPENCODE_MUTATION_EXECUTOR_REQUIRES_ISOLATED_WORKDIR,
  OPENCODE_MUTATION_EXECUTOR_REQUIRES_OWNED_SURFACE,
  OPENCODE_MUTATION_EXECUTOR_REQUIRES_WRITE_BOUNDARY,
  OPENCODE_MUTATION_EXECUTOR_TASK_BINDING_MISMATCH,
  OPENCODE_MUTATION_SERVER_HOSTNAME,
  OPENCODE_MUTATION_SERVER_PORT,
} from './opencode-mutation-executor-adapter.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MUTATION_ADAPTER_PATH = join(
  MODULE_DIRECTORY,
  'opencode-mutation-executor-adapter.mjs',
);
const MUTATION_ADAPTER_SOURCE = readFileSync(MUTATION_ADAPTER_PATH, 'utf8');
const READ_ONLY_ADAPTER_PATH = join(MODULE_DIRECTORY, 'opencode-cli-executor-adapter.mjs');

// Change detector for the frozen READ_ONLY adapter. This digest must only be
// updated by a deliberate task that owns a READ_ONLY adapter change.
const READ_ONLY_ADAPTER_SHA256_PIN =
  '0e9919906ffbe13a31c8b8da6f3ed64f78a675797905bca7702ce2383cc76d05';

const FAKE_EXECUTABLE = process.platform === 'win32' ? 'C:\\fake\\opencode.exe' : '/fake/opencode';
const FAKE_WORKDIR = process.platform === 'win32' ? 'C:\\fake\\workdir' : '/fake/workdir';
const FAKE_CANONICAL = process.platform === 'win32' ? 'C:\\fake\\canonical' : '/fake/canonical';
const FAKE_MODEL = 'opencode-go/deepseek-v4.1-flash';
const FAKE_BASE_URL = 'http://127.0.0.1:43210';

function gitCapture(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

function gitOk(cwd, args) {
  const result = gitCapture(cwd, args);
  assert.equal(
    result.status,
    0,
    `git ${args.join(' ')} failed (${result.status}): ${result.stderr ?? ''}`,
  );
  return result.stdout.replace(/\r\n/g, '\n').trim();
}

/**
 * Create ONE isolated detached git surface under the OS temp dir. Never a
 * worktree, never a branch checkout (unless the test asks for one).
 */
function makeSurface({ files, detached = true, extraFiles = {} } = {}) {
  const baselineFiles = files ?? { 'lib/a.txt': 'alpha\n', 'docs/b.txt': 'beta\n' };
  const dir = mkdtempSync(join(tmpdir(), 'greenhub-pm03-surface-'));
  gitOk(dir, ['init', '-q']);
  gitOk(dir, ['config', 'user.email', 'greenhub-pm03-spec@example.invalid']);
  gitOk(dir, ['config', 'user.name', 'Greenhub PM03 Spec']);
  gitOk(dir, ['config', 'commit.gpgsign', 'false']);
  const allFiles = { ...baselineFiles, ...extraFiles };
  for (const [relativePath, content] of Object.entries(allFiles)) {
    const absolutePath = join(dir, ...relativePath.split('/'));
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  gitOk(dir, ['add', '-A']);
  gitOk(dir, ['commit', '-q', '-m', 'baseline']);
  const baselineSha = gitOk(dir, ['rev-parse', 'HEAD']);
  if (detached) gitOk(dir, ['checkout', '-q', '--detach']);
  return { dir, realDir: realpathSync.native(dir), baselineSha };
}

function makeCanonicalDirectory() {
  return mkdtempSync(join(tmpdir(), 'greenhub-pm03-canonical-'));
}

function removeDirectories(...directories) {
  for (const directory of directories) {
    if (typeof directory === 'string' && directory.length > 0) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch {
        // Best-effort temp cleanup only.
      }
    }
  }
}

function mutationInput({
  taskId,
  surfaceDir,
  baselineSha,
  ownedSurface = ['lib'],
  mutationBoundary = { allowsWrite: true },
  dispatchId = 'dispatch_pm03_unit_01',
  taskOverrides = {},
}) {
  return {
    dispatchId,
    decisionInput: {
      task: {
        taskId,
        taskKind: 'BOUNDED_MUTATION',
        ownedSurface,
        mutationBoundary,
        ...taskOverrides,
      },
    },
    workingDirectory: surfaceDir,
    expectedBaselineSha: baselineSha,
  };
}

function makeAdapter({ workdir, canonicalCheckoutPath, runner, clientFactory, env, executionTimeoutMs, model = FAKE_MODEL } = {}) {
  return createOpenCodeMutationExecutorAdapter({
    executablePath: FAKE_EXECUTABLE,
    workdir: workdir ?? FAKE_WORKDIR,
    canonicalCheckoutPath: canonicalCheckoutPath ?? FAKE_CANONICAL,
    model,
    ...(runner === undefined ? {} : { runner }),
    ...(clientFactory === undefined ? {} : { clientFactory }),
    ...(env === undefined ? {} : { env }),
    ...(executionTimeoutMs === undefined ? {} : { executionTimeoutMs }),
  });
}

function structuredMutationPayload(taskId, overrides = {}) {
  return {
    taskId,
    status: 'SUCCEEDED',
    summary: 'bounded mutation completed inside the isolated surface',
    testsExecuted: ['node --test scripts/coordination/opencode-mutation-executor-adapter.spec.mjs'],
    proofRefs: ['git:status-readback'],
    evidenceRefs: ['git:authority-snapshot'],
    frictionObserved: ['NONE'],
    ...overrides,
  };
}

function fakeServerRunner(observation = {}) {
  const calls = [];
  const stops = [];
  const runner = async (call) => {
    calls.push({ ...call, args: [...call.args] });
    if (observation.throws !== undefined) throw observation.throws;
    if (observation.verbatim === true) return observation.result;
    if (observation.startFailed === true) {
      return { kind: 'start-failed', errorCode: observation.errorCode ?? 'ENOENT' };
    }
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
    id: 'msg_mutation_assistant_unit',
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
    return {
      session: {
        create: async (call) => {
          calls.create.push(call);
          if (observation.createThrows !== undefined) throw observation.createThrows;
          if (observation.createResult !== undefined) return observation.createResult;
          return { data: { id: 'ses_mutation_unit_01' }, error: undefined };
        },
        prompt: async (call) => {
          calls.prompt.push(call);
          if (observation.onPrompt !== undefined) await observation.onPrompt(call);
          if (observation.neverResolve === true) return new Promise(() => {});
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
  };
  return { calls, options, factory };
}

// ---------------------------------------------------------------------------
// A. Configuration fail-closed (zero process invocations).
// ---------------------------------------------------------------------------

test('A1. invalid mutation executor configuration fails closed before any process boundary', () => {
  const cases = [
    { configuration: null, label: 'null configuration' },
    {
      configuration: { executablePath: 'relative/opencode', workdir: FAKE_WORKDIR, canonicalCheckoutPath: FAKE_CANONICAL, model: FAKE_MODEL },
      label: 'relative executable path',
    },
    {
      configuration: { executablePath: FAKE_EXECUTABLE, workdir: 'relative/workdir', canonicalCheckoutPath: FAKE_CANONICAL, model: FAKE_MODEL },
      label: 'relative workdir',
    },
    {
      configuration: { executablePath: FAKE_EXECUTABLE, workdir: FAKE_WORKDIR, canonicalCheckoutPath: 'relative/canonical', model: FAKE_MODEL },
      label: 'relative canonical checkout path',
    },
    {
      configuration: { executablePath: FAKE_EXECUTABLE, workdir: FAKE_WORKDIR, canonicalCheckoutPath: FAKE_CANONICAL, model: '' },
      label: 'empty model',
    },
    {
      configuration: { executablePath: FAKE_EXECUTABLE, workdir: FAKE_WORKDIR, canonicalCheckoutPath: FAKE_CANONICAL, model: 'no-provider' },
      label: 'model without provider/model form',
    },
    {
      configuration: { executablePath: FAKE_EXECUTABLE, workdir: FAKE_WORKDIR, canonicalCheckoutPath: FAKE_CANONICAL, model: FAKE_MODEL, unknownField: true },
      label: 'unknown configuration field',
    },
    {
      configuration: { executablePath: FAKE_EXECUTABLE, workdir: FAKE_WORKDIR, canonicalCheckoutPath: FAKE_CANONICAL, model: FAKE_MODEL, runner: 'not-a-function' },
      label: 'non-function runner',
    },
    {
      configuration: { executablePath: FAKE_EXECUTABLE, workdir: FAKE_WORKDIR, canonicalCheckoutPath: FAKE_CANONICAL, model: FAKE_MODEL, clientFactory: 'not-a-function' },
      label: 'non-function clientFactory',
    },
    {
      configuration: { executablePath: FAKE_EXECUTABLE, workdir: FAKE_WORKDIR, canonicalCheckoutPath: FAKE_CANONICAL, model: FAKE_MODEL, executionTimeoutMs: 0 },
      label: 'zero execution timeout',
    },
    {
      configuration: { executablePath: FAKE_EXECUTABLE, workdir: FAKE_WORKDIR, canonicalCheckoutPath: FAKE_CANONICAL, model: FAKE_MODEL, executionTimeoutMs: 'soon' },
      label: 'non-integer execution timeout',
    },
  ];
  for (const { configuration, label } of cases) {
    assert.throws(
      () => (configuration === null ? createOpenCodeMutationExecutorAdapter(null) : makeAdapterFrom(configuration)),
      (error) => error?.code === INVALID_OPENCODE_MUTATION_EXECUTOR_CONFIGURATION,
      label,
    );
  }
  assert.ok(DEFAULT_MUTATION_EXECUTION_TIMEOUT_MS > 0);
});

function makeAdapterFrom(configuration) {
  return createOpenCodeMutationExecutorAdapter(configuration);
}

// ---------------------------------------------------------------------------
// B. Capability and surface gates (zero process starts on failure).
// ---------------------------------------------------------------------------

test('B1. one BOUNDED_MUTATION input starts exactly one runner and returns the mutation result', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const input = mutationInput({
      taskId: 'PM03-SPEC-SUCCESS01',
      surfaceDir: surface.realDir,
      baselineSha: surface.baselineSha,
      ownedSurface: ['lib'],
    });
    const payload = structuredMutationPayload('PM03-SPEC-SUCCESS01');
    const runner = fakeServerRunner();
    const client = fakeSdkClient({
      payload,
      onPrompt: () => {
        writeFileSync(join(surface.dir, 'lib', 'a.txt'), 'alpha changed\n');
      },
    });
    const executor = makeAdapter({
      workdir: surface.realDir,
      canonicalCheckoutPath: canonical,
      runner: runner.runner,
      clientFactory: client.factory,
    });

    const result = await executor(input);
    assert.equal(runner.calls.length, 1, 'exactly one server process per invocation');
    assert.equal(runner.stops.length, 1, 'the server is stopped exactly once');
    assert.equal(runner.calls[0].command, FAKE_EXECUTABLE);
    assert.deepEqual(runner.calls[0].args, [
      'serve',
      `--hostname=${OPENCODE_MUTATION_SERVER_HOSTNAME}`,
      `--port=${OPENCODE_MUTATION_SERVER_PORT}`,
    ]);
    assert.equal(runner.calls[0].cwd, surface.realDir);

    assert.equal(client.calls.create.length, 1, 'exactly one session create');
    assert.equal(client.calls.prompt.length, 1, 'exactly one structured prompt');
    assert.equal(client.calls.create[0].query.directory, surface.realDir);
    assert.equal(client.calls.prompt[0].body.agent, OPENCODE_MUTATION_AGENT_NAME);
    assert.deepEqual(client.calls.prompt[0].body.model, {
      providerID: 'opencode-go',
      modelID: 'deepseek-v4.1-flash',
    });
    assert.deepEqual(client.calls.prompt[0].body.parts, [
      { type: 'text', text: JSON.stringify(input) },
    ]);
    assert.equal(client.calls.prompt[0].body.format.retryCount, undefined);

    assert.equal(result.schemaVersion, MUTATION_EXECUTOR_RESULT_SCHEMA_VERSION);
    assert.equal(result.dispatchId, input.dispatchId);
    assert.equal(result.taskId, 'PM03-SPEC-SUCCESS01');
    assert.equal(result.status, 'SUCCEEDED');
    assert.equal(result.summary, payload.summary);
    assert.deepEqual(result.changedPaths, ['lib/a.txt']);
    assert.deepEqual(result.testsExecuted, payload.testsExecuted);
    assert.deepEqual(result.proofRefs, payload.proofRefs);
    assert.deepEqual(result.evidenceRefs, payload.evidenceRefs);
    assert.deepEqual(result.frictionObserved, payload.frictionObserved);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(gitOk(surface.dir, ['rev-parse', 'HEAD']), surface.baselineSha, 'HEAD unchanged');
    assert.equal(
      readFileSync(join(surface.dir, 'lib', 'a.txt'), 'utf8'),
      'alpha changed\n',
      'the isolated surface keeps the executor changes (no reset)',
    );
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('B2. a READ_ONLY task is rejected before any process start', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const runner = fakeServerRunner();
    const client = fakeSdkClient({});
    const executor = makeAdapter({
      workdir: surface.realDir,
      canonicalCheckoutPath: canonical,
      runner: runner.runner,
      clientFactory: client.factory,
    });
    const input = mutationInput({
      taskId: 'PM03-SPEC-READONLY1',
      surfaceDir: surface.realDir,
      baselineSha: surface.baselineSha,
      taskOverrides: { taskKind: 'READ_ONLY' },
    });
    await assert.rejects(
      () => executor(input),
      (error) => error?.code === OPENCODE_MUTATION_EXECUTOR_REQUIRES_BOUNDED_MUTATION_TASK,
    );
    assert.equal(runner.calls.length, 0, 'zero server processes');
    assert.equal(client.calls.prompt.length, 0, 'zero prompts');
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('B3. allowsWrite=false or a missing boundary is rejected before any process start', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const runner = fakeServerRunner();
    const executor = makeAdapter({
      workdir: surface.realDir,
      canonicalCheckoutPath: canonical,
      runner: runner.runner,
      clientFactory: fakeSdkClient({}).factory,
    });
    await assert.rejects(
      () =>
        executor(
          mutationInput({
            taskId: 'PM03-SPEC-NOWRITE1',
            surfaceDir: surface.realDir,
            baselineSha: surface.baselineSha,
            mutationBoundary: { allowsWrite: false },
          }),
        ),
      (error) => error?.code === OPENCODE_MUTATION_EXECUTOR_REQUIRES_WRITE_BOUNDARY,
    );
    await assert.rejects(
      () =>
        executor(
          mutationInput({
            taskId: 'PM03-SPEC-NOBOUND1',
            surfaceDir: surface.realDir,
            baselineSha: surface.baselineSha,
            mutationBoundary: null,
          }),
        ),
      (error) => error?.code === INVALID_OPENCODE_MUTATION_EXECUTOR_INPUT,
    );
    assert.equal(runner.calls.length, 0);
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('B4. an empty ownedSurface is rejected before any process start', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const runner = fakeServerRunner();
    const executor = makeAdapter({
      workdir: surface.realDir,
      canonicalCheckoutPath: canonical,
      runner: runner.runner,
      clientFactory: fakeSdkClient({}).factory,
    });
    for (const ownedSurface of [[], null]) {
      await assert.rejects(
        () =>
          executor(
            mutationInput({
              taskId: 'PM03-SPEC-NOOWNED1',
              surfaceDir: surface.realDir,
              baselineSha: surface.baselineSha,
              ownedSurface,
            }),
          ),
        (error) => error?.code === OPENCODE_MUTATION_EXECUTOR_REQUIRES_OWNED_SURFACE,
      );
    }
    assert.equal(runner.calls.length, 0);
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('B5. a workingDirectory mismatch with the adapter-fixed workdir is rejected', async () => {
  const surface = makeSurface();
  const otherSurface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const runner = fakeServerRunner();
    const executor = makeAdapter({
      workdir: surface.realDir,
      canonicalCheckoutPath: canonical,
      runner: runner.runner,
      clientFactory: fakeSdkClient({}).factory,
    });
    await assert.rejects(
      () =>
        executor(
          mutationInput({
            taskId: 'PM03-SPEC-MISMATCH1',
            surfaceDir: otherSurface.realDir,
            baselineSha: otherSurface.baselineSha,
          }),
        ),
      (error) => error?.code === INVALID_OPENCODE_MUTATION_EXECUTOR_INPUT,
    );
    assert.equal(runner.calls.length, 0);
  } finally {
    removeDirectories(surface.dir, otherSurface.dir, canonical);
  }
});

test('B6. the canonical checkout as workingDirectory is rejected before any process start', async () => {
  const canonical = makeCanonicalDirectory();
  try {
    const runner = fakeServerRunner();
    const executor = makeAdapter({
      workdir: canonical,
      canonicalCheckoutPath: canonical,
      runner: runner.runner,
      clientFactory: fakeSdkClient({}).factory,
    });
    await assert.rejects(
      () =>
        executor({
          dispatchId: 'dispatch_pm03_unit_06',
          decisionInput: { task: { taskId: 'PM03-SPEC-CANON01', taskKind: 'BOUNDED_MUTATION', ownedSurface: ['lib'], mutationBoundary: { allowsWrite: true } } },
          workingDirectory: canonical,
          expectedBaselineSha: '0'.repeat(40),
        }),
      (error) => error?.code === OPENCODE_MUTATION_EXECUTOR_REQUIRES_ISOLATED_WORKDIR,
    );
    assert.equal(runner.calls.length, 0);
  } finally {
    removeDirectories(canonical);
  }
});

test('B7. a HEAD mismatch with the expected baseline SHA is rejected before any process start', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const runner = fakeServerRunner();
    const executor = makeAdapter({
      workdir: surface.realDir,
      canonicalCheckoutPath: canonical,
      runner: runner.runner,
      clientFactory: fakeSdkClient({}).factory,
    });
    await assert.rejects(
      () =>
        executor(
          mutationInput({
            taskId: 'PM03-SPEC-BASEHEAD1',
            surfaceDir: surface.realDir,
            baselineSha: 'f'.repeat(40),
          }),
        ),
      (error) => error?.code === OPENCODE_MUTATION_EXECUTOR_REQUIRES_BASELINE_HEAD,
    );
    assert.equal(runner.calls.length, 0);
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('B8. a branch checkout surface is rejected before any process start', async () => {
  const surface = makeSurface({ detached: false });
  const canonical = makeCanonicalDirectory();
  try {
    const runner = fakeServerRunner();
    const executor = makeAdapter({
      workdir: surface.realDir,
      canonicalCheckoutPath: canonical,
      runner: runner.runner,
      clientFactory: fakeSdkClient({}).factory,
    });
    const attachedRef = gitOk(surface.dir, ['symbolic-ref', 'HEAD']);
    assert.notEqual(attachedRef.length, 0);
    await assert.rejects(
      () =>
        executor(
          mutationInput({
            taskId: 'PM03-SPEC-BRANCH01',
            surfaceDir: surface.realDir,
            baselineSha: surface.baselineSha,
          }),
        ),
      (error) => error?.code === OPENCODE_MUTATION_EXECUTOR_REQUIRES_DETACHED_HEAD,
    );
    assert.equal(runner.calls.length, 0);
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('B9. a dirty mutation surface is rejected before any process start', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    writeFileSync(join(surface.dir, 'lib', 'a.txt'), 'pre-existing dirty change\n');
    const runner = fakeServerRunner();
    const executor = makeAdapter({
      workdir: surface.realDir,
      canonicalCheckoutPath: canonical,
      runner: runner.runner,
      clientFactory: fakeSdkClient({}).factory,
    });
    await assert.rejects(
      () =>
        executor(
          mutationInput({
            taskId: 'PM03-SPEC-DIRTY001',
            surfaceDir: surface.realDir,
            baselineSha: surface.baselineSha,
          }),
        ),
      (error) => error?.code === OPENCODE_MUTATION_EXECUTOR_REQUIRES_CLEAN_SURFACE,
    );
    assert.equal(runner.calls.length, 0);
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('B10. malformed invocation input records fail closed before any process start', async () => {
  const goodTask = {
    taskId: 'PM03-SPEC-INPUT001',
    taskKind: 'BOUNDED_MUTATION',
    ownedSurface: ['lib'],
    mutationBoundary: { allowsWrite: true },
  };
  const base = {
    dispatchId: 'dispatch_pm03_unit_10',
    decisionInput: { task: goodTask },
    workingDirectory: FAKE_WORKDIR,
    expectedBaselineSha: '0'.repeat(40),
  };
  const cases = [
    { input: null, label: 'null input' },
    { input: {}, label: 'empty input' },
    { input: { ...base, dispatchId: '' }, label: 'empty dispatchId' },
    { input: { ...base, dispatchId: undefined }, label: 'missing dispatchId' },
    { input: { ...base, decisionInput: undefined }, label: 'missing decisionInput' },
    { input: { ...base, decisionInput: { task: null } }, label: 'missing task envelope' },
    {
      input: { ...base, decisionInput: { task: { ...goodTask, taskId: '' } } },
      label: 'empty taskId',
    },
    { input: { ...base, workingDirectory: 'relative/dir' }, label: 'relative workingDirectory' },
    { input: { ...base, workingDirectory: undefined }, label: 'missing workingDirectory' },
    { input: { ...base, expectedBaselineSha: 'not-a-sha' }, label: 'malformed expected SHA' },
    { input: { ...base, expectedBaselineSha: 'A'.repeat(40) }, label: 'uppercase expected SHA' },
  ];
  const runner = fakeServerRunner();
  const executor = makeAdapter({
    workdir: FAKE_WORKDIR,
    canonicalCheckoutPath: FAKE_CANONICAL,
    runner: runner.runner,
    clientFactory: fakeSdkClient({}).factory,
  });
  for (const { input, label } of cases) {
    await assert.rejects(
      () => executor(input),
      (error) => error?.code === INVALID_OPENCODE_MUTATION_EXECUTOR_INPUT,
      label,
    );
  }
  assert.equal(runner.calls.length, 0, 'zero server processes for malformed input');
});

// ---------------------------------------------------------------------------
// C. Child environment, credential isolation, publication fail-closed scope.
// ---------------------------------------------------------------------------

test('C1. the child environment carries the authored mutation config and the git safety boundary', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const taskId = 'PM03-SPEC-ENV00001';
    const runner = fakeServerRunner();
    const client = fakeSdkClient({ payload: structuredMutationPayload(taskId) });
    const executor = makeAdapter({
      workdir: surface.realDir,
      canonicalCheckoutPath: canonical,
      runner: runner.runner,
      clientFactory: client.factory,
      env: {
        PATH: 'C:\\fake-path',
        OPENCODE_CONFIG_CONTENT: '{"permission":{"edit":"deny"}}',
        OPENCODE_PURE: '0',
        OPENCODE_DISABLE_PROJECT_CONFIG: '0',
        NOT_ALLOWLISTED: 'must-not-be-copied',
      },
    });
    await executor(
      mutationInput({
        taskId,
        surfaceDir: surface.realDir,
        baselineSha: surface.baselineSha,
        mutationBoundary: { allowsWrite: true, forbiddenPaths: ['docs'] },
        ownedSurface: ['lib'],
      }),
    );
    assert.equal(runner.calls.length, 1);
    const env = runner.calls[0].env;
    assert.equal(env.PATH, 'C:\\fake-path');
    assert.equal(env.NOT_ALLOWLISTED, undefined, 'non-allowlisted variables are dropped');
    assert.equal(env.OPENCODE_CONFIG_CONTENT, env[OPENCODE_MUTATION_EXECUTOR_CONFIG_CONTENT_ENV_KEY]);
    assert.equal(env[OPENCODE_MUTATION_EXECUTOR_PURE_ENV_KEY], '1');
    assert.equal(env[OPENCODE_MUTATION_EXECUTOR_DISABLE_PROJECT_CONFIG_ENV_KEY], '1');
    for (const [name, value] of Object.entries(OPENCODE_MUTATION_EXECUTOR_GIT_SAFETY_ENV)) {
      assert.equal(env[name], value, `git safety variable ${name}`);
    }
    const config = JSON.parse(env[OPENCODE_MUTATION_EXECUTOR_CONFIG_CONTENT_ENV_KEY]);
    assert.equal(config.share, 'disabled');
    assert.equal(config.permission.edit, 'allow');
    assert.equal(config.permission.bash, 'allow');
    assert.equal(config.permission.webfetch, 'deny');
    assert.equal(config.permission.websearch, 'deny');
    assert.equal(config.permission.task, 'deny');
    assert.equal(config.permission.external_directory, 'deny');
    assert.equal(config.permission.skill, 'deny');
    assert.equal(config.permission.question, 'deny');
    const agent = config.agent[OPENCODE_MUTATION_AGENT_NAME];
    assert.equal(agent.mode, 'primary');
    assert.equal(agent.model, FAKE_MODEL);
    assert.deepEqual(agent.permission, config.permission);
    assert.match(agent.prompt, /owned surface/i);
    assert.match(agent.prompt, /lib/);
    assert.match(agent.prompt, /docs/);
    assert.match(agent.prompt, /git commit/);
    assert.match(agent.prompt, /git push/);
    assert.match(agent.prompt, /StructuredOutput/);
    assert.match(agent.prompt, /BLOCKED/);
    assert.deepEqual(config.provider, {
      'opencode-go': {
        models: {
          'deepseek-v4.1-flash': { options: { thinking: { type: 'disabled' } } },
        },
      },
    });
    for (const name of Object.keys(env)) {
      const isAllowlisted = OPENCODE_MUTATION_EXECUTOR_ENV_ALLOWLIST.includes(name);
      const isAuthored =
        name.startsWith('OPENCODE_') || name.startsWith('GIT_');
      assert.equal(isAllowlisted || isAuthored, true, `unexpected environment variable ${name}`);
    }
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('C2. credential-shaped variables can never reach the child environment', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const taskId = 'PM03-SPEC-ENVCRED1';
    const credentialNames = [
      'GH_TOKEN',
      'GITHUB_TOKEN',
      'GH_ENTERPRISE_TOKEN',
      'VERCEL_TOKEN',
      'RAILWAY_TOKEN',
      'FIREBASE_TOKEN',
      'FIREBASE_SERVICE_ACCOUNT',
      'ALIGO_ACCESS_KEY',
      'SSH_AUTH_SOCK',
      'AWS_SECRET_ACCESS_KEY',
      'STRIPE_SECRET_KEY',
      'PAYMENT_PROVIDER_SECRET',
      'MY_API_KEY',
      'DEPLOY_CREDENTIAL',
    ];
    const explicitEnv = Object.fromEntries(credentialNames.map((name) => [name, 'secret-value']));
    explicitEnv.PATH = process.env.PATH ?? '';
    const runner = fakeServerRunner();
    const client = fakeSdkClient({ payload: structuredMutationPayload(taskId) });
    const executor = makeAdapter({
      workdir: surface.realDir,
      canonicalCheckoutPath: canonical,
      runner: runner.runner,
      clientFactory: client.factory,
      env: explicitEnv,
    });
    await executor(
      mutationInput({ taskId, surfaceDir: surface.realDir, baselineSha: surface.baselineSha }),
    );
    const env = runner.calls[0].env;
    for (const name of credentialNames) {
      assert.equal(env[name], undefined, `${name} must never be projected`);
    }
    for (const name of Object.keys(env)) {
      assert.doesNotMatch(
        name,
        OPENCODE_MUTATION_EXECUTOR_DENIED_ENV_NAME_PATTERN,
        `child environment variable ${name} must not be credential-shaped`,
      );
    }
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('C3. the child environment git push path fails closed (differential control push)', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  const bare = mkdtempSync(join(tmpdir(), 'greenhub-pm03-bare-'));
  try {
    const taskId = 'PM03-SPEC-GITPUSH1';
    gitOk(bare, ['init', '-q', '--bare']);
    const runner = fakeServerRunner();
    const client = fakeSdkClient({ payload: structuredMutationPayload(taskId) });
    const executor = makeAdapter({
      workdir: surface.realDir,
      canonicalCheckoutPath: canonical,
      runner: runner.runner,
      clientFactory: client.factory,
    });
    await executor(
      mutationInput({ taskId, surfaceDir: surface.realDir, baselineSha: surface.baselineSha }),
    );
    const childEnv = runner.calls[0].env;

    const control = spawnSync('git', ['push', bare, 'HEAD:refs/heads/control'], {
      cwd: surface.dir,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(control.status, 0, `control push must succeed: ${control.stderr ?? ''}`);

    const restricted = spawnSync('git', ['push', bare, 'HEAD:refs/heads/blocked'], {
      cwd: surface.dir,
      env: childEnv,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.notEqual(restricted.status, 0, 'the restricted child environment must block git push');
    assert.match(String(restricted.stderr ?? ''), /not allowed|fatal/i);
    const bareBranches = gitOk(bare, ['for-each-ref', '--format=%(refname)']);
    assert.equal(bareBranches.includes('refs/heads/blocked'), false, 'no blocked push landed');

    const status = spawnSync('git', ['status', '--porcelain'], {
      cwd: surface.dir,
      env: childEnv,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(status.status, 0, 'read-only git still works inside the child environment');
  } finally {
    removeDirectories(surface.dir, canonical, bare);
  }
});

test('C4. the task payload cannot select the executable, workdir, agent, model, permissions, or env', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const taskId = 'PM03-SPEC-ISO0001';
    const runner = fakeServerRunner();
    const client = fakeSdkClient({ payload: structuredMutationPayload(taskId) });
    const executor = makeAdapter({
      workdir: surface.realDir,
      canonicalCheckoutPath: canonical,
      runner: runner.runner,
      clientFactory: client.factory,
    });
    const input = mutationInput({
      taskId,
      surfaceDir: surface.realDir,
      baselineSha: surface.baselineSha,
      taskOverrides: {
        executablePath: 'C:\\evil\\opencode.exe',
        workingDirectory: 'C:\\evil',
        model: 'evil/model',
        agent: 'build',
        permission: { edit: 'allow', bash: 'allow', webfetch: 'allow' },
        baseUrl: 'https://evil.example',
        env: { GH_TOKEN: 'evil' },
      },
    });
    await executor(input);
    const call = runner.calls[0];
    assert.equal(call.command, FAKE_EXECUTABLE);
    assert.equal(call.cwd, surface.realDir);
    assert.equal(call.args.includes('C:\\evil\\opencode.exe'), false);
    assert.equal(call.args.some((argument) => argument.includes('evil.example')), false);
    // The canonical record is the ONLY prompt payload: payload-declared
    // executable/workdir/model/permission/env fields are inert data the adapter
    // never reads, and every executable/cwd/env/model value below stays fixed.
    assert.equal(
      client.calls.prompt[0].body.parts[0].text,
      JSON.stringify(input),
      'the canonical record is passed through verbatim and nothing else',
    );
    const config = JSON.parse(call.env[OPENCODE_MUTATION_EXECUTOR_CONFIG_CONTENT_ENV_KEY]);
    assert.equal(config.agent[OPENCODE_MUTATION_AGENT_NAME].model, FAKE_MODEL);
    assert.equal(config.agent[OPENCODE_MUTATION_AGENT_NAME].permission.webfetch, 'deny');
    assert.equal(call.env.GH_TOKEN, undefined);
    assert.equal(client.calls.prompt[0].body.agent, OPENCODE_MUTATION_AGENT_NAME);
    assert.deepEqual(client.calls.prompt[0].body.model, {
      providerID: 'opencode-go',
      modelID: 'deepseek-v4.1-flash',
    });
    assert.equal(client.options[0].baseUrl, FAKE_BASE_URL);
    assert.equal(client.options[0].directory, surface.realDir);
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('C5. the request schema is exactly the mutation structured result fields', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const taskId = 'PM03-SPEC-SCHEMA01';
    const runner = fakeServerRunner();
    const client = fakeSdkClient({ payload: structuredMutationPayload(taskId) });
    const executor = makeAdapter({
      workdir: surface.realDir,
      canonicalCheckoutPath: canonical,
      runner: runner.runner,
      clientFactory: client.factory,
    });
    await executor(
      mutationInput({ taskId, surfaceDir: surface.realDir, baselineSha: surface.baselineSha }),
    );
    const schema = client.calls.prompt[0].body.format.schema;
    assert.equal(client.calls.prompt[0].body.format.type, 'json_schema');
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, [...MUTATION_EXECUTOR_STRUCTURED_RESULT_FIELDS]);
    assert.deepEqual(schema.properties.status.enum, ['SUCCEEDED', 'FAILED', 'BLOCKED']);
    assert.equal(schema.properties.changedPaths, undefined, 'changedPaths is adapter-observed');
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

// ---------------------------------------------------------------------------
// D. Post-execution boundary enforcement.
// ---------------------------------------------------------------------------

async function runWithMutation({ surface, canonical, taskId, ownedSurface, mutationBoundary, mutate, payload }) {
  const runner = fakeServerRunner();
  const client = fakeSdkClient({
    payload: payload ?? structuredMutationPayload(taskId),
    onPrompt: mutate,
  });
  const executor = makeAdapter({
    workdir: surface.realDir,
    canonicalCheckoutPath: canonical,
    runner: runner.runner,
    clientFactory: client.factory,
  });
  try {
    const result = await executor(
      mutationInput({
        taskId,
        surfaceDir: surface.realDir,
        baselineSha: surface.baselineSha,
        ownedSurface,
        mutationBoundary,
      }),
    );
    return { result, error: null, runner, client };
  } catch (error) {
    return { result: null, error, runner, client };
  }
}

test('D1. modifying an owned file succeeds and reports the adapter-observed changed path', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const taskId = 'PM03-SPEC-OWNEDF01';
    const { result, error } = await runWithMutation({
      surface,
      canonical,
      taskId,
      ownedSurface: ['lib/a.txt'],
      mutationBoundary: { allowsWrite: true },
      mutate: () => writeFileSync(join(surface.dir, 'lib', 'a.txt'), 'changed\n'),
    });
    assert.equal(error, null);
    assert.deepEqual(result.changedPaths, ['lib/a.txt']);
    assert.equal(result.status, 'SUCCEEDED');
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('D2. modifying a descendant of an owned directory succeeds (new untracked file)', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const taskId = 'PM03-SPEC-OWNEDD01';
    const { result, error } = await runWithMutation({
      surface,
      canonical,
      taskId,
      ownedSurface: ['lib'],
      mutationBoundary: { allowsWrite: true },
      mutate: () => {
        mkdirSync(join(surface.dir, 'lib', 'nested'), { recursive: true });
        writeFileSync(join(surface.dir, 'lib', 'nested', 'new.txt'), 'new\n');
      },
    });
    assert.equal(error, null);
    assert.deepEqual(result.changedPaths, ['lib/nested/new.txt']);
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('D3. modifying a path outside the owned surface is a BOUNDARY_VIOLATION and is never auto-restored', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const taskId = 'PM03-SPEC-OUTSIDE1';
    const { result, error } = await runWithMutation({
      surface,
      canonical,
      taskId,
      ownedSurface: ['lib'],
      mutationBoundary: { allowsWrite: true },
      mutate: () => writeFileSync(join(surface.dir, 'docs', 'b.txt'), 'tampered\n'),
    });
    assert.equal(result, null);
    assert.equal(error?.code, BOUNDARY_VIOLATION);
    assert.equal(error?.kind, BOUNDARY_VIOLATION_KINDS.OUTSIDE_OWNED_SURFACE);
    assert.deepEqual(error?.changedPaths, ['docs/b.txt']);
    assert.equal(
      readFileSync(join(surface.dir, 'docs', 'b.txt'), 'utf8'),
      'tampered\n',
      'this adapter never deletes/restores/resets; the surface is retired upstream',
    );
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('D4. touching a forbidden path is a BOUNDARY_VIOLATION even inside the owned surface', async () => {
  const surface = makeSurface({ files: { 'lib/a.txt': 'alpha\n', 'lib/secret.txt': 'secret\n' } });
  const canonical = makeCanonicalDirectory();
  try {
    const taskId = 'PM03-SPEC-FORBID01';
    const { result, error } = await runWithMutation({
      surface,
      canonical,
      taskId,
      ownedSurface: ['lib'],
      mutationBoundary: { allowsWrite: true, forbiddenPaths: ['lib/secret.txt'] },
      mutate: () => writeFileSync(join(surface.dir, 'lib', 'secret.txt'), 'tampered\n'),
    });
    assert.equal(result, null);
    assert.equal(error?.code, BOUNDARY_VIOLATION);
    assert.equal(error?.kind, BOUNDARY_VIOLATION_KINDS.FORBIDDEN_PATH);
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('D5. exceeding mutationBoundary.maxPaths is a BOUNDARY_VIOLATION', async () => {
  const surface = makeSurface({
    files: { 'lib/a.txt': 'a\n', 'lib/b.txt': 'b\n', 'lib/c.txt': 'c\n' },
  });
  const canonical = makeCanonicalDirectory();
  try {
    const taskId = 'PM03-SPEC-MAXPATH1';
    const { result, error } = await runWithMutation({
      surface,
      canonical,
      taskId,
      ownedSurface: ['lib'],
      mutationBoundary: { allowsWrite: true, maxPaths: 2 },
      mutate: () => {
        writeFileSync(join(surface.dir, 'lib', 'a.txt'), 'a2\n');
        writeFileSync(join(surface.dir, 'lib', 'b.txt'), 'b2\n');
        writeFileSync(join(surface.dir, 'lib', 'c.txt'), 'c2\n');
      },
    });
    assert.equal(result, null);
    assert.equal(error?.code, BOUNDARY_VIOLATION);
    assert.equal(error?.kind, BOUNDARY_VIOLATION_KINDS.MAX_PATHS_EXCEEDED);
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('D6. deleting an owned file is observed and succeeds when inside the owned surface', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const taskId = 'PM03-SPEC-DELETE01';
    const { result, error } = await runWithMutation({
      surface,
      canonical,
      taskId,
      ownedSurface: ['lib'],
      mutationBoundary: { allowsWrite: true },
      mutate: () => unlinkSync(join(surface.dir, 'lib', 'a.txt')),
    });
    assert.equal(error, null);
    assert.deepEqual(result.changedPaths, ['lib/a.txt']);
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('D7. renames are observed for both paths and are checked against the boundary', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const taskId = 'PM03-SPEC-RENAME01';
    const { result, error } = await runWithMutation({
      surface,
      canonical,
      taskId,
      ownedSurface: ['lib'],
      mutationBoundary: { allowsWrite: true },
      mutate: () => renameSync(join(surface.dir, 'lib', 'a.txt'), join(surface.dir, 'lib', 'renamed.txt')),
    });
    assert.equal(error, null);
    assert.deepEqual(result.changedPaths, ['lib/a.txt', 'lib/renamed.txt']);
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

// ---------------------------------------------------------------------------
// E. Git authority: no commit, no branch, no ref, no remote creation.
// ---------------------------------------------------------------------------

test('E1. an OpenCode-created commit is a BOUNDARY_VIOLATION (HEAD authority)', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const taskId = 'PM03-SPEC-COMMIT01';
    const { result, error } = await runWithMutation({
      surface,
      canonical,
      taskId,
      ownedSurface: ['lib'],
      mutationBoundary: { allowsWrite: true },
      mutate: () => {
        writeFileSync(join(surface.dir, 'lib', 'a.txt'), 'committed\n');
        gitOk(surface.dir, ['add', '-A']);
        gitOk(surface.dir, ['commit', '-q', '-m', 'sneaky executor commit']);
      },
    });
    assert.equal(result, null);
    assert.equal(error?.code, BOUNDARY_VIOLATION);
    assert.equal(error?.kind, BOUNDARY_VIOLATION_KINDS.GIT_AUTHORITY_CHANGED);
    assert.notEqual(gitOk(surface.dir, ['rev-parse', 'HEAD']), surface.baselineSha);
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('E2. an OpenCode-created branch is a BOUNDARY_VIOLATION (ref authority)', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const taskId = 'PM03-SPEC-BRANCH02';
    const { result, error } = await runWithMutation({
      surface,
      canonical,
      taskId,
      ownedSurface: ['lib'],
      mutationBoundary: { allowsWrite: true },
      mutate: () => gitOk(surface.dir, ['branch', 'sneaky-branch']),
    });
    assert.equal(result, null);
    assert.equal(error?.code, BOUNDARY_VIOLATION);
    assert.equal(error?.kind, BOUNDARY_VIOLATION_KINDS.GIT_AUTHORITY_CHANGED);
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('E3. an OpenCode-added remote is a BOUNDARY_VIOLATION (remote authority)', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const taskId = 'PM03-SPEC-REMOTE01';
    const { result, error } = await runWithMutation({
      surface,
      canonical,
      taskId,
      ownedSurface: ['lib'],
      mutationBoundary: { allowsWrite: true },
      mutate: () => gitOk(surface.dir, ['remote', 'add', 'evil', 'https://evil.example/repo.git']),
    });
    assert.equal(result, null);
    assert.equal(error?.code, BOUNDARY_VIOLATION);
    assert.equal(error?.kind, BOUNDARY_VIOLATION_KINDS.GIT_AUTHORITY_CHANGED);
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('E4. a clean run keeps HEAD, refs, and remote configuration identical', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const before = {
      head: gitOk(surface.dir, ['rev-parse', 'HEAD']),
      refs: gitOk(surface.dir, ['for-each-ref', '--format=%(refname) %(objectname)']),
      remotes: gitOk(surface.dir, ['remote', '-v']),
    };
    const taskId = 'PM03-SPEC-AUTH0001';
    const { result, error } = await runWithMutation({
      surface,
      canonical,
      taskId,
      ownedSurface: ['lib'],
      mutationBoundary: { allowsWrite: true },
      mutate: () => writeFileSync(join(surface.dir, 'lib', 'a.txt'), 'changed\n'),
    });
    assert.equal(error, null);
    assert.equal(result.status, 'SUCCEEDED');
    assert.deepEqual(
      {
        head: gitOk(surface.dir, ['rev-parse', 'HEAD']),
        refs: gitOk(surface.dir, ['for-each-ref', '--format=%(refname) %(objectname)']),
        remotes: gitOk(surface.dir, ['remote', '-v']),
      },
      before,
    );
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

// ---------------------------------------------------------------------------
// F. Structured result fail-closed and no re-invocation.
// ---------------------------------------------------------------------------

test('F1. malformed structured results fail closed with no returned result', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  const taskId = 'PM03-SPEC-MALFORM1';
  const variants = [
    { label: 'missing testsExecuted', payload: (() => { const p = structuredMutationPayload(taskId); delete p.testsExecuted; return p; })() },
    { label: 'extra key', payload: structuredMutationPayload(taskId, { changedPaths: ['lib/a.txt'] }) },
    { label: 'empty taskId', payload: structuredMutationPayload(taskId, { taskId: '' }) },
    { label: 'invalid status', payload: structuredMutationPayload(taskId, { status: 'DONE' }) },
    { label: 'empty summary', payload: structuredMutationPayload(taskId, { summary: '' }) },
    { label: 'non-string summary', payload: structuredMutationPayload(taskId, { summary: 7 }) },
    { label: 'non-array testsExecuted', payload: structuredMutationPayload(taskId, { testsExecuted: 'node --test' }) },
    { label: 'empty testsExecuted entry', payload: structuredMutationPayload(taskId, { testsExecuted: [''] }) },
    { label: 'empty proofRef entry', payload: structuredMutationPayload(taskId, { proofRefs: [''] }) },
    { label: 'non-string evidenceRef entry', payload: structuredMutationPayload(taskId, { evidenceRefs: [7] }) },
    { label: 'non-array frictionObserved', payload: structuredMutationPayload(taskId, { frictionObserved: 'NONE' }) },
    { label: 'empty frictionObserved entry', payload: structuredMutationPayload(taskId, { frictionObserved: [''] }) },
  ];
  try {
    for (const { label, payload } of variants) {
      const runner = fakeServerRunner();
      const client = fakeSdkClient({ payload });
      const executor = makeAdapter({
        workdir: surface.realDir,
        canonicalCheckoutPath: canonical,
        runner: runner.runner,
        clientFactory: client.factory,
      });
      await assert.rejects(
        () =>
          executor(
            mutationInput({ taskId, surfaceDir: surface.realDir, baselineSha: surface.baselineSha }),
          ),
        (error) => error?.code === INVALID_OPENCODE_MUTATION_EXECUTOR_STRUCTURED_RESULT,
        label,
      );
      assert.equal(runner.calls.length, 1, label);
      assert.equal(runner.stops.length, 1, label);
      assert.equal(client.calls.prompt.length, 1, label);
    }
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('F2. missing structured output fails closed (prose is never promoted)', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const taskId = 'PM03-SPEC-MISSING1';
    const prose = JSON.stringify(structuredMutationPayload(taskId));
    const cases = [
      { label: 'no structured channel', observation: { payload: undefined } },
      { label: 'null structured channel', observation: { payload: null } },
      {
        label: 'prose-only parts',
        observation: {
          promptResult: {
            data: {
              info: { id: 'msg_prose', role: 'assistant' },
              parts: [
                { id: 'prt_1', type: 'text', text: `Here is the result:\n\`\`\`json\n${prose}\n\`\`\`\n` },
              ],
            },
            error: undefined,
          },
        },
      },
    ];
    for (const { label, observation } of cases) {
      const runner = fakeServerRunner();
      const client = fakeSdkClient(observation);
      const executor = makeAdapter({
        workdir: surface.realDir,
        canonicalCheckoutPath: canonical,
        runner: runner.runner,
        clientFactory: client.factory,
      });
      await assert.rejects(
        () =>
          executor(
            mutationInput({ taskId, surfaceDir: surface.realDir, baselineSha: surface.baselineSha }),
          ),
        (error) => error?.code === MISSING_OPENCODE_MUTATION_EXECUTOR_STRUCTURED_RESULT,
        label,
      );
      assert.equal(runner.stops.length, 1, label);
    }
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('F3. a taskId mismatch in the structured result fails closed', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const runner = fakeServerRunner();
    const client = fakeSdkClient({ payload: structuredMutationPayload('PM03-SPEC-WRONG001') });
    const executor = makeAdapter({
      workdir: surface.realDir,
      canonicalCheckoutPath: canonical,
      runner: runner.runner,
      clientFactory: client.factory,
    });
    await assert.rejects(
      () =>
        executor(
          mutationInput({
            taskId: 'PM03-SPEC-RIGHT001',
            surfaceDir: surface.realDir,
            baselineSha: surface.baselineSha,
          }),
        ),
      (error) => error?.code === OPENCODE_MUTATION_EXECUTOR_TASK_BINDING_MISMATCH,
    );
    assert.equal(runner.stops.length, 1);
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('F4. StructuredOutputError and SDK failures fail closed but still enforce the boundary', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const taskId = 'PM03-SPEC-SDKERR01';
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
        expectedCode: INVALID_OPENCODE_MUTATION_EXECUTOR_STRUCTURED_RESULT,
      },
      {
        label: 'session create error result',
        observation: { createResult: { data: undefined, error: { name: 'BadRequest' } } },
        expectedCode: OPENCODE_MUTATION_EXECUTOR_REQUEST_FAILED,
      },
    ];
    for (const { label, observation, expectedCode } of cases) {
      const runner = fakeServerRunner();
      const client = fakeSdkClient(observation);
      const executor = makeAdapter({
        workdir: surface.realDir,
        canonicalCheckoutPath: canonical,
        runner: runner.runner,
        clientFactory: client.factory,
      });
      await assert.rejects(
        () =>
          executor(
            mutationInput({ taskId, surfaceDir: surface.realDir, baselineSha: surface.baselineSha }),
          ),
        (error) => error?.code === expectedCode,
        label,
      );
      assert.equal(runner.stops.length, 1, label);
      assert.equal(client.calls.prompt.length <= 1, true, label);
    }
    // A failing model that leaked a change outside the boundary is still caught.
    const runner = fakeServerRunner();
    const client = fakeSdkClient({
      payload: undefined,
      onPrompt: () => writeFileSync(join(surface.dir, 'docs', 'b.txt'), 'tampered\n'),
    });
    const executor = makeAdapter({
      workdir: surface.realDir,
      canonicalCheckoutPath: canonical,
      runner: runner.runner,
      clientFactory: client.factory,
    });
    await assert.rejects(
      () =>
        executor(
          mutationInput({ taskId, surfaceDir: surface.realDir, baselineSha: surface.baselineSha }),
        ),
      (error) => error?.code === BOUNDARY_VIOLATION,
    );
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('F5. runner failures and malformed runner results never trigger a second process or prompt', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const taskId = 'PM03-SPEC-RUNFAIL1';
    const input = mutationInput({
      taskId,
      surfaceDir: surface.realDir,
      baselineSha: surface.baselineSha,
    });

    const throwingRunner = fakeServerRunner({ throws: new Error('runner crashed') });
    const throwingClient = fakeSdkClient({});
    await assert.rejects(
      () =>
        makeAdapter({
          workdir: surface.realDir,
          canonicalCheckoutPath: canonical,
          runner: throwingRunner.runner,
          clientFactory: throwingClient.factory,
        })(input),
      /runner crashed/,
    );
    assert.equal(throwingRunner.calls.length, 1, 'no automatic re-invocation');
    assert.equal(throwingClient.calls.prompt.length, 0);

    const unknownRunner = fakeServerRunner({
      verbatim: true,
      result: { kind: 'terminated-without-exit-status' },
    });
    await assert.rejects(
      () =>
        makeAdapter({
          workdir: surface.realDir,
          canonicalCheckoutPath: canonical,
          runner: unknownRunner.runner,
          clientFactory: fakeSdkClient({}).factory,
        })(input),
      (error) => error?.code === INVALID_OPENCODE_MUTATION_EXECUTOR_RUNNER_RESULT,
    );
    assert.equal(unknownRunner.calls.length, 1);

    const startFailedRunner = fakeServerRunner({ startFailed: true, errorCode: 'ENOENT' });
    await assert.rejects(
      () =>
        makeAdapter({
          workdir: surface.realDir,
          canonicalCheckoutPath: canonical,
          runner: startFailedRunner.runner,
          clientFactory: fakeSdkClient({}).factory,
        })(input),
      (error) => error?.code === OPENCODE_MUTATION_EXECUTOR_PROCESS_START_FAILED,
    );
    assert.equal(startFailedRunner.calls.length, 1);
    assert.equal(startFailedRunner.stops.length, 0, 'no process handle exists for a failed start');

    const missingStopRunner = fakeServerRunner({
      verbatim: true,
      result: { kind: 'started', baseUrl: FAKE_BASE_URL },
    });
    await assert.rejects(
      () =>
        makeAdapter({
          workdir: surface.realDir,
          canonicalCheckoutPath: canonical,
          runner: missingStopRunner.runner,
          clientFactory: fakeSdkClient({}).factory,
        })(input),
      (error) => error?.code === INVALID_OPENCODE_MUTATION_EXECUTOR_RUNNER_RESULT,
    );

    const remoteRunner = fakeServerRunner({ baseUrl: 'https://evil.example' });
    const remoteClient = fakeSdkClient({ payload: structuredMutationPayload(taskId) });
    await assert.rejects(
      () =>
        makeAdapter({
          workdir: surface.realDir,
          canonicalCheckoutPath: canonical,
          runner: remoteRunner.runner,
          clientFactory: remoteClient.factory,
        })(input),
      (error) => error?.code === INVALID_OPENCODE_MUTATION_EXECUTOR_RUNNER_RESULT,
    );
    assert.equal(remoteRunner.stops.length, 1, 'rejected endpoint is still cleaned up');
    assert.equal(remoteClient.calls.create.length, 0, 'the record is never sent off-loopback');

    const promptThrowsRunner = fakeServerRunner();
    const promptThrowsClient = fakeSdkClient({ promptThrows: new Error('socket closed') });
    await assert.rejects(
      () =>
        makeAdapter({
          workdir: surface.realDir,
          canonicalCheckoutPath: canonical,
          runner: promptThrowsRunner.runner,
          clientFactory: promptThrowsClient.factory,
        })(input),
      /socket closed/,
    );
    assert.equal(promptThrowsRunner.calls.length, 1);
    assert.equal(promptThrowsClient.calls.prompt.length, 1, 'a throw is never retried');
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('F6. the bounded execution deadline fails closed and stops the server', async () => {
  const surface = makeSurface();
  const canonical = makeCanonicalDirectory();
  try {
    const runner = fakeServerRunner();
    const client = fakeSdkClient({ neverResolve: true });
    const executor = makeAdapter({
      workdir: surface.realDir,
      canonicalCheckoutPath: canonical,
      runner: runner.runner,
      clientFactory: client.factory,
      executionTimeoutMs: 250,
    });
    await assert.rejects(
      () =>
        executor(
          mutationInput({
            taskId: 'PM03-SPEC-TIMEOUT1',
            surfaceDir: surface.realDir,
            baselineSha: surface.baselineSha,
          }),
        ),
      (error) => error?.code === OPENCODE_MUTATION_EXECUTOR_EXECUTION_TIMEOUT,
    );
    assert.equal(runner.calls.length, 1);
    assert.equal(runner.stops.length, 1);
    assert.equal(client.calls.prompt.length, 1, 'the timed-out prompt is never re-issued');
  } finally {
    removeDirectories(surface.dir, canonical);
  }
});

test('F7. the mutation adapter source contains no retry, fallback, or scheduler surface', () => {
  assert.doesNotMatch(MUTATION_ADAPTER_SOURCE, /retryCount/);
  assert.doesNotMatch(MUTATION_ADAPTER_SOURCE, /for\s*\([^)]*\battempt|while\s*\(true\)/);
  assert.doesNotMatch(MUTATION_ADAPTER_SOURCE, /setInterval|setImmediate|node:worker_threads/);
  assert.doesNotMatch(MUTATION_ADAPTER_SOURCE, /fallbackExecutor|executorRegistry|executorSelection/);
  assert.equal(
    (MUTATION_ADAPTER_SOURCE.match(/setTimeout\(/g) ?? []).length,
    2,
    'one server readiness deadline + one execution deadline only',
  );
});

// ---------------------------------------------------------------------------
// G. The READ_ONLY adapter is unchanged and unmodified by this task.
// ---------------------------------------------------------------------------

test('G1. the READ_ONLY adapter file digest is unchanged (pinned change detector)', () => {
  const digest = createHash('sha256')
    .update(readFileSync(READ_ONLY_ADAPTER_PATH))
    .digest('hex');
  assert.equal(
    digest,
    READ_ONLY_ADAPTER_SHA256_PIN,
    'the READ_ONLY adapter must not be modified by the mutation executor task',
  );
});

test('G2. the READ_ONLY adapter behavior is unchanged: it still refuses mutation and stays read-only', async () => {
  const readOnlyRunner = fakeServerRunner();
  const readOnlyClient = fakeSdkClient({
    payload: {
      taskId: 'PM03-SPEC-RDONLY01',
      status: 'SUCCEEDED',
      summary: 'read-only probe',
      proofRefs: ['read:only'],
      evidenceRefs: ['read:only'],
      frictionObserved: ['NONE'],
    },
  });
  const readOnlyExecutor = createOpenCodeCliStructuredResultExecutor({
    executablePath: FAKE_EXECUTABLE,
    workdir: FAKE_WORKDIR,
    model: FAKE_MODEL,
    runner: readOnlyRunner.runner,
    clientFactory: readOnlyClient.factory,
  });
  await assert.rejects(
    () =>
      readOnlyExecutor({
        dispatchId: 'dispatch_pm03_readonly_refusal',
        decisionInput: {
          task: { taskId: 'PM03-SPEC-RDONLY01', taskKind: 'BOUNDED_MUTATION', mutationBoundary: { allowsWrite: true } },
        },
      }),
    (error) => error?.code === OPENCODE_CLI_EXECUTOR_REQUIRES_READ_ONLY_TASK,
  );
  assert.equal(readOnlyRunner.calls.length, 0, 'READ_ONLY adapter starts no process for mutation');

  const accepted = await readOnlyExecutor({
    dispatchId: 'dispatch_pm03_readonly_accept',
    decisionInput: {
      task: { taskId: 'PM03-SPEC-RDONLY01', taskKind: 'READ_ONLY', mutationBoundary: { allowsWrite: false } },
    },
  });
  assert.equal(accepted.outcome, 'ACCEPTED');
  assert.equal(readOnlyRunner.calls.length, 1);
  const readOnlyConfig = JSON.parse(readOnlyRunner.calls[0].env[READ_ONLY_CONFIG_CONTENT_ENV_KEY]);
  assert.equal(readOnlyConfig.permission.edit, 'deny');
  assert.equal(readOnlyConfig.permission.bash, 'deny');
});

test('G3. the mutation adapter is standalone: it does not import the READ_ONLY adapter', () => {
  assert.doesNotMatch(MUTATION_ADAPTER_SOURCE, /from ['"][^'"]*opencode-cli-executor-adapter/);
  assert.doesNotMatch(MUTATION_ADAPTER_SOURCE, /OPENCODE_READONLY_AGENT_NAME/);
});
