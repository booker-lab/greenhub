import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readRoundDirectTargetUrls, resolveE2ETargetUrl } from './target-url.ts';

const exactTargets = {
  consumer: 'https://consumer-preview.example.test/',
  seller: 'https://seller-preview.example.test/',
  driver: 'https://driver-preview.example.test/',
};

describe('Playwright target_url provenance 계약', () => {
  it('회차 직배송에서는 deployment에서 전달된 exact URL 맵을 우선한다', () => {
    const env = {
      ROUND_DIRECT_E2E_ENABLED: 'true',
      ROUND_DIRECT_E2E_TARGET_URLS_JSON: JSON.stringify(exactTargets),
      CONSUMER_BASE: 'https://stale-consumer.example.test',
      SELLER_BASE: 'https://stale-seller.example.test',
      DRIVER_BASE: 'https://stale-driver.example.test',
    };

    assert.deepEqual(readRoundDirectTargetUrls(env), {
      consumer: 'https://consumer-preview.example.test',
      seller: 'https://seller-preview.example.test',
      driver: 'https://driver-preview.example.test',
    });
    assert.equal(resolveE2ETargetUrl('consumer', env), 'https://consumer-preview.example.test');
    assert.equal(resolveE2ETargetUrl('seller', env), 'https://seller-preview.example.test');
    assert.equal(resolveE2ETargetUrl('driver', env), 'https://driver-preview.example.test');
  });

  it('회차 직배송 target URL이 없거나 유효하지 않으면 즉시 중단한다', () => {
    assert.throws(
      () =>
        resolveE2ETargetUrl('consumer', {
          ROUND_DIRECT_E2E_ENABLED: 'true',
          CONSUMER_BASE: 'https://stale-consumer.example.test',
        }),
      /전달값이 설정되지 않았습니다/,
    );
    assert.throws(
      () =>
        resolveE2ETargetUrl('consumer', {
          ROUND_DIRECT_E2E_ENABLED: 'true',
          ROUND_DIRECT_E2E_TARGET_URLS_JSON: JSON.stringify({
            ...exactTargets,
            consumer: 'http://not-preview.example.test',
          }),
        }),
      /유효하지 않습니다/,
    );
  });

  it('일반 E2E에서는 기존 앱별 base와 production 기본값을 유지한다', () => {
    assert.equal(
      resolveE2ETargetUrl('consumer', { CONSUMER_BASE: 'http://localhost:3001/' }),
      'http://localhost:3001',
    );
    assert.equal(resolveE2ETargetUrl('seller', {}), 'https://seller.greenlove.co.kr');
  });
});
