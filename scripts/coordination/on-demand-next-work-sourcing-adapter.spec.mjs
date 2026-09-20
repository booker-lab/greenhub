// Proof for GREENHUB-COORDINATION-ON-DEMAND-NEXT-WORK-SOURCING-36.
//
// OPTIONAL, ON-DEMAND, READ-ONLY Codex/Astra next-work sourcing boundary:
//   explicit current user approval (userApproved: true)
//     -> AT MOST ONE read-only Codex/Astra process invocation
//     -> strict structured sourcing result
//     -> NON_CANONICAL / CONTROL_TOWER_REVIEW_REQUIRED payload returned to the
//        caller
//     -> STOP (Control Tower independently decides DROP | WATCH | CHANGE).
//
// OPTIONAL_DISCOVERY != AUTOMATIC_POST_PROCESSING:
//   OPEN_CODE_RESULT != CODEX_TRIGGER, TASK_CLOSED != CODEX_TRIGGER,
//   CODEX_CANDIDATE != CANONICAL_TASK.
//   The adapter never creates tasks, never writes durable coordination state,
//   never dispatches OpenCode, never opens a branch/commit/PR, and never
//   deploys.
//
// Proof map:
//   A. explicit approval gate: absent / false / malformed / ambiguous approval
//      -> CODEX_RESEARCH_REQUIRES_EXPLICIT_USER_APPROVAL, zero process calls,
//      zero writes, no retry, no fallback. Exact request shape: the request
//      can never select executable / cwd / environment / sandbox / retry.
//   B. approved invocation: exactly one process call with the fixed argv-only
//      read-only contract (--sandbox read-only --ephemeral --output-schema
//      --output-last-message --cd), allowlist environment, transient artifacts
//      cleaned, no automatic second invocation, no fallback, exact
//      throw/rejection propagation, Task 31 typed process-start failure.
//   C. no per-task auto invocation: the ordinary OpenCode RESULT ->
//      RESULT_DELIVERED -> Control Tower closure composition performs zero
//      sourcing invocations; predecessor modules never import the adapter.
//   D. read-only: resultDirectory can never be the workdir or inside it; a
//      denied write attempt leaves the controlled tree unchanged; the real
//      repository snapshot is unchanged across approved invocations; an
//      optional repositoryStateProbe detects mutation and fails closed.
//   E. zero candidates is a valid successful investigation result (never
//      FAILED/BLOCKED merely because no work was found).
//   F. candidates are explicitly NON_CANONICAL and create zero Task
//      Envelopes, zero READY transitions, zero admissions, zero claims, zero
//      dispatch attempts, zero OpenCode invocations, zero durable state;
//      malformed candidates and Problem Framer authority masquerade fail
//      closed.
//   G. watch findings return signal + promotionTrigger + supportingEvidence
//      ONLY: no watcher, timer, polling, reminder, or durable registry.
//   H. stale liveMainHint is labeled HINT_ONLY, is never treated as current
//      fact, never changes adapter behavior, and malformed hints fail closed;
//      the adapter reads no repository state itself.
//   I. no previous OpenCode RESULT is required: an investigation runs on
//      bounded refs alone; the module imports no receipt/delivery/dispatch
//      module.
//   J. module boundary statics + predecessor regression smoke.
//
// No test in this file spawns a real Codex/Astra process: every sourcing
// runner is an injected fake except the ONE default-runner start-failure test,
// which spawns a guaranteed-missing executable and never reaches Codex. All
// runtime state lives in isolated temp directories; the repository worktree is
// only ever read (git status / HEAD / file snapshots).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
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
import {
  CODEX_CLI_EXECUTOR_ENV_ALLOWLIST,
  CODEX_CLI_EXECUTOR_PROCESS_START_FAILED,
  CodexCliExecutorAdapterError,
  createCodexCliExecutorAdapter,
  INVALID_CODEX_CLI_EXECUTOR_ADAPTER_CONFIGURATION,
} from './codex-cli-executor-adapter.mjs';
import { EXECUTOR_INVOCATION_OUTCOME_VALUES } from './dispatch-executor-invocation-outcome.mjs';
import { EXECUTOR_RESULT_RECEIPT_FIELDS } from './executor-result-receipt.mjs';
import * as sourcingModule from './on-demand-next-work-sourcing-adapter.mjs';
import {
  buildOnDemandNextWorkSourcingPrompt,
  CODEX_RESEARCH_ARTIFACT_WRITE_FAILED,
  CODEX_RESEARCH_PROCESS_FAILED,
  CODEX_RESEARCH_PROCESS_TERMINATED_WITHOUT_EXIT_STATUS,
  CODEX_RESEARCH_REPOSITORY_PROBE_FAILED,
  CODEX_RESEARCH_REQUIRES_EXPLICIT_USER_APPROVAL,
  CODEX_RESEARCH_RESULT_AUTHORITY_VIOLATION,
  CONTROL_TOWER_REVIEW_REQUIRED,
  createOnDemandNextWorkSourcingAdapter,
  INVALID_CODEX_RESEARCH_REQUEST,
  INVALID_CODEX_RESEARCH_RESULT,
  INVALID_CODEX_RESEARCH_RUNNER_RESULT,
  INVALID_ON_DEMAND_NEXT_WORK_SOURCING_ADAPTER_CONFIGURATION,
  LIVE_MAIN_HINT_PATTERN,
  MISSING_CODEX_RESEARCH_RESULT,
  NON_CANONICAL_SOURCING_RESULT_AUTHORITY,
  normalizeOnDemandSourcingResult,
  ON_DEMAND_SOURCING_RESULT_FIELDS,
  REPOSITORY_MUTATION_DETECTED,
  RESEARCH_CANDIDATE_CLASSIFICATION_ACTIONABLE,
  RESEARCH_CANDIDATE_CLASSIFICATION_VALUES,
} from './on-demand-next-work-sourcing-adapter.mjs';
import { CoordinationStore } from './store.mjs';
import { TASK_STATUS_RESULT_DELIVERED } from './task-envelope.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = join(MODULE_DIRECTORY, 'on-demand-next-work-sourcing-adapter.mjs');
const MODULE_SOURCE = readFileSync(MODULE_PATH, 'utf8');
const REPOSITORY_ROOT = resolve(MODULE_DIRECTORY, '..', '..');

