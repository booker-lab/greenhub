import { describe, expect, it } from 'vitest';
import { ApiConfigurationError, DEVELOPMENT_API_BASE_URL, resolveApiBaseUrl } from './api-base-url';

describe('resolveApiBaseUrl 운영 구성 검증', () => {
  it('운영에서 HTTPS API URL은 끝 슬래시를 떼고 허용한다', () => {
    expect(
      resolveApiBaseUrl({ configuredUrl: 'https://api.example.test/', nodeEnv: 'production' }),
    ).toBe('https://api.example.test');
  });

  it.each([
    'http://api.example.test',
    'http://10.0.0.5:3000',
  ])('운영에서 루프백이 아닌 http URL(%s)은 거부한다', (configuredUrl) => {
    expect(() => resolveApiBaseUrl({ configuredUrl, nodeEnv: 'production' })).toThrow(
      ApiConfigurationError,
    );
    expect(() => resolveApiBaseUrl({ configuredUrl, nodeEnv: 'production' })).toThrow(/HTTPS/);
  });

  it.each([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
  ])('운영에서 루프백 URL(%s)은 거부한다', (configuredUrl) => {
    expect(() => resolveApiBaseUrl({ configuredUrl, nodeEnv: 'production' })).toThrow(
      ApiConfigurationError,
    );
  });

  it('운영에서 URL이 없으면 거부한다', () => {
    expect(() => resolveApiBaseUrl({ configuredUrl: '', nodeEnv: 'production' })).toThrow(
      ApiConfigurationError,
    );
  });

  it.each([
    'http://localhost:3000',
    'http://api.example.test',
  ])('개발에서는 http URL(%s)을 허용한다', (configuredUrl) => {
    expect(resolveApiBaseUrl({ configuredUrl, nodeEnv: 'development' })).toBe(configuredUrl);
  });

  it('개발에서 URL이 없으면 로컬 기본값을 쓴다', () => {
    expect(resolveApiBaseUrl({ nodeEnv: 'development' })).toBe(DEVELOPMENT_API_BASE_URL);
  });

  it.each([
    'ftp://api.example.test',
    'https://user:pw@api.example.test',
    'https://api.example.test?x=1',
    'not a url',
  ])('형식이 잘못된 URL(%s)은 환경과 무관하게 거부한다', (configuredUrl) => {
    expect(() => resolveApiBaseUrl({ configuredUrl, nodeEnv: 'development' })).toThrow(
      ApiConfigurationError,
    );
  });
});
