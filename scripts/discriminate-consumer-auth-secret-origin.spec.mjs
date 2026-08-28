import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  API_MARKERS,
  API_ORIGIN_ENV_KEY,
  APPLICATION_SHA,
  CONSUMER_DEPLOYMENT_ID,
  DEPLOYMENT_FILE_RESULTS,
  DEPLOYMENT_RELATIVE_CLASSES,
  EXPECTED_API_ORIGIN,
  ORIGIN_CLASSIFICATIONS,
  PREVIEW_BRANCH,
  READ_STAGES,
  ROOT_CAUSES,
  SECRET_EQUALITIES,
  STATUSES,
  VALUE_READ_RESULTS,
  classifyCurrentApiOrigin,
  classifyDiscrimination,
  classifyEnvBindingRelativeToDeployment,
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

function envPayload({ secret = VERCEL_SECRET, secretCreatedAt = '2026-08-27T00:00:00.000Z', secretUpdatedAt = '2026-08-28T00:00:00.000Z', secretId = 'env-secret-1', secretType = 'plain', secretDecrypted = true, secretSharedEnvId, api = EXPECTED_API_ORIGIN, apiCreatedAt = '2026-08-27T00:00:00.000Z', apiUpdatedAt = '2026-08-28T00:00:00.000Z', apiId = 'env-origin-1', apiType = 'plain', apiDecrypted = true, apiSharedEnvId, extra = [] } = {}) {
  return {
    envs: [
      { id: secretId, key: 'E2E_TEST_SECRET', target: ['preview'], gitBranch: PREVIEW_BRANCH, value: secret, type: secretType, decrypted: secretDecrypted, sharedEnvId: secretSharedEnvId, createdAt: secretCreatedAt, updatedAt: secretUpdatedAt },
      { id: apiId, key: API_ORIGIN_ENV_KEY, target: ['preview'], gitBranch: PREVIEW_BRANCH, value: api, type: apiType, decrypted: apiDecrypted, sharedEnvId: apiSharedEnvId, createdAt: apiCreatedAt, updatedAt: apiUpdatedAt },
      ...extra,
    ],
  };
}

function mockVercel({
  env = envPayload(),
  metadata = envPayload({ secret: '', api: '' }),
  selectedSecret,
  selectedApiOrigin,
  sharedSecret,
  sharedApiOrigin,
  bundle = `const endpoint = '${EXPECTED_API_ORIGIN}${API_MARKERS[0]}';`,
  deploymentStatus = 200,
  projectStatus = 200,
  envV10Status = 200,
  envV9Status = 404,
  decryptStatus = 200,
  filesStatus = 200,
  fileContentStatus = 200,
  reverifyMetadata,
} = {}) {
  const calls = [];
  let metadataReadCount = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const parsed = new URL(url);
    if (parsed.pathname === `/v13/deployments/${CONSUMER_DEPLOYMENT_ID}`) {
      return response({ id: CONSUMER_DEPLOYMENT_ID, projectId: 'prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w', createdAt: '2026-08-28T00:00:01.000Z' }, deploymentStatus);
    }
    if (parsed.pathname === '/v9/projects/prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w') {
      return response({ id: 'prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w', name: 'greenhubconsumer' }, projectStatus);
    }
    if (parsed.pathname === '/v10/projects/prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w/env') {
      if (parsed.searchParams.get('decrypt') !== 'true') metadataReadCount += 1;
      return response(parsed.searchParams.get('decrypt') === 'true' ? env : (metadataReadCount > 1 ? reverifyMetadata ?? metadata : metadata), parsed.searchParams.get('decrypt') === 'true' ? decryptStatus : envV10Status);
    }
    if (parsed.pathname === '/v9/projects/prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w/env') {
      return response(parsed.searchParams.get('decrypt') === 'true' ? env : metadata, parsed.searchParams.get('decrypt') === 'true' ? decryptStatus : envV9Status);
    }
    if (parsed.pathname.startsWith('/v1/projects/prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w/env/')) {
      const id = decodeURIComponent(parsed.pathname.split('/').at(-1));
      if (id === 'env-secret-1') return response(selectedSecret ?? env.envs.find((entry) => entry.key === 'E2E_TEST_SECRET') ?? {}, selectedSecret?.status ?? 200);
      if (id === 'env-origin-1') return response(selectedApiOrigin ?? env.envs.find((entry) => entry.key === API_ORIGIN_ENV_KEY) ?? {}, selectedApiOrigin?.status ?? 200);
      return response({}, 404);
    }
    if (parsed.pathname === '/v1/env/env_sharedsecret1') return response(sharedSecret ?? {}, sharedSecret?.status ?? 200);
    if (parsed.pathname === '/v1/env/env_sharedorigin1') return response(sharedApiOrigin ?? {}, sharedApiOrigin?.status ?? 200);
    if (parsed.pathname === `/v6/deployments/${CONSUMER_DEPLOYMENT_ID}/files`) {
      return response({ files: [{ name: FILE_NAME, uid: 'server-file-1' }] }, filesStatus);
    }
    if (parsed.pathname === `/v8/deployments/${CONSUMER_DEPLOYMENT_ID}/files/server-file-1`) return response(bundle, fileContentStatus);
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
      branch: overrides.branch ?? PREVIEW_BRANCH,
      envRunImpl: overrides.envRunImpl ?? (async () => ({
        secretAvailable: false,
        originAvailable: false,
        secretEquality: SECRET_EQUALITIES.NOT_PROVEN,
        originEquality: SECRET_EQUALITIES.NOT_PROVEN,
      })),
    }),
  };
}

