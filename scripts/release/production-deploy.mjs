#!/usr/bin/env node
/**
 * 운영 배포 실행기. `.github/workflows/production-deploy.yml`이 단계마다 부른다.
 * 사람이 채팅·콘솔에서 하던 "검증된 SHA → API → 프런트 3개" 배포를 같은 순서·같은 확인으로 자동화한다.
 *
 *   node scripts/release/production-deploy.mjs verify-e2e --sha=<40자리> --run-id=<E2E run ID>
 *   node scripts/release/production-deploy.mjs railway    --sha=<40자리>
 *   node scripts/release/production-deploy.mjs health     --sha=<40자리>
 *   node scripts/release/production-deploy.mjs vercel     --sha=<40자리> --app=consumer|seller|driver
 *
 * 자격 증명은 환경 변수로만 받고 출력하지 않는다.
 * - verify-e2e: GITHUB_TOKEN(actions:read)
 * - railway: RAILWAY_TOKEN(운영 환경 project token), RAILWAY_API_SERVICE_ID
 * - vercel: VERCEL_PRODUCTION_TOKEN(팀 범위)
 *
 * 각 명령은 JSON 한 줄을 출력하고, 실패하면 exit 1.
 */
import { fileURLToPath } from 'node:url';

import { PREVIEW_APPS, VERCEL_API_ORIGIN, VERCEL_TEAM_ID } from '../wait-preview-deploy.mjs';
import { PRODUCTION_TARGETS } from './post-deploy-smoke.mjs';

export const REPO_ORG = 'booker-lab';
export const REPO_NAME = 'greenhub';
export const E2E_WORKFLOW_PATH = '.github/workflows/e2e-round-direct.yml';
export const E2E_GATE_JOB_NAME = '비운영 E2E 승인 사전 검증';
export const RAILWAY_GRAPHQL_URL = 'https://backboard.railway.com/graphql/v2';
export const FRONTEND_APPS = Object.freeze(['consumer', 'seller', 'driver']);

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const POLL_INTERVAL_MS = 10_000;
const DEPLOY_TIMEOUT_MS = 25 * 60_000;
const HEALTH_TIMEOUT_MS = 5 * 60_000;

const RAILWAY_PENDING = new Set(['QUEUED', 'WAITING', 'INITIALIZING', 'BUILDING', 'DEPLOYING']);
const VERCEL_PENDING = new Set(['QUEUED', 'INITIALIZING', 'BUILDING']);

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function assertSha(value) {
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) {
    throw new Error('SHA는 40자리 소문자 16진수여야 합니다.');
  }
  return value;
}

function requireEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name}이(가) 없어 실행을 멈춥니다.`);
  return value;
}

async function readJson(res, label) {
  const text = await res.text();
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} 응답이 JSON이 아닙니다.`);
  }
}

/**
 * 같은 SHA로 원격 회차 E2E가 통과했는지 GitHub에서 직접 확인한다.
 * run의 workflow 파일·결과, 그리고 승인 사전 검증 로그의 `expected_sha=<sha>` 줄을 본다.
 */
export async function verifyE2eRun({ sha, runId, token, fetchImpl = fetch }) {
  assertSha(sha);
  if (!/^\d+$/.test(String(runId ?? ''))) throw new Error('E2E run ID는 숫자여야 합니다.');
  const api = `https://api.github.com/repos/${REPO_ORG}/${REPO_NAME}/actions`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const run = await readJson(await fetchImpl(`${api}/runs/${runId}`, { headers }), 'E2E run 조회');
  if (run.path !== E2E_WORKFLOW_PATH) {
    throw new Error(`run ${runId}은(는) 회차 E2E가 아닙니다(${run.path}).`);
  }
  if (run.status !== 'completed' || run.conclusion !== 'success') {
    throw new Error(`run ${runId}이(가) 통과하지 않았습니다(${run.status}/${run.conclusion}).`);
  }

  const { jobs = [] } = await readJson(
    await fetchImpl(`${api}/runs/${runId}/jobs?per_page=100`, { headers }),
    'E2E job 조회',
  );
  const gate = jobs.find((job) => job.name === E2E_GATE_JOB_NAME);
  if (!gate) throw new Error('E2E 승인 사전 검증 job을 찾지 못했습니다.');

  const logRes = await fetchImpl(`${api}/jobs/${gate.id}/logs`, { headers });
  if (!logRes.ok) throw new Error(`E2E 로그 조회 HTTP ${logRes.status}`);
  const log = await logRes.text();
  if (!new RegExp(`expected_sha=${sha}(\\s|$)`, 'm').test(log)) {
    throw new Error(`run ${runId}의 검증 대상 SHA가 ${sha}가 아닙니다.`);
  }
  return { runId: Number(runId), url: run.html_url ?? null, sha };
}

