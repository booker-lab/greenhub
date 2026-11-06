import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { type NextFetchEvent, NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  session: null as null | { user: { role?: string; storeId?: string } },
  authPaths: [] as string[],
}));

// auth() 래퍼는 세션을 request.auth에 싣고 콜백을 부른다. 테스트는 세션만 바꿔 끼운다.
vi.mock('@/auth', () => ({
  auth:
    (handler: (request: NextRequest & { auth: unknown }, ctx: unknown) => unknown) =>
    async (request: NextRequest, ctx: unknown) => {
      state.authPaths.push(request.nextUrl.pathname);
      return handler(Object.assign(request, { auth: state.session }), ctx);
    },
}));
// vitest에는 '@/' 별칭 설정이 없어 같은 모듈로 잇는다.
vi.mock('@/lib/content-security-policy', () => import('./lib/content-security-policy'));
vi.mock('@/lib/admin-landing', () => import('./lib/admin-landing'));
vi.mock('@/lib/initial-session', () => import('./lib/initial-session'));

const { config, proxy } = await import('./proxy');
const { decodeInitialSession, encodeInitialSession, INITIAL_SESSION_HEADER } = await import(
  './lib/initial-session'
);

const event = {} as NextFetchEvent;

async function run(path: string, headers?: Record<string, string>): Promise<Response> {
  const response = await proxy(
    new NextRequest(`https://seller.example.test${path}`, { headers }),
    event,
  );
  if (!response) throw new Error('proxy returned no response');
  return response;
}

function nonceOf(response: Response): string {
  const policy = response.headers.get('content-security-policy-report-only') ?? '';
  const match = policy.match(/'nonce-([A-Za-z0-9+/=]+)'/);
  if (!match) throw new Error(`nonce missing in: ${policy}`);
  return match[1];
}

beforeEach(() => {
  state.session = null;
  state.authPaths = [];
});

describe('판매자 proxy 로그인 검사', () => {
  it('로그인하지 않은 사용자를 보호 경로에서 /login으로 보낸다', async () => {
    const response = await run('/orders?status=paid');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://seller.example.test/login');
    expect(state.authPaths).toEqual(['/orders']);
  });

  it('storeId 없는 판매자는 /onboarding으로, 순수 관리자의 /onboarding은 /admin/stores로 보낸다', async () => {
    state.session = { user: { role: 'seller' } };
    expect((await run('/products')).headers.get('location')).toBe(
      'https://seller.example.test/onboarding',
    );
    state.session = { user: { role: 'admin' } };
    expect((await run('/onboarding')).headers.get('location')).toBe(
      'https://seller.example.test/admin/stores',
    );
  });

  it('순수 관리자는 판매자 경로에서 /admin/stores로 가고, 관리자 경로는 그대로 통과한다', async () => {
    state.session = { user: { role: 'admin' } };
    for (const path of ['/', '/orders', '/products', '/settings']) {
      expect((await run(path)).headers.get('location')).toBe(
        'https://seller.example.test/admin/stores',
      );
    }
    for (const path of ['/admin', '/admin/stores', '/admin/partner-inquiries']) {
      const response = await run(path);
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('x-middleware-next')).toBe('1');
    }
  });

  it('겸직 계정(관리자 + 가게)은 판매자 화면과 /onboarding을 그대로 쓴다', async () => {
    state.session = { user: { role: 'admin', storeId: 'store-1' } };
    for (const path of ['/orders', '/onboarding', '/admin/stores']) {
      expect((await run(path)).headers.get('location')).toBeNull();
    }
  });

  it('로그인한 판매자는 그대로 통과하며 CSP nonce가 요청 헤더로 넘어간다', async () => {
    state.session = { user: { role: 'seller', storeId: 'store-1' } };
    const response = await run('/orders');
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
    const nonce = nonceOf(response);
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(response.headers.get('x-middleware-request-content-security-policy')).toContain(
      `'nonce-${nonce}'`,
    );
  });

  it('판매자 초대 링크는 로그인 전에도 세션을 읽지 않고 리다이렉트하지 않는다', async () => {
    const response = await run('/invite/ABCDEF0123456789');
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(state.authPaths).toEqual([]);
  });

  it('초대 링크와 이름만 비슷한 경로는 그대로 로그인 검사를 한다', async () => {
    const response = await run('/invites');
    expect(response.headers.get('location')).toBe('https://seller.example.test/login');
    expect(state.authPaths).toEqual(['/invites']);
  });

  it('로그인 화면은 세션을 읽지 않고 리다이렉트하지 않는다', async () => {
    const response = await run('/login');
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(state.authPaths).toEqual([]);
  });
});

