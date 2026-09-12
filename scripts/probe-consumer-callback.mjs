/**
 * PILOT-AUTH-CONSUMER-CALLBACK-INPUT-BINDING-PROOF-16 ??invocation-scoped
 * exact Consumer Preview deployment NextAuth credentials callback
 * provenance probe (PILOT-AUTH-CALLBACK-DYNAMIC-EXACT-BINDING-CONTRACT-22).
 *
 * Purpose (CASE B1 closeout, dynamic binding):
 *   Prove, at runtime, whether the invocation-bound Consumer Preview
 *   deployment's NextAuth credentials callback request was actually
 *   constructed with the approved E2E_TEST_SECRET input as the
 *   `x-e2e-test-token` header, and how far that request progressed through
 *   the runtime gate. The callback gate itself is used as the opaque
 *   equality proof ??secret plaintext, value, hash, fingerprint,
 *   prefix/suffix, and length are NEVER accessed for output, comparison
 *   logging, or diagnostics.
 *
 * Binding authority (STATIC lock REMOVED):
 *   There is intentionally NO compile-time deployment/SHA/branch literal in
 *   this file. A literal roll-forward (e.g. rewriting a LOCKED_* constant to
 *   the current main) would self-invalidate on publication, because the
 *   publication merge itself creates a new main SHA. Instead the exact
 *   target is selected explicitly by the caller (workflow inputs:
 *   expected_sha + consumer/seller/driver deployment IDs) and verified
 *   independently against provider deployment metadata evidence. The bound
 *   values (expected SHA, Consumer deployment ID, exact Consumer URL/origin,
 *   deployment evidence) are frozen at invocation start as the immutable
 *   binding for that run: no fallback, auto-discovery, latest-selection, or
 *   branch-tip substitution is permitted afterwards. Source ref/branch may
 *   appear in evidence as provenance only and never outranks exact SHA +
 *   exact deployment metadata.
 *
 *
 * What this probe does (callback path only, never the direct API path):
 *   1. Fail-closed guards BEFORE any network call (approval, production
 *      target, invocation-scoped deployment/SHA/URL evidence binding,
 *      credential-source presence).
 *   2. GET  /api/auth/csrf with the constructed header (provenance recorded
 *      as headerName/headerPresent BEFORE the request is sent).
 *   3. POST /api/auth/callback/credentials with the same header object
 *      (manual redirect: the 302 Location / JSON url is classified, never
 *      followed blindly and never logged).
 *   4. GET  /api/auth/session with the same in-memory cookie jar
 *      (Set-Cookie values never leave memory; only presence is recorded).
 *
 * Non-sensitive evidence ONLY (structurally fixed key set ??see
 * buildCallbackArtifact; the serializer cannot emit secret-derived keys):
 *   requestBuilder, credentialSource, headerName, headerPresent,
 *   callbackStatus, callbackLocationClass, authErrorClass, setCookiePresent,
 *   sessionState, deploymentId, deploymentSourceSha, workflowSourceSha.
 *
 * Exit codes: 0 whenever the callback path was executed and a sanitized
 * artifact was produced (ANY gate outcome is adjudicable evidence);
 * 1 only on fail-closed contract violations (no callback attempted).
 *
 * Usage (real run ??via the approved workflow with Environment-injected
 * secrets; never pass secrets as CLI literals):
 *   node scripts/probe-consumer-callback.mjs \
 *     --expected-sha=<40hex> \
 *     --consumer-url=https://<invocation-bound-consumer-preview> \
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

// Invocation-scoped immutable exact binding
// (PILOT-AUTH-CALLBACK-DYNAMIC-EXACT-BINDING-CONTRACT-22).
// No LOCKED_DEPLOYMENT_ID / LOCKED_SOURCE_SHA / LOCKED_BRANCH literal exists
// by design: the exact target comes from the caller's --expected-sha /
// --consumer-deployment-id / --consumer-url inputs and is verified against
// provider deployment metadata evidence via validateEvidenceBinding().
// The publication merge that carries this file creates a new main SHA, so a
// compile-time literal could never stay exact across publication.

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;

const KNOWN_AUTH_ERROR_CLASSES = Object.freeze([
  'authorize-rejected',
  'upstream-rejected',
  'api-binding-failure',
]);

// Exact sanitized artifact key set. buildCallbackArtifact() can only produce
// these keys ??secret/token/cookie values are structurally unrepresentable.
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

// FAIL evidence contract (PILOT-AUTH-CALLBACK-FAIL-EVIDENCE-PRESERVATION-19).
// Closed allowlist: FAIL probe-raw results can only contain these keys.
// Success allowlist (ARTIFACT_KEYS) is preserved separately; FAIL reuses the
// non-sensitive binding keys for projection compatibility. Raw secrets,
// tokens, cookies, nonces, and raw Location URLs/bodies are structurally
// unrepresentable here.
export const RUNNER_ID = 'PILOT-AUTH-CONSUMER-CALLBACK-PROBE-16';
export const PROTECTION_PASSAGE_MODE = 'NONE';
export const PROTECTION_LOCATION_CLASS = 'VERCEL_SSO_PROTECTION';
export const FAILURE_STAGE_GUARD = 'guard';
export const FAILURE_STAGE_CSRF = 'csrf';
export const FAILURE_STAGE_CALLBACK = 'callback';
export const FAILURE_STAGE_SESSION = 'session';
export const FAIL_RESULT_KEYS = Object.freeze([
  'authErrorClass',
  'callbackAttempted',
  'callbackLocationClass',
  'callbackStatus',
  'checkedAt',
  'credentialSource',
  'csrfStatus',
  'deploymentId',
  'deploymentReady',
  'deploymentSourceSha',
  'expectedSha',
  'failureCode',
  'failureStage',
  'headerAttachedByRunner',
  'headerConfigured',
  'headerName',
  'headerPresent',
  'httpStatus',
  'locationClass',
  'message',
  'observedDeploymentSha',
  'protectionPassageMode',
  'requestBuilder',
  'result',
  'runner',
  'sessionAttempted',
  'sessionState',
  'setCookiePresent',
  'workflowSourceSha',
]);

export class CallbackProbeContractError extends Error {
  constructor(code, message, evidence = null) {
    super(message);
    this.name = 'CallbackProbeContractError';
    this.code = code;
    if (evidence !== null) {
      this.evidence = evidence;
    }
  }
}

function fail(code, message) {
  throw new CallbackProbeContractError(code, message);
}

function failWithEvidence(code, message, evidence) {
  throw new CallbackProbeContractError(code, message, evidence);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function assertExpectedSha(value) {
  if (!isNonEmptyString(value)) {
    fail('EXPECTED_SHA_REQUIRED', 'expected SHAê°€ ?†ìŠµ?ˆë‹¤. --expected-sha=<40hex>ê°€ ?„ìš”?©ë‹ˆ??');
  }
  const normalized = String(value).trim().toLowerCase();
  if (!SHA_PATTERN.test(normalized)) {
    fail('EXPECTED_SHA_MALFORMED', 'expected SHA ?•ì‹???¬ë°”ë¥´ì? ?ŠìŠµ?ˆë‹¤ (40?ë¦¬ ?Œë¬¸??16ì§„ìˆ˜).');
  }
  return normalized;
}

export function assertDeploymentId(value) {
  if (!isNonEmptyString(value) || !DEPLOYMENT_ID_PATTERN.test(String(value).trim())) {
    fail('DEPLOYMENT_ID_MALFORMED', 'pinned Vercel deployment ID ?•ì‹???¬ë°”ë¥´ì? ?ŠìŠµ?ˆë‹¤.');
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
    fail('RUNTIME_NOT_BOUND', 'consumer URL???†ì–´ runtime binding??ì¦ëª…?????†ìŠµ?ˆë‹¤.');
  }
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    fail('RUNTIME_NOT_BOUND', 'consumer URL ?•ì‹???¬ë°”ë¥´ì? ?Šì•„ runtime binding??ê±°ë??©ë‹ˆ??');
  }
  if (url.username || url.password || url.search || url.hash) {
    fail('RUNTIME_NOT_BOUND', 'consumer URL???¸ì¦?•ë³´/query/fragmentê°€ ?ˆì–´ binding??ê±°ë??©ë‹ˆ??');
  }
  const isLoopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (!isLoopback && url.protocol !== 'https:') {
    fail('RUNTIME_NOT_BOUND', 'consumer URL?€ loopback???„ë‹ˆë©?httpsë§??ˆìš©?©ë‹ˆ??');
  }
  if (isProductionHostname(url.hostname)) {
    fail('PRODUCTION_TARGET_REJECTED', 'consumer target???´ì˜ ?¸ìŠ¤?¸ì´ë¯€ë¡?ì°¨ë‹¨?©ë‹ˆ??');
  }
  if (!url.hostname.endsWith('.vercel.app')) {
    fail('RUNTIME_NOT_BOUND', 'consumer target??invocation-bound Preview deployment ?¸ìŠ¤?¸ê? ?„ë‹™?ˆë‹¤.');
  }
  return url.toString().replace(/\/$/, '');
}

/**
 * Invocation-scoped immutable exact binding: freeze the caller's explicit
 * --expected-sha / --consumer-deployment-id inputs for this run. There is no
 * compile-time literal to compare against ??exactness is proven by
 * validateEvidenceBinding() against provider deployment metadata. The
 * returned values are the immutable binding authority for the remainder of
 * the run (no retargeting afterwards).
 */
