/**
 * Deterministic verification for provider-native exact-SHA targeted Preview
 * capability (PILOT-AUTH-EXACT-SHA-VERCEL-TARGETED-PREVIEW-CAPABILITY-44A).
 *
 * Run: node --test scripts/vercel/create-exact-preview-deployment.spec.mjs
 *
 * All tests are mock/local only. Live provider calls are NEVER made here;
 * live proof (if credential exists) runs separately via workflow_dispatch
 * with a fresh live-main SHA and the strict wait-preview-deploy waiter.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertCreateCredentialMode,
  assertNonProductionTarget,
  buildTargetedDeploymentPlan,
  buildVercelCreateBody,
  createExactPreviewDeployments,
  CREATE_CREDENTIAL_MODE_LEGACY_TEAM,
  CREATE_CREDENTIAL_MODE_PROJECT_SCOPED,
  EXACT_PREVIEW_CREATE_TOKENS_BY_APP,
  exactPreviewCreateTokenEnvForApp,
  exactPreviewCreateTokenRequiredCode,
  inspectTargetedCreationResult,
  requestVercelCreateDeployment,
  resolveAppProjectToken,
  resolveCreateToken,
  resolveProjectScopedTokensForScope,
  resolveTargetedApps,
  TARGETED_APP_ALLOWLIST,
  TARGETED_SCOPE_TO_APPS,
  VERCEL_CREATE_CREDENTIAL_ENV,
  vercelCreatePath,
  vercelCreateProjectScopedPath,
} from './create-exact-preview-deployment.mjs';
import { commitExists } from './provision-exact-preview.mjs';
import { inspectAppDeployment, PREVIEW_APPS, VERCEL_TEAM_ID } from '../wait-preview-deploy.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

const KNOWN_SHA = 'e322a01228c43a21b83c8113c9a6a8f1895845ae';
const OTHER_SHA = 'b'.repeat(40);
const UNKNOWN_WELLFORMED_SHA = 'c'.repeat(40);
const FAKE_TOKEN = 'test-token-value-12345';

// ---------------------------------------------------------------------------
// 1. Malformed SHA rejected
// ---------------------------------------------------------------------------

test('malformed SHA rejected', () => {
  for (const bad of ['', 'abc', 'z'.repeat(40), 'A'.repeat(40), KNOWN_SHA.slice(0, 39), `${KNOWN_SHA}x`, ` ${KNOWN_SHA} `, null, undefined, 42]) {
    assert.throws(() => buildTargetedDeploymentPlan({ sha: bad, app: 'consumer' }), (error) => error?.code === 'EXACT_SHA_MALFORMED');
  }
});

test('uppercase SHA rejected (no silent normalization)', () => {
  assert.throws(
    () => buildTargetedDeploymentPlan({ sha: KNOWN_SHA.toUpperCase(), app: 'consumer' }),
    (error) => error?.code === 'EXACT_SHA_MALFORMED',
  );
});

// ---------------------------------------------------------------------------
// 2. Nonexistent commit rejected at git layer
// ---------------------------------------------------------------------------

function initTempRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'targeted-preview-'));
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

test('nonexistent commit rejected at git layer', () => {
  const { dir, head } = initTempRepo();
  assert.equal(commitExists({ repositoryRoot: dir, sha: head }), true);
  assert.equal(commitExists({ repositoryRoot: dir, sha: UNKNOWN_WELLFORMED_SHA }), false);
});

test('createExactPreviewDeployments rejects unknown commit without network', async () => {
  const { dir } = initTempRepo();
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, json: async () => ({}) };
  };
  await assert.rejects(
    () =>
      createExactPreviewDeployments({
        sha: UNKNOWN_WELLFORMED_SHA,
        app: 'consumer',
        token: FAKE_TOKEN,
        fetchImpl,
        repositoryRoot: dir,
      }),
    (error) => error?.code === 'UNKNOWN_COMMIT_SHA',
  );
  assert.equal(called, false);
});

// ---------------------------------------------------------------------------
// 3. App allowlist
// ---------------------------------------------------------------------------

test('app allowlist is exactly consumer|seller|driver|both', () => {
  assert.deepEqual([...TARGETED_APP_ALLOWLIST], ['consumer', 'seller', 'driver', 'both']);
  assert.deepEqual(resolveTargetedApps('consumer'), ['consumer']);
  assert.deepEqual(resolveTargetedApps('seller'), ['seller']);
  assert.deepEqual(resolveTargetedApps('driver'), ['driver']);
  assert.deepEqual(resolveTargetedApps('both'), ['consumer', 'seller']);
  assert.deepEqual(TARGETED_SCOPE_TO_APPS.both, ['consumer', 'seller']);
});

test('invalid app rejected (production/main/preview/empty)', () => {
  for (const bad of ['production', 'main', 'preview', 'consumer, seller', '', '  ', 'consumers', null, undefined, 'both,consumer']) {
    assert.throws(() => buildTargetedDeploymentPlan({ sha: KNOWN_SHA, app: bad }), (error) => error?.code === 'UNKNOWN_TARGETED_APP');
  }
});

// ---------------------------------------------------------------------------
// 4. Project allowlist + consumer/seller/driver mapping, both excludes driver
// ---------------------------------------------------------------------------

test('canonical Vercel project mapping intact (authority = wait-preview PREVIEW_APPS)', () => {
  const byApp = new Map(PREVIEW_APPS.map((entry) => [entry.app, entry]));
  assert.equal(byApp.get('consumer').project, 'greenhubconsumer');
  assert.equal(byApp.get('consumer').projectId, 'prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w');
  assert.equal(byApp.get('seller').project, 'greenhub-seller');
  assert.equal(byApp.get('seller').projectId, 'prj_OPOveVw4QADTbTE7mt32mo14H5dv');
  assert.equal(byApp.get('driver').project, 'greenhub-driver');
  assert.equal(byApp.get('driver').projectId, 'prj_e3OU9YIAGTkDcrWQdpTvkbHnJ4XW');
  assert.equal(VERCEL_TEAM_ID, 'team_J91VWI0TqcHdcF36T7qVgiT1');
});

test('consumer mapping exact', () => {
  const plan = buildTargetedDeploymentPlan({ sha: KNOWN_SHA, app: 'consumer' });
  assert.deepEqual([...plan.apps], ['consumer']);
  assert.equal(plan.plans.length, 1);
  assert.equal(plan.plans[0].project, 'greenhubconsumer');
  assert.equal(plan.plans[0].projectId, 'prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w');
  assert.equal(plan.plans[0].body.project, 'prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w');
  assert.equal(plan.plans[0].body.name, 'greenhubconsumer');
});

test('seller mapping exact', () => {
  const plan = buildTargetedDeploymentPlan({ sha: KNOWN_SHA, app: 'seller' });
  assert.deepEqual([...plan.apps], ['seller']);
  assert.equal(plan.plans[0].project, 'greenhub-seller');
  assert.equal(plan.plans[0].projectId, 'prj_OPOveVw4QADTbTE7mt32mo14H5dv');
});

test('driver mapping independent single scope', () => {
  const plan = buildTargetedDeploymentPlan({ sha: KNOWN_SHA, app: 'driver' });
  assert.deepEqual([...plan.apps], ['driver']);
  assert.equal(plan.plans.length, 1);
  assert.equal(plan.plans[0].project, 'greenhub-driver');
  assert.equal(plan.plans[0].projectId, 'prj_e3OU9YIAGTkDcrWQdpTvkbHnJ4XW');
  assert.equal(plan.plans[0].body.gitSource.sha, KNOWN_SHA);
  assert.equal(plan.plans[0].body.gitSource.ref, KNOWN_SHA);
});

test('both excludes driver (consumer + seller only)', () => {
  const plan = buildTargetedDeploymentPlan({ sha: KNOWN_SHA, app: 'both' });
  assert.deepEqual([...plan.apps], ['consumer', 'seller']);
  assert.equal(plan.plans.length, 2);
  const projects = plan.plans.map((item) => item.project).sort();
  assert.deepEqual(projects, ['greenhub-seller', 'greenhubconsumer']);
  assert.equal(plan.plans.some((item) => item.app === 'driver'), false);
});

// ---------------------------------------------------------------------------
// 5. Production target refused + promote/alias path absence
// ---------------------------------------------------------------------------

test('production target refused', () => {
  for (const target of ['production', 'PRODUCTION', 'staging', 'custom-env', 'production-preview']) {
    assert.throws(
      () => buildTargetedDeploymentPlan({ sha: KNOWN_SHA, app: 'consumer', target }),
      (error) => error?.code === 'PRODUCTION_TARGET_REFUSED',
    );
    assert.throws(() => assertNonProductionTarget(target), (error) => error?.code === 'PRODUCTION_TARGET_REFUSED');
  }
  for (const target of [null, undefined, 'preview', 'PREVIEW', '']) {
    const plan = buildTargetedDeploymentPlan({ sha: KNOWN_SHA, app: 'consumer', target });
    assert.equal(plan.target, null);
    assert.equal(plan.production, false);
  }
});

test('creation body has no production promote/alias path', () => {
  for (const app of ['consumer', 'seller', 'driver']) {
    const body = buildVercelCreateBody({ app, sha: KNOWN_SHA });
    const serialized = JSON.stringify(body);
    assert.equal(Object.hasOwn(body, 'target'), false);
    assert.equal(serialized.includes('"production"'), false);
    assert.equal(serialized.includes('"staging"'), false);
    assert.equal(serialized.includes('"alias"'), false);
    assert.equal(serialized.includes('"promote"'), false);
    assert.equal(Object.hasOwn(body, 'files'), false);
    assert.equal(Object.hasOwn(body, 'deploymentId'), false);
    // Git provenance only.
    assert.equal(body.gitSource.type, 'github');
    assert.equal(body.gitSource.org, 'booker-lab');
    assert.equal(body.gitSource.repo, 'greenhub');
    assert.equal(body.gitSource.sha, KNOWN_SHA);
    assert.equal(body.gitSource.ref, KNOWN_SHA);
  }
  // both cannot be a single project body.
  assert.throws(() => buildVercelCreateBody({ app: 'both', sha: KNOWN_SHA }), (error) => error?.code === 'UNKNOWN_TARGETED_APP');
});

test('create path is team-scoped with dedup bypass (no production)', () => {
  const pathname = vercelCreatePath();
  assert.match(pathname, /\/v13\/deployments\?/);
  assert.match(pathname, /teamId=team_J91VWI0TqcHdcF36T7qVgiT1/);
  assert.match(pathname, /forceNew=1/);
  assert.match(pathname, /skipAutoDetectionConfirmation=1/);
  assert.equal(pathname.includes('production'), false);
});

// ---------------------------------------------------------------------------
// 6. Creation result inspection: exact SHA match vs mismatch, project, ID, READY
// ---------------------------------------------------------------------------

function creationPayload(app, { sha = KNOWN_SHA, state = 'BUILDING', target = null, projectOverride = null } = {}) {
  const config = PREVIEW_APPS.find(({ app: name }) => name === app);
  const deploymentId = `dpl_Test${app}1234567890abcd`;
  const project = projectOverride ?? { id: config.projectId, name: config.project };
  return {
    id: deploymentId,
    url: `${config.project}-abc123.vercel.app`,
    name: config.project,
    projectId: project.id,
    project,
    state,
    readyState: state,
    target,
    meta: { githubCommitSha: sha },
    gitSource: { type: 'github', org: 'booker-lab', repo: 'greenhub', ref: sha, sha },
  };
}

test('exact provider SHA match passes inspection shape (pending when BUILDING)', () => {
  const payload = creationPayload('consumer', { state: 'BUILDING' });
  const result = inspectTargetedCreationResult({ app: 'consumer', requestedSha: KNOWN_SHA, payload });
  assert.equal(result.deploymentId, payload.id);
  assert.equal(result.projectId, 'prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w');
  assert.equal(result.target, null);
  // BUILDING is pending for the waiter, not a hard fail.
  assert.equal(result.retryable, true);
  assert.equal(result.failureCode, null);
});

test('READY + exact SHA passes creation inspection', () => {
  const payload = creationPayload('consumer', { state: 'READY' });
  const result = inspectTargetedCreationResult({ app: 'consumer', requestedSha: KNOWN_SHA, payload });
  assert.equal(result.ready, true);
  assert.equal(result.providerSha, KNOWN_SHA);
  assert.equal(result.target, null);
});

test('SHA mismatch fail-closed (EXACT_PROVIDER_SHA_BINDING_FAILED)', () => {
  for (const app of ['consumer', 'seller', 'driver']) {
    const payload = creationPayload(app, { sha: OTHER_SHA, state: 'READY' });
    const result = inspectTargetedCreationResult({ app, requestedSha: KNOWN_SHA, payload });
    assert.equal(result.ready, false);
    assert.equal(result.failureCode, 'EXACT_PROVIDER_SHA_BINDING_FAILED');
  }
});

test('wrong project fail-closed', () => {
  const payload = creationPayload('consumer', {
    projectOverride: { id: 'prj_wrong', name: 'wrong-project' },
  });
  const result = inspectTargetedCreationResult({ app: 'consumer', requestedSha: KNOWN_SHA, payload });
  assert.equal(result.ready, false);
  assert.equal(result.failureCode, 'VERCEL_PROJECT_MISMATCH');
});

test('missing deployment ID fails', () => {
  const payload = creationPayload('consumer');
  delete payload.id;
  const result = inspectTargetedCreationResult({ app: 'consumer', requestedSha: KNOWN_SHA, payload });
  assert.equal(result.ready, false);
  assert.equal(result.failureCode, 'MISSING_DEPLOYMENT_ID');
});

test('non-READY ERROR/CANCELED fails (VERCEL_NOT_READY)', () => {
  for (const state of ['ERROR', 'CANCELED']) {
    const payload = creationPayload('consumer', { state });
    const result = inspectTargetedCreationResult({ app: 'consumer', requestedSha: KNOWN_SHA, payload });
    assert.equal(result.ready, false);
    assert.equal(result.failureCode, 'VERCEL_NOT_READY');
  }
});

test('production target fails closed (PRODUCTION_SAFETY_VIOLATION)', () => {
  for (const target of ['production', 'staging']) {
    const payload = creationPayload('consumer', { state: 'READY', target });
    const result = inspectTargetedCreationResult({ app: 'consumer', requestedSha: KNOWN_SHA, payload });
    assert.equal(result.ready, false);
    assert.equal(
      result.failureCode === 'PRODUCTION_SAFETY_VIOLATION' || result.failureCode === 'VERCEL_TARGET_NOT_PREVIEW',
      true,
    );
    if (target === 'production') assert.equal(result.failureCode, 'PRODUCTION_SAFETY_VIOLATION');
  }
});

// ---------------------------------------------------------------------------
// 7. Provider auth missing classification + secret redaction
// ---------------------------------------------------------------------------

test('provider auth missing classification (creation token required)', () => {
  const saved = process.env[VERCEL_CREATE_CREDENTIAL_ENV];
  delete process.env[VERCEL_CREATE_CREDENTIAL_ENV];
  try {
    assert.throws(() => resolveCreateToken(null), (error) => error?.code === 'VERCEL_DEPLOY_TOKEN_REQUIRED');
    assert.throws(() => resolveCreateToken('   '), (error) => error?.code === 'VERCEL_DEPLOY_TOKEN_REQUIRED');
  } finally {
    if (saved !== undefined) process.env[VERCEL_CREATE_CREDENTIAL_ENV] = saved;
  }
  // Explicit token resolves without env.
  assert.equal(resolveCreateToken(FAKE_TOKEN), FAKE_TOKEN);
});

test('secret redaction: token never in body/URL/errors', async () => {
  const secretToken = 'super-secret-token-xyz-999';
  const seen = { url: null, init: null };
  const fetchImpl = async (url, init) => {
    seen.url = url;
    seen.init = init;
    const config = PREVIEW_APPS.find(({ app }) => app === 'consumer');
    return {
      ok: true,
      json: async () => ({
        id: 'dpl_Testconsumer1234567890abcd',
        url: `${config.project}-abc123.vercel.app`,
        name: config.project,
        projectId: config.projectId,
        project: { id: config.projectId, name: config.project },
        state: 'BUILDING',
        readyState: 'BUILDING',
        target: null,
        meta: { githubCommitSha: KNOWN_SHA },
      }),
    };
  };
  const { dir, head } = initTempRepo();
  // Use the temp repo HEAD as the requested SHA so provenance passes.
  const plan = buildTargetedDeploymentPlan({ sha: head, app: 'consumer' });
  assert.equal(plan.sha, head);
  // Body for that SHA must not contain the token.
  const body = buildVercelCreateBody({ app: 'consumer', sha: head });
  assert.equal(JSON.stringify(body).includes(secretToken), false);
  assert.equal(vercelCreatePath().includes(secretToken), false);
  // Authorization header carries the token (header-only), body/URL do not.
  const payload = await (async () => {
    const { requestVercelCreateDeployment } = await import('./create-exact-preview-deployment.mjs');
    return requestVercelCreateDeployment({ app: 'consumer', sha: head, token: secretToken, fetchImpl });
  })();
  assert.equal(seen.url.includes(secretToken), false);
  assert.equal(String(seen.init.body).includes(secretToken), false);
  assert.equal(seen.init.headers.Authorization, `Bearer ${secretToken}`);
  assert.equal(JSON.stringify(payload).includes(secretToken), false);
});

test('creation failure does not leak token in error', async () => {
  const secretToken = 'leak-check-token-abc-123';
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'forbidden' } }) });
  const { dir, head } = initTempRepo();
  const { requestVercelCreateDeployment } = await import('./create-exact-preview-deployment.mjs');
  await assert.rejects(
    () => requestVercelCreateDeployment({ app: 'consumer', sha: head, token: secretToken, fetchImpl }),
    (error) => {
      assert.equal(error?.code, 'PROVIDER_TARGETED_DEPLOYMENT_FAILED');
      assert.equal(String(error?.message ?? '').includes(secretToken), false);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// 8. Existing wait-preview strict comparison stays intact
// ---------------------------------------------------------------------------

function waiterPayload(app, { sha = KNOWN_SHA, state = 'READY', target = null } = {}) {
  const config = PREVIEW_APPS.find(({ app: name }) => name === app);
  const deploymentId = `dpl_Wait${app}1234567890abcdef`;
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

test('existing wait-preview strict comparison unchanged', () => {
  for (const app of ['consumer', 'seller', 'driver']) {
    const payload = waiterPayload(app);
    const evidence = inspectAppDeployment(app, payload.id, KNOWN_SHA, payload);
    assert.equal(evidence.ready, true);
    assert.equal(evidence.deploymentSha, KNOWN_SHA);
    assert.equal(evidence.target, null);
    const mismatch = inspectAppDeployment(app, payload.id, KNOWN_SHA, waiterPayload(app, { sha: OTHER_SHA }));
    assert.equal(mismatch.ready, false);
    assert.equal(mismatch.failureCode, 'VERCEL_GITHUB_COMMIT_SHA_MISMATCH');
    const building = inspectAppDeployment(app, payload.id, KNOWN_SHA, waiterPayload(app, { state: 'BUILDING' }));
    assert.equal(building.ready, false);
  }
});

// ---------------------------------------------------------------------------
// 9. No main/preview Git mutation required
// ---------------------------------------------------------------------------

test('no main/preview Git mutation required (helper + plan are push-free)', () => {
  const helperSource = readFileSync(new URL('./create-exact-preview-deployment.mjs', import.meta.url), 'utf8');
  // Executable Git-mutation surface must not exist. Documentation mentions of
  // the legacy `preview-exact/*` ref-push path are allowed in comments; what
  // is forbidden is code that pushes refs or defines a provisioning ref.
  assert.doesNotMatch(helperSource, /git push/);
  assert.doesNotMatch(helperSource, /refs\/heads\/main/);
  assert.doesNotMatch(helperSource, /execFileSync\('git',\s*\[[^\]]*push/);
  assert.doesNotMatch(helperSource, /REF_PREFIX\s*=\s*['"]preview-exact\//);
  assert.doesNotMatch(helperSource, /REF_PATTERN\s*=/);
  assert.doesNotMatch(helperSource, /preview-exact\/\$\{/);
  const plan = buildTargetedDeploymentPlan({ sha: KNOWN_SHA, app: 'consumer' });
  assert.equal(plan.gitRefPushRequired, false);
  assert.equal(plan.target, null);
  assert.equal(plan.production, false);
});

test('targeted workflow requires no ref push and forbids production', () => {
  const workflowPath = path.join(REPO_ROOT, '.github', 'workflows', 'create-exact-preview-deployment.yml');
  const workflow = readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /consumer\|seller\|driver\|both/);
  // 45B project-scoped credentials: one secret per app; the legacy single
  // team secret must NOT be consumed by this workflow anymore.
  assert.match(workflow, /secrets\.VERCEL_EXACT_PREVIEW_CONSUMER_TOKEN/);
  assert.match(workflow, /secrets\.VERCEL_EXACT_PREVIEW_SELLER_TOKEN/);
  assert.match(workflow, /secrets\.VERCEL_EXACT_PREVIEW_DRIVER_TOKEN/);
  assert.doesNotMatch(workflow, /VERCEL_EXACT_PREVIEW_DEPLOY_TOKEN/);
  assert.doesNotMatch(workflow, /secrets\.ROUND_DIRECT_E2E_VERCEL_READ_TOKEN/);
  // Project-scoped readback for the strict waiter; both stays bounded to
  // consumer + seller (driver ID never required there).
  assert.match(workflow, /--credential-mode=project-scoped/);
  assert.match(workflow, /--only=consumer,seller/);
  assert.match(workflow, /create-exact-preview-deployment\.mjs/);
  assert.match(workflow, /wait-preview-deploy\.mjs/);
  // No executable ref push. Doc comments may reference the legacy
  // `preview-exact/*` path to explain it is NOT used; forbid only the
  // actual git push command.
  assert.doesNotMatch(workflow, /git push origin/);
  assert.match(workflow, /PRODUCTION_SAFETY_VIOLATION|production.*forbidden|Preview.*only/i);
  // Secrets travel via env only: `set +x` guards creation, and only
  // deployment IDs (never token values) reach GITHUB_OUTPUT/summary.
  assert.match(workflow, /set \+x/);
  assert.match(workflow, /consumer_deployment_id=%s/);
});

// ---------------------------------------------------------------------------
// 45B. Project-scoped credential convergence (mock/local only)
// ---------------------------------------------------------------------------

const PROJECT_TOKEN_ENVS = [
  'VERCEL_EXACT_PREVIEW_CONSUMER_TOKEN',
  'VERCEL_EXACT_PREVIEW_SELLER_TOKEN',
  'VERCEL_EXACT_PREVIEW_DRIVER_TOKEN',
];

function clearProjectTokenEnvs() {
  const saved = {};
  for (const env of PROJECT_TOKEN_ENVS) {
    saved[env] = process.env[env];
    delete process.env[env];
  }
  return () => {
    for (const env of PROJECT_TOKEN_ENVS) {
      if (saved[env] !== undefined) process.env[env] = saved[env];
      else delete process.env[env];
    }
  };
}

const SCOPE_TOKENS = Object.freeze({
  consumer: 'project-token-consumer-aaa-001',
  seller: 'project-token-seller-bbb-002',
  driver: 'project-token-driver-ccc-003',
});

/** Mock Vercel creation POST: records calls, answers per body.project. */
function mockProjectScopedCreateFetch(sha, { state = 'BUILDING' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body, authorization: init.headers.Authorization });
    const config = PREVIEW_APPS.find((entry) => entry.projectId === body.project);
    assert.ok(config, 'mock only serves allowlisted projectIds');
    const deploymentId = `dpl_Mock${config.app}1234567890abcd`;
    return {
      ok: true,
      json: async () => ({
        id: deploymentId,
        url: `${config.project}-abc123.vercel.app`,
        name: config.project,
        projectId: config.projectId,
        project: { id: config.projectId, name: config.project },
        state,
        readyState: state,
        target: null,
        meta: { githubCommitSha: sha },
        gitSource: { type: 'github', org: 'booker-lab', repo: 'greenhub', ref: sha, sha },
      }),
    };
  };
  return { calls, fetchImpl };
}

