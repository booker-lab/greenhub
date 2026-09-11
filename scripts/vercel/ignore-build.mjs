/**
 * Shared Vercel "Ignored Build Step" predicate for consumer / seller / driver.
 *
 * One semantic contract, three call sites:
 *   apps/consumer/vercel.json -> node ../../scripts/vercel/ignore-build.mjs --app consumer
 *   apps/seller/vercel.json   -> node ../../scripts/vercel/ignore-build.mjs --app seller
 *   apps/driver/vercel.json   -> node ../../scripts/vercel/ignore-build.mjs --app driver
 *
 * Exit codes follow the Vercel Ignored Build Step contract:
 *   0 = SKIP (no app-relevant change since the base -> deployment CANCELED)
 *   1 = BUILD (app-relevant change -> build continues)
 *
 * Design notes (COORD-DEPLOY-FANOUT-01):
 * - The previous per-app `git diff HEAD^ HEAD | grep -qvE docs/md` predicate
 *   treated every non-docs change as relevant for every app, so API-only and
 *   Firestore-rules-only publications built all three frontends.
 * - The base is NEVER a bare `HEAD^`. Vercel exposes VERCEL_GIT_PREVIOUS_SHA
 *   (last successful deployment SHA for this project+branch) exactly when an
 *   Ignored Build Step is configured. Diffing base..HEAD measures the
 *   effective delta since the last successful build, so merge commits,
 *   publication-transport freshness updates, and preview-sync merges cannot
 *   misattribute unrelated movement to this app. Without a trustworthy base
 *   the predicate fails OPEN (BUILD) instead of guessing.
 * - Relevance = own app dir + transitive `workspace:` dependency closure
 *   (the same signal Vercel's native unaffected-project skipping uses) +
 *   explicit global frontend build inputs (lockfile, workspace definition,
 *   shared tsconfig base, font prebuild, this predicate itself, .vercelignore).
 * - A diff that touches ONLY backend/ops/test/docs paths is SKIP even when it
 *   also touches another frontend app: relevance is evaluated per app over the
 *   whole changed-file set, never as "any api file -> skip everything".
 * - Unknown paths fail OPEN (BUILD): a new top-level config or package must
 *   never be silently skipped.
 *
 * Runtime needs: `node` + `git` only. No dependencies, no install step.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APPS = Object.freeze(['consumer', 'seller', 'driver']);

export const EXIT_SKIP = 0;
export const EXIT_BUILD = 1;

const SHA_PATTERN = /^[0-9a-f]{40}$/i;

// Files read by `pnpm install` or by `next build` (via @greenhub/shared or the
// font prebuild) of every frontend app. A change here must rebuild all three.
export const GLOBAL_FRONTEND_INPUTS = Object.freeze([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  '.vercelignore',
  'scripts/copy-fonts.cjs',
  // Trailing '/' entries are directory prefixes.
  'scripts/vercel/',
]);

// The predicate itself: a change to the deployment selector must rebuild so
// the new selector is exercised against a real build at least once.
const PREDICATE_DIR_PREFIX = 'scripts/vercel/';

// Known backend / ops / test-only paths. None of them is read by a frontend
// `next build`, so on their own they never justify a frontend deployment.
const BACKEND_ONLY_DIR_PREFIXES = Object.freeze([
  'apps/api/',
  'apps/e2e/',
  'tests/',
  'test-results/',
  '.github/',
  '.artifacts/',
  'backups/',
  '.codex/',
]);

const BACKEND_ONLY_FILES = Object.freeze([
  'firestore.rules',
  'storage.rules',
  'firestore.indexes.json',
  'firebase.json',
  'cors.json',
  'Dockerfile',
  'nixpacks.toml',
  'Justfile',
  'dev.bat',
  'dev-local.bat',
  'biome.json',
  '.gitignore',
  '.trufflehog.yml',
  'AGENTS.md',
  'CLAUDE.md',
]);

function toPosixPath(value) {
  return String(value).replace(/\\/g, '/');
}

function isDocsOnlyPath(posixPath) {
  return posixPath === 'docs' || posixPath.startsWith('docs/') || posixPath.endsWith('.md');
}

function isPredicatePath(posixPath) {
  return posixPath === 'scripts/vercel' || posixPath.startsWith(PREDICATE_DIR_PREFIX);
}

function isBackendOnlyPath(posixPath) {
  if (isDocsOnlyPath(posixPath)) return true;
  if (BACKEND_ONLY_FILES.includes(posixPath)) return true;
  if (posixPath.startsWith('scripts/') && !isPredicatePath(posixPath)) return true;
  return BACKEND_ONLY_DIR_PREFIXES.some((prefix) => posixPath.startsWith(prefix));
}

/**
 * A path inside another workspace member scope (`apps/<member>/...` or
 * `packages/<member>/...`) that is NOT part of this app's source closure.
 * Sibling frontends, the API, e2e, and undepended packages are never built
 * into this app's artifact, so their files are known-irrelevant. (A newly
 * added member is still safe: registering or depending on it always touches
 * a Tier-1 path — root package.json, pnpm-workspace.yaml, or the depending
 * app's own package.json.)
 */
