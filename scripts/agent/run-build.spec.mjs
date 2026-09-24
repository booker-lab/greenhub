// Focused deterministic proof for scripts/agent/run-build.mjs.
//
// Uses temp local git repositories + temp bare remotes and injected selector /
// child seams. No GitHub, no real OpenCode process, no real publication, and no
// mutation of the Greenhub checkout. The same admission/execution/publication
// path is the real run-goal path; only OpenCode and the publication transport
// are replaced by deterministic stand-ins.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  ALREADY_SATISFIED,
  BLOCKED_EXTERNAL,
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
} from './run-build.mjs';
import { MAX_BATCH_CONCURRENCY } from './run-goal.mjs';

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
function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'greenhub-run-build-spec-'));
  const bare = mkdtempSync(join(tmpdir(), 'greenhub-run-build-spec-remote-'));
  const requestDir = mkdtempSync(join(tmpdir(), 'greenhub-run-build-spec-requests-'));
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
    git(root, ['commit', '-m', 'base']);
    const baseSha = git(root, ['rev-parse', 'HEAD']);
    git(root, ['remote', 'add', 'origin', bare]);
    git(root, ['push', '-u', 'origin', 'main']);
    return { root, bare, requestDir, baseSha };
  } catch (error) {
    git(root, ['worktree', 'prune']);
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
  rmSync(fixture.requestDir, { recursive: true, force: true });
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
    rmSync(clone, { recursive: true, force: true });
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

function listSelectorWorkspaceDirs() {
  return readdirSync(tmpdir())
    .filter((name) => name.startsWith('greenhub-run-build-selector-'))
    .sort();
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
  authorityResolved = ['docs/authority.md', 'docs/BACKLOG.md'],
  reason = 'select the highest-priority open frontier',
}) {
  return {
    status: 'FRONTIER',
    reason,
    authority_resolved: authorityResolved,
    considered,
    selected,
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
    assert.equal(listSelectorWorkspaceDirs().length, 0);
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
    const { result, fake } = runBuildOn(fixture, {
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
    assert.equal(listSelectorWorkspaceDirs().length, 0);
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
