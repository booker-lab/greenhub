// Focused deterministic proof for scripts/agent/run-build.mjs.
//
// Uses temp local git repositories + temp bare remotes and injected selector /
// child seams. No GitHub, no real OpenCode process, no real publication, and no
// mutation of the Greenhub checkout. The same admission/execution/publication
// path is the real run-goal path; only OpenCode and the publication transport
// are replaced by deterministic stand-ins.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  ALREADY_SATISFIED,
  BLOCKED_EXTERNAL,
  BUILD_CRITERION_CHECKS,
  buildFrontierPrompt,
  extractDeclaredAuthorityPaths,
  FRONTIER_COMPLETE,
  HUMAN_DECISION_REQUIRED,
  INVALID_BUILD_REQUEST,
  isHistoricalPath,
  main,
  NO_EXECUTABLE_FRONTIER,
  PROOF_FAILED,
  PUBLICATION_FAILED,
  parseArgs,
  parseBuildRequest,
  runBuild,
  SELECTOR_FIELD_SETS,
  SELECTOR_ID_PATTERN,
  SELECTOR_RECONCILIATIONS,
  SELECTOR_REASON_MAX_CHARS,
  SELECTOR_STATEMENT_MAX_CHARS,
  SELECTOR_TASK_OUTCOME_MAX_CHARS,
} from './run-build.mjs';
import { MAX_BATCH_CONCURRENCY } from './run-goal.mjs';

// ---------------------------------------------------------------------------
// Fixture lifetime ownership (development-authority section 7.1)
// ---------------------------------------------------------------------------
// Every temporary directory this spec creates is owned by the helper that
// created it and is removed on the success, assertion-failure, and exception
// paths. Removal verifies the result instead of assuming it, and a cleanup
// failure is surfaced rather than swallowed. Pre-existing temp residue is never
// wildcard-deleted: only recorded fixture paths are touched.

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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

/** Remove exactly the recorded fixture paths and report anything left behind. */
function cleanupFixturePaths(paths, { removeTree = removeTreeRobust } = {}) {
  const errors = [];
  for (const target of paths) {
    if (target == null) continue;
    try {
      removeTree(target);
    } catch (error) {
      errors.push(`removal failed for ${target}: ${errorMessage(error)}`);
    }
    if (existsSync(target)) errors.push(`fixture path still exists: ${target}`);
  }
  return errors;
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initRepository(directory) {
  git(directory, ['init', '-b', 'main']);
  git(directory, ['config', 'user.email', 'run-build-spec@local']);
  git(directory, ['config', 'user.name', 'run-build-spec']);
  git(directory, ['config', 'commit.gpgsign', 'false']);
}

/** Canonical checkout + real bare remote with a clean live `main`. */
function buildFixture({ gitImpl = git } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'greenhub-run-build-spec-'));
  const bare = mkdtempSync(join(tmpdir(), 'greenhub-run-build-spec-remote-'));
  const requestDir = mkdtempSync(join(tmpdir(), 'greenhub-run-build-spec-requests-'));
  const createdPaths = [root, bare, requestDir];
  try {
    git(bare, ['init', '--bare', '-b', 'main']);
    initRepository(root);
    for (const relative of [
      'AGENTS.md',
      'docs/README.md',
      'docs/memory.md',
      'docs/PROJECT_MAP.md',
      'docs/BACKLOG.md',
      'docs/authority.md',
      'docs/specs/ops/development-authority.md',
      'docs/reports/REPORT_historical.md',
    ]) {
      const absolute = join(root, relative);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, `fixture ${relative}\n`);
    }
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
    writeFileSync(
      join(root, 'proof-three.cjs'),
      "const { existsSync } = require('node:fs');\nprocess.exit(existsSync('docs/three.md') ? 0 : 1);\n",
    );
    git(root, ['add', '-A']);
    gitImpl(root, ['commit', '-m', 'base']);
    const baseSha = git(root, ['rev-parse', 'HEAD']);
    git(root, ['remote', 'add', 'origin', bare]);
    git(root, ['push', '-u', 'origin', 'main']);
    return { root, bare, requestDir, baseSha };
  } catch (error) {
    try {
      git(root, ['worktree', 'prune']);
    } catch {
      // the recorded paths below are the ownership boundary, not the prune
    }
    const cleanupErrors = cleanupFixturePaths(createdPaths);
    if (error instanceof Error) {
      error.fixturePaths = [...createdPaths];
      if (cleanupErrors.length > 0) error.fixtureCleanupErrors = cleanupErrors;
    }
    throw error;
  }
}

function removeFixture(fixture, { removeTree = removeTreeRobust } = {}) {
  try {
    git(fixture.root, ['worktree', 'prune']);
  } catch {
    // prune is best-effort; the recorded paths below are the ownership boundary
  }
  const errors = cleanupFixturePaths([fixture.root, fixture.bare, fixture.requestDir], {
    removeTree,
  });
  if (errors.length > 0) {
    throw new Error(`fixture cleanup failed: ${errors.join('; ')}`);
  }
}

/**
 * Fixture-scoped test body. The helper owns the fixture lifetime, so cleanup
 * runs on the success, assertion-failure, and exception paths. When both the
 * body and cleanup fail, both failures are reported instead of one masking the
 * other.
 */
function withFixture(body) {
  const fixture = buildFixture();
  let bodyError = null;
  try {
    return body(fixture);
  } catch (error) {
    bodyError = error;
    throw error;
  } finally {
    try {
      removeFixture(fixture);
    } catch (cleanupError) {
      if (bodyError === null) throw cleanupError;
      throw new Error(
        `body failed: ${errorMessage(bodyError)}; fixture cleanup also failed: ${errorMessage(cleanupError)}`,
      );
    }
  }
}

