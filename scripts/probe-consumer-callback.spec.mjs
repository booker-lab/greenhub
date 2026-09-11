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
  FAIL_RESULT_KEYS,
  HEADER_NAME,
  LOCKED_BRANCH,
  LOCKED_DEPLOYMENT_ID,
  LOCKED_SOURCE_SHA,
  PROTECTION_LOCATION_CLASS,
  PROTECTION_PASSAGE_MODE,
  REQUEST_BUILDER,
  RUNNER_ID,
  assertDeploymentId,
  assertExpectedSha,
  assertLockedBinding,
  buildCallbackArtifact,
  buildFailureResult,
  classifyAuthError,
  classifyFailureLocation,
  classifyLocationClass,
  extractDeploymentReady,
  extractObservedDeploymentSha,
  isProductionHostname,
  isProtectionIntercept,
  isProtectionResponse,
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

describe('callback FAIL evidence preservation (PILOT-AUTH-CALLBACK-FAIL-19)', () => {
  const PROTECTION_LOCATION = 'https://vercel.com/sso-api?nonce=fixture-nonce-19&token=fixture-token-19';
  const PROTECTION_QUERY = 'nonce=fixture-nonce-19';

  function protectionHeaders(location) {
    return fakeHeaders({ Location: location, 'Content-Type': 'text/plain; charset=utf-8' });
  }

  function appRedirectHeaders(location) {
    return fakeHeaders({ Location: location });
  }

  async function captureFailure(input, fetch) {
    try {
      await runConsumerCallbackProbe(input, { env: {}, fetchImpl: fetch });
      assert.fail('expected probe to FAIL but it succeeded');
    } catch (error) {
      assert.ok(error && typeof error === 'object', 'failure must throw an error object');
      assert.ok(error.evidence && typeof error.evidence === 'object', 'FAIL must carry closed evidence');
      return { error, evidence: error.evidence };
    }
    throw new Error('unreachable');
  }

  it('1: 302 text/plain + vercel.com/sso-api is DEPLOYMENT_PROTECTION_INTERCEPTED', async () => {
    assert.equal(
      isProtectionIntercept({
        status: 302,
        contentType: 'text/plain; charset=utf-8',
        locationValue: PROTECTION_LOCATION,
        base: CONSUMER_URL,
      }),
      true,
    );
    const fetch = mockFetch({
      '/api/auth/csrf': jsonResponse({
        status: 302,
        body: {},
        headers: protectionHeaders(PROTECTION_LOCATION),
      }),
      '/api/auth/callback/credentials': callbackRedirect(`${CONSUMER_URL}/`),
      '/api/auth/session': sessionInvalid(),
    });
    const { error, evidence } = await captureFailure(validInput(), fetch);
    assert.equal(error.code, 'DEPLOYMENT_PROTECTION_INTERCEPTED');
    assert.equal(evidence.result, 'FAIL');
    assert.equal(evidence.failureCode, 'DEPLOYMENT_PROTECTION_INTERCEPTED');
    assert.equal(evidence.failureStage, 'csrf');
    assert.equal(evidence.csrfStatus, 302);
    assert.equal(evidence.httpStatus, 302);
    assert.equal(evidence.locationClass, PROTECTION_LOCATION_CLASS);
    assert.equal(evidence.callbackLocationClass, PROTECTION_LOCATION_CLASS);
    assert.equal(evidence.authErrorClass, 'NONE');
    assert.equal(evidence.protectionPassageMode, 'NONE');
    assert.equal(evidence.callbackAttempted, false);
    assert.equal(evidence.sessionAttempted, false);
    assert.equal(evidence.headerConfigured, true);
    assert.equal(evidence.headerAttachedByRunner, true);
    assert.equal(evidence.runner, RUNNER_ID);
    // Raw location query / nonce must never be stored.
    const serialized = JSON.stringify(evidence);
    assert.ok(!serialized.includes('vercel.com/sso-api?'), 'raw Location URL must not be stored');
    assert.ok(!serialized.includes(PROTECTION_QUERY), 'raw Location query/nonce must not be stored');
    assert.ok(!serialized.includes(MOCK_SECRET), 'secret must not be stored');
  });

  it('1b: callback-stage protection is DEPLOYMENT_PROTECTION_INTERCEPTED with callbackAttempted=true', async () => {
    const fetch = mockFetch({
      '/api/auth/csrf': csrfOk(),
      '/api/auth/callback/credentials': jsonResponse({
        status: 302,
        body: {},
        headers: protectionHeaders(PROTECTION_LOCATION),
      }),
      '/api/auth/session': sessionInvalid(),
    });
    const { error, evidence } = await captureFailure(validInput(), fetch);
    assert.equal(error.code, 'DEPLOYMENT_PROTECTION_INTERCEPTED');
    assert.equal(evidence.failureStage, 'callback');
    assert.equal(evidence.callbackStatus, 302);
    assert.equal(evidence.httpStatus, 302);
    assert.equal(evidence.locationClass, PROTECTION_LOCATION_CLASS);
    assert.equal(evidence.authErrorClass, 'NONE');
    assert.equal(evidence.callbackAttempted, true);
    assert.equal(evidence.sessionAttempted, false);
    assert.equal(evidence.protectionPassageMode, 'NONE');
  });

  it('2: normal application redirect is not protection intercept', async () => {
    assert.equal(
      isProtectionIntercept({
        status: 302,
        contentType: '',
        locationValue: `${CONSUMER_URL}/login?error=CredentialsSignin&code=authorize-rejected`,
        base: CONSUMER_URL,
      }),
      false,
    );
    assert.equal(
      isProtectionIntercept({
        status: 302,
        contentType: 'text/html',
        locationValue: PROTECTION_LOCATION,
        base: CONSUMER_URL,
      }),
      false,
    );
    assert.equal(
      isProtectionResponse({
        status: 302,
        headers: appRedirectHeaders(`${CONSUMER_URL}/login?error=CredentialsSignin`),
        locationValue: null,
        base: CONSUMER_URL,
      }),
      false,
    );
    // Application rejection stays SUCCESS with Auth.js taxonomy (not protection FAIL).
    const fetch = mockFetch({
      '/api/auth/csrf': csrfOk(),
      '/api/auth/callback/credentials': callbackRedirect(
        `${CONSUMER_URL}/login?error=CredentialsSignin&code=authorize-rejected`,
      ),
      '/api/auth/session': sessionInvalid(),
    });
    const { artifact } = await runConsumerCallbackProbe(validInput(), {
      env: {},
      fetchImpl: fetch,
    });
    assert.equal(artifact.authErrorClass, 'authorize-rejected');
    assert.equal(artifact.callbackLocationClass, 'LOGIN_ERROR');
    assert.equal(artifact.callbackStatus, 302);
  });

  it('3: CSRF transport failure preserves csrf stage/code without callback attempt', async () => {
    // Null transport (fetch throws -> null).
    const nullFetch = mockFetch({
      '/api/auth/csrf': () => {
        throw new Error('mock csrf transport down');
      },
    });
    const nullFailure = await captureFailure(validInput(), nullFetch);
    assert.equal(nullFailure.error.code, 'CSRF_TRANSPORT_FAILED');
    assert.equal(nullFailure.evidence.failureStage, 'csrf');
    assert.equal(nullFailure.evidence.failureCode, 'CSRF_TRANSPORT_FAILED');
    assert.equal(nullFailure.evidence.callbackAttempted, false);
    assert.equal(nullFailure.evidence.sessionAttempted, false);
    assert.equal(nullFailure.evidence.headerAttachedByRunner, true);
    assert.equal(nullFailure.evidence.protectionPassageMode, 'NONE');

    // Non-2xx CSRF (protection already excluded).
    const badStatusFetch = mockFetch({
      '/api/auth/csrf': jsonResponse({ status: 500, body: {} }),
    });
    const badStatus = await captureFailure(validInput(), badStatusFetch);
    assert.equal(badStatus.error.code, 'CSRF_TRANSPORT_FAILED');
    assert.equal(badStatus.evidence.csrfStatus, 500);
    assert.equal(badStatus.evidence.httpStatus, 500);

    // Missing csrfToken.
    const missingTokenFetch = mockFetch({
      '/api/auth/csrf': jsonResponse({ status: 200, body: {} }),
    });
    const missingToken = await captureFailure(validInput(), missingTokenFetch);
    assert.equal(missingToken.error.code, 'CSRF_TRANSPORT_FAILED');
    assert.equal(missingToken.evidence.failureStage, 'csrf');
  });

  it('4: callback transport failure preserves callbackAttempted=true', async () => {
    const fetch = mockFetch({
      '/api/auth/csrf': csrfOk(),
      '/api/auth/callback/credentials': () => {
        throw new Error('mock callback transport down');
      },
    });
    const { error, evidence } = await captureFailure(validInput(), fetch);
    assert.equal(error.code, 'CALLBACK_TRANSPORT_FAILED');
    assert.equal(evidence.failureCode, 'CALLBACK_TRANSPORT_FAILED');
    assert.equal(evidence.failureStage, 'callback');
    assert.equal(evidence.callbackAttempted, true);
    assert.equal(evidence.sessionAttempted, false);
    assert.equal(evidence.callbackStatus, null);
    assert.equal(evidence.csrfStatus, 200);
    assert.equal(evidence.httpStatus, null);
    assert.equal(evidence.headerConfigured, true);
    assert.equal(evidence.headerAttachedByRunner, true);
    assert.equal(evidence.protectionPassageMode, 'NONE');
  });

  it('5: callback rejection is distinguished from transport failure', async () => {
    // Transport failure (no application response).
    const transportFetch = mockFetch({
      '/api/auth/csrf': csrfOk(),
      '/api/auth/callback/credentials': () => {
        throw new Error('mock down');
      },
    });
    const transport = await captureFailure(validInput(), transportFetch);
    assert.equal(transport.evidence.failureCode, 'CALLBACK_TRANSPORT_FAILED');

    // Application rejection SUCCESS (302 LOGIN_ERROR) is not transport FAIL.
    const rejectionFetch = mockFetch({
      '/api/auth/csrf': csrfOk(),
      '/api/auth/callback/credentials': callbackRedirect(
        `${CONSUMER_URL}/login?error=CredentialsSignin&code=authorize-rejected`,
      ),
      '/api/auth/session': sessionInvalid(),
    });
    const { artifact } = await runConsumerCallbackProbe(validInput(), {
      env: {},
      fetchImpl: rejectionFetch,
    });
    assert.equal(artifact.authErrorClass, 'authorize-rejected');
    assert.equal(artifact.callbackStatus, 302);

    // Explicit 401 application rejection is CALLBACK_REJECTED FAIL (stage callback).
    const rejectedFetch = mockFetch({
      '/api/auth/csrf': csrfOk(),
      '/api/auth/callback/credentials': jsonResponse({ status: 401, body: {} }),
    });
    const rejected = await captureFailure(validInput(), rejectedFetch);
    assert.equal(rejected.error.code, 'CALLBACK_REJECTED');
    assert.equal(rejected.evidence.failureStage, 'callback');
    assert.equal(rejected.evidence.callbackStatus, 401);
    assert.equal(rejected.evidence.callbackAttempted, true);
    assert.notEqual(rejected.evidence.failureCode, transport.evidence.failureCode);
  });

  it('6: session-stage failure preserves sessionAttempted and callback evidence', async () => {
    const fetch = mockFetch({
      '/api/auth/csrf': csrfOk(),
      '/api/auth/callback/credentials': callbackRedirect(`${CONSUMER_URL}/`),
      '/api/auth/session': () => {
        throw new Error('mock session transport down');
      },
    });
    const { error, evidence } = await captureFailure(validInput(), fetch);
    assert.equal(error.code, 'SESSION_READ_FAILED');
    assert.equal(evidence.failureCode, 'SESSION_READ_FAILED');
    assert.equal(evidence.failureStage, 'session');
    assert.equal(evidence.sessionAttempted, true);
    assert.equal(evidence.callbackAttempted, true);
    assert.equal(evidence.callbackStatus, 302);
    assert.equal(evidence.csrfStatus, 200);
    assert.equal(evidence.sessionState, 'NOT_CHECKED');
    assert.equal(evidence.protectionPassageMode, 'NONE');
  });

  it('7b: FAIL result key set is exactly the closed allowlist', () => {
    const failure = buildFailureResult({
      failureCode: 'CSRF_TRANSPORT_FAILED',
      failureStage: 'csrf',
      csrfStatus: 500,
      httpStatus: 500,
      checkedAt: '2026-09-11T00:00:00.000Z',
      workflowSourceSha: 'workflow-sha-fixture-19',
      message: 'fixture',
    });
    assert.deepEqual(Object.keys(failure).sort(), [...FAIL_RESULT_KEYS].sort());
    assert.equal(failure.result, 'FAIL');
    assert.equal(failure.runner, RUNNER_ID);
    assert.equal(failure.protectionPassageMode, 'NONE');
    assert.equal(failure.protectionPassageMode, PROTECTION_PASSAGE_MODE);
  });

  it('8: FAIL JSON exposes no secret/cookie/nonce/raw-location material', async () => {
    const secretCookie = `__Secure-authjs.session-token=${MOCK_COOKIE_VALUE}; Path=/; HttpOnly`;
    const fetch = mockFetch({
      '/api/auth/csrf': csrfOk(),
      '/api/auth/callback/credentials': jsonResponse({
        status: 302,
        body: {},
        headers: protectionHeaders(PROTECTION_LOCATION),
      }),
      '/api/auth/session': sessionInvalid(),
    });
    // Use a distinct cookie-carrying success path for the negative check as well.
    const successFetch = mockFetch({
      '/api/auth/csrf': csrfOk(),
      '/api/auth/callback/credentials': callbackRedirect(`${CONSUMER_URL}/`, secretCookie),
      '/api/auth/session': sessionValid(),
    });
    const { artifact } = await runConsumerCallbackProbe(validInput(), {
      env: {},
      fetchImpl: successFetch,
    });
    assert.ok(!JSON.stringify(artifact).includes(MOCK_COOKIE_VALUE));
    const { evidence } = await captureFailure(validInput(), fetch);
    const serialized = JSON.stringify(evidence);
    for (const forbidden of [
      MOCK_SECRET,
      MOCK_PASSWORD,
      MOCK_CSRF,
      MOCK_SESSION_TOKEN,
      MOCK_COOKIE_VALUE,
      PROTECTION_QUERY,
      'fixture-nonce-19',
      'fixture-token-19',
    ]) {
      assert.ok(!serialized.includes(forbidden), `FAIL must not contain ${forbidden.slice(0, 20)}`);
    }
    for (const key of [
      'secret',
      'e2eSecret',
      'authorization',
      'cookie',
      'cookies',
      'setCookie',
      'csrfToken',
      'nonce',
      'password',
      'email',
      'accessToken',
    ]) {
      assert.ok(!(key in evidence), `FAIL must not contain key: ${key}`);
    }
    // Location class only, never raw query.
    assert.equal(evidence.locationClass, PROTECTION_LOCATION_CLASS);
  });

  it('9: existing success evidence contract is preserved', async () => {
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
    assert.deepEqual(Object.keys(artifact).sort(), [...ARTIFACT_KEYS].sort());
    assert.equal(artifact.credentialSource, 'E2E_TEST_SECRET');
    assert.equal(artifact.headerName, 'x-e2e-test-token');
    assert.equal(artifact.headerPresent, true);
    assert.equal(artifact.callbackStatus, 302);
    assert.equal(artifact.callbackLocationClass, 'LOGIN_ERROR');
    assert.equal(artifact.authErrorClass, 'authorize-rejected');
    assert.equal(artifact.sessionState, 'INVALID');
    assert.deepEqual(calls, ['/api/auth/csrf', '/api/auth/callback/credentials', '/api/auth/session']);
    assert.equal(extractObservedDeploymentSha(validEvidence()), LOCKED_SOURCE_SHA);
    assert.equal(extractDeploymentReady(validEvidence()), true);
    assert.equal(classifyFailureLocation({ locationValue: null, base: CONSUMER_URL, isProtection: false }), 'NONE');
  });
});
