/**
 * FE-PILOT-AUTH-RUNTIME-PROBE-RUNNER-01 deterministic tests (mock/local only).
 * No network, no secrets, no external mutation. Run:
 *   node --test scripts/probe-auth-runtime.spec.mjs
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  APPROVAL_VALUE,
  ProbeContractError,
  assertExpectedSha,
  classifyLoginRejection,
  createGuardedFetch,
  evaluateConsumerGate,
  evaluateDriverGate,
  evaluateSellerGate,
  isProductionUrl,
  normalizeProbeHttpResponse,
  normalizeTargetUrl,
  runApiProbe,
  runAuthRuntimeProbe,
  runRoleProbe,
  validateRuntimeBinding,
  validateSafetyGates,
} from './probe-auth-runtime.mjs';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

const URLS = Object.freeze({
  consumer: 'https://consumer-preview.example.test',
  seller: 'https://seller-preview.example.test',
  driver: 'https://driver-preview.example.test',
  api: 'https://api-staging.example.test',
});

function validEvidence(overrides = {}) {
  return {
    ready: true,
    expectedSha: SHA,
    deploymentShas: { consumer: SHA, seller: SHA, driver: SHA },
    deploymentTargetUrls: {
      consumer: URLS.consumer,
      seller: URLS.seller,
      driver: URLS.driver,
    },
    apiOrigin: URLS.api,
    ...overrides,
  };
}

function validEnv(overrides = {}) {
  return {
    NON_PRODUCTION_AUTH_PROBE_APPROVAL: APPROVAL_VALUE,
    NODE_ENV: 'test',
    VERCEL_ENV: 'preview',
    RAILWAY_ENVIRONMENT_NAME: 'staging',
    FIREBASE_PROJECT_ID: 'green-staging-74557',
    GREENHUB_LOCAL_RUNTIME: '',
    E2E_TEST_SECRET: 'e2e-secret',
    ROUND_DIRECT_E2E_SHARED_SECRET: 'driver-shared',
    ROUND_DIRECT_E2E_DRIVER_EMAILS: 'driver@example.test',
    ROUND_DIRECT_E2E_ENABLED: 'true',
    AUTH_PROBE_CONSUMER_TOKEN: 'e2e-secret',
    AUTH_PROBE_SELLER_TOKEN: 'e2e-secret',
    AUTH_PROBE_DRIVER_SECRET: 'driver-shared',
    TEST_CONSUMER_EMAIL: 'consumer@example.test',
    TEST_CONSUMER_PASSWORD: 'pw-consumer',
    TEST_SELLER_EMAIL: 'seller@example.test',
    TEST_SELLER_PASSWORD: 'pw-seller',
    TEST_DRIVER_EMAIL: 'driver@example.test',
    TEST_DRIVER_PASSWORD: 'pw-driver',
    ...overrides,
  };
}

function validOptions(overrides = {}) {
  return {
    expectedSha: SHA,
    consumerUrl: URLS.consumer,
    sellerUrl: URLS.seller,
    driverUrl: URLS.driver,
    apiUrl: URLS.api,
    approval: APPROVAL_VALUE,
    evidence: validEvidence(),
    e2eSecret: 'e2e-secret',
    sellerSecret: 'e2e-secret',
    consumerToken: 'e2e-secret',
    sellerToken: 'e2e-secret',
    driverSharedSecret: 'driver-shared',
    driverPresentedSecret: 'driver-shared',
    driverAllowlist: 'driver@example.test',
    driverEnabled: 'true',
    vercelEnv: 'preview',
    nodeEnv: 'test',
    railwayEnvironment: 'staging',
    firebaseProjectId: 'green-staging-74557',
    consumerEmail: 'consumer@example.test',
    consumerPassword: 'pw-consumer',
    sellerEmail: 'seller@example.test',
    sellerPassword: 'pw-seller',
    driverEmail: 'driver@example.test',
    driverPassword: 'pw-driver',
    ...overrides,
  };
}

/** Mock API: login -> me -> logout happy path per role. */
function mockApiFetch({ users, failLogout = false, failMe = false } = {}) {
  const table =
    users ??
    {
      'consumer@example.test': {
        id: 'user-consumer-1',
        email: 'consumer@example.test',
        role: 'consumer',
      },
      'seller@example.test': {
        id: 'user-seller-1',
        email: 'seller@example.test',
        role: 'seller',
        storeId: 'store-1',
      },
      'driver@example.test': {
        id: 'user-driver-1',
        email: 'driver@example.test',
        role: 'driver',
        driverApproved: true,
      },
    };
  return async (url, init = {}) => {
    const method = String(init.method ?? 'GET').toUpperCase();
    const path = new URL(url).pathname;
    if (path === '/auth/login' && method === 'POST') {
      const body = JSON.parse(String(init.body));
      const user = table[body.email];
      if (!user || body.password !== `pw-${user.role}`) {
        return { ok: false, status: 401, data: null };
      }
      return {
        ok: true,
        status: 200,
        data: { accessToken: `at-${user.id}`, refreshToken: `rt-${user.id}`, user },
      };
    }
    if (path === '/auth/me' && method === 'GET') {
      if (failMe) return { ok: false, status: 401, data: null };
      const token = String(init.headers?.Authorization ?? '').replace('Bearer at-', '');
      const user = Object.values(table).find((u) => u.id === token);
      if (!user) return { ok: false, status: 401, data: null };
      return { ok: true, status: 200, data: user };
    }
    if (path === '/auth/logout' && method === 'POST') {
      if (failLogout) return { ok: false, status: 500, data: null };
      return { ok: true, status: 204, data: {} };
    }
    return { ok: false, status: 404, data: null };
  };
}

