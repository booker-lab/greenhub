/**
 * PILOT-AUTH-PROBE-IDENTITY-LIFECYCLE-26A — invocation-owned 3-role identity lifecycle.
 *
 * Purpose:
 * - Prepare exactly 3 test identities (consumer/seller/driver) in the
 *   non-production staging dataset (greenhub-round-direct-e2e) before the
 *   session + callback probes, then always clean them up.
 * - Bounded lifecycle per probe invocation:
 *     approval -> exact non-production target guard -> seed/verify
 *     -> session + callback jobs -> always cleanup -> cleanup verification
 * - This source task implements + deterministically verifies the lifecycle.
 *   It does NOT dispatch the real auth/callback probe.
 *
 * Credential source (no new secrets):
 * - Workflow maps the approved Environment chromium secrets to TEST_* env:
 *     TEST_CONSUMER_EMAIL / TEST_CONSUMER_PASSWORD
 *     TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD
 *     TEST_DRIVER_EMAIL / TEST_DRIVER_PASSWORD
 *   which originate from:
 *     ROUND_DIRECT_E2E_CONSUMER_EMAIL_CHROMIUM (+PASSWORD)
 *     ROUND_DIRECT_E2E_SELLER_EMAIL_CHROMIUM (+PASSWORD)
 *     ROUND_DIRECT_E2E_DRIVER_EMAIL_CHROMIUM (+PASSWORD)
 * - Secret values are never logged, never serialized into manifests/evidence.
 *
 * User document schema (read from current main):
 * - apps/api/src/auth/auth.service.ts — register() stores bcrypt(password,12),
 *   role, providers:['email'], driverApproved:false for driver at creation,
 *   login() requires bcrypt.compare, rejects suspended===true, rejects
 *   driver with driverApproved!==true. No store existence check on login.
 * - scripts/round-direct-e2e-fixtures.mjs buildFixtureManifest() — consumer:
 *   role/passwordHash/providers, seller: + storeId (namespaced, never the
 *   production store), driver: + driverApproved:true. _e2e ownership tag.
 * - This lifecycle reuses that account/user construction at a small-helper
 *   level only. It never runs the full round-direct fixture seed and never
 *   creates products/orders/saleRounds/storage objects or a production store.
 *
 * Seller store binding contract (minimal, probe-valid):
 * - seller doc MUST contain a non-empty string storeId
 *   (probe-auth-runtime.mjs validateLoginUser requires 'storeId' in user).
 * - storeId MUST be invocation-namespaced (`<runId>-store`), MUST NOT equal
 *   the production store, MUST NOT be empty. No store document is created:
 *   the API login path does not validate store existence, and creating
 *   store/products would widen this lifecycle beyond the 3 user docs.
 *
 * Ownership / collision safety:
 * - Every doc carries _e2e = { purpose:'auth-probe', runId, role }.
 * - Same-email unrelated user (different purpose/runId or no marker) causes
 *   fail-closed IDENTITY_COLLISION — never overwritten.
 * - Cleanup deletes ONLY docs whose _e2e.purpose/runId match the manifest.
 *   Foreign docs are skipped, missing docs are idempotent success.
 * - Partial seed failure cleans up already-created owned docs.
 *
 * Target safety (fail-closed before any mutation):
 * - ROUND_DIRECT_E2E_ENABLED must be 'true'.
 * - ROUND_DIRECT_E2E_ENV must be 'preview' and NODE/VERCEL/RAILWAY must not
 *   be 'production'.
 * - FIREBASE_PROJECT_ID must equal greenhub-round-direct-e2e (never
 *   green-e4fe3) and must be in the allowed list.
 * - Service-account project_id must equal FIREBASE_PROJECT_ID (reuses
 *   inspectFirebaseServiceAccount from check-round-direct-e2e-readiness.mjs).
 *
 * Secret-safe evidence:
 * - Manifests persisted to artifacts are redacted: email/password/
 *   passwordHash/accountEmails are structurally removed. Only doc paths,
 *   roles, storeId strings (namespaced, non-sensitive), booleans, and
 *   _e2e markers remain.
 * - verify/cleanup outputs contain only booleans/counts/paths/codes.
 *
 * Usage (real run — NOT executed in this source task):
 *   node scripts/probe-auth-identities.mjs seed --run-id=<runId> --manifest=<path>
 *   node scripts/probe-auth-identities.mjs verify --manifest=<path>
 *   node scripts/probe-auth-identities.mjs cleanup --manifest=<path>
 */