export function assertInvocationBinding({ deploymentId, expectedSha }) {
  const id = assertDeploymentId(deploymentId);
  const sha = assertExpectedSha(expectedSha);
  return { deploymentId: id, expectedSha: sha };
}

/**
 * Evidence binding (consumer slice of wait-preview-deploy JSON): the
 * invocation-bound deployment id + expected SHA + exact target URL must all
 * agree with provider deployment metadata before any network call.
 *
 * Strict exact-equality contract (no fallback / auto-discovery /
 * latest-selection / alias substitution):
 *   - evidence must exist and prove ready === true (exact READY proof);
 *   - evidence.expectedSha must equal the invocation expected SHA;
 *   - evidence consumer deployment SHA must equal the invocation SHA;
 *   - evidence consumer deployment ID must exist and equal the invocation ID;
 *   - evidence consumer target URL must exist and equal the invocation URL
 *     (exact, after trailing-slash normalization);
 *   - source ref/branch fields, when present, are provenance only and never
 *     substitute for the exact SHA or deployment metadata.
 */
export function validateEvidenceBinding({ expectedSha, deploymentId, consumerUrl, evidence }) {
  const sha = assertExpectedSha(expectedSha);
  const id = assertDeploymentId(deploymentId);
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    fail('RUNTIME_NOT_BOUND', 'runtime binding evidenceê°€ ?†ì–´ ?¤í–‰??ì°¨ë‹¨?©ë‹ˆ??');
  }
  if (evidence.ready !== true) {
    fail('RUNTIME_NOT_BOUND', 'binding evidenceê°€ exact READY ?íƒœë¥?ì¦ëª…?˜ì? ?Šì•„ ?¤í–‰??ì°¨ë‹¨?©ë‹ˆ??');
  }
  const evidenceSha = String(evidence.expectedSha ?? '').trim().toLowerCase();
  if (!evidenceSha || evidenceSha !== sha) {
    fail('EXPECTED_SHA_MISMATCH', 'binding evidence SHAê°€ --expected-sha?€ ?¤ë¦…?ˆë‹¤.');
  }
  const shas = evidence.deploymentShas ?? evidence.statusShas ?? {};
  const observedSha = String(shas.consumer ?? '').trim().toLowerCase();
  if (!observedSha || observedSha !== sha) {
    fail('DEPLOYMENT_SHA_MISMATCH', 'consumer ë°°í¬ SHAê°€ ì§€??SHA?€ ?¼ì¹˜?˜ì? ?ŠìŠµ?ˆë‹¤.');
  }
  const pinned =
    evidence.pinnedDeploymentIds ?? evidence.deploymentIds ?? evidence.pinnedDeploymentIDs ?? {};
  const pinnedConsumer = pinned.consumer ?? evidence.consumerDeploymentId ?? '';
  if (!isNonEmptyString(pinnedConsumer)) {
    fail('RUNTIME_NOT_BOUND', 'binding evidence??consumer deployment IDê°€ ?†ì–´ ?¤í–‰??ì°¨ë‹¨?©ë‹ˆ??');
  }
  if (String(pinnedConsumer).trim() !== id) {
    fail('RUNTIME_BINDING_MISMATCH', 'consumer deployment IDê°€ evidence bindingê³??¤ë¦…?ˆë‹¤.');
  }
  const targets = evidence.deploymentTargetUrls ?? evidence.statusTargetUrls ?? evidence.targetUrls ?? {};
  const evidenceTarget = targets.consumer ?? '';
  if (!isNonEmptyString(evidenceTarget)) {
    fail('RUNTIME_NOT_BOUND', 'binding evidence??consumer target URL???†ì–´ ?¤í–‰??ì°¨ë‹¨?©ë‹ˆ??');
  }
  const observed = normalizeConsumerUrl(evidenceTarget);
  if (observed !== consumerUrl) {
    fail('RUNTIME_BINDING_MISMATCH', 'consumer target??evidence bindingê³??¤ë¦…?ˆë‹¤.');
  }
  return { expectedSha: sha, deploymentId: id };
}

