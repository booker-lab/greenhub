/**
 * PILOT-AUTH-CONSUMER-CALLBACK-INPUT-BINDING-PROOF-16 — locked Consumer
 * Preview deployment NextAuth credentials callback provenance probe.
 *
 * Purpose (CASE B1 closeout):
 *   Prove, at runtime, whether the locked Consumer Preview deployment's
 *   NextAuth credentials callback request was actually constructed with the
 *   approved E2E_TEST_SECRET input as the `x-e2e-test-token` header, and how
 *   far that request progressed through the runtime gate. The callback gate
 *   itself is used as the opaque equality proof — secret plaintext, value,
 *   hash, fingerprint, prefix/suffix, and length are NEVER accessed for
 *   output, comparison logging, or diagnostics.
 *
 * What this probe does (callback path only, never the direct API path):
 *   1. Fail-closed guards BEFORE any network call (approval, production
 *      target, locked deployment/branch/SHA binding, evidence binding,
 *      credential-source presence).
 *   2. GET  /api/auth/csrf with the constructed header (provenance recorded
 *      as headerName/headerPresent BEFORE the request is sent).
 *   3. POST /api/auth/callback/credentials with the same header object
 *      (manual redirect: the 302 Location / JSON url is classified, never
 *      followed blindly and never logged).
 *   4. GET  /api/auth/session with the same in-memory cookie jar
 *      (Set-Cookie values never leave memory; only presence is recorded).
 *
 * Non-sensitive evidence ONLY (structurally fixed key set — see
 * buildCallbackArtifact; the serializer cannot emit secret-derived keys):
 *   requestBuilder, credentialSource, headerName, headerPresent,
 *   callbackStatus, callbackLocationClass, authErrorClass, setCookiePresent,
 *   sessionState, deploymentId, deploymentSourceSha, workflowSourceSha.
 *
 * Exit codes: 0 whenever the callback path was executed and a sanitized
 * artifact was produced (ANY gate outcome is adjudicable evidence);
 * 1 only on fail-closed contract violations (no callback attempted).
 *
 * Usage (real run — via the approved workflow with Environment-injected
 * secrets; never pass secrets as CLI literals):
 *   node scripts/probe-consumer-callback.mjs \
 *     --expected-sha=<40hex> \
 *     --consumer-url=https://<locked-consumer-preview> \
 *     --consumer-deployment-id=dpl_... \
 *     --evidence-json=.artifacts/.../probe-evidence.json \
 *     --approval=NON_PRODUCTION_AUTH_PROBE_APPROVED
 *
 * Secrets come from env (never logged, never serialized):
 *   E2E_TEST_SECRET, TEST_CONSUMER_EMAIL, TEST_CONSUMER_PASSWORD
 */

export const APPROVAL_VALUE = 'NON_PRODUCTION_AUTH_PROBE_APPROVED';

export const HEADER_NAME = 'x-e2e-test-token';
export const CREDENTIAL_SOURCE = 'E2E_TEST_SECRET';
export const REQUEST_BUILDER =
  'scripts/probe-consumer-callback.mjs#runConsumerCallbackProbe';

// Locked runtime target (CASE B1 canonical input). Requests to any other
// deployment/branch/SHA fail closed with TARGET_BINDING_MOVED — the callback
// is never retargeted to a different deployment.
export const LOCKED_DEPLOYMENT_ID = 'dpl_B7TCW4CzUgWZv9JTUffMdpjCY7Qd';
export const LOCKED_SOURCE_SHA = '67632ede1d7196456bcf1fe5320a7a7e7d509c0c';
export const LOCKED_BRANCH = 'tmp/pilot-auth-verifier-cookie-04a-publication-01';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;

const KNOWN_AUTH_ERROR_CLASSES = Object.freeze([
  'authorize-rejected',
  'upstream-rejected',
  'api-binding-failure',
]);

