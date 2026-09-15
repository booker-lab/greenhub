/**
 * Deterministic verification for the driver Preview allowlist secure bridge
 * (PILOT-AUTH-DRIVER-ALLOWLIST-SECURE-BRIDGE-43C).
 *
 * Run: node --test scripts/vercel/driver-preview-allowlist-reprobe.spec.mjs
 *
 * Fully provider-free: the Vercel client is an in-memory counting mock.
 * No workflow is dispatched, no Vercel mutation runs, no auth is reprobed.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertAdditiveInvariant,
  assertDriverScope,
  assertExactDriverTarget,
  assertProviderReadbackMatches,
  buildAdditiveAllowlist,
  buildAllowlistEvidence,
  buildDriverExactProvisioningRequest,
  DRIVER_ENV_ENTRY_ID,
  DRIVER_ENV_KEY,
  DRIVER_PREVIEW_ENVIRONMENT,
  DRIVER_PROJECT,
  DRIVER_PROJECT_ID,
  DRIVER_TEAM_ID,
  evidenceExposesRawIdentity,
  EXPECTED_SOURCE_SHA,
  hasWriteCredential,
  OLD_DRIVER_DEPLOYMENT_ID,
  planDriverAllowlistMutation,
  READ_CREDENTIAL_NAME,
  resolveWriteCredential,
  shouldProceedToProbe,
  updateDriverPreviewEnvEntry,
  validateNewDriverDeployment,
  WRITE_CREDENTIAL_NAME,
} from './driver-preview-allowlist-reprobe.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'driver-preview-allowlist-reprobe.yml');
const MODULE_PATH = path.join(SCRIPT_DIR, 'driver-preview-allowlist-reprobe.mjs');

const CANONICAL = 'canonical-driver@example.test';
const UNRELATED_A = 'teammate-a@example.test';
const UNRELATED_B = 'teammate-b@example.test';

function exactTarget(overrides = {}) {
  return {
    app: 'driver',
    teamId: DRIVER_TEAM_ID,
    project: DRIVER_PROJECT,
    projectId: DRIVER_PROJECT_ID,
    environment: DRIVER_PREVIEW_ENVIRONMENT,
    envEntryId: DRIVER_ENV_ENTRY_ID,
    envKey: DRIVER_ENV_KEY,
    oldDeploymentId: OLD_DRIVER_DEPLOYMENT_ID,
    sourceSha: EXPECTED_SOURCE_SHA,
    ...overrides,
  };
}

function writeEnv() {
  return { [WRITE_CREDENTIAL_NAME]: 'write-token-for-tests' };
}

function countingClient() {
  const calls = [];
  return {
    calls,
    updateDriverPreviewEnvEntry: async (args) => {
      calls.push(args);
      return { ok: true };
    },
  };
}

function driverPreviewPayload({ sha = EXPECTED_SOURCE_SHA, state = 'READY', target = null } = {}) {
  const deploymentId = 'dpl_NewDriverPreview1234567890abcdef';
  return {
    id: deploymentId,
    uid: deploymentId,
    name: DRIVER_PROJECT,
    projectId: DRIVER_PROJECT_ID,
    project: { id: DRIVER_PROJECT_ID, name: DRIVER_PROJECT },
    state,
    readyState: state,
    target,
    url: `${DRIVER_PROJECT}-abc123.vercel.app`,
    meta: { githubCommitSha: sha },
  };
}

// ---------------------------------------------------------------------------
// 1. write secret missing -> mutation client 0 calls
// ---------------------------------------------------------------------------

test('1. write secret missing blocks before any provider call', async () => {
  assert.equal(hasWriteCredential({}), false);
  assert.equal(hasWriteCredential({ [WRITE_CREDENTIAL_NAME]: '' }), false);
  assert.equal(hasWriteCredential({ [WRITE_CREDENTIAL_NAME]: '   ' }), false);
  assert.throws(() => resolveWriteCredential({}), (error) => error?.code === 'WRITE_CREDENTIAL_NOT_PROVISIONED');
  assert.throws(
    () => resolveWriteCredential({ [WRITE_CREDENTIAL_NAME]: '' }),
    (error) => error?.code === 'WRITE_CREDENTIAL_NOT_PROVISIONED',
  );

  const client = countingClient();
  await assert.rejects(
    planDriverAllowlistMutation({
      env: {},
      target: exactTarget(),
      currentRaw: UNRELATED_A,
      canonicalIdentity: CANONICAL,
      vercelClient: client,
    }),
    (error) => error?.code === 'WRITE_CREDENTIAL_NOT_PROVISIONED',
  );
  assert.equal(client.calls.length, 0);
});

// ---------------------------------------------------------------------------
// 2. read token only -> no write fallback
// ---------------------------------------------------------------------------

test('2. read token alone never authorizes a write', async () => {
  const readOnlyEnv = { [READ_CREDENTIAL_NAME]: 'read-token-for-tests' };
  assert.equal(hasWriteCredential(readOnlyEnv), false);
  assert.throws(
    () => resolveWriteCredential(readOnlyEnv),
    (error) => error?.code === 'WRITE_CREDENTIAL_NOT_PROVISIONED',
  );
  const client = countingClient();
  await assert.rejects(
    planDriverAllowlistMutation({
      env: readOnlyEnv,
      target: exactTarget(),
      currentRaw: UNRELATED_A,
      canonicalIdentity: CANONICAL,
      vercelClient: client,
    }),
    (error) => error?.code === 'WRITE_CREDENTIAL_NOT_PROVISIONED',
  );
  assert.equal(client.calls.length, 0);

  // Even both present: resolution uses the write name (read value is ignored).
  const both = { [WRITE_CREDENTIAL_NAME]: 'write-token-for-tests', [READ_CREDENTIAL_NAME]: 'read-token-for-tests' };
  assert.equal(resolveWriteCredential(both), 'write-token-for-tests');
});

// ---------------------------------------------------------------------------
// 3. Production target -> hard block
// ---------------------------------------------------------------------------

test('3. production (or any non-preview) target is hard-blocked', async () => {
  for (const environment of ['production', 'PRODUCTION', 'Production', 'staging', '', null, undefined]) {
    assert.throws(
      () => assertExactDriverTarget(exactTarget({ environment })),
      (error) => error?.code === 'PRODUCTION_TARGET_BLOCKED',
      `environment ${JSON.stringify(environment)} must block`,
    );
  }
  const client = countingClient();
  await assert.rejects(
    planDriverAllowlistMutation({
      env: writeEnv(),
      target: exactTarget({ environment: 'production' }),
      currentRaw: UNRELATED_A,
      canonicalIdentity: CANONICAL,
      vercelClient: client,
    }),
    (error) => error?.code === 'PRODUCTION_TARGET_BLOCKED',
  );
  assert.equal(client.calls.length, 0);
});

// ---------------------------------------------------------------------------
// 4-9. exact identity mismatches -> block
// ---------------------------------------------------------------------------

test('4. wrong team blocks', () => {
  assert.throws(
    () => assertExactDriverTarget(exactTarget({ teamId: 'team_WRONG' })),
    (error) => error?.code === 'TEAM_MISMATCH',
  );
});

test('5. wrong project ID blocks', () => {
  assert.throws(
    () => assertExactDriverTarget(exactTarget({ projectId: 'prj_WRONG' })),
    (error) => error?.code === 'PROJECT_ID_MISMATCH',
  );
  assert.throws(
    () => assertExactDriverTarget(exactTarget({ project: 'greenhub-consumer' })),
    (error) => error?.code === 'PROJECT_MISMATCH',
  );
});

test('6. wrong env entry ID blocks', () => {
  assert.throws(
    () => assertExactDriverTarget(exactTarget({ envEntryId: 'WRONG_ENTRY' })),
    (error) => error?.code === 'ENV_ENTRY_ID_MISMATCH',
  );
});

test('7. wrong env key blocks', () => {
  assert.throws(
    () => assertExactDriverTarget(exactTarget({ envKey: 'ROUND_DIRECT_E2E_CONSUMER_EMAILS' })),
    (error) => error?.code === 'ENV_KEY_MISMATCH',
  );
});

test('8. wrong old deployment ID blocks', () => {
  assert.throws(
    () => assertExactDriverTarget(exactTarget({ oldDeploymentId: 'dpl_WRONG0000000000000000' })),
    (error) => error?.code === 'OLD_DEPLOYMENT_MISMATCH',
  );
});

test('9. wrong expected source SHA blocks', () => {
  assert.throws(
    () => assertExactDriverTarget(exactTarget({ sourceSha: 'b'.repeat(40) })),
    (error) => error?.code === 'SOURCE_SHA_MISMATCH',
  );
});

test('provider readback mismatch blocks before mutation', () => {
  const goodReadback = {
    teamId: DRIVER_TEAM_ID,
    project: DRIVER_PROJECT,
    projectId: DRIVER_PROJECT_ID,
    environment: 'preview',
    envEntryId: DRIVER_ENV_ENTRY_ID,
    envKey: DRIVER_ENV_KEY,
    oldDeploymentId: OLD_DRIVER_DEPLOYMENT_ID,
    sourceSha: EXPECTED_SOURCE_SHA,
  };
  assert.equal(assertProviderReadbackMatches({ readback: goodReadback }), true);
  const cases = [
    [{ ...goodReadback, teamId: 'team_WRONG' }, 'TEAM_MISMATCH'],
    [{ ...goodReadback, projectId: 'prj_WRONG' }, 'PROJECT_ID_MISMATCH'],
    [{ ...goodReadback, environment: 'production' }, 'PRODUCTION_TARGET_BLOCKED'],
    [{ ...goodReadback, envEntryId: 'WRONG' }, 'ENV_ENTRY_ID_MISMATCH'],
    [{ ...goodReadback, envKey: 'WRONG' }, 'ENV_KEY_MISMATCH'],
    [{ ...goodReadback, oldDeploymentId: 'dpl_WRONG' }, 'OLD_DEPLOYMENT_MISMATCH'],
    [{ ...goodReadback, sourceSha: 'b'.repeat(40) }, 'SOURCE_SHA_MISMATCH'],
  ];
  for (const [readback, code] of cases) {
    assert.throws(
      () => assertProviderReadbackMatches({ readback }),
      (error) => error?.code === code,
      `readback mismatch must block with ${code}`,
    );
  }
});

test('mutation transport is preview-only and credential-gated (mock fetch)', async () => {
  const fetchCalls = [];
  const okFetch = async () => {
    fetchCalls.push(true);
    return { ok: true };
  };
  await assert.rejects(
    updateDriverPreviewEnvEntry(
      {
        writeToken: '',
        teamId: DRIVER_TEAM_ID,
        projectId: DRIVER_PROJECT_ID,
        envEntryId: DRIVER_ENV_ENTRY_ID,
        key: DRIVER_ENV_KEY,
        target: 'preview',
        newRaw: UNRELATED_A,
      },
      okFetch,
    ),
    (error) => error?.code === 'WRITE_CREDENTIAL_NOT_PROVISIONED',
  );
  assert.equal(fetchCalls.length, 0);
  await assert.rejects(
    updateDriverPreviewEnvEntry(
      {
        writeToken: 'write-token-for-tests',
        teamId: DRIVER_TEAM_ID,
        projectId: DRIVER_PROJECT_ID,
        envEntryId: DRIVER_ENV_ENTRY_ID,
        key: DRIVER_ENV_KEY,
        target: 'production',
        newRaw: UNRELATED_A,
      },
      okFetch,
    ),
    (error) => error?.code === 'EXACT_TARGET_MISMATCH',
  );
  assert.equal(fetchCalls.length, 0);
  const result = await updateDriverPreviewEnvEntry(
    {
      writeToken: 'write-token-for-tests',
      teamId: DRIVER_TEAM_ID,
      projectId: DRIVER_PROJECT_ID,
      envEntryId: DRIVER_ENV_ENTRY_ID,
      key: DRIVER_ENV_KEY,
      target: 'preview',
      newRaw: `${UNRELATED_A},${CANONICAL}`,
    },
    okFetch,
  );
  assert.equal(result.ok, true);
  assert.equal(fetchCalls.length, 1);
});

// ---------------------------------------------------------------------------
// 10. existing allowlist + canonical identity -> additive-only
// ---------------------------------------------------------------------------

test('10. additive-only merge preserves unrelated members and adds canonical', async () => {
  const currentRaw = `${UNRELATED_A}, ${UNRELATED_B}`;
  const { beforeSet, afterSet, newRaw } = buildAdditiveAllowlist({
    currentRaw,
    canonicalIdentity: CANONICAL,
  });
  assert.ok(beforeSet.includes(UNRELATED_A.toLowerCase()));
  assert.ok(beforeSet.includes(UNRELATED_B.toLowerCase()));
  assert.ok(afterSet.includes(CANONICAL.toLowerCase()));
  assert.ok(afterSet.includes(UNRELATED_A.toLowerCase()));
  assert.ok(afterSet.includes(UNRELATED_B.toLowerCase()));

  const evidence = buildAllowlistEvidence({ beforeSet, afterSet, canonicalIdentity: CANONICAL });
  assert.equal(evidence.CANONICAL_IDENTITY_PRESENT_AFTER, true);
  assert.equal(evidence.UNRELATED_MEMBER_COUNT_PRESERVED, true);
  assert.equal(evidence.MEMBER_COUNT_AFTER, evidence.MEMBER_COUNT_BEFORE + 1);
  assert.equal(assertAdditiveInvariant(evidence), true);

  const client = countingClient();
  const plan = await planDriverAllowlistMutation({
    env: writeEnv(),
    target: exactTarget(),
    currentRaw,
    canonicalIdentity: CANONICAL,
    vercelClient: client,
  });
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].target, 'preview');
  assert.equal(client.calls[0].projectId, DRIVER_PROJECT_ID);
  assert.equal(client.calls[0].envEntryId, DRIVER_ENV_ENTRY_ID);
  assert.equal(plan.evidence.CANONICAL_IDENTITY_PRESENT_AFTER, true);
  assert.equal(plan.evidence.UNRELATED_MEMBER_COUNT_PRESERVED, true);
  assert.ok(!String(client.calls[0].newRaw).includes('production'));
  void newRaw;
});

// ---------------------------------------------------------------------------
// 11. canonical already present -> unrelated set preserved
// ---------------------------------------------------------------------------

test('11. already-present canonical converges without shrinking unrelated set', () => {
  const currentRaw = `${UNRELATED_A}, ${CANONICAL}, ${UNRELATED_B}, ${CANONICAL.toUpperCase()}`;
  const { beforeSet, afterSet } = buildAdditiveAllowlist({
    currentRaw,
    canonicalIdentity: CANONICAL,
  });
  const evidence = buildAllowlistEvidence({ beforeSet, afterSet, canonicalIdentity: CANONICAL });
  assert.equal(evidence.CANONICAL_IDENTITY_PRESENT_BEFORE, true);
  assert.equal(evidence.CANONICAL_IDENTITY_PRESENT_AFTER, true);
  assert.equal(evidence.UNRELATED_MEMBER_COUNT_PRESERVED, true);
  assert.equal(evidence.MEMBER_COUNT_AFTER, evidence.MEMBER_COUNT_BEFORE);
  assert.equal(new Set(afterSet).size, afterSet.length);
  assert.equal(assertAdditiveInvariant(evidence), true);
});

// ---------------------------------------------------------------------------
// 12. raw value / PII never appears in evidence
// ---------------------------------------------------------------------------

test('12. evidence exposes booleans/counts only, never raw identities', () => {
  const currentRaw = `${UNRELATED_A},${UNRELATED_B}`;
  const { beforeSet, afterSet } = buildAdditiveAllowlist({
    currentRaw,
    canonicalIdentity: CANONICAL,
  });
  const evidence = buildAllowlistEvidence({ beforeSet, afterSet, canonicalIdentity: CANONICAL });
  const serialized = JSON.stringify(evidence);
  for (const raw of [CANONICAL, UNRELATED_A, UNRELATED_B]) {
    assert.equal(serialized.toLowerCase().includes(raw.toLowerCase()), false, `${raw} must not leak`);
    assert.equal(evidenceExposesRawIdentity(evidence, raw), false);
  }
  assert.deepEqual(
    Object.keys(evidence).sort(),
    [
      'CANONICAL_IDENTITY_PRESENT_AFTER',
      'CANONICAL_IDENTITY_PRESENT_BEFORE',
      'MEMBER_COUNT_AFTER',
      'MEMBER_COUNT_BEFORE',
      'UNRELATED_MEMBER_COUNT_AFTER',
      'UNRELATED_MEMBER_COUNT_BEFORE',
      'UNRELATED_MEMBER_COUNT_PRESERVED',
    ].sort(),
  );
  for (const value of Object.values(evidence)) {
    assert.equal(typeof value === 'boolean' || typeof value === 'number', true);
  }

  // Error paths never embed secret or raw allowlist values either.
  try {
    resolveWriteCredential({});
    assert.fail('must throw');
  } catch (error) {
    assert.equal(JSON.stringify(error.message).includes('write-token'), false);
  }
});

// ---------------------------------------------------------------------------
// 13. consumer / seller targets -> block
// ---------------------------------------------------------------------------

test('13. consumer/seller targets are isolated out', async () => {
  for (const app of ['consumer', 'seller', 'both', 'Consumer', 'SELLER', '', null, undefined]) {
    assert.throws(
      () => assertDriverScope({ app }),
      (error) => error?.code === 'DRIVER_ONLY_ISOLATION_VIOLATION',
      `app ${JSON.stringify(app)} must block`,
    );
    assert.throws(
      () => assertExactDriverTarget(exactTarget({ app })),
      (error) =>
        error?.code === 'DRIVER_ONLY_ISOLATION_VIOLATION' ||
        error?.code === 'PROJECT_MISMATCH' ||
        error?.code === 'PROJECT_ID_MISMATCH',
      `target app ${JSON.stringify(app)} must block`,
    );
  }
  const client = countingClient();
  await assert.rejects(
    planDriverAllowlistMutation({
      env: writeEnv(),
      target: exactTarget({ app: 'consumer', project: 'greenhubconsumer', projectId: 'prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w' }),
      currentRaw: UNRELATED_A,
      canonicalIdentity: CANONICAL,
      vercelClient: client,
    }),
    (error) => error?.code === 'DRIVER_ONLY_ISOLATION_VIOLATION',
  );
  assert.equal(client.calls.length, 0);
});

// ---------------------------------------------------------------------------
// 14. withLatestCommit / latest-ref flows are absent and unusable
// ---------------------------------------------------------------------------

test('14. no withLatestCommit or latest-ref provisioning path exists', () => {
  const source = readFileSync(MODULE_PATH, 'utf8');
  assert.equal(source.includes('withLatestCommit'), false);
  assert.equal(source.includes('with_latest_commit'), false);
  assert.match(source, /provision-exact-preview\.mjs/);
  assert.throws(
    () => buildDriverExactProvisioningRequest({ sourceSha: 'latest' }),
    (error) => error?.code === 'SOURCE_SHA_MISMATCH',
  );
  assert.throws(
    () => buildDriverExactProvisioningRequest({ sourceSha: 'HEAD' }),
    (error) => error?.code === 'SOURCE_SHA_MISMATCH',
  );
  assert.throws(
    () => buildDriverExactProvisioningRequest({}),
    (error) => error?.code === 'SOURCE_SHA_MISMATCH',
  );
});

// ---------------------------------------------------------------------------
// 15. exact Preview provisioning request uses the expected SHA only
// ---------------------------------------------------------------------------

test('15. provisioning reuses 43A with the exact expected SHA only', () => {
  const request = buildDriverExactProvisioningRequest({ sourceSha: EXPECTED_SOURCE_SHA });
  assert.equal(request.sha, EXPECTED_SOURCE_SHA);
  assert.equal(request.requestedSha, EXPECTED_SOURCE_SHA);
  assert.equal(request.app, 'driver');
  assert.equal(request.scope, 'driver');
  assert.equal(request.ref, `preview-exact/driver/${EXPECTED_SOURCE_SHA}`);
  assert.equal(request.target, null);
  assert.equal(request.production, false);
  assert.throws(
    () => buildDriverExactProvisioningRequest({ sourceSha: 'a'.repeat(40) }),
    (error) => error?.code === 'SOURCE_SHA_MISMATCH',
  );
});

// ---------------------------------------------------------------------------
// 16-17. new deployment readback gate before any probe
// ---------------------------------------------------------------------------

test('16. readback mismatch never proceeds to probe', () => {
  const newId = 'dpl_NewDriverPreview1234567890abcdef';
  const mismatch = validateNewDriverDeployment({
    payload: driverPreviewPayload({ sha: 'b'.repeat(40) }),
    newDeploymentId: newId,
  });
  assert.equal(mismatch.ready, false);
  assert.equal(mismatch.shouldProceedToProbe, false);
  assert.equal(shouldProceedToProbe(mismatch), false);

  const unchanged = validateNewDriverDeployment({
    payload: driverPreviewPayload(),
    newDeploymentId: OLD_DRIVER_DEPLOYMENT_ID,
  });
  assert.equal(unchanged.shouldProceedToProbe, false);
  assert.equal(shouldProceedToProbe(unchanged), false);
});

test('17. non-READY deployment never proceeds to probe; READY preview does', () => {
  for (const state of ['BUILDING', 'QUEUED', 'CANCELED', 'ERROR']) {
    const evidence = validateNewDriverDeployment({
      payload: driverPreviewPayload({ state }),
      newDeploymentId: 'dpl_NewDriverPreview1234567890abcdef',
    });
    assert.equal(evidence.ready, false, `${state} must not be ready`);
    assert.equal(evidence.shouldProceedToProbe, false);
    assert.equal(shouldProceedToProbe(evidence), false);
  }
  const ready = validateNewDriverDeployment({
    payload: driverPreviewPayload(),
    newDeploymentId: 'dpl_NewDriverPreview1234567890abcdef',
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.shouldProceedToProbe, true);
  assert.equal(shouldProceedToProbe(ready), true);
});

// ---------------------------------------------------------------------------
// Workflow source-contract test
// ---------------------------------------------------------------------------

test('workflow contract: dispatch-only mutation, driver preview exact identity', () => {
  const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
  // Manual dispatch exists; automatic push mutation path must not exist.
  assert.match(workflow, /workflow_dispatch/);
  assert.equal(/^\s*push\s*:/m.test(workflow), false);
  // Mutation job is gated to workflow_dispatch.
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
  // Environment + write credential contract.
  assert.match(workflow, /round-direct-e2e/);
  assert.match(workflow, /ROUND_DIRECT_E2E_VERCEL_DRIVER_WRITE_TOKEN/);
  // The read credential must never appear in the mutation job: no fallback vector.
  assert.equal(workflow.includes('ROUND_DIRECT_E2E_VERCEL_READ_TOKEN'), false);
  // Exact driver preview identity is pinned in the workflow.
  for (const literal of [
    DRIVER_TEAM_ID,
    DRIVER_PROJECT_ID,
    DRIVER_ENV_ENTRY_ID,
    DRIVER_ENV_KEY,
    OLD_DRIVER_DEPLOYMENT_ID,
    EXPECTED_SOURCE_SHA,
  ]) {
    assert.ok(workflow.includes(literal), `${literal} must be pinned in workflow`);
  }
  // Production mutation and latest-ref provisioning are absent.
  assert.equal(workflow.includes('withLatestCommit'), false);
  assert.match(workflow, /preview/i);
  // Driver-only isolation: no consumer/seller env mutation or deploy steps.
  assert.equal(/greenhubconsumer/.test(workflow), false);
  assert.equal(/greenhub-seller/.test(workflow), false);
  assert.equal(/consumer-deployment-id/.test(workflow), false);
  assert.equal(/seller-deployment-id/.test(workflow), false);

  // 44C operator-guidance convergence: the superseded 43A Git-ref-push path
  // must not be offered as a post-mutation operator step. The runnable 43A
  // command must be absent; only the explicit MUST NOT RUN prohibition may
  // mention the superseded script name (duplicate-deployment guard).
  assert.equal(workflow.includes('node scripts/vercel/provision-exact-preview.mjs'), false);
  assert.equal(workflow.includes('existing 43A capability'), false);
  assert.equal(workflow.includes('43A reuse'), false);
  assert.match(workflow, /provision-exact-preview\.mjs MUST NOT RUN/);
  assert.match(workflow, /no preview-exact\/\* ref push/);
  // Canonical successor is the 44A provider-native workflow, exactly once.
  assert.match(workflow, /create-exact-preview-deployment\.yml/);
  assert.match(workflow, /exactly ONE provider-native POST/);
  assert.match(workflow, /single-authoritative-deployment-ID/);
  assert.match(workflow, /44A-created dpl_\*/);
  assert.match(workflow, /--driver-deployment-id/);
  assert.match(workflow, /new != old/);
  assert.match(workflow, /Preview\/null/);
});
