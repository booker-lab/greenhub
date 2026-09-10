// Canonical owner: AGENTS.md section 2 (temporary publication transport ref).
// Narrow transport helper — admission stays in publication-admission.mjs.
//
// Purpose: carry an admission-allowed exact candidate to a temporary remote
// ref/PR without taking over the shared checkout.
//
// Contract:
//   Transport creates a short-lived remote ref via
//     `git push <remote> <candidateSha>:refs/heads/<transportRef>`
//   which needs no worktree checkout, switch, merge, or rebase.
//   Cleanup deletes ONLY that temporary ref via
//     `git push <remote> --delete <transportRef>`.
//
// Forbidden (this module never runs them):
//   checkout / switch / merge / rebase / reset / restore / stash / clean,
//   `--force` push, history rewrite, direct push to `main`, production deploy.
//   Local merge fallback on a foreign-dirty shared checkout is forbidden:
//     LOCAL_MERGE_FALLBACK = FORBIDDEN_ON_FOREIGN_DIRTY_SHARED_CHECKOUT.
//
// Freshness:
//   When live `main` advances on unrelated paths, source work is NOT recreated.
//   If PR-head freshness is required, prefer a provider-side PR-head update
//   (GitHub "Update branch" or its semantic equivalent) only when available
//   and conflict-free. Conflict or semantic-owner overlap fails closed with
//   BLOCKED_TRANSPORT_CONFLICT / SEMANTIC_OWNER_REVIEW_REQUIRED — never with
//   an automatic local merge/rebase.
//
// This module performs no semantic comparison. Run
// scripts/git/publication-admission.mjs PRE_PR / PRE_MERGE first and transport
// only a PUBLICATION_ALLOWED exact candidate.

import { execFileSync } from 'node:child_process';

export const PROVIDER_SIDE_UPDATE_ALLOWED = 'PROVIDER_SIDE_UPDATE_ALLOWED';
export const BLOCKED_TRANSPORT_CONFLICT = 'BLOCKED_TRANSPORT_CONFLICT';
export const SEMANTIC_OWNER_REVIEW_REQUIRED = 'SEMANTIC_OWNER_REVIEW_REQUIRED';
export const BLOCKED_EXTERNAL_AUTHORITY = 'BLOCKED_EXTERNAL_AUTHORITY';

// Canonical policy marker: local merge fallback is never an allowed transport
// maintenance action on a foreign-dirty shared checkout.
export const LOCAL_MERGE_FALLBACK = 'FORBIDDEN_ON_FOREIGN_DIRTY_SHARED_CHECKOUT';

function assertValidTransportRef(transportRef) {
  if (typeof transportRef !== 'string' || transportRef.length === 0) {
    throw new Error('transportRef must be a non-empty short branch name.');
  }
  if (transportRef.startsWith('-') || transportRef.startsWith('/') || transportRef.endsWith('/')) {
    throw new Error(`refusing unsafe transportRef: ${JSON.stringify(transportRef)}`);
  }
  if (transportRef.startsWith('refs/')) {
    throw new Error('transportRef must be a short branch name, not a full ref.');
  }
  if (
    transportRef === 'main' ||
    transportRef === 'master' ||
    transportRef === 'HEAD' ||
    transportRef === 'origin/main' ||
    transportRef.includes('..') ||
    transportRef.includes('//') ||
    /[\s~^:?*[\]\\]/.test(transportRef)
  ) {
    throw new Error(`refusing transportRef that risks a protected or ambiguous ref: ${JSON.stringify(transportRef)}`);
  }
}

function assertValidCandidateSha(candidateSha) {
  if (typeof candidateSha !== 'string' || !/^[0-9a-f]{40}$/i.test(candidateSha)) {
    throw new Error('candidateSha must be an exact 40-hex commit SHA (no rewriting).');
  }
}

function assertValidRemote(remote) {
  if (typeof remote !== 'string' || remote.length === 0 || remote.startsWith('-')) {
    throw new Error('remote must be a non-empty remote name or URL.');
  }
}

