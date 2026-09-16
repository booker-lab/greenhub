/**
 * Driver Preview pinned revision read-only metadata path
 * (PILOT-AUTH-DRIVER-ALLOWLIST-METADATA-READ-PATH-45E).
 *
 * Dedicated READ-ONLY execution capability for the Driver Preview pinned
 * deployment metadata + allowlist env revision metadata in ONE bounded
 * operation. This Task performs NO live provider readback itself; it only
 * closes the execution capability so a follow-up Task can safely read back.
 *
 * Locked contract (fail-closed, no silent fallback):
 * - Driver only. Preview only. Production is structurally unreachable.
 * - Exact target identity enforced BEFORE any provider call: project,
 *   project ID, environment, env entry ID, env key, pinned deployment ID,
 *   expected source SHA, expected source ref. Any mismatch aborts with
 *   zero provider calls.
 * - Read credential ONLY: ROUND_DIRECT_E2E_VERCEL_READ_TOKEN. The write
 *   credential (VERCEL_EXACT_PREVIEW_DRIVER_TOKEN) is NEVER a fallback.
 *   Missing/empty read credential aborts with zero provider calls.
 * - GET ONLY. No POST / PATCH / PUT / DELETE exists in this module. No
 *   deploy/redeploy/promote, no env update/create/delete, no Git ref push,
 *   no workflow chaining. `decrypt=true` is absolutely forbidden and never
 *   sent (default encrypted-at-rest shape is kept, value is never projected).
 * - Provider operations (exactly TWO GETs on success, zero on pre-call fail):
 *   A. deployment metadata: GET /v13/deployments/{deploymentId}?teamId={team}
 *      (same verified shape as scripts/wait-preview-deploy.mjs legacy-global
 *      read path for ROUND_DIRECT_E2E_VERCEL_READ_TOKEN; this module does NOT
 *      import the READY-gating predicate because 45E projects metadata without
 *      concluding applicability/freshness/READY).
 *   B. project env metadata: GET /v10/projects/{projectId}/env?teamId={team}
 *      (Vercel-official canonical list endpoint; see
 *      https://vercel.com/docs/rest-api/projects/retrieve-the-environment-variables-of-a-project-by-id-or-name
 *      which documents `GET /v10/projects/{idOrName}/env` as the supported
 *      list path. No `decrypt` query is sent; `decrypt=true` never appears.)
 * - Value non-disclosure: whitelist projection ONLY. Provider raw JSON is
 *   never written to stdout/stderr/artifacts. Token values, env values,
 *   allowlist raw values, ciphertext, hashes, lengths, prefixes, suffixes,
 *   and membership are never emitted. Env projection allows ONLY
 *   id/key/type/target/gitBranch/createdAt/updatedAt. Deployment projection
 *   allows ONLY id/project/projectId/sourceSha/sourceRef/state/target/
 *   createdAt. Missing createdAt/updatedAt (and missing optional sourceRef /
 *   gitBranch) are FIELD_UNAVAILABLE, never estimated or backfilled.
 * - This module performs no live provider I/O by itself in tests: fetch is
 *   an injected seam so deterministic specs prove zero-call fail-closed
 *   behavior. Live dispatch happens only through
 *   `.github/workflows/read-driver-preview-revision.yml` (workflow_dispatch,
 *   round-direct-e2e environment, read credential only) and is out of scope
 *   for 45E verification (no dispatch in this Task).
 *
 * Run: node --test scripts/vercel/read-driver-preview-revision.spec.mjs
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Exact target contract (verbatim, driver Preview only)
// ---------------------------------------------------------------------------

export const DRIVER_PROJECT = 'greenhub-driver';
export const DRIVER_PROJECT_ID = 'prj_e3OU9YIAGTkDcrWQdpTvkbHnJ4XW';
export const DRIVER_PREVIEW_ENVIRONMENT = 'preview';
export const DRIVER_ENV_ENTRY_ID = 'RFASslCQh9EVuvfv';
export const DRIVER_ENV_KEY = 'ROUND_DIRECT_E2E_DRIVER_EMAILS';
export const PINNED_DRIVER_DEPLOYMENT_ID = 'dpl_BM6yZATGyH2R6LW6uL8uvkAPhCjn';
// Alias kept so reviewers can cross-check the 43C/45C/45D bridge naming.
export const OLD_DRIVER_DEPLOYMENT_ID = PINNED_DRIVER_DEPLOYMENT_ID;
export const EXPECTED_SOURCE_SHA = '33cb9773df86abc486783e53757448280b80be96';
export const EXPECTED_SOURCE_REF = 'tmp/pilot-auth-driver-full-gate-39b-publication';

export const DRIVER_SCOPE = 'driver';
export const READ_CREDENTIAL_NAME = 'ROUND_DIRECT_E2E_VERCEL_READ_TOKEN';
// Named explicitly so reviewers can verify it is NEVER used as a read path.
export const WRITE_CREDENTIAL_NAME = 'VERCEL_EXACT_PREVIEW_DRIVER_TOKEN';

export const VERCEL_API_ORIGIN = 'https://api.vercel.com';
// Legacy-global read scope for ROUND_DIRECT_E2E_VERCEL_READ_TOKEN, same value
// as scripts/wait-preview-deploy.mjs VERCEL_TEAM_ID (verified read helper).
export const VERCEL_TEAM_ID = 'team_J91VWI0TqcHdcF36T7qVgiT1';

export const FIELD_UNAVAILABLE = 'FIELD_UNAVAILABLE';

export const ALLOWED_ENV_KEYS = Object.freeze([
  'id',
  'key',
  'type',
  'target',
  'gitBranch',
  'createdAt',
  'updatedAt',
]);

export const ALLOWED_DEPLOYMENT_KEYS = Object.freeze([
  'id',
  'project',
  'projectId',
  'sourceSha',
  'sourceRef',
  'state',
  'target',
  'createdAt',
]);

export class ReadRevisionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReadRevisionError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReadRevisionError(code, message);
}

// ---------------------------------------------------------------------------
// Read credential gate (fail-closed, no write fallback, no value exposure)
// ---------------------------------------------------------------------------

/**
 * Resolve the read credential. Reads ONLY the read secret name. Never falls
 * back to the write credential. Never includes the value in errors.
 */
