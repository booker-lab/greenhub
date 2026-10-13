import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHECK_NAMES,
  evaluate,
  maskCommands,
  readConsumerStoreId,
  readRailwayVariables,
  run,
  summarize,
} from './prod-config-check.mjs';

const JWT = 'j'.repeat(40);
const REFRESH = 'r'.repeat(40);
const STORE = 'store-11111111-2222-3333-4444-555555555555';
const OTHER_STORE = 'store-99999999-2222-3333-4444-555555555555';
const WEBHOOK = 'test-webhook-secret-placeholder';
const OTHER_VAR_VALUE = 'unrelated-private-value-should-not-be-read';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const BASE_RAILWAY = {
  JWT_SECRET: JWT,
  JWT_REFRESH_SECRET: REFRESH,
  PORTONE_STORE_ID: STORE,
  PORTONE_WEBHOOK_SECRET: WEBHOOK,
  FIREBASE_PRIVATE_KEY: OTHER_VAR_VALUE,
};

const BASE_ENV = {
  GITHUB_ACTIONS: 'true',
  RAILWAY_TOKEN: 'railway-token',
  RAILWAY_API_SERVICE_ID: 'svc-api',
  VERCEL_PRODUCTION_TOKEN: 'vercel-token',
};

/**
 * Railway GraphQL·Vercel REST를 흉내 낸다.
 * vercelEnvs: 목록 응답 항목, vercelValues: id → 상세 응답.
 */
function fakeFetch({
  railwayVars = BASE_RAILWAY,
  railwayStatus = 200,
  railwayErrors = null,
  vercelEnvs = [
    {
      id: 'env_prod',
      key: 'NEXT_PUBLIC_PORTONE_STORE_ID',
      type: 'encrypted',
      target: ['production'],
    },
    { id: 'env_prev', key: 'NEXT_PUBLIC_PORTONE_STORE_ID', type: 'encrypted', target: ['preview'] },
  ],
  vercelValues = {
    env_prod: { type: 'encrypted', value: STORE, decrypted: true },
    env_prev: { type: 'encrypted', value: OTHER_STORE, decrypted: true },
  },
  vercelListStatus = 200,
} = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === 'https://backboard.railway.com/graphql/v2') {
      if (railwayStatus !== 200) return json({ message: `body with ${JWT}` }, railwayStatus);
      const { query, variables } = JSON.parse(init.body);
      if (railwayErrors) return json({ errors: railwayErrors });
      if (query.includes('projectToken')) {
        return json({ data: { projectToken: { projectId: 'proj-1', environmentId: 'env-1' } } });
      }
      if (query.includes('variables(')) {
        assert.deepEqual(variables, {
          projectId: 'proj-1',
          environmentId: 'env-1',
          serviceId: 'svc-api',
        });
        return json({ data: { variables: railwayVars } });
      }
      throw new Error(`unexpected railway query ${query}`);
    }
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.vercel.com');
    assert.equal(parsed.searchParams.get('teamId'), 'team_J91VWI0TqcHdcF36T7qVgiT1');
    assert.equal(init.headers?.Authorization, 'Bearer vercel-token');
    if (parsed.pathname === '/v10/projects/prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w/env') {
      if (vercelListStatus !== 200) return json({ error: { message: 'x' } }, vercelListStatus);
      return json({ envs: vercelEnvs });
    }
    const match = /^\/v1\/projects\/prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w\/env\/([^/]+)$/.exec(
      parsed.pathname,
    );
    if (match && vercelValues[match[1]]) return json(vercelValues[match[1]]);
    return json({ error: { code: 'not_found' } }, 404);
  };
  return { impl, calls };
}

async function runWith(options = {}, env = BASE_ENV) {
  const { impl, calls } = fakeFetch(options);
  let out = '';
  let stepSummary = '';
  const summary = await run({
    env,
    fetchImpl: impl,
    write: (text) => (out += text),
    appendSummary: (text) => (stepSummary += text),
  });
  return { summary, out, calls, stepSummary };
}

