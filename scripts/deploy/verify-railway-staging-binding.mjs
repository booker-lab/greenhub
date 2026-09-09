/**
 * Railway staging exact-SHA runtime binding evidence capability (read-only, fail-closed).
 *
 * 목적:
 *   GitHub commit status의 Railway success는 target_url이 dashboard URL이라
 *   실제 staging runtime URL이 어느 Railway deployment revision에 묶였고,
 *   그 revision이 어느 Git SHA인지 repository가 결정적으로 증명하지 못한다.
 *   이 binder는 다음을 한 번의 read-only verification으로 증명한다.
 *
 *     expected Git SHA + READY/SUCCESS deployment + 같은 deployment revision +
 *     실제 staging runtime URL + non-production classification
 *
 *   어느 하나라도 증명할 수 없으면 FAIL CLOSED (ready=false, exit 1).
 *
 * 소유권 (narrow semantic ownership):
 *   scripts/deploy/verify-railway-staging-binding.mjs (+ .spec.mjs)
 *   SEMANTIC_MUTATOR = "Railway staging exact-SHA runtime binding evidence capability"
 *
 * 안전 계약:
 *   - read-only Railway query만 허용한다. queryRailwayGraphQL은 `query`로 시작하고
 *     `mutation`을 포함하지 않는 GraphQL 문서만 전송한다.
 *   - deploy / redeploy / restart / delete 경로는 이 파일에 존재하지 않는다.
 *   - env/secret mutation을 하지 않는다. Railway credential은 요청 헤더에만 사용하고
 *     출력·오류 메시지에 절대 포함하지 않는다.
 *   - Railway Public API 계약에 맞게 credential 종류별로 헤더를 명시적으로 분리한다.
 *     ACCOUNT_OR_WORKSPACE_TOKEN(RAILWAY_API_TOKEN 또는 kind=account|workspace인 RAILWAY_TOKEN)
 *       → Authorization: Bearer
 *     PROJECT_TOKEN(RAILWAY_PROJECT_TOKEN 또는 kind=project인 RAILWAY_TOKEN)
 *       → Project-Access-Token
 *   - secret 내용으로 종류를 추측하지 않는다. 종류는 env/입력 계약으로만 결정한다.
 *   - RAILWAY_TOKEN 단독(RAILWAY_TOKEN_KIND 없음)은 ambiguous로 fail-closed한다.
 *   - 복수 credential source가 동시에 존재하면 ambiguous로 fail-closed한다.
 *   - production environment를 target으로 인정하지 않는다.
 *   - credential / query / hash가 포함된 runtime URL을 거부한다.
 *   - dashboard URL(railway.com, *.railway.com, railway.app 계열에서
 *     *.up.railway.app이 아닌 host)을 실제 runtime URL로 인정하지 않는다.
 *   - SHA가 없거나 ambiguous하면 거부한다. "latest deployment니까 아마 이 SHA" 같은
 *     timestamp inference를 하지 않는다. createdAt/updatedAt 필드는 읽지도 않는다.
 *   - GitHub combined status success만으로는 PASS하지 않는다.
 *     evidenceSource가 GitHub status 계열이면 GITHUB_STATUS_ALONE_INSUFFICIENT로 닫는다.
 *
 * 입력 계약 (CLI / env — 기존 contract 재사용):
 *   --sha=<40hex>            | RAILWAY_BINDING_EXPECTED_SHA | ROUND_DIRECT_E2E_EXPECTED_SHA
 *   --environment=<staging>  | RAILWAY_BINDING_ENVIRONMENT (기본값 staging, staging만 인정)
 *   --service=<api>          | RAILWAY_BINDING_SERVICE (기본값 api, api만 인정)
 *   --runtime-url=<https>    | RAILWAY_BINDING_RUNTIME_URL | ROUND_DIRECT_E2E_API_ORIGIN
 *   --deployment-id=<id>     | RAILWAY_BINDING_DEPLOYMENT_ID (ambiguous 해소용 명시 revision)
 *   --evidence-json=<path>   | RAILWAY_BINDING_EVIDENCE_PATH (offline Railway metadata JSON 파일)
 *                            | RAILWAY_BINDING_EVIDENCE_JSON (inline JSON)
 *   --live                   + 명시적 Railway read credential (read-only GraphQL 조회)
 *                            + RAILWAY_API_TOKEN (account/workspace → Authorization: Bearer)
 *                            + RAILWAY_PROJECT_TOKEN (project → Project-Access-Token)
 *                            + RAILWAY_TOKEN + RAILWAY_TOKEN_KIND=account|workspace|project (legacy 명시)
 *                            + RAILWAY_PROJECT_ID / RAILWAY_ENVIRONMENT_ID / RAILWAY_SERVICE_ID (선택 스코프)
 *                            또는 인증된 Railway CLI `railway status --json` (read-only CLI_STATUS)
 *   --read-source=<auto|graphql|cli-status|offline> | RAILWAY_BINDING_READ_SOURCE (기본값 auto)
 *
 * Read source 모델 (FE-PILOT-RAILWAY-READ-SOURCE-CONVERGENCE-04):
 *   GRAPHQL    — 명시적 Railway credential이 있을 때 사용 (기존 auth contract 유지)
 *   CLI_STATUS — 인증된 Railway CLI `railway status --json` read-only evidence
 *   OFFLINE    — 호출자가 이미 제공한 evidence를 평가
 * 자동 선택(auto, 기본값):
 *   explicit GraphQL credential → GRAPHQL
 *   그 외 usable authenticated CLI status → CLI_STATUS
 *   그 외 → READ_CAPABILITY_MISSING (GraphQL token 부재만으로 CLI capability까지 없다고 판정하지 않는다)
 * CLI 안전 계약: argument-array 실행 + `railway status --json` exact allowlist.
 * token harvesting 금지, CLI config/credential 파일 직접 읽기 금지,
 * login/logout/link/create/deploy/redeploy/restart 등 mutation 호출 금지.
 *
 * 출력 JSON (stdout, 최소 필드):
 *   expectedSha, deploymentId, revisionId, deploymentSha, deploymentState,
 *   runtimeUrl, environment, nonProduction, ready, evidenceSource,
 *   + failureCodes, failures, checkedAt
 *
 * 사용법:
 *   node scripts/deploy/verify-railway-staging-binding.mjs --sha=<40hex> --environment=staging \
 *     --runtime-url=https://api-staging-94af.up.railway.app --evidence-json=./binding-evidence.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

export const RAILWAY_GRAPHQL_ENDPOINT = 'https://backboard.railway.com/graphql/v2';
export const STAGING_ENVIRONMENT = 'staging';
export const STAGING_SERVICE = 'api';
export const SUCCESS_DEPLOYMENT_STATES = Object.freeze(['SUCCESS', 'READY']);
export const READ_ONLY_EVIDENCE_SOURCE = 'railway-graphql-readonly';
export const CLI_STATUS_EVIDENCE_SOURCE = 'railway-cli-status-readonly';

// Read source 모델 — first-class 구분. transport가 달라도 최종 binding semantics는 같다.
export const READ_SOURCE_GRAPHQL = 'GRAPHQL';
export const READ_SOURCE_CLI_STATUS = 'CLI_STATUS';
export const READ_SOURCE_OFFLINE = 'OFFLINE';

// CLI transport allowlist — `railway status --json`에만 한정한다.
export const RAILWAY_CLI_COMMAND = 'railway';
export const RAILWAY_CLI_STATUS_ARGS = Object.freeze(['status', '--json']);
export const RAILWAY_CLI_ALLOWLIST = Object.freeze({
  command: RAILWAY_CLI_COMMAND,
  args: RAILWAY_CLI_STATUS_ARGS,
});

const SHA_PATTERN = /^[0-9a-f]{40}$/;

// GitHub status 계열 source만으로는 Railway staging binding을 증명할 수 없다.
const GITHUB_ALONE_SOURCES = new Set([
  'github',
  'github-status',
  'github-commit-status',
  'github-combined-status',
]);

const PRODUCTION_ENVIRONMENT_NAMES = new Set(['production', 'prod', 'live']);

// docs/URLS.md의 production canonical Railway API + production host 판정 규칙.
const PRODUCTION_API_HOSTS = Object.freeze(['api-production-13e7.up.railway.app']);

const RUNTIME_URL_FAILURE_MESSAGES = Object.freeze({
  RUNTIME_URL_MISSING: 'runtime URL이 없습니다.',
  RUNTIME_URL_INVALID: 'runtime URL이 올바른 HTTPS URL이 아닙니다.',
  RUNTIME_URL_HAS_CREDENTIALS: 'credential이 포함된 runtime URL은 거부됩니다.',
  RUNTIME_URL_HAS_QUERY_OR_HASH: 'query/hash가 포함된 runtime URL은 거부됩니다.',
  PRODUCTION_RUNTIME_URL: 'production runtime URL은 binder target이 아닙니다.',
  RUNTIME_URL_IS_DASHBOARD: 'dashboard URL은 실제 staging runtime URL이 아닙니다.',
  RUNTIME_URL_NOT_RAILWAY_RUNTIME: 'Railway runtime URL(*.up.railway.app)이 아닙니다.',
});

function addFailure(failures, code, message) {
  failures.push({ code, message });
}

function normalizeShaValue(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isProductionHostname(hostname) {
  const normalized = normalizeName(hostname);
  if (!normalized) return false;
  if (PRODUCTION_API_HOSTS.includes(normalized)) return true;
  if (normalized.startsWith('api-production-')) return true;
  if (normalized === 'greenlove.co.kr' || normalized.endsWith('.greenlove.co.kr')) return true;
  return false;
}

/**
 * runtime URL을 검사한다. 성공 시 { normalizedUrl, hostname, kind: 'railway-runtime' }.
 * kind: railway-runtime | dashboard | production | non-railway | invalid | missing
 */
