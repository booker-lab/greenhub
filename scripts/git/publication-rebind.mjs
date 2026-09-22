// Canonical owner: docs/specs/ops/development-authority.md sections 3 and 6
// (dimensional freshness; outcome-relative publication binding).
//
// Purpose: when one already-executing bounded task's delta is valid and live
// `main` moves on paths that do NOT overlap the task-owned semantic/proof
// boundary, the same foreground publication process re-binds the exact
// task-owned delta onto fresh live `main` as a new object-level candidate.
//
// Read-only / object-level contract (this module never uses a shared checkout):
//   - It reads trees with `git ls-tree`, diffs with `git diff --name-only`,
//     and checks ancestry with `git merge-base --is-ancestor`.
//   - It builds the rebound commit with object-level plumbing only: a temporary
//     index (`GIT_INDEX_FILE`), `git read-tree`, `git update-index --index-info`,
//     `git write-tree`, and `git commit-tree`. No worktree or index of any shared
//     checkout is touched.
//   - It never runs checkout / switch / merge / rebase / reset / restore /
//     stash / clean, never force pushes, and never merges.
//   - It never absorbs or modifies foreign/main changes into the task delta:
//     the rebound tree delta is exactly the task-owned path set.
//   - It never invokes OpenCode a second time.
//
// Freshness conflicts fail closed with explicit finite outcomes: a non-ancestor
// live `main`, or an owned path whose live entry equals neither the baseline nor
// the candidate entry (FOREIGN_EDIT), is SEMANTIC_OWNER_REVIEW_REQUIRED and no
// automatic construction is performed.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const REBIND_NOT_REQUIRED = 'REBIND_NOT_REQUIRED';
export const REBIND_ALLOWED = 'REBIND_ALLOWED';
export const NO_OWNED_DELTA = 'NO_OWNED_DELTA';
export const SEMANTIC_OWNER_REVIEW_REQUIRED = 'SEMANTIC_OWNER_REVIEW_REQUIRED';
export const REBIND_FAILED = 'REBIND_FAILED';

export const DEFAULT_REBIND_IDENTITY = Object.freeze({
  name: 'greenhub-publication-rebind',
  email: 'publication-rebind@greenhub.invalid',
});

function normalizePath(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function gitRun(cwd, args, { env, input } = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
    input,
    maxBuffer: 64 * 1024 * 1024,
    env,
  });
}

function gitFailureMessage(error) {
  const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
  if (stderr.length > 0) return stderr;
  if (error instanceof Error && typeof error.message === 'string') return error.message;
  return String(error);
}

/**
 * Read-only tree entries for `paths` at `ref` (`git ls-tree <ref> -- <path>`).
 * Missing path and git failure both map to `null`. Never touches any worktree,
 * index, ref, or foreign dirty state.
 *
 * @returns {Record<string, null | { mode: string, type: string, sha: string }>}
 */
export function readLiveTreeEntries({ repositoryRoot, ref, paths }) {
  const entries = {};
  for (const path of paths) {
    let stdout = '';
    try {
      stdout = gitRun(repositoryRoot, ['ls-tree', ref, '--', path]);
    } catch {
      entries[path] = null;
      continue;
    }
    const line = stdout.split('\n').find((entry) => entry.length > 0);
    if (!line) {
      entries[path] = null;
      continue;
    }
    const [meta] = line.split('\t');
    const [mode, type, sha] = meta.split(/\s+/);
    entries[path] =
      mode && type && sha ? { mode: mode.trim(), type: type.trim(), sha: sha.trim() } : null;
  }
  return entries;
}

/** `null === null`; otherwise exact mode+type+sha equality. */
export function treeEntriesEqual(a, b) {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.mode === b.mode && a.type === b.type && a.sha === b.sha;
}

