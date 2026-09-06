import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  collectCommitStatusDiagnostic,
  collectDeploymentEvidence,
  inspectAppDeployment,
  normalizeTargetUrl,
  PREVIEW_APPS,
  requestVercelDeployment,
  VERCEL_API_ORIGIN,
  VERCEL_CREDENTIAL_NAME,
  VERCEL_TEAM_ID,
  vercelDeploymentPath,
} from './wait-preview-deploy.mjs';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const DEPLOYMENT_IDS = {
  consumer: 'dpl_An5V2zjbSeSHddGx74hgc1stTpn1',
  seller: 'dpl_9QnoA76oQd9NxFHnQhGQh3iGKNX6',
  driver: 'dpl_Hn8EBp56x5ayyMVEPoeD8AiJUhja',
};

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function validDeployment(app, overrides = {}) {
  const config = PREVIEW_APPS.find(({ app: name }) => name === app);
  const deploymentId = DEPLOYMENT_IDS[app];
  return {
    id: deploymentId,
    uid: deploymentId,
    name: config.project,
    projectId: config.projectId,
    project: {
      id: config.projectId,
      name: config.project,
    },
    state: 'READY',
    readyState: 'READY',
    target: null,
    url: `${config.project}-abc123.vercel.app`,
    meta: {
      githubCommitSha: SHA,
      githubCommitRef: 'preview',
      githubCommitOrg: 'booker-lab',
      githubCommitRepo: 'greenhub',
    },
    ...overrides,
  };
}

function validDeployments(overrides = {}) {
  return Object.fromEntries(
    PREVIEW_APPS.map(({ app }) => [app, validDeployment(app, overrides[app])]),
  );
}

function collectWith(deployments = validDeployments(), options = {}) {
  const calls = [];
  const request = async (deploymentId, app) => {
    calls.push({ deploymentId, app });
    return deployments[app];
  };
  return {
    calls,
    promise: collectDeploymentEvidence(SHA, DEPLOYMENT_IDS, {
      request,
      ...options,
    }),
  };
}