// Exact sanitized artifact key set. buildCallbackArtifact() can only produce
// these keys — secret/token/cookie values are structurally unrepresentable.
export const ARTIFACT_KEYS = Object.freeze([
  'artifact',
  'authErrorClass',
  'callbackLocationClass',
  'callbackStatus',
  'checkedAt',
  'credentialSource',
  'deploymentId',
  'deploymentSourceSha',
  'headerName',
  'headerPresent',
  'requestBuilder',
  'runner',
  'sessionState',
  'setCookiePresent',
  'workflowSourceSha',
]);

export class CallbackProbeContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CallbackProbeContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new CallbackProbeContractError(code, message);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function assertExpectedSha(value) {
  if (!isNonEmptyString(value)) {
    fail('EXPECTED_SHA_REQUIRED', 'expected SHA가 없습니다. --expected-sha=<40hex>가 필요합니다.');
  }
  const normalized = String(value).trim().toLowerCase();
  if (!SHA_PATTERN.test(normalized)) {
    fail('EXPECTED_SHA_MALFORMED', 'expected SHA 형식이 올바르지 않습니다 (40자리 소문자 16진수).');
  }
  return normalized;
}

export function assertDeploymentId(value) {
  if (!isNonEmptyString(value) || !DEPLOYMENT_ID_PATTERN.test(String(value).trim())) {
    fail('DEPLOYMENT_ID_MALFORMED', 'pinned Vercel deployment ID 형식이 올바르지 않습니다.');
  }
  return String(value).trim();
}

function hostnameOf(urlString) {
  try {
    return new URL(urlString).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isProductionHostname(hostname) {
  const host = String(hostname ?? '').toLowerCase();
  if (!host) return true; // unparseable -> fail closed as production-like
  if (host === 'greenlove.co.kr' || host.endsWith('.greenlove.co.kr')) return true;
  if (host.startsWith('api-production-')) return true;
  if (host === 'api-production-13e7.up.railway.app') return true;
  return false;
}

export function normalizeConsumerUrl(value) {
  if (!isNonEmptyString(value)) {
    fail('RUNTIME_NOT_BOUND', 'consumer URL이 없어 runtime binding을 증명할 수 없습니다.');
  }
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    fail('RUNTIME_NOT_BOUND', 'consumer URL 형식이 올바르지 않아 runtime binding을 거부합니다.');
  }
  if (url.username || url.password || url.search || url.hash) {
    fail('RUNTIME_NOT_BOUND', 'consumer URL에 인증정보/query/fragment가 있어 binding을 거부합니다.');
  }
  const isLoopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (!isLoopback && url.protocol !== 'https:') {
    fail('RUNTIME_NOT_BOUND', 'consumer URL은 loopback이 아니면 https만 허용합니다.');
  }
  if (isProductionHostname(url.hostname)) {
    fail('PRODUCTION_TARGET_REJECTED', 'consumer target이 운영 호스트이므로 차단합니다.');
  }
  if (!url.hostname.endsWith('.vercel.app')) {
    fail('RUNTIME_NOT_BOUND', 'consumer target이 locked Preview deployment 호스트가 아닙니다.');
  }
  return url.toString().replace(/\/$/, '');
}

/**
 * Locked-target pinning: the probe may only address the CASE B1 locked
 * deployment/source. Anything else fails closed without a network call.
 */
export function assertLockedBinding({ deploymentId, expectedSha }) {
  const id = assertDeploymentId(deploymentId);
  const sha = assertExpectedSha(expectedSha);
  if (id !== LOCKED_DEPLOYMENT_ID || sha !== LOCKED_SOURCE_SHA) {
    fail(
      'TARGET_BINDING_MOVED',
      'locked runtime target 바인딩과 달라 callback을 다른 배포로 대체하지 않습니다.',
    );
  }
  return { deploymentId: id, expectedSha: sha };
}

/**
 * Evidence binding (consumer slice of wait-preview-deploy JSON): the pinned
 * deployment id + expected SHA + target URL must all agree before any
 * network call.
 */
export function validateEvidenceBinding({ expectedSha, deploymentId, consumerUrl, evidence }) {
  const sha = assertExpectedSha(expectedSha);
  const id = assertDeploymentId(deploymentId);
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    fail('RUNTIME_NOT_BOUND', 'runtime binding evidence가 없어 실행을 차단합니다.');
  }
  if (evidence.ready === false) {
    fail('RUNTIME_NOT_BOUND', 'binding evidence가 ready 상태가 아닙니다.');
  }
  const evidenceSha = String(evidence.expectedSha ?? '').trim().toLowerCase();
  if (evidenceSha !== sha) {
    fail('EXPECTED_SHA_MISMATCH', 'binding evidence SHA가 --expected-sha와 다릅니다.');
  }
  const shas = evidence.deploymentShas ?? evidence.statusShas ?? {};
  if (shas.consumer !== sha) {
    fail('DEPLOYMENT_SHA_MISMATCH', 'consumer 배포 SHA가 지정 SHA와 일치하지 않습니다.');
  }
  const pinned =
    evidence.pinnedDeploymentIds ?? evidence.deploymentIds ?? evidence.pinnedDeploymentIDs ?? {};
  const pinnedConsumer = pinned.consumer ?? evidence.consumerDeploymentId ?? '';
  if (isNonEmptyString(pinnedConsumer) && String(pinnedConsumer).trim() !== id) {
    fail('RUNTIME_BINDING_MISMATCH', 'consumer deployment ID가 evidence binding과 다릅니다.');
  }
  const targets = evidence.deploymentTargetUrls ?? evidence.statusTargetUrls ?? evidence.targetUrls ?? {};
  if (isNonEmptyString(targets.consumer)) {
    const observed = normalizeConsumerUrl(targets.consumer);
    if (observed !== consumerUrl) {
      fail('RUNTIME_BINDING_MISMATCH', 'consumer target이 evidence binding과 다릅니다.');
    }
  }
  return { expectedSha: sha, deploymentId: id };
}

