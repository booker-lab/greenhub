// Focused regression proof for scripts/agent/run-once.mjs.
// Uses temp local git repositories + temp bare remotes and injected narrow
// process seams. No GitHub, no publication, no real OpenCode process, and no
// mutation of the Greenhub checkout.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
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
import { fileURLToPath } from 'node:url';

import {
  ALREADY_SATISFIED,
  BOUNDARY_VIOLATION,
  buildChildEnv,
  buildOpencodeArgs,
  buildTaskPrompt,
  CLEANUP_FAILED,
  classifyChangedPaths,
  defaultRemoveWorkspace,
  EXECUTOR_FAILED,
  extractWindowsShimTarget,
  gitCapture,
  HEADLESS_MODE,
  INVALID_INPUT,
  isPathAllowed,
  OPENCODE_ATTACH_URL_ENV,
  PROOF_FAILED,
  parseArgs,
  parseVisibleAttachUrl,
  probeVisibleServer,
  RUN_ONCE_STATUSES,
  resolveOpencodeCommand,
  runOnce,
  SUCCESS,
  VISIBLE_TUI_MODE,
} from './run-once.mjs';
import {
  CODEX_EXECUTOR,
  DEFAULT_CODEX_TIMEOUT_MS,
} from './agent-executor.mjs';

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
  git(directory, ['config', 'user.email', 'run-once-spec@local']);
  git(directory, ['config', 'user.name', 'run-once-spec']);
  git(directory, ['config', 'commit.gpgsign', 'false']);
}

/** Canonical checkout + real bare remote, with a clean live `main`. */
function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'greenhub-run-once-spec-'));
  const bare = mkdtempSync(join(tmpdir(), 'greenhub-run-once-spec-remote-'));
  try {
    git(bare, ['init', '--bare', '-b', 'main']);
    initRepository(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'base.txt'), 'base\n');
    writeFileSync(join(root, 'README.md'), 'base\n');
    writeFileSync(
      join(root, 'proof-check.cjs'),
      "const { readFileSync } = require('node:fs');\nconst content = readFileSync('src/allowed.txt', 'utf8');\nif (content !== 'ok\\n') process.exit(1);\n",
    );
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'base']);
    const baseSha = git(root, ['rev-parse', 'HEAD']);
    git(root, ['remote', 'add', 'origin', bare]);
    git(root, ['push', '-u', 'origin', 'main']);
    return { root, bare, baseSha };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
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
}

function runOptions(fixture, overrides = {}) {
  return {
    repositoryRoot: fixture.root,
    remote: 'origin',
    taskText: [
      'OUTCOME: make the bounded change',
      'PRESERVE: unrelated paths',
      'PROOF: focused command',
      'ESCALATE ONLY IF: the boundary is unclear',
    ].join('\n'),
    allowedPaths: ['src'],
    proofCommands: [],
    ...overrides,
  };
}

/** Narrow process seam: records the invocation and mutates only the workspace. */
function createFakeOpencode({ writes = [], fail = false, proofCalls = null } = {}) {
  const invocations = [];
  const invokeOpencode = (invocation) => {
    const snapshot = {
      cwd: invocation.cwd,
      head: git(invocation.cwd, ['rev-parse', 'HEAD']),
      branch: git(invocation.cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
      status: gitRaw(invocation.cwd, ['status', '--porcelain=v1']),
      args: invocation.args,
      env: invocation.env,
    };
    invocations.push(snapshot);
    for (const entry of writes) {
      const absolute = join(invocation.cwd, entry.path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, entry.content);
    }
    if (proofCalls) proofCalls.cwd = invocation.cwd;
    if (fail) {
      return {
        exitCode: 1,
        signal: null,
        timedOut: false,
        startErrorCode: null,
        stdout: '',
        stderr: 'simulated executor failure',
      };
    }
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      startErrorCode: null,
      stdout: '{"type":"result"}',
      stderr: '',
    };
  };
  return { invocations, invokeOpencode };
}

function codexJsonlOutput(text = '완료') {
  return [
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'turn.started', turn_id: 'turn-1' },
    { type: 'item.completed', item: { id: 'message-1', type: 'agent_message', text } },
    { type: 'turn.completed', turn_id: 'turn-1', status: 'completed' },
  ].map((event) => JSON.stringify(event)).join('\n') + '\n';
}

function codexOutputWithoutFinalMessage() {
  return [
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'turn.started', turn_id: 'turn-1' },
    { type: 'turn.completed', turn_id: 'turn-1', status: 'completed' },
  ].map((event) => JSON.stringify(event)).join('\n') + '\n';
}

function listRunOnceTempDirs() {
  return readdirSync(tmpdir())
    .filter((name) => name.startsWith('greenhub-run-once-'))
    .sort();
}

function listRegisteredWorktrees(repositoryRoot) {
  return git(repositoryRoot, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
}

test('CASE 1 — exact live-main baseline workspace is created detached and clean', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const result = runOnce(runOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      log: () => {},
    });
    assert.equal(result.status, SUCCESS);
    assert.equal(result.baseline.liveMainAtStart, fixture.baseSha);
    assert.equal(result.baseline.baselineSha, fixture.baseSha);
    assert.equal(result.baseline.baselineMatchesLiveMainAtStart, true);
    assert.equal(fake.invocations.length, 1);
    assert.notEqual(fake.invocations[0].cwd, fixture.root);
    assert.equal(fake.invocations[0].head, fixture.baseSha);
    assert.equal(fake.invocations[0].branch, 'HEAD');
    assert.equal(fake.invocations[0].status, '');
    assert.deepEqual(result.changedPaths, ['src/allowed.txt']);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE 2 — canonical checkout is never switched, reset, or restaged', () => {
  const fixture = buildFixture();
  try {
    git(fixture.root, ['checkout', '-b', 'work']);
    const headBefore = git(fixture.root, ['rev-parse', 'HEAD']);
    const statusBefore = gitRaw(fixture.root, ['status', '--porcelain=v1']);
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const result = runOnce(runOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      log: () => {},
    });

    assert.equal(result.status, SUCCESS);
    assert.equal(result.canonicalCheckout.unchanged, true);
    assert.equal(git(fixture.root, ['branch', '--show-current']), 'work');
    assert.equal(git(fixture.root, ['rev-parse', 'HEAD']), headBefore);
    assert.equal(gitRaw(fixture.root, ['status', '--porcelain=v1']), statusBefore);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE 3 — foreign dirty state is preserved exactly', () => {
  const fixture = buildFixture();
  try {
    writeFileSync(join(fixture.root, 'src', 'base.txt'), 'foreign tracked modification\n');
    writeFileSync(join(fixture.root, 'foreign-untracked.txt'), 'foreign untracked\n');
    const statusBefore = gitRaw(fixture.root, ['status', '--porcelain=v1']);
    const trackedBefore = readFileSync(join(fixture.root, 'src', 'base.txt'), 'utf8');
    const untrackedBefore = readFileSync(join(fixture.root, 'foreign-untracked.txt'), 'utf8');

    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const result = runOnce(runOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      log: () => {},
    });

    assert.equal(result.status, SUCCESS);
    assert.equal(gitRaw(fixture.root, ['status', '--porcelain=v1']), statusBefore);
    assert.equal(readFileSync(join(fixture.root, 'src', 'base.txt'), 'utf8'), trackedBefore);
    assert.equal(
      readFileSync(join(fixture.root, 'foreign-untracked.txt'), 'utf8'),
      untrackedBefore,
    );
  } finally {
    removeFixture(fixture);
  }
});

test('C1/C2 — unrelated caller checkout movement during the run never fails the task', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const movingInvoke = (invocation) => {
      // Deterministic stand-in for an unrelated concurrent process that moves
      // the shared caller checkout (branch + HEAD + unrelated dirty state)
      // while this task-owned invocation is running.
      git(fixture.root, ['checkout', '-b', 'foreign-movement']);
      git(fixture.root, ['commit', '--allow-empty', '-m', 'foreign movement']);
      writeFileSync(join(fixture.root, 'foreign-untracked.txt'), 'foreign\n');
      return fake.invokeOpencode(invocation);
    };
    const result = runOnce(runOptions(fixture), {
      invokeOpencode: movingInvoke,
      log: () => {},
    });

    assert.equal(result.status, SUCCESS);
    assert.equal(result.canonicalCheckout.unchanged, false);
    // Caller checkout movement is distinct from live-main authority.
    assert.equal(result.baselineMovement, 'UNCHANGED');
    assert.deepEqual(result.changedPaths, ['src/allowed.txt']);
    assert.equal(fake.invocations.length, 1);
    assert.equal(git(fixture.root, ['branch', '--show-current']), 'foreign-movement');
    assert.equal(readFileSync(join(fixture.root, 'foreign-untracked.txt'), 'utf8'), 'foreign\n');
  } finally {
    removeFixture(fixture);
  }
});

