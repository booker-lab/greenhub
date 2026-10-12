import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { type NextFetchEvent, NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  session: null as null | { user: { role?: string } },
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
vi.mock('@/app/login/login-notice', () => import('./app/login/login-notice'));

const { config, proxy } = await import('./proxy');

const event = {} as NextFetchEvent;

async function run(path: string): Promise<Response> {
  const response = await proxy(new NextRequest(`https://driver.example.test${path}`), event);
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

describe('기사 proxy 로그인 검사', () => {
  it('로그인하지 않은 사용자를 보호 경로에서 /login으로 보낸다', async () => {
    for (const path of ['/board', '/board/order-1/photo', '/map', '/profile']) {
      const response = await run(path);
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('https://driver.example.test/login');
    }
    expect(state.authPaths).toEqual(['/board', '/board/order-1/photo', '/map', '/profile']);
  });

  it('남아 있는 관리자 세션은 로그인 안내로 보낸다', async () => {
    state.session = { user: { role: 'admin' } };
    expect((await run('/board')).headers.get('location')).toBe(
      'https://driver.example.test/login?error=AdminAccount',
    );
  });

  it('로그인한 기사는 그대로 통과하며 CSP nonce가 요청 헤더로 넘어간다', async () => {
    state.session = { user: { role: 'driver' } };
    const response = await run('/board');
    expect(response.headers.get('location')).toBeNull();
    const nonce = nonceOf(response);
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(response.headers.get('x-middleware-request-content-security-policy')).toContain(
      `'nonce-${nonce}'`,
    );
  });

  it('공개 경로는 세션을 읽지 않고 리다이렉트하지 않는다', async () => {
    for (const path of ['/', '/login', '/boards']) {
      const response = await run(path);
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('x-middleware-next')).toBe('1');
    }
    expect(state.authPaths).toEqual([]);
  });
});

describe('기사 proxy CSP 헤더', () => {
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

describe('기사 proxy matcher', () => {
  const matches = (url: string, headers?: Record<string, string>) =>
    unstable_doesMiddlewareMatch({ config, url, headers });

  it('보호 경로와 공개 페이지에서 실행된다', () => {
    for (const path of ['/', '/login', '/board', '/board/order-1', '/map', '/profile']) {
      expect(matches(path)).toBe(true);
    }
  });

  it('보호 경로는 이전처럼 프리페치에서도 실행되고, 공개 페이지 프리페치에서는 실행되지 않는다', () => {
    expect(matches('/board', { 'next-router-prefetch': '1' })).toBe(true);
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
