import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateTargetReadiness,
  LOCAL_TARGET_ORIGINS,
  PRODUCTION_API_HOSTS,
} from '../../../../scripts/check-round-direct-e2e-readiness.mjs';
import {
  ROUND_DIRECT_LOCAL_TARGET_ORIGINS,
  readRoundDirectTargetUrls,
  resolveE2EApiBase,
  resolveE2ETargetUrl,
} from './target-url.ts';

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

const localTargets = {
  consumer: 'http://127.0.0.1:3101/',
  seller: 'http://127.0.0.2:3102/',
  driver: 'http://127.0.0.3:3103/',
};

function localEnv(targets, overrides = {}) {
  return {
    ROUND_DIRECT_E2E_ENABLED: 'true',
    ROUND_DIRECT_E2E_TARGET_MODE: 'local',
    ROUND_DIRECT_E2E_TARGET_URLS_JSON: JSON.stringify(targets),
    CONSUMER_BASE: 'https://stale-consumer.example.test',
    SELLER_BASE: 'https://stale-seller.example.test',
    DRIVER_BASE: 'https://stale-driver.example.test',
    ...overrides,
  };
}

describe('Playwright 로컬 대상 모드 계약', () => {
  it('local 표식이 있으면 앱별 고정 루프백 http origin만 허용하고 *_BASE는 무시한다', () => {
    const env = localEnv(localTargets);

    assert.deepEqual(readRoundDirectTargetUrls(env), {
      consumer: 'http://127.0.0.1:3101',
      seller: 'http://127.0.0.2:3102',
      driver: 'http://127.0.0.3:3103',
    });
    assert.equal(resolveE2ETargetUrl('seller', env), 'http://127.0.0.2:3102');
    assert.equal(resolveE2ETargetUrl('driver', env), 'http://127.0.0.3:3103');
  });

  it('로컬 루프백 매핑은 readiness 가드의 매핑과 같다', () => {
    assert.deepEqual({ ...ROUND_DIRECT_LOCAL_TARGET_ORIGINS }, { ...LOCAL_TARGET_ORIGINS });
  });

  it('local 표식이어도 앱별 매핑이 다르거나 고정 origin 밖이면 거부한다', () => {
    const rejected = [
      { ...localTargets, consumer: localTargets.seller, seller: localTargets.consumer },
      { ...localTargets, consumer: 'http://localhost:3101' },
      { ...localTargets, consumer: 'http://127.0.0.1:3001' },
      { ...localTargets, seller: 'https://127.0.0.2:3102' },
      { ...localTargets, seller: 'http://127.0.0.2:3102/login' },
      { ...localTargets, driver: 'http://127.0.0.3:3103/?bypass=1' },
      { ...localTargets, driver: 'https://driver.greenlove.co.kr' },
      { ...localTargets, consumer: 'https://consumer-preview.example.test' },
      { ...localTargets, driver: undefined },
    ];
    for (const targets of rejected) {
      assert.throws(() => readRoundDirectTargetUrls(localEnv(targets)), /유효하지 않습니다/);
    }
  });

  it('local 이외의 대상 모드 값은 즉시 거부한다', () => {
    for (const mode of ['LOCAL', 'preview', 'loopback', 'local ,']) {
      assert.throws(
        () =>
          readRoundDirectTargetUrls(localEnv(localTargets, { ROUND_DIRECT_E2E_TARGET_MODE: mode })),
        /대상 모드/,
      );
    }
  });

  it('표식이 없으면 로컬 루프백 http 대상도 거부한다', () => {
    const env = localEnv(localTargets);
    delete env.ROUND_DIRECT_E2E_TARGET_MODE;
    assert.throws(() => readRoundDirectTargetUrls(env), /유효하지 않습니다/);
    assert.throws(
      () => readRoundDirectTargetUrls({ ...env, ROUND_DIRECT_E2E_TARGET_MODE: '' }),
      /유효하지 않습니다/,
    );
  });

  it('표식이 없는 preview 모드는 기존 HTTPS exact URL 계약을 그대로 유지한다', () => {
    const env = {
      ROUND_DIRECT_E2E_ENABLED: 'true',
      ROUND_DIRECT_E2E_TARGET_URLS_JSON: JSON.stringify(exactTargets),
    };
    assert.deepEqual(readRoundDirectTargetUrls(env), {
      consumer: 'https://consumer-preview.example.test',
      seller: 'https://seller-preview.example.test',
      driver: 'https://driver-preview.example.test',
    });
  });

  it('회차 모드가 아니면 대상 모드 표식은 일반 E2E base 해석에 영향을 주지 않는다', () => {
    assert.equal(readRoundDirectTargetUrls({ ROUND_DIRECT_E2E_TARGET_MODE: 'local' }), null);
    assert.equal(
      resolveE2ETargetUrl('consumer', { ROUND_DIRECT_E2E_TARGET_MODE: 'local' }),
      'https://greenlove.co.kr',
    );
  });
});

