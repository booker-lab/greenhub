// Regression proof for scripts/git/publication-transport.mjs (CASE A..H).
// Uses temp local git repositories + a temp bare remote + a mocked
// provider-boundary seam. No GitHub PR, CI run, Vercel deployment, or
// real-repository mutation is made.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  BLOCKED_EXTERNAL_AUTHORITY,
  BLOCKED_TRANSPORT_CONFLICT,
  LOCAL_MERGE_FALLBACK,
  PROVIDER_SIDE_UPDATE_ALLOWED,
  SEMANTIC_OWNER_REVIEW_REQUIRED,
  buildExactTransportPushArgs,
  buildTransportCleanupArgs,
  captureCheckoutState,
  decideTransportMaintenance,
  deleteTemporaryTransportRef,
  isCheckoutUnchanged,
  publishExactCandidate,
} from './publication-transport.mjs';
import {
  COMPLETE_ALREADY_PUBLISHED,
  PUBLICATION_ALLOWED,
  SUPERSEDED_ALREADY_PUBLISHED,
  decidePreMerge,
  decidePrePublication,
} from './publication-admission.mjs';

const OWNED = 'owned.txt';
const UNRELATED = 'unrelated.txt';
const FOREIGN_TRACKED = 'foreign-tracked.txt';
const FOREIGN_UNTRACKED = 'foreign-untracked.txt';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitRaw(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function initRepo() {
  const directory = mkdtempSync(join(tmpdir(), 'greenhub-pub-transport-'));
  git(directory, ['init']);
  git(directory, ['config', 'user.email', 'transport-test@local']);
  git(directory, ['config', 'user.name', 'transport-test']);
  git(directory, ['config', 'commit.gpgsign', 'false']);
  return directory;
}

function initBareRemote() {
  const directory = mkdtempSync(join(tmpdir(), 'greenhub-pub-transport-remote-'));
  git(directory, ['init', '--bare']);
  return directory;
}

function commitFile(directory, relativePath, content, message) {
  const absolute = join(directory, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  git(directory, ['add', '--', relativePath]);
  git(directory, ['commit', '-m', message]);
  return git(directory, ['rev-parse', 'HEAD']);
}

function removeRepo(directory) {
  rmSync(directory, { recursive: true, force: true });
}

/** Repo with a candidate commit, a file remote, and foreign dirty present. */
function buildDirtyRepoWithRemote() {
  const directory = initRepo();
  const bare = initBareRemote();
  try {
    commitFile(directory, OWNED, 'owned-v0\n', 'base owned');
    commitFile(directory, FOREIGN_TRACKED, 'foreign-v0\n', 'base foreign');
    const candidateSha = commitFile(directory, OWNED, 'owned-v1-candidate\n', 'candidate owned delta');
    git(directory, ['remote', 'add', 'origin', bare]);
    // Foreign dirty: one tracked modification + one untracked file.
    writeFileSync(join(directory, FOREIGN_TRACKED), 'foreign-v0\nforeign-dirty-must-survive\n');
    writeFileSync(join(directory, FOREIGN_UNTRACKED), 'untracked foreign dirty must survive\n');
    return { directory, bare, candidateSha };
  } catch (error) {
    removeRepo(directory);
    removeRepo(bare);
    throw error;
  }
}

function remoteHasRef(directory, transportRef, candidateSha) {
  const out = gitRaw(directory, ['ls-remote', 'origin']);
  return out.split('\n').some((line) => line.includes(`refs/heads/${transportRef}`) && line.includes(candidateSha));
}

function remoteLacksRef(directory, transportRef) {
  const out = gitRaw(directory, ['ls-remote', 'origin']);
  return !out.split('\n').some((line) => line.includes(`refs/heads/${transportRef}`));
}

test('CASE A — NO CHECKOUT TAKEOVER: exact push leaves shared checkout branch/HEAD unchanged', () => {
  const built = buildDirtyRepoWithRemote();
  try {
    const before = captureCheckoutState({ repositoryRoot: built.directory });
    const transportRef = 'test-transport-case-a';
    const result = publishExactCandidate({
      repositoryRoot: built.directory,
      candidateSha: built.candidateSha,
      transportRef,
      remote: 'origin',
    });
    assert.equal(result.candidateSha, built.candidateSha);
    const after = captureCheckoutState({ repositoryRoot: built.directory });
    assert.equal(after.branch, before.branch);
    assert.equal(after.head, before.head);
    assert.ok(isCheckoutUnchanged(before, after));
    assert.ok(remoteHasRef(built.directory, transportRef, built.candidateSha));
  } finally {
    removeRepo(built.directory);
    removeRepo(built.bare);
  }
});

test('CASE B — FOREIGN DIRTY PRESERVED: tracked + untracked foreign dirty survives transport', () => {
  const built = buildDirtyRepoWithRemote();
  try {
    const statusBefore = gitRaw(built.directory, ['status', '--porcelain=v1']);
    assert.match(statusBefore, /foreign-tracked/);
    assert.match(statusBefore, /foreign-untracked/);
    const trackedBefore = readFileSync(join(built.directory, FOREIGN_TRACKED), 'utf8');
    const untrackedBefore = readFileSync(join(built.directory, FOREIGN_UNTRACKED), 'utf8');

    const before = captureCheckoutState({ repositoryRoot: built.directory });
    publishExactCandidate({
      repositoryRoot: built.directory,
      candidateSha: built.candidateSha,
      transportRef: 'test-transport-case-b',
      remote: 'origin',
    });
    const after = captureCheckoutState({ repositoryRoot: built.directory });

    assert.ok(isCheckoutUnchanged(before, after));
    assert.equal(after.status, statusBefore);
    assert.equal(readFileSync(join(built.directory, FOREIGN_TRACKED), 'utf8'), trackedBefore);
    assert.equal(readFileSync(join(built.directory, FOREIGN_UNTRACKED), 'utf8'), untrackedBefore);
  } finally {
    removeRepo(built.directory);
    removeRepo(built.bare);
  }
});

test('CASE C — EXACT CANDIDATE TRANSPORT: temp ref points at the exact candidate, source not rewritten', () => {
  const built = buildDirtyRepoWithRemote();
  try {
    const transportRef = 'test-transport-case-c';
    const headBefore = git(built.directory, ['rev-parse', 'HEAD']);
    assert.equal(headBefore, built.candidateSha);
    publishExactCandidate({
      repositoryRoot: built.directory,
      candidateSha: built.candidateSha,
      transportRef,
      remote: 'origin',
    });
    // Remote temp ref resolves to the exact candidate SHA.
    assert.ok(remoteHasRef(built.directory, transportRef, built.candidateSha));
    // Source commit was not rewritten: HEAD and candidate SHA are identical to before.
    assert.equal(git(built.directory, ['rev-parse', 'HEAD']), built.candidateSha);
    assert.equal(git(built.directory, ['rev-parse', built.candidateSha]), built.candidateSha);
    // Push spec never uses checkout/merge machinery: pure builder check.
    assert.deepEqual(buildExactTransportPushArgs({
      candidateSha: built.candidateSha,
      transportRef,
      remote: 'origin',
    }), ['push', 'origin', `${built.candidateSha}:refs/heads/${transportRef}`]);
    // Transport ref must never be main.
    assert.throws(() => buildExactTransportPushArgs({ candidateSha: built.candidateSha, transportRef: 'main' }));
  } finally {
    removeRepo(built.directory);
    removeRepo(built.bare);
  }
});

test('CASE D — UNRELATED LIVE MAIN ADVANCE: publication survives without source recreation', () => {
  const directory = initRepo();
  try {
    commitFile(directory, OWNED, 'owned-v0\n', 'base owned');
    commitFile(directory, UNRELATED, 'u0\n', 'base unrelated');
    git(directory, ['checkout', '-b', 'cand']);
    const candidateSha = commitFile(directory, OWNED, 'owned-v1-candidate\n', 'candidate owned delta');
    git(directory, ['checkout', '-']);
    const liveAdvanced = commitFile(directory, UNRELATED, 'u1-unrelated-only\n', 'unrelated live advance');
    const decision = decidePrePublication({
      repositoryRoot: directory,
      liveMainRef: liveAdvanced,
      candidateRef: candidateSha,
      ownedPaths: [OWNED],
    });
    assert.equal(decision.status, PUBLICATION_ALLOWED);
    assert.deepEqual(decision.remainingDelta, [OWNED]);
    // Source work was NOT recreated: candidate SHA still resolves to the same commit.
    assert.equal(git(directory, ['rev-parse', candidateSha]), candidateSha);
  } finally {
    removeRepo(directory);
  }
});

test('CASE E — SERVER-SIDE UPDATE PATH: provider-side update selectable without local merge', () => {
  const built = buildDirtyRepoWithRemote();
  try {
    const before = captureCheckoutState({ repositoryRoot: built.directory });
    const decision = decideTransportMaintenance({
      providerUpdateAvailable: true,
      hasConflict: false,
      semanticOwnerReviewRequired: false,
    });
    assert.equal(decision.action, PROVIDER_SIDE_UPDATE_ALLOWED);
    assert.equal(decision.localMergeFallback, LOCAL_MERGE_FALLBACK);
    // Seeking the provider-side path performs no local git mutation by itself.
    const after = captureCheckoutState({ repositoryRoot: built.directory });
    assert.ok(isCheckoutUnchanged(before, after));
  } finally {
    removeRepo(built.directory);
    removeRepo(built.bare);
  }
});

test('CASE F — CONFLICT FAIL CLOSED: no automatic local merge/rebase fallback', () => {
  const conflicted = decideTransportMaintenance({
    providerUpdateAvailable: true,
    hasConflict: true,
    semanticOwnerReviewRequired: false,
  });
  assert.equal(conflicted.action, BLOCKED_TRANSPORT_CONFLICT);
  assert.equal(conflicted.localMergeFallback, LOCAL_MERGE_FALLBACK);

  const ownerReview = decideTransportMaintenance({
    providerUpdateAvailable: true,
    hasConflict: false,
    semanticOwnerReviewRequired: true,
  });
  assert.equal(ownerReview.action, SEMANTIC_OWNER_REVIEW_REQUIRED);

  const noProvider = decideTransportMaintenance({
    providerUpdateAvailable: false,
    hasConflict: false,
    semanticOwnerReviewRequired: false,
  });
  assert.equal(noProvider.action, BLOCKED_EXTERNAL_AUTHORITY);

  for (const decision of [conflicted, ownerReview, noProvider]) {
    assert.notEqual(decision.action, PROVIDER_SIDE_UPDATE_ALLOWED === decision.action && 'LOCAL_MERGE');
    assert.ok(!('localMerge' in decision) || decision.localMergeFallback === LOCAL_MERGE_FALLBACK);
    assert.equal(LOCAL_MERGE_FALLBACK, 'FORBIDDEN_ON_FOREIGN_DIRTY_SHARED_CHECKOUT');
  }

  // Fail-closed decisions perform no local mutation.
  const built = buildDirtyRepoWithRemote();
  try {
    const before = captureCheckoutState({ repositoryRoot: built.directory });
    void decideTransportMaintenance({ providerUpdateAvailable: true, hasConflict: true });
    const after = captureCheckoutState({ repositoryRoot: built.directory });
    assert.ok(isCheckoutUnchanged(before, after));
  } finally {
    removeRepo(built.directory);
    removeRepo(built.bare);
  }
});

test('CASE G — ZERO DELTA TERMINAL: PRE_PR completes, PRE_MERGE supersedes (admission preserved)', () => {
  const directory = initRepo();
  try {
    const base = commitFile(directory, OWNED, 'owned-v1\n', 'base');
    const liveSame = git(directory, ['rev-parse', 'HEAD']);
    const prePr = decidePrePublication({
      repositoryRoot: directory,
      liveMainRef: liveSame,
      candidateRef: base,
      ownedPaths: [OWNED],
    });
    assert.equal(prePr.status, COMPLETE_ALREADY_PUBLISHED);
    const preMerge = decidePreMerge({
      repositoryRoot: directory,
      liveMainRef: liveSame,
      candidateRef: base,
      ownedPaths: [OWNED],
    });
    assert.equal(preMerge.status, SUPERSEDED_ALREADY_PUBLISHED);
    void PUBLICATION_ALLOWED;
  } finally {
    removeRepo(directory);
  }
});

test('CASE H — CLEANUP IS TRANSPORT-ONLY: deleting temp ref touches nothing else', () => {
  const built = buildDirtyRepoWithRemote();
  try {
    const transportRef = 'test-transport-case-h';
    publishExactCandidate({
      repositoryRoot: built.directory,
      candidateSha: built.candidateSha,
      transportRef,
      remote: 'origin',
    });
    assert.ok(remoteHasRef(built.directory, transportRef, built.candidateSha));

    const statusBefore = gitRaw(built.directory, ['status', '--porcelain=v1']);
    const before = captureCheckoutState({ repositoryRoot: built.directory });
    assert.deepEqual(buildTransportCleanupArgs({ transportRef, remote: 'origin' }), [
      'push',
      'origin',
      '--delete',
      transportRef,
    ]);
    const cleaned = deleteTemporaryTransportRef({
      repositoryRoot: built.directory,
      transportRef,
      remote: 'origin',
    });
    assert.equal(cleaned.transportRef, transportRef);
    const after = captureCheckoutState({ repositoryRoot: built.directory });

    assert.ok(isCheckoutUnchanged(before, after));
    assert.equal(after.status, statusBefore);
    assert.match(after.status, /foreign-tracked/);
    // Source candidate still resolves; remote temp ref is gone.
    assert.equal(git(built.directory, ['rev-parse', built.candidateSha]), built.candidateSha);
    assert.ok(remoteLacksRef(built.directory, transportRef));
  } finally {
    removeRepo(built.directory);
    removeRepo(built.bare);
  }
});