/** Read-only ancestry proof via `git merge-base --is-ancestor`. */
export function isAncestor({ repositoryRoot, ancestor, descendant }) {
  try {
    gitRun(repositoryRoot, ['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read-only path delta between two commits:
 * `git diff --name-only --no-renames -z <fromSha> <toSha>`, NUL-split,
 * backslash-normalized, empties dropped, sorted. Same sha -> `[]`.
 */
export function movedPathsBetween({ repositoryRoot, fromSha, toSha }) {
  if (fromSha === toSha) return [];
  const stdout = gitRun(repositoryRoot, [
    'diff',
    '--name-only',
    '--no-renames',
    '-z',
    fromSha,
    toSha,
  ]);
  return stdout
    .split('\0')
    .map((entry) => entry.replace(/\\/g, '/'))
    .filter((entry) => entry.length > 0)
    .sort();
}

/**
 * Proof-freshness authority: only proof whose declared owner overlaps the moved
 * path set is stale. Owner match is path-or-directory-prefix with normalized `/`
 * (`moved === owner || moved.startsWith(owner + '/')`). Missing owners entry
 * means `[]`; empty owners means the proof depends on the whole tree, so it is
 * stale whenever anything moved.
 *
 * @returns {Array<{ command: string, owners: string[], stale: boolean }>}
 */
export function selectStaleProofs({ proofCommands, proofOwners, movedPaths }) {
  const commands = Array.isArray(proofCommands) ? proofCommands : [];
  const ownersFor = (index) => {
    const entry = Array.isArray(proofOwners) ? proofOwners[index] : undefined;
    return Array.isArray(entry) ? entry : [];
  };
  const moved = (Array.isArray(movedPaths) ? movedPaths : []).map(normalizePath).filter(Boolean);
  return commands.map((command, index) => {
    const owners = ownersFor(index);
    const normalizedOwners = owners.map(normalizePath).filter((owner) => owner.length > 0);
    const stale =
      normalizedOwners.length === 0
        ? moved.length > 0
        : moved.some((movedPath) =>
            normalizedOwners.some(
              (owner) => movedPath === owner || movedPath.startsWith(`${owner}/`),
            ),
          );
    return { command, owners, stale };
  });
}

/**
 * Classify whether the existing candidate can be re-bound onto fresh live main.
 *
 * Returns one of REBIND_NOT_REQUIRED, REBIND_ALLOWED, NO_OWNED_DELTA, or
 * SEMANTIC_OWNER_REVIEW_REQUIRED, with per-owned-path dispositions.
 */
export function classifyFreshMainRebind({
  repositoryRoot,
  baselineSha,
  candidateSha,
  liveMainSha,
  ownedPaths,
}) {
  const paths = Array.isArray(ownedPaths) ? ownedPaths : [];
  if (baselineSha === liveMainSha) {
    return {
      status: REBIND_NOT_REQUIRED,
      baselineSha,
      candidateSha,
      liveMainSha,
      movedPaths: [],
      ownedPathStates: [],
      reapplyPaths: [],
      alreadyAppliedPaths: [],
      foreignEditPaths: [],
      reason: 'live main has not moved since the candidate baseline; no rebind is required',
    };
  }

  const movedPaths = movedPathsBetween({ repositoryRoot, fromSha: baselineSha, toSha: liveMainSha });
  const ancestorOk = isAncestor({
    repositoryRoot,
    ancestor: baselineSha,
    descendant: liveMainSha,
  });
  const baselineEntries = readLiveTreeEntries({ repositoryRoot, ref: baselineSha, paths });
  const candidateEntries = readLiveTreeEntries({ repositoryRoot, ref: candidateSha, paths });
  const liveEntries = readLiveTreeEntries({ repositoryRoot, ref: liveMainSha, paths });

  const ownedPathStates = paths.map((path) => {
    const baselineEntry = baselineEntries[path] ?? null;
    const candidateEntry = candidateEntries[path] ?? null;
    const liveEntry = liveEntries[path] ?? null;
    let disposition;
    if (treeEntriesEqual(liveEntry, baselineEntry)) disposition = 'REAPPLY';
    else if (treeEntriesEqual(liveEntry, candidateEntry)) disposition = 'ALREADY_APPLIED';
    else disposition = 'FOREIGN_EDIT';
    return { path, disposition, baselineEntry, candidateEntry, liveEntry };
  });

  const reapplyPaths = ownedPathStates
    .filter((state) => state.disposition === 'REAPPLY')
    .map((state) => state.path);
  const alreadyAppliedPaths = ownedPathStates
    .filter((state) => state.disposition === 'ALREADY_APPLIED')
    .map((state) => state.path);
  const foreignEditPaths = ownedPathStates
    .filter((state) => state.disposition === 'FOREIGN_EDIT')
    .map((state) => state.path);

  const base = {
    baselineSha,
    candidateSha,
    liveMainSha,
    movedPaths,
    ownedPathStates,
  };

  if (!ancestorOk || foreignEditPaths.length > 0) {
    const reasons = [];
    if (!ancestorOk) {
      reasons.push(`baseline ${baselineSha} is not an ancestor of live main ${liveMainSha}`);
    }
    if (foreignEditPaths.length > 0) {
      reasons.push(
        `task-owned path(s) carry foreign edits that are neither the baseline nor the candidate ` +
          `entry: ${foreignEditPaths.join(', ')}`,
      );
    }
    return {
      ...base,
      status: SEMANTIC_OWNER_REVIEW_REQUIRED,
      reapplyPaths,
      alreadyAppliedPaths,
      foreignEditPaths,
      reason: reasons.join('; '),
    };
  }

  if (reapplyPaths.length === 0) {
    return {
      ...base,
      status: NO_OWNED_DELTA,
      reapplyPaths: [],
      alreadyAppliedPaths,
      foreignEditPaths: [],
      reason:
        'every task-owned path already holds the candidate entry on live main; ' +
        'no rebind construction is needed and admission decides completion',
    };
  }

  return {
    ...base,
    status: REBIND_ALLOWED,
    reapplyPaths,
    alreadyAppliedPaths,
    foreignEditPaths: [],
    reason:
      'live main moved only on paths outside the task-owned delta; the exact task-owned delta ' +
      'can be re-bound onto fresh live main with explicit Git evidence',
  };
}

/**
 * Object-level rebound construction. Uses a temporary index and plumbing only
 * (`read-tree`, `update-index --index-info`, `write-tree`, `commit-tree`); never
 * checks out, switches, merges, rebases, or mutates any worktree, index, ref, or
 * config. The temporary index is removed before returning.
 */
export function buildReboundCandidate({
  repositoryRoot,
  scratchDir,
  liveMainSha,
  candidateSha,
  ownedPaths,
  message,
  identity = DEFAULT_REBIND_IDENTITY,
}) {
  const paths = Array.isArray(ownedPaths) ? ownedPaths : [];
  const commitIdentity = identity ?? DEFAULT_REBIND_IDENTITY;
  let indexDirectory = null;
  try {
    indexDirectory = mkdtempSync(join(scratchDir, 'publication-rebind-index-'));
    const env = { ...process.env, GIT_INDEX_FILE: join(indexDirectory, 'index') };

    gitRun(repositoryRoot, ['read-tree', liveMainSha], { env });

    const candidateEntries = readLiveTreeEntries({
      repositoryRoot,
      ref: candidateSha,
      paths,
    });
    const lines = paths.map((path) => {
      const entry = candidateEntries[path] ?? null;
      if (entry === null) return `0 ${'0'.repeat(40)}\t${path}\n`;
      return `${entry.mode} ${entry.sha}\t${path}\n`;
    });
    gitRun(repositoryRoot, ['update-index', '--index-info'], {
      env,
      input: lines.join(''),
    });

    const treeSha = gitRun(repositoryRoot, ['write-tree'], { env }).trim();

    const reboundSha = gitRun(
      repositoryRoot,
      [
        '-c',
        `user.name=${commitIdentity.name}`,
        '-c',
        `user.email=${commitIdentity.email}`,
        '-c',
        'commit.gpgsign=false',
        'commit-tree',
        treeSha,
        '-p',
        liveMainSha,
        '-m',
        message,
      ],
      { env },
    ).trim();

    const evidence = verifyReboundCandidate({
      repositoryRoot,
      reboundSha,
      liveMainSha,
      candidateSha,
      ownedPaths: paths,
    });
    if (!evidence.ok) {
      return {
        ok: false,
        status: REBIND_FAILED,
        reason: `rebound candidate verification failed: ${evidence.reason}`,
      };
    }
    return {
      ok: true,
      candidateSha: reboundSha,
      treeSha,
      changedPaths: [...paths],
      evidence,
    };
  } catch (error) {
    return { ok: false, status: REBIND_FAILED, reason: gitFailureMessage(error) };
  } finally {
    if (indexDirectory !== null) {
      try {
        rmSync(indexDirectory, { recursive: true, force: true });
      } catch {
        // Best-effort scratch index removal; a leftover temp index is not task residue.
      }
    }
  }
}

/**
 * Read-only verification of a rebound candidate:
 *   - exactly one parent, equal to `liveMainSha`;
 *   - the tree delta between live main and the rebound candidate is contained in
 *     the owned path set (foreign changes preserved byte-for-byte);
 *   - every owned path's rebound entry equals the original candidate entry.
 */
export function verifyReboundCandidate({
  repositoryRoot,
  reboundSha,
  liveMainSha,
  candidateSha,
  ownedPaths,
}) {
  const paths = Array.isArray(ownedPaths) ? ownedPaths : [];
  const parentLine = gitRun(repositoryRoot, [
    'rev-list',
    '--parents',
    '-n',
    '1',
    reboundSha,
  ]).trim();
  const parentParts = parentLine.split(/\s+/).filter((entry) => entry.length > 0);
  const parentSha = parentParts.length > 1 ? parentParts[1] : null;
  const parentOk = parentParts.length === 2 && parentParts[1] === liveMainSha;

  const treeDeltaPaths = movedPathsBetween({
    repositoryRoot,
    fromSha: liveMainSha,
    toSha: reboundSha,
  });
  const owned = new Set(paths.map(normalizePath));
  const extraPaths = treeDeltaPaths.filter((path) => !owned.has(normalizePath(path)));

  const reboundEntries = readLiveTreeEntries({ repositoryRoot, ref: reboundSha, paths });
  const candidateEntries = readLiveTreeEntries({ repositoryRoot, ref: candidateSha, paths });
  const mismatchedOwnedPaths = paths.filter(
    (path) =>
      !treeEntriesEqual(reboundEntries[path] ?? null, candidateEntries[path] ?? null),
  );

  const ok = parentOk && extraPaths.length === 0 && mismatchedOwnedPaths.length === 0;
  let reason;
  if (!parentOk) {
    reason =
      `rebound candidate ${reboundSha} does not have exactly one parent equal to ` +
      `live main ${liveMainSha} (observed: ${parentLine})`;
  } else if (extraPaths.length > 0) {
    reason = `rebound tree delta contains paths outside the owned set: ${extraPaths.join(', ')}`;
  } else if (mismatchedOwnedPaths.length > 0) {
    reason =
      `rebound owned-path entries differ from the original candidate: ${mismatchedOwnedPaths.join(', ')}`;
  } else {
    reason = 'rebound candidate matches the live main parent and the exact owned-path delta';
  }
  return {
    ok,
    parentSha,
    parentOk,
    treeDeltaPaths,
    extraPaths,
    mismatchedOwnedPaths,
    reason,
  };
}