export function resolveReadCredential(env = process.env) {
  const source = env ?? {};
  const token = source[READ_CREDENTIAL_NAME];
  if (typeof token !== 'string' || token.trim() === '') {
    fail(
      'READ_CREDENTIAL_NOT_PROVISIONED',
      'driver preview revision read credential이 없어 metadata read를 차단합니다.',
    );
  }
  return token;
}

/** Boolean presence probe without exposing the value. */
export function hasReadCredential(env = process.env) {
  try {
    resolveReadCredential(env);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Driver-only isolation + exact read target enforcement (all before any GET)
// ---------------------------------------------------------------------------

const KNOWN_NON_DRIVER_PROJECTS = Object.freeze(['greenhubconsumer', 'greenhub-seller']);

export function assertDriverReadScope({ project, projectId } = {}) {
  if (project !== undefined && project !== DRIVER_PROJECT) {
    fail('PROJECT_MISMATCH', 'driver project identity가 예상값과 달라 차단합니다.');
  }
  if (projectId !== undefined && projectId !== DRIVER_PROJECT_ID) {
    fail('PROJECT_ID_MISMATCH', 'driver project ID가 예상값과 달라 차단합니다.');
  }
  if (project !== undefined && KNOWN_NON_DRIVER_PROJECTS.includes(project)) {
    fail('PROJECT_MISMATCH', 'driver 이외 project에 대한 revision read를 차단합니다.');
  }
  return DRIVER_SCOPE;
}

/**
 * Enforce the exact driver Preview read target. Every field is compared
 * verbatim. Production (or any non-preview environment) is refused first.
 * Mutation vectors (method override, decrypt=true, teamId override,
 * write-token fallback) are refused before any provider call.
 */
export function assertExactDriverReadTarget({
  project,
  projectId,
  environment,
  envEntryId,
  envKey,
  deploymentId,
  sourceSha,
  sourceRef,
  method,
  decrypt,
  teamId,
  writeToken,
} = {}) {
  if (teamId !== undefined) {
    fail(
      'TEAM_QUERY_FORBIDDEN',
      'read target에서는 teamId override를 사용하지 않아 차단합니다 (canonical team query는 내부 고정값만 사용).',
    );
  }
  if (writeToken !== undefined) {
    fail(
      'WRITE_CREDENTIAL_FALLBACK_FORBIDDEN',
      'write credential을 read 경로에 사용하는 것을 차단합니다.',
    );
  }
  if (method !== undefined) {
    const normalized = typeof method === 'string' ? method.trim().toUpperCase() : '';
    if (normalized !== 'GET') {
      fail(
        'MUTATION_METHOD_FORBIDDEN',
        'GET 이외 method로 revision read를 요청해 차단합니다.',
      );
    }
  }
  if (decrypt === true || (typeof decrypt === 'string' && decrypt.trim().toLowerCase() === 'true')) {
    fail(
      'DECRYPT_FORBIDDEN',
      'decrypt=true로 env value 복호를 요청해 차단합니다.',
    );
  }
  assertDriverReadScope({ project, projectId });

  const normalizedEnv = typeof environment === 'string' ? environment.trim().toLowerCase() : '';
  if (normalizedEnv !== DRIVER_PREVIEW_ENVIRONMENT) {
    fail(
      'PRODUCTION_TARGET_BLOCKED',
      'Preview가 아닌 target에 대한 revision read를 차단합니다.',
    );
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
  if (deploymentId !== PINNED_DRIVER_DEPLOYMENT_ID) {
    fail('DEPLOYMENT_ID_MISMATCH', 'pinned deployment ID가 예상값과 달라 차단합니다.');
  }
  if (sourceSha !== EXPECTED_SOURCE_SHA) {
    fail('SOURCE_SHA_MISMATCH', 'expected source SHA가 예상값과 달라 차단합니다.');
  }
  if (sourceRef !== EXPECTED_SOURCE_REF) {
    fail('SOURCE_REF_MISMATCH', 'expected source ref가 예상값과 달라 차단합니다.');
  }
  return Object.freeze({ project: DRIVER_PROJECT, environment: DRIVER_PREVIEW_ENVIRONMENT });
}

// ---------------------------------------------------------------------------
// Provider paths (GET only, no decrypt query)
// ---------------------------------------------------------------------------

/**
 * Canonical deployment read path (legacy-global read scope, verified shape).
 * Project ID is NOT part of the deployment path; deployment ID is the path
 * authority and is enforced exact here. Canonical team query is fixed
 * internally; caller override is already forbidden above.
 */
export function vercelDeploymentReadPath(deploymentId = PINNED_DRIVER_DEPLOYMENT_ID) {
  if (deploymentId !== PINNED_DRIVER_DEPLOYMENT_ID) {
    fail('DEPLOYMENT_ID_MISMATCH', 'pinned deployment ID가 예상값과 달라 차단합니다.');
  }
  const query = new URLSearchParams({ teamId: VERCEL_TEAM_ID });
  const pathname = `/v13/deployments/${encodeURIComponent(deploymentId)}?${query}`;
  if (pathname.includes('decrypt')) {
    fail('DECRYPT_FORBIDDEN', 'deployment read path must never carry decrypt.');
  }
  return pathname;
}

/**
 * Canonical project env list path (Vercel-official latest supported list
 * endpoint: GET /v10/projects/{idOrName}/env). Project ID is the path
 * authority and is enforced exact here. No decrypt query is emitted.
 * Canonical team query is fixed internally for the legacy-global read token.
 */
export function vercelDriverEnvListPath(projectId = DRIVER_PROJECT_ID) {
  if (projectId !== DRIVER_PROJECT_ID) {
    fail('PROJECT_ID_MISMATCH', 'driver project ID가 예상값과 달라 차단합니다.');
  }
  const query = new URLSearchParams({ teamId: VERCEL_TEAM_ID });
  const pathname = `/v10/projects/${encodeURIComponent(projectId)}/env?${query}`;
  if (pathname.includes('decrypt')) {
    fail('DECRYPT_FORBIDDEN', 'env list read path must never carry decrypt.');
  }
  return pathname;
}

/** Assert a fully built provider URL never carries decrypt. */
export function assertNoDecryptQuery(url) {
  if (typeof url === 'string' && url.includes('decrypt')) {
    fail('DECRYPT_FORBIDDEN', 'provider read request must not carry decrypt.');
  }
  return true;
}

// ---------------------------------------------------------------------------
// Provider GET seams (GET only, header-only credential, no value logging)
// ---------------------------------------------------------------------------

function vercelGetHeaders(token) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Single deployment metadata GET. Fail-closed on missing credential, HTTP
 * failure, or invalid JSON. Never places the token in URL/body/logs.
 */
export async function requestVercelDeploymentMetadata(
  { deploymentId, readToken, fetchImpl = fetch } = {},
) {
  if (deploymentId !== PINNED_DRIVER_DEPLOYMENT_ID) {
    fail('DEPLOYMENT_ID_MISMATCH', 'pinned deployment ID가 예상값과 달라 차단합니다.');
  }
  if (typeof readToken !== 'string' || readToken.trim() === '') {
    fail(
      'READ_CREDENTIAL_NOT_PROVISIONED',
      'driver preview revision read credential이 없어 metadata read를 차단합니다.',
    );
  }
  const cleanToken = readToken.trim();
  const endpoint = `${VERCEL_API_ORIGIN}${vercelDeploymentReadPath(deploymentId)}`;
  assertNoDecryptQuery(endpoint);
  if (endpoint.includes(cleanToken)) {
    fail('SECRET_REDACTION_VIOLATION', 'credential value must never appear in URL.');
  }
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: vercelGetHeaders(cleanToken),
    });
  } catch {
    fail('VERCEL_API_UNAVAILABLE', 'Vercel deployment metadata 읽기 요청에 실패했습니다.');
  }
  if (!response?.ok) {
    const status = Number(response?.status);
    const suffix = Number.isInteger(status) && status > 0 ? `_${status}` : '';
    fail(
      `VERCEL_API_HTTP${suffix}`,
      `Vercel deployment metadata API가 성공 응답을 반환하지 않았습니다${suffix ? ` (HTTP ${status})` : ''}.`,
    );
  }
  try {
    return await response.json();
  } catch {
    fail('VERCEL_API_INVALID_JSON', 'Vercel deployment metadata JSON 응답이 잘못되었습니다.');
  }
}