export function inspectRuntimeUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { normalizedUrl: null, hostname: null, kind: 'missing', failureCode: 'RUNTIME_URL_MISSING' };
  }
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return { normalizedUrl: null, hostname: null, kind: 'invalid', failureCode: 'RUNTIME_URL_INVALID' };
  }
  if (url.protocol !== 'https:') {
    return { normalizedUrl: null, hostname: null, kind: 'invalid', failureCode: 'RUNTIME_URL_INVALID' };
  }
  if (url.username || url.password) {
    return {
      normalizedUrl: null,
      hostname: null,
      kind: 'invalid',
      failureCode: 'RUNTIME_URL_HAS_CREDENTIALS',
    };
  }
  if (url.search || url.hash) {
    return {
      normalizedUrl: null,
      hostname: null,
      kind: 'invalid',
      failureCode: 'RUNTIME_URL_HAS_QUERY_OR_HASH',
    };
  }
  const hostname = url.hostname.toLowerCase();
  const normalizedUrl = url.toString().replace(/\/$/, '');
  if (isProductionHostname(hostname)) {
    return { normalizedUrl, hostname, kind: 'production', failureCode: 'PRODUCTION_RUNTIME_URL' };
  }
  if (hostname === 'railway.com' || hostname.endsWith('.railway.com')) {
    return { normalizedUrl, hostname, kind: 'dashboard', failureCode: 'RUNTIME_URL_IS_DASHBOARD' };
  }
  if (hostname.endsWith('.up.railway.app')) {
    return { normalizedUrl, hostname, kind: 'railway-runtime', failureCode: null };
  }
  if (hostname === 'railway.app' || hostname.endsWith('.railway.app')) {
    return { normalizedUrl, hostname, kind: 'dashboard', failureCode: 'RUNTIME_URL_IS_DASHBOARD' };
  }
  return {
    normalizedUrl,
    hostname,
    kind: 'non-railway',
    failureCode: 'RUNTIME_URL_NOT_RAILWAY_RUNTIME',
  };
}

export function normalizeRuntimeUrl(value) {
  const inspected = inspectRuntimeUrl(value);
  return inspected.failureCode ? null : inspected.normalizedUrl;
}

export function isNonProductionEnvironment(value) {
  return normalizeName(value) === STAGING_ENVIRONMENT;
}

/**
 * Railway deployment metadata를 정규화한다. timestamp 필드는 읽지 않는다.
 * 성공 시 { deployment, failureCode: null }, 실패 시 { deployment: null, failureCode, message }.
 */
export function normalizeDeploymentEvidence(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      deployment: null,
      failureCode: 'DEPLOYMENT_EVIDENCE_MISSING',
      message: 'Railway deployment evidence가 없습니다.',
    };
  }
  const idRaw = raw.id ?? raw.deploymentId ?? raw.revisionId;
  const id = typeof idRaw === 'string' ? idRaw.trim() : '';
  if (!id) {
    return {
      deployment: null,
      failureCode: 'DEPLOYMENT_ID_MISSING',
      message: 'deployment/revision id가 없습니다.',
    };
  }

  const shaCandidates = [];
  const collectSha = (value) => {
    if (typeof value === 'string' && value.trim()) shaCandidates.push(value.trim().toLowerCase());
  };
  collectSha(raw.sha);
  collectSha(raw.commitSha);
  collectSha(raw.commitHash);
  const meta = raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta) ? raw.meta : null;
  if (meta) {
    collectSha(meta.sha);
    collectSha(meta.commitSha);
    collectSha(meta.commitHash);
  }
  const distinctShas = [...new Set(shaCandidates)];
  if (distinctShas.length === 0) {
    return {
      deployment: null,
      failureCode: 'DEPLOYMENT_SHA_MISSING',
      message: 'deployment revision SHA가 없습니다.',
    };
  }
  if (distinctShas.length > 1) {
    return {
      deployment: null,
      failureCode: 'DEPLOYMENT_SHA_AMBIGUOUS',
      message: 'deployment SHA 후보가 2개 이상으로 모호합니다.',
    };
  }
  const sha = distinctShas[0];
  if (!SHA_PATTERN.test(sha)) {
    return {
      deployment: null,
      failureCode: 'DEPLOYMENT_SHA_INVALID',
      message: 'deployment revision SHA 형식이 40자리 16진수가 아닙니다.',
    };
  }

  const stateRaw = raw.state ?? raw.status;
  const state = typeof stateRaw === 'string' && stateRaw.trim() ? stateRaw.trim().toUpperCase() : null;

  let environment = null;
  let environmentId = null;
  const environmentField = raw.environment;
  if (typeof environmentField === 'string' && environmentField.trim()) {
    environment = environmentField.trim().toLowerCase();
  } else if (environmentField && typeof environmentField === 'object' && !Array.isArray(environmentField)) {
    if (typeof environmentField.name === 'string' && environmentField.name.trim()) {
      environment = environmentField.name.trim().toLowerCase();
    }
    if (typeof environmentField.id === 'string' && environmentField.id.trim()) {
      environmentId = environmentField.id.trim();
    }
  }
  if (typeof raw.environmentName === 'string' && raw.environmentName.trim()) {
    environment = raw.environmentName.trim().toLowerCase();
  }
  if (typeof raw.environmentId === 'string' && raw.environmentId.trim()) {
    environmentId = raw.environmentId.trim();
  }

  let serviceId = null;
  if (typeof raw.serviceId === 'string' && raw.serviceId.trim()) {
    serviceId = raw.serviceId.trim();
  } else if (raw.service && typeof raw.service === 'object' && !Array.isArray(raw.service)) {
    if (typeof raw.service.id === 'string' && raw.service.id.trim()) {
      serviceId = raw.service.id.trim();
    }
  }

  return {
    deployment: { id, sha, state, environment, environmentId, serviceId },
    failureCode: null,
    message: null,
  };
}

/**
 * deployment 후보 목록에서 단일 revision을 선택한다.
 * timestamp(createdAt/updatedAt)로는 절대 선택하지 않는다.
 * - deploymentId가 명시되면 해당 id만 선택한다.
 * - 없으면 expectedSha와 같은 revision이 정확히 1개(distinct id 기준)일 때만 선택한다.
 * - 2개 이상이면 AMBIGUOUS_MULTIPLE_DEPLOYMENTS로 닫는다.
 */
export function selectSingleDeployment(candidates, options = {}) {
  if (!Array.isArray(candidates)) {
    return {
      deployment: null,
      failureCode: 'METADATA_MALFORMED',
      message: 'deployment 후보 목록이 배열이 아닙니다.',
    };
  }
  const expectedSha = normalizeShaValue(options.expectedSha);
  const deploymentId =
    typeof options.deploymentId === 'string' ? options.deploymentId.trim() : '';
  if (!deploymentId && !SHA_PATTERN.test(expectedSha)) {
    return {
      deployment: null,
      failureCode: 'EXPECTED_SHA_INVALID',
      message: '40자리 expected SHA가 없어 deployment를 선택할 수 없습니다.',
    };
  }
  const normalized = [];
  for (const entry of candidates) {
    const result = normalizeDeploymentEvidence(entry);
    if (!result.deployment) {
      return { deployment: null, failureCode: result.failureCode, message: result.message };
    }
    normalized.push(result.deployment);
  }
  if (deploymentId) {
    const matches = normalized.filter((item) => item.id === deploymentId);
    if (matches.length === 0) {
      return {
        deployment: null,
        failureCode: 'DEPLOYMENT_NOT_FOUND',
        message: `지정한 deployment revision(${deploymentId})이 조회 결과에 없습니다.`,
      };
    }
    if (matches.length > 1) {
      return {
        deployment: null,
        failureCode: 'AMBIGUOUS_MULTIPLE_DEPLOYMENTS',
        message: '같은 revision id의 중복 행이 있어 단일 deployment를 확정할 수 없습니다.',
      };
    }
    return { deployment: matches[0], failureCode: null, message: null };
  }
  const shaMatches = normalized.filter((item) => item.sha === expectedSha);
  if (shaMatches.length === 0) {
    return {
      deployment: null,
      failureCode: 'DEPLOYMENT_NOT_FOUND',
      message: 'expected SHA와 같은 deployment revision이 조회 결과에 없습니다.',
    };
  }
  const distinctIds = new Set(shaMatches.map((item) => item.id));
  if (distinctIds.size > 1) {
    return {
      deployment: null,
      failureCode: 'AMBIGUOUS_MULTIPLE_DEPLOYMENTS',
      message:
        'expected SHA와 같은 deployment revision이 2개 이상입니다. ' +
        '--deployment-id로 명시하세요. timestamp로 추정하지 않습니다.',
    };
  }
  return { deployment: shaMatches[0], failureCode: null, message: null };
}

