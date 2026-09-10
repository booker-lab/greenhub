// Canonical owner: AGENTS.md section 2 (branch+PR principle for protected `main`).
// This module is the executable admission gate for that principle — it does not
// create a parallel publication SSOT.
//
// Purpose (root cause: PR #119 merged the driver legacy-hub photo semantic delta,
// then PR #122 merged the same semantic delta as a zero-diff no-op merge, which
// still triggered CI/deployments):
//   the same semantic publication may start in parallel; once one of them lands
//   on live `main`, the others must terminate as ALREADY_PUBLISHED / SUPERSEDED
//   BEFORE the PR / CI / merge / deploy steps — never as a zero-diff merge.
//
// Admission points (both mandatory, both re-read live `main`):
//   PRE_PR   — immediately before creating the temporary publication branch/PR.
//   PRE_MERGE — immediately before exercising merge authority on an open PR.
//
// Method (repository-agnostic):
//   Compare the candidate's EFFECTIVE OWNED DELTA against live `main` using exact
//   per-path blob equality (`git ls-tree <ref> -- <path>`). Ancestry
//   (candidate SHA is/isn't an ancestor of `main`) is NEVER used alone, because
//   the same semantic content can exist under a different SHA after
//   transport/rebase/merge. Only `ownedPaths` are compared, so unrelated `main`
//   movement never invalidates a publication by itself.
//
// Automation authority is limited to exact owned-path diff, tree/blob equality,
// and a caller-supplied deterministic proof flag. Generic semantic equivalence
// is never inferred: when the semantic-owner paths moved on live `main` in a way
// exact comparison cannot resolve, the gate fails closed with
// SEMANTIC_OWNER_REVIEW_REQUIRED and the candidate must not auto-merge.
//
// Read-only contract:
//   This gate only runs read-only git commands (`ls-tree`, `rev-parse`,
//   `status --porcelain`). It never runs reset/restore/stash/clean/checkout,
//   never touches foreign dirty state, and never recreates a publication branch.
//   Unrelated movement is absorbed with canonical transport maintenance
//   (merge live `main` into the publication branch), not by rebuilding source work.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRE_PR_PHASE = 'PRE_PR';
export const PRE_MERGE_PHASE = 'PRE_MERGE';

export const PUBLICATION_ALLOWED = 'PUBLICATION_ALLOWED';
export const COMPLETE_ALREADY_PUBLISHED = 'COMPLETE_ALREADY_PUBLISHED';
export const SUPERSEDED_ALREADY_PUBLISHED = 'SUPERSEDED_ALREADY_PUBLISHED';
export const SEMANTIC_OWNER_REVIEW_REQUIRED = 'SEMANTIC_OWNER_REVIEW_REQUIRED';

/**
 * Pure admission decision over exact owned-path blob maps.
 *
 * @param {object} args
 * @param {string[]} args.ownedPaths paths owned by this publication (repo-relative, non-empty).
 * @param {Record<string, string|null>} args.candidateBlobs exact blob hash per owned path at the
 *   candidate ref (`null` = path absent). Different SHAs with identical blobs count as identical.
 * @param {Record<string, string|null>} args.liveMainBlobs exact blob hash per owned path at live `main`.
 * @param {'PRE_PR'|'PRE_MERGE'} [args.phase='PRE_PR'] admission point being exercised.
 * @param {boolean} [args.semanticOwnerReviewRequired=false] deterministic caller proof that the
 *   semantic-owner paths moved on live `main` in a way exact comparison cannot resolve.
 *   When true the gate fails closed regardless of the computed delta.
 */
export function evaluatePublicationAdmission({
  ownedPaths,
  candidateBlobs,
  liveMainBlobs,
  phase = PRE_PR_PHASE,
  semanticOwnerReviewRequired = false,
}) {
  if (!Array.isArray(ownedPaths) || ownedPaths.length === 0) {
    return {
      status: SEMANTIC_OWNER_REVIEW_REQUIRED,
      phase,
      remainingDelta: [],
      reason:
        'ownedPaths is empty: no owned semantic delta can be proven, so automatic admission is refused.',
    };
  }
  if (phase !== PRE_PR_PHASE && phase !== PRE_MERGE_PHASE) {
    throw new Error(`unknown admission phase: ${String(phase)}`);
  }
  for (const path of ownedPaths) {
    if (!(path in Object(candidateBlobs)) || !(path in Object(liveMainBlobs))) {
      return {
        status: SEMANTIC_OWNER_REVIEW_REQUIRED,
        phase,
        remainingDelta: [...ownedPaths],
        reason:
          `blob proof is missing for owned path "${path}": ` +
          'automatic admission is refused until exact comparison is possible.',
      };
    }
  }
  if (semanticOwnerReviewRequired === true) {
    return {
      status: SEMANTIC_OWNER_REVIEW_REQUIRED,
      phase,
      remainingDelta: ownedPaths.filter((path) => candidateBlobs[path] !== liveMainBlobs[path]),
      reason:
        'semantic-owner paths moved on live main in a way exact blob comparison cannot resolve; ' +
        'human/Agent semantic review is required and automatic merge is forbidden.',
    };
  }
  const remainingDelta = ownedPaths.filter((path) => candidateBlobs[path] !== liveMainBlobs[path]);
  if (remainingDelta.length === 0) {
    if (phase === PRE_MERGE_PHASE) {
      return {
        status: SUPERSEDED_ALREADY_PUBLISHED,
        phase,
        remainingDelta,
        reason:
          'open publication PR has zero effective owned delta against live main: ' +
          'do not merge; close the PR and clean up only the temporary publication ref.',
      };
    }
    return {
      status: COMPLETE_ALREADY_PUBLISHED,
      phase,
      remainingDelta,
      reason:
        'owned semantic delta already exists on live main: ' +
        'do not create a publication PR, CI run, or deployment.',
    };
  }
  return {
    status: PUBLICATION_ALLOWED,
    phase,
    remainingDelta,
    reason:
      'owned effective delta still exists on live main; proceed with publication. ' +
      'Unrelated main movement is absorbed with canonical transport maintenance ' +
      '(merge live main into the publication branch) instead of recreating source work.',
  };
}

