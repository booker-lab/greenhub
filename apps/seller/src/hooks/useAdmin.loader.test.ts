import { describe, expect, it } from 'vitest';
import { createAdminListLoader } from './useAdmin.loader';
import { ADMIN_COMMAND_MISSING_TOKEN_MESSAGE } from './useAdmin.outcome';

// Mock/local only — 실제 API 호출 없음. 응답 도착 순서를 손으로 정해 로더의 상태 쓰기만 본다.

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const state = { items: [] as string[], error: null as string | null, loading: true };
  const load = createAdminListLoader<string>({
    setItems: (items) => {
      state.items = items;
    },
    setError: (error) => {
      state.error = error;
    },
    setLoading: (loading) => {
      state.loading = loading;
    },
  });
  return { state, load };
}

const fetchOf = (promise: Promise<string[]>) => ({
  kind: 'fetch' as const,
  fetch: () => promise,
  errLabel: '주문 목록',
});

describe('관리자 목록 로더 — 응답 순서 가드', () => {
  it('늦게 도착한 옛 응답은 최신 결과를 덮지 않는다', async () => {
    const { state, load } = setup();
    const old = deferred<string[]>();
    const latest = deferred<string[]>();
    const first = load(fetchOf(old.promise)); // 필터 "가"
    const second = load(fetchOf(latest.promise)); // 필터 "가나"

    latest.resolve(['가나-주문']);
    await second;
    expect(state.items).toEqual(['가나-주문']);
    expect(state.loading).toBe(false);

    old.resolve(['가-주문']);
    await first;
    expect(state.items).toEqual(['가나-주문']);
    expect(state.loading).toBe(false);
  });

  it('옛 요청이 먼저 끝나도 최신 요청이 끝날 때까지 로딩을 유지한다', async () => {
    const { state, load } = setup();
    const old = deferred<string[]>();
    const latest = deferred<string[]>();
    const first = load(fetchOf(old.promise));
    const second = load(fetchOf(latest.promise));

    old.resolve(['가-주문']);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.items).toEqual([]);
    expect(state.loading).toBe(true);

    latest.resolve(['가나-주문']);
    await expect(first).resolves.toBeNull();
    await second;
    expect(state.items).toEqual(['가나-주문']);
    expect(state.loading).toBe(false);
  });

  it('늦게 실패한 옛 요청은 최신 성공 화면에 오류를 남기지 않는다', async () => {
    const { state, load } = setup();
    const old = deferred<string[]>();
    const first = load(fetchOf(old.promise));
    await load(fetchOf(Promise.resolve(['최신'])));

    old.reject(new Error('timeout'));
    await first;
    expect(state.error).toBeNull();
    expect(state.items).toEqual(['최신']);
  });

  it('밀려난 요청의 호출자는 최신 요청의 결과를 받는다', async () => {
    const { load } = setup();
    const old = deferred<string[]>();
    const latest = deferred<string[]>();
    const first = load(fetchOf(old.promise));
    load(fetchOf(latest.promise));

    old.resolve(['옛']);
    latest.reject(new Error('500'));
    await expect(first).resolves.toBe('주문 목록 조회 중 오류 발생');
  });

  it('최신 요청 실패는 이전 items를 비우지 않고 error만 남긴다', async () => {
    const { state, load } = setup();
    await load(fetchOf(Promise.resolve(['기존'])));
    const readError = await load(fetchOf(Promise.reject(new Error('500'))));
    expect(readError).toBe('주문 목록 조회 중 오류 발생');
    expect(state.error).toBe('주문 목록 조회 중 오류 발생');
    expect(state.items).toEqual(['기존']);
    expect(state.loading).toBe(false);
  });
});

describe('관리자 목록 로더 — 토큰 없음', () => {
  it('세션 확인 중이면 로딩을 유지하고 오류를 쓰지 않는다', async () => {
    const { state, load } = setup();
    await expect(load({ kind: 'session-pending' })).resolves.toBe(
      ADMIN_COMMAND_MISSING_TOKEN_MESSAGE,
    );
    expect(state.loading).toBe(true);
    expect(state.error).toBeNull();
  });

  it('세션 확인이 끝났는데 토큰이 없으면 로딩을 끝내고 인증 오류를 남긴다', async () => {
    const { state, load } = setup();
    await load({ kind: 'missing-token' });
    expect(state.loading).toBe(false);
    expect(state.error).toBe(ADMIN_COMMAND_MISSING_TOKEN_MESSAGE);
  });

  it('토큰 없음 처리 뒤 늦게 온 옛 응답은 무시된다', async () => {
    const { state, load } = setup();
    const old = deferred<string[]>();
    const first = load(fetchOf(old.promise));
    await load({ kind: 'missing-token' });
    old.resolve(['옛']);
    await first;
    expect(state.items).toEqual([]);
    expect(state.loading).toBe(false);
  });
});
