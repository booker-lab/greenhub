// Focused regression proof for scripts/agent/run-publish-once.mjs.
// Uses temp local git repositories + temp bare remotes and injected narrow
// process seams (fake OpenCode child, fake `gh` provider boundary). No real
// GitHub call, no real PR, no real OpenCode process, and no mutation of the
// Greenhub checkout.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  CI_FAILED,
  PUBLICATION_BLOCKED,
  PUBLICATION_REFRESH_REQUIRED,
  PUBLICATION_SUCCESS_OUTCOMES,
  PUBLISH_ONCE_STATUSES,
  REMOTE_READBACK_FAILED,
  SUCCESS_PUBLISHED,
  buildCandidateCommitArgs,
  createTemporaryTransportRef,
  parseArgs,
  runPublishOnce,
  validatePublishOnceInput,
} from './run-publish-once.mjs';
import {
  ALREADY_SATISFIED,
  BOUNDARY_VIOLATION,
  CLEANUP_FAILED,
  PROOF_FAILED,
  SUCCESS,
  runOnce,
} from './run-once.mjs';
import {
  COMPLETE_ALREADY_PUBLISHED,
  SEMANTIC_OWNER_REVIEW_REQUIRED,
  SUPERSEDED_ALREADY_PUBLISHED,
} from '../git/publication-admission.mjs';

const IDENTITY = [
  '-c',
  'user.name=pub-once-spec',
  '-c',
  'user.email=pub-once-spec@local',
  '-c',
  'commit.gpgsign=false',
];

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

function commit(cwd, message) {
  git(cwd, [...IDENTITY, 'commit', '--no-verify', '-m', message]);
}

/** Canonical checkout + real bare remote, with a clean live `main`. */
function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'greenhub-pub-once-spec-'));
  const bare = mkdtempSync(join(tmpdir(), 'greenhub-pub-once-spec-remote-'));
  try {
    git(bare, ['init', '--bare', '-b', 'main']);
    git(root, ['init', '-b', 'main']);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'base.txt'), 'base\n');
    writeFileSync(join(root, 'README.md'), 'base\n');
    writeFileSync(join(root, '.gitignore'), 'ignored.txt\n');
    writeFileSync(
      join(root, 'proof-check.cjs'),
      "const { readFileSync } = require('node:fs');\nconst content = readFileSync('src/allowed.txt', 'utf8');\nif (content !== 'ok\\n') process.exit(1);\n",
    );
    git(root, ['add', '-A']);
    commit(root, 'base');
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

