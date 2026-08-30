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
};

test.after(() => {
  for (const [key, value] of Object.entries({
    NEXT_PUBLIC_PORTONE_STORE_ID: originalEnvironment.storeId,
    NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY: originalEnvironment.kakaoChannel,
    NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY: originalEnvironment.naverChannel,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('유효한 kakao/네이버 공개 설정을 기존 PortOne 계약으로 해석한다', () => {
  process.env.NEXT_PUBLIC_PORTONE_STORE_ID = 'portone-store';
  process.env.NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY = 'kakao-channel';
  process.env.NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY = 'naver-channel';

  assert.deepEqual(module.exports.readPortonePaymentConfiguration('kakaopay'), {
    portoneStoreId: 'portone-store',
    channelKey: 'kakao-channel',
    easyPayProvider: 'KAKAOPAY',
  });
  assert.deepEqual(module.exports.readPortonePaymentConfiguration('naverpay'), {
    portoneStoreId: 'portone-store',
    channelKey: 'naver-channel',
    easyPayProvider: 'NAVERPAY',
  });
});

test('공개 Store/channel 설정 누락은 SDK 호출에 사용할 구성을 만들지 않는다', () => {
  process.env.NEXT_PUBLIC_PORTONE_STORE_ID = 'portone-store';
  process.env.NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY = '';
  delete process.env.NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY;

  assert.throws(
    () => module.exports.readPortonePaymentConfiguration('kakaopay'),
    /결제 설정을 확인할 수 없습니다\./,
  );
  assert.throws(
    () => module.exports.readPortonePaymentConfiguration('naverpay'),
    /결제 설정을 확인할 수 없습니다\./,
  );
});
