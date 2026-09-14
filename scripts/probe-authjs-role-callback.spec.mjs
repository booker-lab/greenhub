/**
 * PILOT-AUTH-SELLER-DRIVER-AUTHJS-BOUNDARY-PROBE-GAP-CLOSURE-34B deterministic
 * tests for scripts/probe-authjs-role-callback.mjs.
 *
 * Mock/local only: no network, no real secrets, no external mutation. All
 * credential values below are synthetic fixtures. Run:
 *   node --test scripts/probe-authjs-role-callback.spec.mjs
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  APPROVAL_VALUE,
  ARTIFACT_KEYS,
  FAIL_RESULT_KEYS,
  PROTECTION_BYPASS_CREDENTIAL_ENV,
  PROTECTION_BYPASS_HEADER_NAME,
  PROTECTION_PASSAGE_MODES,
  ROLE_CONFIG,
  ROLE_VERDICTS,
  ROLES,
  RUNNER_ID,
  assertDeploymentId,
  assertExpectedSha,
  assertInvocationBinding,
  assertProtectionPassageReady,
  assertRole,
  buildFailureResult,
  buildRoleArtifact,
  canonicalUpstreamOrigin,
  classifyAuthError,
  classifyFailureLocation,
  classifyLocationClass,
  classifyRoleVerdict,
  classifySessionState,
  evaluateSessionContract,
  extractDeploymentReady,
  extractObservedDeploymentSha,
  fingerprintUpstreamOrigin,
  isProductionHostname,
  isProtectionIntercept,
  normalizeProtectionPassageMode,
  normalizeTargetUrl,
  parseUpstreamDiagnosticCode,
  resolveExpectedApiOrigin,
  roleConfig,
  runRoleCallbackProbe,
  validateEvidenceBinding,
  validateProbeGuards,
} from './probe-authjs-role-callback.mjs';

const SELLER_URL = 'https://greenhubseller-abc123-jos-projects-d1cecc0c.vercel.app';
const DRIVER_URL = 'https://greenhubdriver-def456-jos-projects-d1cecc0c.vercel.app';
const DYNAMIC_SHA_1 = '0123456789abcdef0123456789abcdef01234567';
const DYNAMIC_SHA_2 = 'fedcba9876543210fedcba9876543210fedcba98';
const DYNAMIC_SELLER_DPL = 'dpl_SellerRoleProbe11111111';
const DYNAMIC_DRIVER_DPL = 'dpl_DriverRoleProbe22222222';
const MOCK_SELLER_SECRET = 'mock-seller-e2e-secret-fixture-34B';
const MOCK_DRIVER_SECRET = 'mock-driver-shared-secret-fixture-34B';
const MOCK_BYPASS = 'mock-bypass-secret-fixture-34B';
const MOCK_PASSWORD = 'mock-role-password-fixture-34B';
const MOCK_CSRF = 'mock-csrf-token-fixture-34B';
const MOCK_SESSION_TOKEN = 'mock-access-token-fixture-34B';
const MOCK_COOKIE_VALUE = 'mock-session-cookie-value-fixture-34B';
const MOCK_EMAIL_SELLER = 'seller-probe-fixture-34B@example.test';
const MOCK_EMAIL_DRIVER = 'driver-probe-fixture-34B@example.test';

function fakeHeaders(entries = {}) {
  const lower = new Map();
  const setCookies = [];
  for (const [name, value] of Object.entries(entries)) {
    if (String(name).toLowerCase() === 'set-cookie') {
      if (Array.isArray(value)) setCookies.push(...value);
      else setCookies.push(String(value));
    } else {
      lower.set(String(name).toLowerCase(), String(value));
    }
  }
  return {
    get(name) {
      if (String(name).toLowerCase() === 'set-cookie') return setCookies[0] ?? null;
      return lower.get(String(name).toLowerCase()) ?? null;
    },
    getSetCookie() {
      return [...setCookies];
    },
  };
}

function jsonResponse({ status = 200, body = {}, headers = fakeHeaders({}) }) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    text: async () => text,
  };
}

function sellerEvidence(overrides = {}) {
  return {
    ready: true,
    expectedSha: DYNAMIC_SHA_1,
    deploymentShas: { seller: DYNAMIC_SHA_1, driver: DYNAMIC_SHA_1 },
    pinnedDeploymentIds: { seller: DYNAMIC_SELLER_DPL, driver: DYNAMIC_DRIVER_DPL },
    deploymentTargetUrls: { seller: SELLER_URL, driver: DRIVER_URL },
    ...overrides,
  };
}

function sellerInput(overrides = {}) {
  return {
    role: 'seller',
    targetUrl: SELLER_URL,
    expectedSha: DYNAMIC_SHA_1,
    deploymentId: DYNAMIC_SELLER_DPL,
    evidence: sellerEvidence(),
    appSecret: MOCK_SELLER_SECRET,
    email: MOCK_EMAIL_SELLER,
    password: MOCK_PASSWORD,
    approval: APPROVAL_VALUE,
    protectionPassageMode: 'NONE',
    workflowSha: DYNAMIC_SHA_2,
    checkedAt: '2026-09-14T00:00:00.000Z',
    ...overrides,
  };
}

function driverInput(overrides = {}) {
  return {
    role: 'driver',
    targetUrl: DRIVER_URL,
    expectedSha: DYNAMIC_SHA_1,
    deploymentId: DYNAMIC_DRIVER_DPL,
    evidence: sellerEvidence(),
    appSecret: MOCK_DRIVER_SECRET,
    email: MOCK_EMAIL_DRIVER,
    password: MOCK_PASSWORD,
    approval: APPROVAL_VALUE,
    protectionPassageMode: 'NONE',
    workflowSha: DYNAMIC_SHA_2,
    checkedAt: '2026-09-14T00:00:00.000Z',
    ...overrides,
  };
}

/** Three-step mock: CSRF ok -> callback 302 LOGIN_ERROR -> session INVALID. */
function mockCallbackInvalid(fetchLog = []) {
  return async (url, init = {}) => {
    const parsed = new URL(String(url));
    fetchLog.push({ path: parsed.pathname, headers: { ...(init.headers ?? {}) } });
    if (parsed.pathname === '/api/auth/csrf') {
      return jsonResponse({
        status: 200,
        body: { csrfToken: MOCK_CSRF },
        headers: fakeHeaders({ 'set-cookie': `csrf-token=${MOCK_COOKIE_VALUE}; Path=/` }),
      });
    }
    if (parsed.pathname === '/api/auth/callback/credentials') {
      return {
        ok: false,
        status: 302,
        headers: fakeHeaders({ location: '/login?code=upstream-rejected&error=CredentialsSignin' }),
        text: async () => JSON.stringify({ url: '/login?code=upstream-rejected&error=CredentialsSignin' }),
      };
    }
    if (parsed.pathname === '/api/auth/session') {
      return jsonResponse({ status: 200, body: { user: null } });
    }
    return jsonResponse({ status: 404, body: {} });
  };
}

