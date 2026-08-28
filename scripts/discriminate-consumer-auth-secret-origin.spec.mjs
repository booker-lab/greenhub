import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  API_MARKERS,
  APPLICATION_SHA,
  CONSUMER_DEPLOYMENT_ID,
  DEPLOYMENT_RELATIVE_CLASSES,
  EXPECTED_API_ORIGIN,
  ORIGIN_CLASSIFICATIONS,
  ROOT_CAUSES,
  SECRET_EQUALITIES,
  STATUSES,
  classifyCurrentApiOrigin,
  classifyDiscrimination,
  classifySecretBinding,
  classifyUpdatedRelativeToDeployment,
  collectDiscriminationEvidence,
  inspectExactDeploymentApiOrigin,
  resolvePreviewEnvEntry,
} from './discriminate-consumer-auth-secret-origin.mjs';

const GITHUB_SECRET = 'github-secret-must-not-print';
const VERCEL_SECRET = 'vercel-secret-must-not-print';
const FILE_NAME = 'apps/consumer/.next/server/app/api/auth/[...nextauth]/route.js';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

function envPayload({ secret = VERCEL_SECRET, secretUpdatedAt = '2026-08-28T00:00:00.000Z', api = EXPECTED_API_ORIGIN, apiUpdatedAt = '2026-08-28T00:00:00.000Z', extra = [] } = {}) {
  return {
    envs: [
      { key: 'E2E_TEST_SECRET', target: ['preview'], gitBranch: 'codex/p2-security-after-pay01', value: secret, updatedAt: secretUpdatedAt },
      { key: 'NEXT_PUBLIC_API_URL', target: ['preview'], gitBranch: 'codex/p2-security-after-pay01', value: api, updatedAt: apiUpdatedAt },
      ...extra,
    ],
  };
}

function mockVercel({ env = envPayload(), bundle = `const endpoint = '${EXPECTED_API_ORIGIN}${API_MARKERS[0]}';` } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const parsed = new URL(url);
    if (parsed.pathname === `/v13/deployments/${CONSUMER_DEPLOYMENT_ID}`) {
      return response({ id: CONSUMER_DEPLOYMENT_ID, projectId: 'prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w', createdAt: '2026-08-28T00:00:01.000Z' });
    }
    if (parsed.pathname === '/v10/projects/prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w/env') return response(env);
    if (parsed.pathname === `/v6/deployments/${CONSUMER_DEPLOYMENT_ID}/files`) {
      return response({ files: [{ name: FILE_NAME, uid: 'server-file-1' }] });
    }
    if (parsed.pathname === `/v8/deployments/${CONSUMER_DEPLOYMENT_ID}/files/server-file-1`) return response(bundle);
    throw new Error(`예상하지 않은 URL: ${parsed.pathname}`);
  };
  return { fetchImpl, calls };
}

function collect(overrides = {}) {
  const mock = mockVercel(overrides);
  return {
    ...mock,
    promise: collectDiscriminationEvidence({
      expectedSha: APPLICATION_SHA,
      githubSecret: GITHUB_SECRET,
      vercelToken: 'vercel-token-must-not-print',
      fetchImpl: mock.fetchImpl,
    }),
  };
}

describe('secret/origin 판별 핵심 분류', () => {
  it('secret exact match와 서버 origin match를 함께 증명한다', async () => {
    const { promise } = collect({ env: envPayload({ secret: GITHUB_SECRET }) });
    const result = await promise;
    assert.equal(result.status, STATUSES.BOTH_MATCH);
    assert.equal(result.secretBindingEvidence.equality, SECRET_EQUALITIES.MATCH);
    assert.equal(result.apiOriginEvidence.exactDeploymentClassification, ORIGIN_CLASSIFICATIONS.MATCH);
  });

  it('secret mismatch가 배포 시점 이전이면 secret root를 확정한다', async () => {
    const { promise } = collect({ env: envPayload({ secret: VERCEL_SECRET }) });
    const result = await promise;
    assert.equal(result.status, STATUSES.SECRET_MISMATCH_CONFIRMED);
    assert.equal(result.rootCauseClass, ROOT_CAUSES.AUTH_HEADER_SECRET_MISMATCH);
    assert.equal(result.nextGate, 'VERCEL_PREVIEW_ENV_REBIND_AND_EXACT_REDEPLOY_GATE');
    assert.deepEqual(result.eliminatedCandidates, [ROOT_CAUSES.CONSUMER_API_ORIGIN_MISMATCH]);
  });

  it('secret이 없으면 equality를 추측하지 않는다', () => {
    const result = classifySecretBinding({
      githubSecret: '',
      resolution: { scope: 'MISSING', entry: null },
    });
    assert.equal(result.equality, SECRET_EQUALITIES.NOT_PROVEN);
    assert.equal(result.effectiveScope, 'MISSING');
  });

  it('branch preview가 generic preview보다 우선한다', () => {
    const result = resolvePreviewEnvEntry({
      envs: [
        { key: 'E2E_TEST_SECRET', target: ['preview'], gitBranch: null, value: 'generic' },
        { key: 'E2E_TEST_SECRET', target: ['preview'], gitBranch: 'codex/p2-security-after-pay01', value: 'branch' },
      ],
    }, 'E2E_TEST_SECRET');
    assert.equal(result.scope, 'BRANCH_PREVIEW');
    assert.equal(result.entry.value, 'branch');
  });

  it('동일 precedence의 중복 entry는 ambiguous로 닫는다', () => {
    const result = resolvePreviewEnvEntry({
      envs: [
        { key: 'E2E_TEST_SECRET', target: ['preview'], gitBranch: null, value: 'one' },
        { key: 'E2E_TEST_SECRET', target: ['preview'], gitBranch: null, value: 'two' },
      ],
    }, 'E2E_TEST_SECRET');
    assert.equal(result.scope, 'AMBIGUOUS');
    assert.equal(result.entry, null);
  });

  it('배포 이후 env 갱신은 exact deployment binding으로 확정하지 않는다', () => {
    const result = classifyDiscrimination({
      secretBinding: { equality: SECRET_EQUALITIES.MISMATCH },
      secretUpdatedRelative: DEPLOYMENT_RELATIVE_CLASSES.AFTER,
      apiOriginClassification: ORIGIN_CLASSIFICATIONS.MATCH,
    });
    assert.equal(result.status, STATUSES.SECRET_BINDING_NOT_PROVEN);
    assert.equal(result.rootCauseClass, ROOT_CAUSES.NOT_CLASSIFIED);
  });
});

