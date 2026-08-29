import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY = 'booker-lab/greenhub';
export const CANDIDATE_REF = 'codex/p2-security-after-pay01';
export const VERCEL_TEAM_ID = 'team_J91VWI0TqcHdcF36T7qVgiT1';
export const VERCEL_TEAM_PATH = 'jos-projects-d1cecc0c';
export const GITHUB_API_ORIGIN = 'https://api.github.com';
export const VERCEL_API_ORIGIN = 'https://api.vercel.com';

export const APPLICATIONS = Object.freeze([
  {
    app: 'consumer',
    context: 'Vercel – greenhubconsumer',
    projectId: 'prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w',
    projectName: 'greenhubconsumer',
  },
  {
    app: 'seller',
    context: 'Vercel – greenhub-seller',
    projectId: 'prj_OPOveVw4QADTbTE7mt32mo14H5dv',
    projectName: 'greenhub-seller',
  },
  {
    app: 'driver',
    context: 'Vercel – greenhub-driver',
    projectId: 'prj_e3OU9YIAGTkDcrWQdpTvkbHnJ4XW',
    projectName: 'greenhub-driver',
  },
]);

export const RAILWAY = Object.freeze({
  context: 'enchanting-enjoyment - api',
  deploymentId: 'a2f99421-003b-4bc3-b09a-29821520feec',
});

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const VERCEL_DEPLOYMENT_SUFFIX_PATTERN = /^[A-Za-z0-9]+$/;
const VERCEL_DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;

export class EvidenceContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EvidenceContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new EvidenceContractError(code, message);
}

export function assertExpectedSha(value) {
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) {
    fail('EXPECTED_SHA_MALFORMED', 'expected SHA는 40자리 소문자 16진수여야 합니다.');
  }
  return value;
}

function headerValue(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function vercelHeaders(token) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function requestJson(fetchImpl, url, token, provider) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: provider === 'github' ? headerValue(token) : vercelHeaders(token),
    });
  } catch {
    fail(
      `${provider.toUpperCase()}_API_UNAVAILABLE`,
      `${provider} API 읽기 요청에 실패했습니다.`,
    );
  }

  if (!response || !response.ok) {
    const status = Number(response?.status);
    const suffix = Number.isInteger(status) && status > 0 ? `_${status}` : '';
    fail(
      `${provider.toUpperCase()}_API_HTTP${suffix}`,
      `${provider} API가 성공 응답을 반환하지 않았습니다.`,
    );
  }

  try {
    return await response.json();
  } catch {
    fail(`${provider.toUpperCase()}_API_INVALID_JSON`, `${provider} API JSON 응답이 잘못되었습니다.`);
  }
}

function normalizeHttpsUrl(
  value,
  { provider, codePrefix, host, requireVercelAppHost = false, allowQuery = false },
) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${codePrefix}_MISSING`, `${provider} target URL이 없습니다.`);
  }

  let url;
  try {
    const raw = value.trim();
    const withProtocol =
      requireVercelAppHost && !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw)
        ? `https://${raw}`
        : raw;
    url = new URL(withProtocol);
  } catch {
    fail(`${codePrefix}_MALFORMED`, `${provider} target URL이 잘못되었습니다.`);
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (!allowQuery && url.search) ||
    url.hash ||
    url.port
  ) {
    fail(`${codePrefix}_MALFORMED`, `${provider} target URL 보안 조건이 맞지 않습니다.`);
  }

  if (host && url.hostname !== host) {
    fail(`${codePrefix}_HOST_MISMATCH`, `${provider} target URL host가 예상값과 다릅니다.`);
  }

  if (requireVercelAppHost && !url.hostname.endsWith('.vercel.app')) {
    fail(`${codePrefix}_HOST_MISMATCH`, 'Vercel direct deployment URL host가 vercel.app이 아닙니다.');
  }

  return url.toString().replace(/\/$/, '');
}