/** Three-step mock ending in a VALID seller session. */
function mockCallbackValidSeller(fetchLog = []) {
  return async (url, init = {}) => {
    const parsed = new URL(String(url));
    fetchLog.push({ path: parsed.pathname, headers: { ...(init.headers ?? {}) } });
    if (parsed.pathname === '/api/auth/csrf') {
      return jsonResponse({ status: 200, body: { csrfToken: MOCK_CSRF } });
    }
    if (parsed.pathname === '/api/auth/callback/credentials') {
      return {
        ok: false,
        status: 302,
        headers: fakeHeaders({
          location: '/',
          'set-cookie': `auth-session=${MOCK_COOKIE_VALUE}; Path=/; HttpOnly`,
        }),
        text: async () => JSON.stringify({ url: '/' }),
      };
    }
    if (parsed.pathname === '/api/auth/session') {
      return jsonResponse({
        status: 200,
        body: { user: { role: 'seller', storeId: 'fixture-store-34B', accessToken: MOCK_SESSION_TOKEN } },
      });
    }
    return jsonResponse({ status: 404, body: {} });
  };
}

/** Three-step mock ending in a VALID driver session. */
function mockCallbackValidDriver(fetchLog = []) {
  return async (url, init = {}) => {
    const parsed = new URL(String(url));
    fetchLog.push({ path: parsed.pathname, headers: { ...(init.headers ?? {}) } });
    if (parsed.pathname === '/api/auth/csrf') {
      return jsonResponse({ status: 200, body: { csrfToken: MOCK_CSRF } });
    }
    if (parsed.pathname === '/api/auth/callback/credentials') {
      return {
        ok: false,
        status: 302,
        headers: fakeHeaders({
          location: '/',
          'set-cookie': `auth-session=${MOCK_COOKIE_VALUE}; Path=/; HttpOnly`,
        }),
        text: async () => JSON.stringify({ url: '/' }),
      };
    }
    if (parsed.pathname === '/api/auth/session') {
      return jsonResponse({
        status: 200,
        body: { user: { id: 'fixture-driver-34B', role: 'driver', accessToken: MOCK_SESSION_TOKEN } },
      });
    }
    return jsonResponse({ status: 404, body: {} });
  };
}

describe('role allowlist (34B)', () => {
  it('only seller|driver are admitted', () => {
    assert.deepEqual([...ROLES].sort(), ['driver', 'seller']);
    assert.equal(assertRole('seller'), 'seller');
    assert.equal(assertRole('driver'), 'driver');
    assert.equal(assertRole(' Seller '), 'seller');
    assert.equal(assertRole('DRIVER'), 'driver');
  });

  it('consumer/admin/unknown roles fail closed', () => {
    for (const bad of ['consumer', 'admin', '', 'SELLERX', 'driver2', null, undefined, 123]) {
      assert.throws(() => assertRole(bad), (error) => error.code === 'UNKNOWN_ROLE');
    }
  });

  it('per-role credential layer matches current main semantics', () => {
    assert.equal(ROLE_CONFIG.seller.headerName, 'x-e2e-test-token');
    assert.equal(ROLE_CONFIG.seller.credentialSource, 'E2E_TEST_SECRET');
    assert.equal(ROLE_CONFIG.seller.secretEnv, 'E2E_TEST_SECRET');
    assert.equal(ROLE_CONFIG.driver.headerName, 'x-round-direct-e2e-secret');
    assert.equal(ROLE_CONFIG.driver.credentialSource, 'ROUND_DIRECT_E2E_SHARED_SECRET');
    assert.equal(ROLE_CONFIG.driver.secretEnv, 'ROUND_DIRECT_E2E_SHARED_SECRET');
    assert.notEqual(ROLE_CONFIG.seller.headerName, ROLE_CONFIG.driver.headerName);
    assert.equal(roleConfig('seller').headerName, 'x-e2e-test-token');
    assert.equal(roleConfig('driver').headerName, 'x-round-direct-e2e-secret');
  });
});

