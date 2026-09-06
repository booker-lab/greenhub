/**
 * 고정된 Vercel Preview deployment metadata를 확인하는 회차 E2E 증거 게이트.
 *
 * application runtime의 source SHA와 이 workflow 자체의 candidate SHA는 서로
 * 다른 identity다. 따라서 이 스크립트는 workflow checkout의 HEAD나 최신
 * deployment를 추정하지 않고, 호출자가 전달한 expected SHA와 세 deployment ID를
 * 그대로 사용한다.
 *
 * canonical acceptance source는 Vercel deployment GET metadata다. GitHub commit
 * status는 별도 diagnostic 경로에서만 읽을 수 있으며 canonical ready 판정에는
 * 참여하지 않는다.
 *
 * 종료 코드:
 *   0  세 pinned deployment가 모두 직접 검증됨
 *   1  metadata 불일치, credential/API 오류 또는 timeout
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = 'booker-lab/greenhub';
export const VERCEL_API_ORIGIN = 'https://api.vercel.com';
export const VERCEL_TEAM_ID = 'team_J91VWI0TqcHdcF36T7qVgiT1';
export const VERCEL_CREDENTIAL_NAME = 'ROUND_DIRECT_E2E_VERCEL_READ_TOKEN';

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

function vercelHeaders(token) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function requestVercelDeployment(deploymentId, token, fetchImpl = fetch) {
  assertDeploymentId(deploymentId);
  if (typeof token !== 'string' || !token.trim()) {
    fail(
      'VERCEL_READ_TOKEN_REQUIRED',
      `${VERCEL_CREDENTIAL_NAME}가 없어 Vercel metadata를 읽을 수 없습니다.`,
    );
  }

  let response;
  try {
    response = await fetchImpl(VERCEL_API_ORIGIN + vercelDeploymentPath(deploymentId), {
      method: 'GET',
      headers: vercelHeaders(token),
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

function normalizeDeploymentIds(deploymentIds) {
  const normalized = {};
  for (const config of PREVIEW_APPS) {
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
    fetchImpl = fetch,
    request = null,
    checkedAt = () => new Date().toISOString(),
  } = {},
) {
  assertHeadSha(expectedSha);
  const pinnedDeploymentIds = normalizeDeploymentIds(deploymentIds);
  if (typeof request !== 'function' && (typeof vercelToken !== 'string' || !vercelToken.trim())) {
    fail(
      'VERCEL_READ_TOKEN_REQUIRED',
      `${VERCEL_CREDENTIAL_NAME}가 없어 Vercel metadata를 읽을 수 없습니다.`,
    );
  }

  const apps = await Promise.all(
    PREVIEW_APPS.map(async (config) => {
      const pinnedDeploymentId = pinnedDeploymentIds[config.app];
      try {
        const payload =
          typeof request === 'function'
            ? await request(pinnedDeploymentId, config.app)
            : await requestVercelDeployment(pinnedDeploymentId, vercelToken, fetchImpl);
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
    ready: apps.length === PREVIEW_APPS.length && apps.every(({ ready }) => ready),
    retryable,
    checkedAt: checkedAt(),
    repository: REPO,
    evidenceSource: 'vercel-deployment-metadata',
    vercelCredentialName: VERCEL_CREDENTIAL_NAME,
    credentialValueRecorded: false,
    vercelTeamId: VERCEL_TEAM_ID,
    expectedSha,
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

function resolveDeploymentIds(args) {
  return Object.fromEntries(
    PREVIEW_APPS.map((config) => [
      config.app,
      argumentValue(args, `${config.app}-deployment-id`)?.trim() ||
        process.env[`ROUND_DIRECT_E2E_${config.app.toUpperCase()}_DEPLOYMENT_ID`]?.trim() ||
        '',
    ]),
  );
}

function failureEvidence(expectedSha, deploymentIds, error) {
  const safeFailure = safeError(error);
  const validSha =
    typeof expectedSha === 'string' && SHA_PATTERN.test(expectedSha) ? expectedSha : null;
  const pinnedDeploymentIds = Object.fromEntries(
    PREVIEW_APPS.map((config) => [config.app, deploymentIds?.[config.app] || null]),
  );
  return {
    ready: false,
    retryable: false,
    checkedAt: new Date().toISOString(),
    repository: REPO,
    evidenceSource: 'vercel-deployment-metadata',
    vercelCredentialName: VERCEL_CREDENTIAL_NAME,
    credentialValueRecorded: false,
    vercelTeamId: VERCEL_TEAM_ID,
    expectedSha: validSha,
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
  const headSha = resolveHeadSha(args);

  if (diagnostic) {
    try {
      writeJson(collectCommitStatusDiagnostic(headSha));
      return;
    } catch (error) {
      const failure = failureEvidence(headSha, {}, error);
      writeJson(failure);
      // 진단이므로 status 불가 여부로 전체 sync workflow를 차단하지 않는다.
      process.exitCode = 0;
      return;
    }
  }

  const deploymentIds = resolveDeploymentIds(args);
  if (once) {
    try {
      const evidence = await collectDeploymentEvidence(headSha, deploymentIds);
      writeJson(evidence);
      process.exitCode = evidence.ready ? 0 : 1;
    } catch (error) {
      const failure = failureEvidence(headSha, deploymentIds, error);
      writeJson(failure);
      console.error(`[wait-preview-deploy] ${failure.failure.code}: ${failure.failure.message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (!jsonOnly) {
    console.log(`[wait-preview-deploy] expected application SHA = ${headSha}`);
    console.log(
      `[wait-preview-deploy] pinned deployment ${PREVIEW_APPS.length}개 확인, 제한 ${TIMEOUT_MS / 1000}초, 간격 ${INTERVAL_MS / 1000}초`,
    );
  }

  const deadline = Date.now() + TIMEOUT_MS;
  let latestEvidence = null;
  let terminalFailure = null;

  while (Date.now() < deadline) {
    try {
      latestEvidence = await collectDeploymentEvidence(headSha, deploymentIds);
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
    else
      console.log(
        '[wait-preview-deploy] 세 pinned Vercel deployment metadata가 모두 검증되었습니다.',
      );
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
