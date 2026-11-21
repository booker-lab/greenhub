import { describe, expect, it } from 'vitest';
import {
  AUTHORITY_RECHECK_COOLDOWN_MS,
  forgetAuthorityVerifiedBefore,
  isSessionEnded,
  readSignedOutAt,
  recheckSessionAfterRejection,
  revalidateSessionToken,
  SESSION_AUTHORITY_REUSE_MS,
  SIGNED_OUT_MARKER_COOKIE,
  SIGNED_OUT_MARKER_MAX_AGE_SECONDS,
  type SessionAuthorityResult,
  signedOutMarkerCookie,
  watchApiAuthorityRejections,
  withSignedOutMarker,
  withSignedOutMarkerOnSignOut,
} from './session-authority.js';

const T0 = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

function baseToken(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: 'user-1',
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    accessTokenExpires: T0 + HOUR,
    ...overrides,
  };
}

function harness(results: SessionAuthorityResult[], start = T0) {
  let clock = start;
  const verifyCalls: string[] = [];
  const refreshCalls: Array<Record<string, unknown>> = [];
  let refreshResult: (token: Record<string, unknown>) => Record<string, unknown> | null = (
    token,
  ) => ({ ...token, accessToken: 'access-2', accessTokenExpires: clock + HOUR });
  const deps = {
    verify: async (accessToken: string) => {
      verifyCalls.push(accessToken);
      const next = results.shift();
      if (!next) throw new Error('unexpected verify');
      return next;
    },
    refresh: async (token: Record<string, unknown>) => {
      refreshCalls.push(token);
      return refreshResult(token);
    },
    now: () => clock,
  };
  return {
    deps,
    verifyCalls,
    refreshCalls,
    advance: (ms: number) => {
      clock += ms;
    },
    setRefreshResult: (fn: typeof refreshResult) => {
      refreshResult = fn;
    },
  };
}

describe('세션 검증 결과 재사용', () => {
  it('재사용 시간은 60초다', () => {
    expect(SESSION_AUTHORITY_REUSE_MS).toBe(60_000);
  });

  it('검증 성공 후 60초 안의 재호출은 API 검증을 부르지 않는다', async () => {
    const h = harness([{ kind: 'ok' }]);
    const first = await revalidateSessionToken(baseToken(), h.deps);
    expect(h.verifyCalls).toEqual(['access-1']);
    expect(first?.authorityVerifiedAt).toBe(T0);
    expect(typeof first?.authorityVerifiedFor).toBe('string');
    // access token 원문을 한 번 더 싣지 않는다.
    expect(first?.authorityVerifiedFor).not.toContain('access-1');

    h.advance(SESSION_AUTHORITY_REUSE_MS - 1);
    const second = await revalidateSessionToken(first as Record<string, unknown>, h.deps);
    expect(h.verifyCalls).toHaveLength(1);
    expect(second).toEqual(first);
    expect(h.refreshCalls).toHaveLength(0);
  });

  it('60초가 지나면 다시 검증하고 검증 시각을 새로 적는다', async () => {
    const h = harness([{ kind: 'ok' }, { kind: 'ok' }]);
    const first = await revalidateSessionToken(baseToken(), h.deps);
    h.advance(SESSION_AUTHORITY_REUSE_MS);
    const second = await revalidateSessionToken(first as Record<string, unknown>, h.deps);
    expect(h.verifyCalls).toEqual(['access-1', 'access-1']);
    expect(second?.authorityVerifiedAt).toBe(T0 + SESSION_AUTHORITY_REUSE_MS);
  });

  it('access token이 바뀌면 60초 안이라도 바로 다시 검증한다', async () => {
    const h = harness([{ kind: 'ok' }, { kind: 'ok' }]);
    const first = await revalidateSessionToken(baseToken(), h.deps);
    h.advance(1_000);
    const changed = { ...first, accessToken: 'access-2' };
    await revalidateSessionToken(changed, h.deps);
    expect(h.verifyCalls).toEqual(['access-1', 'access-2']);
  });

  it('refresh로 새 access token을 받으면 다음 호출에서 다시 검증한다', async () => {
    const h = harness([{ kind: 'ok' }, { kind: 'ok' }]);
    // 검증은 통과했지만 access token 기한이 지나 refresh한다.
    const refreshed = await revalidateSessionToken(
      baseToken({ accessTokenExpires: T0 - 1 }),
      h.deps,
    );
    expect(h.refreshCalls).toHaveLength(1);
    expect(refreshed?.accessToken).toBe('access-2');

    h.advance(1_000);
    await revalidateSessionToken(refreshed as Record<string, unknown>, h.deps);
    expect(h.verifyCalls).toEqual(['access-1', 'access-2']);
  });

  it('update() 요청(reuseVerified: false)은 60초 안이라도 다시 검증해 claims를 새로 묶는다', async () => {
    const h = harness([
      { kind: 'ok', claims: { storeId: null } },
      { kind: 'ok', claims: { storeId: 'store-new' } },
    ]);
    const first = await revalidateSessionToken(baseToken(), h.deps);
    h.advance(1_000);
    const updated = await revalidateSessionToken(first as Record<string, unknown>, {
      ...h.deps,
      reuseVerified: false,
    });
    expect(h.verifyCalls).toHaveLength(2);
    expect(updated?.storeId).toBe('store-new');
    expect(updated?.authorityVerifiedAt).toBe(T0 + 1_000);
  });

  it('검증 시각이 미래(시계 역행)이거나 형식이 틀리면 재사용하지 않는다', async () => {
    const h = harness([{ kind: 'ok' }, { kind: 'ok' }, { kind: 'ok' }]);
    const first = await revalidateSessionToken(baseToken(), h.deps);
    await revalidateSessionToken({ ...first, authorityVerifiedAt: T0 + 5_000 }, h.deps);
    await revalidateSessionToken({ ...first, authorityVerifiedAt: String(T0) }, h.deps);
    expect(h.verifyCalls).toHaveLength(3);
  });

  it('재사용 구간에서도 access token 기한이 지나면 refresh한다', async () => {
    const h = harness([{ kind: 'ok' }]);
    const first = await revalidateSessionToken(
      baseToken({ accessTokenExpires: T0 + 10_000 }),
      h.deps,
    );
    h.advance(10_000);
    const refreshed = await revalidateSessionToken(first as Record<string, unknown>, h.deps);
    expect(h.verifyCalls).toHaveLength(1);
    expect(h.refreshCalls).toHaveLength(1);
    expect(refreshed?.accessToken).toBe('access-2');
  });
});

