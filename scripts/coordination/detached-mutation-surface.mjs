// Canonical owner: AGENTS.md section 2 (`main` role / Mutating Task Admission)
// and docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md
// sections 3-5 (mutation without branch recurrence, worktree/isolation rule).
//
// Scope: EXACTLY the throwaway detached mutation surface lifecycle.
//
//   CREATE  allocate a unique OS-temp directory, then materialize the exact
//           live-main commit without a clone, a worktree, or a branch:
//             git init -> git remote add -> exact-SHA fetch -> checkout --detach
//   VERIFY  prove the surface is outside the canonical repository, carries its
//           own `.git` directory, has a detached HEAD at the exact expected
//           SHA, zero local development branches, and a clean start.
//   RETIRE  remove ONLY a surface whose ownership proof matches the supplied
//           task identity and baseline. No other path is ever deleted.
//
// Invariants:
//   - `refs/heads` stays empty: no task branch, feature branch, agent branch,
//     parallelism branch, branch-per-worktree, and no worktree factory.
//   - Stale surfaces are never reused: every CREATE allocates a fresh,
//     atomically-exclusive directory, and only RETIRE removes a surface.
//   - No durable registry: the ownership proof is written INSIDE the surface's
//     own `.git` directory and dies with the surface. Canonical coordination
//     truth remains with the existing Task/Claim/Result artifacts.
//   - Fail closed on: missing liveMainSha, invalid taskId, canonical-repository
//     containment, attached HEAD, HEAD mismatch, any local branch, dirty start,
//     foreign retirement request, and insufficient ownership proof.
//   - The canonical checkout is never a mutation target of this module.
//
// Windows is first-class: short directory names, atomic exclusive creation,
// bounded removal retries for handle release, and case-insensitive path
// comparison. Linux/macOS behavior is preserved.
//
// Explicitly OUT OF SCOPE: OpenCode/executor invocation, task admission,
// overlap decisions, candidate commit policy, PR creation, merge, publication
// automation, operator CLI wiring, scheduler, batch executor.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

export const DETACHED_MUTATION_SURFACE_SCHEMA_VERSION = 1;
export const DETACHED_MUTATION_SURFACE_MARKER = 'greenhub-detached-mutation-surface';
export const DETACHED_MUTATION_SURFACE_OWNERSHIP_FILENAME =
  'greenhub-detached-mutation-surface-ownership.json';
export const DETACHED_MUTATION_SURFACE_DIRECTORY_PREFIX = 'gh-dms-';
export const DETACHED_MUTATION_SURFACE_REMOTE_NAME = 'origin';
export const DETACHED_MUTATION_SURFACE_MAX_ALLOCATION_ATTEMPTS = 16;
export const DETACHED_MUTATION_SURFACE_DEFAULT_DEPTH = 1;
export const DETACHED_MUTATION_SURFACE_TASK_ID_MAX_LENGTH = 128;

export const INVALID_TASK_ID = 'INVALID_TASK_ID';
export const INVALID_LIVE_MAIN_SHA = 'INVALID_LIVE_MAIN_SHA';
export const INVALID_REMOTE_URL = 'INVALID_REMOTE_URL';
export const INVALID_PARENT_DIRECTORY = 'INVALID_PARENT_DIRECTORY';
export const INVALID_CANONICAL_REPOSITORY_ROOT = 'INVALID_CANONICAL_REPOSITORY_ROOT';
export const SURFACE_INSIDE_CANONICAL_REPOSITORY = 'SURFACE_INSIDE_CANONICAL_REPOSITORY';
export const SURFACE_CREATE_FAILED = 'SURFACE_CREATE_FAILED';
export const BASELINE_FETCH_FAILED = 'BASELINE_FETCH_FAILED';
export const BASELINE_SHA_MISMATCH = 'BASELINE_SHA_MISMATCH';
export const DETACHED_CHECKOUT_FAILED = 'DETACHED_CHECKOUT_FAILED';
export const SURFACE_NOT_FOUND = 'SURFACE_NOT_FOUND';
export const SURFACE_NOT_DIRECTORY = 'SURFACE_NOT_DIRECTORY';
export const SURFACE_GIT_DIR_NOT_SEPARATE = 'SURFACE_GIT_DIR_NOT_SEPARATE';
export const SURFACE_OWNERSHIP_PROOF_MISSING = 'SURFACE_OWNERSHIP_PROOF_MISSING';
export const SURFACE_OWNERSHIP_PROOF_INVALID = 'SURFACE_OWNERSHIP_PROOF_INVALID';
export const SURFACE_NOT_IN_EXPECTED_PARENT_DIRECTORY = 'SURFACE_NOT_IN_EXPECTED_PARENT_DIRECTORY';
export const HEAD_NOT_DETACHED = 'HEAD_NOT_DETACHED';
export const HEAD_SHA_MISMATCH = 'HEAD_SHA_MISMATCH';
export const LOCAL_BRANCH_PRESENT = 'LOCAL_BRANCH_PRESENT';
export const UNEXPECTED_DIRTY_START = 'UNEXPECTED_DIRTY_START';
export const FOREIGN_SURFACE_RETIRE_REFUSED = 'FOREIGN_SURFACE_RETIRE_REFUSED';
export const RETIRE_PATH_UNSAFE = 'RETIRE_PATH_UNSAFE';
export const SURFACE_RETIRE_FAILED = 'SURFACE_RETIRE_FAILED';

