import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 승인 전 기사의 가입 신청 티켓 쿠키가 실제로 브라우저에 닿는지에 대한 증명.
//
// 1) 메커니즘(설치된 next·next-auth 소스): 카카오 로그인 콜백 `GET /api/auth/callback/kakao`는
//    `app/api/auth/[...nextauth]/route.ts`의 라우트 핸들러(Auth.js handlers)다. Next 라우트 핸들러는
//    cookies()를 바꿀 수 있는 'action' 단계로 시작하고, 핸들러가 돌려준 응답(Auth.js의 302 포함)에
//    바꾼 쿠키를 Set-Cookie로 덧붙인다(finalizeResponse → appendMutableCookies). Auth.js는 OAuth 콜백에서
//    signIn 콜백을 같은 요청 안에서 await하고, 문자열을 돌려주면 그 주소로 리다이렉트한다.
// 2) 직렬화(설치된 next 함수 실행): cookies().set으로 쓴 값이 Auth.js가 붙인 Set-Cookie를 지우지 않고
//    httpOnly·Secure·SameSite=Lax·Path=/apply·Max-Age=1800으로 붙는다.
// 3) 콜백 동작(auth.ts 실행): 승인 대기 거절의 티켓을 그 속성으로 쓰고 신청 상태에 따라 이동한다.
//
// next·next-auth를 올리면 1)이 깨질 수 있으므로 버전을 함께 고정한다(바뀌면 다시 확인한다).

const require = createRequire(import.meta.url);
const nextDir = dirname(require.resolve('next/package.json'));
const nextAuthDir = dirname(require.resolve('next-auth/package.json'));
// @auth/core는 package.json을 내보내지 않으므로 진입 파일 위치로 찾는다.
const authCoreDir = dirname(createRequire(join(nextAuthDir, 'package.json')).resolve('@auth/core'));
const readNext = (path: string) => readFileSync(join(nextDir, path), 'utf8');

