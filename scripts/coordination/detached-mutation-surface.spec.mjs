// Proof for PM-02-DETACHED-MUTATION-SURFACE.
//
// Throwaway detached mutation surface lifecycle: CREATE -> VERIFY -> RETIRE.
// All runtime state lives in isolated OS-temp directories backed by real local
// git repositories; no network, no GitHub remote, no canonical checkout
// mutation.
//
// Proof map (required cases 1..13 from the task):
//   A.  exact liveMainSha surface is created with a detached HEAD (1).
//   B.  zero local development branches (2) + no remote-tracking dev refs.
//   C.  surface starts clean (3).
//   D.  surface owns a separate .git, different from the canonical repo (4).
//   E.  two concurrent surfaces (different tasks) get different paths (5).
//   F.  two concurrent creates for the SAME taskId never share a directory (6).
//   G.  verification with a wrong SHA fails closed (7).
//   H.  branch state verification fails closed (8): attached HEAD and side
//       local branch are both refused.
//   I.  create inside the canonical repository is refused (9).
//   J.  foreign directory / foreign task / tampered proof retire is refused (10).
//   K.  owned surface retire succeeds (11).
//   L.  retire removes the directory and a second retire is SURFACE_NOT_FOUND (12).
//   M.  retiring one surface does not affect another surface (13).
//   N.  input fail-closed: invalid taskId / liveMainSha / remoteUrl /
//       parentDirectory, plus a runtime BASELINE_SHA_MISMATCH with no residue.
//   O.  unexpected dirty start fails verification.
//   P.  stale surface reuse never happens: a new create for the same taskId
//       allocates a fresh directory, never a retired one.
//   Q.  static boundary: no branch/worktree/clone/remote-mutation commands,
//       node-builtin imports only, exact exported surface.
//   R.  the working repository (canonical checkout when run from it) is not
//       mutated by create/verify/retire.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
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
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as surfaceModule from './detached-mutation-surface.mjs';
import {
  BASELINE_SHA_MISMATCH,
  createDetachedMutationSurface,
  DETACHED_MUTATION_SURFACE_DIRECTORY_PREFIX,
  DETACHED_MUTATION_SURFACE_MARKER,
  DETACHED_MUTATION_SURFACE_OWNERSHIP_FILENAME,
  DetachedMutationSurfaceError,
  FOREIGN_SURFACE_RETIRE_REFUSED,
  HEAD_NOT_DETACHED,
  HEAD_SHA_MISMATCH,
  INVALID_LIVE_MAIN_SHA,
  INVALID_PARENT_DIRECTORY,
  INVALID_REMOTE_URL,
  INVALID_TASK_ID,
  LOCAL_BRANCH_PRESENT,
  retireDetachedMutationSurface,
  SURFACE_INSIDE_CANONICAL_REPOSITORY,
  SURFACE_NOT_FOUND,
  SURFACE_OWNERSHIP_PROOF_INVALID,
  SURFACE_OWNERSHIP_PROOF_MISSING,
  UNEXPECTED_DIRTY_START,
  verifyDetachedMutationSurface,
} from './detached-mutation-surface.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = join(MODULE_DIRECTORY, 'detached-mutation-surface.mjs');
const MODULE_URL = pathToFileURL(MODULE_PATH).href;

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function probeGit(cwd, args) {
  try {
    return {
      ok: true,
      stdout: execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
    };
  } catch {
    return { ok: false, stdout: '' };
  }
}

