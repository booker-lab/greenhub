import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRODUCTION_FIREBASE_PROJECT = 'green-e4fe3';
export const PRODUCTION_STORE_ID = '80189070-2c3d-45f2-bc11-68a870b13951';
export const PRODUCTION_API_HOSTS = ['api-production-13e7.up.railway.app'];
export const PROVIDER_HOSTS = ['api.portone.io', 'kakaoapi.aligo.in', 'apis.aligo.in'];
const MAX_JPEG_BYTES = 5 * 1024 * 1024;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{6,46}[a-z0-9]$/;
const DEPLOYMENT_APPS = ['consumer', 'seller', 'driver'];

function splitList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseBoolean(value) {
  return value === true || value === 'true';
}

export function inspectFirebaseServiceAccount(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return { configured: false, parseable: false, projectId: null };
  }

  try {
    const raw = value.trim();
    const withoutBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const parsed = JSON.parse(withoutBom);
    const projectId =
      typeof parsed?.project_id === 'string' && parsed.project_id.trim()
        ? parsed.project_id.trim()
        : null;
    return { configured: true, parseable: true, projectId };
  } catch {
    return { configured: true, parseable: false, projectId: null };
  }
}

function safeUrlOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.origin : '';
  } catch {
    return '';
  }
}

function safePreviewTargetUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function normalizeTargetUrls(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    DEPLOYMENT_APPS.map((app) => [app, safePreviewTargetUrl(value[app])]),
  );
}

function isProductionOrigin(origin) {
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return hostname === 'greenlove.co.kr' || hostname.endsWith('.greenlove.co.kr');
  } catch {
    return true;
  }
}

function isProductionApiOrigin(origin) {
  if (isProductionOrigin(origin)) return true;
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return PRODUCTION_API_HOSTS.includes(hostname) || hostname.startsWith('api-production-');
  } catch {
    return true;
  }
}

function isProductionBucket(bucket) {
  const normalized = String(bucket ?? '').toLowerCase();
  return normalized.includes(PRODUCTION_FIREBASE_PROJECT);
}

function addFailure(failures, code, message) {
  failures.push({ code, message });
}

function evaluateApiTarget(input) {
  const hasApiContract =
    Object.hasOwn(input ?? {}, 'apiOrigin') || Object.hasOwn(input ?? {}, 'allowedApiOrigins');
  if (!hasApiContract) {
    return { apiOrigin: null, failures: [] };
  }

  const failures = [];
  const apiOrigin = String(input?.apiOrigin ?? '').trim();
  const allowedApiOrigins = Array.isArray(input?.allowedApiOrigins)
    ? input.allowedApiOrigins.map(String).map((item) => item.trim()).filter(Boolean)
    : [];
  if (!apiOrigin || !allowedApiOrigins.includes(apiOrigin)) {
    addFailure(failures, 'API_ORIGIN_NOT_ALLOWED', 'API origin이 비운영 허용 목록과 다릅니다.');
  }
  if (isProductionApiOrigin(apiOrigin)) {
    addFailure(failures, 'PRODUCTION_API_ORIGIN', '운영 API origin은 사용할 수 없습니다.');
  }
  return { apiOrigin: apiOrigin || null, failures };
}

