/**
 * PILOT-AUTH-SELLER-DRIVER-AUTHJS-BOUNDARY-PROBE-GAP-CLOSURE-34B — role
 * Auth.js callback/session runtime probe (seller|driver).
 *
 * Purpose:
 *   Close the Seller/Driver Auth.js observation gap with the same
 *   runtime-equivalent evidence meaning as the published Consumer callback
 *   probe (scripts/probe-consumer-callback.mjs, read-only reference).
 *   For each role, prove at runtime whether:
 *     Credentials/Auth.js callback → staging API → Set-Cookie →
 *     same-context /api/auth/session
 *   actually passes on the invocation-bound Preview triple.
 *
 * Product semantics locked (this file changes none):
 *   apps/consumer/src/auth.ts, apps/seller/src/auth.ts,
 *   apps/driver/src/auth.ts, API LoginDto/auth service/controller,
 *   credential admission, email validator, role/driverApproved/store
 *   policy, session/JWT policy. Consumer API 400 is NOT fixed here.
 *
 * Per-role application credential layer (mirrors current main, read-only):
 *   seller: x-e2e-test-token <- E2E_TEST_SECRET (same as consumer)
 *           authorize requires header match, then POST staging /auth/login,
 *           admits role seller|admin + storeId binding.
 *   driver: x-round-direct-e2e-secret <- ROUND_DIRECT_E2E_SHARED_SECRET
 *           (preview E2E gate: VERCEL_ENV=preview + ROUND_DIRECT_E2E_ENABLED
 *           + shared-secret match + ROUND_DIRECT_E2E_DRIVER_EMAILS allowlist),
 *           then POST staging /auth/login, admits role driver +
 *           driverApproved=true.
 *   The two layers are never merged. Secret values never leave this scope
 *   except as request headers; only key names + presence booleans enter
 *   evidence.
 *
 * Vercel protection passage (same approved mechanism as Consumer):
 *   --protection-passage-mode=NONE | AUTOMATION_BYPASS. AUTOMATION_BYPASS
 *   attaches x-vercel-protection-bypass (from VERCEL_AUTOMATION_BYPASS_SECRET
 *   env only; workflow maps it from the existing role bypass secret:
 *   ROUND_DIRECT_E2E_SELLER_BYPASS_SECRET / ROUND_DIRECT_E2E_DRIVER_BYPASS_SECRET)
 *   to the three role Preview requests only (CSRF, callback, session).
 *   CLI literals, logs, and secret-derived diagnostics are forbidden.
 *   Missing credential fails closed BEFORE any network call.
 *
 * Lifecycle per role (P0..P8):
 *   P0 Preview deployment/edge reachable (CSRF GET).
 *   P1 Auth.js Credentials path entered with approved bypass + application
 *      credential header.
 *   P2 credentialed callback POST actually dispatched.
 *   P3 callback reached the expected staging API origin (fingerprint
 *      comparison; absent/unparseable expected origin yields null, never a
 *      failure).
 *   P4 upstream response class (2xx / application 4xx / binding failure).
 *   P5 Auth.js callback classification (status + Location/error code).
 *   P6 Set-Cookie/session cookie emitted (presence only).
 *   P7 same in-memory cookie jar /api/auth/session readback:
 *      VALID / INVALID / NOT_CHECKED (transport UNAVAILABLE is an explicit
 *      FAIL with sessionAttempted=true; application INVALID stays SUCCESS).
 *   P8 VALID identity/session contract (presence/allowlist only, never values):
 *      seller: user.role in {seller,admin} + non-empty string storeId binding.
 *      driver: user.role == driver. driverApproved/suspended are enforced at
 *        authorize time via staging /auth/login (direct-API PASS evidence
 *        proves driverApproved=true for the same seed); the NextAuth session
 *        does not carry driverApproved/suspended fields, so VALID implies the
 *        authorize gate passed. This limitation is recorded, not hidden.
 *
 * Non-sensitive evidence ONLY (fixed key set, see ARTIFACT_KEYS):
 *   no emails, passwords, tokens, cookies, secrets, hashes, fingerprints of
 *   secrets, lengths, or raw Location URLs/bodies.
 *
 * Exit codes: 0 whenever the callback path was executed and a sanitized
 * artifact was produced (ANY gate outcome is adjudicable evidence);
 * 1 only on fail-closed contract violations (no callback attempted).
 *
 * Usage (via the approved workflow with Environment-injected secrets):
 *   node scripts/probe-authjs-role-callback.mjs \
 *     --role=seller \
 *     --expected-sha=<40hex> \
 *     --target-url=https://<invocation-bound-seller-preview> \
 *     --deployment-id=dpl_... \
 *     --evidence-json=.artifacts/.../probe-evidence.json \
 *     --expected-api-origin=https://<staging-api-origin> \
 *     --approval=NON_PRODUCTION_AUTH_PROBE_APPROVED \
 *     --protection-passage-mode=AUTOMATION_BYPASS
 *
 * Secrets come from env (never logged, never serialized):
 *   seller: E2E_TEST_SECRET, TEST_SELLER_EMAIL, TEST_SELLER_PASSWORD
 *   driver: ROUND_DIRECT_E2E_SHARED_SECRET, TEST_DRIVER_EMAIL,
 *           TEST_DRIVER_PASSWORD
 *   both:   VERCEL_AUTOMATION_BYPASS_SECRET (AUTOMATION_BYPASS only)
 */

import { createHash as nodeCreateHash } from 'node:crypto';

export const APPROVAL_VALUE = 'NON_PRODUCTION_AUTH_PROBE_APPROVED';

export const ROLES = Object.freeze(['seller', 'driver']);