/**
 * Read-only exact blob map for owned paths at a git ref.
 * Missing path -> null. Never touches the worktree, index, or dirty state.
 */
export function readOwnedBlobs({ repositoryRoot, ref, ownedPaths }) {
  const blobs = {};
  for (const path of ownedPaths) {
    let stdout = '';
    try {
      stdout = execFileSync('git', ['ls-tree', ref, '--', path], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      blobs[path] = null;
      continue;
    }
    const line = stdout.split('\n').find((entry) => entry.length > 0);
    if (!line) {
      blobs[path] = null;
      continue;
    }
    // Format: "<mode> <type> <blob>\t<path>"
    const blob = line.split(/\s+/)[2]?.split('\t')[0] ?? '';
    blobs[path] = blob.length > 0 ? blob : null;
  }
  return blobs;
}

/** Resolve a ref to its exact SHA (read-only proof of which live `main` was checked). */
export function resolveRef({ repositoryRoot, ref }) {
  return execFileSync('git', ['rev-parse', ref], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function decideAtPhase({
  repositoryRoot,
  liveMainRef,
  candidateRef,
  ownedPaths,
  phase,
  semanticOwnerReviewRequired = false,
}) {
  const liveMainSha = resolveRef({ repositoryRoot, ref: liveMainRef });
  const candidateSha = resolveRef({ repositoryRoot, ref: candidateRef });
  const liveMainBlobs = readOwnedBlobs({ repositoryRoot, ref: liveMainSha, ownedPaths });
  const candidateBlobs = readOwnedBlobs({ repositoryRoot, ref: candidateSha, ownedPaths });
  const decision = evaluatePublicationAdmission({
    ownedPaths,
    candidateBlobs,
    liveMainBlobs,
    phase,
    semanticOwnerReviewRequired,
  });
  return { ...decision, liveMainSha, candidateSha };
}

/**
 * PRE_PR admission: call immediately before creating the publication branch/PR,
 * with liveMainRef freshly re-read (fetch first; START_HEAD is provenance only).
 */
export function decidePrePublication(args) {
  return decideAtPhase({ ...args, phase: PRE_PR_PHASE });
}

/**
 * PRE_MERGE admission: call immediately before exercising merge authority on an
 * open publication PR, with liveMainRef freshly re-read. `candidateRef` is the
 * PR head (the effective state that would be merged).
 */
export function decidePreMerge(args) {
  return decideAtPhase({ ...args, phase: PRE_MERGE_PHASE });
}

const EXIT_CODE_BY_STATUS = {
  [PUBLICATION_ALLOWED]: 0,
  [COMPLETE_ALREADY_PUBLISHED]: 2,
  [SUPERSEDED_ALREADY_PUBLISHED]: 3,
  [SEMANTIC_OWNER_REVIEW_REQUIRED]: 4,
};

// Minimal CLI for human/Agent publication flows. Read-only; see module contract above.
const invokedAsMainScript =
  process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMainScript) {
  const argv = process.argv.slice(2);
  const getOption = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 && index + 1 < argv.length ? argv[index + 1] : null;
  };
  const phase = getOption('--phase') ?? PRE_PR_PHASE;
  const liveMainRef = getOption('--live-main');
  const candidateRef = getOption('--candidate');
  const repositoryRoot = getOption('--repo') ?? process.cwd();
  const owned = argv.includes('--owned')
    ? argv.slice(argv.indexOf('--owned') + 1).filter((entry) => !entry.startsWith('--'))
    : [];
  const semanticOwnerReviewRequired = argv.includes('--owner-review-required');
  if (!liveMainRef || !candidateRef || owned.length === 0) {
    console.error(
      'usage: node scripts/git/publication-admission.mjs --phase PRE_PR|PRE_MERGE ' +
        '--live-main <ref> --candidate <ref> --owned <path...> [--repo <dir>] [--owner-review-required]',
    );
    process.exit(1);
  }
  try {
    const decision =
      phase === PRE_MERGE_PHASE
        ? decidePreMerge({ repositoryRoot, liveMainRef, candidateRef, ownedPaths: owned, semanticOwnerReviewRequired })
        : decidePrePublication({ repositoryRoot, liveMainRef, candidateRef, ownedPaths: owned, semanticOwnerReviewRequired });
    console.log(JSON.stringify(decision, null, 2));
    process.exit(EXIT_CODE_BY_STATUS[decision.status] ?? 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