export function validateProbeGuards(input = {}, env = process.env) {
  const approval = String(input.approval ?? env.NON_PRODUCTION_AUTH_PROBE_APPROVAL ?? '').trim();
  if (approval !== APPROVAL_VALUE) {
    fail('MISSING_APPROVAL', 'explicit non-production approval이 없어 실행을 차단합니다.');
  }
  const e2eSecret = input.e2eSecret ?? env.E2E_TEST_SECRET ?? '';
  if (!isNonEmptyString(e2eSecret)) {
    fail(
      'CREDENTIAL_SOURCE_UNAVAILABLE',
      'header를 구성할 승인된 E2E_TEST_SECRET input이 없어 callback을 시도하지 않습니다.',
    );
  }
  const email = input.email ?? env.TEST_CONSUMER_EMAIL ?? '';
  const password = input.password ?? env.TEST_CONSUMER_PASSWORD ?? '';
  if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
    fail('CONSUMER_CREDENTIALS_MISSING', 'consumer test credential이 없어 실행을 차단합니다.');
  }
  return { approval };
}

// ---- Safe classifiers (pure, no network) -----------------------------------

/** Location path class for the callback redirect target. */
export function classifyLocationClass(pathname) {
  if (pathname === '/' || pathname === '') return 'ROOT';
  if (typeof pathname === 'string' && pathname.startsWith('/login')) return 'LOGIN_ERROR';
  return 'OTHER';
}

/**
 * Mirror of the runtime gate taxonomy (apps/consumer/src/auth.ts +
 * loginViaCredentials category mapping), over non-sensitive inputs only:
 * numeric status + whitelisted error/code params.
 */
export function classifyAuthError({ status, codeParam, errorParam }) {
  if (KNOWN_AUTH_ERROR_CLASSES.includes(codeParam)) return codeParam;
  if (codeParam === 'unknown') return 'other';
  if (codeParam != null) return 'other';
  if (errorParam === 'CredentialsSignin' || errorParam === 'CallbackRouteError') {
    return 'authorize-rejected';
  }
  if (errorParam != null && errorParam !== 'unknown') return 'other';
  if (typeof status === 'number' && status >= 500) return 'api-binding-failure';
  if (errorParam === 'unknown') return 'other';
  return 'NONE';
}

function safeCodeParam(value) {
  if (typeof value !== 'string' || !value) return null;
  if (KNOWN_AUTH_ERROR_CLASSES.includes(value)) return value;
  return 'unknown';
}