function assertNoTokenLeak(values, ...haystacks) {
  for (const token of values) {
    for (const haystack of haystacks) {
      assert.equal(String(haystack).includes(token), false);
    }
  }
}

test('45B credential authority: one env per app + per-app fail-closed codes', () => {
  assert.deepEqual({ ...EXACT_PREVIEW_CREATE_TOKENS_BY_APP }, {
    consumer: 'VERCEL_EXACT_PREVIEW_CONSUMER_TOKEN',
    seller: 'VERCEL_EXACT_PREVIEW_SELLER_TOKEN',
    driver: 'VERCEL_EXACT_PREVIEW_DRIVER_TOKEN',
  });
  assert.equal(exactPreviewCreateTokenEnvForApp('consumer'), 'VERCEL_EXACT_PREVIEW_CONSUMER_TOKEN');
  assert.equal(exactPreviewCreateTokenEnvForApp('seller'), 'VERCEL_EXACT_PREVIEW_SELLER_TOKEN');
  assert.equal(exactPreviewCreateTokenEnvForApp('driver'), 'VERCEL_EXACT_PREVIEW_DRIVER_TOKEN');
  assert.equal(exactPreviewCreateTokenRequiredCode('consumer'), 'VERCEL_CONSUMER_PROJECT_TOKEN_REQUIRED');
  assert.equal(exactPreviewCreateTokenRequiredCode('seller'), 'VERCEL_SELLER_PROJECT_TOKEN_REQUIRED');
  assert.equal(exactPreviewCreateTokenRequiredCode('driver'), 'VERCEL_DRIVER_PROJECT_TOKEN_REQUIRED');
  assert.equal(assertCreateCredentialMode('project-scoped'), CREATE_CREDENTIAL_MODE_PROJECT_SCOPED);
  assert.equal(assertCreateCredentialMode('legacy-team-scoped'), CREATE_CREDENTIAL_MODE_LEGACY_TEAM);
  assert.throws(() => assertCreateCredentialMode('auto'), (error) => error?.code === 'UNKNOWN_CREDENTIAL_MODE');
  assert.throws(() => assertCreateCredentialMode(''), (error) => error?.code === 'UNKNOWN_CREDENTIAL_MODE');
});

