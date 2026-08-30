import {
  isProductionRuntime,
  RuntimeConfigurationError,
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
});