describe('secret/origin 판별 핵심 분류', () => {
  it('secret exact match와 서버 origin match를 함께 증명한다', async () => {
    const { promise } = collect({ env: envPayload({ secret: GITHUB_SECRET }) });
    const result = await promise;
    assert.equal(result.status, 'CONFIGURATION_MATCHED_AUTHORIZE_RUNTIME_BOUNDARY_REQUIRED');
    assert.equal(result.secretBindingEvidence.equality, SECRET_EQUALITIES.MATCH);
    assert.equal(result.apiOriginEvidence.exactDeploymentClassification, ORIGIN_CLASSIFICATIONS.MATCH);
  });

  it('secret mismatch가 배포 시점 이전이면 secret root를 확정한다', async () => {
    const { promise } = collect({ env: envPayload({ secret: VERCEL_SECRET }) });
    const result = await promise;
    assert.equal(result.status, 'ROOT_CAUSE_CONFIRMED_AUTH_HEADER_SECRET_MISMATCH');
    assert.equal(result.discriminationStatus, STATUSES.SECRET_MISMATCH_CONFIRMED);
    assert.equal(result.rootCauseClass, ROOT_CAUSES.AUTH_HEADER_SECRET_MISMATCH);
    assert.equal(result.nextGate, 'P2_AUTH_HEADER_SECRET_MINIMUM_REMEDIATION_GATE');
    assert.deepEqual(result.eliminatedCandidates, [ROOT_CAUSES.CONSUMER_API_ORIGIN_MISMATCH]);
  });

  it('secret match와 exact origin mismatch가 함께 증명되면 origin root를 확정한다', async () => {
    const { promise } = collect({
      env: envPayload({ secret: GITHUB_SECRET, api: 'https://wrong.example' }),
    });
    const result = await promise;
    assert.equal(result.status, 'ROOT_CAUSE_CONFIRMED_CONSUMER_API_ORIGIN_MISMATCH');
    assert.equal(result.discriminationStatus, STATUSES.API_ORIGIN_MISMATCH_CONFIRMED);
    assert.equal(result.rootCauseClass, ROOT_CAUSES.CONSUMER_API_ORIGIN_MISMATCH);
    assert.equal(result.nextGate, 'P2_CONSUMER_API_ORIGIN_MINIMUM_REMEDIATION_GATE');
    assert.deepEqual(result.eliminatedCandidates, [ROOT_CAUSES.AUTH_HEADER_SECRET_MISMATCH]);
  });

  it('secret mismatch와 exact origin mismatch가 함께 있으면 두 후보를 남긴다', async () => {
    const { promise } = collect({ env: envPayload({ api: 'https://wrong.example' }) });
    const result = await promise;
    assert.equal(result.rootCauseClass, ROOT_CAUSES.NOT_CLASSIFIED);
    assert.deepEqual(result.remainingCandidates, [
      ROOT_CAUSES.AUTH_HEADER_SECRET_MISMATCH,
      ROOT_CAUSES.CONSUMER_API_ORIGIN_MISMATCH,
    ]);
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
    assert.equal(result.status, STATUSES.PARTIAL_CONFIGURATION);
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
    assert.equal(classifyCurrentApiOrigin({ entry: { value: 'https://wrong.example/path?token=private' } }), 'CURRENT_API_ORIGIN_MISMATCH');
  });

  it('updatedAt 비교는 before, after, unknown을 구분한다', () => {
    assert.equal(classifyUpdatedRelativeToDeployment('2026-08-28T00:00:00Z', '2026-08-28T00:00:01Z'), DEPLOYMENT_RELATIVE_CLASSES.BEFORE_OR_AT);
    assert.equal(classifyUpdatedRelativeToDeployment('2026-08-28T00:00:02Z', '2026-08-28T00:00:01Z'), DEPLOYMENT_RELATIVE_CLASSES.AFTER);
    assert.equal(classifyUpdatedRelativeToDeployment('not-a-date', '2026-08-28T00:00:01Z'), DEPLOYMENT_RELATIVE_CLASSES.UNKNOWN);
  });

  it('createdAt과 updatedAt이 모두 배포 이전이어야 exact deployment binding으로 분류한다', () => {
    assert.equal(classifyEnvBindingRelativeToDeployment({
      createdAt: '2026-08-27T00:00:00Z',
      updatedAt: '2026-08-28T00:00:00Z',
    }, '2026-08-28T00:00:01Z'), DEPLOYMENT_RELATIVE_CLASSES.BEFORE_OR_AT);
    assert.equal(classifyEnvBindingRelativeToDeployment({
      createdAt: '2026-08-28T00:00:02Z',
      updatedAt: '2026-08-28T00:00:02Z',
    }, '2026-08-28T00:00:01Z'), DEPLOYMENT_RELATIVE_CLASSES.AFTER);
    assert.equal(classifyEnvBindingRelativeToDeployment({
      createdAt: '2026-08-27T00:00:00Z',
      updatedAt: 'not-a-date',
    }, '2026-08-28T00:00:01Z'), DEPLOYMENT_RELATIVE_CLASSES.UNKNOWN);
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
    assert.doesNotMatch(output, /vercel-token-must-not-print/);
    assert.equal(result.secretBindingEvidence.rawSecretExposed, 'NO');
  });

  it('수집기가 Vercel GET endpoint만 호출하고 application auth traffic을 만들지 않는다', async () => {
    const { promise, calls } = collect();
    await promise;
    assert.ok(calls.length >= 4);
    for (const call of calls) {
      const url = new URL(call.url);
      assert.equal(url.origin, 'https://api.vercel.com');
      assert.equal(url.searchParams.get('teamId'), 'team_J91VWI0TqcHdcF36T7qVgiT1');
      assert.equal(call.init.method, 'GET');
      assert.doesNotMatch(url.pathname, /auth|callback|csrf/i);
    }
    assert.equal(calls.some((call) => call.url.includes('api-staging-94af.up.railway.app')), false);
  });
});