export function parseVercelDeploymentTargetUrl(value, application) {
  const normalized = normalizeHttpsUrl(value, {
    provider: 'GitHub status',
    codePrefix: 'GITHUB_STATUS_TARGET_URL',
    host: 'vercel.com',
  });
  const url = new URL(normalized);
  const segments = url.pathname.split('/').filter(Boolean);
  if (
    segments.length !== 3 ||
    segments[0] !== VERCEL_TEAM_PATH ||
    segments[1] !== application.projectName
  ) {
    fail(
      'GITHUB_STATUS_TARGET_PATH_MISMATCH',
      `${application.app} GitHub status target URL의 팀·프로젝트 경로가 예상값과 다릅니다.`,
    );
  }

  const deploymentSuffix = segments[2];
  if (
    !deploymentSuffix ||
    deploymentSuffix.startsWith('dpl_') ||
    !VERCEL_DEPLOYMENT_SUFFIX_PATTERN.test(deploymentSuffix)
  ) {
    fail(
      'GITHUB_STATUS_DEPLOYMENT_ID_PARSE_FAILED',
      `${application.app} GitHub status target URL에서 Vercel deployment ID를 추출할 수 없습니다.`,
    );
  }

  return {
    statusTargetUrl: normalized,
    deploymentId: `dpl_${deploymentSuffix}`,
  };
}

function validateCombinedStatusPayload(payload, expectedSha) {
  if (!payload || payload.sha !== expectedSha) {
    fail('GITHUB_STATUS_SHA_MISMATCH', 'GitHub combined status의 commit SHA가 expected SHA와 다릅니다.');
  }
  if (!Array.isArray(payload.statuses)) {
    fail('GITHUB_STATUS_MALFORMED', 'GitHub combined status의 statuses 배열이 없습니다.');
  }

  const contexts = new Set();
  for (const status of payload.statuses) {
    if (!status || typeof status.context !== 'string' || !status.context) {
      fail('GITHUB_STATUS_MALFORMED', 'GitHub status context가 잘못되었습니다.');
    }
    if (contexts.has(status.context)) {
      fail('GITHUB_STATUS_AMBIGUOUS', `GitHub status context가 중복되었습니다: ${status.context}`);
    }
    contexts.add(status.context);
  }
  return payload.statuses;
}

function findExactStatus(statuses, context) {
  const matches = statuses.filter((status) => status.context === context);
  if (matches.length === 0) {
    fail('GITHUB_STATUS_CONTEXT_MISSING', `필수 GitHub status context가 없습니다: ${context}`);
  }
  if (matches.length !== 1) {
    fail('GITHUB_STATUS_AMBIGUOUS', `GitHub status context가 모호합니다: ${context}`);
  }
  return matches[0];
}

function validateSuccessStatus(status, context) {
  if (status.state !== 'success') {
    fail('GITHUB_STATUS_NOT_SUCCESS', `GitHub status가 success가 아닙니다: ${context}`);
  }
  return status;
}

function deploymentIdentifier(deployment) {
  const id = deployment?.id;
  const uid = deployment?.uid;
  if (id !== undefined && uid !== undefined && id !== uid) {
    fail('VERCEL_DEPLOYMENT_ID_MISMATCH', 'Vercel deployment id와 uid가 서로 다릅니다.');
  }
  return id ?? uid;
}

function validateReadyState(deployment, application) {
  const hasReadyState = deployment?.readyState !== undefined;
  const hasState = deployment?.state !== undefined;
  if (!hasReadyState && !hasState) {
    fail('VERCEL_READY_STATE_MISMATCH', `${application.app} Vercel deployment READY 상태가 없습니다.`);
  }
  if (
    (hasReadyState && deployment.readyState !== 'READY') ||
    (hasState && deployment.state !== 'READY')
  ) {
    fail('VERCEL_READY_STATE_MISMATCH', `${application.app} Vercel deployment 상태가 READY가 아닙니다.`);
  }
}

