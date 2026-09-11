/**
 * PILOT-AUTH-CONSUMER-CALLBACK-INPUT-BINDING-PROOF-16 deterministic tests.
 *
 * Mock/local only: no network, no real secrets, no external mutation. The
 * mock credential values below are synthetic test fixtures — real secret
 * material is never present in this file. Run:
 *   node --test scripts/probe-consumer-callback.spec.mjs
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  APPROVAL_VALUE,
  ARTIFACT_KEYS,
  CREDENTIAL_SOURCE,
  HEADER_NAME,
  LOCKED_BRANCH,
  LOCKED_DEPLOYMENT_ID,
  LOCKED_SOURCE_SHA,
  REQUEST_BUILDER,
  assertDeploymentId,
  assertExpectedSha,
  assertLockedBinding,
  buildCallbackArtifact,
  classifyAuthError,
  classifyLocationClass,
  isProductionHostname,
  normalizeConsumerUrl,
  runConsumerCallbackProbe,
  validateEvidenceBinding,
  validateProbeGuards,
} from './probe-consumer-callback.mjs';

const CONSUMER_URL = 'https://greenhubconsumer-2v8t54nvh-jos-projects-d1cecc0c.vercel.app';
const MOCK_SECRET = 'mock-e2e-secret-fixture-16';
const MOCK_PASSWORD = 'mock-consumer-password-fixture-16';
const MOCK_CSRF = 'mock-csrf-token-fixture-16';
const MOCK_SESSION_TOKEN = 'mock-access-token-fixture-16';
const MOCK_COOKIE_VALUE = 'mock-session-cookie-value-fixture-16';

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

function validEvidence(overrides = {}) {
  return {
    ready: true,
    expectedSha: LOCKED_SOURCE_SHA,
    deploymentShas: { consumer: LOCKED_SOURCE_SHA },
    pinnedDeploymentIds: { consumer: LOCKED_DEPLOYMENT_ID },
    deploymentTargetUrls: { consumer: CONSUMER_URL },
    ...overrides,
  };
}

function validInput(overrides = {}) {
  return {
    consumerUrl: CONSUMER_URL,
    expectedSha: LOCKED_SOURCE_SHA,
    deploymentId: LOCKED_DEPLOYMENT_ID,
    evidence: validEvidence(),
    e2eSecret: MOCK_SECRET,
    email: 'consumer-proof-16@example.test',
    password: MOCK_PASSWORD,
    approval: APPROVAL_VALUE,
    workflowSha: 'workflow-sha-fixture-16',
    checkedAt: '2026-09-11T00:00:00.000Z',
    ...overrides,
  };
}

/** Mock fetch with per-path scripted responses; records request headers. */
function mockFetch(scripts) {
  const seen = [];
  const fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    seen.push({ path, headers: { ...(init.headers ?? {}) } });
    const script = scripts[path];
    if (!script) throw new Error(`unexpected fetch path in test: ${path}`);
    return typeof script === 'function' ? script(url, init) : script;
  };
  fetch.seen = seen;
  fetch.paths = () => seen.map((entry) => entry.path);
  return fetch;
}

const csrfOk = () =>
  jsonResponse({ status: 200, body: { csrfToken: MOCK_CSRF } });

const callbackRedirect = (location, setCookie) =>
  jsonResponse({
    status: 302,
    body: {},
    headers: fakeHeaders({
      Location: location,
      ...(setCookie ? { 'Set-Cookie': setCookie } : {}),
    }),
  });

const sessionValid = () =>
  jsonResponse({
    status: 200,
    body: { user: { id: 'user-16', accessToken: MOCK_SESSION_TOKEN } },
  });

const sessionInvalid = () => jsonResponse({ status: 200, body: {} });