const FORBIDDEN_COORDINATION_NAMES = Object.freeze([
  'tasks',
  'admissions',
  'claims',
  'dispatches',
  'executor-invocation-attempts',
  'executor-invocation-outcomes',
  'executor-result-receipts',
  'next-task-emissions',
  'dispositions',
  'materializations',
  'results',
  'schedulable-work',
  'watches',
  'watch-signals',
  'reminders',
  'scheduler',
  'timers',
]);

function stripComments(source) {
  // Line comments first: the module header legitimately mentions a glob that
  // contains "/*" inside a line comment.
  return source.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const MODULE_CODE = stripComments(MODULE_SOURCE);

function errorWithCode(code) {
  return (error) => error instanceof Error && error.code === code;
}

function makeTempDirectory(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeDirectory(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function approvedRequest(overrides = {}) {
  return {
    userApproved: true,
    investigation: sampleInvestigation(overrides.investigation),
    ...overrides.request,
  };
}

function sampleInvestigation(overrides = {}) {
  return {
    domain: 'scripts/coordination on-demand next-work sourcing boundary',
    questions: ['Which coordination seams still lack direct proof?'],
    repositoryAreas: ['scripts/coordination/'],
    policyRefs: ['AGENTS.md'],
    ...overrides,
  };
}

function validResearchResult(overrides = {}) {
  return {
    investigationStatus: 'COMPLETE',
    scope: 'scripts/coordination on-demand next-work sourcing boundary',
    summary: 'No additional bounded work justified by the inspected evidence.',
    evidenceRefs: ['git:live-main-read'],
    actionableCandidates: [],
    watchSignals: [],
    frictionObserved: [],
    ...overrides,
  };
}

function sampleCandidate(overrides = {}) {
  return {
    title: 'Sample bounded candidate',
    problem: 'A concrete problem statement backed by current evidence.',
    evidence: ['scripts/coordination/example.mjs:1'],
    proposedOwnedSurface: ['scripts/coordination/example.mjs'],
    desiredExitState: 'BOUNDED_STATE_REACHED',
    proofRequirement: ['focused-spec'],
    classification: RESEARCH_CANDIDATE_CLASSIFICATION_ACTIONABLE,
    ...overrides,
  };
}

function extractFlagValue(args, flag) {
  const index = args.indexOf(flag);
  assert.ok(index >= 0 && index + 1 < args.length, `expected ${flag} in argv`);
  return args[index + 1];
}

function invokeSchemaPath(args) {
  const index = args.indexOf('--output-schema');
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
}

function makeRecordingRunner(options = {}) {
  const calls = [];
  const runner = async (invocation) => {
    const schemaPath = invokeSchemaPath(invocation.args);
    calls.push({
      command: invocation.command,
      args: [...invocation.args],
      cwd: invocation.cwd,
      env: { ...invocation.env },
      prompt: invocation.args[invocation.args.length - 1],
      schema: schemaPath === null ? null : JSON.parse(readFileSync(schemaPath, 'utf8')),
    });
    if (typeof options.invoke === 'function') {
      return options.invoke(invocation, calls.length);
    }
    if (options.writeResult !== false) {
      const resultPath = extractFlagValue(invocation.args, '--output-last-message');
      const payload =
        typeof options.rawPayload === 'string'
          ? options.rawPayload
          : JSON.stringify(options.result ?? validResearchResult());
      writeFileSync(resultPath, payload, 'utf8');
    }
    return { kind: 'exited', code: 0 };
  };
  runner.calls = calls;
  return runner;
}

async function withAdapter(options, body) {
  const tempRoot = makeTempDirectory('greenhub-on-demand-sourcing-36-');
  try {
    const resultDirectory = options.resultDirectory ?? join(tempRoot, 'artifacts');
    const adapter = createOnDemandNextWorkSourcingAdapter({
      executablePath: options.executablePath ?? join(tempRoot, 'fake-codex', 'codex.exe'),
      workdir: options.workdir ?? REPOSITORY_ROOT,
      resultDirectory,
      runner: options.runner,
      ...(options.env !== undefined ? { env: options.env } : {}),
      ...(options.repositoryStateProbe !== undefined
        ? { repositoryStateProbe: options.repositoryStateProbe }
        : {}),
    });
    await body({ adapter, runner: options.runner, tempRoot, resultDirectory });
  } finally {
    removeDirectory(tempRoot);
  }
}

function repositorySnapshot() {
  const branch = execFileSync('git', ['branch', '--show-current'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  }).trim();
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  }).trim();
  const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  });
  return `branch:${branch}\nhead:${head}\nstatus:\n${status}`;
}

function snapshotTree(root) {
  const entries = [];
  function walk(directory, prefix) {
    for (const name of readdirSync(directory).sort()) {
      const full = join(directory, name);
      const relative = prefix === '' ? name : `${prefix}/${name}`;
      if (statSync(full).isDirectory()) {
        entries.push(`d ${relative}`);
        walk(full, relative);
      } else {
        entries.push(`f ${relative} ${readFileSync(full, 'utf8')}`);
      }
    }
  }
  walk(root, '');
  return entries.join('\n');
}

function assertZeroInvocationState(runner, resultDirectory) {
  assert.equal(runner.calls.length, 0, 'expected zero process invocations');
  assert.equal(
    existsSync(resultDirectory),
    false,
    'expected zero filesystem writes before the approval/scope gate',
  );
}

// ---------------------------------------------------------------------------
// A. Explicit approval gate + exact request shape.
// ---------------------------------------------------------------------------

