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
  SECRET_BINDING_NOT_PROVEN: 'SECRET_DEPLOYMENT_BINDING_NOT_PROVEN',
  API_ORIGIN_NOT_PROVEN: 'API_ORIGIN_EXACT_DEPLOYMENT_NOT_PROVEN',
  INCONCLUSIVE: 'SECRET_ORIGIN_DISCRIMINATION_INCONCLUSIVE',
  SAFETY_FAILED: 'DIAGNOSTIC_SAFETY_GATE_FAILED',
});

export const NEXT_GATES = Object.freeze({
  GITHUB_SECRET_REBIND: 'GITHUB_SECRET_REBIND_GATE',
  VERCEL_PREVIEW_REBIND: 'VERCEL_PREVIEW_ENV_REBIND_AND_EXACT_REDEPLOY_GATE',
  API_ORIGIN_REBIND: 'CONSUMER_API_ORIGIN_REBIND_AND_EXACT_REDEPLOY_GATE',
  NONE_REOPEN: 'NONE_REOPEN_AUTHORIZE_BOUNDARY_REQUIRED',
  NONE_EVIDENCE: 'NONE_EVIDENCE_INSUFFICIENT',
});

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_ERROR_CODES = new Set([
  'GITHUB_SECRET_REQUIRED',
  'VERCEL_READ_TOKEN_REQUIRED',
  'VERCEL_API_HTTP_401',
  'VERCEL_API_HTTP_403',
  'VERCEL_API_HTTP_404',
  'VERCEL_API_HTTP_409',
  'VERCEL_API_HTTP_429',
  'VERCEL_API_HTTP_500',
  'VERCEL_API_HTTP_502',
  'VERCEL_API_HTTP_503',
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
  constructor(code, message) {
    super(message);
    this.name = 'DiscriminationContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new DiscriminationContractError(code, message);
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

async function readJsonResponse(response) {
  const status = safeHttpStatus(response?.status);
  if (!status || status < 200 || status >= 300) {
    fail(`VERCEL_API_HTTP_${status ?? 'UNKNOWN'}`, 'Vercel 읽기 API 응답이 성공이 아닙니다.');
  }
  if (typeof response?.json !== 'function') fail('VERCEL_RESPONSE_MALFORMED', 'Vercel 응답 형식이 잘못되었습니다.');
  try {
    return await response.json();
  } catch {
    fail('VERCEL_API_RESPONSE_MALFORMED', 'Vercel JSON 응답을 읽을 수 없습니다.');
  }
}

async function readTextResponse(response) {
  const status = safeHttpStatus(response?.status);
  if (!status || status < 200 || status >= 300) {
    fail(`VERCEL_API_HTTP_${status ?? 'UNKNOWN'}`, 'Vercel 읽기 API 응답이 성공이 아닙니다.');
  }
  if (typeof response?.text !== 'function') fail('VERCEL_RESPONSE_MALFORMED', 'Vercel 파일 응답 형식이 잘못되었습니다.');
  try {
    return await response.text();
  } catch {
    fail('DEPLOYMENT_FILE_RESPONSE_MALFORMED', 'Vercel 서버 파일을 읽을 수 없습니다.');
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

async function getVercelJson({ fetchImpl, token, pathname, query }) {
  let response;
  try {
    response = await fetchImpl(buildVercelUrl(pathname, query), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    fail('VERCEL_API_UNAVAILABLE', 'Vercel 읽기 API에 연결할 수 없습니다.');
  }
  return readJsonResponse(response);
}

async function getVercelText({ fetchImpl, token, pathname }) {
  let response;
  try {
    response = await fetchImpl(buildVercelUrl(pathname), {
      method: 'GET',
      headers: {
        Accept: 'text/plain, application/octet-stream',
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    fail('VERCEL_API_UNAVAILABLE', 'Vercel 읽기 API에 연결할 수 없습니다.');
  }
  return readTextResponse(response);
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
  return { serverBundleInspected, markerFound, classification };
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
  if (apiOriginMismatch) {
    return {
      status: STATUSES.API_ORIGIN_MISMATCH_CONFIRMED,
      rootCauseClass: ROOT_CAUSES.CONSUMER_API_ORIGIN_MISMATCH,
      eliminatedCandidates: secretMatchProven ? [secretCandidate] : [],
      remainingCandidates: secretMatchProven ? [] : [secretCandidate],
      nextGate: NEXT_GATES.API_ORIGIN_REBIND,
    };
  }
  if (secretMismatchProven) {
    return {
      status: STATUSES.SECRET_MISMATCH_CONFIRMED,
      rootCauseClass: ROOT_CAUSES.AUTH_HEADER_SECRET_MISMATCH,
      eliminatedCandidates: apiOriginMatch ? [originCandidate] : [],
      remainingCandidates: apiOriginMatch ? [] : [originCandidate],
      nextGate: NEXT_GATES.VERCEL_PREVIEW_REBIND,
    };
  }
  if (secretMatchProven && apiOriginMatch) {
    return {
      status: STATUSES.BOTH_MATCH,
      rootCauseClass: ROOT_CAUSES.NOT_CLASSIFIED,
      eliminatedCandidates: [secretCandidate, originCandidate],
      remainingCandidates: [],
      nextGate: NEXT_GATES.NONE_REOPEN,
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

function validateDeployment(deployment) {
  if (deployment?.id !== CONSUMER_DEPLOYMENT_ID || deployment?.projectId !== VERCEL_PROJECT_ID) {
    fail('DEPLOYMENT_IDENTITY_MISMATCH', '대상 Vercel 배포 식별자가 예상값과 다릅니다.');
  }
  return deployment.createdAt ?? null;
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
  };
}

function safeFailureResult(code) {
  const safeCode = SAFE_ERROR_CODES.has(code) ? code : 'VERCEL_READ_ACCESS_REQUIRED';
  return {
    ready: false,
    status: STATUSES.SAFETY_FAILED,
    authorities: commonAuthorities(),
    failureCode: safeCode,
    secretBindingEvidence: {
      githubSecretConfigured: null,
      vercelEnvKeyConfigured: null,
      effectiveScope: 'MISSING',
      equality: SECRET_EQUALITIES.NOT_PROVEN,
      envUpdatedRelativeToDeployment: DEPLOYMENT_RELATIVE_CLASSES.UNKNOWN,
      rawSecretExposed: 'NO',
    },
    apiOriginEvidence: {
      expectedOrigin: EXPECTED_API_ORIGIN,
      serverBundleInspected: false,
      markerFound: false,
      exactDeploymentClassification: ORIGIN_CLASSIFICATIONS.NOT_PROVEN,
      currentBranchEnvClassification: 'CURRENT_API_ORIGIN_NOT_PROVEN',
      envUpdatedRelativeToDeployment: DEPLOYMENT_RELATIVE_CLASSES.UNKNOWN,
    },
    rootCauseClass: ROOT_CAUSES.NOT_CLASSIFIED,
    eliminatedCandidates: [],
    remainingCandidates: [ROOT_CAUSES.AUTH_HEADER_SECRET_MISMATCH, ROOT_CAUSES.CONSUMER_API_ORIGIN_MISMATCH],
    nextGate: NEXT_GATES.NONE_EVIDENCE,
    workflowRuns: {
      discriminationRun: safeRunId(),
      consumerAuthProbeNewRuns: 0,
      existingEvidenceNewRuns: 0,
      browserE2eNewRuns: 0,
    },
    mutationCheck: mutationCheck(),
    finalControlTowerSignal: 'CONTROL_TOWER_STOP_REQUIRED',
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

  const deployment = await getVercelJson({
    fetchImpl,
    token: vercelToken,
    pathname: `/v13/deployments/${encodeURIComponent(CONSUMER_DEPLOYMENT_ID)}`,
  });
  const deploymentCreatedAt = validateDeployment(deployment);
  const envPayload = await getVercelJson({
    fetchImpl,
    token: vercelToken,
    pathname: `/v10/projects/${encodeURIComponent(VERCEL_PROJECT_ID)}/env`,
    query: { decrypt: 'true' },
  });
  const secretResolution = resolvePreviewEnvEntry(envPayload, VERCEL_SECRET_KEY, branch);
  const apiResolution = resolvePreviewEnvEntry(envPayload, 'NEXT_PUBLIC_API_URL', branch);
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
  const filesPayload = await getVercelJson({
    fetchImpl,
    token: vercelToken,
    pathname: `/v6/deployments/${encodeURIComponent(CONSUMER_DEPLOYMENT_ID)}/files`,
  });
  const apiOriginEvidence = await inspectExactDeploymentApiOrigin({
    filesPayload,
    fetchImpl,
    token: vercelToken,
  });
  const classification = classifyDiscrimination({
    secretBinding,
    secretUpdatedRelative,
    apiOriginClassification: apiOriginEvidence.classification,
  });

  return {
    ready: true,
    status: classification.status,
    authorities: commonAuthorities(),
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
    return result;
  } catch (error) {
    const result = safeFailureResult(error?.code);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
    return result;
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) void main();