describe('FE-PILOT-AUTH-RUNTIME-PROBE-RUNNER-01 safety gates', () => {
  it('production target을 거부한다', () => {
    assert.equal(isProductionUrl('https://greenlove.co.kr'), true);
    assert.equal(isProductionUrl('https://shop.greenlove.co.kr/login'), true);
    assert.equal(isProductionUrl('https://api-production-13e7.up.railway.app/health'), true);
    assert.equal(isProductionUrl(URLS.consumer), false);
    assert.throws(() => normalizeTargetUrl('https://greenlove.co.kr', { field: 'consumer-url' }), (e) => {
      assert.ok(e instanceof ProbeContractError);
      assert.equal(e.code, 'PRODUCTION_TARGET_REJECTED');
      return true;
    });
  });

  it('approval 누락을 차단한다', () => {
    assert.throws(
      () => validateSafetyGates({ approval: '' }, validEnv({ NON_PRODUCTION_AUTH_PROBE_APPROVAL: '' })),
      (e) => e.code === 'MISSING_APPROVAL',
    );
    assert.throws(
      () => validateSafetyGates({ approval: 'WRONG' }, validEnv()),
      (e) => e.code === 'MISSING_APPROVAL',
    );
  });

  it('SHA mismatch evidence를 거부한다', () => {
    assert.throws(
      () =>
        validateRuntimeBinding({
          expectedSha: SHA,
          consumerUrl: URLS.consumer,
          sellerUrl: URLS.seller,
          driverUrl: URLS.driver,
          apiUrl: URLS.api,
          evidence: validEvidence({ expectedSha: OTHER_SHA }),
        }),
      (e) => e.code === 'EXPECTED_SHA_MISMATCH',
    );
    assert.equal(assertExpectedSha(SHA), SHA);
    assert.throws(() => assertExpectedSha(''), (e) => e.code === 'EXPECTED_SHA_REQUIRED');
    assert.throws(() => assertExpectedSha('xyz'), (e) => e.code === 'EXPECTED_SHA_MALFORMED');
  });

  it('binding evidence 없이는 RUNTIME_NOT_BOUND로 fail closed한다', () => {
    assert.throws(
      () =>
        validateRuntimeBinding({
          expectedSha: SHA,
          consumerUrl: URLS.consumer,
          sellerUrl: URLS.seller,
          driverUrl: URLS.driver,
          apiUrl: URLS.api,
          evidence: null,
        }),
      (e) => e.code === 'RUNTIME_NOT_BOUND',
    );
  });

  it('required secret 누락을 차단한다', () => {
    assert.throws(
      () => validateSafetyGates({ approval: APPROVAL_VALUE, e2eSecret: '' }, validEnv({ E2E_TEST_SECRET: '' })),
      (e) => e.code === 'CONSUMER_SECRET_MISSING',
    );
    assert.throws(
      () =>
        validateSafetyGates(
          { approval: APPROVAL_VALUE, driverSharedSecret: '' },
          validEnv({ ROUND_DIRECT_E2E_SHARED_SECRET: '' }),
        ),
      (e) => e.code === 'DRIVER_SECRET_MISSING',
    );
  });

  it('driver allowlist 누락을 차단한다', () => {
    assert.throws(
      () =>
        validateSafetyGates(
          { approval: APPROVAL_VALUE, driverAllowlist: '' },
          validEnv({ ROUND_DIRECT_E2E_DRIVER_EMAILS: '' }),
        ),
      (e) => e.code === 'DRIVER_ALLOWLIST_MISSING',
    );
  });

  it('production Firebase project와 production env를 차단한다', () => {
    assert.throws(
      () => validateSafetyGates({ approval: APPROVAL_VALUE, firebaseProjectId: 'green-e4fe3' }, validEnv()),
      (e) => e.code === 'PRODUCTION_FIREBASE_PROJECT',
    );
    assert.throws(
      () => validateSafetyGates({ approval: APPROVAL_VALUE, railwayEnvironment: 'production' }, validEnv()),
      (e) => e.code === 'PRODUCTION_ENVIRONMENT',
    );
  });

  it('mutation/provider/Kakao 경로를 guarded fetch가 차단한다', async () => {
    const apiUrl = URLS.api;
    const guarded = createGuardedFetch(async () => ({ ok: true, status: 200, data: {} }), { apiUrl });
    await assert.rejects(guarded(`${apiUrl}/auth/register`, { method: 'POST' }), (e) => e.code === 'AUTH_MUTATION_FORBIDDEN');
    await assert.rejects(guarded(`${apiUrl}/auth/kakao-login`, { method: 'POST' }), (e) => e.code === 'KAKAO_COMPLETION_NOT_ALLOWED');
    await assert.rejects(guarded('https://api.portone.io/payments', { method: 'GET' }), (e) => e.code === 'PROVIDER_EGRESS_FORBIDDEN');
  });
});