describe('exact deployment server bundle origin 증거', () => {
  it('marker 주변의 expected HTTPS origin을 exact match로 분류한다', async () => {
    const result = await inspectExactDeploymentApiOrigin({
      filesPayload: { files: [{ name: FILE_NAME, uid: 'file-1' }] },
      token: 'vercel-token',
      fetchImpl: async () => response(`${EXPECTED_API_ORIGIN}${API_MARKERS[0]}`),
    });
    assert.equal(result.serverBundleInspected, true);
    assert.equal(result.markerFound, true);
    assert.equal(result.classification, ORIGIN_CLASSIFICATIONS.MATCH);
  });

  it('marker 주변의 다른 HTTPS origin을 mismatch로 분류한다', async () => {
    const result = await inspectExactDeploymentApiOrigin({
      filesPayload: { files: [{ name: FILE_NAME, uid: 'file-1' }] },
      token: 'vercel-token',
      fetchImpl: async () => response(`https://wrong.example${API_MARKERS[0]}`),
    });
    assert.equal(result.classification, ORIGIN_CLASSIFICATIONS.MISMATCH);
  });

  it('server bundle marker가 없으면 not proven으로 남긴다', async () => {
    const result = await inspectExactDeploymentApiOrigin({
      filesPayload: { files: [{ name: FILE_NAME, uid: 'file-1' }] },
      token: 'vercel-token',
      fetchImpl: async () => response('서버 파일에 인증 API marker가 없음'),
    });
    assert.equal(result.markerFound, false);
    assert.equal(result.classification, ORIGIN_CLASSIFICATIONS.NOT_PROVEN);
  });

  it('현재 branch env origin은 안전한 origin만 비교한다', () => {
    assert.equal(classifyCurrentApiOrigin({ entry: { value: EXPECTED_API_ORIGIN } }), 'CURRENT_API_ORIGIN_MATCH');
    assert.equal(classifyCurrentApiOrigin({ entry: { value: 'https://wrong.example' } }), 'CURRENT_API_ORIGIN_MISMATCH');
    assert.equal(classifyCurrentApiOrigin({ entry: { value: 'https://wrong.example/path?token=private' } }), 'CURRENT_API_ORIGIN_NOT_PROVEN');
  });

  it('updatedAt 비교는 before, after, unknown을 구분한다', () => {
    assert.equal(classifyUpdatedRelativeToDeployment('2026-08-28T00:00:00Z', '2026-08-28T00:00:01Z'), DEPLOYMENT_RELATIVE_CLASSES.BEFORE_OR_AT);
    assert.equal(classifyUpdatedRelativeToDeployment('2026-08-28T00:00:02Z', '2026-08-28T00:00:01Z'), DEPLOYMENT_RELATIVE_CLASSES.AFTER);
    assert.equal(classifyUpdatedRelativeToDeployment('not-a-date', '2026-08-28T00:00:01Z'), DEPLOYMENT_RELATIVE_CLASSES.UNKNOWN);
  });
});

describe('안전 출력과 mutation 없는 Vercel API 경계', () => {
  it('secret·decrypted env 응답·bundle 본문을 결과에 직렬화하지 않는다', async () => {
    const { promise } = collect({
      env: envPayload({
        secret: VERCEL_SECRET,
        extra: [{ key: 'PRIVATE_METADATA', target: ['preview'], gitBranch: null, value: 'decrypted-response-must-not-print' }],
      }),
      bundle: `${EXPECTED_API_ORIGIN}${API_MARKERS[0]} ${GITHUB_SECRET} decrypted-response-must-not-print`,
    });
    const result = await promise;
    const output = JSON.stringify(result);
    assert.doesNotMatch(output, /github-secret-must-not-print/);
    assert.doesNotMatch(output, /vercel-secret-must-not-print/);
    assert.doesNotMatch(output, /decrypted-response-must-not-print/);
    assert.equal(result.secretBindingEvidence.rawSecretExposed, 'NO');
  });

  it('수집기가 Vercel GET endpoint만 호출하고 application auth traffic을 만들지 않는다', async () => {
    const { promise, calls } = collect();
    await promise;
    assert.ok(calls.length >= 4);
    for (const call of calls) {
      const url = new URL(call.url);
      assert.equal(url.origin, 'https://api.vercel.com');
      assert.equal(call.init.method, 'GET');
      assert.doesNotMatch(url.pathname, /auth|callback|csrf/i);
    }
    assert.equal(calls.some((call) => call.url.includes('api-staging-94af.up.railway.app')), false);
  });
});
