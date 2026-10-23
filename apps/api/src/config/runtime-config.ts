import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ServiceAccount } from 'firebase-admin';

type RuntimeConfigValues = Record<string, unknown>;

const PRODUCTION_REQUIRED_KEYS = [
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'PORTONE_V2_SECRET',
  'PORTONE_WEBHOOK_SECRET',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
] as const;

const PRODUCTION_SECRET_KEYS = [
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'PORTONE_V2_SECRET',
  'PORTONE_WEBHOOK_SECRET',
] as const;

const PRODUCTION_FIREBASE_PROJECT = 'green-e4fe3';
const LOCAL_FIRESTORE_EMULATOR_HOST_PATTERN = /^(?:localhost|127\.0\.0\.1):8080$/;
const LOCAL_AUTH_EMULATOR_HOST_PATTERN = /^(?:localhost|127\.0\.0\.1):9099$/;

const PLACEHOLDER_SECRET_VALUES = new Set([
  'replace-with-strong-secret',
  'replace-with-strong-refresh-secret',
  'change_me_to_random_32_chars',
]);

// JWT secret 권장 최소 길이(바이트). 미달은 운영 기동을 막지 않고 경고만 남긴다.
const RECOMMENDED_JWT_SECRET_BYTES = 32;
const MAX_TRUST_PROXY_HOPS = 10;
// Railway 런타임 기본 홉 수. scripts/release/prod-config-check.mjs의 EXPECTED_TRUST_PROXY_HOPS와 같아야 한다.
export const RAILWAY_TRUST_PROXY_HOPS = 2;

const runtimeConfigLogger = new Logger('RuntimeConfig');

const STORAGE_BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,253}[a-z0-9]$/i;

export class RuntimeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeConfigurationError';
  }
}

function readString(values: RuntimeConfigValues, key: string): string {
  const value = values[key];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 명시된 배포 환경 표식. 플랫폼 중립 표식(GREENHUB_DEPLOY_ENVIRONMENT, Cloud Run 등)과
 * Railway가 넣는 RAILWAY_ENVIRONMENT_NAME을 함께 본다. 빈 값은 뺀다.
 */
export function deployEnvironmentMarkers(values: RuntimeConfigValues): string[] {
  return [
    readString(values, 'GREENHUB_DEPLOY_ENVIRONMENT'),
    readString(values, 'RAILWAY_ENVIRONMENT_NAME'),
  ].filter(Boolean);
}

/** 표시용 배포 환경 이름. 표식 중 하나라도 production이면 production, 없으면 ''. */
export function resolveDeployEnvironment(values: RuntimeConfigValues): string {
  const markers = deployEnvironmentMarkers(values);
  return markers.includes('production') ? 'production' : (markers[0] ?? '');
}

export function isProductionRuntime(values: RuntimeConfigValues): boolean {
  // 표식이 서로 달라도 하나라도 production이면 운영으로 본다(운영 보호를 풀지 않는 쪽).
  const markers = deployEnvironmentMarkers(values);
  if (markers.length > 0) return markers.includes('production');

  const vercelEnvironment = readString(values, 'VERCEL_ENV');
  if (vercelEnvironment) return vercelEnvironment === 'production';

  return readString(values, 'NODE_ENV') === 'production';
}

export function isLocalRuntime(values: RuntimeConfigValues): boolean {
  return readString(values, 'GREENHUB_LOCAL_RUNTIME') === 'true';
}

export function isApiUnitTestEnv(values: RuntimeConfigValues = process.env): boolean {
  return readString(values, 'GREENHUB_API_UNIT_TEST') === 'true';
}

export function shouldEnableScheduledJobs(values: RuntimeConfigValues = process.env): boolean {
  return readString(values, 'GREENHUB_SCHEDULES_ENABLED') !== 'false';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readServiceAccountField(
  value: Record<string, unknown>,
  field: string,
): string | undefined {
  const fieldValue = value[field];
  return typeof fieldValue === 'string' && fieldValue.trim() ? fieldValue : undefined;
}

export function parseFirebaseServiceAccount(
  rawJson: string,
  configuredProjectId?: string,
): ServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson.replace(/^\uFEFF/, '').trim());
  } catch {
    throw new RuntimeConfigurationError('FIREBASE_SERVICE_ACCOUNT_JSON이 올바른 JSON이 아닙니다.');
  }

  if (!isRecord(parsed)) {
    throw new RuntimeConfigurationError('FIREBASE_SERVICE_ACCOUNT_JSON은 객체여야 합니다.');
  }

  const projectId = readServiceAccountField(parsed, 'project_id');
  const clientEmail = readServiceAccountField(parsed, 'client_email');
  const privateKey = readServiceAccountField(parsed, 'private_key');
  if (!projectId || !clientEmail || !privateKey) {
    throw new RuntimeConfigurationError(
      'FIREBASE_SERVICE_ACCOUNT_JSON의 필수 자격 증명 필드가 없습니다.',
    );
  }

  if (configuredProjectId && projectId !== configuredProjectId) {
    throw new RuntimeConfigurationError(
      'FIREBASE_PROJECT_ID와 Firebase 자격 증명 project가 일치하지 않습니다.',
    );
  }

  return { projectId, clientEmail, privateKey };
}