/**
 * Single project env list GET. Fail-closed on missing credential, HTTP
 * failure, or invalid JSON. Never sends decrypt. Never places the token in
 * URL/body/logs.
 */
export async function requestVercelEnvList(
  { projectId, readToken, fetchImpl = fetch } = {},
) {
  if (projectId !== DRIVER_PROJECT_ID) {
    fail('PROJECT_ID_MISMATCH', 'driver project ID가 예상값과 달라 차단합니다.');
  }
  if (typeof readToken !== 'string' || readToken.trim() === '') {
    fail(
      'READ_CREDENTIAL_NOT_PROVISIONED',
      'driver preview revision read credential이 없어 metadata read를 차단합니다.',
    );
  }
  const cleanToken = readToken.trim();
  const endpoint = `${VERCEL_API_ORIGIN}${vercelDriverEnvListPath(projectId)}`;
  assertNoDecryptQuery(endpoint);
  if (endpoint.includes('decrypt=true')) {
    fail('DECRYPT_FORBIDDEN', 'env list read must never request decrypt=true.');
  }
  if (endpoint.includes(cleanToken)) {
    fail('SECRET_REDACTION_VIOLATION', 'credential value must never appear in URL.');
  }
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: vercelGetHeaders(cleanToken),
    });
  } catch {
    fail('VERCEL_API_UNAVAILABLE', 'Vercel env list 읽기 요청에 실패했습니다.');
  }
  if (!response?.ok) {
    const status = Number(response?.status);
    const suffix = Number.isInteger(status) && status > 0 ? `_${status}` : '';
    fail(
      `VERCEL_API_HTTP${suffix}`,
      `Vercel env list API가 성공 응답을 반환하지 않았습니다${suffix ? ` (HTTP ${status})` : ''}.`,
    );
  }
  try {
    return await response.json();
  } catch {
    fail('VERCEL_API_INVALID_JSON', 'Vercel env list JSON 응답이 잘못되었습니다.');
  }
}

