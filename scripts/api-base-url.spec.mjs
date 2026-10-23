import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolveApiBaseUrl } from '../packages/shared/src/api-base-url.ts';

// 세 앱은 같은 검사 규칙(packages/shared/src/api-base-url.ts)을 쓰고, 환경변수만 각 앱에서 읽는다.
const apps = ['consumer', 'seller', 'driver'];

describe('세 앱 getApiBaseUrl 연결', () => {
  for (const app of apps) {
    it(`${app}: NEXT_PUBLIC_API_URL과 NODE_ENV를 공유 검사 규칙에 넘긴다`, () => {
      const source = readFileSync(
        new URL(`../apps/${app}/src/lib/api-base-url.ts`, import.meta.url),
        'utf8',
      );
      assert.match(source, /import \{ resolveApiBaseUrl \} from '@greenhub\/shared';/);
      assert.match(source, /configuredUrl: process\.env\.NEXT_PUBLIC_API_URL,/);
      assert.match(source, /nodeEnv: process\.env\.NODE_ENV,/);
    });
  }
});

describe('API base URL fail-closed 계약(세 앱 공통)', () => {
  for (const app of ['shared']) {
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