/** Simulated publication: pushes a commit to live main via a clone. */
function pushCommitToLiveMain(fixture, { path, content, message = 'live main movement' }) {
  const clone = mkdtempSync(join(tmpdir(), 'greenhub-run-build-clone-'));
  try {
    git(clone, ['clone', '--quiet', fixture.bare, '.']);
    git(clone, ['config', 'user.email', 'run-build-spec@local']);
    git(clone, ['config', 'user.name', 'run-build-spec']);
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

function requestFileFor(fixture, text) {
  const file = join(fixture.requestDir, `request-${Math.random().toString(16).slice(2)}.txt`);
  writeFileSync(file, text, 'utf8');
  return file;
}

function selectorStdout(decision) {
  return `${JSON.stringify({ type: 'text', part: { text: JSON.stringify(decision) } })}\n`;
}

function createFakeSelector({ decision, onInvoke = null }) {
  const calls = [];
  const invoke = (input) => {
    calls.push(input);
    if (onInvoke !== null) onInvoke(input, calls.length);
    return {
      exitCode: 0,
      timedOut: false,
      signal: null,
      startErrorCode: null,
      stdout: selectorStdout(typeof decision === 'function' ? decision(calls.length) : decision),
      stderr: '',
    };
  };
  return { calls, deps: { invokeSelectorOpencode: invoke } };
}

function createFakeChildren({ runOnceBehavior = null, runPublishBehavior = null } = {}) {
  const calls = { runOnce: [], runPublishOnce: [] };
  const runOnce = (options) => {
    calls.runOnce.push(options);
    if (runOnceBehavior !== null) return runOnceBehavior(options, calls.runOnce.length);
    return { status: 'SUCCESS', reason: 'fake success', changedPaths: options.allowedPaths };
  };
  const runPublishOnce = (options) => {
    calls.runPublishOnce.push(options);
    if (runPublishBehavior !== null)
      return runPublishBehavior(options, calls.runPublishOnce.length);
    return {
      status: 'SUCCESS_PUBLISHED',
      reason: 'fake publication',
      changedPaths: options.allowedPaths,
    };
  };
  return { calls, deps: { runOnce, runPublishOnce } };
}

function childCallCount(fake) {
  return fake.calls.runOnce.length + fake.calls.runPublishOnce.length;
}

/**
 * Attribution-safe selector cleanup proof: the workspace directory this
 * invocation handed to OpenCode (and its task-owned temp root) must be gone.
 * A global tempdir listing is not used because a concurrent foreign spec run
 * can create same-prefix directories in the shared OS tempdir.
 */
function assertSelectorWorkspaceRemoved(selector) {
  const dirIndex = selector.calls[0].args.indexOf('--dir');
  assert.ok(dirIndex >= 0, 'selector invocation must carry --dir');
  const workspacePath = selector.calls[0].args[dirIndex + 1];
  assert.equal(existsSync(workspacePath), false, `selector workspace still exists: ${workspacePath}`);
  assert.equal(
    existsSync(dirname(workspacePath)),
    false,
    `selector temp root still exists: ${dirname(workspacePath)}`,
  );
}

function criterion({ id, path, statement = `criterion ${id}`, command = null }) {
  const base = {
    id,
    statement,
    authority: ['docs/authority.md'],
    check: command === null ? 'PATH_PRESENT' : 'PROOF_AT_MAIN',
    class: 'AUTONOMOUS',
  };
  return command === null ? { ...base, path } : { ...base, command };
}

function task({ id, closes, allow, proof, semanticOwner = null }) {
  return {
    id,
    outcome: `Close ${closes.join(', ')} inside the declared boundary.`,
    preserve: 'Unrelated files and runtime behavior.',
    closes,
    allow,
    proof,
    proof_owner: proof.map(() => []),
    semantic_owner: semanticOwner === null ? [...allow] : semanticOwner,
    publication: 'required',
    commit_message: `feat(agent): ${id}`,
    pr_title: `feat(agent): ${id}`,
    escalate_only_if: [],
    depends_on: [],
  };
}

function frontierDecision({
  considered,
  selected,
  batch,
  authorityResolved = ['docs/authority.md', 'docs/BACKLOG.md'],
  reason = 'select the highest-priority open frontier',
}) {
  const reconciled = (Array.isArray(considered) ? considered : []).map((entry) =>
    entry.satisfied === false && entry.reconciliation === undefined
      ? { ...entry, reconciliation: 'IMPLEMENTATION_GAP' }
      : entry,
  );
  return {
    status: 'FRONTIER',
    reason,
    authority_resolved: authorityResolved,
    considered: reconciled,
    selected,
    ...(batch === undefined ? {} : { batch }),
  };
}

/** One open considered frontier entry plus its selected/batch goal payload. */
function independentFrontier({ priority, id, path, proof, taskId = null }) {
  const entry = {
    priority,
    id,
    statement: `${path} is missing at live main.`,
    kind: 'PRODUCT',
    criteria: [criterion({ id: `C${priority}`, path })],
    satisfied: false,
  };
  return {
    entry,
    selected: {
      priority,
      id,
      statement: entry.statement,
      kind: 'PRODUCT',
      why_selected: `independent frontier ${id}`,
      goal: goalFor({
        criteria: entry.criteria,
        tasks: [
          task({
            id: taskId ?? `T${priority}`,
            closes: [`C${priority}`],
            allow: [path],
            proof: [proof],
          }),
        ],
      }),
    },
  };
}

function batchEntryFor(frontier, overrides = {}) {
  return {
    priority: frontier.entry.priority,
    id: frontier.entry.id,
    kind: 'PRODUCT',
    why_selected: `independent frontier ${frontier.entry.id}`,
    goal: frontier.selected.goal,
    ...overrides,
  };
}

function goalFor({ criteria, tasks, accept = ['docs/BACKLOG.md', 'docs/authority.md'] }) {
  return {
    GOAL: 'Close exactly one bounded product frontier at live main.',
    ACCEPTANCE_AUTHORITY: accept,
    PRESERVE: ['docs/authority.md'],
    AUTONOMOUSLY_ALLOWED: ['docs'],
    ESCALATE_IF: ['PRODUCT_POLICY_FORK'],
    STOP_WHEN: ['all declared criteria are satisfied or a finite terminal remains'],
    CRITERIA: criteria,
    TASK_CATALOG: tasks,
    PLANNER: { enabled: false },
    BUDGET: { max_iterations: 2, max_tasks: 4 },
  };
}

const DEFAULT_REQUEST = [
  'MODE: BUILD',
  '',
  'Fresh `origin/main` 기준으로 다음 실행 가능한 product frontier 1개를 자율적으로',
  '선택해 구현·검증·게시·정리까지 완료하고 종료하라.',
  '',
  'authority order: `docs/BACKLOG.md`, `docs/authority.md`',
  'stop: frontier 1개 완료 후 다음 frontier 선택 없이 종료',
].join('\n');

function runBuildOn(
  fixture,
  { request = DEFAULT_REQUEST, decision, children = {}, selectorOptions = {} } = {},
) {
  const selector = createFakeSelector({ decision, ...selectorOptions });
  const fake = createFakeChildren({
    runPublishBehavior: (options) => {
      pushCommitToLiveMain(fixture, { path: options.allowedPaths[0], content: 'deliverable\n' });
      return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication' };
    },
    ...children,
  });
  const result = runBuild(
    { requestText: request, repositoryRoot: fixture.root, remote: 'origin' },
    { log: () => {}, ...selector.deps, ...fake.deps },
  );
  return { result, selector, fake };
}

// ---------------------------------------------------------------------------
// Deterministic request parsing and authority extraction
// ---------------------------------------------------------------------------

test('CASE A0 — MODE gate rejects anything that is not exactly one BUILD request', () => {
  assert.equal(parseBuildRequest('').ok, false);
  assert.equal(parseBuildRequest('MODE: PLAN\n\n- do a thing').ok, false);
  assert.equal(parseBuildRequest('just some prose').ok, false);
  assert.equal(parseBuildRequest('MODE: BUILD\n\n').ok, false);
  const parsed = parseBuildRequest('mode: build\n\nbody text\n');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.mode, 'BUILD');
  assert.equal(parsed.body, 'body text');
});

test('CASE A0b — declared authority is repo-grounded and ignores non-path backticks', () => {
  const tokens = ['origin/main', 'docs/authority.md', 'scripts', 'docs/missing.md', 'run-goal'];
  const paths = extractDeclaredAuthorityPaths({
    tokens,
    topLevelEntries: ['AGENTS.md', 'docs', 'scripts'],
  });
  assert.deepEqual(paths, ['docs/authority.md', 'scripts', 'docs/missing.md']);
  assert.equal(isHistoricalPath('docs/reports/REPORT_x.md'), true);
  assert.equal(isHistoricalPath('docs/plans/PLAN_x.md'), true);
  assert.equal(isHistoricalPath('docs/plans/HANDOFF.md'), true);
  assert.equal(isHistoricalPath('PROMPT_x.md'), true);
  assert.equal(isHistoricalPath('docs/specs/api/orders.md'), false);
  assert.equal(isHistoricalPath('docs/BACKLOG.md'), false);
});

test('CASE A0c — parseArgs requires only an explicit flag surface', () => {
  assert.equal(parseArgs(['--nope']).ok, false);
  assert.equal(parseArgs(['opencode']).ok, false);
  const parsed = parseArgs(['--request', 'req.txt', '--repo', '.', '--ci-timeout-ms', '5']);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.options.requestFile, 'req.txt');
  assert.equal(parsed.options.ciTimeoutMs, 5);
});

test('CASE A0d — the selector prompt states the ACCEPTANCE_AUTHORITY completeness rule', () => {
  const prompt = buildFrontierPrompt({
    buildRequest: 'MODE: BUILD\n\nclose exactly one bounded frontier',
    declaredAuthority: ['docs/authority.md'],
    canonicalAuthority: ['AGENTS.md', 'docs/README.md'],
    pin: { fetchedSha: 'a'.repeat(40) },
  });
  assert.match(
    prompt,
    /ACCEPTANCE_AUTHORITY must include every path the BUILD REQUEST names and every\s+criterion authority path that exists as a blob\s+at live main\./,
  );
});

test('CASE A0e — the selector prompt caps considered frontiers by grouping request priorities', () => {
  const prompt = buildFrontierPrompt({
    buildRequest: 'MODE: BUILD\n\nclose exactly one bounded frontier',
    declaredAuthority: ['docs/authority.md'],
    canonicalAuthority: ['AGENTS.md', 'docs/README.md'],
    pin: { fetchedSha: 'a'.repeat(40) },
  });
  assert.match(prompt, /priority list is a ranking, not one frontier per entry/);
  assert.match(
    prompt,
    /into at most 5 considered frontiers, preserving the same\s+relative order when the request names more than that many priorities/,
  );
  assert.match(prompt, /priorities must be exactly 1\.\.N with no gaps and must not exceed\s+5/);
  assert.match(prompt, /lowest-numbered\s+considered frontier whose criteria are not all satisfied/);
});

// ---------------------------------------------------------------------------
// A. natural-language BUILD request -> validated ephemeral Goal Contract
// ---------------------------------------------------------------------------

test('CASE A — one natural-language request yields one validated ephemeral Goal Contract', () => {
  const fixture = buildFixture();
  try {
    const entry = {
      priority: 1,
      id: 'F1',
      statement: 'docs/feature.md exists at live main.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C1', path: 'docs/feature.md' })],
      satisfied: false,
    };
    const decision = frontierDecision({
      considered: [entry],
      selected: {
        priority: 1,
        id: 'F1',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'only considered open product frontier',
        goal: goalFor({
          criteria: entry.criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1'],
              allow: ['docs/feature.md'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
        }),
      },
    });
    const { result, selector, fake } = runBuildOn(fixture, { decision });

    assert.equal(result.status, FRONTIER_COMPLETE);
    assert.equal(result.nextFrontierSelected, false);
    assert.equal(selector.calls.length, 1);
    assert.equal(result.selector.status, 'DECISION');
    assert.equal(result.selector.workspaceCleanup, 'REMOVED');
    // The generated Goal Contract is validated, ephemeral, and never a file.
    assert.equal(result.goal.frontierId, 'F1');
    assert.equal(result.goal.raw.CRITERIA.length, 1);
    assert.equal(result.goal.contract.task_catalog.length, 1);
    // The existing run-goal loop owns the result shape.
    assert.equal(typeof result.goalResult.iterations, 'number');
    assert.ok(Array.isArray(result.goalResult.batches));
    assert.ok(Array.isArray(result.goalResult.criteria));
    assert.equal(result.goalResult.planner.enabled, false);
    // The existing publication primitive received the bounded task unchanged.
    assert.equal(fake.calls.runPublishOnce.length, 1);
    assert.deepEqual(fake.calls.runPublishOnce[0].proofCommands, ['node proof-feature.cjs']);
    assert.deepEqual(fake.calls.runPublishOnce[0].allowedPaths, ['docs/feature.md']);
    assert.equal(fake.calls.runPublishOnce[0].commitMessage, 'feat(agent): T1');
    assertSelectorWorkspaceRemoved(selector);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE A2 — a PROOF_AT_MAIN frontier is evaluated before and after implementation', () => {
  const fixture = buildFixture();
  try {
    const entry = {
      priority: 1,
      id: 'F-PROOF',
      statement: 'the focused feature proof passes at live main.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C1', command: 'node proof-feature.cjs' })],
      satisfied: false,
    };
    const decision = frontierDecision({
      considered: [entry],
      selected: {
        priority: 1,
        id: 'F-PROOF',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'proof-backed open frontier',
        goal: goalFor({
          criteria: entry.criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1'],
              allow: ['docs/feature.md'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
        }),
      },
    });
    const { result } = runBuildOn(fixture, {
      decision,
      children: {
        runPublishBehavior: (options) => {
          pushCommitToLiveMain(fixture, {
            path: options.allowedPaths[0],
            content: 'deliverable\n',
          });
          return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication' };
        },
      },
    });
    assert.equal(result.status, FRONTIER_COMPLETE);
    assert.equal(result.goalResult.criteria[0].satisfied, true);
    assert.equal(result.goalResult.criteria[0].check, 'PROOF_AT_MAIN');
  } finally {
    removeFixture(fixture);
  }
});

// ---------------------------------------------------------------------------
// B/C. highest-priority actually-open frontier wins; satisfied ones are skipped
// ---------------------------------------------------------------------------