export class DetachedMutationSurfaceError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'DetachedMutationSurfaceError';
    this.code = details.code ?? 'DETACHED_MUTATION_SURFACE_ERROR';
  }
}

function fail(message, code) {
  throw new DetachedMutationSurfaceError(message, { code });
}

// ---------------------------------------------------------------------------
// Path helpers (Windows-aware, read-only: realpath never mutates anything).
// ---------------------------------------------------------------------------

function normalizePath(path) {
  const resolved = resolve(path);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function samePath(left, right) {
  return normalizePath(left) === normalizePath(right);
}

function realPathOrNull(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** True when `candidate` is `ancestor` itself or lexically below it. */
function isInsideOrEqual(ancestor, candidate) {
  const ancestorNormalized = normalizePath(ancestor);
  const candidateNormalized = normalizePath(candidate);
  if (ancestorNormalized === candidateNormalized) return true;
  const rel = relative(ancestorNormalized, candidateNormalized);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

/** True when `candidate` is strictly below `ancestor` (never equal). */
function isStrictlyInside(ancestor, candidate) {
  return isInsideOrEqual(ancestor, candidate) && !samePath(ancestor, candidate);
}

// ---------------------------------------------------------------------------
// Git helpers. All invocations are short-lived execFileSync calls, so no
// process handle survives them and the surface directory is always releasable.
// ---------------------------------------------------------------------------

function runGit(args, { cwd, code, what }) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const stderr =
      typeof error?.stderr === 'string' ? (error.stderr.trim().split('\n')[0] ?? '') : '';
    fail(`${what}${stderr.length > 0 ? ` (git ${args[0]}: ${stderr})` : ''}`, code);
  }
}

function probeGit(args, { cwd }) {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout: stdout.trim() };
  } catch (error) {
    return {
      ok: false,
      stdout: typeof error?.stdout === 'string' ? error.stdout.trim() : '',
    };
  }
}

/** Repository root of the process working directory, or null outside a repo. */
function detectedWorkingRepositoryRoot() {
  const probe = probeGit(['rev-parse', '--show-toplevel'], { cwd: process.cwd() });
  if (!probe.ok || probe.stdout.length === 0) return null;
  return realPathOrNull(probe.stdout) ?? resolve(probe.stdout);
}

// ---------------------------------------------------------------------------
// Input validation (fail-closed before any directory or git mutation).
// ---------------------------------------------------------------------------

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SURFACE_TOKEN_PATTERN = /^[a-z0-9]{8,32}$/;

function assertValidTaskId(taskId) {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    fail(
      'taskId must be a non-empty [A-Za-z0-9_-] identifier of at most ' +
        `${DETACHED_MUTATION_SURFACE_TASK_ID_MAX_LENGTH} characters ` +
        `(received ${JSON.stringify(taskId)}).`,
      INVALID_TASK_ID,
    );
  }
  return taskId;
}

function assertValidBaselineSha(liveMainSha) {
  if (typeof liveMainSha !== 'string' || !COMMIT_SHA_PATTERN.test(liveMainSha)) {
    fail(
      'liveMainSha must be an exact 40-hex commit SHA from a direct live-main read ' +
        `(received ${JSON.stringify(liveMainSha)}).`,
      INVALID_LIVE_MAIN_SHA,
    );
  }
  return liveMainSha.toLowerCase();
}

function assertValidRemoteUrl(remoteUrl) {
  if (typeof remoteUrl !== 'string' || remoteUrl.length === 0 || remoteUrl.startsWith('-')) {
    fail(
      `remoteUrl must be a non-empty remote URL or repository path (received ${JSON.stringify(remoteUrl)}).`,
      INVALID_REMOTE_URL,
    );
  }
  for (const character of remoteUrl) {
    const codePoint = character.codePointAt(0);
    if (codePoint < 0x20 || codePoint === 0x7f) {
      fail('remoteUrl must not contain control characters.', INVALID_REMOTE_URL);
    }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/]*@/i.test(remoteUrl)) {
    fail(
      'remoteUrl must not embed credentials: surface ownership metadata is written to disk.',
      INVALID_REMOTE_URL,
    );
  }
  return remoteUrl;
}

