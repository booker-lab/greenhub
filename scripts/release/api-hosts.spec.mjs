import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CLOUD_RUN_PRODUCTION_API_HOST,
  isCloudRunProductionApiHost,
  isProductionApiHost,
  PRODUCTION_API_HOSTS,
} from './api-hosts.mjs';

describe('운영 API 호스트 정본', () => {
  it('Railway·Cloud Run 결정적 주소·고정 주소를 모두 운영으로 본다', () => {
    assert.deepEqual(PRODUCTION_API_HOSTS, [
      'api-production-13e7.up.railway.app',
      'greenhub-api-988412563635.asia-northeast3.run.app',
      'api.greenlove.co.kr',
    ]);
    for (const host of PRODUCTION_API_HOSTS) assert.equal(isProductionApiHost(host), true, host);
    assert.equal(isProductionApiHost('API.GREENLOVE.CO.KR'), true);
  });

  it('운영 Cloud Run의 해시·태그 주소도 운영으로 본다', () => {
    for (const host of [
      CLOUD_RUN_PRODUCTION_API_HOST,
      'c-0bcceaea1234---greenhub-api-988412563635.asia-northeast3.run.app',
      'greenhub-api-abc123xyz0-du.a.run.app',
      'c-0bcceaea1234---greenhub-api-abc123xyz0-du.a.run.app',
    ]) {
      assert.equal(isCloudRunProductionApiHost(host), true, host);
      assert.equal(isProductionApiHost(host), true, host);
    }
  });

  it('다른 서비스·프로젝트·리전의 Cloud Run 주소는 운영이 아니다', () => {
    for (const host of [
      'greenhub-api-staging-abc123xyz0-du.a.run.app',
      'greenhub-api-staging-111111111111.asia-northeast3.run.app',
      'greenhub-api-111111111111.asia-northeast3.run.app',
      'greenhub-api-988412563635.asia-northeast1.run.app',
      'greenhub-api-abc123xyz0-an.a.run.app',
      'evil.example.test',
      '',
    ]) {
      assert.equal(isCloudRunProductionApiHost(host), false, host);
      assert.equal(isProductionApiHost(host), false, host);
    }
  });
});
