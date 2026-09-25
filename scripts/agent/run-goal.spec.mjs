// Focused deterministic proof for scripts/agent/run-goal.mjs.
//
// Uses temp local git repositories + temp bare remotes and injected child
// seams. No GitHub, no publication mutation, no real OpenCode process, and no
// mutation of the Greenhub checkout.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';

import {
  BLOCKED_EXTERNAL,
  BUDGET_EXHAUSTED,
  GOAL_SATISFIED,
  HUMAN_DECISION_REQUIRED,
  INVALID_GOAL,
  INVALID_TASK,
  MAX_BATCH_CONCURRENCY,
  NO_PROGRESS,
  NO_TASK_FOR_GAP,
  PLANNER_OUTCOME_MAX_CHARS,
  admitTaskBatch,
  buildPlannerPrompt,
  buildTaskText,
  isRetryableStartFailure,
  parseArgs,
  runGoal,
  runTaskBatch,
  validateGoalContract,
} from './run-goal.mjs';
import {
  CLEANUP_FAILED,
  defaultRunProofCommand,
  fetchBaseline,
  readLiveRemoteMain,
} from './run-once.mjs';

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function gitRaw(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function initRepository(directory) {
  git(directory, ['init', '-b', 'main']);
  git(directory, ['config', 'user.email', 'run-goal-spec@local']);
  git(directory, ['config', 'user.name', 'run-goal-spec']);
  git(directory, ['config', 'commit.gpgsign', 'false']);
}

function messageOf(error) {
  return error instanceof Error && typeof error.message === 'string'
    ? error.message
    : String(error);
}

/**
 * Windows-safe recursive removal. Git's object store contains read-only files,
 * so the first attempt may fail with EPERM; clear the read-only bit and retry.
 * A removal that still leaves the target behind throws instead of being
 * silently treated as success.
 */
function removeTreeRobust(target) {
  const remove = () =>
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  try {
    remove();
  } catch {
    const stack = [target];
    while (stack.length > 0) {
      const current = stack.pop();
      let stats = null;
      try {
        stats = lstatSync(current);
      } catch {
        continue;
      }
      try {
        chmodSync(current, 0o700);
      } catch {
        // best-effort attribute clear; the retry below reports any real failure
      }
      if (stats.isDirectory()) {
        let entries = [];
        try {
          entries = readdirSync(current);
        } catch {
          entries = [];
        }
        for (const entry of entries) stack.push(join(current, entry));
      }
    }
    remove();
  }
}

/**
 * The test/helper that created a fixture owns its lifetime. Every owned
 * directory is attempted exactly once; a removal failure is surfaced instead of
 * being swallowed or silently skipping the remaining targets.
 */
function removeOwnedDirs({ dirs, rm = removeTreeRobust, label = 'fixture' }) {
  const errors = [];
  for (const dir of dirs) {
    try {
      rm(dir, { recursive: true, force: true });
    } catch (error) {
      errors.push(`${dir}: ${messageOf(error)}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`${label} cleanup failed: ${errors.join('; ')}`);
  }
}

/** Canonical checkout + real bare remote, with a clean live `main`. */
function buildFixture({ failAfterInit = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'greenhub-run-goal-spec-'));
  const bare = mkdtempSync(join(tmpdir(), 'greenhub-run-goal-spec-remote-'));
  const goalDir = mkdtempSync(join(tmpdir(), 'greenhub-run-goal-spec-goals-'));
  try {
    git(bare, ['init', '--bare', '-b', 'main']);
    initRepository(root);
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'docs', 'authority.md'), 'STATUS: READY\n');
    writeFileSync(join(root, 'src', 'base.txt'), 'base\n');
    writeFileSync(join(root, 'proof-ok.cjs'), 'process.exit(0);\n');
    writeFileSync(join(root, 'proof-fail.cjs'), 'process.exit(1);\n');
    writeFileSync(
      join(root, 'proof-mutate.cjs'),
      "const { writeFileSync } = require('node:fs');\nwriteFileSync('src/base.txt', 'mutated by proof\\n');\nprocess.exit(0);\n",
    );
    writeFileSync(
      join(root, 'proof-feature.cjs'),
      "const { existsSync } = require('node:fs');\nprocess.exit(existsSync('docs/feature.md') ? 0 : 1);\n",
    );
    writeFileSync(
      join(root, 'proof-one.cjs'),
      "const { existsSync } = require('node:fs');\nprocess.exit(existsSync('docs/one.md') ? 0 : 1);\n",
    );
    writeFileSync(
      join(root, 'proof-two.cjs'),
      "const { existsSync } = require('node:fs');\nprocess.exit(existsSync('docs/two.md') ? 0 : 1);\n",
    );
    for (let index = 1; index <= 5; index += 1) {
      writeFileSync(
        join(root, `proof-ga03-${index}.cjs`),
        `const { existsSync } = require('node:fs');\nprocess.exit(existsSync('docs/ga03/p${index}.md') ? 0 : 1);\n`,
      );
    }
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'base']);
    const baseSha = git(root, ['rev-parse', 'HEAD']);
    git(root, ['remote', 'add', 'origin', bare]);
    git(root, ['push', '-u', 'origin', 'main']);
    if (failAfterInit) throw new Error('injected fixture setup failure');
    return { root, bare, goalDir, baseSha };
  } catch (error) {
    try {
      git(root, ['worktree', 'prune']);
    } catch {
      // setup cleanup is best-effort; the removal below still runs
    }
    let cleanupFailure = null;
    try {
      removeOwnedDirs({ dirs: [root, bare, goalDir], label: 'fixture setup' });
    } catch (cleanupError) {
      cleanupFailure = cleanupError;
    }
    if (error instanceof Error) {
      error.fixturePaths = [root, bare, goalDir];
      if (cleanupFailure !== null) error.fixtureCleanupErrors = [messageOf(cleanupFailure)];
    }
    if (cleanupFailure !== null) {
      throw new Error(`${messageOf(error)}; ${messageOf(cleanupFailure)}`);
    }
    throw error;
  }
}

function removeFixture(fixture, { rm = removeTreeRobust } = {}) {
  try {
    git(fixture.root, ['worktree', 'prune']);
  } catch {
    // fixture teardown is best-effort
  }
  removeOwnedDirs({ dirs: [fixture.root, fixture.bare, fixture.goalDir], rm });
}

function baseContract(overrides = {}) {
  return {
    GOAL: 'deterministic goal core proof',
    ACCEPTANCE_AUTHORITY: ['docs/authority.md'],
    PRESERVE: ['src'],
    AUTONOMOUSLY_ALLOWED: ['docs', 'src'],
    ESCALATE_IF: [],
    STOP_WHEN: 'all criteria satisfied or a human/external gate remains',
    CRITERIA: [],
    TASK_CATALOG: [],
    BUDGET: { max_iterations: 4, max_tasks: 2 },
    ...overrides,
  };
}

let goalCounter = 0;

function writeGoal(fixture, contract) {
  goalCounter += 1;
  const goalFile = join(fixture.goalDir, `goal-${goalCounter}.json`);
  writeFileSync(goalFile, JSON.stringify(contract, null, 2), 'utf8');
  return goalFile;
}

function runGoalOn(fixture, contract, deps = {}) {
  return runGoal(
    { goalFile: writeGoal(fixture, contract), repositoryRoot: fixture.root, remote: 'origin' },
    { log: () => {}, ...deps },
  );
}

/** Narrow child seams: record the child options and never touch any checkout. */
function createFakeChildren({ runOnceBehavior = null, runPublishBehavior = null } = {}) {
  const calls = { runOnce: [], runPublishOnce: [] };
  const runOnce = (options) => {
    calls.runOnce.push(options);
    if (runOnceBehavior) return runOnceBehavior(options, calls.runOnce.length);
    return { status: 'SUCCESS', reason: 'fake success', changedPaths: ['src/allowed.txt'] };
  };
  const runPublishOnce = (options) => {
    calls.runPublishOnce.push(options);
    if (runPublishBehavior) return runPublishBehavior(options, calls.runPublishOnce.length);
    return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication' };
  };
  return { calls, deps: { runOnce, runPublishOnce } };
}

function childCallCount(fake) {
  return fake.calls.runOnce.length + fake.calls.runPublishOnce.length;
}

/** Simulated publication: pushes a commit directly to live main via a clone. */
function pushCommitToLiveMain(fixture, { path, content, message = 'live main movement' }) {
  const clone = mkdtempSync(join(tmpdir(), 'greenhub-run-goal-clone-'));
  try {
    git(clone, ['clone', '--quiet', fixture.bare, '.']);
    git(clone, ['config', 'user.email', 'run-goal-spec@local']);
    git(clone, ['config', 'user.name', 'run-goal-spec']);
    git(clone, ['config', 'commit.gpgsign', 'false']);
    const absolute = join(clone, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
    git(clone, ['add', '--', path]);
    git(clone, ['commit', '-m', message]);
    git(clone, ['push', '--quiet', 'origin', 'main']);
    return git(clone, ['rev-parse', 'HEAD']);
  } finally {
    removeTreeRobust(clone);
  }
}

function listProofWorkspaceDirs() {
  return readdirSync(tmpdir())
    .filter((name) => name.startsWith('greenhub-run-goal-proof-'))
    .sort();
}

function listRunOnceWorkspaceDirs() {
  return readdirSync(tmpdir())
    .filter((name) => name.startsWith('greenhub-run-once-'))
    .sort();
}

function listBatchWorkspaceDirs() {
  return readdirSync(tmpdir())
    .filter((name) => name.startsWith('greenhub-run-goal-batch-'))
    .sort();
}

/** One bounded no-publication task closing one path criterion. */
function batchTask({ id, path, criterionId, overrides = {} }) {
  return {
    id,
    outcome: `Create the declared deliverable ${path} inside the allowed boundary.`,
    preserve: 'Unrelated files and runtime behavior.',
    closes: [criterionId],
    allow: [path],
    proof: [],
    proof_owner: [],
    semantic_owner: [path],
    publication: 'none',
    commit_message: null,
    pr_title: null,
    escalate_only_if: [],
    depends_on: [],
    ...overrides,
  };
}

/**
 * Deterministic real-process concurrency probe: a fake OpenCode executable that
 * writes a start marker, blocks until every expected sibling has started (a
 * filesystem barrier, never a fixed sleep), then writes an end marker.
 */
function createFakeOpencodeBin({ expected }) {
  const binDir = mkdtempSync(join(tmpdir(), 'greenhub-run-goal-fake-opencode-'));
  const eventsDir = mkdtempSync(join(tmpdir(), 'greenhub-run-goal-fake-events-'));
  const script = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const dir = process.env.GREENHUB_GA03_FAKE_DIR;',
    'const expected = Number(process.env.GREENHUB_GA03_FAKE_EXPECT || "5");',
    'const args = process.argv.slice(2);',
    "const dirIndex = args.indexOf('--dir');",
    'const workspace = dirIndex >= 0 ? args[dirIndex + 1] : null;',
    "const titleIndex = args.indexOf('--title');",
    'const title = titleIndex >= 0 ? args[titleIndex + 1] : null;',
    'if (!dir || !workspace) {',
    "  console.error('fake opencode: --dir and GREENHUB_GA03_FAKE_DIR are required');",
    '  process.exit(2);',
    '}',
    'const key = path.basename(path.dirname(workspace));',
    'const startedAt = Date.now();',
    "fs.writeFileSync(path.join(dir, 'start-' + key + '.json'), JSON.stringify({ key, title, startedAt, pid: process.pid }));",
    'const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);',
    'const deadline = Date.now() + 120000;',
    'for (;;) {',
    "  const starts = fs.readdirSync(dir).filter((name) => name.startsWith('start-')).length;",
    '  if (starts >= expected) break;',
    '  if (Date.now() > deadline) {',
    "    console.error('fake opencode: barrier timeout ' + starts + '/' + expected);",
    '    process.exit(3);',
    '  }',
    '  sleep(20);',
    '}',
    'const endedAt = Date.now();',
    "fs.writeFileSync(path.join(dir, 'end-' + key + '.json'), JSON.stringify({ key, title, startedAt, endedAt, pid: process.pid }));",
    'process.exit(0);',
    '',
  ].join('\n');
  writeFileSync(join(binDir, 'fake-opencode.cjs'), script, 'utf8');
  let opencodeBin = null;
  if (process.platform === 'win32') {
    writeFileSync(
      join(binDir, 'opencode.cmd'),
      '@echo off\r\n"%~dp0\\fake-opencode.cjs" %*\r\n',
      'utf8',
    );
  } else {
    const executable = join(binDir, 'opencode');
    writeFileSync(executable, `#!/usr/bin/env node\n${script}`, 'utf8');
    chmodSync(executable, 0o755);
    opencodeBin = executable;
  }
  return {
    binDir,
    eventsDir,
    opencodeBin,
    env: {
      ...process.env,
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      GREENHUB_GA03_FAKE_DIR: eventsDir,
      GREENHUB_GA03_FAKE_EXPECT: String(expected),
    },
    readEvents(prefix) {
      return readdirSync(eventsDir)
        .filter((name) => name.startsWith(prefix))
        .map((name) => JSON.parse(readFileSync(join(eventsDir, name), 'utf8')));
    },
    remove() {
      removeTreeRobust(binDir);
      removeTreeRobust(eventsDir);
    },
  };
}

function criterionById(result, id) {
  return result.criteria.find((criterion) => criterion.id === id);
}

function pathCriterion(overrides = {}) {
  return {
    id: 'C1',
    statement: 'the declared path exists at live main',
    authority: ['docs/authority.md'],
    check: 'PATH_PRESENT',
    class: 'AUTONOMOUS',
    path: 'docs/feature.md',
    ...overrides,
  };
}

function publicationTask(overrides = {}) {
  return {
    id: 'T1',
    outcome: 'Create the declared deliverable inside the allowed boundary.',
    preserve: 'Unrelated files and runtime behavior.',
    closes: ['C1'],
    allow: ['docs'],
    proof: ['node proof-ok.cjs'],
    proof_owner: [['docs']],
    semantic_owner: ['docs'],
    publication: 'required',
    commit_message: 'docs: deliver the bounded outcome',
    pr_title: 'docs: deliver the bounded outcome',
    escalate_only_if: [],
    depends_on: [],
    ...overrides,
  };
}

function proofCriterion(overrides = {}) {
  return {
    id: 'C1',
    statement: 'the feature proof passes at live main',
    authority: ['docs/authority.md'],
    check: 'PROOF_AT_MAIN',
    class: 'AUTONOMOUS',
    command: 'node proof-feature.cjs',
    ...overrides,
  };
}

function plannerTaskProposal(overrides = {}) {
  return {
    decision: 'TASK',
    reason: 'close the open autonomous gap with one bounded change',
    task: {
      id: 'P1',
      outcome: 'Create the missing feature document inside the declared boundary.',
      closes: ['C1'],
      allow: ['docs'],
      semantic_owner: ['docs'],
      ...overrides,
    },
  };
}

/** Deterministic planner proposal whose outcome is exactly `length` characters. */
function plannerOutcomeOfLength(length) {
  const seed = 'Close the open autonomous gap inside the declared boundary.';
  if (length <= seed.length) return seed.slice(0, length);
  return `${seed} ${'x'.repeat(length - seed.length - 1)}`;
}

function plannerStdout(proposal) {
  return [
    JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }),
    JSON.stringify({ type: 'text', part: { type: 'text', text: JSON.stringify(proposal) } }),
    JSON.stringify({ type: 'step_finish', part: { type: 'finish' } }),
    '',
  ].join('\n');
}

function plannerSuccess(stdout) {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    startErrorCode: null,
    stdout,
    stderr: '',
  };
}

