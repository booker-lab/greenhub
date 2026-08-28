import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const APPLICATION_SHA = '9fda1a0909644cb77a223941f28266f7af69cdf9';
export const EVIDENCE_V2_SHA = 'ff351b79ae2e00ce8b111a906ea0cf1ee8b3d114';
export const DIAGNOSTIC_PARENT_SHA = '417c639cc221ade17ed065050e986855631dc42f';
export const DIAGNOSTIC_BRANCH = 'codex/p2-browser-consumer-auth-probe';
export const CONSUMER_DEPLOYMENT_ID = 'dpl_HxPNRSfPztdLxCKp9Tr5d271C4kn';
export const VERCEL_PROJECT_ID = 'prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w';
export const VERCEL_PROJECT_NAME = 'greenhubconsumer';
export const VERCEL_TEAM_ID = 'team_J91VWI0TqcHdcF36T7qVgiT1';
export const EXPECTED_API_ORIGIN = 'https://api-staging-94af.up.railway.app';
export const GITHUB_SECRET_NAME = 'ROUND_DIRECT_E2E_TEST_SECRET';
export const VERCEL_SECRET_KEY = 'E2E_TEST_SECRET';
export const VERCEL_API_URL = 'https://api.vercel.com';
export const PREVIEW_BRANCH = 'codex/p2-security-after-pay01';
export const API_ORIGIN_ENV_KEY = 'NEXT_PUBLIC_API_URL';
export const VERCEL_ENV_RUN_COMMAND = 'vercel';

export const SECRET_EQUALITIES = Object.freeze({
  MATCH: 'MATCH',
  MISMATCH: 'MISMATCH',
  NOT_PROVEN: 'NOT_PROVEN',
});

export const ORIGIN_CLASSIFICATIONS = Object.freeze({
  MATCH: 'API_ORIGIN_EXACT_DEPLOYMENT_MATCH',
  MISMATCH: 'API_ORIGIN_EXACT_DEPLOYMENT_MISMATCH',
  NOT_PROVEN: 'API_ORIGIN_EXACT_DEPLOYMENT_NOT_PROVEN',
});

export const DEPLOYMENT_RELATIVE_CLASSES = Object.freeze({
  BEFORE_OR_AT: 'BOUND_BEFORE_OR_AT_DEPLOYMENT',
  AFTER: 'CURRENT_VALUE_NOT_EXACT_DEPLOYMENT_PROOF',
  UNKNOWN: 'NOT_PROVEN',
});

export const DEPLOYMENT_FILE_RESULTS = Object.freeze({
  NOT_APPLICABLE_GIT_SOURCE: 'NOT_APPLICABLE_GIT_SOURCE',
});

export const ROOT_CAUSES = Object.freeze({
  AUTH_HEADER_SECRET_MISMATCH: 'AUTH_HEADER_SECRET_MISMATCH',
  CONSUMER_API_ORIGIN_MISMATCH: 'CONSUMER_API_ORIGIN_MISMATCH',
  NOT_CLASSIFIED: 'NOT_CLASSIFIED',
});

export const STATUSES = Object.freeze({
  SECRET_MISMATCH_CONFIRMED: 'AUTH_HEADER_SECRET_MISMATCH_CONFIRMED',
  API_ORIGIN_MISMATCH_CONFIRMED: 'CONSUMER_API_ORIGIN_MISMATCH_CONFIRMED',
  MULTIPLE_CONFIGURATION_MISMATCH: 'MULTIPLE_CONFIGURATION_MISMATCH',
  BOTH_MATCH: 'SECRET_AND_ORIGIN_BOTH_PROVEN_MATCH',
  PARTIAL_CONFIGURATION: 'PARTIAL_CONFIGURATION_DISCRIMINATION',
  ENV_VALUE_READ_INSUFFICIENT: 'EFFECTIVE_ENV_VALUE_READ_INSUFFICIENT',
  ENV_READ_CAPABILITY_REQUIRED: 'VERCEL_ENV_READ_CAPABILITY_REQUIRED',
  PROJECT_SCOPE_READ_MISMATCH: 'VERCEL_PROJECT_SCOPE_READ_MISMATCH',
  READ_CREDENTIAL_SCOPE_INVALID_OR_CHANGED: 'VERCEL_READ_CREDENTIAL_SCOPE_INVALID_OR_CHANGED',
  SECRET_BINDING_NOT_PROVEN: 'SECRET_DEPLOYMENT_BINDING_NOT_PROVEN',
  API_ORIGIN_NOT_PROVEN: 'API_ORIGIN_EXACT_DEPLOYMENT_NOT_PROVEN',
  INCONCLUSIVE: 'SECRET_ORIGIN_DISCRIMINATION_INCONCLUSIVE',
  SAFETY_FAILED: 'DIAGNOSTIC_SAFETY_GATE_FAILED',
});

export const FINAL_STATUSES = Object.freeze({
  SECRET_MISMATCH_CONFIRMED: 'ROOT_CAUSE_CONFIRMED_AUTH_HEADER_SECRET_MISMATCH',
  API_ORIGIN_MISMATCH_CONFIRMED: 'ROOT_CAUSE_CONFIRMED_CONSUMER_API_ORIGIN_MISMATCH',
  MULTIPLE_CONFIGURATION_MISMATCH: 'MULTIPLE_CONFIGURATION_MISMATCH',
  BOTH_MATCH: 'CONFIGURATION_MATCHED_AUTHORIZE_RUNTIME_BOUNDARY_REQUIRED',
  CONFIGURATION_MATCHED: 'CONFIGURATION_MATCHED_AUTHORIZE_RUNTIME_BOUNDARY_REQUIRED',
  PARTIAL_CONFIGURATION: 'PARTIAL_CONFIGURATION_DISCRIMINATION',
  ENV_VALUE_READ_INSUFFICIENT: 'SELECTED_ENV_VALUE_READ_CAPABILITY_UNAVAILABLE',
  ENV_READ_CAPABILITY_REQUIRED: 'SELECTED_ENV_VALUE_READ_CAPABILITY_UNAVAILABLE',
  PROJECT_SCOPE_READ_MISMATCH: 'DIAGNOSTIC_AUTHORITY_MISMATCH',
  READ_CREDENTIAL_SCOPE_INVALID_OR_CHANGED: 'SELECTED_ENV_VALUE_READ_CAPABILITY_UNAVAILABLE',
  INCONCLUSIVE: 'SELECTED_ENV_VALUE_READ_CAPABILITY_UNAVAILABLE',
  SAFETY_FAILED: 'SELECTED_ENV_VALUE_READ_CAPABILITY_UNAVAILABLE',
});

export const NEXT_GATES = Object.freeze({
  GITHUB_SECRET_REBIND: 'GITHUB_SECRET_REBIND_GATE',
  VERCEL_PREVIEW_REBIND: 'VERCEL_PREVIEW_ENV_REBIND_AND_EXACT_REDEPLOY_GATE',
  AUTH_SECRET_CANONICAL_RECONCILIATION: 'P2_AUTH_HEADER_SECRET_MINIMUM_REMEDIATION_GATE',
  API_ORIGIN_REBIND: 'P2_CONSUMER_API_ORIGIN_MINIMUM_REMEDIATION_GATE',
  MULTIPLE_CONFIGURATION_REVIEW: 'P2_MULTIPLE_CONFIG_MISMATCH_CONTROL_TOWER_REVIEW',
  AUTHORIZE_BOUNDARY_REOPEN: 'P2_AUTHORIZE_RUNTIME_BOUNDARY_REOPEN_GATE',
  VERCEL_READ_CREDENTIAL_SCOPE_RECOVERY: 'P2_VERCEL_READ_CREDENTIAL_SCOPE_RECOVERY_GATE',
  SELECTED_ENV_PERMISSION_RECOVERY: 'P2_VERCEL_SELECTED_ENV_VALUE_PERMISSION_RECOVERY_GATE',
  RUNTIME_EFFECTIVE_ENV_COMPARISON_REVIEW: 'P2_RUNTIME_EFFECTIVE_ENV_COMPARISON_CONTROL_TOWER_REVIEW',
  REMAINING_CONFIGURATION_EVIDENCE: 'P2_REMAINING_CONFIGURATION_EVIDENCE_GATE',
  NONE_EVIDENCE: 'NONE_EVIDENCE_INSUFFICIENT',
});

export const VALUE_READ_RESULTS = Object.freeze({
  HTTP_200_VALUE_AVAILABLE: 'HTTP_200_VALUE_AVAILABLE',
  HTTP_200_VALUE_UNAVAILABLE: 'HTTP_200_VALUE_UNAVAILABLE',
  HTTP_401: 'HTTP_401',
  HTTP_403: 'HTTP_403',
  HTTP_404: 'HTTP_404',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  NOT_PROBED: 'NOT_PROBED',
  COMMAND_FAILED: 'COMMAND_FAILED',
});

export const READ_STAGES = Object.freeze({
  DEPLOYMENT_METADATA: 'DEPLOYMENT_METADATA',
  PROJECT_METADATA: 'PROJECT_METADATA',
  ENV_V10_METADATA_ONLY: 'ENV_V10_METADATA_ONLY',
  ENV_V10_DECRYPTED_CLI_SOURCE: 'ENV_V10_DECRYPTED_CLI_SOURCE',
  ENV_V10_DECRYPTED: 'ENV_V10_DECRYPTED_CLI_SOURCE',
  ENV_V9_METADATA_ONLY: 'ENV_V9_METADATA_ONLY',
  ENV_V9_DECRYPTED: 'ENV_V9_DECRYPTED',
  ENV_V10_METADATA_REVERIFY: 'ENV_V10_METADATA_REVERIFY',
  SELECTED_SECRET_PROJECT_ENV: 'SELECTED_SECRET_PROJECT_ENV',
  SELECTED_API_ORIGIN_PROJECT_ENV: 'SELECTED_API_ORIGIN_PROJECT_ENV',
  SHARED_SECRET_ENV: 'SHARED_SECRET_ENV',
  SHARED_API_ORIGIN_ENV: 'SHARED_API_ORIGIN_ENV',
  VERCEL_ENV_RUN: 'VERCEL_ENV_RUN',
  DEPLOYMENT_FILES: 'DEPLOYMENT_FILES',
  DEPLOYMENT_FILE_CONTENT: 'DEPLOYMENT_FILE_CONTENT',
});

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const execFileAsync = promisify(execFile);
const SAFE_ERROR_CODES = new Set([
  'GITHUB_SECRET_REQUIRED',
  'VERCEL_READ_TOKEN_REQUIRED',
  'VERCEL_API_UNAVAILABLE',
  'VERCEL_API_HTTP_401',
  'VERCEL_API_HTTP_403',
  'VERCEL_API_HTTP_404',
  'VERCEL_API_HTTP_409',
  'VERCEL_API_HTTP_429',
  'VERCEL_API_HTTP_500',
  'VERCEL_API_HTTP_502',
  'VERCEL_API_HTTP_503',
  'VERCEL_ENV_READ_CAPABILITY_MISSING',
  'VERCEL_ENV_DECRYPT_READ_FAILED',
  'VERCEL_PROJECT_SCOPE_READ_MISMATCH',
  'VERCEL_READ_CREDENTIAL_SCOPE_INVALID_OR_CHANGED',
  'VERCEL_RESPONSE_MALFORMED',
  'VERCEL_API_RESPONSE_MALFORMED',
  'DEPLOYMENT_IDENTITY_MISMATCH',
  'DEPLOYMENT_FILES_RESPONSE_MALFORMED',
  'DEPLOYMENT_FILE_RESPONSE_MALFORMED',
  'VERCEL_ENV_RUN_FAILED',
  'VERCEL_ENV_RUN_OUTPUT_MALFORMED',
  'APPLICATION_SHA_MALFORMED',
  'APPLICATION_SHA_MISMATCH',
]);

