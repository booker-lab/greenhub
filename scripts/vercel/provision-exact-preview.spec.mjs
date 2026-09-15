/**
 * Deterministic verification for exact-preview provisioning
 * (PILOT-AUTH-EXACT-REF-PREVIEW-PROVISIONING-CAPABILITY-42A
 * + PILOT-AUTH-DRIVER-EXACT-PREVIEW-CAPABILITY-43A).
 *
 * Run: node --test scripts/vercel/provision-exact-preview.spec.mjs
 *
 * Covers the task acceptance matrix without any live deployment:
 * - invalid SHA reject / unknown SHA reject (throwaway git repo)
 * - invalid app reject / production target impossible
 * - requested SHA preserved verbatim in request metadata + ref
 * - Consumer/Seller/Driver project mapping accuracy (`both` = consumer + seller)
 * - normal ignore-build predicate unchanged
 * - provisioning bypass scoped to preview-exact/* (no leak to preview/main)
 * - mismatched githubCommitSha FAILs, non-READY never passes
 * - Driver single-scope exact binding via canonical PREVIEW_APPS mapping
 * - workflow contract: driver in input/preflight/ref validation
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  decideForChangedFiles,
  resolveAppSourceDirs,
  resolveExactPreviewBypassFromEnv,
  shouldBypassIgnoreForExactPreview,
} from './ignore-build.mjs';
import {
  APP_ALLOWLIST,
  assertNonProductionTarget,
  buildProvisioningRef,
  buildProvisioningRequest,
  commitExists,
  parseProvisioningRef,
  REF_PATTERN,
  REPO,
  resolveProvisioningApps,
  SCOPE_TO_APPS,
} from './provision-exact-preview.mjs';
import { inspectAppDeployment, PREVIEW_APPS } from '../wait-preview-deploy.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

const KNOWN_SHA = '58e4c0128cf51cb96aea2529d1428f28172a7822';
const OTHER_SHA = 'b'.repeat(40);
const UNKNOWN_WELLFORMED_SHA = 'c'.repeat(40);

// ---------------------------------------------------------------------------
// 1. SHA validation
// ---------------------------------------------------------------------------

test('invalid SHA rejected (malformed)', () => {
  for (const bad of ['', 'abc', 'z'.repeat(40), 'A'.repeat(40), `${KNOWN_SHA.slice(0, 39)}`, `${KNOWN_SHA}x`, ` ${KNOWN_SHA} `, '58e4c0128cf51cb96aea2529d1428f28172a782', null, undefined, 42]) {
    assert.throws(() => buildProvisioningRequest({ sha: bad, app: 'consumer' }), (error) => error?.code === 'EXACT_SHA_MALFORMED');
  }
});

test('uppercase SHA rejected (no silent normalization)', () => {
  assert.throws(
    () => buildProvisioningRequest({ sha: KNOWN_SHA.toUpperCase(), app: 'consumer' }),
    (error) => error?.code === 'EXACT_SHA_MALFORMED',
  );
});

function initTempRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'exact-preview-'));
  const git = (args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'test']);
  mkdirSync(path.join(dir, 'apps'), { recursive: true });
  writeFileSync(path.join(dir, 'apps', 'note.txt'), 'hello\n');
  git(['add', '-A']);
  git(['commit', '-m', 'initial']);
  return { dir, head: git(['rev-parse', 'HEAD']).trim() };
}

test('unknown well-formed SHA rejected at git layer; known commit passes', () => {
  const { dir, head } = initTempRepo();
  assert.equal(commitExists({ repositoryRoot: dir, sha: head }), true);
  assert.equal(commitExists({ repositoryRoot: dir, sha: UNKNOWN_WELLFORMED_SHA }), false);
  assert.throws(
    () => commitExists({ repositoryRoot: dir, sha: 'short' }),
    (error) => error?.code === 'EXACT_SHA_MALFORMED',
  );
});

// ---------------------------------------------------------------------------
// 2. App allowlist + production impossibility
// ---------------------------------------------------------------------------

test('invalid app rejected (production/main/preview/empty)', () => {
  for (const bad of ['production', 'main', 'preview', 'consumer, seller', '', '  ', 'consumers', 'sellers', 'drivers', null, undefined, 'both,consumer']) {
    assert.throws(() => buildProvisioningRequest({ sha: KNOWN_SHA, app: bad }), (error) => error?.code === 'UNKNOWN_PROVISIONING_APP', `app ${JSON.stringify(bad)} must reject`);
  }
  // Case-insensitive trim is accepted but normalized to lowercase scope.
  assert.equal(buildProvisioningRequest({ sha: KNOWN_SHA, app: 'Consumer' }).app, 'consumer');
  assert.equal(buildProvisioningRequest({ sha: KNOWN_SHA, app: ' BOTH ' }).app, 'both');
  assert.equal(buildProvisioningRequest({ sha: KNOWN_SHA, app: 'Driver' }).app, 'driver');
});

test('allowlist is exactly consumer|seller|driver|both', () => {
  assert.deepEqual([...APP_ALLOWLIST], ['consumer', 'seller', 'driver', 'both']);
  assert.deepEqual(resolveProvisioningApps('consumer'), ['consumer']);
  assert.deepEqual(resolveProvisioningApps('seller'), ['seller']);
  assert.deepEqual(resolveProvisioningApps('driver'), ['driver']);
  assert.deepEqual(resolveProvisioningApps('both'), ['consumer', 'seller']);
});

test('driver scope is independent; both stays consumer + seller', () => {
  assert.deepEqual(resolveProvisioningApps('driver'), ['driver']);
  assert.deepEqual(resolveProvisioningApps('both'), ['consumer', 'seller']);
  const driverRequest = buildProvisioningRequest({ sha: KNOWN_SHA, app: 'driver' });
  assert.equal(driverRequest.ref, `preview-exact/driver/${KNOWN_SHA}`);
  assert.deepEqual([...driverRequest.apps], ['driver']);
  assert.equal(driverRequest.sha, KNOWN_SHA);
  assert.equal(driverRequest.requestedSha, KNOWN_SHA);
  assert.equal(driverRequest.target, null);
  assert.equal(driverRequest.production, false);
});

test('production target impossible', () => {
  for (const target of ['production', 'PRODUCTION', 'staging', 'custom-env']) {
    assert.throws(() => buildProvisioningRequest({ sha: KNOWN_SHA, app: 'consumer', target }), (error) => error?.code === 'PRODUCTION_TARGET_REFUSED');
    assert.throws(() => buildProvisioningRequest({ sha: KNOWN_SHA, app: 'driver', target }), (error) => error?.code === 'PRODUCTION_TARGET_REFUSED');
    assert.throws(() => assertNonProductionTarget(target), (error) => error?.code === 'PRODUCTION_TARGET_REFUSED');
  }
  for (const target of [null, undefined, 'preview', 'PREVIEW', '']) {
    const request = buildProvisioningRequest({ sha: KNOWN_SHA, app: 'both', target });
    assert.equal(request.target, null);
    assert.equal(request.production, false);
  }
});

// ---------------------------------------------------------------------------
// 3. SHA preservation in metadata + ref
// ---------------------------------------------------------------------------

test('requested SHA preserved verbatim in request metadata and ref', () => {
  for (const app of APP_ALLOWLIST) {
    const request = buildProvisioningRequest({ sha: KNOWN_SHA, app });
    assert.equal(request.sha, KNOWN_SHA);
    assert.equal(request.requestedSha, KNOWN_SHA);
    assert.equal(request.repository, REPO);
    assert.equal(request.target, null);
    assert.equal(request.production, false);
    const ref = buildProvisioningRef({ sha: KNOWN_SHA, app });
    assert.equal(ref, request.ref);
    assert.match(ref, REF_PATTERN);
    assert.ok(ref.endsWith(`/${KNOWN_SHA}`));
    const parsed = parseProvisioningRef(ref);
    assert.equal(parsed.sha, KNOWN_SHA);
    assert.equal(parsed.scope, app);
  }
});

test('driver exact ref creation and parse preserve SHA verbatim', () => {
  const ref = buildProvisioningRef({ sha: KNOWN_SHA, app: 'driver' });
  assert.equal(ref, `preview-exact/driver/${KNOWN_SHA}`);
  assert.match(ref, REF_PATTERN);
  const parsed = parseProvisioningRef(ref);
  assert.equal(parsed.scope, 'driver');
  assert.equal(parsed.sha, KNOWN_SHA);
  assert.equal(parsed.ref, ref);
});

test('non-provisioning refs rejected by parser', () => {
  for (const bad of ['preview', 'main', 'preview-exact/consumer/short', `preview-exact/both/${OTHER_SHA.slice(0, 39)}x`, `preview-exact//${KNOWN_SHA}`, `preview-exact/driver/short`, `preview-exact/driver/${OTHER_SHA.slice(0, 39)}X`, 'tmp/foo-publication']) {
    assert.throws(() => parseProvisioningRef(bad), (error) => error?.code === 'NOT_A_PROVISIONING_REF');
  }
});

// ---------------------------------------------------------------------------
// 4. Consumer/Seller project mapping accuracy
// ---------------------------------------------------------------------------

test('scope-to-app mapping covers consumer/seller/driver; both unchanged', () => {
  assert.deepEqual([...SCOPE_TO_APPS.consumer], ['consumer']);
  assert.deepEqual([...SCOPE_TO_APPS.seller], ['seller']);
  assert.deepEqual([...SCOPE_TO_APPS.driver], ['driver']);
  assert.deepEqual([...SCOPE_TO_APPS.both], ['consumer', 'seller']);
});

test('canonical Vercel project mapping for consumer/seller/driver intact', () => {
  const byApp = new Map(PREVIEW_APPS.map((entry) => [entry.app, entry]));
  assert.equal(byApp.get('consumer').project, 'greenhubconsumer');
  assert.equal(byApp.get('consumer').projectId, 'prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w');
  assert.equal(byApp.get('seller').project, 'greenhub-seller');
  assert.equal(byApp.get('seller').projectId, 'prj_OPOveVw4QADTbTE7mt32mo14H5dv');
  assert.equal(byApp.get('driver').project, 'greenhub-driver');
  assert.equal(byApp.get('driver').projectId, 'prj_e3OU9YIAGTkDcrWQdpTvkbHnJ4XW');
});

// ---------------------------------------------------------------------------
// 5. Normal ignore-build predicate unchanged
// ---------------------------------------------------------------------------

const sourceDirsByApp = new Map();
for (const app of ['consumer', 'seller']) {
  const { relevant, complete } = resolveAppSourceDirs({ repositoryRoot: REPO_ROOT, app });
  assert.equal(complete, true);
  sourceDirsByApp.set(app, relevant);
}

test('normal predicate: empty delta SKIPs (no bypass via empty env)', () => {
  for (const app of ['consumer', 'seller']) {
    const decision = decideForChangedFiles({ app, changedFiles: [], appSourceDirs: sourceDirsByApp.get(app) });
    assert.equal(decision.build, false);
    const bypass = resolveExactPreviewBypassFromEnv({ app, env: {} });
    assert.equal(bypass.bypass, false);
  }
});

test('normal predicate: api-only change SKIPs every app', () => {
  for (const app of ['consumer', 'seller']) {
    const decision = decideForChangedFiles({
      app,
      changedFiles: ['apps/api/src/orders/orders.service.ts'],
      appSourceDirs: sourceDirsByApp.get(app),
    });
    assert.equal(decision.build, false);
  }
});

test('normal predicate: per-app attribution preserved', () => {
  const consumer = decideForChangedFiles({
    app: 'consumer',
    changedFiles: ['apps/consumer/src/app/page.tsx'],
    appSourceDirs: sourceDirsByApp.get('consumer'),
  });
  const sellerSeesConsumer = decideForChangedFiles({
    app: 'seller',
    changedFiles: ['apps/consumer/src/app/page.tsx'],
    appSourceDirs: sourceDirsByApp.get('seller'),
  });
  assert.equal(consumer.build, true);
  assert.equal(sellerSeesConsumer.build, false);
});

// ---------------------------------------------------------------------------
// 6. Provisioning bypass scoped (no leak to normal Git integration)
// ---------------------------------------------------------------------------

test('provisioning bypass: exact ref builds only the covered app', () => {
  const sha = KNOWN_SHA;
  const consumerRef = `preview-exact/consumer/${sha}`;
  assert.equal(shouldBypassIgnoreForExactPreview({ app: 'consumer', ref: consumerRef, sha }).bypass, true);
  assert.equal(shouldBypassIgnoreForExactPreview({ app: 'seller', ref: consumerRef, sha }).bypass, false);
  assert.equal(shouldBypassIgnoreForExactPreview({ app: 'driver', ref: consumerRef, sha }).bypass, false);

  const bothRef = `preview-exact/both/${sha}`;
  assert.equal(shouldBypassIgnoreForExactPreview({ app: 'consumer', ref: bothRef, sha }).bypass, true);
  assert.equal(shouldBypassIgnoreForExactPreview({ app: 'seller', ref: bothRef, sha }).bypass, true);
  assert.equal(shouldBypassIgnoreForExactPreview({ app: 'driver', ref: bothRef, sha }).bypass, false);

  const driverRef = `preview-exact/driver/${sha}`;
  assert.equal(shouldBypassIgnoreForExactPreview({ app: 'driver', ref: driverRef, sha }).bypass, true);
  assert.equal(shouldBypassIgnoreForExactPreview({ app: 'consumer', ref: driverRef, sha }).bypass, false);
  assert.equal(shouldBypassIgnoreForExactPreview({ app: 'seller', ref: driverRef, sha }).bypass, false);
});

test('provisioning bypass: driver cross-scope refs never bypass', () => {
  const sha = KNOWN_SHA;
  // Driver + consumer/seller/both refs = false.
  for (const ref of [`preview-exact/consumer/${sha}`, `preview-exact/seller/${sha}`, `preview-exact/both/${sha}`]) {
    assert.equal(shouldBypassIgnoreForExactPreview({ app: 'driver', ref, sha }).bypass, false, `${ref} must not bypass driver`);
  }
  // Consumer/Seller + driver ref = false.
  for (const app of ['consumer', 'seller']) {
    assert.equal(shouldBypassIgnoreForExactPreview({ app, ref: `preview-exact/driver/${sha}`, sha }).bypass, false, `driver ref must not bypass ${app}`);
  }
  // Driver + normal preview/main/tmp/production-environment = false.
  for (const ref of ['preview', 'main', 'tmp/anything-publication', 'feature/branch']) {
    assert.equal(shouldBypassIgnoreForExactPreview({ app: 'driver', ref, sha }).bypass, false, `${ref} must not bypass driver`);
  }
  assert.equal(
    shouldBypassIgnoreForExactPreview({ app: 'driver', ref: `preview-exact/driver/${sha}`, sha, vercelEnv: 'production' }).bypass,
    false,
  );
  assert.equal(
    shouldBypassIgnoreForExactPreview({ app: 'driver', ref: `preview-exact/driver/${sha}`, sha: OTHER_SHA }).bypass,
    false,
  );
  assert.equal(
    shouldBypassIgnoreForExactPreview({ app: 'driver', ref: `preview-exact/driver/${sha}`, sha: 'short' }).bypass,
    false,
  );
});

test('provisioning bypass: never leaks to normal refs or production', () => {
  const sha = KNOWN_SHA;
  for (const ref of ['preview', 'main', 'tmp/anything-publication', 'feature/branch']) {
    for (const app of ['consumer', 'seller', 'driver']) {
      assert.equal(shouldBypassIgnoreForExactPreview({ app, ref, sha }).bypass, false, `${ref} must not bypass ${app}`);
    }
  }
  // Production env never bypasses (including driver).
  assert.equal(
    shouldBypassIgnoreForExactPreview({ app: 'consumer', ref: `preview-exact/consumer/${sha}`, sha, vercelEnv: 'production' }).bypass,
    false,
  );
  assert.equal(
    shouldBypassIgnoreForExactPreview({ app: 'driver', ref: `preview-exact/driver/${sha}`, sha, vercelEnv: 'production' }).bypass,
    false,
  );
  // SHA mismatch never bypasses.
  assert.equal(
    shouldBypassIgnoreForExactPreview({ app: 'consumer', ref: `preview-exact/consumer/${sha}`, sha: OTHER_SHA }).bypass,
    false,
  );
  // Malformed SHA never bypasses.
  assert.equal(
    shouldBypassIgnoreForExactPreview({ app: 'consumer', ref: `preview-exact/consumer/${sha}`, sha: 'short' }).bypass,
    false,
  );
});

test('provisioning bypass via Vercel system env (ref+sha), absent env never bypasses', () => {
  const sha = KNOWN_SHA;
  const env = { VERCEL_GIT_COMMIT_REF: `preview-exact/both/${sha}`, VERCEL_GIT_COMMIT_SHA: sha, VERCEL_ENV: 'preview' };
  assert.equal(resolveExactPreviewBypassFromEnv({ app: 'consumer', env }).bypass, true);
  assert.equal(resolveExactPreviewBypassFromEnv({ app: 'seller', env }).bypass, true);
  assert.equal(resolveExactPreviewBypassFromEnv({ app: 'driver', env }).bypass, false);
  const driverEnv = { VERCEL_GIT_COMMIT_REF: `preview-exact/driver/${sha}`, VERCEL_GIT_COMMIT_SHA: sha, VERCEL_ENV: 'preview' };
  assert.equal(resolveExactPreviewBypassFromEnv({ app: 'driver', env: driverEnv }).bypass, true);
  assert.equal(resolveExactPreviewBypassFromEnv({ app: 'consumer', env: driverEnv }).bypass, false);
  assert.equal(resolveExactPreviewBypassFromEnv({ app: 'consumer', env: {} }).bypass, false);
  assert.equal(
    resolveExactPreviewBypassFromEnv({ app: 'consumer', env: { VERCEL_GIT_COMMIT_REF: 'preview', VERCEL_GIT_COMMIT_SHA: sha } }).bypass,
    false,
  );
});

// ---------------------------------------------------------------------------
// 7. Deployment verification: SHA mismatch FAILs, non-READY never passes
// ---------------------------------------------------------------------------

function previewPayload(app, { sha = KNOWN_SHA, state = 'READY', target = null } = {}) {
  const config = PREVIEW_APPS.find(({ app: name }) => name === app);
  const deploymentId = `dpl_Test${app}1234567890abcdef`;
  return {
    id: deploymentId,
    uid: deploymentId,
    name: config.project,
    projectId: config.projectId,
    project: { id: config.projectId, name: config.project },
    state,
    readyState: state,
    target,
    url: `${config.project}-abc123.vercel.app`,
    meta: { githubCommitSha: sha },
  };
}

test('deployment with different githubCommitSha FAILs', () => {
  for (const app of ['consumer', 'seller', 'driver']) {
    const evidence = inspectAppDeployment(app, previewPayload(app).id, KNOWN_SHA, previewPayload(app, { sha: OTHER_SHA }));
    assert.equal(evidence.ready, false);
    assert.equal(evidence.failureCode, 'VERCEL_GITHUB_COMMIT_SHA_MISMATCH');
  }
});

test('non-READY states never count as success', () => {
  for (const state of ['BUILDING', 'QUEUED', 'CANCELED', 'ERROR']) {
    for (const app of ['consumer', 'seller', 'driver']) {
      const payload = previewPayload(app, { state });
      const evidence = inspectAppDeployment(app, payload.id, KNOWN_SHA, payload);
      assert.equal(evidence.ready, false, `${app} ${state} must not be ready`);
    }
  }
});

test('exact SHA + READY + preview target passes binding', () => {
  for (const app of ['consumer', 'seller', 'driver']) {
    const payload = previewPayload(app);
    const evidence = inspectAppDeployment(app, payload.id, KNOWN_SHA, payload);
    assert.equal(evidence.ready, true);
    assert.equal(evidence.deploymentSha, KNOWN_SHA);
    assert.equal(evidence.target, null);
  }
});

test('driver exact binding uses canonical driver project identity', () => {
  const byApp = new Map(PREVIEW_APPS.map((entry) => [entry.app, entry]));
  assert.equal(byApp.get('driver').projectId, 'prj_e3OU9YIAGTkDcrWQdpTvkbHnJ4XW');
  const payload = previewPayload('driver');
  assert.equal(payload.projectId, 'prj_e3OU9YIAGTkDcrWQdpTvkbHnJ4XW');
  const evidence = inspectAppDeployment('driver', payload.id, KNOWN_SHA, payload);
  assert.equal(evidence.ready, true);
  assert.equal(evidence.deploymentSha, KNOWN_SHA);
  assert.equal(evidence.target, null);
  // SHA mismatch and non-READY fail for driver as well.
  const mismatch = inspectAppDeployment('driver', payload.id, KNOWN_SHA, previewPayload('driver', { sha: OTHER_SHA }));
  assert.equal(mismatch.ready, false);
  const building = inspectAppDeployment('driver', payload.id, KNOWN_SHA, previewPayload('driver', { state: 'BUILDING' }));
  assert.equal(building.ready, false);
});

// ---------------------------------------------------------------------------
// 8. Workflow contract: driver in input/preflight/ref validation
// ---------------------------------------------------------------------------

test('workflow contract includes driver scope without weakening push guards', () => {
  const workflowPath = path.join(REPO_ROOT, '.github', 'workflows', 'provision-exact-preview.yml');
  const workflow = readFileSync(workflowPath, 'utf8');
  // workflow_dispatch app choice includes driver.
  assert.match(workflow, /- driver/);
  assert.match(workflow, /consumer\|seller\|driver\|both/);
  // dedicated provisioning ref validation includes driver.
  assert.match(workflow, /preview-exact\/\(consumer\|seller\|driver\|both\)/);
  // push target stays scoped to preview-exact/<scope>/<sha>.
  assert.match(workflow, /preview-exact\/\$APP\/\$EXACT_SHA/);
  // main/preview push and force/history guards stay intact.
  assert.match(workflow, /main\/preview ref push/);
  assert.match(workflow, /--driver-deployment-id/);
  assert.match(workflow, /--only=driver/);
});