test('C1b — an unobservable caller checkout state is diagnostic, not task failure', () => {
  const fixture = buildFixture();
  try {
    git(fixture.root, ['symbolic-ref', 'HEAD', 'refs/heads/not-created-yet']);
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const result = runOnce(runOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      log: () => {},
    });

    assert.equal(result.status, SUCCESS);
    assert.equal(result.canonicalCheckout.before, null);
    assert.equal(result.canonicalCheckout.unchanged, null);
    assert.equal(typeof result.canonicalCheckout.observationError, 'string');
    assert.deepEqual(result.changedPaths, ['src/allowed.txt']);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE 4 — OpenCode is invoked exactly once per run, including failure paths', () => {
  const successFixture = buildFixture();
  const violationFixture = buildFixture();
  try {
    const successFake = createFakeOpencode({
      writes: [{ path: 'src/allowed.txt', content: 'ok\n' }],
    });
    runOnce(runOptions(successFixture), {
      invokeOpencode: successFake.invokeOpencode,
      log: () => {},
    });
    assert.equal(successFake.invocations.length, 1);

    const violationFake = createFakeOpencode({
      writes: [{ path: 'outside.txt', content: 'no\n' }],
    });
    runOnce(runOptions(violationFixture), {
      invokeOpencode: violationFake.invokeOpencode,
      log: () => {},
    });
    assert.equal(violationFake.invocations.length, 1);
  } finally {
    removeFixture(successFixture);
    removeFixture(violationFixture);
  }
});

test('CASE 5 — changes inside --allow pass the Git-observed boundary', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({
      writes: [
        { path: 'src/new/deep/file.txt', content: 'a\n' },
        { path: 'src/base.txt', content: 'modified\n' },
      ],
    });
    const result = runOnce(runOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      log: () => {},
    });
    assert.equal(result.status, SUCCESS);
    assert.deepEqual(result.boundary.violations, []);
    assert.deepEqual(result.changedPaths, ['src/base.txt', 'src/new/deep/file.txt']);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE 6 — changes outside --allow fail closed without hiding the change', () => {
  const fixture = buildFixture();
  try {
    const statusBefore = gitRaw(fixture.root, ['status', '--porcelain=v1']);
    const fake = createFakeOpencode({
      writes: [
        { path: 'src/allowed.txt', content: 'ok\n' },
        { path: 'outside.txt', content: 'forbidden\n' },
      ],
    });
    const result = runOnce(runOptions(fixture, { proofCommands: ['SHOULD_NOT_RUN'] }), {
      invokeOpencode: fake.invokeOpencode,
      runProofCommand: () => {
        throw new Error('proofs must not run after a boundary violation');
      },
      log: () => {},
    });

    assert.equal(result.status, BOUNDARY_VIOLATION);
    assert.deepEqual(result.boundary.violations, ['outside.txt']);
    assert.deepEqual(result.boundary.withinBoundary, ['src/allowed.txt']);
    assert.equal(result.proofResults.length, 0);
    assert.equal(gitRaw(fixture.root, ['status', '--porcelain=v1']), statusBefore);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE 7 — caller proofs run in order inside the workspace after the child', () => {
  const fixture = buildFixture();
  try {
    const proofCalls = {};
    const fake = createFakeOpencode({
      writes: [{ path: 'src/allowed.txt', content: 'ok\n' }],
      proofCalls,
    });
    const executed = [];
    const result = runOnce(runOptions(fixture, { proofCommands: ['proof-one', 'proof-two'] }), {
      invokeOpencode: fake.invokeOpencode,
      runProofCommand: ({ command, cwd }) => {
        executed.push(command);
        assert.equal(cwd, fake.invocations[0].cwd);
        assert.equal(readFileSync(join(cwd, 'src', 'allowed.txt'), 'utf8'), 'ok\n');
        return { exitCode: 0, signal: null, timedOut: false, stdout: `${command}:ok`, stderr: '' };
      },
      log: () => {},
    });

    assert.equal(result.status, SUCCESS);
    assert.deepEqual(executed, ['proof-one', 'proof-two']);
    assert.deepEqual(
      result.proofResults.map((entry) => entry.command),
      ['proof-one', 'proof-two'],
    );
    assert.ok(result.proofResults.every((entry) => entry.ok));
  } finally {
    removeFixture(fixture);
  }
});

test('CASE 7b — no changes plus passing proof reports ALREADY_SATISFIED', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({});
    const result = runOnce(runOptions(fixture, { proofCommands: ['noop'] }), {
      invokeOpencode: fake.invokeOpencode,
      runProofCommand: () => ({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: '',
        stderr: '',
      }),
      log: () => {},
    });
    assert.equal(result.status, ALREADY_SATISFIED);
    assert.deepEqual(result.changedPaths, []);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE 8 — a failing proof is never treated as success', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const executed = [];
    const result = runOnce(
      runOptions(fixture, { proofCommands: ['pass-one', 'FAIL-ONE', 'pass-two'] }),
      {
        invokeOpencode: fake.invokeOpencode,
        runProofCommand: ({ command }) => {
          executed.push(command);
          return command === 'FAIL-ONE'
            ? { exitCode: 1, signal: null, timedOut: false, stdout: '', stderr: 'proof failed' }
            : { exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '' };
        },
        log: () => {},
      },
    );

    assert.equal(result.status, PROOF_FAILED);
    assert.deepEqual(executed, ['pass-one', 'FAIL-ONE', 'pass-two']);
    assert.equal(result.proofResults[1].ok, false);
    assert.equal(result.proofResults.filter((entry) => entry.ok).length, 2);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE 8b — default proof runner executes the caller command in the workspace', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const passing = runOnce(runOptions(fixture, { proofCommands: ['node proof-check.cjs'] }), {
      invokeOpencode: fake.invokeOpencode,
      log: () => {},
    });
    assert.equal(passing.status, SUCCESS);
    assert.equal(passing.proofResults[0].exitCode, 0);

    const failing = runOnce(
      runOptions(fixture, { proofCommands: ['node --definitely-not-a-flag'] }),
      {
        invokeOpencode: fake.invokeOpencode,
        log: () => {},
      },
    );
    assert.equal(failing.status, PROOF_FAILED);
    assert.notEqual(failing.proofResults[0].exitCode, 0);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE 9 — OpenCode failure reports EXECUTOR_FAILED and still cleans up', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({
      writes: [{ path: 'outside.txt', content: 'also forbidden\n' }],
      fail: true,
    });
    const result = runOnce(runOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      log: () => {},
    });
    assert.equal(result.status, EXECUTOR_FAILED);
    assert.equal(result.executor.invoked, true);
    assert.equal(result.executor.exitCode, 1);
    assert.equal(result.workspace.cleanup, 'REMOVED');
    assert.equal(existsSync(result.workspace.path), false);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE 10 — success cleanup removes the task-owned workspace only', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const result = runOnce(runOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      log: () => {},
    });
    assert.equal(result.status, SUCCESS);
    assert.equal(result.workspace.cleanup, 'REMOVED');
    assert.deepEqual(result.workspace.cleanupErrors, []);
    assert.equal(existsSync(result.workspace.path), false);
    assert.equal(listRegisteredWorktrees(fixture.root).length, 1);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE 11 — failure path cleanup runs too', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'outside.txt', content: 'forbidden\n' }] });
    const result = runOnce(runOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      log: () => {},
    });
    assert.equal(result.status, BOUNDARY_VIOLATION);
    assert.equal(result.workspace.cleanup, 'REMOVED');
    assert.equal(existsSync(result.workspace.path), false);
    assert.equal(listRegisteredWorktrees(fixture.root).length, 1);
  } finally {
    removeFixture(fixture);
  }
});

test('CASE 12 — cleanup failure is reported, not hidden', () => {
  const fixture = buildFixture();
  let leftoverRoot = null;
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const result = runOnce(runOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      removeWorkspace: () => ({ removed: false, errors: ['simulated cleanup failure'] }),
      log: () => {},
    });
    leftoverRoot = dirname(result.workspace.path);

    assert.equal(result.status, CLEANUP_FAILED);
    assert.equal(result.workspace.cleanup, 'FAILED');
    assert.deepEqual(result.workspace.cleanupErrors, ['simulated cleanup failure']);
  } finally {
    if (leftoverRoot !== null) rmSync(leftoverRoot, { recursive: true, force: true });
    removeFixture(fixture);
  }
});

test('CASE 12b — cleanup failure does not mask an earlier failure status', () => {
  const fixture = buildFixture();
  let leftoverRoot = null;
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'outside.txt', content: 'forbidden\n' }] });
    const result = runOnce(runOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      removeWorkspace: () => ({ removed: false, errors: ['simulated cleanup failure'] }),
      log: () => {},
    });
    leftoverRoot = dirname(result.workspace.path);

    assert.equal(result.status, BOUNDARY_VIOLATION);
    assert.equal(result.workspace.cleanup, 'FAILED');
    assert.deepEqual(result.workspace.cleanupErrors, ['simulated cleanup failure']);
  } finally {
    if (leftoverRoot !== null) rmSync(leftoverRoot, { recursive: true, force: true });
    removeFixture(fixture);
  }
});