test('CASE B/C — a satisfied higher-priority frontier is skipped, not reimplemented', () => {
  const fixture = buildFixture();
  try {
    const satisfiedEntry = {
      priority: 1,
      id: 'F-DONE',
      statement: 'docs/authority.md already exists.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C0', path: 'docs/authority.md' })],
      satisfied: true,
      evidence: 'PATH_PRESENT docs/authority.md at live main',
    };
    const openEntry = {
      priority: 2,
      id: 'F-OPEN',
      statement: 'docs/feature.md is missing.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C2', path: 'docs/feature.md' })],
      satisfied: false,
    };
    const decision = frontierDecision({
      considered: [satisfiedEntry, openEntry],
      selected: {
        priority: 2,
        id: 'F-OPEN',
        statement: openEntry.statement,
        kind: 'PRODUCT',
        why_selected: 'priority 1 is already satisfied at live main',
        goal: goalFor({
          criteria: openEntry.criteria,
          tasks: [
            task({
              id: 'T2',
              closes: ['C2'],
              allow: ['docs/feature.md'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
        }),
      },
    });
    const { result } = runBuildOn(fixture, { decision });
    assert.equal(result.status, FRONTIER_COMPLETE);
    assert.equal(result.decision.selected.priority, 2);
    assert.equal(result.decision.considered[0].satisfied, true);
    assert.equal(result.goalResult.criteriaAtStart.length, 1);
    assert.equal(result.goalResult.criteriaAtStart[0].id, 'C2');
  } finally {
    removeFixture(fixture);
  }
});

test('CASE B2 — selecting an already-satisfied frontier is rejected before any executor', () => {
  const fixture = buildFixture();
  try {
    const entry = {
      priority: 1,
      id: 'F-DONE',
      statement: 'docs/authority.md already exists.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C0', path: 'docs/authority.md' })],
      satisfied: true,
      evidence: 'present',
    };
    const decision = frontierDecision({
      considered: [entry],
      selected: {
        priority: 1,
        id: 'F-DONE',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'wrong',
        goal: goalFor({
          criteria: entry.criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C0'],
              allow: ['docs/feature.md'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
        }),
      },
    });
    const { result, fake } = runBuildOn(fixture, { decision });
    assert.equal(result.status, BLOCKED_EXTERNAL);
    assert.match(result.reason, /already satisfied/);
    assert.equal(childCallCount(fake), 0);
    assert.equal(result.goal, null);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE B3 — priority inversion (lower-priority selection) is rejected', () => {
  const fixture = buildFixture();
  try {
    const openFirst = {
      priority: 1,
      id: 'F-FIRST',
      statement: 'docs/feature.md is missing.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C1', path: 'docs/feature.md' })],
      satisfied: false,
    };
    const second = {
      priority: 2,
      id: 'F-SECOND',
      statement: 'docs/one.md is missing.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C2', path: 'docs/one.md' })],
      satisfied: false,
    };
    const decision = frontierDecision({
      considered: [openFirst, second],
      selected: {
        priority: 2,
        id: 'F-SECOND',
        statement: second.statement,
        kind: 'PRODUCT',
        why_selected: 'wrong priority order',
        goal: goalFor({
          criteria: second.criteria,
          tasks: [
            task({
              id: 'T2',
              closes: ['C2'],
              allow: ['docs/one.md'],
              proof: ['node proof-one.cjs'],
            }),
          ],
        }),
      },
    });
    const { result, fake } = runBuildOn(fixture, { decision });
    assert.equal(result.status, BLOCKED_EXTERNAL);
    assert.match(result.reason, /highest-priority open frontier/);
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE C2 — a false satisfied claim is contradicted by live main evaluation', () => {
  const fixture = buildFixture();
  try {
    const lying = {
      priority: 1,
      id: 'F-LIE',
      statement: 'claims docs/feature.md already exists.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C1', path: 'docs/feature.md' })],
      satisfied: true,
      evidence: 'claimed present',
    };
    const decision = frontierDecision({
      considered: [lying],
      selected: {
        priority: 1,
        id: 'F-LIE',
        statement: lying.statement,
        kind: 'PRODUCT',
        why_selected: 'wrong',
        goal: goalFor({
          criteria: lying.criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1'],
              allow: ['docs/feature.md'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
        }),
      },
    });
    const { result, fake } = runBuildOn(fixture, { decision });
    assert.equal(result.status, BLOCKED_EXTERNAL);
    assert.match(result.reason, /claims satisfied=true but live main/);
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

// ---------------------------------------------------------------------------
// D. human semantic fork -> zero executor invocations
// ---------------------------------------------------------------------------

test('CASE D — a human semantic fork terminates with zero executor invocations', () => {
  const fixture = buildFixture();
  try {
    const decision = {
      status: 'HUMAN_DECISION_REQUIRED',
      reason: 'the request would choose new product policy meaning',
      escalation_token: 'PRODUCT_POLICY_FORK',
      authority_resolved: ['docs/authority.md', 'docs/BACKLOG.md'],
    };
    const { result, selector, fake } = runBuildOn(fixture, { decision });
    assert.equal(result.status, HUMAN_DECISION_REQUIRED);
    assert.equal(selector.calls.length, 1);
    assert.equal(childCallCount(fake), 0);
    assert.equal(result.goal, null);
    assert.equal(result.nextFrontierSelected, false);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE D2 — an undeclared escalation token fails closed', () => {
  const fixture = buildFixture();
  try {
    const decision = {
      status: 'HUMAN_DECISION_REQUIRED',
      reason: 'escalation with an undeclared token',
      escalation_token: 'NOT_A_DECLARED_TOKEN',
      authority_resolved: ['docs/authority.md', 'docs/BACKLOG.md'],
    };
    const { result, fake } = runBuildOn(fixture, { decision });
    assert.equal(result.status, BLOCKED_EXTERNAL);
    assert.match(result.reason, /escalation_token/);
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

// ---------------------------------------------------------------------------
// E. exactly one frontier per invocation; no automatic second frontier
// ---------------------------------------------------------------------------

test('CASE E — one completed frontier never triggers a second frontier selection', () => {
  const fixture = buildFixture();
  try {
    const entry = {
      priority: 1,
      id: 'F1',
      statement: 'docs/feature.md exists.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C1', path: 'docs/feature.md' })],
      satisfied: false,
    };
    const decision = frontierDecision({
      considered: [entry],
      selected: {
        priority: 1,
        id: 'F1',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'only frontier',
        goal: goalFor({
          criteria: entry.criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1'],
              allow: ['docs/feature.md'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
        }),
      },
    });
    const { result, selector, fake } = runBuildOn(fixture, { decision });
    assert.equal(result.status, FRONTIER_COMPLETE);
    assert.equal(selector.calls.length, 1);
    assert.equal(fake.calls.runPublishOnce.length, 1);
    assert.equal(result.nextFrontierSelected, false);
    assert.equal(Object.hasOwn(result, 'nextFrontier'), false);
    assert.equal(result.decision.selected.id, 'F1');
  } finally {
    removeFixture(fixture);
  }
});

// ---------------------------------------------------------------------------
// F. independent tasks inside one frontier use the existing 5-way batch path
// ---------------------------------------------------------------------------

test('CASE F — independent tasks inside one frontier use the existing batch path', () => {
  const fixture = buildFixture();
  try {
    const criteria = [
      criterion({ id: 'C1', path: 'docs/one.md' }),
      criterion({ id: 'C2', path: 'docs/two.md' }),
      criterion({ id: 'C3', path: 'docs/three.md' }),
    ];
    const entry = {
      priority: 1,
      id: 'F-BATCH',
      statement: 'three independent deliverables are missing.',
      kind: 'PRODUCT',
      criteria,
      satisfied: false,
    };
    const decision = frontierDecision({
      considered: [entry],
      selected: {
        priority: 1,
        id: 'F-BATCH',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'one coherent frontier with three independent bounded tasks',
        goal: goalFor({
          criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1'],
              allow: ['docs/one.md'],
              proof: ['node proof-one.cjs'],
            }),
            task({
              id: 'T2',
              closes: ['C2'],
              allow: ['docs/two.md'],
              proof: ['node proof-two.cjs'],
            }),
            task({
              id: 'T3',
              closes: ['C3'],
              allow: ['docs/three.md'],
              proof: ['node proof-three.cjs'],
            }),
          ],
        }),
      },
    });
    const { result, fake } = runBuildOn(fixture, {
      decision,
      children: {
        runPublishBehavior: (options) => {
          pushCommitToLiveMain(fixture, {
            path: options.allowedPaths[0],
            content: 'deliverable\n',
          });
          return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication' };
        },
      },
    });
    assert.equal(result.status, FRONTIER_COMPLETE);
    assert.equal(result.goalResult.batches.length, 1);
    assert.equal(result.goalResult.batches[0].taskIds.length, 3);
    assert.equal(result.goalResult.batches[0].excluded.length, 0);
    assert.ok(result.goalResult.batches[0].concurrencyLimit <= MAX_BATCH_CONCURRENCY);
    assert.equal(fake.calls.runPublishOnce.length, 3);
    assert.equal(result.goalResult.criteria.filter((c) => c.satisfied).length, 3);
  } finally {
    removeFixture(fixture);
  }
});

// ---------------------------------------------------------------------------
// G. missing declared authority fails closed with no silent substitution
// ---------------------------------------------------------------------------