function runOnceOptions(fixture, overrides = {}) {
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

function publishOptions(fixture, overrides = {}) {
  return {
    ...runOnceOptions(fixture),
    commitMessage: 'feat(agent): bounded publication proof',
    prTitle: 'GN-02 bounded publication proof',
    transportRef: 'tmp/spec-transport',
    ...overrides,
  };
}

/** Narrow process seam: records the invocation and mutates only the workspace. */
function createFakeOpencode({ writes = [], after = null, fail = false } = {}) {
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
    if (after) after(invocation.cwd);
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

function valueOf(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
}

function remoteRefSha(bare, ref) {
  const output = execFileSync('git', ['ls-remote', bare, `refs/heads/${ref}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return output.length > 0 ? output.split(/\s+/)[0] : null;
}

function remoteTemporaryRefs(bare) {
  const output = git(bare, ['for-each-ref', '--format=%(refname)', 'refs/heads/tmp/']);
  return output.length > 0 ? output.split('\n').filter((entry) => entry.length > 0) : [];
}

function squashMergeIntoBare({ bare, candidateSha, message }) {
  const tree = git(bare, ['rev-parse', `${candidateSha}^{tree}`]);
  const parent = git(bare, ['rev-parse', 'refs/heads/main']);
  const commitSha = execFileSync(
    'git',
    [
      ...IDENTITY,
      'commit-tree',
      tree,
      '-p',
      parent,
      '-m',
      message,
    ],
    { cwd: bare, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
  git(bare, ['update-ref', 'refs/heads/main', commitSha]);
  return commitSha;
}

/** A rival publication lands the same semantic content under another SHA. */
function rivalPublish({ bare, files, message }) {
  const clone = mkdtempSync(join(tmpdir(), 'greenhub-pub-once-rival-'));
  try {
    git(clone, ['clone', '--quiet', bare, '.']);
    for (const [relativePath, content] of Object.entries(files)) {
      writeFileSync(join(clone, relativePath), content);
    }
    git(clone, ['add', '-A']);
    commit(clone, message);
    git(clone, ['push', '--quiet', 'origin', 'main']);
    return git(clone, ['rev-parse', 'HEAD']);
  } finally {
    rmSync(clone, { recursive: true, force: true });
  }
}

/**
 * Fake provider boundary: a real bare remote plus an in-memory PR model.
 * The default merge performs a real squash-style commit on the bare remote so
 * remote read-back is exercised against real Git objects.
 */
function createFakeGithub({
  bare,
  repository = 'booker-lab/greenhub',
  requiredChecks = ['verify'],
  checksResult = 'pass',
  checksUnavailableCount = 0,
  checksResults = null,
  checksError = null,
  allowSquashMerge = true,
  mergeEffect = null,
  onChecks = null,
} = {}) {
  const calls = [];
  const prs = new Map();
  const state = {
    nextNumber: 1,
    mergeCalls: [],
    closeCalls: [],
    checksUnavailableRemaining: checksUnavailableCount,
    checksResults: Array.isArray(checksResults) ? [...checksResults] : null,
  };
  const ok = (stdout) => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    startErrorCode: null,
    stdout,
    stderr: '',
  });
  const fail = (stderr, exitCode = 1) => ({
    exitCode,
    signal: null,
    timedOut: false,
    startErrorCode: null,
    stdout: '',
    stderr,
  });
  const findPr = (target) => {
    const number = Number(target);
    if (Number.isInteger(number) && prs.has(number)) return prs.get(number);
    for (const pr of prs.values()) {
      if (pr.url === target) return pr;
    }
    return null;
  };
  const runGh = (args) => {
    calls.push({ args: [...args] });
    if (args[0] === 'auth' && args[1] === 'status') return ok('github.com\n  ??Logged in\n');
    if (args[0] === 'repo' && args[1] === 'view') return ok(`${repository}\n`);
    if (args[0] === 'api' && args[1] === `repos/${repository}`) {
      return ok(JSON.stringify({ allow_squash_merge: allowSquashMerge }));
    }
    if (args[0] === 'api' && args[1] === `repos/${repository}/branches/main/protection`) {
      return ok(JSON.stringify({ required_status_checks: { contexts: requiredChecks, strict: true } }));
    }
    if (args[0] === 'pr' && args[1] === 'create') {
      const head = valueOf(args, '--head');
      let headRefOid = null;
      try {
        headRefOid = git(bare, ['rev-parse', `refs/heads/${head}`]);
      } catch {
        return fail(`no such head ref on the remote: ${head}`);
      }
      const number = state.nextNumber;
      state.nextNumber += 1;
      const url = `https://github.com/${repository}/pull/${number}`;
      prs.set(number, {
        number,
        url,
        headRefOid,
        state: 'OPEN',
        mergeStateStatus: 'CLEAN',
        mergeCommit: null,
        headRefName: head,
      });
      return ok(`${url}\n`);
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      const pr = findPr(args[2]);
      if (pr === null) return fail(`no such PR: ${args[2]}`);
      const fields = String(valueOf(args, '--json') ?? '')
        .split(',')
        .filter((entry) => entry.length > 0);
      const payload = {};
      for (const field of fields) {
        if (field === 'mergeCommit') payload.mergeCommit = pr.mergeCommit ? { oid: pr.mergeCommit } : null;
        else payload[field] = pr[field];
      }
      return ok(JSON.stringify(payload));
    }
    if (args[0] === 'pr' && args[1] === 'checks') {
      const pr = findPr(args[2]);
      if (pr === null) return fail(`no such PR: ${args[2]}`);
      if (checksError !== null) return fail(checksError);
      if (state.checksUnavailableRemaining > 0) {
        state.checksUnavailableRemaining -= 1;
        return fail(`no required checks reported on the '${pr.headRefName}' branch\n`);
      }
      let current = checksResult;
      if (state.checksResults !== null && state.checksResults.length > 0) {
        current = state.checksResults.shift();
      }
      if (onChecks) onChecks({ pr, prs, state });
      if (args.includes('--json')) {
        const bucket = current === 'pass' ? 'pass' : current === 'fail' ? 'fail' : 'pending';
        return ok(
          JSON.stringify(
            requiredChecks.map((name) => ({ name, bucket, state: bucket.toUpperCase() })),
          ),
        );
      }
      if (current === 'pass') return ok('All required checks pass\n');
      if (current === 'fail') return fail('Some required checks fail\n');
      return fail('Checks are still pending\n', 8);
    }
    if (args[0] === 'pr' && args[1] === 'close') {
      const pr = findPr(args[2]);
      if (pr === null) return fail(`no such PR: ${args[2]}`);
      state.closeCalls.push([...args]);
      pr.state = 'CLOSED';
      return ok(`Closed pull request #${pr.number}\n`);
    }
    if (args[0] === 'pr' && args[1] === 'merge') {
      const pr = findPr(args[2]);
      if (pr === null) return fail(`no such PR: ${args[2]}`);
      state.mergeCalls.push({ args: [...args], pr });
      const effect =
        mergeEffect ??
        ((current) => ({
          merge: true,
          mergeSha: squashMergeIntoBare({
            bare,
            candidateSha: current.headRefOid,
            message: `squash PR #${current.number}`,
          }),
        }));
      const outcome = effect(pr, state);
      if (outcome.exitCode != null && outcome.exitCode !== 0) {
        if (outcome.mergeStateStatus) pr.mergeStateStatus = outcome.mergeStateStatus;
        return fail(outcome.stderr ?? 'merge failed', outcome.exitCode);
      }
      if (outcome.merge === false) return fail(outcome.stderr ?? 'merge refused', 1);
      pr.state = 'MERGED';
      pr.mergeCommit = outcome.mergeSha ?? null;
      return ok(`Merged pull request #${pr.number}\n`);
    }
    return fail(`unexpected gh command: ${args.join(' ')}`);
  };
  return { runGh, calls, prs, state };
}

test('GOLDEN ??candidate is committed from observed paths, published, merged, read back, cleaned', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({
      writes: [
        { path: 'src/allowed.txt', content: 'ok\n' },
        { path: 'ignored.txt', content: 'ignored\n' },
      ],
    });
    const github = createFakeGithub({ bare: fixture.bare });
    const result = runPublishOnce(publishOptions(fixture, { proofCommands: ['node proof-check.cjs'] }), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
      env: { ...process.env, GH_TOKEN: 'publication-credential-sentinel' },
    });

    assert.equal(result.status, SUCCESS_PUBLISHED);
    assert.equal(result.executionStatus, SUCCESS);
    assert.equal(fake.invocations.length, 1);
    assert.equal(fake.invocations[0].env.GH_TOKEN, undefined);
    assert.deepEqual(result.changedPaths, ['src/allowed.txt']);
    assert.deepEqual(
      result.proofResults.map((entry) => entry.ok),
      [true],
    );

    const candidate = result.publication.candidate.candidateSha;
    assert.match(candidate, /^[0-9a-f]{40}$/);
    const parents = git(fixture.root, ['rev-list', '--parents', '-n', '1', candidate]).split(/\s+/);
    assert.deepEqual(parents, [candidate, fixture.baseSha]);
    assert.deepEqual(
      git(fixture.root, ['diff', '--name-only', `${fixture.baseSha}..${candidate}`])
        .split('\n')
        .filter((entry) => entry.length > 0),
      ['src/allowed.txt'],
    );
    const tree = git(fixture.root, ['ls-tree', '-r', '--name-only', candidate]).split('\n');
    assert.ok(!tree.includes('ignored.txt'), 'ignored, unobserved files must not be committed');

    const pr = github.prs.get(1);
    assert.equal(pr.headRefName, 'tmp/spec-transport');
    assert.equal(pr.headRefOid, candidate);
    assert.equal(result.publication.prePr.status, 'PUBLICATION_ALLOWED');
    assert.deepEqual(result.publication.requiredChecks, ['verify']);
    assert.equal(result.publication.checks.status, 'PASSED');
    assert.equal(result.publication.preMerge.status, 'PUBLICATION_ALLOWED');
    assert.equal(result.publication.rebind.status, 'NOT_REQUIRED');
    assert.equal(result.publication.rebind.count, 0);
    assert.equal(result.publication.attempts, 1);
    assert.deepEqual(result.publication.stalePublications, []);

    const mergeArgs = github.state.mergeCalls[0].args;
    assert.ok(mergeArgs.includes('--squash'));
    assert.equal(valueOf(mergeArgs, '--match-head-commit'), candidate);

    const remoteMain = git(fixture.bare, ['rev-parse', 'refs/heads/main']);
    assert.notEqual(remoteMain, candidate);
    assert.throws(() => git(fixture.bare, ['merge-base', '--is-ancestor', candidate, remoteMain]));
    assert.equal(git(fixture.bare, ['show', `${remoteMain}:src/allowed.txt`]), 'ok');
    assert.equal(result.publication.merge.mergeSha, remoteMain);
    assert.equal(result.publication.remoteMainSha, remoteMain);
    assert.equal(result.publication.remoteDeltaVerified, true);

    assert.equal(remoteRefSha(fixture.bare, 'tmp/spec-transport'), null);
    assert.equal(result.publication.transportCleanup, 'REMOVED');
    assert.equal(result.workspace.cleanup, 'REMOVED');
    assert.equal(existsSync(result.workspace.path), false);
    assert.equal(result.canonicalCheckout.unchanged, true);
    assert.equal(result.publication.canonicalCheckoutUnchanged, true);
    assert.equal(github.state.closeCalls.length, 0);
    assert.deepEqual(readdirSync(fixture.root).sort(), [
      '.git',
      '.gitignore',
      'README.md',
      'proof-check.cjs',
      'src',
    ]);
  } finally {
    removeFixture(fixture);
  }
});