// Per-role application credential layer. Header names and credential-source
// labels are provenance metadata only; values never enter evidence.
export const ROLE_CONFIG = Object.freeze({
  seller: Object.freeze({
    headerName: 'x-e2e-test-token',
    credentialSource: 'E2E_TEST_SECRET',
    secretEnv: 'E2E_TEST_SECRET',
    emailEnv: 'TEST_SELLER_EMAIL',
    passwordEnv: 'TEST_SELLER_PASSWORD',
    allowedSessionRoles: Object.freeze(['seller', 'admin']),
    requestBuilder: 'scripts/probe-authjs-role-callback.mjs#runRoleCallbackProbe:seller',
  }),
  driver: Object.freeze({
    headerName: 'x-round-direct-e2e-secret',
    credentialSource: 'ROUND_DIRECT_E2E_SHARED_SECRET',
    secretEnv: 'ROUND_DIRECT_E2E_SHARED_SECRET',
    emailEnv: 'TEST_DRIVER_EMAIL',
    passwordEnv: 'TEST_DRIVER_PASSWORD',
    allowedSessionRoles: Object.freeze(['driver']),
    requestBuilder: 'scripts/probe-authjs-role-callback.mjs#runRoleCallbackProbe:driver',
  }),
});

export const PROTECTION_BYPASS_HEADER_NAME = 'x-vercel-protection-bypass';
export const PROTECTION_BYPASS_CREDENTIAL_ENV = 'VERCEL_AUTOMATION_BYPASS_SECRET';
export const PROTECTION_PASSAGE_MODES = Object.freeze(['NONE', 'AUTOMATION_BYPASS']);

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;

const KNOWN_AUTH_ERROR_CLASSES = Object.freeze([
  'authorize-rejected',
  'upstream-rejected',
  'api-binding-failure',
]);

export const UPSTREAM_DIAGNOSTIC_CODE_PREFIX = 'upstream-rejected';
export const UPSTREAM_ORIGIN_FINGERPRINT_HEX_LENGTH = 16;
const UPSTREAM_DIAGNOSTIC_CODE_PATTERN =
  /^upstream-rejected__s(\d{1,3})__o([0-9a-f]{16})(?:__l([A-Z_]+(?:\+[A-Z_]+)*))?$/;

// Result verdicts (section 6, closed allowlist).
export const ROLE_VERDICTS = Object.freeze([
  'AUTHJS_SESSION_VALID',
  'EXPECTED_APPLICATION_REJECTION',
  'AUTHJS_CALLBACK_REJECTED',
  'EDGE_OR_PROTECTION_BLOCKED',
  'API_BINDING_FAILURE',
  'IDENTITY_CONTRACT_FAILURE',
  'INCONCLUSIVE',
]);

// Session contract states (P8, presence/allowlist only).
export const SESSION_CONTRACT_STATES = Object.freeze(['PASS', 'FAIL', 'NOT_CHECKED']);

// Exact sanitized artifact key set. No secret/token/cookie/email/password
// value is structurally representable here.
export const ARTIFACT_KEYS = Object.freeze([
  'artifact',
  'authErrorClass',
  'callbackLocationClass',
  'callbackStatus',
  'checkedAt',
  'credentialSource',
  'deploymentId',
  'deploymentSourceSha',
  'expectedApiOriginFingerprint',
  'headerName',
  'headerPresent',
  'protectionBypassHeaderName',
  'protectionBypassHeaderPresent',
  'protectionPassageMode',
  'requestBuilder',
  'role',
  'runner',
  'sessionContract',
  'sessionRoleAdmitted',
  'sessionState',
  'sessionStoreBindingPresent',
  'setCookiePresent',
  'upstreamOriginFingerprint',
  'upstreamOriginMatchesExpected',
  'upstreamStatus',
  'verdict',
  'workflowSourceSha',
]);

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
  'role',
  'runner',
  'sessionAttempted',
  'sessionState',
  'setCookiePresent',
  'verdict',
  'workflowSourceSha',
]);

export const RUNNER_ID = 'PILOT-AUTH-ROLE-CALLBACK-PROBE-34B';
export const ARTIFACT_ID = 'pilot-auth-role-callback-input-binding-proof-34B';
export const PROTECTION_LOCATION_CLASS = 'VERCEL_SSO_PROTECTION';
export const FAILURE_STAGE_GUARD = 'guard';
export const FAILURE_STAGE_CSRF = 'csrf';
export const FAILURE_STAGE_CALLBACK = 'callback';
export const FAILURE_STAGE_SESSION = 'session';

export class RoleCallbackProbeContractError extends Error {
  constructor(code, message, evidence = null) {
    super(message);
    this.name = 'RoleCallbackProbeContractError';
    this.code = code;
    if (evidence !== null) {
      this.evidence = evidence;
    }
  }
}

function fail(code, message) {
  throw new RoleCallbackProbeContractError(code, message);
}

function failWithEvidence(code, message, evidence) {
  throw new RoleCallbackProbeContractError(code, message, evidence);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Closed role allowlist. Unknown roles fail closed. */
export function assertRole(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'seller' || normalized === 'driver') return normalized;
  fail('UNKNOWN_ROLE', 'role은 seller|driver 중 하나여야 합니다.');
}

export function roleConfig(role) {
  const normalized = assertRole(role);
  return ROLE_CONFIG[normalized];
}

export function assertExpectedSha(value) {
  if (!isNonEmptyString(value)) {
    fail('EXPECTED_SHA_REQUIRED', 'expected SHA가 없습니다. --expected-sha=<40hex>가 필요합니다.');
  }
  const normalized = String(value).trim().toLowerCase();
  if (!SHA_PATTERN.test(normalized)) {
    fail('EXPECTED_SHA_MALFORMED', 'expected SHA 형식이 바르지 않습니다 (40자리 소문자 16진수).');
  }
  return normalized;
}

export function assertDeploymentId(value) {
  if (!isNonEmptyString(value) || !DEPLOYMENT_ID_PATTERN.test(String(value).trim())) {
    fail('DEPLOYMENT_ID_MALFORMED', 'pinned Vercel deployment ID 형식이 바르지 않습니다.');
  }
  return String(value).trim();
}

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

export function isProductionHostname(hostname) {
  const host = String(hostname ?? '').toLowerCase();
  if (!host) return true;
  if (host === 'greenlove.co.kr' || host.endsWith('.greenlove.co.kr')) return true;
  if (host.startsWith('api-production-')) return true;
  if (host === 'api-production-13e7.up.railway.app') return true;
  return false;
}