describe('세션 검증 판정별 처리', () => {
  it('ok는 claims를 토큰에 묶고 error를 지운다', async () => {
    const h = harness([{ kind: 'ok', claims: { storeId: 'store-9' } }]);
    const result = await revalidateSessionToken(
      baseToken({ storeId: 'stale', error: 'RefreshAccessTokenError' }),
      h.deps,
    );
    expect(result?.storeId).toBe('store-9');
    expect(result).not.toHaveProperty('error');
    expect(h.refreshCalls).toHaveLength(0);
  });

  it('revoked는 재사용 기록을 지우고 refresh를 한 번 시도하며, refresh가 거절하면 세션을 끝낸다', async () => {
    const h = harness([{ kind: 'ok' }, { kind: 'revoked' }]);
    const first = await revalidateSessionToken(baseToken(), h.deps);
    h.advance(SESSION_AUTHORITY_REUSE_MS);
    h.setRefreshResult(() => null);
    const result = await revalidateSessionToken(first as Record<string, unknown>, h.deps);
    expect(result).toBeNull();
    expect(h.refreshCalls).toHaveLength(1);
    expect(h.refreshCalls[0]).not.toHaveProperty('authorityVerifiedAt');
    expect(h.refreshCalls[0]).not.toHaveProperty('authorityVerifiedFor');
  });

  it('transient는 기한 안이면 토큰을 그대로 두고 다음 호출에서 다시 검증한다', async () => {
    const h = harness([{ kind: 'transient' }, { kind: 'ok' }]);
    const token = baseToken();
    const result = await revalidateSessionToken(token, h.deps);
    expect(result).toBe(token);
    expect(result).not.toHaveProperty('authorityVerifiedAt');
    expect(h.refreshCalls).toHaveLength(0);

    h.advance(1_000);
    await revalidateSessionToken(result as Record<string, unknown>, h.deps);
    expect(h.verifyCalls).toHaveLength(2);
  });

  it('transient는 기한이 지났으면 refresh한다', async () => {
    const h = harness([{ kind: 'transient' }]);
    await revalidateSessionToken(baseToken({ accessTokenExpires: T0 - 1 }), h.deps);
    expect(h.refreshCalls).toHaveLength(1);
  });

  it('transient는 직전 검증 기록을 지우지 않지만 60초가 지난 기록으로 재사용하지도 않는다', async () => {
    const h = harness([{ kind: 'ok' }, { kind: 'transient' }, { kind: 'ok' }]);
    const first = await revalidateSessionToken(baseToken(), h.deps);
    h.advance(SESSION_AUTHORITY_REUSE_MS);
    const second = await revalidateSessionToken(first as Record<string, unknown>, h.deps);
    expect(second).toBe(first);
    await revalidateSessionToken(second as Record<string, unknown>, h.deps);
    expect(h.verifyCalls).toHaveLength(3);
  });

  it('access·refresh token이 없으면 검증 없이 그대로 돌려준다', async () => {
    const h = harness([]);
    const token = baseToken({ refreshToken: '' });
    expect(await revalidateSessionToken(token, h.deps)).toBe(token);
    expect(h.verifyCalls).toHaveLength(0);
  });
});

