/**
 * Preview 배포 완료 대기 게이트 — sync-preview.yml 의 E2E 트리거 직전에 호출.
 *
 * 왜 필요한가: sync-preview 가 success 로 떨어져도 Vercel 의 실제 preview 재배포는
 * 2~4분 더 걸린다. 그 사이 e2e 를 dispatch 하면 stale(이전 커밋) 배포본을 검사한다
 * (세션39·60·61 재현). 이 스크립트는 3앱 Preview deployment 가 현재 preview HEAD
 * 커밋으로 success 할 때까지 폴링해 그 race 를 트리거 단계에서 차단한다.
 *
 * 매칭 기준 = SHA (시각 비교 아님). deployment.sha 는 preview HEAD commit SHA 와
 * 정확히 일치하며(실측 #CL-43), Vercel 은 커밋 빌드 success 시 고정 브랜치 별칭
 * (-git-preview-, e2e BASE)을 그 커밋으로 재포인팅한다(T0 실측 확정). 따라서
 * sha-매칭 deployment 의 success = e2e BASE 가 새 커밋을 서빙하게 된 정확한 신호.
 *
 * 사용법: GH_TOKEN=... node scripts/wait-preview-deploy.mjs
 *   (preview 브랜치 체크아웃 상태에서 실행 — git rev-parse HEAD 로 대상 SHA 결정)
 *
 * 종료 코드:
 *   0  3앱 모두 sha-매칭 deployment success
 *   1  timeout 초과(fail-fast) 또는 gh api 오류 — e2e dispatch 안 됨, 배포 지연 노출
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = 'booker-lab/greenhub';

// Preview deployment environment 이름 3종.
// 주의: 구분자는 en-dash(U+2013 '–'), 일반 hyphen 아님. consumer 는 앱명에
// 하이픈이 없어 seller/driver 와 표기가 다름(GAP-3 실측).
export const ENVIRONMENTS = [
  { app: 'seller', env: 'Preview – greenhub-seller' },
  { app: 'consumer', env: 'Preview – greenhubconsumer' },
  { app: 'driver', env: 'Preview – greenhub-driver' },
];

// 기본 timeout 10분 / 간격 15초. env 로 오버라이드 가능(로컬 검증·튜닝용).
const TIMEOUT_MS = Number(process.env.WAIT_TIMEOUT_MS) || 10 * 60 * 1000;
const INTERVAL_MS = Number(process.env.WAIT_INTERVAL_MS) || 15 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function gh(path) {
  // gh api 는 URL 인코딩된 query 를 그대로 받는다. en-dash·공백은 호출부에서 인코딩.
  const out = execSync(`gh api "${path}"`, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out);
}

/**
 * 한 앱의 현재 HEAD 커밋 deployment 가 success 인지 1회 확인.
 *  - sha-매칭 deployment id 를 찾고(없으면 아직 생성 전 → 미완)
 *  - 그 deployment 의 최신 status state 가 'success' 인지 판정.
 */
export function inspectAppDeployment(app, env, headSha, request = gh) {
  const encEnv = encodeURIComponent(env); // 공백→%20, en-dash→%E2%80%93
  const deployments = request(`repos/${REPO}/deployments?environment=${encEnv}&per_page=10`);
  const match = deployments.find((d) => d.sha === headSha);
  if (!match) {
    return {
      app,
      environment: env,
      expectedSha: headSha,
      deploymentSha: null,
      deploymentId: null,
      state: 'missing',
      targetUrl: null,
      ready: false,
    };
  }
  const statuses = request(`repos/${REPO}/deployments/${match.id}/statuses?per_page=5`);
  const latest = statuses[0]; // GitHub 는 최신순 반환
  return {
    app,
    environment: env,
    expectedSha: headSha,
    deploymentSha: match.sha,
    deploymentId: match.id,
    state: latest?.state ?? 'missing',
    targetUrl: latest?.target_url ?? null,
    ready: latest?.state === 'success' && match.sha === headSha,
  };
}