test('45B project-scoped POST omits teamId; legacy POST keeps teamId', () => {
  const scoped = vercelCreateProjectScopedPath();
  assert.match(scoped, /\/v13\/deployments\?/);
  assert.match(scoped, /forceNew=1/);
  assert.match(scoped, /skipAutoDetectionConfirmation=1/);
  assert.equal(scoped.includes('teamId'), false);
  const legacy = vercelCreatePath();
  assert.match(legacy, /teamId=team_J91VWI0TqcHdcF36T7qVgiT1/);
});

test('45B scope resolves only its own project token (both = consumer + seller)', () => {
  const restore = clearProjectTokenEnvs();
  try {
    assert.deepEqual(resolveProjectScopedTokensForScope('driver', { ...SCOPE_TOKENS }), {
      driver: SCOPE_TOKENS.driver,
    });
    assert.deepEqual(resolveProjectScopedTokensForScope('consumer', { ...SCOPE_TOKENS }), {
      consumer: SCOPE_TOKENS.consumer,
    });
    assert.deepEqual(resolveProjectScopedTokensForScope('seller', { ...SCOPE_TOKENS }), {
      seller: SCOPE_TOKENS.seller,
    });
    // both resolves consumer + seller independently; driver token untouched.
    assert.deepEqual(resolveProjectScopedTokensForScope('both', { ...SCOPE_TOKENS }), {
      consumer: SCOPE_TOKENS.consumer,
      seller: SCOPE_TOKENS.seller,
    });
  } finally {
    restore();
  }
});

