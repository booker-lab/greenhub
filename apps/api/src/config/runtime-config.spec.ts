import {
  isLocalRuntime,
  isProductionRuntime,
  RuntimeConfigurationError,
  resolveFirebaseAdminSettings,
  shouldEnableScheduledJobs,
  validateRuntimeConfig,
} from './runtime-config';

const validProductionConfig = {
  NODE_ENV: 'production',
  FIREBASE_PROJECT_ID: 'green-production',
  FIREBASE_STORAGE_BUCKET: 'green-production.firebasestorage.app',
  FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
    project_id: 'green-production',
    client_email: 'firebase@example.test',
    private_key: 'private-key',
  }),
  JWT_SECRET: 'access-secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  PORTONE_V2_SECRET: 'portone-secret',
  PORTONE_WEBHOOK_SECRET: 'webhook-secret',
};

const validLocalRuntimeConfig = {
  NODE_ENV: 'development',
  GREENHUB_LOCAL_RUNTIME: 'true',
  GREENHUB_SCHEDULES_ENABLED: 'false',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
  FIREBASE_PROJECT_ID: 'greenhub-local',
  FIREBASE_STORAGE_BUCKET: 'greenhub-local.appspot.com',
  GOOGLE_APPLICATION_CREDENTIALS: '',
  FIREBASE_SERVICE_ACCOUNT_JSON: '',
};

