#!/usr/bin/env node
/**
 * 배포 후 점검(읽기 전용). docs/memory.md 운영 배포 기록의 "배포 뒤 확인"을 한 번에 실행한다.
 *
 *   node scripts/release/post-deploy-smoke.mjs                      # 운영 canonical URL
 *   node scripts/release/post-deploy-smoke.mjs --expect-sha=0bcceaea  # API가 그 SHA로 떠 있는지도 확인
 *   node scripts/release/post-deploy-smoke.mjs --api=https://... --consumer=https://... --seller=... --driver=...
 *
 * GET·OPTIONS만 보낸다. 로그인·쓰기·외부 공급자 호출은 하지 않는다.
 * 결과는 JSON 한 줄 요약으로 출력하고, 하나라도 실패하면 exit 1.
 */
import { fileURLToPath } from 'node:url';

export const PRODUCTION_TARGETS = Object.freeze({
  api: 'https://api-production-13e7.up.railway.app',
  consumer: 'https://greenlove.co.kr',
  seller: 'https://seller.greenlove.co.kr',
  driver: 'https://driver.greenlove.co.kr',
});

const TIMEOUT_MS = 15_000;

function trimSlash(url) {
  return url.replace(/\/+$/, '');
}

async function request(fetchImpl, url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(url, { redirect: 'manual', ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function check(name, run) {
  try {
    const detail = await run();
    return { name, ok: true, ...(detail ? { detail } : {}) };
  } catch (error) {
    return { name, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function buildChecks(targets, { expectSha = null, fetchImpl = fetch } = {}) {
  const api = trimSlash(targets.api);
  const page = (label, base, path) =>
    check(`${label} ${path} 200`, async () => {
      const res = await request(fetchImpl, `${trimSlash(base)}${path}`);
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    });

  return [
    check('API /health ok', async () => {
      const res = await request(fetchImpl, `${api}/health`);
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body?.status !== 'ok') throw new Error('status가 ok가 아님');
      if (expectSha) {
        if (!body.commit) throw new Error('API가 commit을 알려 주지 않음(배포 방식 확인 필요)');
        if (!body.commit.startsWith(expectSha) && !expectSha.startsWith(body.commit)) {
          throw new Error(`배포 SHA 불일치: 실행 중 ${body.commit}, 기대 ${expectSha}`);
        }
      }
      return { commit: body.commit ?? null };
    }),
    page('consumer', targets.consumer, '/'),
    page('seller', targets.seller, '/login'),
    page('driver', targets.driver, '/login'),
    ...['consumer', 'seller', 'driver'].map((app) =>
      check(`API CORS 허용: ${app}`, async () => {
        const origin = trimSlash(targets[app]);
        const res = await request(fetchImpl, `${api}/health`, {
          method: 'OPTIONS',
          headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
        });
        const allowed = res.headers.get('access-control-allow-origin');
        if (allowed !== origin) throw new Error(`allow-origin=${allowed ?? '(없음)'}`);
      }),
    ),
    check('비로그인 기사 API 401', async () => {
      const res = await request(fetchImpl, `${api}/driver/orders`);
      if (res.status !== 401) throw new Error(`HTTP ${res.status}`);
    }),
    check('비로그인 판매자 주문 API 401', async () => {
      const res = await request(fetchImpl, `${api}/stores/smoke-check/orders`);
      if (res.status !== 401) throw new Error(`HTTP ${res.status}`);
    }),
  ];
}

export async function runSmoke(targets, options) {
  const results = await Promise.all(buildChecks(targets, options));
  return { ok: results.every((r) => r.ok), checkedAt: new Date().toISOString(), results };
}

function parseArgs(argv) {
  const value = (name) =>
    argv
      .find((a) => a.startsWith(`--${name}=`))
      ?.split('=')
      .slice(1)
      .join('=');
  const targets = { ...PRODUCTION_TARGETS };
  for (const key of Object.keys(targets)) {
    const override = value(key);
    if (override) targets[key] = override;
  }
  const expectSha = value('expect-sha') ?? null;
  if (expectSha && !/^[0-9a-f]{7,40}$/.test(expectSha)) {
    throw new Error('--expect-sha는 7~40자리 소문자 16진수여야 합니다.');
  }
  return { targets, expectSha };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { targets, expectSha } = parseArgs(process.argv.slice(2));
  const summary = await runSmoke(targets, { expectSha });
  for (const r of summary.results) {
    console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.ok ? '' : ` — ${r.error}`}`);
  }
  console.log(JSON.stringify({ ok: summary.ok, checkedAt: summary.checkedAt, targets, expectSha }));
  process.exit(summary.ok ? 0 : 1);
}