async function railwayQuery({ token, query, variables, fetchImpl }) {
  const res = await fetchImpl(RAILWAY_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Project-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const body = await readJson(res, 'Railway API');
  if (body.errors?.length) {
    throw new Error(`Railway API 오류: ${body.errors.map((e) => e.message).join('; ')}`);
  }
  return body.data;
}

/**
 * GitHub에 연결된 Railway 서비스를 지정 SHA로 배포하고 SUCCESS까지 기다린다.
 * 이 경로로 배포해야 RAILWAY_GIT_COMMIT_SHA가 채워져 `/health` commit으로 확인할 수 있다.
 */
export async function deployRailway({
  sha,
  token,
  serviceId,
  fetchImpl = fetch,
  sleep = defaultSleep,
  timeoutMs = DEPLOY_TIMEOUT_MS,
  intervalMs = POLL_INTERVAL_MS,
}) {
  assertSha(sha);
  const scope = await railwayQuery({
    token,
    fetchImpl,
    query: 'query { projectToken { projectId environmentId } }',
  });
  const environmentId = scope?.projectToken?.environmentId;
  if (!environmentId) throw new Error('Railway token에서 환경을 확인하지 못했습니다.');

  const created = await railwayQuery({
    token,
    fetchImpl,
    query:
      'mutation ($serviceId: String!, $environmentId: String!, $commitSha: String!) { serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId, commitSha: $commitSha) }',
    variables: { serviceId, environmentId, commitSha: sha },
  });
  const deploymentId = created?.serviceInstanceDeployV2;
  if (typeof deploymentId !== 'string' || !deploymentId) {
    throw new Error('Railway가 배포 ID를 돌려주지 않았습니다.');
  }

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const data = await railwayQuery({
      token,
      fetchImpl,
      query: 'query ($id: String!) { deployment(id: $id) { id status } }',
      variables: { id: deploymentId },
    });
    const status = data?.deployment?.status;
    if (status === 'SUCCESS') return { deploymentId, environmentId, status };
    if (!RAILWAY_PENDING.has(status)) {
      throw new Error(
        `Railway 배포 ${deploymentId}이(가) ${status ?? '알 수 없음'} 상태로 끝났습니다.`,
      );
    }
    if (Date.now() > deadline)
      throw new Error(`Railway 배포 ${deploymentId}이(가) 제한 시간 안에 끝나지 않았습니다.`);
    await sleep(intervalMs);
  }
}

/** 운영 API `/health`의 commit이 지정 SHA가 될 때까지 기다린다(이전 컨테이너가 잠시 응답할 수 있다). */
export async function waitHealthCommit({
  sha,
  apiBase = PRODUCTION_TARGETS.api,
  fetchImpl = fetch,
  sleep = defaultSleep,
  timeoutMs = HEALTH_TIMEOUT_MS,
  intervalMs = POLL_INTERVAL_MS,
}) {
  assertSha(sha);
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    try {
      const res = await fetchImpl(`${apiBase}/health`);
      if (res.ok) {
        const body = await res.json();
        last = body?.commit ?? null;
        if (body?.status === 'ok' && last === sha) return { commit: last };
      } else {
        last = `HTTP ${res.status}`;
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() > deadline)
      throw new Error(`운영 API가 ${sha}로 바뀌지 않았습니다(마지막 응답: ${last}).`);
    await sleep(intervalMs);
  }
}

export function buildVercelProductionBody({ app, sha }) {
  assertSha(sha);
  const config = PREVIEW_APPS.find((entry) => entry.app === app);
  if (!config) throw new Error(`알 수 없는 앱입니다: ${app}`);
  return {
    name: config.project,
    project: config.projectId,
    target: 'production',
    gitSource: { type: 'github', org: REPO_ORG, repo: REPO_NAME, ref: 'main', sha },
  };
}