function normalizeWorktreePath(value) {
  return String(value).replace(/\\/g, '/').replace(/\/+$/, '');
}

function isRegisteredWorktree(repositoryRoot, target) {
  const normalized = normalizeWorktreePath(target);
  return listRegisteredWorktrees(repositoryRoot).some(
    (entry) => normalizeWorktreePath(entry) === normalized,
  );
}

/** A task-owned temp root + detached worktree, created the same way run-once does. */
function createOwnedWorkspace(fixture, { depth = 0 } = {}) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'greenhub-run-once-'));
  const workspace = join(tempRoot, 'workspace');
  git(fixture.root, ['worktree', 'add', '--detach', workspace, fixture.baseSha]);
  let deepest = workspace;
  while (depth > 0 && join(deepest, 'leaf.txt').length < depth) {
    deepest = join(deepest, `nested-${deepest.length.toString(36)}-xxxxxxxxxxxxxxxx`);
    mkdirSync(deepest, { recursive: true });
  }
  const deepestFile = join(deepest, 'leaf.txt');
  if (depth > 0) writeFileSync(deepestFile, 'deep\n');
  return { tempRoot, workspace, deepestFile };
}

/** Test-owned teardown for a workspace fixture; removal failures surface in the test body. */
function removeOwnedWorkspace({ fixture, tempRoot, workspace }) {
  if (process.platform !== 'win32' && existsSync(workspace)) {
    try {
      chmodSync(workspace, 0o755);
    } catch {
      // best-effort permission restore; the removal below reports any real failure
    }
  }
  try {
    rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // fixture teardown continues; the owning test already asserted the verdict
  }
  try {
    git(fixture.root, ['worktree', 'prune']);
  } catch {
    // fixture teardown is best-effort
  }
}

test('CASE 12c — a task-owned workspace deeper than MAX_PATH is fully removed (W1/W2/W6)', () => {
  const fixture = buildFixture();
  const tempBefore = listRunOnceTempDirs();
  let owned = null;
  try {
    owned = createOwnedWorkspace(fixture, { depth: 700 });
    assert.ok(owned.deepestFile.length >= 700);

    const removal = defaultRemoveWorkspace({
      repositoryRoot: fixture.root,
      tempRoot: owned.tempRoot,
      workspacePath: owned.workspace,
    });

    assert.equal(removal.removed, true);
    assert.deepEqual(removal.errors, []);
    assert.deepEqual(removal.attemptErrors, []);
    assert.equal(existsSync(owned.workspace), false);
    assert.equal(existsSync(owned.tempRoot), false);
    assert.equal(isRegisteredWorktree(fixture.root, owned.workspace), false);
    assert.deepEqual(listRunOnceTempDirs(), tempBefore);
  } finally {
    if (owned !== null) removeOwnedWorkspace({ fixture, ...owned });
    removeFixture(fixture);
  }
});

test('CASE 12d — a forced Git removal failure converges through the long-path-safe fallback (W2/W3)', () => {
  const fixture = buildFixture();
  let owned = null;
  try {
    owned = createOwnedWorkspace(fixture);
    const injectedGit = (cwd, args, options) => {
      if (args.includes('worktree') && args.includes('remove')) {
        const error = new Error('injected git worktree remove failure');
        error.stderr = "error: failed to delete 'workspace': Filename too long";
        if (options?.allowFailure) return { ok: false, stdout: '', error };
        throw error;
      }
      return gitCapture(cwd, args, options);
    };
    const target = {
      repositoryRoot: fixture.root,
      tempRoot: owned.tempRoot,
      workspacePath: owned.workspace,
    };

    const removal = defaultRemoveWorkspace(target, { gitCapture: injectedGit });
    assert.equal(removal.removed, true);
    assert.deepEqual(removal.errors, []);
    assert.equal(removal.attemptErrors.length, 1);
    assert.match(removal.attemptErrors[0], /Filename too long/);
    assert.equal(existsSync(owned.workspace), false);
    assert.equal(existsSync(owned.tempRoot), false);
    assert.equal(isRegisteredWorktree(fixture.root, owned.workspace), false);

    const retry = defaultRemoveWorkspace(target);
    assert.equal(retry.removed, true);
    assert.deepEqual(retry.errors, []);
    assert.deepEqual(retry.attemptErrors, []);
  } finally {
    if (owned !== null) removeOwnedWorkspace({ fixture, ...owned });
    removeFixture(fixture);
  }
});

test('CASE 12e — registry-only and filesystem-only residue both converge (W3)', () => {
  const fixture = buildFixture();
  let owned = null;
  let plainRoot = null;
  try {
    owned = createOwnedWorkspace(fixture);
    // Registry-only residue: the filesystem target is gone, the worktree admin
    // entry survives a partial cleanup.
    rmSync(owned.workspace, { recursive: true, force: true });
    assert.equal(isRegisteredWorktree(fixture.root, owned.workspace), true);

    const registryOnly = defaultRemoveWorkspace({
      repositoryRoot: fixture.root,
      tempRoot: owned.tempRoot,
      workspacePath: owned.workspace,
    });
    assert.equal(registryOnly.removed, true);
    assert.deepEqual(registryOnly.errors, []);
    assert.equal(existsSync(owned.tempRoot), false);
    assert.equal(isRegisteredWorktree(fixture.root, owned.workspace), false);
    assert.equal(listRegisteredWorktrees(fixture.root).length, 1);

    // Filesystem-only residue: a plain directory at the workspace path with no
    // registry entry at all.
    plainRoot = mkdtempSync(join(tmpdir(), 'greenhub-run-once-'));
    const plainWorkspace = join(plainRoot, 'workspace');
    mkdirSync(join(plainWorkspace, 'src'), { recursive: true });
    writeFileSync(join(plainWorkspace, 'src', 'x.txt'), 'x\n');

    const filesystemOnly = defaultRemoveWorkspace({
      repositoryRoot: fixture.root,
      tempRoot: plainRoot,
      workspacePath: plainWorkspace,
    });
    assert.equal(filesystemOnly.removed, true);
    assert.deepEqual(filesystemOnly.errors, []);
    assert.ok(
      filesystemOnly.attemptErrors.some((entry) => /git worktree remove failed/.test(entry)),
    );
    assert.equal(existsSync(plainRoot), false);
  } finally {
    if (owned !== null) removeOwnedWorkspace({ fixture, ...owned });
    if (plainRoot !== null) rmSync(plainRoot, { recursive: true, force: true });
    removeFixture(fixture);
  }
});

test('CASE 12f — foreign dirs, foreign worktrees, and foreign live temp roots are preserved (W4/W5)', () => {
  const fixture = buildFixture();
  const foreignDir = join(tmpdir(), `greenhub-run-once-foreign-${process.pid}-dir`);
  const foreignWorktree = join(tmpdir(), `greenhub-run-once-foreign-${process.pid}-worktree`);
  const foreignLiveRoot = join(tmpdir(), `greenhub-run-once-foreign-${process.pid}-live`);
  let owned = null;
  let foreignChild = null;
  try {
    owned = createOwnedWorkspace(fixture);
    mkdirSync(foreignDir, { recursive: true });
    writeFileSync(join(foreignDir, 'marker.txt'), 'foreign\n');
    git(fixture.root, ['worktree', 'add', '--detach', foreignWorktree, fixture.baseSha]);
    mkdirSync(foreignLiveRoot, { recursive: true });
    writeFileSync(join(foreignLiveRoot, 'owned-by-other.txt'), 'other\n');
    foreignChild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000);'], {
      cwd: foreignLiveRoot,
      stdio: 'ignore',
    });

    const removal = defaultRemoveWorkspace({
      repositoryRoot: fixture.root,
      tempRoot: owned.tempRoot,
      workspacePath: owned.workspace,
    });

    assert.equal(removal.removed, true);
    assert.equal(existsSync(foreignDir), true);
    assert.equal(readFileSync(join(foreignDir, 'marker.txt'), 'utf8'), 'foreign\n');
    assert.equal(existsSync(foreignWorktree), true);
    assert.equal(isRegisteredWorktree(fixture.root, foreignWorktree), true);
    assert.equal(existsSync(join(foreignLiveRoot, 'owned-by-other.txt')), true);
  } finally {
    if (foreignChild !== null) foreignChild.kill();
    if (existsSync(foreignWorktree)) {
      gitCapture(
        fixture.root,
        ['-c', 'core.longpaths=true', 'worktree', 'remove', '--force', foreignWorktree],
        { allowFailure: true },
      );
    }
    if (owned !== null) removeOwnedWorkspace({ fixture, ...owned });
    rmSync(foreignDir, { recursive: true, force: true });
    rmSync(foreignWorktree, { recursive: true, force: true });
    rmSync(foreignLiveRoot, { recursive: true, force: true });
    removeFixture(fixture);
  }
});