import { inspectFirebaseServiceAccount } from './check-round-direct-e2e-readiness.mjs';

export const APPROVAL_VALUE = 'NON_PRODUCTION_AUTH_PROBE_APPROVED';
export const PRODUCTION_FIREBASE_PROJECT = 'green-e4fe3';
export const TARGET_FIREBASE_PROJECT = 'greenhub-round-direct-e2e';
export const PRODUCTION_STORE_ID = '80189070-2c3d-45f2-bc11-68a870b13951';
export const IDENTITY_PURPOSE = 'auth-probe';
export const ROLES = Object.freeze(['consumer', 'seller', 'driver']);

const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{6,46}[a-z0-9]$/;
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$.{53}$/;

export class IdentityContractError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'IdentityContractError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

function fail(code, message, details) {
  throw new IdentityContractError(code, message, details);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export function normalizeRunId(value) {
  const runId = String(value ?? '').trim();
  if (!RUN_ID_PATTERN.test(runId)) {
    fail('RUN_ID_INVALID', 'auth probe run ID 형식이 올바르지 않습니다.');
  }
  return runId;
}

function readServiceAccountRaw(options = {}, env = process.env) {
  if (isNonEmptyString(options.serviceAccountJson)) return options.serviceAccountJson;
  // Approved Environment secret reuse: the round-direct Environment exposes
  // the staging service account under this name; the generic name is kept as
  // a fallback for local/diagnostic parity. No new secret is introduced.
  if (isNonEmptyString(env.ROUND_DIRECT_E2E_FIREBASE_SERVICE_ACCOUNT_JSON)) {
    return env.ROUND_DIRECT_E2E_FIREBASE_SERVICE_ACCOUNT_JSON;
  }
  if (isNonEmptyString(env.FIREBASE_SERVICE_ACCOUNT_JSON)) return env.FIREBASE_SERVICE_ACCOUNT_JSON;
  return '';
}

/**
 * Fail-closed non-production target guard. No network, no mutation.
 * Reuses inspectFirebaseServiceAccount() from the verified readiness guard.
 */
export function validateIdentityTarget(options = {}, env = process.env) {
  const approval = String(options.approval ?? env.NON_PRODUCTION_AUTH_PROBE_APPROVAL ?? env.APPROVAL ?? '').trim();
  if (approval !== APPROVAL_VALUE) {
    fail('MISSING_APPROVAL', 'explicit non-production approval이 없어 identity lifecycle을 차단합니다.');
  }
  const enabled = String(options.enabled ?? env.ROUND_DIRECT_E2E_ENABLED ?? '').trim();
  if (enabled !== 'true') {
    fail('E2E_NOT_ENABLED', 'ROUND_DIRECT_E2E_ENABLED가 true가 아닙니다.');
  }
  const environment = String(options.environment ?? env.ROUND_DIRECT_E2E_ENV ?? '').trim();
  if (environment !== 'preview') {
    fail('ENVIRONMENT_NOT_PREVIEW', '실행 환경이 preview가 아닙니다.');
  }
  const nodeEnv = String(options.nodeEnv ?? env.NODE_ENV ?? '').trim();
  const vercelEnv = String(options.vercelEnv ?? env.VERCEL_ENV ?? '').trim();
  const railwayEnv = String(options.railwayEnvironment ?? env.RAILWAY_ENVIRONMENT_NAME ?? '').trim();
  if (nodeEnv === 'production' || vercelEnv === 'production' || railwayEnv === 'production') {
    fail('PRODUCTION_ENVIRONMENT', 'production runtime marker가 있어 identity lifecycle을 차단합니다.');
  }
  const firebaseProjectId = String(options.firebaseProjectId ?? env.FIREBASE_PROJECT_ID ?? '').trim();
  if (!firebaseProjectId) {
    fail('FIREBASE_TARGET_MISSING', 'Firebase 비운영 대상 project ID가 없습니다.');
  }
  if (firebaseProjectId === PRODUCTION_FIREBASE_PROJECT) {
    fail('PRODUCTION_FIREBASE_PROJECT', '운영 Firebase project는 사용할 수 없습니다.');
  }
  if (firebaseProjectId !== TARGET_FIREBASE_PROJECT) {
    fail('FIREBASE_PROJECT_NOT_ALLOWED', 'Firebase project가 auth probe staging target과 다릅니다.');
  }
  const allowedRaw = options.allowedFirebaseProjects ?? env.ROUND_DIRECT_E2E_ALLOWED_FIREBASE_PROJECTS ?? '';
  const allowed = splitList(allowedRaw);
  if (allowed.length === 0) {
    fail('FIREBASE_ALLOWED_PROJECTS_MISSING', 'Firebase 비운영 허용 project 목록이 없습니다.');
  }
  if (!allowed.includes(firebaseProjectId)) {
    fail('FIREBASE_PROJECT_NOT_ALLOWED', 'Firebase project가 비운영 허용 목록과 다릅니다.');
  }
  const serviceAccount = inspectFirebaseServiceAccount(readServiceAccountRaw(options, env));
  if (!serviceAccount.configured) {
    fail('FIREBASE_SERVICE_ACCOUNT_MISSING', 'Firebase 서비스 계정 자격이 없어 target identity를 확인할 수 없습니다.');
  }
  if (!serviceAccount.parseable) {
    fail('FIREBASE_SERVICE_ACCOUNT_INVALID', 'Firebase 서비스 계정 자격 JSON을 해석할 수 없습니다.');
  }
  if (!serviceAccount.projectId) {
    fail('FIREBASE_SERVICE_ACCOUNT_PROJECT_MISSING', 'Firebase 서비스 계정 project identity가 없습니다.');
  }
  if (serviceAccount.projectId === PRODUCTION_FIREBASE_PROJECT) {
    fail('PRODUCTION_FIREBASE_SERVICE_ACCOUNT', '운영 Firebase 서비스 계정은 사용할 수 없습니다.');
  }
  if (serviceAccount.projectId !== firebaseProjectId) {
    fail('FIREBASE_SERVICE_ACCOUNT_PROJECT_MISMATCH', '서비스 계정 project identity와 명시된 비운영 target이 다릅니다.');
  }
  return {
    approval,
    firebaseProjectId,
    serviceAccountProjectId: serviceAccount.projectId,
  };
}

export function resolveIdentityCredentials(options = {}, env = process.env) {
  const consumerEmail = String(options.consumerEmail ?? env.TEST_CONSUMER_EMAIL ?? '').trim();
  const consumerPassword = String(options.consumerPassword ?? env.TEST_CONSUMER_PASSWORD ?? '');
  const sellerEmail = String(options.sellerEmail ?? env.TEST_SELLER_EMAIL ?? '').trim();
  const sellerPassword = String(options.sellerPassword ?? env.TEST_SELLER_PASSWORD ?? '');
  const driverEmail = String(options.driverEmail ?? env.TEST_DRIVER_EMAIL ?? '').trim();
  const driverPassword = String(options.driverPassword ?? env.TEST_DRIVER_PASSWORD ?? '');
  if (!isNonEmptyString(consumerEmail) || !consumerPassword) {
    fail('CONSUMER_CREDENTIALS_MISSING', 'consumer test credential이 없어 identity seed를 차단합니다.');
  }
  if (!isNonEmptyString(sellerEmail) || !sellerPassword) {
    fail('SELLER_CREDENTIALS_MISSING', 'seller test credential이 없어 identity seed를 차단합니다.');
  }
  if (!isNonEmptyString(driverEmail) || !driverPassword) {
    fail('DRIVER_CREDENTIALS_MISSING', 'driver test credential이 없어 identity seed를 차단합니다.');
  }
  const lowered = [consumerEmail.toLowerCase(), sellerEmail.toLowerCase(), driverEmail.toLowerCase()];
  if (new Set(lowered).size !== 3) {
    fail('IDENTITY_EMAIL_COLLISION', '세 role의 test email이 서로 달라야 합니다.');
  }
  return {
    consumer: { email: consumerEmail, password: consumerPassword },
    seller: { email: sellerEmail, password: sellerPassword },
    driver: { email: driverEmail, password: driverPassword },
  };
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || !password) {
    fail('PASSWORD_MISSING', 'password가 없어 hash를 만들 수 없습니다.');
  }
  const bcrypt = await import('bcrypt');
  const impl = bcrypt.default ?? bcrypt;
  return impl.hash(password, 12);
}

