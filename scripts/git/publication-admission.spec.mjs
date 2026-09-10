// Regression proof for scripts/git/publication-admission.mjs.
// Covers task CASE A..F using temp local git repositories only.
// No GitHub PR, CI run, Vercel deployment, or real-repository mutation is made.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  COMPLETE_ALREADY_PUBLISHED,
  PUBLICATION_ALLOWED,
  SEMANTIC_OWNER_REVIEW_REQUIRED,
  SUPERSEDED_ALREADY_PUBLISHED,
  decidePreMerge,
  decidePrePublication,
  evaluatePublicationAdmission,
} from './publication-admission.mjs';

const OWNED = 'apps/driver/photo-capture.tsx';
const UNRELATED = 'apps/consumer/unrelated.txt';
const OWNED_V1 = 'photo-ack-v1\n';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function initRepo() {
  const directory = mkdtempSync(join(tmpdir(), 'greenhub-pub-admission-'));
  git(directory, ['init']);
  git(directory, ['config', 'user.email', 'admission-test@local']);
  git(directory, ['config', 'user.name', 'admission-test']);
  git(directory, ['config', 'commit.gpgsign', 'false']);
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

/** Builds the PR #119/#122 shape: A merges the owned delta, B carries the same blobs under another SHA. */
function buildParallelPublicationRepo() {
  const directory = initRepo();
  try {
    const base = commitFile(directory, OWNED, 'photo-ack-v0\n', 'base');
    commitFile(directory, UNRELATED, 'u0\n', 'base unrelated');
    const baseSha = git(directory, ['rev-parse', 'HEAD']);
    void base;
    git(directory, ['checkout', '-b', 'live']);
    const liveBase = git(directory, ['rev-parse', 'HEAD']);

    git(directory, ['checkout', '-b', 'candA', 'live']);
    const candASha = commitFile(directory, OWNED, OWNED_V1, 'candidate A owned delta');
    git(directory, ['checkout', 'live']);
    git(directory, ['merge', '--no-ff', 'candA', '-m', 'merge candidate A']);
    const liveMerged = git(directory, ['rev-parse', 'HEAD']);

    git(directory, ['checkout', '-b', 'candB', liveBase]);
    const candBSha = commitFile(directory, OWNED, OWNED_V1, 'candidate B same semantic delta');
    return { directory, liveBase, liveMerged, candASha, candBSha };
  } catch (error) {
    removeRepo(directory);
    throw error;
  }
}

test('CASE A: candidate delta absent from live main -> PUBLICATION_ALLOWED', () => {
  const built = buildParallelPublicationRepo();
  try {
    const decision = decidePrePublication({
      repositoryRoot: built.directory,
      liveMainRef: built.liveBase,
      candidateRef: built.candASha,
      ownedPaths: [OWNED],
    });
    assert.equal(decision.status, PUBLICATION_ALLOWED);
    assert.deepEqual(decision.remainingDelta, [OWNED]);
  } finally {
    removeRepo(built.directory);
  }
});

test('CASE B: different exact SHA but identical owned blobs -> COMPLETE_ALREADY_PUBLISHED', () => {
  const built = buildParallelPublicationRepo();
  try {
    assert.notEqual(built.candASha, built.candBSha);
    const decision = decidePrePublication({
      repositoryRoot: built.directory,
      liveMainRef: built.liveMerged,
      candidateRef: built.candBSha,
      ownedPaths: [OWNED],
    });
    assert.equal(decision.status, COMPLETE_ALREADY_PUBLISHED);
    assert.deepEqual(decision.remainingDelta, []);
  } finally {
    removeRepo(built.directory);
  }
});

test('CASE C: delta existed at PR framing, gone after rival merge -> SUPERSEDED_ALREADY_PUBLISHED', () => {
  const built = buildParallelPublicationRepo();
  try {
    const atFraming = decidePreMerge({
      repositoryRoot: built.directory,
      liveMainRef: built.liveBase,
      candidateRef: built.candBSha,
      ownedPaths: [OWNED],
    });
    assert.equal(atFraming.status, PUBLICATION_ALLOWED);

    const atMerge = decidePreMerge({
      repositoryRoot: built.directory,
      liveMainRef: built.liveMerged,
      candidateRef: built.candBSha,
      ownedPaths: [OWNED],
    });
    assert.equal(atMerge.status, SUPERSEDED_ALREADY_PUBLISHED);
    assert.deepEqual(atMerge.remainingDelta, []);
  } finally {
    removeRepo(built.directory);
  }
});

test('CASE D: live main moved unrelated files only -> publication remains valid', () => {
  const directory = initRepo();
  try {
    commitFile(directory, OWNED, 'photo-ack-v0\n', 'base');
    commitFile(directory, UNRELATED, 'u0\n', 'base unrelated');
    git(directory, ['checkout', '-b', 'live']);
    git(directory, ['checkout', '-b', 'cand']);
    const candidate = commitFile(directory, OWNED, OWNED_V1, 'candidate owned delta');
    git(directory, ['checkout', 'live']);
    git(directory, ['merge', '--no-ff', 'cand', '-m', 'unrelated transport']);
    const liveUnrelated = commitFile(directory, UNRELATED, 'u1-unrelated-only\n', 'unrelated movement');
    git(directory, ['checkout', '-b', 'cand2', 'live~1']);
    const candidate2 = commitFile(directory, OWNED, 'photo-ack-v2\n', 'candidate owned delta v2');
    const decision = decidePrePublication({
      repositoryRoot: directory,
      liveMainRef: liveUnrelated,
      candidateRef: candidate2,
      ownedPaths: [OWNED],
    });
    assert.equal(decision.status, PUBLICATION_ALLOWED);
    assert.deepEqual(decision.remainingDelta, [OWNED]);
    void candidate;
  } finally {
    removeRepo(directory);
  }
});

test('CASE E: semantic-owner movement beyond exact proof -> SEMANTIC_OWNER_REVIEW_REQUIRED (fail closed)', () => {
  const purePrePr = evaluatePublicationAdmission({
    ownedPaths: [OWNED],
    candidateBlobs: { [OWNED]: 'blob-candidate' },
    liveMainBlobs: { [OWNED]: 'blob-live-diverged' },
    phase: 'PRE_PR',
    semanticOwnerReviewRequired: true,
  });
  assert.equal(purePrePr.status, SEMANTIC_OWNER_REVIEW_REQUIRED);

  const purePreMerge = evaluatePublicationAdmission({
    ownedPaths: [OWNED],
    candidateBlobs: { [OWNED]: 'blob-candidate' },
    liveMainBlobs: { [OWNED]: 'blob-candidate' },
    phase: 'PRE_MERGE',
    semanticOwnerReviewRequired: true,
  });
  assert.equal(purePreMerge.status, SEMANTIC_OWNER_REVIEW_REQUIRED);

  const built = buildParallelPublicationRepo();
  try {
    const decision = decidePrePublication({
      repositoryRoot: built.directory,
      liveMainRef: built.liveBase,
      candidateRef: built.candASha,
      ownedPaths: [OWNED],
      semanticOwnerReviewRequired: true,
    });
    assert.equal(decision.status, SEMANTIC_OWNER_REVIEW_REQUIRED);
  } finally {
    removeRepo(built.directory);
  }
});

test('CASE F: foreign dirty on unrelated path is untouched and admission stays decidable', () => {
  const built = buildParallelPublicationRepo();
  try {
    git(built.directory, ['checkout', 'live']);
    const foreignAbsolute = join(built.directory, 'foreign-unrelated-dirty.txt');
    writeFileSync(foreignAbsolute, 'foreign dirty must be preserved\n');
    const statusBefore = execFileSync('git', ['status', '--porcelain=v1'], {
      cwd: built.directory,
      encoding: 'utf8',
    });
    assert.match(statusBefore, /foreign-unrelated-dirty\.txt/);

    const decision = decidePrePublication({
      repositoryRoot: built.directory,
      liveMainRef: built.liveBase,
      candidateRef: built.candASha,
      ownedPaths: [OWNED],
    });
    assert.equal(decision.status, PUBLICATION_ALLOWED);

    const statusAfter = execFileSync('git', ['status', '--porcelain=v1'], {
      cwd: built.directory,
      encoding: 'utf8',
    });
    assert.equal(statusAfter, statusBefore);
  } finally {
    removeRepo(built.directory);
  }
});

test('phase contract: PRE_PR zero delta completes, PRE_MERGE zero delta supersedes, proofs are required', () => {
  const blobs = { [OWNED]: 'same-blob' };
  const prePr = evaluatePublicationAdmission({
    ownedPaths: [OWNED],
    candidateBlobs: { ...blobs },
    liveMainBlobs: { ...blobs },
    phase: 'PRE_PR',
  });
  assert.equal(prePr.status, COMPLETE_ALREADY_PUBLISHED);

  const preMerge = evaluatePublicationAdmission({
    ownedPaths: [OWNED],
    candidateBlobs: { ...blobs },
    liveMainBlobs: { ...blobs },
    phase: 'PRE_MERGE',
  });
  assert.equal(preMerge.status, SUPERSEDED_ALREADY_PUBLISHED);

  const missingProof = evaluatePublicationAdmission({
    ownedPaths: [OWNED],
    candidateBlobs: {},
    liveMainBlobs: { ...blobs },
    phase: 'PRE_PR',
  });
  assert.equal(missingProof.status, SEMANTIC_OWNER_REVIEW_REQUIRED);

  const emptyOwned = evaluatePublicationAdmission({
    ownedPaths: [],
    candidateBlobs: {},
    liveMainBlobs: {},
    phase: 'PRE_PR',
  });
  assert.equal(emptyOwned.status, SEMANTIC_OWNER_REVIEW_REQUIRED);
});
