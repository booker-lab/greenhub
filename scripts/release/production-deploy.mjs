#!/usr/bin/env node
/**
 * 운영 배포 실행기. `.github/workflows/production-deploy.yml`이 단계마다 부른다.
 * 사람이 채팅·콘솔에서 하던 "검증된 SHA → API → 프런트 3개" 배포를 같은 순서·같은 확인으로 자동화한다.
 *
 *   node scripts/release/production-deploy.mjs verify-e2e --sha=<40자리> --run-id=<E2E run ID>
 *   node scripts/release/production-deploy.mjs railway    --sha=<40자리>
 *   node scripts/release/production-deploy.mjs cloudrun   --sha=<40자리> --api-base=<운영 API 주소>
 *   node scripts/release/production-deploy.mjs health     --sha=<40자리> [--api-base=<운영 API 주소>]
 *   node scripts/release/production-deploy.mjs vercel     --sha=<40자리> --app=consumer|seller|driver [--require-build=true]
 *
 * `--require-build=true`는 환경 변수만 바꾸고 같은 SHA로 다시 배포할 때 쓴다. 앱 빌드 생략 규칙을 건너뛰어
 * (`skipIgnoreBuildStep=1`) 반드시 새로 빌드하고, 그래도 생략되면 실패한다. 없으면 생략 규칙을 따른다.
 *
 * 자격 증명은 환경 변수로만 받고 출력하지 않는다.
 * - verify-e2e: GITHUB_TOKEN(actions:read)
 * - railway: RAILWAY_TOKEN(운영 환경 project token), RAILWAY_API_SERVICE_ID
 * - cloudrun: gcloud가 이미 인증돼 있어야 한다(workflow는 Workload Identity Federation, 키 파일 없음).
 * - vercel: VERCEL_PRODUCTION_TOKEN(팀 범위)
 *
 * 각 명령은 JSON 한 줄을 출력하고, 실패하면 exit 1.
 */
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { PREVIEW_APPS, VERCEL_API_ORIGIN, VERCEL_TEAM_ID } from '../wait-preview-deploy.mjs';
import {
  CLOUD_RUN_PRODUCTION,
  CLOUD_RUN_PRODUCTION_API_HOST,
  isProductionApiHost,
} from './api-hosts.mjs';
import { PRODUCTION_TARGETS } from './post-deploy-smoke.mjs';