function statusLine(out, name) {
  const line = out.split('\n').find((l) => l.startsWith(`${name}:`));
  assert.ok(line, `missing line for ${name}`);
  return line.replace(/\s+/g, ' ');
}

function bodyAfterMasks(out) {
  return out
    .split('\n')
    .filter((line) => !line.startsWith('::add-mask::'))
    .join('\n');
}

function assertNoValues(out) {
  const body = bodyAfterMasks(out);
  for (const value of [
    JWT,
    REFRESH,
    STORE,
    OTHER_STORE,
    WEBHOOK,
    OTHER_VAR_VALUE,
    'short-secret',
  ]) {
    assert.ok(!body.includes(value), 'secret value leaked into output');
  }
  assert.ok(!out.includes(OTHER_VAR_VALUE), 'unchecked variable must not be touched');
}

test('모두 맞으면 전부 PASS, 값은 출력하지 않고 마스킹을 먼저 등록한다', async () => {
  const { summary, out, calls, stepSummary } = await runWith();
  assert.equal(summary.ok, true);
  assert.ok(!stepSummary.includes('::'), 'step summary must not carry mask commands');
  assert.match(stepSummary, /jwt_secret_set:\s+PASS/);
  for (const value of [JWT, REFRESH, STORE, WEBHOOK]) assert.ok(!stepSummary.includes(value));
  for (const name of CHECK_NAMES) assert.equal(summary.checks[name], true, name);
  assertNoValues(out);

  const lines = out.split('\n');
  const firstNonMask = lines.findIndex((line) => !line.startsWith('::add-mask::'));
  const maskLines = lines.slice(0, firstNonMask);
  for (const value of [JWT, REFRESH, STORE, WEBHOOK]) {
    assert.ok(maskLines.includes(`::add-mask::${value}`), 'value must be masked first');
  }
  assert.ok(lines.slice(firstNonMask).every((line) => !line.startsWith('::add-mask::')));

  // preview 전용 항목은 조회하지 않는다.
  assert.ok(!calls.some(({ url }) => url.includes('/env/env_prev')));
  assert.equal(
    statusLine(out, 'portone_store_id_matches_consumer'),
    'portone_store_id_matches_consumer: PASS',
  );
  const json = JSON.parse(lines.filter(Boolean).at(-1));
  assert.deepEqual(json, summary);
});

test('Actions 밖에서는 마스킹 명령(값 포함)을 출력하지 않는다', async () => {
  const { out } = await runWith({}, { ...BASE_ENV, GITHUB_ACTIONS: '' });
  assert.ok(!out.includes('::add-mask::'));
  for (const value of [JWT, REFRESH, STORE, WEBHOOK]) assert.ok(!out.includes(value));
});

test('store ID가 다르면 FAIL, exit 대상', async () => {
  const { summary, out } = await runWith({
    vercelValues: { env_prod: { type: 'encrypted', value: OTHER_STORE, decrypted: true } },
  });
  assert.equal(summary.checks.portone_store_id_matches_consumer, false);
  assert.equal(summary.ok, false);
  assertNoValues(out);
});

test('JWT 두 값이 같거나 짧으면 FAIL', async () => {
  const same = await runWith({ railwayVars: { ...BASE_RAILWAY, JWT_REFRESH_SECRET: JWT } });
  assert.equal(same.summary.checks.jwt_secrets_distinct, false);
  assert.equal(same.summary.ok, false);

  const short = await runWith({ railwayVars: { ...BASE_RAILWAY, JWT_SECRET: 'short-secret' } });
  assert.equal(short.summary.checks.jwt_secret_min_32_bytes, false);
  assert.equal(short.summary.checks.jwt_refresh_secret_min_32_bytes, true);
  assert.equal(short.summary.ok, false);
  assertNoValues(short.out);

  // 32바이트 경계는 UTF-8 바이트 기준이다(한글 11자 = 33바이트).
  const multibyte = evaluate({
    railway: { ...BASE_RAILWAY, JWT_SECRET: '가'.repeat(11), JWT_REFRESH_SECRET: 'x'.repeat(31) },
    vercel: { entries: [{ value: STORE, sensitive: false }] },
  });
  assert.equal(multibyte.jwt_secret_min_32_bytes.status, 'PASS');
  assert.equal(multibyte.jwt_refresh_secret_min_32_bytes.status, 'FAIL');
});