test('45B missing project token fails with its own code (no cross-app reuse)', () => {
  const restore = clearProjectTokenEnvs();
  try {
    // Only the consumer token exists: driver scope must NOT borrow it.
    process.env.VERCEL_EXACT_PREVIEW_CONSUMER_TOKEN = SCOPE_TOKENS.consumer;
    assert.throws(() => resolveAppProjectToken('driver', null), (error) => {
      assert.equal(error?.code, 'VERCEL_DRIVER_PROJECT_TOKEN_REQUIRED');
      assert.equal(String(error?.message ?? '').includes('VERCEL_EXACT_PREVIEW_DRIVER_TOKEN'), true);
      assert.equal(String(error?.message ?? '').includes(SCOPE_TOKENS.consumer), false);
      return true;
    });
    delete process.env.VERCEL_EXACT_PREVIEW_CONSUMER_TOKEN;
    // both with seller token missing fails as the seller code.
    assert.throws(
      () => resolveProjectScopedTokensForScope('both', { consumer: SCOPE_TOKENS.consumer }),
      (error) => error?.code === 'VERCEL_SELLER_PROJECT_TOKEN_REQUIRED',
    );
    assert.throws(
      () => resolveProjectScopedTokensForScope('consumer', {}),
      (error) => error?.code === 'VERCEL_CONSUMER_PROJECT_TOKEN_REQUIRED',
    );
  } finally {
    restore();
  }
});