function safeErrorParam(value) {
  if (typeof value !== 'string' || !value) return null;
  if (value === 'CredentialsSignin' || value === 'CallbackRouteError') return value;
  if (value === 'AccessDenied' || value === 'MissingCSRF') return value;
  return 'unknown';
}

function parseLocationEvidence(location, base) {
  if (typeof location !== 'string' || !location.trim()) {
    return { locationClass: 'OTHER', codeParam: null, errorParam: null };
  }
  try {
    const url = new URL(location, base);
    return {
      locationClass: classifyLocationClass(url.pathname || '/'),
      codeParam: safeCodeParam(url.searchParams.get('code')),
      errorParam: safeErrorParam(url.searchParams.get('error')),
    };
  } catch {
    return { locationClass: 'OTHER', codeParam: null, errorParam: null };
  }
}

// ---- In-memory cookie jar (values never emitted) ----------------------------

function readSetCookieHeaders(headers) {
  if (!headers) return [];
  if (typeof headers.getSetCookie === 'function') {
    const values = headers.getSetCookie();
    return Array.isArray(values) ? values.filter((v) => typeof v === 'string') : [];
  }
  if (typeof headers.raw === 'function') {
    const raw = headers.raw()['set-cookie'];
    if (Array.isArray(raw)) return raw.filter((v) => typeof v === 'string');
  }
  if (typeof headers.get === 'function') {
    const single = headers.get('set-cookie');
    if (typeof single === 'string' && single) return [single];
  }
  if (Array.isArray(headers)) {
    return headers
      .filter((entry) => Array.isArray(entry) && String(entry[0]).toLowerCase() === 'set-cookie')
      .map((entry) => String(entry[1]));
  }
  return [];
}

function storeCookies(jar, headers) {
  for (const line of readSetCookieHeaders(headers)) {
    const pair = String(line).split(';', 1)[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq > 0) {
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name) jar.set(name, value);
    }
  }
}

function jarCookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function parseJsonBody(value) {
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Exact sanitized artifact builder. Only ARTIFACT_KEYS can appear in the
 * output — there is no parameter, code path, or spread through which a
 * secret/token/cookie value could enter the artifact.
 */
export function buildCallbackArtifact(fields) {
  const artifact = {
    artifact: 'pilot-auth-consumer-callback-input-binding-proof-16',
    authErrorClass: fields.authErrorClass,
    callbackLocationClass: fields.callbackLocationClass,
    callbackStatus: fields.callbackStatus,
    checkedAt: fields.checkedAt,
    credentialSource: CREDENTIAL_SOURCE,
    deploymentId: fields.deploymentId,
    deploymentSourceSha: fields.deploymentSourceSha,
    headerName: HEADER_NAME,
    headerPresent: fields.headerPresent,
    requestBuilder: REQUEST_BUILDER,
    runner: 'PILOT-AUTH-CONSUMER-CALLBACK-PROBE-16',
    sessionState: fields.sessionState,
    setCookiePresent: fields.setCookiePresent,
    workflowSourceSha: fields.workflowSourceSha,
  };
  const keys = Object.keys(artifact).sort();
  const expected = [...ARTIFACT_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail('PROBE_INTERNAL_ERROR', 'sanitized artifact key set이 고정 계약과 다릅니다.');
  }
  return artifact;
}

/**
 * One callback provenance lifecycle against the locked Consumer deployment:
 * CSRF -> credentials callback POST -> same-jar session readback.
 *
 * fetchImpl is injectable (mock in tests, global fetch in real runs with
 * redirect:'manual' enforced below). Returns { artifact, calls } where calls
 * is the non-sensitive list of request paths (direct-API confusion check).
 */
export async function runConsumerCallbackProbe(
  {
    consumerUrl,
    expectedSha,
    deploymentId,
    evidence,
    e2eSecret,
    email,
    password,
    approval,
    workflowSha = '',
    checkedAt = '',
    fetchImpl,
  } = {},
  deps = {},
) {
  const env = deps.env ?? process.env;
  const fetch = deps.fetchImpl ?? fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (typeof fetch !== 'function') {
    fail('PROBE_INTERNAL_ERROR', 'fetch 구현이 없어 probe를 실행할 수 없습니다.');
  }
  validateProbeGuards(
    { approval: approval ?? env.NON_PRODUCTION_AUTH_PROBE_APPROVAL, e2eSecret, email, password },
    env,
  );
  const base = normalizeConsumerUrl(consumerUrl);
  const locked = assertLockedBinding({ deploymentId, expectedSha });
  validateEvidenceBinding({
    expectedSha: locked.expectedSha,
    deploymentId: locked.deploymentId,
    consumerUrl: base,
    evidence,
  });

  // Provenance is recorded HERE: the header object carries the approved
  // E2E_TEST_SECRET input under the expected key on BOTH the CSRF GET and
  // the callback POST (same construction as loginViaCredentials). Only the
  // key name + presence boolean ever leave this scope.
  const secret = String(e2eSecret ?? env.E2E_TEST_SECRET ?? '');
  const headers = { [HEADER_NAME]: secret };
  const headerPresent = isNonEmptyString(secret);
  if (!headerPresent) {
    fail(
      'CREDENTIAL_SOURCE_UNAVAILABLE',
      'header를 구성할 승인된 E2E_TEST_SECRET input이 없어 callback을 시도하지 않습니다.',
    );
  }

  const calls = [];
  const jar = new Map();
  const requestInit = (extra = {}) => ({ redirect: 'manual', ...extra });

  // 1) CSRF (same header object as the callback POST).
  const csrfRes = await fetch(
    `${base}/api/auth/csrf`,
    requestInit({ method: 'GET', headers: { ...headers } }),
  ).catch(() => null);
  calls.push('/api/auth/csrf');
  if (!csrfRes) {
    fail('CALLBACK_TRANSPORT_FAILED', 'CSRF 요청 전송에 실패해 callback을 시도하지 않습니다.');
  }
  storeCookies(jar, csrfRes.headers);
  const csrfStatus = typeof csrfRes.status === 'number' ? csrfRes.status : 0;
  const csrfOk = csrfRes.ok === true || (csrfStatus >= 200 && csrfStatus < 300);
  if (!csrfOk) {
    fail('CALLBACK_TRANSPORT_FAILED', 'CSRF 응답이 비정상이라 callback을 시도하지 않습니다.');
  }
  let csrfToken = '';
  try {
    const text = typeof csrfRes.text === 'function' ? await csrfRes.text() : '';
    const body = parseJsonBody(text);
    if (typeof body.csrfToken === 'string') csrfToken = body.csrfToken;
  } catch {
    csrfToken = '';
  }
  if (!csrfToken) {
    fail('CALLBACK_TRANSPORT_FAILED', 'CSRF token을 확인하지 못해 callback을 시도하지 않습니다.');
  }

  // 2) Credentials callback POST (the request under proof — must execute).
  const form = new URLSearchParams();
  form.set('email', String(email));
  form.set('password', String(password));
  form.set('csrfToken', csrfToken);
  form.set('callbackUrl', base);
  form.set('json', 'true');
  const callbackRes = await fetch(
    `${base}/api/auth/callback/credentials`,
    requestInit({
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(jar.size > 0 ? { Cookie: jarCookieHeader(jar) } : {}),
      },
      body: form.toString(),
    }),
  ).catch(() => null);
  calls.push('/api/auth/callback/credentials');
  if (!callbackRes) {
    fail('CALLBACK_TRANSPORT_FAILED', 'callback 요청 전송에 실패했습니다.');
  }
  storeCookies(jar, callbackRes.headers);
  const callbackStatus = typeof callbackRes.status === 'number' ? callbackRes.status : 0;
  const setCookiePresent = readSetCookieHeaders(callbackRes.headers).length > 0;
  let locationValue = null;
  if (callbackRes.headers && typeof callbackRes.headers.get === 'function') {
    try {
      locationValue = callbackRes.headers.get('location');
    } catch {
      locationValue = null;
    }
  }
  try {
    const text = typeof callbackRes.text === 'function' ? await callbackRes.text() : '';
    const body = parseJsonBody(text);
    if (!locationValue && typeof body.url === 'string' && body.url) {
      locationValue = body.url;
    }
  } catch {
    // Body is only a location fallback source — never evidence content.
  }
  const locationEvidence = parseLocationEvidence(locationValue, base);
  const authErrorClass = classifyAuthError({
    status: callbackStatus,
    codeParam: locationEvidence.codeParam,
    errorParam: locationEvidence.errorParam,
  });

  // 3) Same-jar session readback (cookie VALUES stay in memory only).
  let sessionState = 'NOT_CHECKED';
  try {
    const sessionRes = await fetch(
      `${base}/api/auth/session`,
      requestInit({
        method: 'GET',
        headers: { ...(jar.size > 0 ? { Cookie: jarCookieHeader(jar) } : {}) },
      }),
    );
    calls.push('/api/auth/session');
    const sessionStatus = typeof sessionRes?.status === 'number' ? sessionRes.status : 0;
    const sessionOk = sessionRes?.ok === true || (sessionStatus >= 200 && sessionStatus < 300);
    if (sessionOk && typeof sessionRes.text === 'function') {
      const body = parseJsonBody(await sessionRes.text());
      const user = body.user;
      const userRecord =
        user && typeof user === 'object' && !Array.isArray(user)
          ? user
          : null;
      const token = userRecord?.accessToken;
      sessionState = typeof token === 'string' && token.length > 0 ? 'VALID' : 'INVALID';
    } else if (sessionRes) {
      sessionState = 'INVALID';
    }
  } catch {
    sessionState = 'NOT_CHECKED';
  }

  const artifact = buildCallbackArtifact({
    authErrorClass,
    callbackLocationClass: locationEvidence.locationClass,
    callbackStatus,
    checkedAt: String(checkedAt || new Date().toISOString()),
    deploymentId: locked.deploymentId,
    deploymentSourceSha: locked.expectedSha,
    headerPresent,
    sessionState,
    setCookiePresent,
    workflowSourceSha: String(workflowSha || env.GITHUB_SHA || 'local-unpublished'),
  });
  return { artifact, calls };
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = String(arg).match(/^--([^=]+)=(.*)$/);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { readFileSync } = await import('node:fs');
  let evidence = null;
  const evidencePath = args['evidence-json'] ?? process.env.AUTH_PROBE_EVIDENCE_JSON_PATH;
  if (isNonEmptyString(evidencePath)) {
    try {
      evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    } catch {
      evidence = null;
    }
  } else if (isNonEmptyString(process.env.AUTH_PROBE_EVIDENCE_JSON)) {
    try {
      evidence = JSON.parse(process.env.AUTH_PROBE_EVIDENCE_JSON);
    } catch {
      evidence = null;
    }
  }
  try {
    const { artifact } = await runConsumerCallbackProbe(
      {
        consumerUrl: args['consumer-url'],
        expectedSha: args['expected-sha'],
        deploymentId: args['consumer-deployment-id'],
        evidence,
        approval: args.approval,
        workflowSha: process.env.GITHUB_SHA ?? '',
        checkedAt: '',
      },
      { env: process.env },
    );
    process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
    process.exitCode = 0;
  } catch (error) {
    const code = error instanceof CallbackProbeContractError ? error.code : 'PROBE_INTERNAL_ERROR';
    process.stdout.write(
      `${JSON.stringify({ runner: 'PILOT-AUTH-CONSUMER-CALLBACK-PROBE-16', result: 'FAIL', failureCode: code, message: String(error?.message ?? error) }, null, 2)}\n`,
    );
    process.exitCode = 1;
  }
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isDirectRun =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    const code = error instanceof CallbackProbeContractError ? error.code : 'PROBE_INTERNAL_ERROR';
    process.stdout.write(
      `${JSON.stringify({ runner: 'PILOT-AUTH-CONSUMER-CALLBACK-PROBE-16', result: 'FAIL', failureCode: code, message: String(error?.message ?? error) }, null, 2)}\n`,
    );
    process.exitCode = 1;
  });
}