function evaluatePreviewAppTargets(input) {
  const hasAppContract =
    Object.hasOwn(input ?? {}, 'previewAppOrigins') ||
    Object.hasOwn(input ?? {}, 'allowedPreviewAppOrigins');
  if (!hasAppContract) {
    return { previewAppOrigins: {}, failures: [] };
  }

  const failures = [];
  const previewAppOrigins = input?.previewAppOrigins ?? {};
  const allowedPreviewAppOrigins = Array.isArray(input?.allowedPreviewAppOrigins)
    ? input.allowedPreviewAppOrigins.map(String).map((item) => item.trim()).filter(Boolean)
    : [];
  if (allowedPreviewAppOrigins.length === 0) {
    addFailure(
      failures,
      'PREVIEW_APP_ALLOWED_ORIGINS_MISSING',
      'Preview 앱 비운영 origin 허용 목록이 없습니다.',
    );
  }
  for (const app of DEPLOYMENT_APPS) {
    const origin = String(previewAppOrigins[app] ?? '').trim();
    if (!origin) {
      addFailure(
        failures,
        'PREVIEW_APP_ORIGIN_MISSING',
        `${app} Preview 앱 origin이 없습니다.`,
      );
      continue;
    }
    if (isProductionOrigin(origin)) {
      addFailure(
        failures,
        'PRODUCTION_PREVIEW_APP_ORIGIN',
        `${app} Preview target이 운영 origin입니다.`,
      );
    }
    if (allowedPreviewAppOrigins.length > 0 && !allowedPreviewAppOrigins.includes(origin)) {
      addFailure(
        failures,
        'PREVIEW_APP_ORIGIN_NOT_ALLOWED',
        `${app} Preview origin이 비운영 허용 목록과 다릅니다.`,
      );
    }
  }
  return { previewAppOrigins, failures };
}

export function evaluateFirebaseTarget(input, { requireServiceAccount = false } = {}) {
  const failures = [];
  const firebaseProjectId = String(input?.firebaseProjectId ?? '').trim();
  const allowedFirebaseProjects = Array.isArray(input?.allowedFirebaseProjects)
    ? input.allowedFirebaseProjects.map(String).map((item) => item.trim()).filter(Boolean)
    : [];
  const storageBucket = String(input?.storageBucket ?? '').trim();
  const allowedStorageBuckets = Array.isArray(input?.allowedStorageBuckets)
    ? input.allowedStorageBuckets.map(String).map((item) => item.trim()).filter(Boolean)
    : [];
  const serviceAccount = input?.serviceAccount ?? {
    configured: false,
    parseable: false,
    projectId: null,
  };

  if (!firebaseProjectId) {
    addFailure(failures, 'FIREBASE_TARGET_MISSING', 'Firebase 비운영 대상 project ID가 없습니다.');
  }
  if (firebaseProjectId === PRODUCTION_FIREBASE_PROJECT) {
    addFailure(failures, 'PRODUCTION_FIREBASE_PROJECT', '운영 Firebase project는 사용할 수 없습니다.');
  }
  if (allowedFirebaseProjects.length === 0) {
    addFailure(
      failures,
      'FIREBASE_ALLOWED_PROJECTS_MISSING',
      'Firebase 비운영 허용 project 목록이 없습니다.',
    );
  } else if (!allowedFirebaseProjects.includes(firebaseProjectId)) {
    addFailure(
      failures,
      'FIREBASE_PROJECT_NOT_ALLOWED',
      'Firebase project가 비운영 허용 목록과 다릅니다.',
    );
  }

  if (requireServiceAccount && !serviceAccount.configured) {
    addFailure(
      failures,
      'FIREBASE_SERVICE_ACCOUNT_MISSING',
      'Firebase 서비스 계정 자격이 없어 target identity를 확인할 수 없습니다.',
    );
  } else if (serviceAccount.configured && !serviceAccount.parseable) {
    addFailure(
      failures,
      'FIREBASE_SERVICE_ACCOUNT_INVALID',
      'Firebase 서비스 계정 자격 JSON을 해석할 수 없습니다.',
    );
  } else if (requireServiceAccount && !serviceAccount.projectId) {
    addFailure(
      failures,
      'FIREBASE_SERVICE_ACCOUNT_PROJECT_MISSING',
      'Firebase 서비스 계정 project identity가 없습니다.',
    );
  }
  if (serviceAccount.projectId === PRODUCTION_FIREBASE_PROJECT) {
    addFailure(
      failures,
      'PRODUCTION_FIREBASE_SERVICE_ACCOUNT',
      '운영 Firebase 서비스 계정은 사용할 수 없습니다.',
    );
  }
  if (
    serviceAccount.projectId &&
    firebaseProjectId &&
    serviceAccount.projectId !== firebaseProjectId
  ) {
    addFailure(
      failures,
      'FIREBASE_SERVICE_ACCOUNT_PROJECT_MISMATCH',
      '서비스 계정 project identity와 명시된 비운영 target이 다릅니다.',
    );
  }

  if (!storageBucket) {
    addFailure(failures, 'STORAGE_BUCKET_MISSING', 'Firebase 비운영 Storage bucket이 없습니다.');
  }
  if (isProductionBucket(storageBucket)) {
    addFailure(failures, 'PRODUCTION_STORAGE_BUCKET', '운영 Storage bucket은 사용할 수 없습니다.');
  } else if (allowedStorageBuckets.length === 0) {
    addFailure(
      failures,
      'STORAGE_ALLOWED_BUCKETS_MISSING',
      'Storage 비운영 허용 bucket 목록이 없습니다.',
    );
  } else if (!allowedStorageBuckets.includes(storageBucket)) {
    addFailure(
      failures,
      'STORAGE_BUCKET_NOT_ALLOWED',
      'Storage bucket이 비운영 허용 목록과 다릅니다.',
    );
  }

  return {
    ready: failures.length === 0,
    firebaseProjectId: firebaseProjectId || null,
    serviceAccountProjectId: serviceAccount.projectId ?? null,
    storageBucket: storageBucket || null,
    failureCodes: failures.map(({ code }) => code),
    failures,
  };
}

