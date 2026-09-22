// Focused regression proof for scripts/agent/run-once.mjs.
// Uses temp local git repositories + temp bare remotes and injected narrow
// process seams. No GitHub, no publication, no real OpenCode process, and no
// mutation of the Greenhub checkout.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
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

import {
  ALREADY_SATISFIED,
  BOUNDARY_VIOLATION,
  buildChildEnv,
  buildOpencodeArgs,
  buildTaskPrompt,
  CLEANUP_FAILED,
  classifyChangedPaths,
  EXECUTOR_FAILED,
  extractWindowsShimTarget,
  INVALID_INPUT,
  isPathAllowed,
  PROOF_FAILED,
  parseArgs,
  RUN_ONCE_STATUSES,
  resolveOpencodeCommand,
  runOnce,
  SUCCESS,
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
