/**
 * FE-PILOT-AUTH-RUNTIME-PROBE-RUNNER-01 — non-production Auth runtime proof runner.
 *
 * Current-contract source (2026-09-08, main):
 * - apps/consumer/src/auth.ts — Credentials E2E header gate (E2E_TEST_SECRET +
 *   x-e2e-test-token), role consumer|admin, Kakao targetRole consumer.
 * - apps/seller/src/auth.ts — same header gate, EXCEPT local credential runtime
 *   (GREENHUB_LOCAL_RUNTIME=true + non-production) skips the header gate and
 *   validates against the real API path; role seller|admin + storeId binding.
 * - apps/driver/src/auth.ts — preview E2E gate (VERCEL_ENV=preview +
 *   ROUND_DIRECT_E2E_ENABLED=true + timing-safe shared secret +
 *   ROUND_DIRECT_E2E_DRIVER_EMAILS allowlist) then API role=driver +
 *   driverApproved=true; local credential runtime uses the real API path with
 *   the same role/approval check. Kakao driver requires driverApproved.
 * - apps/api/src/auth/** — POST /auth/login, GET /auth/me, POST /auth/logout
 *   (JwtAuthGuard). Current spec docs/specs/api/auth.md. AUTH-SESSION-CLAIM-
 *   REVOCATION (stale role/storeId refresh reuse) is explicitly OUT OF SCOPE
 *   and is NOT fixed or probed as closed here.
 *
 * What this runner does:
 * - Fail-closed safety gates BEFORE any network call (production host /
 *   Firebase project / Railway env, expected SHA, runtime binding evidence,
 *   required secrets, driver allowlist, explicit non-production approval).
 * - Consumes existing deployment/binder evidence (e.g. wait-preview-deploy
 *   commit-status JSON) — it does NOT rewrite Railway/Vercel binder files.
 * - Probes ONLY the non-production test-credential path via an injectable
 *   fetch client: API login -> session reread (GET /auth/me) -> logout
 *   (POST /auth/logout) per role, plus a read-only API boundary check.
 * - NEVER performs Kakao OAuth completion, user registration, admin approval
 *   mutation, or PortOne/ALIGO calls. Forbidden paths/hosts are blocked in
 *   the guarded fetch wrapper and covered by tests.
 *
 * Usage (real run — NOT executed as part of this source task):
 *   node scripts/probe-auth-runtime.mjs \
 *     --expected-sha=<40hex> \
 *     --consumer-url=https://<non-prod-consumer> \
 *     --seller-url=https://<non-prod-seller> \
 *     --driver-url=https://<non-prod-driver> \
 *     --api-url=https://<non-prod-api> \
 *     --evidence-json=.artifacts/.../deployment.json \
 *     --approval=NON_PRODUCTION_AUTH_PROBE_APPROVED
 *
 * Secrets/credentials come from env (never logged):
 *   E2E_TEST_SECRET, ROUND_DIRECT_E2E_SHARED_SECRET,
 *   ROUND_DIRECT_E2E_DRIVER_EMAILS (comma list),
 *   ROUND_DIRECT_E2E_ENABLED, VERCEL_ENV, RAILWAY_ENVIRONMENT_NAME, NODE_ENV,
 *   FIREBASE_PROJECT_ID, GREENHUB_LOCAL_RUNTIME,
 *   TEST_CONSUMER_EMAIL/PASSWORD, TEST_SELLER_EMAIL/PASSWORD,
 *   TEST_DRIVER_EMAIL/PASSWORD (+ TEST_DRIVER_UNAPPROVED_* for the negative case)
 *
 * Exit codes: 0 all probed roles PASS; 1 any fail-closed gate or role failure.
 * Binding evidence missing/mismatch fails with RUNTIME_NOT_BOUND.
 */

export const APPROVAL_VALUE = 'NON_PRODUCTION_AUTH_PROBE_APPROVED';

export const PRODUCTION_FIREBASE_PROJECT = 'green-e4fe3';
export const PRODUCTION_API_HOSTS = Object.freeze(['api-production-13e7.up.railway.app']);
export const PROVIDER_HOSTS = Object.freeze([
  'api.portone.io',
  'kakaoapi.aligo.in',
  'apis.aligo.in',
  'kauth.kakao.com',
  'kapi.kakao.com',
]);

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const ALLOWED_ROLES = Object.freeze({
  consumer: ['consumer', 'admin'],
  seller: ['seller', 'admin'],
  driver: ['driver'],
});
const FRONTEND_APPS = Object.freeze(['consumer', 'seller', 'driver']);