function validateDeploymentIdentity(
  application,
  deployment,
  expectedDeploymentId,
  { requireTeamId = false } = {},
) {
  const returnedId = deploymentIdentifier(deployment);
  if (returnedId !== expectedDeploymentId) {
    fail(
      'VERCEL_DEPLOYMENT_ID_MISMATCH',
      `${application.app} Vercel deployment ID가 status evidence와 다릅니다.`,
    );
  }
  if (requireTeamId && deployment?.teamId !== VERCEL_TEAM_ID) {
    fail('VERCEL_TEAM_ID_MISMATCH', `${application.app} Vercel team ID가 예상값과 다릅니다.`);
  }
  if (!requireTeamId && deployment?.teamId !== undefined && deployment.teamId !== VERCEL_TEAM_ID) {
    fail('VERCEL_TEAM_ID_MISMATCH', `${application.app} Vercel team ID가 예상값과 다릅니다.`);
  }
  if (deployment?.projectId !== application.projectId) {
    fail('VERCEL_PROJECT_ID_MISMATCH', `${application.app} Vercel project ID가 예상값과 다릅니다.`);
  }
  if (deployment?.name !== application.projectName) {
    fail('VERCEL_PROJECT_NAME_MISMATCH', `${application.app} Vercel project name이 예상값과 다릅니다.`);
  }
  if (deployment?.target !== null) {
    fail('VERCEL_TARGET_MISMATCH', `${application.app} Vercel deployment target이 null이 아닙니다.`);
  }
  validateReadyState(deployment, application);
}

function validateGitMetadata(application, deployment, expectedSha) {
  const meta = deployment?.meta;
  if (!meta || meta.githubCommitSha !== expectedSha) {
    fail('VERCEL_GITHUB_COMMIT_SHA_MISMATCH', `${application.app} Vercel githubCommitSha가 다릅니다.`);
  }
  if (meta.githubCommitRef !== CANDIDATE_REF) {
    fail('VERCEL_GITHUB_COMMIT_REF_MISMATCH', `${application.app} Vercel githubCommitRef가 다릅니다.`);
  }
  if (meta.githubCommitOrg !== 'booker-lab' || meta.githubCommitRepo !== 'greenhub') {
    fail('VERCEL_GITHUB_REPOSITORY_MISMATCH', `${application.app} Vercel GitHub 저장소 metadata가 다릅니다.`);
  }
  return meta;
}

function validateDeploymentUrl(application, deployment) {
  const targetUrl = normalizeHttpsUrl(deployment?.url, {
    provider: 'Vercel direct deployment',
    codePrefix: 'VERCEL_DIRECT_URL',
    requireVercelAppHost: true,
  });
  const directUrl = new URL(targetUrl);
  if (directUrl.pathname !== '/') {
    fail('VERCEL_DIRECT_URL_MALFORMED', `${application.app} Vercel direct deployment URL path가 잘못되었습니다.`);
  }
  return targetUrl;
}

function buildDeploymentEvidence(application, expectedDeploymentId, meta, targetUrl) {
  return {
    app: application.app,
    context: application.context,
    githubStatusState: 'success',
    projectId: application.projectId,
    projectName: application.projectName,
    deploymentId: expectedDeploymentId,
    deploymentSha: meta.githubCommitSha,
    state: 'READY',
    targetUrl,
    ready: true,
  };
}

export function validateVercelDeployment(application, deployment, expectedSha, expectedDeploymentId) {
  validateDeploymentIdentity(application, deployment, expectedDeploymentId);
  if (deployment?.source !== 'git') {
    fail('VERCEL_SOURCE_MISMATCH', `${application.app} Vercel deployment source가 git이 아닙니다.`);
  }
  const meta = validateGitMetadata(application, deployment, expectedSha);
  const targetUrl = validateDeploymentUrl(application, deployment);

  return {
    ...buildDeploymentEvidence(application, expectedDeploymentId, meta, targetUrl),
    deploymentProvenance: 'DIRECT_GIT',
  };
}