test('A. explicit approval gate fails closed before any process or write', async () => {
  const accessorRequest = { investigation: sampleInvestigation() };
  Object.defineProperty(accessorRequest, 'userApproved', {
    get: () => true,
    enumerable: true,
    configurable: true,
  });
  const cases = [
    ['missing approval', { investigation: sampleInvestigation() }],
    ['approval false', { userApproved: false, investigation: sampleInvestigation() }],
    ['approval string', { userApproved: 'true', investigation: sampleInvestigation() }],
    ['approval number', { userApproved: 1, investigation: sampleInvestigation() }],
    ['approval null', { userApproved: null, investigation: sampleInvestigation() }],
    ['approval nested', { userApproved: { approved: true }, investigation: sampleInvestigation() }],
    ['non-record request', 'approved'],
    ['array request', [true]],
    ['inherited approval', Object.create({ userApproved: true })],
    ['accessor approval', accessorRequest],
  ];
  for (const [label, request] of cases) {
    const runner = makeRecordingRunner();
    const resultDirectory = join(
      makeTempDirectory('greenhub-on-demand-sourcing-approval-'),
      'never-created',
    );
    const adapter = createOnDemandNextWorkSourcingAdapter({
      executablePath: resolve(process.cwd(), 'fake-codex', 'codex.exe'),
      workdir: REPOSITORY_ROOT,
      resultDirectory,
      runner,
    });
    await assert.rejects(
      adapter(request),
      errorWithCode(CODEX_RESEARCH_REQUIRES_EXPLICIT_USER_APPROVAL),
      `case: ${label}`,
    );
    assert.equal(runner.calls.length, 0, `case: ${label}`);
    assert.equal(existsSync(resultDirectory), false, `case: ${label}`);
    removeDirectory(dirname(resultDirectory));
  }
});

test('A. request shape is exact and can never select executable, cwd, env, sandbox, or retry', async () => {
  const oversized = {
    userApproved: true,
    investigation: {
      questions: Array.from({ length: 50 }, (_entry, index) => `q${index}-${'x'.repeat(480)}`),
    },
  };
  const cases = [
    ['empty investigation', { userApproved: true, investigation: {} }],
    [
      'unknown request field (executable)',
      { userApproved: true, investigation: sampleInvestigation(), executablePath: 'C:\\evil.exe' },
    ],
    [
      'unknown request field (sandbox)',
      { userApproved: true, investigation: sampleInvestigation(), sandbox: 'danger-full-access' },
    ],
    [
      'unknown request field (retry)',
      { userApproved: true, investigation: sampleInvestigation(), retry: 3 },
    ],
    [
      'unknown investigation field',
      { userApproved: true, investigation: { questions: ['ok'], sandbox: 'x' } },
    ],
    [
      'malformed liveMainHint',
      { userApproved: true, investigation: { domain: 'x', liveMainHint: 'not-a-sha' } },
    ],
    [
      'oversized reference',
      { userApproved: true, investigation: { questions: ['y'.repeat(513)] } },
    ],
    [
      'too many references',
      {
        userApproved: true,
        investigation: { questions: Array.from({ length: 51 }, () => 'ref') },
      },
    ],
    [
      'embedded dump',
      { userApproved: true, investigation: { domain: 'x', questions: ['a\n\n\nb'] } },
    ],
    ['oversized serialized scope', oversized],
    [
      'empty list present',
      { userApproved: true, investigation: { domain: 'x', excludedAreas: [] } },
    ],
  ];
  for (const [label, request] of cases) {
    const runner = makeRecordingRunner();
    const tempRoot = makeTempDirectory('greenhub-on-demand-sourcing-shape-');
    const resultDirectory = join(tempRoot, 'artifacts');
    const adapter = createOnDemandNextWorkSourcingAdapter({
      executablePath: join(tempRoot, 'codex.exe'),
      workdir: REPOSITORY_ROOT,
      resultDirectory,
      runner,
    });
    await assert.rejects(adapter(request), errorWithCode(INVALID_CODEX_RESEARCH_REQUEST), label);
    assertZeroInvocationState(runner, resultDirectory);
    removeDirectory(tempRoot);
  }
});

// ---------------------------------------------------------------------------
// B. Approved invocation: exactly one read-only process boundary.
// ---------------------------------------------------------------------------

test('B. approved invocation performs exactly one fixed read-only process call', async () => {
  const runner = makeRecordingRunner({ result: validResearchResult() });
  await withAdapter({ runner }, async ({ adapter, tempRoot, resultDirectory }) => {
    const staleHint = 'b'.repeat(40);
    const result = await adapter(
      approvedRequest({ investigation: sampleInvestigation({ liveMainHint: staleHint }) }),
    );

    assert.equal(runner.calls.length, 1, 'exactly one process invocation');
    const call = runner.calls[0];
    assert.equal(call.command, join(tempRoot, 'fake-codex', 'codex.exe'));
    assert.equal(call.cwd, REPOSITORY_ROOT);
    assert.deepEqual(call.args.slice(0, 5), [
      'exec',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--output-schema',
    ]);
    const schemaPath = extractFlagValue(call.args, '--output-schema');
    const resultPath = extractFlagValue(call.args, '--output-last-message');
    assert.ok(schemaPath.startsWith(resultDirectory));
    assert.ok(resultPath.startsWith(resultDirectory));
    assert.equal(call.args[6], '--output-last-message');
    assert.deepEqual(call.args.slice(8, 10), ['--cd', REPOSITORY_ROOT]);
    assert.equal(call.args.length, 11);
    assert.equal(call.args[10], call.prompt);

    // The schema file is the exact structured-output contract (captured at
    // invocation time; the adapter cleans it up afterwards).
    assert.equal(call.schema.additionalProperties, false);
    assert.deepEqual(call.schema.required, [...ON_DEMAND_SOURCING_RESULT_FIELDS]);

    // Reference-first prompt: fixed role contract plus the bounded scope.
    assert.match(call.prompt, /ON-DEMAND NEXT-WORK SOURCING INVESTIGATION \(READ-ONLY\)/);
    assert.match(call.prompt, /NOT part of the normal per-task completion loop/);
    assert.match(call.prompt, /HINT_ONLY/);
    assert.match(call.prompt, /HINT_ONLY_MAY_BE_STALE_VERIFY_AGAINST_CURRENT_SOURCES/);
    assert.ok(call.prompt.includes(staleHint));
    assert.ok(call.prompt.includes(JSON.stringify(['scripts/coordination/'])));

    // Environment: fixed allowlist projection ONLY.
    for (const name of Object.keys(call.env)) {
      assert.ok(CODEX_CLI_EXECUTOR_ENV_ALLOWLIST.includes(name), `unexpected env ${name}`);
    }

    // Result: normalized NON_CANONICAL payload.
    assert.equal(result.sourcingResultAuthority, NON_CANONICAL_SOURCING_RESULT_AUTHORITY);
    assert.equal(result.controlTowerReviewRequired, CONTROL_TOWER_REVIEW_REQUIRED);
    assert.equal(result.investigationStatus, 'COMPLETE');
    assert.equal(result.actionableCandidates.length, 0);
    assert.ok(Object.isFrozen(result));

    // Transient artifacts are cleaned: zero durable sourcing state.
    assert.deepEqual(readdirSync(resultDirectory), []);
  });
});