test('CASE 12g — a genuinely undeletable owned workspace is reported, then converges (W7)', async (t) => {
  const fixture = buildFixture();
  let owned = null;
  let holder = null;
  try {
    owned = createOwnedWorkspace(fixture);
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    if (process.platform === 'win32') {
      const holderScript = [
        "const fs = require('node:fs');",
        "fs.writeFileSync('hold-ready.txt', 'ready');",
        'setTimeout(() => {}, 60000);',
      ].join('\n');
      holder = spawn(process.execPath, ['-e', holderScript], {
        cwd: owned.workspace,
        stdio: 'ignore',
      });
      const deadline = Date.now() + 15000;
      while (!existsSync(join(owned.workspace, 'hold-ready.txt'))) {
        if (Date.now() > deadline) throw new Error('held fixture did not start');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } else if (isRoot) {
      t.skip('root can delete a permission-blocked fixture');
      return;
    } else {
      chmodSync(owned.workspace, 0o555);
    }

    const target = {
      repositoryRoot: fixture.root,
      tempRoot: owned.tempRoot,
      workspacePath: owned.workspace,
    };
    const blocked = defaultRemoveWorkspace(target);
    assert.equal(blocked.removed, false);
    assert.equal(
      blocked.errors.some((entry) => entry.includes(`workspace still exists: ${owned.workspace}`)),
      true,
    );
    assert.ok(blocked.attemptErrors.length > 0);

    if (holder !== null) {
      const exited = new Promise((resolve) => holder.once('exit', resolve));
      holder.kill();
      await exited;
      holder = null;
    } else if (process.platform !== 'win32') {
      chmodSync(owned.workspace, 0o755);
    }

    const retried = defaultRemoveWorkspace(target);
    assert.equal(retried.removed, true);
    assert.deepEqual(retried.errors, []);
    assert.equal(existsSync(owned.workspace), false);
    assert.equal(existsSync(owned.tempRoot), false);
    assert.equal(isRegisteredWorktree(fixture.root, owned.workspace), false);
  } finally {
    if (holder !== null) holder.kill();
    if (owned !== null) removeOwnedWorkspace({ fixture, ...owned });
    removeFixture(fixture);
  }
});

test('CASE 12h — a vanished canonical checkout does not turn task-owned cleanup into a false failure', () => {
  const fixture = buildFixture();
  let owned = null;
  try {
    owned = createOwnedWorkspace(fixture);
    rmSync(fixture.root, { recursive: true, force: true });

    const removal = defaultRemoveWorkspace({
      repositoryRoot: fixture.root,
      tempRoot: owned.tempRoot,
      workspacePath: owned.workspace,
    });

    assert.equal(removal.removed, true);
    assert.deepEqual(removal.errors, []);
    assert.equal(existsSync(owned.workspace), false);
    assert.equal(existsSync(owned.tempRoot), false);
    assert.ok(removal.attemptErrors.some((entry) => /repository root is gone/.test(entry)));
  } finally {
    if (owned !== null) removeOwnedWorkspace({ fixture, ...owned });
    removeFixture(fixture);
  }
});

test('CASE 13 — no durable task or result state is created', () => {
  const fixture = buildFixture();
  try {
    const entriesBefore = readdirSync(fixture.root).sort();
    const tempBefore = listRunOnceTempDirs();
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const result = runOnce(runOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      log: () => {},
    });

    assert.equal(result.status, SUCCESS);
    assert.deepEqual(readdirSync(fixture.root).sort(), entriesBefore);
    assert.deepEqual(listRunOnceTempDirs(), tempBefore);
    assert.equal(existsSync(join(fixture.root, 'scripts', 'coordination')), false);
    assert.equal(existsSync(join(fixture.root, '.greenhub')), false);
    for (const key of ['resultStore', 'taskId', 'cursor', 'receipt', 'attempt']) {
      assert.ok(!(key in result));
    }
  } finally {
    removeFixture(fixture);
  }
});

test('CASE 14 — no retired coordination dependency or vocabulary is reintroduced', () => {
  const source = readFileSync(new URL('./run-once.mjs', import.meta.url), 'utf8');
  const forbidden = [
    /coordination/i,
    /\bclaim/i,
    /\blease\b/i,
    /\bheartbeat\b/i,
    /\breceipt\b/i,
    /\bcursor\b/i,
    /\bdispatch/i,
    /\bscheduler\b/i,
    /\bqueue\b/i,
    /\bregistry\b/i,
    /\bdaemon\b/i,
    /\binbox\b/i,
    /\brelay\b/i,
    /IN_FLIGHT/,
    /control.?tower/i,
  ];
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(source), `run-once.mjs must not contain ${pattern}`);
  }
  assert.ok(!/from '\.\.\/coordination/.test(source));
  assert.equal(existsSync('scripts/coordination'), false);
  assert.equal(existsSync(join('scripts', 'agent', 'coordination')), false);
});

test('boundary classification aligns path prefixes at directory boundaries', () => {
  assert.equal(isPathAllowed('src/a.ts', ['src']), true);
  assert.equal(isPathAllowed('src', ['src']), true);
  assert.equal(isPathAllowed('src/a.ts', ['src/']), true);
  assert.equal(isPathAllowed('./src/a.ts', ['src']), true);
  assert.equal(isPathAllowed('src2/a.ts', ['src']), false);
  assert.equal(isPathAllowed('other/a.ts', ['src', 'apps/consumer']), false);
  assert.deepEqual(
    classifyChangedPaths({ changedPaths: ['src/a.ts', 'other/b.ts'], allowedPaths: ['src'] }),
    { withinBoundary: ['src/a.ts'], violations: ['other/b.ts'] },
  );
});

test('child environment drops operational credentials and hardens git', () => {
  const env = buildChildEnv({
    baseEnv: {
      PATH: '/usr/bin',
      HOME: '/home/operator',
      GH_TOKEN: 'gh',
      GITHUB_TOKEN: 'github',
      VERCEL_TOKEN: 'vercel',
      RAILWAY_TOKEN: 'railway',
      FIREBASE_TOKEN: 'firebase',
      ALIGO_API_KEY: 'aligo',
      PORTONE_SECRET: 'portone',
      GREENHUB_LOCAL_AUTH_SECRET: 'greenhub-secret',
      GREENHUB_LOCAL_SELLER_PASSWORD: 'greenhub-password',
      ANTHROPIC_API_KEY: 'model-provider-key',
      OPENAI_API_KEY: 'openai-model-key',
      CODEX_API_KEY: 'codex-model-key',
      SERVICE_ACCESS_TOKEN: 'service-token-value',
      [OPENCODE_ATTACH_URL_ENV]: 'http://127.0.0.1:4096',
      GIT_CONFIG_COUNT: '99',
      GIT_CONFIG_KEY_0: 'attacker',
      OPENCODE: '1',
      OPENCODE_PID: '1234',
    },
    scratchDir: '/tmp/scratch',
  });

  for (const dropped of [
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'VERCEL_TOKEN',
    'RAILWAY_TOKEN',
    'FIREBASE_TOKEN',
    'ALIGO_API_KEY',
    'PORTONE_SECRET',
    'GREENHUB_LOCAL_AUTH_SECRET',
    'GREENHUB_LOCAL_SELLER_PASSWORD',
    'OPENCODE',
    'OPENCODE_PID',
  ]) {
    assert.equal(env[dropped], undefined, `${dropped} must not reach the child`);
  }
  assert.ok(
    !Object.values(env).includes('attacker'),
    'parent Git config overrides must be dropped',
  );
  assert.equal(env.ANTHROPIC_API_KEY, 'model-provider-key');
  assert.equal(env.OPENAI_API_KEY, 'openai-model-key');
  assert.equal(env.CODEX_API_KEY, 'codex-model-key');
  assert.equal(env.SERVICE_ACCESS_TOKEN, 'service-token-value');
  assert.equal(env[OPENCODE_ATTACH_URL_ENV], 'http://127.0.0.1:4096');
  assert.equal(env.HOME, '/home/operator');
  assert.equal(env.GIT_CONFIG_COUNT, '5');
  assert.equal(env.GIT_CONFIG_KEY_0, 'credential.helper');
  assert.equal(env.GIT_CONFIG_VALUE_0, '');
  assert.equal(env.GIT_CONFIG_KEY_1, 'protocol.allow');
  assert.equal(env.GIT_CONFIG_VALUE_1, 'never');
  assert.equal(env.GIT_CONFIG_KEY_3, 'push.default');
  assert.equal(env.GIT_CONFIG_VALUE_3, 'nothing');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.GH_CONFIG_DIR, join('/tmp/scratch', 'opencode-child-gh-config'));

  const codexEnv = buildChildEnv({
    baseEnv: {
      PATH: '/usr/bin',
      [OPENCODE_ATTACH_URL_ENV]: 'http://127.0.0.1:4096',
      OPENAI_API_KEY: 'openai-model-key',
      CODEX_API_KEY: 'codex-model-key',
    },
    scratchDir: '/tmp/codex-scratch',
    backend: CODEX_EXECUTOR,
  });
  assert.equal(codexEnv[OPENCODE_ATTACH_URL_ENV], undefined);
  assert.equal(codexEnv.OPENAI_API_KEY, undefined);
  assert.equal(codexEnv.CODEX_API_KEY, undefined);
});