describe('FE-PILOT-AUTH-RUNTIME-PROBE-RUNNER-01 role contract', () => {
  it('Consumer success contract (gate + login + reread + logout)', async () => {
    assert.deepEqual(
      evaluateConsumerGate({ e2eSecret: 's', token: 's' }),
      { ok: true, code: null },
    );
    const result = await runRoleProbe('consumer', {
      apiUrl: URLS.api,
      email: 'consumer@example.test',
      password: 'pw-consumer',
      fetchImpl: mockApiFetch(),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.steps, { login: 'ok', reread: 'ok', logout: 'ok' });
    assert.equal(result.user.role, 'consumer');
  });

  it('Seller success contract (role seller/admin + storeId + reread + logout)', async () => {
    const gate = evaluateSellerGate({ isLocalRuntime: false, e2eSecret: 's', token: 's' });
    assert.equal(gate.ok, true);
    const localGate = evaluateSellerGate({ isLocalRuntime: true, e2eSecret: '', token: '' });
    assert.equal(localGate.ok, true); // current local contract: header gate skipped
    const result = await runRoleProbe('seller', {
      apiUrl: URLS.api,
      email: 'seller@example.test',
      password: 'pw-seller',
      fetchImpl: mockApiFetch(),
    });
    assert.equal(result.ok, true);
    assert.equal(result.user.role, 'seller');
  });

  it('Driver approved success (enable + secret + allowlist + role + approved + reread + logout)', async () => {
    const gate = evaluateDriverGate({
      isLocalRuntime: false,
      vercelEnv: 'preview',
      enabled: 'true',
      sharedSecret: 'sh',
      presentedSecret: 'sh',
      allowlist: 'driver@example.test',
      email: 'driver@example.test',
    });
    assert.equal(gate.ok, true);
    const result = await runRoleProbe('driver', {
      apiUrl: URLS.api,
      email: 'driver@example.test',
      password: 'pw-driver',
      fetchImpl: mockApiFetch(),
    });
    assert.equal(result.ok, true);
    assert.equal(result.user.role, 'driver');
  });

  it('Driver unapproved는 session 금지 (DRIVER_UNAPPROVED_REJECTED)', async () => {
    const fetchImpl = mockApiFetch({
      users: {
        'driver@example.test': {
          id: 'user-driver-9',
          email: 'driver@example.test',
          role: 'driver',
          driverApproved: false,
        },
      },
    });
    await assert.rejects(
      runRoleProbe('driver', {
        apiUrl: URLS.api,
        email: 'driver@example.test',
        password: 'pw-driver',
        fetchImpl,
      }),
      (e) => e.code === 'DRIVER_UNAPPROVED_REJECTED',
    );
  });

  it('session reread 생략을 거부한다', async () => {
    await assert.rejects(
      runRoleProbe('consumer', {
        apiUrl: URLS.api,
        email: 'consumer@example.test',
        password: 'pw-consumer',
        accessTokenForReread: null,
        fetchImpl: mockApiFetch(),
      }),
      (e) => e.code === 'CONSUMER_REREAD_REQUIRED',
    );
  });

  it('logout 실패를 거부한다', async () => {
    await assert.rejects(
      runRoleProbe('consumer', {
        apiUrl: URLS.api,
        email: 'consumer@example.test',
        password: 'pw-consumer',
        fetchImpl: mockApiFetch({ failLogout: true }),
      }),
      (e) => e.code === 'CONSUMER_LOGOUT_FAILED',
    );
  });

  it('API read-only boundary를 증명한다', async () => {
    const result = await runApiProbe({
      apiUrl: URLS.api,
      accessToken: 'at-user-consumer-1',
      fetchImpl: mockApiFetch(),
    });
    assert.equal(result.ok, true);
  });

  it('probe 실패가 role별로 구분된다', async () => {
    const fetchImpl = mockApiFetch({
      users: {
        'consumer@example.test': { id: 'u-c', email: 'consumer@example.test', role: 'consumer' },
        // seller returns a consumer role -> SELLER_ROLE_MISMATCH only for seller
        'seller@example.test': { id: 'u-s', email: 'seller@example.test', role: 'consumer', storeId: null },
        'driver@example.test': { id: 'u-d', email: 'driver@example.test', role: 'driver', driverApproved: true },
      },
    });
    const summary = await runAuthRuntimeProbe(validOptions(), {
      env: validEnv(),
      fetchImpl,
      apiToken: 'at-u-c',
    });
    assert.equal(summary.result, 'FAIL');
    assert.equal(summary.roles.consumer.status, 'PASS');
    assert.equal(summary.roles.seller.status, 'FAIL');
    assert.match(summary.roles.seller.failureCode, /^SELLER_/);
    assert.equal(summary.roles.driver.status, 'PASS');
  });

  it('전체 happy path는 role matrix PASS를 반환한다', async () => {
    const summary = await runAuthRuntimeProbe(validOptions(), {
      env: validEnv(),
      fetchImpl: mockApiFetch(),
      apiToken: 'at-user-consumer-1',
    });
    assert.equal(summary.result, 'PASS');
    assert.equal(summary.roles.consumer.status, 'PASS');
    assert.equal(summary.roles.seller.status, 'PASS');
    assert.equal(summary.roles.driver.status, 'PASS');
    assert.equal(summary.roles.api.status, 'PASS');
    assert.deepEqual(summary.failureCodes, []);
    assert.equal(summary.authSessionClaimRevocation, 'EXPLICITLY_NOT_CLOSED');
  });
});

describe('PILOT-AUTH-PROBE-16 native HTTP adapter + login diagnostic', () => {
  function nativeRoleFetch({ loginStatus = 200, loginBody = null, meBody = null, logoutStatus = 204 } = {}) {
    const defaultUser = {
      id: 'user-consumer-1',
      email: 'consumer@example.test',
      role: 'consumer',
    };
    const loginPayload =
      loginBody ?? { accessToken: 'at-user-consumer-1', refreshToken: 'rt-user-consumer-1', user: defaultUser };
    const mePayload = meBody ?? defaultUser;
    return async (url, init = {}) => {
      const method = String(init.method ?? 'GET').toUpperCase();
      const path = new URL(url).pathname;
      if (path === '/auth/login' && method === 'POST') {
        if (loginStatus >= 200 && loginStatus < 300) {
          return new Response(JSON.stringify(loginPayload), {
            status: loginStatus,
            headers: { 'content-type': 'application/json' },
          });
        }
        const body = typeof loginBody === 'string' ? loginBody : JSON.stringify({ error: 'rejected' });
        const ct = typeof loginBody === 'string' ? 'text/html' : 'application/json';
        return new Response(body, { status: loginStatus, headers: { 'content-type': ct } });
      }
      if (path === '/auth/me' && method === 'GET') {
        return new Response(JSON.stringify(mePayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (path === '/auth/logout' && method === 'POST') {
        if (logoutStatus === 204) return new Response(null, { status: 204 });
        return new Response(JSON.stringify({}), {
          status: logoutStatus,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not-found', { status: 404, headers: { 'content-type': 'text/plain' } });
    };
  }

  it('1. native Response 200 JSON login success를 소비한다', async () => {
    const result = await runRoleProbe('consumer', {
      apiUrl: URLS.api,
      email: 'consumer@example.test',
      password: 'pw-consumer',
      fetchImpl: nativeRoleFetch({ loginStatus: 200, logoutStatus: 200 }),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.steps, { login: 'ok', reread: 'ok', logout: 'ok' });
  });

  it('2. native Response /auth/me success를 소비한다', async () => {
    const meUser = { id: 'user-seller-1', email: 'seller@example.test', role: 'seller', storeId: 'store-1' };
    const fetchImpl = async (url, init = {}) => {
      const method = String(init.method ?? 'GET').toUpperCase();
      const path = new URL(url).pathname;
      if (path === '/auth/login' && method === 'POST') {
        return new Response(
          JSON.stringify({ accessToken: 'at-user-seller-1', refreshToken: 'rt-user-seller-1', user: meUser }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (path === '/auth/me') {
        return new Response(JSON.stringify(meUser), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(null, { status: 204 });
    };
    const result = await runRoleProbe('seller', {
      apiUrl: URLS.api,
      email: 'seller@example.test',
      password: 'pw-seller',
      fetchImpl,
    });
    assert.equal(result.ok, true);
    assert.equal(result.user.id, 'user-seller-1');
  });

  it('3. native Response logout 2xx success를 소비한다', async () => {
    for (const logoutStatus of [200, 204]) {
      const result = await runRoleProbe('consumer', {
        apiUrl: URLS.api,
        email: 'consumer@example.test',
        password: 'pw-consumer',
        fetchImpl: nativeRoleFetch({ logoutStatus }),
      });
      assert.equal(result.ok, true);
    }
  });

  it('4. native Response 401 login rejection은 sanitized unauthorized class를 남긴다', async () => {
    await assert.rejects(
      runRoleProbe('consumer', {
        apiUrl: URLS.api,
        email: 'consumer@example.test',
        password: 'pw-consumer',
        fetchImpl: nativeRoleFetch({ loginStatus: 401 }),
      }),
      (e) => {
        assert.ok(e instanceof ProbeContractError);
        assert.equal(e.code, 'CONSUMER_LOGIN_FAILED');
        assert.equal(e.details?.httpStatus, 401);
        assert.equal(e.details?.rejectionClass, 'AUTH_LOGIN_UNAUTHORIZED');
        assert.equal(e.details?.role, 'consumer');
        assert.equal(e.details?.step, 'login');
        assert.ok(!String(e.message).includes('consumer@example.test'));
        return true;
      },
    );
    assert.equal(classifyLoginRejection(401), 'AUTH_LOGIN_UNAUTHORIZED');
  });

  it('5. native Response 403 login rejection은 sanitized forbidden class를 남긴다', async () => {
    await assert.rejects(
      runRoleProbe('driver', {
        apiUrl: URLS.api,
        email: 'driver@example.test',
        password: 'pw-driver',
        fetchImpl: nativeRoleFetch({ loginStatus: 403 }),
      }),
      (e) => {
        assert.equal(e.code, 'DRIVER_LOGIN_FAILED');
        assert.equal(e.details?.httpStatus, 403);
        assert.equal(e.details?.rejectionClass, 'AUTH_LOGIN_FORBIDDEN');
        return true;
      },
    );
    assert.equal(classifyLoginRejection(403), 'AUTH_LOGIN_FORBIDDEN');
    assert.equal(classifyLoginRejection(404), 'AUTH_LOGIN_ROUTE_NOT_FOUND');
    assert.equal(classifyLoginRejection(500), 'AUTH_LOGIN_SERVER_ERROR');
    assert.equal(classifyLoginRejection(503), 'AUTH_LOGIN_SERVER_ERROR');
    assert.equal(classifyLoginRejection(418), 'AUTH_LOGIN_HTTP_REJECTED');
  });

  it('6. malformed/non-JSON error response가 secret/raw body 없이 안전하게 분류된다', async () => {
    const rawMarker = `raw-secret-marker-html`;
    const fetchImpl = async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path === '/auth/login') {
        return new Response(`<html>${rawMarker} probe-boundary-token</html>`, {
          status: 500,
          headers: { 'content-type': 'text/html' },
        });
      }
      return new Response('x', { status: 404 });
    };
    await assert.rejects(
      runRoleProbe('seller', {
        apiUrl: URLS.api,
        email: 'seller@example.test',
        password: 'pw-seller',
        fetchImpl,
      }),
      (e) => {
        assert.equal(e.code, 'SELLER_LOGIN_FAILED');
        assert.equal(e.details?.rejectionClass, 'AUTH_LOGIN_SERVER_ERROR');
        assert.equal(e.details?.httpStatus, 500);
        assert.ok(!String(e.message).includes(rawMarker));
        assert.ok(!String(e.message).includes('probe-boundary-token'));
        assert.ok(!JSON.stringify(e.details ?? {}).includes(rawMarker));
        return true;
      },
    );
    const normalized = await normalizeProbeHttpResponse(
      new Response('<html>oops</html>', { status: 500, headers: { 'content-type': 'text/html' } }),
    );
    assert.equal(normalized.ok, false);
    assert.equal(normalized.status, 500);
    assert.equal(normalized.data, null);
  });

  it('7. fake probe-boundary-token이 더 이상 runtime proof에 사용되지 않는다', async () => {
    const seenAuth = [];
    const spyFetch = async (url, init = {}) => {
      const path = new URL(url).pathname;
      const method = String(init.method ?? 'GET').toUpperCase();
      if (path === '/auth/me' && method === 'GET') {
        seenAuth.push(String(init.headers?.Authorization ?? ''));
        return { ok: false, status: 401, data: null };
      }
      if (path === '/auth/login') return { ok: false, status: 401, data: null };
      return { ok: false, status: 404, data: null };
    };
    const summary = await runAuthRuntimeProbe(validOptions(), { env: validEnv(), fetchImpl: spyFetch });
    assert.ok(!seenAuth.some((v) => v.includes('probe-boundary-token')));
    assert.notEqual(summary.roles.api?.failureCode, 'API_ME_FAILED');
    assert.equal(summary.roles.api?.failureCode, 'API_ME_SKIPPED_NO_TOKEN');
    assert.equal(summary.roles.api?.status, 'SKIP');
  });

  it('7b. role login 성공 시 실제 token을 메모리에서 재사용해 API boundary를 PASS한다', async () => {
    const summary = await runAuthRuntimeProbe(validOptions({ apiToken: undefined }), {
      env: validEnv(),
      fetchImpl: mockApiFetch(),
      // no explicit apiToken: must reuse real login token, not fake
    });
    assert.equal(summary.result, 'PASS');
    assert.equal(summary.roles.api.status, 'PASS');
  });

  it('8. summary/artifact에 credential/token이 포함되지 않는다', async () => {
    const summary = await runAuthRuntimeProbe(validOptions(), {
      env: validEnv(),
      fetchImpl: mockApiFetch(),
      apiToken: 'at-user-consumer-1',
    });
    const serialized = JSON.stringify(summary);
    for (const sensitive of [
      'pw-consumer',
      'pw-seller',
      'pw-driver',
      'consumer@example.test',
      'at-user-consumer-1',
      'rt-user-consumer-1',
      'probe-boundary-token',
      'e2e-secret',
      'driver-shared',
    ]) {
      assert.ok(!serialized.includes(sensitive), `summary must not contain ${sensitive}`);
    }
    // Role failure diagnostic carries only non-sensitive fields.
    const failSummary = await runAuthRuntimeProbe(validOptions(), {
      env: validEnv(),
      fetchImpl: async (url, init = {}) => {
        const path = new URL(url).pathname;
        if (path === '/auth/login') {
          return new Response(JSON.stringify({ error: 'x' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('x', { status: 404 });
      },
    });
    const failSerialized = JSON.stringify(failSummary);
    assert.ok(!failSerialized.includes('consumer@example.test'));
    assert.ok(!failSerialized.includes('pw-consumer'));
    assert.ok(!failSerialized.includes('probe-boundary-token'));
    assert.equal(failSummary.roles.consumer.rejectionClass, 'AUTH_LOGIN_UNAUTHORIZED');
    assert.equal(failSummary.roles.consumer.httpStatus, 401);
  });

  it('mock {ok,status,data} 계약이 계속 지원된다', async () => {
    const viaMock = await runRoleProbe('consumer', {
      apiUrl: URLS.api,
      email: 'consumer@example.test',
      password: 'pw-consumer',
      fetchImpl: mockApiFetch(),
    });
    assert.equal(viaMock.ok, true);
    const normalized = await normalizeProbeHttpResponse({ ok: true, status: 200, data: { a: 1 } });
    assert.deepEqual(normalized, { ok: true, status: 200, data: { a: 1 } });
    const nullish = await normalizeProbeHttpResponse(null);
    assert.deepEqual(nullish, { ok: false, status: 0, data: null });
  });

  it('9-11. safety/provider/production guard가 normalization 이후에도 유지된다', async () => {
    assert.throws(() => validateSafetyGates({ approval: '' }, validEnv()), (e) => e.code === 'MISSING_APPROVAL');
    assert.equal(isProductionUrl('https://greenlove.co.kr'), true);
    const guarded = createGuardedFetch(async () => ({ ok: true, status: 200, data: {} }), { apiUrl: URLS.api });
    await assert.rejects(guarded(`${URLS.api}/auth/register`, { method: 'POST' }), (e) => e.code === 'AUTH_MUTATION_FORBIDDEN');
    await assert.rejects(guarded('https://api.portone.io/x', { method: 'GET' }), (e) => e.code === 'PROVIDER_EGRESS_FORBIDDEN');
    await assert.rejects(guarded(`${URLS.api}/auth/kakao-login`, { method: 'POST' }), (e) => e.code === 'KAKAO_COMPLETION_NOT_ALLOWED');
  });

  it('10. standard Response 200 malformed JSON은 BODY_INVALID_JSON으로 구분된다', async () => {
    const rawMarker = 'raw-body-marker-10';
    const fetchImpl = async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path === '/auth/login') {
        return new Response(`<html>${rawMarker}</html>`, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      return new Response('x', { status: 404 });
    };
    await assert.rejects(
      runRoleProbe('consumer', {
        apiUrl: URLS.api,
        email: 'consumer@example.test',
        password: 'pw-consumer',
        fetchImpl,
      }),
      (e) => {
        assert.ok(e instanceof ProbeContractError);
        assert.equal(e.code, 'CONSUMER_LOGIN_FAILED');
        assert.equal(e.details?.httpStatus, 200);
        assert.equal(e.details?.rejectionClass, 'AUTH_LOGIN_BODY_INVALID_JSON');
        assert.equal(e.details?.step, 'login');
        assert.ok(!String(e.message).includes(rawMarker));
        assert.ok(!JSON.stringify(e.details ?? {}).includes(rawMarker));
        return true;
      },
    );
    const normalized = await normalizeProbeHttpResponse(
      new Response('<html>oops</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    assert.equal(normalized.ok, true);
    assert.equal(normalized.status, 200);
    assert.equal(normalized.data, null);
    assert.equal(normalized.bodyIssue, 'MALFORMED');
  });

  it('11. standard Response 200 accessToken missing은 TOKEN_MISSING으로 구분된다', async () => {
    const fetchImpl = async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path === '/auth/login') {
        return new Response(
          JSON.stringify({
            refreshToken: 'rt-user-consumer-1',
            user: { id: 'user-consumer-1', email: 'consumer@example.test', role: 'consumer' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('x', { status: 404 });
    };
    await assert.rejects(
      runRoleProbe('consumer', {
        apiUrl: URLS.api,
        email: 'consumer@example.test',
        password: 'pw-consumer',
        fetchImpl,
      }),
      (e) => {
        assert.equal(e.code, 'CONSUMER_LOGIN_FAILED');
        assert.equal(e.details?.httpStatus, 200);
        assert.equal(e.details?.rejectionClass, 'AUTH_LOGIN_TOKEN_MISSING');
        assert.equal(e.details?.step, 'login');
        return true;
      },
    );
  });

  it('12. standard Response 200 empty body는 BODY_EMPTY로 구분된다', async () => {
    const fetchImpl = async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path === '/auth/login') {
        return new Response('', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('x', { status: 404 });
    };
    await assert.rejects(
      runRoleProbe('consumer', {
        apiUrl: URLS.api,
        email: 'consumer@example.test',
        password: 'pw-consumer',
        fetchImpl,
      }),
      (e) => {
        assert.equal(e.code, 'CONSUMER_LOGIN_FAILED');
        assert.equal(e.details?.httpStatus, 200);
        assert.equal(e.details?.rejectionClass, 'AUTH_LOGIN_BODY_EMPTY');
        return true;
      },
    );
    const normalized = await normalizeProbeHttpResponse(new Response('', { status: 200 }));
    assert.equal(normalized.ok, true);
    assert.equal(normalized.data, null);
    assert.equal(normalized.bodyIssue, 'EMPTY');
  });

  it('13. body read failure는 READ_FAILED로 구분되고 원문을 노출하지 않는다', async () => {
    const nativeThrowing = {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => {
        throw new Error('boom-read');
      },
      json: async () => {
        throw new Error('boom-read');
      },
    };
    const normalized = await normalizeProbeHttpResponse(nativeThrowing);
    assert.equal(normalized.ok, true);
    assert.equal(normalized.status, 200);
    assert.equal(normalized.data, null);
    assert.equal(normalized.bodyIssue, 'READ_FAILED');
    const fetchImpl = async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path === '/auth/login') return nativeThrowing;
      return new Response('x', { status: 404 });
    };
    await assert.rejects(
      runRoleProbe('seller', {
        apiUrl: URLS.api,
        email: 'seller@example.test',
        password: 'pw-seller',
        fetchImpl,
      }),
      (e) => {
        assert.equal(e.code, 'SELLER_LOGIN_FAILED');
        assert.equal(e.details?.rejectionClass, 'AUTH_LOGIN_BODY_READ_FAILED');
        assert.equal(e.details?.httpStatus, 200);
        assert.ok(!String(e.message).includes('boom-read'));
        return true;
      },
    );
  });

  it('14. runApiProbe standard Response /auth/me success를 소비한다', async () => {
    const meUser = { id: 'user-api-1', email: 'consumer@example.test', role: 'consumer' };
    const fetchImpl = async (url, init = {}) => {
      const path = new URL(url).pathname;
      assert.equal(path, '/auth/me');
      assert.match(String(init.headers?.Authorization ?? ''), /^Bearer \S+$/);
      return new Response(JSON.stringify(meUser), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const result = await runApiProbe({ apiUrl: URLS.api, accessToken: 'at-user-api-1', fetchImpl });
    assert.equal(result.ok, true);
    assert.deepEqual(result.steps, { read: 'ok' });
  });

  it('15. runApiProbe standard Response /auth/me non-2xx는 API_ME_FAILED이다', async () => {
    const fetchImpl = async () => new Response('unauthorized', { status: 401 });
    await assert.rejects(
      runApiProbe({ apiUrl: URLS.api, accessToken: 'at-user-api-1', fetchImpl }),
      (e) => {
        assert.ok(e instanceof ProbeContractError);
        assert.equal(e.code, 'API_ME_FAILED');
        return true;
      },
    );
  });

  it('16. runRoleProbe /auth/me non-2xx native Response는 REREAD_FAILED이다', async () => {
    const loginUser = { id: 'user-consumer-1', email: 'consumer@example.test', role: 'consumer' };
    const fetchImpl = async (url, init = {}) => {
      const method = String(init.method ?? 'GET').toUpperCase();
      const path = new URL(url).pathname;
      if (path === '/auth/login' && method === 'POST') {
        return new Response(
          JSON.stringify({ accessToken: 'at-user-consumer-1', refreshToken: 'rt-user-consumer-1', user: loginUser }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (path === '/auth/me' && method === 'GET') {
        return new Response('unauthorized', { status: 401 });
      }
      return new Response(null, { status: 204 });
    };
    await assert.rejects(
      runRoleProbe('consumer', {
        apiUrl: URLS.api,
        email: 'consumer@example.test',
        password: 'pw-consumer',
        fetchImpl,
      }),
      (e) => {
        assert.equal(e.code, 'CONSUMER_REREAD_FAILED');
        return true;
      },
    );
  });

  it('17. failure-code collapse 해소: 401 vs malformed vs token-missing이 구분된다', async () => {
    const loginUser = { id: 'user-consumer-1', email: 'consumer@example.test', role: 'consumer' };
    const mkFetch = (loginResponse) => async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path === '/auth/login') return loginResponse;
      if (path === '/auth/me') {
        return new Response(JSON.stringify(loginUser), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(null, { status: 204 });
    };
    const capture = async (loginResponse) => {
      try {
        await runRoleProbe('consumer', {
          apiUrl: URLS.api,
          email: 'consumer@example.test',
          password: 'pw-consumer',
          fetchImpl: mkFetch(loginResponse),
        });
      } catch (e) {
        return e;
      }
      assert.fail('expected login failure');
    };
    const e401 = await capture(
      new Response(JSON.stringify({ error: 'rejected' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const eMalformed = await capture(
      new Response('<html>bad</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    const eTokenMissing = await capture(
      new Response(
        JSON.stringify({ refreshToken: 'rt-x', user: loginUser }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    assert.equal(e401.code, 'CONSUMER_LOGIN_FAILED');
    assert.equal(e401.details?.rejectionClass, 'AUTH_LOGIN_UNAUTHORIZED');
    assert.equal(eMalformed.details?.rejectionClass, 'AUTH_LOGIN_BODY_INVALID_JSON');
    assert.equal(eTokenMissing.details?.rejectionClass, 'AUTH_LOGIN_TOKEN_MISSING');
    assert.ok(
      new Set([e401.details?.rejectionClass, eMalformed.details?.rejectionClass, eTokenMissing.details?.rejectionClass]).size === 3,
      'three login failure classes must be distinct',
    );
  });
});