/** Deterministic planner invocation seam: records input, returns fake output. */
function createFakePlanner({ proposals, onCall = null } = {}) {
  const calls = [];
  const invokePlannerOpencode = (input) => {
    calls.push(input);
    const index = calls.length - 1;
    const proposal = typeof proposals === 'function' ? proposals(index, input) : proposals;
    if (onCall) onCall(index, input);
    if (proposal == null) return plannerSuccess('');
    return plannerSuccess(plannerStdout(proposal));
  };
  return { calls, deps: { invokePlannerOpencode } };
}

function listPlannerWorkspaceDirs() {
  return readdirSync(tmpdir())
    .filter((name) => name.startsWith('greenhub-run-goal-planner-'))
    .sort();
}

test('CASE A — an already satisfied goal makes zero executor calls', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeChildren();
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [
          pathCriterion({ id: 'C1', path: 'docs/authority.md' }),
          {
            id: 'C2',
            statement: 'authority document owns the READY status',
            authority: ['docs/authority.md'],
            check: 'DOC_TOKEN',
            class: 'AUTONOMOUS',
            path: 'docs/authority.md',
            token: 'READY',
          },
        ],
      }),
      fake.deps,
    );

    assert.equal(result.status, GOAL_SATISFIED);
    assert.equal(result.childCalls, 0);
    assert.equal(childCallCount(fake), 0);
    assert.equal(result.iterations, 0);
    assert.deepEqual(
      result.criteria.map((criterion) => [criterion.id, criterion.disposition]),
      [
        ['C1', 'SATISFIED'],
        ['C2', 'SATISFIED'],
      ],
    );
    assert.equal(result.liveMain.atStart.fetchedSha, fixture.baseSha);
    assert.equal(result.liveMain.movement, 'UNCHANGED');
  } finally {
    removeFixture(fixture);
  }
});

test('CASE B — one declared task closes the gap via exactly one GN attempt', () => {
  const fixture = buildFixture();
  try {
    let pushedSha = null;
    const fake = createFakeChildren({
      runPublishBehavior: () => {
        pushedSha = pushCommitToLiveMain(fixture, {
          path: 'docs/feature.md',
          content: '# feature\n',
          message: 'docs: deliver the bounded outcome',
        });
        return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication', changedPaths: ['docs/feature.md'] };
      },
    });
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [pathCriterion()],
        TASK_CATALOG: [publicationTask()],
      }),
      fake.deps,
    );

    assert.equal(result.status, GOAL_SATISFIED);
    assert.equal(fake.calls.runPublishOnce.length, 1);
    assert.equal(fake.calls.runOnce.length, 0);
    assert.equal(result.childCalls, 1);
    assert.equal(result.iterations, 1);
    assert.equal(result.attempts[0].taskId, 'T1');
    assert.equal(result.attempts[0].publication, 'required');
    assert.equal(result.attempts[0].childStatus, 'SUCCESS_PUBLISHED');
    assert.equal(result.attempts[0].succeeded, true);
    assert.equal(result.attempts[0].progressed, true);
    assert.deepEqual(result.attempts[0].semanticOwner, ['docs']);
    assert.equal(result.liveMain.movement, 'MOVED');
    assert.equal(result.liveMain.atEnd.fetchedSha, pushedSha);
    assert.equal(criterionById(result, 'C1').satisfied, true);

    const childOptions = fake.calls.runPublishOnce[0];
    assert.deepEqual(childOptions.allowedPaths, ['docs']);
    assert.deepEqual(childOptions.proofCommands, ['node proof-ok.cjs']);
    assert.deepEqual(childOptions.proofOwners, [['docs']]);
    assert.equal(childOptions.commitMessage, 'docs: deliver the bounded outcome');
    assert.equal(childOptions.prTitle, 'docs: deliver the bounded outcome');
    assert.match(childOptions.taskText, /OUTCOME:/);
    assert.match(childOptions.taskText, /PRESERVE:/);
    assert.match(childOptions.taskText, /PROOF:/);
    assert.match(childOptions.taskText, /ESCALATE ONLY IF:/);
    assert.ok(!('publication' in childOptions));
    assert.ok(!('closes' in childOptions));
  } finally {
    removeFixture(fixture);
  }
});

test('CASE C — a successful task with unchanged criteria stops at NO_PROGRESS', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeChildren({
      runPublishBehavior: () => ({ status: 'SUCCESS_PUBLISHED', reason: 'no-op publication' }),
    });
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [pathCriterion()],
        TASK_CATALOG: [publicationTask()],
      }),
      fake.deps,
    );

    assert.equal(result.status, NO_PROGRESS);
    assert.equal(result.childCalls, 1);
    assert.equal(childCallCount(fake), 1);
    assert.equal(result.attempts[0].succeeded, true);
    assert.equal(result.attempts[0].progressed, false);
    assert.equal(criterionById(result, 'C1').satisfied, false);
    assert.equal(criterionById(result, 'C1').disposition, 'AUTONOMOUS_UNTASKED');
  } finally {
    removeFixture(fixture);
  }
});

test('CASE D — a HUMAN criterion only yields HUMAN_DECISION_REQUIRED without executing', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeChildren();
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [
          {
            id: 'C1',
            statement: 'a human owner must accept the product policy',
            authority: ['docs/authority.md'],
            check: 'HUMAN_AUTHORITY',
            class: 'HUMAN',
          },
        ],
      }),
      fake.deps,
    );

    assert.equal(result.status, HUMAN_DECISION_REQUIRED);
    assert.equal(result.childCalls, 0);
    assert.equal(childCallCount(fake), 0);
    assert.equal(criterionById(result, 'C1').satisfied, false);
    assert.equal(criterionById(result, 'C1').disposition, 'HUMAN');
  } finally {
    removeFixture(fixture);
  }
});

test('CASE E — an EXTERNAL criterion only yields BLOCKED_EXTERNAL without executing', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeChildren();
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [
          {
            id: 'C1',
            statement: 'an external provider gate must lift',
            authority: ['docs/authority.md'],
            check: 'EXTERNAL_GATE',
            class: 'EXTERNAL',
          },
        ],
      }),
      fake.deps,
    );

    assert.equal(result.status, BLOCKED_EXTERNAL);
    assert.equal(result.childCalls, 0);
    assert.equal(childCallCount(fake), 0);
    assert.equal(criterionById(result, 'C1').satisfied, false);
    assert.equal(criterionById(result, 'C1').disposition, 'EXTERNAL');
  } finally {
    removeFixture(fixture);
  }
});

test('CASE F — an autonomous gap without a catalog task yields NO_TASK_FOR_GAP', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeChildren();
    const result = runGoalOn(fixture, baseContract({ CRITERIA: [pathCriterion()] }), fake.deps);

    assert.equal(result.status, NO_TASK_FOR_GAP);
    assert.equal(result.childCalls, 0);
    assert.equal(childCallCount(fake), 0);
    assert.deepEqual(result.refusals, []);
    assert.equal(criterionById(result, 'C1').disposition, 'AUTONOMOUS_UNTASKED');
  } finally {
    removeFixture(fixture);
  }
});

