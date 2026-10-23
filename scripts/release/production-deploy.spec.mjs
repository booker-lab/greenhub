import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildVercelProductionBody,
  deployCloudRun,
  deployRailway,
  deployVercel,
  main,
  resolveProductionApiBase,
  verifyE2eRun,
  waitHealthCommit,
} from './production-deploy.mjs';

const SHA = 'bd159830b238458fff2e566d7397f3b7ade321aa';
const OTHER = '55ed02d9662096a30b6d8c6c4794a0d818948768';
const noSleep = async () => {};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function githubFetch({
  path = '.github/workflows/e2e-round-direct.yml',
  conclusion = 'success',
  headBranch = 'main',
  event = 'workflow_dispatch',
  log,
} = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (url.endsWith('/runs/123')) {
      return json({
        path,
        head_branch: headBranch,
        event,
        status: 'completed',
        conclusion,
        html_url: 'https://github.test/run/123',
      });
    }
    if (url.includes('/runs/123/jobs')) {
      return json({
        jobs: [
          { id: 9, name: '비운영 E2E 승인 사전 검증' },
          { id: 10, name: 'e2e' },
        ],
      });
    }
    if (url.endsWith('/jobs/9/logs')) {
      return new Response(log ?? `run_id=123\n2026-10-12T15:00:00Z expected_sha=${SHA}\n`);
    }
    return json({}, 404);
  };
  return { impl, calls };
}

test('verify-e2e: 같은 SHA로 통과한 회차 E2E만 받는다', async () => {
  const { impl } = githubFetch();
  const result = await verifyE2eRun({ sha: SHA, runId: '123', token: 't', fetchImpl: impl });
  assert.equal(result.runId, 123);
});

test('verify-e2e: 다른 SHA·실패·다른 workflow는 거부한다', async () => {
  await assert.rejects(
    verifyE2eRun({
      sha: SHA,
      runId: '123',
      token: 't',
      fetchImpl: githubFetch({ log: `expected_sha=${OTHER}\n` }).impl,
    }),
    /검증 대상 SHA/,
  );
  await assert.rejects(
    verifyE2eRun({
      sha: SHA,
      runId: '123',
      token: 't',
      fetchImpl: githubFetch({ log: `expected_sha=${SHA}0\n` }).impl,
    }),
    /검증 대상 SHA/,
  );
  await assert.rejects(
    verifyE2eRun({
      sha: SHA,
      runId: '123',
      token: 't',
      fetchImpl: githubFetch({ conclusion: 'failure' }).impl,
    }),
    /통과하지 않았습니다/,
  );
  await assert.rejects(
    verifyE2eRun({
      sha: SHA,
      runId: '123',
      token: 't',
      fetchImpl: githubFetch({ path: '.github/workflows/ci.yml' }).impl,
    }),
    /회차 E2E가 아닙니다/,
  );
  await assert.rejects(
    verifyE2eRun({ sha: SHA, runId: 'abc', token: 't', fetchImpl: githubFetch().impl }),
    /숫자/,
  );
});

test('verify-e2e: main이 아닌 브랜치·수동 실행이 아닌 run은 로그를 보기 전에 거부한다', async () => {
  for (const options of [
    { headBranch: 'feature/skip-tests' },
    { headBranch: null },
    { event: 'push' },
    { event: 'pull_request', headBranch: 'main' },
  ]) {
    const { impl, calls } = githubFetch(options);
    await assert.rejects(
      verifyE2eRun({ sha: SHA, runId: '123', token: 't', fetchImpl: impl }),
      /main에서 수동 실행한 회차 E2E가 아닙니다/,
      JSON.stringify(options),
    );
    assert.equal(calls.length, 1, '실행 브랜치가 틀리면 job·로그를 조회하지 않는다');
  }
});

function railwayFetch(statuses, { deployResult = 'dep_1' } = {}) {
  const requests = [];
  let poll = 0;
  const impl = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, headers: init.headers, body });
    if (body.query.includes('projectToken')) {
      return json({ data: { projectToken: { projectId: 'p1', environmentId: 'env_prod' } } });
    }
    if (body.query.includes('serviceInstanceDeployV2')) {
      return json({ data: { serviceInstanceDeployV2: deployResult } });
    }
    return json({
      data: {
        deployment: { id: 'dep_1', status: statuses[Math.min(poll++, statuses.length - 1)] },
      },
    });
  };
  return { impl, requests };
}