describe('production target fail-closed (34B)', () => {
  it('production hostnames are rejected per role', () => {
    assert.equal(isProductionHostname('greenlove.co.kr'), true);
    assert.equal(isProductionHostname('app.greenlove.co.kr'), true);
    assert.equal(isProductionHostname('api-production-13e7.up.railway.app'), true);
    assert.equal(isProductionHostname('api-production-xyz'), true);
    assert.equal(isProductionHostname('greenhubseller-abc.vercel.app'), false);
  });

  it('normalizeTargetUrl rejects production and non-preview hosts', () => {
    assert.throws(
      () => normalizeTargetUrl('https://greenlove.co.kr/login', 'seller'),
      (error) => error.code === 'PRODUCTION_TARGET_REJECTED',
    );
    assert.throws(
      () => normalizeTargetUrl('https://api-production-13e7.up.railway.app/', 'driver'),
      (error) => error.code === 'PRODUCTION_TARGET_REJECTED',
    );
    assert.throws(
      () => normalizeTargetUrl('https://example.com/', 'seller'),
      (error) => error.code === 'RUNTIME_NOT_BOUND',
    );
    assert.throws(
      () => normalizeTargetUrl('http://greenhubseller-abc.vercel.app/', 'seller'),
      (error) => error.code === 'RUNTIME_NOT_BOUND',
    );
  });
});

describe('exact deployment/SHA binding (34B)', () => {
  it('SHA and deployment ID shapes are enforced', () => {
    assert.equal(assertExpectedSha(DYNAMIC_SHA_1), DYNAMIC_SHA_1);
    assert.throws(() => assertExpectedSha('short'), (e) => e.code === 'EXPECTED_SHA_MALFORMED');
    assert.equal(assertDeploymentId(DYNAMIC_SELLER_DPL), DYNAMIC_SELLER_DPL);
    assert.throws(() => assertDeploymentId('bad-id'), (e) => e.code === 'DEPLOYMENT_ID_MALFORMED');
    assert.deepEqual(
      assertInvocationBinding({ deploymentId: DYNAMIC_SELLER_DPL, expectedSha: DYNAMIC_SHA_1 }),
      { deploymentId: DYNAMIC_SELLER_DPL, expectedSha: DYNAMIC_SHA_1 },
    );
  });

  it('evidence binding checks the role slice (no cross-role substitution)', () => {
    const bound = validateEvidenceBinding({
      expectedSha: DYNAMIC_SHA_1,
      deploymentId: DYNAMIC_SELLER_DPL,
      targetUrl: SELLER_URL,
      role: 'seller',
      evidence: sellerEvidence(),
    });
    assert.equal(bound.expectedSha, DYNAMIC_SHA_1);
    // Driver deployment ID must not satisfy the seller slice.
    assert.throws(
      () =>
        validateEvidenceBinding({
          expectedSha: DYNAMIC_SHA_1,
          deploymentId: DYNAMIC_DRIVER_DPL,
          targetUrl: SELLER_URL,
          role: 'seller',
          evidence: sellerEvidence(),
        }),
      (e) => e.code === 'RUNTIME_BINDING_MISMATCH',
    );
    // Seller URL must not satisfy the driver slice.
    assert.throws(
      () =>
        validateEvidenceBinding({
          expectedSha: DYNAMIC_SHA_1,
          deploymentId: DYNAMIC_DRIVER_DPL,
          targetUrl: SELLER_URL,
          role: 'driver',
          evidence: sellerEvidence(),
        }),
      (e) => e.code === 'RUNTIME_BINDING_MISMATCH',
    );
    // Wrong SHA fails closed.
    assert.throws(
      () =>
        validateEvidenceBinding({
          expectedSha: DYNAMIC_SHA_2,
          deploymentId: DYNAMIC_SELLER_DPL,
          targetUrl: SELLER_URL,
          role: 'seller',
          evidence: sellerEvidence(),
        }),
      (e) => e.code === 'EXPECTED_SHA_MISMATCH' || e.code === 'DEPLOYMENT_SHA_MISMATCH',
    );
    // Non-ready evidence fails closed.
    assert.throws(
      () =>
        validateEvidenceBinding({
          expectedSha: DYNAMIC_SHA_1,
          deploymentId: DYNAMIC_SELLER_DPL,
          targetUrl: SELLER_URL,
          role: 'seller',
          evidence: sellerEvidence({ ready: false }),
        }),
      (e) => e.code === 'RUNTIME_NOT_BOUND',
    );
  });

  it('observed SHA extraction is role-scoped', () => {
    assert.equal(extractObservedDeploymentSha(sellerEvidence(), 'seller'), DYNAMIC_SHA_1);
    assert.equal(extractObservedDeploymentSha(sellerEvidence(), 'driver'), DYNAMIC_SHA_1);
    assert.equal(extractDeploymentReady(sellerEvidence()), true);
  });
});

