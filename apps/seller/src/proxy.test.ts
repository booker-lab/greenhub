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

const { config, proxy } = await import('./proxy');

const event = {} as NextFetchEvent;

async function run(path: string): Promise<Response> {
  const response = await proxy(new NextRequest(`https://seller.example.test${path}`), event);
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

  it('로그인 화면은 세션을 읽지 않고 리다이렉트하지 않는다', async () => {
    const response = await run('/login');
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(state.authPaths).toEqual([]);
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
    for (const path of ['/', '/orders', '/admin/stores', '/onboarding', '/login']) {
      expect(matches(path)).toBe(true);
    }
  });

  it('보호 경로는 이전처럼 프리페치 요청에서도 실행된다', () => {
    expect(matches('/orders', { 'next-router-prefetch': '1' })).toBe(true);
    // 보호 경로가 아닌 페이지의 프리페치에는 nonce를 만들지 않는다.
    expect(matches('/login', { 'next-router-prefetch': '1' })).toBe(false);
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