export const REPO_ORG = 'booker-lab';
export const REPO_NAME = 'greenhub';
export const E2E_WORKFLOW_PATH = '.github/workflows/e2e-round-direct.yml';
export const E2E_GATE_JOB_NAME = '비운영 E2E 승인 사전 검증';
/** 통과 증거로 받는 E2E run은 main에서 수동 실행(workflow_dispatch)한 것뿐이다. */
export const E2E_REQUIRED_BRANCH = 'main';
export const E2E_REQUIRED_EVENT = 'workflow_dispatch';
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
 * run의 workflow 파일·실행 브랜치(main)·이벤트(workflow_dispatch)·결과, 그리고 승인 사전 검증 로그의
 * `expected_sha=<sha>` 줄을 본다. 다른 브랜치에서 실행한 run은 그 브랜치의 workflow 파일로 돌았으므로 받지 않는다.
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
  if (run.head_branch !== E2E_REQUIRED_BRANCH || run.event !== E2E_REQUIRED_EVENT) {
    throw new Error(
      `run ${runId}은(는) main에서 수동 실행한 회차 E2E가 아닙니다(${run.event}/${run.head_branch}).`,
    );
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

const execFileAsync = promisify(execFile);

/** gcloud를 셸 없이 실행하고 표준 출력을 돌려준다. 인자는 배열로만 넘긴다. */
export async function runGcloud(args) {
  const { stdout } = await execFileAsync('gcloud', args, { maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

function cloudRunScope(target) {
  return [`--project=${target.project}`, `--region=${target.region}`];
}

async function describeCloudRunService(gcloud, target) {
  return JSON.parse(
    await gcloud([
      'run',
      'services',
      'describe',
      target.service,
      ...cloudRunScope(target),
      '--format=json',
    ]),
  );
}

/** 리비전의 Ready 조건을 읽는다. 아직 정해지지 않았으면 status는 'Unknown'이거나 없다. */
async function readRevisionReady(gcloud, target, revision) {
  const described = JSON.parse(
    await gcloud([
      'run',
      'revisions',
      'describe',
      revision,
      ...cloudRunScope(target),
      '--format=json',
    ]),
  );
  return (described?.status?.conditions ?? []).find((condition) => condition?.type === 'Ready');
}

/** 새 리비전이 Ready(True)가 될 때까지 기다리고, False(시작 검사 실패)나 시간 초과면 실패한다. */
export async function waitRevisionReady({
  gcloud,
  target,
  revision,
  sleep = defaultSleep,
  timeoutMs = HEALTH_TIMEOUT_MS,
  intervalMs = POLL_INTERVAL_MS,
}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ready = await readRevisionReady(gcloud, target, revision);
    if (ready?.status === 'True') return;
    if (ready?.status === 'False') {
      throw new Error(
        `새 리비전 ${revision}이(가) Ready가 아닙니다(시작 검사 실패: ${ready.message ?? ready.reason ?? '사유 없음'}).`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(`새 리비전 ${revision}이(가) 제한 시간 안에 Ready가 되지 않았습니다.`);
    }
    await sleep(intervalMs);
  }
}

async function routeAllTraffic(gcloud, target, revision) {
  await gcloud([
    'run',
    'services',
    'update-traffic',
    target.service,
    ...cloudRunScope(target),
    `--to-revisions=${revision}=100`,
    '--quiet',
  ]);
}

/**
 * 지정 SHA 이미지를 운영 Cloud Run에 배포한다. 이미지는 workflow가 `<저장소>:<SHA>`로 먼저 올려 둔다.
 * 1. 태그가 가리키는 이미지 digest를 확인해 digest로 고정한다(태그가 나중에 바뀌어도 같은 이미지).
 * 2. 지금 트래픽을 받는 리비전을 기억해 둔다(되돌릴 곳).
 * 3. 새 리비전을 트래픽 없이 배포한다. 서비스의 시작 검사(`/health`, Firestore 한 건 읽기)를 통과해야
 *    Ready가 되고, 실패하면 배포 명령이 실패해 트래픽은 이전 리비전에 그대로 있다. GREENHUB_COMMIT_SHA는
 *    이 리비전에만 넣고, 다른 설정(대수·CPU 상시·비밀값·서비스 계정·네트워크)은 서비스 설정을 이어받는다.
 * 4. 새 리비전의 Ready 조건이 정해질 때까지 기다린 뒤(True면 계속, False면 실패) 트래픽 100%를 옮긴다.
 * 5. 공개 주소의 `/health` commit이 SHA가 될 때까지 기다린다. 끝내 아니면 이전 리비전으로 되돌린다.
 * 새 리비전을 태그 주소로 먼저 확인하지 않는 것은, 전환 뒤 run.app 직접 접속을 막으면(부하분산기만 허용)
 * 태그 주소에 닿을 수 없기 때문이다.
 */
export async function deployCloudRun({
  sha,
  apiBase = `https://${CLOUD_RUN_PRODUCTION_API_HOST}`,
  target = CLOUD_RUN_PRODUCTION,
  gcloud = runGcloud,
  fetchImpl = fetch,
  sleep = defaultSleep,
  healthTimeoutMs = HEALTH_TIMEOUT_MS,
  readyTimeoutMs = HEALTH_TIMEOUT_MS,
  intervalMs = POLL_INTERVAL_MS,
}) {
  assertSha(sha);
  const digest = (
    await gcloud([
      'artifacts',
      'docker',
      'images',
      'describe',
      `${target.imageRepository}:${sha}`,
      '--format=value(image_summary.digest)',
    ])
  ).trim();
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new Error(`이미지 ${target.imageRepository}:${sha}의 digest를 확인하지 못했습니다.`);
  }
  const image = `${target.imageRepository}@${digest}`;

  const before = await describeCloudRunService(gcloud, target);
  const previous =
    (before?.status?.traffic ?? []).find((entry) => entry?.percent === 100)?.revisionName ?? null;

  await gcloud([
    'run',
    'deploy',
    target.service,
    ...cloudRunScope(target),
    `--image=${image}`,
    '--no-traffic',
    `--update-env-vars=GREENHUB_COMMIT_SHA=${sha}`,
    '--quiet',
  ]);

  const after = await describeCloudRunService(gcloud, target);
  const revision = after?.status?.latestCreatedRevisionName;
  if (!revision || revision === previous) {
    throw new Error('Cloud Run이 새 리비전을 만들지 않았습니다.');
  }
  // --no-traffic 배포는 새 리비전이 Ready가 되기 전에 끝날 수 있다. 리비전의 Ready 조건이
  // True(통과)나 False(시작 검사 실패)로 정해질 때까지 기다린다.
  await waitRevisionReady({
    gcloud,
    target,
    revision,
    sleep,
    timeoutMs: readyTimeoutMs,
    intervalMs,
  });

  await routeAllTraffic(gcloud, target, revision);
  try {
    await waitHealthCommit({
      sha,
      apiBase,
      fetchImpl,
      sleep,
      timeoutMs: healthTimeoutMs,
      intervalMs,
    });
  } catch (error) {
    if (!previous) throw error;
    await routeAllTraffic(gcloud, target, previous);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} 트래픽을 이전 리비전 ${previous}(으)로 되돌렸습니다.`,
    );
  }
  return { service: target.service, revision, previous, image };
}

/** `health --api-base`로 받을 수 있는 운영 API 주소. 운영 호스트 정본 밖의 주소는 받지 않는다. */
export function resolveProductionApiBase(value) {
  if (value === undefined || value === '') return PRODUCTION_TARGETS.api;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('--api-base가 URL이 아닙니다.');
  }
  if (url.protocol !== 'https:' || url.origin !== value || !isProductionApiHost(url.hostname)) {
    throw new Error(
      `--api-base는 운영 API origin이어야 합니다(예: https://${CLOUD_RUN_PRODUCTION_API_HOST}).`,
    );
  }
  return url.origin;
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
 * `requireBuild`면 생성 요청에 `skipIgnoreBuildStep=1`을 붙여 생략 규칙을 건너뛰고 반드시 새로 빌드한다.
 */
export async function deployVercel({
  app,
  sha,
  token,
  requireBuild = false,
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
  // 환경 변수만 바꾼 같은 SHA 재배포는 빌드 생략 규칙을 건너뛰어야 새 값이 빌드에 들어간다.
  // 대시보드 Redeploy에서 생략 규칙 체크를 끄는 것과 같은 쿼리다(2026-10-29 Preview 실측).
  if (requireBuild) createQuery.set('skipIgnoreBuildStep', '1');
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
    if (state === 'CANCELED') {
      // 환경 변수만 바꾸고 같은 SHA로 다시 배포할 때는 생략되면 새 값이 반영되지 않으므로 성공으로 보지 않는다.
      if (requireBuild) {
        throw new Error(
          `Vercel ${app} 빌드가 생략됐습니다(${deploymentId}). --require-build는 새 빌드가 필요해 실패로 봅니다.`,
        );
      }
      return { app, status: 'skipped', deploymentId, reason: '앱 변경 없음(빌드 생략)' };
    }
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
  { env = process.env, fetchImpl = fetch, sleep = defaultSleep, gcloud = runGcloud } = {},
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
    case 'cloudrun':
      // 확인 주소는 workflow의 CLOUD_RUN_API_BASE 하나만 정한다. 기본값을 두면 전환 뒤(run.app 직접 접속 차단)
      // 빠뜨렸을 때 run.app을 확인하다 정상 배포를 되돌리므로, 빠지면 배포 전에 멈춘다.
      if (!options['api-base']) {
        throw new Error('cloudrun은 --api-base가 필요합니다(workflow의 CLOUD_RUN_API_BASE).');
      }
      return deployCloudRun({
        sha,
        apiBase: resolveProductionApiBase(options['api-base']),
        gcloud,
        fetchImpl,
        sleep,
      });
    case 'health':
      return waitHealthCommit({
        sha,
        apiBase: resolveProductionApiBase(options['api-base']),
        fetchImpl,
        sleep,
      });
    case 'vercel':
      if (!FRONTEND_APPS.includes(options.app))
        throw new Error('--app은 consumer|seller|driver 중 하나여야 합니다.');
      return deployVercel({
        app: options.app,
        sha,
        token: requireEnv(env, 'VERCEL_PRODUCTION_TOKEN'),
        requireBuild: options['require-build'] === 'true',
        fetchImpl,
        sleep,
      });
    default:
      throw new Error('명령은 verify-e2e|railway|cloudrun|health|vercel 중 하나여야 합니다.');
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