test('CI wait retries transient required-check registration instead of failing closed', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const github = createFakeGithub({
      bare: fixture.bare,
      checksUnavailableCount: 2,
      checksResult: 'pass',
    });
    const result = runPublishOnce(publishOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      sleep: () => {},
      log: () => {},
    });

    assert.equal(result.status, SUCCESS_PUBLISHED);
    assert.equal(result.publication.checks.status, 'PASSED');
    assert.equal(result.publication.preMerge.status, 'PUBLICATION_ALLOWED');
    assert.equal(github.state.checksUnavailableRemaining, 0);
    assert.equal(remoteRefSha(fixture.bare, 'tmp/spec-transport'), null);
  } finally {
    removeFixture(fixture);
  }
});

test('GN-05 registered PENDING is re-observed and converges to PASSED in one foreground publication', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const github = createFakeGithub({
      bare: fixture.bare,
      checksResults: ['pending', 'pending', 'pass', 'pass'],
    });
    const sleeps = [];
    const result = runPublishOnce(publishOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      sleep: (ms) => {
        sleeps.push(ms);
      },
      log: () => {},
    });

    assert.equal(result.status, SUCCESS_PUBLISHED);
    assert.equal(result.publication.checks.status, 'PASSED');
    assert.equal(result.publication.checks.entries.length, 1);
    assert.equal(result.publication.preMerge.status, 'PUBLICATION_ALLOWED');
    assert.equal(result.publication.merge.method, 'squash');

    // PENDING did not recreate the candidate, the PR, or re-invoke OpenCode.
    assert.equal(result.publication.attempts, 1);
    assert.equal(fake.invocations.length, 1);
    assert.equal(github.prs.size, 1);
    const candidate = result.publication.candidate.candidateSha;
    assert.equal(github.prs.get(1).headRefOid, candidate);
    assert.equal(valueOf(github.state.mergeCalls[0].args, '--match-head-commit'), candidate);
    assert.deepEqual(sleeps, [5000]);

    const remoteMain = git(fixture.bare, ['rev-parse', 'refs/heads/main']);
    assert.equal(git(fixture.bare, ['show', `${remoteMain}:src/allowed.txt`]), 'ok');
    assert.equal(result.publication.remoteMainSha, remoteMain);
    assert.equal(result.publication.remoteDeltaVerified, true);
    assert.equal(remoteRefSha(fixture.bare, 'tmp/spec-transport'), null);
    assert.equal(result.publication.transportCleanup, 'REMOVED');
    assert.equal(result.workspace.cleanup, 'REMOVED');
    assert.equal(result.publication.canonicalCheckoutUnchanged, true);
  } finally {
    removeFixture(fixture);
  }
});

test('GN-05 registered PENDING that later fails ends FAILED with no merge', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const github = createFakeGithub({
      bare: fixture.bare,
      checksResults: ['pending', 'pending', 'fail', 'fail'],
    });
    const sleeps = [];
    const result = runPublishOnce(publishOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      sleep: (ms) => {
        sleeps.push(ms);
      },
      log: () => {},
    });

    assert.equal(result.status, CI_FAILED);
    assert.equal(result.publication.checks.status, 'FAILED');
    assert.equal(result.publication.checks.entries[0].bucket, 'fail');
    assert.equal(github.state.mergeCalls.length, 0);
    assert.equal(result.publication.retained, true);
    assert.equal(result.publication.transportCleanup, 'RETAINED');
    assert.equal(fake.invocations.length, 1);
    assert.deepEqual(sleeps, [5000]);
  } finally {
    removeFixture(fixture);
  }
});

test('GN-05 sustained registered PENDING converges to TIMED_OUT at the bounded budget', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const github = createFakeGithub({ bare: fixture.bare, checksResult: 'pending' });
    const result = runPublishOnce(publishOptions(fixture, { ciTimeoutMs: 120 }), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
    });

    assert.equal(result.status, CI_FAILED);
    assert.equal(result.publication.checks.status, 'TIMED_OUT');
    assert.equal(github.state.mergeCalls.length, 0);
    assert.equal(result.publication.retained, true);
    assert.equal(fake.invocations.length, 1);
    assert.equal(result.publication.attempts, 1);
  } finally {
    removeFixture(fixture);
  }
});

test('GN-05 an immediately failed required check is terminal without re-observation', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const github = createFakeGithub({ bare: fixture.bare, checksResult: 'fail' });
    const sleeps = [];
    const result = runPublishOnce(publishOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      sleep: (ms) => {
        sleeps.push(ms);
      },
      log: () => {},
    });

    assert.equal(result.status, CI_FAILED);
    assert.equal(result.publication.checks.status, 'FAILED');
    assert.deepEqual(sleeps, []);
    const checkCalls = github.calls.filter(
      (call) => call.args[0] === 'pr' && call.args[1] === 'checks',
    );
    assert.equal(checkCalls.length, 2);
    assert.equal(fake.invocations.length, 1);
  } finally {
    removeFixture(fixture);
  }
});

test('GN-05 a permanent provider error fails closed without re-observation', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const github = createFakeGithub({
      bare: fixture.bare,
      checksError: 'HTTP 500: required checks could not be read',
    });
    const sleeps = [];
    const result = runPublishOnce(publishOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      sleep: (ms) => {
        sleeps.push(ms);
      },
      log: () => {},
    });

    assert.equal(result.status, CI_FAILED);
    assert.equal(result.publication.checks.status, 'FAILED');
    assert.deepEqual(sleeps, []);
    assert.equal(github.state.mergeCalls.length, 0);
    assert.equal(result.publication.retained, true);
    assert.equal(fake.invocations.length, 1);
  } finally {
    removeFixture(fixture);
  }
});