// ---------------------------------------------------------------------------
// Env list shaping (exact single-record gate, fail-closed)
// ---------------------------------------------------------------------------

function unwrapEnvRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload != null && typeof payload === 'object') {
    if (Array.isArray(payload.envs)) {
      const pagination = payload.pagination;
      if (pagination != null && typeof pagination === 'object' && pagination.next != null) {
        fail('ENV_LIST_INCOMPLETE', 'env list pagination이 남아 있어 단일 revision 확정을 차단합니다.');
      }
      return payload.envs;
    }
  }
  fail('UNSAFE_RESPONSE_SHAPE', 'provider env list shape가 metadata-only projection에 안전하지 않아 차단합니다.');
}

const KNOWN_ENV_TARGETS = Object.freeze(['preview', 'production', 'development']);

/**
 * Select the single exact env record. Fails closed on 0, 2+, id mismatch,
 * key mismatch, or unsafe shape. Never returns values.
 */
export function filterSingleEnvRecord(
  { envListPayload, envEntryId = DRIVER_ENV_ENTRY_ID, envKey = DRIVER_ENV_KEY } = {},
) {
  if (envEntryId !== DRIVER_ENV_ENTRY_ID) {
    fail('ENV_ENTRY_ID_MISMATCH', 'allowlist env entry ID가 예상값과 달라 차단합니다.');
  }
  if (envKey !== DRIVER_ENV_KEY) {
    fail('ENV_KEY_MISMATCH', 'allowlist env key가 예상값과 달라 차단합니다.');
  }
  const records = unwrapEnvRecords(envListPayload);
  if (!Array.isArray(records)) {
    fail('UNSAFE_RESPONSE_SHAPE', 'provider env list shape가 안전하지 않아 차단합니다.');
  }
  const byId = records.filter((record) => record != null && record.id === envEntryId);
  if (byId.length >= 2) {
    fail('DUPLICATE_ENV_RECORDS', '동일 env entry ID가 2개 이상 있어 차단합니다.');
  }
  const matched = records.filter(
    (record) => record != null && record.id === envEntryId && record.key === envKey,
  );
  if (matched.length === 0) {
    const byKey = records.filter((record) => record != null && record.key === envKey);
    if (byId.length > 0) {
      fail('ENV_KEY_MISMATCH', 'provider readback env key가 예상값과 달라 차단합니다.');
    }
    if (byKey.length > 0) {
      fail('ENV_ENTRY_ID_MISMATCH', 'provider readback env entry ID가 예상값과 달라 차단합니다.');
    }
    fail('ENV_ENTRY_NOT_FOUND', 'provider env list에 revision entry가 없어 차단합니다.');
  }
  if (matched.length >= 2) {
    fail('DUPLICATE_ENV_RECORDS', '동일 env revision이 2개 이상 있어 차단합니다.');
  }
  const single = matched[0];
  if (single == null || typeof single !== 'object') {
    fail('UNSAFE_RESPONSE_SHAPE', 'provider env record shape가 안전하지 않아 차단합니다.');
  }
  if (single.id !== envEntryId) {
    fail('ENV_ENTRY_ID_MISMATCH', 'provider readback env entry ID가 예상값과 달라 차단합니다.');
  }
  if (single.key !== envKey) {
    fail('ENV_KEY_MISMATCH', 'provider readback env key가 예상값과 달라 차단합니다.');
  }
  return single;
}