test('B. explicit env map and request-derived environment are strictly separated', async () => {
  process.env.GREENHUB_ON_DEMAND_SOURCING_TEST_SECRET = 'must-never-reach-the-investigator';
  try {
    const runner = makeRecordingRunner();
    await withAdapter({ runner, env: { ONLY_THIS_ENTRY: '1' } }, async ({ adapter }) => {
      await adapter(approvedRequest());
      assert.deepEqual({ ...runner.calls[0].env }, { ONLY_THIS_ENTRY: '1' });
    });
    const defaultRunner = makeRecordingRunner();
    await withAdapter({ runner: defaultRunner }, async ({ adapter }) => {
      await adapter(approvedRequest());
      assert.ok(
        !Object.hasOwn(defaultRunner.calls[0].env, 'GREENHUB_ON_DEMAND_SOURCING_TEST_SECRET'),
      );
    });
  } finally {
    delete process.env.GREENHUB_ON_DEMAND_SOURCING_TEST_SECRET;
  }
});

test('B. runner observations map fail-closed with no retry, no fallback, exact propagation', async () => {
  // Non-zero exit.
  await withAdapter(
    { runner: makeRecordingRunner({ invoke: () => ({ kind: 'exited', code: 3 }) }) },
    async ({ adapter, runner }) => {
      await assert.rejects(
        adapter(approvedRequest()),
        errorWithCode(CODEX_RESEARCH_PROCESS_FAILED),
      );
      assert.equal(runner.calls.length, 1);
    },
  );

  // Terminated without exit status.
  await withAdapter(
    { runner: makeRecordingRunner({ invoke: () => ({ kind: 'terminated-without-exit-status' }) }) },
    async ({ adapter, runner }) => {
      await assert.rejects(
        adapter(approvedRequest()),
        errorWithCode(CODEX_RESEARCH_PROCESS_TERMINATED_WITHOUT_EXIT_STATUS),
      );
      assert.equal(runner.calls.length, 1);
    },
  );

  // Start failure preserves the Task 31 typed meaning.
  await withAdapter(
    {
      runner: makeRecordingRunner({
        invoke: () => ({ kind: 'start-failed', errorCode: 'ENOENT' }),
      }),
    },
    async ({ adapter, runner }) => {
      await assert.rejects(adapter(approvedRequest()), (error) => {
        assert.ok(error instanceof CodexCliExecutorAdapterError);
        assert.equal(error.code, CODEX_CLI_EXECUTOR_PROCESS_START_FAILED);
        return true;
      });
      assert.equal(runner.calls.length, 1);
    },
  );

  // Malformed runner observations.
  await withAdapter(
    { runner: makeRecordingRunner({ invoke: () => ({ kind: 'timeout' }) }) },
    async ({ adapter, runner }) => {
      await assert.rejects(
        adapter(approvedRequest()),
        errorWithCode(INVALID_CODEX_RESEARCH_RUNNER_RESULT),
      );
      assert.equal(runner.calls.length, 1);
    },
  );
  await withAdapter(
    { runner: makeRecordingRunner({ invoke: () => ({ kind: 'exited', code: 0, extra: 1 }) }) },
    async ({ adapter, runner }) => {
      await assert.rejects(
        adapter(approvedRequest()),
        errorWithCode(INVALID_CODEX_RESEARCH_RUNNER_RESULT),
      );
      assert.equal(runner.calls.length, 1);
    },
  );

  // Runner throw: exact identity propagation, one call, no retry.
  const thrown = new Error('runner sync explosion');
  await withAdapter(
    {
      runner: makeRecordingRunner({
        invoke: () => {
          throw thrown;
        },
      }),
    },
    async ({ adapter, runner }) => {
      let captured = null;
      try {
        await adapter(approvedRequest());
      } catch (error) {
        captured = error;
      }
      assert.equal(captured, thrown);
      assert.equal(runner.calls.length, 1);
    },
  );

  // Runner async rejection with a non-Error value: exact identity, no remap.
  const rejectionValue = { kind: 'not-a-process-observation' };
  await withAdapter(
    { runner: makeRecordingRunner({ invoke: () => Promise.reject(rejectionValue) }) },
    async ({ adapter, runner }) => {
      let captured = null;
      try {
        await adapter(approvedRequest());
      } catch (error) {
        captured = error;
      }
      assert.equal(captured, rejectionValue);
      assert.equal(runner.calls.length, 1);
    },
  );

  // Exit 0 without a structured result file.
  await withAdapter(
    { runner: makeRecordingRunner({ writeResult: false }) },
    async ({ adapter, runner }) => {
      await assert.rejects(
        adapter(approvedRequest()),
        errorWithCode(MISSING_CODEX_RESEARCH_RESULT),
      );
      assert.equal(runner.calls.length, 1);
    },
  );

  // Exit 0 with malformed JSON.
  await withAdapter(
    { runner: makeRecordingRunner({ rawPayload: '{not-json' }) },
    async ({ adapter, runner }) => {
      await assert.rejects(
        adapter(approvedRequest()),
        errorWithCode(INVALID_CODEX_RESEARCH_RESULT),
      );
      assert.equal(runner.calls.length, 1);
    },
  );

  // Exit 0 with a non-conforming shape.
  await withAdapter(
    { runner: makeRecordingRunner({ result: { hello: 'world' } }) },
    async ({ adapter, runner }) => {
      await assert.rejects(
        adapter(approvedRequest()),
        errorWithCode(INVALID_CODEX_RESEARCH_RESULT),
      );
      assert.equal(runner.calls.length, 1);
    },
  );
});

test('B. artifact preparation failure fails closed before any process invocation', async () => {
  const tempRoot = makeTempDirectory('greenhub-on-demand-sourcing-artifacts-');
  try {
    const blockedResultDirectory = join(tempRoot, 'blocked');
    writeFileSync(blockedResultDirectory, 'not-a-directory', 'utf8');
    const runner = makeRecordingRunner();
    const adapter = createOnDemandNextWorkSourcingAdapter({
      executablePath: join(tempRoot, 'codex.exe'),
      workdir: REPOSITORY_ROOT,
      resultDirectory: blockedResultDirectory,
      runner,
    });
    await assert.rejects(
      adapter(approvedRequest()),
      errorWithCode(CODEX_RESEARCH_ARTIFACT_WRITE_FAILED),
    );
    assert.equal(runner.calls.length, 0);
  } finally {
    removeDirectory(tempRoot);
  }
});