function pickBindingField(raw, names) {
  for (const name of names) {
    const value = raw?.[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * 핵심 판정 함수 — 순수하고 deterministic하다. 외부 I/O를 하지 않는다.
 *
 * input:
 *   { expectedSha, environment, deployment: { id, sha, state, environment, ... },
 *     runtime: { url, deploymentId, serviceId?, environmentId? }, evidenceSource }
 */
export function evaluateRailwayRevisionBinding(input) {
  const failures = [];
  const rawSource = input?.evidenceSource;
  const evidenceSource = typeof rawSource === 'string' ? rawSource.trim() : '';
  const expectedSha = normalizeShaValue(input?.expectedSha);
  const declaredEnvironment =
    typeof input?.environment === 'string' ? input.environment.trim().toLowerCase() : '';

  if (!SHA_PATTERN.test(expectedSha)) {
    addFailure(failures, 'EXPECTED_SHA_INVALID', '40자리 expected Git SHA가 없습니다.');
  }
  if (!evidenceSource) {
    addFailure(failures, 'EVIDENCE_SOURCE_MISSING', 'evidence source가 없습니다.');
  } else if (GITHUB_ALONE_SOURCES.has(evidenceSource.toLowerCase())) {
    addFailure(
      failures,
      'GITHUB_STATUS_ALONE_INSUFFICIENT',
      'GitHub combined status success만으로는 Railway staging binding을 증명할 수 없습니다.',
    );
  }

  if (!declaredEnvironment) {
    addFailure(failures, 'ENVIRONMENT_NOT_STAGING', 'staging identifier가 없습니다.');
  } else if (
    PRODUCTION_ENVIRONMENT_NAMES.has(declaredEnvironment) ||
    declaredEnvironment.includes('production')
  ) {
    addFailure(
      failures,
      'PRODUCTION_ENVIRONMENT',
      'production environment는 binder target이 아닙니다.',
    );
  } else if (declaredEnvironment !== STAGING_ENVIRONMENT) {
    addFailure(
      failures,
      'ENVIRONMENT_NOT_STAGING',
      `staging만 인정합니다: ${declaredEnvironment}`,
    );
  }

  const deploymentResult = normalizeDeploymentEvidence(input?.deployment);
  const deployment = deploymentResult.deployment;
  if (!deployment) {
    addFailure(failures, deploymentResult.failureCode, deploymentResult.message);
  } else {
    if (SHA_PATTERN.test(expectedSha) && deployment.sha !== expectedSha) {
      addFailure(
        failures,
        'DEPLOYMENT_SHA_MISMATCH',
        'deployment revision SHA가 expected SHA와 다릅니다.',
      );
    }
    if (!deployment.state || !SUCCESS_DEPLOYMENT_STATES.includes(deployment.state)) {
      addFailure(
        failures,
        'DEPLOYMENT_STATE_NOT_SUCCESS',
        `deployment state(${deployment.state ?? 'missing'})가 SUCCESS/READY가 아닙니다.`,
      );
    }
    if (!deployment.environment) {
      addFailure(
        failures,
        'DEPLOYMENT_ENVIRONMENT_MISMATCH',
        'deployment environment가 없습니다.',
      );
    } else if (deployment.environment !== declaredEnvironment) {
      addFailure(
        failures,
        'DEPLOYMENT_ENVIRONMENT_MISMATCH',
        'deployment environment가 선언된 staging identifier와 다릅니다.',
      );
    }
  }

  const runtimeRaw = input?.runtime;
  let inspected = { normalizedUrl: null, hostname: null, kind: 'missing', failureCode: null };
  let runtimeServiceId = null;
  let runtimeEnvironmentId = null;
  if (!runtimeRaw || typeof runtimeRaw !== 'object' || Array.isArray(runtimeRaw)) {
    addFailure(failures, 'RUNTIME_EVIDENCE_MISSING', 'runtime binding evidence가 없습니다.');
  } else {
    inspected = inspectRuntimeUrl(runtimeRaw.url);
    if (inspected.failureCode) {
      addFailure(
        failures,
        inspected.failureCode,
        RUNTIME_URL_FAILURE_MESSAGES[inspected.failureCode] ?? 'runtime URL이 유효하지 않습니다.',
      );
    }
    const boundRevisionId = pickBindingField(runtimeRaw, [
      'deploymentId',
      'revisionId',
      'boundDeploymentId',
    ]);
    if (!boundRevisionId) {
      addFailure(
        failures,
        'BOUND_REVISION_MISSING',
        'runtime URL이 묶인 deployment revision id가 없습니다.',
      );
    } else if (deployment && boundRevisionId !== deployment.id) {
      addFailure(
        failures,
        'URL_REVISION_MISMATCH',
        'runtime URL이 묶인 revision이 deployment revision과 다릅니다.',
      );
    }
    runtimeServiceId = pickBindingField(runtimeRaw, ['serviceId']);
    const runtimeServiceObject = runtimeRaw.service;
    if (
      !runtimeServiceId &&
      runtimeServiceObject &&
      typeof runtimeServiceObject === 'object' &&
      typeof runtimeServiceObject.id === 'string'
    ) {
      runtimeServiceId = runtimeServiceObject.id.trim();
    }
    runtimeEnvironmentId = pickBindingField(runtimeRaw, ['environmentId']);
    if (deployment && runtimeServiceId && deployment.serviceId && runtimeServiceId !== deployment.serviceId) {
      addFailure(
        failures,
        'URL_REVISION_MISMATCH',
        'runtime URL의 service binding이 deployment service와 다릅니다.',
      );
    }
    if (
      deployment &&
      runtimeEnvironmentId &&
      deployment.environmentId &&
      runtimeEnvironmentId !== deployment.environmentId
    ) {
      addFailure(
        failures,
        'URL_REVISION_MISMATCH',
        'runtime URL의 environment binding이 deployment environment와 다릅니다.',
      );
    }
  }

  const nonProduction =
    declaredEnvironment === STAGING_ENVIRONMENT &&
    (deployment?.environment ?? null) === STAGING_ENVIRONMENT &&
    inspected.kind === 'railway-runtime';
  const ready = failures.length === 0;

  return {
    ready,
    checkedAt: new Date().toISOString(),
    expectedSha: expectedSha || null,
    deploymentId: deployment?.id ?? null,
    revisionId: deployment?.id ?? null,
    deploymentSha: deployment?.sha ?? null,
    deploymentState: deployment?.state ?? null,
    runtimeUrl: inspected.normalizedUrl,
    environment: declaredEnvironment || null,
    deploymentEnvironment: deployment?.environment ?? null,
    nonProduction,
    evidenceSource: evidenceSource || null,
    failureCodes: failures.map(({ code }) => code),
    failures,
  };
}

/**
 * read-only GraphQL 문서를 강제한다. mutation 경로는 이 helper를 통과할 수 없다.
 */
export function assertReadOnlyQuery(query) {
  const text = String(query ?? '');
  if (/\bmutation\b/i.test(text)) {
    throw new Error('mutation은 binder에서 금지됩니다.');
  }
  if (!/^\s*query[\s({]/i.test(text)) {
    throw new Error('read-only query만 허용됩니다.');
  }
  return text;
}

/**
 * Railway read credential 종류 → HTTP header 명시 매핑 (fail-closed).
 *
 *   ACCOUNT_OR_WORKSPACE_TOKEN → Authorization: Bearer
 *   PROJECT_TOKEN              → Project-Access-Token
 *
 * 지원하는 명시 계약:
 *   - RAILWAY_API_TOKEN            → account (Authorization: Bearer)
 *   - RAILWAY_PROJECT_TOKEN        → project (Project-Access-Token)
 *   - RAILWAY_TOKEN + RAILWAY_TOKEN_KIND=account|workspace|project (legacy 명시)
 *   - --auth-kind는 RAILWAY_TOKEN_KIND의 CLI override다.
 *
 * 규칙:
 *   - secret 내용으로 종류를 추측하지 않는다.
 *   - RAILWAY_TOKEN 단독(kind 없음)은 ambiguous로 닫는다.
 *   - 복수 credential source가 동시에 존재하면 ambiguous로 닫는다.
 *   - credential이 하나도 없으면 MISSING으로 닫는다.
 *   - 어떤 오류 메시지에도 token 값을 포함하지 않는다.
 */
export const RAILWAY_PROJECT_ACCESS_TOKEN_HEADER = 'Project-Access-Token';

function asCredentialString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeRailwayTokenKind(value) {
  const normalized = asCredentialString(value).toLowerCase();
  if (normalized === 'account' || normalized === 'workspace') return 'account';
  if (normalized === 'project') return 'project';
  return null;
}

export function resolveRailwayAuthCredential({
  token = '',
  tokenKind = '',
  authKind = '',
  apiToken = '',
  projectToken = '',
} = {}) {
  const api = asCredentialString(apiToken);
  const project = asCredentialString(projectToken);
  const legacy = asCredentialString(token);
  const kindInputRaw = asCredentialString(tokenKind) || asCredentialString(authKind);
  // tokenKind와 authKind가 둘 다 명시되고 서로 다르면 모호하다.
  const tokenKindNorm = asCredentialString(tokenKind).toLowerCase();
  const authKindNorm = asCredentialString(authKind).toLowerCase();
  if (tokenKindNorm && authKindNorm && tokenKindNorm !== authKindNorm) {
    throw new Error('Railway auth 설정이 모호합니다. (RAILWAY_AUTH_AMBIGUOUS)');
  }
  const hasApi = Boolean(api);
  const hasProject = Boolean(project);
  const hasLegacy = Boolean(legacy);
  const sourceCount = [hasApi, hasProject, hasLegacy].filter(Boolean).length;
  if (sourceCount === 0) {
    throw new Error('Railway read credential이 없습니다. (RAILWAY_AUTH_MISSING)');
  }
  if (sourceCount > 1) {
    throw new Error('Railway auth 설정이 모호합니다. (RAILWAY_AUTH_AMBIGUOUS)');
  }
  if (hasApi) {
    return { kind: 'account', token: api };
  }
  if (hasProject) {
    return { kind: 'project', token: project };
  }
  // legacy RAILWAY_TOKEN — 반드시 명시적 kind가 필요하다.
  if (!kindInputRaw) {
    throw new Error('Railway auth 설정이 모호합니다. (RAILWAY_AUTH_AMBIGUOUS)');
  }
  const kind = normalizeRailwayTokenKind(kindInputRaw);
  if (!kind) {
    throw new Error('Railway auth 설정이 모호합니다. (RAILWAY_AUTH_AMBIGUOUS)');
  }
  return { kind, token: legacy };
}

export function buildRailwayAuthHeaders(credential) {
  const kind = credential?.kind;
  const token = typeof credential?.token === 'string' ? credential.token.trim() : '';
  if (!token) {
    throw new Error('Railway read credential이 없습니다. (RAILWAY_AUTH_MISSING)');
  }
  if (kind === 'account') {
    return { authorization: `Bearer ${token}` };
  }
  if (kind === 'project') {
    return { [RAILWAY_PROJECT_ACCESS_TOKEN_HEADER]: token };
  }
  throw new Error('Railway auth 설정이 모호합니다. (RAILWAY_AUTH_AMBIGUOUS)');
}

/**
 * 명시적 GraphQL credential 존재 여부 — 값의 종류를 추측하지 않고
 * 비어 있지 않은 credential 문자열이 하나라도 있으면 true.
 * 모호성 판정은 resolveRailwayAuthCredential이 소유한다.
 */
export function hasExplicitRailwayCredential({ apiToken = '', projectToken = '', token = '' } = {}) {
  return Boolean(
    asCredentialString(apiToken) || asCredentialString(projectToken) || asCredentialString(token),
  );
}

/**
 * --read-source / RAILWAY_BINDING_READ_SOURCE 정규화.
 * auto(기본) | graphql | cli-status | offline. 알 수 없는 값은 null.
 */
export function normalizeReadSource(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized || normalized === 'auto') return 'auto';
  if (normalized === 'graphql') return 'graphql';
  if (normalized === 'cli-status' || normalized === 'cli_status' || normalized === 'cli') {
    return 'cli-status';
  }
  if (normalized === 'offline') return 'offline';
  return null;
}

/**
 * 자동 read source selection — 코드와 tests로 고정된 결정 규칙.
 *   evidence 있음 → OFFLINE
 *   명시적 GraphQL credential 있음 → GRAPHQL
 *   그 외 usable authenticated CLI status 있음 → CLI_STATUS
 *   그 외 → null (READ_CAPABILITY_MISSING)
 * GraphQL token이 없다는 사실만으로 CLI capability까지 없다고 판정하지 않는다.
 * cliAvailable: true(사용 가능) | false(사용 불가) | null(알 수 없음 → 불가로 취급).
 * 명시적 readSource(graphql|cli-status|offline)가 있으면 auto보다 우선한다.
 */
export function resolveRailwayReadSource({
  evidence = null,
  live = false,
  apiToken = '',
  projectToken = '',
  token = '',
  cliStatus = null,
  runCliStatus = null,
  allowCliStatus = true,
  readSource = 'auto',
} = {}) {
  const normalized = normalizeReadSource(readSource) ?? 'auto';
  const hasEvidence =
    evidence !== null && evidence !== undefined && evidence !== '';
  if (normalized === 'offline') {
    if (hasEvidence) return { source: READ_SOURCE_OFFLINE, reason: 'explicit-offline-evidence' };
    return { source: null, reason: 'explicit-offline-without-evidence' };
  }
  if (normalized === 'graphql') {
    return { source: READ_SOURCE_GRAPHQL, reason: 'explicit-graphql' };
  }
  if (normalized === 'cli-status') {
    if (!live) return { source: null, reason: 'explicit-cli-without-live' };
    if (allowCliStatus === false) return { source: null, reason: 'explicit-cli-disallowed' };
    return { source: READ_SOURCE_CLI_STATUS, reason: 'explicit-cli-status' };
  }
  // auto
  if (hasEvidence) {
    return { source: READ_SOURCE_OFFLINE, reason: 'auto-offline-evidence-present' };
  }
  if (!live) {
    return { source: null, reason: 'auto-offline-no-live-no-evidence' };
  }
  if (hasExplicitRailwayCredential({ apiToken, projectToken, token })) {
    return { source: READ_SOURCE_GRAPHQL, reason: 'auto-explicit-credential' };
  }
  const hasCliStatusValue =
    cliStatus !== null && cliStatus !== undefined && cliStatus !== '';
  if (allowCliStatus !== false && (hasCliStatusValue || typeof runCliStatus === 'function')) {
    return { source: READ_SOURCE_CLI_STATUS, reason: 'auto-usable-cli-status' };
  }
  return { source: null, reason: 'auto-no-graphql-no-cli' };
}

// CLI mutation 키워드 — allowlist 방어막 뒤의 2차 fail-closed 탐지용.
const CLI_MUTATION_KEYWORDS = Object.freeze([
  'deploy',
  'redeploy',
  'restart',
  'up',
  'down',
  'variable',
  'domain',
  'create',
  'delete',
  'remove',
  'link',
  'unlink',
  'login',
  'logout',
  'shell',
  'exec',
]);

export function isRailwayMutationArgs(args) {
  if (!Array.isArray(args)) return true;
  return args.some((item) => {
    if (typeof item !== 'string') return true;
    const token = item.trim().toLowerCase().replace(/^--+/, '');
    return CLI_MUTATION_KEYWORDS.includes(token);
  });
}

function basenameOf(command) {
  const text = typeof command === 'string' ? command.trim() : '';
  if (!text) return '';
  const normalized = text.replace(/\\/g, '/');
  const base = normalized.split('/').pop() ?? '';
  return base.toLowerCase().replace(/\.(exe|cmd|ps1)$/, '');
}

/**
 * CLI allowlist 강제 — `railway status --json` exact match만 허용.
 * shell interpolation을 사용하지 않으며, 그 외 모든 호출은 실행 전에 fail-closed.
 */
export function assertAllowedCliInvocation(command, args) {
  if (basenameOf(command) !== RAILWAY_CLI_COMMAND) {
    throw new Error('read-only railway status --json만 허용됩니다. (RAILWAY_CLI_DISALLOWED)');
  }
  if (!Array.isArray(args) || args.length !== RAILWAY_CLI_STATUS_ARGS.length) {
    throw new Error('read-only railway status --json만 허용됩니다. (RAILWAY_CLI_DISALLOWED)');
  }
  for (let index = 0; index < RAILWAY_CLI_STATUS_ARGS.length; index += 1) {
    if (args[index] !== RAILWAY_CLI_STATUS_ARGS[index]) {
      throw new Error('read-only railway status --json만 허용됩니다. (RAILWAY_CLI_DISALLOWED)');
    }
  }
  if (isRailwayMutationArgs(args)) {
    throw new Error('Railway mutation command는 binder에서 금지됩니다. (RAILWAY_CLI_DISALLOWED)');
  }
  return true;
}

const defaultExecFileAsync = promisify(execFile);

/**
 * npm global로 설치된 Railway JS 진입점을 shell 없이 직접 실행하기 위한 resolver.
 * 호출자 입력을 받지 않고 고정된 상대 경로만 탐색한다.
 * token harvesting·config 직접 읽기가 없으며 mutation 인자를 절대 추가하지 않는다.
 */
export function findRailwayJsEntry() {
  const candidates = [];
  const appData = typeof process.env?.APPDATA === 'string' ? process.env.APPDATA.trim() : '';
  if (appData) {
    candidates.push(path.join(appData, 'npm', 'node_modules', '@railway', 'cli', 'bin', 'railway.js'));
  }
  const npmPrefix =
    typeof process.env?.npm_config_prefix === 'string' ? process.env.npm_config_prefix.trim() : '';
  if (npmPrefix) {
    candidates.push(path.join(npmPrefix, 'node_modules', '@railway', 'cli', 'bin', 'railway.js'));
    candidates.push(
      path.join(npmPrefix, 'lib', 'node_modules', '@railway', 'cli', 'bin', 'railway.js'),
    );
  }
  const home =
    typeof process.env?.HOME === 'string'
      ? process.env.HOME.trim()
      : typeof process.env?.USERPROFILE === 'string'
        ? process.env.USERPROFILE.trim()
        : '';
  if (home) {
    candidates.push(
      path.join(home, '.npm-global', 'lib', 'node_modules', '@railway', 'cli', 'bin', 'railway.js'),
    );
  }
  candidates.push('/usr/local/lib/node_modules/@railway/cli/bin/railway.js');
  candidates.push('/usr/lib/node_modules/@railway/cli/bin/railway.js');
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      // 존재 확인 실패는 다음 후보로 계속한다.
    }
  }
  return null;
}

function parseExecStdout(result) {
  if (typeof result === 'string') return result;
  return result?.stdout ?? '';
}

/**
 * Authenticated Railway CLI read-only 실행 — argument-array 기반, shell 미사용.
 * token harvesting 없음, config/credential 파일 직접 읽기 없음,
 * login/logout/link/create/deploy 등 mutation 경로 없음.
 * Windows npm shim(.cmd/.ps1) 환경에서는 직접 binary 실행이 ENOENT일 수 있어
 * 고정된 railway.js 진입점을 node로 실행하는 fallback만 허용한다.
 * 성공 시 parsed `railway status --json` 객체를 반환한다.
 */
export async function readRailwayCliStatus({ execFileImpl = defaultExecFileAsync } = {}) {
  assertAllowedCliInvocation(RAILWAY_CLI_COMMAND, [...RAILWAY_CLI_STATUS_ARGS]);
  if (typeof execFileImpl !== 'function') {
    throw new Error('Railway CLI 실행 구현이 없습니다. (RAILWAY_CLI_UNAVAILABLE)');
  }
  const execOptions = {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024,
  };
  let stdout = '';
  let directMissing = false;
  try {
    const result = await execFileImpl(RAILWAY_CLI_COMMAND, [...RAILWAY_CLI_STATUS_ARGS], execOptions);
    stdout = parseExecStdout(result);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      directMissing = true;
    } else {
      throw new Error(
        `Railway CLI status 조회 실패. (${'RAILWAY_CLI_READ_FAILED'})`,
      );
    }
  }
  if (directMissing) {
    const jsEntry = findRailwayJsEntry();
    if (!jsEntry) {
      throw new Error('Railway CLI를 찾을 수 없습니다. (RAILWAY_CLI_UNAVAILABLE)');
    }
    // fallback도 고정된 read-only 인자만 허용한다. 호출자 입력은 절대 전달하지 않는다.
    const fallbackArgs = [jsEntry, ...RAILWAY_CLI_STATUS_ARGS];
    if (
      !fallbackArgs[0].endsWith('railway.js') ||
      fallbackArgs.slice(-2).join(' ') !== RAILWAY_CLI_STATUS_ARGS.join(' ')
    ) {
      throw new Error('read-only railway status --json만 허용됩니다. (RAILWAY_CLI_DISALLOWED)');
    }
    try {
      const result = await execFileImpl(process.execPath, fallbackArgs, execOptions);
      stdout = parseExecStdout(result);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error('Railway CLI를 찾을 수 없습니다. (RAILWAY_CLI_UNAVAILABLE)');
      }
      throw new Error(
        `Railway CLI status 조회 실패. (${'RAILWAY_CLI_READ_FAILED'})`,
      );
    }
  }
  if (typeof stdout !== 'string' || !stdout.trim()) {
    throw new Error('Railway CLI status 출력이 비어 있습니다. (RAILWAY_CLI_READ_FAILED)');
  }
  try {
    const parsed = JSON.parse(stdout);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('empty');
    }
    return parsed;
  } catch {
    throw new Error('Railway CLI status JSON을 해석할 수 없습니다. (RAILWAY_CLI_READ_FAILED)');
  }
}

