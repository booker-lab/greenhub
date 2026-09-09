import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertAllowedCliInvocation,
  assertReadOnlyQuery,
  buildRailwayAuthHeaders,
  CLI_STATUS_EVIDENCE_SOURCE,
  collectRailwayBindingEvidence,
  evaluateRailwayRevisionBinding,
  extractDeploymentCandidates,
  extractDomainCandidates,
  hasExplicitRailwayCredential,
  inspectRuntimeUrl,
  isNonProductionEnvironment,
  isProductionHostname,
  isRailwayMutationArgs,
  normalizeBindingInput,
  normalizeCliStatusBinding,
  normalizeDeploymentEvidence,
  normalizeDomainEntry,
  normalizeRailwayTokenKind,
  normalizeReadSource,
  normalizeRuntimeUrl,
  queryRailwayGraphQL,
  RAILWAY_CLI_ALLOWLIST,
  READ_ONLY_EVIDENCE_SOURCE,
  READ_SOURCE_CLI_STATUS,
  READ_SOURCE_GRAPHQL,
  READ_SOURCE_OFFLINE,
  RAILWAY_PROJECT_ACCESS_TOKEN_HEADER,
  readRailwayCliStatus,
  resolveRailwayAuthCredential,
  resolveRailwayReadSource,
  selectSingleDeployment,
} from './verify-railway-staging-binding.mjs';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

function validInput(overrides = {}) {
  return {
    expectedSha: SHA,
    environment: 'staging',
    deployment: {
      id: 'deployment-revision-001',
      sha: SHA,
      state: 'SUCCESS',
      environment: 'staging',
      serviceId: 'service-api',
      environmentId: 'env-staging',
    },
    runtime: {
      url: 'https://api-staging-94af.up.railway.app',
      deploymentId: 'deployment-revision-001',
      serviceId: 'service-api',
      environmentId: 'env-staging',
    },
    evidenceSource: READ_ONLY_EVIDENCE_SOURCE,
    ...overrides,
  };
}

describe('Railway staging binding PASS 계약', () => {
  it('exact SHA + SUCCESS + staging + 실제 runtime URL + 같은 revision이면 통과한다', () => {
    const result = evaluateRailwayRevisionBinding(validInput());

    assert.equal(result.ready, true);
    assert.deepEqual(result.failureCodes, []);
    assert.equal(result.expectedSha, SHA);
    assert.equal(result.deploymentId, 'deployment-revision-001');
    assert.equal(result.revisionId, 'deployment-revision-001');
    assert.equal(result.deploymentSha, SHA);
    assert.equal(result.deploymentState, 'SUCCESS');
    assert.equal(result.runtimeUrl, 'https://api-staging-94af.up.railway.app');
    assert.equal(result.environment, 'staging');
    assert.equal(result.nonProduction, true);
    assert.equal(result.evidenceSource, READ_ONLY_EVIDENCE_SOURCE);
  });

  it('READY state도 SUCCESS와 함께 인정한다', () => {
    const result = evaluateRailwayRevisionBinding(
      validInput({ deployment: { ...validInput().deployment, state: 'ready' } }),
    );

    assert.equal(result.ready, true);
    assert.equal(result.deploymentState, 'READY');
  });
});

