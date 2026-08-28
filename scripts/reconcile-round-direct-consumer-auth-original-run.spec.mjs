import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyOriginalRunEvidence,
  classifyRefreshTokenUpdatedAt,
  CONSUMER_ID,
  ORIGINAL_WINDOW_END,
  ORIGINAL_WINDOW_START,
  summarizeAuditRecords,
} from './reconcile-round-direct-consumer-auth-original-run.mjs';

describe('원본 Browser 실행 인증 증거 분류', () => {
  it('정리 후 소비자 부재와 원본 user_not_found 감사 로그를 데이터 영역 불일치로 분류한다', () => {
    const result = classifyOriginalRunEvidence({
      auditRecords: [{ action: 'auth.login.failed', reason: 'user_not_found', createdAt: ORIGINAL_WINDOW_START }],
      refreshTokenMetadata: { exists: false },
    });
    assert.equal(result.rootCauseClass, 'API_FIXTURE_DATA_PLANE_MISMATCH');
    assert.equal(result.nextGate, 'P2_BROWSER_CONSUMER_API_FIREBASE_BINDING_DISCRIMINATION_GATE');
    assert.ok(result.eliminatedCandidates.includes('TEST_CONSUMER_ACCOUNT_REPAIR_GATE'));
  });

  it('wrong_password 감사 로그를 관찰된 자격 증명 상태 불일치로 분류한다', () => {
    const result = classifyOriginalRunEvidence({
      auditRecords: [{ action: 'auth.login.failed', reason: 'wrong_password', createdAt: ORIGINAL_WINDOW_START }],
      refreshTokenMetadata: { exists: false },
    });
    assert.equal(result.rootCauseClass, 'API_OBSERVED_CREDENTIAL_STATE_MISMATCH');
  });

  it('정지 감사 로그를 계정 상태 불일치로 분류한다', () => {
    const result = classifyOriginalRunEvidence({
      auditRecords: [{ action: 'auth.login.suspended', createdAt: ORIGINAL_WINDOW_START }],
      refreshTokenMetadata: { exists: false },
    });
    assert.equal(result.rootCauseClass, 'API_OBSERVED_ACCOUNT_STATE_MISMATCH');
  });

  it('원본 로그인 창의 refresh token 갱신을 Auth.js 거부 경계로 분류한다', () => {
    const result = classifyOriginalRunEvidence({
      auditRecords: [],
      refreshTokenMetadata: { exists: true, updatedAt: '2026-08-28T07:06:50Z' },
    });
    assert.equal(result.rootCauseClass, 'OTHER_AUTH_RUNTIME_FAILURE');
    assert.equal(result.safeSubtype, 'ORIGINAL_API_LOGIN_SUCCEEDED_BUT_AUTHJS_REJECTED');
    assert.equal(result.nextGate, 'AUTHJS_SESSION_CONTRACT_FIX_GATE');
  });

  it('원본 창의 감사·refresh 증거가 모두 없으면 secret/origin 경계를 남긴다', () => {
    const result = classifyOriginalRunEvidence({
      auditRecords: [],
      refreshTokenMetadata: { exists: false },
    });
    assert.equal(result.rootCauseClass, 'NOT_CLASSIFIED');
    assert.equal(result.nextGate, 'P2_BROWSER_CONSUMER_AUTH_SECRET_ORIGIN_DISCRIMINATION_GATE');
  });

  it('refresh token 갱신 시각을 원본 실행 기준으로 분류한다', () => {
    assert.equal(classifyRefreshTokenUpdatedAt({ exists: true, updatedAt: ORIGINAL_WINDOW_START }), 'WITHIN_ORIGINAL_LOGIN_WINDOW');
    assert.equal(classifyRefreshTokenUpdatedAt({ exists: true, updatedAt: ORIGINAL_WINDOW_END }), 'WITHIN_ORIGINAL_LOGIN_WINDOW');
    assert.equal(classifyRefreshTokenUpdatedAt({ exists: true, updatedAt: '2026-08-28T07:06:39Z' }), 'BEFORE_ORIGINAL_RUN');
    assert.equal(classifyRefreshTokenUpdatedAt({ exists: true, updatedAt: '2026-08-28T07:07:03Z' }), 'AFTER_ORIGINAL_RUN');
    assert.equal(CONSUMER_ID, 'round-direct-e2e-task-6-7-33150113440-1-chromium-consumer');
  });

  it('감사 로그에는 허용된 안전 필드만 남긴다', () => {
    const result = summarizeAuditRecords([
      {
        action: 'auth.login.failed',
        reason: 'wrong_password',
        createdAt: ORIGINAL_WINDOW_END,
        userId: 'must-not-print',
        detail: { email: 'must-not-print@example.test', hash: 'must-not-print' },
      },
    ]);
    const output = JSON.stringify(result);
    assert.doesNotMatch(output, /must-not-print/);
    assert.deepEqual(result.records, [{
      action: 'auth.login.failed',
      reason: 'wrong_password',
      createdAt: '2026-08-28T07:07:02.000Z',
    }]);
  });
});