export function collectDeploymentEvidence(headSha, request = gh) {
  if (!/^[0-9a-f]{40}$/.test(headSha)) {
    throw new Error('대상 SHA는 40자리 소문자 16진수여야 합니다.');
  }
  const apps = ENVIRONMENTS.map(({ app, env }) =>
    inspectAppDeployment(app, env, headSha, request),
  );
  return {
    ready: apps.every(({ ready }) => ready),
    checkedAt: new Date().toISOString(),
    repository: REPO,
    expectedSha: headSha,
    deploymentShas: Object.fromEntries(apps.map(({ app, deploymentSha }) => [app, deploymentSha])),
    apps,
  };
}

function resolveHeadSha(args) {
  const shaArgument = args.find((arg) => arg.startsWith('--sha='));
  return (
    shaArgument?.slice('--sha='.length).trim().toLowerCase() ||
    process.env.PREVIEW_HEAD_SHA?.trim().toLowerCase() ||
    execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim().toLowerCase()
  );
}

async function main() {
  const args = process.argv.slice(2);
  const jsonOnly = args.includes('--json');
  const once = args.includes('--once');
  // 대상 SHA = preview HEAD. 기본은 git rev-parse(워크플로는 preview 체크아웃 상태).
  // PREVIEW_HEAD_SHA env 로 오버라이드 가능 — 로컬 검증 시 임의 커밋 지정용.
  const headSha = resolveHeadSha(args);

  if (once) {
    const evidence = collectDeploymentEvidence(headSha);
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    process.exitCode = evidence.ready ? 0 : 1;
    return;
  }

  if (!jsonOnly) {
    console.log(`[wait-preview-deploy] 대상 Preview HEAD = ${headSha}`);
    console.log(
      `[wait-preview-deploy] 앱 ${ENVIRONMENTS.length}개 확인, 제한 ${TIMEOUT_MS / 1000}초, 간격 ${INTERVAL_MS / 1000}초`,
    );
  }

  const deadline = Date.now() + TIMEOUT_MS;
  const done = new Set();
  let latestEvidence = null;

  while (Date.now() < deadline) {
    try {
      latestEvidence = collectDeploymentEvidence(headSha);
    } catch (error) {
      if (!jsonOnly) {
        console.warn(
          `[wait-preview-deploy] GitHub API 일시 오류 — ${error.message.split('\n')[0]}`,
        );
      }
      await sleep(INTERVAL_MS);
      continue;
    }
    for (const evidence of latestEvidence.apps) {
      const { app } = evidence;
      if (done.has(app)) continue;
      if (evidence.ready) {
        done.add(app);
        if (!jsonOnly) {
          console.log(
            `[wait-preview-deploy] ${app} 배포 확인 (${done.size}/${ENVIRONMENTS.length}) @ ${new Date().toISOString()}`,
          );
        }
      }
    }
    if (done.size === ENVIRONMENTS.length) {
      if (jsonOnly) {
        process.stdout.write(`${JSON.stringify(latestEvidence, null, 2)}\n`);
      } else {
        console.log('[wait-preview-deploy] 세 앱 배포가 모두 확인되어 E2E 실행을 허용합니다.');
      }
      return;
    }
    await sleep(INTERVAL_MS);
  }

  // fail-fast: timeout 시 미완 앱 노출(배포 지연 원인 식별). e2e dispatch 안 됨.
  const pending = ENVIRONMENTS.filter(({ app }) => !done.has(app)).map(({ app }) => app);
  if (jsonOnly && latestEvidence) {
    process.stdout.write(`${JSON.stringify(latestEvidence, null, 2)}\n`);
  } else {
    console.error(
      `[wait-preview-deploy] ${TIMEOUT_MS / 1000}초 초과 — 미완료 앱: ${pending.join(', ')}`,
    );
    console.error('[wait-preview-deploy] E2E 실행을 차단했습니다. Preview 배포 상태를 확인하세요.');
  }
  process.exitCode = 1;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(`[wait-preview-deploy] 치명적 오류: ${error.message}`);
    process.exitCode = 1;
  });
}