describe('Railway staging binding FAIL 계약', () => {
  it('SHA mismatch를 거부한다', () => {
    const result = evaluateRailwayRevisionBinding(
      validInput({ deployment: { ...validInput().deployment, sha: OTHER_SHA } }),
    );

    assert.equal(result.ready, false);
    assert.ok(result.failureCodes.includes('DEPLOYMENT_SHA_MISMATCH'));
    assert.equal(result.nonProduction, true);
  });

  it('pending/failed state를 success로 추정하지 않는다', () => {
    for (const state of ['BUILDING', 'DEPLOYING', 'PENDING', 'FAILED', 'CRASHED', 'REMOVED', '']) {
      const result = evaluateRailwayRevisionBinding(
        validInput({ deployment: { ...validInput().deployment, state } }),
      );

      assert.equal(result.ready, false, `state=${state || 'missing'}`);
      assert.ok(result.failureCodes.includes('DEPLOYMENT_STATE_NOT_SUCCESS'));
    }
  });

  it('production environment를 target으로 인정하지 않는다', () => {
    const declared = evaluateRailwayRevisionBinding(validInput({ environment: 'production' }));

    assert.equal(declared.ready, false);
    assert.ok(declared.failureCodes.includes('PRODUCTION_ENVIRONMENT'));

    const deploymentEnv = evaluateRailwayRevisionBinding(
      validInput({
        environment: 'production',
        deployment: { ...validInput().deployment, environment: 'production' },
      }),
    );

    assert.equal(deploymentEnv.ready, false);
    assert.ok(deploymentEnv.failureCodes.includes('PRODUCTION_ENVIRONMENT'));
  });

  it('staging이 아닌 identifier를 거부한다', () => {
    const result = evaluateRailwayRevisionBinding(validInput({ environment: 'preview' }));

    assert.equal(result.ready, false);
    assert.ok(result.failureCodes.includes('ENVIRONMENT_NOT_STAGING'));
  });

  it('production runtime hostname을 거부한다', () => {
    for (const url of [
      'https://api-production-13e7.up.railway.app',
      'https://api-production-99ff.up.railway.app/health',
      'https://greenlove.co.kr',
    ]) {
      const result = evaluateRailwayRevisionBinding(
        validInput({ runtime: { ...validInput().runtime, url } }),
      );

      assert.equal(result.ready, false, url);
      assert.ok(result.failureCodes.includes('PRODUCTION_RUNTIME_URL'));
      assert.equal(result.nonProduction, false);
    }
  });

  it('dashboard URL을 실제 runtime URL로 인정하지 않는다', () => {
    for (const url of [
      'https://railway.com/project/abc123',
      'https://backboard.railway.com/project/abc123',
      'https://railway.app/project/abc123',
    ]) {
      const result = evaluateRailwayRevisionBinding(
        validInput({ runtime: { ...validInput().runtime, url } }),
      );

      assert.equal(result.ready, false, url);
      assert.ok(result.failureCodes.includes('RUNTIME_URL_IS_DASHBOARD'));
      assert.equal(result.nonProduction, false);
    }
  });

  it('runtime URL이 없으면 거부한다', () => {
    const missing = evaluateRailwayRevisionBinding(
      validInput({ runtime: { ...validInput().runtime, url: '' } }),
    );

    assert.equal(missing.ready, false);
    assert.ok(missing.failureCodes.includes('RUNTIME_URL_MISSING'));

    const absent = evaluateRailwayRevisionBinding(validInput({ runtime: null }));

    assert.equal(absent.ready, false);
    assert.ok(absent.failureCodes.includes('RUNTIME_EVIDENCE_MISSING'));
  });

  it('revision SHA가 없으면 거부한다', () => {
    const { sha: _ignored, ...withoutSha } = validInput().deployment;
    const result = evaluateRailwayRevisionBinding(
      validInput({ deployment: withoutSha }),
    );

    assert.equal(result.ready, false);
    assert.ok(result.failureCodes.includes('DEPLOYMENT_SHA_MISSING'));
  });

  it('URL/revision mismatch와 묶인 revision 누락을 거부한다', () => {
    const mismatch = evaluateRailwayRevisionBinding(
      validInput({ runtime: { ...validInput().runtime, deploymentId: 'other-revision' } }),
    );

    assert.equal(mismatch.ready, false);
    assert.ok(mismatch.failureCodes.includes('URL_REVISION_MISMATCH'));

    const { deploymentId: _dropped, ...withoutBinding } = validInput().runtime;
    const unbound = evaluateRailwayRevisionBinding(validInput({ runtime: withoutBinding }));

    assert.equal(unbound.ready, false);
    assert.ok(unbound.failureCodes.includes('BOUND_REVISION_MISSING'));
  });

  it('service/environment binding이 deployment와 다르면 거부한다', () => {
    const serviceMismatch = evaluateRailwayRevisionBinding(
      validInput({ runtime: { ...validInput().runtime, serviceId: 'other-service' } }),
    );

    assert.equal(serviceMismatch.ready, false);
    assert.ok(serviceMismatch.failureCodes.includes('URL_REVISION_MISMATCH'));
  });

  it('malformed metadata를 거부한다', () => {
    const notObject = evaluateRailwayRevisionBinding(validInput({ deployment: 'rev-1' }));

    assert.equal(notObject.ready, false);
    assert.ok(notObject.failureCodes.includes('DEPLOYMENT_EVIDENCE_MISSING'));

    const selection = selectSingleDeployment('not-an-array', { expectedSha: SHA });

    assert.equal(selection.deployment, null);
    assert.equal(selection.failureCode, 'METADATA_MALFORMED');
  });

  it('모호한 SHA 후보를 거부한다', () => {
    const conflicting = normalizeDeploymentEvidence({
      id: 'rev-1',
      sha: SHA,
      meta: { commitHash: OTHER_SHA },
      state: 'SUCCESS',
      environment: 'staging',
    });

    assert.equal(conflicting.deployment, null);
    assert.equal(conflicting.failureCode, 'DEPLOYMENT_SHA_AMBIGUOUS');
  });

  it('credential/query/hash가 포함된 runtime URL을 거부한다', () => {
    const credential = evaluateRailwayRevisionBinding(
      validInput({
        runtime: { ...validInput().runtime, url: 'https://user:pass@api-staging-94af.up.railway.app' },
      }),
    );

    assert.equal(credential.ready, false);
    assert.ok(credential.failureCodes.includes('RUNTIME_URL_HAS_CREDENTIALS'));

    const query = evaluateRailwayRevisionBinding(
      validInput({
        runtime: { ...validInput().runtime, url: 'https://api-staging-94af.up.railway.app?token=abc' },
      }),
    );

    assert.equal(query.ready, false);
    assert.ok(query.failureCodes.includes('RUNTIME_URL_HAS_QUERY_OR_HASH'));

    const hash = evaluateRailwayRevisionBinding(
      validInput({
        runtime: { ...validInput().runtime, url: 'https://api-staging-94af.up.railway.app#sha=aabbcc' },
      }),
    );

    assert.equal(hash.ready, false);
    assert.ok(hash.failureCodes.includes('RUNTIME_URL_HAS_QUERY_OR_HASH'));
  });

  it('Railway runtime이 아닌 HTTPS URL을 거부한다', () => {
    const result = evaluateRailwayRevisionBinding(
      validInput({ runtime: { ...validInput().runtime, url: 'https://staging.example.test' } }),
    );

    assert.equal(result.ready, false);
    assert.ok(result.failureCodes.includes('RUNTIME_URL_NOT_RAILWAY_RUNTIME'));
  });

  it('GitHub combined status success만으로 PASS하지 않는다', () => {
    for (const evidenceSource of ['github-combined-status', 'github-commit-status', 'github-status']) {
      const result = evaluateRailwayRevisionBinding(validInput({ evidenceSource }));

      assert.equal(result.ready, false, evidenceSource);
      assert.ok(result.failureCodes.includes('GITHUB_STATUS_ALONE_INSUFFICIENT'));
    }
  });

  it('expected SHA가 없거나 형식이 아니면 거부한다', () => {
    for (const expectedSha of ['', 'latest', 'A'.repeat(40).toLowerCase().slice(0, 39)]) {
      const result = evaluateRailwayRevisionBinding(validInput({ expectedSha }));

      assert.equal(result.ready, false);
      assert.ok(result.failureCodes.includes('EXPECTED_SHA_INVALID'));
    }
  });
});

describe('deployment 선택 — timestamp inference 금지', () => {
  function candidate(id, sha = SHA, state = 'SUCCESS') {
    return {
      id,
      sha,
      state,
      environment: 'staging',
      updated_at: id === 'rev-old' ? '2026-09-01T00:00:00Z' : '2026-09-08T00:00:00Z',
    };
  }

  it('SHA가 없는 후보는 최신 timestamp라도 선택하지 않는다', () => {
    const selection = selectSingleDeployment(
      [{ id: 'rev-new', state: 'SUCCESS', environment: 'staging', updated_at: '2026-09-08T00:00:00Z' }],
      { expectedSha: SHA },
    );

    assert.equal(selection.deployment, null);
    assert.equal(selection.failureCode, 'DEPLOYMENT_SHA_MISSING');
  });

  it('같은 SHA의 revision이 2개 이상이면 ambiguous로 닫는다', () => {
    const selection = selectSingleDeployment([candidate('rev-1'), candidate('rev-2')], {
      expectedSha: SHA,
    });

    assert.equal(selection.deployment, null);
    assert.equal(selection.failureCode, 'AMBIGUOUS_MULTIPLE_DEPLOYMENTS');
  });

  it('명시한 deployment-id로만 ambiguous를 해소한다', () => {
    const selection = selectSingleDeployment([candidate('rev-1'), candidate('rev-2')], {
      expectedSha: SHA,
      deploymentId: 'rev-2',
    });

    assert.equal(selection.failureCode, null);
    assert.equal(selection.deployment.id, 'rev-2');
  });

  it('단일 exact-SHA 후보는 timestamp와 무관하게 SHA로 선택한다', () => {
    const selection = selectSingleDeployment([candidate('rev-old')], { expectedSha: SHA });

    assert.equal(selection.failureCode, null);
    assert.equal(selection.deployment.id, 'rev-old');
  });

  it('expected SHA와 같은 revision이 없으면 NOT_FOUND로 닫는다', () => {
    const selection = selectSingleDeployment([candidate('rev-1', OTHER_SHA)], {
      expectedSha: SHA,
    });

    assert.equal(selection.deployment, null);
    assert.equal(selection.failureCode, 'DEPLOYMENT_NOT_FOUND');
  });
});