test('45B driver scope uses DRIVER token only (no teamId, exact body)', async () => {
  const restore = clearProjectTokenEnvs();
  try {
    const { dir, head } = initTempRepo();
    const { calls, fetchImpl } = mockProjectScopedCreateFetch(head);
    const result = await createExactPreviewDeployments({
      sha: head,
      app: 'driver',
      tokensByApp: { ...SCOPE_TOKENS },
      fetchImpl,
      repositoryRoot: dir,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].authorization, `Bearer ${SCOPE_TOKENS.driver}`);
    assert.equal(calls[0].url.includes('teamId'), false);
    assert.equal(calls[0].body.project, 'prj_e3OU9YIAGTkDcrWQdpTvkbHnJ4XW');
    assert.equal(calls[0].body.name, 'greenhub-driver');
    assert.equal(calls[0].body.gitSource.ref, head);
    assert.equal(calls[0].body.gitSource.sha, head);
    assert.equal(result.scope, 'driver');
    assert.equal(result.credentialMode, 'project-scoped');
    assert.deepEqual({ ...result.credentialEnvs }, { driver: 'VERCEL_EXACT_PREVIEW_DRIVER_TOKEN' });
    assert.equal(result.credentialValueRecorded, false);
    assert.equal(result.deployments.length, 1);
    assertNoTokenLeak(
      Object.values(SCOPE_TOKENS),
      calls[0].url,
      JSON.stringify(calls[0].body),
      JSON.stringify(result),
    );
  } finally {
    restore();
  }
});