function normalizePath(path) {
  const resolved = resolve(path);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function samePath(left, right) {
  return normalizePath(left) === normalizePath(right);
}

function removeDirectory(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function makeParent(prefix = 'greenhub-dms-parent-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Real local git repository fixture: two commits, remote-free. */
function makeFixtureRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'greenhub-dms-fixture-'));
  git(directory, ['init', '--quiet']);
  git(directory, ['config', 'user.email', 'dms-test@local']);
  git(directory, ['config', 'user.name', 'dms-test']);
  git(directory, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(directory, 'README.md'), 'fixture v1\n');
  git(directory, ['add', '--', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'fixture v1']);
  const firstSha = git(directory, ['rev-parse', 'HEAD']);
  writeFileSync(join(directory, 'README.md'), 'fixture v2\n');
  git(directory, ['add', '--', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'fixture v2']);
  const baselineSha = git(directory, ['rev-parse', 'HEAD']);
  return { directory, firstSha, baselineSha };
}

function createSurface({ fixture, parent, taskId = 'DMS-TEST-TASK', overrides = {} } = {}) {
  return createDetachedMutationSurface({
    taskId,
    remoteUrl: fixture.directory,
    liveMainSha: fixture.baselineSha,
    parentDirectory: parent,
    canonicalRepositoryRoot: fixture.directory,
    ...overrides,
  });
}

function assertSurfaceError(operation, code) {
  assert.throws(operation, (error) => {
    assert.ok(
      error instanceof DetachedMutationSurfaceError,
      `expected DetachedMutationSurfaceError, got ${error?.name}: ${error?.message}`,
    );
    assert.equal(error.code, code, `unexpected code for: ${error.message}`);
    return true;
  });
}

function surfaceOwnershipPath(surfacePath) {
  return join(surfacePath, '.git', DETACHED_MUTATION_SURFACE_OWNERSHIP_FILENAME);
}

function readOwnership(surfacePath) {
  return JSON.parse(readFileSync(surfaceOwnershipPath(surfacePath), 'utf8'));
}