describe('watchApiAuthorityRejections', () => {
  const API = 'https://api.example.test';

  function setup(statuses: Record<string, number> = {}) {
    let clock = T0;
    const requests: string[] = [];
    const target = {
      fetch: async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        requests.push(url);
        return new Response('{}', { status: statuses[url] ?? 200 });
      },
    };
    const original = target.fetch;
    let rejected = 0;
    const stop = watchApiAuthorityRejections({
      target,
      apiOrigin: API,
      onRejected: () => {
        rejected += 1;
      },
      now: () => clock,
    });
    const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
    return {
      target,
      original,
      stop,
      bearer,
      requests,
      rejected: () => rejected,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  }

  it('API의 Bearer 요청이 401·403이면 알리고 응답은 그대로 돌려준다', async () => {
    const h = setup({ [`${API}/orders`]: 403, [`${API}/me`]: 401 });
    const forbidden = await h.target.fetch(`${API}/orders`, h.bearer('access-1'));
    expect(forbidden.status).toBe(403);
    expect(h.rejected()).toBe(1);

    // Request 객체에 실린 헤더도 본다. 다른 토큰이면 쉬는 시간과 무관하게 다시 알린다.
    const request = new Request(`${API}/me`, h.bearer('access-2'));
    expect((await h.target.fetch(request)).status).toBe(401);
    expect(h.rejected()).toBe(2);
    expect(h.requests).toEqual([`${API}/orders`, `${API}/me`]);
  });

  it('성공 응답·다른 출처·토큰 없는 요청은 알리지 않는다', async () => {
    const h = setup({
      [`${API}/public`]: 401,
      'https://other.example.test/x': 401,
      [`${API}/ok`]: 200,
    });
    await h.target.fetch(`${API}/ok`, h.bearer('access-1'));
    await h.target.fetch(`${API}/public`);
    await h.target.fetch('https://other.example.test/x', h.bearer('access-1'));
    await h.target.fetch('/api/auth/session', h.bearer('access-1'));
    expect(h.rejected()).toBe(0);
  });

  it('같은 토큰의 거절은 쉬는 시간 안에 한 번만 알린다', async () => {
    const h = setup({ [`${API}/orders`]: 403 });
    await h.target.fetch(`${API}/orders`, h.bearer('access-1'));
    h.advance(AUTHORITY_RECHECK_COOLDOWN_MS - 1);
    await h.target.fetch(`${API}/orders`, h.bearer('access-1'));
    expect(h.rejected()).toBe(1);
    h.advance(1);
    await h.target.fetch(`${API}/orders`, h.bearer('access-1'));
    expect(h.rejected()).toBe(2);
  });

  it('멈추면 원래 fetch로 되돌린다', () => {
    const h = setup();
    expect(h.target.fetch).not.toBe(h.original);
    h.stop();
    expect(h.target.fetch).toBe(h.original);
  });
});