function assertParentDirectoryInput(parentDirectory) {
  if (
    typeof parentDirectory !== 'string' ||
    parentDirectory.length === 0 ||
    !isAbsolute(parentDirectory)
  ) {
    fail(
      `parentDirectory must be an absolute path (received ${JSON.stringify(parentDirectory)}).`,
      INVALID_PARENT_DIRECTORY,
    );
  }
}

function resolveExplicitCanonicalRepositoryRoot(canonicalRepositoryRoot) {
  if (canonicalRepositoryRoot === undefined || canonicalRepositoryRoot === null) return null;
  if (typeof canonicalRepositoryRoot !== 'string' || !isAbsolute(canonicalRepositoryRoot)) {
    fail(
      'canonicalRepositoryRoot must be an absolute path when provided ' +
        `(received ${JSON.stringify(canonicalRepositoryRoot)}).`,
      INVALID_CANONICAL_REPOSITORY_ROOT,
    );
  }
  const realRoot = realPathOrNull(canonicalRepositoryRoot);
  if (realRoot === null) {
    fail(
      `canonicalRepositoryRoot does not exist: ${canonicalRepositoryRoot}.`,
      INVALID_CANONICAL_REPOSITORY_ROOT,
    );
  }
  if (!statSync(realRoot).isDirectory()) {
    fail(
      `canonicalRepositoryRoot is not a directory: ${canonicalRepositoryRoot}.`,
      INVALID_CANONICAL_REPOSITORY_ROOT,
    );
  }
  return realRoot;
}

function ensureParentDirectory(requestedParent) {
  try {
    mkdirSync(requestedParent, { recursive: true });
  } catch (error) {
    fail(
      `parentDirectory could not be created: ${requestedParent} (${error.message}).`,
      INVALID_PARENT_DIRECTORY,
    );
  }
  const realParent = realPathOrNull(requestedParent);
  if (realParent === null || !statSync(realParent).isDirectory()) {
    fail(`parentDirectory is not a directory: ${requestedParent}.`, INVALID_PARENT_DIRECTORY);
  }
  return realParent;
}

