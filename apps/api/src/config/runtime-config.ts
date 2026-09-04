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

export function isProductionRuntime(values: RuntimeConfigValues): boolean {
  const railwayEnvironment = readString(values, 'RAILWAY_ENVIRONMENT_NAME');
  if (railwayEnvironment) return railwayEnvironment === 'production';

  const vercelEnvironment = readString(values, 'VERCEL_ENV');
  if (vercelEnvironment) return vercelEnvironment === 'production';

  return readString(values, 'NODE_ENV') === 'production';
}

export function isLocalRuntime(values: RuntimeConfigValues): boolean {
  return readString(values, 'GREENHUB_LOCAL_RUNTIME') === 'true';
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

export function resolveFirebaseAdminSettings(values: RuntimeConfigValues): FirebaseAdminSettings {
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

export function validateRuntimeConfig(values: RuntimeConfigValues): RuntimeConfigValues {
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

  resolveFirebaseAdminSettings(values);
  return values;
}

export function getConfigValues(config: ConfigService): RuntimeConfigValues {
  return {
    NODE_ENV: config.get<string>('NODE_ENV'),
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
    FIRESTORE_EMULATOR_HOST: config.get<string>('FIRESTORE_EMULATOR_HOST'),
    FIREBASE_AUTH_EMULATOR_HOST: config.get<string>('FIREBASE_AUTH_EMULATOR_HOST'),
    GREENHUB_LOCAL_RUNTIME: config.get<string>('GREENHUB_LOCAL_RUNTIME'),
    GREENHUB_SCHEDULES_ENABLED: config.get<string>('GREENHUB_SCHEDULES_ENABLED'),
  };
}