describe('runtime URL 판정', () => {
  it('안전한 runtime URL만 정규화한다', () => {
    assert.equal(
      normalizeRuntimeUrl(' https://api-staging-94af.up.railway.app/ '),
      'https://api-staging-94af.up.railway.app',
    );
    assert.equal(normalizeRuntimeUrl('http://api-staging-94af.up.railway.app'), null);
    assert.equal(normalizeRuntimeUrl(''), null);
  });

  it('staging만 non-production으로 분류한다', () => {
    assert.equal(isNonProductionEnvironment('staging'), true);
    assert.equal(isNonProductionEnvironment('STAGING'), true);
    assert.equal(isNonProductionEnvironment('production'), false);
    assert.equal(isNonProductionEnvironment('preview'), false);
  });

  it('production hostname을 식별한다', () => {
    assert.equal(isProductionHostname('api-production-13e7.up.railway.app'), true);
    assert.equal(isProductionHostname('api-production-xxxx.up.railway.app'), true);
    assert.equal(isProductionHostname('greenlove.co.kr'), true);
    assert.equal(isProductionHostname('seller.greenlove.co.kr'), true);
    assert.equal(isProductionHostname('api-staging-94af.up.railway.app'), false);
  });

  it('dashboard와 runtime host를 구분한다', () => {
    assert.equal(inspectRuntimeUrl('https://railway.com/project/x').kind, 'dashboard');
    assert.equal(inspectRuntimeUrl('https://backboard.railway.com/x').kind, 'dashboard');
    assert.equal(
      inspectRuntimeUrl('https://api-staging-94af.up.railway.app').kind,
      'railway-runtime',
    );
  });
});

describe('read-only Railway 조회 계약', () => {
  it('mutation 문서를 전송 전에 거부한다', () => {
    assert.throws(() => assertReadOnlyQuery('mutation { deploy }'), /mutation은 binder에서 금지/);
    assert.throws(() => assertReadOnlyQuery('{ deployments { id } }'), /read-only query만 허용/);
    assert.equal(typeof assertReadOnlyQuery('query Foo { deployments { id } }'), 'string');
  });

  it('명시적 account credential은 Authorization Bearer로 POST 조회하고 토큰을 오류에 포함하지 않는다', async () => {
    const calls = [];
    const data = await queryRailwayGraphQL({
      apiToken: 'synthetic-account-token-001',
      query: 'query Foo { deployments { id } }',
      variables: { serviceId: 'service-api' },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({ data: { deployments: [] } }) };
      },
    });

    assert.deepEqual(data, { deployments: [] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.authorization, 'Bearer synthetic-account-token-001');
    assert.ok(!('Project-Access-Token' in calls[0].options.headers));

    await assert.rejects(
      () =>
        queryRailwayGraphQL({
          apiToken: 'synthetic-account-token-001',
          query: 'query Foo { deployments { id } }',
          fetchImpl: async () => ({ ok: false, status: 500 }),
        }),
      (error) => {
        assert.ok(!String(error.message).includes('synthetic-account-token-001'));
        return true;
      },
    );
  });

  it('legacy RAILWAY_TOKEN 단독은 ambiguous로 닫히고 Bearer로 추측하지 않는다', async () => {
    await assert.rejects(
      () =>
        queryRailwayGraphQL({
          token: 'synthetic-legacy-token-001',
          query: 'query Foo { deployments { id } }',
          fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }),
        }),
      /RAILWAY_AUTH_AMBIGUOUS/,
    );
  });

  it('알 수 없는 응답 shape를 추측하지 않고 닫는다', () => {
    const unknown = extractDeploymentCandidates({ unexpected: { shape: true } });

    assert.equal(unknown.candidates, null);
    assert.equal(unknown.failureCode, 'RAILWAY_SCHEMA_UNRECOGNIZED');

    const edges = extractDeploymentCandidates({
      deployments: { edges: [{ node: { id: 'rev-1' } }] },
    });

    assert.deepEqual(edges.candidates, [{ id: 'rev-1' }]);

    const domains = extractDomainCandidates({ domains: [{ domain: 'api-staging-94af.up.railway.app' }] });

    assert.equal(domains.failureCode, null);
    assert.deepEqual(normalizeDomainEntry(domains.candidates[0]).domain, 'api-staging-94af.up.railway.app');
    assert.equal(normalizeDomainEntry(null), null);
  });
});