describe('가입 신청 티켓 쿠키 메커니즘(설치된 next·next-auth 소스)', () => {
  it('확인한 버전이다', () => {
    expect(require('next/package.json').version).toBe('16.4.2');
    expect(require('next-auth/package.json').version).toBe('5.0.0-beta.32');
  });

  it('카카오 콜백은 Auth.js handlers를 내보내는 라우트 핸들러다', () => {
    const route = readFileSync(
      new URL('./app/api/auth/[...nextauth]/route.ts', import.meta.url),
      'utf8',
    );
    expect(route).toMatch(/import \{ handlers \} from '@\/auth';/);
    expect(route).toMatch(/export const \{ GET, POST \} = handlers;/);
    const nextAuthIndex = readFileSync(join(nextAuthDir, 'index.js'), 'utf8');
    expect(nextAuthIndex).toMatch(/handlers: \{ GET: httpHandler, POST: httpHandler \}/);
  });

  it('Next 라우트 핸들러는 cookies()를 바꿀 수 있는 단계로 시작하고 응답에 바꾼 쿠키를 붙인다', () => {
    const requestStore = readNext('dist/server/async-storage/request-store.js');
    expect(requestStore).toMatch(
      /function createRequestStoreForAPI\([^)]*\) \{\s*return createRequestStore\(\{\s*\/\/ API routes start in action phase by default\s*phase: 'action',/,
    );
    const requestCookies = readNext('dist/server/web/spec-extension/adapters/request-cookies.js');
    expect(requestCookies).toMatch(/return requestStore\.phase === 'action';/);

    const appRoute = readNext('dist/server/route-modules/app-route/module.js');
    const finalizeAt = appRoute.indexOf('finalizeResponse(res, request,');
    expect(finalizeAt).toBeGreaterThan(0);
    const finalize = appRoute.slice(
      finalizeAt,
      appRoute.indexOf('prerenderToResponse(', finalizeAt),
    );
    expect(finalize).toMatch(/const headers = new Headers\(res\.headers\);/);
    expect(finalize).toMatch(
      /if \(\(0, _requestcookies\.appendMutableCookies\)\(headers, requestStore\.mutableCookies\)\) \{\s*return new Response\(res\.body, \{\s*status: res\.status,/,
    );
  });

  it('Auth.js OAuth 콜백은 signIn 콜백을 기다리고 돌려준 주소로 리다이렉트한다', () => {
    const callback = readFileSync(join(authCoreDir, 'lib/actions/callback/index.js'), 'utf8');
    expect(callback).toMatch(
      /async function handleAuthorized\(params, config\) \{[\s\S]*?authorized = await signIn\(params\);[\s\S]*?if \(typeof authorized !== "string"\)\s*return;\s*return await redirect\(\{ url: authorized, baseUrl: config\.url\.origin \}\);/,
    );
  });
});

describe('가입 신청 티켓 쿠키 직렬화(설치된 next 함수)', () => {
  it('cookies().set 값이 Auth.js가 붙인 Set-Cookie와 함께 정해진 속성으로 응답에 붙는다', async () => {
    const { RequestCookies } = require('next/dist/server/web/spec-extension/cookies');
    const {
      MutableRequestCookiesAdapter,
      appendMutableCookies,
    } = require('next/dist/server/web/spec-extension/adapters/request-cookies');
    const { DRIVER_APPLICATION_TICKET_COOKIE, driverApplicationCookieOptions } = await import(
      './lib/driver-application-ticket'
    );

    const mutableCookies = MutableRequestCookiesAdapter.wrap(new RequestCookies(new Headers()));
    mutableCookies.set(
      DRIVER_APPLICATION_TICKET_COOKIE,
      'a.b.c',
      driverApplicationCookieOptions('driver.example.test'),
    );

    // Auth.js 콜백 응답처럼 이미 다른 쿠키(PKCE 정리 등)를 지우는 Set-Cookie가 있는 302.
    const headers = new Headers({ Location: 'https://driver.example.test/apply' });
    headers.append('Set-Cookie', '__Secure-authjs.pkce.code_verifier=; Path=/; Max-Age=0');
    expect(appendMutableCookies(headers, mutableCookies)).toBe(true);

    const setCookies = headers.getSetCookie();
    // Auth.js가 붙인 쿠키도 남는다. 다만 next가 다시 직렬화하면서 Max-Age=0을 버려(@edge-runtime/cookies의
    // compact가 0을 지움) 지우려던 일회용 확인 쿠키(PKCE·state)가 빈 값의 세션 쿠키로 남는다. 값이 비어 있고
    // 다음 로그인 시작 때 Auth.js가 새 값으로 덮으므로 기능 영향은 없다(이 경로에서만 생기는 next 동작).
    const pkce = setCookies.find((cookie) =>
      cookie.startsWith('__Secure-authjs.pkce.code_verifier='),
    );
    expect(pkce).toBe('__Secure-authjs.pkce.code_verifier=; Path=/');
    const ticketCookie = setCookies.find((cookie) =>
      cookie.startsWith(`${DRIVER_APPLICATION_TICKET_COOKIE}=`),
    );
    expect(ticketCookie).toBeDefined();
    const attributes = ticketCookie!.split('; ').map((part) => part.toLowerCase());
    expect(attributes).toEqual(
      expect.arrayContaining([
        `${DRIVER_APPLICATION_TICKET_COOKIE}=a.b.c`,
        'path=/apply',
        'max-age=1800',
        'httponly',
        'secure',
        'samesite=lax',
      ]),
    );
  });
});

// ── 3) auth.ts의 카카오 signIn 콜백 동작 ─────────────────────────────────────────

type SignInCallback = (params: {
  user: Record<string, unknown>;
  account: Record<string, unknown> | null;
}) => Promise<boolean | string>;

const state = vi.hoisted(() => ({
  config: null as null | { callbacks: { signIn: SignInCallback } },
  cookieSets: [] as Array<{ name: string; value: string; options: Record<string, unknown> }>,
  host: 'driver.example.test' as string | null,
  cookieSetError: null as Error | null,
}));

vi.mock('next-auth', () => {
  class CredentialsSignin extends Error {
    code = 'credentials';
  }
  return {
    default: (config: typeof state.config) => {
      state.config = config;
      return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
    },
    CredentialsSignin,
  };
});
vi.mock('next-auth/providers/credentials', () => ({ default: () => ({ id: 'credentials' }) }));
vi.mock('next-auth/providers/kakao', () => ({ default: () => ({ id: 'kakao' }) }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(state.host ? { host: state.host } : {}),
  cookies: async () => ({
    set: (name: string, value: string, options: Record<string, unknown>) => {
      if (state.cookieSetError) throw state.cookieSetError;
      state.cookieSets.push({ name, value, options });
    },
    get: () => undefined,
  }),
}));
// vitest에는 '@/' 별칭 설정이 없어 같은 모듈로 잇는다.
vi.mock(
  '@/app/login/local-credential-sign-in',
  () => import('./app/login/local-credential-sign-in'),
);
vi.mock('@/app/login/login-notice', () => import('./app/login/login-notice'));
vi.mock('@/lib/api-base-url', () => import('./lib/api-base-url'));
vi.mock('@/lib/login-redirect', () => import('./lib/login-redirect'));
vi.mock('@/lib/driver-application-ticket', () => import('./lib/driver-application-ticket'));
vi.mock('@/lib/driver-application-cookie', () => import('./lib/driver-application-cookie'));

const TICKET = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkcml2ZXItMSJ9.c2lnbmF0dXJl';
const fetchMock = vi.fn();

async function signInWith(response: Response) {
  fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetchMock);
  await import('./auth');
  const signIn = state.config!.callbacks.signIn;
  const user: Record<string, unknown> = {};
  const result = await signIn({
    user,
    account: { provider: 'kakao', access_token: 'kakao-token' },
  });
  return { result, user };
}

function pendingResponse(body: Record<string, unknown>) {
  return new Response(
    JSON.stringify({ statusCode: 403, code: 'DRIVER_APPROVAL_PENDING', ...body }),
    { status: 403 },
  );
}

describe('카카오 signIn 콜백의 가입 신청 티켓 처리', () => {
  beforeEach(() => {
    state.cookieSets = [];
    state.host = 'driver.example.test';
    state.cookieSetError = null;
    fetchMock.mockReset();
  });

  it('신청 전(none)이면 세션 없이 티켓을 쿠키에 담고 신청 화면으로 보낸다', async () => {
    const { result, user } = await signInWith(
      pendingResponse({ applicationTicket: TICKET, applicationStatus: 'none' }),
    );

    expect(result).toBe('/apply');
    expect(state.cookieSets).toEqual([
      {
        name: 'greenhub-driver-apply',
        value: TICKET,
        options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/apply', maxAge: 1800 },
      },
    ]);
    expect(user).toEqual({});
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/auth\/kakao-login$/);
  });

  it('신청 뒤(submitted)면 티켓을 담고 접수 안내(신청 내용 수정 링크)로 보낸다', async () => {
    const { result } = await signInWith(
      pendingResponse({ applicationTicket: TICKET, applicationStatus: 'submitted' }),
    );
    expect(result).toBe('/login?error=ApprovalPending&application=submitted');
    expect(state.cookieSets).toHaveLength(1);
  });

  it('로컬(localhost)에서는 Secure 없이 담는다', async () => {
    state.host = 'localhost:3003';
    await signInWith(pendingResponse({ applicationTicket: TICKET, applicationStatus: 'none' }));
    expect(state.cookieSets[0].options).toMatchObject({ secure: false, httpOnly: true });
  });

  it('티켓이 없는 승인 대기 거절(가입 신청 기능이 꺼진 API·이전 API)은 쿠키 없이 승인 대기 안내(수정 링크 없음)로 보낸다', async () => {
    const { result } = await signInWith(pendingResponse({}));
    expect(result).toBe('/login?error=ApprovalPending');
    expect(state.cookieSets).toEqual([]);
  });

  it('쿠키를 쓰지 못하면 세션 없이 승인 대기 안내로 보낸다', async () => {
    state.cookieSetError = new Error('ReadonlyRequestCookiesError');
    const { result, user } = await signInWith(
      pendingResponse({ applicationTicket: TICKET, applicationStatus: 'none' }),
    );
    expect(result).toBe('/login?error=ApprovalPending');
    expect(user).toEqual({});
  });

  it('관리자·다른 역할 거절에는 티켓 쿠키를 쓰지 않는다', async () => {
    const admin = await signInWith(
      new Response(
        JSON.stringify({ code: 'KAKAO_LOGIN_DRIVER_APP_ADMIN_ACCOUNT', applicationTicket: TICKET }),
        {
          status: 403,
        },
      ),
    );
    expect(admin.result).toBe('/login?error=AdminAccount');
    const other = await signInWith(
      new Response(JSON.stringify({ applicationTicket: TICKET }), { status: 403 }),
    );
    expect(other.result).toBe(false);
    expect(state.cookieSets).toEqual([]);
  });
});