test('OpenCode command builder uses one-shot JSON automation flags', () => {
  const args = buildOpencodeArgs({
    taskText: 'contract',
    workspacePath: '/tmp/ws',
    model: 'provider/model',
    agent: 'greenhub',
    title: 'GN-01',
  });
  assert.deepEqual(args.slice(0, 5), ['run', '--format', 'json', '--dir', '/tmp/ws']);
  assert.ok(args.includes('--auto'));
  assert.ok(args.includes('--model') && args.includes('provider/model'));
  assert.ok(args.includes('--agent') && args.includes('greenhub'));
  assert.ok(args.includes('--title') && args.includes('GN-01'));
  assert.equal(args[args.length - 1], 'contract');
});

test('Windows shim resolution finds the real executable behind a cmd shim', () => {
  const toolsDirectory = 'C:\\tools';
  const shimPath = join(toolsDirectory, 'opencode.cmd');
  const exePath = `${toolsDirectory}\\node_modules\\opencode-ai\\bin\\opencode.exe`;
  const resolved = resolveOpencodeCommand({
    explicitBin: null,
    baseEnv: { PATH: toolsDirectory },
    platform: 'win32',
    exists: (candidate) => candidate === shimPath || candidate === exePath,
    readFile: () => '@ECHO off\n"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe" %*\n',
  });
  assert.deepEqual(resolved, { command: exePath, prefixArgs: [], source: 'windows-shim' });

  const scriptPath = `${toolsDirectory}\\node_modules\\pkg\\bin\\cli.js`;
  const scriptTarget = extractWindowsShimTarget({
    shimPath,
    exists: (candidate) => candidate === scriptPath,
    readFile: () =>
      '"C:\\Program Files\\nodejs\\node.exe"  "%dp0%\\node_modules\\pkg\\bin\\cli.js" %*\n',
  });
  assert.deepEqual(scriptTarget, { command: process.execPath, prefixArgs: [scriptPath] });

  assert.throws(
    () =>
      resolveOpencodeCommand({
        explicitBin: 'C:\\missing\\opencode.exe',
        baseEnv: {},
        platform: 'win32',
        exists: () => false,
        readFile: () => '',
      }),
    /--opencode-bin does not exist/,
  );
});

test('Codex mutation은 격리 workspace에서 기존 경계와 proof를 적용하고 secret 출력을 가린다', () => {
  const fixture = buildFixture();
  try {
    const secret = 'codex-test-secret-742';
    let invocation = null;
    let visibleProbeCalls = 0;
    const logs = [];
    const result = runOnce(
      runOptions(fixture, {
        executor: 'codex',
        model: 'gpt-6-luna',
        reasoningEffort: 'max',
        codexTimeoutMs: 5000,
        proofCommands: ['node proof-check.cjs'],
      }),
      {
        env: {
          PATH: process.env.PATH ?? '',
          OPENAI_API_KEY: secret,
          CODEX_API_KEY: 'codex-api-secret-123',
          SERVICE_ACCESS_TOKEN: 'other-auth-secret-456',
          [OPENCODE_ATTACH_URL_ENV]: 'http://127.0.0.1:9',
        },
        probeVisibleServer: () => {
          visibleProbeCalls += 1;
          throw new Error('Codex must not probe OpenCode visibility');
        },
        invokeCodex: (input) => {
          invocation = input;
          assert.equal(input.env.OPENAI_API_KEY, undefined);
          assert.equal(input.env.CODEX_API_KEY, undefined);
          assert.equal(input.env.SERVICE_ACCESS_TOKEN, undefined);
          assert.equal(input.env[OPENCODE_ATTACH_URL_ENV], undefined);
          assert.notEqual(input.cwd, fixture.root);
          assert.ok(input.args.includes('--json'));
          assert.ok(input.args.includes('--sandbox') && input.args.includes('workspace-write'));
          assert.ok(input.args.includes('--model') && input.args.includes('gpt-6-luna'));
          assert.ok(input.args.includes('-c') && input.args.includes('model_reasoning_effort="max"'));
          mkdirSync(join(input.cwd, 'src'), { recursive: true });
          writeFileSync(join(input.cwd, 'src', 'allowed.txt'), 'ok\n');
          return {
            exitCode: 0,
            signal: null,
            timedOut: false,
            startErrorCode: null,
            stdout: codexJsonlOutput(`작업 완료 ${secret}`),
            stderr: `진단 ${secret}`,
          };
        },
        log: (message) => logs.push(String(message)),
      },
    );

    assert.equal(visibleProbeCalls, 0);
    assert.equal(result.status, SUCCESS);
    assert.equal(result.executor.backend, CODEX_EXECUTOR);
    assert.equal(result.executor.selected, CODEX_EXECUTOR);
    assert.equal(result.model, 'gpt-6-luna');
    assert.equal(result.reasoningEffort, 'max');
    assert.equal(result.executor.mode, 'NOT_APPLICABLE_TO_CODEX');
    assert.equal(result.executor.invoked, true);
    assert.deepEqual(result.executor.invocationEvidence.codexArgs, [
      ...(process.platform === 'win32' ? ['-c', 'windows.sandbox="elevated"'] : []),
      '-c',
      'model_reasoning_effort="max"',
      'exec',
      '--ephemeral',
      '--ignore-user-config',
      '--json',
      '--sandbox',
      'workspace-write',
      '--model',
      'gpt-6-luna',
    ]);
    assert.equal(result.executor.invocationEvidence.exitCode, 0);
    assert.ok(invocation.cwd.startsWith(tmpdir()));
    assert.deepEqual(result.changedPaths, ['src/allowed.txt']);
    assert.equal(result.proofResults.length, 1);
    assert.equal(result.proofResults[0].ok, true);
    assert.equal(result.workspace.cleanup, 'REMOVED');
    assert.match(result.executor.stdoutTail, /\[가림\]/);
    assert.match(result.executor.stderrTail, /\[가림\]/);
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(logs.join('\n').includes(secret), false);
  } finally {
    removeFixture(fixture);
  }
});

test('Codex 금지 경로 변경은 boundary 위반이며 JSONL·종료·timeout 오류는 정리 후 실패한다', () => {
  const fixture = buildFixture();
  const baseOptions = runOptions(fixture, { executor: 'codex', codexTimeoutMs: 5 });
  const depsFor = (invokeCodex) => ({ invokeCodex, log: () => {} });
  try {
    const violation = runOnce(baseOptions, depsFor((input) => {
      mkdirSync(join(input.cwd, 'outside'), { recursive: true });
      writeFileSync(join(input.cwd, 'outside', 'escape.txt'), 'outside boundary\n');
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        startErrorCode: null,
        stdout: codexJsonlOutput('완료'),
        stderr: '',
      };
    }));
    assert.equal(violation.status, BOUNDARY_VIOLATION);
    assert.deepEqual(violation.boundary.violations, ['outside/escape.txt']);
    assert.equal(violation.workspace.cleanup, 'REMOVED');

    const failures = [
      ['malformed JSONL', { exitCode: 0, stdout: '{broken}\n', timedOut: false }],
      ['missing final output', { exitCode: 0, stdout: codexOutputWithoutFinalMessage(), timedOut: false }],
      ['nonzero exit', { exitCode: 7, stdout: codexJsonlOutput('완료'), timedOut: false }],
      ['timeout', { exitCode: null, stdout: codexJsonlOutput('완료'), timedOut: true }],
    ];
    for (const [label, execution] of failures) {
      const result = runOnce(baseOptions, depsFor(() => ({
        signal: null,
        startErrorCode: null,
        stderr: '',
        ...execution,
      })));
      assert.equal(result.status, EXECUTOR_FAILED, label);
      assert.equal(result.proofResults.length, 0, label);
      assert.equal(result.workspace.cleanup, 'REMOVED', label);
    }
  } finally {
    removeFixture(fixture);
  }
});

