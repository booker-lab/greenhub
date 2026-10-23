import { describe, expect, it } from 'vitest';
import {
  revalidateSessionToken,
  SESSION_AUTHORITY_REUSE_MS,
  type SessionAuthorityResult,
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
