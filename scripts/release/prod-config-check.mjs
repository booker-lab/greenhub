#!/usr/bin/env node
/**
 * 운영 설정 점검(읽기 전용). `.github/workflows/prod-config-check.yml`이 부른다.
 * 운영 Railway API 서비스와 consumer Vercel production 환경 변수를 읽어 불변식만 판정하고,
 * 값은 어디에도 출력하지 않는다(PASS/FAIL/UNKNOWN과 boolean 요약만 출력).
 *
 *   node scripts/release/prod-config-check.mjs
 *
 * 자격 증명은 환경 변수로만 받는다(production-deploy.mjs와 같은 이름).
 * - RAILWAY_TOKEN: 운영 환경 project token, RAILWAY_API_SERVICE_ID: API 서비스 ID
 * - VERCEL_PRODUCTION_TOKEN: 팀 범위 token
 *
 * 쓰는 API(모두 조회):
 * - Railway GraphQL `projectToken { projectId environmentId }` → `variables(projectId, environmentId, serviceId)`
 * - Vercel `GET /v10/projects/{consumer}/env` → production 대상 항목마다 `GET /v1/projects/{consumer}/env/{id}`
 *
 * GitHub Actions 안에서는 읽은 비밀값을 다른 출력보다 먼저 `::add-mask::`로 등록한다.
 * GITHUB_STEP_SUMMARY가 있으면 판정 결과(값 없음)만 덧붙인다.
 * FAIL이 하나라도 있으면 exit 1. UNKNOWN(예: sensitive 변수라 비교 불가)은 실패로 보지 않는다.
 */
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PREVIEW_APPS, VERCEL_API_ORIGIN, VERCEL_TEAM_ID } from '../wait-preview-deploy.mjs';
import { RAILWAY_GRAPHQL_URL } from './production-deploy.mjs';

export const PASS = 'PASS';
export const FAIL = 'FAIL';
export const UNKNOWN = 'UNKNOWN';

export const MIN_JWT_SECRET_BYTES = 32;
export const CONSUMER_STORE_ID_KEY = 'NEXT_PUBLIC_PORTONE_STORE_ID';

/** 값을 읽어 판정하는 Railway 변수. 읽는 즉시 마스킹한다. */
export const RAILWAY_CHECKED_KEYS = Object.freeze([
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'PORTONE_STORE_ID',
  'PORTONE_WEBHOOK_SECRET',
  'GOOGLE_GEMINI_BASE_URL',
]);

/** 출력 순서이자 점검 목록. */
export const CHECK_NAMES = Object.freeze([
  'railway_variables_read',
  'jwt_secret_set',
  'jwt_refresh_secret_set',
  'jwt_secrets_distinct',
  'jwt_secret_min_32_bytes',
  'jwt_refresh_secret_min_32_bytes',
  'portone_store_id_set',
  'portone_webhook_secret_set',
  'google_gemini_base_url_absent',
  'vercel_consumer_env_read',
  'consumer_portone_store_id_set',
  'portone_store_id_matches_consumer',
]);

const REQUEST_TIMEOUT_MS = 15_000;

const CONSUMER = PREVIEW_APPS.find((entry) => entry.app === 'consumer');

/** 응답 본문은 비밀값을 담을 수 있어 오류 메시지에 넣지 않는다. */
class CheckError extends Error {}

