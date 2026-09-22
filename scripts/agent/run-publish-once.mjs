// Canonical owner: docs/specs/ops/development-authority.md sections 2, 6, 7, 8
// (opt-in isolated workspace, outcome-relative publication, task-owned residue,
// thin stateless automation).
//
// One caller-supplied bounded task, one foreground process, one exit.
// This entrypoint composes existing primitives instead of reimplementing them:
//   scripts/agent/run-once.mjs                execution core + success handoff
//   scripts/git/publication-admission.mjs     PRE_PR / PRE_MERGE admission
//   scripts/git/publication-transport.mjs     exact-candidate transport ref
//   installed `gh` CLI                        provider-native PR / checks / merge
//
// Publication credential boundary: the OpenCode child never receives GitHub
// credentials (run-once drops them); only this foreground owner uses the
// operator's approved `gh` authentication, and only after PRE_PR admission.
//
// Never invoked here: task selection, background work, durable state, force
// push, direct push to main, local merge/rebase of the shared checkout, or any
// checkout switch. Merge authority is exercised only after a fresh PRE_MERGE
// admission and a provider-side head-SHA binding.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALREADY_SATISFIED,
  BOUNDARY_VIOLATION,
  CLEANUP_FAILED,
  EXECUTOR_FAILED,
  INVALID_INPUT,
  SUCCESS,
  fetchBaseline,
  gitCapture,
  normalizeRepoPath,
  parseArgs as parseRunOnceArgs,
  readLiveRemoteMain,
  revParse,
  runOnce,
} from './run-once.mjs';
import {
  COMPLETE_ALREADY_PUBLISHED,
  PUBLICATION_ALLOWED,
  SEMANTIC_OWNER_REVIEW_REQUIRED,
  SUPERSEDED_ALREADY_PUBLISHED,
  decidePreMerge,
  decidePrePublication,
  readOwnedBlobs,
} from '../git/publication-admission.mjs';
import {
  captureCheckoutState,
  deleteTemporaryTransportRef,
  isCheckoutUnchanged,
  publishExactCandidate,
} from '../git/publication-transport.mjs';

export const SUCCESS_PUBLISHED = 'SUCCESS_PUBLISHED';
export const PUBLICATION_BLOCKED = 'PUBLICATION_BLOCKED';
export const CI_FAILED = 'CI_FAILED';
export const PUBLICATION_REFRESH_REQUIRED = 'PUBLICATION_REFRESH_REQUIRED';
export const REMOTE_READBACK_FAILED = 'REMOTE_READBACK_FAILED';

// Outcomes that mean the bounded publication outcome is satisfied; only these
// are treated as success-equivalent by the CLI exit code.
export const PUBLICATION_SUCCESS_OUTCOMES = Object.freeze([
  SUCCESS_PUBLISHED,
  COMPLETE_ALREADY_PUBLISHED,
  SUPERSEDED_ALREADY_PUBLISHED,
]);

export const PUBLISH_ONCE_STATUSES = Object.freeze([
  ...PUBLICATION_SUCCESS_OUTCOMES,
  ALREADY_SATISFIED,
  PUBLICATION_BLOCKED,
  CI_FAILED,
  PUBLICATION_REFRESH_REQUIRED,
  REMOTE_READBACK_FAILED,
  CLEANUP_FAILED,
  BOUNDARY_VIOLATION,
  EXECUTOR_FAILED,
  INVALID_INPUT,
]);

export const DEFAULT_CI_TIMEOUT_MS = 45 * 60 * 1000;
export const DEFAULT_MERGE_TIMEOUT_MS = 10 * 60 * 1000;

// Transient per-command commit identity. Global and repository Git config are
// never modified; signing and hooks are disabled per command so publication is
// deterministic.
export const COMMIT_IDENTITY = Object.freeze({
  name: 'greenhub-run-publish-once',
  email: 'run-publish-once@greenhub.invalid',
});

function messageOf(error) {
  if (error instanceof Error && typeof error.message === 'string') return error.message;
  return String(error);
}

function gitFailureMessage(error) {
  const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
  if (stderr.length > 0) return stderr;
  return messageOf(error);
}

