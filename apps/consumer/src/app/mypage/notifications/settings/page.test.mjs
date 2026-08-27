import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');
const testableSource = `${source}
export { readMarketingPreferences, fetchMarketingPreferences, withdrawMarketingPreference };`;
const compiled = ts.transpileModule(testableSource, {
  compilerOptions: {
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'page.tsx',
}).outputText;

const pageModule = { exports: {} };
const requireForTest = (specifier) => {
  if (specifier === 'react') {
    return {
      useEffect: () => {},
      useState: (initial) => [initial, () => {}],
    };
  }
  if (specifier === 'react/jsx-runtime') {
    return { Fragment: Symbol('Fragment'), jsx: () => null, jsxs: () => null };
  }
  if (
    specifier === '@mantine/core' ||
    specifier === 'lucide-react' ||
    specifier === 'next-auth/react' ||
    specifier === 'next/navigation'
  ) {
    return {};
  }
  if (specifier === '@/lib/api-base-url') {
    return { getApiBaseUrl: () => 'http://localhost:3000' };
  }
  throw new Error(`예상하지 못한 마케팅 알림 설정 모듈 요청: ${specifier}`);
};
new Function('require', 'module', 'exports', compiled)(
  requireForTest,
  pageModule,
  pageModule.exports,
);

const { readMarketingPreferences, fetchMarketingPreferences, withdrawMarketingPreference } =
  pageModule.exports;

test('인증 사용자 응답의 두 채널이 boolean일 때만 현재 상태로 인정한다', () => {
  assert.deepEqual(
    readMarketingPreferences({
      id: 'consumer-1',
      notificationPreferences: { alimtalk: true, sms: false },
    }),
    { alimtalk: true, sms: false },
  );

  for (const value of [
    null,
    {},
    { notificationPreferences: null },
    { notificationPreferences: { alimtalk: true } },
    { notificationPreferences: { sms: false } },
    { notificationPreferences: { alimtalk: 'true', sms: false } },
    { notificationPreferences: { alimtalk: true, sms: 0 } },
  ]) {
    assert.equal(readMarketingPreferences(value), null);
  }
});

test('현재 상태는 인증된 GET /auth/me 응답에서만 조회한다', async () => {
  const calls = [];
  const request = async (input, init) => {
    calls.push({ input, init });
    return new Response(
      JSON.stringify({ notificationPreferences: { alimtalk: true, sms: false } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  await assert.doesNotReject(async () => {
    assert.deepEqual(await fetchMarketingPreferences('access-token', request), {
      alimtalk: true,
      sms: false,
    });
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].input, /\/auth\/me$/);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer access-token');
});

test('철회 요청은 해당 채널 false만 전송하고 검증된 두 채널 응답을 반환한다', async () => {
  const calls = [];
  const request = async (input, init) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({ alimtalk: false, sms: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  assert.deepEqual(await withdrawMarketingPreference('alimtalk', 'access-token', request), {
    alimtalk: false,
    sms: true,
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].input, /\/notifications\/me\/preferences$/);
  assert.equal(calls[0].init.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].init.body), { alimtalk: false });
  assert.equal(calls[0].init.headers.Authorization, 'Bearer access-token');
});

test('철회 성공 응답의 두 채널 boolean과 요청 채널 false를 모두 검증한다', async () => {
  for (const responseBody of [
    {},
    { alimtalk: false },
    { alimtalk: false, sms: 'true' },
    { alimtalk: true, sms: false },
  ]) {
    const request = async () =>
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    await assert.rejects(
      withdrawMarketingPreference('alimtalk', 'access-token', request),
      /응답을 확인할 수 없습니다/,
    );
  }
});

test('화면은 선택 마케팅과 주문·결제·배송 정보성 연락을 분리하고 서버 상태만 표시한다', () => {
  assert.match(source, /카카오톡 마케팅/);
  assert.match(source, /문자 마케팅/);
  assert.match(source, /동의함/);
  assert.match(source, /동의하지 않음/);
  assert.match(source, /즉시 철회/);
  assert.match(source, /주문·결제·배송을 위한 정보성 연락/);
  assert.match(source, /마케팅 동의 여부와\s*관계없이/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
  assert.doesNotMatch(source, /marketingConsentLogs/);
});