test('parseArgs accepts repeated flags with safe defaults', () => {
  const parsed = parseArgs([
    '--task',
    'task.md',
    '--allow',
    'src',
    '--allow',
    'scripts/agent',
    '--proof',
    'node --test one',
    '--proof',
    'node --test two',
    '--title',
    'GN-01',
    '--repo',
    'C:\\repo',
  ]);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.options.allowedPaths, ['src', 'scripts/agent']);
  assert.deepEqual(parsed.options.proofCommands, ['node --test one', 'node --test two']);
  assert.equal(parsed.options.repositoryRoot, 'C:\\repo');
  assert.equal(parsed.options.remote, 'origin');
  assert.ok(parsed.options.opencodeTimeoutMs > 0);
  assert.equal(parsed.options.codexTimeoutMs, DEFAULT_CODEX_TIMEOUT_MS);
  assert.equal(
    parseArgs(['--task', 'task.md', '--allow', 'src', '--executor', 'codex']).options.executor,
    'codex',
  );
  assert.equal(
    parseArgs([
      '--task',
      'task.md',
      '--allow',
      'src',
      '--executor',
      'codex',
      '--reasoning-effort',
      'max',
    ]).options.reasoningEffort,
    'max',
  );
  assert.equal(
    parseArgs([
      '--task',
      'task.md',
      '--allow',
      'src',
      '--reasoning-effort',
      'ultra',
    ]).ok,
    false,
  );

  assert.equal(parseArgs(['--task', 'task.md']).ok, false);
  assert.equal(parseArgs(['--allow', 'src']).ok, false);
  assert.equal(parseArgs(['--task', 'task.md', '--allow', 'src', '--bogus']).ok, false);
  assert.equal(parseArgs(['--task', 'task.md', '--allow', 'src', '--proof']).ok, false);
});

test('invalid input is rejected before any Git or process effect', () => {
  const result = runOnce(
    { repositoryRoot: process.cwd(), allowedPaths: [], taskText: '' },
    {
      invokeOpencode: () => {
        throw new Error('must not be invoked');
      },
      log: () => {},
    },
  );
  assert.equal(result.status, INVALID_INPUT);
  assert.deepEqual(result.changedPaths, []);
  assert.equal(result.workspace.cleanup, 'NOT_CREATED');
  assert.ok(RUN_ONCE_STATUSES.includes(INVALID_INPUT));
  assert.equal(RUN_ONCE_STATUSES.length, 8);
});

test('task prompt carries the contract and the execution boundary', () => {
  const prompt = buildTaskPrompt({
    taskText: 'OUTCOME: x\nPRESERVE: y\nPROOF: z\nESCALATE ONLY IF: w',
    allowedPaths: ['src', 'scripts/agent'],
  });
  assert.match(prompt, /OUTCOME: x/);
  assert.match(prompt, /Allowed paths[^\n]*src, scripts\/agent/);
  assert.match(prompt, /Do not run git push/);
});

function visibleEnv(attachUrl) {
  return { PATH: process.env.PATH, [OPENCODE_ATTACH_URL_ENV]: attachUrl };
}

function createDisposalRecorder({ ok = true, error = null, calls = [] } = {}) {
  return (args) => {
    calls.push(args);
    return { attempted: true, ok, error };
  };
}

function createPreflightRecorder({ ok = true, error = null, calls = [] } = {}) {
  return (args) => {
    calls.push(args);
    return { attempted: true, ok, error: ok ? null : (error ?? 'simulated unhealthy server') };
  };
}

function titleOf(invocation) {
  return invocation.args[invocation.args.indexOf('--title') + 1];
}

test('VISIBLE_TUI A ??headless mode is byte-identical when no attach URL is configured', () => {
  const args = buildOpencodeArgs({
    taskText: 'contract',
    workspacePath: '/tmp/ws',
    model: 'provider/model',
    agent: 'greenhub',
    title: 'GN-01',
  });
  assert.deepEqual(args, [
    'run',
    '--format',
    'json',
    '--dir',
    '/tmp/ws',
    '--auto',
    '--model',
    'provider/model',
    '--agent',
    'greenhub',
    '--title',
    'GN-01',
    'contract',
  ]);
  assert.ok(!args.includes('--attach'));

  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const result = runOnce(runOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      env: { PATH: process.env.PATH },
      log: () => {},
    });
    assert.equal(result.status, SUCCESS);
    assert.equal(result.executor.mode, HEADLESS_MODE);
    assert.equal(result.executor.attachUrl, null);
    assert.equal(result.executor.preflight, 'NOT_ATTEMPTED');
    assert.equal(result.executor.instanceDisposal, 'NOT_ATTEMPTED');
    assert.ok(!fake.invocations[0].args.includes('--attach'));
  } finally {
    removeFixture(fixture);
  }
});

test('VISIBLE_TUI B ??a loopback attach URL produces one attached invocation with preserved semantics', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const preflightCalls = [];
    const result = runOnce(
      runOptions(fixture, { title: 'OV-01 task A', model: 'provider/model', agent: 'greenhub' }),
      {
        invokeOpencode: fake.invokeOpencode,
        probeVisibleServer: createPreflightRecorder({ calls: preflightCalls }),
        disposeVisibleInstance: createDisposalRecorder(),
        env: visibleEnv('http://127.0.0.1:4096'),
        log: () => {},
      },
    );

    assert.equal(result.status, SUCCESS);
    assert.equal(result.executor.mode, VISIBLE_TUI_MODE);
    assert.equal(result.executor.attachUrl, 'http://127.0.0.1:4096');
    assert.equal(result.executor.preflight, 'HEALTHY');
    assert.equal(preflightCalls.length, 1);
    assert.equal(preflightCalls[0].attachUrl, 'http://127.0.0.1:4096');
    assert.equal(fake.invocations.length, 1);
    const invocation = fake.invocations[0];
    assert.deepEqual(invocation.args.slice(0, 8), [
      'run',
      '--attach',
      'http://127.0.0.1:4096',
      '--format',
      'json',
      '--dir',
      invocation.cwd,
      '--auto',
    ]);
    assert.ok(invocation.args.includes('--model') && invocation.args.includes('provider/model'));
    assert.ok(invocation.args.includes('--agent') && invocation.args.includes('greenhub'));
    assert.equal(titleOf(invocation), 'OV-01 task A');
    assert.match(invocation.args[invocation.args.length - 1], /^Execute exactly one bounded task/);
    assert.equal(result.baseline.baselineSha, fixture.baseSha);
    assert.deepEqual(result.changedPaths, ['src/allowed.txt']);
    assert.equal(result.workspace.cleanup, 'REMOVED');
  } finally {
    removeFixture(fixture);
  }
});

test('VISIBLE_TUI B2 ??loopback host variants are accepted and normalized to a bare origin', () => {
  assert.deepEqual(parseVisibleAttachUrl('http://127.0.0.1:4096'), {
    ok: true,
    url: 'http://127.0.0.1:4096',
  });
  assert.deepEqual(parseVisibleAttachUrl('http://localhost:4096/'), {
    ok: true,
    url: 'http://localhost:4096',
  });
  assert.deepEqual(parseVisibleAttachUrl('http://[::1]:4096'), {
    ok: true,
    url: 'http://[::1]:4096',
  });
  assert.deepEqual(parseVisibleAttachUrl('  http://LOCALHOST:4096  '), {
    ok: true,
    url: 'http://localhost:4096',
  });
  assert.deepEqual(parseVisibleAttachUrl('http://127.0.0.1'), {
    ok: true,
    url: 'http://127.0.0.1',
  });
});

test('VISIBLE_TUI C ??non-loopback or malformed attach targets fail closed before any effect', () => {
  for (const target of [
    'http://192.168.0.10:4096',
    'http://10.0.0.5:4096',
    'http://0.0.0.0:4096',
    'http://localhost.evil.example:4096',
    'https://opencode.example.com',
    'ftp://127.0.0.1:4096',
    'http://user:pass@127.0.0.1:4096',
    'http://127.0.0.1:4096/prefix',
    'http://127.0.0.1:4096/?x=1',
    'not-a-url',
    '',
  ]) {
    assert.equal(parseVisibleAttachUrl(target).ok, false, `${target} must be rejected`);
  }

  const fixture = buildFixture();
  try {
    const statusBefore = gitRaw(fixture.root, ['status', '--porcelain=v1']);
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const preflightCalls = [];
    const result = runOnce(runOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      probeVisibleServer: createPreflightRecorder({ calls: preflightCalls }),
      env: visibleEnv('http://192.168.0.10:4096'),
      log: () => {},
    });

    assert.equal(result.status, EXECUTOR_FAILED);
    assert.equal(result.executor.mode, VISIBLE_TUI_MODE);
    assert.equal(result.executor.invoked, false);
    assert.match(result.reason, /attach target is not allowed/);
    assert.equal(preflightCalls.length, 0);
    assert.equal(fake.invocations.length, 0);
    assert.equal(result.workspace.created, false);
    assert.equal(result.workspace.cleanup, 'NOT_CREATED');
    assert.deepEqual(result.changedPaths, []);
    assert.equal(gitRaw(fixture.root, ['status', '--porcelain=v1']), statusBefore);
  } finally {
    removeFixture(fixture);
  }
});

