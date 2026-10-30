import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChannelPrefixes, runSmoke } from './post-deploy-smoke.mjs';

const targets = {
  api: 'https://api.test',
  consumer: 'https://consumer.test',
  seller: 'https://seller.test',
  driver: 'https://driver.test',
};

function fakeFetch({ commit = 'abc1234', corsOrigin = (o) => o, driverStatus = 401 } = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    const u = new URL(url);
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (u.host === 'api.test') {
      if (init.method === 'OPTIONS') {
        const allowed = corsOrigin(init.headers.Origin);
        return new Response(null, {
          status: 204,
          headers: allowed ? { 'access-control-allow-origin': allowed } : {},
        });
      }
      if (u.pathname === '/health') return json({ status: 'ok', commit });
      if (u.pathname === '/driver/orders') return json({}, driverStatus);
      if (u.pathname === '/stores/smoke-check/orders') return json({}, 401);
    }
    return new Response('<html></html>', { status: 200 });
  };
  return { impl, calls };
}

test('모든 점검이 통과하면 ok이고 GET·OPTIONS만 보낸다', async () => {
  const { impl, calls } = fakeFetch();
  const summary = await runSmoke(targets, { expectSha: 'abc1234', fetchImpl: impl });
  assert.equal(summary.ok, true, JSON.stringify(summary.results));
  assert.equal(summary.results.length, 9);
  assert.ok(calls.every((c) => c.method === 'GET' || c.method === 'OPTIONS'));
});

test('배포 SHA가 다르거나 알 수 없으면 실패한다', async () => {
  const mismatch = await runSmoke(targets, {
    expectSha: 'def5678',
    fetchImpl: fakeFetch().impl,
  });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.results[0].error, /SHA 불일치/);
  const unknown = await runSmoke(targets, {
    expectSha: 'abc1234',
    fetchImpl: fakeFetch({ commit: null }).impl,
  });
  assert.match(unknown.results[0].error, /commit/);
});

test('CORS 거부나 비로그인 접근 허용은 실패로 잡는다', async () => {
  const summary = await runSmoke(targets, {
    fetchImpl: fakeFetch({ corsOrigin: () => null, driverStatus: 200 }).impl,
  });
  const failed = summary.results.filter((r) => !r.ok).map((r) => r.name);
  assert.deepEqual(failed.sort(), [
    'API CORS 허용: consumer',
    'API CORS 허용: driver',
    'API CORS 허용: seller',
    '비로그인 기사 API 401',
  ]);
});

const LIVE_KAKAO = 'channel-key-11111111-aaaa-4bbb-8ccc-000000000001';
const LIVE_CARD = 'channel-key-22222222-aaaa-4bbb-8ccc-000000000002';
const TEST_CARD = 'channel-key-99999999-aaaa-4bbb-8ccc-000000000009';

// sw.js precache 목록과 청크 본문만 consumer 응답으로 바꾸고 나머지는 fakeFetch에 맡긴다.
function bundleFetch(chunkBodies, { swStatus = 200 } = {}) {
  const base = fakeFetch();
  const urls = [];
  const impl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.host === 'consumer.test') {
      urls.push(u.pathname);
      if (u.pathname === '/sw.js') {
        const entries = Object.keys(chunkBodies)
          .map((path) => `{url:"${path}",revision:null}`)
          .join(',');
        const source = `define(["./workbox-a"],function(e){e.precacheAndRoute([${entries}])})`;
        return new Response(source, { status: swStatus });
      }
      if (u.pathname in chunkBodies) return new Response(chunkBodies[u.pathname], { status: 200 });
    }
    return base.impl(url, init);
  };
  return { impl, urls };
}

const liveBundle = {
  '/_next/static/chunks/app/checkout/page-abc.js': `s="card"===e?"${LIVE_CARD}":"${LIVE_KAKAO}"`,
  '/_next/static/chunks/7385.def.js': `s="card"===e?"${LIVE_CARD}":"${LIVE_KAKAO}"`,
  '/_next/static/chunks/159-xyz.js': 'no keys here',
};

function channelCheck(summary) {
  return summary.results.find((r) => r.name.startsWith('consumer 번들 PortOne'));
}

test('PortOne 채널 점검은 기대값을 줄 때만 돌고, 모든 번들 키가 기대값이면 통과한다', async () => {
  const off = await runSmoke(targets, { fetchImpl: bundleFetch(liveBundle).impl });
  assert.equal(channelCheck(off), undefined);

  const { impl, urls } = bundleFetch(liveBundle);
  const summary = await runSmoke(targets, {
    expectPortoneChannels: ['channel-key-11111111', 'channel-key-22222222'],
    fetchImpl: impl,
  });
  const result = channelCheck(summary);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(summary.ok, true);
  assert.equal(result.detail.chunks, 3);
  assert.equal(result.detail.keys.length, 2);
  assert.ok(urls.includes('/sw.js'));
  assert.ok(urls.includes('/_next/static/chunks/app/checkout/page-abc.js'));
  // 키 값은 결과에 남기지 않는다.
  assert.doesNotMatch(JSON.stringify(summary), /channel-key-/);
});

test('번들에 TEST 키가 남거나 기대한 LIVE 키가 없으면 키 값을 출력하지 않고 실패한다', async () => {
  const leftover = await runSmoke(targets, {
    expectPortoneChannels: ['channel-key-11111111', 'channel-key-22222222'],
    fetchImpl: bundleFetch({
      '/_next/static/chunks/app/checkout/page-abc.js': `s="card"===e?"${TEST_CARD}":"${LIVE_KAKAO}"`,
    }).impl,
  });
  const failed = channelCheck(leftover);
  assert.equal(failed.ok, false);
  assert.equal(leftover.ok, false);
  assert.match(failed.error, /기대값 밖의 키 1개\(sha256 [0-9a-f]{10}\)/);
  assert.match(failed.error, /번들에 없는 기대값 2번째/);
  assert.doesNotMatch(JSON.stringify(leftover), /channel-key-/);
});

test('sw.js·청크 목록·채널 키를 찾지 못하면 통과로 보지 않는다', async () => {
  const expectPortoneChannels = ['channel-key-11111111'];
  const swMissing = await runSmoke(targets, {
    expectPortoneChannels,
    fetchImpl: bundleFetch(liveBundle, { swStatus: 404 }).impl,
  });
  assert.match(channelCheck(swMissing).error, /sw\.js HTTP 404/);
  const noChunks = await runSmoke(targets, {
    expectPortoneChannels,
    fetchImpl: bundleFetch({}).impl,
  });
  assert.match(channelCheck(noChunks).error, /청크 목록을 찾지 못함/);
  const noKeys = await runSmoke(targets, {
    expectPortoneChannels,
    fetchImpl: bundleFetch({ '/_next/static/chunks/159-xyz.js': 'no keys' }).impl,
  });
  assert.match(channelCheck(noKeys).error, /채널 키를 찾지 못함/);
});

test('기대 채널 앞부분은 channel-key- 뒤 8자 이상만 받는다', () => {
  assert.deepEqual(parseChannelPrefixes(' channel-key-11111111 , channel-key-22222222-aaaa '), [
    'channel-key-11111111',
    'channel-key-22222222-aaaa',
  ]);
  const bad = ['', ',', 'channel-key-', 'channel-key-1234', 'store-11111111', 'channel-key-111111"'];
  for (const value of bad) {
    assert.throws(() => parseChannelPrefixes(value), /--expect-portone-channels/, value);
  }
});
