// Focused deterministic proof for scripts/agent/run-goal.mjs.
//
// Uses temp local git repositories + temp bare remotes and injected child
// seams. No GitHub, no publication mutation, no real OpenCode process, and no
// mutation of the Greenhub checkout.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  BLOCKED_EXTERNAL,
  BUDGET_EXHAUSTED,
  GOAL_SATISFIED,
  HUMAN_DECISION_REQUIRED,
  INVALID_GOAL,
  INVALID_TASK,
  NO_PROGRESS,
  NO_TASK_FOR_GAP,
  buildTaskText,
  parseArgs,
  runGoal,
  validateGoalContract,
} from './run-goal.mjs';

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

/** Canonical checkout + real bare remote, with a clean live `main`. */
function buildFixture() {
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
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'base']);
    const baseSha = git(root, ['rev-parse', 'HEAD']);
    git(root, ['remote', 'add', 'origin', bare]);
    git(root, ['push', '-u', 'origin', 'main']);
    return { root, bare, goalDir, baseSha };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
    rmSync(goalDir, { recursive: true, force: true });
    throw error;
  }
}

function removeFixture(fixture) {
  try {
    git(fixture.root, ['worktree', 'prune']);
  } catch {
    // fixture teardown is best-effort
  }
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.bare, { recursive: true, force: true });
  rmSync(fixture.goalDir, { recursive: true, force: true });
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
    rmSync(clone, { recursive: true, force: true });
  }
}

function listProofWorkspaceDirs() {
  return readdirSync(tmpdir())
    .filter((name) => name.startsWith('greenhub-run-goal-proof-'))
    .sort();
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
  const forbidden = [
    /queue/i,
    /scheduler/i,
    /daemon/i,
    /\bworker/i,
    /registry/i,
    /\blease\b/i,
    /inbox/i,
    /journal/i,
    /\bplanner\b/i,
    /watcher/i,
    /watchdog/i,
    /parallel/i,
    /orphan/i,
    /\block\b/i,
    /adopt/i,
    /persistent/i,
    /\bcache\b/i,
    /control.?tower/i,
    /coordinator/i,
  ];
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(source), `run-goal.mjs must not contain ${pattern}`);
  }
  // The runner forwards existing executor seams but never imports or
  // re-implements admission/rebind/transport mechanics itself.
  assert.ok(!/publication-rebind/.test(source));
  assert.ok(!/from '\.\.\/git\/publication-admission/.test(source));
});

test('parseArgs requires an explicit goal contract', () => {
  assert.equal(parseArgs([]).ok, false);
  assert.equal(parseArgs(['--goal', 'goal.json']).ok, true);
  assert.equal(parseArgs(['--goal', 'goal.json', '--bogus']).ok, false);
  assert.equal(parseArgs(['--goal', 'goal.json', '--max-tasks', '3']).ok, false);
});
