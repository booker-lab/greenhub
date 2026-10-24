import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  baseTag,
  buildReleaseBody,
  main,
  parseResults,
  recordRelease,
  releaseName,
  runUrl,
} from './release-record.mjs';

const SHA = '7563488a1b2c3d4e5f60718293a4b5c6d7e8f901';
// 2026-10-23 22:10 UTC = 2026-10-24 07:10 KST. tag 날짜는 KST로 정한다.
const NOW = new Date('2026-10-23T22:10:00Z');
const RESULTS = [
  'indexes\t{"status":"READY"}',
  'railway\t{"ok":true,"deploymentId":"faa88380-1","environmentId":"env","status":"SUCCESS"}',
  'cloudrun-standby\t{"ok":true,"service":"greenhub-api","revision":"greenhub-api-00007","previous":"greenhub-api-00006","image":"img"}',
  'health\t{"ok":true,"commit":"7563488a1b2c3d4e5f60718293a4b5c6d7e8f901"}',
  'vercel\t{"ok":true,"app":"consumer","status":"deployed","deploymentId":"dpl_Consumer1","url":"c.vercel.app"}',
  'vercel\t{"ok":true,"app":"seller","status":"skipped","deploymentId":"dpl_Seller1","reason":"앱 변경 없음(빌드 생략)"}',
  'rules\t{"status":"deployed"}',
].join('\n');

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function githubFetch({
  releases = [],
  existingTags = [],
  notes = "## What's Changed\n* fix by @a in #639",
} = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body, auth: init.headers?.Authorization });
    if (method === 'GET' && url.endsWith('/releases?per_page=100')) return json(releases);
    if (method === 'GET' && url.includes('/git/ref/tags/')) {
      const tag = url.split('/git/ref/tags/')[1];
      return existingTags.includes(tag) ? json({ ref: `refs/tags/${tag}` }) : json({}, 404);
    }
    if (method === 'POST' && url.endsWith('/releases/generate-notes')) {
      return json({ name: 'x', body: notes });
    }
    if (method === 'POST' && url.endsWith('/releases')) {
      return json({ html_url: `https://github.test/releases/${body.tag_name}` }, 201);
    }
    return json({ message: 'unexpected' }, 500);
  };
  return { impl, calls };
}

const base = {
  sha: SHA,
  scope: 'all',
  apiPlatform: 'railway',
  e2eRunId: '39926207118',
  runId: '40000000001',
  results: parseResults(RESULTS),
  token: 't',
  now: NOW,
};

test('tag·이름은 KST 날짜와 SHA 앞 8자리로 만들고, 일부 범위·Cloud Run이면 이름에 적는다', () => {
  assert.equal(baseTag({ sha: SHA, now: NOW }), 'prod-20261024-7563488a');
  assert.equal(
    releaseName({ sha: SHA, scope: 'all', apiPlatform: 'railway', now: NOW }),
    '운영 배포 2026-10-24 · 7563488a',
  );
  assert.equal(
    releaseName({ sha: SHA, scope: 'frontends', apiPlatform: 'cloudrun', now: NOW }),
    '운영 배포 2026-10-24 · 7563488a · 범위 frontends · API cloudrun',
  );
});

test('결과 파일: 단계별 JSON을 읽고, JSON이 아닌 줄은 원문으로 남긴다', () => {
  const parsed = parseResults(`${RESULTS}\nweird\tnot-json\n\n`);
  assert.equal(parsed.length, 8);
  assert.equal(parsed[1].result.deploymentId, 'faa88380-1');
  assert.deepEqual(parsed[7], { step: 'weird', result: null, raw: 'not-json' });
});

