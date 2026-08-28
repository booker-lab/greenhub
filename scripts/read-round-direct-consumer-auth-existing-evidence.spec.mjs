import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PROBE_WINDOW_END,
  PROBE_WINDOW_START,
  ROOT_CAUSES,
  classifyExistingEvidence,
  collectExistingEvidence,
  createReadOnlyFirestoreFacade,
  safeIsoTimestamp,
  validateReadOnlyEnvironment,
} from './read-round-direct-consumer-auth-existing-evidence.mjs';

function consumer(overrides = {}) {
  return {
    userId: 'user-id-must-not-print',
    role: 'consumer',
    suspended: false,
    driverApproved: null,
    ...overrides,
  };
}

function fakeFirestore({ user = consumer(), audits = [], refresh = { exists: false, updatedAt: null } } = {}) {
  return {
    async findUserByEmail() {
      return user;
    },
    async findMatchingAuthAuditLogs() {
      return audits;
    },
    async getRefreshTokenMetadata() {
      return refresh;
    },
  };
}

describe('existing evidence classification', () => {
  it('user_not_found를 계정 복구 gate로 분류한다', () => {
    const result = classifyExistingEvidence({
      testConsumer: consumer(),
      auditRecords: [{ action: 'auth.login.failed', reason: 'user_not_found', createdAt: PROBE_WINDOW_START }],
      refreshTokenMetadata: { exists: false },
    });
    assert.equal(result.rootCauseClass, ROOT_CAUSES.TEST_CONSUMER_CREDENTIAL_INVALID);
    assert.equal(result.safeSubtype, 'TEST_CONSUMER_EMAIL_NOT_FOUND');
    assert.equal(result.nextGate, 'TEST_CONSUMER_ACCOUNT_REPAIR_GATE');
  });

  it('test consumer가 없으면 account missing으로 분류한다', () => {
    const result = classifyExistingEvidence({
      testConsumer: null,
      auditRecords: [],
      refreshTokenMetadata: { exists: false },
    });
    assert.equal(result.rootCauseClass, ROOT_CAUSES.TEST_CONSUMER_CREDENTIAL_INVALID);
    assert.equal(result.safeSubtype, 'TEST_CONSUMER_ACCOUNT_MISSING');
    assert.equal(result.nextGate, 'TEST_CONSUMER_ACCOUNT_REPAIR_GATE');
  });

  it('wrong_password를 비밀번호 오류로 분류한다', () => {
    const result = classifyExistingEvidence({
      testConsumer: consumer(),
      auditRecords: [{ action: 'auth.login.failed', reason: 'wrong_password', createdAt: PROBE_WINDOW_START }],
      refreshTokenMetadata: { exists: false },
    });
    assert.equal(result.safeSubtype, 'TEST_CONSUMER_PASSWORD_INVALID');
  });

  it('suspended를 계정 정지로 분류한다', () => {
    const result = classifyExistingEvidence({
      testConsumer: consumer({ suspended: true }),
      auditRecords: [{ action: 'auth.login.suspended', createdAt: PROBE_WINDOW_START }],
      refreshTokenMetadata: { exists: false },
    });
    assert.equal(result.rootCauseClass, ROOT_CAUSES.OTHER_AUTH_RUNTIME_FAILURE);
    assert.equal(result.safeSubtype, 'TEST_CONSUMER_ACCOUNT_SUSPENDED');
  });

  it('refresh update와 consumer role이면 Auth.js rejection으로 좁힌다', () => {
    const result = classifyExistingEvidence({
      testConsumer: consumer(),
      auditRecords: [],
      refreshTokenMetadata: { exists: true, updatedAt: '2026-08-28T09:45:46Z' },
    });
    assert.equal(result.rootCauseClass, ROOT_CAUSES.OTHER_AUTH_RUNTIME_FAILURE);
    assert.equal(result.safeSubtype, 'API_LOGIN_SUCCEEDED_BUT_AUTHJS_CREDENTIALS_REJECTED');
    assert.equal(result.nextGate, 'AUTHJS_SESSION_CONTRACT_FIX_GATE');
  });

  it('refresh update와 비허용 role이면 role mismatch로 분류한다', () => {
    const result = classifyExistingEvidence({
      testConsumer: consumer({ role: 'seller' }),
      auditRecords: [],
      refreshTokenMetadata: { exists: true, updatedAt: '2026-08-28T09:45:46Z' },
    });
    assert.equal(result.rootCauseClass, ROOT_CAUSES.TEST_CONSUMER_ROLE_MISMATCH);
    assert.equal(result.nextGate, 'TEST_CONSUMER_ACCOUNT_REPAIR_GATE');
  });

  it('실패 audit와 refresh update가 충돌하면 임의 분류하지 않는다', () => {
    const result = classifyExistingEvidence({
      testConsumer: consumer(),
      auditRecords: [{ action: 'auth.login.failed', reason: 'wrong_password', createdAt: PROBE_WINDOW_START }],
      refreshTokenMetadata: { exists: true, updatedAt: '2026-08-28T09:45:46Z' },
    });
    assert.equal(result.rootCauseClass, ROOT_CAUSES.NOT_CLASSIFIED);
    assert.equal(result.nextGate, 'P2_BROWSER_CONSUMER_AUTH_SECRET_API_ORIGIN_DISCRIMINATION_GATE');
  });

  it('증거가 없으면 secret와 API origin을 둘 다 남긴다', () => {
    const result = classifyExistingEvidence({
      testConsumer: consumer(),
      auditRecords: [],
      refreshTokenMetadata: { exists: true, updatedAt: '2026-08-28T09:30:00Z' },
    });
    assert.deepEqual(result.remainingCandidates, [
      ROOT_CAUSES.AUTH_HEADER_SECRET_MISMATCH,
      ROOT_CAUSES.CONSUMER_API_ORIGIN_MISMATCH,
    ]);
  });
});

