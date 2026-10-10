import { Logger } from '@nestjs/common';
import {
  isProductionRuntime,
  RuntimeConfigurationError,
  resolveAdcProjectIds,
  resolveFirebaseAdminSettings,
  resolveTrustProxyHops,
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
  JWT_SECRET: 'access-secret-0123456789abcdef0123456789',
  JWT_REFRESH_SECRET: 'refresh-secret-0123456789abcdef0123456789',
  PORTONE_V2_SECRET: 'portone-secret',
  PORTONE_WEBHOOK_SECRET: 'webhook-secret',
};

const validLocalRuntimeConfig = {
  NODE_ENV: 'development',
  GREENHUB_LOCAL_RUNTIME: 'true',
  GREENHUB_SCHEDULES_ENABLED: 'false',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
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
    expect(validateRuntimeConfig(validLocalRuntimeConfig)).toBe(validLocalRuntimeConfig);
    expect(resolveFirebaseAdminSettings(validLocalRuntimeConfig)).toEqual({
      projectId: 'greenhub-local',
      storageBucket: 'greenhub-local.appspot.com',
      serviceAccount: undefined,
    });
    expect(shouldEnableScheduledJobs(validLocalRuntimeConfig)).toBe(false);
  });

  it.each([
    ['운영 Firebase project', { FIREBASE_PROJECT_ID: 'green-e4fe3' }],
    ['Firestore emulator 누락', { FIRESTORE_EMULATOR_HOST: '' }],
    ['Auth emulator 누락', { FIREBASE_AUTH_EMULATOR_HOST: '' }],
    ['scheduler 활성화', { GREENHUB_SCHEDULES_ENABLED: 'true' }],
    ['credential 경로 설정', { GOOGLE_APPLICATION_CREDENTIALS: 'local-credential.json' }],
    ['storage bucket 불일치', { FIREBASE_STORAGE_BUCKET: 'green-e4fe3.appspot.com' }],
  ])('local runtime의 %s를 거부한다', (_name, override) => {
    expect(() => validateRuntimeConfig({ ...validLocalRuntimeConfig, ...override })).toThrow(
      RuntimeConfigurationError,
    );
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

describe('운영 JWT secret 구성', () => {
  afterEach(() => jest.restoreAllMocks());

  it('access와 refresh secret이 같으면 운영 기동을 거부한다', () => {
    const sameSecret = 'same-secret-0123456789abcdef0123456789';
    const invalid = {
      ...validProductionConfig,
      JWT_SECRET: sameSecret,
      JWT_REFRESH_SECRET: ` ${sameSecret} `,
    };

    expect(() => validateRuntimeConfig(invalid)).toThrow(
      'JWT_SECRET과 JWT_REFRESH_SECRET은 서로 달라야 합니다.',
    );
    expect(() => validateRuntimeConfig(invalid)).not.toThrow(sameSecret);
  });

  it('32바이트 미만 secret은 운영 기동을 막지 않고 값 없이 경고만 남긴다', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const shortSecrets = {
      ...validProductionConfig,
      JWT_SECRET: 'short-access',
      JWT_REFRESH_SECRET: 'short-refresh',
    };

    expect(validateRuntimeConfig(shortSecrets)).toBe(shortSecrets);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('JWT_SECRET, JWT_REFRESH_SECRET');
    expect(message).not.toContain('short-access');
    expect(message).not.toContain('short-refresh');
  });

  it('충분히 긴 서로 다른 secret은 경고하지 않는다', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    validateRuntimeConfig(validProductionConfig);

    expect(warn).not.toHaveBeenCalled();
  });

  it('비운영 실행은 JWT secret 동일 여부로 기동을 막지 않는다', () => {
    expect(() =>
      validateRuntimeConfig({
        NODE_ENV: 'development',
        JWT_SECRET: 'same',
        JWT_REFRESH_SECRET: 'same',
      }),
    ).not.toThrow();
  });
});