test('VISIBLE_TUI D ??an attached invocation failure is EXECUTOR_FAILED with no standalone retry', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ fail: true });
    const result = runOnce(runOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      probeVisibleServer: createPreflightRecorder(),
      disposeVisibleInstance: createDisposalRecorder(),
      env: visibleEnv('http://127.0.0.1:4096'),
      log: () => {},
    });

    assert.equal(result.status, EXECUTOR_FAILED);
    assert.equal(result.executor.mode, VISIBLE_TUI_MODE);
    assert.equal(fake.invocations.length, 1);
    assert.ok(fake.invocations[0].args.includes('--attach'));
    assert.equal(
      fake.invocations.filter((invocation) => !invocation.args.includes('--attach')).length,
      0,
      'a standalone retry would be a second invocation without --attach',
    );
    assert.equal(result.workspace.cleanup, 'REMOVED');
  } finally {
    removeFixture(fixture);
  }
});

test('VISIBLE_TUI D2 ??a throwing attached invocation stays EXECUTOR_FAILED without fallback', () => {
  const fixture = buildFixture();
  try {
    let calls = 0;
    const result = runOnce(runOptions(fixture), {
      invokeOpencode: () => {
        calls += 1;
        const error = new Error('connect ECONNREFUSED 127.0.0.1:4096');
        error.code = 'ECONNREFUSED';
        throw error;
      },
      probeVisibleServer: createPreflightRecorder(),
      disposeVisibleInstance: createDisposalRecorder(),
      env: visibleEnv('http://127.0.0.1:4096'),
      log: () => {},
    });

    assert.equal(result.status, EXECUTOR_FAILED);
    assert.equal(calls, 1);
    assert.equal(result.executor.startErrorCode, 'ECONNREFUSED');
    assert.equal(result.workspace.cleanup, 'REMOVED');
  } finally {
    removeFixture(fixture);
  }
});

test('VISIBLE_TUI E ??the attached mutation child keeps the sanitized child environment', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const baseEnv = {
      PATH: process.env.PATH,
      GH_TOKEN: 'gh',
      GITHUB_TOKEN: 'github',
      VERCEL_TOKEN: 'vercel',
      [OPENCODE_ATTACH_URL_ENV]: 'http://127.0.0.1:4096',
    };
    const result = runOnce(runOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      probeVisibleServer: createPreflightRecorder(),
      disposeVisibleInstance: createDisposalRecorder(),
      env: baseEnv,
      log: () => {},
    });

    assert.equal(result.status, SUCCESS);
    const childEnv = fake.invocations[0].env;
    for (const dropped of ['GH_TOKEN', 'GITHUB_TOKEN', 'VERCEL_TOKEN']) {
      assert.equal(childEnv[dropped], undefined, `${dropped} must not reach the child`);
    }
    for (const credentialValue of ['gh', 'github', 'vercel']) {
      assert.ok(
        !Object.values(childEnv).includes(credentialValue),
        `${credentialValue} must not be a child environment value`,
      );
    }
    assert.equal(childEnv.GIT_TERMINAL_PROMPT, '0');
    assert.equal(childEnv.GIT_CONFIG_KEY_1, 'protocol.allow');
    assert.equal(childEnv.GIT_CONFIG_VALUE_1, 'never');
    assert.equal(childEnv.GIT_CONFIG_KEY_3, 'push.default');
    assert.equal(childEnv.GIT_CONFIG_VALUE_3, 'nothing');
    assert.equal(
      childEnv.GH_CONFIG_DIR,
      join(dirname(fake.invocations[0].cwd), 'opencode-child-gh-config'),
    );
  } finally {
    removeFixture(fixture);
  }
});

test('VISIBLE_TUI F ??each attached task keeps its own title, workspace, and invocation', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const env = visibleEnv('http://127.0.0.1:4096');
    const first = runOnce(runOptions(fixture, { title: 'OV-01 task A' }), {
      invokeOpencode: fake.invokeOpencode,
      probeVisibleServer: createPreflightRecorder(),
      disposeVisibleInstance: createDisposalRecorder(),
      env,
      log: () => {},
    });
    const second = runOnce(runOptions(fixture, { title: 'OV-01 task B' }), {
      invokeOpencode: fake.invokeOpencode,
      probeVisibleServer: createPreflightRecorder(),
      disposeVisibleInstance: createDisposalRecorder(),
      env,
      log: () => {},
    });

    assert.equal(first.status, SUCCESS);
    assert.equal(second.status, SUCCESS);
    assert.equal(fake.invocations.length, 2);
    const [taskA, taskB] = fake.invocations;
    assert.notEqual(taskA.cwd, taskB.cwd);
    assert.notEqual(taskA.cwd, fixture.root);
    assert.equal(titleOf(taskA), 'OV-01 task A');
    assert.equal(titleOf(taskB), 'OV-01 task B');
    assert.notEqual(titleOf(taskA), titleOf(taskB));
    for (const invocation of fake.invocations) {
      assert.ok(invocation.args.includes('--attach'));
    }
    assert.equal(listRegisteredWorktrees(fixture.root).length, 1);
  } finally {
    removeFixture(fixture);
  }
});

test('VISIBLE_TUI G ??attached runs dispose the visible instance before workspace cleanup', () => {
  const fixture = buildFixture();
  try {
    const calls = [];
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const result = runOnce(runOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      probeVisibleServer: createPreflightRecorder(),
      disposeVisibleInstance: createDisposalRecorder({ calls }),
      env: visibleEnv('http://localhost:4096'),
      log: () => {},
    });

    assert.equal(result.status, SUCCESS);
    assert.equal(result.executor.instanceDisposal, 'DISPOSED');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].attachUrl, 'http://localhost:4096');
    assert.equal(calls[0].workspacePath, fake.invocations[0].cwd);
    assert.equal(result.workspace.cleanup, 'REMOVED');
    assert.equal(existsSync(result.workspace.path), false);
  } finally {
    removeFixture(fixture);
  }
});

test('VISIBLE_TUI G1 ??a transient workspace sharing violation is retried after re-disposal', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const disposalCalls = [];
    let removalAttempts = 0;
    const result = runOnce(runOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      probeVisibleServer: createPreflightRecorder(),
      disposeVisibleInstance: (args) => {
        disposalCalls.push(args);
        return { attempted: true, ok: true, error: null };
      },
      removeWorkspace: (args) => {
        removalAttempts += 1;
        if (removalAttempts === 1) {
          return { removed: false, errors: ['simulated transient sharing violation'] };
        }
        return defaultRemoveWorkspace(args);
      },
      env: visibleEnv('http://127.0.0.1:4096'),
      log: () => {},
    });

    assert.equal(result.status, SUCCESS);
    assert.equal(result.workspace.cleanup, 'REMOVED');
    assert.equal(removalAttempts, 2);
    assert.equal(disposalCalls.length, 2, 'the retry re-disposes before removing again');
  } finally {
    removeFixture(fixture);
  }
});

test('VISIBLE_TUI G2 ??a failed instance disposal is reported without masking successful cleanup', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const result = runOnce(runOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      probeVisibleServer: createPreflightRecorder(),
      disposeVisibleInstance: createDisposalRecorder({
        ok: false,
        error: 'simulated disposal failure',
      }),
      env: visibleEnv('http://127.0.0.1:4096'),
      log: () => {},
    });

    assert.equal(result.status, SUCCESS);
    assert.equal(result.executor.instanceDisposal, 'FAILED');
    assert.equal(result.workspace.cleanup, 'REMOVED');
  } finally {
    removeFixture(fixture);
  }
});

test('VISIBLE_TUI G3 ??headless runs never attempt visible instance disposal', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const result = runOnce(runOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      probeVisibleServer: () => {
        throw new Error('headless runs must not probe a visible server');
      },
      disposeVisibleInstance: () => {
        throw new Error('headless runs must not dispose a visible instance');
      },
      env: { PATH: process.env.PATH },
      log: () => {},
    });

    assert.equal(result.status, SUCCESS);
    assert.equal(result.executor.preflight, 'NOT_ATTEMPTED');
    assert.equal(result.executor.instanceDisposal, 'NOT_ATTEMPTED');
  } finally {
    removeFixture(fixture);
  }
});