function splitNul(value) {
  return value.split('\0').filter((entry) => entry.length > 0);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function ghMessageOf(result) {
  const stderr = typeof result?.stderr === 'string' ? result.stderr.trim() : '';
  if (stderr.length > 0) return stderr;
  const stdout = typeof result?.stdout === 'string' ? result.stdout.trim() : '';
  if (stdout.length > 0) return stdout;
  return `gh exited with status ${result?.exitCode ?? 'unknown'}`;
}

function ghFailed(result) {
  return Boolean(result?.startErrorCode) || result?.exitCode !== 0;
}

/** Invocation-unique, task-owned temporary transport ref name. */
export function createTemporaryTransportRef({ token = randomUUID() } = {}) {
  const suffix = String(token)
    .replace(/[^0-9a-z]/gi, '')
    .toLowerCase()
    .slice(0, 12);
  return `tmp/run-publish-once-${suffix.length > 0 ? suffix : 'task'}`;
}

export function defaultRunGh(args, { cwd = process.cwd(), timeoutMs = 0 } = {}) {
  const result = spawnSync('gh', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
    timeout: timeoutMs > 0 ? timeoutMs : undefined,
    windowsHide: true,
    env: process.env,
  });
  return {
    exitCode: typeof result.status === 'number' ? result.status : null,
    signal: result.signal ?? null,
    timedOut: result.error?.code === 'ETIMEDOUT',
    startErrorCode: result.error && result.error.code !== 'ETIMEDOUT' ? result.error.code : null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Fresh live `main` observation: canonical remote SHA plus the fetched ref. */
export function refreshLiveMain({ repositoryRoot, remote }) {
  const remoteSha = readLiveRemoteMain({ repositoryRoot, remote });
  const fetchedSha = fetchBaseline({ repositoryRoot, remote });
  return { remoteSha, fetchedSha };
}

/**
 * Stage exactly the Git-observed changed paths and verify the staged set is
 * identical. A pre-existing staged entry outside the observed boundary fails
 * closed before any commit is created.
 */
export function stageObservedPaths({ workspacePath, baselineSha, changedPaths }) {
  const observed = [...new Set(changedPaths.map(normalizeRepoPath))]
    .filter((entry) => entry.length > 0)
    .sort();
  if (observed.length === 0) {
    return {
      ok: false,
      status: BOUNDARY_VIOLATION,
      reason: 'no Git-observed changed paths exist, so no candidate may be created',
    };
  }
  const head = revParse(workspacePath, 'HEAD');
  if (head !== baselineSha) {
    return {
      ok: false,
      status: BOUNDARY_VIOLATION,
      reason: `workspace HEAD moved from the baseline (${head} != ${baselineSha})`,
    };
  }
  const added = gitCapture(workspacePath, ['add', '--', ...observed], { allowFailure: true });
  if (!added.ok) {
    return {
      ok: false,
      status: BOUNDARY_VIOLATION,
      reason: `staging observed paths failed: ${gitFailureMessage(added.error)}`,
    };
  }
  const staged = splitNul(
    gitCapture(workspacePath, ['diff', '--cached', '--name-only', '--no-renames', '-z', baselineSha])
      .stdout,
  )
    .map(normalizeRepoPath)
    .sort();
  const identical =
    staged.length === observed.length && staged.every((entry, index) => entry === observed[index]);
  if (!identical) {
    return {
      ok: false,
      status: BOUNDARY_VIOLATION,
      reason:
        'staged paths do not match the Git-observed mutation boundary ' +
        `(staged: ${staged.join(', ') || 'none'}; observed: ${observed.join(', ')})`,
    };
  }
  return { ok: true, observed };
}

export function buildCandidateCommitArgs({ message, tempRoot }) {
  const args = [
    '-c',
    `user.name=${COMMIT_IDENTITY.name}`,
    '-c',
    `user.email=${COMMIT_IDENTITY.email}`,
    '-c',
    'commit.gpgsign=false',
  ];
  if (typeof tempRoot === 'string' && tempRoot.length > 0) {
    args.push('-c', `core.hooksPath=${join(tempRoot, 'no-hooks')}`);
  }
  args.push('commit', '--no-verify', '--no-gpg-sign', '-m', message);
  return args;
}

/** Create the candidate commit in the task-owned workspace. */
export function createCandidateCommit({
  workspacePath,
  tempRoot,
  baselineSha,
  changedPaths,
  message,
}) {
  const staged = stageObservedPaths({ workspacePath, baselineSha, changedPaths });
  if (!staged.ok) return staged;
  const committed = gitCapture(
    workspacePath,
    buildCandidateCommitArgs({ message, tempRoot }),
    { allowFailure: true },
  );
  if (!committed.ok) {
    return {
      ok: false,
      status: EXECUTOR_FAILED,
      reason: `candidate commit failed: ${gitFailureMessage(committed.error)}`,
    };
  }
  const candidateSha = revParse(workspacePath, 'HEAD');
  const parents = gitCapture(workspacePath, ['rev-list', '--parents', '-n', '1', candidateSha])
    .stdout.trim()
    .split(/\s+/);
  if (parents.length !== 2 || parents[1] !== baselineSha) {
    return {
      ok: false,
      status: BOUNDARY_VIOLATION,
      reason:
        `candidate ${candidateSha} is not an exact single-parent descendant of the baseline ` +
        `${baselineSha}`,
    };
  }
  const treeChanged = splitNul(
    gitCapture(workspacePath, [
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      `${baselineSha}..${candidateSha}`,
    ]).stdout,
  )
    .map(normalizeRepoPath)
    .sort();
  const identical =
    treeChanged.length === staged.observed.length &&
    treeChanged.every((entry, index) => entry === staged.observed[index]);
  if (!identical) {
    return {
      ok: false,
      status: BOUNDARY_VIOLATION,
      reason:
        'candidate tree delta does not match the Git-observed mutation boundary ' +
        `(candidate: ${treeChanged.join(', ') || 'none'}; observed: ${staged.observed.join(', ')})`,
    };
  }
  return { ok: true, candidateSha, parentSha: baselineSha, changedPaths: staged.observed };
}

export function buildPrBody({
  commitMessage,
  baselineSha,
  candidateSha,
  changedPaths,
  proofResults,
  extraBody = null,
}) {
  const lines = [];
  if (typeof extraBody === 'string' && extraBody.trim().length > 0) {
    lines.push(extraBody.trim(), '');
  }
  const outcomeLine = String(commitMessage).split('\n')[0].trim();
  lines.push('## Bounded outcome', '', outcomeLine, '');
  lines.push('## Current execution evidence', '');
  lines.push(`- Baseline: \`${baselineSha}\``);
  lines.push(`- Candidate: \`${candidateSha}\``);
  lines.push(`- Changed paths: ${changedPaths.map((path) => `\`${path}\``).join(', ')}`);
  lines.push('', '## Proof', '');
  for (const entry of proofResults) {
    lines.push(`- \`${entry.command}\` → exit ${entry.exitCode ?? 'unknown'} (${entry.ok ? 'pass' : 'fail'})`);
  }
  lines.push('', '_Generated by scripts/agent/run-publish-once.mjs (one-shot, stateless)._');
  return lines.join('\n');
}

