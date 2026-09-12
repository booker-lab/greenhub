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
 *   protectionPassageMode, protectionBypassHeaderName,
 *   protectionBypassHeaderPresent,
 *   callbackStatus, callbackLocationClass, authErrorClass, setCookiePresent,
 *   sessionState, deploymentId, deploymentSourceSha, workflowSourceSha.
 *
 * Vercel protection passage (PILOT-AUTH-VERCEL-AUTOMATION-BYPASS-27):
 *   --protection-passage-mode=NONE (default, historical) |
 *     AUTOMATION_BYPASS. AUTOMATION_BYPASS attaches
 *   x-vercel-protection-bypass to the three Consumer Preview requests only
 *   (CSRF, callback, session) while x-e2e-test-token is preserved. The
 *   bypass credential comes from VERCEL_AUTOMATION_BYPASS_SECRET env only
 *   (workflow maps ROUND_DIRECT_E2E_CONSUMER_BYPASS_SECRET); CLI literals,
 *   logs, and secret-derived diagnostics are forbidden. Missing credential
 *   fails closed with AUTOMATION_BYPASS_CREDENTIAL_UNAVAILABLE.
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
 *     --approval=NON_PRODUCTION_AUTH_PROBE_APPROVED \
 *     --protection-passage-mode=AUTOMATION_BYPASS
 *
 * Secrets come from env (never logged, never serialized):
 *   E2E_TEST_SECRET, TEST_CONSUMER_EMAIL, TEST_CONSUMER_PASSWORD,
 *   VERCEL_AUTOMATION_BYPASS_SECRET (AUTOMATION_BYPASS only)
 */

export const APPROVAL_VALUE = 'NON_PRODUCTION_AUTH_PROBE_APPROVED';

export const HEADER_NAME = 'x-e2e-test-token';
export const CREDENTIAL_SOURCE = 'E2E_TEST_SECRET';
export const REQUEST_BUILDER =
  'scripts/probe-consumer-callback.mjs#runConsumerCallbackProbe';

// Vercel protection passage layer (PILOT-AUTH-VERCEL-AUTOMATION-BYPASS-27).
// This layer is SEPARATE from the application/E2E credential layer above:
//   Vercel passage: x-vercel-protection-bypass <- VERCEL_AUTOMATION_BYPASS_SECRET
//     (workflow maps it from ROUND_DIRECT_E2E_CONSUMER_BYPASS_SECRET)
//   Application/E2E auth: x-e2e-test-token <- ROUND_DIRECT_E2E_TEST_SECRET
// The two layers are never merged: the bypass header only opens the Vercel
// protection edge, while x-e2e-test-token still proves the application input.
export const PROTECTION_BYPASS_HEADER_NAME = 'x-vercel-protection-bypass';
export const PROTECTION_BYPASS_CREDENTIAL_ENV = 'VERCEL_AUTOMATION_BYPASS_SECRET';
export const PROTECTION_PASSAGE_MODES = Object.freeze(['NONE', 'AUTOMATION_BYPASS']);

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
  'protectionBypassHeaderName',
  'protectionBypassHeaderPresent',
  'protectionPassageMode',
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
  'protectionBypassHeaderName',
  'protectionBypassHeaderPresent',
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
    fail('EXPECTED_SHA_REQUIRED', 'expected SHA가 ?�습?�다. --expected-sha=<40hex>가 ?�요?�니??');
  }
  const normalized = String(value).trim().toLowerCase();
  if (!SHA_PATTERN.test(normalized)) {
    fail('EXPECTED_SHA_MALFORMED', 'expected SHA ?�식???�바르�? ?�습?�다 (40?�리 ?�문??16진수).');
  }
  return normalized;
}

export function assertDeploymentId(value) {
  if (!isNonEmptyString(value) || !DEPLOYMENT_ID_PATTERN.test(String(value).trim())) {
    fail('DEPLOYMENT_ID_MALFORMED', 'pinned Vercel deployment ID ?�식???�바르�? ?�습?�다.');
  }
  return String(value).trim();
}

