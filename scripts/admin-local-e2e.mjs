/**
 * 판매자·어드민 로컬 E2E 묶음 실행기 — UI 교체 PR의 로컬 증거(ui-stack-migration-plan.md P0.5-2).
 *
 *   node scripts/admin-local-e2e.mjs            # pnpm dev:local을 먼저 띄운다
 *
 * `admin-local-*.spec.ts`를 dev:local 스택(루프백 고정)에서 chromium·mobile로 돌리고, 다음을 모두 만족할 때만 통과한다.
 *  - 대상이 루프백이다(SELLER_BASE·CONSUMER_BASE·DRIVER_BASE를 밖으로 바꾸면 실행하지 않는다).
 *  - 실행 목록의 테스트 수가 아래 EXPECTED_TESTS와 같다(spec을 더하거나 빼면 이 숫자를 같은 PR에서 고친다).
 *  - 실패·재시도로 통과(flaky)·건너뜀이 모두 0이다. 재시도는 끈다(--retries=0).
 * 기준을 맞추려고 판정을 완화하지 않는다(AGENTS.md §0-5).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// admin-local-* 5개 spec × chromium·mobile (2026-10-30 `playwright test admin-local- --list` 20건).
export const EXPECTED_TESTS = 20;
export const SPEC_PATTERN = 'admin-local-';
export const PROJECTS = Object.freeze(['chromium', 'mobile']);
export const LOCAL_BASES = Object.freeze({
  SELLER_BASE: 'http://localhost:3002',
  CONSUMER_BASE: 'http://localhost:3001',
  DRIVER_BASE: 'http://localhost:3003',
});
const API_HEALTH = 'http://localhost:3000/health';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** 사용자가 준 대상 주소가 루프백인지 확인한다. 아니면 문제 목록을 돌려준다. */
export function nonLoopbackBases(env) {
  const problems = [];
  for (const name of Object.keys(LOCAL_BASES)) {
    const value = env[name];
    if (value === undefined || value === '') continue;
    let host;
    try {
      host = new URL(value).hostname;
    } catch {
      problems.push(`${name}=${value}: 주소를 해석할 수 없음`);
      continue;
    }
    if (!LOOPBACK_HOSTS.has(host)) problems.push(`${name}=${value}: 루프백이 아님`);
  }
  return problems;
}

/** Playwright JSON 보고서 요약(stats)을 판정한다. */
export function judgeStats(stats, expectedTotal = EXPECTED_TESTS) {
  const problems = [];
  if (!stats || typeof stats !== 'object') return ['JSON 보고서에 stats가 없음'];
  const expected = stats.expected ?? 0;
  const unexpected = stats.unexpected ?? 0;
  const flaky = stats.flaky ?? 0;
  const skipped = stats.skipped ?? 0;
  const total = expected + unexpected + flaky + skipped;
  if (total !== expectedTotal) problems.push(`실행한 테스트 ${total}건(기대 ${expectedTotal}건)`);
  if (unexpected) problems.push(`실패 ${unexpected}건`);
  if (flaky) problems.push(`재시도 통과 ${flaky}건`);
  if (skipped) problems.push(`건너뜀 ${skipped}건`);
  return problems;
}

async function reachable(url) {
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5_000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outside = nonLoopbackBases(process.env);
  if (outside.length) {
    console.error(
      `❌ 대상 주소가 루프백이 아니어서 실행하지 않습니다:\n  - ${outside.join('\n  - ')}`,
    );
    return 1;
  }
  for (const url of [API_HEALTH, `${LOCAL_BASES.SELLER_BASE}/login`]) {
    if (!(await reachable(url))) {
      console.error(
        `❌ ${url}에 닿지 않습니다. 먼저 pnpm dev:local을 띄우세요(scripts/dev/local/README.md).`,
      );
      return 1;
    }
  }
  const reportFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'admin-local-e2e-')),
    'report.json',
  );
  const args = [
    '--filter',
    'e2e',
    'exec',
    'playwright',
    'test',
    SPEC_PATTERN,
    ...PROJECTS.map((p) => `--project=${p}`),
    '--workers=1',
    '--retries=0',
    '--reporter=list,json',
  ];
  const result = spawnSync('pnpm', args, {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...LOCAL_BASES,
      ADMIN_LOCAL_E2E: '1',
      PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
    },
  });
  if (!fs.existsSync(reportFile)) {
    console.error(`❌ Playwright JSON 보고서가 없습니다(종료 코드 ${result.status}).`);
    return 1;
  }
  const { stats } = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const problems = judgeStats(stats);
  if (result.status !== 0 && problems.length === 0)
    problems.push(`Playwright 종료 코드 ${result.status}`);
  if (problems.length) {
    console.error(`❌ 판매자·어드민 로컬 E2E 묶음: ${problems.join(' · ')}`);
    return 1;
  }
  console.log(`✅ 판매자·어드민 로컬 E2E 묶음: ${EXPECTED_TESTS}/${EXPECTED_TESTS} 통과, 건너뜀 0`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
