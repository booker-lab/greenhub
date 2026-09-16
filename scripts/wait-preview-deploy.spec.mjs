import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertExactPreviewCredentialMode,
  collectCommitStatusDiagnostic,
  collectDeploymentEvidence,
  EXACT_PREVIEW_CREDENTIAL_MODE_LEGACY_GLOBAL,
  EXACT_PREVIEW_CREDENTIAL_MODE_PROJECT_SCOPED,
  EXACT_PREVIEW_TOKENS_BY_APP,
  exactPreviewTokenEnvForApp,
  exactPreviewTokenRequiredCode,
  inspectAppDeployment,
  normalizeTargetUrl,
  PREVIEW_APPS,
  requestVercelDeployment,
  resolveProjectScopedReadToken,
  resolveProjectScopedReadTokensForApps,
  resolveSelectedAppConfigs,
  VERCEL_API_ORIGIN,
  VERCEL_CREDENTIAL_NAME,
  VERCEL_TEAM_ID,
  vercelDeploymentPath,
  vercelDeploymentProjectScopedPath,
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

describe('Driver-only bounded exact binding (PILOT-AUTH-DRIVER-ONLY-EXACT-BINDING-GATE-40B)', () => {
  function collectDriverOnly(deployments, { expectedSha = SHA, ids = null } = {}) {
    const calls = [];
    const request = async (deploymentId, app) => {
      calls.push({ deploymentId, app });
      return deployments[app];
    };
    const deploymentIds = ids ?? { driver: DEPLOYMENT_IDS.driver };
    return {
      calls,
      promise: collectDeploymentEvidence(expectedSha, deploymentIds, {
        request,
        only: 'driver',
      }),
    };
  }

  it('default는 seller CANCELED면 FAIL을 유지한다 (triple preserved)', async () => {
    const deployments = validDeployments({
      seller: { state: 'CANCELED', readyState: 'CANCELED' },
    });
    const evidence = await collectWith(deployments).promise;

    assert.equal(evidence.ready, false);
    assert.equal(evidence.apps.length, 3);
    assert.equal(evidence.apps.find(({ app }) => app === 'seller').failureCode, 'VERCEL_NOT_READY');
    assert.equal(evidence.apps.find(({ app }) => app === 'driver').ready, true);
  });

  it('Driver-only는 consumer/seller CANCELED에도 driver READY+exact SHA면 PASS한다', async () => {
    // Consumer/Seller 상태는 Driver-only 결과에 들어가지 않는다: request는
    // driver pinned ID만 조회하고, evidence apps는 driver 1건만 포함한다.
    const deployments = {
      driver: validDeployment('driver'),
    };
    const { promise, calls } = collectDriverOnly(deployments);
    const evidence = await promise;

    assert.equal(evidence.ready, true);
    assert.deepEqual(evidence.selectedApps, ['driver']);
    assert.equal(evidence.apps.length, 1);
    assert.equal(evidence.apps[0].app, 'driver');
    assert.equal(evidence.apps[0].ready, true);
    assert.equal(evidence.apps[0].deploymentSha, SHA);
    assert.equal(evidence.deploymentShas.driver, SHA);
    assert.ok(String(evidence.deploymentTargetUrls.driver ?? '').startsWith('https://'));
    assert.deepEqual(
      calls.map(({ deploymentId }) => deploymentId),
      [DEPLOYMENT_IDS.driver],
    );
    // Self-fulfilling 방지: observed가 아닌 expected 기준 검증이며,
    // consumer/seller 키가 결과에 존재하지 않는다.
    assert.equal(Object.hasOwn(evidence.deploymentShas, 'consumer'), false);
    assert.equal(Object.hasOwn(evidence.deploymentShas, 'seller'), false);
    assert.equal(Object.hasOwn(evidence.pinnedDeploymentIds, 'consumer'), false);
    assert.equal(Object.hasOwn(evidence.pinnedDeploymentIds, 'seller'), false);
  });

  it('Driver-only는 driver CANCELED면 FAIL한다', async () => {
    const deployments = {
      driver: validDeployment('driver', { state: 'CANCELED', readyState: 'CANCELED' }),
    };
    const evidence = await collectDriverOnly(deployments).promise;

    assert.equal(evidence.ready, false);
    assert.equal(evidence.apps[0].failureCode, 'VERCEL_NOT_READY');
    assert.equal(evidence.apps[0].retryable, false);
  });

  it('Driver-only는 driver READY라도 SHA mismatch면 FAIL한다', async () => {
    const deployments = {
      driver: validDeployment('driver', { meta: { githubCommitSha: OTHER_SHA } }),
    };
    const evidence = await collectDriverOnly(deployments).promise;

    assert.equal(evidence.ready, false);
    assert.equal(evidence.apps[0].failureCode, 'VERCEL_GITHUB_COMMIT_SHA_MISMATCH');
    assert.equal(evidence.apps[0].deploymentSha, OTHER_SHA);
  });

  it('Driver-only는 wrong project/repository/deployment ID를 FAIL한다', async () => {
    const wrongProject = {
      driver: validDeployment('driver', {
        projectId: 'prj_wrong',
        project: { id: 'prj_wrong', name: 'wrong-project' },
        name: 'wrong-project',
      }),
    };
    const wrongProjectEvidence = await collectDriverOnly(wrongProject).promise;
    assert.equal(wrongProjectEvidence.ready, false);
    assert.equal(wrongProjectEvidence.apps[0].failureCode, 'VERCEL_PROJECT_MISMATCH');

    const wrongId = {
      driver: validDeployment('driver', { id: 'dpl_WrongId00000000', uid: 'dpl_WrongId00000000' }),
    };
    const wrongIdEvidence = await collectDriverOnly(wrongId).promise;
    assert.equal(wrongIdEvidence.ready, false);
    assert.equal(wrongIdEvidence.apps[0].failureCode, 'VERCEL_DEPLOYMENT_ID_MISMATCH');
  });

  it('Driver-only는 production target이면 FAIL한다', async () => {
    const deployments = {
      driver: validDeployment('driver', { target: 'production' }),
    };
    const evidence = await collectDriverOnly(deployments).promise;

    assert.equal(evidence.ready, false);
    assert.equal(evidence.apps[0].failureCode, 'VERCEL_TARGET_NOT_PREVIEW');
  });

  it('--only 알 수 없는 앱은 fail-closed한다', async () => {
    await assert.rejects(
      collectDeploymentEvidence(SHA, DEPLOYMENT_IDS, { request: async () => ({}) , only: 'unknown-app' }),
      (error) => error?.code === 'UNKNOWN_PREVIEW_APP',
    );
    assert.throws(() => resolveSelectedAppConfigs('unknown-app'), (error) => error?.code === 'UNKNOWN_PREVIEW_APP');
  });

  it('default --only 없음은 세 앱을 모두 요구한다', () => {
    assert.deepEqual(
      resolveSelectedAppConfigs(null).map(({ app }) => app),
      ['consumer', 'seller', 'driver'],
    );
    assert.deepEqual(
      resolveSelectedAppConfigs('').map(({ app }) => app),
      ['consumer', 'seller', 'driver'],
    );
    assert.deepEqual(
      resolveSelectedAppConfigs('driver').map(({ app }) => app),
      ['driver'],
    );
  });

  it('Driver-only는 driver deployment ID만 요구한다 (consumer/seller 불필요)', async () => {
    await assert.rejects(
      collectDeploymentEvidence(SHA, {}, { request: async () => ({}), only: 'driver' }),
      (error) => error?.code === 'DEPLOYMENT_ID_REQUIRED',
    );
    const deployments = { driver: validDeployment('driver') };
    const evidence = await collectDriverOnly(deployments).promise;
    assert.equal(evidence.ready, true);
  });
});