test('VISIBLE_TUI H ??an unhealthy visible server fails closed as VISIBILITY_UNAVAILABLE before any side effect', () => {
  const fixture = buildFixture();
  try {
    const statusBefore = gitRaw(fixture.root, ['status', '--porcelain=v1']);
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const result = runOnce(runOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      probeVisibleServer: createPreflightRecorder({
        ok: false,
        error: 'health preflight exited with status 1',
      }),
      disposeVisibleInstance: createDisposalRecorder(),
      env: visibleEnv('http://127.0.0.1:4096'),
      log: () => {},
    });

    assert.equal(result.status, EXECUTOR_FAILED);
    assert.equal(result.executor.mode, VISIBLE_TUI_MODE);
    assert.equal(result.executor.attachUrl, 'http://127.0.0.1:4096');
    assert.equal(result.executor.preflight, 'FAILED');
    assert.equal(result.executor.invoked, false);
    assert.match(result.reason, /VISIBILITY_UNAVAILABLE/);
    assert.equal(fake.invocations.length, 0);
    assert.equal(result.workspace.created, false);
    assert.equal(result.workspace.cleanup, 'NOT_CREATED');
    assert.equal(gitRaw(fixture.root, ['status', '--porcelain=v1']), statusBefore);
  } finally {
    removeFixture(fixture);
  }
});

test('VISIBLE_TUI H2 ??probeVisibleServer reports health through its spawn seam only', () => {
  const healthy = probeVisibleServer({
    attachUrl: 'http://127.0.0.1:4096',
    spawn: () => ({ status: 0, stderr: '' }),
  });
  assert.deepEqual(healthy, { attempted: true, ok: true, error: null });

  let observedArgs = null;
  const unhealthy = probeVisibleServer({
    attachUrl: 'http://127.0.0.1:4096',
    spawn: (command, args) => {
      observedArgs = { command, args };
      return { status: 1, stderr: 'connect ECONNREFUSED 127.0.0.1:4096\n' };
    },
  });
  assert.equal(unhealthy.attempted, true);
  assert.equal(unhealthy.ok, false);
  assert.match(unhealthy.error, /ECONNREFUSED/);
  assert.equal(observedArgs.args[observedArgs.args.length - 1], 'http://127.0.0.1:4096');

  const missingTarget = probeVisibleServer({ spawn: () => ({ status: 0, stderr: '' }) });
  assert.deepEqual(missingTarget, {
    attempted: false,
    ok: false,
    error: 'attach URL is required',
  });
});

// Real-process child runner for the C6 concurrency proof. It imports the
// product runner by absolute path and holds the invocation open until the
// parent signals that caller-side movement has happened. It is written to a
// task-owned temp directory, never into product source.
const CHILD_RUNNER_SOURCE = `
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , runnerPath, repositoryRoot, allowedPath, readyFile, proceedFile, resultFile] =
  process.argv;
const { runOnce } = await import(pathToFileURL(runnerPath).href);

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const invokeOpencode = ({ cwd }) => {
  writeFileSync(readyFile, '');
  const deadline = Date.now() + 120000;
  while (!existsSync(proceedFile)) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the caller movement');
    sleep(25);
  }
  const absolute = join(cwd, allowedPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, 'ok\\n');
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    startErrorCode: null,
    stdout: '',
    stderr: '',
  };
};

const options = {
  repositoryRoot,
  remote: 'origin',
  taskText:
    'OUTCOME: write ' + allowedPath + '\\n' +
    'PRESERVE: every other path\\n' +
    'PROOF: none\\n' +
    'ESCALATE ONLY IF: the boundary is unclear',
  allowedPaths: [allowedPath],
  proofCommands: [],
};

// Two independent invocations share one object store, so a transient
// pre-invocation baseline race (for example a concurrent fetch writing
// FETCH_HEAD) is retried exactly like run-goal's bounded start retry does in
// production. The caller-side movement under test happens later, while both
// invocations are running, and is never retried.
let result = null;
let attempts = 0;
for (attempts = 1; attempts <= 5; attempts += 1) {
  try {
    result = runOnce(options, { invokeOpencode, log: () => {} });
  } catch (error) {
    result = {
      status: 'EXECUTOR_THREW',
      reason: String(error && error.stack ? error.stack : error),
    };
  }
  const retryable =
    result.status === 'BASELINE_OBSERVATION_FAILED' && result.executor?.invoked !== true;
  if (!retryable) break;
  sleep(100 * attempts);
}

writeFileSync(
  resultFile,
  JSON.stringify({
    status: result.status,
    reason: result.reason,
    attempts,
    canonicalCheckout: result.canonicalCheckout ?? null,
    baselineMovement: result.baselineMovement ?? null,
    changedPaths: result.changedPaths ?? [],
    executorInvoked: result.executor?.invoked ?? false,
  }),
);
`;

function startChildRunner({
  scriptPath,
  runnerPath,
  fixture,
  allowedPath,
  readyFile,
  proceedFile,
  resultFile,
}) {
  const child = spawn(
    process.execPath,
    [scriptPath, runnerPath, fixture.root, allowedPath, readyFile, proceedFile, resultFile],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  let exited = false;
  const done = new Promise((resolve) => {
    child.on('close', (code) => {
      exited = true;
      resolve({ code, stderr });
    });
    child.on('error', (error) => {
      exited = true;
      resolve({ code: null, stderr: `${stderr}${String(error)}` });
    });
  });
  return { done, didExit: () => exited };
}

function describeChildReport(resultFile) {
  if (!existsSync(resultFile)) return `${resultFile}: <missing>`;
  try {
    return `${resultFile}: ${readFileSync(resultFile, 'utf8')}`;
  } catch (error) {
    return `${resultFile}: <unreadable: ${String(error)}>`;
  }
}

async function waitForChildrenReady(children, paths, resultFiles, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!paths.every((filePath) => existsSync(filePath))) {
    if (children.some((child) => child.didExit())) {
      throw new Error(
        `a child exited before signaling readiness: ${resultFiles.map(describeChildReport).join(' | ')}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for ${paths.join(', ')}; ` +
          resultFiles.map(describeChildReport).join(' | '),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test('C6 — two independent invocations on one baseline survive caller-side movement in real processes', async () => {
  const fixture = buildFixture();
  const scratch = mkdtempSync(join(tmpdir(), 'greenhub-run-once-two-process-'));
  try {
    const runnerPath = fileURLToPath(new URL('./run-once.mjs', import.meta.url));
    const scriptPath = join(scratch, 'child-runner.mjs');
    writeFileSync(scriptPath, CHILD_RUNNER_SOURCE);

    const readyA = join(scratch, 'ready-a');
    const readyB = join(scratch, 'ready-b');
    const proceedA = join(scratch, 'proceed-a');
    const proceedB = join(scratch, 'proceed-b');
    const resultA = join(scratch, 'result-a.json');
    const resultB = join(scratch, 'result-b.json');

    const first = startChildRunner({
      scriptPath,
      runnerPath,
      fixture,
      allowedPath: 'src/a.txt',
      readyFile: readyA,
      proceedFile: proceedA,
      resultFile: resultA,
    });
    const second = startChildRunner({
      scriptPath,
      runnerPath,
      fixture,
      allowedPath: 'src/b.txt',
      readyFile: readyB,
      proceedFile: proceedB,
      resultFile: resultB,
    });

    // Both real subprocesses are alive and past baseline observation.
    await waitForChildrenReady([first, second], [readyA, readyB], [resultA, resultB], 60000);

    // Unrelated concurrent caller-side movement while both tasks are running.
    git(fixture.root, ['checkout', '-b', 'foreign-movement']);
    git(fixture.root, ['commit', '--allow-empty', '-m', 'foreign movement']);
    writeFileSync(join(fixture.root, 'foreign-untracked.txt'), 'foreign\n');
    writeFileSync(proceedA, '');
    writeFileSync(proceedB, '');

    const [exitA, exitB] = await Promise.all([first.done, second.done]);
    assert.equal(exitA.code, 0, exitA.stderr);
    assert.equal(exitB.code, 0, exitB.stderr);

    const a = JSON.parse(readFileSync(resultA, 'utf8'));
    const b = JSON.parse(readFileSync(resultB, 'utf8'));
    assert.equal(a.status, SUCCESS, a.reason);
    assert.equal(b.status, SUCCESS, b.reason);
    assert.equal(a.executorInvoked, true);
    assert.equal(b.executorInvoked, true);
    assert.equal(a.canonicalCheckout.unchanged, false);
    assert.equal(b.canonicalCheckout.unchanged, false);
    assert.equal(a.baselineMovement, 'UNCHANGED');
    assert.equal(b.baselineMovement, 'UNCHANGED');
    assert.deepEqual(a.changedPaths, ['src/a.txt']);
    assert.deepEqual(b.changedPaths, ['src/b.txt']);

    // The foreign caller-side state is preserved exactly and owned by no task.
    assert.equal(git(fixture.root, ['branch', '--show-current']), 'foreign-movement');
    assert.equal(readFileSync(join(fixture.root, 'foreign-untracked.txt'), 'utf8'), 'foreign\n');
  } finally {
    removeFixture(fixture);
    rmSync(scratch, { recursive: true, force: true });
  }
});