test('local-only run-once never publishes and never hands off a workspace', () => {
  const fixture = buildFixture();
  try {
    const refsBefore = git(fixture.bare, ['for-each-ref', '--format=%(refname) %(objectname)']);
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const result = runOnce(runOnceOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      log: () => {},
    });
    assert.equal(result.status, SUCCESS);
    assert.equal(result.successHandoff, null);
    assert.equal(git(fixture.bare, ['for-each-ref', '--format=%(refname) %(objectname)']), refsBefore);
  } finally {
    removeFixture(fixture);
  }
});

test('successful workspace is handed to the same-process finalizer, then cleaned', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    let observedPath = null;
    const result = runOnce(runOnceOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      log: () => {},
      successFinalizer: (context) => {
        observedPath = context.workspacePath;
        assert.equal(existsSync(context.workspacePath), true);
        assert.equal(readFileSync(join(context.workspacePath, 'src', 'allowed.txt'), 'utf8'), 'ok\n');
        assert.deepEqual(context.changedPaths, ['src/allowed.txt']);
        assert.deepEqual(context.proofResults, []);
        return { marker: 'handoff-ok' };
      },
    });
    assert.equal(result.status, SUCCESS);
    assert.deepEqual(result.successHandoff, {
      invoked: true,
      error: null,
      output: { marker: 'handoff-ok' },
    });
    assert.equal(existsSync(observedPath), false);
    assert.equal(result.workspace.cleanup, 'REMOVED');
  } finally {
    removeFixture(fixture);
  }
});

test('success finalizer runs only for SUCCESS, never for ALREADY_SATISFIED or failures', () => {
  const satisfiedFixture = buildFixture();
  const failedFixture = buildFixture();
  try {
    const noop = createFakeOpencode({});
    const satisfied = runOnce(runOnceOptions(satisfiedFixture), {
      invokeOpencode: noop.invokeOpencode,
      log: () => {},
      successFinalizer: () => {
        throw new Error('finalizer must not run for ALREADY_SATISFIED');
      },
    });
    assert.equal(satisfied.status, ALREADY_SATISFIED);
    assert.equal(satisfied.successHandoff, null);

    const violating = createFakeOpencode({ writes: [{ path: 'outside.txt', content: 'no\n' }] });
    const failed = runOnce(runOnceOptions(failedFixture), {
      invokeOpencode: violating.invokeOpencode,
      log: () => {},
      successFinalizer: () => {
        throw new Error('finalizer must not run for BOUNDARY_VIOLATION');
      },
    });
    assert.equal(failed.status, BOUNDARY_VIOLATION);
    assert.equal(failed.successHandoff, null);
  } finally {
    removeFixture(satisfiedFixture);
    removeFixture(failedFixture);
  }
});

test('ALREADY_SATISFIED closes without publication and without touching the provider', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({});
    const github = createFakeGithub({ bare: fixture.bare });
    const result = runPublishOnce(publishOptions(fixture, { proofCommands: ['node --version'] }), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
    });
    assert.equal(result.status, ALREADY_SATISFIED);
    assert.equal(result.publication, null);
    assert.equal(github.calls.length, 0);
    assert.equal(remoteRefSha(fixture.bare, 'tmp/spec-transport'), null);
  } finally {
    removeFixture(fixture);
  }
});

test('proof failure produces no candidate commit and no publication', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'wrong\n' }] });
    const github = createFakeGithub({ bare: fixture.bare });
    const result = runPublishOnce(publishOptions(fixture, { proofCommands: ['node proof-check.cjs'] }), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
    });
    assert.equal(result.status, PROOF_FAILED);
    assert.equal(result.publication, null);
    assert.equal(github.calls.length, 0);
    assert.equal(remoteRefSha(fixture.bare, 'tmp/spec-transport'), null);
    assert.equal(result.workspace.cleanup, 'REMOVED');
  } finally {
    removeFixture(fixture);
  }
});

test('boundary violation produces no candidate commit and no publication', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({
      writes: [
        { path: 'src/allowed.txt', content: 'ok\n' },
        { path: 'outside.txt', content: 'forbidden\n' },
      ],
    });
    const github = createFakeGithub({ bare: fixture.bare });
    const result = runPublishOnce(publishOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
    });
    assert.equal(result.status, BOUNDARY_VIOLATION);
    assert.equal(result.publication, null);
    assert.equal(github.calls.length, 0);
    assert.equal(remoteRefSha(fixture.bare, 'tmp/spec-transport'), null);
  } finally {
    removeFixture(fixture);
  }
});

test('a staged path outside the Git-observed boundary fails closed before any commit', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({
      writes: [{ path: 'src/allowed.txt', content: 'ok\n' }],
      after: (cwd) => {
        writeFileSync(join(cwd, 'hidden.txt'), 'hidden\n');
        git(cwd, ['add', '--', 'hidden.txt']);
        unlinkSync(join(cwd, 'hidden.txt'));
      },
    });
    const github = createFakeGithub({ bare: fixture.bare });
    const result = runPublishOnce(publishOptions(fixture, { proofCommands: ['node proof-check.cjs'] }), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
    });
    assert.equal(result.status, BOUNDARY_VIOLATION);
    assert.equal(result.publication.candidate.candidateSha, undefined);
    assert.equal(github.calls.length, 0);
    assert.equal(remoteRefSha(fixture.bare, 'tmp/spec-transport'), null);
  } finally {
    removeFixture(fixture);
  }
});

test('PRE_PR COMPLETE_ALREADY_PUBLISHED creates no transport, PR, or CI wait', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const github = createFakeGithub({ bare: fixture.bare });
    let rivalSha = null;
    const result = runPublishOnce(publishOptions(fixture, { proofCommands: ['rival-publication'] }), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
      runProofCommand: () => {
        rivalSha = rivalPublish({
          bare: fixture.bare,
          files: { 'src/allowed.txt': 'ok\n' },
          message: 'rival publication of the same delta',
        });
        return { exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '' };
      },
    });
    assert.equal(result.status, COMPLETE_ALREADY_PUBLISHED);
    assert.equal(result.publication.prePr.status, COMPLETE_ALREADY_PUBLISHED);
    assert.equal(result.publication.remoteMainSha, rivalSha);
    assert.equal(result.publication.remoteDeltaVerified, true);
    assert.equal(result.publication.transportCleanup, 'NOT_CREATED');
    assert.equal(github.calls.length, 0);
    assert.equal(remoteRefSha(fixture.bare, 'tmp/spec-transport'), null);
  } finally {
    removeFixture(fixture);
  }
});