test('B. default process runner preserves the Task 31 typed start-failed meaning', async () => {
  const tempRoot = makeTempDirectory('greenhub-on-demand-sourcing-start-');
  try {
    const resultDirectory = join(tempRoot, 'artifacts');
    const adapter = createOnDemandNextWorkSourcingAdapter({
      executablePath: join(tempRoot, 'guaranteed-missing', 'codex.exe'),
      workdir: REPOSITORY_ROOT,
      resultDirectory,
    });
    await assert.rejects(adapter(approvedRequest()), (error) => {
      assert.ok(error instanceof CodexCliExecutorAdapterError);
      assert.equal(error.code, CODEX_CLI_EXECUTOR_PROCESS_START_FAILED);
      return true;
    });
    assert.equal(existsSync(resultDirectory), true);
    assert.deepEqual(readdirSync(resultDirectory), []);
  } finally {
    removeDirectory(tempRoot);
  }
});

// ---------------------------------------------------------------------------
// C. No per-task auto invocation.
// ---------------------------------------------------------------------------

function sampleTaskInput(taskId) {
  return {
    taskId,
    taskKind: 'READ_ONLY',
    desiredExitState: 'CANONICAL_RESULT_DELIVERY_PROVED',
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
    proofRequirement: ['no-auto-sourcing-invocation-proof'],
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
    summary: 'bounded source closure output',
    proofRefs: ['store:read-back'],
    evidenceRefs: ['test:temp-home'],
    frictionObserved: [],
    ...overrides,
  };
}

test('C. ordinary OpenCode RESULT -> RESULT_DELIVERED -> Control Tower closure never invokes sourcing', async () => {
  const home = makeTempDirectory('greenhub-on-demand-sourcing-home-');
  try {
    const runner = makeRecordingRunner();
    await withAdapter({ runner }, async ({ adapter, resultDirectory }) => {
      const store = new CoordinationStore({ home });
      const taskId = 'ON-DEMAND-SOURCING-NO-AUTO-INVOKE-PROOF';
      store.createTask(sampleTaskInput(taskId));
      store.markReady(taskId);
      const claim = store.claimTask({ taskId, workerId: 'worker-a', leaseDurationMs: 60_000 });
      store.deliverResult(sampleResult(claim));

      const task = store.readTask(taskId);
      assert.equal(task.status, TASK_STATUS_RESULT_DELIVERED);

      // The ordinary completion loop has no sourcing trigger. The adapter
      // exists but was never called by any of the above.
      assert.equal(runner.calls.length, 0);
      assert.equal(existsSync(resultDirectory), false);
      assert.equal(typeof adapter, 'function');
    });

    // Static: ordinary-chain predecessor modules never import the sourcing
    // adapter.
    for (const name of [
      'store.mjs',
      'executor-result-receipt.mjs',
      'executor-result-delivery.mjs',
      'dispatch-receiver-decision.mjs',
      'next-task-emission.mjs',
      'materialization.mjs',
      'disposition.mjs',
    ]) {
      const source = readFileSync(join(MODULE_DIRECTORY, name), 'utf8');
      assert.ok(
        !source.includes('on-demand-next-work-sourcing'),
        `${name} must not import the on-demand sourcing adapter`,
      );
    }
  } finally {
    removeDirectory(home);
  }
});

// ---------------------------------------------------------------------------
// D. Read-only execution.
// ---------------------------------------------------------------------------

test('D. resultDirectory can never be the workdir or inside it; repository snapshot unchanged', async () => {
  const tempRoot = makeTempDirectory('greenhub-on-demand-sourcing-readonly-config-');
  try {
    for (const badResultDirectory of [REPOSITORY_ROOT, join(REPOSITORY_ROOT, 'tmp-artifacts')]) {
      const runner = makeRecordingRunner();
      assert.throws(
        () =>
          createOnDemandNextWorkSourcingAdapter({
            executablePath: join(tempRoot, 'codex.exe'),
            workdir: REPOSITORY_ROOT,
            resultDirectory: badResultDirectory,
            runner,
          }),
        errorWithCode(INVALID_ON_DEMAND_NEXT_WORK_SOURCING_ADAPTER_CONFIGURATION),
      );
      assert.equal(runner.calls.length, 0);
    }

    const before = repositorySnapshot();
    await withAdapter({ runner: makeRecordingRunner() }, async ({ adapter }) => {
      await adapter(approvedRequest());
      await adapter(approvedRequest({ investigation: { domain: 'second bounded scope' } }));
    });
    assert.equal(repositorySnapshot(), before);
  } finally {
    removeDirectory(tempRoot);
  }
});

test('D. a denied write attempt leaves the controlled repository tree unchanged', async () => {
  const fixtureRepo = makeTempDirectory('greenhub-on-demand-sourcing-fixture-');
  const lockedPath = join(fixtureRepo, 'src', 'locked.txt');
  try {
    mkdirSync(join(fixtureRepo, 'src'));
    writeFileSync(lockedPath, 'original-content', 'utf8');
    chmodSync(lockedPath, 0o444);

    let writeDenied = false;
    let denialCode = null;
    const runner = makeRecordingRunner({
      invoke: (invocation) => {
        try {
          writeFileSync(lockedPath, 'mutated-by-sandboxed-write-attempt', 'utf8');
        } catch (error) {
          writeDenied = true;
          denialCode = typeof error?.code === 'string' ? error.code : 'UNKNOWN';
        }
        writeFileSync(
          extractFlagValue(invocation.args, '--output-last-message'),
          JSON.stringify(validResearchResult()),
          'utf8',
        );
        return { kind: 'exited', code: 0 };
      },
    });

    const beforeTree = snapshotTree(fixtureRepo);
    await withAdapter({ runner, workdir: fixtureRepo }, async ({ adapter, resultDirectory }) => {
      const result = await adapter(approvedRequest());
      assert.equal(result.investigationStatus, 'COMPLETE');
      assert.deepEqual(readdirSync(resultDirectory), []);
    });

    assert.equal(writeDenied, true, 'the controlled write attempt must be denied');
    assert.ok(
      ['EACCES', 'EPERM', 'EBUSY'].includes(denialCode),
      `unexpected denial code ${String(denialCode)}`,
    );
    assert.equal(snapshotTree(fixtureRepo), beforeTree);
  } finally {
    try {
      chmodSync(lockedPath, 0o666);
    } catch {
      // fixture cleanup only
    }
    removeDirectory(fixtureRepo);
  }
});