function resolveRepository({ runGh, cwd, explicit }) {
  if (typeof explicit === 'string' && explicit.length > 0) {
    return { ok: true, repository: explicit };
  }
  const view = runGh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd });
  if (ghFailed(view)) {
    return { ok: false, reason: `GitHub repository lookup failed: ${ghMessageOf(view)}` };
  }
  const repository = String(view.stdout).trim();
  if (!/^[^\s/]+\/[^\s/]+$/.test(repository)) {
    return {
      ok: false,
      reason: `GitHub repository lookup returned an unexpected value: ${JSON.stringify(repository)}`,
    };
  }
  return { ok: true, repository };
}

function checkGithubAuth({ runGh, cwd }) {
  const auth = runGh(['auth', 'status'], { cwd });
  if (ghFailed(auth)) {
    return { ok: false, reason: `GitHub CLI is not authenticated: ${ghMessageOf(auth)}` };
  }
  return { ok: true };
}

function readRepositoryCapabilities({ runGh, cwd, repository }) {
  const api = runGh(['api', `repos/${repository}`], { cwd });
  if (ghFailed(api)) {
    return { ok: false, reason: `repository capabilities could not be read: ${ghMessageOf(api)}` };
  }
  const payload = parseJson(api.stdout);
  if (payload === null || typeof payload !== 'object') {
    return { ok: false, reason: 'repository capabilities returned no JSON payload' };
  }
  return { ok: true, allowSquashMerge: payload.allow_squash_merge === true };
}

function readRequiredChecks({ runGh, cwd, repository }) {
  const protection = runGh(['api', `repos/${repository}/branches/main/protection`], { cwd });
  if (protection.startErrorCode) {
    return {
      ok: false,
      reason: `main protection could not be read: ${ghMessageOf(protection)}`,
    };
  }
  if (protection.exitCode !== 0) {
    const message = ghMessageOf(protection);
    if (/not protected|Branch not protected|HTTP 404/i.test(message)) {
      return { ok: true, requiredChecks: [], protection: 'UNPROTECTED' };
    }
    return { ok: false, reason: `main protection could not be read: ${message}` };
  }
  const payload = parseJson(protection.stdout);
  if (payload === null || typeof payload !== 'object') {
    return { ok: false, reason: 'main protection returned no JSON payload' };
  }
  const contexts = payload?.required_status_checks?.contexts;
  const requiredChecks = Array.isArray(contexts)
    ? contexts.map((entry) => String(entry)).filter((entry) => entry.trim().length > 0)
    : [];
  return { ok: true, requiredChecks, protection: 'PROTECTED' };
}

function viewPullRequest({
  runGh,
  cwd,
  repository,
  target,
  json = 'number,url,state,headRefOid,mergeStateStatus,mergeCommit',
}) {
  const view = runGh(['pr', 'view', String(target), '--repo', repository, '--json', json], { cwd });
  if (ghFailed(view)) {
    return { ok: false, reason: `PR observation failed: ${ghMessageOf(view)}` };
  }
  const pr = parseJson(view.stdout);
  if (pr === null || typeof pr !== 'object') {
    return { ok: false, reason: 'PR observation returned no JSON payload' };
  }
  return { ok: true, pr };
}

function createPullRequest({ runGh, cwd, repository, transportRef, title, bodyFile, candidateSha }) {
  const created = runGh(
    [
      'pr',
      'create',
      '--repo',
      repository,
      '--base',
      'main',
      '--head',
      transportRef,
      '--title',
      title,
      '--body-file',
      bodyFile,
    ],
    { cwd },
  );
  if (ghFailed(created)) {
    return { ok: false, reason: `PR creation failed: ${ghMessageOf(created)}` };
  }
  const url =
    String(created.stdout)
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '';
  if (!/^https?:\/\//.test(url)) {
    return {
      ok: false,
      reason: `PR creation did not return a pull request URL: ${JSON.stringify(url)}`,
    };
  }
  const viewed = viewPullRequest({ runGh, cwd, repository, target: url });
  if (!viewed.ok) return viewed;
  if (viewed.pr.headRefOid !== candidateSha) {
    return {
      ok: false,
      reason: `PR head ${viewed.pr.headRefOid} is not the exact candidate ${candidateSha}`,
    };
  }
  return { ok: true, pr: viewed.pr };
}

function closePullRequest({ runGh, cwd, repository, prNumber }) {
  const closed = runGh(['pr', 'close', String(prNumber), '--repo', repository], { cwd });
  if (ghFailed(closed)) return { ok: false, reason: ghMessageOf(closed) };
  return { ok: true };
}

/** Wait for the current PR's required checks only. Provider-native watch. */
export function waitForRequiredChecks({
  runGh,
  cwd,
  repository,
  prNumber,
  requiredChecks,
  timeoutMs,
}) {
  if (!Array.isArray(requiredChecks) || requiredChecks.length === 0) {
    return { ok: true, status: 'NONE_REQUIRED', checks: [] };
  }
  const watch = runGh(
    [
      'pr',
      'checks',
      String(prNumber),
      '--repo',
      repository,
      '--required',
      '--watch',
      '--fail-fast',
      '--interval',
      '10',
    ],
    { cwd, timeoutMs },
  );
  const observed = runGh(
    ['pr', 'checks', String(prNumber), '--repo', repository, '--required', '--json', 'name,bucket,state'],
    { cwd },
  );
  const checks = !ghFailed(observed) ? parseJson(observed.stdout) : null;
  if (Array.isArray(checks)) {
    const failed = checks.filter((entry) => entry?.bucket === 'fail');
    const pending = checks.filter((entry) => entry?.bucket === 'pending');
    if (failed.length > 0) {
      return {
        ok: false,
        status: 'FAILED',
        checks,
        reason: `required check(s) failed: ${failed.map((entry) => entry.name).join(', ')}`,
      };
    }
    if (pending.length > 0) {
      return {
        ok: false,
        status: 'PENDING',
        checks,
        reason: `required check(s) still pending: ${pending.map((entry) => entry.name).join(', ')}`,
      };
    }
    return { ok: true, status: 'PASSED', checks };
  }
  if (!ghFailed(watch)) return { ok: true, status: 'PASSED', checks: [] };
  return {
    ok: false,
    status: watch.timedOut ? 'TIMED_OUT' : 'FAILED',
    checks: [],
    reason: `required check watch did not pass: ${ghMessageOf(watch)}`,
  };
}