test('PRE_PR semantic owner review fails closed before transport or credentials', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const github = createFakeGithub({ bare: fixture.bare });
    const result = runPublishOnce(publishOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
      decidePrePublication: () => ({
        status: SEMANTIC_OWNER_REVIEW_REQUIRED,
        phase: 'PRE_PR',
        remainingDelta: [],
        reason: 'spec-injected semantic-owner movement',
      }),
    });
    assert.equal(result.status, PUBLICATION_BLOCKED);
    assert.equal(result.publication.prePr.status, SEMANTIC_OWNER_REVIEW_REQUIRED);
    assert.equal(result.publication.transportCreated, false);
    assert.equal(github.calls.length, 0);
    assert.equal(remoteRefSha(fixture.bare, 'tmp/spec-transport'), null);
  } finally {
    removeFixture(fixture);
  }
});

test('CI failure ends the invocation without a merge and retains evidence', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const github = createFakeGithub({ bare: fixture.bare, checksResult: 'fail' });
    const result = runPublishOnce(publishOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
    });
    assert.equal(result.status, CI_FAILED);
    assert.equal(github.state.mergeCalls.length, 0);
    assert.equal(github.state.closeCalls.length, 0);
    assert.equal(result.publication.retained, true);
    assert.equal(result.publication.transportCleanup, 'RETAINED');
    assert.equal(remoteRefSha(fixture.bare, 'tmp/spec-transport') !== null, true);
    assert.equal(result.workspace.cleanup, 'REMOVED');
  } finally {
    removeFixture(fixture);
  }
});

test('PRE_MERGE SUPERSEDED_ALREADY_PUBLISHED closes own PR, deletes ref, reads back main', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    let rivalSha = null;
    const github = createFakeGithub({
      bare: fixture.bare,
      onChecks: ({ pr }) => {
        if (rivalSha === null && pr.state === 'OPEN') {
          rivalSha = rivalPublish({
            bare: fixture.bare,
            files: { 'src/allowed.txt': 'ok\n' },
            message: 'rival publication while CI ran',
          });
        }
      },
    });
    const result = runPublishOnce(publishOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
    });
    assert.equal(result.status, SUPERSEDED_ALREADY_PUBLISHED);
    assert.equal(result.publication.preMerge.status, SUPERSEDED_ALREADY_PUBLISHED);
    assert.equal(github.state.mergeCalls.length, 0);
    assert.equal(github.state.closeCalls.length, 1);
    assert.equal(result.publication.prClose, 'CLOSED');
    assert.equal(remoteRefSha(fixture.bare, 'tmp/spec-transport'), null);
    assert.equal(result.publication.transportCleanup, 'REMOVED');
    assert.equal(result.publication.remoteMainSha, rivalSha);
    assert.equal(result.publication.remoteDeltaVerified, true);
  } finally {
    removeFixture(fixture);
  }
});

test('PRE_MERGE semantic owner conflict fails closed without merge or local rewrite', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const github = createFakeGithub({ bare: fixture.bare });
    const headBefore = git(fixture.root, ['rev-parse', 'HEAD']);
    const result = runPublishOnce(publishOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
      decidePreMerge: () => ({
        status: SEMANTIC_OWNER_REVIEW_REQUIRED,
        phase: 'PRE_MERGE',
        remainingDelta: [],
        reason: 'spec-injected semantic-owner overlap',
      }),
    });
    assert.equal(result.status, PUBLICATION_BLOCKED);
    assert.equal(result.publication.preMerge.status, SEMANTIC_OWNER_REVIEW_REQUIRED);
    assert.equal(github.state.mergeCalls.length, 0);
    assert.equal(result.publication.retained, true);
    assert.equal(result.publication.transportCleanup, 'RETAINED');
    assert.equal(git(fixture.root, ['rev-parse', 'HEAD']), headBefore);
    assert.equal(result.canonicalCheckout.unchanged, true);
  } finally {
    removeFixture(fixture);
  }
});

test('strict required-check staleness is PUBLICATION_REFRESH_REQUIRED, never an automatic update', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const github = createFakeGithub({
      bare: fixture.bare,
      onChecks: ({ pr }) => {
        pr.mergeStateStatus = 'BEHIND';
      },
    });
    const result = runPublishOnce(publishOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
    });
    assert.equal(result.status, PUBLICATION_REFRESH_REQUIRED);
    assert.equal(github.state.mergeCalls.length, 0);
    assert.equal(result.publication.retained, true);
    assert.equal(result.publication.transportCleanup, 'RETAINED');
  } finally {
    removeFixture(fixture);
  }
});

test('a provider merge refusal without staleness is PUBLICATION_BLOCKED', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const github = createFakeGithub({
      bare: fixture.bare,
      mergeEffect: () => ({ exitCode: 1, mergeStateStatus: 'BLOCKED', stderr: 'merge is blocked' }),
    });
    const result = runPublishOnce(publishOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
    });
    assert.equal(result.status, PUBLICATION_BLOCKED);
    assert.equal(github.state.mergeCalls.length, 1);
    assert.equal(result.publication.retained, true);
  } finally {
    removeFixture(fixture);
  }
});

test('canonical remote read-back is mandatory: merged-but-unchanged main is REMOTE_READBACK_FAILED', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const github = createFakeGithub({
      bare: fixture.bare,
      mergeEffect: () => ({
        merge: true,
        mergeSha: git(fixture.bare, ['rev-parse', 'refs/heads/main']),
      }),
    });
    const result = runPublishOnce(publishOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
    });
    assert.equal(result.status, REMOTE_READBACK_FAILED);
    assert.equal(result.publication.remoteDeltaVerified, false);
    assert.deepEqual(result.publication.remoteBlobsMismatched, ['src/allowed.txt']);
    assert.equal(result.publication.transportCleanup, 'REMOVED');
  } finally {
    removeFixture(fixture);
  }
});

test('remote owned delta equivalence is checked, not command success', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const github = createFakeGithub({
      bare: fixture.bare,
      mergeEffect: () => ({
        merge: true,
        mergeSha: rivalPublish({
          bare: fixture.bare,
          files: { 'src/allowed.txt': 'tampered\n' },
          message: 'tampered merge',
        }),
      }),
    });
    const result = runPublishOnce(publishOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
    });
    assert.equal(result.status, REMOTE_READBACK_FAILED);
    assert.deepEqual(result.publication.remoteBlobsMismatched, ['src/allowed.txt']);
  } finally {
    removeFixture(fixture);
  }
});