test('D. optional repositoryStateProbe detects mutation and fails closed', async () => {
  let probeCalls = 0;
  const states = ['clean-state', 'dirty-state'];
  await withAdapter(
    {
      runner: makeRecordingRunner(),
      repositoryStateProbe: () => states[Math.min(probeCalls++, states.length - 1)],
    },
    async ({ adapter, runner }) => {
      await assert.rejects(adapter(approvedRequest()), errorWithCode(REPOSITORY_MUTATION_DETECTED));
      assert.equal(runner.calls.length, 1);
      assert.equal(probeCalls, 2);
    },
  );

  let throwingProbeCalls = 0;
  await withAdapter(
    {
      runner: makeRecordingRunner(),
      repositoryStateProbe: () => {
        throwingProbeCalls += 1;
        throw new Error('probe unavailable');
      },
    },
    async ({ adapter, runner }) => {
      await assert.rejects(
        adapter(approvedRequest()),
        errorWithCode(CODEX_RESEARCH_REPOSITORY_PROBE_FAILED),
      );
      assert.equal(runner.calls.length, 0);
      assert.equal(throwingProbeCalls, 1);
    },
  );

  let unchangedProbeCalls = 0;
  await withAdapter(
    {
      runner: makeRecordingRunner(),
      repositoryStateProbe: () => {
        unchangedProbeCalls += 1;
        return 'stable';
      },
    },
    async ({ adapter }) => {
      const result = await adapter(approvedRequest());
      assert.equal(result.investigationStatus, 'COMPLETE');
      assert.equal(unchangedProbeCalls, 2);
    },
  );
});

// ---------------------------------------------------------------------------
// E. Zero-candidate validity.
// ---------------------------------------------------------------------------

test('E. zero candidates is a valid successful investigation result', async () => {
  const runner = makeRecordingRunner({
    result: validResearchResult({
      investigationStatus: 'COMPLETE',
      actionableCandidates: [],
      watchSignals: [],
      summary: 'No additional bounded work justified by the inspected evidence.',
    }),
  });
  await withAdapter({ runner }, async ({ adapter }) => {
    const result = await adapter(approvedRequest());
    assert.equal(result.investigationStatus, 'COMPLETE');
    assert.deepEqual(result.actionableCandidates, []);
    assert.deepEqual(result.watchSignals, []);
    assert.equal(result.sourcingResultAuthority, NON_CANONICAL_SOURCING_RESULT_AUTHORITY);
  });
});

// ---------------------------------------------------------------------------
// F. Candidates are NON_CANONICAL.
// ---------------------------------------------------------------------------

test('F. candidates are NON_CANONICAL and create no task/admission/claim/dispatch state', async () => {
  const runner = makeRecordingRunner({
    result: validResearchResult({
      actionableCandidates: [sampleCandidate(), sampleCandidate({ candidateId: 'cand-2' })],
    }),
  });
  await withAdapter({ runner }, async ({ adapter, tempRoot }) => {
    const result = await adapter(approvedRequest());
    assert.equal(runner.calls.length, 1, 'itself-and-exactly-once; no automatic second invocation');

    assert.equal(result.actionableCandidates.length, 2);
    for (const [index, candidate] of result.actionableCandidates.entries()) {
      assert.equal(candidate.localCandidateIndex, index);
      assert.equal(candidate.canonicalAuthority, NON_CANONICAL_SOURCING_RESULT_AUTHORITY);
      assert.equal(candidate.controlTowerReviewRequired, CONTROL_TOWER_REVIEW_REQUIRED);
    }
    assert.equal(result.actionableCandidates[1].candidateId, 'cand-2');

    // Zero canonical task state anywhere under the adapter workspace.
    const unexpected = readdirSync(tempRoot).filter((name) => name !== 'artifacts');
    assert.deepEqual(unexpected, []);
    for (const forbidden of FORBIDDEN_COORDINATION_NAMES) {
      assert.equal(existsSync(join(tempRoot, forbidden)), false, forbidden);
    }
    const serialized = JSON.stringify(result);
    for (const authorityToken of [
      'taskEnvelope',
      'canonicalTaskId',
      'dispatchRequest',
      'autoDispatch',
      'invokeOpenCode',
      'problemFramerDecision',
    ]) {
      assert.ok(!serialized.includes(authorityToken), authorityToken);
    }
  });
});

test('F. malformed candidates and authority masquerade fail closed', async () => {
  const missingProof = sampleCandidate();
  delete missingProof.proofRequirement;
  const cases = [
    ['missing required field', missingProof, INVALID_CODEX_RESEARCH_RESULT],
    [
      'unknown candidate field',
      sampleCandidate({ canonicalTaskId: 'TASK-1' }),
      INVALID_CODEX_RESEARCH_RESULT,
    ],
    [
      'unknown candidate field (dispatch)',
      sampleCandidate({ dispatchRequest: { executor: 'opencode' } }),
      INVALID_CODEX_RESEARCH_RESULT,
    ],
    [
      'invalid classification',
      sampleCandidate({ classification: 'CHANGE' }),
      INVALID_CODEX_RESEARCH_RESULT,
    ],
    [
      'Problem Framer authority claim in candidate',
      sampleCandidate({ problem: 'Problem Framer = CHANGE for this finding.' }),
      CODEX_RESEARCH_RESULT_AUTHORITY_VIOLATION,
    ],
    ['Problem Framer authority claim in summary', null, CODEX_RESEARCH_RESULT_AUTHORITY_VIOLATION],
  ];
  for (const [label, candidate, expectedCode] of cases) {
    const result =
      candidate === null
        ? validResearchResult({ summary: 'Problem Framer = CHANGE: implement this next.' })
        : validResearchResult({ actionableCandidates: [candidate] });
    await withAdapter({ runner: makeRecordingRunner({ result }) }, async ({ adapter, runner }) => {
      await assert.rejects(adapter(approvedRequest()), errorWithCode(expectedCode), label);
      assert.equal(runner.calls.length, 1, `${label}: exactly one call, no retry`);
    });
  }

  // Suggested review wording is allowed: only a claimed decision fails closed.
  const suggestion = validResearchResult({
    actionableCandidates: [
      sampleCandidate({
        problem: 'Evidence suggests this may warrant Control Tower CHANGE review.',
      }),
    ],
  });
  await withAdapter(
    { runner: makeRecordingRunner({ result: suggestion }) },
    async ({ adapter }) => {
      const result = await adapter(approvedRequest());
      assert.equal(result.actionableCandidates.length, 1);
    },
  );
});