/**
 * Invocation-bound Preview target URL guard. Loopback is allowed for local
 * deterministic harnesses; otherwise https + *.vercel.app + non-production.
 */
export function normalizeTargetUrl(value, role) {
  const normalizedRole = assertRole(role);
  if (!isNonEmptyString(value)) {
    fail('RUNTIME_NOT_BOUND', `${normalizedRole} URL이 없어 runtime binding을 증명할 수 없습니다.`);
  }
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    fail('RUNTIME_NOT_BOUND', `${normalizedRole} URL 형식이 바르지 않아 runtime binding을 거부합니다.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    fail('RUNTIME_NOT_BOUND', `${normalizedRole} URL에 인증정보/query/fragment가 있어 binding을 거부합니다.`);
  }
  const isLoopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (!isLoopback && url.protocol !== 'https:') {
    fail('RUNTIME_NOT_BOUND', `${normalizedRole} URL은 loopback이 아니면 https만 사용합니다.`);
  }
  if (isProductionHostname(url.hostname)) {
    fail('PRODUCTION_TARGET_REJECTED', `${normalizedRole} target이 운영 호스트이므로 차단합니다.`);
  }
  if (!isLoopback && !url.hostname.endsWith('.vercel.app')) {
    fail('RUNTIME_NOT_BOUND', `${normalizedRole} target이 invocation-bound Preview deployment 호스트가 아닙니다.`);
  }
  return url.toString().replace(/\/$/, '');
}

export function assertInvocationBinding({ deploymentId, expectedSha }) {
  const id = assertDeploymentId(deploymentId);
  const sha = assertExpectedSha(expectedSha);
  return { deploymentId: id, expectedSha: sha };
}

/**
 * Evidence binding (role slice of wait-preview-deploy JSON): the
 * invocation-bound deployment id + expected SHA + exact target URL must all
 * agree with provider deployment metadata before any network call.
 */
export function validateEvidenceBinding({ expectedSha, deploymentId, targetUrl, role, evidence }) {
  const normalizedRole = assertRole(role);
  const sha = assertExpectedSha(expectedSha);
  const id = assertDeploymentId(deploymentId);
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    fail('RUNTIME_NOT_BOUND', 'runtime binding evidence가 없어 실행을 차단합니다.');
  }
  if (evidence.ready !== true) {
    fail('RUNTIME_NOT_BOUND', 'binding evidence가 exact READY 상태를 증명하지 않아 실행을 차단합니다.');
  }
  const evidenceSha = String(evidence.expectedSha ?? '').trim().toLowerCase();
  if (!evidenceSha || evidenceSha !== sha) {
    fail('EXPECTED_SHA_MISMATCH', 'binding evidence SHA가 --expected-sha와 다릅니다.');
  }
  const shas = evidence.deploymentShas ?? evidence.statusShas ?? {};
  const observedSha = String(shas[normalizedRole] ?? '').trim().toLowerCase();
  if (!observedSha || observedSha !== sha) {
    fail('DEPLOYMENT_SHA_MISMATCH', `${normalizedRole} 배포 SHA가 지정 SHA와 일치하지 않습니다.`);
  }
  const pinned =
    evidence.pinnedDeploymentIds ?? evidence.deploymentIds ?? evidence.pinnedDeploymentIDs ?? {};
  const pinnedRole = pinned[normalizedRole] ?? '';
  if (!isNonEmptyString(pinnedRole)) {
    fail('RUNTIME_NOT_BOUND', `binding evidence에 ${normalizedRole} deployment ID가 없어 실행을 차단합니다.`);
  }
  if (String(pinnedRole).trim() !== id) {
    fail('RUNTIME_BINDING_MISMATCH', `${normalizedRole} deployment ID가 evidence binding과 다릅니다.`);
  }
  const targets = evidence.deploymentTargetUrls ?? evidence.statusTargetUrls ?? evidence.targetUrls ?? {};
  const evidenceTarget = targets[normalizedRole] ?? '';
  if (!isNonEmptyString(evidenceTarget)) {
    fail('RUNTIME_NOT_BOUND', `binding evidence에 ${normalizedRole} target URL이 없어 실행을 차단합니다.`);
  }
  const observed = normalizeTargetUrl(evidenceTarget, normalizedRole);
  if (observed !== targetUrl) {
    fail('RUNTIME_BINDING_MISMATCH', `${normalizedRole} target이 evidence binding과 다릅니다.`);
  }
  return { expectedSha: sha, deploymentId: id };
}

/**
 * Fail-closed guards BEFORE any network call: approval, per-role
 * application secret presence, per-role credential presence, Vercel passage
 * readiness. Values never enter messages or evidence.
 */
export function validateProbeGuards(input = {}, env = process.env) {
  const role = assertRole(input.role ?? input.targetRole);
  const config = ROLE_CONFIG[role];
  const approval = String(input.approval ?? env.NON_PRODUCTION_AUTH_PROBE_APPROVAL ?? '').trim();
  if (approval !== APPROVAL_VALUE) {
    fail('MISSING_APPROVAL', 'explicit non-production approval이 없어 실행을 차단합니다.');
  }
  const appSecret = input.appSecret ?? input.e2eSecret ?? input.sharedSecret ?? env[config.secretEnv] ?? '';
  if (!isNonEmptyString(appSecret)) {
    fail(
      'CREDENTIAL_SOURCE_UNAVAILABLE',
      `${role} application credential source(${config.credentialSource})가 없어 callback을 시도할 수 없습니다.`,
    );
  }
  const email = input.email ?? env[config.emailEnv] ?? '';
  const password = input.password ?? env[config.passwordEnv] ?? '';
  if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
    fail(`${role.toUpperCase()}_CREDENTIALS_MISSING`, `${role} test credential이 없어 실행을 차단합니다.`);
  }
  const { protectionPassageMode } = assertProtectionPassageReady(
    {
      protectionPassageMode:
        input.protectionPassageMode ?? env.PROTECTION_PASSAGE_MODE ?? 'NONE',
      protectionBypassSecret: input.protectionBypassSecret,
    },
    env,
  );
  return { role, approval, protectionPassageMode };
}

// ---- Safe classifiers (pure, no network) -----------------------------------

export function classifyLocationClass(pathname) {
  if (pathname === '/' || pathname === '') return 'ROOT';
  if (typeof pathname === 'string' && pathname.startsWith('/login')) return 'LOGIN_ERROR';
  return 'OTHER';
}

export function parseUpstreamDiagnosticCode(value) {
  if (typeof value !== 'string' || !value) return null;
  const match = UPSTREAM_DIAGNOSTIC_CODE_PATTERN.exec(value);
  if (!match) return null;
  const status = Number(match[1]);
  if (!Number.isInteger(status) || status < 100 || status > 599) return null;
  return {
    topClass: UPSTREAM_DIAGNOSTIC_CODE_PREFIX,
    upstreamStatus: status,
    upstreamOriginFingerprint: match[2],
  };
}

export function classifyAuthError({ status, codeParam, errorParam }) {
  if (KNOWN_AUTH_ERROR_CLASSES.includes(codeParam)) return codeParam;
  if (parseUpstreamDiagnosticCode(codeParam)) return UPSTREAM_DIAGNOSTIC_CODE_PREFIX;
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
  if (parseUpstreamDiagnosticCode(value)) return value;
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

export function extractObservedDeploymentSha(evidence, role) {
  try {
    const normalized = String(role ?? '').trim().toLowerCase();
    const shas = evidence?.deploymentShas ?? evidence?.statusShas ?? {};
    const value = String(shas[normalized] ?? '').trim().toLowerCase();
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

export function canonicalUpstreamOrigin(value) {
  try {
    const url = new URL(String(value));
    const protocol = String(url.protocol ?? '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function fingerprintUpstreamOrigin(canonicalOrigin) {
  try {
    if (typeof canonicalOrigin !== 'string' || !canonicalOrigin) return null;
    const canonical = canonicalUpstreamOrigin(canonicalOrigin);
    if (!canonical) return null;
    return nodeCreateHash('sha256')
      .update(canonical, 'utf8')
      .digest('hex')
      .slice(0, UPSTREAM_ORIGIN_FINGERPRINT_HEX_LENGTH);
  } catch {
    return null;
  }
}

export function resolveExpectedApiOrigin(input = {}, env = process.env) {
  const raw =
    input?.expectedApiOrigin ??
    env?.ROUND_DIRECT_E2E_API_ORIGIN ??
    env?.AUTH_PROBE_API_ORIGIN ??
    '';
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return canonicalUpstreamOrigin(raw.trim());
}

// ---- Session contract (P8, presence/allowlist only) ------------------------

/**
 * Evaluate the P8 identity/session contract from the already-parsed session
 * user record. Only presence and allowlist membership are observed; no
 * values, lengths, or hashes leave this function.
 *
 * seller: user.role in {seller,admin} AND user.storeId is a non-empty string.
 * driver: user.role == driver. driverApproved/suspended are enforced at
 *   authorize time via staging /auth/login (VALID implies that gate passed);
 *   the NextAuth session carries neither field.
 *
 * Returns { contract, roleAdmitted, storeBindingPresent } where contract is
 * PASS | FAIL and the booleans are presence-only observations.
 */
export function evaluateSessionContract(role, sessionUser) {
  const normalized = assertRole(role);
  const user =
    sessionUser && typeof sessionUser === 'object' && !Array.isArray(sessionUser)
      ? sessionUser
      : null;
  if (!user) {
    return { contract: 'FAIL', roleAdmitted: false, storeBindingPresent: normalized === 'seller' ? false : null };
  }
  const config = ROLE_CONFIG[normalized];
  const roleValue = typeof user.role === 'string' ? user.role : '';
  const roleAdmitted = config.allowedSessionRoles.includes(roleValue);
  if (normalized === 'seller') {
    const storeId = user.storeId;
    const storeBindingPresent = typeof storeId === 'string' && storeId.length > 0;
    return {
      contract: roleAdmitted && storeBindingPresent ? 'PASS' : 'FAIL',
      roleAdmitted,
      storeBindingPresent,
    };
  }
  return {
    contract: roleAdmitted ? 'PASS' : 'FAIL',
    roleAdmitted,
    storeBindingPresent: null,
  };
}

/**
 * Classify the session readback body into VALID / INVALID (application
 * states). Transport failures are handled by the caller as explicit FAILs
 * (task UNAVAILABLE). Presence of a non-empty string user.accessToken is the
 * sole VALID signal; no token value is observed.
 */
export function classifySessionState(sessionBody) {
  try {
    const user =
      sessionBody && typeof sessionBody === 'object' && !Array.isArray(sessionBody)
        ? sessionBody.user
        : null;
    const record =
      user && typeof user === 'object' && !Array.isArray(user) ? user : null;
    const token = record?.accessToken;
    return typeof token === 'string' && token.length > 0 ? 'VALID' : 'INVALID';
  } catch {
    return 'INVALID';
  }
}

// ---- Verdict classification (section 6) ------------------------------------

/**
 * Map sanitized artifact/FAIL evidence to the closed role verdict set.
 * Direct API login PASS must never be mapped to AUTHJS_SESSION_VALID here;
 * only same-context Auth.js session VALID + contract PASS qualifies.
 */
export function classifyRoleVerdict(evidence) {
  if (!evidence || typeof evidence !== 'object') return 'INCONCLUSIVE';
  const failureCode = evidence.failureCode ?? null;
  if (failureCode === 'DEPLOYMENT_PROTECTION_INTERCEPTED') return 'EDGE_OR_PROTECTION_BLOCKED';
  if (evidence.result === 'FAIL') {
    if (failureCode === 'CALLBACK_REJECTED') return 'AUTHJS_CALLBACK_REJECTED';
    if (
      failureCode === 'CSRF_TRANSPORT_FAILED' ||
      failureCode === 'CALLBACK_TRANSPORT_FAILED' ||
      failureCode === 'SESSION_READ_FAILED'
    ) {
      return 'API_BINDING_FAILURE';
    }
    const authClass = evidence.authErrorClass ?? null;
    if (authClass === 'api-binding-failure') return 'API_BINDING_FAILURE';
    if (authClass === 'authorize-rejected' || authClass === 'upstream-rejected') {
      return 'EXPECTED_APPLICATION_REJECTION';
    }
    return 'INCONCLUSIVE';
  }
  // SUCCESS artifact path.
  if (evidence.sessionState === 'VALID') {
    if (evidence.sessionContract === 'FAIL') return 'IDENTITY_CONTRACT_FAILURE';
    if (evidence.sessionContract === 'PASS') return 'AUTHJS_SESSION_VALID';
    return 'INCONCLUSIVE';
  }
  if (evidence.sessionState === 'INVALID') return 'EXPECTED_APPLICATION_REJECTION';
  return 'INCONCLUSIVE';
}

// ---- Evidence builders (closed key sets) -----------------------------------

export function buildFailureResult(fields = {}) {
  const role = assertRole(fields.role);
  const config = ROLE_CONFIG[role];
  const mode = normalizeProtectionPassageMode(fields.protectionPassageMode ?? 'NONE');
  const verdict = ROLE_VERDICTS.includes(fields.verdict) ? fields.verdict : 'INCONCLUSIVE';
  const result = {
    authErrorClass: fields.authErrorClass ?? null,
    callbackAttempted: fields.callbackAttempted ?? false,
    callbackLocationClass: fields.callbackLocationClass ?? 'NONE',
    callbackStatus: fields.callbackStatus ?? null,
    checkedAt: fields.checkedAt ?? new Date().toISOString(),
    credentialSource: config.credentialSource,
    csrfStatus: fields.csrfStatus ?? null,
    deploymentId: fields.deploymentId ?? null,
    deploymentReady: fields.deploymentReady ?? null,
    deploymentSourceSha: fields.deploymentSourceSha ?? null,
    expectedSha: fields.expectedSha ?? null,
    failureCode: fields.failureCode ?? 'PROBE_INTERNAL_ERROR',
    failureStage: fields.failureStage ?? FAILURE_STAGE_GUARD,
    headerAttachedByRunner: fields.headerAttachedByRunner ?? false,
    headerConfigured: fields.headerConfigured ?? false,
    headerName: config.headerName,
    headerPresent: fields.headerPresent ?? false,
    httpStatus: fields.httpStatus ?? null,
    locationClass: fields.locationClass ?? 'NONE',
    message: fields.message ?? '',
    observedDeploymentSha: fields.observedDeploymentSha ?? null,
    protectionBypassHeaderName: PROTECTION_BYPASS_HEADER_NAME,
    protectionBypassHeaderPresent: fields.protectionBypassHeaderPresent ?? false,
    protectionPassageMode: mode,
    requestBuilder: config.requestBuilder,
    result: 'FAIL',
    role,
    runner: RUNNER_ID,
    sessionAttempted: fields.sessionAttempted ?? false,
    sessionState: fields.sessionState ?? 'NOT_CHECKED',
    setCookiePresent: fields.setCookiePresent ?? null,
    verdict,
    workflowSourceSha: fields.workflowSourceSha ?? 'local-unpublished',
  };
  const keys = Object.keys(result).sort();
  const expected = [...FAIL_RESULT_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail('PROBE_INTERNAL_ERROR', 'sanitized role FAIL key set이 고정 계약과 다릅니다.');
  }
  return result;
}

export function buildRoleArtifact(fields) {
  const role = assertRole(fields.role);
  const config = ROLE_CONFIG[role];
  const mode = normalizeProtectionPassageMode(fields.protectionPassageMode ?? 'NONE');
  const sessionState = fields.sessionState;
  if (sessionState !== 'VALID' && sessionState !== 'INVALID') {
    fail('PROBE_INTERNAL_ERROR', 'sessionState는 VALID|INVALID 중 하나여야 합니다.');
  }
  const contract = fields.sessionContract;
  if (!SESSION_CONTRACT_STATES.includes(contract) || contract === 'NOT_CHECKED') {
    // SUCCESS artifacts always carry a decided contract; NOT_CHECKED is FAIL-only.
    if (sessionState === 'VALID' || sessionState === 'INVALID') {
      if (!SESSION_CONTRACT_STATES.includes(contract)) {
        fail('PROBE_INTERNAL_ERROR', 'sessionContract 상태가 허용 목록에 없습니다.');
      }
    }
  }
  const verdict = classifyRoleVerdict({
    result: 'SUCCESS',
    sessionState,
    sessionContract: contract,
    authErrorClass: fields.authErrorClass ?? null,
  });
  const artifact = {
    artifact: ARTIFACT_ID,
    authErrorClass: fields.authErrorClass,
    callbackLocationClass: fields.callbackLocationClass,
    callbackStatus: fields.callbackStatus,
    checkedAt: fields.checkedAt,
    credentialSource: config.credentialSource,
    deploymentId: fields.deploymentId,
    deploymentSourceSha: fields.deploymentSourceSha,
    expectedApiOriginFingerprint: fields.expectedApiOriginFingerprint ?? null,
    headerName: config.headerName,
    headerPresent: fields.headerPresent,
    protectionBypassHeaderName: PROTECTION_BYPASS_HEADER_NAME,
    protectionBypassHeaderPresent: fields.protectionBypassHeaderPresent ?? false,
    protectionPassageMode: mode,
    requestBuilder: config.requestBuilder,
    role,
    runner: RUNNER_ID,
    sessionContract: contract,
    sessionRoleAdmitted: fields.sessionRoleAdmitted ?? null,
    sessionState,
    sessionStoreBindingPresent: role === 'seller' ? (fields.sessionStoreBindingPresent ?? null) : null,
    setCookiePresent: fields.setCookiePresent,
    upstreamOriginFingerprint: fields.upstreamOriginFingerprint ?? null,
    upstreamOriginMatchesExpected: fields.upstreamOriginMatchesExpected ?? null,
    upstreamStatus: fields.upstreamStatus ?? null,
    verdict,
    workflowSourceSha: fields.workflowSourceSha,
  };
  const keys = Object.keys(artifact).sort();
  const expected = [...ARTIFACT_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail('PROBE_INTERNAL_ERROR', 'sanitized role artifact key set이 고정 계약과 다릅니다.');
  }
  return artifact;
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

// ---- Main role lifecycle ----------------------------------------------------

/**
 * One role callback provenance lifecycle against the invocation-bound role
 * Preview deployment: CSRF -> credentials callback POST -> same-jar session
 * readback. Returns { artifact, calls } where calls is the non-sensitive
 * list of request paths.
 */
export async function runRoleCallbackProbe(
  {
    role,
    targetUrl,
    expectedSha,
    deploymentId,
    evidence,
    appSecret,
    e2eSecret,
    sharedSecret,
    email,
    password,
    approval,
    protectionPassageMode,
    protectionBypassSecret,
    expectedApiOrigin,
    workflowSha = '',
    checkedAt = '',
    fetchImpl,
  } = {},
  deps = {},
) {
  const normalizedRole = assertRole(role);
  const config = ROLE_CONFIG[normalizedRole];
  const env = deps.env ?? process.env;
  const fetch = deps.fetchImpl ?? fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const workflowShaValue = String(workflowSha || env.GITHUB_SHA || 'local-unpublished');
  const checkedAtValue = String(checkedAt || new Date().toISOString());
  // Per-role application secret: seller E2E_TEST_SECRET, driver shared secret.
  const rawSecretForEvidence = String(
    appSecret ?? e2eSecret ?? sharedSecret ?? env[config.secretEnv] ?? '',
  );
  const headerConfiguredInitial = isNonEmptyString(rawSecretForEvidence);
  const observedShaInitial = extractObservedDeploymentSha(evidence, normalizedRole);
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
  const guardEvidence = (code, message, verdict = 'INCONCLUSIVE') =>
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
      role: normalizedRole,
      sessionAttempted: false,
      sessionState: 'NOT_CHECKED',
      setCookiePresent: null,
      verdict,
      workflowSourceSha: workflowShaValue,
    });
  if (typeof fetch !== 'function') {
    failWithEvidence(
      'PROBE_INTERNAL_ERROR',
      'fetch 구현이 없어 probe를 실행할 수 없습니다.',
      guardEvidence('PROBE_INTERNAL_ERROR', 'fetch 구현이 없어 probe를 실행할 수 없습니다.'),
    );
  }
  let base;
  let bound;
  let passage;
  try {
    validateProbeGuards(
      {
        role: normalizedRole,
        approval: approval ?? env.NON_PRODUCTION_AUTH_PROBE_APPROVAL,
        appSecret: appSecret ?? e2eSecret ?? sharedSecret,
        email,
        password,
        protectionPassageMode: requestedModeRaw,
        protectionBypassSecret,
      },
      env,
    );
    base = normalizeTargetUrl(targetUrl, normalizedRole);
    bound = assertInvocationBinding({ deploymentId, expectedSha });
    validateEvidenceBinding({
      expectedSha: bound.expectedSha,
      deploymentId: bound.deploymentId,
      targetUrl: base,
      role: normalizedRole,
      evidence,
    });
    passage = assertProtectionPassageReady(
      {
        protectionPassageMode: requestedModeRaw,
        protectionBypassSecret,
      },
      env,
    );
  } catch (error) {
    if (error instanceof RoleCallbackProbeContractError && error.evidence) throw error;
    const code = error instanceof RoleCallbackProbeContractError ? error.code : 'PROBE_INTERNAL_ERROR';
    const message = String(error?.message ?? error);
    failWithEvidence(code, message, guardEvidence(code, message));
  }

  const secret = String(appSecret ?? e2eSecret ?? sharedSecret ?? env[config.secretEnv] ?? '');
  const bypassSecret = String(passage.bypassSecret ?? '');
  const protectionMode = String(passage.protectionPassageMode ?? 'NONE');
  const protectionPresent = protectionMode === 'AUTOMATION_BYPASS' && isNonEmptyString(bypassSecret);
  const expectedApiCanonical = resolveExpectedApiOrigin({ expectedApiOrigin }, env);
  const expectedApiOriginFingerprint = expectedApiCanonical
    ? fingerprintUpstreamOrigin(expectedApiCanonical)
    : null;
  const headers = { [config.headerName]: secret };
  const bypassHeaders =
    protectionMode === 'AUTOMATION_BYPASS' ? { [PROTECTION_BYPASS_HEADER_NAME]: bypassSecret } : {};
  const csrfHeaders = { ...headers, ...bypassHeaders };
  const callbackHeadersBase = { ...headers, ...bypassHeaders };
  const headerPresent = isNonEmptyString(secret);
  const headerConfigured = headerPresent;
  const observedSha = extractObservedDeploymentSha(evidence, normalizedRole);
  const deploymentReady = extractDeploymentReady(evidence);
  if (!headerPresent) {
    const code = 'CREDENTIAL_SOURCE_UNAVAILABLE';
    const message = `${normalizedRole} header를 구성할 application secret이 없어 callback을 시도할 수 없습니다.`;
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
        role: normalizedRole,
        sessionAttempted: false,
        sessionState: 'NOT_CHECKED',
        setCookiePresent: null,
        verdict: 'INCONCLUSIVE',
        workflowSourceSha: workflowShaValue,
      }),
    );
  }
  const headerAttachedByRunner = true;

  const calls = [];
  const jar = new Map();
  const requestInit = (extra = {}) => ({ redirect: 'manual', ...extra });

  // P0/P1: CSRF with the same header object as the callback POST.
  const csrfRes = await fetch(
    `${base}/api/auth/csrf`,
    requestInit({ method: 'GET', headers: { ...csrfHeaders } }),
  ).catch(() => null);
  calls.push('/api/auth/csrf');
  const csrfFail = (code, message, { csrfStatus = null, locationValue = null, isProtection = false, verdict = 'INCONCLUSIVE' } = {}) => {
    const locationClass = classifyFailureLocation({ locationValue, base, isProtection });
    return buildFailureResult({
      authErrorClass: isProtection ? 'NONE' : null,
      callbackAttempted: false,
      callbackLocationClass: locationClass,
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
      role: normalizedRole,
      sessionAttempted: false,
      sessionState: 'NOT_CHECKED',
      setCookiePresent: null,
      verdict,
      workflowSourceSha: workflowShaValue,
    });
  };
  if (!csrfRes) {
    const code = 'CSRF_TRANSPORT_FAILED';
    const message = 'CSRF 요청 전송에 실패해 callback을 시도할 수 없습니다.';
    failWithEvidence(code, message, csrfFail(code, message, { csrfStatus: null, verdict: 'API_BINDING_FAILURE' }));
  }
  {
    const csrfStatusObserved = typeof csrfRes.status === 'number' ? csrfRes.status : 0;
    const csrfLocation = readLocationHeader(csrfRes.headers);
    const csrfContentType = readContentType(csrfRes.headers);
    if (
      isProtectionIntercept({
        status: csrfStatusObserved,
        contentType: csrfContentType,
        locationValue: csrfLocation,
        base,
      })
    ) {
      const code = 'DEPLOYMENT_PROTECTION_INTERCEPTED';
      const message = 'Vercel protection intercept이 CSRF 단계에서 차단했습니다.';
      failWithEvidence(
        code,
        message,
        csrfFail(code, message, {
          csrfStatus: csrfStatusObserved,
          locationValue: csrfLocation,
          isProtection: true,
          verdict: 'EDGE_OR_PROTECTION_BLOCKED',
        }),
      );
    }
  }
  storeCookies(jar, csrfRes.headers);
  const csrfStatus = typeof csrfRes.status === 'number' ? csrfRes.status : 0;
  const csrfOk = csrfRes.ok === true || (csrfStatus >= 200 && csrfStatus < 300);
  if (!csrfOk) {
    const code = 'CSRF_TRANSPORT_FAILED';
    const message = 'CSRF 응답이 비정상이라 callback을 시도할 수 없습니다.';
    failWithEvidence(code, message, csrfFail(code, message, { csrfStatus, verdict: 'API_BINDING_FAILURE' }));
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
    const code = 'CSRF_TRANSPORT_FAILED';
    const message = 'CSRF token을 확인할 수 없어 callback을 시도할 수 없습니다.';
    failWithEvidence(code, message, csrfFail(code, message, { csrfStatus, verdict: 'API_BINDING_FAILURE' }));
  }

  // P2: Credentials callback POST (the request under proof — must execute).
  const resolvedEmail = String(email ?? env[config.emailEnv] ?? '');
  const resolvedPassword = String(password ?? env[config.passwordEnv] ?? '');
  const form = new URLSearchParams();
  form.set('email', resolvedEmail);
  form.set('password', resolvedPassword);
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
    { callbackStatus: cbStatus = null, locationValue: loc = null, isProtection = false, authClass = null, cookiePresent = null, verdict = 'INCONCLUSIVE' } = {},
  ) => {
    const locationClass = classifyFailureLocation({ locationValue: loc, base, isProtection });
    return buildFailureResult({
      authErrorClass: isProtection ? 'NONE' : authClass,
      callbackAttempted: true,
      callbackLocationClass: locationClass,
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
      role: normalizedRole,
      sessionAttempted: false,
      sessionState: 'NOT_CHECKED',
      setCookiePresent: cookiePresent,
      verdict,
      workflowSourceSha: workflowShaValue,
    });
  };
  if (!callbackRes) {
    const code = 'CALLBACK_TRANSPORT_FAILED';
    const message = 'callback 요청 전송에 실패했습니다.';
    failWithEvidence(code, message, callbackFail(code, message, { callbackStatus: null, verdict: 'API_BINDING_FAILURE' }));
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
  {
    const contentType = readContentType(callbackRes.headers);
    if (isProtectionIntercept({ status: callbackStatus, contentType, locationValue, base })) {
      const code = 'DEPLOYMENT_PROTECTION_INTERCEPTED';
      const message = 'Vercel protection intercept이 callback 단계에서 차단했습니다.';
      failWithEvidence(
        code,
        message,
        callbackFail(code, message, {
          callbackStatus,
          locationValue,
          isProtection: true,
          cookiePresent: setCookiePresent,
          verdict: 'EDGE_OR_PROTECTION_BLOCKED',
        }),
      );
    }
  }
  // P3/P4/P5: callback classification + upstream diagnostic recovery.
  const locationEvidence = parseLocationEvidence(locationValue, base);
  const authErrorClass = classifyAuthError({
    status: callbackStatus,
    codeParam: locationEvidence.codeParam,
    errorParam: locationEvidence.errorParam,
  });
  const upstreamDiagnostic = parseUpstreamDiagnosticCode(locationEvidence.codeParam);
  if (callbackStatus === 401 || callbackStatus === 403) {
    const code = 'CALLBACK_REJECTED';
    const message = 'callback application 응답에서 인증 거절이 직접 관찰됐습니다.';
    failWithEvidence(
      code,
      message,
      callbackFail(code, message, {
        callbackStatus,
        locationValue,
        isProtection: false,
        authClass: authErrorClass,
        cookiePresent: setCookiePresent,
        verdict: 'AUTHJS_CALLBACK_REJECTED',
      }),
    );
  }

  // P7: Same-jar session readback (cookie VALUES stay in memory only).
  let sessionState = 'NOT_CHECKED';
  let sessionUserRecord = null;
  const sessionFail = (code, message, { sessionStatus = null, verdict = 'INCONCLUSIVE' } = {}) =>
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
      role: normalizedRole,
      sessionAttempted: true,
      sessionState: 'NOT_CHECKED',
      setCookiePresent,
      verdict,
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
      requestInit({ method: 'GET', headers: { ...sessionHeaders } }),
    );
  } catch {
    sessionFetchThrew = true;
    sessionRes = null;
  }
  if (sessionFetchThrew || !sessionRes) {
    const code = 'SESSION_READ_FAILED';
    const message = 'session 확인 단계에서 전송에 실패했습니다.';
    failWithEvidence(code, message, sessionFail(code, message, { sessionStatus: null, verdict: 'API_BINDING_FAILURE' }));
  }
  calls.push('/api/auth/session');
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
      const message = 'Vercel protection intercept이 session 단계에서 차단했습니다.';
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
          role: normalizedRole,
          sessionAttempted: true,
          sessionState: 'NOT_CHECKED',
          setCookiePresent,
          verdict: 'EDGE_OR_PROTECTION_BLOCKED',
          workflowSourceSha: workflowShaValue,
        }),
      );
    }
  }
  let sessionBodyForContract = {};
  {
    const sessionStatus = typeof sessionRes?.status === 'number' ? sessionRes.status : 0;
    const sessionOk = sessionRes?.ok === true || (sessionStatus >= 200 && sessionStatus < 300);
    if (sessionOk && typeof sessionRes.text === 'function') {
      const body = parseJsonBody(await sessionRes.text());
      sessionBodyForContract = body;
      sessionState = classifySessionState(body);
      const user =
        body && typeof body === 'object' && body.user && typeof body.user === 'object'
          ? body.user
          : null;
      sessionUserRecord = user;
    } else if (sessionRes) {
      try {
        const text = typeof sessionRes.text === 'function' ? await sessionRes.text() : '';
        sessionBodyForContract = parseJsonBody(text);
      } catch {
        sessionBodyForContract = {};
      }
      sessionState = 'INVALID';
      sessionUserRecord = null;
    }
  }

  // P8: identity/session contract (presence/allowlist only).
  let sessionContract = 'NOT_CHECKED';
  let roleAdmitted = null;
  let storeBindingPresent = normalizedRole === 'seller' ? null : null;
  if (sessionState === 'VALID') {
    const evaluated = evaluateSessionContract(normalizedRole, sessionUserRecord);
    sessionContract = evaluated.contract;
    roleAdmitted = evaluated.roleAdmitted;
    if (normalizedRole === 'seller') storeBindingPresent = evaluated.storeBindingPresent;
  } else {
    sessionContract = 'NOT_CHECKED';
    roleAdmitted = null;
    storeBindingPresent = normalizedRole === 'seller' ? null : null;
  }

  const artifact = buildRoleArtifact({
    authErrorClass,
    callbackLocationClass: locationEvidence.locationClass,
    callbackStatus,
    checkedAt: checkedAtValue,
    deploymentId: bound.deploymentId,
    deploymentSourceSha: bound.expectedSha,
    expectedApiOriginFingerprint,
    headerPresent,
    protectionBypassHeaderPresent: protectionPresent,
    protectionPassageMode: protectionMode,
    role: normalizedRole,
    sessionContract,
    sessionRoleAdmitted: roleAdmitted,
    sessionState,
    sessionStoreBindingPresent: storeBindingPresent,
    setCookiePresent,
    upstreamOriginFingerprint: upstreamDiagnostic?.upstreamOriginFingerprint ?? null,
    upstreamOriginMatchesExpected:
      upstreamDiagnostic?.upstreamOriginFingerprint && expectedApiOriginFingerprint
        ? upstreamDiagnostic.upstreamOriginFingerprint === expectedApiOriginFingerprint
        : null,
    upstreamStatus: upstreamDiagnostic?.upstreamStatus ?? null,
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
  // Role-generic CLI: --role plus --target-url/--deployment-id aliases for the
  // explicit workflow inputs (--seller-url/--driver-url,
  // --seller-deployment-id/--driver-deployment-id).
  const roleRaw = args.role ?? args['target-role'] ?? '';
  const targetUrl =
    args['target-url'] ?? args['seller-url'] ?? args['driver-url'] ?? '';
  const deploymentId =
    args['deployment-id'] ?? args['seller-deployment-id'] ?? args['driver-deployment-id'] ?? '';
  try {
    const normalizedRole = assertRole(roleRaw);
    const config = ROLE_CONFIG[normalizedRole];
    const { artifact } = await runRoleCallbackProbe(
      {
        role: normalizedRole,
        targetUrl,
        expectedSha: args['expected-sha'],
        deploymentId,
        evidence,
        approval: args.approval,
        expectedApiOrigin: args['expected-api-origin'],
        protectionPassageMode:
          args['protection-passage-mode'] ?? process.env.PROTECTION_PASSAGE_MODE ?? 'NONE',
        workflowSha: process.env.GITHUB_SHA ?? '',
        checkedAt: '',
      },
      {
        env: {
          ...process.env,
          // Ensure the per-role credential env names resolve inside the runner
          // without ever echoing values: only presence is recorded.
          [config.secretEnv]: process.env[config.secretEnv] ?? '',
          [config.emailEnv]: process.env[config.emailEnv] ?? '',
          [config.passwordEnv]: process.env[config.passwordEnv] ?? '',
        },
      },
    );
    process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
    process.exitCode = 0;
  } catch (error) {
    if (
      error instanceof RoleCallbackProbeContractError &&
      error.evidence &&
      typeof error.evidence === 'object'
    ) {
      process.stdout.write(`${JSON.stringify(error.evidence, null, 2)}\n`);
    } else {
      const code =
        error instanceof RoleCallbackProbeContractError ? error.code : 'PROBE_INTERNAL_ERROR';
      let roleFallback = 'seller';
      try {
        roleFallback = assertRole(roleRaw);
      } catch {
        roleFallback = 'seller';
      }
      const fallback = buildFailureResult({
        checkedAt: new Date().toISOString(),
        failureCode: code,
        failureStage: FAILURE_STAGE_GUARD,
        message: String(error?.message ?? error),
        role: roleFallback,
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
      error instanceof RoleCallbackProbeContractError &&
      error.evidence &&
      typeof error.evidence === 'object'
    ) {
      process.stdout.write(`${JSON.stringify(error.evidence, null, 2)}\n`);
    } else {
      const code =
        error instanceof RoleCallbackProbeContractError ? error.code : 'PROBE_INTERNAL_ERROR';
      const fallback = buildFailureResult({
        checkedAt: new Date().toISOString(),
        failureCode: code,
        failureStage: FAILURE_STAGE_GUARD,
        message: String(error?.message ?? error),
        role: 'seller',
        workflowSourceSha: String(process.env.GITHUB_SHA ?? 'local-unpublished'),
      });
      process.stdout.write(`${JSON.stringify(fallback, null, 2)}\n`);
    }
    process.exitCode = 1;
  });
}
