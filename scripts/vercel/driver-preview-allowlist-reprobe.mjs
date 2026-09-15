/**
 * Driver Preview allowlist secure bridge (PILOT-AUTH-DRIVER-ALLOWLIST-SECURE-BRIDGE-43C).
 *
 * Manual-only secure bridge that performs an ADDITIVE-ONLY mutation of the
 * Driver Preview allowlist env entry, then allows exact-preview reprovisioning
 * exclusively through the existing 43A capability
 * (`scripts/vercel/provision-exact-preview.mjs`).
 *
 * Locked contract (fail-closed, no silent fallback):
 * - Driver only. Consumer / seller targets are structurally rejected.
 * - Preview only. Production mutation is structurally unreachable: the only
 *   mutation entry point hardcodes the Preview target and asserts it before
 *   any provider call. No update/delete/create path accepts `production`.
 * - Exact target identity enforced before mutation: team, project, project ID,
 *   env entry ID, env key, old deployment ID, expected source SHA. Any mismatch
 *   aborts before any provider write.
 * - Write credential: ROUND_DIRECT_E2E_VERCEL_DRIVER_WRITE_TOKEN only. The read
 *   credential is NEVER a write fallback. Missing/empty write credential aborts
 *   with WRITE_CREDENTIAL_NOT_PROVISIONED before any provider call.
 * - Additive-only: NEW_SET = CURRENT_SET + CANONICAL_DRIVER_IDENTITY.
 *   Unrelated members are never removed. Canonical identity is present after.
 * - Evidence is boolean/count only. Raw allowlist values, secret values,
 *   hashes, prefixes, and lengths are never emitted.
 * - Reprovisioning reuses the 43A exact provisioning builder with the exact
 *   expected source SHA only. Latest-commit promotion / latest-ref flows are
 *   forbidden and absent from this module (no latest-SHA resolution exists
 *   here; the exact SHA is the only accepted source identity).
 *
 * This module performs no live provider I/O by itself in tests: the Vercel
 * client is an injected seam (`vercelClient`) so deterministic specs can prove
 * zero-call fail-closed behavior. Live dispatch happens only through
 * `.github/workflows/driver-preview-allowlist-reprobe.yml` (workflow_dispatch,
 * round-direct-e2e environment) and is out of scope for 43C verification.
 *
 * Run: node --test scripts/vercel/driver-preview-allowlist-reprobe.spec.mjs
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildProvisioningRequest } from './provision-exact-preview.mjs';
import { inspectAppDeployment } from '../wait-preview-deploy.mjs';

// ---------------------------------------------------------------------------
// Exact target contract (verbatim, driver Preview only)
// ---------------------------------------------------------------------------

export const DRIVER_TEAM_ID = 'team_J91VWI0TqcHdcF36T7qVgiT1';
export const DRIVER_PROJECT = 'greenhub-driver';
export const DRIVER_PROJECT_ID = 'prj_e3OU9YIAGTkDcrWQdpTvkbHnJ4XW';
export const DRIVER_ENV_ENTRY_ID = 'RFASslCQh9EVuvfv';
export const DRIVER_ENV_KEY = 'ROUND_DIRECT_E2E_DRIVER_EMAILS';
export const OLD_DRIVER_DEPLOYMENT_ID = 'dpl_BM6yZATGyH2R6LW6uL8uvkAPhCjn';
export const EXPECTED_SOURCE_SHA = '33cb9773df86abc486783e53757448280b80be96';
export const DRIVER_PREVIEW_ENVIRONMENT = 'preview';

export const WRITE_CREDENTIAL_NAME = 'ROUND_DIRECT_E2E_VERCEL_DRIVER_WRITE_TOKEN';
// Named explicitly so reviewers can verify it is never used as a write path.
// This module never reads it for mutation purposes.
export const READ_CREDENTIAL_NAME = 'ROUND_DIRECT_E2E_VERCEL_READ_TOKEN';

export const DRIVER_SCOPE = 'driver';
export const VERCEL_API_ORIGIN = 'https://api.vercel.com';

export class BridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new BridgeError(code, message);
}

// ---------------------------------------------------------------------------
// Write credential gate (fail-closed, no read fallback, no value exposure)
// ---------------------------------------------------------------------------

/**
 * Resolve the write credential. Reads ONLY the write secret name. Never falls
 * back to the read credential. Never includes the value in errors.
 */