describe('45B project-scoped exact-preview readback (mock/local only)', () => {
  const PROJECT_TOKEN_ENVS = [
    'VERCEL_EXACT_PREVIEW_CONSUMER_TOKEN',
    'VERCEL_EXACT_PREVIEW_SELLER_TOKEN',
    'VERCEL_EXACT_PREVIEW_DRIVER_TOKEN',
  ];

  function clearProjectTokenEnvs() {
    const saved = {};
    for (const env of PROJECT_TOKEN_ENVS) {
      saved[env] = process.env[env];
      delete process.env[env];
    }
    return () => {
      for (const env of PROJECT_TOKEN_ENVS) {
        if (saved[env] !== undefined) process.env[env] = saved[env];
        else delete process.env[env];
      }
    };
  }

  const READ_TOKENS = Object.freeze({
    consumer: 'read-token-consumer-aaa-001',
    seller: 'read-token-seller-bbb-002',
    driver: 'read-token-driver-ccc-003',
  });

  function scopedFetch(deployments, calls) {
    return async (url, init) => {
      calls.push({ url, init });
      const deploymentId = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
      const app = Object.entries(DEPLOYMENT_IDS).find(([, id]) => id === deploymentId)?.[0];
      return response(deployments[app]);
    };
  }

  it('credential authority: one env per app + per-app fail-closed codes', () => {
    assert.deepEqual({ ...EXACT_PREVIEW_TOKENS_BY_APP }, {
      consumer: 'VERCEL_EXACT_PREVIEW_CONSUMER_TOKEN',
      seller: 'VERCEL_EXACT_PREVIEW_SELLER_TOKEN',
      driver: 'VERCEL_EXACT_PREVIEW_DRIVER_TOKEN',
    });
    assert.equal(exactPreviewTokenEnvForApp('driver'), 'VERCEL_EXACT_PREVIEW_DRIVER_TOKEN');
    assert.equal(exactPreviewTokenRequiredCode('consumer'), 'VERCEL_CONSUMER_PROJECT_TOKEN_REQUIRED');
    assert.equal(exactPreviewTokenRequiredCode('seller'), 'VERCEL_SELLER_PROJECT_TOKEN_REQUIRED');
    assert.equal(exactPreviewTokenRequiredCode('driver'), 'VERCEL_DRIVER_PROJECT_TOKEN_REQUIRED');
    assert.equal(
      assertExactPreviewCredentialMode('project-scoped'),
      EXACT_PREVIEW_CREDENTIAL_MODE_PROJECT_SCOPED,
    );
    assert.equal(
      assertExactPreviewCredentialMode('legacy-global'),
      EXACT_PREVIEW_CREDENTIAL_MODE_LEGACY_GLOBAL,
    );
    assert.throws(
      () => assertExactPreviewCredentialMode('auto'),
      (error) => error?.code === 'UNKNOWN_CREDENTIAL_MODE',
    );
  });

  it('project-scoped GET omits teamId; legacy GET keeps teamId (compat)', () => {
    assert.equal(
      vercelDeploymentProjectScopedPath(DEPLOYMENT_IDS.driver),
      `/v13/deployments/${DEPLOYMENT_IDS.driver}`,
    );
    assert.equal(vercelDeploymentProjectScopedPath(DEPLOYMENT_IDS.driver).includes('teamId'), false);
    assert.equal(
      vercelDeploymentPath(DEPLOYMENT_IDS.driver),
      `/v13/deployments/${DEPLOYMENT_IDS.driver}?teamId=${VERCEL_TEAM_ID}`,
    );
  });

  it('legacy global read contract unchanged (KEEP_COMPATIBILITY)', async () => {
    // No credentialMode => legacy-global: single global token + teamId query.
    const calls = [];
    const evidence = await collectDeploymentEvidence(SHA, DEPLOYMENT_IDS, {
      vercelToken: 'opaque-test-token',
      fetchImpl: scopedFetch(validDeployments(), calls),
    });
    assert.equal(evidence.ready, true);
    assert.equal(evidence.credentialMode, 'legacy-global');
    assert.equal(calls.length, 3);
    for (const { url, init } of calls) {
      assert.equal(new URL(url).searchParams.get('teamId'), VERCEL_TEAM_ID);
      assert.equal(init.headers.Authorization, 'Bearer opaque-test-token');
    }
    assert.equal(JSON.stringify(evidence).includes('opaque-test-token'), false);
  });

  it('strict waiter validates only the pinned dpl_* with that app token', async () => {
    const restore = clearProjectTokenEnvs();
    try {
      const calls = [];
      const evidence = await collectDeploymentEvidence(SHA, { driver: DEPLOYMENT_IDS.driver }, {
        tokensByApp: { ...READ_TOKENS },
        credentialMode: 'project-scoped',
        only: 'driver',
        fetchImpl: scopedFetch(validDeployments(), calls),
      });
      assert.equal(evidence.ready, true);
      assert.equal(evidence.credentialMode, 'project-scoped');
      assert.deepEqual({ ...evidence.vercelCredentialNames }, {
        driver: 'VERCEL_EXACT_PREVIEW_DRIVER_TOKEN',
      });
      assert.equal(evidence.vercelTeamId, null);
      assert.equal(evidence.credentialValueRecorded, false);
      assert.deepEqual(evidence.selectedApps, ['driver']);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url.includes('teamId'), false);
      assert.equal(calls[0].init.headers.Authorization, `Bearer ${READ_TOKENS.driver}`);
      assert.equal(JSON.stringify(evidence).includes(READ_TOKENS.driver), false);
    } finally {
      restore();
    }
  });

  it('consumer+seller readback uses each app token; driver token unused', async () => {
    const restore = clearProjectTokenEnvs();
    try {
      const calls = [];
      const evidence = await collectDeploymentEvidence(
        SHA,
        { consumer: DEPLOYMENT_IDS.consumer, seller: DEPLOYMENT_IDS.seller },
        {
          tokensByApp: { ...READ_TOKENS },
          credentialMode: 'project-scoped',
          only: 'consumer,seller',
          fetchImpl: scopedFetch(validDeployments(), calls),
        },
      );
      assert.equal(evidence.ready, true);
      assert.equal(calls.length, 2);
      for (const { url, init } of calls) {
        assert.equal(url.includes('teamId'), false);
        assert.notEqual(init.headers.Authorization, `Bearer ${READ_TOKENS.driver}`);
        assert.equal(url.includes(READ_TOKENS.driver), false);
      }
      const auths = calls.map(({ init }) => init.headers.Authorization).sort();
      assert.deepEqual(auths, [`Bearer ${READ_TOKENS.consumer}`, `Bearer ${READ_TOKENS.seller}`].sort());
      assert.equal(JSON.stringify(evidence).includes(READ_TOKENS.driver), false);
    } finally {
      restore();
    }
  });

  it('missing project token fails before any GET (GET 0회, own code)', async () => {
    const restore = clearProjectTokenEnvs();
    try {
      const calls = [];
      await assert.rejects(
        collectDeploymentEvidence(SHA, { driver: DEPLOYMENT_IDS.driver }, {
          tokensByApp: { consumer: READ_TOKENS.consumer },
          credentialMode: 'project-scoped',
          only: 'driver',
          fetchImpl: scopedFetch(validDeployments(), calls),
        }),
        (error) => error?.code === 'VERCEL_DRIVER_PROJECT_TOKEN_REQUIRED',
      );
      assert.equal(calls.length, 0);
      // Resolver unit: another app's token is never borrowed.
      process.env.VERCEL_EXACT_PREVIEW_CONSUMER_TOKEN = READ_TOKENS.consumer;
      assert.throws(
        () => resolveProjectScopedReadToken('seller', null),
        (error) => error?.code === 'VERCEL_SELLER_PROJECT_TOKEN_REQUIRED',
      );
      assert.deepEqual(Object.keys(resolveProjectScopedReadTokensForApps([{ app: 'driver' }], {
        driver: READ_TOKENS.driver,
      })), ['driver']);
    } finally {
      restore();
    }
  });

  it('project-scoped strict predicate stays fail-closed', async () => {
    const restore = clearProjectTokenEnvs();
    try {
      async function scopedEvidence(app, overrides) {
        const calls = [];
        const deployments = validDeployments({ [app]: { ...validDeployment(app), ...overrides } });
        const evidence = await collectDeploymentEvidence(SHA, { [app]: DEPLOYMENT_IDS[app] }, {
          tokensByApp: { ...READ_TOKENS },
          credentialMode: 'project-scoped',
          only: app,
          fetchImpl: scopedFetch(deployments, calls),
        });
        return { evidence, calls };
      }
      const wrongSha = await scopedEvidence('driver', { meta: { githubCommitSha: OTHER_SHA } });
      assert.equal(wrongSha.evidence.ready, false);
      assert.equal(wrongSha.evidence.apps[0].failureCode, 'VERCEL_GITHUB_COMMIT_SHA_MISMATCH');
      const wrongProject = await scopedEvidence('driver', {
        projectId: 'prj_wrong',
        project: { id: 'prj_wrong', name: 'wrong-project' },
        name: 'wrong-project',
      });
      assert.equal(wrongProject.evidence.ready, false);
      assert.equal(wrongProject.evidence.apps[0].failureCode, 'VERCEL_PROJECT_MISMATCH');
      const production = await scopedEvidence('driver', { target: 'production' });
      assert.equal(production.evidence.ready, false);
      assert.equal(production.evidence.apps[0].failureCode, 'VERCEL_TARGET_NOT_PREVIEW');
      for (const state of ['ERROR', 'CANCELED']) {
        const failed = await scopedEvidence('driver', { state, readyState: state });
        assert.equal(failed.evidence.ready, false);
        assert.equal(failed.evidence.apps[0].failureCode, 'VERCEL_NOT_READY');
      }
      // ID substitution is refused even with the right token + SHA.
      const calls = [];
      const deployments = validDeployments();
      const evidence = await collectDeploymentEvidence(SHA, { driver: DEPLOYMENT_IDS.driver }, {
        tokensByApp: { ...READ_TOKENS },
        credentialMode: 'project-scoped',
        only: 'driver',
        request: async () => validDeployment('driver', {
          id: 'dpl_Substituted00000000',
          uid: 'dpl_Substituted00000000',
        }),
      });
      assert.equal(evidence.ready, false);
      assert.equal(evidence.apps[0].failureCode, 'VERCEL_DEPLOYMENT_ID_MISMATCH');
      assert.equal(calls.length, 0);
    } finally {
      restore();
    }
  });

  it('requestVercelDeployment project-scoped sends no teamId (header-only token)', async () => {
    const calls = [];
    const payload = { deployment: validDeployment('consumer') };
    const result = await requestVercelDeployment(
      DEPLOYMENT_IDS.consumer,
      'scoped-token-abc',
      async (url, init) => {
        calls.push({ url, init });
        return response(payload);
      },
      { credentialMode: 'project-scoped' },
    );
    assert.deepEqual(result, payload);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.includes('teamId'), false);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer scoped-token-abc');
    assert.equal(JSON.stringify(result).includes('scoped-token-abc'), false);
  });
});