test('foreign dirty canonical checkout is preserved across the full publication', () => {
  const fixture = buildFixture();
  try {
    writeFileSync(join(fixture.root, 'src', 'base.txt'), 'foreign tracked dirty\n');
    writeFileSync(join(fixture.root, 'foreign-untracked.txt'), 'foreign untracked\n');
    const statusBefore = gitRaw(fixture.root, ['status', '--porcelain=v1']);
    const trackedBefore = readFileSync(join(fixture.root, 'src', 'base.txt'), 'utf8');

    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const github = createFakeGithub({ bare: fixture.bare });
    const result = runPublishOnce(publishOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
    });

    assert.equal(result.status, SUCCESS_PUBLISHED);
    assert.equal(gitRaw(fixture.root, ['status', '--porcelain=v1']), statusBefore);
    assert.equal(readFileSync(join(fixture.root, 'src', 'base.txt'), 'utf8'), trackedBefore);
    assert.equal(result.canonicalCheckout.unchanged, true);
    assert.equal(result.publication.canonicalCheckoutUnchanged, true);
  } finally {
    removeFixture(fixture);
  }
});

test('workspace cleanup failure is surfaced with the publication evidence attached', () => {
  const fixture = buildFixture();
  let leftoverRoot = null;
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const github = createFakeGithub({ bare: fixture.bare });
    const result = runPublishOnce(publishOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
      removeWorkspace: () => ({ removed: false, errors: ['simulated workspace cleanup failure'] }),
    });
    leftoverRoot = dirname(result.workspace.path);
    assert.equal(result.status, CLEANUP_FAILED);
    assert.equal(result.publication.outcome, SUCCESS_PUBLISHED);
    assert.match(result.reason, /workspace cleanup failed/);
    assert.equal(result.publication.remoteDeltaVerified, true);
  } finally {
    if (leftoverRoot !== null) rmSync(leftoverRoot, { recursive: true, force: true });
    removeFixture(fixture);
  }
});

test('transport ref cleanup failure is surfaced as CLEANUP_FAILED', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const github = createFakeGithub({ bare: fixture.bare });
    const result = runPublishOnce(publishOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
      deleteTemporaryTransportRef: () => {
        throw new Error('simulated transport cleanup failure');
      },
    });
    assert.equal(result.status, CLEANUP_FAILED);
    assert.equal(result.publication.transportCleanup, 'FAILED');
    assert.deepEqual(result.publication.transportCleanupErrors, [
      'simulated transport cleanup failure',
    ]);
  } finally {
    removeFixture(fixture);
  }
});