describe('recheckSessionAfterRejection', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  function run({ updated, session }: { updated: unknown; session: () => Promise<Response> }) {
    const calls = { update: 0, session: 0, signOut: 0 };
    const result = recheckSessionAfterRejection({
      update: async () => {
        calls.update += 1;
        return updated;
      },
      fetchImpl: async (input) => {
        if (String(input).endsWith('/csrf')) return json({ csrfToken: 'csrf-1' });
        calls.session += 1;
        return session();
      },
      signOut: () => {
        calls.signOut += 1;
      },
    });
    return { result, calls };
  }

  it('다시 검증한 세션이 돌아오면 세션 조회 없이 그대로 둔다', async () => {
    const { result, calls } = run({
      updated: { user: { role: 'driver' } },
      session: async () => json(null),
    });
    expect(await result).toBe('kept');
    expect(calls).toEqual({ update: 1, session: 0, signOut: 0 });
  });

  it('세션이 돌아오지 않고 세션 조회도 비어 있으면 로그아웃시킨다', async () => {
    for (const body of [null, {}]) {
      const { result, calls } = run({ updated: null, session: async () => json(body) });
      expect(await result).toBe('ended');
      expect(calls).toEqual({ update: 1, session: 1, signOut: 1 });
    }
  });

  it('세션 조회가 실패하거나 아직 사용자가 있으면 로그아웃시키지 않는다(일시 장애 보존)', async () => {
    const cases: Array<() => Promise<Response>> = [
      async () => {
        throw new TypeError('Failed to fetch');
      },
      async () => json({ message: 'error' }, 500),
      async () => new Response('<html>', { status: 200 }),
      async () => json({ user: { role: 'seller' } }),
    ];
    for (const session of cases) {
      const { result, calls } = run({ updated: null, session });
      expect(await result).toBe('unknown');
      expect(calls.signOut).toBe(0);
    }
  });

  it('isSessionEnded는 CSRF 토큰을 받아 세션 조회를 POST로 보내 재사용 없이 다시 검증한다', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const ended = await isSessionEnded(async (input, init) => {
      requests.push({ url: String(input), init });
      return String(input).endsWith('/csrf') ? json({ csrfToken: 'csrf-1' }) : json(null);
    });
    expect(ended).toBe(true);
    expect(requests).toEqual([
      { url: '/api/auth/csrf', init: { cache: 'no-store' } },
      {
        url: '/api/auth/session',
        init: {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csrfToken: 'csrf-1' }),
        },
      },
    ]);
  });

  it('isSessionEnded는 다른 세션 주소를 받으면 같은 경로의 csrf를 부른다', async () => {
    const urls: string[] = [];
    await isSessionEnded(async (input) => {
      urls.push(String(input));
      return String(input).endsWith('/csrf') ? json({ csrfToken: 'csrf-1' }) : json({});
    }, '/base/api/auth/session');
    expect(urls).toEqual(['/base/api/auth/csrf', '/base/api/auth/session']);
  });

  it('CSRF 토큰을 받지 못하면 세션을 끝났다고 보지 않는다(일시 장애 보존)', async () => {
    const cases: Array<() => Promise<Response>> = [
      async () => {
        throw new TypeError('Failed to fetch');
      },
      async () => json({ message: 'error' }, 500),
      async () => json({}),
      async () => json({ csrfToken: '' }),
    ];
    for (const csrf of cases) {
      let sessionCalls = 0;
      const ended = await isSessionEnded(async (input) => {
        if (String(input).endsWith('/csrf')) return csrf();
        sessionCalls += 1;
        return json(null);
      });
      expect(ended).toBe(false);
      expect(sessionCalls).toBe(0);
    }
  });

  it('쿠키를 지운 뒤 늦은 응답이 되살린 세션도 강제 검증이 폐기를 판정하면 로그아웃시킨다', async () => {
    // update()는 폐기를 판정해 null을 돌려줬지만 늦게 온 GET 응답이 쿠키를 되살린 상황.
    // GET이라면 재사용 구간이라 사용자가 남아 보였을 것이다. POST 강제 검증은 사용자 없음으로 답한다.
    const methods: string[] = [];
    let signedOut = 0;
    const result = await recheckSessionAfterRejection({
      update: async () => null,
      fetchImpl: async (input, init) => {
        if (String(input).endsWith('/csrf')) return json({ csrfToken: 'csrf-1' });
        methods.push(init?.method ?? 'GET');
        return init?.method === 'POST' ? json({}) : json({ user: { role: 'seller' } });
      },
      signOut: () => {
        signedOut += 1;
      },
    });
    expect(result).toBe('ended');
    expect(methods).toEqual(['POST']);
    expect(signedOut).toBe(1);
  });
});