describe('Railway read auth 명시 계약 (FE-PILOT-RAILWAY-READ-AUTH-CONTRACT-03)', () => {
  it('account/workspace credential은 Authorization Bearer를 사용한다', async () => {
    assert.equal(normalizeRailwayTokenKind('account'), 'account');
    assert.equal(normalizeRailwayTokenKind('workspace'), 'account');
    assert.equal(normalizeRailwayTokenKind('project'), 'project');

    const fromApi = resolveRailwayAuthCredential({ apiToken: 'synthetic-account-aaa' });
    assert.deepEqual(fromApi, { kind: 'account', token: 'synthetic-account-aaa' });
    assert.deepEqual(buildRailwayAuthHeaders(fromApi), {
      authorization: 'Bearer synthetic-account-aaa',
    });

    const fromLegacyAccount = resolveRailwayAuthCredential({
      token: 'synthetic-legacy-bbb',
      tokenKind: 'account',
    });
    assert.equal(fromLegacyAccount.kind, 'account');
    assert.deepEqual(buildRailwayAuthHeaders(fromLegacyAccount), {
      authorization: 'Bearer synthetic-legacy-bbb',
    });

    const fromLegacyWorkspace = resolveRailwayAuthCredential({
      token: 'synthetic-legacy-ccc',
      authKind: 'workspace',
    });
    assert.equal(fromLegacyWorkspace.kind, 'account');

    const calls = [];
    await queryRailwayGraphQL({
      token: 'synthetic-legacy-bbb',
      tokenKind: 'account',
      query: 'query Foo { deployments { id } }',
      fetchImpl: async (url, options) => {
        calls.push(options);
        return { ok: true, json: async () => ({ data: { deployments: [] } }) };
      },
    });
    assert.equal(calls[0].headers.authorization, 'Bearer synthetic-legacy-bbb');
    assert.ok(!(RAILWAY_PROJECT_ACCESS_TOKEN_HEADER in calls[0].headers));
  });

  it('project credential은 Project-Access-Token을 사용한다', async () => {
    const fromProject = resolveRailwayAuthCredential({ projectToken: 'synthetic-project-aaa' });
    assert.deepEqual(fromProject, { kind: 'project', token: 'synthetic-project-aaa' });
    const headers = buildRailwayAuthHeaders(fromProject);
    assert.equal(headers[RAILWAY_PROJECT_ACCESS_TOKEN_HEADER], 'synthetic-project-aaa');
    assert.ok(!('authorization' in headers));

    const fromLegacy = resolveRailwayAuthCredential({
      token: 'synthetic-legacy-proj',
      tokenKind: 'project',
    });
    assert.equal(fromLegacy.kind, 'project');

    const calls = [];
    await queryRailwayGraphQL({
      projectToken: 'synthetic-project-aaa',
      query: 'query Foo { deployments { id } }',
      fetchImpl: async (url, options) => {
        calls.push(options);
        return { ok: true, json: async () => ({ data: { deployments: [] } }) };
      },
    });
    assert.equal(calls[0].headers[RAILWAY_PROJECT_ACCESS_TOKEN_HEADER], 'synthetic-project-aaa');
    assert.ok(!('authorization' in calls[0].headers));
  });

  it('잘못된 헤더를 조용히 선택하지 않는다', async () => {
    const accountCalls = [];
    await queryRailwayGraphQL({
      apiToken: 'synthetic-account-xxx',
      query: 'query Foo { deployments { id } }',
      fetchImpl: async (url, options) => {
        accountCalls.push(options);
        return { ok: true, json: async () => ({ data: {} }) };
      },
    });
    assert.ok(!('Project-Access-Token' in accountCalls[0].headers));
    assert.ok(!(RAILWAY_PROJECT_ACCESS_TOKEN_HEADER in accountCalls[0].headers));

    const projectCalls = [];
    await queryRailwayGraphQL({
      projectToken: 'synthetic-project-yyy',
      query: 'query Foo { deployments { id } }',
      fetchImpl: async (url, options) => {
        projectCalls.push(options);
        return { ok: true, json: async () => ({ data: {} }) };
      },
    });
    assert.ok(!('authorization' in projectCalls[0].headers));
  });

  it('모호한 auth 설정은 fail-closed한다', async () => {
    assert.throws(
      () => resolveRailwayAuthCredential({ token: 'synthetic-amb-001' }),
      /RAILWAY_AUTH_AMBIGUOUS/,
    );
    assert.throws(
      () => resolveRailwayAuthCredential({ token: 'synthetic-amb-002', tokenKind: 'unknown-kind' }),
      /RAILWAY_AUTH_AMBIGUOUS/,
    );
    assert.throws(
      () =>
        resolveRailwayAuthCredential({
          apiToken: 'synthetic-amb-003',
          projectToken: 'synthetic-amb-004',
        }),
      /RAILWAY_AUTH_AMBIGUOUS/,
    );
    assert.throws(
      () =>
        resolveRailwayAuthCredential({
          token: 'synthetic-amb-005',
          apiToken: 'synthetic-amb-006',
          tokenKind: 'account',
        }),
      /RAILWAY_AUTH_AMBIGUOUS/,
    );
    assert.throws(
      () =>
        resolveRailwayAuthCredential({
          token: 'synthetic-amb-007',
          tokenKind: 'account',
          authKind: 'project',
        }),
      /RAILWAY_AUTH_AMBIGUOUS/,
    );

    const ambiguous = await collectRailwayBindingEvidence({
      expectedSha: SHA,
      environment: 'staging',
      runtimeUrl: 'https://api-staging-94af.up.railway.app',
      live: true,
      token: 'synthetic-amb-008',
      fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }),
    });
    assert.equal(ambiguous.ready, false);
    assert.ok(ambiguous.failureCodes.includes('RAILWAY_AUTH_AMBIGUOUS'));
    assert.ok(!JSON.stringify(ambiguous).includes('synthetic-amb-008'));
  });

  it('credential이 없으면 fail-closed하고 토큰을 노출하지 않는다', async () => {
    assert.throws(() => resolveRailwayAuthCredential({}), /RAILWAY_AUTH_MISSING/);
    assert.throws(
      () => resolveRailwayAuthCredential({ apiToken: '   ', projectToken: '', token: '' }),
      /RAILWAY_AUTH_MISSING/,
    );

    const missing = await collectRailwayBindingEvidence({
      expectedSha: SHA,
      environment: 'staging',
      runtimeUrl: 'https://api-staging-94af.up.railway.app',
      live: true,
      fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }),
    });
    assert.equal(missing.ready, false);
    assert.ok(missing.failureCodes.includes('READ_CAPABILITY_MISSING'));

    await assert.rejects(
      () =>
        queryRailwayGraphQL({
          query: 'query Foo { deployments { id } }',
          fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }),
        }),
      /RAILWAY_AUTH_MISSING/,
    );
  });

  it('진단 출력에 token 값이 절대 포함되지 않는다', async () => {
    const accountSecret = 'synthetic-redact-account-001';
    const projectSecret = 'synthetic-redact-project-002';
    try {
      resolveRailwayAuthCredential({ token: accountSecret });
    } catch (error) {
      assert.ok(!String(error.message).includes(accountSecret));
    }
    try {
      resolveRailwayAuthCredential({ apiToken: accountSecret, projectToken: projectSecret });
    } catch (error) {
      const text = String(error.message);
      assert.ok(!text.includes(accountSecret));
      assert.ok(!text.includes(projectSecret));
    }
    await assert.rejects(
      () =>
        queryRailwayGraphQL({
          apiToken: accountSecret,
          query: 'query Foo { deployments { id } }',
          fetchImpl: async () => ({ ok: false, status: 401 }),
        }),
      (error) => {
        assert.ok(!String(error.message).includes(accountSecret));
        return true;
      },
    );
    const failed = await collectRailwayBindingEvidence({
      expectedSha: SHA,
      environment: 'staging',
      runtimeUrl: 'https://api-staging-94af.up.railway.app',
      live: true,
      token: accountSecret,
      fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }),
    });
    assert.ok(!JSON.stringify(failed).includes(accountSecret));
  });

  it('유효한 credential이 있어도 mutation은 pre-flight에서 거부된다', async () => {
    let fetched = false;
    await assert.rejects(
      () =>
        queryRailwayGraphQL({
          apiToken: 'synthetic-account-mut-001',
          query: 'mutation { deploy }',
          fetchImpl: async () => {
            fetched = true;
            return { ok: true, json: async () => ({ data: {} }) };
          },
        }),
      /mutation은 binder에서 금지/,
    );
    assert.equal(fetched, false);

    await assert.rejects(
      () =>
        queryRailwayGraphQL({
          projectToken: 'synthetic-project-mut-002',
          query: 'mutation { deploy }',
          fetchImpl: async () => {
            fetched = true;
            return { ok: true, json: async () => ({ data: {} }) };
          },
        }),
      /mutation은 binder에서 금지/,
    );
    assert.equal(fetched, false);
  });

  it('project live 경로는 Project-Access-Token 헤더로 조회한다', async () => {
    const seen = [];
    const result = await collectRailwayBindingEvidence({
      expectedSha: SHA,
      environment: 'staging',
      runtimeUrl: 'https://api-staging-94af.up.railway.app',
      live: true,
      projectToken: 'synthetic-project-live-001',
      fetchImpl: async (url, options) => {
        seen.push(options.headers);
        const body = JSON.parse(options.body);
        if (body.query.includes('deployments')) {
          return {
            ok: true,
            json: async () => ({
              data: {
                deployments: [
                  {
                    id: 'deployment-revision-001',
                    status: 'SUCCESS',
                    meta: { commitHash: SHA },
                    service: { id: 'service-api' },
                    environment: { id: 'env-staging', name: 'staging' },
                  },
                ],
              },
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            data: {
              domains: [
                {
                  domain: 'api-staging-94af.up.railway.app',
                  serviceId: 'service-api',
                  environmentId: 'env-staging',
                },
              ],
            },
          }),
        };
      },
    });
    assert.equal(result.ready, true);
    assert.equal(seen.length, 2);
    for (const headers of seen) {
      assert.equal(headers[RAILWAY_PROJECT_ACCESS_TOKEN_HEADER], 'synthetic-project-live-001');
      assert.ok(!('authorization' in headers));
    }
  });
});