// Runner may ONLY touch these API paths. Anything else (register, kakao-login,
// admin approval, addresses, fcm-token, firebase-token, refresh rotation
// semantics) is out of scope and blocked. AUTH-SESSION-CLAIM-REVOCATION is
// explicitly not closed by this runner.
const ALLOWED_API_PATHS = Object.freeze(['/auth/login', '/auth/me', '/auth/logout']);

export class ProbeContractError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ProbeContractError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

function fail(code, message, details) {
  throw new ProbeContractError(code, message, details);
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
  if (PRODUCTION_API_HOSTS.includes(host)) return true;
  if (host.startsWith('api-production-')) return true;
  return false;
}

export function isProductionUrl(urlString) {
  return isProductionHostname(hostnameOf(urlString));
}

export function isProductionApiOrigin(origin) {
  return isProductionUrl(origin);
}

export function normalizeTargetUrl(value, { field = 'target' } = {}) {
  if (!isNonEmptyString(value)) {
    fail('RUNTIME_NOT_BOUND', `${field} URL이 없어 runtime binding을 증명할 수 없습니다.`);
  }
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    fail('RUNTIME_NOT_BOUND', `${field} URL 형식이 올바르지 않아 runtime binding을 증명할 수 없습니다.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    fail('RUNTIME_NOT_BOUND', `${field} URL에 인증정보/query/fragment가 있어 binding을 거부합니다.`);
  }
  const isLoopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (!isLoopback && url.protocol !== 'https:') {
    fail('RUNTIME_NOT_BOUND', `${field} URL은 loopback이 아니면 https만 허용합니다.`);
  }
  if (isProductionUrl(url.toString())) {
    fail('PRODUCTION_TARGET_REJECTED', `${field} target이 운영 호스트이므로 차단합니다.`);
  }
  return url.toString().replace(/\/$/, '');
}

export function isLocalCredentialRuntime(env = process.env) {
  // Mirrors apps/seller/src/auth.ts + apps/driver/src/auth.ts (read-only copy).
  if (env.GREENHUB_LOCAL_RUNTIME !== 'true') return false;
  if (env.NODE_ENV === 'production') return false;
  if (env.VERCEL_ENV === 'production') return false;
  if (env.RAILWAY_ENVIRONMENT_NAME === 'production') return false;
  return true;
}

function readEvidenceTargetUrls(evidence) {
  if (!evidence || typeof evidence !== 'object') return {};
  return (
    evidence.deploymentTargetUrls ??
    evidence.statusTargetUrls ??
    evidence.targetUrls ??
    {}
  );
}

function readEvidenceShas(evidence) {
  if (!evidence || typeof evidence !== 'object') return {};
  return evidence.deploymentShas ?? evidence.statusShas ?? {};
}

/**
 * Runtime binding: CLI urls alone are NOT enough. A ready evidence artifact
 * (e.g. wait-preview-deploy commit-status JSON) must pin the same expected
 * SHA and the same per-app target urls. Anything missing/mismatched fails
 * with RUNTIME_NOT_BOUND (or the specific SHA/production code).
 */
export function validateRuntimeBinding({ expectedSha, consumerUrl, sellerUrl, driverUrl, apiUrl, evidence }) {
  const sha = assertExpectedSha(expectedSha);
  const targets = {
    consumer: normalizeTargetUrl(consumerUrl, { field: 'consumer-url' }),
    seller: normalizeTargetUrl(sellerUrl, { field: 'seller-url' }),
    driver: normalizeTargetUrl(driverUrl, { field: 'driver-url' }),
    api: normalizeTargetUrl(apiUrl, { field: 'api-url' }),
  };
  if (isProductionApiOrigin(targets.api)) {
    fail('PRODUCTION_API_ORIGIN', '운영 API origin은 사용할 수 없습니다.');
  }
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    fail('RUNTIME_NOT_BOUND', 'runtime binding evidence가 없어 실행을 차단합니다.');
  }
  if (evidence.ready === false) {
    fail('RUNTIME_NOT_BOUND', 'binding evidence가 ready 상태가 아닙니다.');
  }
  const evidenceSha = String(evidence.expectedSha ?? '').trim().toLowerCase();
  if (!SHA_PATTERN.test(evidenceSha)) {
    fail('RUNTIME_NOT_BOUND', 'binding evidence에 40자리 expected SHA가 없습니다.');
  }
  if (evidenceSha !== sha) {
    fail('EXPECTED_SHA_MISMATCH', 'binding evidence SHA가 --expected-sha와 다릅니다.');
  }
  const shas = readEvidenceShas(evidence);
  for (const app of FRONTEND_APPS) {
    if (shas[app] !== sha) {
      fail(
        'DEPLOYMENT_SHA_MISMATCH',
        `${app} 배포 SHA가 지정 SHA와 일치하지 않아 runtime binding을 거부합니다.`,
      );
    }
  }
  const evidenceUrls = readEvidenceTargetUrls(evidence);
  for (const app of FRONTEND_APPS) {
    const observed = isNonEmptyString(evidenceUrls[app])
      ? normalizeTargetUrl(evidenceUrls[app], { field: `evidence-${app}` })
      : '';
    if (!observed) {
      fail('RUNTIME_NOT_BOUND', `${app} deployment target_url이 evidence에 없어 binding을 거부합니다.`);
    }
    if (observed !== targets[app]) {
      fail(
        'RUNTIME_BINDING_MISMATCH',
        `${app} target이 evidence binding과 달라 실행을 차단합니다.`,
      );
    }
  }
  // API origin binding: evidence may carry apiOrigin (readiness) — when present
  // it must match; wait-preview-deploy evidence has no API origin, in which
  // case the explicit non-production --api-url + production rejection above
  // is the binding floor (evidence still required for the 3 frontends + SHA).
  const evidenceApi = isNonEmptyString(evidence.apiOrigin)
    ? normalizeTargetUrl(evidence.apiOrigin, { field: 'evidence-api' })
    : '';
  if (evidenceApi && evidenceApi !== targets.api) {
    fail('RUNTIME_BINDING_MISMATCH', 'api target이 evidence binding과 달라 실행을 차단합니다.');
  }
  return { expectedSha: sha, targets };
}

export function splitAllowlist(value) {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * Global safety gates — evaluated before any network call.
 * Throws ProbeContractError on the first blocking condition.
 */
export function validateSafetyGates(input = {}, env = process.env) {
  const approval = String(input.approval ?? env.NON_PRODUCTION_AUTH_PROBE_APPROVAL ?? env.APPROVAL ?? '').trim();
  if (approval !== APPROVAL_VALUE) {
    fail('MISSING_APPROVAL', 'explicit non-production approval이 없어 실행을 차단합니다.');
  }
  const railwayEnv = String(input.railwayEnvironment ?? env.RAILWAY_ENVIRONMENT_NAME ?? '').trim();
  const vercelEnv = String(input.vercelEnv ?? env.VERCEL_ENV ?? '').trim();
  const nodeEnv = String(input.nodeEnv ?? env.NODE_ENV ?? '').trim();
  if (railwayEnv === 'production' || vercelEnv === 'production' || nodeEnv === 'production') {
    fail('PRODUCTION_ENVIRONMENT', 'production runtime marker가 있어 실행을 차단합니다.');
  }
  const firebaseProject = String(input.firebaseProjectId ?? env.FIREBASE_PROJECT_ID ?? '').trim();
  if (firebaseProject === PRODUCTION_FIREBASE_PROJECT) {
    fail('PRODUCTION_FIREBASE_PROJECT', '운영 Firebase project는 사용할 수 없습니다.');
  }
  const localRuntime = Boolean(input.isLocalRuntime ?? isLocalCredentialRuntime(env));

  const e2eSecret = input.e2eSecret ?? env.E2E_TEST_SECRET ?? '';
  if (!isNonEmptyString(e2eSecret) && !localRuntime) {
    // Consumer has no local bypass in current main; seller does. The global
    // gate requires the secret unless the whole run is a local-runtime probe
    // (localhost targets + local marker). Per-role gates re-check this.
    fail('CONSUMER_SECRET_MISSING', 'consumer/seller secret gate에 필요한 E2E_TEST_SECRET이 없습니다.');
  }
  if (!localRuntime) {
    const sellerSecret = input.sellerSecret ?? e2eSecret;
    if (!isNonEmptyString(sellerSecret)) {
      fail('SELLER_SECRET_MISSING', 'seller secret gate에 필요한 secret이 없습니다.');
    }
  }
  const driverSecret = input.driverSharedSecret ?? env.ROUND_DIRECT_E2E_SHARED_SECRET ?? '';
  if (!isNonEmptyString(driverSecret)) {
    fail('DRIVER_SECRET_MISSING', 'driver enable gate에 필요한 shared secret이 없습니다.');
  }
  const allowlist = splitAllowlist(input.driverAllowlist ?? env.ROUND_DIRECT_E2E_DRIVER_EMAILS ?? '');
  if (allowlist.length === 0) {
    fail('DRIVER_ALLOWLIST_MISSING', 'driver email allowlist가 비어 있어 실행을 차단합니다.');
  }
  return { approval, localRuntime, allowlist };
}

// ---- Frontend gate mirrors (pure, no network) -------------------------------
// These mirror the CURRENT main authorize() entry conditions so the probe can
// prove the same gate it exercises. They do not change app semantics.

export function evaluateConsumerGate({ e2eSecret, token }) {
  if (!isNonEmptyString(e2eSecret)) return { ok: false, code: 'CONSUMER_GATE_REJECTED' };
  if (!isNonEmptyString(token) || token !== e2eSecret) {
    return { ok: false, code: 'CONSUMER_GATE_REJECTED' };
  }
  return { ok: true, code: null };
}

export function evaluateSellerGate({ isLocalRuntime, e2eSecret, token }) {
  // Current seller main: local runtime skips the header gate, otherwise the
  // same E2E header gate as consumer.
  if (isLocalRuntime) return { ok: true, code: null, via: 'local-contract' };
  return { ...evaluateConsumerGate({ e2eSecret, token }), via: undefined };
}

export function evaluateDriverGate({
  isLocalRuntime,
  vercelEnv,
  enabled,
  sharedSecret,
  presentedSecret,
  allowlist,
  email,
}) {
  if (!isLocalRuntime) {
    if (vercelEnv !== 'preview' || enabled !== 'true') {
      return { ok: false, code: 'DRIVER_ENABLE_GATE_REJECTED' };
    }
    if (!isNonEmptyString(sharedSecret) || presentedSecret !== sharedSecret) {
      return { ok: false, code: 'DRIVER_SECRET_MISMATCH' };
    }
  }
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized || !splitAllowlist(allowlist).includes(normalized)) {
    return { ok: false, code: 'DRIVER_ALLOWLIST_REJECTED' };
  }
  return { ok: true, code: null };
}

// ---- HTTP response normalization -------------------------------------------
// Production runtime uses native fetch Response ({ ok, status, headers, text/json })
// while deterministic tests historically use plain { ok, status, data } mocks.
// Both shapes are normalized to a single internal contract { ok, status, data }
// without ever surfacing raw bodies, tokens, or credentials.

export function classifyLoginRejection(status) {
  const code = Number(status);
  if (code === 401) return 'AUTH_LOGIN_UNAUTHORIZED';
  if (code === 403) return 'AUTH_LOGIN_FORBIDDEN';
  if (code === 404) return 'AUTH_LOGIN_ROUTE_NOT_FOUND';
  if (Number.isInteger(code) && code >= 500 && code <= 599) return 'AUTH_LOGIN_SERVER_ERROR';
  return 'AUTH_LOGIN_HTTP_REJECTED';
}

function isNativeResponseLike(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (typeof raw.status !== 'number') return false;
  if (typeof raw.text !== 'function' && typeof raw.json !== 'function') return false;
  // Mock { ok, status, data } has no headers.get / text / json fns.
  if (typeof raw.headers?.get === 'function') return true;
  if (typeof raw.text === 'function' && !('data' in raw)) return true;
  return false;
}

export async function normalizeProbeHttpResponse(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, status: 0, data: null };
  }
  if (isNativeResponseLike(raw)) {
    const status = typeof raw.status === 'number' ? raw.status : 0;
    const ok = raw.ok === true ? true : status >= 200 && status < 300;
    let data = null;
    try {
      let text = '';
      if (typeof raw.text === 'function') {
        text = await raw.text();
      } else if (typeof raw.json === 'function') {
        // Fallback when only json() exists: resolve then treat as data.
        // Body-read failure is classified without surfacing raw content.
        try {
          const parsed = await raw.json();
          return { ok, status, data: parsed ?? null };
        } catch {
          return { ok, status, data: null, bodyIssue: 'READ_FAILED' };
        }
      }
      if (typeof text !== 'string') {
        return { ok, status, data: null, bodyIssue: 'READ_FAILED' };
      }
      const trimmed = text.trim();
      if (!trimmed) {
        return { ok, status, data: null, bodyIssue: 'EMPTY' };
      }
      try {
        data = JSON.parse(trimmed);
      } catch {
        // Non-JSON / malformed body: never surface raw text.
        return { ok, status, data: null, bodyIssue: 'MALFORMED' };
      }
    } catch {
      return { ok, status, data: null, bodyIssue: 'READ_FAILED' };
    }
    return { ok, status, data };
  }
  // Legacy deterministic mock contract { ok, status, data }.
  const status = typeof raw.status === 'number' ? raw.status : 0;
  return {
    ok: raw.ok === true,
    status,
    data: 'data' in raw ? raw.data : null,
  };
}

// ---- Guarded fetch -----------------------------------------------------------

function apiPathOf(urlString, apiUrl) {
  try {
    const url = new URL(urlString);
    const base = new URL(apiUrl);
    if (url.origin !== base.origin) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

export function createGuardedFetch(fetchImpl, { apiUrl }) {
  const calls = [];
  const guarded = async (url, init = {}) => {
    const method = String(init.method ?? 'GET').toUpperCase();
    const target = String(url);
    const host = hostnameOf(target);
    if (PROVIDER_HOSTS.includes(host)) {
      fail('PROVIDER_EGRESS_FORBIDDEN', `외부 provider 호출은 probe에서 금지됩니다: ${host}`);
    }
    if (target.includes('/auth/kakao-login') || target.includes('kakao')) {
      fail('KAKAO_COMPLETION_NOT_ALLOWED', '실제 Kakao OAuth completion을 자동 수행하지 않습니다.');
    }
    const apiPath = apiPathOf(target, apiUrl);
    if (!apiPath || !ALLOWED_API_PATHS.includes(apiPath)) {
      fail('AUTH_MUTATION_FORBIDDEN', `probe 허용 경로가 아닌 호출을 차단합니다: ${method} ${apiPath ?? 'cross-origin'}`);
    }
    calls.push({ method, path: apiPath });
    const raw = await fetchImpl(target, init);
    return normalizeProbeHttpResponse(raw);
  };
  guarded.calls = calls;
  return guarded;
}

function requireOkJson(res, { role, step }) {
  if (!res || res.ok !== true) {
    const httpStatus = typeof res?.status === 'number' ? res.status : 0;
    const rejectionClass = classifyLoginRejection(httpStatus);
    const normalizedRole = String(role).toLowerCase();
    fail(
      `${role}_LOGIN_FAILED`,
      `${role} login이 거부됐습니다 (${step} http=${httpStatus} class=${rejectionClass}).`,
      { role: normalizedRole, step, httpStatus, rejectionClass },
    );
  }
  return res.data;
}

function validateLoginUser(role, user) {
  if (!user || typeof user.id !== 'string' || !user.id) {
    fail(`${role}_LOGIN_FAILED`, `${role} login 응답에 유효한 user id가 없습니다.`);
  }
  const allowed = ALLOWED_ROLES[role];
  if (!allowed.includes(String(user.role))) {
    fail(`${role}_ROLE_MISMATCH`, `${role} role binding이 깨졌습니다 (role=${String(user.role)}).`);
  }
  if (role === 'seller' && !('storeId' in user)) {
    fail('SELLER_ROLE_MISMATCH', 'seller session에 storeId binding이 없습니다.');
  }
  if (role === 'driver') {
    if (user.role !== 'driver') fail('DRIVER_ROLE_MISMATCH', 'driver role binding이 깨졌습니다.');
    if (user.driverApproved !== true) {
      // Negative proof signal: unapproved driver MUST NOT get a session.
      fail('DRIVER_UNAPPROVED_REJECTED', '미승인 driver의 session 발급이 거부됐습니다.');
    }
  }
}

/**
 * One role lifecycle: login -> reread (GET /auth/me) -> logout.
 * fetchImpl is injectable (mock in tests, global fetch in real runs).
 * Throws role-prefixed ProbeContractError on any deviation, including a
 * missing reread/logout step.
 */
export async function runRoleProbe(role, { apiUrl, email, password, accessTokenForReread, fetchImpl }) {
  const ROLE = String(role).toUpperCase();
  if (!['consumer', 'seller', 'driver'].includes(role)) {
    fail('UNKNOWN_ROLE', `알 수 없는 probe 역할입니다: ${role}`);
  }
  if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
    fail(`${ROLE}_CREDENTIALS_MISSING`, `${role} test credential이 없어 실행을 차단합니다.`);
  }
  const fetch = createGuardedFetch(fetchImpl, { apiUrl });

  // 1) session creation via non-production test credential path
  const loginRes = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const loginData = requireOkJson(loginRes, { role: ROLE, step: 'login' });
  const loginHttpStatus = typeof loginRes?.status === 'number' ? loginRes.status : 0;
  const loginRole = String(role).toLowerCase();
  if (!loginData || typeof loginData !== 'object') {
    const bodyIssue = typeof loginRes?.bodyIssue === 'string' ? loginRes.bodyIssue : '';
    const rejectionClass =
      bodyIssue === 'EMPTY'
        ? 'AUTH_LOGIN_BODY_EMPTY'
        : bodyIssue === 'MALFORMED'
          ? 'AUTH_LOGIN_BODY_INVALID_JSON'
          : bodyIssue === 'READ_FAILED'
            ? 'AUTH_LOGIN_BODY_READ_FAILED'
            : 'AUTH_LOGIN_BODY_INVALID';
    fail(
      `${ROLE}_LOGIN_FAILED`,
      `${role} login 응답 본문이 유효하지 않습니다 (http=${loginHttpStatus} class=${rejectionClass}).`,
      { role: loginRole, step: 'login', httpStatus: loginHttpStatus, rejectionClass },
    );
  }
  if (typeof loginData.accessToken !== 'string' || !loginData.accessToken) {
    fail(
      `${ROLE}_LOGIN_FAILED`,
      `${role} login 응답에 accessToken이 없습니다 (http=${loginHttpStatus}).`,
      { role: loginRole, step: 'login', httpStatus: loginHttpStatus, rejectionClass: 'AUTH_LOGIN_TOKEN_MISSING' },
    );
  }
  if (typeof loginData.refreshToken !== 'string' || !loginData.refreshToken) {
    fail(
      `${ROLE}_LOGIN_FAILED`,
      `${role} login 응답에 refreshToken이 없습니다 (http=${loginHttpStatus}).`,
      { role: loginRole, step: 'login', httpStatus: loginHttpStatus, rejectionClass: 'AUTH_LOGIN_REFRESH_MISSING' },
    );
  }
  validateLoginUser(role, loginData.user);

  // 2) session reread is REQUIRED (not optional)
  if (accessTokenForReread === null) {
    fail(`${ROLE}_REREAD_REQUIRED`, `${role} session reread 단계가 생략됐습니다.`);
  }
  const meRes = await fetch(`${apiUrl}/auth/me`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${loginData.accessToken}` },
  });
  if (!meRes || meRes.ok !== true) {
    fail(`${ROLE}_REREAD_FAILED`, `${role} session reread(GET /auth/me)가 실패했습니다.`);
  }
  const me = meRes.data;
  if (!me || me.id !== loginData.user.id || String(me.role) !== String(loginData.user.role)) {
    fail(`${ROLE}_REREAD_MISMATCH`, `${role} reread identity가 login session과 다릅니다.`);
  }
  if (role === 'driver' && me.driverApproved !== true) {
    fail('DRIVER_UNAPPROVED_REJECTED', 'reread에서 미승인 driver가 확인돼 session을 금지합니다.');
  }

  // 3) logout is REQUIRED (not optional)
  const logoutRes = await fetch(`${apiUrl}/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginData.accessToken}` },
  });
  if (!logoutRes || logoutRes.ok !== true) {
    fail(`${ROLE}_LOGOUT_FAILED`, `${role} logout(POST /auth/logout)가 실패했습니다.`);
  }

  return {
    role,
    ok: true,
    steps: { login: 'ok', reread: 'ok', logout: 'ok' },
    user: { id: loginData.user.id, role: String(loginData.user.role) },
    // In-memory only: reused for the API boundary read. Never serialized
    // into summary/artifact (see runAuthRuntimeProbe).
    accessToken: loginData.accessToken,
    fetchCalls: [...fetch.calls],
  };
}

