import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const APPLICATION_SHA = '9fda1a0909644cb77a223941f28266f7af69cdf9';
export const EVIDENCE_V2_SHA = 'ff351b79ae2e00ce8b111a906ea0cf1ee8b3d114';
export const DIAGNOSTIC_PARENT_SHA = '1c171e76d99e79e810ee5944e0831f5befcf4c10';
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
  BEFORE_OR_AT: 'BEFORE_OR_AT_DEPLOYMENT',
  AFTER: 'AFTER_DEPLOYMENT',
  UNKNOWN: 'UNKNOWN',
});

export const ROOT_CAUSES = Object.freeze({
  AUTH_HEADER_SECRET_MISMATCH: 'AUTH_HEADER_SECRET_MISMATCH',
  CONSUMER_API_ORIGIN_MISMATCH: 'CONSUMER_API_ORIGIN_MISMATCH',
  NOT_CLASSIFIED: 'NOT_CLASSIFIED',
});

export const STATUSES = Object.freeze({
  SECRET_MISMATCH_CONFIRMED: 'AUTH_HEADER_SECRET_MISMATCH_CONFIRMED',
  API_ORIGIN_MISMATCH_CONFIRMED: 'CONSUMER_API_ORIGIN_MISMATCH_CONFIRMED',
  BOTH_MATCH: 'SECRET_AND_ORIGIN_BOTH_PROVEN_MATCH',
  ENV_READ_CAPABILITY_REQUIRED: 'VERCEL_ENV_READ_CAPABILITY_REQUIRED',
  PROJECT_SCOPE_READ_MISMATCH: 'VERCEL_PROJECT_SCOPE_READ_MISMATCH',
  READ_CREDENTIAL_SCOPE_INVALID_OR_CHANGED: 'VERCEL_READ_CREDENTIAL_SCOPE_INVALID_OR_CHANGED',
  SECRET_BINDING_NOT_PROVEN: 'SECRET_DEPLOYMENT_BINDING_NOT_PROVEN',
  API_ORIGIN_NOT_PROVEN: 'API_ORIGIN_EXACT_DEPLOYMENT_NOT_PROVEN',
  INCONCLUSIVE: 'SECRET_ORIGIN_DISCRIMINATION_INCONCLUSIVE',
  SAFETY_FAILED: 'DIAGNOSTIC_SAFETY_GATE_FAILED',
});

export const FINAL_STATUSES = Object.freeze({
  COMPLETED: 'SECRET_ORIGIN_DISCRIMINATION_COMPLETED',
  BOTH_MATCH: 'SECRET_AND_ORIGIN_BOTH_PROVEN_MATCH',
  ENV_READ_CAPABILITY_REQUIRED: 'VERCEL_ENV_READ_CAPABILITY_REQUIRED',
  PROJECT_SCOPE_READ_MISMATCH: 'VERCEL_PROJECT_SCOPE_READ_MISMATCH',
  READ_CREDENTIAL_SCOPE_INVALID_OR_CHANGED: 'VERCEL_READ_CREDENTIAL_SCOPE_INVALID_OR_CHANGED',
  INCONCLUSIVE: 'SECRET_ORIGIN_STILL_INCONCLUSIVE',
  SAFETY_FAILED: 'DIAGNOSTIC_SAFETY_GATE_FAILED',
});

export const NEXT_GATES = Object.freeze({
  GITHUB_SECRET_REBIND: 'GITHUB_SECRET_REBIND_GATE',
  VERCEL_PREVIEW_REBIND: 'VERCEL_PREVIEW_ENV_REBIND_AND_EXACT_REDEPLOY_GATE',
  AUTH_SECRET_CANONICAL_RECONCILIATION: 'P2_AUTH_SECRET_CANONICAL_SIDE_RECONCILIATION_GATE',
  API_ORIGIN_REBIND: 'CONSUMER_API_ORIGIN_REBIND_AND_EXACT_REDEPLOY_GATE',
  AUTHORIZE_BOUNDARY_REOPEN: 'P2_BROWSER_CONSUMER_AUTHORIZE_BOUNDARY_REOPEN_GATE',
  VERCEL_READ_CREDENTIAL_SCOPE_RECOVERY: 'P2_VERCEL_READ_CREDENTIAL_SCOPE_RECOVERY_GATE',
  NONE_EVIDENCE: 'NONE_EVIDENCE_INSUFFICIENT',
});

