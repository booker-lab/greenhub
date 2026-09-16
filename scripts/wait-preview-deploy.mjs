/**
 * 고정된 Vercel Preview deployment metadata를 확인하는 회차 E2E 증거 게이트.
 *
 * 이 스크립트는 workflow checkout의 HEAD나 최신 deployment를 추정하지 않고,
 * 호출자가 전달한 expected SHA와 pinned deployment ID를 그대로 사용한다.
 * 기본값은 세 deployment ID(consumer + seller + driver)를 모두 검증한다.
 * Driver role-callback 전용 bounded mode는 --only=driver로 driver만 검증하며,
 * session-probe는 --only 없이 triple binding을 유지해야 한다.
 * 검증 내내 동일한 pinned deployment identity를 유지하며, 중간에 더 최신
 * Preview가 생성되어도 자동으로 전환하지 않는다.
 *
 * canonical acceptance source는 Vercel deployment GET metadata다. GitHub commit
 * status는 별도 diagnostic 경로에서만 읽을 수 있으며 canonical ready 판정에는
 * 참여하지 않는다.
 *
 * 종료 코드:
 *   0  선택된 pinned deployment가 모두 직접 검증됨 (default: 세 앱)
 *   1  metadata 불일치, credential/API 오류 또는 timeout
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = 'booker-lab/greenhub';
export const VERCEL_API_ORIGIN = 'https://api.vercel.com';
export const VERCEL_TEAM_ID = 'team_J91VWI0TqcHdcF36T7qVgiT1';
export const VERCEL_CREDENTIAL_NAME = 'ROUND_DIRECT_E2E_VERCEL_READ_TOKEN';

/**
 * 45B project-scoped exact-preview credential authority (per-app, single
 * Project scope each). Values are NEVER logged; only names travel in evidence.
 *
 * - consumer -> VERCEL_EXACT_PREVIEW_CONSUMER_TOKEN (greenhubconsumer only)
 * - seller   -> VERCEL_EXACT_PREVIEW_SELLER_TOKEN   (greenhub-seller only)
 * - driver   -> VERCEL_EXACT_PREVIEW_DRIVER_TOKEN   (greenhub-driver only)
 *
 * A project-scoped token is used for BOTH the exact Preview creation POST and
 * the pinned deployment metadata GET of its own app. Vercel offers no
 * operation-level create-only/read-only scope, so the token scope (single
 * Project) and the application guard below are SEPARATE defense lines:
 * credential scope limits blast radius, application code still enforces
 * Preview-only + exact-SHA + allowlisted-project + pinned-ID fail-closed.
 *
 * Legacy/global mode (`legacy-global`: ROUND_DIRECT_E2E_VERCEL_READ_TOKEN +
 * `?teamId=`) stays for existing e2e/probe consumers (KEEP_COMPATIBILITY).
 * Project-scoped mode (`project-scoped`) sends NO `teamId` query: the
 * credential itself carries the project/team context. Mode is always explicit
 * (`credentialMode`); credential type is never guessed from token shape.
 */
export const VERCEL_EXACT_PREVIEW_CONSUMER_TOKEN = 'VERCEL_EXACT_PREVIEW_CONSUMER_TOKEN';
export const VERCEL_EXACT_PREVIEW_SELLER_TOKEN = 'VERCEL_EXACT_PREVIEW_SELLER_TOKEN';
export const VERCEL_EXACT_PREVIEW_DRIVER_TOKEN = 'VERCEL_EXACT_PREVIEW_DRIVER_TOKEN';

export const EXACT_PREVIEW_CREDENTIAL_MODE_PROJECT_SCOPED = 'project-scoped';
export const EXACT_PREVIEW_CREDENTIAL_MODE_LEGACY_GLOBAL = 'legacy-global';

export const EXACT_PREVIEW_TOKENS_BY_APP = Object.freeze({
  consumer: VERCEL_EXACT_PREVIEW_CONSUMER_TOKEN,
  seller: VERCEL_EXACT_PREVIEW_SELLER_TOKEN,
  driver: VERCEL_EXACT_PREVIEW_DRIVER_TOKEN,
});

/** Per-app fail-closed codes when a required project token is missing. */
export const EXACT_PREVIEW_TOKEN_REQUIRED_BY_APP = Object.freeze({
  consumer: 'VERCEL_CONSUMER_PROJECT_TOKEN_REQUIRED',
  seller: 'VERCEL_SELLER_PROJECT_TOKEN_REQUIRED',
  driver: 'VERCEL_DRIVER_PROJECT_TOKEN_REQUIRED',
});

