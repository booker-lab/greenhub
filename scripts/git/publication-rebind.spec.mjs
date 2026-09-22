// Regression proof for scripts/git/publication-rebind.mjs.
// Uses temp local git repositories only. No network, no GitHub, no OpenCode
// process, and no mutation of the Greenhub checkout. The module under test is
// read-only / object-level: it never touches a shared worktree or index.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  DEFAULT_REBIND_IDENTITY,
  NO_OWNED_DELTA,
  REBIND_ALLOWED,
  REBIND_NOT_REQUIRED,
  SEMANTIC_OWNER_REVIEW_REQUIRED,
  buildReboundCandidate,
  classifyFreshMainRebind,
  isAncestor,
  movedPathsBetween,
  readLiveTreeEntries,
  selectStaleProofs,
  treeEntriesEqual,
  verifyReboundCandidate,
} from './publication-rebind.mjs';

const IDENTITY = [
  '-c',
  'user.name=rebind-spec',
  '-c',
  'user.email=rebind-spec@local',
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

function initRepo() {
  const directory = mkdtempSync(join(tmpdir(), 'greenhub-rebind-spec-'));
  git(directory, ['init', '-b', 'main']);
  git(directory, ['config', 'user.email', 'rebind-spec@local']);
  git(directory, ['config', 'user.name', 'rebind-spec']);
  git(directory, ['config', 'commit.gpgsign', 'false']);
  return directory;
}

function commitChanges(directory, { files = {}, deletes = [], chmod = [] }, message) {
  for (const path of deletes) rmSync(join(directory, path), { force: true });
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(directory, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  git(directory, ['add', '-A']);
  for (const path of chmod) git(directory, ['update-index', '--chmod=+x', '--', path]);
  git(directory, [...IDENTITY, 'commit', '--no-verify', '-m', message]);
  return git(directory, ['rev-parse', 'HEAD']);
}

function removeRepo(directory) {
  rmSync(directory, { recursive: true, force: true });
}

/**
 * base (main) -> candidate branch delta, then main diverges to `live`.
 * Returns the three exact SHAs.
 */
function buildDivergent({
  baseFiles = { 'src/owned.txt': 'owned-v0\n', 'keep.txt': 'keep-v0\n' },
  candidate = { 'src/owned.txt': 'owned-candidate\n' },
  live = { 'keep.txt': 'keep-live\n' },
  owned = ['src/owned.txt'],
} = {}) {
  const directory = initRepo();
  const base = commitChanges(directory, { files: baseFiles }, 'base');
  git(directory, ['checkout', '-b', 'candidate']);
  const candidateSha = commitChanges(directory, { files: candidate }, 'candidate delta');
  git(directory, ['checkout', 'main']);
  const liveSha = commitChanges(directory, { files: live }, 'live main advance');
  return { directory, base, candidateSha, liveSha, owned };
}

test('DEFAULT_REBIND_IDENTITY is a frozen transient identity', () => {
  assert.equal(DEFAULT_REBIND_IDENTITY.name, 'greenhub-publication-rebind');
  assert.equal(DEFAULT_REBIND_IDENTITY.email, 'publication-rebind@greenhub.invalid');
  assert.equal(Object.isFrozen(DEFAULT_REBIND_IDENTITY), true);
});

test('readLiveTreeEntries / treeEntriesEqual: absence, presence, exact equality', () => {
  const built = buildDivergent();
  try {
    const entries = readLiveTreeEntries({
      repositoryRoot: built.directory,
      ref: built.base,
      paths: ['src/owned.txt', 'missing.txt'],
    });
    assert.deepEqual(Object.keys(entries).sort(), ['missing.txt', 'src/owned.txt']);
    assert.equal(entries['missing.txt'], null);
    assert.equal(entries['src/owned.txt'].mode, '100644');
    assert.equal(entries['src/owned.txt'].type, 'blob');

    assert.equal(treeEntriesEqual(null, null), true);
    assert.equal(treeEntriesEqual(entries['src/owned.txt'], null), false);
    assert.equal(treeEntriesEqual(entries['src/owned.txt'], { ...entries['src/owned.txt'] }), true);
    assert.equal(
      treeEntriesEqual(entries['src/owned.txt'], { ...entries['src/owned.txt'], mode: '100755' }),
      false,
    );
  } finally {
    removeRepo(built.directory);
  }
});

test('isAncestor and movedPathsBetween are exact and read-only', () => {
  const built = buildDivergent({ live: { 'keep.txt': 'keep-live\n' } });
  try {
    assert.equal(isAncestor({ repositoryRoot: built.directory, ancestor: built.base, descendant: built.liveSha }), true);
    assert.equal(isAncestor({ repositoryRoot: built.directory, ancestor: built.liveSha, descendant: built.base }), false);
    assert.deepEqual(
      movedPathsBetween({ repositoryRoot: built.directory, fromSha: built.base, toSha: built.liveSha }),
      ['keep.txt'],
    );
    assert.deepEqual(
      movedPathsBetween({ repositoryRoot: built.directory, fromSha: built.base, toSha: built.base }),
      [],
    );
  } finally {
    removeRepo(built.directory);
  }
});

test('NOT_REQUIRED when live main equals the candidate baseline', () => {
  const built = buildDivergent();
  try {
    const result = classifyFreshMainRebind({
      repositoryRoot: built.directory,
      baselineSha: built.base,
      candidateSha: built.candidateSha,
      liveMainSha: built.base,
      ownedPaths: built.owned,
    });
    assert.equal(result.status, REBIND_NOT_REQUIRED);
    assert.deepEqual(result.movedPaths, []);
    assert.deepEqual(result.ownedPathStates, []);
    assert.deepEqual(result.reapplyPaths, []);
  } finally {
    removeRepo(built.directory);
  }
});

test('REBIND_ALLOWED for unrelated movement: owned path is REAPPLY', () => {
  const built = buildDivergent({ live: { 'keep.txt': 'keep-live\n' } });
  try {
    const result = classifyFreshMainRebind({
      repositoryRoot: built.directory,
      baselineSha: built.base,
      candidateSha: built.candidateSha,
      liveMainSha: built.liveSha,
      ownedPaths: built.owned,
    });
    assert.equal(result.status, REBIND_ALLOWED);
    assert.deepEqual(result.movedPaths, ['keep.txt']);
    assert.deepEqual(result.reapplyPaths, ['src/owned.txt']);
    assert.deepEqual(result.alreadyAppliedPaths, []);
    assert.deepEqual(result.foreignEditPaths, []);
    assert.equal(result.ownedPathStates[0].disposition, 'REAPPLY');
    assert.notEqual(result.ownedPathStates[0].baselineEntry, null);
    assert.notEqual(result.ownedPathStates[0].candidateEntry, null);
    assert.notEqual(result.ownedPathStates[0].liveEntry, null);
  } finally {
    removeRepo(built.directory);
  }
});

test('ALREADY_APPLIED on every owned path yields NO_OWNED_DELTA', () => {
  const built = buildDivergent({ live: { 'src/owned.txt': 'owned-candidate\n' } });
  try {
    const result = classifyFreshMainRebind({
      repositoryRoot: built.directory,
      baselineSha: built.base,
      candidateSha: built.candidateSha,
      liveMainSha: built.liveSha,
      ownedPaths: built.owned,
    });
    assert.equal(result.status, NO_OWNED_DELTA);
    assert.deepEqual(result.reapplyPaths, []);
    assert.deepEqual(result.alreadyAppliedPaths, ['src/owned.txt']);
    assert.deepEqual(result.foreignEditPaths, []);
    assert.equal(result.ownedPathStates[0].disposition, 'ALREADY_APPLIED');
  } finally {
    removeRepo(built.directory);
  }
});

test('FOREIGN_EDIT on an owned path fails closed with SEMANTIC_OWNER_REVIEW_REQUIRED', () => {
  const built = buildDivergent({ live: { 'src/owned.txt': 'owned-foreign\n' } });
  try {
    const result = classifyFreshMainRebind({
      repositoryRoot: built.directory,
      baselineSha: built.base,
      candidateSha: built.candidateSha,
      liveMainSha: built.liveSha,
      ownedPaths: built.owned,
    });
    assert.equal(result.status, SEMANTIC_OWNER_REVIEW_REQUIRED);
    assert.deepEqual(result.foreignEditPaths, ['src/owned.txt']);
    assert.match(result.reason, /foreign edits/);
  } finally {
    removeRepo(built.directory);
  }
});

test('non-ancestor live main fails closed with SEMANTIC_OWNER_REVIEW_REQUIRED', () => {
  const directory = initRepo();
  try {
    const base = commitChanges(directory, { files: { 'src/owned.txt': 'owned-v0\n' } }, 'base');
    git(directory, ['checkout', '-b', 'candidate']);
    const candidateSha = commitChanges(
      directory,
      { files: { 'src/owned.txt': 'owned-candidate\n' } },
      'candidate',
    );
    git(directory, ['checkout', 'main']);
    git(directory, ['checkout', '--orphan', 'unrelated']);
    git(directory, ['rm', '-rf', '--cached', '.']);
    const liveSha = commitChanges(
      directory,
      { files: { 'other.txt': 'orphan\n' } },
      'unrelated root',
    );
    const result = classifyFreshMainRebind({
      repositoryRoot: directory,
      baselineSha: base,
      candidateSha,
      liveMainSha: liveSha,
      ownedPaths: ['src/owned.txt'],
    });
    assert.equal(result.status, SEMANTIC_OWNER_REVIEW_REQUIRED);
    assert.match(result.reason, /not an ancestor/);
    assert.equal(
      isAncestor({ repositoryRoot: directory, ancestor: base, descendant: liveSha }),
      false,
    );
  } finally {
    removeRepo(directory);
  }
});

test('deletion and addition owned paths reapply and rebuild exactly', () => {
  const directory = initRepo();
  try {
    const base = commitChanges(
      directory,
      { files: { 'keep.txt': 'keep-v0\n', 'del.txt': 'delete-me\n' } },
      'base',
    );
    git(directory, ['checkout', '-b', 'candidate']);
    const candidateSha = commitChanges(
      directory,
      { files: { 'new.txt': 'brand-new\n' }, deletes: ['del.txt'] },
      'candidate delete+add',
    );
    git(directory, ['checkout', 'main']);
    const liveSha = commitChanges(directory, { files: { 'other.txt': 'other\n' } }, 'live');

    const owned = ['del.txt', 'new.txt'];
    const result = classifyFreshMainRebind({
      repositoryRoot: directory,
      baselineSha: base,
      candidateSha,
      liveMainSha: liveSha,
      ownedPaths: owned,
    });
    assert.equal(result.status, REBIND_ALLOWED);
    assert.deepEqual(result.reapplyPaths, owned);

    const scratch = mkdtempSync(join(tmpdir(), 'greenhub-rebind-scratch-'));
    try {
      const rebound = buildReboundCandidate({
        repositoryRoot: directory,
        scratchDir: scratch,
        liveMainSha: liveSha,
        candidateSha,
        ownedPaths: owned,
        message: 'rebound delete+add',
      });
      assert.equal(rebound.ok, true);
      assert.deepEqual(rebound.changedPaths, owned);
      assert.equal(rebound.evidence.parentOk, true);
      assert.deepEqual(rebound.evidence.extraPaths, []);
      assert.deepEqual(rebound.evidence.mismatchedOwnedPaths, []);
      assert.deepEqual(rebound.evidence.treeDeltaPaths, owned);
      const tree = git(directory, ['ls-tree', '-r', '--name-only', rebound.candidateSha]).split('\n');
      assert.ok(!tree.includes('del.txt'), 'deleted owned path must be absent in the rebound tree');
      assert.ok(tree.includes('new.txt'), 'added owned path must be present in the rebound tree');
      assert.equal(git(directory, ['show', `${rebound.candidateSha}:new.txt`]), 'brand-new');
      assert.equal(git(directory, ['show', `${rebound.candidateSha}:keep.txt`]), 'keep-v0');
    } finally {
      removeRepo(scratch);
    }
  } finally {
    removeRepo(directory);
  }
});

test('mode changes on an owned path classify as FOREIGN_EDIT', () => {
  const directory = initRepo();
  try {
    const base = commitChanges(directory, { files: { 'script.sh': 'echo v0\n' } }, 'base');
    git(directory, ['checkout', '-b', 'candidate']);
    const candidateSha = commitChanges(
      directory,
      { files: { 'script.sh': 'echo candidate\n' } },
      'candidate content',
    );
    git(directory, ['checkout', 'main']);
    const liveSha = commitChanges(
      directory,
      { files: { 'script.sh': 'echo v0\n' }, chmod: ['script.sh'] },
      'live mode-only change',
    );
    const result = classifyFreshMainRebind({
      repositoryRoot: directory,
      baselineSha: base,
      candidateSha,
      liveMainSha: liveSha,
      ownedPaths: ['script.sh'],
    });
    assert.equal(result.status, SEMANTIC_OWNER_REVIEW_REQUIRED);
    assert.deepEqual(result.foreignEditPaths, ['script.sh']);
    assert.notEqual(
      result.ownedPathStates[0].liveEntry.mode,
      result.ownedPathStates[0].baselineEntry.mode,
    );
  } finally {
    removeRepo(directory);
  }
});

test('rebuild evidence: parent, owned entry equality, no extra paths, foreign bytes preserved', () => {
  const built = buildDivergent({
    candidate: { 'src/owned.txt': 'owned-candidate\n', 'src/added.txt': 'added\n' },
    live: { 'keep.txt': 'keep-live\n' },
  });
  try {
    const owned = ['src/owned.txt', 'src/added.txt'];
    const scratch = mkdtempSync(join(tmpdir(), 'greenhub-rebind-scratch-'));
    try {
      const rebound = buildReboundCandidate({
        repositoryRoot: built.directory,
        scratchDir: scratch,
        liveMainSha: built.liveSha,
        candidateSha: built.candidateSha,
        ownedPaths: owned,
        message: 'rebound candidate',
      });
      assert.equal(rebound.ok, true);
      const parents = git(built.directory, [
        'rev-list',
        '--parents',
        '-n',
        '1',
        rebound.candidateSha,
      ]).split(/\s+/);
      assert.deepEqual(parents, [rebound.candidateSha, built.liveSha]);

      assert.deepEqual(
        movedPathsBetween({
          repositoryRoot: built.directory,
          fromSha: built.liveSha,
          toSha: rebound.candidateSha,
        }),
        [...owned].sort(),
      );

      const reboundEntries = readLiveTreeEntries({
        repositoryRoot: built.directory,
        ref: rebound.candidateSha,
        paths: owned,
      });
      const candidateEntries = readLiveTreeEntries({
        repositoryRoot: built.directory,
        ref: built.candidateSha,
        paths: owned,
      });
      for (const path of owned) {
        assert.equal(treeEntriesEqual(reboundEntries[path], candidateEntries[path]), true, path);
      }

      // Foreign movement is preserved byte-for-byte, never absorbed.
      assert.equal(git(built.directory, ['show', `${rebound.candidateSha}:keep.txt`]), 'keep-live');

      const verification = verifyReboundCandidate({
        repositoryRoot: built.directory,
        reboundSha: rebound.candidateSha,
        liveMainSha: built.liveSha,
        candidateSha: built.candidateSha,
        ownedPaths: owned,
      });
      assert.equal(verification.ok, true);
      assert.equal(verification.parentOk, true);
      assert.deepEqual(verification.extraPaths, []);
      assert.deepEqual(verification.mismatchedOwnedPaths, []);
    } finally {
      removeRepo(scratch);
    }
  } finally {
    removeRepo(built.directory);
  }
});

test('selectStaleProofs: empty owners, prefix owners, exact owners, no movement', () => {
  const emptyOwners = selectStaleProofs({
    proofCommands: ['a'],
    proofOwners: [[]],
    movedPaths: ['src/x.txt'],
  });
  assert.deepEqual(emptyOwners, [{ command: 'a', owners: [], stale: true }]);
  assert.equal(
    selectStaleProofs({ proofCommands: ['a'], proofOwners: [[]], movedPaths: [] })[0].stale,
    false,
  );

  const missingOwners = selectStaleProofs({
    proofCommands: ['a'],
    movedPaths: ['src/x.txt'],
  });
  assert.deepEqual(missingOwners, [{ command: 'a', owners: [], stale: true }]);

  const prefixed = selectStaleProofs({
    proofCommands: ['one', 'two'],
    proofOwners: [['src'], ['docs']],
    movedPaths: ['src/deep/file.txt'],
  });
  assert.deepEqual(prefixed, [
    { command: 'one', owners: ['src'], stale: true },
    { command: 'two', owners: ['docs'], stale: false },
  ]);

  assert.equal(
    selectStaleProofs({
      proofCommands: ['one'],
      proofOwners: [['src']],
      movedPaths: ['srcx/file.txt'],
    })[0].stale,
    false,
  );
  assert.equal(
    selectStaleProofs({
      proofCommands: ['one'],
      proofOwners: [['src']],
      movedPaths: ['src'],
    })[0].stale,
    true,
  );
  assert.equal(
    selectStaleProofs({
      proofCommands: ['one'],
      proofOwners: [['src']],
      movedPaths: [],
    })[0].stale,
    false,
  );
});

test('verifyReboundCandidate returns ok:false for a mismatched expectation', () => {
  const built = buildDivergent({ live: { 'keep.txt': 'keep-live\n' } });
  try {
    const scratch = mkdtempSync(join(tmpdir(), 'greenhub-rebind-scratch-'));
    try {
      const rebound = buildReboundCandidate({
        repositoryRoot: built.directory,
        scratchDir: scratch,
        liveMainSha: built.liveSha,
        candidateSha: built.candidateSha,
        ownedPaths: built.owned,
        message: 'rebound candidate',
      });
      assert.equal(rebound.ok, true);

      const wrongCandidate = verifyReboundCandidate({
        repositoryRoot: built.directory,
        reboundSha: rebound.candidateSha,
        liveMainSha: built.liveSha,
        candidateSha: built.base,
        ownedPaths: built.owned,
      });
      assert.equal(wrongCandidate.ok, false);
      assert.deepEqual(wrongCandidate.mismatchedOwnedPaths, ['src/owned.txt']);

      const wrongParent = verifyReboundCandidate({
        repositoryRoot: built.directory,
        reboundSha: rebound.candidateSha,
        liveMainSha: built.base,
        candidateSha: built.candidateSha,
        ownedPaths: built.owned,
      });
      assert.equal(wrongParent.ok, false);
      assert.equal(wrongParent.parentOk, false);
      assert.match(wrongParent.reason, /parent/);
    } finally {
      removeRepo(scratch);
    }
  } finally {
    removeRepo(built.directory);
  }
});
