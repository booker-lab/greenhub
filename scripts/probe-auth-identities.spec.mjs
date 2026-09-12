/**
 * PILOT-AUTH-PROBE-IDENTITY-LIFECYCLE-26A deterministic tests (mock/local only).
 * No network, no secrets, no external mutation. Run:
 *   node --test scripts/probe-auth-identities.spec.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  APPROVAL_VALUE,
  IDENTITY_PURPOSE,
  PRODUCTION_STORE_ID,
  TARGET_FIREBASE_PROJECT,
  buildAuthProbeManifest,
  buildPersistedEvidence,
  cleanupAuthProbeIdentities,
  hashPassword,
  isBcryptHash,
  normalizeRunId,
  redactPersistedManifest,
  seedAuthProbeIdentities,
  validateIdentityTarget,
  verifyAuthProbeIdentities,
} from './probe-auth-identities.mjs';

const RUN_ID = 'auth-probe-34678810429-1';
const EMAILS = Object.freeze({
  consumer: 'consumer-probe@example.test',
  seller: 'seller-probe@example.test',
  driver: 'driver-probe@example.test',
});
const HASHES = Object.freeze({
  consumer: `$2b$12$${'C'.repeat(53)}`,
  seller: `$2b$12$${'S'.repeat(53)}`,
  driver: `$2b$12$${'D'.repeat(53)}`,
});

function validEnv(overrides = {}) {
  return {
    NON_PRODUCTION_AUTH_PROBE_APPROVAL: APPROVAL_VALUE,
    ROUND_DIRECT_E2E_ENABLED: 'true',
    ROUND_DIRECT_E2E_ENV: 'preview',
    NODE_ENV: 'test',
    VERCEL_ENV: 'preview',
    RAILWAY_ENVIRONMENT_NAME: 'staging',
    FIREBASE_PROJECT_ID: TARGET_FIREBASE_PROJECT,
    ROUND_DIRECT_E2E_ALLOWED_FIREBASE_PROJECTS: TARGET_FIREBASE_PROJECT,
    ROUND_DIRECT_E2E_FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: TARGET_FIREBASE_PROJECT }),
    ...overrides,
  };
}

function validOptions(overrides = {}) {
  return {
    approval: APPROVAL_VALUE,
    enabled: 'true',
    environment: 'preview',
    nodeEnv: 'test',
    vercelEnv: 'preview',
    railwayEnvironment: 'staging',
    firebaseProjectId: TARGET_FIREBASE_PROJECT,
    allowedFirebaseProjects: TARGET_FIREBASE_PROJECT,
    serviceAccountJson: JSON.stringify({ project_id: TARGET_FIREBASE_PROJECT }),
    ...overrides,
  };
}

function memoryAdapter({ failAfterWrites = Number.POSITIVE_INFINITY } = {}) {
  const docs = new Map();
  let writes = 0;
  return {
    docs,
    async getDoc(docPath) {
      return docs.get(docPath) ?? null;
    },
    async setDoc(docPath, data) {
      writes += 1;
      if (writes > failAfterWrites) throw new Error('부분 seed 실패');
      docs.set(docPath, structuredClone(data));
    },
    async deleteDoc(docPath) {
      docs.delete(docPath);
    },
    async findUserByEmail(email) {
      const needle = String(email).trim().toLowerCase();
      for (const [docPath, data] of docs.entries()) {
        if (!docPath.startsWith('users/')) continue;
        if (String(data?.email ?? '').trim().toLowerCase() === needle) {
          return { path: docPath, data: structuredClone(data) };
        }
      }
      return null;
    },
  };
}

function validManifest(overrides = {}) {
  return buildAuthProbeManifest({
    runId: RUN_ID,
    emails: { ...EMAILS },
    passwordHashes: { ...HASHES },
    ...overrides,
  });
}

describe('PILOT-AUTH-PROBE-IDENTITY-LIFECYCLE-26A target safety', () => {
  it('1. production Firebase target을 거부한다', () => {
    assert.throws(
      () => validateIdentityTarget(validOptions({ firebaseProjectId: 'green-e4fe3', allowedFirebaseProjects: 'green-e4fe3', serviceAccountJson: JSON.stringify({ project_id: 'green-e4fe3' }) }), validEnv()),
      (e) => e.code === 'PRODUCTION_FIREBASE_PROJECT',
    );
    assert.throws(
      () =>
        validateIdentityTarget(
          {},
          validEnv({
            FIREBASE_PROJECT_ID: 'green-e4fe3',
            ROUND_DIRECT_E2E_ALLOWED_FIREBASE_PROJECTS: 'green-e4fe3',
            ROUND_DIRECT_E2E_FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'green-e4fe3' }),
          }),
        ),
      (e) => e.code === 'PRODUCTION_FIREBASE_PROJECT',
    );
  });

  it('2. wrong service-account project를 거부한다', () => {
    assert.throws(
      () => validateIdentityTarget(validOptions({ serviceAccountJson: JSON.stringify({ project_id: 'other-project' }) }), validEnv()),
      (e) => e.code === 'FIREBASE_SERVICE_ACCOUNT_PROJECT_MISMATCH',
    );
    assert.throws(
      () => validateIdentityTarget(validOptions({ serviceAccountJson: '' }), validEnv({ ROUND_DIRECT_E2E_FIREBASE_SERVICE_ACCOUNT_JSON: '' })),
      (e) => e.code === 'FIREBASE_SERVICE_ACCOUNT_MISSING',
    );
    assert.throws(
      () => validateIdentityTarget(validOptions({ serviceAccountJson: '{broken' }), validEnv()),
      (e) => e.code === 'FIREBASE_SERVICE_ACCOUNT_INVALID',
    );
  });

  it('non-preview / production env / disabled harness를 거부한다', () => {
    assert.throws(() => validateIdentityTarget(validOptions({ enabled: 'false' }), validEnv()), (e) => e.code === 'E2E_NOT_ENABLED');
    assert.throws(() => validateIdentityTarget(validOptions({ environment: 'production' }), validEnv()), (e) => e.code === 'ENVIRONMENT_NOT_PREVIEW');
    assert.throws(() => validateIdentityTarget(validOptions({ nodeEnv: 'production' }), validEnv()), (e) => e.code === 'PRODUCTION_ENVIRONMENT');
    assert.throws(() => validateIdentityTarget(validOptions({ approval: 'WRONG' }), validEnv()), (e) => e.code === 'MISSING_APPROVAL');
    assert.throws(
      () => validateIdentityTarget(validOptions({ firebaseProjectId: 'other-project', allowedFirebaseProjects: 'other-project', serviceAccountJson: JSON.stringify({ project_id: 'other-project' }) }), validEnv()),
      (e) => e.code === 'FIREBASE_PROJECT_NOT_ALLOWED',
    );
  });

  it('staging target + matching service account를 허용한다', () => {
    const result = validateIdentityTarget(validOptions(), validEnv());
    assert.equal(result.firebaseProjectId, TARGET_FIREBASE_PROJECT);
    assert.equal(result.serviceAccountProjectId, TARGET_FIREBASE_PROJECT);
  });
});

describe('PILOT-AUTH-PROBE-IDENTITY-LIFECYCLE-26A identity contract', () => {
  it('3. consumer/seller/driver 정확히 3 identity를 생성한다', () => {
    const manifest = validManifest();
    assert.equal(manifest.documents.length, 3);
    assert.deepEqual(manifest.documentPaths.sort(), [
      `users/${RUN_ID}-consumer`,
      `users/${RUN_ID}-driver`,
      `users/${RUN_ID}-seller`,
    ].sort());
    const roles = new Set(manifest.documents.map(({ data }) => data.role));
    assert.deepEqual([...roles].sort(), ['consumer', 'driver', 'seller']);
    for (const entry of manifest.documents) {
      assert.equal(entry.data._e2e.purpose, IDENTITY_PURPOSE);
      assert.equal(entry.data._e2e.runId, RUN_ID);
    }
  });

  it('4. driverApproved=true 이고 suspended=true가 아니다', async () => {
    const manifest = validManifest();
    const adapter = memoryAdapter();
    await seedAuthProbeIdentities(adapter, manifest);
    const driver = await adapter.getDoc(`users/${RUN_ID}-driver`);
    assert.equal(driver.driverApproved, true);
    assert.notEqual(driver.suspended, true);
    const verify = await verifyAuthProbeIdentities(adapter, manifest);
    assert.equal(verify.roles.driver.driverApprovedOk, true);
    assert.equal(verify.roles.driver.suspendedOk, true);
    assert.equal(verify.ready, true);
  });

  it('5. seller store binding 계약 (namespaced + non-production + present)', async () => {
    const manifest = validManifest();
    assert.ok(typeof manifest.storeId === 'string' && manifest.storeId.length > 0);
    assert.equal(manifest.storeId, `${RUN_ID}-store`);
    assert.notEqual(manifest.storeId, PRODUCTION_STORE_ID);
    const sellerEntry = manifest.documents.find(({ data }) => data.role === 'seller');
    assert.ok('storeId' in sellerEntry.data);
    assert.equal(sellerEntry.data.storeId, manifest.storeId);
    const adapter = memoryAdapter();
    await seedAuthProbeIdentities(adapter, manifest);
    const verify = await verifyAuthProbeIdentities(adapter, manifest);
    assert.equal(verify.roles.seller.storeBindingOk, true);
    assert.throws(
      () => buildAuthProbeManifest({ runId: RUN_ID, emails: { ...EMAILS }, passwordHashes: { ...HASHES }, sellerStoreId: PRODUCTION_STORE_ID }),
      (e) => e.code === 'PRODUCTION_STORE',
    );
    assert.throws(
      () => buildAuthProbeManifest({ runId: RUN_ID, emails: { ...EMAILS }, passwordHashes: { ...HASHES }, sellerStoreId: 'foreign-store' }),
      (e) => e.code === 'SELLER_STORE_BINDING_INVALID',
    );
  });

  it('6. bcrypt password hash를 생성한다', async () => {
    const hash = await hashPassword('probe-password-123');
    assert.equal(isBcryptHash(hash), true);
    const bcrypt = await import('bcrypt');
    const impl = bcrypt.default ?? bcrypt;
    assert.equal(await impl.compare('probe-password-123', hash), true);
    assert.equal(await impl.compare('wrong-password', hash), false);
    // Manifest accepts real bcrypt hashes and verify reports presence only.
    const manifest = buildAuthProbeManifest({
      runId: RUN_ID,
      emails: { ...EMAILS },
      passwordHashes: { consumer: hash, seller: hash, driver: hash },
    });
    const adapter = memoryAdapter();
    await seedAuthProbeIdentities(adapter, manifest);
    const verify = await verifyAuthProbeIdentities(adapter, manifest);
    assert.equal(verify.roles.consumer.hashPresent, true);
    assert.equal(verify.roles.seller.hashPresent, true);
    assert.equal(verify.roles.driver.hashPresent, true);
  });

  it('7. persisted evidence에서 password/passwordHash/email을 제거한다', async () => {
    const manifest = validManifest();
    const persisted = redactPersistedManifest(manifest);
    assert.ok(manifest.documents.some(({ data }) => typeof data.passwordHash === 'string'));
    assert.equal(persisted.documents.some(({ data }) => Object.hasOwn(data, 'passwordHash')), false);
    assert.equal(persisted.documents.some(({ data }) => Object.hasOwn(data, 'password')), false);
    assert.equal(persisted.documents.some(({ data }) => Object.hasOwn(data, 'email')), false);
    assert.equal('accountEmails' in persisted, false);
    // persisted still carries ownership + binding for cleanup.
    assert.equal(persisted.runId, RUN_ID);
    assert.equal(persisted.storeId, `${RUN_ID}-store`);

    const adapter = memoryAdapter();
    await seedAuthProbeIdentities(adapter, manifest);
    const verify = await verifyAuthProbeIdentities(adapter, manifest);
    const { manifest: redacted, evidence } = buildPersistedEvidence({ manifest, verifyResult: verify });
    const serialized = JSON.stringify({ redacted, evidence });
    for (const sensitive of [...Object.values(HASHES), ...Object.values(EMAILS)]) {
      assert.ok(!serialized.includes(sensitive), 'evidence must not contain raw credential material');
    }
    // verify reports booleans only.
    assert.equal(typeof evidence.roles.consumer.hashPresent, 'boolean');
    assert.equal(typeof evidence.roles.seller.storeBindingOk, 'boolean');
    assert.equal(typeof evidence.roles.driver.driverApprovedOk, 'boolean');
  });

  it('runId 형식을 검증한다', () => {
    assert.equal(normalizeRunId(RUN_ID), RUN_ID);
    assert.throws(() => normalizeRunId('bad'), (e) => e.code === 'RUN_ID_INVALID');
    assert.throws(() => normalizeRunId(''), (e) => e.code === 'RUN_ID_INVALID');
  });
});

describe('PILOT-AUTH-PROBE-IDENTITY-LIFECYCLE-26A ownership / cleanup', () => {
  it('8. unrelated existing user overwrite를 금지한다 (path + email)', async () => {
    const manifest = validManifest();
    const adapter = memoryAdapter();
    // Same-path foreign doc.
    adapter.docs.set(`users/${RUN_ID}-consumer`, { id: 'foreign', email: 'other@example.test', role: 'consumer' });
    await assert.rejects(seedAuthProbeIdentities(adapter, manifest), (e) => e.code === 'IDENTITY_COLLISION');
    assert.deepEqual(adapter.docs.get(`users/${RUN_ID}-consumer`), { id: 'foreign', email: 'other@example.test', role: 'consumer' });

    // Same-email under a different path.
    const adapter2 = memoryAdapter();
    adapter2.docs.set('users/unrelated-id', { id: 'unrelated-id', email: EMAILS.seller, role: 'seller' });
    await assert.rejects(seedAuthProbeIdentities(adapter2, manifest), (e) => e.code === 'IDENTITY_COLLISION');
    // Unrelated doc is preserved and no owned docs leak.
    assert.ok(adapter2.docs.has('users/unrelated-id'));
    assert.equal(adapter2.docs.has(`users/${RUN_ID}-seller`), false);
  });

  it('9. owned docs cleanup이 동작한다', async () => {
    const manifest = validManifest();
    const adapter = memoryAdapter();
    await seedAuthProbeIdentities(adapter, manifest);
    const cleanup = await cleanupAuthProbeIdentities(adapter, manifest);
    assert.equal(cleanup.ready, true);
    assert.equal(cleanup.deleted, 3);
    assert.equal(cleanup.remainingOwned, 0);
    for (const docPath of manifest.documentPaths) {
      assert.equal(await adapter.getDoc(docPath), null);
    }
  });

  it('10. foreign docs cleanup을 금지한다', async () => {
    const manifest = validManifest();
    const adapter = memoryAdapter();
    await seedAuthProbeIdentities(adapter, manifest);
    adapter.docs.set('users/foreign-keep', { id: 'foreign-keep', email: 'keep@example.test', role: 'consumer' });
    const cleanup = await cleanupAuthProbeIdentities(adapter, manifest);
    assert.equal(cleanup.ready, true);
    assert.deepEqual(await adapter.getDoc('users/foreign-keep'), { id: 'foreign-keep', email: 'keep@example.test', role: 'consumer' });
    // Foreign doc at a manifest path is skipped, not deleted.
    const adapter2 = memoryAdapter();
    adapter2.docs.set(`users/${RUN_ID}-driver`, { id: `users/${RUN_ID}-driver`, email: 'hijack@example.test', role: 'driver' });
    const cleanup2 = await cleanupAuthProbeIdentities(adapter2, validManifest());
    assert.equal(cleanup2.skippedForeign, 1);
    assert.equal(cleanup2.deleted, 0);
    assert.ok(await adapter2.getDoc(`users/${RUN_ID}-driver`));
  });

  it('cleanup은 idempotent하다', async () => {
    const manifest = validManifest();
    const adapter = memoryAdapter();
    const first = await cleanupAuthProbeIdentities(adapter, manifest);
    assert.equal(first.ready, true);
    assert.equal(first.missing, 3);
    await seedAuthProbeIdentities(adapter, manifest);
    await cleanupAuthProbeIdentities(adapter, manifest);
    const second = await cleanupAuthProbeIdentities(adapter, manifest);
    assert.equal(second.ready, true);
    assert.equal(second.missing, 3);
  });

  it('11. partial seed failure 시 이미 생성한 owned docs를 정리한다', async () => {
    const manifest = validManifest();
    const adapter = memoryAdapter({ failAfterWrites: 1 });
    adapter.docs.set('users/unrelated', { keep: true });
    await assert.rejects(seedAuthProbeIdentities(adapter, manifest), /부분 seed 실패/);
    assert.deepEqual(await adapter.getDoc('users/unrelated'), { keep: true });
    for (const docPath of manifest.documentPaths) {
      assert.equal(await adapter.getDoc(docPath), null);
    }
  });
});

describe('PILOT-AUTH-PROBE-IDENTITY-LIFECYCLE-26A workflow + regression', () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const WORKFLOW_PATH = path.join(HERE, '..', '.github', 'workflows', 'probe-auth-runtime.yml');

  it('12. workflow dependency가 approval → identity → probes → always cleanup이다', () => {
    const source = readFileSync(WORKFLOW_PATH, 'utf8');
    assert.ok(source.includes('auth_identity_seed:'), 'workflow must contain the identity seed job');
    assert.ok(source.includes('auth_identity_cleanup:'), 'workflow must contain the identity cleanup job');
    const seedStart = source.indexOf('auth_identity_seed:');
    const sessionStart = source.indexOf('session-probe:');
    const callbackStart = source.indexOf('callback-probe:');
    const cleanupStart = source.indexOf('auth_identity_cleanup:');
    assert.ok(seedStart >= 0 && sessionStart > seedStart, 'seed must precede session-probe');
    assert.ok(callbackStart > seedStart, 'seed must precede callback-probe');
    assert.ok(cleanupStart > sessionStart && cleanupStart > callbackStart, 'cleanup must follow both probes');
    const cleanupSlice = source.slice(cleanupStart);
    assert.ok(cleanupSlice.includes('if: ${{ always() }}'), 'cleanup must run always()');
    assert.ok(cleanupSlice.includes('auth_identity_seed'), 'cleanup must need the seed job');
  });

  it('13. callback/session 기존 auth contract regression이 없다', async () => {
    const runtime = await import('./probe-auth-runtime.mjs');
    assert.equal(runtime.APPROVAL_VALUE, 'NON_PRODUCTION_AUTH_PROBE_APPROVED');
    const guarded = runtime.createGuardedFetch(async () => ({ ok: true, status: 200, data: {} }), { apiUrl: 'https://api-staging.example.test' });
    await assert.rejects(guarded('https://api-staging.example.test/auth/register', { method: 'POST' }), (e) => e.code === 'AUTH_MUTATION_FORBIDDEN');
    // Seller still requires storeId; driver still requires approval (runner contract).
    const sellerMismatch = runtime.validateRuntimeBinding;
    assert.equal(typeof sellerMismatch, 'function');
  });
});