export function resolveWriteCredential(env = process.env) {
  const source = env ?? {};
  const token = source[WRITE_CREDENTIAL_NAME];
  if (typeof token !== 'string' || token.trim() === '') {
    fail(
      'WRITE_CREDENTIAL_NOT_PROVISIONED',
      'driver preview allowlist write credential이 없어 mutation을 차단합니다.',
    );
  }
  return token;
}

/** Boolean presence probe without exposing the value. */
export function hasWriteCredential(env = process.env) {
  try {
    resolveWriteCredential(env);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Driver-only isolation + exact target enforcement (all before any mutation)
// ---------------------------------------------------------------------------

const KNOWN_NON_DRIVER_SCOPES = Object.freeze(['consumer', 'seller', 'both', 'api', 'admin']);

export function assertDriverScope({ app, project, projectId } = {}) {
  const normalizedApp = typeof app === 'string' ? app.trim().toLowerCase() : '';
  if (normalizedApp !== DRIVER_SCOPE) {
    fail(
      'DRIVER_ONLY_ISOLATION_VIOLATION',
      'driver 이외 scope에 대한 allowlist mutation을 차단합니다.',
    );
  }
  if (KNOWN_NON_DRIVER_SCOPES.includes(normalizedApp)) {
    fail(
      'DRIVER_ONLY_ISOLATION_VIOLATION',
      'driver 이외 scope에 대한 allowlist mutation을 차단합니다.',
    );
  }
  if (project !== undefined && project !== DRIVER_PROJECT) {
    fail('PROJECT_MISMATCH', 'driver project identity가 예상값과 달라 차단합니다.');
  }
  if (projectId !== undefined && projectId !== DRIVER_PROJECT_ID) {
    fail('PROJECT_ID_MISMATCH', 'driver project ID가 예상값과 달라 차단합니다.');
  }
  return DRIVER_SCOPE;
}

/**
 * Enforce the exact driver Preview target. Every field is compared verbatim.
 * Production (or any non-preview environment) is refused first.
 */
export function assertExactDriverTarget({
  app,
  teamId,
  project,
  projectId,
  environment,
  envEntryId,
  envKey,
  oldDeploymentId,
  sourceSha,
} = {}) {
  assertDriverScope({ app, project, projectId });

  const normalizedEnv = typeof environment === 'string' ? environment.trim().toLowerCase() : '';
  if (normalizedEnv !== DRIVER_PREVIEW_ENVIRONMENT) {
    fail(
      'PRODUCTION_TARGET_BLOCKED',
      'Preview가 아닌 target에 대한 allowlist mutation을 차단합니다.',
    );
  }
  if (teamId !== DRIVER_TEAM_ID) {
    fail('TEAM_MISMATCH', 'Vercel team이 예상값과 달라 차단합니다.');
  }
  if (project !== DRIVER_PROJECT) {
    fail('PROJECT_MISMATCH', 'driver project가 예상값과 달라 차단합니다.');
  }
  if (projectId !== DRIVER_PROJECT_ID) {
    fail('PROJECT_ID_MISMATCH', 'driver project ID가 예상값과 달라 차단합니다.');
  }
  if (envEntryId !== DRIVER_ENV_ENTRY_ID) {
    fail('ENV_ENTRY_ID_MISMATCH', 'allowlist env entry ID가 예상값과 달라 차단합니다.');
  }
  if (envKey !== DRIVER_ENV_KEY) {
    fail('ENV_KEY_MISMATCH', 'allowlist env key가 예상값과 달라 차단합니다.');
  }
  if (oldDeploymentId !== OLD_DRIVER_DEPLOYMENT_ID) {
    fail('OLD_DEPLOYMENT_MISMATCH', 'old deployment ID가 예상값과 달라 차단합니다.');
  }
  if (sourceSha !== EXPECTED_SOURCE_SHA) {
    fail('SOURCE_SHA_MISMATCH', 'expected source SHA가 예상값과 달라 차단합니다.');
  }
  return Object.freeze({ app: DRIVER_SCOPE, environment: DRIVER_PREVIEW_ENVIRONMENT });
}

// ---------------------------------------------------------------------------
// Additive-only allowlist algebra (PII-free evidence)
// ---------------------------------------------------------------------------

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeIdentity(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized || !EMAIL_SHAPE.test(normalized)) {
    fail('INVALID_CANONICAL_IDENTITY', 'canonical driver identity 형식이 올바르지 않아 차단합니다.');
  }
  return normalized;
}

/** Parse a raw comma-separated allowlist into a deduplicated normalized set. */
export function parseAllowlist(raw) {
  if (typeof raw !== 'string') {
    fail('ALLOWLIST_MALFORMED', 'allowlist raw 값이 문자열이 아니라 차단합니다.');
  }
  const members = new Set();
  for (const part of raw.split(',')) {
    const normalized = part.trim().toLowerCase();
    if (normalized) members.add(normalized);
  }
  return [...members];
}

/**
 * Additive-only merge: NEW_SET = CURRENT_SET + CANONICAL_DRIVER_IDENTITY.
 * Never removes unrelated members. Returns sorted deterministic sets.
 */
export function buildAdditiveAllowlist({ currentRaw, canonicalIdentity }) {
  const canonical = normalizeIdentity(canonicalIdentity);
  const beforeSet = parseAllowlist(currentRaw);
  const merged = new Set(beforeSet);
  merged.add(canonical);
  const afterSet = [...merged].sort();
  return Object.freeze({
    beforeSet: Object.freeze([...beforeSet].sort()),
    afterSet: Object.freeze(afterSet),
    newRaw: afterSet.join(','),
  });
}

/**
 * Boolean/count-only evidence. Contains no email strings, hashes, prefixes,
 * or lengths of secrets. Safe for logs and artifacts.
 */
export function buildAllowlistEvidence({ beforeSet, afterSet, canonicalIdentity }) {
  const canonical = normalizeIdentity(canonicalIdentity);
  const before = new Set(beforeSet ?? []);
  const after = new Set(afterSet ?? []);
  const beforeUnrelated = [...before].filter((member) => member !== canonical);
  const afterUnrelated = [...after].filter((member) => member !== canonical);
  const unrelatedPreserved =
    afterUnrelated.length >= beforeUnrelated.length &&
    beforeUnrelated.every((member) => after.has(member));
  return Object.freeze({
    CANONICAL_IDENTITY_PRESENT_BEFORE: before.has(canonical),
    CANONICAL_IDENTITY_PRESENT_AFTER: after.has(canonical),
    MEMBER_COUNT_BEFORE: before.size,
    MEMBER_COUNT_AFTER: after.size,
    UNRELATED_MEMBER_COUNT_BEFORE: beforeUnrelated.length,
    UNRELATED_MEMBER_COUNT_AFTER: afterUnrelated.length,
    UNRELATED_MEMBER_COUNT_PRESERVED: unrelatedPreserved,
  });
}

export function assertAdditiveInvariant(evidence) {
  if (!evidence || evidence.CANONICAL_IDENTITY_PRESENT_AFTER !== true) {
    fail(
      'ADDITIVE_INVARIANT_VIOLATED',
      'canonical identity가 mutation 이후 존재하지 않아 차단합니다.',
    );
  }
  if (evidence.UNRELATED_MEMBER_COUNT_PRESERVED !== true) {
    fail(
      'ADDITIVE_INVARIANT_VIOLATED',
      'unrelated allowlist member가 보존되지 않아 차단합니다.',
    );
  }
  return true;
}

/**
 * PII-leak guard used by specs and safe loggers: evidence must never contain
 * a raw identity substring (case-insensitive).
 */
export function evidenceExposesRawIdentity(evidence, rawIdentities) {
  const serialized = JSON.stringify(evidence ?? {});
  const candidates = Array.isArray(rawIdentities) ? rawIdentities : [rawIdentities];
  return candidates
    .filter((value) => typeof value === 'string' && value.trim() !== '')
    .some((value) => serialized.toLowerCase().includes(value.trim().toLowerCase()));
}

// ---------------------------------------------------------------------------
// Exact-preview reprovisioning via the existing 43A capability only
// ---------------------------------------------------------------------------

/**
 * Build the driver exact-preview provisioning request through the existing 43A
 * builder. Only the exact expected source SHA is accepted; latest-commit
 * promotion and latest-ref flows do not exist in this module.
 */
export function buildDriverExactProvisioningRequest({ sourceSha } = {}) {
  if (sourceSha !== EXPECTED_SOURCE_SHA) {
    fail(
      'SOURCE_SHA_MISMATCH',
      'exact preview provisioning은 expected source SHA만 허용됩니다.',
    );
  }
  const request = buildProvisioningRequest({ sha: sourceSha, app: DRIVER_SCOPE, target: null });
  if (request.ref !== `preview-exact/driver/${EXPECTED_SOURCE_SHA}`) {
    fail('SOURCE_SHA_MISMATCH', 'provisioning ref가 expected source SHA와 달라 차단합니다.');
  }
  if (request.target !== null || request.production !== false) {
    fail('PRODUCTION_TARGET_BLOCKED', 'provisioning target은 Preview만 허용됩니다.');
  }
  return request;
}

// ---------------------------------------------------------------------------
// New-deployment readback gate (probe proceeds only on exact READY preview)
// ---------------------------------------------------------------------------

/**
 * Validate the new driver Preview deployment readback. Returns the underlying
 * app evidence plus a probe gate. The probe stage must check
 * `shouldProceedToProbe === true` before any auth reprobe.
 */
export function validateNewDriverDeployment({ payload, newDeploymentId, expectedSha = EXPECTED_SOURCE_SHA } = {}) {
  if (typeof newDeploymentId !== 'string' || !newDeploymentId) {
    fail('NEW_DEPLOYMENT_ID_MISSING', 'new deployment ID가 없어 readback 검증을 차단합니다.');
  }
  if (newDeploymentId === OLD_DRIVER_DEPLOYMENT_ID) {
    const blocked = {
      ready: false,
      shouldProceedToProbe: false,
      failureCode: 'NEW_DEPLOYMENT_ID_UNCHANGED',
      failureMessage: 'new deployment가 old deployment와 달라야 합니다.',
    };
    return Object.freeze(blocked);
  }
  const evidence = inspectAppDeployment('driver', newDeploymentId, expectedSha, payload);
  return Object.freeze({
    ...evidence,
    shouldProceedToProbe: evidence.ready === true,
  });
}

/** Probe gate: only an exact READY preview deployment may proceed to probing. */
export function shouldProceedToProbe(readback) {
  return readback != null && readback.ready === true && readback.shouldProceedToProbe === true;
}

/**
 * Compare provider readback against the exact expected identity BEFORE any
 * mutation. Any single mismatch aborts. `readback` is the live provider state
 * (env entry GET + pinned deployment metadata); no field is trusted blindly.
 */
export function assertProviderReadbackMatches({ readback } = {}) {
  const observed = readback ?? {};
  if (observed.teamId !== DRIVER_TEAM_ID) {
    fail('TEAM_MISMATCH', 'provider readback team이 예상값과 달라 차단합니다.');
  }
  if (observed.project !== DRIVER_PROJECT) {
    fail('PROJECT_MISMATCH', 'provider readback project가 예상값과 달라 차단합니다.');
  }
  if (observed.projectId !== DRIVER_PROJECT_ID) {
    fail('PROJECT_ID_MISMATCH', 'provider readback project ID가 예상값과 달라 차단합니다.');
  }
  const normalizedEnv =
    typeof observed.environment === 'string' ? observed.environment.trim().toLowerCase() : '';
  if (normalizedEnv !== DRIVER_PREVIEW_ENVIRONMENT) {
    fail(
      'PRODUCTION_TARGET_BLOCKED',
      'provider readback target이 Preview가 아니라 차단합니다.',
    );
  }
  if (observed.envEntryId !== DRIVER_ENV_ENTRY_ID) {
    fail('ENV_ENTRY_ID_MISMATCH', 'provider readback env entry ID가 예상값과 달라 차단합니다.');
  }
  if (observed.envKey !== DRIVER_ENV_KEY) {
    fail('ENV_KEY_MISMATCH', 'provider readback env key가 예상값과 달라 차단합니다.');
  }
  if (observed.oldDeploymentId !== undefined && observed.oldDeploymentId !== OLD_DRIVER_DEPLOYMENT_ID) {
    fail('OLD_DEPLOYMENT_MISMATCH', 'provider readback old deployment가 예상값과 달라 차단합니다.');
  }
  if (observed.sourceSha !== undefined && observed.sourceSha !== EXPECTED_SOURCE_SHA) {
    fail('SOURCE_SHA_MISMATCH', 'provider readback source SHA가 예상값과 달라 차단합니다.');
  }
  return true;
}

// ---------------------------------------------------------------------------
// Mutation planner (single Preview-only write path; fail-closed ordering)
// ---------------------------------------------------------------------------

/**
 * Plan (and optionally execute via the injected client) the additive allowlist
 * mutation. Validation order is fixed:
 *   1. write credential (no provider call before this passes)
 *   2. exact driver Preview target (incl. driver-only isolation)
 *   3. additive-only build + invariant
 *   4. single Preview-only provider write via the injected client
 *
 * The injected `vercelClient` seam keeps deterministic tests provider-free:
 * pass `{ updateDriverPreviewEnvEntry }`. When omitted, only planning +
 * evidence are returned and no provider call exists to make.
 */
export async function planDriverAllowlistMutation({
  env = process.env,
  target,
  currentRaw,
  canonicalIdentity,
  vercelClient = null,
} = {}) {
  // 1. Write credential first — zero provider calls on failure.
  const writeToken = resolveWriteCredential(env);

  // 2. Exact driver Preview target before touching provider state.
  assertExactDriverTarget(target);

  // 3. Additive-only algebra + invariant (pure, no provider).
  const { beforeSet, afterSet, newRaw } = buildAdditiveAllowlist({ currentRaw, canonicalIdentity });
  const evidence = buildAllowlistEvidence({ beforeSet, afterSet, canonicalIdentity });
  assertAdditiveInvariant(evidence);

  // 4. Exact-preview provisioning request bound to the expected SHA (43A reuse).
  const provisioningRequest = buildDriverExactProvisioningRequest({
    sourceSha: target.sourceSha ?? EXPECTED_SOURCE_SHA,
  });

  if (vercelClient == null) {
    return Object.freeze({ evidence, provisioningRequest, providerCalls: 0 });
  }
  if (typeof vercelClient.updateDriverPreviewEnvEntry !== 'function') {
    fail('VERCEL_CLIENT_MALFORMED', 'Vercel client seam이 올바르지 않아 차단합니다.');
  }

  // Single Preview-only write. The target environment literal is fixed to
  // Preview; production is not representable through this call.
  const result = await vercelClient.updateDriverPreviewEnvEntry({
    writeToken,
    teamId: DRIVER_TEAM_ID,
    projectId: DRIVER_PROJECT_ID,
    envEntryId: DRIVER_ENV_ENTRY_ID,
    key: DRIVER_ENV_KEY,
    target: DRIVER_PREVIEW_ENVIRONMENT,
    newRaw,
  });
  return Object.freeze({ evidence, provisioningRequest, providerCalls: 1, result: result ?? null });
}

/**
 * Direct mutation helper used by the workflow runtime. Structurally Preview-only:
 * there is no parameter, branch, or export that can address a production env
 * entry. Production update/delete/create is unreachable by construction.
 */
export async function updateDriverPreviewEnvEntry(
  { writeToken, teamId, projectId, envEntryId, key, target, newRaw },
  fetchImpl = fetch,
) {
  if (typeof writeToken !== 'string' || writeToken.trim() === '') {
    fail(
      'WRITE_CREDENTIAL_NOT_PROVISIONED',
      'driver preview allowlist write credential이 없어 mutation을 차단합니다.',
    );
  }
  if (
    teamId !== DRIVER_TEAM_ID ||
    projectId !== DRIVER_PROJECT_ID ||
    envEntryId !== DRIVER_ENV_ENTRY_ID ||
    key !== DRIVER_ENV_KEY ||
    target !== DRIVER_PREVIEW_ENVIRONMENT
  ) {
    fail('EXACT_TARGET_MISMATCH', 'exact driver Preview target이 아니라 mutation을 차단합니다.');
  }
  if (typeof newRaw !== 'string' || !newRaw) {
    fail('ALLOWLIST_MALFORMED', 'mutation 대상 allowlist가 비어 있어 차단합니다.');
  }
  const endpoint =
    `${VERCEL_API_ORIGIN}/v9/projects/${encodeURIComponent(projectId)}` +
    `/env/${encodeURIComponent(envEntryId)}?teamId=${encodeURIComponent(teamId)}`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        // The write credential is used ONLY as the transport authenticator.
        // It is never written to stdout/stderr/artifacts/evidence.
        Authorization: `Bearer ${writeToken}`,
      },
      body: JSON.stringify({ value: newRaw, target: [DRIVER_PREVIEW_ENVIRONMENT] }),
    });
  } catch {
    fail('VERCEL_API_UNAVAILABLE', 'Vercel mutation 요청에 실패해 차단합니다.');
  }
  if (!response?.ok) {
    fail('VERCEL_MUTATION_REJECTED', 'Vercel mutation API가 성공을 반환하지 않아 차단합니다.');
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// CLI (check-only by default; --apply requires explicit confirmation)
// ---------------------------------------------------------------------------

const invokedAsMainScript =
  process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsMainScript) {
  const argv = process.argv.slice(2);
  const mode = argv.includes('--apply') ? 'apply' : 'check-only';
  try {
    // Static contract self-check: exact constants + 43A reuse + Preview-only.
    assertExactDriverTarget({
      app: DRIVER_SCOPE,
      teamId: DRIVER_TEAM_ID,
      project: DRIVER_PROJECT,
      projectId: DRIVER_PROJECT_ID,
      environment: DRIVER_PREVIEW_ENVIRONMENT,
      envEntryId: DRIVER_ENV_ENTRY_ID,
      envKey: DRIVER_ENV_KEY,
      oldDeploymentId: OLD_DRIVER_DEPLOYMENT_ID,
      sourceSha: EXPECTED_SOURCE_SHA,
    });
    buildDriverExactProvisioningRequest({ sourceSha: EXPECTED_SOURCE_SHA });
    if (mode === 'check-only') {
      process.stdout.write(
        `${JSON.stringify({ mode, contract: 'EXACT_DRIVER_PREVIEW_ADDITIVE_ONLY', mutationExecuted: false })}\n`,
      );
    } else {
      resolveWriteCredential(process.env);
      process.stderr.write('[driver-preview-allowlist-reprobe] apply mode requires workflow dispatch context.\n');
      process.exit(1);
    }
  } catch (error) {
    const code = error instanceof BridgeError ? error.code : 'BRIDGE_CHECK_FAILED';
    process.stderr.write(`[driver-preview-allowlist-reprobe] ${code}: gate blocked.\n`);
    process.exit(1);
  }
}
