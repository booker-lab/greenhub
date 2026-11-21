import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');
const testableSource = `${source}
export { readMarketingPreferences, fetchMarketingPreferences, withdrawMarketingPreference, settingsErrorMessage };`;
const compiled = ts.transpileModule(testableSource, {
  compilerOptions: {
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'page.tsx',
}).outputText;

// 연결 실패 판정은 앱 공통 모듈(lib/load-error-message.ts)의 실제 구현을 쓴다.
const loadErrorSource = await readFile(
  new URL('../../../../lib/load-error-message.ts', import.meta.url),
  'utf8',
);
const loadErrorModule = { exports: {} };
new Function(
  'module',
  'exports',
  ts.transpileModule(loadErrorSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: 'load-error-message.ts',
  }).outputText,
)(loadErrorModule, loadErrorModule.exports);

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
    specifier === '@greenhub/ui/components/alert' ||
    specifier === '@greenhub/ui/components/badge' ||
    specifier === '@/components/Button' ||
    specifier === '@/components/LoadingButton' ||
    specifier === '@/lib/touch-target' ||
    specifier === 'lucide-react' ||
    specifier === 'next-auth/react' ||
    specifier === 'next/navigation'
  ) {
    return {};
  }
  if (specifier === '@/lib/load-error-message') return loadErrorModule.exports;
  if (specifier === '@/lib/api-base-url') {
    return { getApiBaseUrl: () => 'http://localhost:3000' };
  }
  // 비로그인 복귀 주소 함수(mypage/_login.ts, 자체 테스트가 따로 있다).
  if (specifier === '../../_login') return { currentMyPageLoginUrl: () => '/login' };
  throw new Error(`예상하지 못한 마케팅 알림 설정 모듈 요청: ${specifier}`);
};
new Function('require', 'module', 'exports', compiled)(
  requireForTest,
  pageModule,
  pageModule.exports,
);

const {
  readMarketingPreferences,
  fetchMarketingPreferences,
  withdrawMarketingPreference,
  settingsErrorMessage,
} = pageModule.exports;

test('연결이 끊긴 실패는 브라우저 원문 대신 앱 공통 연결 안내를 보인다', () => {
  for (const raw of ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.']) {
    assert.equal(
      settingsErrorMessage(new TypeError(raw), '현재 상태를 확인할 수 없습니다.'),
      '연결이 불안정해요. 잠시 후 다시 시도해 주세요.',
      raw,
    );
  }
});

test('서버 오류는 이 화면이 만든 한국어 문구를, 알 수 없는 값은 기본 문구를 그대로 보인다', () => {
  assert.equal(
    settingsErrorMessage(new Error('현재 마케팅 동의 상태를 불러오지 못했습니다.'), '기본'),
    '현재 마케팅 동의 상태를 불러오지 못했습니다.',
  );
  assert.equal(settingsErrorMessage(null, '마케팅 동의 철회에 실패했습니다.'), '마케팅 동의 철회에 실패했습니다.');
  assert.equal(settingsErrorMessage(undefined, '현재 상태를 확인할 수 없습니다.'), '현재 상태를 확인할 수 없습니다.');
});

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

test('파일럿 MY 설정 경로는 마케팅 편집 없이 비활성 안내만 표시한다', () => {
  const start = source.indexOf('export default function NotificationSettingsPage');
  const end = source.indexOf('function LegacyNotificationSettingsPage', start);
  const pilotSource = source.slice(start, end);

  assert.match(source, /const MARKETING_NOT_USED_IN_PILOT = true/);
  assert.match(pilotSource, /지금은 마케팅 알림을 보내지 않아요\./);
  // 고객 화면에 내부 운영 용어(파일럿)를 내지 않는다.
  assert.doesNotMatch(pilotSource, />[^<]*파일럿[^<]*</);
  assert.doesNotMatch(pilotSource, /fetchMarketingPreferences|withdrawMarketingPreference|PATCH/);
  assert.doesNotMatch(pilotSource, /즉시 철회|동의함|동의하지 않음/);
  assert.match(pilotSource, /주문·결제·배송에 필요한 정보성 연락/);
  assert.match(source, /function LegacyNotificationSettingsPage/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|marketingConsentLogs/);
});