export function inspectJpegBuffer(buffer) {
  const exists = Buffer.isBuffer(buffer);
  const size = exists ? buffer.length : 0;
  return {
    exists,
    mime: exists ? 'image/jpeg' : null,
    size,
    hasStartMagic:
      exists && size >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
    hasEndMagic: exists && size >= 2 && buffer[size - 2] === 0xff && buffer[size - 1] === 0xd9,
  };
}

export function inspectJpegFile(filePath) {
  try {
    return inspectJpegBuffer(fs.readFileSync(filePath));
  } catch {
    return {
      exists: false,
      mime: null,
      size: 0,
      hasStartMagic: false,
      hasEndMagic: false,
    };
  }
}

export function normalizeReadinessInput(env = process.env, options = {}) {
  const runId = env.ROUND_DIRECT_E2E_RUN_ID?.trim() ?? '';
  const jpegPath =
    options.jpegPath ??
    env.ROUND_DIRECT_E2E_JPEG_PATH ??
    path.resolve(process.cwd(), 'apps/e2e/fixtures/round-direct-delivery.jpg');
  const authEvidence = parseJsonObject(env.ROUND_DIRECT_E2E_AUTH_EVIDENCE_JSON);

  return {
    enabled: env.ROUND_DIRECT_E2E_ENABLED,
    environment: env.ROUND_DIRECT_E2E_ENV,
    runId,
    expectedSha: env.ROUND_DIRECT_E2E_EXPECTED_SHA?.trim().toLowerCase() ?? '',
    providerMode: env.ROUND_DIRECT_E2E_PROVIDER_MODE,
    sharedSecretConfigured: Boolean(env.ROUND_DIRECT_E2E_SHARED_SECRET?.trim()),
    apiOrigin: safeUrlOrigin(env.ROUND_DIRECT_E2E_API_ORIGIN),
    allowedApiOrigins: splitList(env.ROUND_DIRECT_E2E_ALLOWED_API_ORIGINS).map(safeUrlOrigin),
    previewAppOrigins: Object.fromEntries(
      DEPLOYMENT_APPS.map((app) => [
        app,
        safeUrlOrigin(env[`${app.toUpperCase()}_BASE`]),
      ]),
    ),
    allowedPreviewAppOrigins: splitList(env.ROUND_DIRECT_E2E_ALLOWED_PREVIEW_APP_ORIGINS).map(
      safeUrlOrigin,
    ),
    firebaseProjectId: env.FIREBASE_PROJECT_ID?.trim() ?? '',
    allowedFirebaseProjects: splitList(env.ROUND_DIRECT_E2E_ALLOWED_FIREBASE_PROJECTS),
    serviceAccount: inspectFirebaseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON),
    storageBucket: env.FIREBASE_STORAGE_BUCKET?.trim() ?? '',
    allowedStorageBuckets: splitList(env.ROUND_DIRECT_E2E_ALLOWED_STORAGE_BUCKETS),
    storagePrefix:
      env.ROUND_DIRECT_E2E_STORAGE_PREFIX?.trim() ??
      (runId ? `e2e/round-direct/${runId}/` : ''),
    fixtureStoreId: env.ROUND_DIRECT_E2E_STORE_ID?.trim() ?? '',
    deploymentShas: parseJsonObject(env.ROUND_DIRECT_E2E_DEPLOYMENT_SHAS_JSON),
    targetUrls: normalizeTargetUrls(parseJsonObject(env.ROUND_DIRECT_E2E_TARGET_URLS_JSON)),
    auth: {
      consumer: authEvidence.consumer ?? {
        configured: Boolean(env.TEST_CONSUMER_EMAIL && env.TEST_CONSUMER_PASSWORD),
        role: null,
        verified: false,
      },
      seller: authEvidence.seller ?? {
        configured: Boolean(env.TEST_SELLER_EMAIL && env.TEST_SELLER_PASSWORD),
        role: null,
        verified: false,
      },
      driver: authEvidence.driver ?? {
        configured: Boolean(env.TEST_DRIVER_EMAIL && env.TEST_DRIVER_PASSWORD),
        role: null,
        approved: false,
        verified: false,
      },
    },
    providerEgressHosts: splitList(env.ROUND_DIRECT_E2E_PROVIDER_EGRESS_HOSTS),
    jpeg: options.jpeg ?? inspectJpegFile(jpegPath),
    jpegPath,
    fixtureProjects: splitList(
      env.ROUND_DIRECT_E2E_FIXTURE_PROJECTS ?? 'chromium,mobile',
    ),
    manifestPath:
      env.ROUND_DIRECT_E2E_FIXTURE_MANIFEST?.trim() ??
      (runId ? `.artifacts/round-direct/${runId}/manifest.json` : ''),
    cleanupConfigured: parseBoolean(env.ROUND_DIRECT_E2E_CLEANUP_CONFIGURED),
  };
}