test('CASE G — an unreadable ACCEPTANCE_AUTHORITY yields INVALID_GOAL without executing', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeChildren();
    const result = runGoalOn(
      fixture,
      baseContract({ ACCEPTANCE_AUTHORITY: ['docs/not-tracked.md'] }),
      fake.deps,
    );

    assert.equal(result.status, INVALID_GOAL);
    assert.equal(result.childCalls, 0);
    assert.equal(childCallCount(fake), 0);
    assert.equal(result.validation.kind, INVALID_GOAL);
    assert.equal(result.acceptanceAuthority[0].path, 'docs/not-tracked.md');
    assert.equal(result.acceptanceAuthority[0].readableAtLiveMain, false);

    const emptyResult = runGoalOn(fixture, baseContract({ ACCEPTANCE_AUTHORITY: [] }), fake.deps);
    assert.equal(emptyResult.status, INVALID_GOAL);
    assert.equal(childCallCount(fake), 0);

    const missingFileResult = runGoal(
      { goalFile: join(fixture.goalDir, 'missing.json'), repositoryRoot: fixture.root },
      { log: () => {} },
    );
    assert.equal(missingFileResult.status, INVALID_GOAL);
    assert.equal(missingFileResult.childCalls, 0);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE H — a task outside AUTONOMOUSLY_ALLOWED is refused without executing', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeChildren();
    const result = runGoalOn(
      fixture,
      baseContract({
        AUTONOMOUSLY_ALLOWED: ['src'],
        CRITERIA: [pathCriterion()],
        TASK_CATALOG: [publicationTask()],
      }),
      fake.deps,
    );

    assert.equal(result.status, HUMAN_DECISION_REQUIRED);
    assert.equal(result.childCalls, 0);
    assert.equal(childCallCount(fake), 0);
    assert.equal(result.refusals.length, 1);
    assert.equal(result.refusals[0].taskId, 'T1');
    assert.match(result.refusals[0].reason, /outside AUTONOMOUSLY_ALLOWED/);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE I — an unknown escalation token fails closed without executing', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeChildren();

    const goalToken = runGoalOn(
      fixture,
      baseContract({ ESCALATE_IF: ['NOT_A_DECLARED_TOKEN'] }),
      fake.deps,
    );
    assert.equal(goalToken.status, INVALID_GOAL);
    assert.equal(goalToken.validation.kind, INVALID_GOAL);
    assert.equal(goalToken.childCalls, 0);

    const taskToken = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [pathCriterion()],
        TASK_CATALOG: [publicationTask({ escalate_only_if: ['PILOT_GO_MAYBE'] })],
      }),
      fake.deps,
    );
    assert.equal(taskToken.status, INVALID_GOAL);
    assert.equal(taskToken.validation.kind, INVALID_TASK);
    assert.equal(taskToken.childCalls, 0);
    assert.equal(childCallCount(fake), 0);

    const declaredToken = runGoalOn(
      fixture,
      baseContract({ ESCALATE_IF: ['PRODUCT_POLICY_FORK'] }),
      fake.deps,
    );
    assert.equal(declaredToken.status, GOAL_SATISFIED);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE J — budget exhaustion stops finitely before unbounded retries', () => {
  const fixture = buildFixture();
  try {
    const zeroIterationsFake = createFakeChildren();
    const zeroIterations = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [pathCriterion()],
        TASK_CATALOG: [publicationTask()],
        BUDGET: { max_iterations: 0, max_tasks: 2, max_wall_clock_ms: 60000 },
      }),
      zeroIterationsFake.deps,
    );
    assert.equal(zeroIterations.status, BUDGET_EXHAUSTED);
    assert.equal(zeroIterations.budget.exhausted, 'ITERATIONS');
    assert.equal(zeroIterations.childCalls, 0);

    const taskBudgetFake = createFakeChildren({
      runPublishBehavior: () => ({ status: 'EXECUTOR_FAILED', reason: 'simulated executor failure' }),
    });
    const taskBudget = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [pathCriterion()],
        TASK_CATALOG: [
          publicationTask({ id: 'T1' }),
          publicationTask({ id: 'T2', commit_message: 'docs: alternate path', pr_title: 'docs: alternate path' }),
        ],
        BUDGET: { max_iterations: 4, max_tasks: 1, max_wall_clock_ms: 60000 },
      }),
      taskBudgetFake.deps,
    );
    assert.equal(taskBudget.status, BUDGET_EXHAUSTED);
    assert.equal(taskBudget.budget.exhausted, 'TASKS');
    assert.equal(taskBudget.childCalls, 1);
    assert.equal(taskBudgetFake.calls.runPublishOnce.length, 1);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE K — live main movement between iterations is re-read, not re-bound here', () => {
  const fixture = buildFixture();
  try {
    let movedSha = null;
    const fake = createFakeChildren({
      runOnceBehavior: () => {
        movedSha = pushCommitToLiveMain(fixture, {
          path: 'docs/feature.md',
          content: '# feature\n',
          message: 'external movement',
        });
        return { status: 'SUCCESS', reason: 'fake execution', changedPaths: ['docs/feature.md'] };
      },
    });
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [pathCriterion()],
        TASK_CATALOG: [publicationTask({ publication: 'none', commit_message: null, pr_title: null })],
      }),
      fake.deps,
    );

    assert.equal(result.status, GOAL_SATISFIED);
    assert.equal(result.childCalls, 1);
    assert.equal(result.liveMain.movement, 'MOVED');
    assert.equal(result.liveMain.atEnd.fetchedSha, movedSha);
    assert.equal(criterionById(result, 'C1').satisfied, true);
    assert.equal(criterionById(result, 'C1').reason.includes(movedSha), true);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE L — a dirty shared checkout is preserved exactly', () => {
  const fixture = buildFixture();
  try {
    writeFileSync(join(fixture.root, 'src', 'base.txt'), 'foreign tracked modification\n');
    writeFileSync(join(fixture.root, 'foreign-untracked.txt'), 'foreign untracked\n');
    const statusBefore = gitRaw(fixture.root, ['status', '--porcelain=v1']);
    const headBefore = git(fixture.root, ['rev-parse', 'HEAD']);
    const branchBefore = git(fixture.root, ['branch', '--show-current']);

    const fake = createFakeChildren({
      runOnceBehavior: () => ({ status: 'SUCCESS', reason: 'fake execution', changedPaths: [] }),
    });
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [pathCriterion()],
        TASK_CATALOG: [publicationTask({ publication: 'none', commit_message: null, pr_title: null })],
      }),
      fake.deps,
    );

    assert.equal(result.status, NO_PROGRESS);
    assert.equal(result.childCalls, 1);
    assert.equal(result.canonicalCheckout.unchanged, true);
    assert.equal(gitRaw(fixture.root, ['status', '--porcelain=v1']), statusBefore);
    assert.equal(git(fixture.root, ['rev-parse', 'HEAD']), headBefore);
    assert.equal(git(fixture.root, ['branch', '--show-current']), branchBefore);
    assert.equal(
      readFileSync(join(fixture.root, 'src', 'base.txt'), 'utf8'),
      'foreign tracked modification\n',
    );
    assert.equal(
      readFileSync(join(fixture.root, 'foreign-untracked.txt'), 'utf8'),
      'foreign untracked\n',
    );
  } finally {
    removeFixture(fixture);
  }
});

test('HUMAN takes deterministic priority over EXTERNAL while both are preserved', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeChildren();
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [
          {
            id: 'C1',
            statement: 'human product decision pending',
            authority: ['docs/authority.md'],
            check: 'HUMAN_AUTHORITY',
            class: 'HUMAN',
          },
          {
            id: 'C2',
            statement: 'external provider gate pending',
            authority: ['docs/authority.md'],
            check: 'EXTERNAL_GATE',
            class: 'EXTERNAL',
          },
          pathCriterion({ id: 'C3' }),
        ],
      }),
      fake.deps,
    );

    assert.equal(result.status, HUMAN_DECISION_REQUIRED);
    assert.equal(childCallCount(fake), 0);
    assert.deepEqual(
      result.criteria.map((criterion) => [criterion.id, criterion.disposition]),
      [
        ['C1', 'HUMAN'],
        ['C2', 'EXTERNAL'],
        ['C3', 'AUTONOMOUS_UNTASKED'],
      ],
    );
  } finally {
    removeFixture(fixture);
  }
});

test('criterion checks read the live-main object store and isolated proof workspaces', () => {
  const fixture = buildFixture();
  const proofDirsBefore = listProofWorkspaceDirs();
  try {
    // The shared working tree must never be an authority source: this stale
    // copy must not affect DOC_TOKEN or ACCEPTANCE_AUTHORITY.
    writeFileSync(join(fixture.root, 'docs', 'authority.md'), 'STATUS: STALE\n');
    const fake = createFakeChildren();
    const ghCalls = [];
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [
          {
            id: 'C1',
            statement: 'a retired path is absent from live main',
            authority: ['docs/authority.md'],
            check: 'PATH_ABSENT',
            class: 'AUTONOMOUS',
            path: 'docs/retired.md',
          },
          {
            id: 'C2',
            statement: 'the authority document owns the READY token',
            authority: ['docs/authority.md'],
            check: 'DOC_TOKEN',
            class: 'AUTONOMOUS',
            path: 'docs/authority.md',
            token: 'READY',
          },
          {
            id: 'C3',
            statement: 'the focused proof passes at live main',
            authority: ['docs/authority.md'],
            check: 'PROOF_AT_MAIN',
            class: 'AUTONOMOUS',
            command: 'node proof-ok.cjs',
          },
          {
            id: 'C4',
            statement: 'the publication PR is merged',
            authority: ['docs/authority.md'],
            check: 'PR_MERGED',
            class: 'AUTONOMOUS',
            repository: 'booker-lab/greenhub',
            pr: 123,
          },
          {
            id: 'C5',
            statement: 'a mutating proof stays inside its disposable workspace',
            authority: ['docs/authority.md'],
            check: 'PROOF_AT_MAIN',
            class: 'AUTONOMOUS',
            command: 'node proof-mutate.cjs',
          },
        ],
      }),
      {
        ...fake.deps,
        runGh: (args) => {
          ghCalls.push(args);
          return {
            exitCode: 0,
            signal: null,
            timedOut: false,
            startErrorCode: null,
            stdout: JSON.stringify({ state: 'MERGED', mergeCommit: { oid: fixture.baseSha } }),
            stderr: '',
          };
        },
      },
    );

    assert.equal(result.status, GOAL_SATISFIED);
    assert.equal(result.childCalls, 0);
    assert.equal(result.criteria.every((criterion) => criterion.satisfied), true);
    assert.equal(result.criteria[2].proofResult.ok, true);
    assert.equal(result.criteria[2].cleanup, 'REMOVED');
    assert.equal(result.criteria[4].satisfied, true);
    assert.equal(result.criteria[4].cleanup, 'REMOVED');
    assert.equal(readFileSync(join(fixture.root, 'src', 'base.txt'), 'utf8'), 'base\n');
    assert.equal(
      readFileSync(join(fixture.root, 'docs', 'authority.md'), 'utf8'),
      'STATUS: STALE\n',
    );
    assert.equal(ghCalls.length, 1);
    assert.deepEqual(ghCalls[0].slice(0, 3), ['pr', 'view', '123']);
    assert.deepEqual(listProofWorkspaceDirs(), proofDirsBefore);

    const failing = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [
          {
            id: 'C1',
            statement: 'the doc does not yet own the token',
            authority: ['docs/authority.md'],
            check: 'DOC_TOKEN',
            class: 'AUTONOMOUS',
            path: 'docs/authority.md',
            token: 'NOT_YET',
          },
          {
            id: 'C2',
            statement: 'the failing proof must not be satisfied',
            authority: ['docs/authority.md'],
            check: 'PROOF_AT_MAIN',
            class: 'AUTONOMOUS',
            command: 'node proof-fail.cjs',
          },
          pathCriterion({ id: 'C3' }),
        ],
      }),
      {
        ...fake.deps,
        runGh: () => ({
          exitCode: 0,
          signal: null,
          timedOut: false,
          startErrorCode: null,
          stdout: JSON.stringify({ state: 'OPEN' }),
          stderr: '',
        }),
      },
    );
    assert.equal(failing.status, NO_TASK_FOR_GAP);
    assert.equal(childCallCount(fake), 0);
    assert.equal(failing.criteria.every((criterion) => !criterion.satisfied), true);
    assert.equal(failing.criteria[1].proofResult.exitCode, 1);
    assert.equal(failing.criteria[1].cleanup, 'REMOVED');
    assert.deepEqual(listProofWorkspaceDirs(), proofDirsBefore);
  } finally {
    removeFixture(fixture);
  }
});

test('declared depends_on gates deterministic selection across iterations', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeChildren({
      runPublishBehavior: (options, callNumber) => {
        if (callNumber === 1) {
          pushCommitToLiveMain(fixture, { path: 'docs/one.md', content: 'one\n', message: 'first' });
        } else {
          pushCommitToLiveMain(fixture, { path: 'docs/two.md', content: 'two\n', message: 'second' });
        }
        return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication' };
      },
    });
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [
          pathCriterion({ id: 'C1', path: 'docs/one.md' }),
          pathCriterion({ id: 'C2', path: 'docs/two.md' }),
        ],
        TASK_CATALOG: [
          publicationTask({ id: 'T2', closes: ['C2'], depends_on: ['T1'] }),
          publicationTask({ id: 'T1', closes: ['C1'] }),
        ],
        BUDGET: { max_iterations: 4, max_tasks: 4 },
      }),
      fake.deps,
    );

    assert.equal(result.status, GOAL_SATISFIED);
    assert.equal(result.childCalls, 2);
    assert.deepEqual(
      result.attempts.map((attempt) => attempt.taskId),
      ['T1', 'T2'],
    );
    assert.deepEqual(fake.calls.runPublishOnce.map((options) => options.commitMessage), [
      'docs: deliver the bounded outcome',
      'docs: deliver the bounded outcome',
    ]);
  } finally {
    removeFixture(fixture);
  }
});

test('the runner creates no durable task state or temporary residue', () => {
  const fixture = buildFixture();
  const proofDirsBefore = listProofWorkspaceDirs();
  try {
    const entriesBefore = readdirSync(fixture.root).sort();
    const fake = createFakeChildren({
      runPublishBehavior: () => {
        pushCommitToLiveMain(fixture, { path: 'docs/feature.md', content: '# feature\n' });
        return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication' };
      },
    });
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [pathCriterion()],
        TASK_CATALOG: [publicationTask()],
      }),
      fake.deps,
    );

    assert.equal(result.status, GOAL_SATISFIED);
    assert.deepEqual(readdirSync(fixture.root).sort(), entriesBefore);
    assert.deepEqual(listProofWorkspaceDirs(), proofDirsBefore);
    for (const key of ['taskRegistry', 'goalState', 'iterationJournal', 'resultInbox', 'proofCache']) {
      assert.ok(!(key in result));
    }
  } finally {
    removeFixture(fixture);
  }
});