/**
 * Vercel 운영 배포를 지정 SHA의 Git 원본으로 만들고 끝날 때까지 기다린다.
 * CANCELED는 앱 빌드 생략 규칙(`scripts/vercel/ignore-build.mjs`)이 "이 앱은 바뀐 것이 없다"고 판단한 경우라
 * 기존 운영 배포가 계속 서비스한다. 결과에 `skipped`로 남긴다.
 */
export async function deployVercel({
  app,
  sha,
  token,
  fetchImpl = fetch,
  sleep = defaultSleep,
  timeoutMs = DEPLOY_TIMEOUT_MS,
  intervalMs = POLL_INTERVAL_MS,
}) {
  const body = buildVercelProductionBody({ app, sha });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const createQuery = new URLSearchParams({
    teamId: VERCEL_TEAM_ID,
    forceNew: '1',
    skipAutoDetectionConfirmation: '1',
  });
  const created = await readJson(
    await fetchImpl(`${VERCEL_API_ORIGIN}/v13/deployments?${createQuery}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    `Vercel ${app} 배포 생성`,
  );
  const deploymentId = created.id;
  if (!/^dpl_[A-Za-z0-9]+$/.test(deploymentId ?? '')) {
    throw new Error(`Vercel ${app} 배포 ID를 받지 못했습니다.`);
  }

  const readQuery = new URLSearchParams({ teamId: VERCEL_TEAM_ID });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const deployment = await readJson(
      await fetchImpl(`${VERCEL_API_ORIGIN}/v13/deployments/${deploymentId}?${readQuery}`, {
        headers,
      }),
      `Vercel ${app} 배포 조회`,
    );
    const state = deployment.readyState ?? deployment.status;
    if (state === 'READY') {
      if (deployment.target !== 'production') {
        throw new Error(`Vercel ${app} 배포가 운영 대상이 아닙니다(${deployment.target}).`);
      }
      const gitSha = deployment.meta?.githubCommitSha ?? deployment.gitSource?.sha ?? null;
      if (gitSha !== sha) throw new Error(`Vercel ${app} 배포 SHA 불일치: ${gitSha}`);
      return { app, status: 'deployed', deploymentId, url: deployment.url ?? null };
    }
    if (state === 'CANCELED')
      return { app, status: 'skipped', deploymentId, reason: '앱 변경 없음(빌드 생략)' };
    if (!VERCEL_PENDING.has(state)) {
      throw new Error(
        `Vercel ${app} 배포 ${deploymentId}이(가) ${state ?? '알 수 없음'} 상태로 끝났습니다.`,
      );
    }
    if (Date.now() > deadline)
      throw new Error(`Vercel ${app} 배포가 제한 시간 안에 끝나지 않았습니다.`);
    await sleep(intervalMs);
  }
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (const arg of rest) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match) throw new Error(`알 수 없는 인자: ${arg}`);
    options[match[1]] = match[2];
  }
  return { command, options };
}

export async function main(
  argv,
  { env = process.env, fetchImpl = fetch, sleep = defaultSleep } = {},
) {
  const { command, options } = parseArgs(argv);
  const sha = assertSha(options.sha);
  switch (command) {
    case 'verify-e2e':
      return verifyE2eRun({
        sha,
        runId: options['run-id'],
        token: requireEnv(env, 'GITHUB_TOKEN'),
        fetchImpl,
      });
    case 'railway':
      return deployRailway({
        sha,
        token: requireEnv(env, 'RAILWAY_TOKEN'),
        serviceId: requireEnv(env, 'RAILWAY_API_SERVICE_ID'),
        fetchImpl,
        sleep,
      });
    case 'health':
      return waitHealthCommit({ sha, fetchImpl, sleep });
    case 'vercel':
      if (!FRONTEND_APPS.includes(options.app))
        throw new Error('--app은 consumer|seller|driver 중 하나여야 합니다.');
      return deployVercel({
        app: options.app,
        sha,
        token: requireEnv(env, 'VERCEL_PRODUCTION_TOKEN'),
        fetchImpl,
        sleep,
      });
    default:
      throw new Error('명령은 verify-e2e|railway|health|vercel 중 하나여야 합니다.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const result = await main(process.argv.slice(2));
    console.log(JSON.stringify({ ok: true, ...result }));
  } catch (error) {
    console.error(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
    process.exit(1);
  }
}