// ---------------------------------------------------------------------------
// Whitelist projections (metadata only, no value, FIELD_UNAVAILABLE fallback)
// ---------------------------------------------------------------------------

function normalizeEnvTarget(target) {
  if (typeof target === 'string') {
    if (!KNOWN_ENV_TARGETS.includes(target)) {
      fail('MALFORMED_TARGET_METADATA', 'provider env target metadata가 올바르지 않아 차단합니다.');
    }
    return target;
  }
  if (Array.isArray(target)) {
    if (target.length === 0) {
      fail('MALFORMED_TARGET_METADATA', 'provider env target metadata가 올바르지 않아 차단합니다.');
    }
    for (const entry of target) {
      if (typeof entry !== 'string' || !KNOWN_ENV_TARGETS.includes(entry)) {
        fail('MALFORMED_TARGET_METADATA', 'provider env target metadata가 올바르지 않아 차단합니다.');
      }
    }
    return Object.freeze([...target]);
  }
  fail('MALFORMED_TARGET_METADATA', 'provider env target metadata가 올바르지 않아 차단합니다.');
}

function normalizeGitBranch(gitBranch) {
  if (gitBranch === undefined || gitBranch === null) return FIELD_UNAVAILABLE;
  if (typeof gitBranch !== 'string') {
    fail('MALFORMED_GITBRANCH_METADATA', 'provider env gitBranch metadata가 올바르지 않아 차단합니다.');
  }
  const trimmed = gitBranch.trim();
  if (!trimmed) return FIELD_UNAVAILABLE;
  return trimmed;
}

function normalizeTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return FIELD_UNAVAILABLE;
}

/**
 * Project env metadata whitelist projection. Contains ONLY id/key/type/
 * target/gitBranch/createdAt/updatedAt. Value/ciphertext/decrypted flags are
 * never copied. Missing timestamps become FIELD_UNAVAILABLE.
 */
export function projectEnvMetadata(record) {
  if (record == null || typeof record !== 'object' || Array.isArray(record)) {
    fail('UNSAFE_RESPONSE_SHAPE', 'provider env record shape가 안전하지 않아 차단합니다.');
  }
  if (typeof record.id !== 'string' || !record.id) {
    fail('UNSAFE_RESPONSE_SHAPE', 'provider env record id가 없어 차단합니다.');
  }
  if (typeof record.key !== 'string' || !record.key) {
    fail('UNSAFE_RESPONSE_SHAPE', 'provider env record key가 없어 차단합니다.');
  }
  if (typeof record.type !== 'string' || !record.type) {
    fail('UNSAFE_RESPONSE_SHAPE', 'provider env record type이 없어 차단합니다.');
  }
  if (!Object.hasOwn(record, 'target')) {
    fail('UNSAFE_RESPONSE_SHAPE', 'provider env record target이 없어 차단합니다.');
  }
  const target = normalizeEnvTarget(record.target);
  const gitBranch = normalizeGitBranch(record.gitBranch);
  return Object.freeze({
    id: record.id,
    key: record.key,
    type: record.type,
    target,
    gitBranch,
    createdAt: normalizeTimestamp(record.createdAt),
    updatedAt: normalizeTimestamp(record.updatedAt),
  });
}

function unwrapDeployment(payload) {
  if (payload?.deployment && typeof payload.deployment === 'object') {
    return payload.deployment;
  }
  return payload != null && typeof payload === 'object' ? payload : null;
}

function deploymentProjectId(deployment) {
  return deployment?.projectId ?? deployment?.project?.id ?? null;
}

function deploymentProjectName(deployment) {
  return deployment?.project?.name ?? deployment?.name ?? null;
}

function deploymentSourceSha(deployment) {
  return (
    deployment?.meta?.githubCommitSha ??
    deployment?.gitSource?.sha ??
    deployment?.deployment?.meta?.githubCommitSha ??
    null
  );
}

function deploymentSourceRef(deployment) {
  return (
    deployment?.meta?.githubCommitRef ??
    deployment?.gitSource?.ref ??
    null
  );
}

function deploymentStateValue(deployment) {
  const state = typeof deployment?.state === 'string' ? deployment.state : null;
  const readyState = typeof deployment?.readyState === 'string' ? deployment.readyState : null;
  return state ?? readyState ?? null;
}