/**
 * Vercel protection passage mode (PILOT-AUTH-VERCEL-AUTOMATION-BYPASS-27).
 * NONE preserves the historical behavior exactly (no bypass header).
 * AUTOMATION_BYPASS attaches x-vercel-protection-bypass to the three
 * Consumer Preview requests only. Unknown modes fail closed.
 */
export function normalizeProtectionPassageMode(value) {
  const raw = String(value ?? 'NONE').trim().toUpperCase();
  if (raw === '' || raw === 'NONE') return 'NONE';
  if (raw === 'AUTOMATION_BYPASS') return 'AUTOMATION_BYPASS';
  fail('PROTECTION_PASSAGE_MODE_UNSUPPORTED', 'protection passage mode가 지원되지 않습니다 (NONE | AUTOMATION_BYPASS).');
}

function readProtectionBypassSecret(inputBypassSecret, env) {
  if (typeof inputBypassSecret === 'string' && isNonEmptyString(inputBypassSecret)) {
    return String(inputBypassSecret);
  }
  const fromEnv = env?.[PROTECTION_BYPASS_CREDENTIAL_ENV] ?? process.env[PROTECTION_BYPASS_CREDENTIAL_ENV] ?? '';
  return typeof fromEnv === 'string' ? fromEnv : '';
}

/**
 * Resolve the bypass credential for the requested mode WITHOUT ever
 * serializing, logging, hashing, or measuring it. NONE needs no credential.
 * AUTOMATION_BYPASS without a credential fails closed BEFORE any network
 * call with AUTOMATION_BYPASS_CREDENTIAL_UNAVAILABLE.
 */
export function assertProtectionPassageReady({ protectionPassageMode, protectionBypassSecret } = {}, env = process.env) {
  const mode = normalizeProtectionPassageMode(
    protectionPassageMode ?? env?.PROTECTION_PASSAGE_MODE ?? 'NONE',
  );
  if (mode === 'NONE') return { protectionPassageMode: mode, bypassSecret: '' };
  const secret = readProtectionBypassSecret(protectionBypassSecret, env);
  if (!isNonEmptyString(secret)) {
    fail(
      'AUTOMATION_BYPASS_CREDENTIAL_UNAVAILABLE',
      'AUTOMATION_BYPASS mode인데 bypass credential이 없어 network 호출 전에 차단합니다.',
    );
  }
  return { protectionPassageMode: mode, bypassSecret: String(secret) };
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
    fail('RUNTIME_NOT_BOUND', 'consumer URL???�어 runtime binding??증명?????�습?�다.');
  }
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    fail('RUNTIME_NOT_BOUND', 'consumer URL ?�식???�바르�? ?�아 runtime binding??거�??�니??');
  }
  if (url.username || url.password || url.search || url.hash) {
    fail('RUNTIME_NOT_BOUND', 'consumer URL???�증?�보/query/fragment가 ?�어 binding??거�??�니??');
  }
  const isLoopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (!isLoopback && url.protocol !== 'https:') {
    fail('RUNTIME_NOT_BOUND', 'consumer URL?� loopback???�니�?https�??�용?�니??');
  }
  if (isProductionHostname(url.hostname)) {
    fail('PRODUCTION_TARGET_REJECTED', 'consumer target???�영 ?�스?�이므�?차단?�니??');
  }
  if (!url.hostname.endsWith('.vercel.app')) {
    fail('RUNTIME_NOT_BOUND', 'consumer target??invocation-bound Preview deployment ?�스?��? ?�닙?�다.');
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
    fail('RUNTIME_NOT_BOUND', 'runtime binding evidence가 ?�어 ?�행??차단?�니??');
  }
  if (evidence.ready !== true) {
    fail('RUNTIME_NOT_BOUND', 'binding evidence가 exact READY ?�태�?증명?��? ?�아 ?�행??차단?�니??');
  }
  const evidenceSha = String(evidence.expectedSha ?? '').trim().toLowerCase();
  if (!evidenceSha || evidenceSha !== sha) {
    fail('EXPECTED_SHA_MISMATCH', 'binding evidence SHA가 --expected-sha?� ?�릅?�다.');
  }
  const shas = evidence.deploymentShas ?? evidence.statusShas ?? {};
  const observedSha = String(shas.consumer ?? '').trim().toLowerCase();
  if (!observedSha || observedSha !== sha) {
    fail('DEPLOYMENT_SHA_MISMATCH', 'consumer 배포 SHA가 지??SHA?� ?�치?��? ?�습?�다.');
  }
  const pinned =
    evidence.pinnedDeploymentIds ?? evidence.deploymentIds ?? evidence.pinnedDeploymentIDs ?? {};
  const pinnedConsumer = pinned.consumer ?? evidence.consumerDeploymentId ?? '';
  if (!isNonEmptyString(pinnedConsumer)) {
    fail('RUNTIME_NOT_BOUND', 'binding evidence??consumer deployment ID가 ?�어 ?�행??차단?�니??');
  }
  if (String(pinnedConsumer).trim() !== id) {
    fail('RUNTIME_BINDING_MISMATCH', 'consumer deployment ID가 evidence binding�??�릅?�다.');
  }
  const targets = evidence.deploymentTargetUrls ?? evidence.statusTargetUrls ?? evidence.targetUrls ?? {};
  const evidenceTarget = targets.consumer ?? '';
  if (!isNonEmptyString(evidenceTarget)) {
    fail('RUNTIME_NOT_BOUND', 'binding evidence??consumer target URL???�어 ?�행??차단?�니??');
  }
  const observed = normalizeConsumerUrl(evidenceTarget);
  if (observed !== consumerUrl) {
    fail('RUNTIME_BINDING_MISMATCH', 'consumer target??evidence binding�??�릅?�다.');
  }
  return { expectedSha: sha, deploymentId: id };
}