test('본문: 배포 ID·직전 배포·변경 목록을 담는다', () => {
  const body = buildReleaseBody({
    ...base,
    previous: { tag_name: 'prod-20261023-951044f2', html_url: 'https://github.test/r/prev' },
    changes: '* fix in #639',
  });
  assert.match(body, new RegExp(`- SHA: \`${SHA}\``));
  assert.match(body, /- 범위: `all` · API: `railway`/);
  assert.ok(body.includes(`- 배포 run: ${runUrl('40000000001')}\n`));
  assert.ok(body.includes(`- 원격 회차 E2E run: ${runUrl('39926207118')}\n`));
  assert.match(body, /직전 배포: \[prod-20261023-951044f2\]\(https:\/\/github.test\/r\/prev\)/);
  assert.match(body, /\| Firestore 인덱스 \| 모두 READY \|/);
  assert.match(body, /\| API\(Railway\) \| 배포 `faa88380-1` SUCCESS \|/);
  assert.match(
    body,
    /\| Cloud Run 예비 서버 \| 리비전 `greenhub-api-00007` \(이전 `greenhub-api-00006`\) \|/,
  );
  assert.match(body, /\| API \/health \| commit `7563488a/);
  assert.match(body, /\| consumer\(Vercel\) \| `dpl_Consumer1` \|/);
  assert.match(
    body,
    /\| seller\(Vercel\) \| 빌드 생략 `dpl_Seller1` — .* 운영은 직전 배포 그대로 \|/,
  );
  assert.match(body, /\| Firestore·Storage 규칙 \| 배포됨 \|/);
  assert.match(body, /### 변경\n\n\* fix in #639/);
});

test('본문: 직전 Release·결과가 없으면 그렇다고 적고, 표 칸의 |는 이스케이프한다', () => {
  const body = buildReleaseBody({
    ...base,
    results: parseResults('odd\ta|b'),
    previous: null,
    changes: null,
  });
  assert.match(body, /직전 배포: Release 기록 없음/);
  assert.match(body, /직전 배포 Release가 없어 변경 목록을 생략했다/);
  assert.match(body, /\| odd \| `a\\\|b` \|/);
  const empty = buildReleaseBody({ ...base, results: [], previous: null, changes: null });
  assert.match(empty, /배포 결과가 전달되지 않았다/);
});

test('첫 기록: 직전 prod Release가 없으면 변경 목록 없이 만들고 Latest로 표시한다', async () => {
  const { impl, calls } = githubFetch({
    releases: [{ tag_name: 'v1.0.0', html_url: 'x', body: 'other' }],
  });
  const result = await recordRelease({ ...base, fetchImpl: impl });
  assert.deepEqual(result, {
    status: 'created',
    tag: 'prod-20261024-7563488a',
    url: 'https://github.test/releases/prod-20261024-7563488a',
    previous: null,
  });
  assert.ok(!calls.some((call) => call.url.endsWith('/generate-notes')));
  const create = calls.find((call) => call.method === 'POST' && call.url.endsWith('/releases'));
  assert.equal(create.body.target_commitish, SHA);
  assert.equal(create.body.make_latest, 'true');
  assert.equal(create.body.name, '운영 배포 2026-10-24 · 7563488a');
  assert.ok(calls.every((call) => call.auth === 'Bearer t'));
});

test('직전 prod Release와 비교한 변경 목록을 넣는다', async () => {
  const { impl, calls } = githubFetch({
    releases: [
      { tag_name: 'prod-20261023-951044f2', html_url: 'https://github.test/r/prev', body: '' },
      { tag_name: 'prod-20261020-71085566', html_url: 'https://github.test/r/older', body: '' },
    ],
  });
  const result = await recordRelease({ ...base, fetchImpl: impl });
  assert.equal(result.previous, 'prod-20261023-951044f2');
  const notes = calls.find((call) => call.url.endsWith('/generate-notes'));
  assert.deepEqual(notes.body, {
    tag_name: 'prod-20261024-7563488a',
    target_commitish: SHA,
    previous_tag_name: 'prod-20261023-951044f2',
  });
  const create = calls.find((call) => call.method === 'POST' && call.url.endsWith('/releases'));
  assert.match(create.body.body, /fix by @a in #639/);
});

test('같은 이름 tag가 이미 있으면(같은 날 같은 SHA 재배포) run ID를 붙인다', async () => {
  const fromRelease = githubFetch({
    releases: [{ tag_name: 'prod-20261024-7563488a', html_url: 'x', body: '- 배포 run: other' }],
  });
  const first = await recordRelease({ ...base, fetchImpl: fromRelease.impl });
  assert.equal(first.tag, 'prod-20261024-7563488a-40000000001');

  const fromTag = githubFetch({ existingTags: ['prod-20261024-7563488a'] });
  const second = await recordRelease({ ...base, fetchImpl: fromTag.impl });
  assert.equal(second.tag, 'prod-20261024-7563488a-40000000001');
});

test('같은 배포 run의 Release가 이미 있으면 새로 만들지 않는다(job 재실행)', async () => {
  const { impl, calls } = githubFetch({
    releases: [
      {
        tag_name: 'prod-20261024-7563488a',
        html_url: 'https://github.test/r/same',
        body: `## 운영 배포 기록\n\n- 배포 run: ${runUrl('40000000001')}\n`,
      },
    ],
  });
  const result = await recordRelease({ ...base, fetchImpl: impl });
  assert.deepEqual(result, {
    status: 'exists',
    tag: 'prod-20261024-7563488a',
    url: 'https://github.test/r/same',
  });
  assert.ok(calls.every((call) => call.method === 'GET'));
});