describe('probe guards: approval + per-role credentials (34B)', () => {
  function baseEnv(role) {
    if (role === 'seller') {
      return {
        NON_PRODUCTION_AUTH_PROBE_APPROVAL: APPROVAL_VALUE,
        E2E_TEST_SECRET: MOCK_SELLER_SECRET,
        TEST_SELLER_EMAIL: MOCK_EMAIL_SELLER,
        TEST_SELLER_PASSWORD: MOCK_PASSWORD,
      };
    }
    return {
      NON_PRODUCTION_AUTH_PROBE_APPROVAL: APPROVAL_VALUE,
      ROUND_DIRECT_E2E_SHARED_SECRET: MOCK_DRIVER_SECRET,
      TEST_DRIVER_EMAIL: MOCK_EMAIL_DRIVER,
      TEST_DRIVER_PASSWORD: MOCK_PASSWORD,
    };
  }

  it('approval is required per role', () => {
    assert.throws(
      () => validateProbeGuards({ role: 'seller' }, { ...baseEnv('seller'), NON_PRODUCTION_AUTH_PROBE_APPROVAL: 'NO' }),
      (e) => e.code === 'MISSING_APPROVAL',
    );
    assert.throws(
      () => validateProbeGuards({ role: 'driver' }, { ...baseEnv('driver'), NON_PRODUCTION_AUTH_PROBE_APPROVAL: '' }),
      (e) => e.code === 'MISSING_APPROVAL',
    );
  });

  it('per-role secret absence fails closed with role provenance', () => {
    assert.throws(
      () => validateProbeGuards({ role: 'seller', email: MOCK_EMAIL_SELLER, password: MOCK_PASSWORD, approval: APPROVAL_VALUE }, {}),
      (e) => e.code === 'CREDENTIAL_SOURCE_UNAVAILABLE',
    );
    assert.throws(
      () => validateProbeGuards({ role: 'driver', email: MOCK_EMAIL_DRIVER, password: MOCK_PASSWORD, approval: APPROVAL_VALUE }, {}),
      (e) => e.code === 'CREDENTIAL_SOURCE_UNAVAILABLE',
    );
  });

  it('per-role credential absence fails closed with role code', () => {
    assert.throws(
      () => validateProbeGuards({ role: 'seller', approval: APPROVAL_VALUE }, { ...baseEnv('seller'), TEST_SELLER_EMAIL: '' }),
      (e) => e.code === 'SELLER_CREDENTIALS_MISSING',
    );
    assert.throws(
      () => validateProbeGuards({ role: 'driver', approval: APPROVAL_VALUE }, { ...baseEnv('driver'), TEST_DRIVER_PASSWORD: '' }),
      (e) => e.code === 'DRIVER_CREDENTIALS_MISSING',
    );
  });

  it('unknown role in guards fails closed', () => {
    assert.throws(
      () => validateProbeGuards({ role: 'consumer', approval: APPROVAL_VALUE }, {}),
      (e) => e.code === 'UNKNOWN_ROLE',
    );
  });
});

describe('Vercel bypass header presence provenance (34B)', () => {
  it('modes are closed to NONE|AUTOMATION_BYPASS', () => {
    assert.deepEqual([...PROTECTION_PASSAGE_MODES].sort(), ['AUTOMATION_BYPASS', 'NONE']);
    assert.equal(normalizeProtectionPassageMode('NONE'), 'NONE');
    assert.equal(normalizeProtectionPassageMode('AUTOMATION_BYPASS'), 'AUTOMATION_BYPASS');
    assert.throws(() => normalizeProtectionPassageMode('QUERY'), (e) => e.code === 'PROTECTION_PASSAGE_MODE_UNSUPPORTED');
    assert.equal(PROTECTION_BYPASS_HEADER_NAME, 'x-vercel-protection-bypass');
    assert.equal(PROTECTION_BYPASS_CREDENTIAL_ENV, 'VERCEL_AUTOMATION_BYPASS_SECRET');
  });

  it('AUTOMATION_BYPASS without credential fails closed before network', () => {
    assert.throws(
      () => assertProtectionPassageReady({ protectionPassageMode: 'AUTOMATION_BYPASS' }, {}),
      (e) => e.code === 'AUTOMATION_BYPASS_CREDENTIAL_UNAVAILABLE',
    );
  });

  it('AUTOMATION_BYPASS attaches bypass to all three role requests', async () => {
    const log = [];
    await runRoleCallbackProbe(sellerInput({ protectionPassageMode: 'AUTOMATION_BYPASS', appSecret: MOCK_SELLER_SECRET }), {
      env: {
        NON_PRODUCTION_AUTH_PROBE_APPROVAL: APPROVAL_VALUE,
        E2E_TEST_SECRET: MOCK_SELLER_SECRET,
        TEST_SELLER_EMAIL: MOCK_EMAIL_SELLER,
        TEST_SELLER_PASSWORD: MOCK_PASSWORD,
        [PROTECTION_BYPASS_CREDENTIAL_ENV]: MOCK_BYPASS,
      },
      fetchImpl: mockCallbackInvalid(log),
    }).catch(() => null);
    // Even on INVALID outcome the three requests must have been attempted.
    assert.equal(log.length, 3);
    for (const entry of log) {
      assert.equal(entry.headers[PROTECTION_BYPASS_HEADER_NAME], MOCK_BYPASS);
    }
  });

  it('NONE never sends the bypass header', async () => {
    const log = [];
    await runRoleCallbackProbe(sellerInput(), {
      env: {
        NON_PRODUCTION_AUTH_PROBE_APPROVAL: APPROVAL_VALUE,
        E2E_TEST_SECRET: MOCK_SELLER_SECRET,
        TEST_SELLER_EMAIL: MOCK_EMAIL_SELLER,
        TEST_SELLER_PASSWORD: MOCK_PASSWORD,
      },
      fetchImpl: mockCallbackInvalid(log),
    });
    for (const entry of log) {
      assert.ok(!(PROTECTION_BYPASS_HEADER_NAME in entry.headers));
    }
  });
});

