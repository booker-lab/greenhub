/**
 * Deterministic verification for the shared Vercel deployment predicate
 * (COORD-DEPLOY-FANOUT-01 acceptance matrix).
 *
 * Run: node --test scripts/vercel/ignore-build.spec.mjs
 *
 * Layers:
 *  1. Workspace-graph truth: per-app source dirs resolved from the REAL repo
 *     (never hardcoded) — proves packages/ui + packages/shared attribution.
 *  2. Pure matrix: decideForChangedFiles over fixture path sets for all ten
 *     acceptance cases.
 *  3. Git integration: throwaway repos exercising VERCEL_GIT_PREVIOUS_SHA base
 *     semantics, including a publication-transport-style freshness merge where
 *     a naive `HEAD^` diff misjudges and this predicate does not.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  APPS,
  decideForChangedFiles,
  resolveAppSourceDirs,
} from './ignore-build.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./ignore-build.mjs', import.meta.url));
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..', '..');

function runNode(args, options = {}) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT_PATH, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    return { exitCode: 0, stdout };
  } catch (error) {
    return { exitCode: error.status ?? 1, stdout: String(error.stdout ?? '') };
  }
}

// ---------------------------------------------------------------------------
// 1. Workspace-graph truth (real repo, not fixtures)
// ---------------------------------------------------------------------------

const sourceDirsByApp = new Map();

for (const app of APPS) {
  test(`workspace graph resolves source dirs for ${app}`, () => {
    const { relevant, complete } = resolveAppSourceDirs({ repositoryRoot: REPO_ROOT, app });
    assert.equal(complete, true, 'dependency graph must resolve completely');
    assert.ok(relevant.includes(`apps/${app}/`), 'own app dir must be relevant');
    assert.ok(relevant.includes('packages/shared/'), '@greenhub/shared is a real workspace dep');
    assert.ok(relevant.includes('packages/ui/'), '@greenhub/ui is a real workspace dep');
    assert.ok(!relevant.some((dir) => dir.startsWith('apps/api/')), 'apps/api must not be a source dir');
    sourceDirsByApp.set(app, relevant);
  });
}

function decideAllApps(changedFiles) {
  const result = new Map();
  for (const app of APPS) {
    result.set(
      app,
      decideForChangedFiles({ app, changedFiles, appSourceDirs: sourceDirsByApp.get(app) }),
    );
  }
  return result;
}

function assertMatrix(name, changedFiles, expected) {
  test(`matrix: ${name}`, () => {
    const decisions = decideAllApps(changedFiles);
    for (const app of APPS) {
      assert.equal(
        decisions.get(app).build,
        expected[app],
        `${name}: ${app} must be ${expected[app] ? 'BUILD' : 'SKIP'} (reason: ${decisions.get(app).reason})`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// 2. Acceptance matrix (cases 1-10)
// ---------------------------------------------------------------------------

assertMatrix('1. apps/api only -> all SKIP', ['apps/api/src/orders/orders.service.ts'], {
  consumer: false,
  seller: false,
  driver: false,
});

assertMatrix('2. firestore.rules only -> all SKIP', ['firestore.rules'], {
  consumer: false,
  seller: false,
  driver: false,
});

assertMatrix('3. docs only -> all SKIP', ['docs/specs/api/orders.md', 'README.md', 'apps/api/README.md'], {
  consumer: false,
  seller: false,
  driver: false,
});

assertMatrix('4. apps/consumer only -> consumer BUILD', ['apps/consumer/src/app/page.tsx'], {
  consumer: true,
  seller: false,
  driver: false,
});

assertMatrix('5. apps/seller only -> seller BUILD', ['apps/seller/src/app/dashboard/page.tsx'], {
  consumer: false,
  seller: true,
  driver: false,
});

assertMatrix('6. apps/driver only -> driver BUILD', ['apps/driver/src/app/board/page.tsx'], {
  consumer: false,
  seller: false,
  driver: true,
});

test('7/8. shared package attribution follows the workspace graph, not guesses', () => {
  for (const changed of ['packages/ui/src/theme.ts', 'packages/shared/src/index.ts']) {
    const decisions = decideAllApps([changed]);
    for (const app of APPS) {
      const depends = sourceDirsByApp
        .get(app)
        .some((dir) => changed === dir.slice(0, -1) || changed.startsWith(dir));
      assert.equal(
        decisions.get(app).build,
        depends,
        `${changed}: ${app} BUILD must equal real graph dependence (${depends})`,
      );
    }
  }
  // In the current graph every frontend depends on both shared packages.
  const uiDecisions = decideAllApps(['packages/ui/src/theme.ts']);
  const sharedDecisions = decideAllApps(['packages/shared/src/index.ts']);
  for (const app of APPS) {
    assert.equal(uiDecisions.get(app).build, true, `packages/ui change must BUILD ${app}`);
    assert.equal(sharedDecisions.get(app).build, true, `packages/shared change must BUILD ${app}`);
  }
});

assertMatrix('9. lockfile / shared build config -> all BUILD', ['pnpm-lock.yaml'], {
  consumer: true,
  seller: true,
  driver: true,
});

assertMatrix('9b. tsconfig base -> all BUILD', ['tsconfig.base.json'], {
  consumer: true,
  seller: true,
  driver: true,
});

assertMatrix(
  '10. api change never forces a frontend build, mixed diffs still build the affected app',
  ['apps/api/src/notifications/notifications.service.ts', 'apps/seller/src/app/orders/page.tsx'],
  { consumer: false, seller: true, driver: false },
);

assertMatrix('unknown paths fail OPEN', ['brand-new-service/main.go'], {
  consumer: true,
  seller: true,
  driver: true,
});

assertMatrix('empty delta -> all SKIP', [], {
  consumer: false,
  seller: false,
  driver: false,
});

assertMatrix('backend/ops-only bundle -> all SKIP', [
  'apps/api/src/auth/auth.service.ts',
  'apps/e2e/specs/checkout.spec.ts',
  'tests/firestore/firestore-rules.test.mjs',
  '.github/workflows/e2e.yml',
  'storage.rules',
  'Dockerfile',
  'scripts/seed.mjs',
], {
  consumer: false,
  seller: false,
  driver: false,
});

assertMatrix('predicate change rebuilds (self-exercise)', ['scripts/vercel/ignore-build.mjs'], {
  consumer: true,
  seller: true,
  driver: true,
});

// ---------------------------------------------------------------------------
// 3. Git integration with throwaway repos
// ---------------------------------------------------------------------------

function initFixtureRepo() {
  const dir = mkdtempRepoDir();
  const git = (args, options = {}) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'test']);
  writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n  - 'packages/*'\n");
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', private: true }));
  for (const app of APPS) {
    writeAppPackage(dir, app);
    writeFile(dir, `apps/${app}/src/page.tsx`, `// ${app}\n`);
  }
  for (const pkg of ['shared', 'ui']) {
    writeFile(dir, `packages/${pkg}/package.json`, JSON.stringify({ name: `@greenhub/${pkg}`, private: true }));
    writeFile(dir, `packages/${pkg}/src/index.ts`, `// ${pkg}\n`);
  }
  writeFile(dir, 'apps/api/src/main.ts', '// api\n');
  git(['add', '-A']);
  git(['commit', '-m', 'initial']);
  return { dir, git };
}

function mkdtempRepoDir() {
  return mkdtempSync(path.join(tmpdir(), 'ignore-build-'));
}

function writeFile(repoDir, relativePath, content) {
  const absolute = path.join(repoDir, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function writeAppPackage(repoDir, app) {
  writeFile(
    repoDir,
    `apps/${app}/package.json`,
    JSON.stringify({
      name: app,
      private: true,
      dependencies: { '@greenhub/shared': 'workspace:*', '@greenhub/ui': 'workspace:*' },
    }),
  );
}

function commitAll(git, message) {
  git(['add', '-A']);
  git(['commit', '-m', message]);
  return git(['rev-parse', 'HEAD']).trim();
}

test('integration: api-only delta since PREV_SHA skips all apps', () => {
  const { dir, git } = initFixtureRepo();
  const base = git(['rev-parse', 'HEAD']).trim();
  writeFile(dir, 'apps/api/src/orders.ts', '// api change\n');
  commitAll(git, 'api only');
  writeFile(dir, 'firestore.rules', '// rules\n');
  commitAll(git, 'rules only');
  for (const app of APPS) {
    const result = runNode(['--app', app, '--repo', dir], {
      env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: base },
    });
    assert.equal(result.exitCode, 0, `${app} must SKIP api+rules delta (output: ${result.stdout})`);
  }
});

test('integration: per-app attribution from PREV_SHA base', () => {
  const { dir, git } = initFixtureRepo();
  const base = git(['rev-parse', 'HEAD']).trim();
  writeFile(dir, 'apps/seller/src/page.tsx', '// seller change\n');
  commitAll(git, 'seller only');
  const expected = { consumer: 0, seller: 1, driver: 0 };
  for (const app of APPS) {
    const result = runNode(['--app', app, '--repo', dir], {
      env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: base },
    });
    assert.equal(result.exitCode, expected[app], `${app} exit must be ${expected[app]} (${result.stdout})`);
  }
});

test('integration: freshness merge does not misjudge (HEAD^ would BUILD, predicate SKIPs)', () => {
  const { dir, git } = initFixtureRepo();
  // Last successful frontend build happened at the initial commit.
  const lastSuccessful = git(['rev-parse', 'HEAD']).trim();
  // Candidate work: api-only change on a publication branch.
  git(['checkout', '-b', 'publication']);
  writeFile(dir, 'apps/api/src/lease.ts', '// api candidate\n');
  commitAll(git, 'api candidate');
  // Unrelated main movement that is also frontend-irrelevant.
  git(['checkout', 'main']);
  writeFile(dir, 'apps/api/src/other.ts', '// unrelated api movement\n');
  commitAll(git, 'unrelated movement');
  // Transport freshness update: merge main into the publication branch.
  git(['checkout', 'publication']);
  git(['merge', 'main', '--no-edit', '-m', 'transport freshness update']);
  const head = git(['rev-parse', 'HEAD']).trim();
  assert.ok(head);

  // A naive HEAD^ predicate sees the sync-merge diff (unrelated api files,
  // all non-docs) and votes BUILD for every frontend.
  const naiveDiff = git(['diff', '--name-only', 'HEAD^1', 'HEAD']).trim();
  assert.ok(naiveDiff.length > 0, 'freshness merge must have a non-empty first-parent diff');
  const naiveWouldBuild = naiveDiff.split('\n').some((line) => !/(\.md$|^docs\/)/.test(line.trim()));
  assert.equal(naiveWouldBuild, true, 'naive HEAD^ predicate would BUILD on the freshness merge');

  // The shared predicate diffs last-successful..HEAD: no frontend-relevant
  // path moved, so every frontend skips.
  for (const app of APPS) {
    const result = runNode(['--app', app, '--repo', dir], {
      env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: lastSuccessful },
    });
    assert.equal(result.exitCode, 0, `${app} must SKIP after freshness update (${result.stdout})`);
  }
});

test('integration: missing base fails OPEN (BUILD)', () => {
  const { dir } = initFixtureRepo();
  const env = { ...process.env };
  delete env.VERCEL_GIT_PREVIOUS_SHA;
  const result = runNode(['--app', 'consumer', '--repo', dir], { env });
  assert.equal(result.exitCode, 1, 'without a trustworthy base the predicate must BUILD');
});

test('cli: unknown app fails OPEN (BUILD)', () => {
  const result = runNode(['--app', 'nope', '--repo', REPO_ROOT]);
  assert.equal(result.exitCode, 1);
});