test('값이 없으면 set FAIL, 파생 점검은 UNKNOWN', async () => {
  const { summary, out } = await runWith({
    railwayVars: { JWT_SECRET: JWT, JWT_REFRESH_SECRET: '  ' },
    vercelEnvs: [],
  });
  assert.equal(summary.checks.jwt_secret_set, true);
  assert.equal(summary.checks.jwt_refresh_secret_set, false);
  assert.equal(summary.checks.jwt_secrets_distinct, null);
  assert.equal(summary.checks.jwt_refresh_secret_min_32_bytes, null);
  assert.equal(summary.checks.portone_store_id_set, false);
  assert.equal(summary.checks.portone_webhook_secret_set, false);
  assert.equal(summary.checks.consumer_portone_store_id_set, false);
  assert.equal(summary.checks.portone_store_id_matches_consumer, null);
  assert.equal(summary.ok, false);
  assertNoValues(out);
});

test('GOOGLE_GEMINI_BASE_URL이 있으면(빈 값 포함) FAIL', async () => {
  const present = await runWith({
    railwayVars: { ...BASE_RAILWAY, GOOGLE_GEMINI_BASE_URL: 'https://proxy.example' },
  });
  assert.equal(present.summary.checks.google_gemini_base_url_absent, false);
  assert.ok(!bodyAfterMasks(present.out).includes('proxy.example'));

  const empty = await runWith({ railwayVars: { ...BASE_RAILWAY, GOOGLE_GEMINI_BASE_URL: '' } });
  assert.equal(empty.summary.checks.google_gemini_base_url_absent, false);
});

test('sensitive 변수는 비교 불가(UNKNOWN)로 두고 실패로 보지 않는다', async () => {
  const listed = await runWith({
    vercelEnvs: [
      {
        id: 'env_prod',
        key: 'NEXT_PUBLIC_PORTONE_STORE_ID',
        type: 'sensitive',
        target: ['production'],
      },
    ],
  });
  assert.equal(listed.summary.checks.consumer_portone_store_id_set, true);
  assert.equal(listed.summary.checks.portone_store_id_matches_consumer, null);
  assert.match(
    statusLine(listed.out, 'portone_store_id_matches_consumer'),
    /UNKNOWN - cannot compare \(sensitive\)/,
  );
  assert.equal(listed.summary.ok, true);
  assert.ok(!listed.calls.some(({ url }) => url.includes('/env/env_prod')));

  const detail = await runWith({
    vercelValues: { env_prod: { type: 'sensitive', decrypted: false } },
  });
  assert.equal(detail.summary.checks.portone_store_id_matches_consumer, null);
  assert.equal(detail.summary.ok, true);
});

test('Railway API 오류: 응답 본문을 출력하지 않고 조회 FAIL, 나머지는 UNKNOWN', async () => {
  const http = await runWith({ railwayStatus: 500 });
  assert.equal(http.summary.checks.railway_variables_read, false);
  assert.equal(http.summary.checks.jwt_secret_set, null);
  assert.equal(http.summary.checks.portone_store_id_matches_consumer, null);
  assert.equal(http.summary.checks.consumer_portone_store_id_set, true);
  assert.equal(http.summary.ok, false);
  assert.match(http.out, /error: Railway 환경 확인 HTTP 500/);
  assert.ok(!http.out.includes(JWT));

  const gql = await runWith({ railwayErrors: [{ message: `Not Authorized ${JWT}` }] });
  assert.equal(gql.summary.checks.railway_variables_read, false);
  assert.match(gql.out, /GraphQL 오류 1건/);
  assert.ok(!gql.out.includes(JWT));
});