function edgeNodes(connection) {
  if (!connection || typeof connection !== 'object' || Array.isArray(connection)) return null;
  const edges = connection.edges;
  if (!Array.isArray(edges)) return null;
  return edges
    .map((edge) => (edge && typeof edge === 'object' ? edge.node : null))
    .filter((node) => node && typeof node === 'object');
}

/**
 * `railway status --json` live response를 canonical binder evidence로 normalize.
 * transport마다 판정 로직을 복제하지 않고 normalizeDeploymentEvidence +
 * evaluateRailwayRevisionBinding을 재사용할 수 있는 deployment/runtime shape를 만든다.
 * 값이 없으면 추측하지 않고 RAILWAY_EVIDENCE_INCOMPLETE로 닫는다.
 * timestamp(createdAt/updatedAt)로는 절대 선택하지 않는다.
 */
export function normalizeCliStatusBinding(
  cliStatus,
  { environment = STAGING_ENVIRONMENT, service = STAGING_SERVICE, runtimeUrl = '', deploymentId = '' } = {},
) {
  const fail = (message) => ({
    deployment: null,
    runtime: null,
    serviceName: null,
    serviceId: null,
    environmentId: null,
    domain: null,
    targetPort: null,
    evidenceSource: CLI_STATUS_EVIDENCE_SOURCE,
    failureCode: 'RAILWAY_EVIDENCE_INCOMPLETE',
    message,
  });
  let root = cliStatus;
  if (typeof root === 'string') {
    if (!root.trim()) return fail('Railway CLI status 출력이 비어 있습니다.');
    try {
      root = JSON.parse(root.trim());
    } catch {
      return {
        deployment: null,
        runtime: null,
        serviceName: null,
        serviceId: null,
        environmentId: null,
        domain: null,
        targetPort: null,
        evidenceSource: CLI_STATUS_EVIDENCE_SOURCE,
        failureCode: 'RAILWAY_CLI_READ_FAILED',
        message: 'Railway CLI status JSON을 해석할 수 없습니다.',
      };
    }
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    return fail('Railway CLI status shape를 인식할 수 없습니다.');
  }
  const environments = edgeNodes(root.environments);
  if (!environments) {
    return fail('Railway CLI status에 environments 목록이 없습니다.');
  }
  const wantedEnv = normalizeName(environment) || STAGING_ENVIRONMENT;
  const envNode = environments.find((node) => normalizeName(node.name) === wantedEnv);
  if (!envNode) {
    return fail(`Railway CLI status에 요청한 environment(${wantedEnv})가 없습니다.`);
  }
  const envName = typeof envNode.name === 'string' ? envNode.name.trim().toLowerCase() : '';
  const envId = typeof envNode.id === 'string' && envNode.id.trim() ? envNode.id.trim() : null;
  if (!envName || !envId) {
    return fail('Railway CLI status의 environment name/id가 부족합니다.');
  }
  const instances = edgeNodes(envNode.serviceInstances);
  if (!instances) {
    return fail('Railway CLI status에 serviceInstances 목록이 없습니다.');
  }
  const wantedService = normalizeName(service) || STAGING_SERVICE;
  const instance = instances.find((node) => normalizeName(node.serviceName) === wantedService);
  if (!instance) {
    return fail(`Railway CLI status에 요청한 service(${wantedService})가 없습니다.`);
  }
  const serviceName =
    typeof instance.serviceName === 'string' ? instance.serviceName.trim().toLowerCase() : null;
  const instanceServiceId =
    typeof instance.serviceId === 'string' && instance.serviceId.trim()
      ? instance.serviceId.trim()
      : null;
  const instanceEnvId =
    (typeof instance.environmentId === 'string' && instance.environmentId.trim()) || envId;
  if (!serviceName || !instanceServiceId || !instanceEnvId) {
    return fail('Railway CLI status의 service name/id 또는 environment id가 부족합니다.');
  }
  if (instanceEnvId !== envId) {
    return fail('Railway CLI status의 service instance가 요청한 environment에 속하지 않습니다.');
  }
  const latest = instance.latestDeployment;
  if (!latest || typeof latest !== 'object' || Array.isArray(latest)) {
    return fail('Railway CLI status에 latest deployment가 없습니다.');
  }
  const deploymentIdRaw = typeof latest.id === 'string' ? latest.id.trim() : '';
  if (!deploymentIdRaw) {
    return fail('Railway CLI status의 deployment id가 없습니다.');
  }
  const requestedDeploymentId =
    typeof deploymentId === 'string' ? deploymentId.trim() : '';
  if (requestedDeploymentId && requestedDeploymentId !== deploymentIdRaw) {
    return {
      deployment: null,
      runtime: null,
      serviceName,
      serviceId: instanceServiceId,
      environmentId: instanceEnvId,
      domain: null,
      targetPort: null,
      evidenceSource: CLI_STATUS_EVIDENCE_SOURCE,
      failureCode: 'DEPLOYMENT_NOT_FOUND',
      message: '지정한 deployment revision이 CLI status 결과에 없습니다.',
    };
  }
  const meta = latest.meta && typeof latest.meta === 'object' && !Array.isArray(latest.meta)
    ? latest.meta
    : {};
  const shaRaw =
    (typeof meta.commitHash === 'string' && meta.commitHash.trim()) ||
    (typeof meta.commitSha === 'string' && meta.commitSha.trim()) ||
    (typeof meta.sha === 'string' && meta.sha.trim()) ||
    '';
  if (!shaRaw) {
    return fail('Railway CLI status의 deployment revision SHA가 없습니다.');
  }
  const sha = shaRaw.trim().toLowerCase();
  if (!SHA_PATTERN.test(sha)) {
    return fail('Railway CLI status의 deployment revision SHA 형식이 40자리 16진수가 아닙니다.');
  }
  const stateRaw = typeof latest.status === 'string' ? latest.status.trim().toUpperCase() : '';
  const deployment = {
    id: deploymentIdRaw,
    sha,
    state: stateRaw || null,
    environment: envName,
    environmentId: instanceEnvId,
    serviceId: instanceServiceId,
  };
  const canonical = normalizeDeploymentEvidence(deployment);
  if (!canonical.deployment) {
    return fail(canonical.message ?? 'Railway CLI deployment evidence가 부족합니다.');
  }
  const domainsConnection = instance.domains;
  const serviceDomainsRaw =
    domainsConnection && typeof domainsConnection === 'object' && !Array.isArray(domainsConnection)
      ? domainsConnection.serviceDomains
      : null;
  if (!Array.isArray(serviceDomainsRaw)) {
    return fail('Railway CLI status에 serviceDomains 목록이 없습니다.');
  }
  const inspected = inspectRuntimeUrl(runtimeUrl);
  let matchedDomain = null;
  let targetPort = null;
  if (!inspected.failureCode) {
    matchedDomain = serviceDomainsRaw.find((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const domainRaw = typeof entry.domain === 'string' ? entry.domain.trim().toLowerCase() : '';
      return domainRaw && `https://${domainRaw}` === inspected.normalizedUrl;
    }) ?? null;
    if (matchedDomain && typeof matchedDomain.targetPort === 'number') {
      targetPort = matchedDomain.targetPort;
    }
  }
  const runtime = {
    url: typeof runtimeUrl === 'string' ? runtimeUrl : '',
    deploymentId: deploymentIdRaw,
    serviceId: instanceServiceId,
    environmentId: instanceEnvId,
  };
  return {
    deployment: canonical.deployment,
    runtime,
    serviceName,
    serviceId: instanceServiceId,
    environmentId: instanceEnvId,
    domain: matchedDomain?.domain?.trim().toLowerCase() ?? null,
    targetPort,
    evidenceSource: CLI_STATUS_EVIDENCE_SOURCE,
    failureCode: null,
    message: null,
  };
}

