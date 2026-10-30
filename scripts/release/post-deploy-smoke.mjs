#!/usr/bin/env node
/**
 * 배포 후 점검(읽기 전용). docs/memory.md 운영 배포 기록의 "배포 뒤 확인"을 한 번에 실행한다.
 *
 *   node scripts/release/post-deploy-smoke.mjs                      # 운영 canonical URL
 *   node scripts/release/post-deploy-smoke.mjs --expect-sha=0bcceaea  # API가 그 SHA로 떠 있는지도 확인
 *   node scripts/release/post-deploy-smoke.mjs --api=https://... --consumer=https://... --seller=... --driver=...
 *   node scripts/release/post-deploy-smoke.mjs --expect-portone-channels=channel-key-1234abcd,channel-key-5678ef01
 *
 * `--expect-portone-channels`는 consumer 운영 번들에 굳은 PortOne 채널 키가 모두 주어진 앞부분 중 하나로
 * 시작하는지 본다(LIVE 전환 뒤 TEST 키가 남았는지 확인). 키 값은 출력하지 않고 sha256 앞 10자리만 남긴다.
 *
 * GET·OPTIONS만 보낸다. 로그인·쓰기·외부 공급자 호출은 하지 않는다.
 * 결과는 JSON 한 줄 요약으로 출력하고, 하나라도 실패하면 exit 1.
 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const PRODUCTION_TARGETS = Object.freeze({
  api: 'https://api-production-13e7.up.railway.app',
  consumer: 'https://greenlove.co.kr',
  seller: 'https://seller.greenlove.co.kr',
  driver: 'https://driver.greenlove.co.kr',
});

const TIMEOUT_MS = 15_000;
const CHUNK_FETCH_CONCURRENCY = 8;
// 기대값은 키 앞부분이다. `channel-key-` 뒤 8자 이상이어야 다른 채널과 구별된다.
const CHANNEL_PREFIX_PATTERN = /^channel-key-[0-9A-Za-z-]{8,}$/;
const CHANNEL_KEY_PATTERN = /channel-key-[0-9A-Za-z-]+/g;
// next-pwa가 만든 sw.js의 precache 목록. 로그인 뒤에만 열리는 결제 화면의 청크도 여기에 있다.
const PRECACHED_CHUNK_PATTERN = /url:"(\/_next\/static\/chunks\/[^"]+\.js)"/g;

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

export function parseChannelPrefixes(value) {
  const prefixes = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (prefixes.length === 0 || !prefixes.every((prefix) => CHANNEL_PREFIX_PATTERN.test(prefix))) {
    throw new Error(
      '--expect-portone-channels는 쉼표로 나눈 channel-key-로 시작하는 앞부분(뒤 8자 이상)이어야 합니다.',
    );
  }
  return prefixes;
}

function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 10);
}

/**
 * consumer 운영 번들에 굳은 PortOne 채널 키를 모은다. 결제 화면은 로그인해야 열리므로 페이지 HTML 대신
 * sw.js precache 목록의 JS 청크를 모두 읽는다. 목록이나 키를 찾지 못하면 실패로 본다.
 */
export async function readBundledChannelKeys(consumer, fetchImpl) {
  const swRes = await request(fetchImpl, `${consumer}/sw.js`);
  if (swRes.status !== 200) throw new Error(`sw.js HTTP ${swRes.status}`);
  const swSource = await swRes.text();
  const chunks = [...new Set([...swSource.matchAll(PRECACHED_CHUNK_PATTERN)].map((m) => m[1]))];
  if (chunks.length === 0) throw new Error('sw.js에서 JS 청크 목록을 찾지 못함');

  const keys = new Set();
  for (let i = 0; i < chunks.length; i += CHUNK_FETCH_CONCURRENCY) {
    await Promise.all(
      chunks.slice(i, i + CHUNK_FETCH_CONCURRENCY).map(async (path) => {
        const res = await request(fetchImpl, `${consumer}${path}`);
        if (res.status !== 200) throw new Error(`청크 ${path} HTTP ${res.status}`);
        for (const [key] of (await res.text()).matchAll(CHANNEL_KEY_PATTERN)) keys.add(key);
      }),
    );
  }
  return { chunks: chunks.length, keys: [...keys].sort() };
}

export function buildChecks(
  targets,
  { expectSha = null, expectPortoneChannels = null, fetchImpl = fetch } = {},
) {
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
    ...(expectPortoneChannels
      ? [
          check('consumer 번들 PortOne 채널 키가 기대값', async () => {
            const { chunks, keys } = await readBundledChannelKeys(
              trimSlash(targets.consumer),
              fetchImpl,
            );
            if (keys.length === 0) throw new Error(`청크 ${chunks}개에서 채널 키를 찾지 못함`);
            const unexpected = keys.filter(
              (key) => !expectPortoneChannels.some((prefix) => key.startsWith(prefix)),
            );
            const missing = expectPortoneChannels
              .map((prefix, index) => ({ prefix, index }))
              .filter(({ prefix }) => !keys.some((key) => key.startsWith(prefix)));
            if (unexpected.length > 0 || missing.length > 0) {
              const parts = [];
              if (unexpected.length > 0) {
                parts.push(
                  `기대값 밖의 키 ${unexpected.length}개(sha256 ${unexpected.map(fingerprint).join(', ')})`,
                );
              }
              if (missing.length > 0) {
                parts.push(`번들에 없는 기대값 ${missing.map(({ index }) => index + 1).join(', ')}번째`);
              }
              throw new Error(parts.join('; '));
            }
            return { chunks, keys: keys.map(fingerprint) };
          }),
        ]
      : []),
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
  const channels = value('expect-portone-channels');
  const expectPortoneChannels = channels === undefined ? null : parseChannelPrefixes(channels);
  return { targets, expectSha, expectPortoneChannels };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { targets, expectSha, expectPortoneChannels } = parseArgs(process.argv.slice(2));
  const summary = await runSmoke(targets, { expectSha, expectPortoneChannels });
  for (const r of summary.results) {
    console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.ok ? '' : ` — ${r.error}`}`);
  }
  console.log(JSON.stringify({ ok: summary.ok, checkedAt: summary.checkedAt, targets, expectSha }));
  process.exit(summary.ok ? 0 : 1);
}