export function isBcryptHash(value) {
  return typeof value === 'string' && BCRYPT_HASH_PATTERN.test(value);
}

function sellerStoreIdFor(runId, override) {
  if (override !== undefined) {
    const candidate = String(override).trim();
    if (!candidate) fail('SELLER_STORE_BINDING_INVALID', 'seller store binding이 비어 있습니다.');
    if (candidate === PRODUCTION_STORE_ID) fail('PRODUCTION_STORE', '운영 store는 사용할 수 없습니다.');
    if (!candidate.startsWith(`${runId}-`)) {
      fail('SELLER_STORE_BINDING_INVALID', 'seller store binding이 invocation namespace 밖입니다.');
    }
    return candidate;
  }
  const storeId = `${runId}-store`;
  if (storeId === PRODUCTION_STORE_ID) fail('PRODUCTION_STORE', '운영 store는 사용할 수 없습니다.');
  return storeId;
}

/**
 * Small-helper reuse of the round-direct account/user construction:
 * consumer/seller/driver docs with bcrypt passwordHash, providers, role,
 * seller storeId, driver driverApproved. No products/orders/rounds/storage.
 */
export function buildAuthProbeManifest({ runId, emails, passwordHashes, sellerStoreId } = {}) {
  const normalizedRunId = normalizeRunId(runId);
  for (const role of ROLES) {
    if (!isNonEmptyString(emails?.[role])) {
      fail('IDENTITY_EMAIL_MISSING', `${role} email이 없어 manifest를 만들 수 없습니다.`);
    }
    if (typeof passwordHashes?.[role] !== 'string' || !passwordHashes[role]) {
      fail('IDENTITY_HASH_MISSING', `${role} passwordHash가 없어 manifest를 만들 수 없습니다.`);
    }
  }
  const lowered = ROLES.map((role) => String(emails[role]).trim().toLowerCase());
  if (new Set(lowered).size !== 3) {
    fail('IDENTITY_EMAIL_COLLISION', '세 role의 email이 서로 달라야 합니다.');
  }
  const storeId = sellerStoreIdFor(normalizedRunId, sellerStoreId);
  const now = new Date().toISOString();
  const tagFor = (role) => ({ purpose: IDENTITY_PURPOSE, runId: normalizedRunId, role });
  const documents = [
    {
      path: `users/${normalizedRunId}-consumer`,
      data: {
        id: `${normalizedRunId}-consumer`,
        email: String(emails.consumer).trim(),
        name: 'Auth Probe Consumer',
        role: 'consumer',
        passwordHash: passwordHashes.consumer,
        providers: ['email'],
        savedAddresses: [],
        createdAt: now,
        updatedAt: now,
        _e2e: tagFor('consumer'),
      },
    },
    {
      path: `users/${normalizedRunId}-seller`,
      data: {
        id: `${normalizedRunId}-seller`,
        email: String(emails.seller).trim(),
        name: 'Auth Probe Seller',
        role: 'seller',
        storeId,
        passwordHash: passwordHashes.seller,
        providers: ['email'],
        savedAddresses: [],
        createdAt: now,
        updatedAt: now,
        _e2e: tagFor('seller'),
      },
    },
    {
      path: `users/${normalizedRunId}-driver`,
      data: {
        id: `${normalizedRunId}-driver`,
        email: String(emails.driver).trim(),
        name: 'Auth Probe Driver',
        role: 'driver',
        driverApproved: true,
        passwordHash: passwordHashes.driver,
        providers: ['email'],
        savedAddresses: [],
        createdAt: now,
        updatedAt: now,
        _e2e: tagFor('driver'),
      },
    },
  ];
  return {
    version: 1,
    kind: 'auth-probe-identities',
    purpose: IDENTITY_PURPOSE,
    runId: normalizedRunId,
    namespace: normalizedRunId,
    storeId,
    documentPaths: documents.map(({ path }) => path),
    documents,
  };
}