test('contract validation fails closed on malformed criteria and catalog tasks', () => {
  const valid = baseContract({
    CRITERIA: [
      {
        id: 'C1',
        statement: 'path exists',
        authority: ['docs/authority.md'],
        check: 'PATH_PRESENT',
        class: 'AUTONOMOUS',
        path: 'docs/feature.md',
      },
      {
        id: 'C2',
        statement: 'human acceptance',
        authority: ['docs/authority.md'],
        check: 'HUMAN_AUTHORITY',
        class: 'HUMAN',
      },
    ],
    TASK_CATALOG: [publicationTask()],
  });
  const clone = (overrides) => JSON.parse(JSON.stringify({ ...valid, ...overrides }));
  const withTask = (taskOverrides) =>
    clone({ TASK_CATALOG: [{ ...publicationTask(), ...taskOverrides }] });

  assert.equal(validateGoalContract(valid).ok, true);
  assert.equal(validateGoalContract(clone({ GOAL: '' })).kind, INVALID_GOAL);
  assert.equal(validateGoalContract(clone({ ACCEPTANCE_AUTHORITY: [] })).kind, INVALID_GOAL);
  assert.equal(validateGoalContract(clone({ AUTONOMOUSLY_ALLOWED: 'docs' })).kind, INVALID_GOAL);
  assert.equal(validateGoalContract(clone({ ESCALATE_IF: ['NOPE'] })).kind, INVALID_GOAL);
  assert.equal(
    validateGoalContract(
      clone({
        CRITERIA: [{ ...valid.CRITERIA[0], check: 'UNKNOWN_CHECK' }],
      }),
    ).kind,
    INVALID_GOAL,
  );
  assert.equal(
    validateGoalContract(
      clone({
        CRITERIA: [{ ...valid.CRITERIA[1], class: 'AUTONOMOUS' }],
      }),
    ).kind,
    INVALID_GOAL,
  );
  assert.equal(
    validateGoalContract(
      clone({
        CRITERIA: [valid.CRITERIA[0], { ...valid.CRITERIA[0], statement: 'duplicate' }],
      }),
    ).kind,
    INVALID_GOAL,
  );
  assert.equal(
    validateGoalContract(
      clone({ CRITERIA: [{ ...valid.CRITERIA[0], path: '../escape.md' }] }),
    ).kind,
    INVALID_GOAL,
  );
  assert.equal(validateGoalContract(withTask({ proof_owner: [] })).kind, INVALID_TASK);
  assert.equal(validateGoalContract(withTask({ closes: ['UNKNOWN'] })).kind, INVALID_TASK);
  assert.equal(validateGoalContract(withTask({ closes: ['C2'] })).kind, INVALID_TASK);
  assert.equal(validateGoalContract(withTask({ depends_on: ['UNKNOWN'] })).kind, INVALID_TASK);
  assert.equal(
    validateGoalContract(
      clone({
        TASK_CATALOG: [
          publicationTask({ id: 'T1', depends_on: ['T2'] }),
          publicationTask({ id: 'T2', depends_on: ['T1'] }),
        ],
      }),
    ).kind,
    INVALID_TASK,
  );
  assert.equal(validateGoalContract(withTask({ escalate_only_if: ['NOPE'] })).kind, INVALID_TASK);
  assert.equal(
    validateGoalContract(withTask({ commit_message: null })).kind,
    INVALID_TASK,
  );
  assert.equal(
    validateGoalContract(clone({ BUDGET: { max_iterations: -1 } })).kind,
    INVALID_GOAL,
  );
});

test('task text uses the existing OUTCOME/PRESERVE/PROOF/ESCALATE ONLY IF shape', () => {
  const contract = baseContract({ PRESERVE: ['src', 'AGENTS.md'] });
  const text = buildTaskText({
    task: publicationTask({ escalate_only_if: ['PRODUCT_POLICY_FORK'] }),
    contract: validateGoalContract({
      ...contract,
      CRITERIA: [
        {
          id: 'C1',
          statement: 'path exists',
          authority: ['docs/authority.md'],
          check: 'PATH_PRESENT',
          class: 'AUTONOMOUS',
          path: 'docs/feature.md',
        },
      ],
    }).contract,
  });
  assert.match(text, /OUTCOME:\n/);
  assert.match(text, /PRESERVE:\n/);
  assert.match(text, /PROOF:\n- node proof-ok\.cjs/);
  assert.match(text, /ESCALATE ONLY IF:\n- PRODUCT_POLICY_FORK/);
  assert.match(text, /Goal-level preserve \(do not change\): src, AGENTS\.md/);
});

test('the source introduces no retired or out-of-scope automation concepts', () => {
  const source = readFileSync(new URL('./run-goal.mjs', import.meta.url), 'utf8');
  // The GA-03 contract allows bounded in-run concurrency only. Persistent
  // coordination concepts stay forbidden; the retired terms must not return.
  const forbidden = [
    /queue/i,
    /scheduler/i,
    /daemon/i,
    /registry/i,
    /database/i,
    /\blease\b/i,
    /inbox/i,
    /journal/i,
    /watcher/i,
    /watchdog/i,
    /orphan/i,
    /\block\b/i,
    /adopt/i,
    /persistent/i,
    /\bcache\b/i,
    /control.?tower/i,
    /coordinator/i,
    /setInterval/,
    /setTimeout/,
    /detached:\s*true/,
    /SHARE_ENV/,
  ];
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(source), `run-goal.mjs must not contain ${pattern}`);
  }
  // Concurrency is fixed and bounded by the declared batch contract.
  assert.match(source, /export const MAX_BATCH_CONCURRENCY = 5;/);
  // The planner seam is foreground-only and keeps no durable planner state; the
  // runner forwards existing executor seams but never imports or re-implements
  // admission/rebind/transport mechanics itself.
  assert.ok(!/publication-rebind/.test(source));
  assert.ok(!/from '\.\.\/git\/publication-admission/.test(source));
});

test('parseArgs requires an explicit goal contract', () => {
  assert.equal(parseArgs([]).ok, false);
  assert.equal(parseArgs(['--goal', 'goal.json']).ok, true);
  assert.equal(parseArgs(['--goal', 'goal.json', '--bogus']).ok, false);
  assert.equal(parseArgs(['--goal', 'goal.json', '--max-tasks', '3']).ok, false);
});

test('PLANNER A — an absent or disabled planner keeps the GA-01A NO_TASK_FOR_GAP behavior', () => {
  const fixture = buildFixture();
  try {
    const absentPlanner = createFakePlanner({ proposals: plannerTaskProposal() });
    const absent = runGoalOn(
      fixture,
      baseContract({ CRITERIA: [proofCriterion()] }),
      { ...createFakeChildren().deps, ...absentPlanner.deps },
    );
    assert.equal(absent.status, NO_TASK_FOR_GAP);
    assert.equal(absent.planner.enabled, false);
    assert.equal(absent.planner.calls, 0);
    assert.equal(absentPlanner.calls.length, 0);

    const disabledPlanner = createFakePlanner({ proposals: plannerTaskProposal() });
    const disabled = runGoalOn(
      fixture,
      baseContract({ CRITERIA: [proofCriterion()], PLANNER: { enabled: false } }),
      { ...createFakeChildren().deps, ...disabledPlanner.deps },
    );
    assert.equal(disabled.status, NO_TASK_FOR_GAP);
    assert.equal(disabled.planner.enabled, false);
    assert.equal(disabled.planner.calls, 0);
    assert.equal(disabledPlanner.calls.length, 0);
  } finally {
    removeFixture(fixture);
  }
});

test('PLANNER B — an eligible declared catalog task always wins over the planner', () => {
  const fixture = buildFixture();
  try {
    const planner = createFakePlanner({ proposals: plannerTaskProposal({ id: 'P9' }) });
    const fake = createFakeChildren({
      runPublishBehavior: () => {
        pushCommitToLiveMain(fixture, { path: 'docs/feature.md', content: '# feature\n' });
        return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication' };
      },
    });
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [proofCriterion()],
        TASK_CATALOG: [publicationTask()],
        PLANNER: { enabled: true },
      }),
      { ...fake.deps, ...planner.deps },
    );

    assert.equal(result.status, GOAL_SATISFIED);
    assert.equal(result.planner.calls, 0);
    assert.equal(planner.calls.length, 0);
    assert.equal(fake.calls.runPublishOnce.length, 1);
    assert.equal(result.attempts[0].taskId, 'T1');
  } finally {
    removeFixture(fixture);
  }
});

test('PLANNER C — a validated planner task bridges to one GN publication', () => {
  const fixture = buildFixture();
  const plannerDirsBefore = listPlannerWorkspaceDirs();
  try {
    const planner = createFakePlanner({ proposals: plannerTaskProposal() });
    let pushedSha = null;
    const fake = createFakeChildren({
      runPublishBehavior: () => {
        pushedSha = pushCommitToLiveMain(fixture, {
          path: 'docs/feature.md',
          content: '# feature\n',
        });
        return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication' };
      },
    });
    const result = runGoalOn(
      fixture,
      baseContract({ CRITERIA: [proofCriterion()], PLANNER: { enabled: true } }),
      { ...fake.deps, ...planner.deps },
    );

    assert.equal(result.status, GOAL_SATISFIED);
    assert.equal(result.planner.calls, 1);
    assert.equal(result.planner.lastStatus, 'TASK');
    assert.deepEqual(result.planner.decisions, ['TASK']);
    assert.deepEqual(result.planner.lastChangedPaths, []);
    assert.equal(result.planner.lastWorkspaceCleanup, 'REMOVED');
    assert.equal(planner.calls.length, 1);
    assert.equal(fake.calls.runOnce.length, 0);
    assert.equal(fake.calls.runPublishOnce.length, 1);
    assert.equal(result.attempts[0].taskId, 'P1');
    assert.equal(result.attempts[0].publication, 'required');
    assert.equal(result.attempts[0].succeeded, true);
    assert.equal(result.attempts[0].progressed, true);
    assert.equal(result.liveMain.atEnd.fetchedSha, pushedSha);
    assert.equal(criterionById(result, 'C1').satisfied, true);

    const childOptions = fake.calls.runPublishOnce[0];
    assert.deepEqual(childOptions.proofCommands, ['node proof-feature.cjs']);
    assert.deepEqual(childOptions.proofOwners, [[]]);
    assert.deepEqual(childOptions.allowedPaths, ['docs']);
    assert.match(childOptions.taskText, /OUTCOME:/);
    assert.match(childOptions.taskText, /PRESERVE:/);
    assert.match(childOptions.taskText, /PROOF:/);
    assert.match(childOptions.taskText, /ESCALATE ONLY IF:/);
    assert.match(childOptions.commitMessage, /P1/);
    assert.ok(childOptions.prTitle.length > 0);
    assert.deepEqual(listPlannerWorkspaceDirs(), plannerDirsBefore);
  } finally {
    removeFixture(fixture);
  }
});

test('PLANNER D — a planner workspace mutation rejects the proposal and preserves the shared checkout', () => {
  const fixture = buildFixture();
  const plannerDirsBefore = listPlannerWorkspaceDirs();
  try {
    const planner = createFakePlanner({
      proposals: plannerTaskProposal(),
      onCall: (index, input) => {
        writeFileSync(join(input.cwd, 'src', 'planner-touched.txt'), 'planner mutation\n');
      },
    });
    const fake = createFakeChildren();
    const statusBefore = gitRaw(fixture.root, ['status', '--porcelain=v1']);
    const headBefore = git(fixture.root, ['rev-parse', 'HEAD']);
    const result = runGoalOn(
      fixture,
      baseContract({ CRITERIA: [proofCriterion()], PLANNER: { enabled: true } }),
      { ...fake.deps, ...planner.deps },
    );

    assert.equal(result.status, BLOCKED_EXTERNAL);
    assert.equal(result.planner.lastStatus, 'MUTATION_REJECTED');
    assert.match(result.planner.lastReason, /PLANNER_MUTATION_REJECTED/);
    assert.deepEqual(result.planner.lastChangedPaths, ['src/planner-touched.txt']);
    assert.equal(result.planner.lastWorkspaceCleanup, 'REMOVED');
    assert.equal(result.planner.lastProposal.task.id, 'P1');
    assert.equal(childCallCount(fake), 0);
    assert.equal(planner.calls.length, 1);
    assert.equal(gitRaw(fixture.root, ['status', '--porcelain=v1']), statusBefore);
    assert.equal(git(fixture.root, ['rev-parse', 'HEAD']), headBefore);
    assert.equal(existsSync(join(fixture.root, 'src', 'planner-touched.txt')), false);
    assert.deepEqual(listPlannerWorkspaceDirs(), plannerDirsBefore);
  } finally {
    removeFixture(fixture);
  }
});

