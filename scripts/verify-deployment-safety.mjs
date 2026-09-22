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

const authorityDoc = 'docs/specs/ops/development-authority.md';
assert.equal(
  existsSync(authorityDoc),
  true,
  'docs/specs/ops/development-authority.md (detailed development rules owner) must exist',
);
assert.equal(
  existsSync('docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md'),
  false,
  'the retired control-tower coordination policy must not be reintroduced',
);
assert.equal(
  existsSync('scripts/coordination'),
  false,
  'the retired coordination control plane must not be reintroduced',
);

const agents = readFileSync('AGENTS.md', 'utf8');
assert.match(
  agents,
  /docs\/specs\/ops\/development-authority\.md/,
  'AGENTS.md must delegate detailed development rules to the development authority',
);
assert.match(
  agents,
  /배포.*명시적 승인 없이 변경하지 않는다\./,
  'AGENTS.md must keep deployment inside the explicit approval boundary',
);

const authority = readFileSync(authorityDoc, 'utf8');
assert.match(
  authority,
  /normal non-force publication/,
  'development authority must keep non-force publication safety',
);
assert.match(
  authority,
  /canonical remote를 직접 read-back한다\./,
  'development authority must require canonical remote read-back after publication',
);

console.log('Deployment safety guard: OK');