test('railway: 지정 SHA로 배포하고 SUCCESS까지 기다린다', async () => {
  const { impl, requests } = railwayFetch(['BUILDING', 'DEPLOYING', 'SUCCESS']);
  const result = await deployRailway({
    sha: SHA,
    token: 'tok',
    serviceId: 'svc',
    fetchImpl: impl,
    sleep: noSleep,
  });
  assert.deepEqual(result, { deploymentId: 'dep_1', environmentId: 'env_prod', status: 'SUCCESS' });
  const deploy = requests.find((r) => r.body.query.includes('serviceInstanceDeployV2'));
  assert.deepEqual(deploy.body.variables, {
    serviceId: 'svc',
    environmentId: 'env_prod',
    commitSha: SHA,
  });
  assert.equal(deploy.headers['Project-Access-Token'], 'tok');
});

test('railway: FAILED·CRASHED는 실패로 끝낸다', async () => {
  for (const status of ['FAILED', 'CRASHED']) {
    const { impl } = railwayFetch(['BUILDING', status]);
    await assert.rejects(
      deployRailway({ sha: SHA, token: 'tok', serviceId: 'svc', fetchImpl: impl, sleep: noSleep }),
      new RegExp(status),
    );
  }
});

test('railway: GraphQL 오류를 그대로 드러낸다', async () => {
  const impl = async () => json({ errors: [{ message: 'Not Authorized' }] });
  await assert.rejects(
    deployRailway({ sha: SHA, token: 'tok', serviceId: 'svc', fetchImpl: impl, sleep: noSleep }),
    /Not Authorized/,
  );
});

test('health: 이전 SHA가 응답하는 동안 기다렸다가 새 SHA를 확인한다', async () => {
  const commits = [OTHER, OTHER, SHA];
  let i = 0;
  const impl = async () => json({ status: 'ok', commit: commits[i++] });
  assert.deepEqual(
    await waitHealthCommit({
      sha: SHA,
      apiBase: 'https://api.test',
      fetchImpl: impl,
      sleep: noSleep,
    }),
    {
      commit: SHA,
    },
  );
});

test('health: 끝까지 바뀌지 않으면 실패한다', async () => {
  const impl = async () => json({ status: 'ok', commit: OTHER });
  await assert.rejects(
    waitHealthCommit({
      sha: SHA,
      apiBase: 'https://api.test',
      fetchImpl: impl,
      sleep: noSleep,
      timeoutMs: -1,
    }),
    new RegExp(OTHER),
  );
});

test('vercel: 운영 대상·Git 원본 SHA로 배포 본문을 만든다', () => {
  assert.deepEqual(buildVercelProductionBody({ app: 'seller', sha: SHA }), {
    name: 'greenhub-seller',
    project: 'prj_OPOveVw4QADTbTE7mt32mo14H5dv',
    target: 'production',
    gitSource: { type: 'github', org: 'booker-lab', repo: 'greenhub', ref: 'main', sha: SHA },
  });
  assert.throws(() => buildVercelProductionBody({ app: 'api', sha: SHA }), /알 수 없는 앱/);
});

function vercelFetch(states, { target = 'production', gitSha = SHA } = {}) {
  let poll = 0;
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    if (init.method === 'POST') return json({ id: 'dpl_abc', readyState: 'QUEUED' });
    return json({
      id: 'dpl_abc',
      readyState: states[Math.min(poll++, states.length - 1)],
      target,
      url: 'greenhub-seller-x.vercel.app',
      meta: { githubCommitSha: gitSha },
    });
  };
  return { impl, calls };
}

test('vercel: READY와 SHA·운영 대상을 확인한다', async () => {
  const { impl, calls } = vercelFetch(['BUILDING', 'READY']);
  const result = await deployVercel({
    app: 'seller',
    sha: SHA,
    token: 't',
    fetchImpl: impl,
    sleep: noSleep,
  });
  assert.equal(result.status, 'deployed');
  assert.equal(result.deploymentId, 'dpl_abc');
  assert.match(calls[0].url, /teamId=team_/);
});