test('PLANNER E — a planner allow path outside AUTONOMOUSLY_ALLOWED fails closed', () => {
  const fixture = buildFixture();
  try {
    const planner = createFakePlanner({ proposals: plannerTaskProposal({ allow: ['src'] }) });
    const fake = createFakeChildren();
    const result = runGoalOn(
      fixture,
      baseContract({
        AUTONOMOUSLY_ALLOWED: ['docs'],
        CRITERIA: [proofCriterion()],
        PLANNER: { enabled: true },
      }),
      { ...fake.deps, ...planner.deps },
    );

    assert.equal(result.status, HUMAN_DECISION_REQUIRED);
    assert.equal(result.planner.lastStatus, 'ALLOW_OUTSIDE_AUTHORITY');
    assert.match(result.planner.lastReason, /outside AUTONOMOUSLY_ALLOWED/);
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

test('PLANNER F — a planner proposal that closes a HUMAN criterion is rejected', () => {
  const fixture = buildFixture();
  try {
    const planner = createFakePlanner({ proposals: plannerTaskProposal({ closes: ['CH'] }) });
    const fake = createFakeChildren();
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [
          proofCriterion(),
          {
            id: 'CH',
            statement: 'a human owner must accept the product policy',
            authority: ['docs/authority.md'],
            check: 'HUMAN_AUTHORITY',
            class: 'HUMAN',
          },
        ],
        PLANNER: { enabled: true },
      }),
      { ...fake.deps, ...planner.deps },
    );

    assert.equal(result.status, HUMAN_DECISION_REQUIRED);
    assert.equal(result.planner.lastStatus, 'HUMAN_CRITERION_REJECTED');
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

test('PLANNER G — a planner proposal that closes an EXTERNAL criterion is rejected', () => {
  const fixture = buildFixture();
  try {
    const planner = createFakePlanner({ proposals: plannerTaskProposal({ closes: ['CE'] }) });
    const fake = createFakeChildren();
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [
          proofCriterion(),
          {
            id: 'CE',
            statement: 'an external provider gate must lift',
            authority: ['docs/authority.md'],
            check: 'EXTERNAL_GATE',
            class: 'EXTERNAL',
          },
        ],
        PLANNER: { enabled: true },
      }),
      { ...fake.deps, ...planner.deps },
    );

    assert.equal(result.status, BLOCKED_EXTERNAL);
    assert.equal(result.planner.lastStatus, 'EXTERNAL_CRITERION_REJECTED');
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

test('PLANNER H — planner-injected proof or shell fields are rejected and never executed', () => {
  const fixture = buildFixture();
  try {
    const proposal = plannerTaskProposal();
    proposal.task.proof = ['node proof-evil.cjs'];
    proposal.task.shell = 'rm -rf /';
    const planner = createFakePlanner({ proposals: proposal });
    const fake = createFakeChildren();
    const proofCommands = [];
    const result = runGoalOn(
      fixture,
      baseContract({ CRITERIA: [proofCriterion()], PLANNER: { enabled: true } }),
      {
        ...fake.deps,
        ...planner.deps,
        runProofCommand: (input) => {
          proofCommands.push(input.command);
          return defaultRunProofCommand(input);
        },
      },
    );

    assert.equal(result.status, BLOCKED_EXTERNAL);
    assert.equal(result.planner.lastStatus, 'INVALID_OUTPUT');
    assert.match(result.planner.lastReason, /unsupported field/);
    assert.equal(childCallCount(fake), 0);
    assert.equal(proofCommands.includes('node proof-evil.cjs'), false);
    assert.equal(proofCommands.includes('rm -rf /'), false);
    assert.deepEqual(proofCommands, ['node proof-feature.cjs']);
  } finally {
    removeFixture(fixture);
  }
});

test('PLANNER I — a planner task without canonical PROOF_AT_MAIN authority requires a human decision', () => {
  const fixture = buildFixture();
  try {
    const planner = createFakePlanner({ proposals: plannerTaskProposal() });
    const fake = createFakeChildren();
    const result = runGoalOn(
      fixture,
      baseContract({ CRITERIA: [pathCriterion()], PLANNER: { enabled: true } }),
      { ...fake.deps, ...planner.deps },
    );

    assert.equal(result.status, HUMAN_DECISION_REQUIRED);
    assert.equal(result.planner.lastStatus, 'PROOF_AUTHORITY_REQUIRED');
    assert.match(result.planner.lastReason, /PROOF_AUTHORITY_REQUIRED/);
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

test('PLANNER J — a declared escalation token yields HUMAN_DECISION_REQUIRED without executing', () => {
  const fixture = buildFixture();
  try {
    const planner = createFakePlanner({
      proposals: {
        decision: 'ESCALATE',
        reason: 'the product policy fork belongs to a human owner',
        escalation_token: 'PRODUCT_POLICY_FORK',
      },
    });
    const fake = createFakeChildren();
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [proofCriterion()],
        ESCALATE_IF: ['PRODUCT_POLICY_FORK'],
        PLANNER: { enabled: true },
      }),
      { ...fake.deps, ...planner.deps },
    );

    assert.equal(result.status, HUMAN_DECISION_REQUIRED);
    assert.equal(result.planner.lastStatus, 'ESCALATE');
    assert.match(result.planner.lastReason, /PRODUCT_POLICY_FORK/);
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

test('PLANNER K — an unknown escalation token fails closed without executing', () => {
  const fixture = buildFixture();
  try {
    const planner = createFakePlanner({
      proposals: {
        decision: 'ESCALATE',
        reason: 'undeclared escalation',
        escalation_token: 'NOT_A_DECLARED_TOKEN',
      },
    });
    const fake = createFakeChildren();
    const result = runGoalOn(
      fixture,
      baseContract({ CRITERIA: [proofCriterion()], PLANNER: { enabled: true } }),
      { ...fake.deps, ...planner.deps },
    );

    assert.equal(result.status, BLOCKED_EXTERNAL);
    assert.equal(result.planner.lastStatus, 'INVALID_OUTPUT');
    assert.match(result.planner.lastReason, /not declared in the Goal Contract/);
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

test('PLANNER L — a planner NO_TASK keeps the NO_TASK_FOR_GAP terminal', () => {
  const fixture = buildFixture();
  try {
    const planner = createFakePlanner({
      proposals: { decision: 'NO_TASK', reason: 'no single safe autonomous task can advance the goal' },
    });
    const fake = createFakeChildren();
    const result = runGoalOn(
      fixture,
      baseContract({ CRITERIA: [proofCriterion()], PLANNER: { enabled: true } }),
      { ...fake.deps, ...planner.deps },
    );

    assert.equal(result.status, NO_TASK_FOR_GAP);
    assert.equal(result.planner.calls, 1);
    assert.equal(result.planner.lastStatus, 'NO_TASK');
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

test('PLANNER M — a planner invocation timeout or failure yields BLOCKED_EXTERNAL', () => {
  const fixture = buildFixture();
  const plannerDirsBefore = listPlannerWorkspaceDirs();
  try {
    const fake = createFakeChildren();
    const result = runGoalOn(
      fixture,
      baseContract({ CRITERIA: [proofCriterion()], PLANNER: { enabled: true } }),
      {
        ...fake.deps,
        invokePlannerOpencode: () => ({
          exitCode: null,
          signal: null,
          timedOut: true,
          startErrorCode: null,
          stdout: '',
          stderr: '',
        }),
      },
    );

    assert.equal(result.status, BLOCKED_EXTERNAL);
    assert.equal(result.planner.lastStatus, 'INVOCATION_FAILED');
    assert.equal(result.planner.lastWorkspaceCleanup, 'REMOVED');
    assert.equal(childCallCount(fake), 0);
    assert.deepEqual(listPlannerWorkspaceDirs(), plannerDirsBefore);
  } finally {
    removeFixture(fixture);
  }
});

test('PLANNER N — the same criterion fingerprint never plans twice', () => {
  const fixture = buildFixture();
  try {
    const planner = createFakePlanner({ proposals: plannerTaskProposal() });
    const fake = createFakeChildren({
      runPublishBehavior: () => ({ status: 'EXECUTOR_FAILED', reason: 'simulated failure' }),
    });
    const result = runGoalOn(
      fixture,
      baseContract({ CRITERIA: [proofCriterion()], PLANNER: { enabled: true } }),
      { ...fake.deps, ...planner.deps },
    );

    assert.equal(result.status, NO_PROGRESS);
    assert.equal(result.planner.calls, 1);
    assert.equal(planner.calls.length, 1);
    assert.equal(fake.calls.runPublishOnce.length, 1);
  } finally {
    removeFixture(fixture);
  }
});

test('PLANNER O — a real criterion change enables a second planner call on the new fingerprint', () => {
  const fixture = buildFixture();
  try {
    const planner = createFakePlanner({
      proposals: (index) =>
        index === 0
          ? plannerTaskProposal({ id: 'P1', closes: ['C1'] })
          : plannerTaskProposal({ id: 'P2', closes: ['C2'] }),
    });
    const fake = createFakeChildren({
      runPublishBehavior: (options, callNumber) => {
        pushCommitToLiveMain(fixture, {
          path: callNumber === 1 ? 'docs/one.md' : 'docs/two.md',
          content: '# done\n',
        });
        return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication' };
      },
    });
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [
          proofCriterion({ id: 'C1', command: 'node proof-one.cjs' }),
          proofCriterion({ id: 'C2', command: 'node proof-two.cjs' }),
        ],
        PLANNER: { enabled: true },
        BUDGET: { max_iterations: 4, max_tasks: 4 },
      }),
      { ...fake.deps, ...planner.deps },
    );

    assert.equal(result.status, GOAL_SATISFIED);
    assert.equal(result.planner.calls, 2);
    assert.deepEqual(result.planner.decisions, ['TASK', 'TASK']);
    assert.equal(planner.calls.length, 2);
    assert.deepEqual(
      result.attempts.map((attempt) => attempt.taskId),
      ['P1', 'P2'],
    );
    assert.deepEqual(fake.calls.runPublishOnce.map((options) => options.proofCommands), [
      ['node proof-one.cjs'],
      ['node proof-two.cjs'],
    ]);
  } finally {
    removeFixture(fixture);
  }
});

test('PLANNER P — a foreign dirty shared checkout is preserved exactly across a planner call', () => {
  const fixture = buildFixture();
  const plannerDirsBefore = listPlannerWorkspaceDirs();
  try {
    writeFileSync(join(fixture.root, 'src', 'base.txt'), 'foreign tracked modification\n');
    writeFileSync(join(fixture.root, 'foreign-untracked.txt'), 'foreign untracked\n');
    const statusBefore = gitRaw(fixture.root, ['status', '--porcelain=v1']);
    const headBefore = git(fixture.root, ['rev-parse', 'HEAD']);
    const branchBefore = git(fixture.root, ['branch', '--show-current']);

    const planner = createFakePlanner({
      proposals: { decision: 'NO_TASK', reason: 'no safe task' },
    });
    const fake = createFakeChildren();
    const result = runGoalOn(
      fixture,
      baseContract({ CRITERIA: [proofCriterion()], PLANNER: { enabled: true } }),
      { ...fake.deps, ...planner.deps },
    );

    assert.equal(result.status, NO_TASK_FOR_GAP);
    assert.equal(result.planner.calls, 1);
    assert.equal(result.canonicalCheckout.unchanged, true);
    assert.equal(gitRaw(fixture.root, ['status', '--porcelain=v1']), statusBefore);
    assert.equal(git(fixture.root, ['rev-parse', 'HEAD']), headBefore);
    assert.equal(git(fixture.root, ['branch', '--show-current']), branchBefore);
    assert.equal(
      readFileSync(join(fixture.root, 'src', 'base.txt'), 'utf8'),
      'foreign tracked modification\n',
    );
    assert.equal(
      readFileSync(join(fixture.root, 'foreign-untracked.txt'), 'utf8'),
      'foreign untracked\n',
    );
    assert.deepEqual(listPlannerWorkspaceDirs(), plannerDirsBefore);
  } finally {
    removeFixture(fixture);
  }
});

test('PLANNER Q — the planner child environment excludes publication and provider credentials', () => {
  const fixture = buildFixture();
  try {
    const captured = [];
    const fake = createFakeChildren();
    const result = runGoalOn(
      fixture,
      baseContract({ CRITERIA: [proofCriterion()], PLANNER: { enabled: true } }),
      {
        ...fake.deps,
        invokePlannerOpencode: (input) => {
          captured.push(input.env);
          return plannerSuccess(
            plannerStdout({ decision: 'NO_TASK', reason: 'environment probe' }),
          );
        },
        env: {
          ...process.env,
          GH_TOKEN: 'gh-token',
          GITHUB_TOKEN: 'github-token',
          VERCEL_TOKEN: 'vercel-token',
          RAILWAY_TOKEN: 'railway-token',
          FIREBASE_TOKEN: 'firebase-token',
          GCLOUD_PROJECT: 'gcloud-project',
          GOOGLE_APPLICATION_CREDENTIALS: 'gac.json',
          ALIGO_API_KEY: 'aligo-key',
          PORTONE_API_SECRET: 'portone-secret',
          TOSS_SECRET_KEY: 'toss-key',
          AWS_SECRET_ACCESS_KEY: 'aws-key',
          AZURE_CLIENT_SECRET: 'azure-key',
          MY_SECRET: 'secret-value',
          MY_PASSWORD: 'password-value',
          GH_SAFE_MARKER: 'safe-value',
          SAFE_MARKER: 'present',
        },
      },
    );

    assert.equal(result.status, NO_TASK_FOR_GAP);
    assert.equal(captured.length, 1);
    const childEnv = captured[0];
    for (const denied of [
      'GH_TOKEN',
      'GITHUB_TOKEN',
      'VERCEL_TOKEN',
      'RAILWAY_TOKEN',
      'FIREBASE_TOKEN',
      'GCLOUD_PROJECT',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'ALIGO_API_KEY',
      'PORTONE_API_SECRET',
      'TOSS_SECRET_KEY',
      'AWS_SECRET_ACCESS_KEY',
      'AZURE_CLIENT_SECRET',
      'MY_SECRET',
      'MY_PASSWORD',
      'GH_SAFE_MARKER',
    ]) {
      assert.equal(denied in childEnv, false, `${denied} must not reach the planner child`);
    }
    assert.equal(childEnv.SAFE_MARKER, 'present');
    assert.equal(childEnv.GIT_TERMINAL_PROMPT, '0');
    assert.ok(childEnv.GH_CONFIG_DIR.length > 0);
  } finally {
    removeFixture(fixture);
  }
});

test('PLANNER R — ambiguous planner output fails closed before any executor call', () => {
  const fixture = buildFixture();
  try {
    const rawStdouts = [
      '```json\n' + JSON.stringify({ decision: 'NO_TASK', reason: 'fenced' }) + '\n```',
      JSON.stringify({ decision: 'NO_TASK', reason: 'one' }) +
        '\n' +
        JSON.stringify({ decision: 'NO_TASK', reason: 'two' }),
      'plain narration line\n' + plannerStdout({ decision: 'NO_TASK', reason: 'mixed' }),
      plannerStdout({ decision: 'NO_TASK', reason: 'no trailing payload' }) + 'trailing text',
    ];
    let call = 0;
    for (const stdout of rawStdouts) {
      const fake = createFakeChildren();
      const result = runGoalOn(
        fixture,
        baseContract({ CRITERIA: [proofCriterion()], PLANNER: { enabled: true } }),
        {
          ...fake.deps,
          invokePlannerOpencode: () => ({
            exitCode: 0,
            signal: null,
            timedOut: false,
            startErrorCode: null,
            stdout,
            stderr: '',
          }),
        },
      );
      call += 1;
      assert.equal(result.status, BLOCKED_EXTERNAL, `case ${call}`);
      assert.equal(result.planner.lastStatus, 'INVALID_OUTPUT', `case ${call}`);
      assert.equal(childCallCount(fake), 0, `case ${call}`);
    }
  } finally {
    removeFixture(fixture);
  }
});

test('PLANNER PROMPT — bounded context and a strict output contract reach the planner', () => {
  const parsed = validateGoalContract(
    baseContract({
      GOAL: 'make the declared feature verifiable',
      CRITERIA: [proofCriterion()],
      ESCALATE_IF: ['PRODUCT_POLICY_FORK'],
    }),
  );
  assert.equal(parsed.ok, true);
  const prompt = buildPlannerPrompt({
    contract: parsed.contract,
    pin: { fetchedSha: 'a'.repeat(40) },
    criteria: [
      {
        id: 'C1',
        statement: 'the feature proof passes at live main',
        class: 'AUTONOMOUS',
        check: 'PROOF_AT_MAIN',
        authority: ['docs/authority.md'],
        satisfied: false,
        evaluationError: false,
        reason: 'proof command did not pass at live main',
      },
    ],
  });

  assert.match(prompt, /read-only planner/);
  assert.match(prompt, /## GOAL\nmake the declared feature verifiable/);
  assert.match(prompt, new RegExp(`## Current live main\\n${'a'.repeat(40)}`));
  assert.match(prompt, /## ACCEPTANCE_AUTHORITY\n- docs\/authority\.md/);
  assert.match(prompt, /## PRESERVE \(must not change\)\n- src/);
  assert.match(prompt, /## AUTONOMOUSLY_ALLOWED\n- docs\n- src/);
  assert.match(prompt, /- PRODUCT_POLICY_FORK/);
  assert.match(prompt, /- id: C1/);
  assert.match(prompt, /statement: the feature proof passes at live main/);
  assert.match(prompt, /check: PROOF_AT_MAIN/);
  assert.match(prompt, /current evaluation: proof command did not pass at live main/);
  assert.match(prompt, /Return exactly one JSON object and nothing else/);
  assert.match(prompt, /"decision":"TASK"/);
  assert.match(prompt, /"decision":"NO_TASK"/);
  assert.match(prompt, /"decision":"ESCALATE"/);
  assert.equal(prompt.includes('TASK_CATALOG'), false);
});

test('PLANNER OUTCOME CONTRACT A — the actual invocation prompt advertises the authoritative outcome limit', () => {
  const fixture = buildFixture();
  try {
    const planner = createFakePlanner({
      proposals: { decision: 'NO_TASK', reason: 'contract visibility probe' },
    });
    const fake = createFakeChildren();
    const result = runGoalOn(
      fixture,
      baseContract({ CRITERIA: [proofCriterion()], PLANNER: { enabled: true } }),
      { ...fake.deps, ...planner.deps },
    );

    assert.equal(result.status, NO_TASK_FOR_GAP);
    assert.equal(planner.calls.length, 1);
    const invokedArgs = planner.calls[0].args;
    const prompt = invokedArgs[invokedArgs.length - 1];
    assert.ok(
      prompt.includes(
        `- "outcome" must be a non-empty string of at most ${PLANNER_OUTCOME_MAX_CHARS} characters.`,
      ),
      'the planner invocation prompt must state the authoritative outcome limit',
    );
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

test('PLANNER OUTCOME CONTRACT B — an outcome within the advertised limit is accepted and reaches the executor', () => {
  const fixture = buildFixture();
  try {
    const outcome = plannerOutcomeOfLength(PLANNER_OUTCOME_MAX_CHARS - 20);
    const planner = createFakePlanner({ proposals: plannerTaskProposal({ outcome }) });
    const fake = createFakeChildren({
      runPublishBehavior: () => {
        pushCommitToLiveMain(fixture, { path: 'docs/feature.md', content: '# feature\n' });
        return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication' };
      },
    });
    const result = runGoalOn(
      fixture,
      baseContract({ CRITERIA: [proofCriterion()], PLANNER: { enabled: true } }),
      { ...fake.deps, ...planner.deps },
    );

    assert.equal(result.status, GOAL_SATISFIED);
    assert.equal(result.planner.lastStatus, 'TASK');
    assert.equal(fake.calls.runPublishOnce.length, 1);
    assert.ok(fake.calls.runPublishOnce[0].taskText.includes(outcome));
  } finally {
    removeFixture(fixture);
  }
});

test('PLANNER OUTCOME CONTRACT C — an outcome over the advertised limit stays INVALID_OUTPUT', () => {
  const fixture = buildFixture();
  try {
    const outcome = plannerOutcomeOfLength(PLANNER_OUTCOME_MAX_CHARS + 1);
    const planner = createFakePlanner({ proposals: plannerTaskProposal({ outcome }) });
    const fake = createFakeChildren();
    const result = runGoalOn(
      fixture,
      baseContract({ CRITERIA: [proofCriterion()], PLANNER: { enabled: true } }),
      { ...fake.deps, ...planner.deps },
    );

    assert.equal(result.status, BLOCKED_EXTERNAL);
    assert.equal(result.planner.lastStatus, 'INVALID_OUTPUT');
    assert.match(
      result.planner.lastReason,
      new RegExp(`at most ${PLANNER_OUTCOME_MAX_CHARS} characters`),
    );
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

test('PLANNER OUTCOME CONTRACT D — a GA-02C-class boundary outcome is not blocked before task construction', () => {
  const fixture = buildFixture();
  try {
    const outcome = plannerOutcomeOfLength(PLANNER_OUTCOME_MAX_CHARS);
    const planner = createFakePlanner({ proposals: plannerTaskProposal({ outcome }) });
    const fake = createFakeChildren({
      runPublishBehavior: () => {
        pushCommitToLiveMain(fixture, { path: 'docs/feature.md', content: '# feature\n' });
        return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication' };
      },
    });
    const result = runGoalOn(
      fixture,
      baseContract({ CRITERIA: [proofCriterion()], PLANNER: { enabled: true } }),
      { ...fake.deps, ...planner.deps },
    );

    assert.equal(outcome.length, PLANNER_OUTCOME_MAX_CHARS);
    assert.equal(result.planner.lastStatus, 'TASK');
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].taskId, 'P1');
    assert.equal(result.attempts[0].publication, 'required');
    assert.equal(fake.calls.runPublishOnce.length, 1);
    const taskText = fake.calls.runPublishOnce[0].taskText;
    assert.ok(taskText.includes(outcome), 'the accepted outcome must reach the executor untruncated');
  } finally {
    removeFixture(fixture);
  }
});

test('GA-03 A — five pairwise-independent tasks are admitted into one batch', () => {
  const fixture = buildFixture();
  try {
    const paths = [1, 2, 3, 4, 5].map((index) => `docs/ga03/p${index}.md`);
    const fake = createFakeChildren({
      runOnceBehavior: (options) => ({
        status: 'SUCCESS',
        reason: 'fake execution',
        changedPaths: [...options.allowedPaths],
      }),
    });
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: paths.map((path, index) => pathCriterion({ id: `C${index + 1}`, path })),
        TASK_CATALOG: paths.map((path, index) =>
          batchTask({ id: `T${index + 1}`, path, criterionId: `C${index + 1}` }),
        ),
        BUDGET: { max_iterations: 3, max_tasks: 5, max_wall_clock_ms: 60000 },
      }),
      fake.deps,
    );

    assert.equal(result.status, NO_PROGRESS);
    assert.equal(result.batches.length, 1);
    assert.deepEqual(result.batches[0].taskIds, ['T1', 'T2', 'T3', 'T4', 'T5']);
    assert.deepEqual(result.batches[0].excluded, []);
    assert.equal(result.batches[0].concurrencyLimit, MAX_BATCH_CONCURRENCY);
    assert.equal(result.maxBatchConcurrency, MAX_BATCH_CONCURRENCY);
    assert.equal(fake.calls.runOnce.length, 5);
    assert.equal(result.childCalls, 5);
    const titles = fake.calls.runOnce.map((options) => options.title);
    assert.equal(new Set(titles).size, 5, 'each concurrent task needs a distinct session title');
    assert.ok(titles.every((title) => typeof title === 'string' && title.length > 0));
  } finally {
    removeFixture(fixture);
  }
});

test('GA-03 B — admitted children actually overlap in real processes', () => {
  const fixture = buildFixture();
  const runOnceDirsBefore = listRunOnceWorkspaceDirs();
  const batchDirsBefore = listBatchWorkspaceDirs();
  const fakeOpencode = createFakeOpencodeBin({ expected: MAX_BATCH_CONCURRENCY });
  try {
    const descriptors = [1, 2, 3, 4, 5].map((index) => ({
      taskId: `B${index}`,
      title: `ga03-proof [B${index}]`,
      closes: [],
      invocation: {
        runner: 'runOnce',
        options: {
          repositoryRoot: fixture.root,
          remote: 'origin',
          taskText: `OUTCOME:\nCreate docs/ga03/p${index}.md inside the allowed boundary.`,
          allowedPaths: [`docs/ga03/p${index}.md`],
          proofCommands: [],
          proofOwners: [],
          title: `ga03-proof [B${index}]`,
          model: null,
          agent: null,
          opencodeBin: fakeOpencode.opencodeBin,
          opencodeTimeoutMs: 120000,
          proofTimeoutMs: 60000,
        },
      },
    }));
    const results = runTaskBatch({
      descriptors,
      maxConcurrency: MAX_BATCH_CONCURRENCY,
      env: fakeOpencode.env,
      log: () => {},
    });

    assert.equal(results.length, 5);
    for (const entry of results) {
      assert.equal(entry.child.status, 'ALREADY_SATISFIED', `${entry.taskId}: ${entry.child.reason}`);
      assert.ok(Number.isFinite(entry.startedAt) && Number.isFinite(entry.endedAt));
    }
    const starts = fakeOpencode.readEvents('start-');
    const ends = fakeOpencode.readEvents('end-');
    assert.equal(starts.length, 5);
    assert.equal(ends.length, 5);
    assert.equal(new Set(starts.map((entry) => entry.title)).size, 5);
    // The filesystem barrier means every child observed all five starts before
    // any child ended; overlap is structural, not an after-the-fact recording.
    assert.ok(
      Math.max(...starts.map((entry) => entry.startedAt)) <=
        Math.min(...ends.map((entry) => entry.endedAt)),
      'all five child processes must be inside the barrier together',
    );
    const maxStart = Math.max(...results.map((entry) => entry.startedAt));
    const minEnd = Math.min(...results.map((entry) => entry.endedAt));
    assert.ok(maxStart < minEnd, 'worker execution intervals must overlap');
    assert.deepEqual(listRunOnceWorkspaceDirs(), runOnceDirsBefore);
    assert.deepEqual(listBatchWorkspaceDirs(), batchDirsBefore);
  } finally {
    fakeOpencode.remove();
    removeFixture(fixture);
  }
});

test('GA-03 C — overlapping semantic_owner tasks serialize across batches', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeChildren({
      runPublishBehavior: (options, callNumber) => {
        pushCommitToLiveMain(fixture, {
          path: callNumber === 1 ? 'docs/one.md' : 'docs/two.md',
          content: '# done\n',
          message: `publication ${callNumber}`,
        });
        return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication' };
      },
    });
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [
          pathCriterion({ id: 'C1', path: 'docs/one.md' }),
          pathCriterion({ id: 'C2', path: 'docs/two.md' }),
        ],
        TASK_CATALOG: [
          publicationTask({
            id: 'T1',
            closes: ['C1'],
            allow: ['docs/one.md'],
            semantic_owner: ['docs/shared'],
            proof: [],
            proof_owner: [],
          }),
          publicationTask({
            id: 'T2',
            closes: ['C2'],
            allow: ['docs/two.md'],
            semantic_owner: ['docs/shared'],
            proof: [],
            proof_owner: [],
          }),
        ],
        BUDGET: { max_iterations: 4, max_tasks: 4, max_wall_clock_ms: 60000 },
      }),
      fake.deps,
    );

    assert.equal(result.status, GOAL_SATISFIED);
    assert.deepEqual(
      result.batches.map((batch) => batch.taskIds),
      [['T1'], ['T2']],
    );
    assert.equal(result.batches[0].excluded.length, 1);
    assert.deepEqual(
      {
        taskId: result.batches[0].excluded[0].taskId,
        kind: result.batches[0].excluded[0].kind,
        withTaskId: result.batches[0].excluded[0].withTaskId,
      },
      { taskId: 'T2', kind: 'SEMANTIC_OWNER', withTaskId: 'T1' },
    );
    assert.equal(fake.calls.runPublishOnce.length, 2);
  } finally {
    removeFixture(fixture);
  }
});

test('GA-03 D — overlapping declared allow surfaces serialize', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeChildren({
      runPublishBehavior: (options, callNumber) => {
        pushCommitToLiveMain(fixture, {
          path: callNumber === 1 ? 'docs/one.md' : 'docs/two.md',
          content: '# done\n',
          message: `publication ${callNumber}`,
        });
        return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication' };
      },
    });
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [
          pathCriterion({ id: 'C1', path: 'docs/one.md' }),
          pathCriterion({ id: 'C2', path: 'docs/two.md' }),
        ],
        TASK_CATALOG: [
          publicationTask({
            id: 'T1',
            closes: ['C1'],
            allow: ['docs/a'],
            semantic_owner: [],
            proof: [],
            proof_owner: [],
          }),
          publicationTask({
            id: 'T2',
            closes: ['C2'],
            allow: ['docs/a/nested'],
            semantic_owner: [],
            proof: [],
            proof_owner: [],
          }),
        ],
        BUDGET: { max_iterations: 4, max_tasks: 4, max_wall_clock_ms: 60000 },
      }),
      fake.deps,
    );

    assert.equal(result.status, GOAL_SATISFIED);
    assert.deepEqual(
      result.batches.map((batch) => batch.taskIds),
      [['T1'], ['T2']],
    );
    assert.equal(result.batches[0].excluded[0].kind, 'ALLOW_SURFACE');
    assert.equal(result.batches[0].excluded[0].withTaskId, 'T1');
  } finally {
    removeFixture(fixture);
  }
});

test('GA-03 C2 — a proof_owner against a sibling mutation surface serializes', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeChildren({
      runPublishBehavior: (options, callNumber) => {
        pushCommitToLiveMain(fixture, {
          path: callNumber === 1 ? 'docs/one.md' : 'docs/two.md',
          content: '# done\n',
          message: `publication ${callNumber}`,
        });
        return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication' };
      },
    });
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [
          pathCriterion({ id: 'C1', path: 'docs/one.md' }),
          pathCriterion({ id: 'C2', path: 'docs/two.md' }),
        ],
        TASK_CATALOG: [
          publicationTask({
            id: 'T1',
            closes: ['C1'],
            allow: ['docs/one.md'],
            semantic_owner: [],
            proof: ['node proof-ok.cjs'],
            proof_owner: [['docs/two.md']],
          }),
          publicationTask({
            id: 'T2',
            closes: ['C2'],
            allow: ['docs/two.md'],
            semantic_owner: [],
            proof: [],
            proof_owner: [],
          }),
        ],
        BUDGET: { max_iterations: 4, max_tasks: 4, max_wall_clock_ms: 60000 },
      }),
      fake.deps,
    );

    assert.equal(result.status, GOAL_SATISFIED);
    assert.deepEqual(
      result.batches.map((batch) => batch.taskIds),
      [['T1'], ['T2']],
    );
    assert.equal(result.batches[0].excluded[0].kind, 'PROOF_OWNER');
    assert.equal(result.batches[0].excluded[0].withTaskId, 'T1');
  } finally {
    removeFixture(fixture);
  }
});