// ---------------------------------------------------------------------------
// G. Watch signals.
// ---------------------------------------------------------------------------

test('G. watch findings return signal and promotion trigger with no watcher or timer', async () => {
  const runner = makeRecordingRunner({
    result: validResearchResult({
      watchSignals: [
        {
          signal: 'duplicated reference-validation helper in two coordination modules',
          promotionTrigger: 'a third duplicate appears or a validation drift is observed',
          supportingEvidence: ['scripts/coordination/example.mjs:10'],
        },
      ],
    }),
  });
  await withAdapter({ runner }, async ({ adapter, tempRoot }) => {
    const result = await adapter(approvedRequest());
    assert.equal(result.watchSignals.length, 1);
    const [signal] = result.watchSignals;
    assert.equal(
      signal.signal,
      'duplicated reference-validation helper in two coordination modules',
    );
    assert.ok(signal.promotionTrigger.length > 0);
    assert.deepEqual([...signal.supportingEvidence], ['scripts/coordination/example.mjs:10']);
    assert.equal(signal.canonicalAuthority, NON_CANONICAL_SOURCING_RESULT_AUTHORITY);
    assert.equal(signal.controlTowerReviewRequired, CONTROL_TOWER_REVIEW_REQUIRED);

    // No durable watch registry, timer, or scheduler namespace is created.
    for (const forbidden of ['watches', 'watch-signals', 'reminders', 'scheduler', 'timers']) {
      assert.equal(existsSync(join(tempRoot, forbidden)), false, forbidden);
    }
  });

  // Unknown watch-signal fields (for example a polling interval) fail closed.
  const malformedWatch = validResearchResult({
    watchSignals: [
      {
        signal: 'x',
        promotionTrigger: 'y',
        supportingEvidence: ['z'],
        pollingInterval: '24h',
      },
    ],
  });
  await withAdapter(
    { runner: makeRecordingRunner({ result: malformedWatch }) },
    async ({ adapter, runner }) => {
      await assert.rejects(
        adapter(approvedRequest()),
        errorWithCode(INVALID_CODEX_RESEARCH_RESULT),
      );
      assert.equal(runner.calls.length, 1);
    },
  );
});

// ---------------------------------------------------------------------------
// H. Current authority vs stale hint.
// ---------------------------------------------------------------------------

test('H. stale liveMainHint stays a labeled hint and cannot override current evidence', async () => {
  const staleHint = 'c'.repeat(40);
  const runner = makeRecordingRunner();
  await withAdapter({ runner }, async ({ adapter }) => {
    await adapter(
      approvedRequest({ investigation: sampleInvestigation({ liveMainHint: staleHint }) }),
    );
    const hintedPrompt = runner.calls[0].prompt;
    assert.ok(hintedPrompt.includes(staleHint));
    assert.match(hintedPrompt, /HINT_ONLY/);
    assert.match(hintedPrompt, /may be stale/);
    assert.match(hintedPrompt, /never treat a hint as current fact/);

    await adapter(approvedRequest({ investigation: sampleInvestigation() }));
    const plainPrompt = runner.calls[1].prompt;
    assert.ok(!plainPrompt.includes(staleHint));
    assert.equal(runner.calls.length, 2, 'hint presence never changes invocation count');
  });

  // Malformed hints fail closed; a hint is shape-validated, not trusted.
  await withAdapter({ runner: makeRecordingRunner() }, async ({ adapter, runner }) => {
    await assert.rejects(
      adapter(
        approvedRequest({
          investigation: { domain: 'x', liveMainHint: 'd'.repeat(39) },
        }),
      ),
      errorWithCode(INVALID_CODEX_RESEARCH_REQUEST),
    );
    assert.equal(runner.calls.length, 0);
  });

  // The adapter itself reads no repository state: no git/fs repository reads.
  assert.equal(LIVE_MAIN_HINT_PATTERN.test(staleHint), true);
  assert.ok(!MODULE_CODE.includes('execFileSync'));
  assert.ok(!MODULE_CODE.includes('execSync'));
  assert.ok(!MODULE_CODE.includes('spawnSync'));
  assert.ok(!MODULE_CODE.includes('readdirSync'));
  assert.equal((MODULE_CODE.match(/readFileSync/g) ?? []).length, 1);
});

// ---------------------------------------------------------------------------
// I. No previous-result review requirement.
// ---------------------------------------------------------------------------

test('I. a broad investigation runs on bounded refs alone without any previous RESULT', async () => {
  const runner = makeRecordingRunner();
  await withAdapter({ runner }, async ({ adapter, tempRoot, resultDirectory }) => {
    // No resultIds, no receipts, no dispatch records, no task ids exist.
    const result = await adapter(
      approvedRequest({
        investigation: {
          domain: 'repository-wide architecture boundary review',
          questions: ['Where do intended contracts and observed behavior diverge?'],
          repositoryAreas: ['apps/', 'scripts/'],
        },
      }),
    );
    assert.equal(result.investigationStatus, 'COMPLETE');
    assert.equal(runner.calls.length, 1);
    assert.deepEqual(readdirSync(resultDirectory), [], 'transient artifacts are cleaned');
    assert.equal(existsSync(join(tempRoot, 'tasks')), false);
  });

  // Import boundary: no receipt / delivery / dispatch / store composition.
  const importedSpecifiers = [...MODULE_CODE.matchAll(/from '([^']+)'/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(importedSpecifiers, [
    './codex-cli-executor-adapter.mjs',
    './task-envelope.mjs',
    'node:child_process',
    'node:crypto',
    'node:fs',
    'node:path',
  ]);
});