export const PREVIEW_APPS = Object.freeze([
  {
    app: 'consumer',
    project: 'greenhubconsumer',
    projectId: 'prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w',
    context: 'Vercel – greenhubconsumer',
  },
  {
    app: 'seller',
    project: 'greenhub-seller',
    projectId: 'prj_OPOveVw4QADTbTE7mt32mo14H5dv',
    context: 'Vercel – greenhub-seller',
  },
  {
    app: 'driver',
    project: 'greenhub-driver',
    projectId: 'prj_e3OU9YIAGTkDcrWQdpTvkbHnJ4XW',
    context: 'Vercel – greenhub-driver',
  },
]);

// 기존 import 소비자와 진단 출력의 호환을 위해 유지한다.
export const ENVIRONMENTS = PREVIEW_APPS;

const APP_BY_NAME = new Map(PREVIEW_APPS.map((config) => [config.app, config]));
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const RETRYABLE_STATES = new Set(['BUILDING', 'QUEUED']);

const TIMEOUT_MS = Number(process.env.WAIT_TIMEOUT_MS) || 10 * 60 * 1000;
const INTERVAL_MS = Number(process.env.WAIT_INTERVAL_MS) || 15 * 1000;

export class PreviewEvidenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PreviewEvidenceError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new PreviewEvidenceError(code, message);
}

export function assertHeadSha(value) {
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) {
    fail('EXPECTED_SHA_MALFORMED', 'expected SHA는 40자리 소문자 16진수여야 합니다.');
  }
  return value;
}

export function assertDeploymentId(value, label = 'Vercel deployment ID') {
  if (typeof value !== 'string' || !DEPLOYMENT_ID_PATTERN.test(value)) {
    fail('DEPLOYMENT_ID_MALFORMED', `${label}가 올바른 형식이 아닙니다.`);
  }
  return value;
}

export function normalizeTargetUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function normalizeVercelDeploymentUrl(value, app) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('VERCEL_URL_MISSING', `${app} Vercel deployment URL이 없습니다.`);
  }

  const raw = value.trim();
  const candidate = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;
  const normalized = normalizeTargetUrl(candidate);
  if (!normalized) {
    fail('VERCEL_URL_UNSAFE', `${app} Vercel deployment URL이 안전한 HTTPS 주소가 아닙니다.`);
  }

  const url = new URL(normalized);
  if (!url.hostname.endsWith('.vercel.app') || url.hostname === 'vercel.app') {
    fail('VERCEL_URL_HOST_MISMATCH', `${app} Vercel deployment URL host가 올바르지 않습니다.`);
  }
  if (url.pathname !== '/') {
    fail('VERCEL_URL_PATH_MISMATCH', `${app} Vercel deployment URL path가 올바르지 않습니다.`);
  }
  return normalized;
}

export function vercelDeploymentPath(deploymentId) {
  assertDeploymentId(deploymentId);
  const query = new URLSearchParams({ teamId: VERCEL_TEAM_ID });
  return `/v13/deployments/${encodeURIComponent(deploymentId)}?${query}`;
}

/**
 * Project-scoped exact-preview GET path: NO `teamId` query is forced. The
 * per-app project token itself carries the project/team context. Callers must
 * pass `credentialMode: 'project-scoped'` explicitly to use this path; the
 * default legacy path above is unchanged for existing global consumers.
 */
export function vercelDeploymentProjectScopedPath(deploymentId) {
  assertDeploymentId(deploymentId);
  return `/v13/deployments/${encodeURIComponent(deploymentId)}`;
}

export function assertExactPreviewCredentialMode(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (
    normalized !== EXACT_PREVIEW_CREDENTIAL_MODE_PROJECT_SCOPED &&
    normalized !== EXACT_PREVIEW_CREDENTIAL_MODE_LEGACY_GLOBAL
  ) {
    fail(
      'UNKNOWN_CREDENTIAL_MODE',
      `알 수 없는 credential mode입니다: ${JSON.stringify(value)} (project-scoped|legacy-global만 허용)`,
    );
  }
  return normalized;
}