export function mergePullRequest({
  runGh,
  cwd,
  repository,
  prNumber,
  candidateSha,
  pullTitle,
}) {
  const command = [
    'pr',
    'merge',
    String(prNumber),
    '--repo',
    repository,
    '--squash',
    '--match-head-commit',
    candidateSha,
    '--subject',
    pullTitle,
  ];
  const merged = runGh(command, { cwd, timeoutMs: DEFAULT_MERGE_TIMEOUT_MS });
  const viewed = viewPullRequest({ runGh, cwd, repository, target: prNumber });
  if (!viewed.ok) {
    return { ok: false, blocked: true, reason: `merge result could not be verified: ${viewed.reason}` };
  }
  const pr = viewed.pr;
  if (pr.state === 'MERGED') {
    return {
      ok: true,
      pr,
      mergeSha: pr.mergeCommit?.oid ?? null,
      command,
      commandExitedZero: !ghFailed(merged),
    };
  }
  if (ghFailed(merged)) {
    if (pr.mergeStateStatus === 'BEHIND') {
      return {
        ok: false,
        refreshRequired: true,
        pr,
        reason:
          'live main moved after required checks passed; the provider refuses a stale merge ' +
          'under strict required checks and no automatic update is created',
      };
    }
    if (pr.mergeStateStatus === 'DIRTY') {
      return {
        ok: false,
        blocked: true,
        pr,
        reason: 'the provider reports a merge conflict; local merge/rebase fallback is forbidden',
      };
    }
    return { ok: false, blocked: true, pr, reason: `merge command failed: ${ghMessageOf(merged)}` };
  }
  return {
    ok: false,
    blocked: true,
    pr,
    reason: `merge command did not result in a merged PR (state=${pr.state})`,
  };
}

/**
 * Canonical remote read-back. Squash merges do not keep the candidate SHA in
 * main ancestry, so completion is judged only by exact owned-path blob
 * equality between the candidate and the current remote `main`.
 */
export function verifyRemoteOwnedDelta({ repositoryRoot, remote, candidateSha, ownedPaths }) {
  const candidateBlobs = readOwnedBlobs({ repositoryRoot, ref: candidateSha, ownedPaths });
  const remoteMainSha = readLiveRemoteMain({ repositoryRoot, remote });
  const fetchedSha = fetchBaseline({ repositoryRoot, remote });
  const remoteBlobs = readOwnedBlobs({ repositoryRoot, ref: fetchedSha, ownedPaths });
  const mismatched = ownedPaths.filter((path) => remoteBlobs[path] !== candidateBlobs[path]);
  return {
    candidateBlobs,
    remoteBlobs,
    remoteMainSha,
    fetchedSha,
    mismatched,
    verified: mismatched.length === 0,
  };
}

/**
 * Publication finalizer handed the successful task-owned workspace inside the
 * same foreground process. It never re-invokes OpenCode and never returns
 * before the workspace is released back to the execution core for cleanup.
 */