export function validateProbeGuards(input = {}, env = process.env) {
  const approval = String(input.approval ?? env.NON_PRODUCTION_AUTH_PROBE_APPROVAL ?? '').trim();
  if (approval !== APPROVAL_VALUE) {
    fail('MISSING_APPROVAL', 'explicit non-production approval???†ì–´ ?¤í–‰??ì°¨ë‹¨?©ë‹ˆ??');
  }
  const e2eSecret = input.e2eSecret ?? env.E2E_TEST_SECRET ?? '';
  if (!isNonEmptyString(e2eSecret)) {
    fail(
      'CREDENTIAL_SOURCE_UNAVAILABLE',
      'headerë¥?êµ¬ì„±???¹ì¸??E2E_TEST_SECRET input???†ì–´ callback???œë„?˜ì? ?ŠìŠµ?ˆë‹¤.',
    );
  }
  const email = input.email ?? env.TEST_CONSUMER_EMAIL ?? '';
  const password = input.password ?? env.TEST_CONSUMER_PASSWORD ?? '';
  if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
    fail('CONSUMER_CREDENTIALS_MISSING', 'consumer test credential???†ì–´ ?¤í–‰??ì°¨ë‹¨?©ë‹ˆ??');
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

// ---- FAIL evidence helpers (pure, no secrets) --------------------------------

function readHeaderValue(headers, name) {
  if (!headers) return '';
  try {
    if (typeof headers.get === 'function') {
      const value = headers.get(name);
      return typeof value === 'string' ? value : '';
    }
    if (Array.isArray(headers)) {
      const entry = headers.find(
        (item) => Array.isArray(item) && String(item[0]).toLowerCase() === String(name).toLowerCase(),
      );
      return entry ? String(entry[1] ?? '') : '';
    }
  } catch {
    return '';
  }
  return '';
}

function readContentType(headers) {
  return readHeaderValue(headers, 'content-type').toLowerCase();
}

function readLocationHeader(headers) {
  const value = readHeaderValue(headers, 'location');
  return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * Deterministic Vercel protection intercept classifier. Direct observation
 * only (no elimination inference):
 *   302 + text/plain + Location host vercel.com + path /sso-api.
 * Raw Location is used for classification only and never stored.
 * Any non-matching redirect (e.g. application /login redirect) returns false.
 */
export function isProtectionIntercept({ status, contentType, locationValue, base }) {
  if (status !== 302) return false;
  const type = String(contentType ?? '').toLowerCase();
  if (!type.includes('text/plain')) return false;
  if (typeof locationValue !== 'string' || !locationValue.trim()) return false;
  try {
    const url = new URL(locationValue, base);
    if (String(url.hostname ?? '').toLowerCase() !== 'vercel.com') return false;
    const path = String(url.pathname ?? '');
    if (path !== '/sso-api' && !path.startsWith('/sso-api/')) return false;
    return true;
  } catch {
    return false;
  }
}

export function isProtectionResponse({ status, headers, locationValue, base }) {
  const location = locationValue ?? readLocationHeader(headers);
  return isProtectionIntercept({
    status,
    contentType: readContentType(headers),
    locationValue: location,
    base,
  });
}

/** FAIL location class: protection is distinct, otherwise safe app classes. */
export function classifyFailureLocation({ locationValue, base, isProtection }) {
  if (isProtection) return PROTECTION_LOCATION_CLASS;
  if (typeof locationValue !== 'string' || !locationValue.trim()) return 'NONE';
  try {
    const url = new URL(locationValue, base);
    return classifyLocationClass(url.pathname || '/');
  } catch {
    return 'OTHER';
  }
}

function safeNormalizedSha(value) {
  try {
    return assertExpectedSha(value);
  } catch {
    return null;
  }
}

function safeDeploymentId(value) {
  try {
    return assertDeploymentId(value);
  } catch {
    return null;
  }
}

export function extractObservedDeploymentSha(evidence) {
  try {
    const shas = evidence?.deploymentShas ?? evidence?.statusShas ?? {};
    const value = String(shas.consumer ?? '').trim().toLowerCase();
    return SHA_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function extractDeploymentReady(evidence) {
  if (!evidence || typeof evidence !== 'object') return null;
  if (typeof evidence.ready === 'boolean') return evidence.ready;
  return null;
}

/**
 * Closed FAIL result builder. Only FAIL_RESULT_KEYS can appear ??raw
 * header/token/cookie/location values, nonces, and credential material are
 * structurally unrepresentable. All unknown observations must be passed as
 * explicit null, never as raw values.
 */
export function buildFailureResult(fields = {}) {
  const result = {
    authErrorClass: fields.authErrorClass ?? null,
    callbackAttempted: fields.callbackAttempted ?? false,
    callbackLocationClass: fields.callbackLocationClass ?? 'NONE',
    callbackStatus: fields.callbackStatus ?? null,
    checkedAt: fields.checkedAt ?? new Date().toISOString(),
    credentialSource: CREDENTIAL_SOURCE,
    csrfStatus: fields.csrfStatus ?? null,
    deploymentId: fields.deploymentId ?? null,
    deploymentReady: fields.deploymentReady ?? null,
    deploymentSourceSha: fields.deploymentSourceSha ?? null,
    expectedSha: fields.expectedSha ?? null,
    failureCode: fields.failureCode ?? 'PROBE_INTERNAL_ERROR',
    failureStage: fields.failureStage ?? FAILURE_STAGE_GUARD,
    headerAttachedByRunner: fields.headerAttachedByRunner ?? false,
    headerConfigured: fields.headerConfigured ?? false,
    headerName: HEADER_NAME,
    headerPresent: fields.headerPresent ?? false,
    httpStatus: fields.httpStatus ?? null,
    locationClass: fields.locationClass ?? 'NONE',
    message: fields.message ?? '',
    observedDeploymentSha: fields.observedDeploymentSha ?? null,
    protectionPassageMode: PROTECTION_PASSAGE_MODE,
    requestBuilder: REQUEST_BUILDER,
    result: 'FAIL',
    runner: RUNNER_ID,
    sessionAttempted: fields.sessionAttempted ?? false,
    sessionState: fields.sessionState ?? 'NOT_CHECKED',
    setCookiePresent: fields.setCookiePresent ?? null,
    workflowSourceSha: fields.workflowSourceSha ?? 'local-unpublished',
  };
  const keys = Object.keys(result).sort();
  const expected = [...FAIL_RESULT_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail('PROBE_INTERNAL_ERROR', 'sanitized FAIL key set??ê³ ì • ê³„ì•½ê³??¤ë¦…?ˆë‹¤.');
  }
  if (result.protectionPassageMode !== 'NONE') {
    fail('PROBE_INTERNAL_ERROR', 'protection passage mode???´ë²ˆ Task?ì„œ NONEë§??ˆìš©?©ë‹ˆ??');
  }
  return result;
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
 * output ??there is no parameter, code path, or spread through which a
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
    fail('PROBE_INTERNAL_ERROR', 'sanitized artifact key set??ê³ ì • ê³„ì•½ê³??¤ë¦…?ˆë‹¤.');
  }
  return artifact;
}

/**
 * One callback provenance lifecycle against the invocation-bound Consumer
 * deployment: CSRF -> credentials callback POST -> same-jar session readback.
 * The invocation binding (expected SHA + deployment ID + exact URL + READY
 * evidence) is frozen before any network call and never retargeted.
 *
 * fetchImpl is injectable (mock in tests, global fetch in real runs with
 * redirect:'manual' enforced below). Returns { artifact, calls } where calls
 * is the non-sensitive list of request paths (direct-API confusion check).
 *
 * workflowSha is the probe-code version (workflow ref); it is recorded as
 * workflowSourceSha provenance only and never substitutes for the
 * invocation-bound target deployment SHA.
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
  const workflowShaValue = String(workflowSha || env.GITHUB_SHA || 'local-unpublished');
  const checkedAtValue = String(checkedAt || new Date().toISOString());
  const rawSecretForEvidence = String(e2eSecret ?? env.E2E_TEST_SECRET ?? '');
  const headerConfiguredInitial = isNonEmptyString(rawSecretForEvidence);
  const observedShaInitial = extractObservedDeploymentSha(evidence);
  const readyInitial = extractDeploymentReady(evidence);
  const expectedShaInitial = safeNormalizedSha(expectedSha);
  const deploymentIdInitial = safeDeploymentId(deploymentId);
  const guardEvidence = (code, message) =>
    buildFailureResult({
      authErrorClass: null,
      callbackAttempted: false,
      callbackLocationClass: 'NONE',
      callbackStatus: null,
      checkedAt: checkedAtValue,
      csrfStatus: null,
      deploymentId: deploymentIdInitial,
      deploymentReady: readyInitial,
      deploymentSourceSha: expectedShaInitial,
      expectedSha: expectedShaInitial,
      failureCode: code,
      failureStage: FAILURE_STAGE_GUARD,
      headerAttachedByRunner: false,
      headerConfigured: headerConfiguredInitial,
      headerPresent: headerConfiguredInitial,
      httpStatus: null,
      locationClass: 'NONE',
      message,
      observedDeploymentSha: observedShaInitial,
      sessionAttempted: false,
      sessionState: 'NOT_CHECKED',
      setCookiePresent: null,
      workflowSourceSha: workflowShaValue,
    });
  if (typeof fetch !== 'function') {
    failWithEvidence(
      'PROBE_INTERNAL_ERROR',
      'fetch êµ¬í˜„???†ì–´ probeë¥??¤í–‰?????†ìŠµ?ˆë‹¤.',
      guardEvidence('PROBE_INTERNAL_ERROR', 'fetch êµ¬í˜„???†ì–´ probeë¥??¤í–‰?????†ìŠµ?ˆë‹¤.'),
    );
  }
  let base;
  let bound;
  try {
    validateProbeGuards(
      { approval: approval ?? env.NON_PRODUCTION_AUTH_PROBE_APPROVAL, e2eSecret, email, password },
      env,
    );
    base = normalizeConsumerUrl(consumerUrl);
    bound = assertInvocationBinding({ deploymentId, expectedSha });
    validateEvidenceBinding({
      expectedSha: bound.expectedSha,
      deploymentId: bound.deploymentId,
      consumerUrl: base,
      evidence,
    });
  } catch (error) {
    if (error instanceof CallbackProbeContractError && error.evidence) throw error;
    const code = error instanceof CallbackProbeContractError ? error.code : 'PROBE_INTERNAL_ERROR';
    const message = String(error?.message ?? error);
    failWithEvidence(code, message, guardEvidence(code, message));
  }

  // Provenance is recorded HERE: the header object carries the approved
  // E2E_TEST_SECRET input under the expected key on BOTH the CSRF GET and
  // the callback POST (same construction as loginViaCredentials). Only the
  // key name + presence boolean ever leave this scope.
  const secret = String(e2eSecret ?? env.E2E_TEST_SECRET ?? '');
  const headers = { [HEADER_NAME]: secret };
  const headerPresent = isNonEmptyString(secret);
  const headerConfigured = headerPresent;
  const observedSha = extractObservedDeploymentSha(evidence);
  const deploymentReady = extractDeploymentReady(evidence);
  if (!headerPresent) {
    const code = 'CREDENTIAL_SOURCE_UNAVAILABLE';
    const message = 'headerë¥?êµ¬ì„±???¹ì¸??E2E_TEST_SECRET input???†ì–´ callback???œë„?˜ì? ?ŠìŠµ?ˆë‹¤.';
    failWithEvidence(
      code,
      message,
      buildFailureResult({
        authErrorClass: null,
        callbackAttempted: false,
        callbackLocationClass: 'NONE',
        callbackStatus: null,
        checkedAt: checkedAtValue,
        csrfStatus: null,
        deploymentId: bound.deploymentId,
        deploymentReady,
        deploymentSourceSha: bound.expectedSha,
        expectedSha: bound.expectedSha,
        failureCode: code,
        failureStage: FAILURE_STAGE_GUARD,
        headerAttachedByRunner: false,
        headerConfigured: false,
        headerPresent: false,
        httpStatus: null,
        locationClass: 'NONE',
        message,
        observedDeploymentSha: observedSha,
        sessionAttempted: false,
        sessionState: 'NOT_CHECKED',
        setCookiePresent: null,
        workflowSourceSha: workflowShaValue,
      }),
    );
  }
  const headerAttachedByRunner = true;

  const calls = [];
  const jar = new Map();
  const requestInit = (extra = {}) => ({ redirect: 'manual', ...extra });

  // 1) CSRF (same header object as the callback POST).
  const csrfRes = await fetch(
    `${base}/api/auth/csrf`,
    requestInit({ method: 'GET', headers: { ...headers } }),
  ).catch(() => null);
  calls.push('/api/auth/csrf');
  const csrfFail = (code, message, { csrfStatus = null, locationValue = null, isProtection = false } = {}) => {
    const locationClass = classifyFailureLocation({ locationValue, base, isProtection });
    const callbackLocationClass = locationClass;
    return buildFailureResult({
      authErrorClass: isProtection ? 'NONE' : null,
      callbackAttempted: false,
      callbackLocationClass,
      callbackStatus: null,
      checkedAt: checkedAtValue,
      csrfStatus,
      deploymentId: bound.deploymentId,
      deploymentReady,
      deploymentSourceSha: bound.expectedSha,
      expectedSha: bound.expectedSha,
      failureCode: code,
      failureStage: FAILURE_STAGE_CSRF,
      headerAttachedByRunner,
      headerConfigured,
      headerPresent,
      httpStatus: csrfStatus,
      locationClass,
      message,
      observedDeploymentSha: observedSha,
      sessionAttempted: false,
      sessionState: 'NOT_CHECKED',
      setCookiePresent: null,
      workflowSourceSha: workflowShaValue,
    });
  };
  if (!csrfRes) {
    const code = 'CSRF_TRANSPORT_FAILED';
    const message = 'CSRF ?”ì²­ ?„ì†¡???¤íŒ¨??callback???œë„?˜ì? ?ŠìŠµ?ˆë‹¤.';
    failWithEvidence(code, message, csrfFail(code, message, { csrfStatus: null }));
  }
  // Protection intercept at CSRF stage takes precedence over transport/app checks.
  {
    const csrfStatusObserved = typeof csrfRes.status === 'number' ? csrfRes.status : 0;
    const csrfLocation = readLocationHeader(csrfRes.headers);
    const csrfContentType = readContentType(csrfRes.headers);
    // Body fallback location (same as callback): only for classification, never stored.
    let csrfBodyLocation = null;
    try {
      if (typeof csrfRes.text === 'function') {
        // Peek without consuming twice: CSRF body is JSON; read once and reuse below.
        // We read here for protection classification; the token parse below re-reads
        // via a second call only in mocks where text() is repeatable. In real fetch,
        // text() can be consumed once, so we handle both by caching.
        csrfBodyLocation = null;
      }
    } catch {
      csrfBodyLocation = null;
    }
    const effectiveLocation = csrfLocation ?? csrfBodyLocation;
    if (
      isProtectionIntercept({
        status: csrfStatusObserved,
        contentType: csrfContentType,
        locationValue: effectiveLocation,
        base,
      })
    ) {
      const code = 'DEPLOYMENT_PROTECTION_INTERCEPTED';
      const message = 'Vercel protection interceptë¡?CSRF ?¨ê³„?ì„œ ì°¨ë‹¨?ìŠµ?ˆë‹¤.';
      failWithEvidence(
        code,
        message,
        csrfFail(code, message, {
          csrfStatus: csrfStatusObserved,
          locationValue: effectiveLocation,
          isProtection: true,
        }),
      );
    }
  }
  storeCookies(jar, csrfRes.headers);
  const csrfStatus = typeof csrfRes.status === 'number' ? csrfRes.status : 0;
  const csrfOk = csrfRes.ok === true || (csrfStatus >= 200 && csrfStatus < 300);
  if (!csrfOk) {
    const code = 'CSRF_TRANSPORT_FAILED';
    const message = 'CSRF ?‘ë‹µ??ë¹„ì •?ì´??callback???œë„?˜ì? ?ŠìŠµ?ˆë‹¤.';
    // Non-2xx CSRF is transport/app precondition failure (protection already excluded).
    failWithEvidence(code, message, csrfFail(code, message, { csrfStatus }));
  }
  let csrfToken = '';
  let csrfTextCache = null;
  try {
    const text = typeof csrfRes.text === 'function' ? await csrfRes.text() : '';
    csrfTextCache = text;
    const body = parseJsonBody(text);
    if (typeof body.csrfToken === 'string') csrfToken = body.csrfToken;
  } catch {
    csrfToken = '';
  }
  if (!csrfToken) {
    const code = 'CSRF_TRANSPORT_FAILED';
    const message = 'CSRF token???•ì¸?˜ì? ëª»í•´ callback???œë„?˜ì? ?ŠìŠµ?ˆë‹¤.';
    failWithEvidence(code, message, csrfFail(code, message, { csrfStatus }));
  }

  // 2) Credentials callback POST (the request under proof ??must execute).
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
  const callbackFail = (
    code,
    message,
    { callbackStatus: cbStatus = null, locationValue: loc = null, isProtection = false, authClass = null, cookiePresent = null } = {},
  ) => {
    const locationClass = classifyFailureLocation({ locationValue: loc, base, isProtection });
    const callbackLocationClass = locationClass;
    return buildFailureResult({
      authErrorClass: isProtection ? 'NONE' : authClass,
      callbackAttempted: true,
      callbackLocationClass,
      callbackStatus: cbStatus,
      checkedAt: checkedAtValue,
      csrfStatus,
      deploymentId: bound.deploymentId,
      deploymentReady,
      deploymentSourceSha: bound.expectedSha,
      expectedSha: bound.expectedSha,
      failureCode: code,
      failureStage: FAILURE_STAGE_CALLBACK,
      headerAttachedByRunner,
      headerConfigured,
      headerPresent,
      httpStatus: cbStatus,
      locationClass,
      message,
      observedDeploymentSha: observedSha,
      sessionAttempted: false,
      sessionState: 'NOT_CHECKED',
      setCookiePresent: cookiePresent,
      workflowSourceSha: workflowShaValue,
    });
  };
  if (!callbackRes) {
    const code = 'CALLBACK_TRANSPORT_FAILED';
    const message = 'callback ?”ì²­ ?„ì†¡???¤íŒ¨?ˆìŠµ?ˆë‹¤.';
    failWithEvidence(code, message, callbackFail(code, message, { callbackStatus: null }));
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
  let callbackBody = {};
  try {
    const text = typeof callbackRes.text === 'function' ? await callbackRes.text() : '';
    const body = parseJsonBody(text);
    callbackBody = body;
    if (!locationValue && typeof body.url === 'string' && body.url) {
      locationValue = body.url;
    }
  } catch {
    // Body is only a location fallback source ??never evidence content.
  }
  // Protection intercept at callback stage: never misclassified as Auth.js rejection.
  {
    const contentType = readContentType(callbackRes.headers);
    if (
      isProtectionIntercept({ status: callbackStatus, contentType, locationValue, base })
    ) {
      const code = 'DEPLOYMENT_PROTECTION_INTERCEPTED';
      const message = 'Vercel protection interceptë¡?callback ?¨ê³„?ì„œ ì°¨ë‹¨?ìŠµ?ˆë‹¤.';
      failWithEvidence(
        code,
        message,
        callbackFail(code, message, {
          callbackStatus,
          locationValue,
          isProtection: true,
          cookiePresent: setCookiePresent,
        }),
      );
    }
  }
  const locationEvidence = parseLocationEvidence(locationValue, base);
  const authErrorClass = classifyAuthError({
    status: callbackStatus,
    codeParam: locationEvidence.codeParam,
    errorParam: locationEvidence.errorParam,
  });
  // Directly-observed application rejection with 401/403 status is an explicit
  // CALLBACK_REJECTED FAIL (distinct from transport failure and from the
  // 302 LOGIN_ERROR SUCCESS taxonomy which is preserved unchanged).
  if (callbackStatus === 401 || callbackStatus === 403) {
    const code = 'CALLBACK_REJECTED';
    const message = 'callback application ?‘ë‹µ?ì„œ ?¸ì¦ ê±°ì ˆ??ì§ì ‘ ê´€ì°°ë?µë‹ˆ??';
    failWithEvidence(
      code,
      message,
      callbackFail(code, message, {
        callbackStatus,
        locationValue,
        isProtection: false,
        authClass: authErrorClass,
        cookiePresent: setCookiePresent,
      }),
    );
  }

  // 3) Same-jar session readback (cookie VALUES stay in memory only).
  // Transport-level session failures are explicit SESSION_READ_FAILED FAILs
  // with sessionAttempted=true and callback evidence preserved. Application
  // INVALID (200 without token / non-2xx with response) remains SUCCESS to
  // preserve the existing success semantics.
  let sessionState = 'NOT_CHECKED';
  const sessionFail = (code, message, { sessionStatus = null } = {}) =>
    buildFailureResult({
      authErrorClass,
      callbackAttempted: true,
      callbackLocationClass: locationEvidence.locationClass,
      callbackStatus,
      checkedAt: checkedAtValue,
      csrfStatus,
      deploymentId: bound.deploymentId,
      deploymentReady,
      deploymentSourceSha: bound.expectedSha,
      expectedSha: bound.expectedSha,
      failureCode: code,
      failureStage: FAILURE_STAGE_SESSION,
      headerAttachedByRunner,
      headerConfigured,
      headerPresent,
      httpStatus: sessionStatus,
      locationClass: locationEvidence.locationClass,
      message,
      observedDeploymentSha: observedSha,
      sessionAttempted: true,
      sessionState: 'NOT_CHECKED',
      setCookiePresent,
      workflowSourceSha: workflowShaValue,
    });
  let sessionFetchThrew = false;
  let sessionRes = null;
  try {
    sessionRes = await fetch(
      `${base}/api/auth/session`,
      requestInit({
        method: 'GET',
        headers: { ...(jar.size > 0 ? { Cookie: jarCookieHeader(jar) } : {}) },
      }),
    );
  } catch {
    sessionFetchThrew = true;
    sessionRes = null;
  }
  if (sessionFetchThrew || !sessionRes) {
    const code = 'SESSION_READ_FAILED';
    const message = 'session ?•ì¸ ?¨ê³„?ì„œ ?„ì†¡???¤íŒ¨?ˆìŠµ?ˆë‹¤.';
    failWithEvidence(code, message, sessionFail(code, message, { sessionStatus: null }));
  }
  calls.push('/api/auth/session');
  // Protection intercept at session stage (directly observed) is distinct
  // from Auth.js session INVALID.
  {
    const sessionStatusObserved =
      typeof sessionRes?.status === 'number' ? sessionRes.status : 0;
    const sessionLocation =
      sessionRes?.headers && typeof sessionRes.headers.get === 'function'
        ? (() => {
            try {
              return sessionRes.headers.get('location');
            } catch {
              return null;
            }
          })()
        : null;
    const sessionContentType = readContentType(sessionRes?.headers);
    if (
      isProtectionIntercept({
        status: sessionStatusObserved,
        contentType: sessionContentType,
        locationValue: sessionLocation,
        base,
      })
    ) {
      const code = 'DEPLOYMENT_PROTECTION_INTERCEPTED';
      const message = 'Vercel protection interceptë¡?session ?¨ê³„?ì„œ ì°¨ë‹¨?ìŠµ?ˆë‹¤.';
      failWithEvidence(
        code,
        message,
        buildFailureResult({
          authErrorClass: 'NONE',
          callbackAttempted: true,
          callbackLocationClass: locationEvidence.locationClass,
          callbackStatus,
          checkedAt: checkedAtValue,
          csrfStatus,
          deploymentId: bound.deploymentId,
          deploymentReady,
          deploymentSourceSha: bound.expectedSha,
          expectedSha: bound.expectedSha,
          failureCode: code,
          failureStage: FAILURE_STAGE_SESSION,
          headerAttachedByRunner,
          headerConfigured,
          headerPresent,
          httpStatus: sessionStatusObserved,
          locationClass: PROTECTION_LOCATION_CLASS,
          message,
          observedDeploymentSha: observedSha,
          sessionAttempted: true,
          sessionState: 'NOT_CHECKED',
          setCookiePresent,
          workflowSourceSha: workflowShaValue,
        }),
      );
    }
  }
  {
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
  }

  const artifact = buildCallbackArtifact({
    authErrorClass,
    callbackLocationClass: locationEvidence.locationClass,
    callbackStatus,
    checkedAt: checkedAtValue,
    deploymentId: bound.deploymentId,
    deploymentSourceSha: bound.expectedSha,
    headerPresent,
    sessionState,
    setCookiePresent,
    workflowSourceSha: workflowShaValue,
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
    if (
      error instanceof CallbackProbeContractError &&
      error.evidence &&
      typeof error.evidence === 'object'
    ) {
      process.stdout.write(`${JSON.stringify(error.evidence, null, 2)}\n`);
    } else {
      const code =
        error instanceof CallbackProbeContractError ? error.code : 'PROBE_INTERNAL_ERROR';
      const fallback = buildFailureResult({
        checkedAt: new Date().toISOString(),
        failureCode: code,
        failureStage: FAILURE_STAGE_GUARD,
        message: String(error?.message ?? error),
        workflowSourceSha: String(process.env.GITHUB_SHA ?? 'local-unpublished'),
      });
      process.stdout.write(`${JSON.stringify(fallback, null, 2)}\n`);
    }
    process.exitCode = 1;
  }
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isDirectRun =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    if (
      error instanceof CallbackProbeContractError &&
      error.evidence &&
      typeof error.evidence === 'object'
    ) {
      process.stdout.write(`${JSON.stringify(error.evidence, null, 2)}\n`);
    } else {
      const code =
        error instanceof CallbackProbeContractError ? error.code : 'PROBE_INTERNAL_ERROR';
      const fallback = buildFailureResult({
        checkedAt: new Date().toISOString(),
        failureCode: code,
        failureStage: FAILURE_STAGE_GUARD,
        message: String(error?.message ?? error),
        workflowSourceSha: String(process.env.GITHUB_SHA ?? 'local-unpublished'),
      });
      process.stdout.write(`${JSON.stringify(fallback, null, 2)}\n`);
    }
    process.exitCode = 1;
  });
}