function validateRedeployMetadata(application, deployment) {
  const meta = deployment?.meta;
  if (!meta || meta.action !== 'redeploy') {
    fail(
      'VERCEL_REDEPLOY_ACTION_MISMATCH',
      `${application.app} Vercel deployment meta.action이 redeploy가 아닙니다.`,
    );
  }
  if (meta.originalDeploymentId === undefined || meta.originalDeploymentId === null) {
    fail(
      'VERCEL_ORIGINAL_DEPLOYMENT_ID_MISSING',
      `${application.app} Vercel redeploy originalDeploymentId가 없습니다.`,
    );
  }
  if (
    typeof meta.originalDeploymentId !== 'string' ||
    !VERCEL_DEPLOYMENT_ID_PATTERN.test(meta.originalDeploymentId)
  ) {
    fail(
      'VERCEL_ORIGINAL_DEPLOYMENT_ID_MALFORMED',
      `${application.app} Vercel redeploy originalDeploymentId가 잘못되었습니다.`,
    );
  }
  return meta.originalDeploymentId;
}

async function validateVercelRedeployDeployment(
  application,
  deployment,
  expectedSha,
  expectedDeploymentId,
  vercelToken,
  fetchImpl,
) {
  validateDeploymentIdentity(application, deployment, expectedDeploymentId, { requireTeamId: true });
  const originalDeploymentId = validateRedeployMetadata(application, deployment);
  const originalDeployment = await requestJson(
    fetchImpl,
    buildDeploymentUrl(originalDeploymentId),
    vercelToken,
    'vercel',
  );

  validateDeploymentIdentity(application, originalDeployment, originalDeploymentId, {
    requireTeamId: true,
  });
  if (originalDeployment?.source !== 'git') {
    fail(
      'VERCEL_ORIGINAL_SOURCE_MISMATCH',
      `${application.app} Vercel original deployment source가 git이 아닙니다.`,
    );
  }
  if (originalDeployment?.meta?.action === 'redeploy') {
    fail('VERCEL_NESTED_REDEPLOY', `${application.app} Vercel original deployment가 redeploy입니다.`);
  }
  const originalMeta = validateGitMetadata(application, originalDeployment, expectedSha);
  const currentMeta = validateGitMetadata(application, deployment, expectedSha);
  const targetUrl = validateDeploymentUrl(application, deployment);

  return {
    ...buildDeploymentEvidence(application, expectedDeploymentId, currentMeta, targetUrl),
    deploymentProvenance: 'VERIFIED_GIT_REDEPLOY_LINEAGE',
    originalDeploymentId,
    originalDeploymentSha: originalMeta.githubCommitSha,
  };
}

export function validateRailwayStatus(status, expectedSha) {
  if (status.state !== 'success') {
    fail('RAILWAY_STATUS_NOT_SUCCESS', '보존된 Railway GitHub status가 success가 아닙니다.');
  }
  const normalized = normalizeHttpsUrl(status.target_url, {
    provider: 'Railway status',
    codePrefix: 'RAILWAY_STATUS_TARGET_URL',
    host: 'railway.com',
    allowQuery: true,
  });
  const url = new URL(normalized);
  if (url.searchParams.get('id') !== RAILWAY.deploymentId) {
    fail('RAILWAY_STATUS_TARGET_MISMATCH', 'Railway status target URL이 보존 deployment ID와 다릅니다.');
  }
  return {
    context: RAILWAY.context,
    deploymentId: RAILWAY.deploymentId,
    sha: expectedSha,
    state: 'success',
    targetUrl: normalized,
    ready: true,
  };
}

function buildStatusUrl(expectedSha) {
  return `${GITHUB_API_ORIGIN}/repos/${REPOSITORY}/commits/${expectedSha}/status`;
}

function buildDeploymentUrl(deploymentId) {
  const query = new URLSearchParams({ teamId: VERCEL_TEAM_ID });
  return `${VERCEL_API_ORIGIN}/v13/deployments/${encodeURIComponent(deploymentId)}?${query}`;
}