async function assertFailure(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

describe('Vercel pinned Preview deployment metadata 증거 계약', () => {
  it('일반 target URL은 안전한 HTTPS 주소만 정규화한다', () => {
    assert.equal(
      normalizeTargetUrl(' https://preview.example.test/ '),
      'https://preview.example.test',
    );
    assert.equal(normalizeTargetUrl('http://preview.example.test'), null);
    assert.equal(normalizeTargetUrl('https://preview.example.test/?x=1'), null);
    assert.equal(normalizeTargetUrl('https://user:pass@preview.example.test'), null);
    assert.equal(normalizeTargetUrl('https://preview.example.test:8443'), null);
  });

  it('Vercel GET 경로는 team과 pinned deployment ID에 고정된다', () => {
    assert.equal(
      vercelDeploymentPath(DEPLOYMENT_IDS.consumer),
      `/v13/deployments/${DEPLOYMENT_IDS.consumer}?teamId=${VERCEL_TEAM_ID}`,
    );
  });

  it('세 pinned deployment가 프로젝트·SHA·READY·Preview·안전 URL이면 통과한다', async () => {
    const { promise, calls } = collectWith();
    const evidence = await promise;

    assert.equal(evidence.ready, true);
    assert.equal(evidence.retryable, false);
    assert.equal(evidence.evidenceSource, 'vercel-deployment-metadata');
    assert.equal(evidence.expectedSha, SHA);
    assert.deepEqual(evidence.pinnedDeploymentIds, DEPLOYMENT_IDS);
    assert.deepEqual(evidence.deploymentIds, DEPLOYMENT_IDS);
    assert.deepEqual(evidence.deploymentShas, {
      consumer: SHA,
      seller: SHA,
      driver: SHA,
    });
    assert.deepEqual(evidence.deploymentStates, {
      consumer: 'READY',
      seller: 'READY',
      driver: 'READY',
    });
    assert.deepEqual(
      calls.map(({ deploymentId }) => deploymentId),
      [DEPLOYMENT_IDS.consumer, DEPLOYMENT_IDS.seller, DEPLOYMENT_IDS.driver],
    );
    assert.deepEqual(
      evidence.apps.map(
        ({ app, project, deploymentId, deploymentSha, target, targetUrl, ready }) => ({
          app,
          project,
          deploymentId,
          deploymentSha,
          target,
          targetUrl,
          ready,
        }),
      ),
      PREVIEW_APPS.map(({ app, project }) => ({
        app,
        project,
        deploymentId: DEPLOYMENT_IDS[app],
        deploymentSha: SHA,
        target: null,
        targetUrl: `https://${project}-abc123.vercel.app`,
        ready: true,
      })),
    );
  });

  it('Vercel API의 중첩 deployment 응답도 직접 metadata로 검증한다', () => {
    const result = inspectAppDeployment('consumer', DEPLOYMENT_IDS.consumer, SHA, {
      deployment: validDeployment('consumer'),
    });

    assert.equal(result.ready, true);
    assert.equal(result.projectId, 'prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w');
  });

  it('잘못된 project identity는 거부한다', async () => {
    const deployments = validDeployments({
      seller: {
        projectId: 'prj_wrong',
        project: { id: 'prj_wrong', name: 'wrong-project' },
        name: 'wrong-project',
      },
    });
    const evidence = await collectWith(deployments).promise;
    const seller = evidence.apps.find(({ app }) => app === 'seller');

    assert.equal(evidence.ready, false);
    assert.equal(seller.failureCode, 'VERCEL_PROJECT_MISMATCH');
  });

  it('잘못된 githubCommitSha는 거부한다', async () => {
    const deployments = validDeployments({
      consumer: { meta: { githubCommitSha: OTHER_SHA } },
    });
    const evidence = await collectWith(deployments).promise;
    const consumer = evidence.apps.find(({ app }) => app === 'consumer');

    assert.equal(evidence.ready, false);
    assert.equal(consumer.deploymentSha, OTHER_SHA);
    assert.equal(consumer.failureCode, 'VERCEL_GITHUB_COMMIT_SHA_MISMATCH');
  });

  it('ERROR와 CANCELED 상태는 READY로 추정하지 않는다', async () => {
    for (const state of ['ERROR', 'CANCELED']) {
      const deployments = validDeployments({
        driver: { state, readyState: state },
      });
      const evidence = await collectWith(deployments).promise;
      const driver = evidence.apps.find(({ app }) => app === 'driver');

      assert.equal(evidence.ready, false);
      assert.equal(driver.state, state);
      assert.equal(driver.failureCode, 'VERCEL_NOT_READY');
      assert.equal(driver.retryable, false);
    }
  });

  it('BUILDING 상태만 재조회 가능한 미완료 상태로 남긴다', async () => {
    const evidence = await collectWith(
      validDeployments({ consumer: { state: 'BUILDING', readyState: 'BUILDING' } }),
    ).promise;
    const consumer = evidence.apps.find(({ app }) => app === 'consumer');

    assert.equal(evidence.ready, false);
    assert.equal(evidence.retryable, true);
    assert.equal(consumer.failureCode, 'VERCEL_NOT_READY');
    assert.equal(consumer.retryable, true);
  });

  it('production target는 SHA와 READY가 맞아도 거부한다', async () => {
    const evidence = await collectWith(validDeployments({ seller: { target: 'production' } }))
      .promise;
    const seller = evidence.apps.find(({ app }) => app === 'seller');

    assert.equal(evidence.ready, false);
    assert.equal(seller.failureCode, 'VERCEL_TARGET_NOT_PREVIEW');
  });

  it('URL이 없거나 안전하지 않으면 거부한다', async () => {
    for (const url of [
      undefined,
      'http://seller-abc123.vercel.app',
      'https://seller-abc123.vercel.app/?x=1',
    ]) {
      const evidence = await collectWith(validDeployments({ seller: { url } })).promise;
      const seller = evidence.apps.find(({ app }) => app === 'seller');

      assert.equal(evidence.ready, false);
      assert.match(seller.failureCode, /^VERCEL_URL_/);
      assert.equal(seller.targetUrl, null);
    }
  });

  it('Vercel read credential이 없으면 fail-closed한다', async () => {
    await assertFailure(
      collectDeploymentEvidence(SHA, DEPLOYMENT_IDS, {
        vercelToken: '',
        fetchImpl: async () => {
          throw new Error('호출되면 안 됨');
        },
      }),
      'VERCEL_READ_TOKEN_REQUIRED',
    );
  });

  it('잘못된 credential의 HTTP 401은 성공으로 숨기지 않는다', async () => {
    const calls = [];
    const evidence = await collectDeploymentEvidence(SHA, DEPLOYMENT_IDS, {
      vercelToken: 'opaque-test-token',
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({ error: { code: 'forbidden' } }, 401);
      },
    });

    assert.equal(evidence.ready, false);
    assert.equal(evidence.retryable, false);
    assert.deepEqual(
      evidence.failureCodes,
      PREVIEW_APPS.map(({ app }) => ({ app, code: 'VERCEL_API_HTTP_401' })),
    );
    assert.equal(JSON.stringify(evidence).includes('opaque-test-token'), false);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer opaque-test-token');
  });

  it('직접 fetch는 Vercel deployment GET만 호출한다', async () => {
    const calls = [];
    const deployments = validDeployments();
    const evidence = await collectDeploymentEvidence(SHA, DEPLOYMENT_IDS, {
      vercelToken: 'opaque-test-token',
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        const deploymentId = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
        const app = Object.entries(DEPLOYMENT_IDS).find(([, id]) => id === deploymentId)?.[0];
        return response(deployments[app]);
      },
    });

    assert.equal(evidence.ready, true);
    assert.equal(calls.length, 3);
    for (const { url, init } of calls) {
      assert.equal(url.startsWith(`${VERCEL_API_ORIGIN}/v13/deployments/`), true);
      assert.equal(new URL(url).searchParams.get('teamId'), VERCEL_TEAM_ID);
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.Accept, 'application/json');
    }
  });

  it('더 최신 deployment가 있어도 전달한 pinned ID만 조회한다', async () => {
    const calls = [];
    const deployments = validDeployments();
    const newerDeployment = validDeployment('consumer', {
      id: 'dpl_newerDeploymentIgnored',
      uid: 'dpl_newerDeploymentIgnored',
      meta: { githubCommitSha: 'c'.repeat(40) },
    });
    const evidence = await collectDeploymentEvidence(SHA, DEPLOYMENT_IDS, {
      request: async (deploymentId, app) => {
        calls.push(deploymentId);
        assert.equal(deploymentId, DEPLOYMENT_IDS[app]);
        return deployments[app];
      },
    });

    assert.equal(evidence.ready, true);
    assert.equal(newerDeployment.meta.githubCommitSha, 'c'.repeat(40));
    assert.deepEqual(calls, [
      DEPLOYMENT_IDS.consumer,
      DEPLOYMENT_IDS.seller,
      DEPLOYMENT_IDS.driver,
    ]);
    assert.deepEqual(evidence.deploymentIds, DEPLOYMENT_IDS);
  });

  it('stale GitHub status는 직접 Vercel evidence의 결과를 override하지 않는다', async () => {
    const evidence = await collectWith().promise;

    assert.equal(evidence.ready, true);
    assert.equal(evidence.evidenceSource, 'vercel-deployment-metadata');
    assert.equal(Object.hasOwn(evidence, 'statusStates'), false);
  });

  it('GitHub status diagnostic은 canonical deployment evidence와 별도로 표시한다', () => {
    const diagnostic = collectCommitStatusDiagnostic(SHA, (apiPath) => {
      assert.equal(apiPath, `repos/booker-lab/greenhub/commits/${SHA}/statuses?per_page=100`);
      return [
        {
          id: 1,
          context: 'Vercel – greenhubconsumer',
          sha: OTHER_SHA,
          state: 'failure',
          target_url: 'https://status.example.test',
        },
      ];
    });

    assert.equal(diagnostic.diagnostic, true);
    assert.equal(diagnostic.evidenceSource, 'github-commit-status-diagnostic');
    assert.equal(Object.hasOwn(diagnostic, 'ready'), false);
    assert.equal(diagnostic.apps.find(({ app }) => app === 'consumer').state, 'failure');
  });

  it('pinned ID와 expected SHA가 없으면 contract를 거부한다', async () => {
    await assertFailure(
      collectDeploymentEvidence(
        SHA,
        { ...DEPLOYMENT_IDS, driver: '' },
        { request: async () => ({}) },
      ),
      'DEPLOYMENT_ID_REQUIRED',
    );
    await assertFailure(
      collectDeploymentEvidence(OTHER_SHA.slice(0, 39), DEPLOYMENT_IDS, {
        request: async () => ({}),
      }),
      'EXPECTED_SHA_MALFORMED',
    );
  });

  it('requestVercelDeployment은 token 값을 결과나 오류에 넣지 않는다', async () => {
    const calls = [];
    const payload = { deployment: validDeployment('consumer') };
    const result = await requestVercelDeployment(
      DEPLOYMENT_IDS.consumer,
      'opaque-test-token',
      async (url, init) => {
        calls.push({ url, init });
        return response(payload);
      },
    );

    assert.deepEqual(result, payload);
    assert.equal(JSON.stringify(result).includes('opaque-test-token'), false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer opaque-test-token');
    assert.equal(VERCEL_CREDENTIAL_NAME, 'ROUND_DIRECT_E2E_VERCEL_READ_TOKEN');
  });
});