describe('API 런타임 구성 fail-closed 계약', () => {
  it('유효한 운영 구성은 정상적으로 통과한다', () => {
    expect(validateRuntimeConfig(validProductionConfig)).toBe(validProductionConfig);
  });

  it.each([
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'PORTONE_V2_SECRET',
    'PORTONE_WEBHOOK_SECRET',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
  ])('%s 누락은 운영 초기화를 거부한다', (key) => {
    const invalid = { ...validProductionConfig, [key]: '' };

    expect(() => validateRuntimeConfig(invalid)).toThrow(RuntimeConfigurationError);
    expect(() => validateRuntimeConfig(invalid)).toThrow(key);
  });

  it('예제용 secret은 운영 자격 증명으로 인정하지 않는다', () => {
    const invalid = {
      ...validProductionConfig,
      JWT_SECRET: 'replace-with-strong-secret',
    };

    expect(() => validateRuntimeConfig(invalid)).toThrow('JWT_SECRET');
  });

  it('서비스 계정 JSON 오류는 비밀 원문을 오류에 포함하지 않는다', () => {
    const invalid = {
      ...validProductionConfig,
      FIREBASE_SERVICE_ACCOUNT_JSON: '{private-key-should-not-leak}',
    };

    expect(() => validateRuntimeConfig(invalid)).toThrow(
      'FIREBASE_SERVICE_ACCOUNT_JSON이 올바른 JSON이 아닙니다.',
    );
    try {
      validateRuntimeConfig(invalid);
    } catch (error) {
      expect(String(error)).not.toContain('private-key-should-not-leak');
    }
  });

  it('설정 project와 서비스 계정 project가 다르면 fail-closed한다', () => {
    const invalid = {
      ...validProductionConfig,
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        project_id: 'other-project',
        client_email: 'firebase@example.test',
        private_key: 'private-key',
      }),
    };

    expect(() => validateRuntimeConfig(invalid)).toThrow(
      'FIREBASE_PROJECT_ID와 Firebase 자격 증명 project가 일치하지 않습니다.',
    );
    expect(() => validateRuntimeConfig(invalid)).not.toThrow('other-project');
  });

  it('Railway staging은 NODE_ENV가 production이어도 비운영으로 판정한다', () => {
    expect(
      isProductionRuntime({ NODE_ENV: 'production', RAILWAY_ENVIRONMENT_NAME: 'staging' }),
    ).toBe(false);
    expect(() =>
      validateRuntimeConfig({ NODE_ENV: 'production', RAILWAY_ENVIRONMENT_NAME: 'staging' }),
    ).not.toThrow();
  });

  it('local runtime은 loopback emulator와 scheduler 비활성화가 모두 있어야 통과한다', () => {
    expect(isLocalRuntime(validLocalRuntimeConfig)).toBe(true);
    expect(validateRuntimeConfig(validLocalRuntimeConfig)).toBe(validLocalRuntimeConfig);
    expect(resolveFirebaseAdminSettings(validLocalRuntimeConfig)).toEqual({
      projectId: 'greenhub-local',
      storageBucket: 'greenhub-local.appspot.com',
      serviceAccount: undefined,
    });
    expect(shouldEnableScheduledJobs(validLocalRuntimeConfig)).toBe(false);
  });

  it.each([
    ['NODE_ENV 비개발', { NODE_ENV: 'test' }],
    ['local marker 누락', { GREENHUB_LOCAL_RUNTIME: '' }],
    ['production marker', { VERCEL_ENV: 'production' }],
    ['운영 Firebase project', { FIREBASE_PROJECT_ID: 'green-e4fe3' }],
    ['project 불일치', { FIREBASE_PROJECT_ID: 'greenhub-local-preview' }],
    ['Firestore emulator 누락', { FIRESTORE_EMULATOR_HOST: '' }],
    ['Auth emulator 누락', { FIREBASE_AUTH_EMULATOR_HOST: '' }],
    ['Storage emulator 누락', { FIREBASE_STORAGE_EMULATOR_HOST: '' }],
    ['비 loopback Storage emulator', { FIREBASE_STORAGE_EMULATOR_HOST: '192.168.0.10:9199' }],
    ['scheduler 활성화', { GREENHUB_SCHEDULES_ENABLED: 'true' }],
    ['credential 경로 설정', { GOOGLE_APPLICATION_CREDENTIALS: 'local-credential.json' }],
    ['service account 경로 설정', { FIREBASE_SERVICE_ACCOUNT_PATH: 'local-credential.json' }],
    [
      'service account JSON 설정',
      {
        FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
          project_id: 'greenhub-local',
          client_email: 'firebase@example.test',
          private_key: 'private-key',
        }),
      },
    ],
    ['storage bucket 불일치', { FIREBASE_STORAGE_BUCKET: 'green-e4fe3.appspot.com' }],
  ])('local runtime의 %s를 거부한다', (_name, override) => {
    expect(() => validateRuntimeConfig({ ...validLocalRuntimeConfig, ...override })).toThrow(
      RuntimeConfigurationError,
    );
  });

  it('local marker 없이 emulator host가 남아 있으면 원격 fallback을 허용하지 않는다', () => {
    expect(() =>
      validateRuntimeConfig({
        NODE_ENV: 'development',
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      }),
    ).toThrow('non-local runtime은 Firebase emulator host를 설정할 수 없습니다.');
  });

  it('local runtime predicate는 marker만으로 활성화되지 않는다', () => {
    expect(isLocalRuntime({ GREENHUB_LOCAL_RUNTIME: 'true' })).toBe(false);
    expect(
      isLocalRuntime({
        ...validLocalRuntimeConfig,
        NODE_ENV: 'production',
      }),
    ).toBe(false);
  });

  it('비운영 실행에서 알려진 운영 Firebase project를 거부한다', () => {
    expect(() =>
      validateRuntimeConfig({ NODE_ENV: 'development', FIREBASE_PROJECT_ID: 'green-e4fe3' }),
    ).toThrow(RuntimeConfigurationError);
  });

  it('비운영 실행에서 운영 project의 service account만 설정된 경우도 거부한다', () => {
    expect(() =>
      validateRuntimeConfig({
        NODE_ENV: 'development',
        FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
          project_id: 'green-e4fe3',
          client_email: 'firebase@example.test',
          private_key: 'private-key',
        }),
      }),
    ).toThrow(RuntimeConfigurationError);
  });

  it('scheduler는 명시적으로 끈 경우에만 끄고 기본은 기존 활성 동작을 유지한다', () => {
    expect(shouldEnableScheduledJobs({ NODE_ENV: 'production' })).toBe(true);
    expect(shouldEnableScheduledJobs({ GREENHUB_SCHEDULES_ENABLED: 'false' })).toBe(false);
  });
});
