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
import { execSync } from 'child_process';

const REPO = 'booker-lab/greenhub';

// Preview deployment environment 이름 3종.
// 주의: 구분자는 en-dash(U+2013 '–'), 일반 hyphen 아님. consumer 는 앱명에
// 하이픈이 없어 seller/driver 와 표기가 다름(GAP-3 실측).
const ENVIRONMENTS = [
  { app: 'seller', env: 'Preview – greenhub-seller' },
  { app: 'consumer', env: 'Preview – greenhubconsumer' },
  { app: 'driver', env: 'Preview – greenhub-driver' },
];

// 기본 timeout 10분 / 간격 15초. env 로 오버라이드 가능(로컬 검증·튜닝용).
const TIMEOUT_MS = Number(process.env.WAIT_TIMEOUT_MS) || 10 * 60 * 1000;
const INTERVAL_MS = Number(process.env.WAIT_INTERVAL_MS) || 15 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function gh(path) {
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
function isAppDeployed(env, headSha) {
  const encEnv = encodeURIComponent(env); // 공백→%20, en-dash→%E2%80%93
  const deployments = gh(`repos/${REPO}/deployments?environment=${encEnv}&per_page=10`);
  const match = deployments.find((d) => d.sha === headSha);
  if (!match) return false; // 해당 커밋 deployment 아직 미생성
  const statuses = gh(`repos/${REPO}/deployments/${match.id}/statuses?per_page=5`);
  const latest = statuses[0]; // GitHub 는 최신순 반환
  return latest?.state === 'success';
}

async function main() {
  // 대상 SHA = preview HEAD. 기본은 git rev-parse(워크플로는 preview 체크아웃 상태).
  // PREVIEW_HEAD_SHA env 로 오버라이드 가능 — 로컬 검증 시 임의 커밋 지정용.
  const headSha =
    process.env.PREVIEW_HEAD_SHA?.trim() ||
    execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  console.log(`[wait-preview-deploy] target preview HEAD = ${headSha}`);
  console.log(`[wait-preview-deploy] polling ${ENVIRONMENTS.length} apps, timeout ${TIMEOUT_MS / 1000}s, interval ${INTERVAL_MS / 1000}s`);

  const deadline = Date.now() + TIMEOUT_MS;
  const done = new Set();

  while (Date.now() < deadline) {
    for (const { app, env } of ENVIRONMENTS) {
      if (done.has(app)) continue;
      let ok = false;
      try {
        ok = isAppDeployed(env, headSha);
      } catch (e) {
        // gh api 오류(권한·네트워크)는 폴링 중 일시적일 수 있어 다음 주기에 재시도.
        console.warn(`[wait-preview-deploy] ${app}: gh api error — ${e.message.split('\n')[0]}`);
      }
      if (ok) {
        done.add(app);
        console.log(`[wait-preview-deploy] ✅ ${app} deployed (${done.size}/${ENVIRONMENTS.length}) @ ${new Date().toISOString()}`);
      }
    }
    if (done.size === ENVIRONMENTS.length) {
      console.log('[wait-preview-deploy] 🎉 all 3 apps deployed — proceeding to e2e dispatch.');
      process.exit(0);
    }
    await sleep(INTERVAL_MS);
  }

  // fail-fast: timeout 시 미완 앱 노출(배포 지연 원인 식별). e2e dispatch 안 됨.
  const pending = ENVIRONMENTS.filter(({ app }) => !done.has(app)).map(({ app }) => app);
  console.error(`[wait-preview-deploy] ⛔ timeout ${TIMEOUT_MS / 1000}s — pending apps: ${pending.join(', ')}`);
  console.error('[wait-preview-deploy] e2e dispatch 차단(fail-fast) — Vercel preview 배포 지연 가능성을 확인하세요.');
  process.exit(1);
}

main().catch((e) => {
  console.error(`[wait-preview-deploy] fatal: ${e.message}`);
  process.exit(1);
});