describe('callback probe input contract (E2E_TEST_SECRET -> x-e2e-test-token)', () => {
  it('locked target constants match the CASE B1 canonical input', () => {
    assert.equal(LOCKED_DEPLOYMENT_ID, 'dpl_B7TCW4CzUgWZv9JTUffMdpjCY7Qd');
    assert.equal(LOCKED_SOURCE_SHA, '67632ede1d7196456bcf1fe5320a7a7e7d509c0c');
    assert.equal(LOCKED_BRANCH, 'tmp/pilot-auth-verifier-cookie-04a-publication-01');
    assert.equal(HEADER_NAME, 'x-e2e-test-token');
    assert.equal(CREDENTIAL_SOURCE, 'E2E_TEST_SECRET');
    assert.equal(APPROVAL_VALUE, 'NON_PRODUCTION_AUTH_PROBE_APPROVED');
  });

  it('authorize-rejected lifecycle proves header path with runtime rejection', async () => {
    const fetch = mockFetch({
      '/api/auth/csrf': csrfOk(),
      '/api/auth/callback/credentials': callbackRedirect(
        `${CONSUMER_URL}/login?error=CredentialsSignin&code=authorize-rejected`,
      ),
      '/api/auth/session': sessionInvalid(),
    });
    const { artifact, calls } = await runConsumerCallbackProbe(validInput(), {
      env: {},
      fetchImpl: fetch,
    });
    assert.equal(artifact.credentialSource, 'E2E_TEST_SECRET');
    assert.equal(artifact.headerName, 'x-e2e-test-token');
    assert.equal(artifact.headerPresent, true);
    assert.equal(artifact.requestBuilder, REQUEST_BUILDER);
    assert.equal(artifact.callbackStatus, 302);
    assert.equal(artifact.callbackLocationClass, 'LOGIN_ERROR');
    assert.equal(artifact.authErrorClass, 'authorize-rejected');
    assert.equal(artifact.setCookiePresent, false);
    assert.equal(artifact.sessionState, 'INVALID');
    assert.equal(artifact.deploymentId, LOCKED_DEPLOYMENT_ID);
    assert.equal(artifact.deploymentSourceSha, LOCKED_SOURCE_SHA);
    // Exact callback path executed in order; direct API probe never used.
    assert.deepEqual(calls, [
      '/api/auth/csrf',
      '/api/auth/callback/credentials',
      '/api/auth/session',
    ]);
    assert.ok(!calls.includes('/auth/login'), 'direct API /auth/login must never be called');
    assert.ok(
      fetch.paths().every((path) => path.startsWith('/api/auth/')),
      'only NextAuth callback-path endpoints may be called',
    );
  });

  it('header object is constructed from the approved input on CSRF and callback', async () => {
    const fetch = mockFetch({
      '/api/auth/csrf': csrfOk(),
      '/api/auth/callback/credentials': callbackRedirect(
        `${CONSUMER_URL}/login?error=CredentialsSignin&code=authorize-rejected`,
      ),
      '/api/auth/session': sessionInvalid(),
    });
    await runConsumerCallbackProbe(validInput(), { env: {}, fetchImpl: fetch });
    const csrfHeaders = fetch.seen.find((entry) => entry.path === '/api/auth/csrf').headers;
    const callbackHeaders = fetch.seen.find(
      (entry) => entry.path === '/api/auth/callback/credentials',
    ).headers;
    // Same construction as loginViaCredentials: approved input under the
    // expected key on BOTH requests (mock value compared in-memory only).
    assert.equal(csrfHeaders[HEADER_NAME], MOCK_SECRET);
    assert.equal(callbackHeaders[HEADER_NAME], MOCK_SECRET);
  });

  it('gate pass with VALID session maps to NONE + ROOT + VALID', async () => {
    const fetch = mockFetch({
      '/api/auth/csrf': csrfOk(),
      '/api/auth/callback/credentials': callbackRedirect(
        `${CONSUMER_URL}/`,
        `__Secure-authjs.session-token=${MOCK_COOKIE_VALUE}; Path=/; HttpOnly`,
      ),
      '/api/auth/session': sessionValid(),
    });
    const { artifact } = await runConsumerCallbackProbe(validInput(), {
      env: {},
      fetchImpl: fetch,
    });
    assert.equal(artifact.headerPresent, true);
    assert.equal(artifact.authErrorClass, 'NONE');
    assert.equal(artifact.callbackLocationClass, 'ROOT');
    assert.equal(artifact.setCookiePresent, true);
    assert.equal(artifact.sessionState, 'VALID');
  });

  it('upstream-rejected and api-binding-failure classes are distinguished', async () => {
    const upstreamFetch = mockFetch({
      '/api/auth/csrf': csrfOk(),
      '/api/auth/callback/credentials': callbackRedirect(
        `${CONSUMER_URL}/login?error=CallbackRouteError&code=upstream-rejected`,
      ),
      '/api/auth/session': sessionInvalid(),
    });
    const upstream = await runConsumerCallbackProbe(validInput(), {
      env: {},
      fetchImpl: upstreamFetch,
    });
    assert.equal(upstream.artifact.authErrorClass, 'upstream-rejected');

    const bindingFetch = mockFetch({
      '/api/auth/csrf': csrfOk(),
      '/api/auth/callback/credentials': callbackRedirect(
        `${CONSUMER_URL}/login?error=CallbackRouteError&code=api-binding-failure`,
      ),
      '/api/auth/session': sessionInvalid(),
    });
    const binding = await runConsumerCallbackProbe(validInput(), {
      env: {},
      fetchImpl: bindingFetch,
    });
    assert.equal(binding.artifact.authErrorClass, 'api-binding-failure');

    const serverErrorFetch = mockFetch({
      '/api/auth/csrf': csrfOk(),
      '/api/auth/callback/credentials': jsonResponse({ status: 500, body: {} }),
      '/api/auth/session': sessionInvalid(),
    });
    const serverError = await runConsumerCallbackProbe(validInput(), {
      env: {},
      fetchImpl: serverErrorFetch,
    });
    assert.equal(serverError.artifact.authErrorClass, 'api-binding-failure');
  });
});