export function assertAuthProbeManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') fail('MANIFEST_INVALID', 'identity manifest가 올바르지 않습니다.');
  const runId = normalizeRunId(manifest.runId);
  if (manifest.purpose !== IDENTITY_PURPOSE) fail('MANIFEST_INVALID', 'identity manifest purpose가 올바르지 않습니다.');
  if (!Array.isArray(manifest.documents) || manifest.documents.length !== 3) {
    fail('MANIFEST_INVALID', 'identity manifest는 정확히 3개 문서를 가져야 합니다.');
  }
  const roles = new Set();
  for (const entry of manifest.documents) {
    if (!isNonEmptyString(entry?.path) || !entry?.data) fail('MANIFEST_INVALID', 'identity manifest 문서가 올바르지 않습니다.');
    if (entry.data._e2e?.purpose !== IDENTITY_PURPOSE || entry.data._e2e?.runId !== runId) {
      fail('MANIFEST_INVALID', 'identity manifest 소유 표식이 올바르지 않습니다.');
    }
    roles.add(entry.data.role);
  }
  if (roles.size !== 3 || !roles.has('consumer') || !roles.has('seller') || !roles.has('driver')) {
    fail('MANIFEST_INVALID', 'identity manifest는 consumer/seller/driver 3 role이어야 합니다.');
  }
  return runId;
}