describe('per-role application header provenance (34B)', () => {
  it('seller sends x-e2e-test-token, driver sends x-round-direct-e2e-secret', async () => {
    const sellerLog = [];
    await runRoleCallbackProbe(sellerInput(), {
      env: {
        NON_PRODUCTION_AUTH_PROBE_APPROVAL: APPROVAL_VALUE,
        E2E_TEST_SECRET: MOCK_SELLER_SECRET,
        TEST_SELLER_EMAIL: MOCK_EMAIL_SELLER,
        TEST_SELLER_PASSWORD: MOCK_PASSWORD,
      },
      fetchImpl: mockCallbackInvalid(sellerLog),
    });
    assert.ok(sellerLog.length >= 2);
    assert.equal(sellerLog[0].headers['x-e2e-test-token'], MOCK_SELLER_SECRET);
    assert.ok(!('x-round-direct-e2e-secret' in sellerLog[0].headers));

    const driverLog = [];
    await runRoleCallbackProbe(driverInput(), {
      env: {
        NON_PRODUCTION_AUTH_PROBE_APPROVAL: APPROVAL_VALUE,
        ROUND_DIRECT_E2E_SHARED_SECRET: MOCK_DRIVER_SECRET,
        TEST_DRIVER_EMAIL: MOCK_EMAIL_DRIVER,
        TEST_DRIVER_PASSWORD: MOCK_PASSWORD,
      },
      fetchImpl: mockCallbackInvalid(driverLog),
    });
    assert.ok(driverLog.length >= 2);
    assert.equal(driverLog[0].headers['x-round-direct-e2e-secret'], MOCK_DRIVER_SECRET);
    assert.ok(!('x-e2e-test-token' in driverLog[0].headers));
  });
});

describe('secret value non-serialization (34B)', () => {
  it('artifacts and FAILs carry names/presence only', async () => {
    const { artifact } = await runRoleCallbackProbe(sellerInput(), {
      env: {
        NON_PRODUCTION_AUTH_PROBE_APPROVAL: APPROVAL_VALUE,
        E2E_TEST_SECRET: MOCK_SELLER_SECRET,
        TEST_SELLER_EMAIL: MOCK_EMAIL_SELLER,
        TEST_SELLER_PASSWORD: MOCK_PASSWORD,
      },
      fetchImpl: mockCallbackInvalid(),
    });
    const serialized = JSON.stringify(artifact);
    for (const secret of [MOCK_SELLER_SECRET, MOCK_DRIVER_SECRET, MOCK_BYPASS, MOCK_PASSWORD, MOCK_CSRF, MOCK_SESSION_TOKEN, MOCK_COOKIE_VALUE, MOCK_EMAIL_SELLER, MOCK_EMAIL_DRIVER]) {
      assert.ok(!serialized.includes(secret), `artifact must not contain ${secret.slice(0, 12)}...`);
    }
    for (const forbidden of ['password', 'passwordHash', 'email', 'serviceAccount', 'private_key', 'token', 'secret', 'cookie', 'csrfToken', 'accessToken']) {
      assert.ok(!Object.hasOwn(artifact, forbidden), `artifact must not carry ${forbidden}`);
    }
    assert.equal(artifact.headerName, 'x-e2e-test-token');
    assert.equal(artifact.credentialSource, 'E2E_TEST_SECRET');
    assert.equal(typeof artifact.headerPresent, 'boolean');
  });

  it('FAIL evidence never serializes secrets', async () => {
    try {
      await runRoleCallbackProbe(
        sellerInput({ appSecret: '', evidence: sellerEvidence() }),
        {
          env: {
            NON_PRODUCTION_AUTH_PROBE_APPROVAL: APPROVAL_VALUE,
            TEST_SELLER_EMAIL: MOCK_EMAIL_SELLER,
            TEST_SELLER_PASSWORD: MOCK_PASSWORD,
          },
          fetchImpl: async () => {
            throw new Error('must not be called');
          },
        },
      );
      assert.fail('expected guard FAIL');
    } catch (error) {
      const serialized = JSON.stringify(error.evidence);
      for (const secret of [MOCK_SELLER_SECRET, MOCK_PASSWORD, MOCK_EMAIL_SELLER]) {
        assert.ok(!serialized.includes(secret));
      }
    }
  });
});