export function validateProbeGuards(input = {}, env = process.env) {
  const approval = String(input.approval ?? env.NON_PRODUCTION_AUTH_PROBE_APPROVAL ?? '').trim();
  if (approval !== APPROVAL_VALUE) {
    fail('MISSING_APPROVAL', 'explicit non-production approval???�어 ?�행??차단?�니??');
  }
  const e2eSecret = input.e2eSecret ?? env.E2E_TEST_SECRET ?? '';
  if (!isNonEmptyString(e2eSecret)) {
    fail(
      'CREDENTIAL_SOURCE_UNAVAILABLE',
      'header�?구성???�인??E2E_TEST_SECRET input???�어 callback???�도?��? ?�습?�다.',
    );
  }
  const email = input.email ?? env.TEST_CONSUMER_EMAIL ?? '';
  const password = input.password ?? env.TEST_CONSUMER_PASSWORD ?? '';
  if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
    fail('CONSUMER_CREDENTIALS_MISSING', 'consumer test credential???�어 ?�행??차단?�니??');
  }
  // Vercel passage layer is validated here as well so AUTOMATION_BYPASS
  // without a credential fails closed BEFORE any network call. NONE needs
  // no credential and preserves the historical guard behavior exactly.
  const { protectionPassageMode } = assertProtectionPassageReady(
    {
      protectionPassageMode:
        input.protectionPassageMode ?? env.PROTECTION_PASSAGE_MODE ?? 'NONE',
      protectionBypassSecret: input.protectionBypassSecret,
    },
    env,
  );
  return { approval, protectionPassageMode };
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
  const mode = normalizeProtectionPassageMode(fields.protectionPassageMode ?? 'NONE');
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
    protectionBypassHeaderName: PROTECTION_BYPASS_HEADER_NAME,
    protectionBypassHeaderPresent: fields.protectionBypassHeaderPresent ?? false,
    protectionPassageMode: mode,
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
    fail('PROBE_INTERNAL_ERROR', 'sanitized FAIL key set??고정 계약�??�릅?�다.');
  }
  if (!PROTECTION_PASSAGE_MODES.includes(result.protectionPassageMode)) {
    fail('PROBE_INTERNAL_ERROR', 'protection passage mode가 허용 목록에 없습니다.');
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
  const mode = normalizeProtectionPassageMode(fields.protectionPassageMode ?? 'NONE');
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
    protectionBypassHeaderName: PROTECTION_BYPASS_HEADER_NAME,
    protectionBypassHeaderPresent: fields.protectionBypassHeaderPresent ?? false,
    protectionPassageMode: mode,
    requestBuilder: REQUEST_BUILDER,
    runner: 'PILOT-AUTH-CONSUMER-CALLBACK-PROBE-16',
    sessionState: fields.sessionState,
    setCookiePresent: fields.setCookiePresent,
    workflowSourceSha: fields.workflowSourceSha,
  };
  const keys = Object.keys(artifact).sort();
  const expected = [...ARTIFACT_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail('PROBE_INTERNAL_ERROR', 'sanitized artifact key set??고정 계약�??�릅?�다.');
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
    protectionPassageMode,
    protectionBypassSecret,
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
  const requestedModeRaw =
    protectionPassageMode ?? env.PROTECTION_PASSAGE_MODE ?? 'NONE';
  const safeModeInitial = (() => {
    try {
      return normalizeProtectionPassageMode(requestedModeRaw);
    } catch {
      return 'NONE';
    }
  })();
  const rawBypassForInitial = String(
    protectionBypassSecret ?? env[PROTECTION_BYPASS_CREDENTIAL_ENV] ?? '',
  );
  const protectionPresentInitial =
    safeModeInitial === 'AUTOMATION_BYPASS' && isNonEmptyString(rawBypassForInitial);
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
      protectionBypassHeaderPresent: protectionPresentInitial,
      protectionPassageMode: safeModeInitial,
      sessionAttempted: false,
      sessionState: 'NOT_CHECKED',
      setCookiePresent: null,
      workflowSourceSha: workflowShaValue,
    });
  if (typeof fetch !== 'function') {
    failWithEvidence(
      'PROBE_INTERNAL_ERROR',
      'fetch 구현???�어 probe�??�행?????�습?�다.',
      guardEvidence('PROBE_INTERNAL_ERROR', 'fetch 구현???�어 probe�??�행?????�습?�다.'),
    );
  }
  let base;
  let bound;
  let passage;
  try {
    validateProbeGuards(
      {
        approval: approval ?? env.NON_PRODUCTION_AUTH_PROBE_APPROVAL,
        e2eSecret,
        email,
        password,
        protectionPassageMode: requestedModeRaw,
        protectionBypassSecret,
      },
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
    // Resolve the Vercel passage credential AFTER the shared guards so the
    // mode + credential contract fails closed before any network call.
    // The secret value never leaves this scope except as a request header.
    passage = assertProtectionPassageReady(
      {
        protectionPassageMode: requestedModeRaw,
        protectionBypassSecret,
      },
      env,
    );
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
  // Vercel passage layer (separate): when AUTOMATION_BYPASS is selected,
  // x-vercel-protection-bypass carries the bypass credential on the three
  // Consumer Preview requests (CSRF, callback, session) only. It is never
  // merged with x-e2e-test-token and never sent to any other origin.
  const secret = String(e2eSecret ?? env.E2E_TEST_SECRET ?? '');
  const bypassSecret = String(passage.bypassSecret ?? '');
  const protectionMode = String(passage.protectionPassageMode ?? 'NONE');
  const protectionPresent = protectionMode === 'AUTOMATION_BYPASS' && isNonEmptyString(bypassSecret);
  const headers = { [HEADER_NAME]: secret };
  const bypassHeaders =
    protectionMode === 'AUTOMATION_BYPASS' ? { [PROTECTION_BYPASS_HEADER_NAME]: bypassSecret } : {};
  const csrfHeaders = { ...headers, ...bypassHeaders };
  const callbackHeadersBase = { ...headers, ...bypassHeaders };
  const headerPresent = isNonEmptyString(secret);
  const headerConfigured = headerPresent;
  const observedSha = extractObservedDeploymentSha(evidence);
  const deploymentReady = extractDeploymentReady(evidence);
  if (!headerPresent) {
    const code = 'CREDENTIAL_SOURCE_UNAVAILABLE';
    const message = 'header�?구성???�인??E2E_TEST_SECRET input???�어 callback???�도?��? ?�습?�다.';
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
        protectionBypassHeaderPresent: protectionPresent,
        protectionPassageMode: protectionMode,
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
    requestInit({ method: 'GET', headers: { ...csrfHeaders } }),
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
      protectionBypassHeaderPresent: protectionPresent,
      protectionPassageMode: protectionMode,
      sessionAttempted: false,
      sessionState: 'NOT_CHECKED',
      setCookiePresent: null,
      workflowSourceSha: workflowShaValue,
    });
  };
  if (!csrfRes) {
    const code = 'CSRF_TRANSPORT_FAILED';
    const message = 'CSRF ?�청 ?�송???�패??callback???�도?��? ?�습?�다.';
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
      const message = 'Vercel protection intercept�?CSRF ?�계?�서 차단?�습?�다.';
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
    const message = 'CSRF ?�답??비정?�이??callback???�도?��? ?�습?�다.';
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
    const message = 'CSRF token???�인?��? 못해 callback???�도?��? ?�습?�다.';
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
        ...callbackHeadersBase,
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
      protectionBypassHeaderPresent: protectionPresent,
      protectionPassageMode: protectionMode,
      sessionAttempted: false,
      sessionState: 'NOT_CHECKED',
      setCookiePresent: cookiePresent,
      workflowSourceSha: workflowShaValue,
    });
  };
  if (!callbackRes) {
    const code = 'CALLBACK_TRANSPORT_FAILED';
    const message = 'callback ?�청 ?�송???�패?�습?�다.';
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
      const message = 'Vercel protection intercept�?callback ?�계?�서 차단?�습?�다.';
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
    const message = 'callback application ?�답?�서 ?�증 거절??직접 관찰됐?�니??';
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
      protectionBypassHeaderPresent: protectionPresent,
      protectionPassageMode: protectionMode,
      sessionAttempted: true,
      sessionState: 'NOT_CHECKED',
      setCookiePresent,
      workflowSourceSha: workflowShaValue,
    });
  let sessionFetchThrew = false;
  let sessionRes = null;
  const sessionHeaders = {
    ...bypassHeaders,
    ...(jar.size > 0 ? { Cookie: jarCookieHeader(jar) } : {}),
  };
  try {
    sessionRes = await fetch(
      `${base}/api/auth/session`,
      requestInit({
        method: 'GET',
        headers: { ...sessionHeaders },
      }),
    );
  } catch {
    sessionFetchThrew = true;
    sessionRes = null;
  }
  if (sessionFetchThrew || !sessionRes) {
    const code = 'SESSION_READ_FAILED';
    const message = 'session ?�인 ?�계?�서 ?�송???�패?�습?�다.';
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
      const message = 'Vercel protection intercept�?session ?�계?�서 차단?�습?�다.';
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
          protectionBypassHeaderPresent: protectionPresent,
          protectionPassageMode: protectionMode,
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
    protectionBypassHeaderPresent: protectionPresent,
    protectionPassageMode: protectionMode,
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
        // Vercel passage mode comes from an explicit CLI flag only.
        // The bypass CREDENTIAL itself is NEVER a CLI literal: it is read
        // from VERCEL_AUTOMATION_BYPASS_SECRET env inside the runner.
        protectionPassageMode:
          args['protection-passage-mode'] ?? process.env.PROTECTION_PASSAGE_MODE ?? 'NONE',
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
