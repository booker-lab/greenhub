import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  APPLICATIONS,
  CANDIDATE_REF,
  RAILWAY,
  VERCEL_TEAM_ID,
  verifyEvidence,
} from './verify-vercel-preview-evidence.mjs';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const GITHUB_TOKEN = 'github-test-token';
const VERCEL_TOKEN = 'vercel-test-token';

const DEPLOYMENT_IDS = {
  consumer: 'dpl_HxPNRSfPztdLxCKp9Tr5d271C4kn',
  seller: 'dpl_CJkzKfWPGNc7qPyLxuo287hJiXQ3',
  driver: 'dpl_FycJKhuLYW5AmftzMFYbbXKxqwaj',
};

const DIRECT_URLS = {
  consumer: 'greenhubconsumer-abc123.vercel.app',
  seller: 'greenhub-seller-def456.vercel.app',
  driver: 'greenhub-driver-ghi789.vercel.app',
};

const DASHBOARD_URLS = {
  consumer:
    'https://vercel.com/jos-projects-d1cecc0c/greenhubconsumer/HxPNRSfPztdLxCKp9Tr5d271C4kn',
  seller:
    'https://vercel.com/jos-projects-d1cecc0c/greenhub-seller/CJkzKfWPGNc7qPyLxuo287hJiXQ3',
  driver:
    'https://vercel.com/jos-projects-d1cecc0c/greenhub-driver/FycJKhuLYW5AmftzMFYbbXKxqwaj',
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

function validDeployment(application, overrides = {}) {
  return {
    id: DEPLOYMENT_IDS[application.app],
    teamId: VERCEL_TEAM_ID,
    projectId: application.projectId,
    name: application.projectName,
    source: 'git',
    target: null,
    readyState: 'READY',
    state: 'READY',
    meta: {
      githubCommitSha: SHA,
      githubCommitRef: CANDIDATE_REF,
      githubCommitOrg: 'booker-lab',
      githubCommitRepo: 'greenhub',
    },
    url: DIRECT_URLS[application.app],
    ...overrides,
  };
}

function validStatus(application, overrides = {}) {
  return {
    context: application.context,
    state: 'success',
    target_url: DASHBOARD_URLS[application.app],
    ...overrides,
  };
}

function validRailwayStatus(overrides = {}) {
  return {
    context: RAILWAY.context,
    state: 'success',
    target_url:
      `https://railway.com/project/project-id/service/service-id?id=${RAILWAY.deploymentId}&environmentId=environment-id`,
    ...overrides,
  };
}

function fixture({ statusPayload, deploymentOverrides = {}, statusOverrides = {}, railway } = {}) {
  const statuses = [
    ...APPLICATIONS.map((application) =>
      validStatus(application, statusOverrides[application.app]),
    ),
    railway ?? validRailwayStatus(),
  ];
  const payload =
    statusPayload ?? {
      sha: SHA,
      statuses,
    };
  const deployments = Object.fromEntries(
    APPLICATIONS.map((application) => [
      DEPLOYMENT_IDS[application.app],
      validDeployment(application, deploymentOverrides[application.app]),
    ]),
  );
  return { payload, deployments };
}

function mockFetch({ statusPayload, payload, deployments, vercelStatus, vercelBody } = {}) {
  const calls = [];
  const effectiveStatusPayload = statusPayload ?? payload;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/commits/')) return response(effectiveStatusPayload);
    const deploymentId = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
    if (vercelStatus) return response(vercelBody, vercelStatus);
    return response(deployments[deploymentId]);
  };
  return { fetchImpl, calls };
}

function runVerification(overrides = {}) {
  const data = fixture(overrides);
  const mock = mockFetch({ ...data, statusPayload: data.payload, ...overrides });
  return {
    ...mock,
    promise: verifyEvidence({
      expectedSha: SHA,
      githubToken: GITHUB_TOKEN,
      vercelToken: VERCEL_TOKEN,
      fetchImpl: mock.fetchImpl,
      checkedAt: () => '2026-08-27T00:00:00.000Z',
    }),
  };
}