function isOtherWorkspaceScope(posixPath) {
  return /^(apps|packages)\/[^/]+\//.test(posixPath);
}

/**
 * Read the workspace member directories from pnpm-workspace.yaml globs.
 * Only `*` globs (`apps/*`, `packages/*`) are supported; anything else is
 * ignored so an unreadable workspace file fails OPEN at the call site.
 */
export function readWorkspaceGlobs(repositoryRoot) {
  try {
    const raw = readFileSync(path.join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8');
    const globs = [];
    let inPackages = false;
    for (const line of raw.split('\n')) {
      if (/^\s*packages\s*:\s*$/.test(line)) {
        inPackages = true;
        continue;
      }
      if (inPackages) {
        const match = line.match(/^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/);
        if (match) {
          globs.push(match[1]);
        } else if (!/^\s*(#|$)/.test(line)) {
          inPackages = false;
        }
      }
    }
    return globs;
  } catch {
    return [];
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/** Map workspace package name -> repo-relative posix dir (e.g. packages/shared). */
export function readWorkspacePackageDirs(repositoryRoot) {
  const byName = new Map();
  for (const glob of readWorkspaceGlobs(repositoryRoot)) {
    const prefix = glob.endsWith('/*') ? glob.slice(0, -2) : null;
    if (prefix == null) continue;
    let entries = [];
    try {
      entries = readdirSync(path.join(repositoryRoot, prefix), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const manifest = readJsonFile(path.join(repositoryRoot, prefix, entry, 'package.json'));
      if (manifest != null && typeof manifest.name === 'string' && manifest.name.length > 0) {
        byName.set(manifest.name, `${prefix}/${entry}`);
      }
    }
  }
  return byName;
}

function readAppManifest(repositoryRoot, app) {
  return readJsonFile(path.join(repositoryRoot, 'apps', app, 'package.json'));
}

/**
 * Transitive closure of repo-relative workspace dirs the app builds from:
 * its own dir plus every `workspace:` dependency (dependencies,
 * devDependencies, peerDependencies), recursed.
 */
export function resolveAppSourceDirs({ repositoryRoot, app, packageDirsByName = null }) {
  const byName = packageDirsByName ?? readWorkspacePackageDirs(repositoryRoot);
  const appDir = `apps/${app}`;
  const relevant = new Set([`${appDir}/`]);
  const queue = [];
  const manifest = readAppManifest(repositoryRoot, app);
  if (manifest == null) return { relevant: [...relevant], complete: false };
  const directDeps = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
    ...(manifest.peerDependencies ?? {}),
  };
  for (const [name, range] of Object.entries(directDeps)) {
    if (typeof range === 'string' && range.startsWith('workspace:') && byName.has(name)) {
      queue.push(name);
    }
  }
  const visited = new Set();
  let complete = true;
  while (queue.length > 0) {
    const name = queue.pop();
    if (visited.has(name)) continue;
    visited.add(name);
    const dir = byName.get(name);
    if (dir == null) {
      complete = false;
      continue;
    }
    relevant.add(`${dir}/`);
    const depManifest = readJsonFile(path.join(repositoryRoot, dir, 'package.json'));
    if (depManifest == null) {
      complete = false;
      continue;
    }
    const nested = {
      ...(depManifest.dependencies ?? {}),
      ...(depManifest.devDependencies ?? {}),
      ...(depManifest.peerDependencies ?? {}),
    };
    for (const [nestedName, nestedRange] of Object.entries(nested)) {
      if (typeof nestedRange === 'string' && nestedRange.startsWith('workspace:')) {
        if (byName.has(nestedName)) queue.push(nestedName);
        else complete = false;
      }
    }
  }
  return { relevant: [...relevant].sort(), complete };
}

/**
 * Pure per-app decision over a changed-file list (repo-relative paths).
 * Returns { build, matched, reason }. Unknown paths fail OPEN (build).
 */
export function decideForChangedFiles({ app, changedFiles, appSourceDirs }) {
  if (!APPS.includes(app)) {
    throw new Error(`unknown app: ${JSON.stringify(app)} (expected one of ${APPS.join(', ')})`);
  }
  const files = [...new Set(changedFiles.map(toPosixPath))].sort();
  if (files.length === 0) {
    return { build: false, matched: [], reason: 'empty effective delta since base: SKIP' };
  }
  const relevantPrefixes = [...appSourceDirs, ...GLOBAL_FRONTEND_INPUTS];
  const matched = files.filter((file) =>
    relevantPrefixes.some((prefix) =>
      prefix.endsWith('/') ? file === prefix.slice(0, -1) || file.startsWith(prefix) : file === prefix,
    ),
  );
  if (matched.length > 0) {
    return {
      build: true,
      matched,
      reason: `app-relevant change for ${app}: ${matched.join(', ')}`,
    };
  }
  const unknown = files.filter(
    (file) => !isBackendOnlyPath(file) && !isPredicatePath(file) && !isOtherWorkspaceScope(file),
  );
  if (unknown.length > 0) {
    return {
      build: true,
      matched: unknown,
      reason: `unclassified path change (fail OPEN) for ${app}: ${unknown.join(', ')}`,
    };
  }
  return {
    build: false,
    matched: [],
    reason: `only backend/ops/test/docs paths changed, none relevant to ${app}: SKIP`,
  };
}

function runGit(repositoryRoot, args) {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function resolveRepositoryRoot() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  try {
    return runGit(scriptDir, ['rev-parse', '--show-toplevel']).trim().replace(/\\/g, '/');
  } catch {
    // Fall back to the monorepo layout scripts/vercel -> repo root.
    return path.resolve(scriptDir, '..', '..');
  }
}

function objectExists(repositoryRoot, sha) {
  try {
    runGit(repositoryRoot, ['cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function tryFetchSha(repositoryRoot, sha) {
  try {
    execFileSync('git', ['fetch', 'origin', sha, '--depth=100'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    return objectExists(repositoryRoot, sha);
  } catch {
    return false;
  }
}

/** Resolve the diff base. Never defaults to a bare HEAD^. */
export function resolveBaseSha({ repositoryRoot, env = process.env }) {
  const previous = String(env.VERCEL_GIT_PREVIOUS_SHA ?? '').trim();
  if (SHA_PATTERN.test(previous)) {
    if (objectExists(repositoryRoot, previous)) {
      return { sha: previous, source: 'VERCEL_GIT_PREVIOUS_SHA' };
    }
    if (tryFetchSha(repositoryRoot, previous)) {
      return { sha: previous, source: 'VERCEL_GIT_PREVIOUS_SHA (fetched)' };
    }
    return {
      sha: null,
      source: 'none',
      reason:
        'VERCEL_GIT_PREVIOUS_SHA is set but unavailable locally and could not be fetched; failing OPEN (BUILD).',
    };
  }
  return {
    sha: null,
    source: 'none',
    reason:
      'VERCEL_GIT_PREVIOUS_SHA is not set (first deployment or local run); failing OPEN (BUILD).',
  };
}

export function listChangedFiles({ repositoryRoot, baseSha, headSha = 'HEAD' }) {
  const stdout = runGit(repositoryRoot, ['diff', '--name-only', '--no-renames', '-z', baseSha, headSha, '--']);
  return stdout.split('\0').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function parseArgs(argv) {
  const appFlag = argv.indexOf('--app');
  const app = appFlag >= 0 && appFlag + 1 < argv.length ? argv[appFlag + 1] : null;
  const repoFlag = argv.indexOf('--repo');
  const repo = repoFlag >= 0 && repoFlag + 1 < argv.length ? repoFlag + 1 : null;
  return { app, repoRootOverride: repo != null ? argv[repo] : null };
}

const invokedAsMainScript =
  process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsMainScript) {
  const { app, repoRootOverride } = parseArgs(process.argv.slice(2));
  if (app == null || !APPS.includes(app)) {
    console.error(`usage: node scripts/vercel/ignore-build.mjs --app <${APPS.join('|')}> [--repo <dir>]`);
    process.exit(EXIT_BUILD);
  }
  try {
    const repositoryRoot = repoRootOverride ?? resolveRepositoryRoot();
    const base = resolveBaseSha({ repositoryRoot });
    if (base.sha == null) {
      console.log(`[vercel-ignore:${app}] BUILD: ${base.reason}`);
      process.exit(EXIT_BUILD);
    }
    const changedFiles = listChangedFiles({ repositoryRoot, baseSha: base.sha });
    const { relevant, complete } = resolveAppSourceDirs({ repositoryRoot, app });
    if (!complete) {
      console.log(`[vercel-ignore:${app}] BUILD: workspace dependency graph incomplete; failing OPEN.`);
      process.exit(EXIT_BUILD);
    }
    const decision = decideForChangedFiles({ app, changedFiles, appSourceDirs: relevant });
    console.log(
      `[vercel-ignore:${app}] ${decision.build ? 'BUILD' : 'SKIP'}: ${decision.reason} (base=${base.source} ${base.sha.slice(0, 8)}, files=${changedFiles.length})`,
    );
    process.exit(decision.build ? EXIT_BUILD : EXIT_SKIP);
  } catch (error) {
    console.error(`[vercel-ignore:${app}] BUILD: predicate error, failing OPEN: ${error.message}`);
    process.exit(EXIT_BUILD);
  }
}