const API_MARKERS = Object.freeze(
  ['login', 'refresh', 'kakao-login'].map((action) => ['', 'auth', action].join('/')),
);
export { API_MARKERS };

const HTTPS_ORIGIN_PATTERN = /https:\/\/[A-Za-z0-9.-]+(?::\d+)?/g;
const MAX_SERVER_FILE_TEXT_LENGTH = 12 * 1024 * 1024;

export class DiscriminationContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DiscriminationContractError';
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(code, message, details) {
  throw new DiscriminationContractError(code, message, details);
}

function requireNonEmptyString(value, code) {
  if (typeof value !== 'string' || value.length === 0) fail(code, '필수 입력이 없습니다.');
  return value;
}

function assertApplicationSha(value) {
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) {
    fail('APPLICATION_SHA_MALFORMED', '애플리케이션 SHA 형식이 잘못되었습니다.');
  }
  if (value !== APPLICATION_SHA) {
    fail('APPLICATION_SHA_MISMATCH', '애플리케이션 authority SHA와 다릅니다.');
  }
  return value;
}

function safeHttpStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

async function readJsonResponse(response, stage) {
  const status = safeHttpStatus(response?.status);
  if (!status || status < 200 || status >= 300) {
    fail(`VERCEL_API_HTTP_${status ?? 'UNKNOWN'}`, 'Vercel 읽기 API 응답이 성공이 아닙니다.', {
      stage,
      httpStatus: status,
    });
  }
  if (typeof response?.json !== 'function') {
    fail('VERCEL_RESPONSE_MALFORMED', 'Vercel 응답 형식이 잘못되었습니다.', { stage, httpStatus: status });
  }
  try {
    return await response.json();
  } catch {
    fail('VERCEL_API_RESPONSE_MALFORMED', 'Vercel JSON 응답을 읽을 수 없습니다.', { stage, httpStatus: status });
  }
}

async function readTextResponse(response, stage) {
  const status = safeHttpStatus(response?.status);
  if (!status || status < 200 || status >= 300) {
    fail(`VERCEL_API_HTTP_${status ?? 'UNKNOWN'}`, 'Vercel 읽기 API 응답이 성공이 아닙니다.', {
      stage,
      httpStatus: status,
    });
  }
  if (typeof response?.text !== 'function') {
    fail('VERCEL_RESPONSE_MALFORMED', 'Vercel 파일 응답 형식이 잘못되었습니다.', { stage, httpStatus: status });
  }
  try {
    return await response.text();
  } catch {
    fail('DEPLOYMENT_FILE_RESPONSE_MALFORMED', 'Vercel 서버 파일을 읽을 수 없습니다.', { stage, httpStatus: status });
  }
}