test('run ID가 앞부분만 같은 다른 run의 Release는 같은 run으로 보지 않는다', async () => {
  const { impl } = githubFetch({
    releases: [
      {
        tag_name: 'prod-20261023-951044f2',
        html_url: 'x',
        body: `- 배포 run: ${runUrl('400000000011')}\n`,
      },
    ],
  });
  const result = await recordRelease({ ...base, fetchImpl: impl });
  assert.equal(result.status, 'created');
});

test('일부 범위 배포는 Latest로 표시하지 않는다', async () => {
  const { impl, calls } = githubFetch();
  await recordRelease({ ...base, scope: 'rules', fetchImpl: impl });
  const create = calls.find((call) => call.method === 'POST' && call.url.endsWith('/releases'));
  assert.equal(create.body.make_latest, 'false');
});

test('입력이 잘못되면 GitHub를 부르기 전에 멈춘다', async () => {
  const { impl, calls } = githubFetch();
  await assert.rejects(recordRelease({ ...base, sha: 'abc', fetchImpl: impl }), /40자리/);
  await assert.rejects(recordRelease({ ...base, scope: 'db', fetchImpl: impl }), /scope/);
  await assert.rejects(
    recordRelease({ ...base, apiPlatform: 'fly', fetchImpl: impl }),
    /api-platform/,
  );
  await assert.rejects(recordRelease({ ...base, runId: '12a', fetchImpl: impl }), /run-id/);
  await assert.rejects(recordRelease({ ...base, e2eRunId: '', fetchImpl: impl }), /e2e-run-id/);
  await assert.rejects(recordRelease({ ...base, token: '', fetchImpl: impl }), /GITHUB_TOKEN/);
  assert.equal(calls.length, 0);
});

test('GitHub 오류는 상태 코드와 함께 실패로 올린다', async () => {
  const impl = async () => json({ message: 'Resource not accessible by integration' }, 403);
  await assert.rejects(recordRelease({ ...base, fetchImpl: impl }), /HTTP 403/);
});

test('main: 인자와 결과 파일을 읽어 기록한다', async () => {
  const { impl, calls } = githubFetch();
  const result = await main(
    [
      `--sha=${SHA}`,
      '--scope=all',
      '--api-platform=railway',
      '--e2e-run-id=39926207118',
      '--run-id=40000000001',
      '--results=/fixture/results.tsv',
    ],
    { env: { GITHUB_TOKEN: ' t ' }, fetchImpl: impl, readFile: () => RESULTS, now: NOW },
  );
  assert.equal(result.status, 'created');
  const create = calls.find((call) => call.method === 'POST' && call.url.endsWith('/releases'));
  assert.match(create.body.body, /dpl_Consumer1/);
  await assert.rejects(main(['--sha'], { env: {}, fetchImpl: impl }), /알 수 없는 인자/);
});