describe('callback redirect classification (34B)', () => {
  it('Location classes are ROOT/LOGIN_ERROR/OTHER', () => {
    assert.equal(classifyLocationClass('/'), 'ROOT');
    assert.equal(classifyLocationClass('/login?x=1'), 'LOGIN_ERROR');
    assert.equal(classifyLocationClass('/dashboard'), 'OTHER');
    assert.equal(classifyFailureLocation({ locationValue: null, base: SELLER_URL, isProtection: false }), 'NONE');
  });

  it('auth error classes cover the locked taxonomy', () => {
    assert.equal(classifyAuthError({ status: 302, codeParam: 'authorize-rejected', errorParam: null }), 'authorize-rejected');
    assert.equal(classifyAuthError({ status: 302, codeParam: 'upstream-rejected', errorParam: null }), 'upstream-rejected');
    assert.equal(classifyAuthError({ status: 500, codeParam: null, errorParam: null }), 'api-binding-failure');
    assert.equal(parseUpstreamDiagnosticCode('upstream-rejected__s400__o0123456789abcdef')?.upstreamStatus, 400);
    assert.equal(parseUpstreamDiagnosticCode('upstream-rejected'), null);
  });
});

describe('Set-Cookie presence only (34B)', () => {
  it('cookie presence is boolean; values never enter evidence', async () => {
    const { artifact } = await runRoleCallbackProbe(sellerInput(), {
      env: {
        NON_PRODUCTION_AUTH_PROBE_APPROVAL: APPROVAL_VALUE,
        E2E_TEST_SECRET: MOCK_SELLER_SECRET,
        TEST_SELLER_EMAIL: MOCK_EMAIL_SELLER,
        TEST_SELLER_PASSWORD: MOCK_PASSWORD,
      },
      fetchImpl: mockCallbackValidSeller(),
    });
    assert.equal(artifact.setCookiePresent, true);
    assert.equal(typeof artifact.setCookiePresent, 'boolean');
  });
});

describe('same-context session classification (34B)', () => {
  it('VALID requires a non-empty accessToken; otherwise INVALID', () => {
    assert.equal(classifySessionState({ user: { accessToken: MOCK_SESSION_TOKEN } }), 'VALID');
    assert.equal(classifySessionState({ user: null }), 'INVALID');
    assert.equal(classifySessionState({ user: {} }), 'INVALID');
    assert.equal(classifySessionState({}), 'INVALID');
  });

  it('three requests share one cookie jar in order', async () => {
    const log = [];
    const { calls } = await runRoleCallbackProbe(sellerInput(), {
      env: {
        NON_PRODUCTION_AUTH_PROBE_APPROVAL: APPROVAL_VALUE,
        E2E_TEST_SECRET: MOCK_SELLER_SECRET,
        TEST_SELLER_EMAIL: MOCK_EMAIL_SELLER,
        TEST_SELLER_PASSWORD: MOCK_PASSWORD,
      },
      fetchImpl: mockCallbackInvalid(log),
    });
    assert.deepEqual(calls, ['/api/auth/csrf', '/api/auth/callback/credentials', '/api/auth/session']);
  });

  it('session transport failure is an explicit FAIL (UNAVAILABLE)', async () => {
    const fetchImpl = async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/api/auth/csrf') {
        return jsonResponse({ status: 200, body: { csrfToken: MOCK_CSRF } });
      }
      if (parsed.pathname === '/api/auth/callback/credentials') {
        return {
          ok: false,
          status: 302,
          headers: fakeHeaders({ location: '/' }),
          text: async () => JSON.stringify({ url: '/' }),
        };
      }
      throw new Error('session transport down');
    };
    try {
      await runRoleCallbackProbe(sellerInput(), {
        env: {
          NON_PRODUCTION_AUTH_PROBE_APPROVAL: APPROVAL_VALUE,
          E2E_TEST_SECRET: MOCK_SELLER_SECRET,
          TEST_SELLER_EMAIL: MOCK_EMAIL_SELLER,
          TEST_SELLER_PASSWORD: MOCK_PASSWORD,
        },
        fetchImpl,
      });
      assert.fail('expected SESSION_READ_FAILED');
    } catch (error) {
      assert.equal(error.code, 'SESSION_READ_FAILED');
      assert.equal(error.evidence.sessionAttempted, true);
      assert.equal(classifyRoleVerdict(error.evidence), 'API_BINDING_FAILURE');
    }
  });
});