describe('로그아웃 시각 표시(되살아난 세션 쿠키 정리)', () => {
  it('표시 쿠키는 재사용 구간의 두 배 동안 남고 https에서만 Secure다', () => {
    expect(SIGNED_OUT_MARKER_MAX_AGE_SECONDS).toBe(120);
    expect(signedOutMarkerCookie(T0, true)).toBe(
      `${SIGNED_OUT_MARKER_COOKIE}=${T0}; Path=/; Max-Age=120; HttpOnly; SameSite=Lax; Secure`,
    );
    expect(signedOutMarkerCookie(T0, false)).not.toContain('Secure');
  });

  it('쿠키 헤더에서 로그아웃 시각을 읽고 없거나 잘못된 값은 null이다', () => {
    expect(readSignedOutAt(`a=1; ${SIGNED_OUT_MARKER_COOKIE}=${T0}; b=2`)).toBe(T0);
    for (const header of [
      null,
      undefined,
      '',
      'a=1',
      `${SIGNED_OUT_MARKER_COOKIE}=abc`,
      `${SIGNED_OUT_MARKER_COOKIE}=-5`,
    ]) {
      expect(readSignedOutAt(header)).toBeNull();
    }
  });

  it('로그아웃 시각 이전에 검증된 토큰만 재사용 표시를 지운다', () => {
    const verified = baseToken({ authorityVerifiedAt: T0, authorityVerifiedFor: 'fp' });
    expect(forgetAuthorityVerifiedBefore(verified, T0)).toEqual(baseToken());
    expect(forgetAuthorityVerifiedBefore(verified, T0 + 1)).toEqual(baseToken());
    expect(forgetAuthorityVerifiedBefore(verified, T0 - 1)).toBe(verified);
    expect(forgetAuthorityVerifiedBefore(verified, null)).toBe(verified);
    const unverified = baseToken();
    expect(forgetAuthorityVerifiedBefore(unverified, T0)).toBe(unverified);
  });

  it('되살아난 쿠키(로그아웃 전 검증)는 재사용 구간이어도 API로 다시 검증해 끝낸다', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const config = {
      session: { strategy: 'jwt' },
      callbacks: {
        jwt: async ({ token }: { token: Record<string, unknown> }) => {
          seen.push(token);
          return revalidateSessionToken(token, {
            verify: async () => ({ kind: 'revoked' }),
            refresh: async () => null,
            now: () => T0 + 5_000,
          });
        },
      },
    };
    const resurrected = baseToken({ authorityVerifiedAt: T0, authorityVerifiedFor: 'fp' });
    const lazy = withSignedOutMarker(config);
    const marked = lazy({
      headers: new Headers({ cookie: `${SIGNED_OUT_MARKER_COOKIE}=${T0 + 1_000}` }),
    });
    expect(marked.session).toBe(config.session);
    expect(await marked.callbacks.jwt({ token: resurrected })).toBeNull();
    expect(seen.at(-1)).not.toHaveProperty('authorityVerifiedAt');
  });

  it('표시가 없거나 요청이 없으면 설정을 그대로 쓴다', () => {
    const config = { callbacks: { jwt: async () => null } };
    const lazy = withSignedOutMarker(config);
    expect(lazy(undefined)).toBe(config);
    expect(lazy({ headers: new Headers({ cookie: 'a=1' }) })).toBe(config);
  });

  it('로그아웃 응답에만 표시 쿠키를 더하고 원래 쿠키·상태·본문을 지킨다', async () => {
    const upstream = (status: number) => async () => {
      const headers = new Headers({ 'content-type': 'application/json' });
      headers.append('Set-Cookie', 'authjs.session-token=; Max-Age=0; Path=/');
      return new Response(JSON.stringify({ url: '/login' }), { status, headers });
    };
    const signOut = withSignedOutMarkerOnSignOut(upstream(200), () => T0);
    const response = await signOut(
      new Request('https://app.test/api/auth/signout', { method: 'POST' }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: '/login' });
    expect(response.headers.getSetCookie()).toEqual([
      'authjs.session-token=; Max-Age=0; Path=/',
      signedOutMarkerCookie(T0, true),
    ]);

    const session = await withSignedOutMarkerOnSignOut(
      upstream(200),
      () => T0,
    )(new Request('https://app.test/api/auth/session', { method: 'POST' }));
    expect(session.headers.getSetCookie()).toEqual(['authjs.session-token=; Max-Age=0; Path=/']);

    const failed = await withSignedOutMarkerOnSignOut(
      upstream(403),
      () => T0,
    )(new Request('https://app.test/api/auth/signout', { method: 'POST' }));
    expect(failed.headers.getSetCookie()).toEqual(['authjs.session-token=; Max-Age=0; Path=/']);

    const local = await withSignedOutMarkerOnSignOut(
      upstream(302),
      () => T0,
    )(new Request('http://127.0.0.1:3203/api/auth/signout', { method: 'POST' }));
    expect(local.headers.getSetCookie().at(-1)).toBe(signedOutMarkerCookie(T0, false));
  });
});