/**
 * API runtime boundary: safe authenticated read only. Proves the JWT boundary
 * answers for a valid token without performing any mutation. Any attempt to
 * reach a non-allowlisted path fails via the guarded fetch.
 */
export async function runApiProbe({ apiUrl, accessToken, fetchImpl }) {
  if (!isNonEmptyString(accessToken)) {
    fail('API_CREDENTIALS_MISSING', 'API read probe에 access token이 없습니다.');
  }
  const fetch = createGuardedFetch(fetchImpl, { apiUrl });
  const meRes = await fetch(`${apiUrl}/auth/me`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!meRes || meRes.ok !== true) {
    fail('API_ME_FAILED', 'API boundary read(GET /auth/me)가 실패했습니다.');
  }
  if (!meRes.data || typeof meRes.data.id !== 'string') {
    fail('API_REREAD_MISMATCH', 'API boundary read 응답 identity가 유효하지 않습니다.');
  }
  return { role: 'api', ok: true, steps: { read: 'ok' }, fetchCalls: [...fetch.calls] };
}

function toFailure(summary, role, error) {
  const code = error instanceof ProbeContractError ? error.code : 'PROBE_INTERNAL_ERROR';
  summary.failureCodes.push(code);
  const entry = { status: 'FAIL', failureCode: code, message: String(error?.message ?? error) };
  // Preserve only non-sensitive diagnostic fields (role/step/status/class).
  // Never copy email, password, token, secret, header, or raw body.
  const details = error?.details;
  if (details && typeof details === 'object') {
    if (typeof details.role === 'string' && details.role) entry.role = details.role;
    if (typeof details.step === 'string' && details.step) entry.step = details.step;
    if (typeof details.httpStatus === 'number') entry.httpStatus = details.httpStatus;
    if (typeof details.rejectionClass === 'string' && details.rejectionClass) {
      entry.rejectionClass = details.rejectionClass;
    }
  }
  summary.roles[role] = entry;
}

