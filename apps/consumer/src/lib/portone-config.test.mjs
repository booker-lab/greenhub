import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./portone-config.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'portone-config.ts',
}).outputText;
const module = { exports: {} };
new Function('module', 'exports', compiled)(module, module.exports);

const originalEnvironment = {
  storeId: process.env.NEXT_PUBLIC_PORTONE_STORE_ID,
  kakaoChannel: process.env.NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY,
  naverChannel: process.env.NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY,
  cardChannel: process.env.NEXT_PUBLIC_PORTONE_CARD_CHANNEL_KEY,
};

test.after(() => {
  for (const [key, value] of Object.entries({
    NEXT_PUBLIC_PORTONE_STORE_ID: originalEnvironment.storeId,
    NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY: originalEnvironment.kakaoChannel,
    NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY: originalEnvironment.naverChannel,
    NEXT_PUBLIC_PORTONE_CARD_CHANNEL_KEY: originalEnvironment.cardChannel,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('유효한 카카오·네이버·카드 공개 설정을 결제수단별 채널로 해석한다', () => {
  process.env.NEXT_PUBLIC_PORTONE_STORE_ID = 'portone-store';
  process.env.NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY = 'kakao-channel';
  process.env.NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY = 'naver-channel';
  process.env.NEXT_PUBLIC_PORTONE_CARD_CHANNEL_KEY = 'card-channel';

  assert.deepEqual(module.exports.readPortonePaymentConfiguration('kakaopay'), {
    portoneStoreId: 'portone-store',
    channelKey: 'kakao-channel',
    paymentMethod: 'kakaopay',
  });
  assert.deepEqual(module.exports.readPortonePaymentConfiguration('naverpay'), {
    portoneStoreId: 'portone-store',
    channelKey: 'naver-channel',
    paymentMethod: 'naverpay',
  });
  assert.deepEqual(module.exports.readPortonePaymentConfiguration('card'), {
    portoneStoreId: 'portone-store',
    channelKey: 'card-channel',
    paymentMethod: 'card',
  });
});

test('간편결제는 EASY_PAY와 제공사를, 카드는 CARD만 넘기고 간편결제 정보를 넣지 않는다', () => {
  const { buildPortonePayMethodRequest } = module.exports;

  assert.deepEqual(buildPortonePayMethodRequest('kakaopay', { name: '김그린', phone: '010-1' }), {
    payMethod: 'EASY_PAY',
    easyPay: { easyPayProvider: 'KAKAOPAY' },
  });
  assert.deepEqual(buildPortonePayMethodRequest('naverpay'), {
    payMethod: 'EASY_PAY',
    easyPay: { easyPayProvider: 'NAVERPAY' },
  });
  assert.deepEqual(buildPortonePayMethodRequest('card'), { payMethod: 'CARD' });
  assert.equal('easyPay' in buildPortonePayMethodRequest('card'), false);
});

test('카드 결제창에는 구매자 이름과 숫자만 남긴 전화번호를 넘기고 빈 값은 뺀다', () => {
  const { buildPortonePayMethodRequest } = module.exports;

  assert.deepEqual(
    buildPortonePayMethodRequest('card', { name: ' 김그린 ', phone: '010-1234-5678' }),
    { payMethod: 'CARD', customer: { fullName: '김그린', phoneNumber: '01012345678' } },
  );
  assert.deepEqual(buildPortonePayMethodRequest('card', { name: null, phone: '010 1234 5678' }), {
    payMethod: 'CARD',
    customer: { phoneNumber: '01012345678' },
  });
  assert.deepEqual(buildPortonePayMethodRequest('card', { name: '  ', phone: '' }), {
    payMethod: 'CARD',
  });
});

test('공개 Store/channel 설정 누락은 SDK 호출에 사용할 구성을 만들지 않는다', () => {
  process.env.NEXT_PUBLIC_PORTONE_STORE_ID = 'portone-store';
  process.env.NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY = '';
  delete process.env.NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY;
  delete process.env.NEXT_PUBLIC_PORTONE_CARD_CHANNEL_KEY;

  assert.throws(
    () => module.exports.readPortonePaymentConfiguration('kakaopay'),
    /결제 설정을 확인할 수 없습니다\./,
  );
  assert.throws(
    () => module.exports.readPortonePaymentConfiguration('naverpay'),
    /결제 설정을 확인할 수 없습니다\./,
  );
  assert.throws(
    () => module.exports.readPortonePaymentConfiguration('card'),
    /결제 설정을 확인할 수 없습니다\./,
  );
});
