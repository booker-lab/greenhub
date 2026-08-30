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

export function resolveFirebaseAdminSettings(values: RuntimeConfigValues): FirebaseAdminSettings {
  const configuredProjectId = readString(values, 'FIREBASE_PROJECT_ID');
  const configuredBucket = readString(values, 'FIREBASE_STORAGE_BUCKET');
  const rawServiceAccount = readString(values, 'FIREBASE_SERVICE_ACCOUNT_JSON');
  const serviceAccount = rawServiceAccount
    ? parseFirebaseServiceAccount(rawServiceAccount, configuredProjectId || undefined)
    : undefined;
  const projectId = configuredProjectId || serviceAccount?.projectId;
  const storageBucket = configuredBucket || (projectId ? `${projectId}.appspot.com` : undefined);

  const production = isProductionRuntime(values);
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
  };
}