function isSet(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function escapeCommandData(value) {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

/**
 * GitHub Actions 마스킹 명령을 만든다. 여러 줄 값은 줄마다 따로 등록해 일부 줄만 찍혀도 가린다.
 * Actions 밖에서는 명령 자체가 값을 그대로 출력하게 되므로 호출하지 않는다.
 */
export function maskCommands(value) {
  if (typeof value !== 'string' || value === '') return [];
  const parts = new Set([value, ...value.split(/\r?\n/)]);
  return [...parts]
    .filter((part) => part.trim() !== '')
    .map((part) => `::add-mask::${escapeCommandData(part)}`);
}

export function createMasker({ enabled, write }) {
  return (value) => {
    if (!enabled) return;
    for (const line of maskCommands(value)) write(`${line}\n`);
  };
}

async function request(fetchImpl, url, init, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch {
    throw new CheckError(`${label} 요청 실패`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new CheckError(`${label} HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new CheckError(`${label} 응답이 JSON이 아닙니다.`);
  }
}

async function railwayQuery({ token, query, variables, fetchImpl, label }) {
  const body = await request(
    fetchImpl,
    RAILWAY_GRAPHQL_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Project-Access-Token': token },
      body: JSON.stringify({ query, variables }),
    },
    label,
  );
  if (Array.isArray(body?.errors) && body.errors.length > 0) {
    throw new CheckError(`${label} GraphQL 오류 ${body.errors.length}건`);
  }
  return body?.data;
}

/**
 * Railway API 서비스의 운영 환경 변수 중 점검 대상만 읽는다.
 * project token이 가리키는 프로젝트·환경을 먼저 확인한다(production-deploy.mjs와 같은 방식).
 */
export async function readRailwayVariables({ token, serviceId, fetchImpl = fetch, mask }) {
  const scope = await railwayQuery({
    token,
    fetchImpl,
    label: 'Railway 환경 확인',
    query: 'query { projectToken { projectId environmentId } }',
  });
  const projectId = scope?.projectToken?.projectId;
  const environmentId = scope?.projectToken?.environmentId;
  if (!projectId || !environmentId) {
    throw new CheckError('Railway token에서 프로젝트·환경을 확인하지 못했습니다.');
  }
  const data = await railwayQuery({
    token,
    fetchImpl,
    label: 'Railway 변수 조회',
    query:
      'query ($projectId: String!, $environmentId: String!, $serviceId: String!) { variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) }',
    variables: { projectId, environmentId, serviceId },
  });
  const all = data?.variables;
  if (!all || typeof all !== 'object' || Array.isArray(all)) {
    throw new CheckError('Railway 변수 응답 형식이 올바르지 않습니다.');
  }
  const picked = {};
  for (const key of RAILWAY_CHECKED_KEYS) {
    const value = all[key];
    if (typeof value === 'string') {
      mask(value);
      picked[key] = value;
    } else if (value !== undefined && value !== null) {
      // 문자열이 아닌 값도 존재로 본다. 값 자체는 쓰지 않는다.
      picked[key] = String(value);
      mask(picked[key]);
    }
  }
  return picked;
}

function targetsProduction(env) {
  const target = env?.target;
  if (Array.isArray(target)) return target.includes('production');
  return target === 'production';
}

/**
 * consumer Vercel 프로젝트의 production `NEXT_PUBLIC_PORTONE_STORE_ID`를 읽는다.
 * 목록에서 production 대상 항목을 고르고 항목마다 복호화 조회를 한다.
 * sensitive 변수는 값을 돌려주지 않으므로 `sensitive: true`로만 표시한다.
 * 결과: { entries: [{ value?: string, sensitive: boolean }] }
 */
export async function readConsumerStoreId({ token, fetchImpl = fetch, mask }) {
  const headers = { Authorization: `Bearer ${token}` };
  const query = new URLSearchParams({ teamId: VERCEL_TEAM_ID });
  const project = encodeURIComponent(CONSUMER.projectId);
  const list = await request(
    fetchImpl,
    `${VERCEL_API_ORIGIN}/v10/projects/${project}/env?${query}`,
    { headers },
    'Vercel consumer 환경 변수 목록',
  );
  const envs = Array.isArray(list) ? list : Array.isArray(list?.envs) ? list.envs : null;
  if (!envs) throw new CheckError('Vercel 환경 변수 목록 형식이 올바르지 않습니다.');

  const candidates = envs.filter(
    (env) => env?.key === CONSUMER_STORE_ID_KEY && targetsProduction(env) && !env.gitBranch,
  );
  const entries = [];
  for (const env of candidates) {
    if (env.type === 'sensitive') {
      entries.push({ sensitive: true });
      continue;
    }
    if (typeof env.id !== 'string' || env.id === '') {
      throw new CheckError('Vercel 환경 변수 ID가 없습니다.');
    }
    const detail = await request(
      fetchImpl,
      `${VERCEL_API_ORIGIN}/v1/projects/${project}/env/${encodeURIComponent(env.id)}?${query}`,
      { headers },
      'Vercel consumer 환경 변수 조회',
    );
    if (detail?.type === 'sensitive' || detail?.decrypted === false) {
      entries.push({ sensitive: true });
      continue;
    }
    if (typeof detail?.value !== 'string') {
      throw new CheckError('Vercel 환경 변수 값 형식이 올바르지 않습니다.');
    }
    mask(detail.value);
    entries.push({ value: detail.value, sensitive: false });
  }
  return { entries };
}

function check(status, note) {
  return note ? { status, note } : { status };
}

/**
 * 읽은 값으로 점검 결과를 만든다. 결과에는 값이 들어가지 않는다.
 * railway/vercel이 null이면 해당 조회가 실패한 것이다.
 */
export function evaluate({ railway, vercel }) {
  const checks = {};
  const railwayOk = railway !== null && railway !== undefined;
  const vercelOk = vercel !== null && vercel !== undefined;

  checks.railway_variables_read = check(railwayOk ? PASS : FAIL);
  if (railwayOk) {
    const jwt = railway.JWT_SECRET;
    const refresh = railway.JWT_REFRESH_SECRET;
    const jwtSet = isSet(jwt);
    const refreshSet = isSet(refresh);
    checks.jwt_secret_set = check(jwtSet ? PASS : FAIL);
    checks.jwt_refresh_secret_set = check(refreshSet ? PASS : FAIL);
    checks.jwt_secrets_distinct =
      jwtSet && refreshSet ? check(jwt !== refresh ? PASS : FAIL) : check(UNKNOWN, '값 없음');
    checks.jwt_secret_min_32_bytes = jwtSet
      ? check(Buffer.byteLength(jwt, 'utf8') >= MIN_JWT_SECRET_BYTES ? PASS : FAIL)
      : check(UNKNOWN, '값 없음');
    checks.jwt_refresh_secret_min_32_bytes = refreshSet
      ? check(Buffer.byteLength(refresh, 'utf8') >= MIN_JWT_SECRET_BYTES ? PASS : FAIL)
      : check(UNKNOWN, '값 없음');
    checks.portone_store_id_set = check(isSet(railway.PORTONE_STORE_ID) ? PASS : FAIL);
    checks.portone_webhook_secret_set = check(isSet(railway.PORTONE_WEBHOOK_SECRET) ? PASS : FAIL);
    checks.google_gemini_base_url_absent = check(
      Object.hasOwn(railway, 'GOOGLE_GEMINI_BASE_URL') ? FAIL : PASS,
    );
  } else {
    for (const name of [
      'jwt_secret_set',
      'jwt_refresh_secret_set',
      'jwt_secrets_distinct',
      'jwt_secret_min_32_bytes',
      'jwt_refresh_secret_min_32_bytes',
      'portone_store_id_set',
      'portone_webhook_secret_set',
      'google_gemini_base_url_absent',
    ]) {
      checks[name] = check(UNKNOWN, 'Railway 조회 실패');
    }
  }

  checks.vercel_consumer_env_read = check(vercelOk ? PASS : FAIL);
  const entries = vercelOk ? vercel.entries : [];
  const consumerSet =
    vercelOk &&
    entries.length > 0 &&
    entries.every((entry) => entry.sensitive || isSet(entry.value));
  checks.consumer_portone_store_id_set = vercelOk
    ? check(consumerSet ? PASS : FAIL)
    : check(UNKNOWN, 'Vercel 조회 실패');

  const railwayStoreId = railwayOk ? railway.PORTONE_STORE_ID : undefined;
  if (!railwayOk || !vercelOk) {
    checks.portone_store_id_matches_consumer = check(UNKNOWN, '조회 실패');
  } else if (!isSet(railwayStoreId) || !consumerSet) {
    checks.portone_store_id_matches_consumer = check(UNKNOWN, '값 없음');
  } else if (entries.some((entry) => entry.sensitive)) {
    checks.portone_store_id_matches_consumer = check(UNKNOWN, 'cannot compare (sensitive)');
  } else {
    checks.portone_store_id_matches_consumer = check(
      entries.every((entry) => entry.value === railwayStoreId) ? PASS : FAIL,
    );
  }
  return checks;
}

export function summarize(checks) {
  const booleans = {};
  for (const name of CHECK_NAMES) {
    const status = checks[name]?.status;
    booleans[name] = status === PASS ? true : status === FAIL ? false : null;
  }
  const ok = CHECK_NAMES.every((name) => checks[name]?.status !== FAIL);
  return { ok, checks: booleans };
}

export function formatReport(checks, errors = []) {
  const width = Math.max(...CHECK_NAMES.map((name) => name.length));
  const lines = CHECK_NAMES.map((name) => {
    const { status, note } = checks[name] ?? { status: UNKNOWN };
    return `${`${name}:`.padEnd(width + 1)} ${status}${note ? ` - ${note}` : ''}`;
  });
  for (const error of errors) lines.push(`error: ${error}`);
  lines.push(JSON.stringify(summarize(checks)));
  return `${lines.join('\n')}\n`;
}

function errorMessage(error) {
  // 직접 만든 오류만 메시지를 그대로 쓴다. 그 밖의 오류는 종류만 남긴다.
  if (error instanceof CheckError) return error.message;
  return error instanceof Error ? `${error.name}` : '알 수 없는 오류';
}

function defaultAppendSummary(env) {
  const file = env.GITHUB_STEP_SUMMARY;
  return file ? (text) => appendFileSync(file, text) : () => {};
}

export async function run({
  env = process.env,
  fetchImpl = fetch,
  write = (text) => process.stdout.write(text),
  appendSummary = defaultAppendSummary(env),
} = {}) {
  const mask = createMasker({ enabled: env.GITHUB_ACTIONS === 'true', write });
  const errors = [];

  let railway = null;
  const railwayToken = env.RAILWAY_TOKEN?.trim();
  const serviceId = env.RAILWAY_API_SERVICE_ID?.trim();
  if (!railwayToken || !serviceId) {
    errors.push('RAILWAY_TOKEN 또는 RAILWAY_API_SERVICE_ID가 없습니다.');
  } else {
    try {
      railway = await readRailwayVariables({ token: railwayToken, serviceId, fetchImpl, mask });
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }

  let vercel = null;
  const vercelToken = env.VERCEL_PRODUCTION_TOKEN?.trim();
  if (!vercelToken) {
    errors.push('VERCEL_PRODUCTION_TOKEN이 없습니다.');
  } else {
    try {
      vercel = await readConsumerStoreId({ token: vercelToken, fetchImpl, mask });
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }

  const checks = evaluate({ railway, vercel });
  const report = formatReport(checks, errors);
  write(report);
  // Step summary에는 마스킹 명령 없이 판정 결과만 남긴다.
  appendSummary(`## 운영 설정 점검\n\n\`\`\`\n${report}\`\`\`\n`);
  return summarize(checks);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const summary = await run();
  process.exit(summary.ok ? 0 : 1);
}