export function runPublicationFinalizer({ context, options, deps, extraBody, log }) {
  const runGh = deps.runGh ?? defaultRunGh;
  const publishExact = deps.publishExactCandidate ?? publishExactCandidate;
  const removeTransportRef = deps.deleteTemporaryTransportRef ?? deleteTemporaryTransportRef;
  const decidePrePr = deps.decidePrePublication ?? decidePrePublication;
  const decidePreMrg = deps.decidePreMerge ?? decidePreMerge;

  let canonicalBefore = null;
  try {
    canonicalBefore = captureCheckoutState({ repositoryRoot: context.repositoryRoot });
  } catch {
    canonicalBefore = null;
  }

  const publication = {
    outcome: null,
    reason: null,
    stage: 'CANDIDATE',
    ownedPaths: [],
    candidate: null,
    prePr: null,
    transportRef: null,
    transportCreated: false,
    transportCleanup: 'NOT_CREATED',
    transportCleanupErrors: [],
    retained: false,
    github: null,
    protection: null,
    requiredChecks: null,
    pr: null,
    prClose: null,
    checks: null,
    preMerge: null,
    merge: null,
    remoteMainSha: null,
    remoteDeltaVerified: null,
    remoteBlobsMismatched: [],
    canonicalCheckoutUnchanged: null,
  };

  const finish = (outcome, reason) => {
    publication.outcome = outcome;
    publication.reason = reason;
    if (publication.transportCreated && publication.transportCleanup === 'NOT_CREATED') {
      // The transport ref still exists: publication evidence is retained for
      // review instead of deleting the only remote reference to the candidate.
      publication.transportCleanup = 'RETAINED';
    }
    try {
      const canonicalAfter = captureCheckoutState({ repositoryRoot: context.repositoryRoot });
      publication.canonicalCheckoutUnchanged =
        canonicalBefore === null ? null : isCheckoutUnchanged(canonicalBefore, canonicalAfter);
    } catch (error) {
      publication.canonicalCheckoutUnchanged = null;
      log(`[run-publish-once] canonical checkout re-observation failed: ${messageOf(error)}`);
    }
    return publication;
  };

  const cleanupTransportRef = () => {
    if (!publication.transportCreated) {
      publication.transportCleanup = 'NOT_CREATED';
      return true;
    }
    try {
      removeTransportRef({
        repositoryRoot: context.repositoryRoot,
        transportRef: publication.transportRef,
        remote: context.remote,
      });
      publication.transportCleanup = 'REMOVED';
      return true;
    } catch (error) {
      publication.transportCleanup = 'FAILED';
      publication.transportCleanupErrors = [messageOf(error)];
      log(`[run-publish-once] transport ref cleanup failed: ${messageOf(error)}`);
      return false;
    }
  };

  try {
    const candidate = createCandidateCommit({
      workspacePath: context.workspacePath,
      tempRoot: context.tempRoot,
      baselineSha: context.baselineSha,
      changedPaths: context.changedPaths,
      message: options.commitMessage,
    });
    publication.candidate = candidate.ok
      ? {
          baselineSha: candidate.parentSha,
          candidateSha: candidate.candidateSha,
          parentSha: candidate.parentSha,
          changedPaths: candidate.changedPaths,
        }
      : { baselineSha: context.baselineSha, changedPaths: context.changedPaths };
    if (!candidate.ok) {
      return finish(candidate.status, candidate.reason);
    }
    publication.ownedPaths = candidate.changedPaths;
    log(
      `[run-publish-once] candidate ${candidate.candidateSha} (${candidate.changedPaths.length} owned path(s))`,
    );

    publication.stage = 'PRE_PR';
    const prePrFresh = refreshLiveMain({
      repositoryRoot: context.repositoryRoot,
      remote: context.remote,
    });
    const prePrDecision = decidePrePr({
      repositoryRoot: context.repositoryRoot,
      liveMainRef: prePrFresh.fetchedSha,
      candidateRef: candidate.candidateSha,
      ownedPaths: candidate.changedPaths,
    });
    publication.prePr = {
      ...prePrDecision,
      remoteMainSha: prePrFresh.remoteSha,
      fetchedMainSha: prePrFresh.fetchedSha,
    };
    if (prePrDecision.status === COMPLETE_ALREADY_PUBLISHED) {
      publication.remoteMainSha = prePrFresh.remoteSha;
      publication.remoteDeltaVerified = true;
      return finish(COMPLETE_ALREADY_PUBLISHED, prePrDecision.reason);
    }
    if (prePrDecision.status === SEMANTIC_OWNER_REVIEW_REQUIRED) {
      return finish(
        PUBLICATION_BLOCKED,
        `PRE_PR admission requires semantic owner review: ${prePrDecision.reason}`,
      );
    }
    if (prePrDecision.status !== PUBLICATION_ALLOWED) {
      return finish(
        PUBLICATION_BLOCKED,
        `unexpected PRE_PR admission status: ${prePrDecision.status}`,
      );
    }

    publication.stage = 'GITHUB';
    const repository = resolveRepository({
      runGh,
      cwd: context.repositoryRoot,
      explicit: options.githubRepository ?? null,
    });
    if (!repository.ok) return finish(PUBLICATION_BLOCKED, repository.reason);
    publication.github = { repository: repository.repository };
    const auth = checkGithubAuth({ runGh, cwd: context.repositoryRoot });
    if (!auth.ok) return finish(PUBLICATION_BLOCKED, auth.reason);
    const capabilities = readRepositoryCapabilities({
      runGh,
      cwd: context.repositoryRoot,
      repository: repository.repository,
    });
    if (!capabilities.ok) return finish(PUBLICATION_BLOCKED, capabilities.reason);
    publication.github.allowSquashMerge = capabilities.allowSquashMerge;
    if (capabilities.allowSquashMerge !== true) {
      return finish(
        PUBLICATION_BLOCKED,
        'the repository configuration does not allow squash merges, so automated publication is refused',
      );
    }
    const checks = readRequiredChecks({
      runGh,
      cwd: context.repositoryRoot,
      repository: repository.repository,
    });
    if (!checks.ok) return finish(PUBLICATION_BLOCKED, checks.reason);
    publication.protection = checks.protection;
    publication.requiredChecks = checks.requiredChecks;

    publication.stage = 'TRANSPORT';
    const transportRef = options.transportRef ?? createTemporaryTransportRef();
    publication.transportRef = transportRef;
    publishExact({
      repositoryRoot: context.repositoryRoot,
      candidateSha: candidate.candidateSha,
      transportRef,
      remote: context.remote,
    });
    publication.transportCreated = true;
    log(`[run-publish-once] transport ${transportRef} -> ${candidate.candidateSha}`);

    publication.stage = 'PR';
    const bodyFile = join(context.tempRoot, 'publication-pr-body.md');
    writeFileSync(
      bodyFile,
      buildPrBody({
        commitMessage: options.commitMessage,
        baselineSha: candidate.parentSha,
        candidateSha: candidate.candidateSha,
        changedPaths: candidate.changedPaths,
        proofResults: context.proofResults,
        extraBody,
      }),
      'utf8',
    );
    const prResult = createPullRequest({
      runGh,
      cwd: context.repositoryRoot,
      repository: repository.repository,
      transportRef,
      title: options.prTitle,
      bodyFile,
      candidateSha: candidate.candidateSha,
    });
    if (!prResult.ok) {
      // No PR exists yet, so the transport ref has no publication provenance.
      cleanupTransportRef();
      return finish(PUBLICATION_BLOCKED, prResult.reason);
    }
    publication.pr = prResult.pr;
    log(`[run-publish-once] PR #${prResult.pr.number} ${prResult.pr.url}`);

    publication.stage = 'CI';
    const checkWait = waitForRequiredChecks({
      runGh,
      cwd: context.repositoryRoot,
      repository: repository.repository,
      prNumber: prResult.pr.number,
      requiredChecks: publication.requiredChecks,
      timeoutMs: options.ciTimeoutMs ?? DEFAULT_CI_TIMEOUT_MS,
    });
    publication.checks = {
      status: checkWait.status,
      required: publication.requiredChecks,
      entries: Array.isArray(checkWait.checks) ? checkWait.checks : [],
    };
    if (!checkWait.ok) {
      publication.retained = true;
      return finish(CI_FAILED, checkWait.reason);
    }

    publication.stage = 'PRE_MERGE';
    const preMergeFresh = refreshLiveMain({
      repositoryRoot: context.repositoryRoot,
      remote: context.remote,
    });
    const prView = viewPullRequest({
      runGh,
      cwd: context.repositoryRoot,
      repository: repository.repository,
      target: prResult.pr.number,
    });
    if (!prView.ok) {
      publication.retained = true;
      return finish(PUBLICATION_BLOCKED, prView.reason);
    }
    if (prView.pr.state !== 'OPEN') {
      publication.retained = true;
      return finish(PUBLICATION_BLOCKED, `PR is not open (state=${prView.pr.state})`);
    }
    if (prView.pr.headRefOid !== candidate.candidateSha) {
      publication.retained = true;
      return finish(
        PUBLICATION_BLOCKED,
        `PR head ${prView.pr.headRefOid} is no longer the exact candidate ${candidate.candidateSha}`,
      );
    }
    const preMergeDecision = decidePreMrg({
      repositoryRoot: context.repositoryRoot,
      liveMainRef: preMergeFresh.fetchedSha,
      candidateRef: candidate.candidateSha,
      ownedPaths: candidate.changedPaths,
    });
    publication.preMerge = {
      ...preMergeDecision,
      remoteMainSha: preMergeFresh.remoteSha,
      fetchedMainSha: preMergeFresh.fetchedSha,
      mergeStateStatus: prView.pr.mergeStateStatus ?? null,
    };
    if (preMergeDecision.status === SUPERSEDED_ALREADY_PUBLISHED) {
      const closed = closePullRequest({
        runGh,
        cwd: context.repositoryRoot,
        repository: repository.repository,
        prNumber: prResult.pr.number,
      });
      publication.prClose = closed.ok ? 'CLOSED' : `FAILED: ${closed.reason}`;
      const cleaned = cleanupTransportRef();
      const readBack = verifyRemoteOwnedDelta({
        repositoryRoot: context.repositoryRoot,
        remote: context.remote,
        candidateSha: candidate.candidateSha,
        ownedPaths: candidate.changedPaths,
      });
      publication.remoteMainSha = readBack.remoteMainSha;
      publication.remoteDeltaVerified = readBack.verified;
      publication.remoteBlobsMismatched = readBack.mismatched;
      if (!cleaned) {
        return finish(CLEANUP_FAILED, 'publication was superseded but transport ref cleanup failed');
      }
      return finish(SUPERSEDED_ALREADY_PUBLISHED, preMergeDecision.reason);
    }
    if (preMergeDecision.status === SEMANTIC_OWNER_REVIEW_REQUIRED) {
      publication.retained = true;
      return finish(
        PUBLICATION_BLOCKED,
        `PRE_MERGE admission requires semantic owner review: ${preMergeDecision.reason}`,
      );
    }
    if (preMergeDecision.status !== PUBLICATION_ALLOWED) {
      publication.retained = true;
      return finish(
        PUBLICATION_BLOCKED,
        `unexpected PRE_MERGE admission status: ${preMergeDecision.status}`,
      );
    }
    if (prView.pr.mergeStateStatus === 'BEHIND') {
      publication.retained = true;
      return finish(
        PUBLICATION_REFRESH_REQUIRED,
        'live main moved after required checks passed; the provider refuses a stale merge under ' +
          'strict required checks and no automatic update is created',
      );
    }
    if (prView.pr.mergeStateStatus === 'DIRTY') {
      publication.retained = true;
      return finish(
        PUBLICATION_BLOCKED,
        'the provider reports a merge conflict; local merge/rebase fallback is forbidden',
      );
    }

    publication.stage = 'MERGE';
    const merge = mergePullRequest({
      runGh,
      cwd: context.repositoryRoot,
      repository: repository.repository,
      prNumber: prResult.pr.number,
      candidateSha: candidate.candidateSha,
      pullTitle: options.prTitle,
    });
    if (!merge.ok) {
      publication.retained = true;
      return finish(
        merge.refreshRequired ? PUBLICATION_REFRESH_REQUIRED : PUBLICATION_BLOCKED,
        merge.reason,
      );
    }
    publication.merge = {
      method: 'squash',
      matchHeadCommit: candidate.candidateSha,
      mergeSha: merge.mergeSha,
      pullRequestState: merge.pr.state,
    };
    log(`[run-publish-once] merged (squash) ${merge.mergeSha ?? 'merge SHA unobserved'}`);

    publication.stage = 'READ_BACK';
    const readBack = verifyRemoteOwnedDelta({
      repositoryRoot: context.repositoryRoot,
      remote: context.remote,
      candidateSha: candidate.candidateSha,
      ownedPaths: candidate.changedPaths,
    });
    publication.remoteMainSha = readBack.remoteMainSha;
    publication.remoteDeltaVerified = readBack.verified;
    publication.remoteBlobsMismatched = readBack.mismatched;

    publication.stage = 'CLEANUP';
    const cleaned = cleanupTransportRef();
    if (!readBack.verified) {
      return finish(
        REMOTE_READBACK_FAILED,
        `remote owned delta does not match the candidate after merge: ${readBack.mismatched.join(', ')}`,
      );
    }
    if (!cleaned) {
      return finish(CLEANUP_FAILED, 'publication succeeded but transport ref cleanup failed');
    }
    return finish(SUCCESS_PUBLISHED, 'candidate published, merged, and verified on canonical remote main');
  } catch (error) {
    if (publication.transportCreated && publication.pr === null) {
      cleanupTransportRef();
    } else if (publication.transportCreated) {
      publication.retained = true;
    }
    return finish(PUBLICATION_BLOCKED, `publication did not complete: ${messageOf(error)}`);
  }
}