test('GA-03 E — depends_on tasks serialize in dependency order', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeChildren({
      runPublishBehavior: (options, callNumber) => {
        pushCommitToLiveMain(fixture, {
          path: callNumber === 1 ? 'docs/one.md' : 'docs/two.md',
          content: '# done\n',
          message: `publication ${callNumber}`,
        });
        return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication' };
      },
    });
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [
          pathCriterion({ id: 'C1', path: 'docs/one.md' }),
          pathCriterion({ id: 'C2', path: 'docs/two.md' }),
        ],
        TASK_CATALOG: [
          publicationTask({ id: 'T2', closes: ['C2'], depends_on: ['T1'] }),
          publicationTask({ id: 'T1', closes: ['C1'] }),
        ],
        BUDGET: { max_iterations: 4, max_tasks: 4, max_wall_clock_ms: 60000 },
      }),
      fake.deps,
    );

    assert.equal(result.status, GOAL_SATISFIED);
    assert.deepEqual(
      result.batches.map((batch) => batch.taskIds),
      [['T1'], ['T2']],
    );
    assert.deepEqual(
      result.attempts.map((attempt) => attempt.taskId),
      ['T1', 'T2'],
    );
    assert.equal(fake.calls.runPublishOnce.length, 2);
  } finally {
    removeFixture(fixture);
  }
});