test('vercel: 빌드 생략(CANCELED)은 skipped, ERROR·SHA 불일치·비운영은 실패', async () => {
  const skipped = await deployVercel({
    app: 'driver',
    sha: SHA,
    token: 't',
    fetchImpl: vercelFetch(['CANCELED']).impl,
    sleep: noSleep,
  });
  assert.equal(skipped.status, 'skipped');
  // 환경 변수만 바꾼 같은 SHA 재배포는 빌드가 생략되면 새 값이 반영되지 않으므로 실패로 본다.
  await assert.rejects(
    deployVercel({
      app: 'driver',
      sha: SHA,
      token: 't',
      requireBuild: true,
      fetchImpl: vercelFetch(['CANCELED']).impl,
      sleep: noSleep,
    }),
    /빌드가 생략됐습니다/,
  );
  await assert.rejects(
    deployVercel({
      app: 'driver',
      sha: SHA,
      token: 't',
      fetchImpl: vercelFetch(['ERROR']).impl,
      sleep: noSleep,
    }),
    /ERROR/,
  );
  await assert.rejects(
    deployVercel({
      app: 'driver',
      sha: SHA,
      token: 't',
      fetchImpl: vercelFetch(['READY'], { gitSha: OTHER }).impl,
      sleep: noSleep,
    }),
    /SHA 불일치/,
  );
  await assert.rejects(
    deployVercel({
      app: 'driver',
      sha: SHA,
      token: 't',
      fetchImpl: vercelFetch(['READY'], { target: null }).impl,
      sleep: noSleep,
    }),
    /운영 대상이 아닙니다/,
  );
});

test('main: 자격 증명이 없거나 인자가 틀리면 요청 전에 멈춘다', async () => {
  const fetchImpl = async () => {
    throw new Error('요청하면 안 됨');
  };
  await assert.rejects(main(['railway', `--sha=${SHA}`], { env: {}, fetchImpl }), /RAILWAY_TOKEN/);
  await assert.rejects(
    main(['vercel', `--sha=${SHA}`, '--app=api'], { env: {}, fetchImpl }),
    /--app/,
  );
  await assert.rejects(main(['railway', '--sha=bd159830'], { env: {}, fetchImpl }), /40자리/);
  await assert.rejects(main(['deploy-all', `--sha=${SHA}`], { env: {}, fetchImpl }), /명령은/);
});

const DIGEST = `sha256:${'a'.repeat(64)}`;
const RUN_BASE = 'https://greenhub-api-988412563635.asia-northeast3.run.app';
const IMAGE_REPO = 'asia-northeast3-docker.pkg.dev/green-e4fe3/greenhub/api';

function fakeGcloud({
  digest = DIGEST,
  before = { revision: 'greenhub-api-00041-old' },
  created = 'greenhub-api-00042-new',
  ready = created,
} = {}) {
  const calls = [];
  let describes = 0;
  const impl = async (args) => {
    calls.push(args);
    const [group, sub, verb] = args;
    if (group === 'artifacts') return `${digest}\n`;
    if (group === 'run' && sub === 'services' && verb === 'describe') {
      describes += 1;
      const traffic = before.revision ? [{ revisionName: before.revision, percent: 100 }] : [];
      return JSON.stringify({
        status:
          describes === 1
            ? { latestCreatedRevisionName: before.revision, traffic }
            : { latestCreatedRevisionName: created, latestReadyRevisionName: ready, traffic },
      });
    }
    return '';
  };
  return { calls, impl };
}

const trafficCalls = (calls) =>
  calls.filter((args) => args[2] === 'update-traffic').map((args) => args.at(-2));

test('cloudrun: 시작 검사를 통과한 새 리비전에만 트래픽을 옮기고 공개 /health로 SHA를 확인한다', async () => {
  const gcloud = fakeGcloud();
  const healthUrls = [];
  const commits = [OTHER, SHA];
  let i = 0;
  const fetchImpl = async (url) => {
    healthUrls.push(url);
    return json({ status: 'ok', commit: commits[i++] });
  };
  const result = await deployCloudRun({ sha: SHA, gcloud: gcloud.impl, fetchImpl, sleep: noSleep });

  assert.deepEqual(result, {
    service: 'greenhub-api',
    revision: 'greenhub-api-00042-new',
    previous: 'greenhub-api-00041-old',
    image: `${IMAGE_REPO}@${DIGEST}`,
  });
  assert.deepEqual(healthUrls, [`${RUN_BASE}/health`, `${RUN_BASE}/health`]);
  assert.deepEqual(gcloud.calls[0].slice(0, 5), [
    'artifacts',
    'docker',
    'images',
    'describe',
    `${IMAGE_REPO}:${SHA}`,
  ]);
  assert.deepEqual(gcloud.calls[2], [
    'run',
    'deploy',
    'greenhub-api',
    '--project=green-e4fe3',
    '--region=asia-northeast3',
    `--image=${IMAGE_REPO}@${DIGEST}`,
    '--no-traffic',
    `--update-env-vars=GREENHUB_COMMIT_SHA=${SHA}`,
    '--quiet',
  ]);
  assert.deepEqual(trafficCalls(gcloud.calls), ['--to-revisions=greenhub-api-00042-new=100']);
});