export function validatePublishOnceInput(options) {
  if (options == null || typeof options !== 'object') return 'publisher options are required';
  if (typeof options.commitMessage !== 'string' || options.commitMessage.trim().length === 0) {
    return '--commit-message is required';
  }
  if (typeof options.prTitle !== 'string' || options.prTitle.trim().length === 0) {
    return '--pr-title is required';
  }
  if (
    options.prBodyFile != null &&
    (typeof options.prBodyFile !== 'string' || options.prBodyFile.trim().length === 0)
  ) {
    return '--pr-body must be a file path';
  }
  if (
    options.transportRef != null &&
    (typeof options.transportRef !== 'string' || options.transportRef.trim().length === 0)
  ) {
    return '--transport-ref must be a non-empty name';
  }
  if (
    options.githubRepository != null &&
    (typeof options.githubRepository !== 'string' ||
      !/^[^\s/]+\/[^\s/]+$/.test(options.githubRepository))
  ) {
    return '--github-repo must be <owner>/<name>';
  }
  if (options.ciTimeoutMs != null && (!Number.isFinite(options.ciTimeoutMs) || options.ciTimeoutMs < 0)) {
    return '--ci-timeout-ms must be >= 0';
  }
  return null;
}

function invalidResult(reason) {
  return {
    status: INVALID_INPUT,
    reason,
    executionStatus: null,
    publication: null,
    changedPaths: [],
    proofResults: [],
    workspace: { cleanup: 'NOT_CREATED', cleanupErrors: [] },
  };
}