/** Env name holding the project-scoped token for one app. */
export function exactPreviewTokenEnvForApp(app) {
  const env = EXACT_PREVIEW_TOKENS_BY_APP[app];
  if (!env) fail('UNKNOWN_PREVIEW_APP', `알 수 없는 Preview 앱입니다: ${app}`);
  return env;
}

/** Fail-closed code when one app's project token is missing. */
export function exactPreviewTokenRequiredCode(app) {
  const code = EXACT_PREVIEW_TOKEN_REQUIRED_BY_APP[app];
  if (!code) fail('UNKNOWN_PREVIEW_APP', `알 수 없는 Preview 앱입니다: ${app}`);
  return code;
}

function readProjectScopedTokenFromEnv(app) {
  const env = exactPreviewTokenEnvForApp(app);
  const value = process.env?.[env];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Resolve ONE app's project-scoped token. No cross-app reuse: a missing token
 * for `app` fails with that app's own code even when another app's token is
 * present. Explicit `tokensByApp` entries win; absent entries fall back to
 * their own per-app env var only (never to another app's credential).
 */
export function resolveProjectScopedReadToken(app, tokensByApp = null) {
  if (!APP_BY_NAME.has(app)) fail('UNKNOWN_PREVIEW_APP', `알 수 없는 Preview 앱입니다: ${app}`);
  const explicit = tokensByApp?.[app];
  const token =
    typeof explicit === 'string' && explicit.trim() ? explicit.trim() : readProjectScopedTokenFromEnv(app);
  if (!token) {
    fail(
      exactPreviewTokenRequiredCode(app),
      `${exactPreviewTokenEnvForApp(app)}가 없어 ${app} Vercel metadata를 읽을 수 없습니다 (타 앱 token으로 대체 불가).`,
    );
  }
  return token;
}

/**
 * Resolve every selected app's project-scoped token BEFORE any provider call,
 * so a missing token fails with GET 0회 (no partial readback with mixed
 * credentials). Returns a frozen app -> token map.
 */
export function resolveProjectScopedReadTokensForApps(apps, tokensByApp = null) {
  const names = [...new Set((Array.isArray(apps) ? apps : []).map((entry) => entry?.app ?? entry))];
  const resolved = {};
  for (const app of names) {
    resolved[app] = resolveProjectScopedReadToken(app, tokensByApp);
  }
  return Object.freeze(resolved);
}

function vercelHeaders(token) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function requestVercelDeployment(deploymentId, token, fetchImpl = fetch, options = {}) {
  assertDeploymentId(deploymentId);
  if (typeof token !== 'string' || !token.trim()) {
    fail(
      'VERCEL_READ_TOKEN_REQUIRED',
      `${VERCEL_CREDENTIAL_NAME}가 없어 Vercel metadata를 읽을 수 없습니다.`,
    );
  }
  const credentialMode =
    options?.credentialMode ?? EXACT_PREVIEW_CREDENTIAL_MODE_LEGACY_GLOBAL;
  assertExactPreviewCredentialMode(credentialMode);
  const cleanToken = token.trim();
  const deploymentPath =
    credentialMode === EXACT_PREVIEW_CREDENTIAL_MODE_PROJECT_SCOPED
      ? vercelDeploymentProjectScopedPath(deploymentId)
      : vercelDeploymentPath(deploymentId);
  if (deploymentPath.includes(cleanToken)) {
    fail('SECRET_REDACTION_VIOLATION', 'credential value must never appear in URL.');
  }

  let response;
  try {
    response = await fetchImpl(VERCEL_API_ORIGIN + deploymentPath, {
      method: 'GET',
      headers: vercelHeaders(cleanToken),
    });
  } catch {
    fail('VERCEL_API_UNAVAILABLE', 'Vercel metadata 읽기 요청에 실패했습니다.');
  }

  if (!response?.ok) {
    const status = Number(response?.status);
    const suffix = Number.isInteger(status) && status > 0 ? `_${status}` : '';
    fail(
      `VERCEL_API_HTTP${suffix}`,
      `Vercel metadata API가 성공 응답을 반환하지 않았습니다${suffix ? ` (HTTP ${status})` : ''}.`,
    );
  }

  try {
    return await response.json();
  } catch {
    fail('VERCEL_API_INVALID_JSON', 'Vercel metadata JSON 응답이 잘못되었습니다.');
  }
}

function unwrapDeployment(payload) {
  if (payload?.deployment && typeof payload.deployment === 'object') {
    return payload.deployment;
  }
  return payload && typeof payload === 'object' ? payload : null;
}

function deploymentIdentifier(deployment) {
  const id = deployment?.id;
  const uid = deployment?.uid;
  if (id !== undefined && uid !== undefined && id !== uid) {
    return { value: id, mismatch: true };
  }
  return { value: id ?? uid ?? null, mismatch: false };
}

function deploymentProjectId(deployment) {
  return deployment?.projectId ?? deployment?.project?.id ?? null;
}

function deploymentProjectName(deployment) {
  return deployment?.project?.name ?? deployment?.name ?? null;
}

function deploymentState(deployment) {
  const state = typeof deployment?.state === 'string' ? deployment.state : null;
  const readyState = typeof deployment?.readyState === 'string' ? deployment.readyState : null;
  const values = [state, readyState].filter(Boolean);
  return {
    state: state ?? readyState ?? 'missing',
    readyState,
    hasState: values.length > 0,
    ready: values.length > 0 && values.every((value) => value === 'READY'),
    retryable: values.length > 0 && values.every((value) => RETRYABLE_STATES.has(value)),
  };
}

function baseAppEvidence(config, pinnedDeploymentId, expectedSha, deployment) {
  const identifier = deploymentIdentifier(deployment);
  const state = deploymentState(deployment);
  return {
    app: config.app,
    project: deploymentProjectName(deployment),
    projectId: deploymentProjectId(deployment),
    context: config.context,
    environment: 'preview',
    expectedSha,
    pinnedDeploymentId,
    deploymentId: identifier.value ?? pinnedDeploymentId,
    deploymentSha: deployment?.meta?.githubCommitSha ?? null,
    state: state.state,
    readyState: state.readyState,
    target: Object.hasOwn(deployment ?? {}, 'target') ? deployment.target : null,
    targetUrl: null,
    ready: false,
    failureCode: null,
    failureMessage: null,
    retryable: state.retryable,
  };
}

function failedAppEvidence(base, code, message, retryable = false) {
  return {
    ...base,
    ready: false,
    failureCode: code,
    failureMessage: message,
    retryable,
  };
}

function inspectDeploymentMetadata(config, pinnedDeploymentId, expectedSha, payload) {
  const deployment = unwrapDeployment(payload);
  const base = baseAppEvidence(config, pinnedDeploymentId, expectedSha, deployment);

  if (!deployment) {
    return failedAppEvidence(
      base,
      'VERCEL_METADATA_MISSING',
      `${config.app} Vercel metadata가 없습니다.`,
    );
  }

  const identifier = deploymentIdentifier(deployment);
  if (identifier.mismatch || identifier.value !== pinnedDeploymentId) {
    return failedAppEvidence(
      base,
      'VERCEL_DEPLOYMENT_ID_MISMATCH',
      `${config.app} Vercel deployment ID가 pinned ID와 다릅니다.`,
    );
  }

  if (
    deploymentProjectId(deployment) !== config.projectId ||
    deploymentProjectName(deployment) !== config.project
  ) {
    return failedAppEvidence(
      base,
      'VERCEL_PROJECT_MISMATCH',
      `${config.app} Vercel project identity가 예상값과 다릅니다.`,
    );
  }

  const deploymentSha = deployment?.meta?.githubCommitSha;
  if (deploymentSha !== expectedSha) {
    return failedAppEvidence(
      base,
      'VERCEL_GITHUB_COMMIT_SHA_MISMATCH',
      `${config.app} Vercel githubCommitSha가 expected SHA와 다릅니다.`,
    );
  }

  if (!Object.hasOwn(deployment, 'target') || deployment.target !== null) {
    return failedAppEvidence(
      base,
      'VERCEL_TARGET_NOT_PREVIEW',
      `${config.app} Vercel deployment가 Preview target이 아닙니다.`,
    );
  }

  const state = deploymentState(deployment);
  if (!state.hasState) {
    return failedAppEvidence(
      base,
      'VERCEL_STATE_MISSING',
      `${config.app} Vercel deployment 상태가 없습니다.`,
    );
  }
  if (!state.ready) {
    return failedAppEvidence(
      base,
      'VERCEL_NOT_READY',
      `${config.app} Vercel deployment가 READY가 아닙니다.`,
      state.retryable,
    );
  }

  let targetUrl;
  try {
    targetUrl = normalizeVercelDeploymentUrl(deployment.url, config.app);
  } catch (error) {
    const safeError =
      error instanceof PreviewEvidenceError
        ? error
        : new PreviewEvidenceError(
            'VERCEL_URL_UNSAFE',
            `${config.app} Vercel URL 검증에 실패했습니다.`,
          );
    return failedAppEvidence(base, safeError.code, safeError.message);
  }

  return {
    ...base,
    targetUrl,
    ready: true,
    failureCode: null,
    failureMessage: null,
    retryable: false,
  };
}

export function inspectAppDeployment(app, pinnedDeploymentId, expectedSha, payload) {
  assertHeadSha(expectedSha);
  const config = APP_BY_NAME.get(app);
  if (!config) fail('UNKNOWN_PREVIEW_APP', `알 수 없는 Preview 앱입니다: ${app}`);
  assertDeploymentId(pinnedDeploymentId, `${app} Vercel deployment ID`);
  return inspectDeploymentMetadata(config, pinnedDeploymentId, expectedSha, payload);
}

/**
 * PILOT-AUTH-DRIVER-ONLY-EXACT-BINDING-GATE-40B — bounded verification subset.
 *
 * Default (no --only): all three Preview apps (consumer + seller + driver).
 * Driver role-callback: --only=driver (driver pinned deployment only).
 * Session-probe must never pass --only (triple binding preserved).
 * Consumer/Seller state never enters a driver-only PASS/FAIL verdict.
 */
export function resolveSelectedAppConfigs(onlyRaw) {
  if (onlyRaw === undefined || onlyRaw === null || String(onlyRaw).trim() === '') {
    return [...PREVIEW_APPS];
  }
  const parts = String(onlyRaw)
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return [...PREVIEW_APPS];
  for (const part of parts) {
    if (!APP_BY_NAME.has(part)) {
      fail('UNKNOWN_PREVIEW_APP', `알 수 없는 Preview 앱입니다: ${part}`);
    }
  }
  const unique = [...new Set(parts)];
  return PREVIEW_APPS.filter((config) => unique.includes(config.app));
}

function normalizeDeploymentIds(deploymentIds, selectedApps = PREVIEW_APPS) {
  const normalized = {};
  for (const config of selectedApps) {
    const value = deploymentIds?.[config.app];
    if (typeof value !== 'string' || !value.trim()) {
      fail('DEPLOYMENT_ID_REQUIRED', `${config.app} pinned Vercel deployment ID가 필요합니다.`);
    }
    normalized[config.app] = assertDeploymentId(value.trim(), `${config.app} Vercel deployment ID`);
  }
  return normalized;
}

function isRetryableErrorCode(code) {
  return (
    code === 'VERCEL_API_UNAVAILABLE' ||
    code === 'VERCEL_API_INVALID_JSON' ||
    /^VERCEL_API_HTTP_(429|5\d\d)$/.test(code)
  );
}

function safeError(error) {
  if (error instanceof PreviewEvidenceError) return error;
  return new PreviewEvidenceError('VERCEL_API_UNAVAILABLE', 'Vercel metadata 읽기에 실패했습니다.');
}

export async function collectDeploymentEvidence(
  expectedSha,
  deploymentIds,
  {
    vercelToken = process.env[VERCEL_CREDENTIAL_NAME],
    tokensByApp = null,
    credentialMode = EXACT_PREVIEW_CREDENTIAL_MODE_LEGACY_GLOBAL,
    fetchImpl = fetch,
    request = null,
    checkedAt = () => new Date().toISOString(),
    only = null,
    selectedApps = null,
  } = {},
) {
  assertHeadSha(expectedSha);
  const mode = assertExactPreviewCredentialMode(credentialMode);
  const projectScoped = mode === EXACT_PREVIEW_CREDENTIAL_MODE_PROJECT_SCOPED;
  const selected =
    Array.isArray(selectedApps) && selectedApps.length > 0
      ? selectedApps
      : resolveSelectedAppConfigs(only);
  const pinnedDeploymentIds = normalizeDeploymentIds(deploymentIds, selected);
  // Project-scoped mode: resolve EVERY selected app's own token up front so a
  // missing token fails before any GET (GET 0회) and no app ever borrows
  // another app's credential. Legacy mode keeps the single global token.
  const scopedTokens = projectScoped ? resolveProjectScopedReadTokensForApps(selected, tokensByApp) : null;
  if (!projectScoped && typeof request !== 'function' && (typeof vercelToken !== 'string' || !vercelToken.trim())) {
    fail(
      'VERCEL_READ_TOKEN_REQUIRED',
      `${VERCEL_CREDENTIAL_NAME}가 없어 Vercel metadata를 읽을 수 없습니다.`,
    );
  }

  const apps = await Promise.all(
    selected.map(async (config) => {
      const pinnedDeploymentId = pinnedDeploymentIds[config.app];
      try {
        const payload =
          typeof request === 'function'
            ? await request(pinnedDeploymentId, config.app)
            : projectScoped
              ? await requestVercelDeployment(pinnedDeploymentId, scopedTokens[config.app], fetchImpl, {
                  credentialMode: mode,
                })
              : await requestVercelDeployment(pinnedDeploymentId, vercelToken, fetchImpl, {
                  credentialMode: mode,
                });
        return inspectDeploymentMetadata(config, pinnedDeploymentId, expectedSha, payload);
      } catch (error) {
        const failure = safeError(error);
        return failedAppEvidence(
          baseAppEvidence(config, pinnedDeploymentId, expectedSha, null),
          failure.code,
          failure.message,
          isRetryableErrorCode(failure.code),
        );
      }
    }),
  );

  const notReadyApps = apps.filter(({ ready }) => !ready);
  const retryable =
    notReadyApps.length > 0 && notReadyApps.every(({ retryable: canRetry }) => canRetry);
  const deploymentShas = Object.fromEntries(
    apps.map(({ app, deploymentSha }) => [app, deploymentSha]),
  );
  const deploymentTargetUrls = Object.fromEntries(
    apps.map(({ app, targetUrl }) => [app, targetUrl]),
  );
  const deploymentIdsByApp = Object.fromEntries(
    apps.map(({ app, deploymentId }) => [app, deploymentId]),
  );
  const deploymentStates = Object.fromEntries(apps.map(({ app, state }) => [app, state]));

  return {
    ready: apps.length === selected.length && apps.every(({ ready }) => ready),
    retryable,
    checkedAt: checkedAt(),
    repository: REPO,
    evidenceSource: 'vercel-deployment-metadata',
    vercelCredentialName: VERCEL_CREDENTIAL_NAME,
    credentialMode: mode,
    vercelCredentialNames: projectScoped
      ? Object.freeze(Object.fromEntries(selected.map(({ app }) => [app, exactPreviewTokenEnvForApp(app)])))
      : null,
    credentialValueRecorded: false,
    vercelTeamId: projectScoped ? null : VERCEL_TEAM_ID,
    expectedSha,
    selectedApps: selected.map(({ app }) => app),
    pinnedDeploymentIds,
    deploymentIds: deploymentIdsByApp,
    deploymentShas,
    deploymentTargetUrls,
    deploymentStates,
    failureCodes: apps
      .filter(({ ready }) => !ready)
      .map(({ app, failureCode }) => ({ app, code: failureCode })),
    apps,
  };
}

// GitHub status는 필요할 때만 남기는 비권위 진단 정보다.
export function gh(apiPath) {
  const out = execSync(`gh api "${apiPath}"`, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out);
}

function commitStatusesPath(headSha) {
  return `repos/${REPO}/commits/${headSha}/statuses?per_page=100`;
}

function statusTimestamp(status) {
  for (const field of ['updated_at', 'created_at']) {
    if (typeof status?.[field] !== 'string') continue;
    const timestamp = Date.parse(status[field]);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return null;
}

function comparableStatusId(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

function latestStatus(statuses) {
  let latest = null;
  for (const candidate of Array.isArray(statuses) ? statuses : []) {
    if (!latest) {
      latest = candidate;
      continue;
    }
    const candidateTime = statusTimestamp(candidate);
    const latestTime = statusTimestamp(latest);
    if (candidateTime !== null && (latestTime === null || candidateTime > latestTime)) {
      latest = candidate;
      continue;
    }
    if (candidateTime !== null && latestTime !== null && candidateTime === latestTime) {
      const candidateId = comparableStatusId(candidate?.id);
      const latestId = comparableStatusId(latest?.id);
      if (candidateId !== null && (latestId === null || candidateId > latestId)) {
        latest = candidate;
      }
    }
  }
  return latest;
}

export function collectCommitStatusDiagnostic(headSha, request = gh) {
  assertHeadSha(headSha);
  const statuses = request(commitStatusesPath(headSha));
  const apps = PREVIEW_APPS.map((config) => {
    const matches = (Array.isArray(statuses) ? statuses : []).filter(
      (status) => status?.context === config.context,
    );
    const latest = latestStatus(matches);
    return {
      app: config.app,
      context: config.context,
      statusId: latest?.id ?? null,
      statusSha: typeof latest?.sha === 'string' ? latest.sha : null,
      state: latest?.state ?? 'missing',
      targetUrl: normalizeTargetUrl(latest?.target_url),
    };
  });
  return {
    diagnostic: true,
    evidenceSource: 'github-commit-status-diagnostic',
    repository: REPO,
    expectedSha: headSha,
    checkedAt: new Date().toISOString(),
    apps,
  };
}

// 기존 진단 import 이름을 유지하되 canonical deployment evidence와 분리한다.
export const collectCommitStatusEvidence = collectCommitStatusDiagnostic;

function argumentValue(args, name) {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function resolveHeadSha(args) {
  return (
    argumentValue(args, 'sha')?.trim().toLowerCase() ||
    process.env.PREVIEW_HEAD_SHA?.trim().toLowerCase() ||
    execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim().toLowerCase()
  );
}

function resolveDeploymentIds(args, selectedApps = PREVIEW_APPS) {
  return Object.fromEntries(
    selectedApps.map((config) => [
      config.app,
      argumentValue(args, `${config.app}-deployment-id`)?.trim() ||
        process.env[`ROUND_DIRECT_E2E_${config.app.toUpperCase()}_DEPLOYMENT_ID`]?.trim() ||
        '',
    ]),
  );
}

function failureEvidence(expectedSha, deploymentIds, error, selectedApps = PREVIEW_APPS, credentialMode = null) {
  const safeFailure = safeError(error);
  const validSha =
    typeof expectedSha === 'string' && SHA_PATTERN.test(expectedSha) ? expectedSha : null;
  const pinnedDeploymentIds = Object.fromEntries(
    selectedApps.map((config) => [config.app, deploymentIds?.[config.app] || null]),
  );
  const scoped = credentialMode === EXACT_PREVIEW_CREDENTIAL_MODE_PROJECT_SCOPED;
  return {
    ready: false,
    retryable: false,
    checkedAt: new Date().toISOString(),
    repository: REPO,
    evidenceSource: 'vercel-deployment-metadata',
    vercelCredentialName: VERCEL_CREDENTIAL_NAME,
    credentialMode: credentialMode ?? EXACT_PREVIEW_CREDENTIAL_MODE_LEGACY_GLOBAL,
    vercelCredentialNames: scoped
      ? Object.freeze(Object.fromEntries(selectedApps.map(({ app }) => [app, exactPreviewTokenEnvForApp(app)])))
      : null,
    credentialValueRecorded: false,
    vercelTeamId: scoped ? null : VERCEL_TEAM_ID,
    expectedSha: validSha,
    selectedApps: selectedApps.map(({ app }) => app),
    pinnedDeploymentIds,
    deploymentIds: {},
    deploymentShas: {},
    deploymentTargetUrls: {},
    deploymentStates: {},
    failureCodes: [{ app: null, code: safeFailure.code }],
    failure: { code: safeFailure.code, message: safeFailure.message },
    apps: [],
  };
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const jsonOnly = args.includes('--json');
  const once = args.includes('--once');
  const diagnostic = args.includes('--diagnostic-status');
  const credentialModeRaw = argumentValue(args, 'credential-mode');
  let credentialMode = EXACT_PREVIEW_CREDENTIAL_MODE_LEGACY_GLOBAL;
  try {
    if (credentialModeRaw !== undefined) credentialMode = assertExactPreviewCredentialMode(credentialModeRaw);
  } catch (error) {
    const failure = failureEvidence(null, {}, error, [...PREVIEW_APPS], EXACT_PREVIEW_CREDENTIAL_MODE_LEGACY_GLOBAL);
    writeJson(failure);
    console.error(`[wait-preview-deploy] ${failure.failure.code}: ${failure.failure.message}`);
    process.exitCode = 1;
    return;
  }
  const headSha = resolveHeadSha(args);
  let selectedApps = [...PREVIEW_APPS];
  try {
    selectedApps = resolveSelectedAppConfigs(argumentValue(args, 'only'));
  } catch (error) {
    const failure = failureEvidence(headSha, {}, error, [...PREVIEW_APPS], credentialMode);
    writeJson(failure);
    console.error(`[wait-preview-deploy] ${failure.failure.code}: ${failure.failure.message}`);
    process.exitCode = 1;
    return;
  }
  const onlyLabel = selectedApps.length === PREVIEW_APPS.length ? null : selectedApps.map(({ app }) => app).join(',');

  if (diagnostic) {
    try {
      writeJson(collectCommitStatusDiagnostic(headSha));
      return;
    } catch (error) {
      const failure = failureEvidence(headSha, {}, error, selectedApps);
      writeJson(failure);
      // 진단이므로 status 불가 여부로 전체 sync workflow를 차단하지 않는다.
      process.exitCode = 0;
      return;
    }
  }

  const deploymentIds = resolveDeploymentIds(args, selectedApps);
  if (once) {
    try {
      const evidence = await collectDeploymentEvidence(headSha, deploymentIds, {
        only: argumentValue(args, 'only') ?? null,
        credentialMode,
      });
      writeJson(evidence);
      process.exitCode = evidence.ready ? 0 : 1;
    } catch (error) {
      const failure = failureEvidence(headSha, deploymentIds, error, selectedApps, credentialMode);
      writeJson(failure);
      console.error(`[wait-preview-deploy] ${failure.failure.code}: ${failure.failure.message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (!jsonOnly) {
    console.log(`[wait-preview-deploy] expected application SHA = ${headSha}`);
    if (onlyLabel) {
      console.log(
        `[wait-preview-deploy] pinned deployment ${selectedApps.length}개(only=${onlyLabel}) 확인, 제한 ${TIMEOUT_MS / 1000}초, 간격 ${INTERVAL_MS / 1000}초`,
      );
    } else {
      console.log(
        `[wait-preview-deploy] pinned deployment ${PREVIEW_APPS.length}개 확인, 제한 ${TIMEOUT_MS / 1000}초, 간격 ${INTERVAL_MS / 1000}초`,
      );
    }
  }

  const deadline = Date.now() + TIMEOUT_MS;
  let latestEvidence = null;
  let terminalFailure = null;

  while (Date.now() < deadline) {
    try {
      latestEvidence = await collectDeploymentEvidence(headSha, deploymentIds, {
        only: argumentValue(args, 'only') ?? null,
        credentialMode,
      });
      if (latestEvidence.ready || !latestEvidence.retryable) break;
    } catch (error) {
      const failure = safeError(error);
      terminalFailure = failure;
      if (!isRetryableErrorCode(failure.code)) break;
      if (!jsonOnly)
        console.warn(`[wait-preview-deploy] 일시적 Vercel API 오류 — ${failure.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }

  if (latestEvidence?.ready) {
    if (jsonOnly) writeJson(latestEvidence);
    else if (onlyLabel) {
      console.log(
        `[wait-preview-deploy] pinned Vercel deployment metadata가 검증되었습니다 (only=${onlyLabel}).`,
      );
    } else {
      console.log(
        '[wait-preview-deploy] 세 pinned Vercel deployment metadata가 모두 검증되었습니다.',
      );
    }
    return;
  }

  if (latestEvidence) {
    if (jsonOnly) writeJson(latestEvidence);
    else {
      console.error(
        '[wait-preview-deploy] Vercel deployment evidence가 준비되지 않아 E2E 실행을 차단했습니다.',
      );
      console.error(JSON.stringify(latestEvidence.failureCodes));
    }
  } else {
    const failure = failureEvidence(
      headSha,
      deploymentIds,
      terminalFailure ??
        new PreviewEvidenceError('VERCEL_API_UNAVAILABLE', 'Vercel metadata 읽기에 실패했습니다.'),
      selectedApps,
      credentialMode,
    );
    if (jsonOnly) writeJson(failure);
    else console.error(`[wait-preview-deploy] ${failure.failure.code}: ${failure.failure.message}`);
  }
  process.exitCode = 1;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    const failure = failureEvidence(null, {}, error);
    writeJson(failure);
    console.error(`[wait-preview-deploy] ${failure.failure.code}: ${failure.failure.message}`);
    process.exitCode = 1;
  });
}
