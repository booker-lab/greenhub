import {
  findPortonePaymentContextMismatch,
  resolvePortonePaymentContextPolicy,
} from './portone-payment-context';

const livePayment = {
  storeId: 'store-portone-live',
  currency: 'KRW',
  channel: { type: 'LIVE' },
};

describe('PortOne 결제 상점·통화·채널 확인 정책', () => {
  it.each([
    [{ RAILWAY_ENVIRONMENT_NAME: 'production' }, true],
    [{ RAILWAY_ENVIRONMENT_NAME: 'staging', NODE_ENV: 'production' }, false],
    [{ VERCEL_ENV: 'preview' }, false],
    [{ NODE_ENV: 'production' }, true],
    [{ NODE_ENV: 'test' }, false],
  ])('%j 운영 여부는 isProductionRuntime을 따른다', (values, production) => {
    expect(resolvePortonePaymentContextPolicy(values)).toEqual({
      expectedStoreId: null,
      requireLiveChannel: production,
      requireContextFields: production,
    });
  });

  it('PORTONE_STORE_ID는 앞뒤 공백을 제거해 쓴다', () => {
    expect(
      resolvePortonePaymentContextPolicy({ PORTONE_STORE_ID: '  store-portone-live ' })
        .expectedStoreId,
    ).toBe('store-portone-live');
  });
});

describe('PortOne 결제 상점·통화·채널 비교', () => {
  const production = resolvePortonePaymentContextPolicy({
    RAILWAY_ENVIRONMENT_NAME: 'production',
    PORTONE_STORE_ID: 'store-portone-live',
  });
  const staging = resolvePortonePaymentContextPolicy({
    RAILWAY_ENVIRONMENT_NAME: 'staging',
    PORTONE_STORE_ID: 'store-portone-live',
  });

  it('운영 LIVE·KRW·설정 상점 결제는 통과한다', () => {
    expect(findPortonePaymentContextMismatch(livePayment, production)).toBeNull();
  });

  it.each([
    [{ channel: { type: 'TEST' } }, 'channel.type', 'TEST'],
    [{ channel: undefined }, 'channel.type', null],
    [{ channel: null }, 'channel.type', null],
    [{ storeId: 'store-other' }, 'storeId', 'store-other'],
    [{ storeId: undefined }, 'storeId', null],
    [{ currency: 'USD' }, 'currency', 'USD'],
    [{ currency: undefined }, 'currency', null],
  ])('운영 %j 결제는 불일치다', (override, field, actual) => {
    expect(findPortonePaymentContextMismatch({ ...livePayment, ...override }, production)).toEqual(
      expect.objectContaining({ field, actual }),
    );
  });

  it('운영에서 PORTONE_STORE_ID가 없으면 상점만 건너뛰고 LIVE·KRW는 계속 요구한다', () => {
    const policy = resolvePortonePaymentContextPolicy({ RAILWAY_ENVIRONMENT_NAME: 'production' });
    expect(
      findPortonePaymentContextMismatch({ ...livePayment, storeId: 'store-other' }, policy),
    ).toBeNull();
    expect(
      findPortonePaymentContextMismatch({ ...livePayment, channel: { type: 'TEST' } }, policy),
    ).toEqual(expect.objectContaining({ field: 'channel.type' }));
  });

  it('스테이징은 TEST 채널과 필드 없는 stub 응답을 허용한다', () => {
    expect(
      findPortonePaymentContextMismatch({ ...livePayment, channel: { type: 'TEST' } }, staging),
    ).toBeNull();
    expect(findPortonePaymentContextMismatch({}, staging)).toBeNull();
  });

  it('스테이징도 값이 있으면 상점과 통화를 비교한다', () => {
    expect(
      findPortonePaymentContextMismatch({ ...livePayment, storeId: 'store-other' }, staging),
    ).toEqual(expect.objectContaining({ field: 'storeId' }));
    expect(findPortonePaymentContextMismatch({ ...livePayment, currency: 'USD' }, staging)).toEqual(
      expect.objectContaining({ field: 'currency' }),
    );
  });
});