/** Real concurrent CREATE in a child process; returns the created record. */
function runChildCreate(options) {
  const script = [
    `const moduleUrl = ${JSON.stringify(MODULE_URL)};`,
    `const options = ${JSON.stringify(options)};`,
    'const surfaceModule = await import(moduleUrl);',
    'const created = surfaceModule.createDetachedMutationSurface(options);',
    'process.stdout.write(JSON.stringify(created));',
  ].join('\n');
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`child create failed (exit ${code}): ${stderr.trim()}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch {
        rejectPromise(new Error(`child create returned unparsable output: ${stdout}`));
      }
    });
  });
}

function captureWorkingRepositoryState() {
  const root = probeGit(process.cwd(), ['rev-parse', '--show-toplevel']);
  if (!root.ok || root.stdout.length === 0) return null;
  return {
    root: root.stdout,
    branch: probeGit(process.cwd(), ['branch', '--show-current']).stdout,
    head: probeGit(process.cwd(), ['rev-parse', 'HEAD']).stdout,
    status: git(process.cwd(), ['status', '--porcelain']),
  };
}

function assertOwnedRetired(surface) {
  assert.equal(existsSync(surface.surfacePath), false, surface.surfacePath);
}

// ---------------------------------------------------------------------------
// A. EXACT SHA DETACHED SURFACE + OWNERSHIP PROOF.
// ---------------------------------------------------------------------------

test('A. create materializes the exact liveMainSha with a detached HEAD and ownership proof', () => {
  const fixture = makeFixtureRepository();
  const parent = makeParent();
  try {
    const surface = createSurface({ fixture, parent });
    assert.equal(surface.baselineSha, fixture.baselineSha);
    assert.equal(surface.headSha, fixture.baselineSha);
    assert.equal(surface.detached, true);
    assert.equal(surface.clean, true);
    assert.equal(surface.localBranchCount, 0);
    assert.equal(surface.taskId, 'DMS-TEST-TASK');
    assert.ok(surface.surfaceId.startsWith(DETACHED_MUTATION_SURFACE_DIRECTORY_PREFIX));
    assert.equal(surface.surfaceId, basename(surface.surfacePath));

    // The exact commit is present and HEAD resolves to it.
    assert.equal(git(surface.surfacePath, ['rev-parse', 'HEAD']), fixture.baselineSha);
    assert.equal(git(surface.surfacePath, ['cat-file', '-t', fixture.baselineSha]), 'commit');

    // Ownership proof lives inside the surface's own .git directory only.
    const ownership = readOwnership(surface.surfacePath);
    assert.equal(ownership.marker, DETACHED_MUTATION_SURFACE_MARKER);
    assert.equal(ownership.surfaceId, surface.surfaceId);
    assert.equal(ownership.taskId, 'DMS-TEST-TASK');
    assert.equal(ownership.baselineSha, fixture.baselineSha);
    assert.equal(ownership.remoteUrl, fixture.directory);
    assert.ok(samePath(ownership.parentDirectory, parent));
    assert.ok(samePath(ownership.canonicalRepositoryRoot, fixture.directory));

    const verified = verifyDetachedMutationSurface({
      surfacePath: surface.surfacePath,
      taskId: 'DMS-TEST-TASK',
      expectedBaselineSha: fixture.baselineSha,
      canonicalRepositoryRoot: fixture.directory,
    });
    assert.equal(verified.detached, true);
    assert.equal(verified.headSha, fixture.baselineSha);
    assert.equal(verified.localBranchCount, 0);
  } finally {
    removeDirectory(parent);
    removeDirectory(fixture.directory);
  }
});

// ---------------------------------------------------------------------------
// B. ZERO LOCAL BRANCHES.
// ---------------------------------------------------------------------------

test('B. the surface has zero local branches and no remote-tracking development refs', () => {
  const fixture = makeFixtureRepository();
  const parent = makeParent();
  try {
    const surface = createSurface({ fixture, parent });
    assert.equal(
      git(surface.surfacePath, ['for-each-ref', '--format=%(refname)', 'refs/heads']),
      '',
    );
    assert.equal(
      git(surface.surfacePath, ['for-each-ref', '--format=%(refname)', 'refs/remotes']),
      '',
    );
    assert.equal(git(surface.surfacePath, ['rev-parse', '--abbrev-ref', 'HEAD']), 'HEAD');
    assert.equal(probeGit(surface.surfacePath, ['symbolic-ref', '-q', 'HEAD']).ok, false);
  } finally {
    removeDirectory(parent);
    removeDirectory(fixture.directory);
  }
});

// ---------------------------------------------------------------------------
// C. CLEAN START.
// ---------------------------------------------------------------------------

test('C. the surface starts clean', () => {
  const fixture = makeFixtureRepository();
  const parent = makeParent();
  try {
    const surface = createSurface({ fixture, parent });
    assert.equal(git(surface.surfacePath, ['status', '--porcelain']), '');
    const verified = verifyDetachedMutationSurface({
      surfacePath: surface.surfacePath,
      taskId: 'DMS-TEST-TASK',
    });
    assert.equal(verified.clean, true);
  } finally {
    removeDirectory(parent);
    removeDirectory(fixture.directory);
  }
});

// ---------------------------------------------------------------------------
// D. SEPARATE GIT DIRECTORY, OUTSIDE THE CANONICAL REPOSITORY.
// ---------------------------------------------------------------------------

test('D. the surface owns a separate .git directory, different from the canonical repository', () => {
  const fixture = makeFixtureRepository();
  const parent = makeParent();
  try {
    const surface = createSurface({ fixture, parent });
    const surfaceGitDir = git(surface.surfacePath, ['rev-parse', '--absolute-git-dir']);
    const fixtureGitDir = git(fixture.directory, ['rev-parse', '--absolute-git-dir']);
    assert.ok(samePath(surfaceGitDir, join(surface.surfacePath, '.git')));
    assert.equal(samePath(surfaceGitDir, fixtureGitDir), false);
    assert.equal(samePath(surface.realPath, fixture.directory), false);

    const verified = verifyDetachedMutationSurface({
      surfacePath: surface.surfacePath,
      taskId: 'DMS-TEST-TASK',
      canonicalRepositoryRoot: fixture.directory,
    });
    assert.ok(samePath(verified.gitDir, surfaceGitDir));
  } finally {
    removeDirectory(parent);
    removeDirectory(fixture.directory);
  }
});

// ---------------------------------------------------------------------------
// E. CONCURRENT CREATE, DIFFERENT TASKS -> DIFFERENT SURFACES.
// ---------------------------------------------------------------------------

test('E. two concurrent creates for different tasks receive different surfaces', async () => {
  const fixture = makeFixtureRepository();
  const parent = makeParent();
  try {
    const [first, second] = await Promise.all([
      runChildCreate({
        taskId: 'DMS-CONCURRENT-A',
        remoteUrl: fixture.directory,
        liveMainSha: fixture.baselineSha,
        parentDirectory: parent,
        canonicalRepositoryRoot: fixture.directory,
      }),
      runChildCreate({
        taskId: 'DMS-CONCURRENT-B',
        remoteUrl: fixture.directory,
        liveMainSha: fixture.baselineSha,
        parentDirectory: parent,
        canonicalRepositoryRoot: fixture.directory,
      }),
    ]);
    assert.notEqual(first.surfacePath, second.surfacePath);
    assert.notEqual(first.surfaceId, second.surfaceId);
    assert.equal(existsSync(first.surfacePath), true);
    assert.equal(existsSync(second.surfacePath), true);
    for (const [created, taskId] of [
      [first, 'DMS-CONCURRENT-A'],
      [second, 'DMS-CONCURRENT-B'],
    ]) {
      const verified = verifyDetachedMutationSurface({
        surfacePath: created.surfacePath,
        taskId,
        expectedBaselineSha: fixture.baselineSha,
      });
      assert.equal(verified.headSha, fixture.baselineSha);
    }
  } finally {
    removeDirectory(parent);
    removeDirectory(fixture.directory);
  }
});

// ---------------------------------------------------------------------------
// F. CONCURRENT CREATE, SAME TASK ID -> NEVER SHARED.
// ---------------------------------------------------------------------------

test('F. two concurrent creates for the same taskId never share a directory', async () => {
  const fixture = makeFixtureRepository();
  const parent = makeParent();
  try {
    const options = {
      taskId: 'DMS-SAME-TASK',
      remoteUrl: fixture.directory,
      liveMainSha: fixture.baselineSha,
      parentDirectory: parent,
      canonicalRepositoryRoot: fixture.directory,
    };
    const [first, second] = await Promise.all([runChildCreate(options), runChildCreate(options)]);
    assert.notEqual(first.surfacePath, second.surfacePath);
    assert.equal(existsSync(first.surfacePath), true);
    assert.equal(existsSync(second.surfacePath), true);

    // Each surface is its own repository with its own HEAD and ownership proof.
    assert.equal(git(first.surfacePath, ['rev-parse', 'HEAD']), fixture.baselineSha);
    assert.equal(git(second.surfacePath, ['rev-parse', 'HEAD']), fixture.baselineSha);
    assert.equal(readOwnership(first.surfacePath).surfaceId, basename(first.surfacePath));
    assert.equal(readOwnership(second.surfacePath).surfaceId, basename(second.surfacePath));
  } finally {
    removeDirectory(parent);
    removeDirectory(fixture.directory);
  }
});

// ---------------------------------------------------------------------------
// G. WRONG SHA VERIFICATION FAILS CLOSED.
// ---------------------------------------------------------------------------

test('G. verification against a wrong baseline SHA fails closed', () => {
  const fixture = makeFixtureRepository();
  const parent = makeParent();
  try {
    const surface = createSurface({ fixture, parent });
    assert.notEqual(fixture.firstSha, fixture.baselineSha);
    assertSurfaceError(
      () =>
        verifyDetachedMutationSurface({
          surfacePath: surface.surfacePath,
          taskId: 'DMS-TEST-TASK',
          expectedBaselineSha: fixture.firstSha,
        }),
      HEAD_SHA_MISMATCH,
    );
    assertSurfaceError(
      () =>
        verifyDetachedMutationSurface({
          surfacePath: surface.surfacePath,
          taskId: 'DMS-TEST-TASK',
          expectedBaselineSha: '0'.repeat(40),
        }),
      HEAD_SHA_MISMATCH,
    );
  } finally {
    removeDirectory(parent);
    removeDirectory(fixture.directory);
  }
});

// ---------------------------------------------------------------------------
// H. BRANCH STATE VERIFICATION FAILS CLOSED.
// ---------------------------------------------------------------------------

test('H. attached HEAD and side local branches both fail verification', () => {
  const fixture = makeFixtureRepository();
  const parent = makeParent();
  try {
    const surface = createSurface({ fixture, parent });
    git(surface.surfacePath, ['checkout', '--quiet', '-b', 'dms-attached']);
    assertSurfaceError(
      () =>
        verifyDetachedMutationSurface({
          surfacePath: surface.surfacePath,
          taskId: 'DMS-TEST-TASK',
          expectedBaselineSha: fixture.baselineSha,
        }),
      HEAD_NOT_DETACHED,
    );

    git(surface.surfacePath, ['checkout', '--quiet', '--detach', fixture.baselineSha]);
    git(surface.surfacePath, ['branch', 'dms-side-branch']);
    assertSurfaceError(
      () =>
        verifyDetachedMutationSurface({
          surfacePath: surface.surfacePath,
          taskId: 'DMS-TEST-TASK',
          expectedBaselineSha: fixture.baselineSha,
        }),
      LOCAL_BRANCH_PRESENT,
    );
  } finally {
    removeDirectory(parent);
    removeDirectory(fixture.directory);
  }
});

// ---------------------------------------------------------------------------
// I. SURFACE INSIDE THE CANONICAL REPOSITORY IS REFUSED.
// ---------------------------------------------------------------------------

test('I. create inside the canonical repository worktree is refused without creating anything', () => {
  const fixture = makeFixtureRepository();
  try {
    const insideParent = join(fixture.directory, 'nested-surface-root');
    assertSurfaceError(
      () =>
        createDetachedMutationSurface({
          taskId: 'DMS-INSIDE-TASK',
          remoteUrl: fixture.directory,
          liveMainSha: fixture.baselineSha,
          parentDirectory: insideParent,
          canonicalRepositoryRoot: fixture.directory,
        }),
      SURFACE_INSIDE_CANONICAL_REPOSITORY,
    );
    assert.equal(existsSync(insideParent), false);
    assert.equal(git(fixture.directory, ['status', '--porcelain']), '');
  } finally {
    removeDirectory(fixture.directory);
  }
});

// ---------------------------------------------------------------------------
// J. FOREIGN / UNPROVEN SURFACES ARE NEVER RETIRED.
// ---------------------------------------------------------------------------

test('J. foreign directories, foreign task ids, and tampered proofs are refused', () => {
  const fixture = makeFixtureRepository();
  const parent = makeParent();
  try {
    // (1) A plain foreign directory carries no ownership proof.
    const foreign = join(
      parent,
      `${DETACHED_MUTATION_SURFACE_DIRECTORY_PREFIX}foreign-0000000000000000`,
    );
    mkdirSync(foreign);
    writeFileSync(join(foreign, 'keep.txt'), 'must survive\n');
    assertSurfaceError(
      () => retireDetachedMutationSurface({ surfacePath: foreign, taskId: 'DMS-TEST-TASK' }),
      SURFACE_OWNERSHIP_PROOF_MISSING,
    );
    assert.equal(existsSync(join(foreign, 'keep.txt')), true);

    // (2) An owned surface cannot be retired under another task id.
    const surface = createSurface({ fixture, parent });
    assertSurfaceError(
      () =>
        retireDetachedMutationSurface({
          surfacePath: surface.surfacePath,
          taskId: 'DMS-OTHER-TASK',
        }),
      FOREIGN_SURFACE_RETIRE_REFUSED,
    );
    // (3) A baseline mismatch is refused.
    assertSurfaceError(
      () =>
        retireDetachedMutationSurface({
          surfacePath: surface.surfacePath,
          taskId: 'DMS-TEST-TASK',
          expectedBaselineSha: fixture.firstSha,
        }),
      FOREIGN_SURFACE_RETIRE_REFUSED,
    );
    // (4) A tampered ownership proof is refused.
    const ownership = readOwnership(surface.surfacePath);
    ownership.marker = 'foreign-marker';
    writeFileSync(
      surfaceOwnershipPath(surface.surfacePath),
      `${JSON.stringify(ownership, null, 2)}\n`,
      'utf8',
    );
    assertSurfaceError(
      () =>
        verifyDetachedMutationSurface({
          surfacePath: surface.surfacePath,
          taskId: 'DMS-TEST-TASK',
        }),
      SURFACE_OWNERSHIP_PROOF_INVALID,
    );
    assertSurfaceError(
      () =>
        retireDetachedMutationSurface({
          surfacePath: surface.surfacePath,
          taskId: 'DMS-TEST-TASK',
        }),
      SURFACE_OWNERSHIP_PROOF_INVALID,
    );
    assert.equal(existsSync(surface.surfacePath), true);
  } finally {
    removeDirectory(parent);
    removeDirectory(fixture.directory);
  }
});

// ---------------------------------------------------------------------------
// K. OWNED SURFACE RETIRE SUCCEEDS.
// ---------------------------------------------------------------------------

test('K. an owned surface retires successfully with its exact identity', () => {
  const fixture = makeFixtureRepository();
  const parent = makeParent();
  try {
    const surface = createSurface({ fixture, parent });
    const retired = retireDetachedMutationSurface({
      surfacePath: surface.surfacePath,
      taskId: 'DMS-TEST-TASK',
      expectedBaselineSha: fixture.baselineSha,
      canonicalRepositoryRoot: fixture.directory,
    });
    assert.equal(retired.removed, true);
    assert.equal(retired.surfaceId, surface.surfaceId);
    assert.equal(retired.baselineSha, fixture.baselineSha);
    assert.equal(retired.taskId, 'DMS-TEST-TASK');
  } finally {
    removeDirectory(parent);
    removeDirectory(fixture.directory);
  }
});

// ---------------------------------------------------------------------------
// L. RETIRE REMOVES THE DIRECTORY; SECOND RETIRE IS NOT FOUND.
// ---------------------------------------------------------------------------

test('L. retire removes the surface directory and a second retire reports SURFACE_NOT_FOUND', () => {
  const fixture = makeFixtureRepository();
  const parent = makeParent();
  try {
    const surface = createSurface({ fixture, parent });
    retireDetachedMutationSurface({ surfacePath: surface.surfacePath, taskId: 'DMS-TEST-TASK' });
    assert.equal(existsSync(surface.surfacePath), false);
    assert.equal(existsSync(parent), true);
    assertSurfaceError(
      () =>
        retireDetachedMutationSurface({
          surfacePath: surface.surfacePath,
          taskId: 'DMS-TEST-TASK',
        }),
      SURFACE_NOT_FOUND,
    );
  } finally {
    removeDirectory(parent);
    removeDirectory(fixture.directory);
  }
});

// ---------------------------------------------------------------------------
// M. RETIRING ONE SURFACE DOES NOT AFFECT ANOTHER.
// ---------------------------------------------------------------------------

test('M. retiring one surface leaves every other surface intact and verifiable', () => {
  const fixture = makeFixtureRepository();
  const parent = makeParent();
  try {
    const first = createSurface({ fixture, parent, taskId: 'DMS-PARALLEL-A' });
    const second = createSurface({ fixture, parent, taskId: 'DMS-PARALLEL-B' });
    retireDetachedMutationSurface({ surfacePath: first.surfacePath, taskId: 'DMS-PARALLEL-A' });
    assertOwnedRetired(first);

    assert.equal(existsSync(second.surfacePath), true);
    const verified = verifyDetachedMutationSurface({
      surfacePath: second.surfacePath,
      taskId: 'DMS-PARALLEL-B',
      expectedBaselineSha: fixture.baselineSha,
    });
    assert.equal(verified.clean, true);
    assert.equal(verified.headSha, fixture.baselineSha);
    retireDetachedMutationSurface({ surfacePath: second.surfacePath, taskId: 'DMS-PARALLEL-B' });
    assertOwnedRetired(second);
  } finally {
    removeDirectory(parent);
    removeDirectory(fixture.directory);
  }
});

// ---------------------------------------------------------------------------
// N. INPUT FAIL-CLOSED (NO GIT MUTATION) + BASELINE MISMATCH WITH NO RESIDUE.
// ---------------------------------------------------------------------------

test('N. invalid inputs fail closed before any mutation and a moved live main leaves no residue', () => {
  const fixture = makeFixtureRepository();
  const parent = makeParent();
  try {
    const base = {
      taskId: 'DMS-INPUT-TASK',
      remoteUrl: fixture.directory,
      liveMainSha: fixture.baselineSha,
      parentDirectory: parent,
      canonicalRepositoryRoot: fixture.directory,
    };
    for (const taskId of [
      '',
      ' ',
      'has space',
      '..',
      'a/b',
      'a\\b',
      '.hidden',
      'x'.repeat(200),
      42,
      null,
    ]) {
      assertSurfaceError(() => createDetachedMutationSurface({ ...base, taskId }), INVALID_TASK_ID);
    }
    for (const liveMainSha of [null, undefined, '', 'abc', 'a'.repeat(39), 'g'.repeat(40), 123]) {
      assertSurfaceError(
        () => createDetachedMutationSurface({ ...base, liveMainSha }),
        INVALID_LIVE_MAIN_SHA,
      );
    }
    for (const remoteUrl of [null, '', '-oops', 'https://user:secret@github.com/x/y.git']) {
      assertSurfaceError(
        () => createDetachedMutationSurface({ ...base, remoteUrl }),
        INVALID_REMOTE_URL,
      );
    }
    for (const parentDirectory of ['relative-parent', '', null]) {
      assertSurfaceError(
        () => createDetachedMutationSurface({ ...base, parentDirectory }),
        INVALID_PARENT_DIRECTORY,
      );
    }

    // A well-formed SHA that is not reachable in the fixture: exact-SHA fetch
    // fails, refs/heads/main resolves elsewhere, and no surface is left behind.
    assertSurfaceError(
      () => createDetachedMutationSurface({ ...base, liveMainSha: 'f'.repeat(40) }),
      BASELINE_SHA_MISMATCH,
    );
    assert.deepEqual(
      readdirSync(parent).filter((name) =>
        name.startsWith(DETACHED_MUTATION_SURFACE_DIRECTORY_PREFIX),
      ),
      [],
    );
  } finally {
    removeDirectory(parent);
    removeDirectory(fixture.directory);
  }
});

// ---------------------------------------------------------------------------
// O. UNEXPECTED DIRTY START FAILS VERIFICATION.
// ---------------------------------------------------------------------------

test('O. an unexpected dirty start fails verification', () => {
  const fixture = makeFixtureRepository();
  const parent = makeParent();
  try {
    const surface = createSurface({ fixture, parent });
    writeFileSync(join(surface.surfacePath, 'dirty.txt'), 'unexpected\n');
    assertSurfaceError(
      () =>
        verifyDetachedMutationSurface({
          surfacePath: surface.surfacePath,
          taskId: 'DMS-TEST-TASK',
          expectedBaselineSha: fixture.baselineSha,
        }),
      UNEXPECTED_DIRTY_START,
    );
  } finally {
    removeDirectory(parent);
    removeDirectory(fixture.directory);
  }
});

// ---------------------------------------------------------------------------
// P. NO STALE SURFACE REUSE.
// ---------------------------------------------------------------------------

test('P. a new create for the same taskId allocates a fresh directory, never a retired one', () => {
  const fixture = makeFixtureRepository();
  const parent = makeParent();
  try {
    const first = createSurface({ fixture, parent, taskId: 'DMS-REUSE-TASK' });
    retireDetachedMutationSurface({ surfacePath: first.surfacePath, taskId: 'DMS-REUSE-TASK' });
    const second = createSurface({ fixture, parent, taskId: 'DMS-REUSE-TASK' });
    assert.notEqual(second.surfacePath, first.surfacePath);
    assert.equal(existsSync(first.surfacePath), false);
    assert.equal(existsSync(second.surfacePath), true);
    verifyDetachedMutationSurface({
      surfacePath: second.surfacePath,
      taskId: 'DMS-REUSE-TASK',
      expectedBaselineSha: fixture.baselineSha,
    });
    retireDetachedMutationSurface({ surfacePath: second.surfacePath, taskId: 'DMS-REUSE-TASK' });
  } finally {
    removeDirectory(parent);
    removeDirectory(fixture.directory);
  }
});

// ---------------------------------------------------------------------------
// Q. STATIC BOUNDARY: NO BRANCH/WORKTREE FACTORY, NARROW EXPORTED SURFACE.
// ---------------------------------------------------------------------------

function codeOnly(source) {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    })
    .join('\n');
}

test('Q. the module runs no branch/worktree/clone/remote-mutation command and exports one narrow surface', () => {
  const code = codeOnly(readFileSync(MODULE_PATH, 'utf8'));
  for (const forbidden of [
    "'worktree'",
    "'clone'",
    "'switch'",
    "'branch'",
    "'-b'",
    "'--orphan'",
    "'push'",
    "'reset'",
    "'stash'",
    "'clean'",
    "'merge'",
    "'rebase'",
    "'cherry-pick'",
    "'remote', 'set-url'",
    "'submodule'",
  ]) {
    assert.equal(code.includes(forbidden), false, `module code must not contain ${forbidden}`);
  }
  const importSpecifiers = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(importSpecifiers, [
    'node:child_process',
    'node:crypto',
    'node:fs',
    'node:os',
    'node:path',
  ]);

  const exportedFunctions = Object.entries(surfaceModule)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(exportedFunctions, [
    'DetachedMutationSurfaceError',
    'createDetachedMutationSurface',
    'retireDetachedMutationSurface',
    'verifyDetachedMutationSurface',
  ]);
});

// ---------------------------------------------------------------------------
// R. THE WORKING REPOSITORY IS NEVER MUTATED.
// ---------------------------------------------------------------------------

test('R. create/verify/retire never mutate the working repository (canonical checkout)', () => {
  const before = captureWorkingRepositoryState();
  if (before === null) return;
  const fixture = makeFixtureRepository();
  const parent = makeParent();
  try {
    const surface = createSurface({ fixture, parent });
    verifyDetachedMutationSurface({
      surfacePath: surface.surfacePath,
      taskId: 'DMS-TEST-TASK',
      expectedBaselineSha: fixture.baselineSha,
    });
    retireDetachedMutationSurface({ surfacePath: surface.surfacePath, taskId: 'DMS-TEST-TASK' });
  } finally {
    removeDirectory(parent);
    removeDirectory(fixture.directory);
  }
  assert.deepEqual(captureWorkingRepositoryState(), before);
});