describe('Vercel 읽기 경로 복구와 단계별 실패 귀속', () => {
  it('deployment 404를 DEPLOYMENT_METADATA 단계로 귀속한다', async () => {
    const { promise } = collect({ deploymentStatus: 404 });
    const result = await promise;
    assert.equal(result.status, 'SELECTED_ENV_VALUE_READ_CAPABILITY_UNAVAILABLE');
    assert.equal(result.failureCode, 'VERCEL_READ_CREDENTIAL_SCOPE_INVALID_OR_CHANGED');
    assert.deepEqual(result.failure, { stage: READ_STAGES.DEPLOYMENT_METADATA, httpStatus: 404 });
    assert.equal(result.endpointMatrix.deploymentMetadata.httpStatus, 404);
    assert.equal(result.endpointMatrix.deploymentMetadata.result, 'HTTP_404');
    assert.equal(result.endpointMatrix.projectMetadata.result, 'NOT_PROBED');
  });

  it('project 404를 PROJECT_METADATA scope mismatch로 귀속한다', async () => {
    const { promise } = collect({ projectStatus: 404 });
    const result = await promise;
    assert.equal(result.status, 'DIAGNOSTIC_AUTHORITY_MISMATCH');
    assert.equal(result.failureCode, 'VERCEL_PROJECT_SCOPE_READ_MISMATCH');
    assert.deepEqual(result.failure, { stage: READ_STAGES.PROJECT_METADATA, httpStatus: 404 });
    assert.equal(result.endpointMatrix.projectMetadata.httpStatus, 404);
    assert.equal(result.endpointMatrix.envV10Metadata.result, 'NOT_PROBED');
  });

  it('deployment·project·env v10 metadata가 성공하면 V10 복호화 경로를 선택한다', async () => {
    const { promise, calls } = collect();
    const result = await promise;
    assert.equal(result.readPath, 'V10');
    assert.equal(result.endpointMatrix.deploymentMetadata.httpStatus, 200);
    assert.equal(result.endpointMatrix.projectMetadata.httpStatus, 200);
    assert.equal(result.endpointMatrix.envV10Metadata.httpStatus, 200);
    assert.equal(result.endpointMatrix.selectedEnvDecrypt.stage, READ_STAGES.ENV_V10_DECRYPTED);
    assert.equal(result.endpointMatrix.selectedEnvDecrypt.httpStatus, 200);
    const envCalls = calls.filter(({ url }) => new URL(url).pathname.endsWith('/env'));
    assert.equal(envCalls.length, 2);
    assert.equal(new URL(envCalls[0].url).searchParams.has('decrypt'), false);
    assert.equal(new URL(envCalls[1].url).searchParams.get('decrypt'), 'true');
  });

  it('V10 metadata 404에서는 V9 metadata fallback을 사용한다', async () => {
    const { promise, calls } = collect({ envV10Status: 404, envV9Status: 200 });
    const result = await promise;
    assert.equal(result.readPath, 'V9');
    assert.equal(result.endpointMatrix.envV10Metadata.httpStatus, 404);
    assert.equal(result.endpointMatrix.envV9Metadata.httpStatus, 200);
    assert.equal(result.endpointMatrix.selectedEnvDecrypt.stage, READ_STAGES.ENV_V9_DECRYPTED);
    const envCalls = calls.filter(({ url }) => new URL(url).pathname.endsWith('/env'));
    assert.deepEqual(envCalls.map(({ url }) => new URL(url).pathname), [
      '/v10/projects/prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w/env',
      '/v9/projects/prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w/env',
      '/v9/projects/prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w/env',
    ]);
    assert.equal(new URL(envCalls[1].url).searchParams.has('decrypt'), false);
    assert.equal(new URL(envCalls[2].url).searchParams.get('decrypt'), 'true');
  });

  it('V10·V9 metadata가 모두 404이면 환경변수 읽기 capability 부족으로 닫는다', async () => {
    const { promise, calls } = collect({ envV10Status: 404, envV9Status: 404 });
    const result = await promise;
    assert.equal(result.status, 'SELECTED_ENV_VALUE_READ_CAPABILITY_UNAVAILABLE');
    assert.equal(result.failureCode, 'VERCEL_ENV_READ_CAPABILITY_MISSING');
    assert.equal(result.nextGate, 'P2_RUNTIME_EFFECTIVE_ENV_COMPARISON_CONTROL_TOWER_REVIEW');
    assert.equal(result.endpointMatrix.envV10Metadata.httpStatus, 404);
    assert.equal(result.endpointMatrix.envV9Metadata.httpStatus, 404);
    assert.equal(result.endpointMatrix.selectedEnvDecrypt.result, 'NOT_PROBED');
    assert.equal(calls.some(({ url }) => new URL(url).searchParams.get('decrypt') === 'true'), false);
  });

  it('metadata-only 성공 뒤에만 복호화 read를 실행한다', async () => {
    const { promise, calls } = collect();
    await promise;
    const envCalls = calls.filter(({ url }) => new URL(url).pathname.endsWith('/env'));
    assert.equal(new URL(envCalls[0].url).searchParams.has('decrypt'), false);
    assert.equal(new URL(envCalls[1].url).searchParams.get('decrypt'), 'true');
  });

  it('env metadata 404이면 복호화 read를 실행하지 않는다', async () => {
    const { promise, calls } = collect({ envV10Status: 404, envV9Status: 404 });
    await promise;
    assert.equal(calls.some(({ url }) => new URL(url).searchParams.get('decrypt') === 'true'), false);
  });

  it('Git source deployment에서는 deployment files를 요청하지 않고 not applicable로 남긴다', async () => {
    const { promise } = collect({
      env: envPayload({ secret: GITHUB_SECRET, apiUpdatedAt: '2026-08-28T00:00:02.000Z' }),
      filesStatus: 404,
    });
    const result = await promise;
    assert.equal(result.ready, true);
    assert.equal(result.secretBindingEvidence.equality, SECRET_EQUALITIES.MATCH);
    assert.equal(result.secretBindingEvidence.envUpdatedRelativeToDeployment, DEPLOYMENT_RELATIVE_CLASSES.BEFORE_OR_AT);
    assert.equal(result.endpointMatrix.deploymentFiles.httpStatus, null);
    assert.equal(result.endpointMatrix.deploymentFiles.result, DEPLOYMENT_FILE_RESULTS.NOT_APPLICABLE_GIT_SOURCE);
    assert.equal(result.endpointMatrix.deploymentFileContent.result, DEPLOYMENT_FILE_RESULTS.NOT_APPLICABLE_GIT_SOURCE);
    assert.equal(result.deploymentFilesRequired, false);
    assert.equal(result.deploymentFilesAvailable, false);
    assert.equal(result.apiOriginEvidence.serverBundleEvidence, DEPLOYMENT_FILE_RESULTS.NOT_APPLICABLE_GIT_SOURCE);
    assert.equal(result.apiOriginEvidence.exactDeploymentClassification, ORIGIN_CLASSIFICATIONS.NOT_PROVEN);
  });

  it('origin binding이 배포 이후면 server bundle fallback 없이 partial로 닫는다', async () => {
    const { promise } = collect({
      env: envPayload({ apiUpdatedAt: '2026-08-28T00:00:02.000Z' }),
      filesStatus: 404,
    });
    const result = await promise;
    assert.equal(result.rootCauseClass, ROOT_CAUSES.NOT_CLASSIFIED);
    assert.equal(result.finalClassification, 'PARTIAL_CONFIGURATION_DISCRIMINATION');
    assert.deepEqual(result.remainingCandidates, [ROOT_CAUSES.CONSUMER_API_ORIGIN_MISMATCH]);
    assert.equal(result.nextGate, 'P2_REMAINING_CONFIGURATION_EVIDENCE_GATE');
  });
});