function assertStorageBucket(value: string, required: boolean): void {
  if (!value && !required) return;
  if (!STORAGE_BUCKET_PATTERN.test(value)) {
    throw new RuntimeConfigurationError('FIREBASE_STORAGE_BUCKET 형식이 올바르지 않습니다.');
  }
}

export type FirebaseAdminSettings = {
  projectId?: string;
  storageBucket?: string;
  serviceAccount?: ServiceAccount;
};

function assertLocalRuntimeSafety(values: RuntimeConfigValues): void {
  if (!isLocalRuntime(values)) return;

  if (isProductionRuntime(values)) {
    throw new RuntimeConfigurationError('운영 환경에서는 local runtime을 사용할 수 없습니다.');
  }

  if (readString(values, 'GREENHUB_SCHEDULES_ENABLED') !== 'false') {
    throw new RuntimeConfigurationError('local runtime은 scheduler를 비활성화해야 합니다.');
  }

  if (!LOCAL_FIRESTORE_EMULATOR_HOST_PATTERN.test(readString(values, 'FIRESTORE_EMULATOR_HOST'))) {
    throw new RuntimeConfigurationError(
      'local runtime은 localhost Firestore emulator에 연결되어야 합니다.',
    );
  }

  if (!LOCAL_AUTH_EMULATOR_HOST_PATTERN.test(readString(values, 'FIREBASE_AUTH_EMULATOR_HOST'))) {
    throw new RuntimeConfigurationError(
      'local runtime은 localhost Firebase Auth emulator에 연결되어야 합니다.',
    );
  }

  const projectId = readString(values, 'FIREBASE_PROJECT_ID');
  if (!projectId || projectId === PRODUCTION_FIREBASE_PROJECT) {
    throw new RuntimeConfigurationError('local runtime은 비운영 Firebase project가 필요합니다.');
  }

  const storageBucket = readString(values, 'FIREBASE_STORAGE_BUCKET');
  if (
    storageBucket &&
    !new Set([`${projectId}.appspot.com`, `${projectId}.firebasestorage.app`]).has(storageBucket)
  ) {
    throw new RuntimeConfigurationError(
      'local runtime의 Firebase storage bucket이 project와 일치하지 않습니다.',
    );
  }

  if (
    readString(values, 'GOOGLE_APPLICATION_CREDENTIALS') ||
    readString(values, 'FIREBASE_SERVICE_ACCOUNT_JSON')
  ) {
    throw new RuntimeConfigurationError(
      'local runtime은 Firebase service account credential을 사용할 수 없습니다.',
    );
  }
}

export type CredentialFileReader = (path: string) => string;

const readCredentialFile: CredentialFileReader = (path) => readFileSync(path, 'utf8');

/**
 * 서비스 계정 JSON 없이 ADC를 쓸 때 실제로 연결될 수 있는 project 후보.
 * 환경 변수 project와 GOOGLE_APPLICATION_CREDENTIALS 키 파일의 project_id를 본다.
 * 파일을 읽지 못하면 후보에서 빼고, 자격 증명 초기화 단계가 실패를 처리한다.
 */