// ---------------------------------------------------------------------------
// J. Module boundary statics + predecessor regression.
// ---------------------------------------------------------------------------

test('J. module boundary statics and predecessor regression', async () => {
  const expectedExports = [
    'CODEX_RESEARCH_ARTIFACT_WRITE_FAILED',
    'CODEX_RESEARCH_PROCESS_FAILED',
    'CODEX_RESEARCH_PROCESS_TERMINATED_WITHOUT_EXIT_STATUS',
    'CODEX_RESEARCH_REPOSITORY_PROBE_FAILED',
    'CODEX_RESEARCH_REQUIRES_EXPLICIT_USER_APPROVAL',
    'CODEX_RESEARCH_RESULT_AUTHORITY_VIOLATION',
    'CONTROL_TOWER_REVIEW_REQUIRED',
    'INVALID_CODEX_RESEARCH_REQUEST',
    'INVALID_CODEX_RESEARCH_RESULT',
    'INVALID_CODEX_RESEARCH_RUNNER_RESULT',
    'INVALID_ON_DEMAND_NEXT_WORK_SOURCING_ADAPTER_CONFIGURATION',
    'LIVE_MAIN_HINT_PATTERN',
    'MAX_RESEARCH_INVESTIGATION_JSON_BYTES',
    'MAX_RESEARCH_RESULT_CANDIDATES',
    'MAX_RESEARCH_RESULT_WATCH_SIGNALS',
    'MAX_RESEARCH_SCOPE_ENTRIES',
    'MAX_RESEARCH_STATUS_LENGTH',
    'MISSING_CODEX_RESEARCH_RESULT',
    'NON_CANONICAL_SOURCING_RESULT_AUTHORITY',
    'ON_DEMAND_SOURCING_CANDIDATE_OPTIONAL_FIELDS',
    'ON_DEMAND_SOURCING_CANDIDATE_REQUIRED_FIELDS',
    'ON_DEMAND_SOURCING_INVESTIGATION_FIELDS',
    'ON_DEMAND_SOURCING_INVESTIGATION_LIST_FIELDS',
    'ON_DEMAND_SOURCING_REQUEST_FIELDS',
    'ON_DEMAND_SOURCING_RESULT_FIELDS',
    'ON_DEMAND_SOURCING_SCOPE_ANCHOR_FIELDS',
    'ON_DEMAND_SOURCING_WATCH_SIGNAL_FIELDS',
    'OnDemandNextWorkSourcingAdapterError',
    'PROBLEM_FRAMER_AUTHORITY_CLAIM_PATTERN',
    'REPOSITORY_MUTATION_DETECTED',
    'RESEARCH_CANDIDATE_CLASSIFICATION_ACTIONABLE',
    'RESEARCH_CANDIDATE_CLASSIFICATION_INFORMATIONAL',
    'RESEARCH_CANDIDATE_CLASSIFICATION_INSUFFICIENT_EVIDENCE',
    'RESEARCH_CANDIDATE_CLASSIFICATION_STALE_OR_SUPERSEDED',
    'RESEARCH_CANDIDATE_CLASSIFICATION_VALUES',
    'RESEARCH_CANDIDATE_CLASSIFICATION_WATCH',
    'buildOnDemandNextWorkSourcingPrompt',
    'buildOnDemandSourcingResultJsonSchema',
    'createOnDemandNextWorkSourcingAdapter',
    'normalizeOnDemandSourcingResult',
  ];
  assert.deepEqual(Object.keys(sourcingModule).sort(), expectedExports);
  assert.deepEqual(
    [...RESEARCH_CANDIDATE_CLASSIFICATION_VALUES],
    [
      'ACTIONABLE_CANDIDATE',
      'WATCH_SIGNAL',
      'INFORMATIONAL',
      'STALE_OR_SUPERSEDED',
      'INSUFFICIENT_EVIDENCE',
    ],
  );

  // Static boundary: exactly one spawn, no shell, no timers, no durable
  // coordination composition, no OpenCode / Operator CLI / Notion coupling.
  assert.equal((MODULE_CODE.match(/spawn\(/g) ?? []).length, 1);
  for (const token of [
    'execSync',
    'execFileSync',
    'execFile(',
    'spawnSync',
    'node:timers',
    'setInterval',
    'setTimeout',
    'chokidar',
    'watchFile',
    'fs.watch',
    'store.mjs',
    'coordination-home',
    'operator-cli',
    'CoordinationStore',
    'createTask',
    'markReady',
    'claimTask',
    'deliverResult',
    'taskEnvelope',
    'shell: true',
  ]) {
    assert.ok(!MODULE_CODE.includes(token), `sourcing adapter code must not contain ${token}`);
  }
  assert.ok(MODULE_CODE.includes("'--sandbox',"));
  assert.ok(MODULE_CODE.includes("'read-only',"));
  assert.ok(MODULE_CODE.includes("'--ephemeral',"));
  assert.ok(MODULE_CODE.includes("'--output-schema',"));
  assert.ok(MODULE_CODE.includes("'--output-last-message',"));
  assert.ok(MODULE_CODE.includes('shell: false'));
  assert.ok(MODULE_CODE.includes('CODEX_CLI_EXECUTOR_ENV_ALLOWLIST'));

  // Pure helpers remain usable without the factory.
  const prompt = buildOnDemandNextWorkSourcingPrompt({ domain: 'bounded scope' });
  assert.match(prompt, /ON-DEMAND NEXT-WORK SOURCING INVESTIGATION/);
  assert.match(prompt, /Return ONLY the structured JSON/);
  const normalized = normalizeOnDemandSourcingResult(validResearchResult());
  assert.equal(normalized.sourcingResultAuthority, NON_CANONICAL_SOURCING_RESULT_AUTHORITY);

  // Predecessor surfaces unchanged (composition smoke; full regression runs in
  // the coordination suite).
  assert.deepEqual([...EXECUTOR_INVOCATION_OUTCOME_VALUES], ['ACCEPTED', 'REJECTED', 'UNKNOWN']);
  assert.ok(EXECUTOR_RESULT_RECEIPT_FIELDS.includes('dispatchId'));
  assert.throws(
    () => createCodexCliExecutorAdapter({}),
    errorWithCode(INVALID_CODEX_CLI_EXECUTOR_ADAPTER_CONFIGURATION),
  );
});