test('45B consumer scope uses CONSUMER token only', async () => {
  const restore = clearProjectTokenEnvs();
  try {
    const { dir, head } = initTempRepo();
    const { calls, fetchImpl } = mockProjectScopedCreateFetch(head);
    await createExactPreviewDeployments({
      sha: head,
      app: 'consumer',
      tokensByApp: { ...SCOPE_TOKENS },
      fetchImpl,
      repositoryRoot: dir,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].authorization, `Bearer ${SCOPE_TOKENS.consumer}`);
    assert.equal(calls[0].body.project, 'prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w');
    assertNoTokenLeak(Object.values(SCOPE_TOKENS), calls[0].url, JSON.stringify(calls[0].body));
  } finally {
    restore();
  }
});

test('45B seller scope uses SELLER token only', async () => {
  const restore = clearProjectTokenEnvs();
  try {
    const { dir, head } = initTempRepo();
    const { calls, fetchImpl } = mockProjectScopedCreateFetch(head);
    await createExactPreviewDeployments({
      sha: head,
      app: 'seller',
      tokensByApp: { ...SCOPE_TOKENS },
      fetchImpl,
      repositoryRoot: dir,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].authorization, `Bearer ${SCOPE_TOKENS.seller}`);
    assert.equal(calls[0].body.project, 'prj_OPOveVw4QADTbTE7mt32mo14H5dv');
    assertNoTokenLeak(Object.values(SCOPE_TOKENS), calls[0].url, JSON.stringify(calls[0].body));
  } finally {
    restore();
  }
});

