import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveApiBaseUrl as resolveConsumerApiBaseUrl } from '../apps/consumer/src/lib/api-base-url.ts';
import { resolveApiBaseUrl as resolveDriverApiBaseUrl } from '../apps/driver/src/lib/api-base-url.ts';
import { resolveApiBaseUrl as resolveSellerApiBaseUrl } from '../apps/seller/src/lib/api-base-url.ts';

const resolvers = [
  ['consumer', resolveConsumerApiBaseUrl],
  ['seller', resolveSellerApiBaseUrl],
  ['driver', resolveDriverApiBaseUrl],
];

describe('세 앱 API base URL fail-closed 계약', () => {
  for (const [app, resolveApiBaseUrl] of resolvers) {
    it(`${app}: development는 명시 URL을 사용하고 없으면 localhost fallback을 사용한다`, () => {
      assert.equal(
        resolveApiBaseUrl({
          configuredUrl: 'https://api.example.test/',
          nodeEnv: 'development',
        }),
        'https://api.example.test',
      );
      assert.equal(resolveApiBaseUrl({ nodeEnv: 'development' }), 'http://localhost:3000');
      assert.equal(resolveApiBaseUrl({ nodeEnv: 'test' }), 'http://localhost:3000');
    });

    it(`${app}: production는 명시 URL을 사용하고 누락·localhost를 거부한다`, () => {
      assert.equal(
        resolveApiBaseUrl({
          configuredUrl: 'https://api-production.example.test',
          nodeEnv: 'production',
        }),
        'https://api-production.example.test',
      );
      assert.throws(
        () => resolveApiBaseUrl({ nodeEnv: 'production' }),
        /Production API URL이 설정되지 않았습니다/,
      );
      assert.throws(
        () =>
          resolveApiBaseUrl({
            configuredUrl: 'http://localhost:3000',
            nodeEnv: 'production',
          }),
        /localhost를 사용할 수 없습니다/,
      );
    });

    it(`${app}: 잘못된 URL은 환경과 관계없이 오류로 닫는다`, () => {
      assert.throws(
        () =>
          resolveApiBaseUrl({
            configuredUrl: 'not-a-url',
            nodeEnv: 'development',
          }),
        /올바른 URL 형식/,
      );
      assert.throws(
        () =>
          resolveApiBaseUrl({
            configuredUrl: 'https://api.example.test?unsafe=true',
            nodeEnv: 'production',
          }),
        /query 또는 fragment/,
      );
    });
  }
});