function assertOutsideRepositoryWorktrees({ guardRoots, candidatePath, what }) {
  for (const root of guardRoots) {
    if (isInsideOrEqual(root, candidatePath)) {
      fail(
        `${what}: ${candidatePath} is inside the repository worktree ${root}. ` +
          'A mutation surface is never created inside a repository checkout.',
        SURFACE_INSIDE_CANONICAL_REPOSITORY,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// CREATE.
// ---------------------------------------------------------------------------

function defaultSurfaceToken() {
  return randomBytes(8).toString('hex');
}

/**
 * Atomically allocate a fresh unique surface directory.
 * `mkdirSync(..., { recursive: false })` fails with EEXIST instead of reusing
 * an existing directory, so concurrent creators (even for the same taskId)
 * always receive distinct surfaces and stale surfaces are never picked up.
 */
function allocateUniqueSurfaceDirectory({ parent, taskId, uniqueTokenFactory }) {
  const taskSlug = taskId.toLowerCase().slice(0, 24);
  for (let attempt = 0; attempt < DETACHED_MUTATION_SURFACE_MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
    const token = uniqueTokenFactory();
    if (typeof token !== 'string' || !SURFACE_TOKEN_PATTERN.test(token)) {
      fail(
        'uniqueTokenFactory must return a token matching [a-z0-9]{8,32}.',
        SURFACE_CREATE_FAILED,
      );
    }
    const candidate = join(
      parent,
      `${DETACHED_MUTATION_SURFACE_DIRECTORY_PREFIX}${taskSlug}-${token}`,
    );
    try {
      mkdirSync(candidate, { recursive: false });
      return candidate;
    } catch (error) {
      if (error?.code === 'EEXIST') continue;
      fail(
        `failed to allocate a unique surface directory under ${parent}: ${error.message}.`,
        SURFACE_CREATE_FAILED,
      );
    }
  }
  fail(
    `failed to allocate a unique surface directory under ${parent} after ` +
      `${DETACHED_MUTATION_SURFACE_MAX_ALLOCATION_ATTEMPTS} attempts.`,
    SURFACE_CREATE_FAILED,
  );
}

/**
 * Fetch the exact baseline commit without creating a local branch.
 * Primary path: fetch by exact SHA. Fallback (some remotes refuse raw-SHA
 * fetch): fetch `refs/heads/main` and require the tip to equal the exact
 * expected SHA; anything else fails closed as BASELINE_SHA_MISMATCH.
 */
function fetchExactBaseline({ surfacePath, baselineSha, depth }) {
  const depthArgs = Number.isInteger(depth) && depth > 0 ? [`--depth=${depth}`] : [];
  const remote = DETACHED_MUTATION_SURFACE_REMOTE_NAME;
  const exact = probeGit(['fetch', '--no-tags', ...depthArgs, remote, baselineSha], {
    cwd: surfacePath,
  });
  if (exact.ok) return;
  const byRef = probeGit(['fetch', '--no-tags', ...depthArgs, remote, 'refs/heads/main'], {
    cwd: surfacePath,
  });
  if (!byRef.ok) {
    fail(
      `exact-SHA fetch of ${baselineSha} failed and the refs/heads/main fallback also failed; ` +
        'the surface cannot bind to the exact live main.',
      BASELINE_FETCH_FAILED,
    );
  }
  const fetchedTip = probeGit(['rev-parse', 'FETCH_HEAD'], { cwd: surfacePath });
  if (!fetchedTip.ok || fetchedTip.stdout.toLowerCase() !== baselineSha) {
    fail(
      `live main is not the expected baseline: raw-SHA fetch failed and refs/heads/main ` +
        `resolved to ${fetchedTip.stdout || 'unknown'} instead of ${baselineSha}. ` +
        'Re-read live main and re-admit.',
      BASELINE_SHA_MISMATCH,
    );
  }
}

function initializeDetachedSurface({ surfacePath, remoteUrl, baselineSha, depth }) {
  runGit(['init', '--quiet'], {
    cwd: surfacePath,
    code: SURFACE_CREATE_FAILED,
    what: 'git init failed',
  });
  runGit(['remote', 'add', DETACHED_MUTATION_SURFACE_REMOTE_NAME, remoteUrl], {
    cwd: surfacePath,
    code: SURFACE_CREATE_FAILED,
    what: 'git remote add failed',
  });
  fetchExactBaseline({ surfacePath, baselineSha, depth });
  runGit(['checkout', '--quiet', '--detach', baselineSha], {
    cwd: surfacePath,
    code: DETACHED_CHECKOUT_FAILED,
    what: `detached checkout of ${baselineSha} failed`,
  });
}

function surfaceGitDirectory(surfacePath) {
  return join(surfacePath, '.git');
}

function surfaceOwnershipFilePath(surfacePath) {
  return join(surfaceGitDirectory(surfacePath), DETACHED_MUTATION_SURFACE_OWNERSHIP_FILENAME);
}

function writeSurfaceOwnership({
  surfacePath,
  surfaceId,
  taskId,
  baselineSha,
  remoteUrl,
  canonicalRepositoryRoot,
  parentDirectory,
  createdAt,
}) {
  const gitDirectory = surfaceGitDirectory(surfacePath);
  if (!existsSync(gitDirectory) || !statSync(gitDirectory).isDirectory()) {
    fail(
      `surface ${surfacePath} has no separate .git directory to carry ownership metadata.`,
      SURFACE_GIT_DIR_NOT_SEPARATE,
    );
  }
  const payload = {
    schemaVersion: DETACHED_MUTATION_SURFACE_SCHEMA_VERSION,
    marker: DETACHED_MUTATION_SURFACE_MARKER,
    surfaceId,
    taskId,
    baselineSha,
    remoteUrl,
    canonicalRepositoryRoot,
    parentDirectory,
    createdAt,
  };
  try {
    writeFileSync(
      surfaceOwnershipFilePath(surfacePath),
      `${JSON.stringify(payload, null, 2)}\n`,
      'utf8',
    );
  } catch (error) {
    fail(`failed to write surface ownership metadata: ${error.message}.`, SURFACE_CREATE_FAILED);
  }
  return payload;
}

function readSurfaceOwnership(surfacePath) {
  const filePath = surfaceOwnershipFilePath(surfacePath);
  if (!existsSync(filePath)) {
    fail(
      `${surfacePath} carries no ${DETACHED_MUTATION_SURFACE_OWNERSHIP_FILENAME} ownership ` +
        'proof; it is not an owned detached mutation surface.',
      SURFACE_OWNERSHIP_PROOF_MISSING,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(
      `surface ownership proof is not readable JSON: ${error.message}.`,
      SURFACE_OWNERSHIP_PROOF_INVALID,
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('surface ownership proof is not a plain record.', SURFACE_OWNERSHIP_PROOF_INVALID);
  }
  if (
    parsed.schemaVersion !== DETACHED_MUTATION_SURFACE_SCHEMA_VERSION ||
    parsed.marker !== DETACHED_MUTATION_SURFACE_MARKER
  ) {
    fail(
      'surface ownership proof marker/schema mismatch; refusing to trust it.',
      SURFACE_OWNERSHIP_PROOF_INVALID,
    );
  }
  for (const field of ['surfaceId', 'taskId', 'baselineSha', 'remoteUrl', 'parentDirectory']) {
    if (typeof parsed[field] !== 'string' || parsed[field].length === 0) {
      fail(`surface ownership proof is missing "${field}".`, SURFACE_OWNERSHIP_PROOF_INVALID);
    }
  }
  if (
    parsed.canonicalRepositoryRoot !== null &&
    typeof parsed.canonicalRepositoryRoot !== 'string'
  ) {
    fail(
      'surface ownership proof has an invalid canonicalRepositoryRoot.',
      SURFACE_OWNERSHIP_PROOF_INVALID,
    );
  }
  return parsed;
}

/** Guard roots for verify/retire: explicit + recorded + working repository. */
function resolveSurfaceGuardRoots({ explicitRoot, ownership, realTarget }) {
  const roots = [];
  const pushRoot = (root) => {
    if (root === null || root === undefined) return;
    if (!roots.some((existing) => samePath(existing, root))) roots.push(root);
  };
  pushRoot(explicitRoot);
  if (typeof ownership.canonicalRepositoryRoot === 'string') {
    pushRoot(
      realPathOrNull(ownership.canonicalRepositoryRoot) ?? ownership.canonicalRepositoryRoot,
    );
  }
  // The working repository root is a guard unless it is the surface itself
  // (an executor may legitimately verify/retire from inside its own surface).
  const workingRoot = detectedWorkingRepositoryRoot();
  if (workingRoot !== null && !isInsideOrEqual(realTarget, workingRoot)) {
    pushRoot(workingRoot);
  }
  return roots;
}

function removableSurfaceGuardCheck({ guardRoots, realTarget }) {
  for (const root of guardRoots) {
    if (isInsideOrEqual(root, realTarget) || isInsideOrEqual(realTarget, root)) {
      fail(
        `refusing to touch ${realTarget}: it overlaps the canonical repository ${root}.`,
        SURFACE_INSIDE_CANONICAL_REPOSITORY,
      );
    }
  }
}

function removeFailedSurface(surfacePath) {
  if (!existsSync(surfacePath)) return;
  const real = realPathOrNull(surfacePath);
  if (real === null || !samePath(real, surfacePath)) return;
  try {
    rmSync(surfacePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // Best effort only: a partially created surface is never reused, because
    // CREATE always allocates a fresh exclusive directory.
  }
}

/**
 * CREATE — allocate and materialize a throwaway detached mutation surface.
 *
 * @param {object} args
 * @param {string} args.taskId bounded semantic owner (safe directory token).
 * @param {string} args.remoteUrl repository identity (URL or local path).
 * @param {string} args.liveMainSha exact 40-hex SHA from a direct live-main read.
 * @param {string} [args.parentDirectory] absolute temp parent (default os.tmpdir()).
 * @param {string|null} [args.canonicalRepositoryRoot] canonical checkout to stay outside.
 * @param {number} [args.depth] fetch depth (default 1; pass null for full history).
 * @param {() => string} [args.uniqueTokenFactory] test seam for directory tokens.
 * @param {() => string} [args.nowProvider] metadata timestamp provider.
 * @returns {Readonly<object>} unique surface path, exact baseline, ownership proof.
 */
export function createDetachedMutationSurface({
  taskId,
  remoteUrl,
  liveMainSha,
  parentDirectory = tmpdir(),
  canonicalRepositoryRoot = null,
  depth = DETACHED_MUTATION_SURFACE_DEFAULT_DEPTH,
  uniqueTokenFactory = defaultSurfaceToken,
  nowProvider = () => new Date().toISOString(),
} = {}) {
  const safeTaskId = assertValidTaskId(taskId);
  const safeBaselineSha = assertValidBaselineSha(liveMainSha);
  const safeRemoteUrl = assertValidRemoteUrl(remoteUrl);
  assertParentDirectoryInput(parentDirectory);
  const explicitRoot = resolveExplicitCanonicalRepositoryRoot(canonicalRepositoryRoot);

  const guardRoots = [explicitRoot, detectedWorkingRepositoryRoot()].filter(
    (root) => root !== null,
  );
  const requestedParent = resolve(parentDirectory);
  assertOutsideRepositoryWorktrees({
    guardRoots,
    candidatePath: requestedParent,
    what: 'refusing to create a mutation surface',
  });

  const parent = ensureParentDirectory(requestedParent);
  assertOutsideRepositoryWorktrees({
    guardRoots,
    candidatePath: parent,
    what: 'refusing to create a mutation surface',
  });

  const surfacePath = allocateUniqueSurfaceDirectory({
    parent,
    taskId: safeTaskId,
    uniqueTokenFactory,
  });

  try {
    initializeDetachedSurface({
      surfacePath,
      remoteUrl: safeRemoteUrl,
      baselineSha: safeBaselineSha,
      depth,
    });
    const surfaceId = basename(surfacePath);
    const createdAt = String(nowProvider());
    writeSurfaceOwnership({
      surfacePath,
      surfaceId,
      taskId: safeTaskId,
      baselineSha: safeBaselineSha,
      remoteUrl: safeRemoteUrl,
      canonicalRepositoryRoot: explicitRoot,
      parentDirectory: parent,
      createdAt,
    });
    const verified = verifyDetachedMutationSurface({
      surfacePath,
      taskId: safeTaskId,
      expectedBaselineSha: safeBaselineSha,
      canonicalRepositoryRoot: explicitRoot,
      expectedSurfaceId: surfaceId,
      expectedParentDirectory: parent,
    });
    return Object.freeze({
      schemaVersion: DETACHED_MUTATION_SURFACE_SCHEMA_VERSION,
      marker: DETACHED_MUTATION_SURFACE_MARKER,
      surfaceId,
      taskId: safeTaskId,
      surfacePath,
      realPath: verified.realPath,
      gitDir: verified.gitDir,
      baselineSha: safeBaselineSha,
      headSha: verified.headSha,
      detached: true,
      clean: true,
      localBranchCount: 0,
      remoteUrl: safeRemoteUrl,
      canonicalRepositoryRoot: explicitRoot,
      parentDirectory: parent,
      createdAt,
    });
  } catch (error) {
    removeFailedSurface(surfacePath);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// VERIFY.
// ---------------------------------------------------------------------------

/**
 * VERIFY — prove a surface satisfies every detached-mutation-surface condition.
 *
 * Checks, in fail-closed order:
 *   1. path exists, is an absolute directory, and is outside the canonical
 *      repository (explicit and/or recorded guard root);
 *   2. ownership proof exists, matches the expected task/surface identity, and
 *      places the surface inside its recorded temp parent;
 *   3. `.git` is a real directory inside the surface (never a linked checkout);
 *   4. HEAD is detached, at the exact expected SHA (or the recorded baseline);
 *   5. `refs/heads` is empty (no local development branch);
 *   6. the start is clean (`git status --porcelain` empty).
 *
 * @returns {Readonly<object>} verified detached surface record.
 */
export function verifyDetachedMutationSurface({
  surfacePath,
  taskId,
  expectedBaselineSha = null,
  canonicalRepositoryRoot = null,
  expectedSurfaceId = null,
  expectedParentDirectory = null,
} = {}) {
  const safeTaskId = assertValidTaskId(taskId);
  const requestedBaselineSha =
    expectedBaselineSha === null ? null : assertValidBaselineSha(expectedBaselineSha);
  const explicitRoot = resolveExplicitCanonicalRepositoryRoot(canonicalRepositoryRoot);
  if (typeof surfacePath !== 'string' || surfacePath.length === 0 || !isAbsolute(surfacePath)) {
    fail(
      `surfacePath must be an absolute path (received ${JSON.stringify(surfacePath)}).`,
      SURFACE_NOT_FOUND,
    );
  }
  const requested = resolve(surfacePath);
  if (!existsSync(requested)) {
    fail(`surface does not exist: ${requested}.`, SURFACE_NOT_FOUND);
  }
  const realTarget = realPathOrNull(requested);
  if (realTarget === null) {
    fail(`surface path is not resolvable: ${requested}.`, SURFACE_NOT_FOUND);
  }
  if (!statSync(realTarget).isDirectory()) {
    fail(`surface is not a directory: ${realTarget}.`, SURFACE_NOT_DIRECTORY);
  }

  removableSurfaceGuardCheck({
    guardRoots: [explicitRoot].filter((root) => root !== null),
    realTarget,
  });

  const ownership = readSurfaceOwnership(realTarget);
  const guardRoots = resolveSurfaceGuardRoots({ explicitRoot, ownership, realTarget });
  removableSurfaceGuardCheck({ guardRoots, realTarget });

  const expectedId = expectedSurfaceId ?? basename(realTarget);
  if (
    ownership.surfaceId !== basename(realTarget) ||
    (expectedSurfaceId !== null && ownership.surfaceId !== expectedId)
  ) {
    fail(
      `surface ownership proof id mismatch: ${ownership.surfaceId} != ${expectedId}.`,
      SURFACE_OWNERSHIP_PROOF_INVALID,
    );
  }
  if (ownership.taskId !== safeTaskId) {
    fail(
      `surface ${realTarget} belongs to task ${ownership.taskId}, not ${safeTaskId}.`,
      SURFACE_OWNERSHIP_PROOF_INVALID,
    );
  }
  const recordedParent = realPathOrNull(ownership.parentDirectory) ?? ownership.parentDirectory;
  if (!isAbsolute(ownership.parentDirectory) || !isStrictlyInside(recordedParent, realTarget)) {
    fail(
      `surface ownership proof places ${realTarget} outside its recorded temp parent ` +
        `${ownership.parentDirectory}.`,
      SURFACE_OWNERSHIP_PROOF_INVALID,
    );
  }
  if (expectedParentDirectory !== null && !isStrictlyInside(expectedParentDirectory, realTarget)) {
    fail(
      `surface ${realTarget} is not inside the expected parent directory ` +
        `${expectedParentDirectory}.`,
      SURFACE_NOT_IN_EXPECTED_PARENT_DIRECTORY,
    );
  }

  const gitDirectory = surfaceGitDirectory(realTarget);
  if (!existsSync(gitDirectory) || !statSync(gitDirectory).isDirectory()) {
    fail(
      `surface ${realTarget} has no separate .git directory inside it.`,
      SURFACE_GIT_DIR_NOT_SEPARATE,
    );
  }
  const absoluteGitDir = runGit(['rev-parse', '--absolute-git-dir'], {
    cwd: realTarget,
    code: SURFACE_GIT_DIR_NOT_SEPARATE,
    what: 'surface is not a usable git repository',
  });
  const realGitDir = realPathOrNull(absoluteGitDir) ?? absoluteGitDir;
  const expectedGitDir = realPathOrNull(gitDirectory) ?? gitDirectory;
  if (!samePath(realGitDir, expectedGitDir) || !isStrictlyInside(realTarget, realGitDir)) {
    fail(
      `surface ${realTarget} does not own its git directory (got ${realGitDir}).`,
      SURFACE_GIT_DIR_NOT_SEPARATE,
    );
  }

  const symbolicHead = probeGit(['symbolic-ref', '-q', 'HEAD'], { cwd: realTarget });
  if (symbolicHead.ok) {
    fail(
      `surface HEAD is attached to ${symbolicHead.stdout}; a mutation surface must be detached.`,
      HEAD_NOT_DETACHED,
    );
  }
  const headSha = runGit(['rev-parse', 'HEAD'], {
    cwd: realTarget,
    code: HEAD_SHA_MISMATCH,
    what: 'surface HEAD cannot be resolved',
  }).toLowerCase();
  const expectedHeadSha = requestedBaselineSha ?? ownership.baselineSha;
  if (headSha !== expectedHeadSha) {
    fail(
      `surface HEAD mismatch: expected ${expectedHeadSha} but found ${headSha}.`,
      HEAD_SHA_MISMATCH,
    );
  }

  const localBranches = runGit(['for-each-ref', '--format=%(refname)', 'refs/heads'], {
    cwd: realTarget,
    code: LOCAL_BRANCH_PRESENT,
    what: 'surface local branch enumeration failed',
  });
  if (localBranches.length > 0) {
    fail(
      `surface ${realTarget} carries local development branches: ` +
        `${localBranches.split('\n').join(', ')}.`,
      LOCAL_BRANCH_PRESENT,
    );
  }

  const dirty = runGit(['status', '--porcelain'], {
    cwd: realTarget,
    code: UNEXPECTED_DIRTY_START,
    what: 'surface status read failed',
  });
  if (dirty.length > 0) {
    fail(`surface ${realTarget} is not clean at start:\n${dirty}`, UNEXPECTED_DIRTY_START);
  }

  return Object.freeze({
    schemaVersion: DETACHED_MUTATION_SURFACE_SCHEMA_VERSION,
    marker: DETACHED_MUTATION_SURFACE_MARKER,
    surfaceId: ownership.surfaceId,
    taskId: safeTaskId,
    surfacePath: realTarget,
    realPath: realTarget,
    gitDir: realGitDir,
    baselineSha: expectedHeadSha,
    headSha,
    detached: true,
    clean: true,
    localBranchCount: 0,
  });
}

// ---------------------------------------------------------------------------
// RETIRE.
// ---------------------------------------------------------------------------

/**
 * RETIRE — remove ONLY the surface directory proven to be owned by this task.
 *
 * Refusal conditions (fail closed, nothing is deleted):
 *   - the target does not exist, is not a directory, or has no ownership proof;
 *   - the ownership proof marker/schema, surfaceId, taskId, baselineSHA, or
 *     recorded temp parent does not match the retirement request;
 *   - the target is not strictly inside its recorded temp parent;
 *   - the target overlaps the canonical repository in either direction;
 *   - `.git` is not a separate directory (a linked checkout is never removed).
 *
 * @returns {Readonly<object>} retired surface record.
 */
export function retireDetachedMutationSurface({
  surfacePath,
  taskId,
  expectedBaselineSha = null,
  canonicalRepositoryRoot = null,
} = {}) {
  const safeTaskId = assertValidTaskId(taskId);
  const requestedBaselineSha =
    expectedBaselineSha === null ? null : assertValidBaselineSha(expectedBaselineSha);
  const explicitRoot = resolveExplicitCanonicalRepositoryRoot(canonicalRepositoryRoot);
  if (typeof surfacePath !== 'string' || surfacePath.length === 0 || !isAbsolute(surfacePath)) {
    fail(
      `surfacePath must be an absolute path (received ${JSON.stringify(surfacePath)}).`,
      SURFACE_NOT_FOUND,
    );
  }
  const requested = resolve(surfacePath);
  if (!existsSync(requested)) {
    fail(`surface does not exist (already retired?): ${requested}.`, SURFACE_NOT_FOUND);
  }
  const realTarget = realPathOrNull(requested);
  if (realTarget === null) {
    fail(`surface path is not resolvable: ${requested}.`, SURFACE_NOT_FOUND);
  }
  if (!statSync(realTarget).isDirectory()) {
    fail(`surface is not a directory: ${realTarget}.`, SURFACE_NOT_DIRECTORY);
  }

  removableSurfaceGuardCheck({
    guardRoots: [explicitRoot].filter((root) => root !== null),
    realTarget,
  });

  const ownership = readSurfaceOwnership(realTarget);
  const guardRoots = resolveSurfaceGuardRoots({ explicitRoot, ownership, realTarget });
  removableSurfaceGuardCheck({ guardRoots, realTarget });

  const gitDirectory = surfaceGitDirectory(realTarget);
  if (!existsSync(gitDirectory) || !statSync(gitDirectory).isDirectory()) {
    fail(
      `refusing to retire ${realTarget}: it has no separate .git directory inside it.`,
      SURFACE_GIT_DIR_NOT_SEPARATE,
    );
  }
  if (ownership.surfaceId !== basename(realTarget)) {
    fail(
      `refusing to retire ${realTarget}: ownership proof id ${ownership.surfaceId} does not ` +
        `match the directory name ${basename(realTarget)}.`,
      SURFACE_OWNERSHIP_PROOF_INVALID,
    );
  }
  if (ownership.taskId !== safeTaskId) {
    fail(
      `refusing to retire a foreign surface: ${realTarget} belongs to task ` +
        `${ownership.taskId}, not ${safeTaskId}.`,
      FOREIGN_SURFACE_RETIRE_REFUSED,
    );
  }
  if (requestedBaselineSha !== null && ownership.baselineSha !== requestedBaselineSha) {
    fail(
      `refusing to retire ${realTarget}: baseline mismatch (expected ` +
        `${requestedBaselineSha}, recorded ${ownership.baselineSha}).`,
      FOREIGN_SURFACE_RETIRE_REFUSED,
    );
  }
  const recordedParent = realPathOrNull(ownership.parentDirectory) ?? ownership.parentDirectory;
  if (!isAbsolute(ownership.parentDirectory) || !isStrictlyInside(recordedParent, realTarget)) {
    fail(
      `refusing to retire ${realTarget}: it is not strictly inside its recorded temp parent ` +
        `${ownership.parentDirectory}.`,
      RETIRE_PATH_UNSAFE,
    );
  }
  if (!basename(realTarget).startsWith(DETACHED_MUTATION_SURFACE_DIRECTORY_PREFIX)) {
    fail(
      `refusing to retire ${realTarget}: the directory is not a ` +
        `${DETACHED_MUTATION_SURFACE_DIRECTORY_PREFIX} surface directory.`,
      RETIRE_PATH_UNSAFE,
    );
  }

  try {
    rmSync(realTarget, { recursive: true, force: false, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    fail(`failed to remove surface ${realTarget}: ${error.message}.`, SURFACE_RETIRE_FAILED);
  }
  if (existsSync(realTarget)) {
    fail(`surface directory still exists after removal: ${realTarget}.`, SURFACE_RETIRE_FAILED);
  }

  return Object.freeze({
    schemaVersion: DETACHED_MUTATION_SURFACE_SCHEMA_VERSION,
    marker: DETACHED_MUTATION_SURFACE_MARKER,
    removed: true,
    surfaceId: ownership.surfaceId,
    taskId: safeTaskId,
    surfacePath: realTarget,
    baselineSha: ownership.baselineSha,
  });
}