test('GA-03 F — one sibling failure does not cancel the other four tasks', () => {
  const fixture = buildFixture();
  try {
    const paths = [1, 2, 3, 4, 5].map((index) => `docs/ga03/p${index}.md`);
    const fake = createFakeChildren({
      runOnceBehavior: (options) =>
        options.allowedPaths[0].includes('/p3.')
          ? { status: 'EXECUTOR_FAILED', reason: 'simulated sibling failure' }
          : { status: 'SUCCESS', reason: 'fake execution', changedPaths: [...options.allowedPaths] },
    });
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: paths.map((path, index) => pathCriterion({ id: `C${index + 1}`, path })),
        TASK_CATALOG: paths.map((path, index) =>
          batchTask({ id: `T${index + 1}`, path, criterionId: `C${index + 1}` }),
        ),
        BUDGET: { max_iterations: 3, max_tasks: 5, max_wall_clock_ms: 60000 },
      }),
      fake.deps,
    );

    assert.equal(result.batches.length, 1);
    assert.equal(result.batches[0].taskIds.length, 5);
    assert.equal(result.childCalls, 5);
    assert.equal(fake.calls.runOnce.length, 5);
    assert.equal(
      result.attempts.filter((attempt) => attempt.succeeded).length,
      4,
      'the four independent siblings must complete',
    );
    assert.equal(result.attempts.find((attempt) => attempt.taskId === 'T3').succeeded, false);
    assert.equal(result.attempts.find((attempt) => attempt.taskId === 'T4').succeeded, true);
    assert.equal(result.attempts.find((attempt) => attempt.taskId === 'T5').succeeded, true);
    assert.equal(result.status, NO_PROGRESS);
  } finally {
    removeFixture(fixture);
  }
});

test('GA-03 G — batch completion causes one authoritative recomputation from fresh live main', () => {
  const fixture = buildFixture();
  try {
    let readCalls = 0;
    let fetchCalls = 0;
    let proofRuns = 0;
    const fake = createFakeChildren({
      runOnceBehavior: (options) => {
        const index = options.allowedPaths[0].match(/p(\d)\.md/)[1];
        pushCommitToLiveMain(fixture, {
          path: `docs/ga03/p${index}.md`,
          content: `# p${index}\n`,
          message: `publish p${index}`,
        });
        return { status: 'SUCCESS', reason: 'fake execution', changedPaths: [...options.allowedPaths] };
      },
    });
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [1, 2, 3, 4, 5].map((index) =>
          proofCriterion({ id: `C${index}`, command: `node proof-ga03-${index}.cjs` }),
        ),
        TASK_CATALOG: [1, 2, 3, 4, 5].map((index) =>
          batchTask({ id: `T${index}`, path: `docs/ga03/p${index}.md`, criterionId: `C${index}` }),
        ),
        BUDGET: { max_iterations: 3, max_tasks: 5, max_wall_clock_ms: 120000 },
      }),
      {
        ...fake.deps,
        readLiveMain: (input) => {
          readCalls += 1;
          return readLiveRemoteMain(input);
        },
        fetchLiveMain: (input) => {
          fetchCalls += 1;
          return fetchBaseline(input);
        },
        runProofCommand: (input) => {
          proofRuns += 1;
          return defaultRunProofCommand(input);
        },
      },
    );

    assert.equal(result.status, GOAL_SATISFIED);
    assert.equal(result.childCalls, 5);
    assert.equal(result.batches.length, 1);
    assert.equal(readCalls, 2, 'one start observation and one post-batch observation');
    assert.equal(fetchCalls, 2, 'one start fetch and one post-batch fetch');
    assert.equal(proofRuns, 10, 'five proofs before and five after the single recomputation');
    assert.equal(result.criteria.every((criterion) => criterion.satisfied), true);
  } finally {
    removeFixture(fixture);
  }
});