/**
 * Railway GraphQL read-only 조회. credential은 종류별 명시 헤더에만 사용하고
 * 출력·예외 메시지에 포함하지 않는다.
 */
export async function queryRailwayGraphQL({
  token = '',
  tokenKind = '',
  authKind = '',
  apiToken = '',
  projectToken = '',
  query,
  variables = {},
  fetchImpl = globalThis.fetch,
  endpoint = RAILWAY_GRAPHQL_ENDPOINT,
} = {}) {
  const safeQuery = assertReadOnlyQuery(query);
  let credential;
  try {
    credential = resolveRailwayAuthCredential({ token, tokenKind, authKind, apiToken, projectToken });
  } catch (error) {
    // resolver 메시지는 이미 token 값을 포함하지 않는다. 그대로 전달한다.
    throw error instanceof Error ? error : new Error(String(error));
  }
  const authHeaders = buildRailwayAuthHeaders(credential);
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch 구현이 없습니다.');
  }
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({ query: safeQuery, variables }),
    });
  } catch (error) {
    throw new Error(
      `Railway GraphQL 조회 실패: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response || typeof response.json !== 'function') {
    throw new Error('Railway GraphQL 응답 형식이 올바르지 않습니다.');
  }
  if (response.ok === false) {
    throw new Error(`Railway GraphQL HTTP ${response.status} — read-only 조회 실패`);
  }
  const body = await response.json();
  if (body && typeof body === 'object' && Array.isArray(body.errors) && body.errors.length > 0) {
    const first = body.errors[0];
    const message =
      first && typeof first.message === 'string' ? first.message : 'GraphQL 오류';
    throw new Error(`Railway GraphQL 오류: ${message}`);
  }
  const data = body && typeof body === 'object' ? (body.data ?? null) : null;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Railway GraphQL data가 없습니다.');
  }
  return data;
}

// 기본 live 조회 템플릿 — workspace Railway project의 실제 GraphQL schema와 다르면
// extract* 단계에서 RAILWAY_SCHEMA_UNRECOGNIZED로 fail-closed한다. shape를 추측하지 않는다.
export const RAILWAY_STAGING_DEPLOYMENTS_QUERY = `query RailwayStagingDeployments($projectId: String, $environmentId: String, $serviceId: String) {
  deployments(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
    id
    status
    meta {
      branch
      commitHash
    }
    service {
      id
    }
    environment {
      id
      name
    }
  }
}`;

export const RAILWAY_SERVICE_DOMAINS_QUERY = `query RailwayServiceDomains($projectId: String, $environmentId: String, $serviceId: String) {
  domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
    domain
    serviceId
    environmentId
  }
}`;

/**
 * GraphQL 응답에서 deployment 후보 배열을 추출한다.
 * 알려진 envelope(배열 자체, { deployments }, { deployments: { edges } }, { data })만 인정한다.
 */
export function extractDeploymentCandidates(data) {
  const root =
    data && typeof data === 'object' && !Array.isArray(data) && data.data && typeof data.data === 'object'
      ? data.data
      : data;
  if (Array.isArray(root)) return { candidates: root, failureCode: null };
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    return {
      candidates: null,
      failureCode: 'RAILWAY_SCHEMA_UNRECOGNIZED',
      message: 'Railway 응답에서 deployment 목록 shape를 인식할 수 없습니다.',
    };
  }
  const direct = root.deployments;
  if (Array.isArray(direct)) return { candidates: direct, failureCode: null };
  if (direct && typeof direct === 'object' && Array.isArray(direct.edges)) {
    const nodes = direct.edges
      .map((edge) => (edge && typeof edge === 'object' ? edge.node : null))
      .filter((node) => node && typeof node === 'object');
    return { candidates: nodes, failureCode: null };
  }
  return {
    candidates: null,
    failureCode: 'RAILWAY_SCHEMA_UNRECOGNIZED',
    message: 'Railway 응답에서 deployment 목록 shape를 인식할 수 없습니다.',
  };
}

export function extractDomainCandidates(data) {
  const root =
    data && typeof data === 'object' && !Array.isArray(data) && data.data && typeof data.data === 'object'
      ? data.data
      : data;
  if (Array.isArray(root)) return { candidates: root, failureCode: null };
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    return {
      candidates: null,
      failureCode: 'RAILWAY_SCHEMA_UNRECOGNIZED',
      message: 'Railway 응답에서 domain 목록 shape를 인식할 수 없습니다.',
    };
  }
  for (const key of ['domains', 'serviceDomains']) {
    const direct = root[key];
    if (Array.isArray(direct)) return { candidates: direct, failureCode: null };
    if (direct && typeof direct === 'object' && Array.isArray(direct.edges)) {
      const nodes = direct.edges
        .map((edge) => (edge && typeof edge === 'object' ? edge.node : null))
        .filter((node) => node && typeof node === 'object');
      return { candidates: nodes, failureCode: null };
    }
  }
  return {
    candidates: null,
    failureCode: 'RAILWAY_SCHEMA_UNRECOGNIZED',
    message: 'Railway 응답에서 domain 목록 shape를 인식할 수 없습니다.',
  };
}

export function normalizeDomainEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const domainRaw = [raw.domain, raw.host, raw.hostname].find(
    (value) => typeof value === 'string' && value.trim(),
  );
  if (!domainRaw) return null;
  const serviceObject = raw.service;
  return {
    domain: domainRaw.trim().toLowerCase(),
    serviceId:
      (typeof raw.serviceId === 'string' && raw.serviceId.trim()) ||
      (serviceObject && typeof serviceObject === 'object' && typeof serviceObject.id === 'string'
        ? serviceObject.id.trim()
        : null) ||
      null,
    environmentId:
      (typeof raw.environmentId === 'string' && raw.environmentId.trim()) ||
      (raw.environment && typeof raw.environment === 'object' && typeof raw.environment.id === 'string'
        ? raw.environment.id.trim()
        : null) ||
      null,
  };
}

function failedBindingResult(partial, code, message) {
  const base = evaluateRailwayRevisionBinding({
    expectedSha: partial?.expectedSha ?? '',
    environment: partial?.environment ?? '',
    deployment: partial?.deployment ?? null,
    runtime: partial?.runtime ?? null,
    evidenceSource: partial?.evidenceSource ?? '',
  });
  base.failures.push({ code, message });
  base.failureCodes = base.failures.map(({ code: failureCode }) => failureCode);
  base.ready = false;
  return base;
}

function parseEvidenceValue(evidence) {
  if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) return evidence;
  if (typeof evidence === 'string' && evidence.trim()) {
    try {
      const parsed = JSON.parse(evidence.trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      return null;
    }
    return null;
  }
  return null;
}

function withReadSource(result, source, reason, extra = {}) {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    result.readSource = source;
    result.selectionReason = reason;
    for (const [key, value] of Object.entries(extra)) {
      if (result[key] === undefined) {
        result[key] = value;
      }
    }
  }
  return result;
}

/**
 * offline evidence JSON 또는 live read-only 조회(GRAPHQL | CLI_STATUS)로
 * binding evidence를 수집하고 판정한다.
 * live GRAPHQL binding 규칙: exact-SHA SUCCESS/READY deployment가 조회 범위에서
 * 정확히 1개일 때만 같은 service+environment의 service domain과 묶는다.
 * live CLI_STATUS binding 규칙: 요청한 staging/api serviceInstance의
 * latestDeployment + serviceDomains를 canonical shape로 normalize한 뒤
 * 같은 evaluateRailwayRevisionBinding으로 판정한다. transport마다 판정을 복제하지 않는다.
 */
export async function collectRailwayBindingEvidence({
  expectedSha = '',
  environment = STAGING_ENVIRONMENT,
  service = STAGING_SERVICE,
  runtimeUrl = '',
  deploymentId = '',
  evidence = null,
  live = false,
  token = '',
  tokenKind = '',
  authKind = '',
  apiToken = '',
  projectToken = '',
  projectId = '',
  environmentId = '',
  serviceId = '',
  fetchImpl = globalThis.fetch,
  cliStatus = null,
  runCliStatus = null,
  readSource = 'auto',
  allowCliStatus = true,
} = {}) {
  const declaredEnvironment =
    typeof environment === 'string' && environment.trim() ? environment.trim() : STAGING_ENVIRONMENT;
  const declaredService =
    typeof service === 'string' && service.trim() ? service.trim() : STAGING_SERVICE;
  const normalizedReadSource = normalizeReadSource(readSource) ?? 'auto';
  const hasEvidenceValue = evidence !== null && evidence !== undefined && evidence !== '';

  if (hasEvidenceValue && (normalizedReadSource === 'auto' || normalizedReadSource === 'offline')) {
    const parsed = parseEvidenceValue(evidence);
    if (!parsed) {
      return withReadSource(
        failedBindingResult(
          { expectedSha, environment: declaredEnvironment },
          'METADATA_MALFORMED',
          'evidence JSON을 해석할 수 없습니다.',
        ),
        READ_SOURCE_OFFLINE,
        'offline-evidence-malformed',
        { service: declaredService },
      );
    }
    let deployment = null;
    if (Array.isArray(parsed.deployments)) {
      const selected = selectSingleDeployment(parsed.deployments, { expectedSha, deploymentId });
      if (!selected.deployment) {
        return withReadSource(
          failedBindingResult(
            { expectedSha, environment: declaredEnvironment },
            selected.failureCode,
            selected.message,
          ),
          READ_SOURCE_OFFLINE,
          'offline-deployments-selection-failed',
          { service: declaredService },
        );
      }
      deployment = selected.deployment;
    } else if (parsed.deployment && typeof parsed.deployment === 'object') {
      const normalized = normalizeDeploymentEvidence(parsed.deployment);
      if (!normalized.deployment) {
        return withReadSource(
          failedBindingResult(
            { expectedSha, environment: declaredEnvironment },
            normalized.failureCode,
            normalized.message,
          ),
          READ_SOURCE_OFFLINE,
          'offline-deployment-normalize-failed',
          { service: declaredService },
        );
      }
      deployment = normalized.deployment;
      if (deploymentId && deployment.id !== deploymentId) {
        return withReadSource(
          failedBindingResult(
            { expectedSha, environment: declaredEnvironment, deployment },
            'URL_REVISION_MISMATCH',
            '지정한 deployment revision이 evidence deployment와 다릅니다.',
          ),
          READ_SOURCE_OFFLINE,
          'offline-deployment-id-mismatch',
          { service: declaredService },
        );
      }
    } else {
      return withReadSource(
        failedBindingResult(
          { expectedSha, environment: declaredEnvironment },
          'METADATA_MALFORMED',
          'evidence에 deployment 또는 deployments 배열이 없습니다.',
        ),
        READ_SOURCE_OFFLINE,
        'offline-evidence-shape-unknown',
        { service: declaredService },
      );
    }
    const runtimeField =
      parsed.runtime && typeof parsed.runtime === 'object' && !Array.isArray(parsed.runtime)
        ? parsed.runtime
        : {};
    const effectiveRuntimeUrl = runtimeUrl || (typeof runtimeField.url === 'string' ? runtimeField.url : '');
    const offlineResult = evaluateRailwayRevisionBinding({
      expectedSha,
      environment: declaredEnvironment,
      deployment,
      runtime: {
        url: effectiveRuntimeUrl,
        deploymentId: pickBindingField(runtimeField, ['deploymentId', 'revisionId', 'boundDeploymentId']),
        serviceId: pickBindingField(runtimeField, ['serviceId']),
        environmentId: pickBindingField(runtimeField, ['environmentId']),
      },
      evidenceSource:
        typeof parsed.evidenceSource === 'string' && parsed.evidenceSource.trim()
          ? parsed.evidenceSource.trim()
          : READ_ONLY_EVIDENCE_SOURCE,
    });
    return withReadSource(offlineResult, READ_SOURCE_OFFLINE, 'offline-evidence', {
      service: declaredService,
    });
  }

  if (!live) {
    return withReadSource(
      failedBindingResult(
        { expectedSha, environment: declaredEnvironment, runtime: { url: runtimeUrl } },
        'READ_CAPABILITY_MISSING',
        'Railway read evidence가 없습니다. --evidence-json 또는 --live + 명시적 Railway credential이 필요합니다.',
      ),
      null,
      normalizedReadSource === 'offline'
        ? 'offline-without-evidence'
        : 'no-live-no-evidence',
      { service: declaredService },
    );
  }

  const selection = resolveRailwayReadSource({
    evidence: hasEvidenceValue ? evidence : null,
    live,
    apiToken,
    projectToken,
    token,
    cliStatus,
    runCliStatus,
    allowCliStatus,
    readSource: normalizedReadSource,
  });

  if (selection.source === READ_SOURCE_OFFLINE) {
    return withReadSource(
      failedBindingResult(
        { expectedSha, environment: declaredEnvironment, runtime: { url: runtimeUrl } },
        'METADATA_MALFORMED',
        'offline evidence를 해석할 수 없습니다.',
      ),
      READ_SOURCE_OFFLINE,
      selection.reason,
      { service: declaredService },
    );
  }

  if (selection.source === READ_SOURCE_CLI_STATUS) {
    return collectCliStatusBinding({
      expectedSha,
      declaredEnvironment,
      declaredService,
      runtimeUrl,
      deploymentId,
      cliStatus,
      runCliStatus,
      allowCliStatus,
      selectionReason: selection.reason,
    });
  }

  if (selection.source !== READ_SOURCE_GRAPHQL) {
    return withReadSource(
      failedBindingResult(
        { expectedSha, environment: declaredEnvironment, runtime: { url: runtimeUrl } },
        'READ_CAPABILITY_MISSING',
        'Railway read capability가 없습니다. 명시적 GraphQL credential 또는 authenticated Railway CLI status가 필요합니다.',
      ),
      null,
      selection.reason,
      { service: declaredService },
    );
  }

  let liveCredential;
  try {
    liveCredential = resolveRailwayAuthCredential({ token, tokenKind, authKind, apiToken, projectToken });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // token 값은 resolver 메시지에 포함되지 않는다. 그대로 전달해도 redaction이 유지된다.
    if (message.includes('RAILWAY_AUTH_AMBIGUOUS')) {
      return withReadSource(
        failedBindingResult(
          { expectedSha, environment: declaredEnvironment, runtime: { url: runtimeUrl } },
          'RAILWAY_AUTH_AMBIGUOUS',
          message,
        ),
        READ_SOURCE_GRAPHQL,
        selection.reason,
        { service: declaredService },
      );
    }
    return withReadSource(
      failedBindingResult(
        { expectedSha, environment: declaredEnvironment, runtime: { url: runtimeUrl } },
        'READ_CAPABILITY_MISSING',
        message,
      ),
      null,
      selection.reason,
      { service: declaredService },
    );
  }

  const liveAuthForQuery =
    liveCredential.kind === 'account'
      ? { apiToken: liveCredential.token }
      : { projectToken: liveCredential.token };

  const variables = {};
  if (projectId) variables.projectId = projectId;
  if (environmentId) variables.environmentId = environmentId;
  if (serviceId) variables.serviceId = serviceId;

  let deploymentData;
  try {
    deploymentData = await queryRailwayGraphQL({
      ...liveAuthForQuery,
      query: RAILWAY_STAGING_DEPLOYMENTS_QUERY,
      variables,
      fetchImpl,
    });
  } catch (error) {
    return withReadSource(
      failedBindingResult(
        { expectedSha, environment: declaredEnvironment, runtime: { url: runtimeUrl } },
        'RAILWAY_QUERY_FAILED',
        error instanceof Error ? error.message : String(error),
      ),
      READ_SOURCE_GRAPHQL,
      selection.reason,
      { service: declaredService },
    );
  }
  const extracted = extractDeploymentCandidates(deploymentData);
  if (!extracted.candidates) {
    return withReadSource(
      failedBindingResult(
        { expectedSha, environment: declaredEnvironment, runtime: { url: runtimeUrl } },
        extracted.failureCode,
        extracted.message,
      ),
      READ_SOURCE_GRAPHQL,
      selection.reason,
      { service: declaredService },
    );
  }
  const selected = selectSingleDeployment(extracted.candidates, { expectedSha, deploymentId });
  if (!selected.deployment) {
    return withReadSource(
      failedBindingResult(
        { expectedSha, environment: declaredEnvironment, runtime: { url: runtimeUrl } },
        selected.failureCode,
        selected.message,
      ),
      READ_SOURCE_GRAPHQL,
      selection.reason,
      { service: declaredService },
    );
  }

  let domainData;
  try {
    domainData = await queryRailwayGraphQL({
      ...liveAuthForQuery,
      query: RAILWAY_SERVICE_DOMAINS_QUERY,
      variables,
      fetchImpl,
    });
  } catch (error) {
    return withReadSource(
      failedBindingResult(
        {
          expectedSha,
          environment: declaredEnvironment,
          deployment: selected.deployment,
          runtime: { url: runtimeUrl },
        },
        'RAILWAY_QUERY_FAILED',
        error instanceof Error ? error.message : String(error),
      ),
      READ_SOURCE_GRAPHQL,
      selection.reason,
      { service: declaredService },
    );
  }
  const domains = extractDomainCandidates(domainData);
  if (!domains.candidates) {
    return withReadSource(
      failedBindingResult(
        {
          expectedSha,
          environment: declaredEnvironment,
          deployment: selected.deployment,
          runtime: { url: runtimeUrl },
        },
        domains.failureCode,
        domains.message,
      ),
      READ_SOURCE_GRAPHQL,
      selection.reason,
      { service: declaredService },
    );
  }
  const domainEntries = domains.candidates.map(normalizeDomainEntry).filter(Boolean);
  const inspected = inspectRuntimeUrl(runtimeUrl);
  const owned =
    !inspected.failureCode &&
    domainEntries.some((entry) => `https://${entry.domain}` === inspected.normalizedUrl);
  const result = evaluateRailwayRevisionBinding({
    expectedSha,
    environment: declaredEnvironment,
    deployment: selected.deployment,
    runtime: {
      url: runtimeUrl,
      deploymentId: selected.deployment.id,
      serviceId: selected.deployment.serviceId,
      environmentId: selected.deployment.environmentId,
    },
    evidenceSource: READ_ONLY_EVIDENCE_SOURCE,
  });
  if (result.ready && !owned) {
    result.failures.push({
      code: 'RUNTIME_URL_NOT_IN_SERVICE_DOMAINS',
      message: 'runtime URL이 조회된 Railway service domain 목록에 없습니다.',
    });
    result.failureCodes = result.failures.map(({ code }) => code);
    result.ready = false;
  }
  return withReadSource(result, READ_SOURCE_GRAPHQL, selection.reason, {
    service: declaredService,
  });
}