/**
 * Deployment metadata whitelist projection. Contains ONLY id/project/
 * projectId/sourceSha/sourceRef/state/target/createdAt. No URL, no value,
 * no token. Identity (id/project/projectId) mismatches fail closed.
 * Missing optional sourceRef/createdAt become FIELD_UNAVAILABLE; missing
 * sourceSha/state/target shape failures fail closed because the projection
 * would otherwise be unsafe. Applicability/freshness (READY vs BUILDING,
 * revision newer/older, allowlist-applied) is NEVER concluded here.
 */
export function projectDeploymentMetadata(
  { payload, pinnedDeploymentId = PINNED_DRIVER_DEPLOYMENT_ID } = {},
) {
  if (pinnedDeploymentId !== PINNED_DRIVER_DEPLOYMENT_ID) {
    fail('DEPLOYMENT_ID_MISMATCH', 'pinned deployment ID가 예상값과 달라 차단합니다.');
  }
  const deployment = unwrapDeployment(payload);
  if (!deployment) {
    fail('UNSAFE_RESPONSE_SHAPE', 'provider deployment shape가 안전하지 않아 차단합니다.');
  }
  const observedId = deployment.id ?? deployment.uid ?? null;
  if (observedId !== pinnedDeploymentId) {
    fail('DEPLOYMENT_ID_MISMATCH', 'provider deployment ID가 pinned ID와 달라 차단합니다.');
  }
  if (deploymentProjectId(deployment) !== DRIVER_PROJECT_ID) {
    fail('PROJECT_ID_MISMATCH', 'provider deployment project ID가 예상값과 달라 차단합니다.');
  }
  if (deploymentProjectName(deployment) !== DRIVER_PROJECT) {
    fail('PROJECT_MISMATCH', 'provider deployment project가 예상값과 달라 차단합니다.');
  }
  const rawTarget = Object.hasOwn(deployment, 'target') ? deployment.target : undefined;
  if (rawTarget !== null && typeof rawTarget !== 'string') {
    fail('MALFORMED_TARGET_METADATA', 'provider deployment target metadata가 올바르지 않아 차단합니다.');
  }
  const state = deploymentStateValue(deployment);
  if (typeof state !== 'string' || !state) {
    fail('UNSAFE_RESPONSE_SHAPE', 'provider deployment state가 없어 차단합니다.');
  }
  const sourceSha = deploymentSourceSha(deployment);
  const projectedSha = typeof sourceSha === 'string' && sourceSha ? sourceSha : FIELD_UNAVAILABLE;
  const sourceRef = deploymentSourceRef(deployment);
  const projectedRef =
    typeof sourceRef === 'string' && sourceRef.trim() ? sourceRef.trim() : FIELD_UNAVAILABLE;
  const createdAtRaw = deployment.createdAt ?? null;
  return Object.freeze({
    id: observedId,
    project: DRIVER_PROJECT,
    projectId: DRIVER_PROJECT_ID,
    sourceSha: projectedSha,
    sourceRef: projectedRef,
    state,
    target: rawTarget ?? null,
    createdAt: normalizeTimestamp(createdAtRaw),
  });
}

/**
 * Secret-leak guard used by specs and safe loggers: serialized result must
 * never contain a secret/value substring.
 */
export function resultExposesSecret(result, secrets) {
  const serialized = JSON.stringify(result ?? {});
  const candidates = Array.isArray(secrets) ? secrets : [secrets];
  return candidates
    .filter((value) => typeof value === 'string' && value.trim() !== '')
    .some((value) => serialized.includes(value));
}

// ---------------------------------------------------------------------------
// Bounded read orchestrator (exactly TWO GETs on success, ZERO on pre-fail)
// ---------------------------------------------------------------------------

