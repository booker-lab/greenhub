import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  evaluateReadiness,
  evaluateTargetReadiness,
  inspectFirebaseServiceAccount,
  inspectJpegBuffer,
  normalizeReadinessInput,
} from './check-round-direct-e2e-readiness.mjs';

const SHA = 'a'.repeat(40);
const ROUND_DIRECT_WORKFLOW = fs.readFileSync(
  fileURLToPath(new URL('../.github/workflows/e2e-round-direct.yml', import.meta.url)),
  'utf8',
);

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
    serviceAccount: {
      configured: true,
      parseable: true,
      projectId: 'green-staging-74557',
    },
    storageBucket: 'green-staging-74557-e2e.appspot.com',
    allowedStorageBuckets: ['green-staging-74557-e2e.appspot.com'],
    storagePrefix: 'e2e/round-direct/task-6-7-run-001/',
    fixtureStoreId: 'round-direct-e2e-task-6-7-run-001-store',
    deploymentShas: {
      consumer: SHA,
      seller: SHA,
      driver: SHA,
    },
    targetUrls: {
      consumer: 'https://consumer-preview.example.test',
      seller: 'https://seller-preview.example.test',
      driver: 'https://driver-preview.example.test',
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

  it('세 앱 deployment target_url이 하나라도 없으면 거부한다', () => {
    const result = evaluateReadiness(
      validInput({
        targetUrls: { consumer: 'https://consumer-preview.example.test' },
      }),
    );
    assert.equal(result.ready, false);
    assert.ok(result.failureCodes.includes('DEPLOYMENT_TARGET_URL_MISSING'));
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

    const egress = evaluateReadiness(validInput({ providerEgressHosts: ['api.portone.io'] }));
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

describe('회차 직배송 workflow candidate source binding', () => {
  it('application SHA를 검증하면서 candidate SHA의 gate 구현을 실행한다', () => {
    assert.match(ROUND_DIRECT_WORKFLOW, /ref:\s+\$\{\{\s*github\.sha\s*\}\}/);
    assert.doesNotMatch(ROUND_DIRECT_WORKFLOW, /ref:\s+\$\{\{\s*inputs\.expected_sha\s*\}\}/);
    assert.match(ROUND_DIRECT_WORKFLOW, /git merge-base --is-ancestor/);
    assert.match(ROUND_DIRECT_WORKFLOW, /git diff --name-only/);
    assert.match(ROUND_DIRECT_WORKFLOW, /WORKFLOW_SHA:\s+\$\{\{\s*github\.sha\s*\}\}/);
    assert.match(ROUND_DIRECT_WORKFLOW, /candidate workflow SHA checkout/);
  });
});

describe('환경 입력과 JPEG 판독', () => {
  it('서비스 계정 원문에서 project identity만 추출하고 원문을 보존하지 않는다', () => {
    assert.deepEqual(
      inspectFirebaseServiceAccount(
        JSON.stringify({ project_id: 'green-staging-74557', private_key: '비밀값' }),
      ),
      { configured: true, parseable: true, projectId: 'green-staging-74557' },
    );
    assert.deepEqual(inspectFirebaseServiceAccount('{"project_id":'), {
      configured: true,
      parseable: false,
      projectId: null,
    });
    assert.deepEqual(inspectFirebaseServiceAccount(''), {
      configured: false,
      parseable: false,
      projectId: null,
    });
  });

  it('Firebase target가 없거나 모호하거나 운영이면 seed 전에 거부한다', () => {
    const base = {
      firebaseProjectId: 'green-staging-74557',
      allowedFirebaseProjects: ['green-staging-74557'],
      serviceAccount: {
        configured: true,
        parseable: true,
        projectId: 'green-staging-74557',
      },
      storageBucket: 'green-staging-74557-e2e.appspot.com',
      allowedStorageBuckets: ['green-staging-74557-e2e.appspot.com'],
    };
    const missing = evaluateTargetReadiness({ ...base, firebaseProjectId: '' });
    assert.equal(missing.ready, false);
    assert.ok(missing.failureCodes.includes('FIREBASE_TARGET_MISSING'));

    const ambiguous = evaluateTargetReadiness({
      ...base,
      serviceAccount: { configured: true, parseable: true, projectId: null },
    });
    assert.equal(ambiguous.ready, false);
    assert.ok(ambiguous.failureCodes.includes('FIREBASE_SERVICE_ACCOUNT_PROJECT_MISSING'));

    const production = evaluateTargetReadiness({
      ...base,
      firebaseProjectId: 'green-e4fe3',
      allowedFirebaseProjects: ['green-e4fe3'],
      serviceAccount: { configured: true, parseable: true, projectId: 'green-e4fe3' },
      storageBucket: 'green-e4fe3.appspot.com',
      allowedStorageBuckets: ['green-e4fe3.appspot.com'],
    });
    assert.equal(production.ready, false);
    assert.ok(production.failureCodes.includes('PRODUCTION_FIREBASE_PROJECT'));
    assert.ok(production.failureCodes.includes('PRODUCTION_FIREBASE_SERVICE_ACCOUNT'));
    assert.ok(production.failureCodes.includes('PRODUCTION_STORAGE_BUCKET'));
  });

  it('허용된 비운영 target과 서비스 계정 identity가 정확히 같을 때만 통과한다', () => {
    const result = evaluateTargetReadiness({
      firebaseProjectId: 'green-staging-74557',
      allowedFirebaseProjects: ['green-staging-74557'],
      serviceAccount: { configured: true, parseable: true, projectId: 'green-staging-74557' },
      storageBucket: 'green-staging-74557-e2e.appspot.com',
      allowedStorageBuckets: ['green-staging-74557-e2e.appspot.com'],
    });
    assert.equal(result.ready, true);
    assert.deepEqual(result.failureCodes, []);

    const mismatch = evaluateTargetReadiness({
      firebaseProjectId: 'green-staging-74557',
      allowedFirebaseProjects: ['green-staging-74557'],
      serviceAccount: { configured: true, parseable: true, projectId: 'another-staging' },
      storageBucket: 'green-staging-74557-e2e.appspot.com',
      allowedStorageBuckets: ['green-staging-74557-e2e.appspot.com'],
    });
    assert.equal(mismatch.ready, false);
    assert.ok(mismatch.failureCodes.includes('FIREBASE_SERVICE_ACCOUNT_PROJECT_MISMATCH'));
  });

  it('target-only 실행도 API origin이 없거나 운영이면 거부한다', () => {
    const base = {
      previewAppOrigins: {
        consumer: 'https://consumer-preview.example.test',
        seller: 'https://seller-preview.example.test',
        driver: 'https://driver-preview.example.test',
      },
      allowedPreviewAppOrigins: [
        'https://consumer-preview.example.test',
        'https://seller-preview.example.test',
        'https://driver-preview.example.test',
      ],
      apiOrigin: 'https://api-staging.example.test',
      allowedApiOrigins: ['https://api-staging.example.test'],
      firebaseProjectId: 'green-staging-74557',
      allowedFirebaseProjects: ['green-staging-74557'],
      serviceAccount: { configured: true, parseable: true, projectId: 'green-staging-74557' },
      storageBucket: 'green-staging-74557-e2e.appspot.com',
      allowedStorageBuckets: ['green-staging-74557-e2e.appspot.com'],
    };
    assert.equal(evaluateTargetReadiness(base).ready, true);

    const missing = evaluateTargetReadiness({ ...base, apiOrigin: '' });
    assert.equal(missing.ready, false);
    assert.ok(missing.failureCodes.includes('API_ORIGIN_NOT_ALLOWED'));

    const production = evaluateTargetReadiness({
      ...base,
      apiOrigin: 'https://api.greenlove.co.kr',
      allowedApiOrigins: ['https://api.greenlove.co.kr'],
    });
    assert.equal(production.ready, false);
    assert.ok(production.failureCodes.includes('PRODUCTION_API_ORIGIN'));

    const productionRailway = evaluateTargetReadiness({
      ...base,
      apiOrigin: 'https://api-production-13e7.up.railway.app',
      allowedApiOrigins: ['https://api-production-13e7.up.railway.app'],
    });
    assert.equal(productionRailway.ready, false);
    assert.ok(productionRailway.failureCodes.includes('PRODUCTION_API_ORIGIN'));

    const missingApp = evaluateTargetReadiness({
      ...base,
      previewAppOrigins: { ...base.previewAppOrigins, seller: '' },
    });
    assert.equal(missingApp.ready, false);
    assert.ok(missingApp.failureCodes.includes('PREVIEW_APP_ORIGIN_MISSING'));

    const productionApp = evaluateTargetReadiness({
      ...base,
      previewAppOrigins: {
        ...base.previewAppOrigins,
        consumer: 'https://greenlove.co.kr',
      },
    });
    assert.equal(productionApp.ready, false);
    assert.ok(productionApp.failureCodes.includes('PRODUCTION_PREVIEW_APP_ORIGIN'));
  });

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
      ROUND_DIRECT_E2E_TARGET_URLS_JSON: JSON.stringify({
        consumer: 'https://consumer-preview.example.test/',
        seller: 'https://seller-preview.example.test/',
        driver: 'https://driver-preview.example.test/',
      }),
    });
    assert.deepEqual(input.allowedApiOrigins, ['https://one.test', 'https://two.test']);
    assert.equal(input.deploymentShas.driver, SHA);
    assert.equal(input.targetUrls.consumer, 'https://consumer-preview.example.test');
    assert.equal(input.sharedSecretConfigured, true);
  });

  it('JPEG magic bytes와 크기를 판독한다', () => {
    const result = inspectJpegBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]));
    assert.deepEqual(result, {
      exists: true,
      mime: 'image/jpeg',
      size: 8,
      hasStartMagic: true,
      hasEndMagic: true,
    });
  });
});
