/**
 * PILOT-AUTH-CONSUMER-CALLBACK dynamic invocation-scoped exact binding
 * deterministic tests (PILOT-AUTH-CALLBACK-DYNAMIC-EXACT-BINDING-CONTRACT-22).
 *
 * Mock/local only: no network, no real secrets, no external mutation. The
 * mock credential values below are synthetic test fixtures — real secret
 * material is never present in this file. Run:
 *   node --test scripts/probe-consumer-callback.spec.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as callbackModule from './probe-consumer-callback.mjs';
import {
  APPROVAL_VALUE,
  ARTIFACT_KEYS,
  CREDENTIAL_SOURCE,
  FAIL_RESULT_KEYS,
  HEADER_NAME,
  PROTECTION_LOCATION_CLASS,
  PROTECTION_PASSAGE_MODE,
  REQUEST_BUILDER,
  RUNNER_ID,
  assertDeploymentId,
  assertExpectedSha,
  assertInvocationBinding,
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
const CONSUMER_URL_B = 'https://greenhubconsumer-9x8y7z6w5v4u3t2s-jos-projects-d1cecc0c.vercel.app';
// Arbitrary invocation-bound fixtures (40-hex lowercase; NOT historical literals).
const DYNAMIC_SHA_1 = '0123456789abcdef0123456789abcdef01234567';
const DYNAMIC_SHA_2 = 'fedcba9876543210fedcba9876543210fedcba98';
const DYNAMIC_SHA_3 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DYNAMIC_DEPLOYMENT_1 = 'dpl_DynamicExactBinding111111';
const DYNAMIC_DEPLOYMENT_2 = 'dpl_DynamicExactBinding222222';
// Historical static-lock values (must NEVER act as binding authority again).
const HISTORICAL_STALE_DEPLOYMENT_ID = 'dpl_B7TCW4CzUgWZv9JTUffMdpjCY7Qd';
const HISTORICAL_STALE_SHA = '67632ede1d7196456bcf1fe5320a7a7e7d509c0c';
const HISTORICAL_STALE_BRANCH = 'tmp/pilot-auth-verifier-cookie-04a-publication-01';
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
    expectedSha: DYNAMIC_SHA_1,
    deploymentShas: { consumer: DYNAMIC_SHA_1 },
    pinnedDeploymentIds: { consumer: DYNAMIC_DEPLOYMENT_1 },
    deploymentTargetUrls: { consumer: CONSUMER_URL },
    ...overrides,
  };
}

function validInput(overrides = {}) {
  return {
    consumerUrl: CONSUMER_URL,
    expectedSha: DYNAMIC_SHA_1,
    deploymentId: DYNAMIC_DEPLOYMENT_1,
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

function evidenceFor({ sha, deploymentId, url } = {}) {
  return validEvidence({
    expectedSha: sha,
    deploymentShas: { consumer: sha },
    pinnedDeploymentIds: { consumer: deploymentId },
    deploymentTargetUrls: { consumer: url },
  });
}

function inputFor({ sha, deploymentId, url, evidence, workflowSha } = {}) {
  return validInput({
    consumerUrl: url ?? CONSUMER_URL,
    expectedSha: sha ?? DYNAMIC_SHA_1,
    deploymentId: deploymentId ?? DYNAMIC_DEPLOYMENT_1,
    evidence: evidence ?? evidenceFor({
      sha: sha ?? DYNAMIC_SHA_1,
      deploymentId: deploymentId ?? DYNAMIC_DEPLOYMENT_1,
      url: url ?? CONSUMER_URL,
    }),
    ...(workflowSha !== undefined ? { workflowSha } : {}),
  });
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
  it('no compile-time historical literal lock exists (static binding removed)', () => {
    assert.equal('LOCKED_DEPLOYMENT_ID' in callbackModule, false);
    assert.equal('LOCKED_SOURCE_SHA' in callbackModule, false);
    assert.equal('LOCKED_BRANCH' in callbackModule, false);
    assert.equal(typeof assertInvocationBinding, 'function');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, 'probe-consumer-callback.mjs'), 'utf8');
    assert.ok(!source.includes('dpl_B7TCW4CzUgWZv9JTUffMdpjCY7Qd'), 'historical deployment literal must be gone');
    assert.ok(!source.includes('67632ede1d7196456bcf1fe5320a7a7e7d509c0c'), 'historical SHA literal must be gone');
    assert.ok(!source.includes('tmp/pilot-auth-verifier-cookie-04a-publication-01'), 'historical branch literal must be gone');
    assert.ok(!/export const LOCKED_/.test(source), 'no LOCKED_* export may remain');
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
    assert.equal(artifact.deploymentId, DYNAMIC_DEPLOYMENT_1);
    assert.equal(artifact.deploymentSourceSha, DYNAMIC_SHA_1);
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

describe('callback invocation-scoped exact binding admission (positive)', () => {
  it('1: arbitrary new SHA with matching evidence passes irrespective of history', async () => {
    const fetch = mockFetch({
      '/api/auth/csrf': csrfOk(),
      '/api/auth/callback/credentials': callbackRedirect(
        `${CONSUMER_URL_B}/login?error=CredentialsSignin&code=authorize-rejected`,
      ),
      '/api/auth/session': sessionInvalid(),
    });
    const input = inputFor({ sha: DYNAMIC_SHA_2, deploymentId: DYNAMIC_DEPLOYMENT_2, url: CONSUMER_URL_B });
    const { artifact } = await runConsumerCallbackProbe(input, { env: {}, fetchImpl: fetch });
    assert.equal(artifact.deploymentSourceSha, DYNAMIC_SHA_2);
    assert.equal(artifact.deploymentId, DYNAMIC_DEPLOYMENT_2);
  });

  it('2: arbitrary new deployment ID matching evidence is allowed', async () => {
    const deploymentId = 'dpl_ArbitraryNewTarget9999999999';
    const fetch = mockFetch({
      '/api/auth/csrf': csrfOk(),
      '/api/auth/callback/credentials': callbackRedirect(`${CONSUMER_URL}/`),
      '/api/auth/session': sessionInvalid(),
    });
    const input = inputFor({ sha: DYNAMIC_SHA_3, deploymentId, url: CONSUMER_URL });
    const { artifact } = await runConsumerCallbackProbe(input, { env: {}, fetchImpl: fetch });
    assert.equal(artifact.deploymentId, deploymentId);
    assert.equal(artifact.deploymentSourceSha, DYNAMIC_SHA_3);
  });

  it('3: workflow source SHA may differ from target SHA when roles are separated', async () => {
    const fetch = mockFetch({
      '/api/auth/csrf': csrfOk(),
      '/api/auth/callback/credentials': callbackRedirect(`${CONSUMER_URL}/`),
      '/api/auth/session': sessionInvalid(),
    });
    const input = inputFor({ sha: DYNAMIC_SHA_1, deploymentId: DYNAMIC_DEPLOYMENT_1, url: CONSUMER_URL });
    input.workflowSha = DYNAMIC_SHA_2;
    assert.notEqual(input.workflowSha, input.expectedSha);
    const { artifact } = await runConsumerCallbackProbe(input, { env: {}, fetchImpl: fetch });
    assert.equal(artifact.deploymentSourceSha, DYNAMIC_SHA_1);
    assert.equal(artifact.workflowSourceSha, DYNAMIC_SHA_2);
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

  it('4: expected SHA != observed deployment SHA fails closed', async () => {
    const fetch = mockFetch({});
    // Requested SHA differs from internally-consistent evidence (DYNAMIC_SHA_1).
    await assert.rejects(
      runConsumerCallbackProbe(
        validInput({ expectedSha: DYNAMIC_SHA_2, evidence: validEvidence() }),
        { env: {}, fetchImpl: fetch },
      ),
      (error) => error.code === 'EXPECTED_SHA_MISMATCH',
    );
    // Evidence whose own deployment SHA disagrees with the invocation SHA.
    const tampered = evidenceFor({
      sha: DYNAMIC_SHA_1,
      deploymentId: DYNAMIC_DEPLOYMENT_1,
      url: CONSUMER_URL,
    });
    tampered.deploymentShas = { consumer: DYNAMIC_SHA_2 };
    await assert.rejects(
      runConsumerCallbackProbe(validInput({ evidence: tampered }), { env: {}, fetchImpl: fetch }),
      (error) => error.code === 'DEPLOYMENT_SHA_MISMATCH',
    );
    assert.deepEqual(fetch.paths(), []);
  });

  it('5: requested deployment ID != observed deployment ID fails closed', async () => {
    const fetch = mockFetch({});
    const evidence = evidenceFor({
      sha: DYNAMIC_SHA_1,
      deploymentId: DYNAMIC_DEPLOYMENT_1,
      url: CONSUMER_URL,
    });
    await assert.rejects(
      runConsumerCallbackProbe(
        validInput({ deploymentId: DYNAMIC_DEPLOYMENT_2, evidence }),
        { env: {}, fetchImpl: fetch },
      ),
      (error) => error.code === 'RUNTIME_BINDING_MISMATCH',
    );
    assert.deepEqual(fetch.paths(), []);
  });

  it('6: consumer URL != exact evidence URL fails closed', async () => {
    const fetch = mockFetch({});
    const evidence = evidenceFor({
      sha: DYNAMIC_SHA_1,
      deploymentId: DYNAMIC_DEPLOYMENT_1,
      url: CONSUMER_URL,
    });
    await assert.rejects(
      runConsumerCallbackProbe(
        validInput({ consumerUrl: CONSUMER_URL_B, evidence }),
        { env: {}, fetchImpl: fetch },
      ),
      (error) => error.code === 'RUNTIME_BINDING_MISMATCH',
    );
    assert.deepEqual(fetch.paths(), []);
  });

  it('7: READY=false (or missing READY proof) sends zero network requests', async () => {
    const fetch = mockFetch({});
    await assert.rejects(
      runConsumerCallbackProbe(
        validInput({ evidence: validEvidence({ ready: false }) }),
        { env: {}, fetchImpl: fetch },
      ),
      (error) => error.code === 'RUNTIME_NOT_BOUND',
    );
    const { ready, ...withoutReady } = validEvidence();
    await assert.rejects(
      runConsumerCallbackProbe(validInput({ evidence: withoutReady }), {
        env: {},
        fetchImpl: fetch,
      }),
      (error) => error.code === 'RUNTIME_NOT_BOUND',
    );
    assert.deepEqual(fetch.paths(), []);
  });

  it('8: production host/target sends zero network requests', async () => {
    const fetch = mockFetch({});
    await assert.rejects(
      runConsumerCallbackProbe(validInput({ consumerUrl: 'https://shop.greenlove.co.kr' }), {
        env: {},
        fetchImpl: fetch,
      }),
      (error) => error.code === 'PRODUCTION_TARGET_REJECTED',
    );
    const prodEvidence = evidenceFor({
      sha: DYNAMIC_SHA_1,
      deploymentId: DYNAMIC_DEPLOYMENT_1,
      url: CONSUMER_URL,
    });
    prodEvidence.deploymentTargetUrls = { consumer: 'https://shop.greenlove.co.kr' };
    await assert.rejects(
      runConsumerCallbackProbe(validInput({ evidence: prodEvidence }), {
        env: {},
        fetchImpl: fetch,
      }),
      (error) => error.code === 'PRODUCTION_TARGET_REJECTED' || error.code === 'RUNTIME_BINDING_MISMATCH',
    );
    assert.deepEqual(fetch.paths(), []);
  });

  it('9: malformed SHA/deployment ID sends zero network requests', async () => {
    const fetch = mockFetch({});
    await assert.rejects(
      runConsumerCallbackProbe(validInput({ expectedSha: 'xyz' }), { env: {}, fetchImpl: fetch }),
      (error) => error.code === 'EXPECTED_SHA_MALFORMED',
    );
    await assert.rejects(
      runConsumerCallbackProbe(validInput({ deploymentId: 'nope' }), { env: {}, fetchImpl: fetch }),
      (error) => error.code === 'DEPLOYMENT_ID_MALFORMED',
    );
    assert.deepEqual(fetch.paths(), []);
  });

  it('10: missing evidence or missing binding fields send zero network requests', async () => {
    const fetch = mockFetch({});
    await assert.rejects(
      runConsumerCallbackProbe(validInput({ evidence: null }), { env: {}, fetchImpl: fetch }),
      (error) => error.code === 'RUNTIME_NOT_BOUND',
    );
    await assert.rejects(
      runConsumerCallbackProbe(validInput({ evidence: {} }), { env: {}, fetchImpl: fetch }),
      (error) => error.code === 'RUNTIME_NOT_BOUND',
    );
    const noPinned = validEvidence();
    delete noPinned.pinnedDeploymentIds;
    await assert.rejects(
      runConsumerCallbackProbe(validInput({ evidence: noPinned }), { env: {}, fetchImpl: fetch }),
      (error) => error.code === 'RUNTIME_NOT_BOUND',
    );
    const noTargets = validEvidence();
    delete noTargets.deploymentTargetUrls;
    await assert.rejects(
      runConsumerCallbackProbe(validInput({ evidence: noTargets }), { env: {}, fetchImpl: fetch }),
      (error) => error.code === 'RUNTIME_NOT_BOUND',
    );
    const noShas = validEvidence();
    delete noShas.deploymentShas;
    await assert.rejects(
      runConsumerCallbackProbe(validInput({ evidence: noShas }), { env: {}, fetchImpl: fetch }),
      (error) => error.code === 'DEPLOYMENT_SHA_MISMATCH',
    );
    assert.deepEqual(fetch.paths(), []);
  });

  it('11: historical stale deployment ID mismatching current evidence fails closed', async () => {
    const fetch = mockFetch({});
    await assert.rejects(
      runConsumerCallbackProbe(
        validInput({ deploymentId: HISTORICAL_STALE_DEPLOYMENT_ID }),
        { env: {}, fetchImpl: fetch },
      ),
      (error) => error.code === 'RUNTIME_BINDING_MISMATCH',
    );
    await assert.rejects(
      runConsumerCallbackProbe(
        validInput({ expectedSha: HISTORICAL_STALE_SHA }),
        { env: {}, fetchImpl: fetch },
      ),
      (error) => error.code === 'EXPECTED_SHA_MISMATCH',
    );
    assert.deepEqual(fetch.paths(), []);
  });

  it('12: branch/ref alone never substitutes for the exact SHA', async () => {
    const fetch = mockFetch({});
    const branchOnly = {
      ready: true,
      expectedSha: DYNAMIC_SHA_1,
      branch: 'main',
      ref: 'refs/heads/main',
      sourceBranch: HISTORICAL_STALE_BRANCH,
    };
    await assert.rejects(
      runConsumerCallbackProbe(validInput({ evidence: branchOnly }), {
        env: {},
        fetchImpl: fetch,
      }),
      (error) => error.code === 'DEPLOYMENT_SHA_MISMATCH' || error.code === 'RUNTIME_NOT_BOUND',
    );
    assert.deepEqual(
      validateEvidenceBinding({
        expectedSha: DYNAMIC_SHA_1,
        deploymentId: DYNAMIC_DEPLOYMENT_1,
        consumerUrl: CONSUMER_URL,
        evidence: validEvidence(),
      }),
      { expectedSha: DYNAMIC_SHA_1, deploymentId: DYNAMIC_DEPLOYMENT_1 },
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
    assert.equal(assertExpectedSha(DYNAMIC_SHA_1), DYNAMIC_SHA_1);
    assert.throws(() => assertExpectedSha('xyz'), (error) => error.code === 'EXPECTED_SHA_MALFORMED');
    assert.equal(assertDeploymentId(DYNAMIC_DEPLOYMENT_1), DYNAMIC_DEPLOYMENT_1);
    assert.throws(() => assertDeploymentId('nope'), (error) => error.code === 'DEPLOYMENT_ID_MALFORMED');
    assert.deepEqual(assertInvocationBinding({ deploymentId: DYNAMIC_DEPLOYMENT_1, expectedSha: DYNAMIC_SHA_1 }), {
      deploymentId: DYNAMIC_DEPLOYMENT_1,
      expectedSha: DYNAMIC_SHA_1,
    });
    assert.deepEqual(assertInvocationBinding({ deploymentId: DYNAMIC_DEPLOYMENT_2, expectedSha: DYNAMIC_SHA_2 }), {
      deploymentId: DYNAMIC_DEPLOYMENT_2,
      expectedSha: DYNAMIC_SHA_2,
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
        expectedSha: DYNAMIC_SHA_1,
        deploymentId: DYNAMIC_DEPLOYMENT_1,
        consumerUrl: CONSUMER_URL,
        evidence: validEvidence(),
      }),
      { expectedSha: DYNAMIC_SHA_1, deploymentId: DYNAMIC_DEPLOYMENT_1 },
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
      deploymentId: DYNAMIC_DEPLOYMENT_1,
      deploymentSourceSha: DYNAMIC_SHA_1,
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
    assert.equal(extractObservedDeploymentSha(validEvidence()), DYNAMIC_SHA_1);
    assert.equal(extractDeploymentReady(validEvidence()), true);
    assert.equal(classifyFailureLocation({ locationValue: null, base: CONSUMER_URL, isProtection: false }), 'NONE');
  });
});
