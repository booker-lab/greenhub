import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FEATURE_KEYS, parseFeatureFlags } from '../../../../packages/shared/src/features.ts';
import { parseConsumerFeatures } from './consumer-features.ts';

describe('소비자 빌드 기능 토글 meta 판정', () => {
  it('meta가 없거나(옛 빌드) 비어 있으면 guest-cart는 꺼짐이다', () => {
    for (const raw of [null, undefined, '', '   ']) {
      const features = parseConsumerFeatures(raw);
      assert.equal(features.isOn('guest-cart'), false, `raw=${JSON.stringify(raw)}`);
    }
    assert.equal(parseConsumerFeatures(null).raw, null);
  });

  it('적은 키만 켜지고 앞뒤 공백은 무시한다', () => {
    const features = parseConsumerFeatures(' reviews , guest-cart ');
    assert.equal(features.isOn('guest-cart'), true);
    assert.equal(features.isOn('reviews'), true);
    assert.equal(features.isOn('wishlist'), false);
  });

  it('비슷한 이름은 켜짐으로 보지 않는다', () => {
    assert.equal(parseConsumerFeatures('guest-cart-v2').isOn('guest-cart'), false);
    assert.equal(parseConsumerFeatures('guest').isOn('guest-cart'), false);
  });

  it('전체가 all이면 모두 켜지고, 다른 키와 섞인 all은 키로 보지 않는다', () => {
    assert.equal(parseConsumerFeatures('all').isOn('guest-cart'), true);
    assert.equal(parseConsumerFeatures('all,reviews').isOn('guest-cart'), false);
  });

  it('모든 알려진 키에서 packages/shared parseFeatureFlags와 같은 결과를 낸다', () => {
    const inputs = [
      null,
      '',
      '  ',
      'all',
      ' all ',
      'all,guest-cart',
      'guest-cart',
      'guest-cart,reviews',
      ' reviews , guest-cart ,',
      'unknown,guest-cart',
      'guest-cart-v2',
      FEATURE_KEYS.join(','),
    ];
    for (const raw of inputs) {
      const expected = parseFeatureFlags(raw);
      const actual = parseConsumerFeatures(raw);
      for (const key of FEATURE_KEYS) {
        assert.equal(
          actual.isOn(key),
          expected.has(key),
          `raw=${JSON.stringify(raw)} key=${key}`,
        );
      }
    }
  });
});