describe('API 직접 호출 spec의 API_BASE 계약', () => {
  it('API_BASE가 없거나 비어 있으면 운영 기본값 없이 null을 돌려준다', () => {
    assert.equal(resolveE2EApiBase({}), null);
    assert.equal(resolveE2EApiBase({ API_BASE: '' }), null);
    assert.equal(resolveE2EApiBase({ API_BASE: '   ' }), null);
  });

  it('비운영 API 주소는 끝 슬래시만 정리해 그대로 쓴다', () => {
    assert.equal(
      resolveE2EApiBase({ API_BASE: 'https://api-staging-94af.up.railway.app/' }),
      'https://api-staging-94af.up.railway.app',
    );
    assert.equal(
      resolveE2EApiBase({ API_BASE: ' http://localhost:3000 ' }),
      'http://localhost:3000',
    );
  });

  it('운영 API를 지정하면 요청 전에 거부한다', () => {
    const rejected = [
      'https://api-production-13e7.up.railway.app',
      'https://api-production-13e7.up.railway.app/',
      'http://API-PRODUCTION-13E7.up.railway.app',
      'https://api-production-0000.up.railway.app',
      'https://greenlove.co.kr',
      'https://seller.greenlove.co.kr',
    ];
    for (const value of rejected) {
      assert.throws(() => resolveE2EApiBase({ API_BASE: value }), /운영 API/, value);
    }
  });

  it('형식이 잘못된 API_BASE는 거부한다', () => {
    const rejected = [
      'api-staging-94af.up.railway.app',
      'localhost:3000',
      'ftp://api.example.test',
      'https://e2e-user@api.example.test',
      'https://api.example.test/?target=staging',
      'https://api.example.test/#staging',
    ];
    for (const value of rejected) {
      assert.throws(() => resolveE2EApiBase({ API_BASE: value }), /형식/, value);
    }
  });

  it('운영 API 판정은 readiness 가드의 운영 API origin 판정과 같다', () => {
    const candidates = [
      ...PRODUCTION_API_HOSTS.map((host) => `https://${host}`),
      'https://api-production-0000.up.railway.app',
      'https://greenlove.co.kr',
      'https://api.greenlove.co.kr',
      'https://api-staging-94af.up.railway.app',
      'https://staging-api-production.example.test',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ];
    for (const origin of candidates) {
      const readiness = evaluateTargetReadiness({ apiOrigin: origin, allowedApiOrigins: [origin] });
      let rejectedAsProduction = false;
      try {
        resolveE2EApiBase({ API_BASE: origin });
      } catch (error) {
        rejectedAsProduction = /운영 API/.test(error.message);
      }
      assert.equal(
        rejectedAsProduction,
        readiness.failureCodes.includes('PRODUCTION_API_ORIGIN'),
        origin,
      );
    }
  });
});