test('45B both uses consumer + seller tokens independently, driver token unused', async () => {
  const restore = clearProjectTokenEnvs();
  try {
    const { dir, head } = initTempRepo();
    const { calls, fetchImpl } = mockProjectScopedCreateFetch(head);
    const result = await createExactPreviewDeployments({
      sha: head,
      app: 'both',
      tokensByApp: { ...SCOPE_TOKENS },
      fetchImpl,
      repositoryRoot: dir,
    });
    assert.equal(calls.length, 2);
    const byProject = new Map(calls.map((call) => [call.body.project, call]));
    const consumerCall = byProject.get('prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w');
    const sellerCall = byProject.get('prj_OPOveVw4QADTbTE7mt32mo14H5dv');
    assert.ok(consumerCall);
    assert.ok(sellerCall);
    assert.equal(consumerCall.authorization, `Bearer ${SCOPE_TOKENS.consumer}`);
    assert.equal(sellerCall.authorization, `Bearer ${SCOPE_TOKENS.seller}`);
    for (const call of calls) {
      assert.equal(call.url.includes('teamId'), false);
      assert.equal(call.body.gitSource.ref, head);
      assert.equal(call.body.gitSource.sha, head);
      assert.notEqual(call.authorization, `Bearer ${SCOPE_TOKENS.driver}`);
      assert.equal(call.url.includes(SCOPE_TOKENS.driver), false);
      assert.equal(JSON.stringify(call.body).includes(SCOPE_TOKENS.driver), false);
    }
    assert.deepEqual({ ...result.credentialEnvs }, {
      consumer: 'VERCEL_EXACT_PREVIEW_CONSUMER_TOKEN',
      seller: 'VERCEL_EXACT_PREVIEW_SELLER_TOKEN',
    });
    assertNoTokenLeak(Object.values(SCOPE_TOKENS), JSON.stringify(result));
  } finally {
    restore();
  }
});

test('45B missing project token => deployment POST 0회', async () => {
  const restore = clearProjectTokenEnvs();
  try {
    const { dir, head } = initTempRepo();
    for (const [scope, code] of [
      ['driver', 'VERCEL_DRIVER_PROJECT_TOKEN_REQUIRED'],
      ['consumer', 'VERCEL_CONSUMER_PROJECT_TOKEN_REQUIRED'],
      ['seller', 'VERCEL_SELLER_PROJECT_TOKEN_REQUIRED'],
    ]) {
      const { calls, fetchImpl } = mockProjectScopedCreateFetch(head);
      await assert.rejects(
        () =>
          createExactPreviewDeployments({
            sha: head,
            app: scope,
            tokensByApp: {},
            fetchImpl,
            repositoryRoot: dir,
          }),
        (error) => error?.code === code,
      );
      assert.equal(calls.length, 0);
    }
    // both with seller token missing: seller code, still 0 POSTs.
    const both = mockProjectScopedCreateFetch(head);
    await assert.rejects(
      () =>
        createExactPreviewDeployments({
          sha: head,
          app: 'both',
          tokensByApp: { consumer: SCOPE_TOKENS.consumer },
          fetchImpl: both.fetchImpl,
          repositoryRoot: dir,
        }),
      (error) => error?.code === 'VERCEL_SELLER_PROJECT_TOKEN_REQUIRED',
    );
    assert.equal(both.calls.length, 0);
  } finally {
    restore();
  }
});