/**
 * CLI_STATUS live binding — `railway status --json` evidence를 canonical 판정으로 연결.
 * 실패 의미:
 *   RAILWAY_CLI_UNAVAILABLE  — executable 없음 등
 *   RAILWAY_CLI_READ_FAILED  — command 자체 실패 / 출력 해석 실패
 *   RAILWAY_EVIDENCE_INCOMPLETE — command 성공 but required binding field 부족
 *   DEPLOYMENT_SHA_MISMATCH (canonical RAILWAY_REVISION_MISMATCH) — expected SHA 불일치
 *   DEPLOYMENT_STATE_NOT_SUCCESS (canonical RAILWAY_DEPLOYMENT_NOT_READY) — 허용 상태 아님
 */
async function collectCliStatusBinding({
  expectedSha = '',
  declaredEnvironment = STAGING_ENVIRONMENT,
  declaredService = STAGING_SERVICE,
  runtimeUrl = '',
  deploymentId = '',
  cliStatus = null,
  runCliStatus = null,
  allowCliStatus = true,
  selectionReason = 'auto-usable-cli-status',
} = {}) {
  if (allowCliStatus === false) {
    return withReadSource(
      failedBindingResult(
        { expectedSha, environment: declaredEnvironment, runtime: { url: runtimeUrl } },
        'READ_CAPABILITY_MISSING',
        'Railway CLI status read가 비활성화되어 있습니다.',
      ),
      null,
      selectionReason,
      { service: declaredService },
    );
  }
  const hasCliStatusValue =
    cliStatus !== null && cliStatus !== undefined && cliStatus !== '';
  let cliJson = null;
  if (hasCliStatusValue) {
    cliJson = cliStatus;
  } else if (typeof runCliStatus === 'function') {
    try {
      cliJson = await runCliStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('RAILWAY_CLI_UNAVAILABLE')) {
        return withReadSource(
          failedBindingResult(
            { expectedSha, environment: declaredEnvironment, runtime: { url: runtimeUrl } },
            'RAILWAY_CLI_UNAVAILABLE',
            message,
          ),
          READ_SOURCE_CLI_STATUS,
          selectionReason,
          { service: declaredService },
        );
      }
      return withReadSource(
        failedBindingResult(
          { expectedSha, environment: declaredEnvironment, runtime: { url: runtimeUrl } },
          'RAILWAY_CLI_READ_FAILED',
          message,
        ),
        READ_SOURCE_CLI_STATUS,
        selectionReason,
        { service: declaredService },
      );
    }
  } else {
    return withReadSource(
      failedBindingResult(
        { expectedSha, environment: declaredEnvironment, runtime: { url: runtimeUrl } },
        'READ_CAPABILITY_MISSING',
        'Railway read capability가 없습니다. 명시적 GraphQL credential 또는 authenticated Railway CLI status가 필요합니다.',
      ),
      null,
      selectionReason,
      { service: declaredService },
    );
  }

  const normalized = normalizeCliStatusBinding(cliJson, {
    environment: declaredEnvironment,
    service: declaredService,
    runtimeUrl,
    deploymentId,
  });
  if (!normalized.deployment) {
    const code =
      normalized.failureCode === 'RAILWAY_CLI_READ_FAILED'
        ? 'RAILWAY_CLI_READ_FAILED'
        : normalized.failureCode === 'DEPLOYMENT_NOT_FOUND'
          ? 'DEPLOYMENT_NOT_FOUND'
          : 'RAILWAY_EVIDENCE_INCOMPLETE';
    return withReadSource(
      failedBindingResult(
        { expectedSha, environment: declaredEnvironment, runtime: { url: runtimeUrl } },
        code,
        normalized.message ?? 'Railway CLI evidence가 부족합니다.',
      ),
      code === 'DEPLOYMENT_NOT_FOUND' ? READ_SOURCE_CLI_STATUS : READ_SOURCE_CLI_STATUS,
      selectionReason,
      { service: declaredService },
    );
  }

  const result = evaluateRailwayRevisionBinding({
    expectedSha,
    environment: declaredEnvironment,
    deployment: normalized.deployment,
    runtime: normalized.runtime,
    evidenceSource: CLI_STATUS_EVIDENCE_SOURCE,
  });
  // CLI instance의 serviceDomains 소유 증명 — GraphQL live 경로의 owned 검사와 동일 의미.
  const inspected = inspectRuntimeUrl(runtimeUrl);
  const owned = Boolean(normalized.domain) && !inspected.failureCode;
  if (result.ready && !owned) {
    result.failures.push({
      code: 'RUNTIME_URL_NOT_IN_SERVICE_DOMAINS',
      message: 'runtime URL이 조회된 Railway service domain 목록에 없습니다.',
    });
    result.failureCodes = result.failures.map(({ code }) => code);
    result.ready = false;
  }
  return withReadSource(result, READ_SOURCE_CLI_STATUS, selectionReason, {
    service: normalized.serviceName ?? declaredService,
    serviceId: normalized.serviceId,
    environmentId: normalized.environmentId,
    targetPort: normalized.targetPort,
    domain: normalized.domain,
  });
}