describe('Seller role/store contract (34B P8)', () => {
  it('seller PASS requires allowlisted role + non-empty storeId', () => {
    assert.deepEqual(evaluateSessionContract('seller', { role: 'seller', storeId: 's-1' }), {
      contract: 'PASS',
      roleAdmitted: true,
      storeBindingPresent: true,
    });
    assert.deepEqual(evaluateSessionContract('seller', { role: 'admin', storeId: 's-1' }), {
      contract: 'PASS',
      roleAdmitted: true,
      storeBindingPresent: true,
    });
    assert.equal(evaluateSessionContract('seller', { role: 'consumer', storeId: 's-1' }).contract, 'FAIL');
    assert.equal(evaluateSessionContract('seller', { role: 'seller', storeId: '' }).contract, 'FAIL');
    assert.equal(evaluateSessionContract('seller', { role: 'seller' }).contract, 'FAIL');
    assert.equal(evaluateSessionContract('seller', null).contract, 'FAIL');
  });

  it('VALID seller session with contract PASS yields AUTHJS_SESSION_VALID', async () => {
    const { artifact } = await runRoleCallbackProbe(sellerInput(), {
      env: {
        NON_PRODUCTION_AUTH_PROBE_APPROVAL: APPROVAL_VALUE,
        E2E_TEST_SECRET: MOCK_SELLER_SECRET,
        TEST_SELLER_EMAIL: MOCK_EMAIL_SELLER,
        TEST_SELLER_PASSWORD: MOCK_PASSWORD,
      },
      fetchImpl: mockCallbackValidSeller(),
    });
    assert.equal(artifact.sessionState, 'VALID');
    assert.equal(artifact.sessionContract, 'PASS');
    assert.equal(artifact.sessionRoleAdmitted, true);
    assert.equal(artifact.sessionStoreBindingPresent, true);
    assert.equal(artifact.verdict, 'AUTHJS_SESSION_VALID');
    assert.equal(classifyRoleVerdict(artifact), 'AUTHJS_SESSION_VALID');
  });

  it('VALID seller session with bad role yields IDENTITY_CONTRACT_FAILURE', async () => {
    const fetchImpl = async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/api/auth/csrf') return jsonResponse({ status: 200, body: { csrfToken: MOCK_CSRF } });
      if (parsed.pathname === '/api/auth/callback/credentials') {
        return {
          ok: false,
          status: 302,
          headers: fakeHeaders({ location: '/', 'set-cookie': `s=${MOCK_COOKIE_VALUE}; Path=/` }),
          text: async () => JSON.stringify({ url: '/' }),
        };
      }
      return jsonResponse({ status: 200, body: { user: { role: 'consumer', storeId: 's-1', accessToken: MOCK_SESSION_TOKEN } } });
    };
    const { artifact } = await runRoleCallbackProbe(sellerInput(), {
      env: {
        NON_PRODUCTION_AUTH_PROBE_APPROVAL: APPROVAL_VALUE,
        E2E_TEST_SECRET: MOCK_SELLER_SECRET,
        TEST_SELLER_EMAIL: MOCK_EMAIL_SELLER,
        TEST_SELLER_PASSWORD: MOCK_PASSWORD,
      },
      fetchImpl,
    });
    assert.equal(artifact.sessionState, 'VALID');
    assert.equal(artifact.sessionContract, 'FAIL');
    assert.equal(artifact.verdict, 'IDENTITY_CONTRACT_FAILURE');
  });
});

describe('Driver approval contract (34B P8)', () => {
  it('driver PASS requires role driver (approval enforced at authorize)', () => {
    assert.deepEqual(evaluateSessionContract('driver', { role: 'driver' }), {
      contract: 'PASS',
      roleAdmitted: true,
      storeBindingPresent: null,
    });
    assert.equal(evaluateSessionContract('driver', { role: 'seller' }).contract, 'FAIL');
    assert.equal(evaluateSessionContract('driver', null).contract, 'FAIL');
  });

  it('VALID driver session yields AUTHJS_SESSION_VALID', async () => {
    const { artifact } = await runRoleCallbackProbe(driverInput(), {
      env: {
        NON_PRODUCTION_AUTH_PROBE_APPROVAL: APPROVAL_VALUE,
        ROUND_DIRECT_E2E_SHARED_SECRET: MOCK_DRIVER_SECRET,
        TEST_DRIVER_EMAIL: MOCK_EMAIL_DRIVER,
        TEST_DRIVER_PASSWORD: MOCK_PASSWORD,
      },
      fetchImpl: mockCallbackValidDriver(),
    });
    assert.equal(artifact.sessionState, 'VALID');
    assert.equal(artifact.sessionContract, 'PASS');
    assert.equal(artifact.sessionRoleAdmitted, true);
    assert.equal(artifact.sessionStoreBindingPresent, null);
    assert.equal(artifact.role, 'driver');
    assert.equal(artifact.verdict, 'AUTHJS_SESSION_VALID');
  });

  it('INVALID driver session is an application rejection, not a session proof', async () => {
    const { artifact } = await runRoleCallbackProbe(driverInput(), {
      env: {
        NON_PRODUCTION_AUTH_PROBE_APPROVAL: APPROVAL_VALUE,
        ROUND_DIRECT_E2E_SHARED_SECRET: MOCK_DRIVER_SECRET,
        TEST_DRIVER_EMAIL: MOCK_EMAIL_DRIVER,
        TEST_DRIVER_PASSWORD: MOCK_PASSWORD,
      },
      fetchImpl: mockCallbackInvalid(),
    });
    assert.equal(artifact.sessionState, 'INVALID');
    assert.equal(artifact.verdict, 'EXPECTED_APPLICATION_REJECTION');
  });
});