export function evaluateReadiness(input) {
  const failures = [];
  const runId = String(input.runId ?? '');

  if (!parseBoolean(input.enabled)) {
    addFailure(failures, 'E2E_NOT_ENABLED', 'ROUND_DIRECT_E2E_ENABLED가 true가 아닙니다.');
  }
  if (input.environment !== 'preview') {
    addFailure(failures, 'ENVIRONMENT_NOT_PREVIEW', '실행 환경이 preview가 아닙니다.');
  }
  if (!RUN_ID_PATTERN.test(runId)) {
    addFailure(failures, 'RUN_ID_INVALID', '실행 ID 형식이 올바르지 않습니다.');
  }
  if (!SHA_PATTERN.test(String(input.expectedSha ?? ''))) {
    addFailure(failures, 'EXPECTED_SHA_INVALID', '40자리 실행 SHA가 없습니다.');
  }
  if (input.providerMode !== 'stub') {
    addFailure(failures, 'PROVIDER_MODE_NOT_STUB', 'provider mode가 stub이 아닙니다.');
  }
  if (!input.sharedSecretConfigured) {
    addFailure(failures, 'SHARED_SECRET_MISSING', '공유 secret이 설정되지 않았습니다.');
  }

  if (!input.apiOrigin || !input.allowedApiOrigins?.includes(input.apiOrigin)) {
    addFailure(failures, 'API_ORIGIN_NOT_ALLOWED', 'API origin이 비운영 허용 목록과 다릅니다.');
  }
  if (isProductionApiOrigin(input.apiOrigin)) {
    addFailure(failures, 'PRODUCTION_API_ORIGIN', '운영 API origin은 사용할 수 없습니다.');
  }
  const firebaseTarget = evaluateFirebaseTarget(input, { requireServiceAccount: true });
  failures.push(...firebaseTarget.failures);
  const expectedPrefix = runId ? `e2e/round-direct/${runId}/` : '';
  if (!expectedPrefix || input.storagePrefix !== expectedPrefix) {
    addFailure(
      failures,
      'STORAGE_PREFIX_INVALID',
      'Storage 접두사가 실행 ID 전용 경계와 다릅니다.',
    );
  }
  if (input.fixtureStoreId === PRODUCTION_STORE_ID) {
    addFailure(failures, 'PRODUCTION_STORE', '운영 디어오키드 store는 사용할 수 없습니다.');
  }
  if (!String(input.fixtureStoreId ?? '').startsWith(`round-direct-e2e-${runId}-`)) {
    addFailure(failures, 'FIXTURE_STORE_INVALID', '테스트 store ID가 실행 namespace 밖입니다.');
  }

  const expectedSha = String(input.expectedSha ?? '');
  const deploymentShas = input.deploymentShas ?? {};
  const deploymentMatches = DEPLOYMENT_APPS.every(
    (app) => deploymentShas[app] === expectedSha,
  );
  if (!deploymentMatches) {
    addFailure(
      failures,
      'DEPLOYMENT_SHA_MISMATCH',
      '세 앱 배포 SHA가 지정 SHA와 모두 일치하지 않습니다.',
    );
  }
  const targetUrls = input.targetUrls ?? {};
  const targetUrlsConfigured = DEPLOYMENT_APPS.every(
    (app) => typeof targetUrls[app] === 'string' && targetUrls[app].length > 0,
  );
  if (!targetUrlsConfigured) {
    addFailure(
      failures,
      'DEPLOYMENT_TARGET_URL_MISSING',
      '세 앱 배포 target_url이 Playwright 전달값으로 모두 연결되지 않았습니다.',
    );
  }

  for (const [name, role] of [
    ['consumer', 'consumer'],
    ['seller', 'seller'],
  ]) {
    const evidence = input.auth?.[name] ?? {};
    if (!evidence.configured || !evidence.verified || evidence.role !== role) {
      addFailure(
        failures,
        `${name.toUpperCase()}_AUTH_NOT_VERIFIED`,
        `${name} 인증이 검증되지 않았습니다.`,
      );
    }
  }
  const driver = input.auth?.driver ?? {};
  if (!driver.configured || !driver.verified || driver.role !== 'driver') {
    addFailure(failures, 'DRIVER_AUTH_NOT_VERIFIED', 'driver 인증이 검증되지 않았습니다.');
  }
  if (!driver.approved) {
    addFailure(failures, 'DRIVER_NOT_APPROVED', 'driver 승인 상태가 확인되지 않았습니다.');
  }

  const egress = (input.providerEgressHosts ?? []).filter((host) =>
    PROVIDER_HOSTS.includes(String(host).toLowerCase()),
  );
  if (egress.length > 0) {
    addFailure(
      failures,
      'PROVIDER_EGRESS_DETECTED',
      '금지된 외부 provider egress가 감지됐습니다.',
    );
  }

  const jpeg = input.jpeg ?? {};
  if (
    !jpeg.exists ||
    jpeg.mime !== 'image/jpeg' ||
    !jpeg.hasStartMagic ||
    !jpeg.hasEndMagic ||
    !Number.isSafeInteger(jpeg.size) ||
    jpeg.size <= 0 ||
    jpeg.size > MAX_JPEG_BYTES
  ) {
    addFailure(failures, 'JPEG_INVALID', '테스트 JPEG 경계가 올바르지 않습니다.');
  }

  const projects = new Set(input.fixtureProjects ?? []);
  if (projects.size !== 2 || !projects.has('chromium') || !projects.has('mobile')) {
    addFailure(
      failures,
      'FIXTURE_PROJECTS_NOT_ISOLATED',
      'chromium과 mobile fixture namespace가 모두 준비되지 않았습니다.',
    );
  }
  const normalizedManifest = String(input.manifestPath ?? '').replaceAll('\\', '/');
  if (!runId || !normalizedManifest.includes(`/${runId}/`) || !normalizedManifest.endsWith('/manifest.json')) {
    addFailure(failures, 'MANIFEST_PATH_INVALID', 'fixture manifest 경로가 실행 ID 범위 밖입니다.');
  }
  if (!input.cleanupConfigured) {
    addFailure(failures, 'CLEANUP_NOT_CONFIGURED', 'manifest 제한 cleanup이 구성되지 않았습니다.');
  }

  return {
    ready: failures.length === 0,
    checkedAt: new Date().toISOString(),
    runId,
    expectedSha,
    environment: input.environment ?? null,
    apiOrigin: input.apiOrigin || null,
    firebaseProjectId: input.firebaseProjectId || null,
    serviceAccountProjectId: input.serviceAccount?.projectId ?? null,
    storageBucket: input.storageBucket || null,
    storagePrefix: input.storagePrefix || null,
    fixtureStoreId: input.fixtureStoreId || null,
    deploymentShas,
    targetUrls,
    auth: {
      consumer: {
        configured: Boolean(input.auth?.consumer?.configured),
        role: input.auth?.consumer?.role ?? null,
        verified: Boolean(input.auth?.consumer?.verified),
      },
      seller: {
        configured: Boolean(input.auth?.seller?.configured),
        role: input.auth?.seller?.role ?? null,
        verified: Boolean(input.auth?.seller?.verified),
      },
      driver: {
        configured: Boolean(input.auth?.driver?.configured),
        role: input.auth?.driver?.role ?? null,
        approved: Boolean(input.auth?.driver?.approved),
        verified: Boolean(input.auth?.driver?.verified),
      },
    },
    jpeg: input.jpeg,
    fixtureProjects: [...projects],
    manifestPath: input.manifestPath || null,
    cleanupConfigured: Boolean(input.cleanupConfigured),
    providerEgressCount: egress.length,
    failureCodes: failures.map(({ code }) => code),
    failures,
  };
}