export function normalizeBindingInput(argv = process.argv.slice(2), env = process.env) {
  const args = Array.isArray(argv) ? argv : [];
  const flagValue = (name) => {
    const prefix = `--${name}=`;
    const hit = args.find((item) => typeof item === 'string' && item.startsWith(prefix));
    return hit ? hit.slice(prefix.length).trim() : '';
  };
  const hasFlag = (name) => args.includes(`--${name}`);
  const source = env ?? {};
  const rawReadSource =
    flagValue('read-source') || String(source.RAILWAY_BINDING_READ_SOURCE ?? '').trim() || 'auto';
  return {
    expectedSha:
      flagValue('sha') ||
      String(source.RAILWAY_BINDING_EXPECTED_SHA ?? '').trim().toLowerCase() ||
      String(source.ROUND_DIRECT_E2E_EXPECTED_SHA ?? '').trim().toLowerCase(),
    environment:
      flagValue('environment') ||
      String(source.RAILWAY_BINDING_ENVIRONMENT ?? '').trim() ||
      STAGING_ENVIRONMENT,
    service:
      flagValue('service') ||
      String(source.RAILWAY_BINDING_SERVICE ?? '').trim() ||
      STAGING_SERVICE,
    runtimeUrl:
      flagValue('runtime-url') ||
      String(source.RAILWAY_BINDING_RUNTIME_URL ?? '').trim() ||
      String(source.ROUND_DIRECT_E2E_API_ORIGIN ?? '').trim(),
    deploymentId:
      flagValue('deployment-id') || String(source.RAILWAY_BINDING_DEPLOYMENT_ID ?? '').trim(),
    evidenceJsonPath:
      flagValue('evidence-json') || String(source.RAILWAY_BINDING_EVIDENCE_PATH ?? '').trim(),
    evidenceJsonInline: String(source.RAILWAY_BINDING_EVIDENCE_JSON ?? '').trim(),
    live: hasFlag('live'),
    help: hasFlag('help') || args.includes('-h'),
    projectId: flagValue('project-id') || String(source.RAILWAY_PROJECT_ID ?? '').trim(),
    environmentId: flagValue('environment-id') || String(source.RAILWAY_ENVIRONMENT_ID ?? '').trim(),
    serviceId: flagValue('service-id') || String(source.RAILWAY_SERVICE_ID ?? '').trim(),
    readSource: normalizeReadSource(rawReadSource) ?? 'auto',
    allowCliStatus: !hasFlag('no-cli-status'),
    // Explicit Railway auth contract — 아래 값은 요청 헤더에만 사용하고
    // stdout/오류 메시지에 절대 포함하지 않는다. 호출자는 이 객체를 로그로 출력하지 않는다.
    authKind:
      flagValue('auth-kind') ||
      String(source.RAILWAY_TOKEN_KIND ?? source.RAILWAY_AUTH_KIND ?? '').trim(),
    apiToken: String(source.RAILWAY_API_TOKEN ?? '').trim(),
    projectToken: String(source.RAILWAY_PROJECT_TOKEN ?? '').trim(),
    token: String(source.RAILWAY_TOKEN ?? '').trim(),
  };
}