function isOwnedDoc(data, runId) {
  return Boolean(data) && data._e2e?.purpose === IDENTITY_PURPOSE && data._e2e?.runId === runId;
}

async function findUserByEmail(adapter, email) {
  if (typeof adapter.findUserByEmail === 'function') {
    return adapter.findUserByEmail(email);
  }
  return null;
}

/**
 * Seed exactly 3 owned user docs. Fail-closed on unrelated-email collision.
 * Partial failure cleans up already-created owned docs from this invocation.
 */
export async function seedAuthProbeIdentities(adapter, manifest) {
  const runId = assertAuthProbeManifest(manifest);
  const created = [];
  try {
    for (const entry of manifest.documents) {
      const existing = await adapter.getDoc(entry.path);
      if (existing && !isOwnedDoc(existing, runId)) {
        fail('IDENTITY_COLLISION', `다른 소유자의 identity 문서가 존재합니다: ${entry.path}.`, {
          path: entry.path,
        });
      }
      // Same-email unrelated user must never be overwritten. The path-level
      // check above covers same-path collisions; the email scan covers the
      // case where the same email lives under a different document id.
      const collision = await findUserByEmail(adapter, entry.data.email);
      if (collision && collision.path !== entry.path) {
        const collisionOwned = isOwnedDoc(collision.data, runId);
        if (!collisionOwned) {
          fail('IDENTITY_COLLISION', '같은 email의 unrelated user가 있어 seed를 차단합니다.', {
            path: entry.path,
          });
        }
      }
      if (existing && isOwnedDoc(existing, runId)) {
        // Idempotent re-seed for the same invocation: refresh owned doc.
        await adapter.setDoc(entry.path, entry.data);
        if (!created.includes(entry.path)) created.push(entry.path);
        continue;
      }
      await adapter.setDoc(entry.path, entry.data);
      created.push(entry.path);
    }
  } catch (error) {
    // Best-effort bounded cleanup of docs created by this invocation only.
    for (const docPath of [...created].reverse()) {
      try {
        const current = await adapter.getDoc(docPath);
        if (isOwnedDoc(current, runId)) {
          await adapter.deleteDoc(docPath);
        }
      } catch {
        // Cleanup errors must not mask the original seed failure.
      }
    }
    throw error;
  }
  return { ready: true, created };
}

/**
 * Secret-safe verification: booleans only, never email/password/hash/token.
 */
export async function verifyAuthProbeIdentities(adapter, manifest) {
  const runId = assertAuthProbeManifest(manifest);
  const roles = {};
  const failureCodes = [];
  for (const entry of manifest.documents) {
    const role = entry.data.role;
    const expectedStoreId = manifest.storeId;
    const data = await adapter.getDoc(entry.path);
    const checks = {
      exists: Boolean(data),
      owned: isOwnedDoc(data, runId),
      roleOk: Boolean(data) && data.role === role,
      providersOk: Boolean(data) && Array.isArray(data.providers) && data.providers.includes('email'),
      hashPresent: Boolean(data) && isBcryptHash(data.passwordHash),
      suspendedOk: Boolean(data) && data.suspended !== true,
      storeBindingOk: true,
      driverApprovedOk: true,
    };
    if (role === 'seller') {
      checks.storeBindingOk =
        Boolean(data) &&
        typeof data.storeId === 'string' &&
        data.storeId.length > 0 &&
        data.storeId !== PRODUCTION_STORE_ID &&
        data.storeId === expectedStoreId &&
        data.storeId.startsWith(`${runId}-`);
    }
    if (role === 'driver') {
      checks.driverApprovedOk = Boolean(data) && data.driverApproved === true;
    }
    const ok = Object.values(checks).every(Boolean);
    roles[role] = { ok, ...checks };
    if (!ok) failureCodes.push(`${String(role).toUpperCase()}_IDENTITY_NOT_READY`);
  }
  return { ready: failureCodes.length === 0, roles, failureCodes };
}