describe('callback probe fail-closed guards (no callback attempted)', () => {
  it('missing credential source blocks before any network call', async () => {
    const fetch = mockFetch({});
    await assert.rejects(
      runConsumerCallbackProbe(validInput({ e2eSecret: '' }), { env: {}, fetchImpl: fetch }),
      (error) => error.code === 'CREDENTIAL_SOURCE_UNAVAILABLE',
    );
    assert.deepEqual(fetch.paths(), []);
  });

  it('retargeting to another deployment fails with TARGET_BINDING_MOVED', async () => {
    const fetch = mockFetch({});
    await assert.rejects(
      runConsumerCallbackProbe(validInput({ deploymentId: 'dpl_AAAAAAAAAAAAAAAAAAAA' }), {
        env: {},
        fetchImpl: fetch,
      }),
      (error) => error.code === 'TARGET_BINDING_MOVED',
    );
    await assert.rejects(
      runConsumerCallbackProbe(validInput({ expectedSha: 'a'.repeat(40) }), {
        env: {},
        fetchImpl: fetch,
      }),
      (error) => error.code === 'TARGET_BINDING_MOVED',
    );
    assert.deepEqual(fetch.paths(), []);
  });

  it('production targets and missing approval are rejected', async () => {
    const fetch = mockFetch({});
    await assert.rejects(
      runConsumerCallbackProbe(validInput({ consumerUrl: 'https://shop.greenlove.co.kr' }), {
        env: {},
        fetchImpl: fetch,
      }),
      (error) => error.code === 'PRODUCTION_TARGET_REJECTED',
    );
    await assert.rejects(
      runConsumerCallbackProbe(validInput({ approval: 'WRONG' }), {
        env: {},
        fetchImpl: fetch,
      }),
      (error) => error.code === 'MISSING_APPROVAL',
    );
    assert.deepEqual(fetch.paths(), []);
  });

  it('evidence binding mismatch blocks without a network call', async () => {
    const fetch = mockFetch({});
    await assert.rejects(
      runConsumerCallbackProbe(
        validInput({ evidence: validEvidence({ expectedSha: 'b'.repeat(40) }) }),
        { env: {}, fetchImpl: fetch },
      ),
      (error) => error.code === 'EXPECTED_SHA_MISMATCH',
    );
    await assert.rejects(
      runConsumerCallbackProbe(validInput({ evidence: null }), {
        env: {},
        fetchImpl: fetch,
      }),
      (error) => error.code === 'RUNTIME_NOT_BOUND',
    );
    assert.deepEqual(fetch.paths(), []);
  });
});