function printHelp() {
  process.stderr.write(
    [
      'Railway staging exact-SHA runtime binding verifier (read-only, fail-closed)',
      '',
      '  node scripts/deploy/verify-railway-staging-binding.mjs --sha=<40hex> --environment=staging \\',
      '    --runtime-url=https://<staging>.up.railway.app --evidence-json=./evidence.json',
      '  node scripts/deploy/verify-railway-staging-binding.mjs --sha=<40hex> --live --auth-kind=account',
      '  node scripts/deploy/verify-railway-staging-binding.mjs --sha=<40hex> --live --auth-kind=project',
      '  node scripts/deploy/verify-railway-staging-binding.mjs --sha=<40hex> --live \\',
      '    --runtime-url=https://api-staging-94af.up.railway.app',
      '    (no GraphQL token → authenticated `railway status --json` CLI_STATUS)',
      '',
      'env: RAILWAY_BINDING_EXPECTED_SHA | ROUND_DIRECT_E2E_EXPECTED_SHA,',
      '     RAILWAY_BINDING_ENVIRONMENT, RAILWAY_BINDING_SERVICE,',
      '     RAILWAY_BINDING_RUNTIME_URL | ROUND_DIRECT_E2E_API_ORIGIN,',
      '     RAILWAY_BINDING_DEPLOYMENT_ID, RAILWAY_BINDING_EVIDENCE_JSON/PATH,',
      '     RAILWAY_BINDING_READ_SOURCE=auto|graphql|cli-status|offline,',
      '     RAILWAY_API_TOKEN (account → Authorization: Bearer),',
      '     RAILWAY_PROJECT_TOKEN (project → Project-Access-Token),',
      '     RAILWAY_TOKEN + RAILWAY_TOKEN_KIND=account|workspace|project (legacy 명시),',
      '     RAILWAY_PROJECT_ID/RAILWAY_ENVIRONMENT_ID/RAILWAY_SERVICE_ID for --live',
      '',
    ].join('\n'),
  );
}

async function main() {
  const input = normalizeBindingInput();
  if (input.help) {
    printHelp();
    process.exitCode = 2;
    return;
  }
  let evidence = input.evidenceJsonInline || null;
  if (!evidence && input.evidenceJsonPath) {
    try {
      evidence = fs.readFileSync(path.resolve(input.evidenceJsonPath), 'utf8');
    } catch {
      const result = failedBindingResult(
        { expectedSha: input.expectedSha, environment: input.environment },
        'METADATA_MALFORMED',
        `evidence 파일을 읽을 수 없습니다: ${input.evidenceJsonPath}`,
      );
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = 1;
      return;
    }
  }
  const source = process.env ?? {};
  // Library 기본값은 주입된 CLI capability만 사용해 deterministic하게 유지한다.
  // 실제 `railway status --json` 실행은 main() 진입점에서만 주입한다.
  const hasExplicitCredential = Boolean(
    String(source.RAILWAY_API_TOKEN ?? '').trim() ||
      String(source.RAILWAY_PROJECT_TOKEN ?? '').trim() ||
      String(source.RAILWAY_TOKEN ?? '').trim(),
  );
  const runCliStatus =
    input.live && !hasExplicitCredential && input.allowCliStatus
      ? () => readRailwayCliStatus()
      : null;
  const result = await collectRailwayBindingEvidence({
    expectedSha: input.expectedSha,
    environment: input.environment,
    service: input.service,
    runtimeUrl: input.runtimeUrl,
    deploymentId: input.deploymentId,
    evidence,
    live: input.live,
    token: String(source.RAILWAY_TOKEN ?? '').trim(),
    tokenKind: input.authKind || String(source.RAILWAY_TOKEN_KIND ?? source.RAILWAY_AUTH_KIND ?? '').trim(),
    authKind: input.authKind,
    apiToken: String(source.RAILWAY_API_TOKEN ?? '').trim(),
    projectToken: String(source.RAILWAY_PROJECT_TOKEN ?? '').trim(),
    projectId: input.projectId,
    environmentId: input.environmentId,
    serviceId: input.serviceId,
    readSource: input.readSource,
    allowCliStatus: input.allowCliStatus,
    runCliStatus,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ready ? 0 : 1;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(
      `[railway-staging-binding] 치명적 오류: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