export function resolveAdcProjectIds(
  values: RuntimeConfigValues,
  readFile: CredentialFileReader = readCredentialFile,
): string[] {
  const candidates = [
    readString(values, 'GOOGLE_CLOUD_PROJECT'),
    readString(values, 'GCLOUD_PROJECT'),
  ];
  const credentialPath = readString(values, 'GOOGLE_APPLICATION_CREDENTIALS');
  if (credentialPath) {
    try {
      const parsed: unknown = JSON.parse(
        readFile(credentialPath)
          .replace(/^\uFEFF/, '')
          .trim(),
      );
      if (isRecord(parsed)) {
        candidates.push(readServiceAccountField(parsed, 'project_id')?.trim() ?? '');
      }
    } catch {
      // 읽을 수 없는 키 파일은 project 판정에 쓰지 않는다.
    }
  }
  return [...new Set(candidates.filter(Boolean))];
}

export function resolveFirebaseAdminSettings(
  values: RuntimeConfigValues,
  readFile: CredentialFileReader = readCredentialFile,
): FirebaseAdminSettings {
  assertLocalRuntimeSafety(values);

  const configuredProjectId = readString(values, 'FIREBASE_PROJECT_ID');
  const configuredBucket = readString(values, 'FIREBASE_STORAGE_BUCKET');
  const rawServiceAccount = readString(values, 'FIREBASE_SERVICE_ACCOUNT_JSON');
  const serviceAccount = rawServiceAccount
    ? parseFirebaseServiceAccount(rawServiceAccount, configuredProjectId || undefined)
    : undefined;
  const production = isProductionRuntime(values);
  const projectId = configuredProjectId || serviceAccount?.projectId;
  if (!production && projectId === PRODUCTION_FIREBASE_PROJECT) {
    throw new RuntimeConfigurationError(
      '비운영 환경에서 운영 Firebase project를 사용할 수 없습니다.',
    );
  }
  if (
    !production &&
    !serviceAccount &&
    resolveAdcProjectIds(values, readFile).includes(PRODUCTION_FIREBASE_PROJECT)
  ) {
    throw new RuntimeConfigurationError(
      '비운영 환경에서 운영 Firebase project의 기본 자격 증명을 사용할 수 없습니다.',
    );
  }
  const storageBucket = configuredBucket || (projectId ? `${projectId}.appspot.com` : undefined);
  if (production && !configuredProjectId) {
    throw new RuntimeConfigurationError('운영 Firebase project 구성이 없습니다.');
  }
  if (production && !configuredBucket) {
    throw new RuntimeConfigurationError('운영 Firebase storage bucket 구성이 없습니다.');
  }
  assertStorageBucket(storageBucket ?? '', production || Boolean(configuredBucket));

  return { projectId, storageBucket, serviceAccount };
}

/**
 * Express `trust proxy` 홉 수. 명시값(TRUST_PROXY_HOPS)이 없으면 Railway 런타임은
 * 2홉, Cloud Run(K_SERVICE)은 기동 거부, 그 밖(로컬 등)은 0(프록시 헤더 미신뢰)이다.
 * Cloud Run은 앞단(부하분산기 유무)에 따라 홉 수가 달라 기본값을 두지 않는다. 0으로 두면
 * 모든 접속자가 앞단 IP 하나로 묶여 요청 한도가 손님 전체에 한꺼번에 걸린다. Railway는 엣지 뒤에 중계 노드가 한 번 더
 * 붙는다: 2026-10-18 운영·스테이징 실측에서 1홉은 연결마다 바뀌는 중계 노드 IP를 접속자로
 * 잡았고, 2홉은 접속자마다 한 버킷이면서 클라이언트가 보낸 X-Forwarded-For를 무시했다.
 * `true` 같은 무제한 신뢰는 X-Forwarded-For를 그대로 믿게 되므로 정수만 허용한다.
 */
export function resolveTrustProxyHops(values: RuntimeConfigValues = process.env): number {
  const raw = readString(values, 'TRUST_PROXY_HOPS');
  if (!raw) {
    if (readString(values, 'RAILWAY_ENVIRONMENT_NAME')) return RAILWAY_TRUST_PROXY_HOPS;
    if (readString(values, 'K_SERVICE')) {
      throw new RuntimeConfigurationError('Cloud Run 런타임은 TRUST_PROXY_HOPS를 명시해야 합니다.');
    }
    return 0;
  }
  if (!/^\d+$/.test(raw) || Number(raw) > MAX_TRUST_PROXY_HOPS) {
    throw new RuntimeConfigurationError(
      `TRUST_PROXY_HOPS는 0~${MAX_TRUST_PROXY_HOPS} 사이의 정수여야 합니다.`,
    );
  }
  return Number(raw);
}