describe('evidence 수집 계약', () => {
  const offlineEvidence = {
    deployment: {
      id: 'deployment-revision-001',
      sha: SHA,
      state: 'SUCCESS',
      environment: 'staging',
    },
    runtime: {
      url: 'https://api-staging-94af.up.railway.app',
      deploymentId: 'deployment-revision-001',
    },
    evidenceSource: READ_ONLY_EVIDENCE_SOURCE,
  };

  it('offline evidence JSON으로 PASS를 증명한다', async () => {
    const result = await collectRailwayBindingEvidence({
      expectedSha: SHA,
      environment: 'staging',
      evidence: offlineEvidence,
    });

    assert.equal(result.ready, true);
    assert.equal(result.deploymentId, 'deployment-revision-001');
  });

  it('offline evidence의 runtime 바인딩 누락을 거부한다', async () => {
    const result = await collectRailwayBindingEvidence({
      expectedSha: SHA,
      environment: 'staging',
      evidence: {
        deployment: offlineEvidence.deployment,
        runtime: { url: 'https://api-staging-94af.up.railway.app' },
        evidenceSource: READ_ONLY_EVIDENCE_SOURCE,
      },
    });

    assert.equal(result.ready, false);
    assert.ok(result.failureCodes.includes('BOUND_REVISION_MISSING'));
  });

  it('evidence도 live token도 없으면 READ_CAPABILITY_MISSING으로 닫는다', async () => {
    const result = await collectRailwayBindingEvidence({
      expectedSha: SHA,
      environment: 'staging',
      runtimeUrl: 'https://api-staging-94af.up.railway.app',
    });

    assert.equal(result.ready, false);
    assert.ok(result.failureCodes.includes('READ_CAPABILITY_MISSING'));
  });

  it('live 조회에서 service domain 소유까지 증명하면 PASS한다', async () => {
    const result = await collectRailwayBindingEvidence({
      expectedSha: SHA,
      environment: 'staging',
      runtimeUrl: 'https://api-staging-94af.up.railway.app',
      live: true,
      apiToken: 'synthetic-live-account-token-001',
      fetchImpl: async (url, options) => {
        assert.equal(options.method, 'POST');
        const body = JSON.parse(options.body);
        if (body.query.includes('deployments')) {
          return {
            ok: true,
            json: async () => ({
              data: {
                deployments: [
                  {
                    id: 'deployment-revision-001',
                    status: 'SUCCESS',
                    meta: { commitHash: SHA },
                    service: { id: 'service-api' },
                    environment: { id: 'env-staging', name: 'staging' },
                  },
                ],
              },
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            data: {
              domains: [
                {
                  domain: 'api-staging-94af.up.railway.app',
                  serviceId: 'service-api',
                  environmentId: 'env-staging',
                },
              ],
            },
          }),
        };
      },
    });

    assert.equal(result.ready, true);
    assert.equal(result.evidenceSource, READ_ONLY_EVIDENCE_SOURCE);
  });

  it('live 조회에서 runtime URL이 service domain에 없으면 거부한다', async () => {
    const result = await collectRailwayBindingEvidence({
      expectedSha: SHA,
      environment: 'staging',
      runtimeUrl: 'https://api-staging-94af.up.railway.app',
      live: true,
      apiToken: 'synthetic-live-account-token-002',
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body);
        if (body.query.includes('deployments')) {
          return {
            ok: true,
            json: async () => ({
              data: {
                deployments: [
                  {
                    id: 'deployment-revision-001',
                    status: 'SUCCESS',
                    meta: { commitHash: SHA },
                    service: { id: 'service-api' },
                    environment: { id: 'env-staging', name: 'staging' },
                  },
                ],
              },
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            data: { domains: [{ domain: 'other-service.up.railway.app' }] },
          }),
        };
      },
    });

    assert.equal(result.ready, false);
    assert.ok(result.failureCodes.includes('RUNTIME_URL_NOT_IN_SERVICE_DOMAINS'));
  });
});

