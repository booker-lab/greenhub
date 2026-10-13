import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runSmoke } from './post-deploy-smoke.mjs';

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