describe('verdict taxonomy (34B section 6)', () => {
  it('verdicts are closed to the seven allowed values', () => {
    assert.deepEqual([...ROLE_VERDICTS].sort(), [
      'API_BINDING_FAILURE',
      'AUTHJS_CALLBACK_REJECTED',
      'AUTHJS_SESSION_VALID',
      'EDGE_OR_PROTECTION_BLOCKED',
      'EXPECTED_APPLICATION_REJECTION',
      'IDENTITY_CONTRACT_FAILURE',
      'INCONCLUSIVE',
    ].sort());
  });

  it('direct API PASS is never mapped here (only same-context session counts)', () => {
    // A direct-API style payload without Auth.js session evidence stays INCONCLUSIVE.
    assert.equal(classifyRoleVerdict({ result: 'SUCCESS' }), 'INCONCLUSIVE');
    assert.equal(classifyRoleVerdict(null), 'INCONCLUSIVE');
  });

  it('protection intercept maps to EDGE_OR_PROTECTION_BLOCKED', () => {
    assert.equal(
      classifyRoleVerdict({ result: 'FAIL', failureCode: 'DEPLOYMENT_PROTECTION_INTERCEPTED' }),
      'EDGE_OR_PROTECTION_BLOCKED',
    );
  });

  it('401/403 callback maps to AUTHJS_CALLBACK_REJECTED', () => {
    assert.equal(
      classifyRoleVerdict({ result: 'FAIL', failureCode: 'CALLBACK_REJECTED' }),
      'AUTHJS_CALLBACK_REJECTED',
    );
  });
});

describe('sanitized evidence key sets (34B)', () => {
  it('SUCCESS artifact keys are exactly ARTIFACT_KEYS', async () => {
    const { artifact } = await runRoleCallbackProbe(sellerInput(), {
      env: {
        NON_PRODUCTION_AUTH_PROBE_APPROVAL: APPROVAL_VALUE,
        E2E_TEST_SECRET: MOCK_SELLER_SECRET,
        TEST_SELLER_EMAIL: MOCK_EMAIL_SELLER,
        TEST_SELLER_PASSWORD: MOCK_PASSWORD,
      },
      fetchImpl: mockCallbackInvalid(),
    });
    assert.deepEqual(Object.keys(artifact).sort(), [...ARTIFACT_KEYS].sort());
    assert.equal(artifact.runner, RUNNER_ID);
    assert.equal(artifact.role, 'seller');
  });

  it('FAIL keys are exactly FAIL_RESULT_KEYS', () => {
    const failure = buildFailureResult({
      role: 'driver',
      checkedAt: '2026-09-14T00:00:00.000Z',
      failureCode: 'CSRF_TRANSPORT_FAILED',
      failureStage: 'csrf',
      message: 'fixture',
    });
    assert.deepEqual(Object.keys(failure).sort(), [...FAIL_RESULT_KEYS].sort());
    assert.equal(failure.role, 'driver');
    assert.equal(failure.headerName, 'x-round-direct-e2e-secret');
  });

  it('expected API origin correlation is fingerprint-only', () => {
    assert.equal(canonicalUpstreamOrigin('https://api-staging.example.com/v1/x?y=1'), 'https://api-staging.example.com');
    const fp = fingerprintUpstreamOrigin('https://api-staging.example.com');
    assert.equal(typeof fp, 'string');
    assert.equal(fp.length, 16);
    assert.equal(resolveExpectedApiOrigin({ expectedApiOrigin: 'https://api-staging.example.com' }, {}), 'https://api-staging.example.com');
    assert.equal(resolveExpectedApiOrigin({}, {}), null);
  });
});

describe('consumer probe preservation (34B boundary)', () => {
  it('role probe never imports the consumer probe (no refactor coupling)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(here, 'probe-authjs-role-callback.mjs'), 'utf8');
    assert.ok(!/^import .*probe-consumer-callback/m.test(source), 'role probe must not import the consumer probe');
    assert.ok(!source.includes('from ./probe-consumer-callback.mjs'), 'role probe must not import the consumer probe module');
    assert.ok(!source.includes('runConsumerCallbackProbe'), 'role probe must not reuse the consumer entrypoint');
  });

  it('role request builders are distinct from the consumer builder', () => {
    assert.ok(!String(ROLE_CONFIG.seller.requestBuilder).includes('probe-consumer-callback'));
    assert.ok(!String(ROLE_CONFIG.driver.requestBuilder).includes('probe-consumer-callback'));
  });
});