/**
 * Read-only snapshot of the shared checkout. Never mutates anything.
 * @returns {{branch: string, head: string, status: string}}
 */
export function captureCheckoutState({ repositoryRoot }) {
  const branch = execFileSync('git', ['branch', '--show-current'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const status = execFileSync('git', ['status', '--porcelain=v1'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { branch, head, status };
}

/** True when branch, HEAD, and porcelain status are all identical. */
export function isCheckoutUnchanged(before, after) {
  return (
    before != null &&
    after != null &&
    before.branch === after.branch &&
    before.head === after.head &&
    before.status === after.status
  );
}

/** Pure push spec for exact-candidate transport (no checkout). */
export function buildExactTransportPushArgs({ candidateSha, transportRef, remote = 'origin' }) {
  assertValidCandidateSha(candidateSha);
  assertValidTransportRef(transportRef);
  assertValidRemote(remote);
  return ['push', remote, `${candidateSha}:refs/heads/${transportRef}`];
}

/** Pure push-delete spec for transport-only cleanup. */
export function buildTransportCleanupArgs({ transportRef, remote = 'origin' }) {
  assertValidTransportRef(transportRef);
  assertValidRemote(remote);
  return ['push', remote, '--delete', transportRef];
}

/**
 * Publish the exact candidate commit to a temporary remote ref.
 * Runs ONLY `git push <remote> <sha>:refs/heads/<ref>` — no checkout,
 * switch, merge, rebase, reset, or worktree/index mutation.
 */
export function publishExactCandidate({ repositoryRoot, candidateSha, transportRef, remote = 'origin' }) {
  const args = buildExactTransportPushArgs({ candidateSha, transportRef, remote });
  execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { remote, transportRef, candidateSha };
}

/**
 * Delete ONLY the temporary publication ref on the remote.
 * Never touches the shared checkout branch/HEAD, the source candidate,
 * or foreign dirty state.
 */
export function deleteTemporaryTransportRef({ repositoryRoot, transportRef, remote = 'origin' }) {
  const args = buildTransportCleanupArgs({ transportRef, remote });
  execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { remote, transportRef };
}

/**
 * Pure transport-maintenance decision (mocked provider-boundary seam).
 *
 * Never returns a local merge/rebase action. Either the provider-side update
 * path is allowed, or the flow fails closed with an explicit terminal status.
 */
export function decideTransportMaintenance({
  providerUpdateAvailable = false,
  hasConflict = false,
  semanticOwnerReviewRequired = false,
} = {}) {
  if (semanticOwnerReviewRequired === true) {
    return {
      action: SEMANTIC_OWNER_REVIEW_REQUIRED,
      localMergeFallback: LOCAL_MERGE_FALLBACK,
      reason:
        'semantic-owner paths moved in a way exact comparison cannot resolve; ' +
        'do not merge/rebase on the local checkout, request semantic owner review.',
    };
  }
  if (hasConflict === true) {
    return {
      action: BLOCKED_TRANSPORT_CONFLICT,
      localMergeFallback: LOCAL_MERGE_FALLBACK,
      reason:
        'provider-side update reports a conflict; ' +
        'do not fall back to local merge/rebase on a foreign-dirty shared checkout.',
    };
  }
  if (providerUpdateAvailable !== true) {
    return {
      action: BLOCKED_EXTERNAL_AUTHORITY,
      localMergeFallback: LOCAL_MERGE_FALLBACK,
      reason:
        'no conflict-free provider-side update path is available; ' +
        'do not merge/rebase locally, wait for provider authority or human decision.',
    };
  }
  return {
    action: PROVIDER_SIDE_UPDATE_ALLOWED,
    localMergeFallback: LOCAL_MERGE_FALLBACK,
    reason:
      'conflict-free provider-side PR-head update is available; ' +
      'use it without touching the shared checkout (no local merge/rebase).',
  };
}
