import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateReadiness,
  inspectJpegBuffer,
  normalizeReadinessInput,
} from './check-round-direct-e2e-readiness.mjs';

const SHA = 'a'.repeat(40);

function validInput(overrides = {}) {
  return {
    enabled: 'true',
    environment: 'preview',
    runId: 'task-6-7-run-001',
    expectedSha: SHA,
    providerMode: 'stub',
    sharedSecretConfigured: true,
    apiOrigin: 'https://greenhub-api-staging.example.test',
    allowedApiOrigins: ['https://greenhub-api-staging.example.test'],
    firebaseProjectId: 'green-staging-74557',
    allowedFirebaseProjects: ['green-staging-74557'],
    storageBucket: 'green-staging-74557-e2e.appspot.com',
    allowedStorageBuckets: ['green-staging-74557-e2e.appspot.com'],
    storagePrefix: 'e2e/round-direct/task-6-7-run-001/',
    fixtureStoreId: 'round-direct-e2e-task-6-7-run-001-store',
    deploymentShas: {
      consumer: SHA,
      seller: SHA,
      driver: SHA,
    },
    auth: {
      consumer: { configured: true, role: 'consumer', verified: true },
      seller: { configured: true, role: 'seller', verified: true },
      driver: { configured: true, role: 'driver', approved: true, verified: true },
    },
    providerEgressHosts: [],
    jpeg: {
      exists: true,
      mime: 'image/jpeg',
      size: 128,
      hasStartMagic: true,
      hasEndMagic: true,
    },
    fixtureProjects: ['chromium', 'mobile'],
    manifestPath: '.artifacts/round-direct/task-6-7-run-001/manifest.json',
    cleanupConfigured: true,
    ...overrides,
  };
}

describe('회차 직배송 E2E 준비조건 실패 계약', () => {
  it('완전한 비운영 입력만 통과한다', () => {
    const result = evaluateReadiness(validInput());
    assert.equal(result.ready, true);
    assert.deepEqual(result.failures, []);
  });

  it('운영 Firebase project와 디어오키드 store를 항상 거부한다', () => {
    const projectResult = evaluateReadiness(
      validInput({
        firebaseProjectId: 'green-e4fe3',
        allowedFirebaseProjects: ['green-e4fe3'],
      }),
    );
    assert.equal(projectResult.ready, false);
    assert.ok(projectResult.failureCodes.includes('PRODUCTION_FIREBASE_PROJECT'));

    const storeResult = evaluateReadiness(
      validInput({ fixtureStoreId: '80189070-2c3d-45f2-bc11-68a870b13951' }),
    );
    assert.equal(storeResult.ready, false);
    assert.ok(storeResult.failureCodes.includes('PRODUCTION_STORE'));
  });

  it('세 앱 SHA가 하나라도 다르면 거부한다', () => {
    const result = evaluateReadiness(
      validInput({
        deploymentShas: { consumer: SHA, seller: 'b'.repeat(40), driver: SHA },
      }),
    );
    assert.equal(result.ready, false);
    assert.ok(result.failureCodes.includes('DEPLOYMENT_SHA_MISMATCH'));
  });

  it('세 역할 인증과 승인 드라이버 중 하나라도 빠지면 거부한다', () => {
    const result = evaluateReadiness(
      validInput({
        auth: {
          consumer: { configured: true, role: 'consumer', verified: true },
          seller: { configured: false, role: null, verified: false },
          driver: { configured: true, role: 'driver', approved: false, verified: true },
        },
      }),
    );
    assert.equal(result.ready, false);
    assert.ok(result.failureCodes.includes('SELLER_AUTH_NOT_VERIFIED'));
    assert.ok(result.failureCodes.includes('DRIVER_NOT_APPROVED'));
  });

  it('실제 provider mode와 외부 provider egress를 거부한다', () => {
    const live = evaluateReadiness(validInput({ providerMode: 'live' }));
    assert.equal(live.ready, false);
    assert.ok(live.failureCodes.includes('PROVIDER_MODE_NOT_STUB'));

    const egress = evaluateReadiness(
      validInput({ providerEgressHosts: ['api.portone.io'] }),
    );
    assert.equal(egress.ready, false);
    assert.ok(egress.failureCodes.includes('PROVIDER_EGRESS_DETECTED'));
  });

  it('Storage 허용 목록·접두사·JPEG·cleanup 누락을 거부한다', () => {
    const result = evaluateReadiness(
      validInput({
        allowedStorageBuckets: ['other-staging.appspot.com'],
        storagePrefix: 'deliveryPhotos/order/photo.jpg',
        jpeg: {
          exists: true,
          mime: 'image/jpeg',
          size: 128,
          hasStartMagic: false,
          hasEndMagic: true,
        },
        cleanupConfigured: false,
      }),
    );
    assert.equal(result.ready, false);
    assert.ok(result.failureCodes.includes('STORAGE_BUCKET_NOT_ALLOWED'));
    assert.ok(result.failureCodes.includes('STORAGE_PREFIX_INVALID'));
    assert.ok(result.failureCodes.includes('JPEG_INVALID'));
    assert.ok(result.failureCodes.includes('CLEANUP_NOT_CONFIGURED'));
  });

  it('chromium과 mobile fixture namespace가 모두 없으면 거부한다', () => {
    const result = evaluateReadiness(validInput({ fixtureProjects: ['chromium'] }));
    assert.equal(result.ready, false);
    assert.ok(result.failureCodes.includes('FIXTURE_PROJECTS_NOT_ISOLATED'));
  });
});

describe('환경 입력과 JPEG 판독', () => {
  it('쉼표 허용 목록과 JSON 증거를 정규화한다', () => {
    const input = normalizeReadinessInput({
      ROUND_DIRECT_E2E_ENABLED: 'true',
      ROUND_DIRECT_E2E_ENV: 'preview',
      ROUND_DIRECT_E2E_RUN_ID: 'task-6-7-run-001',
      ROUND_DIRECT_E2E_EXPECTED_SHA: SHA,
      ROUND_DIRECT_E2E_PROVIDER_MODE: 'stub',
      ROUND_DIRECT_E2E_SHARED_SECRET: '비공개',
      ROUND_DIRECT_E2E_ALLOWED_API_ORIGINS: 'https://one.test, https://two.test',
      ROUND_DIRECT_E2E_DEPLOYMENT_SHAS_JSON: JSON.stringify({
        consumer: SHA,
        seller: SHA,
        driver: SHA,
      }),
    });
    assert.deepEqual(input.allowedApiOrigins, ['https://one.test', 'https://two.test']);
    assert.equal(input.deploymentShas.driver, SHA);
    assert.equal(input.sharedSecretConfigured, true);
  });

  it('JPEG magic bytes와 크기를 판독한다', () => {
    const result = inspectJpegBuffer(
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]),
    );
    assert.deepEqual(result, {
      exists: true,
      mime: 'image/jpeg',
      size: 8,
      hasStartMagic: true,
      hasEndMagic: true,
    });
  });
});