test('Vercel API 오류: 조회 FAIL, 비교는 UNKNOWN', async () => {
  const { summary, out } = await runWith({ vercelListStatus: 403 });
  assert.equal(summary.checks.vercel_consumer_env_read, false);
  assert.equal(summary.checks.consumer_portone_store_id_set, null);
  assert.equal(summary.checks.portone_store_id_matches_consumer, null);
  assert.equal(summary.checks.railway_variables_read, true);
  assert.equal(summary.ok, false);
  assert.match(out, /error: Vercel consumer 환경 변수 목록 HTTP 403/);
});

test('fetch 예외 메시지도 출력하지 않는다', async () => {
  let out = '';
  const summary = await run({
    env: BASE_ENV,
    fetchImpl: async () => {
      throw new Error(`boom ${JWT}`);
    },
    write: (text) => (out += text),
  });
  assert.equal(summary.ok, false);
  assert.ok(!out.includes(JWT));
});

test('토큰이 없으면 조회 FAIL', async () => {
  const { summary, calls } = await runWith({}, { GITHUB_ACTIONS: 'true' });
  assert.equal(summary.checks.railway_variables_read, false);
  assert.equal(summary.checks.vercel_consumer_env_read, false);
  assert.equal(summary.ok, false);
  assert.equal(calls.length, 0);
});

test('readRailwayVariables는 점검 대상 키만 고른다', async () => {
  const { impl } = fakeFetch();
  const masked = [];
  const picked = await readRailwayVariables({
    token: 't',
    serviceId: 'svc-api',
    fetchImpl: impl,
    mask: (v) => masked.push(v),
  });
  assert.deepEqual(Object.keys(picked).sort(), [
    'JWT_REFRESH_SECRET',
    'JWT_SECRET',
    'PORTONE_STORE_ID',
    'PORTONE_WEBHOOK_SECRET',
  ]);
  assert.ok(!masked.includes(OTHER_VAR_VALUE));
});

test('readConsumerStoreId는 production·브랜치 없는 항목만 본다', async () => {
  const { impl, calls } = fakeFetch({
    vercelEnvs: [
      { id: 'env_prod', key: 'NEXT_PUBLIC_PORTONE_STORE_ID', type: 'plain', target: 'production' },
      {
        id: 'env_branch',
        key: 'NEXT_PUBLIC_PORTONE_STORE_ID',
        type: 'plain',
        target: ['production'],
        gitBranch: 'x',
      },
      { id: 'env_other', key: 'NEXT_PUBLIC_API_URL', type: 'plain', target: ['production'] },
    ],
  });
  const result = await readConsumerStoreId({
    token: 'vercel-token',
    fetchImpl: impl,
    mask: () => {},
  });
  assert.deepEqual(result, { entries: [{ value: STORE, sensitive: false }] });
  assert.equal(calls.filter(({ url }) => url.includes('/v1/')).length, 1);
});

test('maskCommands는 여러 줄과 명령 특수문자를 처리한다', () => {
  assert.deepEqual(maskCommands(''), []);
  assert.deepEqual(maskCommands('a%b'), ['::add-mask::a%25b']);
  assert.deepEqual(maskCommands('line1\nline2'), [
    '::add-mask::line1%0Aline2',
    '::add-mask::line1',
    '::add-mask::line2',
  ]);
});

test('summarize: UNKNOWN은 null이고 ok를 깨지 않는다', () => {
  const checks = Object.fromEntries(CHECK_NAMES.map((name) => [name, { status: 'PASS' }]));
  checks.portone_store_id_matches_consumer = { status: 'UNKNOWN' };
  const summary = summarize(checks);
  assert.equal(summary.ok, true);
  assert.equal(summary.checks.portone_store_id_matches_consumer, null);
});