describe('입력 계약', () => {
  it('기존 env contract를 CLI 인자 다음으로 사용한다', () => {
    const fromEnv = normalizeBindingInput([], {
      ROUND_DIRECT_E2E_EXPECTED_SHA: SHA,
      ROUND_DIRECT_E2E_API_ORIGIN: 'https://api-staging-94af.up.railway.app',
    });

    assert.equal(fromEnv.expectedSha, SHA);
    assert.equal(fromEnv.environment, 'staging');
    assert.equal(fromEnv.runtimeUrl, 'https://api-staging-94af.up.railway.app');

    const overridden = normalizeBindingInput(
      [`--sha=${OTHER_SHA}`, '--environment=staging'],
      { RAILWAY_BINDING_EXPECTED_SHA: SHA },
    );

    assert.equal(overridden.expectedSha, OTHER_SHA);
  });

  it('명시적 auth env/flag 계약을 읽는다', () => {
    const fromEnv = normalizeBindingInput([], {
      RAILWAY_API_TOKEN: 'synthetic-env-account',
      RAILWAY_TOKEN_KIND: 'account',
    });
    assert.equal(fromEnv.apiToken, 'synthetic-env-account');
    assert.equal(fromEnv.authKind, 'account');

    const legacy = normalizeBindingInput([], {
      RAILWAY_TOKEN: 'synthetic-env-legacy',
      RAILWAY_TOKEN_KIND: 'project',
    });
    assert.equal(legacy.token, 'synthetic-env-legacy');
    assert.equal(legacy.authKind, 'project');

    const flagged = normalizeBindingInput(['--auth-kind=project'], {
      RAILWAY_TOKEN: 'synthetic-env-legacy',
    });
    assert.equal(flagged.authKind, 'project');
  });
});

