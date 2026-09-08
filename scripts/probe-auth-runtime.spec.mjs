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
  createGuardedFetch,
  evaluateConsumerGate,
  evaluateDriverGate,
  evaluateSellerGate,
  isProductionUrl,
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