test('no durable state files, no retired coordination dependency, no selection loop', () => {
  const source = readFileSync(new URL('./run-publish-once.mjs', import.meta.url), 'utf8');
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
    /\bgh issue\b/i,
    /label scanning/i,
  ];
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(source), `run-publish-once.mjs must not contain ${pattern}`);
  }
  assert.ok(!/from '\.\.\/coordination/.test(source));
  assert.ok(!/setInterval/.test(source));
  assert.ok(!/readdirSync\(.*coordination/.test(source));

  const runOnceSource = readFileSync(new URL('./run-once.mjs', import.meta.url), 'utf8');
  assert.ok(!/['"]pr['"], ['"]create['"]/.test(runOnceSource));
  assert.ok(!/['"]pr['"], ['"]merge['"]/.test(runOnceSource));
  assert.ok(!/execFileSync\(['"]gh['"]|spawnSync\(['"]gh['"]/.test(runOnceSource));
});

test('parseArgs reuses the GN-01 convention and requires publication input', () => {
  const parsed = parseArgs([
    '--task',
    'task.md',
    '--allow',
    'src',
    '--allow',
    'scripts/agent',
    '--proof',
    'node --test one',
    '--commit-message',
    'feat: bounded change',
    '--pr-title',
    'Bounded change',
    '--ci-timeout-ms',
    '1234',
    '--repo',
    'C:\\repo',
  ]);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.options.allowedPaths, ['src', 'scripts/agent']);
  assert.deepEqual(parsed.options.proofCommands, ['node --test one']);
  assert.equal(parsed.options.commitMessage, 'feat: bounded change');
  assert.equal(parsed.options.prTitle, 'Bounded change');
  assert.equal(parsed.options.ciTimeoutMs, 1234);
  assert.equal(parsed.options.repositoryRoot, 'C:\\repo');

  assert.equal(parseArgs(['--task', 't.md', '--allow', 'src']).ok, false);
  assert.equal(parseArgs(['--task', 't.md', '--allow', 'src', '--commit-message', 'm']).ok, false);
  assert.equal(
    parseArgs(['--task', 't.md', '--allow', 'src', '--commit-message', 'm', '--pr-title', 'T', '--bogus'])
      .ok,
    false,
  );
  assert.equal(
    parseArgs(['--task', 't.md', '--allow', 'src', '--commit-message', 'm', '--pr-title', 'T', '--pr-body'])
      .ok,
    false,
  );
});

test('invalid input is rejected before any Git, provider, or process effect', () => {
  const result = runPublishOnce(
    { repositoryRoot: process.cwd(), allowedPaths: [], taskText: '', commitMessage: '', prTitle: '' },
    {
      invokeOpencode: () => {
        throw new Error('must not be invoked');
      },
      runGh: () => {
        throw new Error('must not be invoked');
      },
      log: () => {},
    },
  );
  assert.equal(result.status, 'INVALID_INPUT');
  assert.equal(result.publication, null);
  assert.equal(result.workspace.cleanup, 'NOT_CREATED');
  assert.ok(PUBLISH_ONCE_STATUSES.includes('INVALID_INPUT'));
  assert.equal(validatePublishOnceInput({ commitMessage: 'm', prTitle: 'T' }), null);
  assert.equal(validatePublishOnceInput({ commitMessage: '', prTitle: 'T' }), '--commit-message is required');
  assert.equal(validatePublishOnceInput({ commitMessage: 'm', prTitle: '' }), '--pr-title is required');
  assert.equal(
    validatePublishOnceInput({ commitMessage: 'm', prTitle: 'T', githubRepository: 'nope' }),
    '--github-repo must be <owner>/<name>',
  );
});

test('transport ref names are task-owned, invocation-unique, and candidate-only', () => {
  const refs = new Set();
  for (let index = 0; index < 50; index += 1) refs.add(createTemporaryTransportRef());
  assert.equal(refs.size, 50);
  for (const ref of refs) assert.match(ref, /^tmp\/run-publish-once-[0-9a-z]+$/);
  const args = buildCandidateCommitArgs({ message: 'm', tempRoot: '/tmp/scratch' });
  assert.ok(args.includes('--no-verify'));
  assert.ok(args.includes('--no-gpg-sign'));
  assert.ok(args.includes('commit.gpgsign=false'));
  assert.ok(args.includes('user.name=greenhub-run-publish-once'));
  assert.ok(args.some((entry) => entry.startsWith('core.hooksPath=')));
  assert.equal(PUBLICATION_SUCCESS_OUTCOMES.includes(SUCCESS_PUBLISHED), true);
});

test('B ??unrelated PRE_PR movement re-binds the exact delta without a second OpenCode run', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const github = createFakeGithub({ bare: fixture.bare });
    let movedMainSha = null;
    let proofCalls = 0;
    const result = runPublishOnce(publishOptions(fixture, { proofCommands: ['rebind-move-proof'] }), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
      runProofCommand: () => {
        proofCalls += 1;
        if (movedMainSha === null) {
          movedMainSha = rivalPublish({
            bare: fixture.bare,
            files: { 'unrelated.txt': 'moved-unrelated\n' },
            message: 'unrelated movement before PRE_PR',
          });
        }
        return { exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '' };
      },
    });

    assert.equal(result.status, SUCCESS_PUBLISHED);
    assert.equal(fake.invocations.length, 1);
    assert.equal(result.publication.rebind.status, 'REBOUND');
    assert.equal(result.publication.rebind.count, 1);
    assert.equal(result.publication.attempts, 1);
    assert.notEqual(movedMainSha, null);
    assert.equal(proofCalls, 2);

    const candidate = result.publication.candidate.candidateSha;
    const originalCandidate = result.publication.rebind.history[0].previousCandidateSha;
    assert.deepEqual(
      git(fixture.root, ['rev-list', '--parents', '-n', '1', candidate]).split(/\s+/),
      [candidate, movedMainSha],
    );
    assert.deepEqual(
      git(fixture.root, ['diff', '--name-only', `${movedMainSha}..${candidate}`])
        .split('\n')
        .filter((entry) => entry.length > 0),
      ['src/allowed.txt'],
    );
    assert.equal(
      git(fixture.root, ['ls-tree', candidate, '--', 'src/allowed.txt']),
      git(fixture.root, ['ls-tree', originalCandidate, '--', 'src/allowed.txt']),
    );
    assert.equal(git(fixture.root, ['show', `${candidate}:unrelated.txt`]), 'moved-unrelated');
    const remoteMain = git(fixture.bare, ['rev-parse', 'refs/heads/main']);
    assert.equal(git(fixture.bare, ['show', `${remoteMain}:unrelated.txt`]), 'moved-unrelated');
    assert.equal(git(fixture.bare, ['show', `${remoteMain}:src/allowed.txt`]), 'ok');

    assert.equal(github.prs.get(1).headRefOid, candidate);
    assert.equal(valueOf(github.state.mergeCalls[0].args, '--match-head-commit'), candidate);
    assert.equal(remoteRefSha(fixture.bare, 'tmp/spec-transport'), null);
    assert.deepEqual(remoteTemporaryRefs(fixture.bare), []);
    assert.equal(result.workspace.cleanup, 'REMOVED');
    assert.equal(existsSync(result.workspace.path), false);
    assert.equal(existsSync(dirname(result.workspace.path)), false);
    assert.equal(result.canonicalCheckout.unchanged, true);
    assert.equal(result.publication.remoteDeltaVerified, true);
  } finally {
    removeFixture(fixture);
  }
});

test('C ??movement during CI retires the first PR and publishes the rebound candidate', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const checkedPrs = new Set();
    let movedMainSha = null;
    let moved = false;
    const github = createFakeGithub({
      bare: fixture.bare,
      onChecks: ({ pr }) => {
        checkedPrs.add(pr.number);
        if (!moved) {
          moved = true;
          movedMainSha = rivalPublish({
            bare: fixture.bare,
            files: { 'unrelated-1.txt': 'moved-during-ci\n' },
            message: 'movement during CI',
          });
        }
      },
    });
    const result = runPublishOnce(publishOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
    });

    assert.equal(result.status, SUCCESS_PUBLISHED);
    assert.equal(fake.invocations.length, 1);
    assert.equal(github.prs.size, 2);
    assert.equal(github.prs.get(1).state, 'CLOSED');
    assert.equal(github.prs.get(2).state, 'MERGED');
    assert.equal(github.state.closeCalls.length, 1);
    assert.deepEqual([...checkedPrs].sort(), [1, 2]);
    assert.equal(result.publication.attempts, 2);
    assert.equal(result.publication.rebind.count, 1);
    assert.equal(result.publication.stalePublications.length, 1);
    assert.equal(result.publication.stalePublications[0].prClose, 'CLOSED');
    assert.equal(result.publication.stalePublications[0].transportCleanup, 'REMOVED');
    assert.equal(result.publication.pr.number, 2);
    const candidate = result.publication.candidate.candidateSha;
    assert.deepEqual(
      git(fixture.root, ['rev-list', '--parents', '-n', '1', candidate]).split(/\s+/),
      [candidate, movedMainSha],
    );
    assert.equal(valueOf(github.state.mergeCalls[0].args, '--match-head-commit'), candidate);
    assert.equal(result.publication.remoteDeltaVerified, true);
    assert.equal(remoteRefSha(fixture.bare, 'tmp/spec-transport'), null);
    assert.deepEqual(remoteTemporaryRefs(fixture.bare), []);
    assert.equal(result.workspace.cleanup, 'REMOVED');
  } finally {
    removeFixture(fixture);
  }
});

test('D ??owned path conflict before PRE_PR blocks with zero provider calls and no overwrite', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const github = createFakeGithub({ bare: fixture.bare });
    let foreignMainSha = null;
    const result = runPublishOnce(
      publishOptions(fixture, { proofCommands: ['foreign-owned-proof'] }),
      {
        invokeOpencode: fake.invokeOpencode,
        runGh: github.runGh,
        log: () => {},
        runProofCommand: () => {
          if (foreignMainSha === null) {
            foreignMainSha = rivalPublish({
              bare: fixture.bare,
              files: { 'src/allowed.txt': 'foreign-owned\n' },
              message: 'foreign edit on the owned path',
            });
          }
          return { exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '' };
        },
      },
    );
    assert.equal(result.status, PUBLICATION_BLOCKED);
    assert.equal(result.publication.rebind.status, 'BLOCKED');
    assert.equal(github.calls.length, 0);
    assert.equal(github.state.mergeCalls.length, 0);
    assert.equal(remoteRefSha(fixture.bare, 'tmp/spec-transport'), null);
    assert.deepEqual(remoteTemporaryRefs(fixture.bare), []);
    assert.equal(git(fixture.bare, ['show', `${foreignMainSha}:src/allowed.txt`]), 'foreign-owned');
    assert.equal(result.canonicalCheckout.unchanged, true);
  } finally {
    removeFixture(fixture);
  }
});