describe('판매자 proxy 첫 화면 세션 전달', () => {
  const sellerSession = {
    user: { name: '김판매', role: 'seller', storeId: 'store-1', accessToken: 'access-1' },
    expires: '2099-01-01T00:00:00.000Z',
  };
  const forged = encodeInitialSession({
    user: { role: 'admin', storeId: null, accessToken: 'forged' },
    expires: '2099-01-01T00:00:00.000Z',
  } as never);
  const passedSession = (response: Response) =>
    response.headers.get(`x-middleware-request-${INITIAL_SESSION_HEADER}`);

  it('보호 경로에서 확인한 판매자 세션을 그대로 layout에 넘긴다(브라우저가 보낸 값은 덮어쓴다)', async () => {
    state.session = sellerSession;
    for (const path of ['/', '/orders', '/orders/order-1', '/settings', '/onboarding']) {
      const response = await run(path, { [INITIAL_SESSION_HEADER]: forged });
      expect(response.headers.get('location')).toBeNull();
      expect(decodeInitialSession(passedSession(response))).toEqual(sellerSession);
    }
  });

  it('관리자 경로를 여는 순수 관리자 세션도 넘긴다', async () => {
    const adminSession = {
      user: { role: 'admin', storeId: null, accessToken: 'access-2' },
      expires: '2099-01-01T00:00:00.000Z',
    };
    state.session = adminSession as never;
    const response = await run('/admin/stores', { [INITIAL_SESSION_HEADER]: forged });
    expect(decodeInitialSession(passedSession(response))).toEqual(adminSession);
  });

  it('로그인·초대 화면에서는 세션을 넘기지 않고 브라우저가 보낸 같은 이름의 헤더도 지운다', async () => {
    state.session = sellerSession;
    for (const path of ['/login', '/invite/ABCDEF0123456789']) {
      const response = await run(path, { [INITIAL_SESSION_HEADER]: forged });
      expect(passedSession(response)).toBeNull();
      expect(response.headers.get('x-middleware-override-headers')).not.toContain(
        INITIAL_SESSION_HEADER,
      );
    }
    expect(state.authPaths).toEqual([]);
  });

  it('로그인·온보딩·관리자 콘솔로 보내는 경우에는 세션을 넘기지 않는다', async () => {
    const cases: Array<[typeof state.session, string]> = [
      [null, '/orders'],
      [{ user: { role: 'seller' } }, '/orders'],
      [{ user: { role: 'admin' } }, '/orders'],
    ];
    for (const [session, path] of cases) {
      state.session = session;
      const response = await run(path, { [INITIAL_SESSION_HEADER]: forged });
      expect(response.status).toBe(307);
      expect(passedSession(response)).toBeNull();
    }
  });
});

describe('판매자 proxy CSP 헤더', () => {
  it('Report-Only 헤더에 요청마다 새 nonce를 싣고 강제 CSP 헤더는 붙이지 않는다', async () => {
    const first = await run('/login');
    const second = await run('/login');
    expect(nonceOf(first)).not.toBe(nonceOf(second));
    expect(first.headers.get('content-security-policy')).toBeNull();
    expect(first.headers.get('content-security-policy-report-only')).toContain("'strict-dynamic'");
    expect(first.headers.get('content-security-policy-report-only')).toContain(
      'report-uri /api/csp-report',
    );
  });
});

describe('판매자 proxy matcher', () => {
  const matches = (url: string, headers?: Record<string, string>) =>
    unstable_doesMiddlewareMatch({ config, url, headers });

  it('보호 경로와 로그인 화면을 포함한 페이지에서 실행된다', () => {
    for (const path of [
      '/',
      '/orders',
      '/admin/stores',
      '/onboarding',
      '/login',
      '/login/error',
      '/invite/ABCDEF0123456789',
    ]) {
      expect(matches(path)).toBe(true);
    }
  });

  it('보호 경로는 이전처럼 프리페치 요청에서도 실행된다', () => {
    expect(matches('/orders', { 'next-router-prefetch': '1' })).toBe(true);
    // 보호 경로가 아닌 페이지의 프리페치에는 nonce를 만들지 않는다.
    expect(matches('/login', { 'next-router-prefetch': '1' })).toBe(false);
    expect(matches('/invite/ABCDEF0123456789', { 'next-router-prefetch': '1' })).toBe(false);
  });

  it('API, Next 정적 파일, 서비스워커, 매니페스트, 아이콘에서는 실행되지 않는다', () => {
    for (const path of [
      '/api/csp-report',
      '/api/auth/session',
      '/_next/static/chunks/main.js',
      '/_next/image?url=x',
      '/favicon.ico',
      '/sw.js',
      '/workbox-1a2b3c.js',
      '/manifest.json',
      '/icons/icon-192x192.png',
    ]) {
      expect(matches(path)).toBe(false);
    }
  });
});