test('cloudrun: 공개 /health가 끝내 SHA가 아니면 이전 리비전으로 되돌리고 실패한다', async () => {
  const gcloud = fakeGcloud();
  const fetchImpl = async () => json({ status: 'ok', commit: OTHER });
  await assert.rejects(
    deployCloudRun({
      sha: SHA,
      gcloud: gcloud.impl,
      fetchImpl,
      sleep: noSleep,
      healthTimeoutMs: -1,
    }),
    /이전 리비전 greenhub-api-00041-old/,
  );
  assert.deepEqual(trafficCalls(gcloud.calls), [
    '--to-revisions=greenhub-api-00042-new=100',
    '--to-revisions=greenhub-api-00041-old=100',
  ]);
});

test('cloudrun: digest를 못 읽거나 새 리비전이 없거나 Ready가 아니면 트래픽을 옮기지 않는다', async () => {
  const fetchImpl = async () => {
    throw new Error('요청하면 안 됨');
  };
  const noDigest = fakeGcloud({ digest: '' });
  await assert.rejects(
    deployCloudRun({ sha: SHA, gcloud: noDigest.impl, fetchImpl, sleep: noSleep }),
    /digest/,
  );
  assert.equal(noDigest.calls.length, 1);

  const notCreated = fakeGcloud({ created: 'greenhub-api-00041-old' });
  await assert.rejects(
    deployCloudRun({ sha: SHA, gcloud: notCreated.impl, fetchImpl, sleep: noSleep }),
    /새 리비전을 만들지 않았습니다/,
  );
  const notReady = fakeGcloud({ ready: 'greenhub-api-00041-old' });
  await assert.rejects(
    deployCloudRun({ sha: SHA, gcloud: notReady.impl, fetchImpl, sleep: noSleep }),
    /Ready가 아닙니다/,
  );
  assert.deepEqual(trafficCalls([...notCreated.calls, ...notReady.calls]), []);
});

test('cloudrun: 첫 배포처럼 되돌릴 리비전이 없으면 되돌리지 않고 실패만 한다', async () => {
  const gcloud = fakeGcloud({ before: { revision: null } });
  const fetchImpl = async () => json({ status: 'ok', commit: OTHER });
  await assert.rejects(
    deployCloudRun({
      sha: SHA,
      gcloud: gcloud.impl,
      fetchImpl,
      sleep: noSleep,
      healthTimeoutMs: -1,
    }),
    new RegExp(OTHER),
  );
  assert.deepEqual(trafficCalls(gcloud.calls), ['--to-revisions=greenhub-api-00042-new=100']);
});

test('health --api-base: 운영 API origin만 받는다', () => {
  assert.equal(resolveProductionApiBase(undefined), 'https://api-production-13e7.up.railway.app');
  assert.equal(
    resolveProductionApiBase('https://greenhub-api-988412563635.asia-northeast3.run.app'),
    'https://greenhub-api-988412563635.asia-northeast3.run.app',
  );
  assert.equal(
    resolveProductionApiBase('https://api.greenlove.co.kr'),
    'https://api.greenlove.co.kr',
  );
  for (const value of [
    'https://api-staging-94af.up.railway.app',
    'http://api.greenlove.co.kr',
    'https://api.greenlove.co.kr/health',
    'https://api.greenlove.co.kr/',
    'not a url',
  ]) {
    assert.throws(() => resolveProductionApiBase(value), /--api-base/, value);
  }
});

test('main: cloudrun은 주입한 gcloud로 배포하고 health는 --api-base 주소를 본다', async () => {
  const gcloud = fakeGcloud();
  const deployUrls = [];
  const fetchImpl = async (url) => {
    deployUrls.push(url);
    return json({ status: 'ok', commit: SHA });
  };
  const deployed = await main(
    ['cloudrun', `--sha=${SHA}`, '--api-base=https://api.greenlove.co.kr'],
    { env: {}, fetchImpl, sleep: noSleep, gcloud: gcloud.impl },
  );
  assert.equal(deployed.revision, 'greenhub-api-00042-new');
  assert.deepEqual(deployUrls, ['https://api.greenlove.co.kr/health']);
  await assert.rejects(
    main(['cloudrun', `--sha=${SHA}`, '--api-base=https://api.example.test'], {
      env: {},
      fetchImpl,
      sleep: noSleep,
      gcloud: fakeGcloud().impl,
    }),
    /--api-base/,
  );

  const urls = [];
  await main(['health', `--sha=${SHA}`, '--api-base=https://api.greenlove.co.kr'], {
    env: {},
    sleep: noSleep,
    fetchImpl: async (url) => {
      urls.push(url);
      return json({ status: 'ok', commit: SHA });
    },
  });
  assert.deepEqual(urls, ['https://api.greenlove.co.kr/health']);
});