/**
 * Read Driver Preview pinned deployment + env revision metadata in ONE
 * bounded read-only operation.
 *
 * Validation order is fixed:
 *   1. read credential (zero provider calls on failure, no write fallback)
 *   2. exact driver Preview read target incl. driver isolation, Preview-only,
 *      GET-only, decrypt=false, no teamId override, no write-token vector
 *   3. deployment GET (exactly ONE) + identity gate + whitelist projection
 *   4. env list GET (exactly ONE) + single-record gate + whitelist projection
 *
 * The injected `fetchImpl` seam keeps deterministic tests provider-free.
 * Returns frozen { deployment, env, providerCalls: 2 } plus credential/provenance
 * NAMES only (never values). Raw provider payloads are never returned.
 */
export async function readDriverPreviewRevision({
  env = process.env,
  target,
  fetchImpl = fetch,
} = {}) {
  // 1. Read credential first — zero provider calls on failure.
  const readToken = resolveReadCredential(env);

  // 2. Exact driver Preview read target before touching provider state.
  assertExactDriverReadTarget(target);

  const deploymentId = target.deploymentId;
  const projectId = target.projectId;

  // 3. Deployment metadata GET (exactly ONE).
  const deploymentPayload = await requestVercelDeploymentMetadata({
    deploymentId,
    readToken,
    fetchImpl,
  });
  const deployment = projectDeploymentMetadata({
    payload: deploymentPayload,
    pinnedDeploymentId: deploymentId,
  });

  // 4. Env list GET (exactly ONE) + single-record gate + projection.
  const envListPayload = await requestVercelEnvList({
    projectId,
    readToken,
    fetchImpl,
  });
  const singleRecord = filterSingleEnvRecord({
    envListPayload,
    envEntryId: target.envEntryId,
    envKey: target.envKey,
  });
  const envRecord = projectEnvMetadata(singleRecord);

  return Object.freeze({
    deployment,
    env: envRecord,
    providerCalls: 2,
    deploymentCalls: 1,
    envCalls: 1,
    credentialName: READ_CREDENTIAL_NAME,
    credentialValueRecorded: false,
    project: DRIVER_PROJECT,
    projectId: DRIVER_PROJECT_ID,
    environment: DRIVER_PREVIEW_ENVIRONMENT,
  });
}

// ---------------------------------------------------------------------------
// CLI (check-only by default; no live GET without explicit --read)
// ---------------------------------------------------------------------------

const invokedAsMainScript =
  process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsMainScript) {
  const argv = process.argv.slice(2);
  const wantsRead = argv.includes('--read');
  try {
    // Static contract self-check: exact constants + Preview-only + GET paths.
    assertExactDriverReadTarget({
      project: DRIVER_PROJECT,
      projectId: DRIVER_PROJECT_ID,
      environment: DRIVER_PREVIEW_ENVIRONMENT,
      envEntryId: DRIVER_ENV_ENTRY_ID,
      envKey: DRIVER_ENV_KEY,
      deploymentId: PINNED_DRIVER_DEPLOYMENT_ID,
      sourceSha: EXPECTED_SOURCE_SHA,
      sourceRef: EXPECTED_SOURCE_REF,
    });
    const deploymentPath = vercelDeploymentReadPath(PINNED_DRIVER_DEPLOYMENT_ID);
    const envListPath = vercelDriverEnvListPath(DRIVER_PROJECT_ID);
    assertNoDecryptQuery(`${VERCEL_API_ORIGIN}${deploymentPath}`);
    assertNoDecryptQuery(`${VERCEL_API_ORIGIN}${envListPath}`);
    if (!wantsRead) {
      process.stdout.write(
        `${JSON.stringify({ mode: 'check-only', contract: 'DRIVER_PREVIEW_READ_ONLY', providerCalls: 0, mutationExecuted: false })}\n`,
      );
    } else {
      resolveReadCredential(process.env);
      process.stderr.write('[read-driver-preview-revision] live read requires workflow dispatch context.\n');
      process.exit(1);
    }
  } catch (error) {
    const code = error instanceof ReadRevisionError ? error.code : 'READ_CHECK_FAILED';
    process.stderr.write(`[read-driver-preview-revision] ${code}: gate blocked.\n`);
    process.exit(1);
  }
}