describe('선택된 환경 변수 값 읽기 capability', () => {
  const unavailableEnv = () => envPayload({ secret: '', api: '' });

  it('V10 HTTP 200이어도 값이 없으면 value-read 성공으로 분류하지 않는다', async () => {
    const { promise } = collect({
      env: unavailableEnv(),
      metadata: unavailableEnv(),
      envRunImpl: async () => ({
        secretAvailable: false,
        originAvailable: false,
        secretEquality: SECRET_EQUALITIES.NOT_PROVEN,
        originEquality: SECRET_EQUALITIES.NOT_PROVEN,
      }),
    });
    const result = await promise;
    assert.equal(result.endpointMatrix.envV10DecryptedCliSource.httpStatus, 200);
    assert.equal(result.endpointMatrix.envV10DecryptedCliSource.result, VALUE_READ_RESULTS.HTTP_200_VALUE_UNAVAILABLE);
    assert.equal(result.endpointMatrix.envV10DecryptedCliSource.keys.E2E_TEST_SECRET.valueAvailable, 'NO');
    assert.equal(result.endpointMatrix.envV10DecryptedCliSource.keys[API_ORIGIN_ENV_KEY].valueAvailable, 'NO');
    assert.equal(result.status, 'SELECTED_ENV_VALUE_READ_CAPABILITY_UNAVAILABLE');
  });

  it('V10 CLI source decrypt 요청에 정확한 source와 branch 필터를 포함한다', async () => {
    const { promise, calls } = collect();
    await promise;
    const metadataCall = calls.find(({ url }) => {
      const parsed = new URL(url);
      return parsed.pathname === '/v10/projects/prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w/env'
        && parsed.searchParams.get('decrypt') !== 'true';
    });
    const decryptCall = calls.find(({ url }) => {
      const parsed = new URL(url);
      return parsed.pathname === '/v10/projects/prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w/env'
        && parsed.searchParams.get('decrypt') === 'true';
    });
    assert.equal(new URL(metadataCall.url).searchParams.get('gitBranch'), PREVIEW_BRANCH);
    assert.equal(new URL(decryptCall.url).searchParams.get('gitBranch'), PREVIEW_BRANCH);
    assert.equal(new URL(decryptCall.url).searchParams.get('source'), 'vercel-cli:pull');
  });

  it('Stage A 값이 없으면 선택된 ID별 project-env endpoint를 각각 조회한다', async () => {
    const { promise, calls } = collect({
      env: unavailableEnv(),
      metadata: unavailableEnv(),
      selectedSecret: { key: 'E2E_TEST_SECRET', value: GITHUB_SECRET, type: 'plain', decrypted: true },
      selectedApiOrigin: { key: API_ORIGIN_ENV_KEY, value: `${EXPECTED_API_ORIGIN}/`, type: 'plain', decrypted: true },
    });
    const result = await promise;
    assert.equal(result.endpointMatrix.selectedSecretProjectEnv.result, VALUE_READ_RESULTS.HTTP_200_VALUE_AVAILABLE);
    assert.equal(result.endpointMatrix.selectedApiOriginProjectEnv.result, VALUE_READ_RESULTS.HTTP_200_VALUE_AVAILABLE);
    assert.equal(result.endpointMatrix.vercelEnvRun.result, VALUE_READ_RESULTS.NOT_PROBED);
    assert.equal(calls.filter(({ url }) => new URL(url).pathname.startsWith('/v1/projects/')).length, 2);
    assert.equal(result.status, 'CONFIGURATION_MATCHED_AUTHORIZE_RUNTIME_BOUNDARY_REQUIRED');
  });

  it('project-env HTTP 200에 value가 없으면 다음 fallback으로 진행한다', async () => {
    let envRunCalled = false;
    const { promise } = collect({
      env: unavailableEnv(),
      metadata: unavailableEnv(),
      selectedSecret: { key: 'E2E_TEST_SECRET', type: 'encrypted', decrypted: true },
      selectedApiOrigin: { key: API_ORIGIN_ENV_KEY, type: 'encrypted', decrypted: true },
      envRunImpl: async () => {
        envRunCalled = true;
        return {
          secretAvailable: true,
          originAvailable: true,
          secretEquality: SECRET_EQUALITIES.MATCH,
          originEquality: SECRET_EQUALITIES.MATCH,
        };
      },
    });
    const result = await promise;
    assert.equal(envRunCalled, true);
    assert.equal(result.endpointMatrix.selectedSecretProjectEnv.result, VALUE_READ_RESULTS.HTTP_200_VALUE_UNAVAILABLE);
    assert.equal(result.endpointMatrix.selectedApiOriginProjectEnv.result, VALUE_READ_RESULTS.HTTP_200_VALUE_UNAVAILABLE);
    assert.equal(result.endpointMatrix.vercelEnvRun.result, VALUE_READ_RESULTS.HTTP_200_VALUE_AVAILABLE);
    assert.equal(result.status, 'CONFIGURATION_MATCHED_AUTHORIZE_RUNTIME_BOUNDARY_REQUIRED');
  });

  it('selected project-env 401과 403은 selected env permission recovery로 분류한다', async () => {
    const { promise } = collect({
      env: unavailableEnv(),
      metadata: unavailableEnv(),
      selectedSecret: { status: 401, key: 'E2E_TEST_SECRET' },
      selectedApiOrigin: { status: 403, key: API_ORIGIN_ENV_KEY },
      envRunImpl: async () => ({
        secretAvailable: false,
        originAvailable: false,
        secretEquality: SECRET_EQUALITIES.NOT_PROVEN,
        originEquality: SECRET_EQUALITIES.NOT_PROVEN,
      }),
    });
    const result = await promise;
    assert.equal(result.endpointMatrix.selectedSecretProjectEnv.result, VALUE_READ_RESULTS.HTTP_401);
    assert.equal(result.endpointMatrix.selectedApiOriginProjectEnv.result, VALUE_READ_RESULTS.HTTP_403);
    assert.equal(result.status, 'SELECTED_ENV_VALUE_READ_CAPABILITY_UNAVAILABLE');
    assert.equal(result.nextGate, 'P2_VERCEL_SELECTED_ENV_VALUE_PERMISSION_RECOVERY_GATE');
  });

  it('shared-env ID가 metadata에 명시된 경우에만 shared endpoint를 조회한다', async () => {
    const env = envPayload({
      secret: '',
      api: '',
      secretSharedEnvId: 'env_sharedsecret1',
      apiSharedEnvId: 'env_sharedorigin1',
    });
    const { promise, calls } = collect({
      env,
      metadata: env,
      selectedSecret: { key: 'E2E_TEST_SECRET', type: 'encrypted', decrypted: true },
      selectedApiOrigin: { key: API_ORIGIN_ENV_KEY, type: 'encrypted', decrypted: true },
      sharedSecret: { key: 'E2E_TEST_SECRET', value: GITHUB_SECRET, type: 'plain', decrypted: true },
      sharedApiOrigin: { key: API_ORIGIN_ENV_KEY, value: EXPECTED_API_ORIGIN, type: 'plain', decrypted: true },
    });
    const result = await promise;
    assert.equal(result.endpointMatrix.sharedSecretEnv.result, VALUE_READ_RESULTS.HTTP_200_VALUE_AVAILABLE);
    assert.equal(result.endpointMatrix.sharedApiOriginEnv.result, VALUE_READ_RESULTS.HTTP_200_VALUE_AVAILABLE);
    assert.equal(calls.some(({ url }) => new URL(url).pathname === '/v1/env/env_sharedsecret1'), true);
    assert.equal(calls.some(({ url }) => new URL(url).pathname === '/v1/env/env_sharedorigin1'), true);
    assert.equal(result.status, 'CONFIGURATION_MATCHED_AUTHORIZE_RUNTIME_BOUNDARY_REQUIRED');
  });

  it('shared-env identity가 명시되지 않으면 ID를 추측하지 않는다', async () => {
    const { promise, calls } = collect({
      env: unavailableEnv(),
      metadata: unavailableEnv(),
      envRunImpl: async () => ({
        secretAvailable: false,
        originAvailable: false,
        secretEquality: SECRET_EQUALITIES.NOT_PROVEN,
        originEquality: SECRET_EQUALITIES.NOT_PROVEN,
      }),
    });
    const result = await promise;
    assert.equal(calls.some(({ url }) => new URL(url).pathname.startsWith('/v1/env/')), false);
    assert.equal(result.endpointMatrix.sharedSecretEnv.result, VALUE_READ_RESULTS.NOT_APPLICABLE);
    assert.equal(result.endpointMatrix.sharedApiOriginEnv.result, VALUE_READ_RESULTS.NOT_APPLICABLE);
  });

  it('env-run secret MATCH를 in-memory binding 증거로 반영한다', async () => {
    const { promise } = collect({
      env: unavailableEnv(),
      metadata: unavailableEnv(),
      envRunImpl: async () => ({
        secretAvailable: true,
        originAvailable: true,
        secretEquality: SECRET_EQUALITIES.MATCH,
        originEquality: SECRET_EQUALITIES.MATCH,
      }),
    });
    const result = await promise;
    assert.equal(result.secretBindingEvidence.equality, SECRET_EQUALITIES.MATCH);
    assert.equal(result.secretBindingEvidence.selectedRowUnchanged, 'YES');
    assert.equal(result.status, 'CONFIGURATION_MATCHED_AUTHORIZE_RUNTIME_BOUNDARY_REQUIRED');
  });

  it('env-run secret MISMATCH를 auth header secret root로 분류한다', async () => {
    const { promise } = collect({
      env: unavailableEnv(),
      metadata: unavailableEnv(),
      envRunImpl: async () => ({
        secretAvailable: true,
        originAvailable: true,
        secretEquality: SECRET_EQUALITIES.MISMATCH,
        originEquality: SECRET_EQUALITIES.MATCH,
      }),
    });
    const result = await promise;
    assert.equal(result.status, 'ROOT_CAUSE_CONFIRMED_AUTH_HEADER_SECRET_MISMATCH');
    assert.equal(result.rootCauseClass, ROOT_CAUSES.AUTH_HEADER_SECRET_MISMATCH);
  });

  it('env-run origin MATCH와 MISMATCH를 각각 분류한다', async () => {
    const matching = await collect({
      env: unavailableEnv(),
      metadata: unavailableEnv(),
      envRunImpl: async () => ({
        secretAvailable: true,
        originAvailable: true,
        secretEquality: SECRET_EQUALITIES.MATCH,
        originEquality: SECRET_EQUALITIES.MATCH,
      }),
    });
    const mismatching = await collect({
      env: unavailableEnv(),
      metadata: unavailableEnv(),
      envRunImpl: async () => ({
        secretAvailable: true,
        originAvailable: true,
        secretEquality: SECRET_EQUALITIES.MATCH,
        originEquality: SECRET_EQUALITIES.MISMATCH,
      }),
    });
    const matchingResult = await matching.promise;
    const mismatchingResult = await mismatching.promise;
    assert.equal(matchingResult.apiOriginEvidence.exactDeploymentClassification, ORIGIN_CLASSIFICATIONS.MATCH);
    assert.equal(mismatchingResult.apiOriginEvidence.exactDeploymentClassification, ORIGIN_CLASSIFICATIONS.MISMATCH);
    assert.equal(mismatchingResult.status, 'ROOT_CAUSE_CONFIRMED_CONSUMER_API_ORIGIN_MISMATCH');
  });

  it('env-run 결과와 collector 결과는 비밀값·Authorization header를 직렬화하지 않는다', async () => {
    const { promise } = collect({
      env: envPayload({ secret: VERCEL_SECRET, api: EXPECTED_API_ORIGIN }),
      envRunImpl: async () => ({
        secretAvailable: true,
        originAvailable: true,
        secretEquality: SECRET_EQUALITIES.MATCH,
        originEquality: SECRET_EQUALITIES.MATCH,
      }),
    });
    const result = await promise;
    const output = JSON.stringify(result);
    assert.doesNotMatch(output, new RegExp(GITHUB_SECRET));
    assert.doesNotMatch(output, new RegExp(VERCEL_SECRET));
    assert.doesNotMatch(output, /Authorization: Bearer/);
    assert.doesNotMatch(output, /secretValue|originValue/);
  });

  it('env-run 직전 selected row identity가 바뀌면 exact deployment 증거로 사용하지 않는다', async () => {
    const { promise } = collect({
      env: unavailableEnv(),
      metadata: unavailableEnv(),
      reverifyMetadata: envPayload({ secret: '', api: '', secretId: 'env-secret-changed', apiId: 'env-origin-changed' }),
      envRunImpl: async () => ({
        secretAvailable: true,
        originAvailable: true,
        secretEquality: SECRET_EQUALITIES.MATCH,
        originEquality: SECRET_EQUALITIES.MATCH,
      }),
    });
    const result = await promise;
    assert.equal(result.secretBindingEvidence.selectedRowUnchanged, 'NO');
    assert.equal(result.apiOriginEvidence.selectedRowUnchanged, 'NO');
    assert.equal(result.status, 'SELECTED_ENV_VALUE_READ_CAPABILITY_UNAVAILABLE');
    assert.equal(result.nextGate, 'P2_RUNTIME_EFFECTIVE_ENV_COMPARISON_CONTROL_TOWER_REVIEW');
  });
});