/**
 * Execute one bounded task and close its publication in the same foreground
 * process. `deps` forwards the run-once seams (invokeOpencode,
 * runProofCommand, removeWorkspace, env, log) plus the publication seams
 * (runGh, publishExactCandidate, deleteTemporaryTransportRef,
 * decidePrePublication, decidePreMerge).
 */
export function runPublishOnce(options, deps = {}) {
  const invalid = validatePublishOnceInput(options);
  if (invalid) return invalidResult(invalid);

  const log = deps.log ?? ((message) => process.stderr.write(`${message}\n`));
  let extraBody = null;
  if (options.prBodyFile != null) {
    try {
      extraBody = readFileSync(resolve(options.prBodyFile), 'utf8');
    } catch (error) {
      return invalidResult(`cannot read --pr-body file: ${messageOf(error)}`);
    }
  }

  const execution = (deps.runOnceCore ?? runOnce)(
    {
      repositoryRoot: options.repositoryRoot,
      remote: options.remote ?? 'origin',
      taskText: options.taskText,
      allowedPaths: options.allowedPaths,
      proofCommands: options.proofCommands ?? [],
      title: options.title ?? null,
      model: options.model ?? null,
      agent: options.agent ?? null,
      opencodeBin: options.opencodeBin ?? null,
      opencodeTimeoutMs: options.opencodeTimeoutMs,
      proofTimeoutMs: options.proofTimeoutMs,
    },
    {
      invokeOpencode: deps.invokeOpencode,
      runProofCommand: deps.runProofCommand,
      removeWorkspace: deps.removeWorkspace,
      log,
      env: deps.env,
      successFinalizer: (context) =>
        runPublicationFinalizer({ context, options, deps, extraBody, log }),
    },
  );

  const publication = execution.successHandoff?.output ?? null;
  const handoffError = execution.successHandoff?.error ?? null;
  let status = execution.status;
  let reason = execution.reason;
  if (publication !== null) {
    const publicationSucceeded = PUBLICATION_SUCCESS_OUTCOMES.includes(publication.outcome);
    if (publicationSucceeded) {
      status = execution.status === CLEANUP_FAILED ? CLEANUP_FAILED : publication.outcome;
      reason =
        execution.status === CLEANUP_FAILED
          ? `${publication.reason}; workspace cleanup failed: ${execution.workspace.cleanupErrors.join('; ')}`
          : publication.reason;
    } else {
      status = publication.outcome;
      reason = publication.reason;
    }
  } else if (execution.status === SUCCESS) {
    status = EXECUTOR_FAILED;
    reason = handoffError ?? 'publication finalizer did not return a result';
  }

  return {
    ...execution,
    status,
    reason,
    executionStatus: execution.status,
    publication,
  };
}