function buildVercelUrl(pathname, query = {}) {
  const url = new URL(pathname, VERCEL_API_URL);
  url.searchParams.set('teamId', VERCEL_TEAM_ID);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function requestVercel({ fetchImpl, token, pathname, query, accept, stage }) {
  let response;
  try {
    response = await fetchImpl(buildVercelUrl(pathname, query), {
      method: 'GET',
      headers: {
        Accept: accept,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    fail('VERCEL_API_UNAVAILABLE', 'Vercel 읽기 API에 연결할 수 없습니다.', { stage, httpStatus: null });
  }
  return response;
}

async function getVercelJson({ fetchImpl, token, pathname, query, stage }) {
  const response = await requestVercel({
    fetchImpl,
    token,
    pathname,
    query,
    accept: 'application/json',
    stage,
  });
  return readJsonResponse(response, stage);
}

async function getVercelText({ fetchImpl, token, pathname, stage }) {
  const response = await requestVercel({
    fetchImpl,
    token,
    pathname,
    accept: 'text/plain, application/octet-stream',
    stage,
  });
  return readTextResponse(response, stage);
}

async function probeJsonEndpoint({ fetchImpl, token, pathname, query, stage }) {
  let response;
  try {
    response = await requestVercel({
      fetchImpl,
      token,
      pathname,
      query,
      accept: 'application/json',
      stage,
    });
  } catch (error) {
    return {
      ok: false,
      httpStatus: Number.isInteger(error?.httpStatus) ? error.httpStatus : null,
      failureCode: error?.code ?? 'VERCEL_API_UNAVAILABLE',
      stage,
    };
  }
  const httpStatus = safeHttpStatus(response?.status);
  if (!httpStatus || httpStatus < 200 || httpStatus >= 300) {
    return {
      ok: false,
      httpStatus,
      failureCode: `VERCEL_API_HTTP_${httpStatus ?? 'UNKNOWN'}`,
      stage,
    };
  }
  try {
    return { ok: true, httpStatus, payload: await readJsonResponse(response, stage), stage };
  } catch (error) {
    return {
      ok: false,
      httpStatus,
      failureCode: error?.code ?? 'VERCEL_API_RESPONSE_MALFORMED',
      stage,
    };
  }
}

function targetsIncludePreview(target) {
  if (Array.isArray(target)) return target.some((item) => item === 'preview');
  return target === 'preview';
}

function isGenericBranch(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function envEntries(payload) {
  return Array.isArray(payload?.envs) ? payload.envs.filter((entry) => entry && typeof entry === 'object') : [];
}

function isUsablePlaintextValue(entry) {
  if (typeof entry?.value !== 'string' || entry.value.length === 0) return false;
  return entry.decrypted !== false;
}

function yesNo(value) {
  return value ? 'YES' : 'NO';
}

function responseType(entry) {
  return typeof entry?.type === 'string' && entry.type.length > 0 ? entry.type : 'UNKNOWN';
}

function selectedEnvId(entry) {
  return typeof entry?.id === 'string' && entry.id.length > 0 ? entry.id : null;
}

function sharedEnvId(entry) {
  const explicitIds = [
    entry?.sharedEnvId,
    entry?.sharedEnvVariableId,
    entry?.sharedEnvironmentVariableId,
    entry?.sharedEnvironmentVariable?.id,
  ];
  return explicitIds.find((value) => typeof value === 'string' && /^env_[A-Za-z0-9]+$/.test(value)) ?? null;
}

export function resolvePreviewEnvEntry(payload, key, branch = PREVIEW_BRANCH) {
  const candidates = envEntries(payload).filter(
    (entry) => entry.key === key && targetsIncludePreview(entry.target),
  );
  const branchEntries = candidates.filter((entry) => entry.gitBranch === branch);
  if (branchEntries.length > 1) return { scope: 'AMBIGUOUS', entry: null };
  if (branchEntries.length === 1) return { scope: 'BRANCH_PREVIEW', entry: branchEntries[0] };

  const genericEntries = candidates.filter((entry) => isGenericBranch(entry.gitBranch));
  if (genericEntries.length > 1) return { scope: 'AMBIGUOUS', entry: null };
  if (genericEntries.length === 1) return { scope: 'GENERIC_PREVIEW', entry: genericEntries[0] };
  return { scope: 'MISSING', entry: null };
}

export function classifySecretBinding({ githubSecret, resolution }) {
  const githubSecretConfigured = typeof githubSecret === 'string' && githubSecret.length > 0;
  const vercelValue = resolution?.entry?.value;
  const vercelValueConfigured = isUsablePlaintextValue(resolution?.entry);
  let equality = SECRET_EQUALITIES.NOT_PROVEN;
  if (githubSecretConfigured && vercelValueConfigured && resolution?.entry) {
    equality = githubSecret === vercelValue ? SECRET_EQUALITIES.MATCH : SECRET_EQUALITIES.MISMATCH;
  }
  return {
    githubSecretConfigured,
    vercelEnvKeyConfigured: Boolean(resolution?.entry),
    effectiveScope: resolution?.scope ?? 'MISSING',
    equality,
    envCreatedAt: resolution?.entry?.createdAt ?? null,
    envUpdatedAt: resolution?.entry?.updatedAt ?? null,
  };
}

function asDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' || typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function classifyUpdatedRelativeToDeployment(value, deploymentCreatedAt) {
  const updated = asDate(value);
  const created = asDate(deploymentCreatedAt);
  if (!updated || !created) return DEPLOYMENT_RELATIVE_CLASSES.UNKNOWN;
  return updated.getTime() <= created.getTime()
    ? DEPLOYMENT_RELATIVE_CLASSES.BEFORE_OR_AT
    : DEPLOYMENT_RELATIVE_CLASSES.AFTER;
}

export function classifyEnvBindingRelativeToDeployment({ createdAt, updatedAt }, deploymentCreatedAt) {
  const envCreated = asDate(createdAt);
  const envUpdated = asDate(updatedAt);
  const deploymentCreated = asDate(deploymentCreatedAt);
  if (!envCreated || !envUpdated || !deploymentCreated) return DEPLOYMENT_RELATIVE_CLASSES.UNKNOWN;
  return envCreated.getTime() <= deploymentCreated.getTime()
    && envUpdated.getTime() <= deploymentCreated.getTime()
    ? DEPLOYMENT_RELATIVE_CLASSES.BEFORE_OR_AT
    : DEPLOYMENT_RELATIVE_CLASSES.AFTER;
}

function safeOrigin(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function classifyCurrentApiOrigin(resolution) {
  if (!isUsablePlaintextValue(resolution?.entry)) return 'CURRENT_API_ORIGIN_NOT_PROVEN';
  const origin = safeOrigin(resolution.entry.value);
  if (!origin) return 'CURRENT_API_ORIGIN_NOT_PROVEN';
  return origin === EXPECTED_API_ORIGIN
    ? 'CURRENT_API_ORIGIN_MATCH'
    : 'CURRENT_API_ORIGIN_MISMATCH';
}

function normalizeFileName(value) {
  return typeof value === 'string' ? value.replaceAll('\\', '/').toLowerCase() : '';
}

function isServerAuthBundleCandidate(name) {
  const normalized = normalizeFileName(name);
  return normalized.includes('/api/auth/')
    && normalized.endsWith('.js')
    && (normalized.includes('nextauth') || normalized.includes('[...nextauth]') || normalized.endsWith('/route.js'));
}

function deploymentFiles(payload) {
  if (Array.isArray(payload)) return payload.filter((file) => file && typeof file === 'object');
  if (Array.isArray(payload?.files)) return payload.files.filter((file) => file && typeof file === 'object');
  fail('DEPLOYMENT_FILES_RESPONSE_MALFORMED', 'Vercel 배포 파일 트리가 배열이 아닙니다.');
}

function fileId(file) {
  if (typeof file?.uid === 'string' && file.uid.length > 0) return file.uid;
  if (typeof file?.id === 'string' && file.id.length > 0) return file.id;
  return null;
}

function inspectBundleText(text) {
  if (typeof text !== 'string' || text.length > MAX_SERVER_FILE_TEXT_LENGTH) {
    return { markerFound: false, unresolved: true, origins: [] };
  }
  const normalized = text.replaceAll('\\u002f', '/').replaceAll('\\/', '/');
  let markerFound = false;
  let unresolved = false;
  const origins = [];

  for (const marker of API_MARKERS) {
    let offset = 0;
    while (true) {
      const index = normalized.indexOf(marker, offset);
      if (index < 0) break;
      markerFound = true;
      const start = Math.max(0, index - 2048);
      const end = Math.min(normalized.length, index + marker.length + 2048);
      const windowText = normalized.slice(start, end);
      const nearbyOrigins = [...windowText.matchAll(HTTPS_ORIGIN_PATTERN)].map((match) => match[0]);
      const uniqueOrigins = [...new Set(nearbyOrigins)];
      if (uniqueOrigins.length !== 1) unresolved = true;
      else origins.push(uniqueOrigins[0]);
      offset = index + marker.length;
    }
  }
  return { markerFound, unresolved, origins };
}

export async function inspectExactDeploymentApiOrigin({ filesPayload, fetchImpl, token }) {
  const candidates = deploymentFiles(filesPayload).filter((file) => isServerAuthBundleCandidate(file.name));
  let serverBundleInspected = false;
  let markerFound = false;
  let unresolved = false;
  const origins = [];

  for (const candidate of candidates) {
    const id = fileId(candidate);
    if (!id) {
      unresolved = true;
      continue;
    }
    const text = await getVercelText({
      fetchImpl,
      token,
      pathname: `/v8/deployments/${encodeURIComponent(CONSUMER_DEPLOYMENT_ID)}/files/${encodeURIComponent(id)}`,
      stage: READ_STAGES.DEPLOYMENT_FILE_CONTENT,
    });
    serverBundleInspected = true;
    const evidence = inspectBundleText(text);
    markerFound ||= evidence.markerFound;
    unresolved ||= evidence.unresolved;
    origins.push(...evidence.origins);
  }

  const uniqueOrigins = [...new Set(origins)];
  let classification = ORIGIN_CLASSIFICATIONS.NOT_PROVEN;
  if (markerFound && !unresolved && uniqueOrigins.length === 1) {
    classification = uniqueOrigins[0] === EXPECTED_API_ORIGIN
      ? ORIGIN_CLASSIFICATIONS.MATCH
      : ORIGIN_CLASSIFICATIONS.MISMATCH;
  }
  return {
    serverBundleInspected,
    markerFound,
    classification,
    serverBundleEvidence: classification === ORIGIN_CLASSIFICATIONS.MATCH
      ? 'MATCH'
      : classification === ORIGIN_CLASSIFICATIONS.MISMATCH ? 'MISMATCH' : 'NOT_AVAILABLE',
  };
}

function exactSecretProof(secretBinding, secretRelative) {
  return (secretBinding?.equality === SECRET_EQUALITIES.MATCH
    || secretBinding?.equality === SECRET_EQUALITIES.MISMATCH)
    && secretRelative === DEPLOYMENT_RELATIVE_CLASSES.BEFORE_OR_AT;
}

export function classifyDiscrimination({
  secretBinding,
  secretUpdatedRelative,
  secretBindingRelative,
  apiOriginClassification,
}) {
  const resolvedSecretRelative = secretBindingRelative ?? secretUpdatedRelative;
  const secretProof = exactSecretProof(secretBinding, resolvedSecretRelative);
  const secretMismatchProven = secretProof && secretBinding.equality === SECRET_EQUALITIES.MISMATCH;
  const secretMatchProven = secretProof && secretBinding.equality === SECRET_EQUALITIES.MATCH;
  const apiOriginMatch = apiOriginClassification === ORIGIN_CLASSIFICATIONS.MATCH;
  const apiOriginMismatch = apiOriginClassification === ORIGIN_CLASSIFICATIONS.MISMATCH;
  const secretCandidate = ROOT_CAUSES.AUTH_HEADER_SECRET_MISMATCH;
  const originCandidate = ROOT_CAUSES.CONSUMER_API_ORIGIN_MISMATCH;

  if (secretMismatchProven && apiOriginMismatch) {
    return {
      status: STATUSES.MULTIPLE_CONFIGURATION_MISMATCH,
      rootCauseClass: ROOT_CAUSES.NOT_CLASSIFIED,
      eliminatedCandidates: [],
      remainingCandidates: [secretCandidate, originCandidate],
      nextGate: NEXT_GATES.MULTIPLE_CONFIGURATION_REVIEW,
    };
  }
  if (secretMismatchProven) {
    if (!apiOriginMatch) {
      return {
        status: STATUSES.PARTIAL_CONFIGURATION,
        rootCauseClass: ROOT_CAUSES.NOT_CLASSIFIED,
        eliminatedCandidates: [],
        remainingCandidates: [originCandidate],
        nextGate: NEXT_GATES.REMAINING_CONFIGURATION_EVIDENCE,
      };
    }
    return {
      status: STATUSES.SECRET_MISMATCH_CONFIRMED,
      rootCauseClass: ROOT_CAUSES.AUTH_HEADER_SECRET_MISMATCH,
      eliminatedCandidates: [originCandidate],
      remainingCandidates: [],
      nextGate: NEXT_GATES.AUTH_SECRET_CANONICAL_RECONCILIATION,
    };
  }
  if (apiOriginMismatch) {
    if (!secretMatchProven) {
      return {
        status: STATUSES.PARTIAL_CONFIGURATION,
        rootCauseClass: ROOT_CAUSES.NOT_CLASSIFIED,
        eliminatedCandidates: [],
        remainingCandidates: [secretCandidate],
        nextGate: NEXT_GATES.REMAINING_CONFIGURATION_EVIDENCE,
      };
    }
    return {
      status: STATUSES.API_ORIGIN_MISMATCH_CONFIRMED,
      rootCauseClass: ROOT_CAUSES.CONSUMER_API_ORIGIN_MISMATCH,
      eliminatedCandidates: [secretCandidate],
      remainingCandidates: [],
      nextGate: NEXT_GATES.API_ORIGIN_REBIND,
    };
  }
  if (secretMatchProven && apiOriginMatch) {
    return {
      status: STATUSES.BOTH_MATCH,
      rootCauseClass: ROOT_CAUSES.NOT_CLASSIFIED,
      eliminatedCandidates: [secretCandidate, originCandidate],
      remainingCandidates: [],
      nextGate: NEXT_GATES.AUTHORIZE_BOUNDARY_REOPEN,
    };
  }
  if (secretMatchProven) {
    return {
      status: STATUSES.PARTIAL_CONFIGURATION,
      rootCauseClass: ROOT_CAUSES.NOT_CLASSIFIED,
      eliminatedCandidates: [secretCandidate],
      remainingCandidates: [originCandidate],
      nextGate: NEXT_GATES.REMAINING_CONFIGURATION_EVIDENCE,
    };
  }
  if (apiOriginMatch) {
    return {
      status: STATUSES.PARTIAL_CONFIGURATION,
      rootCauseClass: ROOT_CAUSES.NOT_CLASSIFIED,
      eliminatedCandidates: [originCandidate],
      remainingCandidates: [secretCandidate],
      nextGate: NEXT_GATES.REMAINING_CONFIGURATION_EVIDENCE,
    };
  }
  if (secretBinding?.equality === SECRET_EQUALITIES.MATCH
    || secretBinding?.equality === SECRET_EQUALITIES.MISMATCH) {
    return {
      status: STATUSES.PARTIAL_CONFIGURATION,
      rootCauseClass: ROOT_CAUSES.NOT_CLASSIFIED,
      eliminatedCandidates: [],
      remainingCandidates: [secretCandidate, originCandidate],
      nextGate: NEXT_GATES.REMAINING_CONFIGURATION_EVIDENCE,
    };
  }
  return {
    status: STATUSES.ENV_VALUE_READ_INSUFFICIENT,
    rootCauseClass: ROOT_CAUSES.NOT_CLASSIFIED,
    eliminatedCandidates: [],
    remainingCandidates: [secretCandidate, originCandidate],
    nextGate: NEXT_GATES.REMAINING_CONFIGURATION_EVIDENCE,
  };
}

function validateDeployment(deployment, stage = READ_STAGES.DEPLOYMENT_METADATA) {
  if (deployment?.id !== CONSUMER_DEPLOYMENT_ID || deployment?.projectId !== VERCEL_PROJECT_ID) {
    fail('DEPLOYMENT_IDENTITY_MISMATCH', '대상 Vercel 배포 식별자가 예상값과 다릅니다.', { stage });
  }
  return deployment.createdAt ?? null;
}

function validateProject(project, stage = READ_STAGES.PROJECT_METADATA) {
  if (project?.id !== VERCEL_PROJECT_ID) {
    fail('VERCEL_PROJECT_SCOPE_READ_MISMATCH', '대상 Vercel 프로젝트 식별자가 예상값과 다릅니다.', { stage });
  }
  return {
    id: project.id,
    name: typeof project.name === 'string' ? project.name : null,
  };
}

function safeDiagnosticChild() {
  const value = process.env.GITHUB_SHA;
  return typeof value === 'string' && SHA_PATTERN.test(value) ? value : 'LOCAL_NOT_PUBLISHED';
}

function safeRunId() {
  const value = process.env.GITHUB_RUN_ID;
  return typeof value === 'string' && /^[0-9]+$/.test(value) ? value : 'LOCAL_NOT_RUN';
}

const ENV_RUN_CHILD_SOURCE = `
const secret = process.env.E2E_TEST_SECRET;
const origin = process.env.NEXT_PUBLIC_API_URL;
const githubSecret = process.env.ROUND_DIRECT_E2E_TEST_SECRET;
const secretAvailable = typeof secret === 'string' && secret.length > 0;
const originAvailable = typeof origin === 'string' && origin.length > 0;
const githubSecretAvailable = typeof githubSecret === 'string' && githubSecret.length > 0;
const normalizeOrigin = (value) => value.endsWith('/') ? value.slice(0, -1) : value;
const secretEquality = secretAvailable && githubSecretAvailable
  ? (secret === githubSecret ? 'MATCH' : 'MISMATCH')
  : 'NOT_PROVEN';
const originEquality = originAvailable
  ? (normalizeOrigin(origin) === 'https://api-staging-94af.up.railway.app' ? 'MATCH' : 'MISMATCH')
  : 'NOT_PROVEN';
process.stdout.write(JSON.stringify({
  secretAvailable,
  originAvailable,
  secretEquality,
  originEquality,
}));
`.trim();

export function classifyEnvRunResult(result) {
  const secretEquality = Object.values(SECRET_EQUALITIES).includes(result?.secretEquality)
    ? result.secretEquality
    : SECRET_EQUALITIES.NOT_PROVEN;
  const originEquality = Object.values(SECRET_EQUALITIES).includes(result?.originEquality)
    ? result.originEquality
    : SECRET_EQUALITIES.NOT_PROVEN;
  return {
    secretAvailable: result?.secretAvailable === true,
    originAvailable: result?.originAvailable === true,
    secretEquality,
    originEquality,
  };
}

function parseEnvRunOutput(stdout) {
  if (typeof stdout !== 'string') {
    fail('VERCEL_ENV_RUN_OUTPUT_MALFORMED', 'Vercel env run 결과 형식이 잘못되었습니다.');
  }
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    try {
      return classifyEnvRunResult(JSON.parse(line));
    } catch {
      // Vercel CLI 안내 출력은 결과로 해석하지 않는다.
    }
  }
  fail('VERCEL_ENV_RUN_OUTPUT_MALFORMED', 'Vercel env run 분류 결과가 없습니다.');
}

async function runVercelEnvRun({ vercelToken, branch, runCommand = VERCEL_ENV_RUN_COMMAND }) {
  let tempDirectory;
  try {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'greenhub-p2-selected-env-'));
    const inheritedEnvironment = {
      ...process.env,
      VERCEL_ORG_ID: VERCEL_TEAM_ID,
      VERCEL_PROJECT_ID,
    };
    const envRunEnvironment = Object.fromEntries(
      Object.entries(inheritedEnvironment)
        .filter(([key]) => key !== 'E2E_TEST_SECRET' && key !== 'NEXT_PUBLIC_API_URL'),
    );
    const { stdout } = await execFileAsync(runCommand, [
      '--token', vercelToken,
      '--non-interactive',
      '--cwd', tempDirectory,
      'env',
      'run',
      '--environment',
      'preview',
      '--git-branch',
      branch,
      '--',
      process.execPath,
      '--input-type=module',
      '-e',
      ENV_RUN_CHILD_SOURCE,
    ], {
      cwd: tempDirectory,
      env: envRunEnvironment,
      maxBuffer: 64 * 1024,
    });
    return parseEnvRunOutput(stdout);
  } catch (error) {
    if (error?.code === 'VERCEL_ENV_RUN_OUTPUT_MALFORMED') throw error;
    fail('VERCEL_ENV_RUN_FAILED', 'Vercel env run 읽기에 실패했습니다.');
  } finally {
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

function mutationCheck() {
  return {
    applicationChanged: false,
    evidenceV2Changed: false,
    mainChanged: false,
    pr56Changed: false,
    vercelEnvChanged: false,
    vercelRedeployed: false,
    railwayChanged: false,
    firebaseChanged: false,
    testUserChanged: false,
    passwordReset: false,
    githubSecretChanged: false,
    aligoChanged: false,
    actualAligoSend: false,
    authRequestPerformed: false,
    rawSecretExposed: false,
  };
}

function commonAuthorities() {
  const diagnosticEndingSha = safeDiagnosticChild();
  return {
    applicationSha: APPLICATION_SHA,
    evidenceV2Sha: EVIDENCE_V2_SHA,
    diagnosticStartingSha: DIAGNOSTIC_PARENT_SHA,
    diagnosticEndingSha,
    diagnosticParent: DIAGNOSTIC_PARENT_SHA,
    diagnosticChild: safeDiagnosticChild(),
    consumerDeployment: CONSUMER_DEPLOYMENT_ID,
    vercelProject: VERCEL_PROJECT_ID,
    vercelProjectName: VERCEL_PROJECT_NAME,
    vercelTeam: VERCEL_TEAM_ID,
  };
}

function createEndpointMatrix() {
  return {
    deploymentMetadata: {
      stage: READ_STAGES.DEPLOYMENT_METADATA,
      endpointFamily: 'v13 deployment',
      httpStatus: null,
      result: 'NOT_PROBED',
    },
    projectMetadata: {
      stage: READ_STAGES.PROJECT_METADATA,
      endpointFamily: 'v9 project',
      httpStatus: null,
      result: 'NOT_PROBED',
    },
    envV10Metadata: {
      stage: READ_STAGES.ENV_V10_METADATA_ONLY,
      endpointFamily: 'v10 env metadata',
      httpStatus: null,
      result: 'NOT_PROBED',
    },
    envV9Metadata: {
      stage: READ_STAGES.ENV_V9_METADATA_ONLY,
      endpointFamily: 'v9 env metadata',
      httpStatus: null,
      result: 'NOT_PROBED',
    },
    selectedEnvDecrypt: {
      stage: null,
      endpointFamily: 'v10/v9 env decrypt',
      httpStatus: null,
      result: 'NOT_PROBED',
    },
    envV10DecryptedCliSource: {
      stage: READ_STAGES.ENV_V10_DECRYPTED_CLI_SOURCE,
      endpointFamily: 'v10 env decrypt cli source',
      httpStatus: null,
      valueAvailable: 'NO',
      decrypted: 'NO',
      result: VALUE_READ_RESULTS.NOT_PROBED,
      keys: {},
    },
    envV10MetadataReverify: {
      stage: READ_STAGES.ENV_V10_METADATA_REVERIFY,
      endpointFamily: 'v10 env metadata reverify',
      httpStatus: null,
      result: VALUE_READ_RESULTS.NOT_PROBED,
    },
    selectedSecretProjectEnv: {
      stage: READ_STAGES.SELECTED_SECRET_PROJECT_ENV,
      endpointFamily: 'v1 project env by id',
      key: VERCEL_SECRET_KEY,
      httpStatus: null,
      responseKeyMatches: 'NO',
      valueAvailable: 'NO',
      decrypted: 'NO',
      responseType: 'NOT_PROBED',
      result: VALUE_READ_RESULTS.NOT_PROBED,
    },
    selectedApiOriginProjectEnv: {
      stage: READ_STAGES.SELECTED_API_ORIGIN_PROJECT_ENV,
      endpointFamily: 'v1 project env by id',
      key: API_ORIGIN_ENV_KEY,
      httpStatus: null,
      responseKeyMatches: 'NO',
      valueAvailable: 'NO',
      decrypted: 'NO',
      responseType: 'NOT_PROBED',
      result: VALUE_READ_RESULTS.NOT_PROBED,
    },
    sharedSecretEnv: {
      stage: READ_STAGES.SHARED_SECRET_ENV,
      endpointFamily: 'v1 shared env by id',
      key: VERCEL_SECRET_KEY,
      httpStatus: null,
      responseKeyMatches: 'NO',
      valueAvailable: 'NO',
      decrypted: 'NO',
      responseType: 'NOT_APPLICABLE',
      result: VALUE_READ_RESULTS.NOT_APPLICABLE,
    },
    sharedApiOriginEnv: {
      stage: READ_STAGES.SHARED_API_ORIGIN_ENV,
      endpointFamily: 'v1 shared env by id',
      key: API_ORIGIN_ENV_KEY,
      httpStatus: null,
      responseKeyMatches: 'NO',
      valueAvailable: 'NO',
      decrypted: 'NO',
      responseType: 'NOT_APPLICABLE',
      result: VALUE_READ_RESULTS.NOT_APPLICABLE,
    },
    vercelEnvRun: {
      stage: READ_STAGES.VERCEL_ENV_RUN,
      endpointFamily: 'vercel env run',
      httpStatus: null,
      valueAvailable: 'NO',
      decrypted: 'NO',
      result: VALUE_READ_RESULTS.NOT_PROBED,
      keys: {},
    },
    deploymentFiles: {
      stage: READ_STAGES.DEPLOYMENT_FILES,
      endpointFamily: 'v6 files',
      httpStatus: null,
      result: DEPLOYMENT_FILE_RESULTS.NOT_APPLICABLE_GIT_SOURCE,
    },
    deploymentFileContent: {
      stage: READ_STAGES.DEPLOYMENT_FILE_CONTENT,
      endpointFamily: 'v8 file content',
      httpStatus: null,
      result: DEPLOYMENT_FILE_RESULTS.NOT_APPLICABLE_GIT_SOURCE,
    },
  };
}

function endpointResult(probe) {
  if (probe?.ok) return 'PASS';
  if (Number.isInteger(probe?.httpStatus)) return `HTTP_${probe.httpStatus}`;
  return 'FAILED';
}

export function classifyValueReadResult({ httpStatus, valueAvailable, applicable = true, probed = true, commandFailed = false }) {
  if (!applicable) return VALUE_READ_RESULTS.NOT_APPLICABLE;
  if (!probed) return VALUE_READ_RESULTS.NOT_PROBED;
  if (commandFailed) return VALUE_READ_RESULTS.COMMAND_FAILED;
  if (httpStatus === 200) {
    return valueAvailable ? VALUE_READ_RESULTS.HTTP_200_VALUE_AVAILABLE : VALUE_READ_RESULTS.HTTP_200_VALUE_UNAVAILABLE;
  }
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 404) return `HTTP_${httpStatus}`;
  return Number.isInteger(httpStatus) ? `HTTP_${httpStatus}` : VALUE_READ_RESULTS.COMMAND_FAILED;
}

function valueRecord({ payload, expectedKey, httpStatus, applicable = true, probed = true, commandFailed = false }) {
  const keyMatches = payload?.key === expectedKey;
  const valueAvailable = keyMatches && isUsablePlaintextValue(payload);
  const decrypted = keyMatches && (payload?.decrypted === true || valueAvailable);
  return {
    httpStatus: Number.isInteger(httpStatus) ? httpStatus : null,
    responseKeyMatches: yesNo(keyMatches),
    valueAvailable: yesNo(valueAvailable),
    decrypted: yesNo(decrypted),
    responseType: applicable && probed ? responseType(payload) : applicable ? 'NOT_PROBED' : 'NOT_APPLICABLE',
    result: classifyValueReadResult({ httpStatus, valueAvailable, applicable, probed, commandFailed }),
    value: valueAvailable ? payload.value : null,
    payload: keyMatches ? payload : null,
  };
}

function aggregateValueRecord(records) {
  const values = Object.values(records);
  return {
    valueAvailable: yesNo(values.length > 0 && values.every((record) => record.valueAvailable === 'YES')),
    decrypted: yesNo(values.length > 0 && values.every((record) => record.decrypted === 'YES')),
    keys: Object.fromEntries(Object.entries(records).map(([key, record]) => [key, {
      httpStatus: record.httpStatus,
      responseKeyMatches: record.responseKeyMatches,
      valueAvailable: record.valueAvailable,
      decrypted: record.decrypted,
      result: record.result,
    }])),
  };
}

function recordValueEndpoint(matrix, key, record) {
  if (!matrix[key]) return;
  matrix[key] = {
    ...matrix[key],
    httpStatus: record.httpStatus,
    responseKeyMatches: record.responseKeyMatches,
    valueAvailable: record.valueAvailable,
    decrypted: record.decrypted,
    responseType: record.responseType,
    result: record.result,
  };
}

function recordEndpoint(matrix, key, probe, result = endpointResult(probe), stage = null) {
  if (!matrix[key]) return;
  matrix[key] = {
    ...matrix[key],
    ...(stage ? { stage } : {}),
    httpStatus: Number.isInteger(probe?.httpStatus) ? probe.httpStatus : null,
    result,
  };
}

function emptySecretBindingEvidence() {
  return {
    githubSecretConfigured: null,
    vercelEnvKeyConfigured: null,
    effectiveScope: 'MISSING',
    equality: SECRET_EQUALITIES.NOT_PROVEN,
    envUpdatedRelativeToDeployment: DEPLOYMENT_RELATIVE_CLASSES.UNKNOWN,
    envDeploymentBinding: DEPLOYMENT_RELATIVE_CLASSES.UNKNOWN,
    rawSecretExposed: 'NO',
  };
}

function emptyApiOriginEvidence() {
  return {
    expectedOrigin: EXPECTED_API_ORIGIN,
    serverBundleInspected: false,
    markerFound: false,
    exactDeploymentClassification: ORIGIN_CLASSIFICATIONS.NOT_PROVEN,
    currentBranchEnvClassification: 'CURRENT_API_ORIGIN_NOT_PROVEN',
    envUpdatedRelativeToDeployment: DEPLOYMENT_RELATIVE_CLASSES.UNKNOWN,
    envDeploymentBinding: DEPLOYMENT_RELATIVE_CLASSES.UNKNOWN,
    serverBundleEvidence: 'NOT_AVAILABLE',
  };
}

function projectEnvPayload(payload) {
  return {
    envs: envEntries(payload)
      .filter((entry) => entry.key === VERCEL_SECRET_KEY || entry.key === API_ORIGIN_ENV_KEY)
      .map((entry) => ({
        id: entry.id,
        key: entry.key,
        target: entry.target,
        gitBranch: entry.gitBranch,
        value: entry.value,
        type: entry.type,
        decrypted: entry.decrypted,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        sharedEnvId: entry.sharedEnvId,
        sharedEnvVariableId: entry.sharedEnvVariableId,
        sharedEnvironmentVariableId: entry.sharedEnvironmentVariableId,
        sharedEnvironmentVariable: entry.sharedEnvironmentVariable,
      })),
  };
}

function mergeEnvPayloads(metadataPayload, decryptedPayload) {
  const merged = metadataPayload.envs.map((entry) => ({ ...entry }));
  for (const decryptedEntry of decryptedPayload.envs) {
    const index = merged.findIndex((entry) => entry.key === decryptedEntry.key
      && entry.gitBranch === decryptedEntry.gitBranch
      && JSON.stringify(entry.target) === JSON.stringify(decryptedEntry.target));
    if (index < 0) merged.push({ ...decryptedEntry });
    else merged[index] = { ...merged[index], ...decryptedEntry };
  }
  return { envs: merged };
}

function selectedResolutions(payload, branch) {
  return {
    secret: resolvePreviewEnvEntry(payload, VERCEL_SECRET_KEY, branch),
    origin: resolvePreviewEnvEntry(payload, API_ORIGIN_ENV_KEY, branch),
  };
}

function selectedRowUnchanged(before, after) {
  const beforeId = selectedEnvId(before);
  const afterId = selectedEnvId(after);
  if (!beforeId || !afterId || beforeId !== afterId) return false;
  const beforeCreated = asDate(before.createdAt);
  const afterCreated = asDate(after.createdAt);
  const beforeUpdated = asDate(before.updatedAt);
  const afterUpdated = asDate(after.updatedAt);
  return Boolean(beforeCreated && afterCreated && beforeUpdated && afterUpdated
    && beforeCreated.getTime() === afterCreated.getTime()
    && beforeUpdated.getTime() === afterUpdated.getTime());
}

function valueFromRecord(record) {
  return record?.value ?? null;
}

function safeCandidateMatrix(classification) {
  const secretCandidate = ROOT_CAUSES.AUTH_HEADER_SECRET_MISMATCH;
  const originCandidate = ROOT_CAUSES.CONSUMER_API_ORIGIN_MISMATCH;
  const values = new Map([
    [secretCandidate, 'REMAINING'],
    [originCandidate, 'REMAINING'],
  ]);
  if (classification?.secretMismatchProven) values.set(secretCandidate, 'CONFIRMED');
  if (classification?.secretMatchProven) values.set(secretCandidate, 'ELIMINATED');
  if (classification?.apiOriginMismatchProven) values.set(originCandidate, 'CONFIRMED');
  if (classification?.apiOriginMatchProven) values.set(originCandidate, 'ELIMINATED');
  return Object.fromEntries(values);
}

function exactOriginFromEnv(currentClassification, updatedRelative) {
  if (updatedRelative !== DEPLOYMENT_RELATIVE_CLASSES.BEFORE_OR_AT) return null;
  if (currentClassification === 'CURRENT_API_ORIGIN_MATCH') return ORIGIN_CLASSIFICATIONS.MATCH;
  if (currentClassification === 'CURRENT_API_ORIGIN_MISMATCH') return ORIGIN_CLASSIFICATIONS.MISMATCH;
  return null;
}

function finalStatusForClassification(classification) {
  if (classification.status === STATUSES.BOTH_MATCH) return FINAL_STATUSES.BOTH_MATCH;
  if (classification.status === STATUSES.SECRET_MISMATCH_CONFIRMED) return FINAL_STATUSES.SECRET_MISMATCH_CONFIRMED;
  if (classification.status === STATUSES.API_ORIGIN_MISMATCH_CONFIRMED) return FINAL_STATUSES.API_ORIGIN_MISMATCH_CONFIRMED;
  if (classification.status === STATUSES.MULTIPLE_CONFIGURATION_MISMATCH) return FINAL_STATUSES.MULTIPLE_CONFIGURATION_MISMATCH;
  if (classification.status === STATUSES.PARTIAL_CONFIGURATION) return FINAL_STATUSES.PARTIAL_CONFIGURATION;
  return FINAL_STATUSES.ENV_VALUE_READ_INSUFFICIENT;
}

function finalClassificationForClassification(classification) {
  if (classification.status === STATUSES.SECRET_MISMATCH_CONFIRMED) {
    return FINAL_STATUSES.SECRET_MISMATCH_CONFIRMED;
  }
  if (classification.status === STATUSES.API_ORIGIN_MISMATCH_CONFIRMED) {
    return FINAL_STATUSES.API_ORIGIN_MISMATCH_CONFIRMED;
  }
  if (classification.status === STATUSES.MULTIPLE_CONFIGURATION_MISMATCH) {
    return FINAL_STATUSES.MULTIPLE_CONFIGURATION_MISMATCH;
  }
  if (classification.status === STATUSES.BOTH_MATCH) return FINAL_STATUSES.CONFIGURATION_MATCHED;
  if (classification.status === STATUSES.PARTIAL_CONFIGURATION) {
    return FINAL_STATUSES.PARTIAL_CONFIGURATION;
  }
  return FINAL_STATUSES.ENV_VALUE_READ_INSUFFICIENT;
}

function failureStatusForProbe(probe, fallback = STATUSES.SAFETY_FAILED) {
  if (probe?.httpStatus === 404) return STATUSES.READ_CREDENTIAL_SCOPE_INVALID_OR_CHANGED;
  if (probe?.httpStatus === 401 || probe?.httpStatus === 403) return STATUSES.READ_CREDENTIAL_SCOPE_INVALID_OR_CHANGED;
  return fallback;
}

function safeFailureResult(error = {}, context = {}) {
  const code = context.failureCode ?? error?.code;
  const safeCode = SAFE_ERROR_CODES.has(code) ? code : 'VERCEL_READ_ACCESS_REQUIRED';
  const status = context.status ?? STATUSES.SAFETY_FAILED;
  const outputStatus = status === STATUSES.PROJECT_SCOPE_READ_MISMATCH
    || code === 'APPLICATION_SHA_MALFORMED'
    || code === 'APPLICATION_SHA_MISMATCH'
    || code === 'DEPLOYMENT_IDENTITY_MISMATCH'
    ? 'DIAGNOSTIC_AUTHORITY_MISMATCH'
    : status === STATUSES.ENV_READ_CAPABILITY_REQUIRED
      || status === STATUSES.READ_CREDENTIAL_SCOPE_INVALID_OR_CHANGED
      || status === STATUSES.SAFETY_FAILED
      ? FINAL_STATUSES.ENV_VALUE_READ_INSUFFICIENT
      : status;
  const endpointMatrix = context.endpointMatrix ?? createEndpointMatrix();
  const recoveryRequired = status === STATUSES.ENV_READ_CAPABILITY_REQUIRED
    || status === STATUSES.PROJECT_SCOPE_READ_MISMATCH
    || status === STATUSES.READ_CREDENTIAL_SCOPE_INVALID_OR_CHANGED;
  const failureStage = context.failureStage ?? error?.stage ?? null;
  const failureHttpStatus = Number.isInteger(context.failureHttpStatus)
    ? context.failureHttpStatus
    : Number.isInteger(error?.httpStatus) ? error.httpStatus : null;
  const permissionRecoveryRequired = failureHttpStatus === 401 || failureHttpStatus === 403;
  return {
    ready: false,
    status: outputStatus,
    finalStatus: outputStatus,
    authorities: commonAuthorities(),
    failureCode: safeCode,
    failure: { stage: failureStage, httpStatus: failureHttpStatus },
    endpointMatrix,
    readPath: context.readPath ?? 'NONE',
    deploymentFilesRequired: context.deploymentFilesRequired ?? false,
    deploymentFilesAvailable: context.deploymentFilesAvailable ?? false,
    secretBindingEvidence: context.secretBindingEvidence ?? emptySecretBindingEvidence(),
    apiOriginEvidence: context.apiOriginEvidence ?? emptyApiOriginEvidence(),
    rootCauseClass: ROOT_CAUSES.NOT_CLASSIFIED,
    eliminatedCandidates: [],
    remainingCandidates: [ROOT_CAUSES.AUTH_HEADER_SECRET_MISMATCH, ROOT_CAUSES.CONSUMER_API_ORIGIN_MISMATCH],
    nextGate: context.nextGate ?? (permissionRecoveryRequired
      ? NEXT_GATES.SELECTED_ENV_PERMISSION_RECOVERY
      : recoveryRequired
        ? NEXT_GATES.VERCEL_READ_CREDENTIAL_SCOPE_RECOVERY
        : NEXT_GATES.NONE_EVIDENCE),
    workflowRuns: {
      discriminationRun: safeRunId(),
      consumerAuthProbeNewRuns: 0,
      existingEvidenceNewRuns: 0,
      browserE2eNewRuns: 0,
    },
    mutationCheck: mutationCheck(),
    finalControlTowerSignal: recoveryRequired
      ? 'VERCEL_READ_CREDENTIAL_RECOVERY_REQUIRED'
      : 'CONTROL_TOWER_STOP_REQUIRED',
  };
}

export async function collectDiscriminationEvidence({
  expectedSha = APPLICATION_SHA,
  githubSecret,
  vercelToken,
  fetchImpl = globalThis.fetch,
  branch = PREVIEW_BRANCH,
  envRunImpl = ({ vercelToken: token, branch: selectedBranch }) => runVercelEnvRun({
    vercelToken: token,
    branch: selectedBranch,
  }),
} = {}) {
  assertApplicationSha(expectedSha);
  requireNonEmptyString(githubSecret, 'GITHUB_SECRET_REQUIRED');
  requireNonEmptyString(vercelToken, 'VERCEL_READ_TOKEN_REQUIRED');
  if (typeof fetchImpl !== 'function') fail('VERCEL_READ_ACCESS_REQUIRED', '읽기 API 구현이 없습니다.');

  const endpointMatrix = createEndpointMatrix();
  const deploymentProbe = await probeJsonEndpoint({
    fetchImpl,
    token: vercelToken,
    pathname: `/v13/deployments/${encodeURIComponent(CONSUMER_DEPLOYMENT_ID)}`,
    stage: READ_STAGES.DEPLOYMENT_METADATA,
  });
  recordEndpoint(endpointMatrix, 'deploymentMetadata', deploymentProbe);
  if (!deploymentProbe.ok) {
    return safeFailureResult(deploymentProbe, {
      endpointMatrix,
      status: deploymentProbe.httpStatus === 404
        ? STATUSES.READ_CREDENTIAL_SCOPE_INVALID_OR_CHANGED
        : STATUSES.SAFETY_FAILED,
      failureCode: deploymentProbe.httpStatus === 404
        ? 'VERCEL_READ_CREDENTIAL_SCOPE_INVALID_OR_CHANGED'
        : deploymentProbe.failureCode,
      nextGate: deploymentProbe.httpStatus === 404
        ? NEXT_GATES.VERCEL_READ_CREDENTIAL_SCOPE_RECOVERY
        : deploymentProbe.httpStatus === 401 || deploymentProbe.httpStatus === 403
          ? NEXT_GATES.SELECTED_ENV_PERMISSION_RECOVERY
        : NEXT_GATES.NONE_EVIDENCE,
    });
  }

  let deploymentCreatedAt;
  try {
    deploymentCreatedAt = validateDeployment(deploymentProbe.payload);
  } catch (error) {
    return safeFailureResult(error, {
      endpointMatrix,
      failureStage: READ_STAGES.DEPLOYMENT_METADATA,
      failureCode: error.code,
    });
  }
  deploymentProbe.payload = null;

  const projectProbe = await probeJsonEndpoint({
    fetchImpl,
    token: vercelToken,
    pathname: `/v9/projects/${encodeURIComponent(VERCEL_PROJECT_ID)}`,
    stage: READ_STAGES.PROJECT_METADATA,
  });
  recordEndpoint(endpointMatrix, 'projectMetadata', projectProbe);
  if (!projectProbe.ok) {
    const projectScopeMismatch = projectProbe.httpStatus === 404;
    return safeFailureResult(projectProbe, {
      endpointMatrix,
      status: projectScopeMismatch ? STATUSES.PROJECT_SCOPE_READ_MISMATCH : failureStatusForProbe(projectProbe),
      failureCode: projectScopeMismatch
        ? 'VERCEL_PROJECT_SCOPE_READ_MISMATCH'
        : projectProbe.failureCode,
      nextGate: projectScopeMismatch || projectProbe.httpStatus === 401 || projectProbe.httpStatus === 403
        ? NEXT_GATES.VERCEL_READ_CREDENTIAL_SCOPE_RECOVERY
        : NEXT_GATES.NONE_EVIDENCE,
    });
  }
  try {
    validateProject(projectProbe.payload);
  } catch (error) {
    return safeFailureResult(error, {
      endpointMatrix,
      failureStage: READ_STAGES.PROJECT_METADATA,
      failureCode: error.code,
      status: STATUSES.PROJECT_SCOPE_READ_MISMATCH,
      nextGate: NEXT_GATES.VERCEL_READ_CREDENTIAL_SCOPE_RECOVERY,
    });
  }
  projectProbe.payload = null;

  const envV10MetadataProbe = await probeJsonEndpoint({
    fetchImpl,
    token: vercelToken,
    pathname: `/v10/projects/${encodeURIComponent(VERCEL_PROJECT_ID)}/env`,
    query: { gitBranch: branch },
    stage: READ_STAGES.ENV_V10_METADATA_ONLY,
  });
  recordEndpoint(endpointMatrix, 'envV10Metadata', envV10MetadataProbe);
  let envMetadataPayload = envV10MetadataProbe.ok ? projectEnvPayload(envV10MetadataProbe.payload) : { envs: [] };
  envV10MetadataProbe.payload = null;

  let envReadPath = 'NONE';
  let envDecryptStage;
  let envDecryptEndpoint;
  if (envV10MetadataProbe.ok) {
    envReadPath = 'V10';
    envDecryptStage = READ_STAGES.ENV_V10_DECRYPTED_CLI_SOURCE;
    envDecryptEndpoint = `/v10/projects/${encodeURIComponent(VERCEL_PROJECT_ID)}/env`;
  } else if (envV10MetadataProbe.httpStatus === 404) {
    const envV9MetadataProbe = await probeJsonEndpoint({
      fetchImpl,
      token: vercelToken,
      pathname: `/v9/projects/${encodeURIComponent(VERCEL_PROJECT_ID)}/env`,
      query: { gitBranch: branch },
      stage: READ_STAGES.ENV_V9_METADATA_ONLY,
    });
    recordEndpoint(endpointMatrix, 'envV9Metadata', envV9MetadataProbe);
    envMetadataPayload = envV9MetadataProbe.ok ? projectEnvPayload(envV9MetadataProbe.payload) : { envs: [] };
    envV9MetadataProbe.payload = null;
    if (envV9MetadataProbe.ok) {
      envReadPath = 'V9';
      envDecryptStage = READ_STAGES.ENV_V9_DECRYPTED;
      envDecryptEndpoint = `/v9/projects/${encodeURIComponent(VERCEL_PROJECT_ID)}/env`;
    } else {
      const capabilityMissing = envV9MetadataProbe.httpStatus === 404
        || envV9MetadataProbe.httpStatus === 401
        || envV9MetadataProbe.httpStatus === 403;
      return safeFailureResult(envV9MetadataProbe, {
        endpointMatrix,
        status: capabilityMissing ? STATUSES.ENV_READ_CAPABILITY_REQUIRED : STATUSES.SAFETY_FAILED,
        failureCode: capabilityMissing
          ? 'VERCEL_ENV_READ_CAPABILITY_MISSING'
          : envV9MetadataProbe.failureCode,
      nextGate: capabilityMissing
          ? envV9MetadataProbe.httpStatus === 401 || envV9MetadataProbe.httpStatus === 403
            ? NEXT_GATES.SELECTED_ENV_PERMISSION_RECOVERY
            : NEXT_GATES.RUNTIME_EFFECTIVE_ENV_COMPARISON_REVIEW
          : NEXT_GATES.NONE_EVIDENCE,
        readPath: 'NONE',
      });
    }
  } else {
    const capabilityMissing = envV10MetadataProbe.httpStatus === 401
      || envV10MetadataProbe.httpStatus === 403;
    return safeFailureResult(envV10MetadataProbe, {
      endpointMatrix,
      status: capabilityMissing ? STATUSES.ENV_READ_CAPABILITY_REQUIRED : STATUSES.SAFETY_FAILED,
      failureCode: capabilityMissing
        ? 'VERCEL_ENV_READ_CAPABILITY_MISSING'
        : envV10MetadataProbe.failureCode,
      nextGate: capabilityMissing
          ? envV10MetadataProbe.httpStatus === 401 || envV10MetadataProbe.httpStatus === 403
            ? NEXT_GATES.SELECTED_ENV_PERMISSION_RECOVERY
            : NEXT_GATES.RUNTIME_EFFECTIVE_ENV_COMPARISON_REVIEW
          : NEXT_GATES.NONE_EVIDENCE,
      readPath: 'NONE',
    });
  }

  const envDecryptProbe = await probeJsonEndpoint({
    fetchImpl,
    token: vercelToken,
    pathname: envDecryptEndpoint,
    query: {
      decrypt: 'true',
      gitBranch: branch,
      ...(envReadPath === 'V10' ? { source: 'vercel-cli:pull' } : { source: 'vercel-cli:pull' }),
    },
    stage: envDecryptStage,
  });
  recordEndpoint(endpointMatrix, 'selectedEnvDecrypt', envDecryptProbe, endpointResult(envDecryptProbe), envDecryptStage);
  if (envReadPath === 'V10' && envDecryptProbe.ok) {
    const decryptedPayload = projectEnvPayload(envDecryptProbe.payload);
    const mergedPayload = mergeEnvPayloads(envMetadataPayload, decryptedPayload);
    const mergedResolutions = selectedResolutions(mergedPayload, branch);
    const stageARecords = {
      secret: valueRecord({
        payload: mergedResolutions.secret.entry,
        expectedKey: VERCEL_SECRET_KEY,
        httpStatus: envDecryptProbe.httpStatus,
      }),
      origin: valueRecord({
        payload: mergedResolutions.origin.entry,
        expectedKey: API_ORIGIN_ENV_KEY,
        httpStatus: envDecryptProbe.httpStatus,
      }),
    };
    const aggregate = aggregateValueRecord({
      [VERCEL_SECRET_KEY]: stageARecords.secret,
      [API_ORIGIN_ENV_KEY]: stageARecords.origin,
    });
    endpointMatrix.envV10DecryptedCliSource = {
      ...endpointMatrix.envV10DecryptedCliSource,
      httpStatus: envDecryptProbe.httpStatus,
      ...aggregate,
      result: classifyValueReadResult({
        httpStatus: envDecryptProbe.httpStatus,
        valueAvailable: aggregate.valueAvailable === 'YES',
      }),
    };
    envDecryptProbe.payload = mergedPayload;
  }
  if (!envDecryptProbe.ok) {
    const capabilityMissing = envDecryptProbe.httpStatus === 401
      || envDecryptProbe.httpStatus === 403
      || envDecryptProbe.httpStatus === 404;
    return safeFailureResult(envDecryptProbe, {
      endpointMatrix,
      status: capabilityMissing ? STATUSES.ENV_READ_CAPABILITY_REQUIRED : STATUSES.SAFETY_FAILED,
      failureCode: capabilityMissing
        ? 'VERCEL_ENV_DECRYPT_READ_FAILED'
        : envDecryptProbe.failureCode,
      nextGate: capabilityMissing
          ? envDecryptProbe.httpStatus === 401 || envDecryptProbe.httpStatus === 403
            ? NEXT_GATES.SELECTED_ENV_PERMISSION_RECOVERY
            : NEXT_GATES.RUNTIME_EFFECTIVE_ENV_COMPARISON_REVIEW
          : NEXT_GATES.NONE_EVIDENCE,
      readPath: envReadPath,
    });
  }

  const filteredEnvPayload = projectEnvPayload(envDecryptProbe.payload);
  envDecryptProbe.payload = null;
  const { secret: secretResolution, origin: apiResolution } = selectedResolutions(filteredEnvPayload, branch);
  const stageARecords = {
    secret: valueRecord({
      payload: secretResolution.entry,
      expectedKey: VERCEL_SECRET_KEY,
      httpStatus: envDecryptProbe.httpStatus,
    }),
    origin: valueRecord({
      payload: apiResolution.entry,
      expectedKey: API_ORIGIN_ENV_KEY,
      httpStatus: envDecryptProbe.httpStatus,
    }),
  };

  async function readSelectedProjectEnv({ key, entry, matrixKey }) {
    if (stageARecords[key === VERCEL_SECRET_KEY ? 'secret' : 'origin'].valueAvailable === 'YES') {
      return stageARecords[key === VERCEL_SECRET_KEY ? 'secret' : 'origin'];
    }
    const id = selectedEnvId(entry);
    if (!id) {
      const record = valueRecord({ expectedKey: key, applicable: false, probed: false });
      recordValueEndpoint(endpointMatrix, matrixKey, record);
      return record;
    }
    const probe = await probeJsonEndpoint({
      fetchImpl,
      token: vercelToken,
      pathname: `/v1/projects/${encodeURIComponent(VERCEL_PROJECT_ID)}/env/${encodeURIComponent(id)}`,
      query: { decrypt: 'true' },
      stage: matrixKey === 'selectedSecretProjectEnv'
        ? READ_STAGES.SELECTED_SECRET_PROJECT_ENV
        : READ_STAGES.SELECTED_API_ORIGIN_PROJECT_ENV,
    });
    const record = valueRecord({
      payload: probe.ok ? probe.payload : null,
      expectedKey: key,
      httpStatus: probe.httpStatus,
      commandFailed: !probe.ok && !Number.isInteger(probe.httpStatus),
    });
    recordValueEndpoint(endpointMatrix, matrixKey, record);
    probe.payload = null;
    return record;
  }

  async function readSharedEnv({ key, entry, matrixKey }) {
    const id = sharedEnvId(entry);
    if (!id) {
      return valueRecord({ expectedKey: key, applicable: false, probed: false });
    }
    const probe = await probeJsonEndpoint({
      fetchImpl,
      token: vercelToken,
      pathname: `/v1/env/${encodeURIComponent(id)}`,
      query: { decrypt: 'true' },
      stage: matrixKey === 'sharedSecretEnv'
        ? READ_STAGES.SHARED_SECRET_ENV
        : READ_STAGES.SHARED_API_ORIGIN_ENV,
    });
    const record = valueRecord({
      payload: probe.ok ? probe.payload : null,
      expectedKey: key,
      httpStatus: probe.httpStatus,
      commandFailed: !probe.ok && !Number.isInteger(probe.httpStatus),
    });
    recordValueEndpoint(endpointMatrix, matrixKey, record);
    probe.payload = null;
    return record;
  }

  const selectedSecretProjectRecord = await readSelectedProjectEnv({
    key: VERCEL_SECRET_KEY,
    entry: secretResolution.entry,
    matrixKey: 'selectedSecretProjectEnv',
  });
  const selectedApiOriginProjectRecord = await readSelectedProjectEnv({
    key: API_ORIGIN_ENV_KEY,
    entry: apiResolution.entry,
    matrixKey: 'selectedApiOriginProjectEnv',
  });

  let secretRecord = stageARecords.secret.valueAvailable === 'YES'
    ? stageARecords.secret
    : selectedSecretProjectRecord;
  let apiOriginRecord = stageARecords.origin.valueAvailable === 'YES'
    ? stageARecords.origin
    : selectedApiOriginProjectRecord;

  const sharedSecretRecord = secretRecord.valueAvailable === 'YES'
    ? valueRecord({ expectedKey: VERCEL_SECRET_KEY, applicable: false, probed: false })
    : await readSharedEnv({
      key: VERCEL_SECRET_KEY,
      entry: secretResolution.entry,
      matrixKey: 'sharedSecretEnv',
    });
  const sharedApiOriginRecord = apiOriginRecord.valueAvailable === 'YES'
    ? valueRecord({ expectedKey: API_ORIGIN_ENV_KEY, applicable: false, probed: false })
    : await readSharedEnv({
      key: API_ORIGIN_ENV_KEY,
      entry: apiResolution.entry,
      matrixKey: 'sharedApiOriginEnv',
    });
  if (secretRecord.valueAvailable !== 'YES' && sharedSecretRecord.valueAvailable === 'YES') secretRecord = sharedSecretRecord;
  if (apiOriginRecord.valueAvailable !== 'YES' && sharedApiOriginRecord.valueAvailable === 'YES') apiOriginRecord = sharedApiOriginRecord;

  let secretValue = valueFromRecord(secretRecord);
  let apiOriginValue = valueFromRecord(apiOriginRecord);
  let envRunResult = null;
  let envRunBinding = { attempted: false, secret: false, origin: false };

  if (secretValue === null || apiOriginValue === null) {
    const reverifyProbe = await probeJsonEndpoint({
      fetchImpl,
      token: vercelToken,
      pathname: envDecryptEndpoint,
      query: { gitBranch: branch },
      stage: READ_STAGES.ENV_V10_METADATA_REVERIFY,
    });
    recordEndpoint(endpointMatrix, 'envV10MetadataReverify', reverifyProbe);
    envRunBinding.attempted = true;
    if (reverifyProbe.ok) {
      const reverifyPayload = projectEnvPayload(reverifyProbe.payload);
      const reverifyResolutions = selectedResolutions(reverifyPayload, branch);
      envRunBinding.secret = selectedRowUnchanged(secretResolution.entry, reverifyResolutions.secret.entry);
      envRunBinding.origin = selectedRowUnchanged(apiResolution.entry, reverifyResolutions.origin.entry);
      reverifyProbe.payload = null;
    }

    try {
      envRunResult = classifyEnvRunResult(await envRunImpl({
        vercelToken,
        branch,
        projectId: VERCEL_PROJECT_ID,
        teamId: VERCEL_TEAM_ID,
        environment: 'preview',
      }));
      const envRunRecord = (available) => ({
        httpStatus: null,
        responseKeyMatches: 'YES',
        valueAvailable: yesNo(available),
        decrypted: yesNo(available),
        responseType: 'env-run',
        result: available
          ? VALUE_READ_RESULTS.HTTP_200_VALUE_AVAILABLE
          : VALUE_READ_RESULTS.HTTP_200_VALUE_UNAVAILABLE,
      });
      const envRunSecretRecord = envRunRecord(envRunResult.secretAvailable);
      const envRunOriginRecord = envRunRecord(envRunResult.originAvailable);
      endpointMatrix.vercelEnvRun = {
        ...endpointMatrix.vercelEnvRun,
        valueAvailable: yesNo(envRunResult.secretAvailable && envRunResult.originAvailable),
        decrypted: yesNo(envRunResult.secretAvailable && envRunResult.originAvailable),
        keys: {
          [VERCEL_SECRET_KEY]: envRunSecretRecord,
          [API_ORIGIN_ENV_KEY]: envRunOriginRecord,
        },
        result: envRunResult.secretAvailable && envRunResult.originAvailable
          ? VALUE_READ_RESULTS.HTTP_200_VALUE_AVAILABLE
          : VALUE_READ_RESULTS.HTTP_200_VALUE_UNAVAILABLE,
      };
      if (secretValue === null && envRunResult.secretAvailable && envRunBinding.secret) {
        secretValue = 'env-run-value-held-in-child-process';
      }
      if (apiOriginValue === null && envRunResult.originAvailable && envRunBinding.origin) {
        apiOriginValue = 'env-run-value-held-in-child-process';
      }
    } catch {
      endpointMatrix.vercelEnvRun = {
        ...endpointMatrix.vercelEnvRun,
        result: VALUE_READ_RESULTS.COMMAND_FAILED,
        keys: {
          [VERCEL_SECRET_KEY]: { valueAvailable: 'NO', decrypted: 'NO', result: VALUE_READ_RESULTS.COMMAND_FAILED },
          [API_ORIGIN_ENV_KEY]: { valueAvailable: 'NO', decrypted: 'NO', result: VALUE_READ_RESULTS.COMMAND_FAILED },
        },
      };
    }
  }

  const secretResolutionForComparison = secretResolution.entry && secretValue !== null
    ? { ...secretResolution, entry: { ...secretResolution.entry, value: secretValue } }
    : secretResolution;
  const apiResolutionForComparison = apiResolution.entry && apiOriginValue !== null
    ? { ...apiResolution, entry: { ...apiResolution.entry, value: apiOriginValue } }
    : apiResolution;
  const secretBinding = classifySecretBinding({ githubSecret, resolution: secretResolutionForComparison });
  const secretBindingRelative = classifyEnvBindingRelativeToDeployment({
    createdAt: secretBinding.envCreatedAt,
    updatedAt: secretBinding.envUpdatedAt,
  }, deploymentCreatedAt);
  let currentApiOriginClassification = classifyCurrentApiOrigin(apiResolutionForComparison);
  const apiBindingRelative = classifyEnvBindingRelativeToDeployment({
    createdAt: apiResolution.entry?.createdAt,
    updatedAt: apiResolution.entry?.updatedAt,
  }, deploymentCreatedAt);
  const envExactOriginClassification = exactOriginFromEnv(
    currentApiOriginClassification,
    apiBindingRelative,
  );
  const apiOriginEvidence = {
    serverBundleInspected: false,
    markerFound: false,
    classification: envExactOriginClassification ?? ORIGIN_CLASSIFICATIONS.NOT_PROVEN,
    serverBundleEvidence: envExactOriginClassification
      ? 'NOT_REQUIRED'
      : DEPLOYMENT_FILE_RESULTS.NOT_APPLICABLE_GIT_SOURCE,
  };
  const deploymentFilesRequired = false;
  const deploymentFilesAvailable = false;

  if (envRunResult && secretValue === 'env-run-value-held-in-child-process' && envRunBinding.secret) {
    secretBinding.equality = envRunResult.secretEquality;
  }
  if (envRunResult && apiOriginValue === 'env-run-value-held-in-child-process' && envRunBinding.origin) {
    currentApiOriginClassification = envRunResult.originEquality === SECRET_EQUALITIES.MATCH
      ? 'CURRENT_API_ORIGIN_MATCH'
      : envRunResult.originEquality === SECRET_EQUALITIES.MISMATCH
        ? 'CURRENT_API_ORIGIN_MISMATCH'
        : 'CURRENT_API_ORIGIN_NOT_PROVEN';
  }

  secretResolution.entry = null;
  apiResolution.entry = null;
  filteredEnvPayload.envs.length = 0;

  let exactApiOriginClassification = envExactOriginClassification
    ?? apiOriginEvidence.classification;
  if (envRunResult && apiOriginValue === 'env-run-value-held-in-child-process' && envRunBinding.origin
    && apiBindingRelative === DEPLOYMENT_RELATIVE_CLASSES.BEFORE_OR_AT) {
    exactApiOriginClassification = envRunResult.originEquality === SECRET_EQUALITIES.MATCH
      ? ORIGIN_CLASSIFICATIONS.MATCH
      : envRunResult.originEquality === SECRET_EQUALITIES.MISMATCH
        ? ORIGIN_CLASSIFICATIONS.MISMATCH
        : ORIGIN_CLASSIFICATIONS.NOT_PROVEN;
  }
  apiOriginEvidence.classification = exactApiOriginClassification;
  const classification = classifyDiscrimination({
    secretBinding,
    secretBindingRelative,
    apiOriginClassification: exactApiOriginClassification,
  });

  const secretValueAvailable = secretRecord.valueAvailable === 'YES'
    || Boolean(envRunResult?.secretAvailable && envRunBinding.secret);
  const apiOriginValueAvailable = apiOriginRecord.valueAvailable === 'YES'
    || Boolean(envRunResult?.originAvailable && envRunBinding.origin);
  const capabilityUnavailable = !secretValueAvailable && !apiOriginValueAvailable;
  const permissionFailure = Object.values(endpointMatrix).some((entry) => entry?.result === VALUE_READ_RESULTS.HTTP_401
    || entry?.result === VALUE_READ_RESULTS.HTTP_403);
  const finalStatus = capabilityUnavailable
    ? FINAL_STATUSES.ENV_VALUE_READ_INSUFFICIENT
    : finalStatusForClassification(classification);
  const nextGate = capabilityUnavailable
    ? (permissionFailure
      ? NEXT_GATES.SELECTED_ENV_PERMISSION_RECOVERY
      : NEXT_GATES.RUNTIME_EFFECTIVE_ENV_COMPARISON_REVIEW)
    : classification.nextGate;
  const candidateMatrix = {
    [ROOT_CAUSES.AUTH_HEADER_SECRET_MISMATCH]: secretBinding.equality === SECRET_EQUALITIES.MISMATCH
      && secretBindingRelative === DEPLOYMENT_RELATIVE_CLASSES.BEFORE_OR_AT
      ? 'CONFIRMED'
      : secretBinding.equality === SECRET_EQUALITIES.MATCH
        && secretBindingRelative === DEPLOYMENT_RELATIVE_CLASSES.BEFORE_OR_AT ? 'ELIMINATED' : 'REMAINING',
    [ROOT_CAUSES.CONSUMER_API_ORIGIN_MISMATCH]: exactApiOriginClassification === ORIGIN_CLASSIFICATIONS.MISMATCH
      ? 'CONFIRMED'
      : exactApiOriginClassification === ORIGIN_CLASSIFICATIONS.MATCH ? 'ELIMINATED' : 'REMAINING',
  };

  return {
    ready: !capabilityUnavailable,
    status: finalStatus,
    discriminationStatus: classification.status,
    finalStatus,
    authorities: commonAuthorities(),
    endpointMatrix,
    readPath: envReadPath,
    deploymentFilesRequired,
    deploymentFilesAvailable,
    finalClassification: finalStatus,
    valueReadMatrix: [
      [VERCEL_SECRET_KEY, 'v10 cli-source decrypt', endpointMatrix.envV10DecryptedCliSource.keys[VERCEL_SECRET_KEY] ?? endpointMatrix.envV10DecryptedCliSource],
      [API_ORIGIN_ENV_KEY, 'v10 cli-source decrypt', endpointMatrix.envV10DecryptedCliSource.keys[API_ORIGIN_ENV_KEY] ?? endpointMatrix.envV10DecryptedCliSource],
      [VERCEL_SECRET_KEY, 'project-env v1', endpointMatrix.selectedSecretProjectEnv],
      [API_ORIGIN_ENV_KEY, 'project-env v1', endpointMatrix.selectedApiOriginProjectEnv],
      [VERCEL_SECRET_KEY, 'shared-env v1', endpointMatrix.sharedSecretEnv],
      [API_ORIGIN_ENV_KEY, 'shared-env v1', endpointMatrix.sharedApiOriginEnv],
      [VERCEL_SECRET_KEY, 'env-run', endpointMatrix.vercelEnvRun.keys[VERCEL_SECRET_KEY] ?? endpointMatrix.vercelEnvRun],
      [API_ORIGIN_ENV_KEY, 'env-run', endpointMatrix.vercelEnvRun.keys[API_ORIGIN_ENV_KEY] ?? endpointMatrix.vercelEnvRun],
    ].map(([key, method, record]) => ({
      method,
      key,
      httpStatus: record.httpStatus ?? null,
      valueAvailable: record.valueAvailable ?? 'NO',
      decrypted: record.decrypted ?? 'NO',
      verdict: record.result ?? VALUE_READ_RESULTS.NOT_PROBED,
    })),
    secretBindingEvidence: {
      githubSecretConfigured: secretBinding.githubSecretConfigured,
      vercelEnvKeyConfigured: secretBinding.vercelEnvKeyConfigured,
      available: yesNo(secretValueAvailable),
      effectiveScope: secretBinding.effectiveScope,
      equality: secretBinding.equality,
      selectedRowUnchanged: envRunBinding.attempted ? yesNo(envRunBinding.secret) : 'NOT_REVERIFIED',
      envUpdatedRelativeToDeployment: secretBindingRelative,
      envDeploymentBinding: secretBindingRelative,
      rawSecretExposed: 'NO',
    },
    apiOriginEvidence: {
      expectedOrigin: EXPECTED_API_ORIGIN,
      serverBundleInspected: apiOriginEvidence.serverBundleInspected,
      markerFound: apiOriginEvidence.markerFound,
      exactDeploymentClassification: apiOriginEvidence.classification,
      currentBranchEnvClassification: currentApiOriginClassification,
      available: yesNo(apiOriginValueAvailable),
      selectedRowUnchanged: envRunBinding.attempted ? yesNo(envRunBinding.origin) : 'NOT_REVERIFIED',
      envUpdatedRelativeToDeployment: apiBindingRelative,
      envDeploymentBinding: apiBindingRelative,
      serverBundleEvidence: apiOriginEvidence.serverBundleEvidence,
    },
    rootCauseClass: classification.rootCauseClass,
    root: classification.rootCauseClass,
    eliminatedCandidates: classification.eliminatedCandidates,
    remainingCandidates: classification.remainingCandidates,
    candidateMatrix,
    nextGate,
    workflowRuns: {
      discriminationRun: safeRunId(),
      consumerAuthProbeNewRuns: 0,
      existingEvidenceNewRuns: 0,
      browserE2eNewRuns: 0,
    },
    mutationCheck: mutationCheck(),
    finalControlTowerSignal: finalStatus === FINAL_STATUSES.BOTH_MATCH
      ? 'CONSUMER_AUTHORIZE_BOUNDARY_REOPEN_REQUIRED'
      : classification.rootCauseClass === ROOT_CAUSES.NOT_CLASSIFIED
        ? 'CONTROL_TOWER_STOP_REQUIRED'
        : 'CONSUMER_AUTH_ROOT_CAUSE_CONFIRMED',
  };
}

export async function main() {
  try {
    const result = await collectDiscriminationEvidence({
      expectedSha: process.env.EXPECTED_SHA ?? APPLICATION_SHA,
      githubSecret: process.env.ROUND_DIRECT_E2E_TEST_SECRET,
      vercelToken: process.env.ROUND_DIRECT_E2E_VERCEL_READ_TOKEN,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ready) process.exitCode = 1;
    return result;
  } catch (error) {
    const result = safeFailureResult(error);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
    return result;
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) void main();