test('GA-03 H — sibling-caused live-main movement does not reinvoke executed tasks', () => {
  const fixture = buildFixture();
  try {
    let readCalls = 0;
    const fake = createFakeChildren({
      runPublishBehavior: (options, callNumber) => {
        pushCommitToLiveMain(fixture, {
          path: callNumber === 1 ? 'docs/one.md' : 'docs/two.md',
          content: '# done\n',
          message: `sibling publication ${callNumber}`,
        });
        return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication with existing rebind semantics' };
      },
    });
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [
          pathCriterion({ id: 'C1', path: 'docs/one.md' }),
          pathCriterion({ id: 'C2', path: 'docs/two.md' }),
        ],
        TASK_CATALOG: [
          publicationTask({ id: 'T1', closes: ['C1'], allow: ['docs/one.md'], semantic_owner: ['docs/one.md'], proof: [], proof_owner: [] }),
          publicationTask({ id: 'T2', closes: ['C2'], allow: ['docs/two.md'], semantic_owner: ['docs/two.md'], proof: [], proof_owner: [] }),
        ],
        BUDGET: { max_iterations: 4, max_tasks: 4, max_wall_clock_ms: 60000 },
      }),
      {
        ...fake.deps,
        readLiveMain: (input) => {
          readCalls += 1;
          return readLiveRemoteMain(input);
        },
      },
    );

    assert.equal(result.status, GOAL_SATISFIED);
    assert.equal(result.liveMain.movement, 'MOVED');
    assert.equal(fake.calls.runPublishOnce.length, 2, 'no task may be reinvoked after sibling movement');
    assert.deepEqual(
      result.attempts.map((attempt) => attempt.taskId),
      ['T1', 'T2'],
    );
    assert.equal(readCalls, 2, 'the sibling movement triggers exactly one recomputation');
  } finally {
    removeFixture(fixture);
  }
});

test('GA-03 I — the batch never exceeds the fixed concurrency maximum', () => {
  const fixture = buildFixture();
  try {
    const indexes = [1, 2, 3, 4, 5, 6];
    const fake = createFakeChildren({
      runOnceBehavior: (options) => {
        const index = options.allowedPaths[0].match(/p(\d)\.md/)[1];
        pushCommitToLiveMain(fixture, {
          path: `docs/ga03/p${index}.md`,
          content: `# p${index}\n`,
          message: `publish p${index}`,
        });
        return { status: 'SUCCESS', reason: 'fake execution', changedPaths: [...options.allowedPaths] };
      },
    });
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: indexes.map((index) => pathCriterion({ id: `C${index}`, path: `docs/ga03/p${index}.md` })),
        TASK_CATALOG: indexes.map((index) =>
          batchTask({ id: `T${index}`, path: `docs/ga03/p${index}.md`, criterionId: `C${index}` }),
        ),
        BUDGET: { max_iterations: 4, max_tasks: 6, max_wall_clock_ms: 60000 },
      }),
      fake.deps,
    );

    assert.equal(result.status, GOAL_SATISFIED);
    assert.deepEqual(
      result.batches.map((batch) => batch.taskIds),
      [['T1', 'T2', 'T3', 'T4', 'T5'], ['T6']],
    );
    assert.ok(result.batches.every((batch) => batch.taskIds.length <= MAX_BATCH_CONCURRENCY));
    assert.equal(result.batches[0].excluded[0].taskId, 'T6');
    assert.equal(result.batches[0].excluded[0].kind, 'CONCURRENCY_LIMIT');
    assert.equal(fake.calls.runOnce.length, 6, 'the excluded task runs in a later batch');
    assert.throws(
      () =>
        runTaskBatch({
          descriptors: indexes.map((index) => ({ taskId: `X${index}` })),
          maxConcurrency: MAX_BATCH_CONCURRENCY,
        }),
      /exceeds the maximum concurrency/,
    );
  } finally {
    removeFixture(fixture);
  }
});

test('GA-03 J — a single eligible task keeps the existing serial behavior', () => {
  const fixture = buildFixture();
  try {
    const contract = () =>
      baseContract({
        CRITERIA: [pathCriterion({ id: 'C1', path: 'docs/ga03/p1.md' })],
        TASK_CATALOG: [batchTask({ id: 'T1', path: 'docs/ga03/p1.md', criterionId: 'C1' })],
        BUDGET: { max_iterations: 3, max_tasks: 2, max_wall_clock_ms: 60000 },
      });
    const fake = createFakeChildren({
      runOnceBehavior: () => ({ status: 'SUCCESS', reason: 'fake execution', changedPaths: ['docs/ga03/p1.md'] }),
    });
    const titled = runGoal(
      {
        goalFile: writeGoal(fixture, contract()),
        repositoryRoot: fixture.root,
        remote: 'origin',
        title: 'ga03-serial-title',
      },
      { log: () => {}, ...fake.deps },
    );
    assert.equal(titled.status, NO_PROGRESS);
    assert.equal(titled.batches.length, 1);
    assert.deepEqual(titled.batches[0].taskIds, ['T1']);
    assert.deepEqual(titled.batches[0].titles, ['ga03-serial-title']);
    assert.equal(fake.calls.runOnce[0].title, 'ga03-serial-title');
    assert.equal(titled.childCalls, 1);
    assert.equal(titled.iterations, 1);

    const untitled = runGoal(
      { goalFile: writeGoal(fixture, contract()), repositoryRoot: fixture.root, remote: 'origin' },
      { log: () => {}, ...fake.deps },
    );
    assert.equal(untitled.status, NO_PROGRESS);
    assert.deepEqual(untitled.batches[0].titles, [null]);
    assert.equal(fake.calls.runOnce[1].title, null);
  } finally {
    removeFixture(fixture);
  }
});

test('GA-03 K — a transient pre-invocation baseline failure is retried in-batch', () => {
  const fixture = buildFixture();
  try {
    const baselineFailure = {
      status: 'BASELINE_OBSERVATION_FAILED',
      reason: 'canonical checkout observation failed: simulated transient lock race',
      executor: { invoked: false },
      changedPaths: [],
    };
    let calls = 0;
    const fake = createFakeChildren({
      runOnceBehavior: () => {
        calls += 1;
        if (calls === 1) return baselineFailure;
        return { status: 'SUCCESS', reason: 'fake execution', changedPaths: ['docs/ga03/p1.md'] };
      },
    });
    const result = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [pathCriterion({ id: 'C1', path: 'docs/ga03/p1.md' })],
        TASK_CATALOG: [batchTask({ id: 'T1', path: 'docs/ga03/p1.md', criterionId: 'C1' })],
        BUDGET: { max_iterations: 3, max_tasks: 2, max_wall_clock_ms: 60000 },
      }),
      fake.deps,
    );

    assert.equal(result.status, NO_PROGRESS);
    assert.equal(fake.calls.runOnce.length, 2, 'the transient failure must be retried once');
    assert.equal(result.attempts.length, 1, 'one admitted task still produces one attempt record');
    assert.equal(result.attempts[0].childStatus, 'SUCCESS');
    assert.equal(result.batches[0].results[0].attempts, 2);
    assert.equal(result.batches[0].results[0].retryReasons.length, 1);

    const postInvocationFailure = {
      status: 'BASELINE_OBSERVATION_FAILED',
      reason: 'mutation boundary observation failed',
      executor: { invoked: true },
      changedPaths: ['docs/ga03/p2.md'],
    };
    let secondCalls = 0;
    const fake2 = createFakeChildren({
      runOnceBehavior: () => {
        secondCalls += 1;
        return postInvocationFailure;
      },
    });
    const second = runGoalOn(
      fixture,
      baseContract({
        CRITERIA: [pathCriterion({ id: 'C2', path: 'docs/ga03/p2.md' })],
        TASK_CATALOG: [batchTask({ id: 'T2', path: 'docs/ga03/p2.md', criterionId: 'C2' })],
        BUDGET: { max_iterations: 3, max_tasks: 2, max_wall_clock_ms: 60000 },
      }),
      fake2.deps,
    );
    assert.equal(secondCalls, 1, 'a failure after invocation must not be retried');
    assert.equal(second.attempts[0].succeeded, false);

    assert.equal(isRetryableStartFailure(baselineFailure), true);
    assert.equal(isRetryableStartFailure(postInvocationFailure), false);
    assert.equal(
      isRetryableStartFailure({
        status: 'EXECUTOR_FAILED',
        executor: { invoked: false },
        changedPaths: [],
      }),
      false,
    );
  } finally {
    removeFixture(fixture);
  }
});

// ---------------------------------------------------------------------------
// L. temporary fixture lifetime ownership
// ---------------------------------------------------------------------------

test('CASE L1 — a fixture lifetime removes exactly its own temp dirs', () => {
  const fixture = buildFixture();
  try {
    assert.ok(existsSync(fixture.root));
    assert.ok(existsSync(fixture.bare));
    assert.ok(existsSync(fixture.goalDir));
  } finally {
    removeFixture(fixture);
  }
  assert.equal(existsSync(fixture.root), false);
  assert.equal(existsSync(fixture.bare), false);
  assert.equal(existsSync(fixture.goalDir), false);
});

test('CASE L2 — the assertion-failure path removes the fixture', () => {
  let fixture = null;
  assert.throws(() => {
    fixture = buildFixture();
    try {
      assert.fail('synthetic assertion failure');
    } finally {
      removeFixture(fixture);
    }
  }, /synthetic assertion failure/);
  assert.equal(existsSync(fixture.root), false);
  assert.equal(existsSync(fixture.bare), false);
  assert.equal(existsSync(fixture.goalDir), false);
});

test('CASE L3 — a fixture setup failure does not leak its temp dirs', () => {
  let captured = null;
  try {
    buildFixture({ failAfterInit: true });
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof Error);
  assert.match(captured.message, /injected fixture setup failure/);
  assert.ok(Array.isArray(captured.fixturePaths));
  assert.deepEqual(
    captured.fixturePaths.filter((target) => existsSync(target)),
    [],
  );
  assert.equal(captured.fixtureCleanupErrors, undefined);
});

test('CASE L4 — a fixture cleanup failure is surfaced, not silent', () => {
  const fixture = buildFixture();
  assert.throws(
    () =>
      removeFixture(fixture, {
        rm: (target, options) => {
          if (target === fixture.bare) throw new Error('injected removal failure');
          rmSync(target, options);
        },
      }),
    /fixture cleanup failed: .*injected removal failure/,
  );
  assert.equal(existsSync(fixture.root), false);
  assert.equal(existsSync(fixture.goalDir), false);
  assert.equal(existsSync(fixture.bare), true);
  removeTreeRobust(fixture.bare);
  assert.equal(existsSync(fixture.bare), false);
});

test('CASE W8a — publication success with cleanup failure still closes the product goal', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeChildren({
      runPublishBehavior: () => {
        pushCommitToLiveMain(fixture, {
          path: 'docs/feature.md',
          content: 'delivered\n',
          message: 'docs: deliver the bounded outcome',
        });
        return {
          status: CLEANUP_FAILED,
          reason: 'publication succeeded but task-owned workspace cleanup failed',
          publication: { outcome: 'SUCCESS_PUBLISHED', remoteDeltaVerified: true },
          changedPaths: ['docs/feature.md'],
        };
      },
    });
    const result = runGoalOn(
      fixture,
      baseContract({ CRITERIA: [pathCriterion()], TASK_CATALOG: [publicationTask()] }),
      fake.deps,
    );

    assert.equal(result.status, GOAL_SATISFIED);
    assert.equal(fake.calls.runPublishOnce.length, 1);
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].childStatus, CLEANUP_FAILED);
    assert.equal(result.attempts[0].succeeded, false);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE W8b — a published task is never re-executed for the same invocation', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeChildren({
      runPublishBehavior: () => ({
        status: CLEANUP_FAILED,
        reason: 'publication succeeded but task-owned workspace cleanup failed',
        publication: { outcome: 'SUCCESS_PUBLISHED', remoteDeltaVerified: true },
        changedPaths: ['docs/feature.md'],
      }),
    });
    const result = runGoalOn(
      fixture,
      baseContract({ CRITERIA: [pathCriterion()], TASK_CATALOG: [publicationTask()] }),
      fake.deps,
    );

    assert.equal(result.status, NO_PROGRESS);
    assert.equal(fake.calls.runPublishOnce.length, 1);
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].childStatus, CLEANUP_FAILED);
    assert.ok(
      result.selection.skipped.some(
        (entry) => entry.taskId === 'T1' && /already attempted/.test(entry.reason),
      ),
    );
  } finally {
    removeFixture(fixture);
  }
});