export const USAGE = [
  'usage: node scripts/agent/run-publish-once.mjs --task <file> --allow <path>... --commit-message <message> --pr-title <title>',
  '',
  '  --task <file>               bounded task contract file (OUTCOME/PRESERVE/PROOF/ESCALATE ONLY IF)',
  '  --allow <path>              repo-relative path the task may mutate (repeatable, required)',
  '  --proof <command>           focused proof command, run in order in the workspace (repeatable)',
  '  --commit-message <message>  candidate commit message (required)',
  '  --pr-title <title>          pull request title (required)',
  '  --pr-body <file>            optional pull request body file, appended before execution evidence',
  '  --transport-ref <name>      optional explicit temporary transport ref name',
  '  --github-repo <owner/name>  optional explicit GitHub repository (default: resolved by gh)',
  '  --ci-timeout-ms <n>         required-check watch timeout in ms (default: 2700000, 0 disables)',
  '  --title <title>             optional OpenCode session title',
  '  --model <provider/model>    optional OpenCode model override',
  '  --agent <name>              optional OpenCode agent override',
  '  --opencode-bin <path>       explicit OpenCode executable (default: resolved from PATH)',
  '  --repo <dir>                canonical checkout root (default: current directory)',
  '  --remote <name>             publication remote observed for the live baseline (default: origin)',
  '  --opencode-timeout-ms <n>   opencode timeout in ms (default: 3600000, 0 disables)',
  '  --proof-timeout-ms <n>      per-proof timeout in ms (default: 1800000, 0 disables)',
  '',
  'Prints one deterministic JSON result to stdout.',
  'Exit code 0 for SUCCESS_PUBLISHED/ALREADY_SATISFIED/COMPLETE_ALREADY_PUBLISHED/SUPERSEDED_ALREADY_PUBLISHED.',
].join('\n');

export function parseArgs(argv) {
  const publication = {
    commitMessage: null,
    prTitle: null,
    prBodyFile: null,
    transportRef: null,
    githubRepository: null,
    ciTimeoutMs: DEFAULT_CI_TIMEOUT_MS,
  };
  const valueFlags = {
    '--commit-message': 'commitMessage',
    '--pr-title': 'prTitle',
    '--pr-body': 'prBodyFile',
    '--transport-ref': 'transportRef',
    '--github-repo': 'githubRepository',
  };
  const executionArgs = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (Object.hasOwn(valueFlags, arg)) {
      const value = argv[index + 1];
      if (value === undefined) return { ok: false, error: `${arg} requires a value` };
      index += 1;
      publication[valueFlags[arg]] = value;
      continue;
    }
    if (arg === '--ci-timeout-ms') {
      const value = argv[index + 1];
      const parsed = Number(value);
      if (value === undefined || !Number.isFinite(parsed) || parsed < 0) {
        return { ok: false, error: '--ci-timeout-ms requires a non-negative number' };
      }
      index += 1;
      publication.ciTimeoutMs = parsed;
      continue;
    }
    executionArgs.push(arg);
  }
  const execution = parseRunOnceArgs(executionArgs);
  if (!execution.ok) return execution;
  if (execution.options.help) {
    return { ok: true, options: { ...execution.options, ...publication, help: true } };
  }
  if (!publication.commitMessage) return { ok: false, error: '--commit-message is required' };
  if (!publication.prTitle) return { ok: false, error: '--pr-title is required' };
  return { ok: true, options: { ...execution.options, ...publication } };
}

export function main(
  argv,
  { env = process.env, stdout = process.stdout, stderr = process.stderr, deps = {} } = {},
) {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    stderr.write(`${parsed.error}\n${USAGE}\n`);
    stdout.write(`${JSON.stringify({ status: INVALID_INPUT, reason: parsed.error }, null, 2)}\n`);
    return 1;
  }
  if (parsed.options.help) {
    stderr.write(`${USAGE}\n`);
    return 0;
  }
  const taskPath = resolve(parsed.options.taskFile);
  let taskText;
  try {
    taskText = readFileSync(taskPath, 'utf8');
  } catch (error) {
    stderr.write(`cannot read task file: ${messageOf(error)}\n`);
    stdout.write(
      `${JSON.stringify({ status: INVALID_INPUT, reason: `cannot read task file: ${messageOf(error)}` }, null, 2)}\n`,
    );
    return 1;
  }
  const result = runPublishOnce({ ...parsed.options, taskText }, { ...deps, env });
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const publication = result.publication;
  const summary = [
    `[run-publish-once] STATUS ${result.status}`,
    `[run-publish-once] BASELINE_SHA ${result.baseline?.baselineSha ?? 'unknown'}`,
    `[run-publish-once] CANDIDATE_SHA ${publication?.candidate?.candidateSha ?? 'none'}`,
    `[run-publish-once] CHANGED_PATHS ${result.changedPaths.length}`,
    `[run-publish-once] PROOF_RESULTS ${result.proofResults.filter((entry) => entry.ok).length}/${result.proofResults.length} passed`,
    `[run-publish-once] PRE_PR ${publication?.prePr?.status ?? 'NOT_REACHED'}`,
    `[run-publish-once] TRANSPORT_REF ${publication?.transportRef ?? 'none'}`,
    `[run-publish-once] PR_NUMBER ${publication?.pr?.number ?? 'none'}`,
    `[run-publish-once] REQUIRED_CHECKS ${(publication?.requiredChecks ?? []).join(', ') || 'none'}`,
    `[run-publish-once] PRE_MERGE ${publication?.preMerge?.status ?? 'NOT_REACHED'}`,
    `[run-publish-once] MERGE_SHA ${publication?.merge?.mergeSha ?? 'none'}`,
    `[run-publish-once] REMOTE_MAIN_SHA ${publication?.remoteMainSha ?? 'none'}`,
    `[run-publish-once] REMOTE_DELTA_VERIFIED ${publication?.remoteDeltaVerified ?? 'none'}`,
    `[run-publish-once] WORKSPACE_CLEANUP ${result.workspace?.cleanup ?? 'NOT_CREATED'}`,
    `[run-publish-once] TRANSPORT_CLEANUP ${publication?.transportCleanup ?? 'NOT_CREATED'}`,
  ].join('\n');
  stderr.write(`${summary}\n`);
  return PUBLICATION_SUCCESS_OUTCOMES.includes(result.status) || result.status === ALREADY_SATISFIED
    ? 0
    : 1;
}

const invokedAsMainScript =
  process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMainScript) {
  process.exitCode = main(process.argv.slice(2));
}