/**
 * Idempotent owned-only cleanup. Foreign docs are never deleted.
 */
export async function cleanupAuthProbeIdentities(adapter, manifest) {
  const runId = assertAuthProbeManifest(manifest);
  let deleted = 0;
  let skippedForeign = 0;
  let missing = 0;
  for (const entry of [...manifest.documents].reverse()) {
    const data = await adapter.getDoc(entry.path);
    if (!data) {
      missing += 1;
      continue;
    }
    if (!isOwnedDoc(data, runId)) {
      skippedForeign += 1;
      continue;
    }
    await adapter.deleteDoc(entry.path);
    deleted += 1;
  }
  const verification = await verifyAuthProbeIdentities(adapter, manifest).catch(() => null);
  // verify reports NOT_READY while owned docs remain; for cleanup the
  // success signal is "no owned docs remain", reported as absent-ready.
  let remainingOwned = 0;
  if (verification) {
    for (const entry of manifest.documents) {
      const data = await adapter.getDoc(entry.path);
      if (isOwnedDoc(data, runId)) remainingOwned += 1;
    }
  }
  return {
    ready: remainingOwned === 0,
    deleted,
    skippedForeign,
    missing,
    remainingOwned,
  };
}

/**
 * Strip credential material before persisting evidence/artifacts.
 * Removes email/password/passwordHash/accountEmails; keeps paths, roles,
 * namespaced storeId, providers-shape booleans, and _e2e markers.
 */
export function redactPersistedManifest(manifest) {
  const persisted = structuredClone(manifest);
  delete persisted.accountEmails;
  delete persisted.accountPasswords;
  for (const entry of persisted.documents ?? []) {
    if (entry.data) {
      delete entry.data.email;
      delete entry.data.password;
      delete entry.data.passwordHash;
    }
  }
  return persisted;
}

export function buildPersistedEvidence({ manifest, verifyResult, cleanupResult } = {}) {
  const redacted = manifest ? redactPersistedManifest(manifest) : null;
  const evidence = {
    kind: 'auth-probe-identities-evidence',
    purpose: IDENTITY_PURPOSE,
    runId: manifest?.runId ?? null,
    documentPaths: manifest?.documentPaths ?? [],
    storeIdPresent: Boolean(manifest?.storeId),
    storeIdIsProduction: manifest?.storeId === PRODUCTION_STORE_ID,
    roles: {},
    failureCodes: [],
  };
  if (verifyResult?.roles) {
    for (const [role, checks] of Object.entries(verifyResult.roles)) {
      evidence.roles[role] = {
        ok: Boolean(checks.ok),
        exists: Boolean(checks.exists),
        owned: Boolean(checks.owned),
        roleOk: Boolean(checks.roleOk),
        providersOk: Boolean(checks.providersOk),
        hashPresent: Boolean(checks.hashPresent),
        suspendedOk: Boolean(checks.suspendedOk),
        storeBindingOk: Boolean(checks.storeBindingOk),
        driverApprovedOk: Boolean(checks.driverApprovedOk),
      };
    }
    evidence.failureCodes = [...(verifyResult.failureCodes ?? [])];
  }
  if (cleanupResult) {
    evidence.cleanup = {
      ready: Boolean(cleanupResult.ready),
      deleted: Number(cleanupResult.deleted ?? 0),
      skippedForeign: Number(cleanupResult.skippedForeign ?? 0),
      missing: Number(cleanupResult.missing ?? 0),
      remainingOwned: Number(cleanupResult.remainingOwned ?? 0),
    };
  }
  return { manifest: redacted, evidence };
}