async function assertFailure(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

describe('Vercel exact-SHA evidence verifier 성공 fixture', () => {
  it('GitHub status와 Vercel metadata를 결합해 direct URL만 반환한다', async () => {
    const { promise, calls } = runVerification();
    const evidence = await promise;

    assert.equal(evidence.ready, true);
    assert.equal(evidence.source, 'github-status+vercel-api');
    assert.equal(evidence.expectedSha, SHA);
    assert.equal(evidence.candidateRef, CANDIDATE_REF);
    assert.deepEqual(
      evidence.apps.map(({ app, deploymentId, targetUrl, state }) => ({
        app,
        deploymentId,
        targetUrl,
        state,
      })),
      APPLICATIONS.map((application) => ({
        app: application.app,
        deploymentId: DEPLOYMENT_IDS[application.app],
        targetUrl: `https://${DIRECT_URLS[application.app]}`,
        state: 'READY',
      })),
    );
    assert.equal(evidence.railway.deploymentId, RAILWAY.deploymentId);
    assert.equal(calls.length, 4);
    assert.match(calls[0].url, new RegExp(`/commits/${SHA}/status$`));
    assert.match(calls[1].url, /\/v13\/deployments\/dpl_HxPNRSfPztdLxCKp9Tr5d271C4kn\?/);
    assert.match(calls[1].url, /teamId=team_J91VWI0TqcHdcF36T7qVgiT1/);
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${GITHUB_TOKEN}`);
    assert.equal(calls[1].init.headers.Authorization, `Bearer ${VERCEL_TOKEN}`);
  });
});

describe('입력·GitHub status fail-closed 계약', () => {
  it('expected SHA가 malformed이면 API를 호출하지 않는다', async () => {
    const { fetchImpl, calls } = mockFetch(fixture());
    await assertFailure(
      verifyEvidence({
        expectedSha: 'A'.repeat(40),
        githubToken: GITHUB_TOKEN,
        vercelToken: VERCEL_TOKEN,
        fetchImpl,
      }),
      'EXPECTED_SHA_MALFORMED',
    );
    assert.equal(calls.length, 0);
  });

  it('GitHub token 또는 Vercel read token이 없으면 닫는다', async () => {
    const { fetchImpl } = mockFetch(fixture());
    await assertFailure(
      verifyEvidence({
        expectedSha: SHA,
        githubToken: '',
        vercelToken: VERCEL_TOKEN,
        fetchImpl,
      }),
      'GITHUB_TOKEN_REQUIRED',
    );
    await assertFailure(
      verifyEvidence({
        expectedSha: SHA,
        githubToken: GITHUB_TOKEN,
        vercelToken: '',
        fetchImpl,
      }),
      'VERCEL_READ_TOKEN_REQUIRED',
    );
  });

  it('GitHub status evidence가 없거나 context가 typo이면 닫는다', async () => {
    await assertFailure(
      runVerification({ statusPayload: { sha: SHA, statuses: [] } }).promise,
      'GITHUB_STATUS_CONTEXT_MISSING',
    );
    await assertFailure(
      runVerification({
        statusOverrides: { consumer: { context: 'Vercel – greenhub-consumer-typo' } },
      }).promise,
      'GITHUB_STATUS_CONTEXT_MISSING',
    );
  });

  it('status state가 success가 아니거나 commit SHA가 다르면 닫는다', async () => {
    await assertFailure(
      runVerification({ statusOverrides: { seller: { state: 'failure' } } }).promise,
      'GITHUB_STATUS_NOT_SUCCESS',
    );
    await assertFailure(
      runVerification({
        statusPayload: { sha: OTHER_SHA, statuses: fixture().payload.statuses },
      }).promise,
      'GITHUB_STATUS_SHA_MISMATCH',
    );
  });

  it('status context가 중복되면 모호한 증거로 닫는다', async () => {
    const base = fixture().payload;
    await assertFailure(
      runVerification({
        statusPayload: {
          sha: SHA,
          statuses: [...base.statuses, validStatus(APPLICATIONS[0])],
        },
      }).promise,
      'GITHUB_STATUS_AMBIGUOUS',
    );
  });
});

describe('GitHub Vercel dashboard target URL fail-closed 계약', () => {
  it('target_url 누락·비HTTPS·오류 host를 닫는다', async () => {
    await assertFailure(
      runVerification({ statusOverrides: { consumer: { target_url: null } } }).promise,
      'GITHUB_STATUS_TARGET_URL_MISSING',
    );
    await assertFailure(
      runVerification({
        statusOverrides: { consumer: { target_url: 'http://vercel.com/jos-projects-d1cecc0c/greenhubconsumer/Hx' } },
      }).promise,
      'GITHUB_STATUS_TARGET_URL_MALFORMED',
    );
    await assertFailure(
      runVerification({
        statusOverrides: { consumer: { target_url: 'https://evil.example/jos-projects-d1cecc0c/greenhubconsumer/Hx' } },
      }).promise,
      'GITHUB_STATUS_TARGET_URL_HOST_MISMATCH',
    );
  });

  it('팀·프로젝트 경로와 deployment ID parsing이 정확하지 않으면 닫는다', async () => {
    await assertFailure(
      runVerification({
        statusOverrides: {
          consumer: {
            target_url:
              'https://vercel.com/wrong-team/greenhubconsumer/HxPNRSfPztdLxCKp9Tr5d271C4kn',
          },
        },
      }).promise,
      'GITHUB_STATUS_TARGET_PATH_MISMATCH',
    );
    await assertFailure(
      runVerification({
        statusOverrides: {
          consumer: {
            target_url:
              'https://vercel.com/jos-projects-d1cecc0c/greenhubconsumer/dpl_HxPNRSfPztdLxCKp9Tr5d271C4kn',
          },
        },
      }).promise,
      'GITHUB_STATUS_DEPLOYMENT_ID_PARSE_FAILED',
    );
    await assertFailure(
      runVerification({
        statusOverrides: {
          consumer: {
            target_url: 'https://vercel.com/jos-projects-d1cecc0c/greenhubconsumer/not-valid!',
          },
        },
      }).promise,
      'GITHUB_STATUS_DEPLOYMENT_ID_PARSE_FAILED',
    );
  });
});

describe('Vercel API HTTP와 metadata fail-closed 계약', () => {
  for (const status of [401, 403, 404, 500]) {
    it(`Vercel API ${status} 응답을 거부한다`, async () => {
      const data = fixture();
      const mock = mockFetch({ ...data, vercelStatus: status, vercelBody: {} });
      await assertFailure(
        verifyEvidence({
          expectedSha: SHA,
          githubToken: GITHUB_TOKEN,
          vercelToken: VERCEL_TOKEN,
          fetchImpl: mock.fetchImpl,
        }),
        `VERCEL_API_HTTP_${status}`,
      );
    });
  }

  it('deployment ID·team ID·project ID·project name이 다르면 닫는다', async () => {
    await assertFailure(
      runVerification({ deploymentOverrides: { consumer: { id: 'dpl_wrong' } } }).promise,
      'VERCEL_DEPLOYMENT_ID_MISMATCH',
    );
    await assertFailure(
      runVerification({ deploymentOverrides: { consumer: { teamId: 'team_wrong' } } }).promise,
      'VERCEL_TEAM_ID_MISMATCH',
    );
    await assertFailure(
      runVerification({ deploymentOverrides: { consumer: { projectId: 'prj_wrong' } } }).promise,
      'VERCEL_PROJECT_ID_MISMATCH',
    );
    await assertFailure(
      runVerification({ deploymentOverrides: { consumer: { name: 'wrong-project' } } }).promise,
      'VERCEL_PROJECT_NAME_MISMATCH',
    );
  });

  it('source·target·READY state 계약을 모두 확인한다', async () => {
    await assertFailure(
      runVerification({ deploymentOverrides: { consumer: { source: 'cli' } } }).promise,
      'VERCEL_SOURCE_MISMATCH',
    );
    await assertFailure(
      runVerification({ deploymentOverrides: { consumer: { target: 'preview' } } }).promise,
      'VERCEL_TARGET_MISMATCH',
    );
    await assertFailure(
      runVerification({ deploymentOverrides: { consumer: { readyState: 'ERROR' } } }).promise,
      'VERCEL_READY_STATE_MISMATCH',
    );
    await assertFailure(
      runVerification({ deploymentOverrides: { consumer: { state: 'ERROR' } } }).promise,
      'VERCEL_READY_STATE_MISMATCH',
    );
  });

  it('GitHub commit metadata가 하나라도 다르면 닫는다', async () => {
    await assertFailure(
      runVerification({
        deploymentOverrides: { consumer: { meta: { githubCommitSha: OTHER_SHA } } },
      }).promise,
      'VERCEL_GITHUB_COMMIT_SHA_MISMATCH',
    );
    await assertFailure(
      runVerification({
        deploymentOverrides: {
          consumer: {
            meta: {
              githubCommitSha: SHA,
              githubCommitRef: 'main',
              githubCommitOrg: 'booker-lab',
              githubCommitRepo: 'greenhub',
            },
          },
        },
      }).promise,
      'VERCEL_GITHUB_COMMIT_REF_MISMATCH',
    );
    await assertFailure(
      runVerification({
        deploymentOverrides: {
          consumer: {
            meta: {
              githubCommitSha: SHA,
              githubCommitRef: CANDIDATE_REF,
              githubCommitOrg: 'other-org',
              githubCommitRepo: 'other-repo',
            },
          },
        },
      }).promise,
      'VERCEL_GITHUB_REPOSITORY_MISMATCH',
    );
  });

  it('direct deployment URL이 없거나 보안 형식이 아니면 닫는다', async () => {
    await assertFailure(
      runVerification({ deploymentOverrides: { consumer: { url: null } } }).promise,
      'VERCEL_DIRECT_URL_MISSING',
    );
    await assertFailure(
      runVerification({
        deploymentOverrides: { consumer: { url: 'http://greenhubconsumer-abc123.vercel.app' } },
      }).promise,
      'VERCEL_DIRECT_URL_MALFORMED',
    );
    await assertFailure(
      runVerification({
        deploymentOverrides: { consumer: { url: 'https://greenhubconsumer-abc123.vercel.app/?query=1' } },
      }).promise,
      'VERCEL_DIRECT_URL_MALFORMED',
    );
    await assertFailure(
      runVerification({ deploymentOverrides: { consumer: { url: 'https://example.com' } } }).promise,
      'VERCEL_DIRECT_URL_HOST_MISMATCH',
    );
  });
});

describe('Railway 보존 status fail-closed 계약', () => {
  it('Railway exact status가 없으면 닫는다', async () => {
    const data = fixture();
    await assertFailure(
      runVerification({
        statusPayload: {
          ...data.payload,
          statuses: data.payload.statuses.filter((status) => status.context !== RAILWAY.context),
        },
      }).promise,
      'GITHUB_STATUS_CONTEXT_MISSING',
    );
  });

  it('Railway status가 success가 아니면 닫는다', async () => {
    await assertFailure(
      runVerification({ railway: validRailwayStatus({ state: 'failure' }) }).promise,
      'GITHUB_STATUS_NOT_SUCCESS',
    );
  });

  it('Railway target URL이 보존 deployment ID와 다르면 닫는다', async () => {
    await assertFailure(
      runVerification({
        railway: validRailwayStatus({
          target_url: 'https://railway.com/project/project-id/service/service-id?id=other-deployment',
        }),
      }).promise,
      'RAILWAY_STATUS_TARGET_MISMATCH',
    );
  });
});