describe('callback probe pure classifiers and guards', () => {
  it('location classes are ROOT | LOGIN_ERROR | OTHER', () => {
    assert.equal(classifyLocationClass('/'), 'ROOT');
    assert.equal(classifyLocationClass('/login'), 'LOGIN_ERROR');
    assert.equal(classifyLocationClass('/login?error=x'), 'LOGIN_ERROR');
    assert.equal(classifyLocationClass('/orders'), 'OTHER');
  });

  it('auth error classes mirror the runtime gate taxonomy', () => {
    assert.equal(
      classifyAuthError({ status: 302, codeParam: 'authorize-rejected', errorParam: null }),
      'authorize-rejected',
    );
    assert.equal(
      classifyAuthError({ status: 302, codeParam: null, errorParam: 'CredentialsSignin' }),
      'authorize-rejected',
    );
    assert.equal(
      classifyAuthError({ status: 302, codeParam: 'upstream-rejected', errorParam: null }),
      'upstream-rejected',
    );
    assert.equal(
      classifyAuthError({ status: 302, codeParam: 'api-binding-failure', errorParam: null }),
      'api-binding-failure',
    );
    assert.equal(classifyAuthError({ status: 500, codeParam: null, errorParam: null }), 'api-binding-failure');
    assert.equal(classifyAuthError({ status: 302, codeParam: null, errorParam: null }), 'NONE');
    assert.equal(classifyAuthError({ status: 302, codeParam: 'unknown', errorParam: null }), 'other');
  });

  it('production hostnames fail closed', () => {
    assert.equal(isProductionHostname('greenlove.co.kr'), true);
    assert.equal(isProductionHostname('shop.greenlove.co.kr'), true);
    assert.equal(isProductionHostname('api-production-13e7.up.railway.app'), true);
    assert.equal(
      isProductionHostname('greenhubconsumer-2v8t54nvh-jos-projects-d1cecc0c.vercel.app'),
      false,
    );
  });

  it('SHA and deployment ID shapes are enforced', () => {
    assert.equal(assertExpectedSha(LOCKED_SOURCE_SHA), LOCKED_SOURCE_SHA);
    assert.throws(() => assertExpectedSha('xyz'), (error) => error.code === 'EXPECTED_SHA_MALFORMED');
    assert.equal(assertDeploymentId(LOCKED_DEPLOYMENT_ID), LOCKED_DEPLOYMENT_ID);
    assert.throws(() => assertDeploymentId('nope'), (error) => error.code === 'DEPLOYMENT_ID_MALFORMED');
    assert.deepEqual(assertLockedBinding({ deploymentId: LOCKED_DEPLOYMENT_ID, expectedSha: LOCKED_SOURCE_SHA }), {
      deploymentId: LOCKED_DEPLOYMENT_ID,
      expectedSha: LOCKED_SOURCE_SHA,
    });
    assert.throws(
      () => normalizeConsumerUrl('https://greenlove.co.kr'),
      (error) => error.code === 'PRODUCTION_TARGET_REJECTED',
    );
    assert.throws(
      () => validateProbeGuards({ approval: APPROVAL_VALUE, e2eSecret: '', email: 'a', password: 'b' }, {}),
      (error) => error.code === 'CREDENTIAL_SOURCE_UNAVAILABLE',
    );
    assert.deepEqual(
      validateEvidenceBinding({
        expectedSha: LOCKED_SOURCE_SHA,
        deploymentId: LOCKED_DEPLOYMENT_ID,
        consumerUrl: CONSUMER_URL,
        evidence: validEvidence(),
      }),
      { expectedSha: LOCKED_SOURCE_SHA, deploymentId: LOCKED_DEPLOYMENT_ID },
    );
  });
});

describe('callback probe serializer safety (no secret-derived output)', () => {
  it('artifact key set is exactly the non-sensitive allowlist', () => {
    const artifact = buildCallbackArtifact({
      authErrorClass: 'authorize-rejected',
      callbackLocationClass: 'LOGIN_ERROR',
      callbackStatus: 302,
      checkedAt: '2026-09-11T00:00:00.000Z',
      deploymentId: LOCKED_DEPLOYMENT_ID,
      deploymentSourceSha: LOCKED_SOURCE_SHA,
      headerPresent: true,
      sessionState: 'INVALID',
      setCookiePresent: false,
      workflowSourceSha: 'workflow-sha-fixture-16',
    });
    assert.deepEqual(Object.keys(artifact).sort(), [...ARTIFACT_KEYS].sort());
  });

  it('serialized runtime artifact contains no mock secret-derived material', async () => {
    const fetch = mockFetch({
      '/api/auth/csrf': csrfOk(),
      '/api/auth/callback/credentials': callbackRedirect(
        `${CONSUMER_URL}/`,
        `__Secure-authjs.session-token=${MOCK_COOKIE_VALUE}; Path=/; HttpOnly`,
      ),
      '/api/auth/session': sessionValid(),
    });
    const { artifact } = await runConsumerCallbackProbe(validInput(), {
      env: {},
      fetchImpl: fetch,
    });
    const serialized = JSON.stringify(artifact);
    for (const forbidden of [MOCK_SECRET, MOCK_PASSWORD, MOCK_CSRF, MOCK_SESSION_TOKEN, MOCK_COOKIE_VALUE]) {
      assert.ok(!serialized.includes(forbidden), 'artifact must not contain secret-derived material');
    }
    // Forbidden STRUCTURAL keys can never appear (exact allowlist enforced by builder).
    for (const key of [
      'secret',
      'e2eSecret',
      'token',
      'accessToken',
      'refreshToken',
      'csrfToken',
      'cookie',
      'cookies',
      'setCookie',
      'password',
      'email',
      'value',
      'authorization',
    ]) {
      assert.ok(!(key in artifact), `artifact must not contain key: ${key}`);
    }
  });
});