describe('비운영 기본 자격 증명(ADC) project 가드', () => {
  const productionKeyFile = JSON.stringify({
    project_id: 'green-e4fe3',
    client_email: 'firebase@example.test',
    private_key: 'private-key',
  });

  it('비운영에서 운영 project 키 파일을 가리키는 ADC를 거부한다', () => {
    const readFile = jest.fn(() => productionKeyFile);

    expect(() =>
      resolveFirebaseAdminSettings(
        { NODE_ENV: 'development', GOOGLE_APPLICATION_CREDENTIALS: './key.json' },
        readFile,
      ),
    ).toThrow('비운영 환경에서 운영 Firebase project의 기본 자격 증명을 사용할 수 없습니다.');
    expect(readFile).toHaveBeenCalledWith('./key.json');
  });

  it.each([
    'GOOGLE_CLOUD_PROJECT',
    'GCLOUD_PROJECT',
  ])('비운영에서 %s가 운영 project면 거부한다', (key) => {
    expect(() =>
      resolveFirebaseAdminSettings({ NODE_ENV: 'development', [key]: 'green-e4fe3' }, () => '{}'),
    ).toThrow(RuntimeConfigurationError);
  });

  it('FIREBASE_PROJECT_ID가 비운영이어도 ADC가 운영 project면 거부한다', () => {
    expect(() =>
      resolveFirebaseAdminSettings(
        {
          NODE_ENV: 'development',
          FIREBASE_PROJECT_ID: 'greenhub-staging',
          GOOGLE_APPLICATION_CREDENTIALS: './key.json',
        },
        () => productionKeyFile,
      ),
    ).toThrow(RuntimeConfigurationError);
  });

  it('비운영 project의 ADC와 읽을 수 없는 키 파일은 기존대로 통과시킨다', () => {
    expect(
      resolveFirebaseAdminSettings(
        { NODE_ENV: 'development', GOOGLE_APPLICATION_CREDENTIALS: './key.json' },
        () => JSON.stringify({ project_id: 'greenhub-staging' }),
      ),
    ).toEqual({ projectId: undefined, storageBucket: undefined, serviceAccount: undefined });
    expect(
      resolveAdcProjectIds({ GOOGLE_APPLICATION_CREDENTIALS: './missing.json' }, () => {
        throw new Error('ENOENT');
      }),
    ).toEqual([]);
  });

  it('운영 런타임은 운영 project ADC를 그대로 허용한다', () => {
    expect(() =>
      resolveFirebaseAdminSettings(
        {
          RAILWAY_ENVIRONMENT_NAME: 'production',
          FIREBASE_PROJECT_ID: 'green-e4fe3',
          FIREBASE_STORAGE_BUCKET: 'green-e4fe3.appspot.com',
          GOOGLE_CLOUD_PROJECT: 'green-e4fe3',
        },
        () => '{}',
      ),
    ).not.toThrow();
  });
});

describe('trust proxy 홉 수 구성', () => {
  it('명시값이 없으면 Railway 런타임은 1홉, 로컬은 0홉이다', () => {
    expect(resolveTrustProxyHops({ RAILWAY_ENVIRONMENT_NAME: 'production' })).toBe(1);
    expect(resolveTrustProxyHops({ RAILWAY_ENVIRONMENT_NAME: 'staging' })).toBe(1);
    expect(resolveTrustProxyHops({ NODE_ENV: 'development' })).toBe(0);
  });

  it('명시한 정수 홉 수를 따른다', () => {
    expect(
      resolveTrustProxyHops({ RAILWAY_ENVIRONMENT_NAME: 'production', TRUST_PROXY_HOPS: '0' }),
    ).toBe(0);
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '2' })).toBe(2);
  });

  it.each([
    'true',
    '-1',
    '1.5',
    '11',
    'loopback',
  ])('TRUST_PROXY_HOPS=%s는 기동을 거부한다', (value) => {
    expect(() => resolveTrustProxyHops({ TRUST_PROXY_HOPS: value })).toThrow(
      RuntimeConfigurationError,
    );
    expect(() =>
      validateRuntimeConfig({ NODE_ENV: 'development', TRUST_PROXY_HOPS: value }),
    ).toThrow(RuntimeConfigurationError);
  });
});
