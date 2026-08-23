import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const apps = ['consumer', 'seller', 'driver'];

for (const app of apps) {
  const path = `apps/${app}/vercel.json`;
  const config = JSON.parse(readFileSync(path, 'utf8'));

  assert.equal(
    config.git?.deploymentEnabled?.main,
    false,
    `${path}: git.deploymentEnabled.main must remain false`,
  );
}

const syncPreview = readFileSync('.github/workflows/sync-preview.yml', 'utf8');
assert.match(syncPreview, /paths-ignore:/, 'sync-preview.yml must keep a docs-only ignore gate');
assert.match(syncPreview, /['"]docs\/\*\*['"]/, 'sync-preview.yml must ignore docs/**');
assert.match(syncPreview, /['"]\*\*\/\*\.md['"]/, 'sync-preview.yml must ignore **/*.md');

const agents = readFileSync('AGENTS.md', 'utf8');
assert.match(
  agents,
  /`main`에는 문서-only 변경을 포함해 직접 commit\/push하지 않는다\./,
  'AGENTS.md must keep the no-direct-main rule',
);

console.log('Deployment safety guard: OK');
