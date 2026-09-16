/**
 * Deterministic verification for the Driver Preview read-only revision path
 * (PILOT-AUTH-DRIVER-ALLOWLIST-METADATA-READ-PATH-45E).
 *
 * Run: node --test scripts/vercel/read-driver-preview-revision.spec.mjs
 *
 * Fully provider-free: fetch is an in-memory counting mock. No workflow is
 * dispatched, no live Vercel GET runs, no credential is minted, no mutation
 * runs. No real token/value appears here.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ALLOWED_DEPLOYMENT_KEYS,
  ALLOWED_ENV_KEYS,
  assertExactDriverReadTarget,
  assertNoDecryptQuery,
  DRIVER_ENV_ENTRY_ID,
  DRIVER_ENV_KEY,
  DRIVER_PREVIEW_ENVIRONMENT,
  DRIVER_PROJECT,
  DRIVER_PROJECT_ID,
  EXPECTED_SOURCE_REF,
  EXPECTED_SOURCE_SHA,
  FIELD_UNAVAILABLE,
  filterSingleEnvRecord,
  hasReadCredential,
  OLD_DRIVER_DEPLOYMENT_ID,
  PINNED_DRIVER_DEPLOYMENT_ID,
  projectDeploymentMetadata,
  projectEnvMetadata,
  READ_CREDENTIAL_NAME,
  readDriverPreviewRevision,
  requestVercelDeploymentMetadata,
  requestVercelEnvList,
  resolveReadCredential,
  resultExposesSecret,
  VERCEL_API_ORIGIN,
  VERCEL_TEAM_ID,
  vercelDeploymentReadPath,
  vercelDriverEnvListPath,
  WRITE_CREDENTIAL_NAME,
} from './read-driver-preview-revision.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const MODULE_PATH = path.join(SCRIPT_DIR, 'read-driver-preview-revision.mjs');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'read-driver-preview-revision.yml');
const BRIDGE_PATH = path.join(SCRIPT_DIR, 'driver-preview-allowlist-reprobe.mjs');

function exactTarget(overrides = {}) {
  return {
    project: DRIVER_PROJECT,
    projectId: DRIVER_PROJECT_ID,
    environment: DRIVER_PREVIEW_ENVIRONMENT,
    envEntryId: DRIVER_ENV_ENTRY_ID,
    envKey: DRIVER_ENV_KEY,
    deploymentId: PINNED_DRIVER_DEPLOYMENT_ID,
    sourceSha: EXPECTED_SOURCE_SHA,
    sourceRef: EXPECTED_SOURCE_REF,
    ...overrides,
  };
}

function readEnv(token = 'read-token-for-tests') {
  return { [READ_CREDENTIAL_NAME]: token };
}

function deploymentPayload(overrides = {}) {
  return {
    id: PINNED_DRIVER_DEPLOYMENT_ID,
    uid: PINNED_DRIVER_DEPLOYMENT_ID,
    name: DRIVER_PROJECT,
    projectId: DRIVER_PROJECT_ID,
    project: { id: DRIVER_PROJECT_ID, name: DRIVER_PROJECT },
    state: 'READY',
    readyState: 'READY',
    target: null,
    meta: { githubCommitSha: EXPECTED_SOURCE_SHA, githubCommitRef: EXPECTED_SOURCE_REF },
    createdAt: 1750000000000,
    ...overrides,
  };
}

function envRecord(overrides = {}) {
  return {
    id: DRIVER_ENV_ENTRY_ID,
    key: DRIVER_ENV_KEY,
    type: 'encrypted',
    target: ['preview'],
    gitBranch: 'main',
    createdAt: 1750000000000,
    updatedAt: 1750000001000,
    // Provider always carries a value/ciphertext shape; projection must drop it.
    value: 'encrypted-or-plaintext-value-that-must-never-leak-xyz',
    decrypted: false,
    ...overrides,
  };
}

function envListPayload(records) {
  return { envs: records ?? [envRecord()] };
}

/** Counting fetch seam routing deployment vs env-list by URL. */
function mockFetch({ deployment = deploymentPayload(), envList = envListPayload() } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const href = String(url);
    if (href.includes('/v13/deployments/')) {
      return { ok: true, json: async () => deployment };
    }
    if (href.includes('/v10/projects/') && href.includes('/env')) {
      return { ok: true, json: async () => envList };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { calls, fetchImpl };
}

function deploymentCalls(calls) {
  return calls.filter((call) => call.url.includes('/v13/deployments/'));
}

function envCalls(calls) {
  return calls.filter((call) => call.url.includes('/v10/projects/') && call.url.includes('/env'));
}

// ---------------------------------------------------------------------------
// 1. credential missing -> provider calls 0
// ---------------------------------------------------------------------------

test('1. credential missing blocks before any provider call', async () => {
  assert.equal(hasReadCredential({}), false);
  assert.equal(hasReadCredential({ [READ_CREDENTIAL_NAME]: '' }), false);
  assert.equal(hasReadCredential({ [READ_CREDENTIAL_NAME]: '   ' }), false);
  assert.throws(() => resolveReadCredential({}), (error) => error?.code === 'READ_CREDENTIAL_NOT_PROVISIONED');
  assert.throws(
    () => resolveReadCredential({ [READ_CREDENTIAL_NAME]: '' }),
    (error) => error?.code === 'READ_CREDENTIAL_NOT_PROVISIONED',
  );

  const { calls, fetchImpl } = mockFetch();
  await assert.rejects(
    readDriverPreviewRevision({ env: {}, target: exactTarget(), fetchImpl }),
    (error) => error?.code === 'READ_CREDENTIAL_NOT_PROVISIONED',
  );
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// 2. wrong driver identity -> provider calls 0
// ---------------------------------------------------------------------------

test('2. wrong driver identity blocks before any provider call', async () => {
  const cases = [
    [{ project: 'greenhubconsumer' }, 'PROJECT_MISMATCH'],
    [{ projectId: 'prj_WRONG' }, 'PROJECT_ID_MISMATCH'],
    [{ envEntryId: 'WRONG_ENTRY' }, 'ENV_ENTRY_ID_MISMATCH'],
    [{ envKey: 'WRONG_KEY' }, 'ENV_KEY_MISMATCH'],
    [{ deploymentId: 'dpl_WRONG0000000000000000' }, 'DEPLOYMENT_ID_MISMATCH'],
    [{ sourceSha: 'b'.repeat(40) }, 'SOURCE_SHA_MISMATCH'],
    [{ sourceRef: 'wrong/ref' }, 'SOURCE_REF_MISMATCH'],
  ];
  for (const [override, code] of cases) {
    assert.throws(
      () => assertExactDriverReadTarget(exactTarget(override)),
      (error) => error?.code === code,
      `${code} must block`,
    );
    const { calls, fetchImpl } = mockFetch();
    await assert.rejects(
      readDriverPreviewRevision({ env: readEnv(), target: exactTarget(override), fetchImpl }),
      (error) => error?.code === code,
    );
    assert.equal(calls.length, 0);
  }
});

// ---------------------------------------------------------------------------
// 3. production request -> provider calls 0
// ---------------------------------------------------------------------------

test('3. production (or any non-preview) request is hard-blocked', async () => {
  for (const environment of ['production', 'PRODUCTION', 'Production', 'staging', '', null, undefined]) {
    assert.throws(
      () => assertExactDriverReadTarget(exactTarget({ environment })),
      (error) => error?.code === 'PRODUCTION_TARGET_BLOCKED',
      `environment ${JSON.stringify(environment)} must block`,
    );
    const { calls, fetchImpl } = mockFetch();
    await assert.rejects(
      readDriverPreviewRevision({ env: readEnv(), target: exactTarget({ environment }), fetchImpl }),
      (error) => error?.code === 'PRODUCTION_TARGET_BLOCKED',
    );
    assert.equal(calls.length, 0);
  }
});

// ---------------------------------------------------------------------------
// Mutation / decrypt / teamId / write-fallback vectors -> 0 calls
// ---------------------------------------------------------------------------

test('mutation method, decrypt=true, teamId override, write fallback all block with 0 calls', async () => {
  assert.throws(
    () => assertExactDriverReadTarget({ ...exactTarget(), method: 'POST' }),
    (error) => error?.code === 'MUTATION_METHOD_FORBIDDEN',
  );
  assert.throws(
    () => assertExactDriverReadTarget({ ...exactTarget(), method: 'PATCH' }),
    (error) => error?.code === 'MUTATION_METHOD_FORBIDDEN',
  );
  assert.throws(
    () => assertExactDriverReadTarget({ ...exactTarget(), decrypt: true }),
    (error) => error?.code === 'DECRYPT_FORBIDDEN',
  );
  assert.throws(
    () => assertExactDriverReadTarget({ ...exactTarget(), decrypt: 'true' }),
    (error) => error?.code === 'DECRYPT_FORBIDDEN',
  );
  assert.throws(
    () => assertExactDriverReadTarget({ ...exactTarget(), teamId: 'team_WRONG' }),
    (error) => error?.code === 'TEAM_QUERY_FORBIDDEN',
  );
  assert.throws(
    () => assertExactDriverReadTarget({ ...exactTarget(), writeToken: 'write-token-x' }),
    (error) => error?.code === 'WRITE_CREDENTIAL_FALLBACK_FORBIDDEN',
  );

  for (const badTarget of [
    exactTarget({ method: 'POST' }),
    exactTarget({ decrypt: true }),
    exactTarget({ teamId: 'team_WRONG' }),
    exactTarget({ writeToken: 'write-token-x' }),
  ]) {
    const { calls, fetchImpl } = mockFetch();
    await assert.rejects(readDriverPreviewRevision({ env: readEnv(), target: badTarget, fetchImpl }));
    assert.equal(calls.length, 0);
  }
});

// ---------------------------------------------------------------------------
// 4. GET-only source contract
// ---------------------------------------------------------------------------

test('4. source contract is GET-only', () => {
  const source = readFileSync(MODULE_PATH, 'utf8');
  assert.match(source, /method:\s*'GET'/);
  assert.equal(source.includes("method: 'POST'"), false);
  assert.equal(source.includes('method: "POST"'), false);
  assert.equal(source.includes("method: 'PATCH'"), false);
  assert.equal(source.includes('method: "PATCH"'), false);
  assert.equal(source.includes("method: 'PUT'"), false);
  assert.equal(source.includes('method: "PUT"'), false);
  assert.equal(source.includes("method: 'DELETE'"), false);
  assert.equal(source.includes('method: "DELETE"'), false);
  // decrypt=true is never SENT: no decrypt query is ever constructed. The
  // literal may only appear inside fail-closed guards/docs that forbid it.
  assert.equal(source.includes('?decrypt='), false);
  assert.equal(source.includes('&decrypt='), false);
  assert.match(source, /DECRYPT_FORBIDDEN/);
  assert.match(source, /assertNoDecryptQuery/);
  // Built read paths never carry decrypt by construction.
  assert.equal(vercelDeploymentReadPath(PINNED_DRIVER_DEPLOYMENT_ID).includes('decrypt'), false);
  assert.equal(vercelDriverEnvListPath(DRIVER_PROJECT_ID).includes('decrypt'), false);
  // No deployment creation / env mutation surface.
  assert.equal(source.includes('/v13/deployments?'), false);
  assert.equal(source.includes('preview-exact/'), false);
  assert.equal(source.includes('git push'), false);
});

// ---------------------------------------------------------------------------
// 5. write credential fallback absent
// ---------------------------------------------------------------------------

test('5. write credential alone never authorizes a read', async () => {
  assert.equal(WRITE_CREDENTIAL_NAME, 'VERCEL_EXACT_PREVIEW_DRIVER_TOKEN');
  assert.equal(READ_CREDENTIAL_NAME, 'ROUND_DIRECT_E2E_VERCEL_READ_TOKEN');
  const writeOnlyEnv = { [WRITE_CREDENTIAL_NAME]: 'write-token-for-tests' };
  assert.equal(hasReadCredential(writeOnlyEnv), false);
  assert.throws(
    () => resolveReadCredential(writeOnlyEnv),
    (error) => error?.code === 'READ_CREDENTIAL_NOT_PROVISIONED',
  );
  const { calls, fetchImpl } = mockFetch();
  await assert.rejects(
    readDriverPreviewRevision({ env: writeOnlyEnv, target: exactTarget(), fetchImpl }),
    (error) => error?.code === 'READ_CREDENTIAL_NOT_PROVISIONED',
  );
  assert.equal(calls.length, 0);

  // Both present: transport uses the READ value only.
  const readToken = 'read-token-aaa-001';
  const writeToken = 'write-token-bbb-002';
  const both = { [READ_CREDENTIAL_NAME]: readToken, [WRITE_CREDENTIAL_NAME]: writeToken };
  assert.equal(resolveReadCredential(both), readToken);
  const routed = mockFetch();
  const result = await readDriverPreviewRevision({ env: both, target: exactTarget(), fetchImpl: routed.fetchImpl });
  assert.equal(routed.calls.length, 2);
  for (const call of routed.calls) {
    assert.equal(call.init.headers.Authorization, `Bearer ${readToken}`);
    assert.equal(String(call.init.headers.Authorization).includes(writeToken), false);
  }
  assert.equal(JSON.stringify(result).includes(writeToken), false);
});

// ---------------------------------------------------------------------------
// 6+7. deployment GET + env GET each exactly once on success
// ---------------------------------------------------------------------------

test('6+7. success performs exactly one deployment GET and one env GET', async () => {
  const { calls, fetchImpl } = mockFetch();
  const result = await readDriverPreviewRevision({ env: readEnv(), target: exactTarget(), fetchImpl });
  assert.equal(calls.length, 2);
  assert.equal(result.providerCalls, 2);
  assert.equal(result.deploymentCalls, 1);
  assert.equal(result.envCalls, 1);

  const dCalls = deploymentCalls(calls);
  const eCalls = envCalls(calls);
  assert.equal(dCalls.length, 1);
  assert.equal(eCalls.length, 1);

  assert.ok(dCalls[0].url.startsWith(`${VERCEL_API_ORIGIN}/v13/deployments/`));
  assert.ok(dCalls[0].url.includes(encodeURIComponent(PINNED_DRIVER_DEPLOYMENT_ID)));
  assert.ok(dCalls[0].url.includes(`teamId=${VERCEL_TEAM_ID}`));
  assert.equal(dCalls[0].init.method, 'GET');
  assert.equal(eCalls[0].init.method, 'GET');

  assert.ok(eCalls[0].url.startsWith(`${VERCEL_API_ORIGIN}/v10/projects/${encodeURIComponent(DRIVER_PROJECT_ID)}/env`));
  assert.ok(eCalls[0].url.includes(`teamId=${VERCEL_TEAM_ID}`));
  assert.equal(eCalls[0].url.includes('decrypt'), false);
  assert.equal(assertNoDecryptQuery(eCalls[0].url), true);

  // Canonical paths carry no decrypt query by construction.
  assert.equal(vercelDeploymentReadPath(PINNED_DRIVER_DEPLOYMENT_ID).includes('decrypt'), false);
  assert.equal(vercelDriverEnvListPath(DRIVER_PROJECT_ID).includes('decrypt'), false);
  assert.equal(vercelDriverEnvListPath(DRIVER_PROJECT_ID).includes('/v10/projects/'), true);
});

// ---------------------------------------------------------------------------
// 8. env id/key exact match
// ---------------------------------------------------------------------------

test('8. env id/key exact match gates the single record', async () => {
  const { fetchImpl } = mockFetch();
  const result = await readDriverPreviewRevision({ env: readEnv(), target: exactTarget(), fetchImpl });
  assert.equal(result.env.id, DRIVER_ENV_ENTRY_ID);
  assert.equal(result.env.key, DRIVER_ENV_KEY);

  // Provider record with wrong key but right id -> key mismatch closed.
  const wrongKeyList = envListPayload([envRecord({ key: 'WRONG_KEY' })]);
  const routedWrongKey = mockFetch({ envList: wrongKeyList });
  await assert.rejects(
    readDriverPreviewRevision({ env: readEnv(), target: exactTarget(), fetchImpl: routedWrongKey.fetchImpl }),
    (error) => error?.code === 'ENV_KEY_MISMATCH' || error?.code === 'ENV_ENTRY_NOT_FOUND',
  );

  // Provider record with wrong id but right key -> id mismatch closed.
  const wrongIdList = envListPayload([envRecord({ id: 'WRONG_ID' })]);
  const routedWrongId = mockFetch({ envList: wrongIdList });
  await assert.rejects(
    readDriverPreviewRevision({ env: readEnv(), target: exactTarget(), fetchImpl: routedWrongId.fetchImpl }),
    (error) => error?.code === 'ENV_ENTRY_ID_MISMATCH' || error?.code === 'ENV_ENTRY_NOT_FOUND',
  );
});

// ---------------------------------------------------------------------------
// 9. duplicate / empty env records fail closed
// ---------------------------------------------------------------------------

test('9. duplicate env records fail closed; empty list fails closed', async () => {
  const dupList = envListPayload([envRecord(), envRecord()]);
  const routedDup = mockFetch({ envList: dupList });
  await assert.rejects(
    readDriverPreviewRevision({ env: readEnv(), target: exactTarget(), fetchImpl: routedDup.fetchImpl }),
    (error) => error?.code === 'DUPLICATE_ENV_RECORDS',
  );
  assert.throws(
    () => filterSingleEnvRecord({ envListPayload: dupList }),
    (error) => error?.code === 'DUPLICATE_ENV_RECORDS',
  );

  const emptyList = envListPayload([]);
  const routedEmpty = mockFetch({ envList: emptyList });
  await assert.rejects(
    readDriverPreviewRevision({ env: readEnv(), target: exactTarget(), fetchImpl: routedEmpty.fetchImpl }),
    (error) => error?.code === 'ENV_ENTRY_NOT_FOUND',
  );
  assert.throws(
    () => filterSingleEnvRecord({ envListPayload: emptyList }),
    (error) => error?.code === 'ENV_ENTRY_NOT_FOUND',
  );
});

// ---------------------------------------------------------------------------
// After-read: malformed target/gitBranch + unexpected project identity
// ---------------------------------------------------------------------------

test('after-read malformed target/gitBranch and unexpected project identity fail closed', async () => {
  assert.throws(
    () => projectEnvMetadata(envRecord({ target: 42 })),
    (error) => error?.code === 'MALFORMED_TARGET_METADATA',
  );
  assert.throws(
    () => projectEnvMetadata(envRecord({ target: ['preview', 'unknown-env'] })),
    (error) => error?.code === 'MALFORMED_TARGET_METADATA',
  );
  assert.throws(
    () => projectEnvMetadata(envRecord({ gitBranch: 42 })),
    (error) => error?.code === 'MALFORMED_GITBRANCH_METADATA',
  );
  assert.throws(
    () => projectEnvMetadata({ id: DRIVER_ENV_ENTRY_ID, key: DRIVER_ENV_KEY }),
    (error) => error?.code === 'UNSAFE_RESPONSE_SHAPE',
  );

  assert.throws(
    () =>
      projectDeploymentMetadata({
        payload: deploymentPayload({ projectId: 'prj_WRONG', project: { id: 'prj_WRONG', name: 'wrong' } }),
      }),
    (error) => error?.code === 'PROJECT_ID_MISMATCH' || error?.code === 'PROJECT_MISMATCH',
  );
  assert.throws(
    () => projectDeploymentMetadata({ payload: deploymentPayload({ id: 'dpl_WRONG0000000000000000', uid: 'dpl_WRONG0000000000000000' }) }),
    (error) => error?.code === 'DEPLOYMENT_ID_MISMATCH',
  );
  assert.throws(
    () => projectDeploymentMetadata({ payload: deploymentPayload({ target: 42 }) }),
    (error) => error?.code === 'MALFORMED_TARGET_METADATA',
  );
});

// ---------------------------------------------------------------------------
// 10. metadata projection carries no value
// ---------------------------------------------------------------------------

test('10. metadata projection carries value-free whitelists only', async () => {
  const rawValue = 'allowlist-raw-value-must-never-leak-001';
  const secretToken = 'read-secret-token-001-xyz';
  const { fetchImpl } = mockFetch({
    envList: envListPayload([envRecord({ value: rawValue, vsmValue: rawValue, decrypted: true })]),
  });
  const result = await readDriverPreviewRevision({ env: readEnv(secretToken), target: exactTarget(), fetchImpl });

  assert.deepEqual([...Object.keys(result.env)].sort(), [...ALLOWED_ENV_KEYS].sort());
  assert.deepEqual([...Object.keys(result.deployment)].sort(), [...ALLOWED_DEPLOYMENT_KEYS].sort());
  for (const forbidden of ['value', 'decrypted', 'vsmValue', 'legacyValue', 'secret', 'ciphertext']) {
    assert.equal(Object.hasOwn(result.env, forbidden), false, `env must not carry ${forbidden}`);
    assert.equal(Object.hasOwn(result.deployment, forbidden), false, `deployment must not carry ${forbidden}`);
  }
  const serializedEnv = JSON.stringify(result.env);
  const serializedDeployment = JSON.stringify(result.deployment);
  assert.equal(serializedEnv.includes(rawValue), false);
  assert.equal(serializedEnv.toLowerCase().includes('allowlist-raw-value'), false);
  assert.equal(serializedEnv.includes(secretToken), false);
  assert.equal(serializedDeployment.includes(secretToken), false);
  assert.equal(serializedDeployment.includes(rawValue), false);
});

// ---------------------------------------------------------------------------
// 11. serialized result carries no synthetic secret/value
// ---------------------------------------------------------------------------

test('11. serialized result carries no credential or raw value material', async () => {
  const secretToken = 'super-secret-read-token-45E-xyz-999';
  const rawValue = 'synthetic-allowlist-raw-zzz-123';
  const { fetchImpl } = mockFetch({
    deployment: deploymentPayload(),
    envList: envListPayload([envRecord({ value: rawValue })]),
  });
  const result = await readDriverPreviewRevision({ env: readEnv(secretToken), target: exactTarget(), fetchImpl });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(secretToken), false);
  assert.equal(serialized.includes(rawValue), false);
  assert.equal(resultExposesSecret(result, secretToken), false);
  assert.equal(resultExposesSecret(result, rawValue), false);
  assert.equal(result.credentialValueRecorded, false);
  assert.equal(result.credentialName, READ_CREDENTIAL_NAME);
});

// ---------------------------------------------------------------------------
// 12. createdAt/updatedAt unavailable -> FIELD_UNAVAILABLE
// ---------------------------------------------------------------------------

test('12. missing timestamps project as FIELD_UNAVAILABLE, never estimated', async () => {
  const noTimeRecord = envRecord();
  delete noTimeRecord.createdAt;
  delete noTimeRecord.updatedAt;
  const projected = projectEnvMetadata(noTimeRecord);
  assert.equal(projected.createdAt, FIELD_UNAVAILABLE);
  assert.equal(projected.updatedAt, FIELD_UNAVAILABLE);

  const noBranchRecord = envRecord();
  delete noBranchRecord.gitBranch;
  assert.equal(projectEnvMetadata(noBranchRecord).gitBranch, FIELD_UNAVAILABLE);

  const noTimeDeployment = deploymentPayload();
  delete noTimeDeployment.createdAt;
  const projectedDeployment = projectDeploymentMetadata({ payload: noTimeDeployment });
  assert.equal(projectedDeployment.createdAt, FIELD_UNAVAILABLE);

  const noRefDeployment = deploymentPayload({ meta: { githubCommitSha: EXPECTED_SOURCE_SHA } });
  assert.equal(projectDeploymentMetadata({ payload: noRefDeployment }).sourceRef, FIELD_UNAVAILABLE);

  const { fetchImpl } = mockFetch({ envList: envListPayload([noTimeRecord]) });
  const result = await readDriverPreviewRevision({ env: readEnv(), target: exactTarget(), fetchImpl });
  assert.equal(result.env.createdAt, FIELD_UNAVAILABLE);
  assert.equal(result.env.updatedAt, FIELD_UNAVAILABLE);
});

// ---------------------------------------------------------------------------
// 13. provider raw response is never dumped to artifact/log
// ---------------------------------------------------------------------------

test('13. provider raw response is never dumped', async () => {
  const source = readFileSync(MODULE_PATH, 'utf8');
  assert.equal(source.includes('JSON.stringify(payload'), false);
  assert.equal(source.includes('JSON.stringify(deploymentPayload'), false);
  assert.equal(source.includes('JSON.stringify(envListPayload'), false);
  assert.equal(source.includes('console.log(payload'), false);
  assert.equal(source.includes('console.log(deploymentPayload'), false);
  assert.equal(source.includes('console.log(envListPayload'), false);
  assert.equal(source.includes('process.stdout.write(JSON.stringify(payload'), false);

  const rawValue = 'raw-dump-check-value-qqq-777';
  const { fetchImpl } = mockFetch({ envList: envListPayload([envRecord({ value: rawValue })]) });
  const result = await readDriverPreviewRevision({ env: readEnv(), target: exactTarget(), fetchImpl });
  assert.equal('envListPayload' in result, false);
  assert.equal('deploymentPayload' in result, false);
  assert.equal('raw' in result, false);
  assert.equal(JSON.stringify(result).includes(rawValue), false);
});

// ---------------------------------------------------------------------------
// Provider HTTP failure fails closed without leaking the token
// ---------------------------------------------------------------------------

test('provider GET failure fails closed without leaking the token', async () => {
  const secret = 'failure-path-secret-token-45E';
  const rejectedFetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(
    requestVercelDeploymentMetadata({ deploymentId: PINNED_DRIVER_DEPLOYMENT_ID, readToken: secret, fetchImpl: rejectedFetch }),
    (error) => error?.code === 'VERCEL_API_HTTP_403',
  );
  await assert.rejects(
    requestVercelEnvList({ projectId: DRIVER_PROJECT_ID, readToken: secret, fetchImpl: rejectedFetch }),
    (error) => error?.code === 'VERCEL_API_HTTP_403',
  );
  const throwingFetch = async () => {
    throw new Error('network down');
  };
  await assert.rejects(
    requestVercelDeploymentMetadata({ deploymentId: PINNED_DRIVER_DEPLOYMENT_ID, readToken: secret, fetchImpl: throwingFetch }),
    (error) => error?.code === 'VERCEL_API_UNAVAILABLE',
  );
  try {
    await requestVercelDeploymentMetadata({ deploymentId: PINNED_DRIVER_DEPLOYMENT_ID, readToken: secret, fetchImpl: rejectedFetch });
    assert.fail('must throw');
  } catch (error) {
    assert.equal(String(error?.message ?? '').includes(secret), false);
    assert.equal(JSON.stringify(error ?? {}).includes(secret), false);
  }
});

// ---------------------------------------------------------------------------
// 14. 45C/45D contract is consumed, not rewritten (regression guard)
// ---------------------------------------------------------------------------

test('14. 45C/45D write/successor contract is untouched and consistent', async () => {
  const bridgeSource = readFileSync(BRIDGE_PATH, 'utf8');
  // This read-only module never carries the write PATCH seam.
  const readerSource = readFileSync(MODULE_PATH, 'utf8');
  assert.equal(readerSource.includes("from './driver-preview-allowlist-reprobe.mjs'"), false);
  assert.equal(readerSource.includes('from "./driver-preview-allowlist-reprobe.mjs"'), false);
  assert.equal(readerSource.includes('updateDriverPreviewEnvEntry'), false);
  assert.equal(readerSource.includes('planDriverAllowlistMutation'), false);
  // Canonical identity constants stay converged with the bridge.
  const bridge = await import('./driver-preview-allowlist-reprobe.mjs');
  assert.equal(bridge.DRIVER_PROJECT, DRIVER_PROJECT);
  assert.equal(bridge.DRIVER_PROJECT_ID, DRIVER_PROJECT_ID);
  assert.equal(bridge.DRIVER_ENV_ENTRY_ID, DRIVER_ENV_ENTRY_ID);
  assert.equal(bridge.DRIVER_ENV_KEY, DRIVER_ENV_KEY);
  assert.equal(bridge.OLD_DRIVER_DEPLOYMENT_ID, OLD_DRIVER_DEPLOYMENT_ID);
  assert.equal(bridge.EXPECTED_SOURCE_SHA, EXPECTED_SOURCE_SHA);
  assert.equal(bridge.READ_CREDENTIAL_NAME, READ_CREDENTIAL_NAME);
  assert.equal(bridge.WRITE_CREDENTIAL_NAME, WRITE_CREDENTIAL_NAME);
  assert.equal(bridgeSource.includes("method: 'PATCH'"), true);
  // Reader stays GET-only while the bridge stays the sole PATCH owner.
  assert.equal(readerSource.includes("method: 'PATCH'"), false);
});

// ---------------------------------------------------------------------------
// Workflow source-contract test (45E read-only wrapper)
// ---------------------------------------------------------------------------

test('workflow contract: dispatch-only read wrapper with read credential only', () => {
  const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
  assert.match(workflow, /workflow_dispatch/);
  assert.equal(/^\s*push\s*:/m.test(workflow), false);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /round-direct-e2e/);
  assert.match(workflow, /secrets\.ROUND_DIRECT_E2E_VERCEL_READ_TOKEN/);
  assert.match(workflow, /ROUND_DIRECT_E2E_VERCEL_READ_TOKEN/);
  // Write credential must never appear in the read wrapper.
  assert.equal(workflow.includes('VERCEL_EXACT_PREVIEW_DRIVER_TOKEN'), false);
  assert.equal(workflow.includes('secrets.VERCEL_EXACT_PREVIEW_DRIVER_TOKEN'), false);
  // Exact driver preview identity is pinned.
  for (const literal of [
    DRIVER_PROJECT_ID,
    DRIVER_ENV_ENTRY_ID,
    DRIVER_ENV_KEY,
    PINNED_DRIVER_DEPLOYMENT_ID,
    EXPECTED_SOURCE_SHA,
    EXPECTED_SOURCE_REF,
  ]) {
    assert.ok(workflow.includes(literal), `${literal} must be pinned in workflow`);
  }
  // Reader only: no mutation, no E2E, no chaining, no decrypt query sent.
  assert.equal(workflow.includes('?decrypt='), false);
  assert.equal(workflow.includes('&decrypt='), false);
  assert.match(workflow, /read-driver-preview-revision\.mjs/);
  assert.equal(workflow.includes('planDriverAllowlistMutation'), false);
  assert.equal(workflow.includes('updateDriverPreviewEnvEntry'), false);
  assert.equal(workflow.includes('create-exact-preview-deployment.yml'), false);
  assert.equal(workflow.includes('driver-preview-allowlist-reprobe.yml'), false);
  assert.equal(workflow.includes('probe-auth'), false);
  assert.equal(workflow.includes('e2e-round-direct'), false);
  // GET-only evidence in workflow inline script.
  assert.match(workflow, /method:\s*'GET'/);
  assert.equal(workflow.includes("method: 'POST'"), false);
  assert.equal(workflow.includes("method: 'PATCH'"), false);
});