describe('safe output and read-only boundary', () => {
  it('production Firebase project는 개인 키 사용 전에 차단한다', () => {
    assert.throws(
      () => validateReadOnlyEnvironment({
        serviceAccountJson: JSON.stringify({ project_id: 'green-e4fe3' }),
        consumerEmail: 'consumer@example.test',
        allowedProjects: 'green-e4fe3',
      }),
      { code: 'PRODUCTION_FIREBASE_PROJECT_BLOCKED' },
    );
  });

  it('사용자 식별자·token 값이 결과에 직렬화되지 않는다', async () => {
    const result = await collectExistingEvidence({
      firestore: fakeFirestore({
        audits: [{
          action: 'auth.login.failed',
          reason: 'private-detail@example.test',
          createdAt: PROBE_WINDOW_START,
        }],
        refresh: { exists: true, updatedAt: '2026-08-28T09:45:46Z', token: 'refresh-token-must-not-print' },
      }),
      consumerEmail: 'consumer@example.test',
    });
    const output = JSON.stringify(result);
    assert.doesNotMatch(output, /user-id-must-not-print/);
    assert.doesNotMatch(output, /refresh-token-must-not-print/);
    assert.doesNotMatch(output, /consumer@example\.test/);
    assert.doesNotMatch(output, /private-detail@example\.test/);
    assert.equal(result.refreshTokenDocumentExists, true);
  });

  it('read-only facade는 write API를 노출하지 않는다', () => {
    const facade = createReadOnlyFirestoreFacade({
      serviceAccountJson: JSON.stringify({
        project_id: 'green-staging-74557',
        client_email: 'reader@example.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY----- test -----END PRIVATE KEY-----',
      }),
      consumerEmail: 'consumer@example.test',
      allowedProjects: 'green-staging-74557',
      fetchImpl: async () => ({ ok: false, status: 500, async json() { return {}; } }),
    });
    assert.equal(typeof facade.set, 'undefined');
    assert.equal(typeof facade.update, 'undefined');
    assert.equal(typeof facade.create, 'undefined');
    assert.equal(typeof facade.delete, 'undefined');
    assert.equal(typeof facade.batch, 'undefined');
    assert.equal(typeof facade.runTransaction, 'undefined');
  });

  it('timestamp를 안전한 ISO 문자열로만 변환한다', () => {
    assert.equal(safeIsoTimestamp({ _seconds: 1787910346, _nanoseconds: 0 }), '2026-08-28T09:45:46.000Z');
    assert.equal(safeIsoTimestamp('not-a-timestamp'), null);
    assert.equal(PROBE_WINDOW_END, '2026-08-28T09:46:46Z');
  });
});