/**
 * Full runner: gates -> binding -> per-role probes. Returns a JSON-serializable
 * summary and never throws secrets. Provider/Kakao/mutation paths fail closed.
 */
export async function runAuthRuntimeProbe(options = {}, deps = {}) {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (typeof fetchImpl !== 'function') {
    fail('PROBE_INTERNAL_ERROR', 'fetch 구현이 없어 probe를 실행할 수 없습니다.');
  }
  const summary = {
    runner: 'FE-PILOT-AUTH-RUNTIME-PROBE-RUNNER-01',
    result: 'PASS',
    expectedSha: null,
    targets: null,
    roles: {},
    failureCodes: [],
    authSessionClaimRevocation: 'EXPLICITLY_NOT_CLOSED',
  };

  try {
    const binding = validateRuntimeBinding({
      expectedSha: options.expectedSha ?? env.AUTH_PROBE_EXPECTED_SHA,
      consumerUrl: options.consumerUrl,
      sellerUrl: options.sellerUrl,
      driverUrl: options.driverUrl,
      apiUrl: options.apiUrl,
      evidence: options.evidence,
    });
    summary.expectedSha = binding.expectedSha;
    summary.targets = binding.targets;

    const gates = validateSafetyGates(
      {
        approval: options.approval,
        railwayEnvironment: options.railwayEnvironment,
        vercelEnv: options.vercelEnv,
        nodeEnv: options.nodeEnv,
        firebaseProjectId: options.firebaseProjectId,
        e2eSecret: options.e2eSecret,
        sellerSecret: options.sellerSecret,
        driverSharedSecret: options.driverSharedSecret,
        driverAllowlist: options.driverAllowlist,
        isLocalRuntime: options.isLocalRuntime,
      },
      env,
    );

    // Frontend entry gates mirror current main before any session is created.
    const consumerGate = evaluateConsumerGate({
      e2eSecret: options.e2eSecret ?? env.E2E_TEST_SECRET,
      token: options.consumerToken ?? env.AUTH_PROBE_CONSUMER_TOKEN,
    });
    if (!consumerGate.ok && !gates.localRuntime) {
      fail('CONSUMER_GATE_REJECTED', 'consumer secret/token gate가 거부됐습니다.');
    }
    const sellerGate = evaluateSellerGate({
      isLocalRuntime: gates.localRuntime,
      e2eSecret: options.sellerSecret ?? options.e2eSecret ?? env.E2E_TEST_SECRET,
      token: options.sellerToken ?? env.AUTH_PROBE_SELLER_TOKEN,
    });
    if (!sellerGate.ok) {
      fail('SELLER_GATE_REJECTED', 'seller secret/token (또는 local contract) gate가 거부됐습니다.');
    }
    const driverEmail = options.driverEmail ?? env.TEST_DRIVER_EMAIL ?? '';
    const driverGate = evaluateDriverGate({
      isLocalRuntime: gates.localRuntime,
      vercelEnv: options.vercelEnv ?? env.VERCEL_ENV,
      enabled: options.driverEnabled ?? env.ROUND_DIRECT_E2E_ENABLED,
      sharedSecret: options.driverSharedSecret ?? env.ROUND_DIRECT_E2E_SHARED_SECRET,
      presentedSecret: options.driverPresentedSecret ?? env.AUTH_PROBE_DRIVER_SECRET,
      allowlist: options.driverAllowlist ?? env.ROUND_DIRECT_E2E_DRIVER_EMAILS,
      email: driverEmail,
    });
    if (!driverGate.ok) {
      fail(driverGate.code ?? 'DRIVER_GATE_REJECTED', 'driver enable/secret/allowlist gate가 거부됐습니다.');
    }

    const creds = {
      consumer: {
        email: options.consumerEmail ?? env.TEST_CONSUMER_EMAIL,
        password: options.consumerPassword ?? env.TEST_CONSUMER_PASSWORD,
      },
      seller: {
        email: options.sellerEmail ?? env.TEST_SELLER_EMAIL,
        password: options.sellerPassword ?? env.TEST_SELLER_PASSWORD,
      },
      driver: { email: driverEmail, password: options.driverPassword ?? env.TEST_DRIVER_PASSWORD },
    };

    // In-memory only: successful role logins contribute real access tokens
    // for the API boundary read. Tokens are never written into summary.
    const roleTokens = [];
    for (const role of ['consumer', 'seller', 'driver']) {
      try {
        const result = await runRoleProbe(role, {
          apiUrl: binding.targets.api,
          email: creds[role].email,
          password: creds[role].password,
          fetchImpl,
        });
        summary.roles[role] = {
          status: 'PASS',
          failureCode: null,
          steps: result.steps,
          user: result.user,
        };
        if (typeof result.accessToken === 'string' && result.accessToken) {
          roleTokens.push(result.accessToken);
        }
      } catch (error) {
        toFailure(summary, role, error);
      }
    }

    try {
      const provided = deps.apiToken ?? options.apiToken;
      const providedToken = isNonEmptyString(provided) ? String(provided) : '';
      // Never fall back to a fake "probe-boundary-token": use an explicitly
      // provided real token or a real login token from this run, held in
      // memory only. Without any real token the boundary read is skipped
      // with an explicit code instead of a misleading API_ME_FAILED.
      const apiToken = providedToken || roleTokens[0] || '';
      if (!isNonEmptyString(apiToken)) {
        const skipError = new ProbeContractError(
          'API_ME_SKIPPED_NO_TOKEN',
          'API boundary read를 건너뜁니다 (사용 가능한 실제 access token 없음).',
        );
        summary.failureCodes.push(skipError.code);
        summary.roles.api = {
          status: 'SKIP',
          failureCode: skipError.code,
          steps: { read: 'skipped' },
        };
      } else {
        const apiResult = await runApiProbe({ apiUrl: binding.targets.api, accessToken: apiToken, fetchImpl });
        summary.roles.api = { status: 'PASS', failureCode: null, steps: apiResult.steps };
      }
    } catch (error) {
      toFailure(summary, 'api', error);
    }
  } catch (error) {
    const code = error instanceof ProbeContractError ? error.code : 'PROBE_INTERNAL_ERROR';
    summary.failureCodes.push(code);
    summary.bindingFailure = { code, message: String(error?.message ?? error) };
  }

  if (summary.failureCodes.length > 0 || summary.bindingFailure) {
    summary.result = 'FAIL';
  }
  return summary;
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
  const summary = await runAuthRuntimeProbe(
    {
      expectedSha: args['expected-sha'] ?? process.env.AUTH_PROBE_EXPECTED_SHA,
      consumerUrl: args['consumer-url'],
      sellerUrl: args['seller-url'],
      driverUrl: args['driver-url'],
      apiUrl: args['api-url'],
      approval: args.approval,
      evidence,
    },
    { env: process.env },
  );
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = summary.result === 'PASS' ? 0 : 1;
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isDirectRun =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    const code = error instanceof ProbeContractError ? error.code : 'PROBE_INTERNAL_ERROR';
    process.stdout.write(
      `${JSON.stringify({ runner: 'FE-PILOT-AUTH-RUNTIME-PROBE-RUNNER-01', result: 'FAIL', failureCodes: [code], bindingFailure: { code, message: String(error?.message ?? error) } }, null, 2)}\n`,
    );
    process.exitCode = 1;
  });
}