test('CASE G — a declared authority path missing at live main fails closed', () => {
  const fixture = buildFixture();
  try {
    const request = [
      'MODE: BUILD',
      '',
      'authority order: `docs/authority.md`, `docs/missing-authority.md`',
      'stop: after one frontier',
    ].join('\n');
    const selector = createFakeSelector({
      decision: frontierDecision({ considered: [], selected: null }),
      onInvoke: () => {
        throw new Error('selector must not be invoked when declared authority is missing');
      },
    });
    const fake = createFakeChildren();
    const result = runBuild(
      { requestText: request, repositoryRoot: fixture.root, remote: 'origin' },
      { log: () => {}, ...selector.deps, ...fake.deps },
    );
    assert.equal(result.status, INVALID_BUILD_REQUEST);
    assert.match(result.reason, /docs\/missing-authority\.md/);
    assert.match(result.reason, /no substitute authority was selected/);
    assert.equal(selector.calls.length, 0);
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE G2 — a selector that drops a declared authority path is rejected', () => {
  const fixture = buildFixture();
  try {
    const request = [
      'MODE: BUILD',
      '',
      'authority order: `docs/authority.md`',
      'stop: after one frontier',
    ].join('\n');
    const entry = {
      priority: 1,
      id: 'F1',
      statement: 'docs/feature.md exists.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C1', path: 'docs/feature.md' })],
      satisfied: false,
    };
    const decision = frontierDecision({
      considered: [entry],
      authorityResolved: ['docs/BACKLOG.md'],
      selected: {
        priority: 1,
        id: 'F1',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'only frontier',
        goal: goalFor({
          criteria: entry.criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1'],
              allow: ['docs/feature.md'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
        }),
      },
    });
    const { result, fake } = runBuildOn(fixture, { request, decision });
    assert.equal(result.status, BLOCKED_EXTERNAL);
    assert.match(result.reason, /not resolved by the selector/);
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE G3 — a BUILD-REQUEST-named blob missing from ACCEPTANCE_AUTHORITY is rejected', () => {
  const fixture = buildFixture();
  try {
    const entry = {
      priority: 1,
      id: 'F1',
      statement: 'docs/feature.md exists.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C1', path: 'docs/feature.md' })],
      satisfied: false,
    };
    const decision = frontierDecision({
      considered: [entry],
      authorityResolved: ['docs/authority.md', 'docs/BACKLOG.md'],
      selected: {
        priority: 1,
        id: 'F1',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'only frontier',
        goal: goalFor({
          criteria: entry.criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1'],
              allow: ['docs/feature.md'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
          accept: ['docs/authority.md'],
        }),
      },
    });
    const { result, fake } = runBuildOn(fixture, { decision });
    assert.equal(result.status, BLOCKED_EXTERNAL);
    assert.match(result.reason, /ACCEPTANCE_AUTHORITY must include every blob/);
    assert.match(result.reason, /docs\/BACKLOG\.md/);
    assert.equal(childCallCount(fake), 0);
    assert.equal(result.goal, null);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE G4 — an authority_resolved-only path does not block a valid decision', () => {
  const fixture = buildFixture();
  try {
    const entry = {
      priority: 1,
      id: 'F1',
      statement: 'docs/feature.md exists.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C1', path: 'docs/feature.md' })],
      satisfied: false,
    };
    const decision = frontierDecision({
      considered: [entry],
      authorityResolved: ['docs/authority.md', 'docs/BACKLOG.md', 'docs/README.md'],
      selected: {
        priority: 1,
        id: 'F1',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'only frontier',
        goal: goalFor({
          criteria: entry.criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1'],
              allow: ['docs/feature.md'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
        }),
      },
    });
    const { result, selector, fake } = runBuildOn(fixture, { decision });
    assert.equal(result.status, FRONTIER_COMPLETE);
    assert.equal(
      result.goal.contract.acceptance_authority.includes('docs/README.md'),
      false,
    );
    assert.equal(selector.calls.length, 1);
    assert.equal(childCallCount(fake), 1);
  } finally {
    removeFixture(fixture);
  }
});

// ---------------------------------------------------------------------------
// H. historical documentation is never promoted to frontier authority
// ---------------------------------------------------------------------------

test('CASE H — a historical report cannot become frontier authority', () => {
  const fixture = buildFixture();
  try {
    const entry = {
      priority: 1,
      id: 'F1',
      statement: 'docs/feature.md exists.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C1', path: 'docs/feature.md' })],
      satisfied: false,
    };
    const decision = frontierDecision({
      considered: [entry],
      authorityResolved: [
        'docs/authority.md',
        'docs/BACKLOG.md',
        'docs/reports/REPORT_historical.md',
      ],
      selected: {
        priority: 1,
        id: 'F1',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'promotes a historical report into acceptance authority',
        goal: goalFor({
          criteria: entry.criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1'],
              allow: ['docs/feature.md'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
          accept: ['docs/authority.md', 'docs/reports/REPORT_historical.md'],
        }),
      },
    });
    const { result, fake } = runBuildOn(fixture, { decision });
    assert.equal(result.status, BLOCKED_EXTERNAL);
    assert.match(result.reason, /historical documentation/);
    assert.match(result.reason, /docs\/reports\/REPORT_historical\.md/);
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE H2 — a historical path explicitly named by the request is a designated authority', () => {
  const fixture = buildFixture();
  try {
    const request = [
      'MODE: BUILD',
      '',
      'authority order: `docs/reports/REPORT_historical.md`, `docs/authority.md`',
      'stop: after one frontier',
    ].join('\n');
    const entry = {
      priority: 1,
      id: 'F1',
      statement: 'docs/feature.md exists.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C1', path: 'docs/feature.md' })],
      satisfied: false,
    };
    const decision = frontierDecision({
      considered: [entry],
      authorityResolved: ['docs/authority.md', 'docs/reports/REPORT_historical.md'],
      selected: {
        priority: 1,
        id: 'F1',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'explicitly designated historical authority',
        goal: goalFor({
          criteria: entry.criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1'],
              allow: ['docs/feature.md'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
          accept: ['docs/authority.md', 'docs/reports/REPORT_historical.md'],
        }),
      },
    });
    const { result } = runBuildOn(fixture, { request, decision });
    assert.equal(result.status, FRONTIER_COMPLETE);
    assert.ok(
      result.goal.contract.acceptance_authority.includes('docs/reports/REPORT_historical.md'),
    );
  } finally {
    removeFixture(fixture);
  }
});

test('CASE H3 — mutating a historical path is rejected unless the request names it', () => {
  const fixture = buildFixture();
  try {
    const entry = {
      priority: 1,
      id: 'F1',
      statement: 'touches a historical report',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C1', path: 'docs/feature.md' })],
      satisfied: false,
    };
    const decision = frontierDecision({
      considered: [entry],
      selected: {
        priority: 1,
        id: 'F1',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'allow surface crosses a historical report',
        goal: goalFor({
          criteria: entry.criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1'],
              allow: ['docs/reports/REPORT_historical.md'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
        }),
      },
    });
    const { result, fake } = runBuildOn(fixture, { decision });
    assert.equal(result.status, BLOCKED_EXTERNAL);
    assert.match(result.reason, /historical documentation/);
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

// ---------------------------------------------------------------------------
// I. task-caused failure is separated from unrelated failure
// ---------------------------------------------------------------------------

test('CASE I — a task-caused proof failure is reported without widening scope', () => {
  const fixture = buildFixture();
  try {
    const criteria = [
      criterion({ id: 'C1', path: 'docs/one.md' }),
      criterion({ id: 'C2', path: 'docs/two.md' }),
    ];
    const entry = {
      priority: 1,
      id: 'F-TWO',
      statement: 'two deliverables are missing.',
      kind: 'PRODUCT',
      criteria,
      satisfied: false,
    };
    const decision = frontierDecision({
      considered: [entry],
      selected: {
        priority: 1,
        id: 'F-TWO',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'one frontier with two independent tasks',
        goal: goalFor({
          criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1'],
              allow: ['docs/one.md'],
              proof: ['node proof-one.cjs'],
            }),
            task({
              id: 'T2',
              closes: ['C2'],
              allow: ['docs/two.md'],
              proof: ['node proof-two.cjs'],
            }),
          ],
        }),
      },
    });
    const { result, selector, fake } = runBuildOn(fixture, {
      decision,
      children: {
        runPublishBehavior: (options) => {
          if (options.allowedPaths[0] === 'docs/one.md') {
            return {
              status: 'PROOF_FAILED',
              reason: 'task-caused proof failure',
              changedPaths: [],
            };
          }
          pushCommitToLiveMain(fixture, {
            path: options.allowedPaths[0],
            content: 'deliverable\n',
          });
          return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication' };
        },
      },
    });
    assert.equal(result.status, PROOF_FAILED);
    assert.match(result.reason, /did not change criterion state|no declared catalog task/);
    const attemptByTask = new Map(
      result.goalResult.attempts.map((attempt) => [attempt.taskId, attempt]),
    );
    assert.equal(attemptByTask.get('T1').childStatus, 'PROOF_FAILED');
    assert.equal(attemptByTask.get('T1').succeeded, false);
    assert.equal(attemptByTask.get('T2').childStatus, 'SUCCESS_PUBLISHED');
    assert.equal(attemptByTask.get('T2').succeeded, true);
    // The unrelated successful sibling was neither rolled back nor widened.
    const publishedCriterion = result.goalResult.criteria.find((c) => c.id === 'C2');
    assert.equal(publishedCriterion.satisfied, true);
    // Exactly one frontier and one selector call: the failure opened no new scope.
    assert.equal(selector.calls.length, 1);
    assert.equal(result.nextFrontierSelected, false);
    assert.equal(fake.calls.runPublishOnce.length, 2);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE I2 — a publication infrastructure failure maps to PUBLICATION_FAILED', () => {
  const fixture = buildFixture();
  try {
    const entry = {
      priority: 1,
      id: 'F-PUB',
      statement: 'docs/feature.md exists.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C1', path: 'docs/feature.md' })],
      satisfied: false,
    };
    const decision = frontierDecision({
      considered: [entry],
      selected: {
        priority: 1,
        id: 'F-PUB',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'only frontier',
        goal: goalFor({
          criteria: entry.criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1'],
              allow: ['docs/feature.md'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
        }),
      },
    });
    const { result } = runBuildOn(fixture, {
      decision,
      children: {
        runPublishBehavior: () => ({
          status: 'CI_FAILED',
          reason: 'required check failed',
          changedPaths: [],
        }),
      },
    });
    assert.equal(result.status, PUBLICATION_FAILED);
    assert.match(result.reason, /CI_FAILED/);
    assert.equal(result.nextFrontierSelected, false);
  } finally {
    removeFixture(fixture);
  }
});

// ---------------------------------------------------------------------------
// Selector read-only enforcement and finite non-FRONTIER terminals
// ---------------------------------------------------------------------------