test('D2 ??owned path conflict during CI retains the PR and blocks the merge', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    let moved = false;
    const github = createFakeGithub({
      bare: fixture.bare,
      onChecks: () => {
        if (!moved) {
          moved = true;
          rivalPublish({
            bare: fixture.bare,
            files: { 'src/allowed.txt': 'foreign-during-ci\n' },
            message: 'foreign owned edit during CI',
          });
        }
      },
    });
    const result = runPublishOnce(publishOptions(fixture), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
    });
    assert.equal(result.status, PUBLICATION_BLOCKED);
    assert.equal(result.publication.rebind.status, 'BLOCKED');
    assert.equal(github.state.mergeCalls.length, 0);
    assert.equal(github.prs.get(1).state, 'OPEN');
    assert.equal(result.publication.retained, true);
    assert.equal(result.publication.transportCleanup, 'RETAINED');
  } finally {
    removeFixture(fixture);
  }
});

test('E ??proof-owner-scoped movement re-executes only the affected proof', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const github = createFakeGithub({ bare: fixture.bare });
    const executed = [];
    let moved = false;
    const result = runPublishOnce(
      publishOptions(fixture, {
        proofCommands: ['proof-one', 'proof-two'],
        proofOwners: [['src'], ['docs']],
      }),
      {
        invokeOpencode: fake.invokeOpencode,
        runGh: github.runGh,
        log: () => {},
        runProofCommand: ({ command }) => {
          executed.push(command);
          if (!moved) {
            moved = true;
            rivalPublish({
              bare: fixture.bare,
              files: { 'src/unrelated.txt': 'owner-one movement\n' },
              message: 'movement inside proof-one owner',
            });
          }
          return { exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '' };
        },
      },
    );
    assert.equal(result.status, SUCCESS_PUBLISHED);
    assert.deepEqual(executed, ['proof-one', 'proof-two', 'proof-one']);
    assert.deepEqual(result.publication.rebind.history[0].proofReexecutions, [
      { command: 'proof-one', owners: ['src'], stale: true },
      { command: 'proof-two', owners: ['docs'], stale: false },
    ]);
    assert.equal(result.publication.rebind.count, 1);
  } finally {
    removeFixture(fixture);
  }
});

test('E2 ??no movement and no proof owners re-executes nothing', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const github = createFakeGithub({ bare: fixture.bare });
    let calls = 0;
    const result = runPublishOnce(publishOptions(fixture, { proofCommands: ['only-proof'] }), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
      runProofCommand: () => {
        calls += 1;
        return { exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '' };
      },
    });
    assert.equal(result.status, SUCCESS_PUBLISHED);
    assert.equal(calls, 1);
    assert.equal(result.publication.rebind.status, 'NOT_REQUIRED');
    assert.equal(result.publication.rebind.count, 0);
  } finally {
    removeFixture(fixture);
  }
});

test('F ??repeated movement is bounded by maxRebindAttempts and ends REFRESH_REQUIRED', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const movedPrs = new Set();
    const github = createFakeGithub({
      bare: fixture.bare,
      onChecks: ({ pr }) => {
        if (!movedPrs.has(pr.number)) {
          movedPrs.add(pr.number);
          rivalPublish({
            bare: fixture.bare,
            files: { [`unrelated-${pr.number}.txt`]: `moved-${pr.number}\n` },
            message: `movement during CI for PR ${pr.number}`,
          });
        }
      },
    });
    const result = runPublishOnce(publishOptions(fixture, { maxRebindAttempts: 1 }), {
      invokeOpencode: fake.invokeOpencode,
      runGh: github.runGh,
      log: () => {},
    });
    assert.equal(result.status, PUBLICATION_REFRESH_REQUIRED);
    assert.equal(result.publication.rebind.status, 'EXHAUSTED');
    assert.equal(result.publication.rebind.count, 1);
    assert.equal(result.publication.attempts, 2);
    assert.ok(github.prs.size <= 2);
    assert.equal(result.publication.retained, true);
    assert.equal(fake.invocations.length, 1);
    assert.equal(result.publication.transportCleanup, 'RETAINED');
  } finally {
    removeFixture(fixture);
  }
});

test('G ??a rebind whose affected proof fails ends PROOF_FAILED with no PR and no leak', () => {
  const fixture = buildFixture();
  try {
    const fake = createFakeOpencode({ writes: [{ path: 'src/allowed.txt', content: 'ok\n' }] });
    const github = createFakeGithub({ bare: fixture.bare });
    let calls = 0;
    const result = runPublishOnce(
      publishOptions(fixture, { proofCommands: ['proof-one'], proofOwners: [['src']] }),
      {
        invokeOpencode: fake.invokeOpencode,
        runGh: github.runGh,
        log: () => {},
        runProofCommand: () => {
          calls += 1;
          if (calls === 1) {
            rivalPublish({
              bare: fixture.bare,
              files: { 'src/unrelated.txt': 'movement\n' },
              message: 'movement inside proof-one owner',
            });
            return { exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '' };
          }
          return {
            exitCode: 1,
            signal: null,
            timedOut: false,
            stdout: '',
            stderr: 'rebound proof failed',
          };
        },
      },
    );
    assert.equal(result.status, PROOF_FAILED);
    assert.equal(result.publication.rebind.status, 'PROOF_FAILED');
    assert.equal(github.calls.length, 0);
    assert.equal(github.prs.size, 0);
    assert.equal(remoteRefSha(fixture.bare, 'tmp/spec-transport'), null);
    assert.deepEqual(remoteTemporaryRefs(fixture.bare), []);
    assert.equal(result.workspace.cleanup, 'REMOVED');
    assert.equal(existsSync(result.workspace.path), false);
    assert.equal(existsSync(dirname(result.workspace.path)), false);
    assert.equal(result.canonicalCheckout.unchanged, true);
    assert.equal(fake.invocations.length, 1);
  } finally {
    removeFixture(fixture);
  }
});