describe('READ-SOURCE-CONVERGENCE-04 A. source selection', () => {
  function usableCliStatus() {
    return {
      environments: {
        edges: [
          {
            node: {
              id: 'env-staging-synth',
              name: 'staging',
              serviceInstances: {
                edges: [
                  {
                    node: {
                      serviceId: 'svc-api-synth',
                      serviceName: 'api',
                      environmentId: 'env-staging-synth',
                      latestDeployment: {
                        id: 'dep-cli-001',
                        status: 'SUCCESS',
                        meta: { commitHash: SHA },
                      },
                      domains: {
                        serviceDomains: [
                          { domain: 'api-staging-94af.up.railway.app', targetPort: 3000 },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    };
  }

  it('explicit API token → GRAPHQL', () => {
    assert.equal(hasExplicitRailwayCredential({ apiToken: 'synthetic-a' }), true);
    const selection = resolveRailwayReadSource({
      live: true,
      apiToken: 'synthetic-a',
      cliStatus: usableCliStatus(),
      runCliStatus: async () => usableCliStatus(),
    });
    assert.equal(selection.source, READ_SOURCE_GRAPHQL);
  });

  it('explicit project token → GRAPHQL', () => {
    const selection = resolveRailwayReadSource({
      live: true,
      projectToken: 'synthetic-p',
      cliStatus: usableCliStatus(),
      runCliStatus: async () => usableCliStatus(),
    });
    assert.equal(selection.source, READ_SOURCE_GRAPHQL);
  });

  it('no token + usable CLI → CLI_STATUS (token 부재만으로 MISSING이 아니다)', async () => {
    assert.equal(hasExplicitRailwayCredential({}), false);
    const byValue = resolveRailwayReadSource({
      live: true,
      cliStatus: usableCliStatus(),
    });
    assert.equal(byValue.source, READ_SOURCE_CLI_STATUS);

    const byRunner = resolveRailwayReadSource({
      live: true,
      runCliStatus: async () => usableCliStatus(),
    });
    assert.equal(byRunner.source, READ_SOURCE_CLI_STATUS);

    const result = await collectRailwayBindingEvidence({
      expectedSha: SHA,
      environment: 'staging',
      runtimeUrl: 'https://api-staging-94af.up.railway.app',
      live: true,
      cliStatus: usableCliStatus(),
    });
    assert.equal(result.ready, true);
    assert.equal(result.readSource, READ_SOURCE_CLI_STATUS);
    assert.equal(result.evidenceSource, CLI_STATUS_EVIDENCE_SOURCE);
    assert.ok(!result.failureCodes.includes('READ_CAPABILITY_MISSING'));
  });

  it('no token + unusable CLI → READ_CAPABILITY_MISSING', async () => {
    const disallowed = resolveRailwayReadSource({ live: true, allowCliStatus: false });
    assert.equal(disallowed.source, null);

    const absent = resolveRailwayReadSource({ live: true });
    assert.equal(absent.source, null);

    const result = await collectRailwayBindingEvidence({
      expectedSha: SHA,
      environment: 'staging',
      runtimeUrl: 'https://api-staging-94af.up.railway.app',
      live: true,
    });
    assert.equal(result.ready, false);
    assert.ok(result.failureCodes.includes('READ_CAPABILITY_MISSING'));
  });

  it('offline evidence → OFFLINE', () => {
    const selection = resolveRailwayReadSource({
      evidence: { deployment: { id: 'x' } },
      live: false,
    });
    assert.equal(selection.source, READ_SOURCE_OFFLINE);
  });
});

describe('READ-SOURCE-CONVERGENCE-04 B. CLI parsing', () => {
  const SHA_LIVE_SHAPE = 'c'.repeat(40);
  function realShapeCli() {
    return {
      environments: {
        edges: [
          {
            node: {
              id: 'env-production-synth',
              name: 'production',
              serviceInstances: {
                edges: [
                  {
                    node: {
                      serviceId: 'svc-api-synth',
                      serviceName: 'api',
                      environmentId: 'env-production-synth',
                      latestDeployment: {
                        id: 'dep-prod-001',
                        status: 'SUCCESS',
                        meta: { commitHash: 'd'.repeat(40) },
                      },
                      domains: {
                        serviceDomains: [{ domain: 'api-production-13e7.up.railway.app', targetPort: 3000 }],
                      },
                    },
                  },
                ],
              },
            },
          },
          {
            node: {
              id: 'env-staging-synth',
              name: 'staging',
              serviceInstances: {
                edges: [
                  {
                    node: {
                      serviceId: 'svc-api-synth',
                      serviceName: 'api',
                      environmentId: 'env-staging-synth',
                      latestDeployment: {
                        id: 'dep-staging-001',
                        status: 'SUCCESS',
                        meta: { commitHash: SHA_LIVE_SHAPE },
                      },
                      domains: {
                        serviceDomains: [
                          { domain: 'api-staging-94af.up.railway.app', targetPort: 3000 },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    };
  }

  it('real-shape synthetic JSON에서 staging/api/deployment/domain/revision을 추출한다', () => {
    const normalized = normalizeCliStatusBinding(realShapeCli(), {
      environment: 'staging',
      service: 'api',
      runtimeUrl: 'https://api-staging-94af.up.railway.app',
    });
    assert.equal(normalized.failureCode, null);
    assert.equal(normalized.deployment.id, 'dep-staging-001');
    assert.equal(normalized.deployment.sha, SHA_LIVE_SHAPE);
    assert.equal(normalized.deployment.state, 'SUCCESS');
    assert.equal(normalized.deployment.environment, 'staging');
    assert.equal(normalized.deployment.environmentId, 'env-staging-synth');
    assert.equal(normalized.deployment.serviceId, 'svc-api-synth');
    assert.equal(normalized.serviceName, 'api');
    assert.equal(normalized.domain, 'api-staging-94af.up.railway.app');
    assert.equal(normalized.targetPort, 3000);
    assert.equal(normalized.evidenceSource, CLI_STATUS_EVIDENCE_SOURCE);
    assert.equal(normalized.runtime.deploymentId, 'dep-staging-001');
    assert.equal(normalized.runtime.serviceId, 'svc-api-synth');
    assert.equal(normalized.runtime.environmentId, 'env-staging-synth');
  });

  it('CLI evidence도 canonical evaluation을 재사용해 PASS한다', async () => {
    const result = await collectRailwayBindingEvidence({
      expectedSha: SHA_LIVE_SHAPE,
      environment: 'staging',
      runtimeUrl: 'https://api-staging-94af.up.railway.app',
      live: true,
      cliStatus: realShapeCli(),
    });
    assert.equal(result.ready, true);
    assert.equal(result.deploymentId, 'dep-staging-001');
    assert.equal(result.deploymentSha, SHA_LIVE_SHAPE);
    assert.equal(result.readSource, READ_SOURCE_CLI_STATUS);
  });

  it('요청한 runtime URL이 같은 instance domain이 아니면 소유로 인정하지 않는다', async () => {
    const result = await collectRailwayBindingEvidence({
      expectedSha: SHA_LIVE_SHAPE,
      environment: 'staging',
      runtimeUrl: 'https://api-staging-94af.up.railway.app',
      live: true,
      cliStatus: {
        environments: {
          edges: [
            {
              node: {
                id: 'env-staging-synth',
                name: 'staging',
                serviceInstances: {
                  edges: [
                    {
                      node: {
                        serviceId: 'svc-api-synth',
                        serviceName: 'api',
                        environmentId: 'env-staging-synth',
                        latestDeployment: {
                          id: 'dep-staging-001',
                          status: 'SUCCESS',
                          meta: { commitHash: SHA_LIVE_SHAPE },
                        },
                        domains: {
                          serviceDomains: [{ domain: 'other-service.up.railway.app', targetPort: 3000 }],
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    });
    assert.equal(result.ready, false);
    assert.ok(result.failureCodes.includes('RUNTIME_URL_NOT_IN_SERVICE_DOMAINS'));
  });
});

describe('READ-SOURCE-CONVERGENCE-04 C. exact SHA', () => {
  function cliForSha(sha) {
    return {
      environments: {
        edges: [
          {
            node: {
              id: 'env-staging-synth',
              name: 'staging',
              serviceInstances: {
                edges: [
                  {
                    node: {
                      serviceId: 'svc-api-synth',
                      serviceName: 'api',
                      environmentId: 'env-staging-synth',
                      latestDeployment: { id: 'dep-001', status: 'SUCCESS', meta: { commitHash: sha } },
                      domains: {
                        serviceDomains: [{ domain: 'api-staging-94af.up.railway.app', targetPort: 3000 }],
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    };
  }

  it('match → ready true', async () => {
    const result = await collectRailwayBindingEvidence({
      expectedSha: SHA,
      environment: 'staging',
      runtimeUrl: 'https://api-staging-94af.up.railway.app',
      live: true,
      cliStatus: cliForSha(SHA),
    });
    assert.equal(result.ready, true);
    assert.equal(result.deploymentSha, SHA);
  });

  it('mismatch → canonical DEPLOYMENT_SHA_MISMATCH (RAILWAY_REVISION_MISMATCH 정합)', async () => {
    const result = await collectRailwayBindingEvidence({
      expectedSha: SHA,
      environment: 'staging',
      runtimeUrl: 'https://api-staging-94af.up.railway.app',
      live: true,
      cliStatus: cliForSha(OTHER_SHA),
    });
    assert.equal(result.ready, false);
    assert.ok(result.failureCodes.includes('DEPLOYMENT_SHA_MISMATCH'));
  });
});

describe('READ-SOURCE-CONVERGENCE-04 D. deployment state', () => {
  function cliForState(state) {
    return {
      environments: {
        edges: [
          {
            node: {
              id: 'env-staging-synth',
              name: 'staging',
              serviceInstances: {
                edges: [
                  {
                    node: {
                      serviceId: 'svc-api-synth',
                      serviceName: 'api',
                      environmentId: 'env-staging-synth',
                      latestDeployment: { id: 'dep-001', status: state, meta: { commitHash: SHA } },
                      domains: {
                        serviceDomains: [{ domain: 'api-staging-94af.up.railway.app', targetPort: 3000 }],
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    };
  }

  it('SUCCESS/READY accepted state', async () => {
    for (const state of ['SUCCESS', 'READY', 'success', 'ready']) {
      const result = await collectRailwayBindingEvidence({
        expectedSha: SHA,
        environment: 'staging',
        runtimeUrl: 'https://api-staging-94af.up.railway.app',
        live: true,
        cliStatus: cliForState(state),
      });
      assert.equal(result.ready, true, `state=${state}`);
    }
  });

  it('failed/non-ready state → canonical DEPLOYMENT_STATE_NOT_SUCCESS', async () => {
    for (const state of ['FAILED', 'BUILDING', 'DEPLOYING', 'CRASHED', 'REMOVED']) {
      const result = await collectRailwayBindingEvidence({
        expectedSha: SHA,
        environment: 'staging',
        runtimeUrl: 'https://api-staging-94af.up.railway.app',
        live: true,
        cliStatus: cliForState(state),
      });
      assert.equal(result.ready, false, `state=${state}`);
      assert.ok(result.failureCodes.includes('DEPLOYMENT_STATE_NOT_SUCCESS'));
    }
  });
});

describe('READ-SOURCE-CONVERGENCE-04 E. malformed/incomplete CLI output', () => {
  it('fail closed, no invented binding', async () => {
    const malformed = normalizeCliStatusBinding('not-json{{{', {
      environment: 'staging',
      service: 'api',
      runtimeUrl: 'https://api-staging-94af.up.railway.app',
    });
    assert.equal(malformed.deployment, null);
    assert.ok(['RAILWAY_CLI_READ_FAILED', 'RAILWAY_EVIDENCE_INCOMPLETE'].includes(malformed.failureCode));

    const missingEnv = normalizeCliStatusBinding(
      { environments: { edges: [] } },
      { environment: 'staging', service: 'api', runtimeUrl: 'https://api-staging-94af.up.railway.app' },
    );
    assert.equal(missingEnv.deployment, null);
    assert.equal(missingEnv.failureCode, 'RAILWAY_EVIDENCE_INCOMPLETE');

    const missingSha = normalizeCliStatusBinding(
      {
        environments: {
          edges: [
            {
              node: {
                id: 'env-staging-synth',
                name: 'staging',
                serviceInstances: {
                  edges: [
                    {
                      node: {
                        serviceId: 'svc-api-synth',
                        serviceName: 'api',
                        environmentId: 'env-staging-synth',
                        latestDeployment: { id: 'dep-001', status: 'SUCCESS', meta: {} },
                        domains: { serviceDomains: [] },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
      { environment: 'staging', service: 'api', runtimeUrl: 'https://api-staging-94af.up.railway.app' },
    );
    assert.equal(missingSha.deployment, null);
    assert.equal(missingSha.failureCode, 'RAILWAY_EVIDENCE_INCOMPLETE');

    const viaCollect = await collectRailwayBindingEvidence({
      expectedSha: SHA,
      environment: 'staging',
      runtimeUrl: 'https://api-staging-94af.up.railway.app',
      live: true,
      cliStatus: { environments: { edges: [] } },
    });
    assert.equal(viaCollect.ready, false);
    assert.ok(viaCollect.failureCodes.includes('RAILWAY_EVIDENCE_INCOMPLETE'));
    assert.equal(viaCollect.deploymentId, null);

    const readFailed = await collectRailwayBindingEvidence({
      expectedSha: SHA,
      environment: 'staging',
      runtimeUrl: 'https://api-staging-94af.up.railway.app',
      live: true,
      runCliStatus: async () => {
        throw new Error('boom (RAILWAY_CLI_READ_FAILED)');
      },
    });
    assert.equal(readFailed.ready, false);
    assert.ok(readFailed.failureCodes.includes('RAILWAY_CLI_READ_FAILED'));

    const unavailable = await collectRailwayBindingEvidence({
      expectedSha: SHA,
      environment: 'staging',
      runtimeUrl: 'https://api-staging-94af.up.railway.app',
      live: true,
      runCliStatus: async () => {
        throw new Error('missing (RAILWAY_CLI_UNAVAILABLE)');
      },
    });
    assert.equal(unavailable.ready, false);
    assert.ok(unavailable.failureCodes.includes('RAILWAY_CLI_UNAVAILABLE'));
  });
});

describe('READ-SOURCE-CONVERGENCE-04 F. mutation safety', () => {
  it('mutation command impossible through verifier path', async () => {
    assert.equal(assertAllowedCliInvocation('railway', ['status', '--json']), true);
    assert.deepEqual([...RAILWAY_CLI_ALLOWLIST.args], ['status', '--json']);
    for (const args of [
      ['deploy'],
      ['redeploy'],
      ['restart'],
      ['up'],
      ['down'],
      ['variable', 'set', 'FOO=bar'],
      ['domain', 'create'],
      ['link'],
      ['login'],
      ['logout'],
      ['status'],
      ['status', '--json', '--service', 'api'],
    ]) {
      assert.throws(() => assertAllowedCliInvocation('railway', args), /RAILWAY_CLI_DISALLOWED/);
    }
    assert.throws(() => assertAllowedCliInvocation('railway; rm -rf /', ['status', '--json']), /RAILWAY_CLI_DISALLOWED/);
    assert.equal(isRailwayMutationArgs(['status', '--json']), false);
    assert.equal(isRailwayMutationArgs(['deploy']), true);

    const calls = [];
    const parsed = await readRailwayCliStatus({
      execFileImpl: async (command, args) => {
        calls.push({ command, args });
        assert.equal(command, 'railway');
        assert.deepEqual(args, ['status', '--json']);
        return { stdout: JSON.stringify({ environments: { edges: [] } }) };
      },
    });
    assert.deepEqual(parsed, { environments: { edges: [] } });
    assert.equal(calls.length, 1);

    await assert.rejects(
      () =>
        readRailwayCliStatus({
          execFileImpl: async () => {
            const error = new Error('not found');
            error.code = 'ENOENT';
            throw error;
          },
        }),
      /RAILWAY_CLI_UNAVAILABLE/,
    );
  });
});

describe('READ-SOURCE-CONVERGENCE-04 G. regression', () => {
  it('existing GraphQL auth path preserved with explicit credential', async () => {
    const result = await collectRailwayBindingEvidence({
      expectedSha: SHA,
      environment: 'staging',
      runtimeUrl: 'https://api-staging-94af.up.railway.app',
      live: true,
      apiToken: 'synthetic-regression-account-001',
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body);
        if (body.query.includes('deployments')) {
          return {
            ok: true,
            json: async () => ({
              data: {
                deployments: [
                  {
                    id: 'deployment-revision-001',
                    status: 'SUCCESS',
                    meta: { commitHash: SHA },
                    service: { id: 'service-api' },
                    environment: { id: 'env-staging', name: 'staging' },
                  },
                ],
              },
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            data: {
              domains: [
                {
                  domain: 'api-staging-94af.up.railway.app',
                  serviceId: 'service-api',
                  environmentId: 'env-staging',
                },
              ],
            },
          }),
        };
      },
    });
    assert.equal(result.ready, true);
    assert.equal(result.readSource, READ_SOURCE_GRAPHQL);
    assert.equal(result.evidenceSource, READ_ONLY_EVIDENCE_SOURCE);
  });

  it('read-source normalization + input contract', () => {
    assert.equal(normalizeReadSource('auto'), 'auto');
    assert.equal(normalizeReadSource('graphql'), 'graphql');
    assert.equal(normalizeReadSource('cli-status'), 'cli-status');
    assert.equal(normalizeReadSource('offline'), 'offline');
    assert.equal(normalizeReadSource('bogus'), null);
    const input = normalizeBindingInput(['--read-source=cli-status', '--service=api'], {});
    assert.equal(input.readSource, 'cli-status');
    assert.equal(input.service, 'api');
    const defaults = normalizeBindingInput([], {});
    assert.equal(defaults.readSource, 'auto');
    assert.equal(defaults.service, 'api');
  });
});