test('45B single project token is never reused for another allowlisted project', async () => {
  const restore = clearProjectTokenEnvs();
  try {
    const { dir, head } = initTempRepo();
    // Only the driver token is handed over for a consumer request: the fan-out
    // must fail closed instead of spending the driver token on consumer.
    const { calls, fetchImpl } = mockProjectScopedCreateFetch(head);
    await assert.rejects(
      () =>
        createExactPreviewDeployments({
          sha: head,
          app: 'consumer',
          tokensByApp: { driver: SCOPE_TOKENS.driver },
          fetchImpl,
          repositoryRoot: dir,
        }),
      (error) => error?.code === 'VERCEL_CONSUMER_PROJECT_TOKEN_REQUIRED',
    );
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test('45B project-scoped request URL never forces teamId; legacy request keeps it', async () => {
  const restore = clearProjectTokenEnvs();
  try {
    const { dir, head } = initTempRepo();
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url, init });
      const config = PREVIEW_APPS.find(({ app }) => app === 'driver');
      return {
        ok: true,
        json: async () => ({
          id: 'dpl_Mockdriver1234567890abcd',
          url: `${config.project}-abc123.vercel.app`,
          name: config.project,
          projectId: config.projectId,
          project: { id: config.projectId, name: config.project },
          state: 'BUILDING',
          readyState: 'BUILDING',
          target: null,
          meta: { githubCommitSha: head },
        }),
      };
    };
    await requestVercelCreateDeployment({
      app: 'driver',
      sha: head,
      token: SCOPE_TOKENS.driver,
      fetchImpl,
      credentialMode: 'project-scoped',
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url.includes('teamId'), false);
    assert.equal(seen[0].init.headers.Authorization, `Bearer ${SCOPE_TOKENS.driver}`);
    await requestVercelCreateDeployment({
      app: 'driver',
      sha: head,
      token: 'legacy-team-token-xyz',
      fetchImpl,
      credentialMode: 'legacy-team-scoped',
    });
    assert.equal(seen.length, 2);
    assert.equal(seen[1].url.includes('teamId=team_J91VWI0TqcHdcF36T7qVgiT1'), true);
  } finally {
    restore();
  }
});

test('45B production target via fan-out is refused with POST 0회', async () => {
  const restore = clearProjectTokenEnvs();
  try {
    const { dir, head } = initTempRepo();
    const { calls, fetchImpl } = mockProjectScopedCreateFetch(head);
    await assert.rejects(
      () =>
        createExactPreviewDeployments({
          sha: head,
          app: 'driver',
          target: 'production',
          tokensByApp: { ...SCOPE_TOKENS },
          fetchImpl,
          repositoryRoot: dir,
        }),
      (error) => error?.code === 'PRODUCTION_TARGET_REFUSED',
    );
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test('45B creation failure never leaks token values in errors', async () => {
  const restore = clearProjectTokenEnvs();
  try {
    const { dir, head } = initTempRepo();
    const fetchImpl = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: 'forbidden' } }),
    });
    await assert.rejects(
      () =>
        createExactPreviewDeployments({
          sha: head,
          app: 'driver',
          tokensByApp: { ...SCOPE_TOKENS },
          fetchImpl,
          repositoryRoot: dir,
        }),
      (error) => {
        assert.equal(error?.code, 'PROVIDER_TARGETED_DEPLOYMENT_FAILED');
        assertNoTokenLeak(Object.values(SCOPE_TOKENS), String(error?.message ?? ''));
        return true;
      },
    );
  } finally {
    restore();
  }
});

test('45B cli dry-run stdout carries credential names only, never values', () => {
  const restore = clearProjectTokenEnvs();
  try {
    const { dir, head } = initTempRepo();
    const secret = 'cli-dry-run-secret-value-789xyz';
    process.env.VERCEL_EXACT_PREVIEW_DRIVER_TOKEN = secret;
    const helperPath = new URL('./create-exact-preview-deployment.mjs', import.meta.url);
    const out = execFileSync(
      'node',
      [fileURLToPath(helperPath), `--sha=${head}`, '--app=driver', '--dry-run', `--repo=${dir}`],
      { encoding: 'utf8' },
    );
    assert.equal(out.includes(secret), false);
    const plan = JSON.parse(out);
    assert.equal(plan.credentialMode, 'project-scoped');
    assert.deepEqual(plan.credentialEnvs, { driver: 'VERCEL_EXACT_PREVIEW_DRIVER_TOKEN' });
    assert.equal(plan.plans[0].body.gitSource.sha, head);
  } finally {
    restore();
  }
});
