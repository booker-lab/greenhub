import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const apps = ['consumer', 'seller', 'driver'];

// COORD-DEPLOY-FANOUT-01: one shared dependency-aware predicate, per-app entry
// point. The old docs-only `git diff HEAD^` grep treated every non-docs change
// as relevant for every app (API/rules publications built all three previews)
// and misjudged merge/transport-freshness updates. The shared predicate diffs
// VERCEL_GIT_PREVIOUS_SHA..HEAD scoped to the app's workspace closure.
const ignoreCommandFor = (app) => `node ../../scripts/vercel/ignore-build.mjs --app ${app}`;

for (const app of apps) {
  const path = `apps/${app}/vercel.json`;
  const config = JSON.parse(readFileSync(path, 'utf8'));

  assert.equal(
    config.git?.deploymentEnabled?.main,
    false,
    `${path}: git.deploymentEnabled.main must remain false`,
  );
  assert.equal(
    config.ignoreCommand,
    ignoreCommandFor(app),
    `${path}: shared dependency-aware Vercel ignoreCommand must remain enabled`,
  );
}

const syncPreview = readFileSync('.github/workflows/sync-preview.yml', 'utf8');
assert.match(syncPreview, /paths-ignore:/, 'sync-preview.yml must keep a docs-only ignore gate');
assert.match(syncPreview, /['"]docs\/\*\*['"]/, 'sync-preview.yml must ignore docs/**');
assert.match(syncPreview, /['"]\*\*\/\*\.md['"]/, 'sync-preview.yml must ignore **/*.md');

assert.equal(
  existsSync('scripts/vercel/ignore-build.mjs'),
  true,
  'scripts/vercel/ignore-build.mjs (shared deployment predicate) must exist',
);
assert.equal(
  existsSync('scripts/vercel/ignore-build.spec.mjs'),
  true,
  'scripts/vercel/ignore-build.spec.mjs (predicate matrix proof) must exist',
);

const agents = readFileSync('AGENTS.md', 'utf8');
assert.match(
  agents,
  /`main`에는 문서-only 변경을 포함해 직접 commit\/push하지 않는다\./,
  'AGENTS.md must keep the no-direct-main rule',
);

console.log('Deployment safety guard: OK');