export const READ_STAGES = Object.freeze({
  DEPLOYMENT_METADATA: 'DEPLOYMENT_METADATA',
  PROJECT_METADATA: 'PROJECT_METADATA',
  ENV_V10_METADATA_ONLY: 'ENV_V10_METADATA_ONLY',
  ENV_V10_DECRYPTED: 'ENV_V10_DECRYPTED',
  ENV_V9_METADATA_ONLY: 'ENV_V9_METADATA_ONLY',
  ENV_V9_DECRYPTED: 'ENV_V9_DECRYPTED',
  DEPLOYMENT_FILES: 'DEPLOYMENT_FILES',
  DEPLOYMENT_FILE_CONTENT: 'DEPLOYMENT_FILE_CONTENT',
});

const SHA_PATTERN = /^[0-9a-f]{40}$/;
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
  const vercelValueConfigured = typeof vercelValue === 'string' && vercelValue.length > 0;
  let equality = SECRET_EQUALITIES.NOT_PROVEN;
  if (githubSecretConfigured && vercelValueConfigured && resolution?.entry) {
    equality = githubSecret === vercelValue ? SECRET_EQUALITIES.MATCH : SECRET_EQUALITIES.MISMATCH;
  }
  return {
    githubSecretConfigured,
    vercelEnvKeyConfigured: Boolean(resolution?.entry),
    effectiveScope: resolution?.scope ?? 'MISSING',
    equality,
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

function safeOrigin(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== '' && url.pathname !== '/') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function classifyCurrentApiOrigin(resolution) {
  const origin = safeOrigin(resolution?.entry?.value);
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

export function classifyDiscrimination({ secretBinding, secretUpdatedRelative, apiOriginClassification }) {
  const secretProof = exactSecretProof(secretBinding, secretUpdatedRelative);
  const secretMismatchProven = secretProof && secretBinding.equality === SECRET_EQUALITIES.MISMATCH;
  const secretMatchProven = secretProof && secretBinding.equality === SECRET_EQUALITIES.MATCH;
  const apiOriginMatch = apiOriginClassification === ORIGIN_CLASSIFICATIONS.MATCH;
  const apiOriginMismatch = apiOriginClassification === ORIGIN_CLASSIFICATIONS.MISMATCH;
  const secretCandidate = ROOT_CAUSES.AUTH_HEADER_SECRET_MISMATCH;
  const originCandidate = ROOT_CAUSES.CONSUMER_API_ORIGIN_MISMATCH;

  if (secretMismatchProven && apiOriginMismatch) {
    return {
      status: STATUSES.INCONCLUSIVE,
      rootCauseClass: ROOT_CAUSES.NOT_CLASSIFIED,
      eliminatedCandidates: [],
      remainingCandidates: [secretCandidate, originCandidate],
      nextGate: NEXT_GATES.NONE_EVIDENCE,
    };
  }
  if (secretMismatchProven) {
    return {
      status: STATUSES.SECRET_MISMATCH_CONFIRMED,
      rootCauseClass: ROOT_CAUSES.AUTH_HEADER_SECRET_MISMATCH,
      eliminatedCandidates: apiOriginMatch ? [originCandidate] : [],
      remainingCandidates: apiOriginMatch ? [] : [originCandidate],
      nextGate: NEXT_GATES.AUTH_SECRET_CANONICAL_RECONCILIATION,
    };
  }
  if (apiOriginMismatch) {
    return {
      status: STATUSES.API_ORIGIN_MISMATCH_CONFIRMED,
      rootCauseClass: ROOT_CAUSES.CONSUMER_API_ORIGIN_MISMATCH,
      eliminatedCandidates: secretMatchProven ? [secretCandidate] : [],
      remainingCandidates: secretMatchProven ? [] : [secretCandidate],
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
      status: STATUSES.API_ORIGIN_NOT_PROVEN,
      rootCauseClass: ROOT_CAUSES.NOT_CLASSIFIED,
      eliminatedCandidates: [secretCandidate],
      remainingCandidates: [originCandidate],
      nextGate: NEXT_GATES.NONE_EVIDENCE,
    };
  }
  if ((secretBinding?.equality === SECRET_EQUALITIES.MATCH
    || secretBinding?.equality === SECRET_EQUALITIES.MISMATCH)
    && secretUpdatedRelative !== DEPLOYMENT_RELATIVE_CLASSES.BEFORE_OR_AT) {
    return {
      status: STATUSES.SECRET_BINDING_NOT_PROVEN,
      rootCauseClass: ROOT_CAUSES.NOT_CLASSIFIED,
      eliminatedCandidates: apiOriginMatch ? [originCandidate] : [],
      remainingCandidates: apiOriginMatch ? [secretCandidate] : [secretCandidate, originCandidate],
      nextGate: NEXT_GATES.NONE_EVIDENCE,
    };
  }
  return {
    status: STATUSES.INCONCLUSIVE,
    rootCauseClass: ROOT_CAUSES.NOT_CLASSIFIED,
    eliminatedCandidates: [],
    remainingCandidates: [secretCandidate, originCandidate],
    nextGate: NEXT_GATES.NONE_EVIDENCE,
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
  return {
    applicationSha: APPLICATION_SHA,
    evidenceV2Sha: EVIDENCE_V2_SHA,
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
    deploymentFiles: {
      stage: READ_STAGES.DEPLOYMENT_FILES,
      endpointFamily: 'v6 files',
      httpStatus: null,
      result: 'NOT_PROBED',
    },
    deploymentFileContent: {
      stage: READ_STAGES.DEPLOYMENT_FILE_CONTENT,
      endpointFamily: 'v8 file content',
      httpStatus: null,
      result: 'NOT_PROBED',
    },
  };
}

function endpointResult(probe) {
  if (probe?.ok) return 'PASS';
  if (Number.isInteger(probe?.httpStatus)) return `HTTP_${probe.httpStatus}`;
  return 'FAILED';
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
    serverBundleEvidence: 'NOT_AVAILABLE',
  };
}

function projectEnvPayload(payload) {
  return {
    envs: envEntries(payload)
      .filter((entry) => entry.key === VERCEL_SECRET_KEY || entry.key === 'NEXT_PUBLIC_API_URL')
      .map((entry) => ({
        key: entry.key,
        target: entry.target,
        gitBranch: entry.gitBranch,
        value: entry.value,
        updatedAt: entry.updatedAt,
      })),
  };
}

function exactOriginFromEnv(currentClassification, updatedRelative) {
  if (updatedRelative !== DEPLOYMENT_RELATIVE_CLASSES.BEFORE_OR_AT) return null;
  if (currentClassification === 'CURRENT_API_ORIGIN_MATCH') return ORIGIN_CLASSIFICATIONS.MATCH;
  if (currentClassification === 'CURRENT_API_ORIGIN_MISMATCH') return ORIGIN_CLASSIFICATIONS.MISMATCH;
  return null;
}

function finalStatusForClassification(classification) {
  if (classification.status === STATUSES.BOTH_MATCH) return FINAL_STATUSES.BOTH_MATCH;
  if (classification.rootCauseClass !== ROOT_CAUSES.NOT_CLASSIFIED) return FINAL_STATUSES.COMPLETED;
  return FINAL_STATUSES.INCONCLUSIVE;
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
  const endpointMatrix = context.endpointMatrix ?? createEndpointMatrix();
  const recoveryRequired = status === STATUSES.ENV_READ_CAPABILITY_REQUIRED
    || status === STATUSES.PROJECT_SCOPE_READ_MISMATCH
    || status === STATUSES.READ_CREDENTIAL_SCOPE_INVALID_OR_CHANGED;
  const failureStage = context.failureStage ?? error?.stage ?? null;
  const failureHttpStatus = Number.isInteger(context.failureHttpStatus)
    ? context.failureHttpStatus
    : Number.isInteger(error?.httpStatus) ? error.httpStatus : null;
  return {
    ready: false,
    status,
    finalStatus: status,
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
    nextGate: context.nextGate ?? (recoveryRequired
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
    stage: READ_STAGES.ENV_V10_METADATA_ONLY,
  });
  recordEndpoint(endpointMatrix, 'envV10Metadata', envV10MetadataProbe);
  envV10MetadataProbe.payload = null;

  let envReadPath = 'NONE';
  let envDecryptStage;
  let envDecryptEndpoint;
  if (envV10MetadataProbe.ok) {
    envReadPath = 'V10';
    envDecryptStage = READ_STAGES.ENV_V10_DECRYPTED;
    envDecryptEndpoint = `/v10/projects/${encodeURIComponent(VERCEL_PROJECT_ID)}/env`;
  } else if (envV10MetadataProbe.httpStatus === 404) {
    const envV9MetadataProbe = await probeJsonEndpoint({
      fetchImpl,
      token: vercelToken,
      pathname: `/v9/projects/${encodeURIComponent(VERCEL_PROJECT_ID)}/env`,
      stage: READ_STAGES.ENV_V9_METADATA_ONLY,
    });
    recordEndpoint(endpointMatrix, 'envV9Metadata', envV9MetadataProbe);
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
          ? NEXT_GATES.VERCEL_READ_CREDENTIAL_SCOPE_RECOVERY
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
        ? NEXT_GATES.VERCEL_READ_CREDENTIAL_SCOPE_RECOVERY
        : NEXT_GATES.NONE_EVIDENCE,
      readPath: 'NONE',
    });
  }

  const envDecryptProbe = await probeJsonEndpoint({
    fetchImpl,
    token: vercelToken,
    pathname: envDecryptEndpoint,
    query: { decrypt: 'true' },
    stage: envDecryptStage,
  });
  recordEndpoint(endpointMatrix, 'selectedEnvDecrypt', envDecryptProbe, endpointResult(envDecryptProbe), envDecryptStage);
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
        ? NEXT_GATES.VERCEL_READ_CREDENTIAL_SCOPE_RECOVERY
        : NEXT_GATES.NONE_EVIDENCE,
      readPath: envReadPath,
    });
  }

  const filteredEnvPayload = projectEnvPayload(envDecryptProbe.payload);
  envDecryptProbe.payload = null;
  const secretResolution = resolvePreviewEnvEntry(filteredEnvPayload, VERCEL_SECRET_KEY, branch);
  const apiResolution = resolvePreviewEnvEntry(filteredEnvPayload, 'NEXT_PUBLIC_API_URL', branch);
  const secretBinding = classifySecretBinding({ githubSecret, resolution: secretResolution });
  const secretUpdatedRelative = classifyUpdatedRelativeToDeployment(
    secretBinding.envUpdatedAt,
    deploymentCreatedAt,
  );
  const currentApiOriginClassification = classifyCurrentApiOrigin(apiResolution);
  const apiUpdatedRelative = classifyUpdatedRelativeToDeployment(
    apiResolution.entry?.updatedAt,
    deploymentCreatedAt,
  );
  const envExactOriginClassification = exactOriginFromEnv(
    currentApiOriginClassification,
    apiUpdatedRelative,
  );
  let apiOriginEvidence = {
    serverBundleInspected: false,
    markerFound: false,
    classification: envExactOriginClassification ?? ORIGIN_CLASSIFICATIONS.NOT_PROVEN,
    serverBundleEvidence: envExactOriginClassification ? 'NOT_REQUIRED' : 'NOT_AVAILABLE',
  };
  let deploymentFilesRequired = !envExactOriginClassification;
  let deploymentFilesAvailable = false;

  if (deploymentFilesRequired) {
    const filesProbe = await probeJsonEndpoint({
      fetchImpl,
      token: vercelToken,
      pathname: `/v6/deployments/${encodeURIComponent(CONSUMER_DEPLOYMENT_ID)}/files`,
      stage: READ_STAGES.DEPLOYMENT_FILES,
    });
    deploymentFilesAvailable = filesProbe.ok;
    recordEndpoint(
      endpointMatrix,
      'deploymentFiles',
      filesProbe,
      filesProbe.httpStatus === 404 ? 'NOT_AVAILABLE' : endpointResult(filesProbe),
    );
    if (filesProbe.ok) {
      try {
        const bundleEvidence = await inspectExactDeploymentApiOrigin({
          filesPayload: filesProbe.payload,
          fetchImpl,
          token: vercelToken,
        });
        apiOriginEvidence = bundleEvidence;
        recordEndpoint(
          endpointMatrix,
          'deploymentFileContent',
          {
            ok: bundleEvidence.serverBundleInspected,
            httpStatus: 200,
          },
          bundleEvidence.serverBundleInspected ? 'PASS' : 'NOT_AVAILABLE',
        );
      } catch (error) {
        recordEndpoint(
          endpointMatrix,
          'deploymentFileContent',
          { ok: false, httpStatus: Number.isInteger(error?.httpStatus) ? error.httpStatus : null },
          'NOT_AVAILABLE',
        );
      } finally {
        filesProbe.payload = null;
      }
    }
  }

  secretResolution.entry = null;
  apiResolution.entry = null;
  filteredEnvPayload.envs.length = 0;

  const exactApiOriginClassification = envExactOriginClassification
    ?? apiOriginEvidence.classification;
  const classification = classifyDiscrimination({
    secretBinding,
    secretUpdatedRelative,
    apiOriginClassification: exactApiOriginClassification,
  });

  return {
    ready: true,
    status: finalStatusForClassification(classification),
    discriminationStatus: classification.status,
    finalStatus: finalStatusForClassification(classification),
    authorities: commonAuthorities(),
    endpointMatrix,
    readPath: envReadPath,
    deploymentFilesRequired,
    deploymentFilesAvailable,
    secretBindingEvidence: {
      githubSecretConfigured: secretBinding.githubSecretConfigured,
      vercelEnvKeyConfigured: secretBinding.vercelEnvKeyConfigured,
      effectiveScope: secretBinding.effectiveScope,
      equality: secretBinding.equality,
      envUpdatedRelativeToDeployment: secretUpdatedRelative,
      rawSecretExposed: 'NO',
    },
    apiOriginEvidence: {
      expectedOrigin: EXPECTED_API_ORIGIN,
      serverBundleInspected: apiOriginEvidence.serverBundleInspected,
      markerFound: apiOriginEvidence.markerFound,
      exactDeploymentClassification: apiOriginEvidence.classification,
      currentBranchEnvClassification: currentApiOriginClassification,
      envUpdatedRelativeToDeployment: apiUpdatedRelative,
      serverBundleEvidence: apiOriginEvidence.serverBundleEvidence,
    },
    rootCauseClass: classification.rootCauseClass,
    eliminatedCandidates: classification.eliminatedCandidates,
    remainingCandidates: classification.remainingCandidates,
    nextGate: classification.nextGate,
    workflowRuns: {
      discriminationRun: safeRunId(),
      consumerAuthProbeNewRuns: 0,
      existingEvidenceNewRuns: 0,
      browserE2eNewRuns: 0,
    },
    mutationCheck: mutationCheck(),
    finalControlTowerSignal: classification.rootCauseClass === ROOT_CAUSES.NOT_CLASSIFIED
      ? (classification.status === STATUSES.BOTH_MATCH
        ? 'CONSUMER_AUTHORIZE_BOUNDARY_REOPEN_REQUIRED'
        : 'CONTROL_TOWER_STOP_REQUIRED')
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
