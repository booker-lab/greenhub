/**
 * Preview 배포 완료 대기 게이트 — sync-preview.yml 의 E2E 트리거 직전에 호출.
 *
 * sync-preview 가 success 로 떨어져도 Vercel 의 실제 Preview 재배포는 더 늦게
 * 끝날 수 있다. 그 사이 E2E 를 dispatch 하면 stale(이전 커밋) 배포본을 검사한다.
 * 이 스크립트는 GitHub 에 기록된 Vercel commit status가 현재 Preview HEAD를
 * 가리키며 성공할 때까지 폴링해 그 race 를 트리거 단계에서 차단한다.
 *
 * 매칭 기준 = SHA와 정확한 status context. GitHub commit status API 요청 자체가
 * expected SHA에 고정되며, 각 status의 context와 state, 안전한 target_url을
 * 함께 검증한다. 시각만으로 이전 증거를 현재 배포로 승격하지 않는다.
 *
 * 사용법: GH_TOKEN=... node scripts/wait-preview-deploy.mjs
 *   (preview 브랜치 체크아웃 상태에서 실행 — git rev-parse HEAD 로 대상 SHA 결정)
 *
 * 종료 코드:
 *   0  3앱 모두 SHA-매칭 Vercel commit status success
 *   1  timeout 초과(fail-fast) 또는 gh api 오류 — E2E dispatch 안 됨
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = 'booker-lab/greenhub';

// Vercel GitHub integration이 생성하는 exact status context 3종.
export const PREVIEW_APPS = [
  {
    app: 'seller',
    project: 'greenhub-seller',
    context: 'Vercel – greenhub-seller',
    env: 'Preview – greenhub-seller',
  },
  {
    app: 'consumer',
    project: 'greenhubconsumer',
    context: 'Vercel – greenhubconsumer',
    env: 'Preview – greenhubconsumer',
  },
  {
    app: 'driver',
    project: 'greenhub-driver',
    context: 'Vercel – greenhub-driver',
    env: 'Preview – greenhub-driver',
  },
];

// 기존 import 소비자와 로그 계약을 위한 호환 export. 새 판정은 env가 아니라 context를 사용한다.
export const ENVIRONMENTS = PREVIEW_APPS;

const APP_BY_NAME = new Map(PREVIEW_APPS.map((config) => [config.app, config]));

// 기본 timeout 10분 / 간격 15초. env 로 오버라이드 가능(로컬 검증·튜닝용).
const TIMEOUT_MS = Number(process.env.WAIT_TIMEOUT_MS) || 10 * 60 * 1000;
const INTERVAL_MS = Number(process.env.WAIT_INTERVAL_MS) || 15 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function normalizeTargetUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function gh(apiPath) {
  // gh api 는 URL 인코딩된 query 를 그대로 받는다.
  const out = execSync('gh api "' + apiPath + '"', {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out);
}

function commitStatusesPath(headSha) {
  return 'repos/' + REPO + '/commits/' + headSha + '/statuses?per_page=100';
}

function assertHeadSha(headSha) {
  if (typeof headSha !== 'string' || !/^[0-9a-f]{40}$/.test(headSha)) {
    throw new Error('대상 SHA는 40자리 소문자 16진수여야 합니다.');
  }
}

function statusBelongsToExpectedSha(status, headSha) {
  // 실제 GitHub commit status 응답은 요청 경로가 SHA 권위를 소유하며 sha 필드가 없을 수 있다.
  // 응답에 sha가 있으면 추가 방어로 exact match를 요구한다.
  return typeof status?.sha !== 'string' || status.sha === headSha;
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
    if (
      candidateTime !== null &&
      (latestTime === null || candidateTime > latestTime)
    ) {
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
    // timestamp가 없거나 같고 id도 없으면 GitHub API의 최신순 배열 순서를 유지한다.
  }
  return latest;
}

function inspectStatus(config, headSha, statuses) {
  const contextStatuses = (Array.isArray(statuses) ? statuses : []).filter(
    (status) => status && status.context === config.context,
  );
  const exactStatuses = contextStatuses.filter((status) =>
    statusBelongsToExpectedSha(status, headSha),
  );
  const latestExactStatus = latestStatus(exactStatuses);
  const latestContextStatus = latestStatus(contextStatuses);

  // API 응답에 다른 SHA가 섞인 경우에도 성공으로 추정하지 않는다.
  if (
    !latestExactStatus &&
    latestContextStatus &&
    typeof latestContextStatus.sha === 'string' &&
    latestContextStatus.sha !== headSha
  ) {
    return {
      app: config.app,
      project: config.project,
      context: config.context,
      environment: null,
      expectedSha: headSha,
      statusId: latestContextStatus.id ?? null,
      statusSha: latestContextStatus.sha,
      deploymentId: null,
      deploymentSha: latestContextStatus.sha,
      state: 'stale',
      targetUrl: null,
      ready: false,
    };
  }

  const statusSha = latestExactStatus
    ? typeof latestExactStatus.sha === 'string'
      ? latestExactStatus.sha
      : headSha
    : null;
  const targetUrl = normalizeTargetUrl(latestExactStatus?.target_url);

  return {
    app: config.app,
    project: config.project,
    context: config.context,
    environment: null,
    expectedSha: headSha,
    statusId: latestExactStatus?.id ?? null,
    statusSha,
    // round-direct의 기존 readiness 입력 이름과 호환하되 값의 source는 commit status다.
    deploymentId: null,
    deploymentSha: statusSha,
    state: latestExactStatus?.state ?? 'missing',
    targetUrl,
    ready:
      latestExactStatus?.state === 'success' &&
      statusSha === headSha &&
      Boolean(targetUrl),
  };
}

export function inspectAppCommitStatus(app, headSha, statuses) {
  assertHeadSha(headSha);
  const config = APP_BY_NAME.get(app);
  if (!config) throw new Error('알 수 없는 Preview 앱입니다: ' + app);
  return inspectStatus(config, headSha, statuses);
}

// 기존 함수 이름을 사용하는 로컬 소비자를 위해 유지한다. 조회 source는 commit status로 바뀌었다.
export function inspectAppDeployment(app, _environment, headSha, request = gh) {
  assertHeadSha(headSha);
  return inspectAppCommitStatus(app, headSha, request(commitStatusesPath(headSha)));
}

export function collectCommitStatusEvidence(headSha, request = gh) {
  assertHeadSha(headSha);
  const response = request(commitStatusesPath(headSha));
  const statuses = Array.isArray(response) ? response : [];
  const apps = PREVIEW_APPS.map(({ app }) => inspectAppCommitStatus(app, headSha, statuses));
  const statusShas = Object.fromEntries(apps.map(({ app, statusSha }) => [app, statusSha]));
  const targetUrls = Object.fromEntries(apps.map(({ app, targetUrl }) => [app, targetUrl]));
  const statusStates = Object.fromEntries(apps.map(({ app, state }) => [app, state]));
  const statusContexts = Object.fromEntries(
    PREVIEW_APPS.map(({ app, context }) => [app, context]),
  );

  return {
    ready: apps.length === PREVIEW_APPS.length && apps.every(({ ready }) => ready),
    checkedAt: new Date().toISOString(),
    repository: REPO,
    expectedSha: headSha,
    evidenceSource: 'github-commit-status',
    statusContexts,
    statusShas,
    statusStates,
    statusTargetUrls: targetUrls,
    // 기존 round-direct readiness 계약을 보존하는 source-agnostic alias.
    deploymentShas: statusShas,
    deploymentTargetUrls: targetUrls,
    apps,
  };
}

// 현재 직접 호출자와 기존 artifact 소비자 이름을 함께 보존한다.
export const collectDeploymentEvidence = collectCommitStatusEvidence;

function resolveHeadSha(args) {
  const shaArgument = args.find((arg) => arg.startsWith('--sha='));
  return (
    shaArgument?.slice('--sha='.length).trim().toLowerCase() ||
    process.env.PREVIEW_HEAD_SHA?.trim().toLowerCase() ||
    execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim().toLowerCase()
  );
}

function unavailableEvidence(headSha) {
  return PREVIEW_APPS.map(({ app, project, context }) => ({
    app,
    project,
    context,
    environment: null,
    expectedSha: headSha,
    statusId: null,
    statusSha: null,
    deploymentId: null,
    deploymentSha: null,
    state: 'unavailable',
    targetUrl: null,
    ready: false,
  }));
}

function timeoutDetails(evidence, headSha) {
  const apps = evidence?.apps ?? unavailableEvidence(headSha);
  return apps
    .filter(({ ready }) => !ready)
    .map(
      ({ app, state, statusSha, expectedSha, targetUrl }) =>
        app +
        ': state=' +
        (state ?? 'missing') +
        ', observed_sha=' +
        (statusSha ?? '없음') +
        ', expected_sha=' +
        (expectedSha ?? headSha) +
        ', target_url=' +
        (targetUrl ? 'safe' : 'missing-or-unsafe'),
    )
    .join('; ');
}

async function main() {
  const args = process.argv.slice(2);
  const jsonOnly = args.includes('--json');
  const once = args.includes('--once');
  const headSha = resolveHeadSha(args);

  if (once) {
    const evidence = collectCommitStatusEvidence(headSha);
    process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
    process.exitCode = evidence.ready ? 0 : 1;
    return;
  }

  if (!jsonOnly) {
    console.log('[wait-preview-deploy] 대상 Preview HEAD = ' + headSha);
    console.log(
      '[wait-preview-deploy] 앱 ' +
        PREVIEW_APPS.length +
        '개 확인, 제한 ' +
        TIMEOUT_MS / 1000 +
        '초, 간격 ' +
        INTERVAL_MS / 1000 +
        '초',
    );
  }

  const deadline = Date.now() + TIMEOUT_MS;
  const announcedReadyApps = new Set();
  let latestEvidence = null;

  while (Date.now() < deadline) {
    try {
      latestEvidence = collectCommitStatusEvidence(headSha);
    } catch (error) {
      if (!jsonOnly) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          '[wait-preview-deploy] GitHub API 일시 오류 — ' + message.split('\n')[0],
        );
      }
      await sleep(INTERVAL_MS);
      continue;
    }

    for (const appEvidence of latestEvidence.apps) {
      const { app } = appEvidence;
      if (appEvidence.ready) {
        if (!announcedReadyApps.has(app) && !jsonOnly) {
          console.log(
            '[wait-preview-deploy] ' +
              app +
              ' commit status 확인 (' +
              (announcedReadyApps.size + 1) +
              '/' +
              PREVIEW_APPS.length +
              ') @ ' +
              new Date().toISOString(),
          );
        }
        announcedReadyApps.add(app);
      } else {
        announcedReadyApps.delete(app);
      }
    }

    if (latestEvidence.ready) {
      if (jsonOnly) {
        process.stdout.write(JSON.stringify(latestEvidence, null, 2) + '\n');
      } else {
        console.log(
          '[wait-preview-deploy] 세 앱의 Vercel commit status가 모두 확인되어 E2E 실행을 허용합니다.',
        );
      }
      return;
    }
    await sleep(INTERVAL_MS);
  }

  // fail-fast: timeout 시 앱별 상태와 SHA를 노출해 배포 지연 원인을 식별한다.
  if (jsonOnly && latestEvidence) {
    process.stdout.write(JSON.stringify(latestEvidence, null, 2) + '\n');
  } else {
    console.error(
      '[wait-preview-deploy] ' +
        TIMEOUT_MS / 1000 +
        '초 초과 — 미완료 앱: ' +
        timeoutDetails(latestEvidence, headSha),
    );
    console.error(
      '[wait-preview-deploy] E2E 실행을 차단했습니다. Preview commit status를 확인하세요.',
    );
  }
  process.exitCode = 1;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[wait-preview-deploy] 치명적 오류: ' + message);
    process.exitCode = 1;
  });
}