export function evaluateTargetReadiness(input) {
  const previewAppTargets = evaluatePreviewAppTargets(input);
  const apiTarget = evaluateApiTarget(input);
  const firebaseTarget = evaluateFirebaseTarget(input, { requireServiceAccount: true });
  const failures = [
    ...previewAppTargets.failures,
    ...apiTarget.failures,
    ...firebaseTarget.failures,
  ];
  return {
    ready: failures.length === 0,
    checkedAt: new Date().toISOString(),
    previewAppOrigins: previewAppTargets.previewAppOrigins,
    apiOrigin: apiTarget.apiOrigin,
    firebaseProjectId: firebaseTarget.firebaseProjectId,
    serviceAccountProjectId: firebaseTarget.serviceAccountProjectId,
    storageBucket: firebaseTarget.storageBucket,
    failureCodes: failures.map(({ code }) => code),
    failures,
  };
}

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    result[key] = rawValue.trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return result;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const mergedEnv = {
    ...readDotEnv(path.join(root, 'apps/e2e/.env')),
    ...process.env,
  };
  const input = normalizeReadinessInput(mergedEnv);

  if (args.has('--target-only')) {
    const targetResult = evaluateTargetReadiness(input);
    process.stdout.write(`${JSON.stringify(targetResult, null, 2)}\n`);
    process.exitCode = targetResult.ready ? 0 : 1;
    return;
  }

  if (args.has('--check-jpeg')) {
    const jpegResult = {
      ready:
        input.jpeg.exists &&
        input.jpeg.mime === 'image/jpeg' &&
        input.jpeg.hasStartMagic &&
        input.jpeg.hasEndMagic &&
        input.jpeg.size > 0 &&
        input.jpeg.size <= MAX_JPEG_BYTES,
      jpeg: input.jpeg,
    };
    process.stdout.write(`${JSON.stringify(jpegResult, null, 2)}\n`);
    process.exitCode = jpegResult.ready ? 0 : 1;
    return;
  }

  const result = evaluateReadiness(input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ready ? 0 : 1;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