function argument(name) {
  return process.argv
    .slice(2)
    .find((value) => value.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');
}

async function firebaseAdapter(environment) {
  const rawCredential = readServiceAccountRaw({}, process.env);
  if (!rawCredential.trim()) throw new Error('비운영 FIREBASE_SERVICE_ACCOUNT_JSON이 필요합니다.');
  const withoutBom = rawCredential.charCodeAt(0) === 0xfeff ? rawCredential.slice(1) : rawCredential;
  const serviceAccount = JSON.parse(withoutBom);
  const { cert, initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const app = initializeApp(
    {
      credential: cert(serviceAccount),
      projectId: environment.firebaseProjectId,
    },
    `auth-probe-${environment.runId}-${Date.now()}`,
  );
  const db = getFirestore(app);
  return {
    async getDoc(docPath) {
      const snapshot = await db.doc(docPath).get();
      return snapshot.exists ? snapshot.data() : null;
    },
    async setDoc(docPath, data) {
      await db.doc(docPath).set(data);
    },
    async deleteDoc(docPath) {
      await db.doc(docPath).delete();
    },
    async findUserByEmail(email) {
      const snap = await db.collection('users').where('email', '==', email).limit(1).get();
      if (snap.empty) return null;
      const doc = snap.docs[0];
      return { path: `users/${doc.id}`, data: doc.data() };
    },
  };
}

async function main() {
  const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
  const { default: path } = await import('node:path');
  const action = process.argv[2];
  if (!['seed', 'verify', 'cleanup'].includes(action)) {
    throw new Error('사용법: node scripts/probe-auth-identities.mjs seed|verify|cleanup --manifest=<경로> [--run-id=<runId>]');
  }
  // Target guard runs BEFORE any Firestore mutation or credential hashing.
  const target = validateIdentityTarget({}, process.env);
  const manifestPath = path.resolve(argument('manifest') ?? '');
  if (!manifestPath) throw new Error('manifest 경로가 필요합니다: --manifest=<경로>');
  const adapter = await firebaseAdapter({
    firebaseProjectId: target.firebaseProjectId,
    runId: String(process.env.AUTH_PROBE_IDENTITY_RUN_ID ?? process.env.AUTH_PROBE_RUN_ID ?? 'local').trim() || 'local',
  });
  if (action === 'seed') {
    const runId = normalizeRunId(
      argument('run-id') ?? process.env.AUTH_PROBE_IDENTITY_RUN_ID ?? process.env.AUTH_PROBE_RUN_ID ?? '',
    );
    const credentials = resolveIdentityCredentials({}, process.env);
    const passwordHashes = {
      consumer: await hashPassword(credentials.consumer.password),
      seller: await hashPassword(credentials.seller.password),
      driver: await hashPassword(credentials.driver.password),
    };
    const manifest = buildAuthProbeManifest({
      runId,
      emails: {
        consumer: credentials.consumer.email,
        seller: credentials.seller.email,
        driver: credentials.driver.email,
      },
      passwordHashes,
    });
    await seedAuthProbeIdentities(adapter, manifest);
    const verifyResult = await verifyAuthProbeIdentities(adapter, manifest);
    const { manifest: persisted, evidence } = buildPersistedEvidence({ manifest, verifyResult });
    mkdirSync(path.dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(persisted, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(
      `${JSON.stringify({ action, runId, ready: verifyResult.ready, evidence }, null, 2)}\n`,
    );
    if (!verifyResult.ready) process.exitCode = 1;
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (action === 'verify') {
    const result = await verifyAuthProbeIdentities(adapter, manifest);
    const { evidence } = buildPersistedEvidence({ manifest, verifyResult: result });
    process.stdout.write(`${JSON.stringify({ action, runId: manifest.runId, ...evidence }, null, 2)}\n`);
    if (!result.ready) process.exitCode = 1;
    return;
  }
  const result = await cleanupAuthProbeIdentities(adapter, manifest);
  const { evidence } = buildPersistedEvidence({ manifest, cleanupResult: result });
  process.stdout.write(`${JSON.stringify({ action, runId: manifest.runId, ...evidence }, null, 2)}\n`);
  if (!result.ready) process.exitCode = 1;
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isDirectRun =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    const code = error instanceof IdentityContractError ? error.code : 'PROBE_INTERNAL_ERROR';
    process.stdout.write(`${JSON.stringify({ result: 'FAIL', failureCode: code, message: String(error?.message ?? error) }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
