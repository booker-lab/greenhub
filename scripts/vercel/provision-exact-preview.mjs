/**
 * Exact-preview provisioning helper (PILOT-AUTH-EXACT-REF-PREVIEW-PROVISIONING-CAPABILITY-42A
 * + PILOT-AUTH-DRIVER-EXACT-PREVIEW-CAPABILITY-43A).
 *
 * Minimal diagnostic/runtime-proof capability: preserve an arbitrary approved
 * exact Git commit SHA as the source identity of a Consumer / Seller / Driver
 * Vercel Preview deployment.
 *
 * Mechanism (smallest official path):
 * - Build a dedicated ref `preview-exact/<scope>/<sha>` pointing EXACTLY at
 *   the requested commit (no new commit, no merge, no main mutation).
 * - Push only that ref. The existing Vercel Git integration then creates a
 *   Preview deployment with `meta.githubCommitSha == requested exact SHA`
 *   and `target == null` (preview). `main` deployments stay disabled via
 *   `apps/<app>/vercel.json`.
 * - The shared ignore predicate bypasses the empty-delta SKIP ONLY for
 *   `preview-exact/*` refs (see `shouldBypassIgnoreForExactPreview` in
 *   `scripts/vercel/ignore-build.mjs`). Normal `preview` sync flow is
 *   unchanged.
 *
 * Locked contract (never here):
 * - No wait-preview-deploy.mjs exact-SHA predicate change.
 * - No tree-equality-as-SHA substitution.
 * - No production deployment, no main auto-deploy re-enable.
 * - No preview merge-commit identity spoofing.
 * - No publication-transport ref reuse.
 *
 * Runtime needs: `node` + `git` only. No dependencies, no install step.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = 'booker-lab/greenhub';

/** Provisioning caller allowlist. `both` = consumer + seller (driver excluded). Driver is an independent single scope. */
export const APP_ALLOWLIST = Object.freeze(['consumer', 'seller', 'driver', 'both']);

export const SCOPE_TO_APPS = Object.freeze({
  consumer: Object.freeze(['consumer']),
  seller: Object.freeze(['seller']),
  driver: Object.freeze(['driver']),
  both: Object.freeze(['consumer', 'seller']),
});

/** Strict lowercase full 40-char SHA. Callers must pass the SHA verbatim; no silent normalization. */
export const SHA_PATTERN = /^[0-9a-f]{40}$/;

export const REF_PREFIX = 'preview-exact/';

export const REF_PATTERN = /^preview-exact\/(consumer|seller|driver|both)\/[0-9a-f]{40}$/;

export class ProvisioningError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProvisioningError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ProvisioningError(code, message);
}

/** Validate the exact SHA syntax. Rejects empty/unknown SHAs at the git layer, not here. */
export function assertExactSha(value) {
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) {
    fail('EXACT_SHA_MALFORMED', 'exact SHA는 40자리 소문자 16진수여야 합니다.');
  }
  return value;
}

/** Validate the app selection against the allowlist. Production/main/preview are impossible here. */
export function assertProvisioningApp(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!APP_ALLOWLIST.includes(normalized)) {
    fail(
      'UNKNOWN_PROVISIONING_APP',
      `알 수 없는 provisioning 앱입니다: ${JSON.stringify(value)} (consumer|seller|driver|both만 허용)`,
    );
  }
  return normalized;
}

/** Production target is impossible: only null/undefined/preview are accepted. */
export function assertNonProductionTarget(target) {
  if (target === undefined || target === null) return null;
  const normalized = String(target).trim().toLowerCase();
  if (normalized === '' || normalized === 'preview' || normalized === 'null') return null;
  fail('PRODUCTION_TARGET_REFUSED', 'provisioning target은 Preview(non-production)만 허용됩니다.');
}

export function resolveProvisioningApps(app) {
  const scope = assertProvisioningApp(app);
  return [...SCOPE_TO_APPS[scope]];
}

/**
 * Build the dedicated provisioning ref for a validated request.
 * The requested SHA is embedded verbatim as the ref suffix.
 */
export function buildProvisioningRef({ sha, app }) {
  const validSha = assertExactSha(sha);
  const scope = assertProvisioningApp(app);
  return `${REF_PREFIX}${scope}/${validSha}`;
}

/** Parse a provisioning ref back into { scope, sha }. Throws when the ref is not a provisioning ref. */
export function parseProvisioningRef(ref) {
  const normalized = typeof ref === 'string' ? ref.trim() : '';
  const match = normalized.match(REF_PATTERN);
  if (!match) {
    fail('NOT_A_PROVISIONING_REF', `provisioning ref가 아닙니다: ${JSON.stringify(ref)}`);
  }
  return { scope: match[1], sha: normalized.slice(-40), ref: normalized };
}

/**
 * Pure request builder: validates syntax/allowlist/target and preserves the
 * requested SHA verbatim in both metadata and ref. Commit existence and
 * remote-addressability are verified at the git layer (commitExists + push).
 */
export function buildProvisioningRequest({ sha, app, target = null }) {
  const validSha = assertExactSha(sha);
  const scope = assertProvisioningApp(app);
  assertNonProductionTarget(target);
  const ref = `${REF_PREFIX}${scope}/${validSha}`;
  return Object.freeze({
    repository: REPO,
    sha: validSha,
    requestedSha: validSha,
    app: scope,
    scope,
    apps: Object.freeze([...SCOPE_TO_APPS[scope]]),
    ref,
    target: null,
    production: false,
  });
}

function runGit(repositoryRoot, args) {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function resolveRepositoryRoot(scriptDir) {
  try {
    return runGit(scriptDir, ['rev-parse', '--show-toplevel']).trim();
  } catch {
    return path.resolve(scriptDir, '..', '..');
  }
}

/** Git-layer existence check: the SHA must be a commit object in this repository. */
export function commitExists({ repositoryRoot, sha }) {
  assertExactSha(sha);
  try {
    runGit(repositoryRoot, ['cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const out = { sha: null, app: null, target: null, repo: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--sha' && index + 1 < argv.length) out.sha = argv[(index += 1)];
    else if (arg.startsWith('--sha=')) out.sha = arg.slice('--sha='.length);
    else if (arg === '--app' && index + 1 < argv.length) out.app = argv[(index += 1)];
    else if (arg.startsWith('--app=')) out.app = arg.slice('--app='.length);
    else if (arg === '--target' && index + 1 < argv.length) out.target = argv[(index += 1)];
    else if (arg.startsWith('--target=')) out.target = arg.slice('--target='.length);
    else if (arg === '--repo' && index + 1 < argv.length) out.repo = argv[(index += 1)];
    else if (arg.startsWith('--repo=')) out.repo = arg.slice('--repo='.length);
  }
  return out;
}

const invokedAsMainScript =
  process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsMainScript) {
  const { sha, app, target, repo } = parseArgs(process.argv.slice(2));
  try {
    const request = buildProvisioningRequest({ sha, app, target });
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const repositoryRoot = repo ?? resolveRepositoryRoot(scriptDir);
    if (!commitExists({ repositoryRoot, sha: request.sha })) {
      fail(
        'UNKNOWN_COMMIT_SHA',
        'repository에 존재하지 않는 commit SHA이므로 provisioning을 거부합니다.',
      );
    }
    process.stdout.write(`${JSON.stringify(request)}\n`);
  } catch (error) {
    const code = error instanceof ProvisioningError ? error.code : 'PROVISIONING_FAILED';
    process.stderr.write(`[provision-exact-preview] ${code}: ${error.message}\n`);
    process.exit(1);
  }
}