function assertProductionJwtSecrets(values: RuntimeConfigValues): void {
  const accessSecret = readString(values, 'JWT_SECRET');
  const refreshSecret = readString(values, 'JWT_REFRESH_SECRET');
  if (accessSecret === refreshSecret) {
    throw new RuntimeConfigurationError('JWT_SECRET과 JWT_REFRESH_SECRET은 서로 달라야 합니다.');
  }

  const shortKeys = (
    [
      ['JWT_SECRET', accessSecret],
      ['JWT_REFRESH_SECRET', refreshSecret],
    ] as const
  )
    .filter(([, secret]) => Buffer.byteLength(secret, 'utf8') < RECOMMENDED_JWT_SECRET_BYTES)
    .map(([key]) => key);
  if (shortKeys.length > 0) {
    runtimeConfigLogger.warn(
      `${shortKeys.join(', ')} 길이가 권장 최소 ${RECOMMENDED_JWT_SECRET_BYTES}바이트보다 짧습니다.`,
    );
  }
}

export function validateRuntimeConfig(values: RuntimeConfigValues): RuntimeConfigValues {
  resolveTrustProxyHops(values);

  if (!isProductionRuntime(values)) {
    resolveFirebaseAdminSettings(values);
    return values;
  }

  const missing = PRODUCTION_REQUIRED_KEYS.filter((key) => !readString(values, key));
  const placeholders = PRODUCTION_SECRET_KEYS.filter((key) =>
    PLACEHOLDER_SECRET_VALUES.has(readString(values, key)),
  );
  const invalid = [...new Set([...missing, ...placeholders])];
  if (invalid.length > 0) {
    throw new RuntimeConfigurationError(`운영 필수 구성이 누락되었습니다: ${invalid.join(', ')}`);
  }

  assertProductionJwtSecrets(values);
  resolveFirebaseAdminSettings(values);
  return values;
}

export function getConfigValues(config: ConfigService): RuntimeConfigValues {
  return {
    NODE_ENV: config.get<string>('NODE_ENV'),
    GREENHUB_DEPLOY_ENVIRONMENT: config.get<string>('GREENHUB_DEPLOY_ENVIRONMENT'),
    RAILWAY_ENVIRONMENT_NAME: config.get<string>('RAILWAY_ENVIRONMENT_NAME'),
    VERCEL_ENV: config.get<string>('VERCEL_ENV'),
    JWT_SECRET: config.get<string>('JWT_SECRET'),
    JWT_REFRESH_SECRET: config.get<string>('JWT_REFRESH_SECRET'),
    PORTONE_V2_SECRET: config.get<string>('PORTONE_V2_SECRET'),
    PORTONE_WEBHOOK_SECRET: config.get<string>('PORTONE_WEBHOOK_SECRET'),
    FIREBASE_PROJECT_ID: config.get<string>('FIREBASE_PROJECT_ID'),
    FIREBASE_STORAGE_BUCKET: config.get<string>('FIREBASE_STORAGE_BUCKET'),
    FIREBASE_SERVICE_ACCOUNT_JSON: config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON'),
    GOOGLE_APPLICATION_CREDENTIALS: config.get<string>('GOOGLE_APPLICATION_CREDENTIALS'),
    GOOGLE_CLOUD_PROJECT: config.get<string>('GOOGLE_CLOUD_PROJECT'),
    GCLOUD_PROJECT: config.get<string>('GCLOUD_PROJECT'),
    FIRESTORE_EMULATOR_HOST: config.get<string>('FIRESTORE_EMULATOR_HOST'),
    FIREBASE_AUTH_EMULATOR_HOST: config.get<string>('FIREBASE_AUTH_EMULATOR_HOST'),
    GREENHUB_LOCAL_RUNTIME: config.get<string>('GREENHUB_LOCAL_RUNTIME'),
    GREENHUB_SCHEDULES_ENABLED: config.get<string>('GREENHUB_SCHEDULES_ENABLED'),
  };
}