export async function verifyEvidence({
  expectedSha,
  githubToken,
  vercelToken,
  fetchImpl = fetch,
  checkedAt = () => new Date().toISOString(),
}) {
  assertExpectedSha(expectedSha);
  if (typeof githubToken !== 'string' || !githubToken.trim()) {
    fail('GITHUB_TOKEN_REQUIRED', 'GitHub status 읽기 token이 필요합니다.');
  }
  if (typeof vercelToken !== 'string' || !vercelToken.trim()) {
    fail('VERCEL_READ_TOKEN_REQUIRED', 'Vercel metadata 읽기 token이 필요합니다.');
  }

  const statusPayload = await requestJson(
    fetchImpl,
    buildStatusUrl(expectedSha),
    githubToken,
    'github',
  );
  const statuses = validateCombinedStatusPayload(statusPayload, expectedSha);

  const apps = [];
  for (const application of APPLICATIONS) {
    const status = validateSuccessStatus(findExactStatus(statuses, application.context), application.context);
    const parsedTarget = parseVercelDeploymentTargetUrl(status.target_url, application);
    const deployment = await requestJson(
      fetchImpl,
      buildDeploymentUrl(parsedTarget.deploymentId),
      vercelToken,
      'vercel',
    );
    const appEvidence =
      deployment?.source === 'git'
        ? validateVercelDeployment(application, deployment, expectedSha, parsedTarget.deploymentId)
        : await validateVercelRedeployDeployment(
            application,
            deployment,
            expectedSha,
            parsedTarget.deploymentId,
            vercelToken,
            fetchImpl,
          );
    apps.push({
      ...appEvidence,
      githubStatusTargetUrl: parsedTarget.statusTargetUrl,
    });
  }

  const railway = validateRailwayStatus(
    validateSuccessStatus(findExactStatus(statuses, RAILWAY.context), RAILWAY.context),
    expectedSha,
  );

  return {
    ready: true,
    source: 'github-status+vercel-api',
    repository: REPOSITORY,
    expectedSha,
    candidateRef: CANDIDATE_REF,
    checkedAt: checkedAt(),
    apps,
    railway,
  };
}

function parseArgs(args) {
  const shaArgument = args.find((arg) => arg.startsWith('--sha='));
  if (!shaArgument) {
    fail('EXPECTED_SHA_REQUIRED', '--sha=<40자리 소문자 SHA> 입력이 필요합니다.');
  }
  const expectedSha = shaArgument.slice('--sha='.length).trim();
  assertExpectedSha(expectedSha);
  return { expectedSha, json: args.includes('--json') };
}

function failureEvidence(expectedSha, error) {
  return {
    ready: false,
    source: 'github-status+vercel-api',
    repository: REPOSITORY,
    expectedSha: SHA_PATTERN.test(expectedSha ?? '') ? expectedSha : null,
    candidateRef: CANDIDATE_REF,
    checkedAt: new Date().toISOString(),
    failure: {
      code: error.code ?? 'EVIDENCE_VERIFICATION_FAILED',
      message: error.message,
    },
  };
}

async function main() {
  let expectedSha = null;
  try {
    const { expectedSha: parsedSha } = parseArgs(process.argv.slice(2));
    expectedSha = parsedSha;
    const evidence = await verifyEvidence({
      expectedSha,
      githubToken: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
      vercelToken: process.env.ROUND_DIRECT_E2E_VERCEL_READ_TOKEN,
    });
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    const safeError =
      error instanceof EvidenceContractError
        ? error
        : new EvidenceContractError('EVIDENCE_VERIFICATION_FAILED', '증거 검증에 실패했습니다.');
    process.stdout.write(`${JSON.stringify(failureEvidence(expectedSha, safeError), null, 2)}\n`);
    console.error(`[verify-vercel-preview-evidence] ${safeError.code}: ${safeError.message}`);
    process.exitCode = 1;
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main();
}