test('CASE S1 — a selector workspace mutation rejects the whole decision', () => {
  const fixture = buildFixture();
  try {
    const entry = {
      priority: 1,
      id: 'F1',
      statement: 'docs/feature.md exists.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C1', path: 'docs/feature.md' })],
      satisfied: false,
    };
    const decision = frontierDecision({
      considered: [entry],
      selected: {
        priority: 1,
        id: 'F1',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'only frontier',
        goal: goalFor({
          criteria: entry.criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1'],
              allow: ['docs/feature.md'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
        }),
      },
    });
    const { result, selector, fake } = runBuildOn(fixture, {
      decision,
      selectorOptions: {
        onInvoke: (input) => {
          const dirIndex = input.args.indexOf('--dir');
          writeFileSync(join(input.args[dirIndex + 1], 'selector-wrote-this.txt'), 'mutation\n');
        },
      },
    });
    assert.equal(result.status, BLOCKED_EXTERNAL);
    assert.match(result.reason, /MUTATION_REJECTED|mutation observed/);
    assert.equal(childCallCount(fake), 0);
    assert.equal(result.selector.workspaceCleanup, 'REMOVED');
    assertSelectorWorkspaceRemoved(selector);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE S2 — an invalid selector payload fails closed as BLOCKED_EXTERNAL', () => {
  const fixture = buildFixture();
  try {
    const selector = {
      calls: [],
      deps: {
        invokeSelectorOpencode: (input) => {
          selector.calls.push(input);
          return {
            exitCode: 0,
            timedOut: false,
            startErrorCode: null,
            stdout: `${JSON.stringify({ type: 'text', part: { text: 'not a json decision' } })}\n`,
            stderr: '',
          };
        },
      },
    };
    const fake = createFakeChildren();
    const result = runBuild(
      { requestText: DEFAULT_REQUEST, repositoryRoot: fixture.root, remote: 'origin' },
      { log: () => {}, ...selector.deps, ...fake.deps },
    );
    assert.equal(result.status, BLOCKED_EXTERNAL);
    assert.equal(result.selector.status, 'INVALID_OUTPUT');
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE S4 — earlier commentary text parts do not break the final selector decision', () => {
  const fixture = buildFixture();
  try {
    const decision = {
      status: 'NO_EXECUTABLE_FRONTIER',
      reason: 'no currently-open frontier is autonomously closable',
      authority_resolved: ['docs/authority.md', 'docs/BACKLOG.md'],
    };
    const events = [
      { type: 'text', part: { text: 'Tests are green at live main. Now cleaning up.' } },
      { type: 'text', part: { text: JSON.stringify(decision) } },
    ];
    const selector = {
      calls: [],
      deps: {
        invokeSelectorOpencode: (input) => {
          selector.calls.push(input);
          return {
            exitCode: 0,
            timedOut: false,
            startErrorCode: null,
            stdout: `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
            stderr: '',
          };
        },
      },
    };
    const fake = createFakeChildren();
    const result = runBuild(
      { requestText: DEFAULT_REQUEST, repositoryRoot: fixture.root, remote: 'origin' },
      { log: () => {}, ...selector.deps, ...fake.deps },
    );
    assert.equal(result.status, NO_EXECUTABLE_FRONTIER);
    assert.equal(selector.calls.length, 1);
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE S3 — ALREADY_SATISFIED and NO_EXECUTABLE_FRONTIER are finite terminals', () => {
  const fixture = buildFixture();
  try {
    const satisfiedEntry = {
      priority: 1,
      id: 'F-DONE',
      statement: 'docs/authority.md already exists.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C0', path: 'docs/authority.md' })],
      satisfied: true,
      evidence: 'present at live main',
    };
    const already = runBuildOn(fixture, {
      decision: {
        status: 'ALREADY_SATISFIED',
        reason: 'every considered frontier is satisfied at live main',
        authority_resolved: ['docs/authority.md', 'docs/BACKLOG.md'],
        considered: [satisfiedEntry],
      },
    });
    assert.equal(already.result.status, ALREADY_SATISFIED);
    assert.equal(childCallCount(already.fake), 0);

    const none = runBuildOn(fixture, {
      decision: {
        status: 'NO_EXECUTABLE_FRONTIER',
        reason: 'no currently-open frontier is autonomously closable',
        authority_resolved: ['docs/authority.md', 'docs/BACKLOG.md'],
      },
    });
    assert.equal(none.result.status, NO_EXECUTABLE_FRONTIER);
    assert.equal(childCallCount(none.fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

function selectorTextDeps(text) {
  const calls = [];
  return {
    calls,
    deps: {
      invokeSelectorOpencode: (input) => {
        calls.push(input);
        return {
          exitCode: 0,
          timedOut: false,
          startErrorCode: null,
          stdout: `${JSON.stringify({ type: 'text', part: { text } })}\n`,
          stderr: '',
        };
      },
    },
  };
}

function openProductFrontierDecision() {
  const entry = {
    priority: 1,
    id: 'F1',
    statement: 'docs/feature.md exists.',
    kind: 'PRODUCT',
    criteria: [criterion({ id: 'C1', path: 'docs/feature.md' })],
    satisfied: false,
  };
  return frontierDecision({
    considered: [entry],
    selected: {
      priority: 1,
      id: 'F1',
      statement: entry.statement,
      kind: 'PRODUCT',
      why_selected: 'only frontier',
      goal: goalFor({
        criteria: entry.criteria,
        tasks: [
          task({
            id: 'T1',
            closes: ['C1'],
            allow: ['docs/feature.md'],
            proof: ['node proof-feature.cjs'],
          }),
        ],
      }),
    },
  });
}

function publishToLiveMain(fixture) {
  return (options) => {
    pushCommitToLiveMain(fixture, { path: options.allowedPaths[0], content: 'deliverable\n' });
    return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication' };
  };
}

test('CASE S5 — a trailing extra brace after the decision object is tolerated', () => {
  const fixture = buildFixture();
  try {
    const decision = openProductFrontierDecision();
    const selector = selectorTextDeps(`${JSON.stringify(decision)}}`);
    const fake = createFakeChildren({ runPublishBehavior: publishToLiveMain(fixture) });
    const result = runBuild(
      { requestText: DEFAULT_REQUEST, repositoryRoot: fixture.root, remote: 'origin' },
      { log: () => {}, ...selector.deps, ...fake.deps },
    );
    assert.equal(result.status, FRONTIER_COMPLETE);
    assert.equal(result.nextFrontierSelected, false);
    assert.equal(result.selector.status, 'DECISION');
    assert.equal(selector.calls.length, 1);
    assert.equal(fake.calls.runPublishOnce.length, 1);
    assert.equal(childCallCount(fake), 1);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE S6 — prose around the decision object is tolerated', () => {
  const fixture = buildFixture();
  try {
    const decision = openProductFrontierDecision();
    const selector = selectorTextDeps(
      `Here is the selected frontier.\n${JSON.stringify(decision)}\nThat is the decision.`,
    );
    const fake = createFakeChildren({ runPublishBehavior: publishToLiveMain(fixture) });
    const result = runBuild(
      { requestText: DEFAULT_REQUEST, repositoryRoot: fixture.root, remote: 'origin' },
      { log: () => {}, ...selector.deps, ...fake.deps },
    );
    assert.equal(result.status, FRONTIER_COMPLETE);
    assert.equal(result.nextFrontierSelected, false);
    assert.equal(result.selector.status, 'DECISION');
    assert.equal(selector.calls.length, 1);
    assert.equal(fake.calls.runPublishOnce.length, 1);
    assert.equal(childCallCount(fake), 1);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE S7 — two decision objects fail closed', () => {
  const fixture = buildFixture();
  try {
    const decision = openProductFrontierDecision();
    const selector = selectorTextDeps(`${JSON.stringify(decision)}\n${JSON.stringify(decision)}`);
    const fake = createFakeChildren();
    const result = runBuild(
      { requestText: DEFAULT_REQUEST, repositoryRoot: fixture.root, remote: 'origin' },
      { log: () => {}, ...selector.deps, ...fake.deps },
    );
    assert.equal(result.status, BLOCKED_EXTERNAL);
    assert.equal(result.selector.status, 'INVALID_OUTPUT');
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

// ---------------------------------------------------------------------------
// Contract-integrity gates on the generated Goal Contract
// ---------------------------------------------------------------------------

test('CASE V1 — a goal whose criteria drift from the frontier is rejected', () => {
  const fixture = buildFixture();
  try {
    const entry = {
      priority: 1,
      id: 'F1',
      statement: 'docs/feature.md exists.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C1', path: 'docs/feature.md' })],
      satisfied: false,
    };
    const decision = frontierDecision({
      considered: [entry],
      selected: {
        priority: 1,
        id: 'F1',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'only frontier',
        goal: goalFor({
          criteria: [criterion({ id: 'C-OTHER', path: 'docs/one.md' })],
          tasks: [
            task({
              id: 'T1',
              closes: ['C-OTHER'],
              allow: ['docs/feature.md'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
        }),
      },
    });
    const { result, fake } = runBuildOn(fixture, { decision });
    assert.equal(result.status, BLOCKED_EXTERNAL);
    assert.match(result.reason, /CRITERIA must be exactly/);
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE V2 — a task outside AUTONOMOUSLY_ALLOWED is rejected before execution', () => {
  const fixture = buildFixture();
  try {
    const entry = {
      priority: 1,
      id: 'F1',
      statement: 'docs/feature.md exists.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C1', path: 'docs/feature.md' })],
      satisfied: false,
    };
    const decision = frontierDecision({
      considered: [entry],
      selected: {
        priority: 1,
        id: 'F1',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'only frontier',
        goal: goalFor({
          criteria: entry.criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1'],
              allow: ['apps/api/src/x.ts'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
        }),
      },
    });
    const { result, fake } = runBuildOn(fixture, { decision });
    assert.equal(result.status, BLOCKED_EXTERNAL);
    assert.match(result.reason, /outside AUTONOMOUSLY_ALLOWED/);
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE V3 — PLANNER, publication, and proof requirements are enforced', () => {
  const fixture = buildFixture();
  try {
    const entry = {
      priority: 1,
      id: 'F1',
      statement: 'docs/feature.md exists.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C1', path: 'docs/feature.md' })],
      satisfied: false,
    };
    const base = goalFor({
      criteria: entry.criteria,
      tasks: [
        task({
          id: 'T1',
          closes: ['C1'],
          allow: ['docs/feature.md'],
          proof: ['node proof-feature.cjs'],
        }),
      ],
    });
    const variants = [
      { goal: { ...base, PLANNER: { enabled: true } }, pattern: /must not enable PLANNER/ },
      {
        goal: {
          ...base,
          TASK_CATALOG: base.TASK_CATALOG.map((t) => ({ ...t, publication: 'none' })),
        },
        pattern: /publication "required"/,
      },
      {
        goal: {
          ...base,
          TASK_CATALOG: base.TASK_CATALOG.map((t) => ({ ...t, proof: [], proof_owner: [] })),
        },
        pattern: /at least one proof command/,
      },
    ];
    for (const variant of variants) {
      const decision = frontierDecision({
        considered: [entry],
        selected: {
          priority: 1,
          id: 'F1',
          statement: entry.statement,
          kind: 'PRODUCT',
          why_selected: 'only frontier',
          goal: variant.goal,
        },
      });
      const { result, fake } = runBuildOn(fixture, { decision });
      assert.equal(result.status, BLOCKED_EXTERNAL);
      assert.match(result.reason, variant.pattern);
      assert.equal(childCallCount(fake), 0);
    }
  } finally {
    removeFixture(fixture);
  }
});

// ---------------------------------------------------------------------------
// K. authoritative selector contract: prompt and validator share one layer
// ---------------------------------------------------------------------------

function selectorPrompt() {
  return buildFrontierPrompt({
    buildRequest: DEFAULT_REQUEST,
    declaredAuthority: ['docs/authority.md'],
    canonicalAuthority: ['AGENTS.md', 'docs/README.md'],
    pin: { fetchedSha: 'a'.repeat(40) },
  });
}

test('CASE K1 — the prompt prints the exact field sets, ids, and limits the validator enforces', () => {
  const prompt = selectorPrompt();
  assert.ok(prompt.includes(`- decision fields: ${SELECTOR_FIELD_SETS.decision.join(', ')}`));
  assert.ok(
    prompt.includes(`- considered entry fields: ${SELECTOR_FIELD_SETS.considered.join(', ')}`),
  );
  assert.ok(prompt.includes(`- selected fields: ${SELECTOR_FIELD_SETS.selected.join(', ')}`));
  assert.ok(
    prompt.includes(
      `identifier pattern for every frontier/criterion/task id: ${SELECTOR_ID_PATTERN.source}`,
    ),
  );
  for (const check of BUILD_CRITERION_CHECKS) {
    assert.ok(
      prompt.includes(`  - ${check}: ${SELECTOR_FIELD_SETS.criterionByCheck[check].join(', ')}`),
      `prompt must print the ${check} criterion field set`,
    );
  }
  assert.ok(prompt.includes(`- goal contract fields: ${SELECTOR_FIELD_SETS.goal.join(', ')}`));
  assert.ok(prompt.includes(`- task fields: ${SELECTOR_FIELD_SETS.task.join(', ')}`));
  assert.match(prompt, /- selected\.kind must equal the considered frontier kind/);
  assert.match(prompt, /goal CRITERIA must be exactly the selected considered frontier criteria/);
  assert.match(prompt, /proof_owner is index-positional with proof when present/);
  assert.ok(
    prompt.includes(
      `- reconciliation is required when satisfied is false and must be one of: ${SELECTOR_RECONCILIATIONS.join(', ')}`,
    ),
  );
  assert.match(prompt, /statement <= 2000/);
  assert.match(prompt, /reason <= 4000/);
  assert.match(prompt, /task outcome <= 2000/);
});

test('CASE K2 — unknown fields at every level fail closed before any executor', () => {
  const fixture = buildFixture();
  try {
    const variants = [
      ['considered', (decision) => { decision.considered[0].unexpected = 'x'; }],
      ['selected', (decision) => { decision.selected.unexpected = 'x'; }],
      ['criterion', (decision) => { decision.considered[0].criteria[0].unexpected = 'x'; }],
      ['task', (decision) => { decision.selected.goal.TASK_CATALOG[0].unexpected = 'x'; }],
      ['goal', (decision) => { decision.selected.goal.UNEXPECTED_FIELD = 'x'; }],
    ];
    for (const [label, mutate] of variants) {
      const decision = structuredClone(openProductFrontierDecision());
      mutate(decision);
      const { result, fake } = runBuildOn(fixture, { decision });
      assert.equal(result.status, BLOCKED_EXTERNAL, `${label} must fail closed`);
      assert.match(result.reason, /unsupported field/, label);
      assert.equal(childCallCount(fake), 0, label);
    }
  } finally {
    removeFixture(fixture);
  }
});

test('CASE K3 — a DOC_TOKEN frontier keeps path+token and completes in one selector invocation', () => {
  const fixture = buildFixture();
  try {
    const entry = {
      priority: 1,
      id: 'F-DOC',
      statement: 'docs/authority.md owns the synced marker.',
      kind: 'PRODUCT',
      criteria: [
        {
          id: 'C1',
          statement: 'the synced marker is present in the authority document',
          authority: ['docs/authority.md'],
          check: 'DOC_TOKEN',
          class: 'AUTONOMOUS',
          path: 'docs/authority.md',
          token: 'SYNCED',
        },
      ],
      satisfied: false,
    };
    const decision = frontierDecision({
      considered: [entry],
      selected: {
        priority: 1,
        id: 'F-DOC',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'the document marker is missing at live main',
        goal: goalFor({
          criteria: entry.criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1'],
              allow: ['docs/authority.md'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
        }),
      },
    });
    const { result, selector, fake } = runBuildOn(fixture, {
      decision,
      children: {
        runPublishBehavior: (options) => {
          pushCommitToLiveMain(fixture, {
            path: options.allowedPaths[0],
            content: 'SYNCED\n',
          });
          return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication' };
        },
      },
    });
    assert.equal(result.status, FRONTIER_COMPLETE);
    assert.equal(selector.calls.length, 1);
    assert.equal(result.selector.status, 'DECISION');
    assert.equal(result.decision.rejected, undefined);
    assert.equal(result.goal.contract.criteria[0].check, 'DOC_TOKEN');
    assert.equal(result.goal.contract.criteria[0].token, 'SYNCED');
    assert.equal(fake.calls.runPublishOnce.length, 1);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE K4 — a criterion authority path missing from authority_resolved is rejected', () => {
  const fixture = buildFixture();
  try {
    const entry = {
      priority: 1,
      id: 'F1',
      statement: 'docs/feature.md exists.',
      kind: 'PRODUCT',
      criteria: [
        criterion({ id: 'C1', path: 'docs/feature.md' }),
        {
          id: 'C2',
          statement: 'docs/memory.md is a criterion authority.',
          authority: ['docs/memory.md'],
          check: 'PATH_PRESENT',
          class: 'AUTONOMOUS',
          path: 'docs/feature.md',
        },
      ],
      satisfied: false,
    };
    const decision = frontierDecision({
      considered: [entry],
      authorityResolved: ['docs/authority.md', 'docs/BACKLOG.md'],
      selected: {
        priority: 1,
        id: 'F1',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'only frontier',
        goal: goalFor({
          criteria: entry.criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1', 'C2'],
              allow: ['docs/feature.md'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
        }),
      },
    });
    const { result, fake } = runBuildOn(fixture, { decision });
    assert.equal(result.status, BLOCKED_EXTERNAL);
    assert.match(result.reason, /criterion authority path\(s\) are not resolved/);
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE K5 — identifiers, kind equality, and length limits fail closed', () => {
  const fixture = buildFixture();
  try {
    const variants = [
      ['considered id', (d) => { d.considered[0].id = 'F 1'; }, /must match/],
      [
        'criterion id',
        (d) => {
          d.considered[0].criteria[0].id = 'C 1';
          d.selected.goal.TASK_CATALOG[0].closes = ['C 1'];
        },
        /must match/,
      ],
      ['task id', (d) => { d.selected.goal.TASK_CATALOG[0].id = 'T 1'; }, /must match/],
      [
        'kind equality',
        (d) => {
          d.selected.kind = 'MAINTENANCE';
          d.selected.maintenance_justification = 'not actually maintenance';
        },
        /must equal the considered frontier kind/,
      ],
      [
        'statement limit',
        (d) => { d.considered[0].statement = 'x'.repeat(SELECTOR_STATEMENT_MAX_CHARS + 1); },
        /statement must be at most/,
      ],
      ['reason limit', (d) => { d.reason = 'x'.repeat(SELECTOR_REASON_MAX_CHARS + 1); }, /reason must be at most/],
      [
        'task outcome limit',
        (d) => {
          d.selected.goal.TASK_CATALOG[0].outcome = 'x'.repeat(SELECTOR_TASK_OUTCOME_MAX_CHARS + 1);
        },
        /outcome must be at most/,
      ],
    ];
    for (const [label, mutate, pattern] of variants) {
      const decision = structuredClone(openProductFrontierDecision());
      mutate(decision);
      const { result, fake } = runBuildOn(fixture, { decision });
      assert.equal(result.status, BLOCKED_EXTERNAL, label);
      assert.match(result.reason, pattern, label);
      assert.equal(childCallCount(fake), 0, label);
    }
  } finally {
    removeFixture(fixture);
  }
});

// ---------------------------------------------------------------------------
// R. current-evidence reconciliation classification
// ---------------------------------------------------------------------------

test('CASE R1 — the prompt states the reconciliation classification rules', () => {
  const prompt = selectorPrompt();
  for (const kind of SELECTOR_RECONCILIATIONS) {
    assert.ok(prompt.includes(kind), `prompt must name ${kind}`);
  }
  assert.match(prompt, /Existing code alone never makes a spec stale/);
  assert.match(prompt, /an existing test alone never\s+changes the intended contract/);
  assert.match(prompt, /STALE_SPEC is not a\s+product gap/);
  assert.match(prompt, /must not change runtime behavior/);
  assert.match(prompt, /Do not\s+choose this as a frontier; return HUMAN_DECISION_REQUIRED instead/);
  assert.match(prompt, /STALE_SPEC requires an evidence\s+string naming the implementation/);
});

test('CASE R2 — a selected SEMANTIC_CONFLICT frontier escalates with zero executor calls', () => {
  const fixture = buildFixture();
  try {
    const entry = {
      priority: 1,
      id: 'F-CONFLICT',
      statement: 'orders spec and orders implementation claim different contracts.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C1', path: 'docs/feature.md' })],
      satisfied: false,
      reconciliation: 'SEMANTIC_CONFLICT',
    };
    const decision = frontierDecision({
      considered: [entry],
      selected: {
        priority: 1,
        id: 'F-CONFLICT',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'the contradiction needs a human decision',
        goal: goalFor({
          criteria: entry.criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1'],
              allow: ['docs/feature.md'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
        }),
      },
    });
    const { result, selector, fake } = runBuildOn(fixture, { decision });
    assert.equal(result.status, HUMAN_DECISION_REQUIRED);
    assert.match(result.reason, /SEMANTIC_CONFLICT/);
    assert.equal(selector.calls.length, 1);
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE R3 — a STALE_SPEC documentation-sync frontier is admitted and completes', () => {
  const fixture = buildFixture();
  try {
    const entry = {
      priority: 1,
      id: 'F-STALE',
      statement: 'docs/authority.md wording is behind an already implemented behavior.',
      kind: 'PRODUCT',
      criteria: [
        {
          id: 'C1',
          statement: 'the authority document carries the current synced marker',
          authority: ['docs/authority.md'],
          check: 'DOC_TOKEN',
          class: 'AUTONOMOUS',
          path: 'docs/authority.md',
          token: 'SYNCED',
        },
      ],
      satisfied: false,
      reconciliation: 'STALE_SPEC',
      evidence: 'apps/api/src/orders plus the direct proof already implement the synced behavior',
    };
    const decision = frontierDecision({
      considered: [entry],
      selected: {
        priority: 1,
        id: 'F-STALE',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'sync the stale spec line to the current proven contract',
        goal: goalFor({
          criteria: entry.criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1'],
              allow: ['docs/authority.md'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
        }),
      },
    });
    const { result, fake } = runBuildOn(fixture, {
      decision,
      children: {
        runPublishBehavior: (options) => {
          pushCommitToLiveMain(fixture, { path: options.allowedPaths[0], content: 'SYNCED\n' });
          return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication' };
        },
      },
    });
    assert.equal(result.status, FRONTIER_COMPLETE);
    assert.equal(result.decision.considered[0].reconciliation, 'STALE_SPEC');
    assert.equal(fake.calls.runPublishOnce.length, 1);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE R4 — a missing reconciliation or STALE_SPEC without evidence fails closed', () => {
  const fixture = buildFixture();
  try {
    const variants = [
      [
        'missing reconciliation',
        (d) => { d.considered[0].reconciliation = null; },
        /reconciliation must be one of/,
      ],
      [
        'stale without evidence',
        (d) => {
          d.considered[0].reconciliation = 'STALE_SPEC';
          delete d.considered[0].evidence;
        },
        /STALE_SPEC requires an evidence string/,
      ],
    ];
    for (const [label, mutate, pattern] of variants) {
      const decision = structuredClone(openProductFrontierDecision());
      mutate(decision);
      const { result, fake } = runBuildOn(fixture, { decision });
      assert.equal(result.status, BLOCKED_EXTERNAL, label);
      assert.match(result.reason, pattern, label);
      assert.equal(childCallCount(fake), 0, label);
    }
  } finally {
    removeFixture(fixture);
  }
});

test('CASE R5 — a stale TODO claiming an implemented deliverable is not an open gap', () => {
  const fixture = buildFixture();
  try {
    const entry = {
      priority: 1,
      id: 'F-TODO',
      statement: 'docs/authority.md is listed as missing.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C1', path: 'docs/authority.md' })],
      satisfied: false,
      reconciliation: 'IMPLEMENTATION_GAP',
    };
    const decision = frontierDecision({
      considered: [entry],
      selected: {
        priority: 1,
        id: 'F-TODO',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'stale TODO claims the deliverable is missing',
        goal: goalFor({
          criteria: entry.criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1'],
              allow: ['docs/feature.md'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
        }),
      },
    });
    const { result, fake } = runBuildOn(fixture, { decision });
    assert.equal(result.status, BLOCKED_EXTERNAL);
    assert.match(result.reason, /claims satisfied=false but live main .* evaluates satisfied=true/);
    assert.equal(childCallCount(fake), 0);
  } finally {
    removeFixture(fixture);
  }
});

// ---------------------------------------------------------------------------
// M. multi-frontier batch admission through the existing bounded executor
// ---------------------------------------------------------------------------

test('CASE M1 — five independent frontier candidates are admitted into one batch', () => {
  const fixture = buildFixture();
  try {
    const frontiers = [1, 2, 3, 4, 5].map((priority) =>
      independentFrontier({
        priority,
        id: `F${priority}`,
        path: `docs/m${priority}.md`,
        proof: 'node proof-one.cjs',
      }),
    );
    const decision = frontierDecision({
      considered: frontiers.map((frontier) => frontier.entry),
      selected: frontiers[0].selected,
      batch: frontiers.slice(1).map((frontier) => batchEntryFor(frontier)),
    });
    const { result, selector, fake } = runBuildOn(fixture, { decision });
    assert.equal(result.status, FRONTIER_COMPLETE);
    assert.equal(selector.calls.length, 1);
    assert.deepEqual(result.goal.frontierIds, ['F1', 'F2', 'F3', 'F4', 'F5']);
    assert.equal(result.batch.admitted.length, 5);
    assert.equal(result.batch.deferred.length, 0);
    assert.deepEqual(
      result.decision.batch.map((candidate) => candidate.id),
      ['F2', 'F3', 'F4', 'F5'],
    );
    assert.equal(result.goalResult.batches.length, 1);
    assert.deepEqual(result.goalResult.batches[0].taskIds, ['T1', 'T2', 'T3', 'T4', 'T5']);
    assert.equal(result.goalResult.batches[0].excluded.length, 0);
    assert.equal(result.goalResult.batches[0].concurrencyLimit, MAX_BATCH_CONCURRENCY);
    assert.equal(result.goalResult.maxBatchConcurrency, MAX_BATCH_CONCURRENCY);
    assert.equal(fake.calls.runPublishOnce.length, 5);
    assert.equal(result.goalResult.criteria.filter((entry) => entry.satisfied).length, 5);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE M2 — overlapping candidates are deferred, never started together', () => {
  const fixture = buildFixture();
  try {
    const first = independentFrontier({
      priority: 1,
      id: 'F1',
      path: 'docs/shared.md',
      proof: 'node proof-one.cjs',
    });
    const second = independentFrontier({
      priority: 2,
      id: 'F2',
      path: 'docs/shared.md',
      proof: 'node proof-two.cjs',
    });
    const decision = frontierDecision({
      considered: [first.entry, second.entry],
      selected: first.selected,
      batch: [batchEntryFor(second)],
    });
    const { result, fake } = runBuildOn(fixture, { decision });
    assert.equal(result.status, FRONTIER_COMPLETE);
    assert.deepEqual(result.goal.frontierIds, ['F1']);
    assert.equal(result.batch.admitted.length, 1);
    assert.equal(result.batch.deferred.length, 1);
    assert.equal(result.batch.deferred[0].id, 'F2');
    assert.equal(result.batch.deferred[0].kind, 'SEMANTIC_OWNER');
    assert.equal(result.batch.deferred[0].withId, 'F1');
    assert.deepEqual(result.goalResult.batches[0].taskIds, ['T1']);
    assert.equal(fake.calls.runPublishOnce.length, 1);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE M3 — a declared depends_on task is ordered across executor batches', () => {
  const fixture = buildFixture();
  try {
    const entry = {
      priority: 1,
      id: 'F-DEP',
      statement: 'two dependent deliverables are missing.',
      kind: 'PRODUCT',
      criteria: [
        criterion({ id: 'C1', path: 'docs/m1.md' }),
        criterion({ id: 'C2', path: 'docs/m2.md' }),
      ],
      satisfied: false,
    };
    const decision = frontierDecision({
      considered: [entry],
      selected: {
        priority: 1,
        id: 'F-DEP',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'one frontier with an explicit dependency order',
        goal: goalFor({
          criteria: entry.criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1'],
              allow: ['docs/m1.md'],
              proof: ['node proof-one.cjs'],
            }),
            {
              ...task({
                id: 'T2',
                closes: ['C2'],
                allow: ['docs/m2.md'],
                proof: ['node proof-two.cjs'],
              }),
              depends_on: ['T1'],
            },
          ],
        }),
      },
    });
    const { result, fake } = runBuildOn(fixture, { decision });
    assert.equal(result.status, FRONTIER_COMPLETE);
    assert.equal(result.goalResult.batches.length, 2);
    assert.deepEqual(result.goalResult.batches[0].taskIds, ['T1']);
    assert.deepEqual(result.goalResult.batches[1].taskIds, ['T2']);
    assert.equal(fake.calls.runPublishOnce.length, 2);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE M4 — a failing sibling never cancels an already-started independent sibling', () => {
  const fixture = buildFixture();
  try {
    const first = independentFrontier({
      priority: 1,
      id: 'F1',
      path: 'docs/m1.md',
      proof: 'node proof-one.cjs',
    });
    const second = independentFrontier({
      priority: 2,
      id: 'F2',
      path: 'docs/m2.md',
      proof: 'node proof-two.cjs',
    });
    const decision = frontierDecision({
      considered: [first.entry, second.entry],
      selected: first.selected,
      batch: [batchEntryFor(second)],
    });
    const { result, fake } = runBuildOn(fixture, {
      decision,
      children: {
        runPublishBehavior: (options) => {
          if (options.allowedPaths[0] === 'docs/m2.md') {
            return { status: 'PROOF_FAILED', reason: 'deliberate sibling proof failure' };
          }
          pushCommitToLiveMain(fixture, {
            path: options.allowedPaths[0],
            content: 'deliverable\n',
          });
          return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication' };
        },
      },
    });
    assert.equal(result.status, PROOF_FAILED);
    assert.equal(result.goalResult.batches[0].taskIds.length, 2);
    const attempts = result.goalResult.attempts;
    assert.equal(attempts.find((attempt) => attempt.taskId === 'T1').succeeded, true);
    assert.equal(attempts.find((attempt) => attempt.taskId === 'T2').succeeded, false);
    assert.equal(fake.calls.runPublishOnce.length, 2);
    const criteria = result.goalResult.criteria;
    assert.equal(criteria.find((criterion) => criterion.id === 'C1').satisfied, true);
    assert.equal(criteria.find((criterion) => criterion.id === 'C2').satisfied, false);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE M5 — invalid batch candidates fail closed before any executor', () => {
  const fixture = buildFixture();
  try {
    const frontiers = [1, 2, 3, 4, 5].map((priority) =>
      independentFrontier({
        priority,
        id: `F${priority}`,
        path: `docs/m${priority}.md`,
        proof: 'node proof-one.cjs',
      }),
    );
    const baseDecision = () =>
      frontierDecision({
        considered: frontiers.map((frontier) => frontier.entry),
        selected: frontiers[0].selected,
        batch: frontiers.slice(1).map((frontier) => batchEntryFor(frontier)),
      });
    const variants = [
      [
        'priority order',
        (decision) => {
          decision.batch[0].priority = 1;
        },
        /priority must be an integer greater than the previous/,
      ],
      [
        'id mismatch',
        (decision) => {
          decision.batch[0].id = 'F-OTHER';
        },
        /id must equal the considered frontier id/,
      ],
      [
        'unknown field',
        (decision) => {
          decision.batch[0].unexpected = 'x';
        },
        /unsupported field/,
      ],
      [
        'satisfied entry',
        (decision) => {
          decision.considered[1].criteria = [criterion({ id: 'C2', path: 'docs/authority.md' })];
          decision.considered[1].satisfied = true;
          decision.considered[1].evidence = 'already present at live main';
        },
        /already satisfied at live main/,
      ],
      [
        'kind mismatch',
        (decision) => {
          decision.batch[0].kind = 'MAINTENANCE';
          decision.batch[0].maintenance_justification = 'not actually maintenance';
        },
        /must equal the considered frontier kind/,
      ],
      [
        'too many candidates',
        (decision) => {
          decision.batch.push({
            priority: 6,
            id: 'F6',
            kind: 'PRODUCT',
            why_selected: 'over the batch limit',
            goal: frontiers[4].selected.goal,
          });
        },
        /batch must contain at most 4 candidates/,
      ],
    ];
    for (const [label, mutate, pattern] of variants) {
      const decision = structuredClone(baseDecision());
      mutate(decision);
      const { result, fake } = runBuildOn(fixture, { decision });
      assert.equal(result.status, BLOCKED_EXTERNAL, label);
      assert.match(result.reason, pattern, label);
      assert.equal(childCallCount(fake), 0, label);
    }
  } finally {
    removeFixture(fixture);
  }
});

test('CASE M6 — the prompt states the batch contract and the independence rule', () => {
  const prompt = selectorPrompt();
  assert.ok(
    prompt.includes(`- batch entry fields: ${SELECTOR_FIELD_SETS.batchEntry.join(', ')}`),
  );
  assert.match(prompt, /batch candidates: 0\.\.4 entries; priorities strictly/);
  assert.match(prompt, /frontier independence: candidates are admitted in priority order/);
  assert.match(prompt, /deferred to the\s+next live-main recomputation/);
  assert.match(prompt, /12\. Batch candidates\./);
  assert.match(prompt, /A failing candidate never cancels an already-started\s+independent sibling/);
});

// ---------------------------------------------------------------------------
// J. existing run-goal behavior is reused, never reimplemented
// ---------------------------------------------------------------------------

test('CASE J — BUILD delegates execution to the imported run-goal loop unchanged', () => {
  const fixture = buildFixture();
  try {
    const entry = {
      priority: 1,
      id: 'F1',
      statement: 'docs/feature.md exists.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C1', path: 'docs/feature.md' })],
      satisfied: false,
    };
    const decision = frontierDecision({
      considered: [entry],
      selected: {
        priority: 1,
        id: 'F1',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'only frontier',
        goal: goalFor({
          criteria: entry.criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1'],
              allow: ['docs/feature.md'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
        }),
      },
    });
    const { result, selector } = runBuildOn(fixture, { decision });
    // The deterministic run-goal bookkeeping surface is present and untouched.
    for (const key of [
      'status',
      'criteria',
      'criteriaAtStart',
      'selection',
      'attempts',
      'batches',
      'budget',
      'planner',
      'liveMain',
      'canonicalCheckout',
      'childCalls',
    ]) {
      assert.ok(
        Object.hasOwn(result.goalResult, key),
        `run-goal result field ${key} must be present`,
      );
    }
    assert.equal(result.goalResult.maxBatchConcurrency, MAX_BATCH_CONCURRENCY);
    // BUILD invoked the selector exactly once and the goal loop exactly once.
    assert.equal(selector.calls.length, 1);
  } finally {
    removeFixture(fixture);
  }
});

// ---------------------------------------------------------------------------
// F. fixture lifetime ownership
// ---------------------------------------------------------------------------

test('CASE F1 — a passing fixture body removes every owned directory', () => {
  let recorded = null;
  const value = withFixture((fixture) => {
    recorded = [fixture.root, fixture.bare, fixture.requestDir];
    assert.ok(recorded.every((target) => existsSync(target)));
    return 'body-result';
  });
  assert.equal(value, 'body-result');
  assert.deepEqual(
    recorded.filter((target) => existsSync(target)),
    [],
  );
});

test('CASE F2 — an exception path still removes the fixture and rethrows the body error', () => {
  let recorded = null;
  const sentinel = new Error('simulated assertion failure');
  assert.throws(
    () =>
      withFixture((fixture) => {
        recorded = [fixture.root, fixture.bare, fixture.requestDir];
        throw sentinel;
      }),
    (error) => error === sentinel,
  );
  assert.deepEqual(
    recorded.filter((target) => existsSync(target)),
    [],
  );
});

test('CASE F3 — a fixture setup failure removes the directories it already created', () => {
  const failingGit = (cwd, args) => {
    if (args[0] === 'commit') throw new Error('simulated setup failure');
    return git(cwd, args);
  };
  let captured = null;
  try {
    buildFixture({ gitImpl: failingGit });
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof Error);
  assert.match(captured.message, /simulated setup failure/);
  assert.ok(Array.isArray(captured.fixturePaths));
  assert.deepEqual(
    captured.fixturePaths.filter((target) => existsSync(target)),
    [],
  );
  assert.equal(captured.fixtureCleanupErrors, undefined);
});

test('CASE F4 — a cleanup failure is surfaced instead of being treated as success', () => {
  const fixture = buildFixture();
  try {
    assert.throws(
      () => removeFixture(fixture, { removeTree: () => {} }),
      /fixture cleanup failed: .*fixture path still exists/,
    );
  } finally {
    removeFixture(fixture);
  }
});

test('CASE F5 — fixture removal touches only its own recorded paths', () => {
  const foreign = mkdtempSync(join(tmpdir(), 'greenhub-run-build-spec-foreign-'));
  const fixture = buildFixture();
  try {
    writeFileSync(join(foreign, 'marker.txt'), 'foreign state\n');
    removeFixture(fixture);
    assert.equal(existsSync(join(foreign, 'marker.txt')), true);
  } finally {
    removeTreeRobust(foreign);
  }
});

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------

test('CASE CLI1 — main() reads an explicit request file and prints one JSON result', () => {
  const fixture = buildFixture();
  try {
    const requestFile = requestFileFor(fixture, DEFAULT_REQUEST);
    const entry = {
      priority: 1,
      id: 'F1',
      statement: 'docs/feature.md exists.',
      kind: 'PRODUCT',
      criteria: [criterion({ id: 'C1', path: 'docs/feature.md' })],
      satisfied: false,
    };
    const decision = frontierDecision({
      considered: [entry],
      selected: {
        priority: 1,
        id: 'F1',
        statement: entry.statement,
        kind: 'PRODUCT',
        why_selected: 'only frontier',
        goal: goalFor({
          criteria: entry.criteria,
          tasks: [
            task({
              id: 'T1',
              closes: ['C1'],
              allow: ['docs/feature.md'],
              proof: ['node proof-feature.cjs'],
            }),
          ],
        }),
      },
    });
    const selector = createFakeSelector({ decision });
    const fake = createFakeChildren({
      runPublishBehavior: (options) => {
        pushCommitToLiveMain(fixture, { path: options.allowedPaths[0], content: 'deliverable\n' });
        return { status: 'SUCCESS_PUBLISHED', reason: 'fake publication' };
      },
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    const code = main(['--request', requestFile, '--repo', fixture.root], {
      stdout: { write: (chunk) => stdoutChunks.push(chunk) },
      stderr: { write: (chunk) => stderrChunks.push(chunk) },
      deps: { log: () => {}, ...selector.deps, ...fake.deps },
    });
    assert.equal(code, 0);
    const payload = JSON.parse(stdoutChunks.join(''));
    assert.equal(payload.status, FRONTIER_COMPLETE);
    assert.equal(payload.request.source, 'file');
    assert.match(stderrChunks.join(''), /NEXT_FRONTIER_SELECTED NO/);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE CLI2 — main() rejects an invalid argument surface without any invocation', () => {
  const stdoutChunks = [];
  const stderrChunks = [];
  const code = main(['--unknown'], {
    stdout: { write: (chunk) => stdoutChunks.push(chunk) },
    stderr: { write: (chunk) => stderrChunks.push(chunk) },
  });
  assert.equal(code, 1);
  const payload = JSON.parse(stdoutChunks.join(''));
  assert.equal(payload.status, INVALID_BUILD_REQUEST);
  assert.match(stderrChunks.join(''), /unknown argument/);
});
