import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACQUISITION_STORAGE_KEY,
  captureAcquisition,
  clearAcquisition,
  getAcquisitionSnapshot,
} from './acquisition.ts';

function createStorage(initialValue = null) {
  let value = initialValue;
  return {
    getItem(key) {
      assert.equal(key, ACQUISITION_STORAGE_KEY);
      return value;
    },
    setItem(key, nextValue) {
      assert.equal(key, ACQUISITION_STORAGE_KEY);
      value = nextValue;
    },
    removeItem(key) {
      assert.equal(key, ACQUISITION_STORAGE_KEY);
      value = null;
    },
    rawValue() {
      return value;
    },
  };
}

test('당근 UTM 유입은 허용 필드만 탭 세션 저장소에 보관한다', () => {
  const storage = createStorage();
  const snapshot = captureAcquisition(
    'https://greenlove.co.kr/products/product-1?round=round-1&utm_source=carrot&utm_campaign=july-round&utm_content=feed&access_token=secret#private',
    {
      storage,
      now: () => new Date('2026-07-17T05:00:00.000Z'),
    },
  );

  assert.deepEqual(snapshot, {
    source: 'carrot',
    campaign: 'july-round',
    content: 'feed',
    landingUrl: 'https://greenlove.co.kr/products/product-1?round=round-1',
    capturedAt: '2026-07-17T05:00:00.000Z',
  });
  assert.deepEqual(JSON.parse(storage.rawValue()), snapshot);
  assert.doesNotMatch(storage.rawValue(), /access_token|secret|private/);
});

test('당근이 아닌 유입은 기존 당근 스냅샷을 덮어쓰지 않는다', () => {
  const existing = {
    source: 'carrot',
    campaign: 'first-round',
    content: null,
    landingUrl: 'https://greenlove.co.kr/?round=round-1',
    capturedAt: '2026-07-17T05:00:00.000Z',
  };
  const storage = createStorage(JSON.stringify(existing));

  const result = captureAcquisition(
    'https://greenlove.co.kr/?utm_source=newsletter&utm_campaign=other',
    { storage },
  );

  assert.equal(result, null);
  assert.deepEqual(JSON.parse(storage.rawValue()), existing);
});

test('주문용 스냅샷은 저장값을 재검증하고 허용 필드만 새 객체로 반환한다', () => {
  const storage = createStorage(
    JSON.stringify({
      source: 'carrot',
      campaign: 'july-round',
      content: 'feed',
      landingUrl:
        'https://greenlove.co.kr/products/product-1?round=round-1&authorization=Bearer-secret',
      capturedAt: '2026-07-17T05:00:00.000Z',
      accessToken: 'secret',
      phone: '010-0000-0000',
    }),
  );

  const snapshot = getAcquisitionSnapshot(storage);

  assert.deepEqual(snapshot, {
    source: 'carrot',
    campaign: 'july-round',
    content: 'feed',
    landingUrl: 'https://greenlove.co.kr/products/product-1?round=round-1',
    capturedAt: '2026-07-17T05:00:00.000Z',
  });
  assert.deepEqual(Object.keys(snapshot), [
    'source',
    'campaign',
    'content',
    'landingUrl',
    'capturedAt',
  ]);
  assert.doesNotMatch(JSON.stringify(snapshot), /authorization|Bearer-secret|accessToken|phone/);
});

test('잘못된 저장값은 주문 스냅샷으로 사용하지 않고 제거한다', () => {
  const storage = createStorage(
    JSON.stringify({
      source: 'carrot',
      campaign: 'july-round',
      content: null,
      landingUrl: 'javascript:alert(1)',
      capturedAt: 'not-a-date',
    }),
  );

  assert.equal(getAcquisitionSnapshot(storage), null);
  assert.equal(storage.rawValue(), null);

  const malformedStorage = createStorage('{');
  assert.equal(getAcquisitionSnapshot(malformedStorage), null);
  assert.equal(malformedStorage.rawValue(), null);
});

test('브라우저 저장소가 없거나 접근이 거부되어도 예외를 내지 않는다', () => {
  const deniedStorage = {
    getItem() {
      throw new Error('접근 거부');
    },
    setItem() {
      throw new Error('접근 거부');
    },
    removeItem() {
      throw new Error('접근 거부');
    },
  };

  assert.equal(getAcquisitionSnapshot(), null);
  assert.equal(getAcquisitionSnapshot(deniedStorage), null);
  assert.doesNotThrow(() =>
    captureAcquisition('https://greenlove.co.kr/?utm_source=carrot', {
      storage: deniedStorage,
    }),
  );
  assert.doesNotThrow(() => clearAcquisition(deniedStorage));
});

test('명시적으로 지우면 현재 탭의 당근 유입 수명주기가 끝난다', () => {
  const storage = createStorage(
    JSON.stringify({
      source: 'carrot',
      campaign: null,
      content: null,
      landingUrl: 'https://greenlove.co.kr/',
      capturedAt: '2026-07-17T05:00:00.000Z',
    }),
  );

  clearAcquisition(storage);

  assert.equal(storage.rawValue(), null);
  assert.equal(getAcquisitionSnapshot(storage), null);
});
