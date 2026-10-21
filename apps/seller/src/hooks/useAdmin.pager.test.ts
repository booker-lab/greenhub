import { describe, expect, it } from 'vitest';
import { type AdminPage, createAdminPagedLoader, readAdminPage } from './useAdmin.pager';

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
  const state = {
    items: [] as string[],
    hasMore: false,
    error: null as string | null,
    loading: true,
    loadingMore: false,
    moreError: null as string | null,
  };
  const pager = createAdminPagedLoader<string>({
    setItems: (items) => {
      state.items = items;
    },
    setHasMore: (hasMore) => {
      state.hasMore = hasMore;
    },
    setError: (error) => {
      state.error = error;
    },
    setLoading: (loading) => {
      state.loading = loading;
    },
    setLoadingMore: (loadingMore) => {
      state.loadingMore = loadingMore;
    },
    setMoreError: (moreError) => {
      state.moreError = moreError;
    },
  });
  return { state, pager };
}

const page = (items: string[], nextCursor: string | null): AdminPage<string> => ({
  items,
  hasMore: nextCursor !== null,
  nextCursor,
});

describe('관리자 목록 더 보기 로더', () => {
  it('첫 쪽 뒤에 nextCursor로 다음 쪽을 이어 붙이고, 끝나면 더 보기를 감춘다', async () => {
    const { state, pager } = setup();
    const cursors: Array<string | null> = [];
    const pages: Record<string, AdminPage<string>> = {
      first: page(['주문1', '주문2'], 'c2'),
      c2: page(['주문3'], null),
    };
    await pager.load({
      kind: 'fetch',
      fetchPage: async (cursor) => {
        cursors.push(cursor);
        return pages[cursor ?? 'first'];
      },
      errLabel: '주문 목록',
    });
    expect(state).toMatchObject({ items: ['주문1', '주문2'], hasMore: true, loading: false });

    await pager.loadMore();
    expect(cursors).toEqual([null, 'c2']);
    expect(state).toMatchObject({ items: ['주문1', '주문2', '주문3'], hasMore: false });

    // 더 받을 쪽이 없으면 요청하지 않는다.
    await pager.loadMore();
    expect(cursors).toHaveLength(2);
  });

  it('더 보기는 한 번에 하나만 보낸다', async () => {
    const { state, pager } = setup();
    const more = deferred<AdminPage<string>>();
    let calls = 0;
    await pager.load({
      kind: 'fetch',
      fetchPage: (cursor) => {
        calls += 1;
        return cursor === null ? Promise.resolve(page(['a'], 'c1')) : more.promise;
      },
      errLabel: '주문 목록',
    });

    const first = pager.loadMore();
    const second = pager.loadMore();
    expect(state.loadingMore).toBe(true);
    more.resolve(page(['b'], null));
    await Promise.all([first, second]);

    expect(calls).toBe(2);
    expect(state.items).toEqual(['a', 'b']);
    expect(state.loadingMore).toBe(false);
  });

  it('더 보기 도중 조건이 바뀌면 늦게 온 다음 쪽을 새 목록에 섞지 않는다', async () => {
    const { state, pager } = setup();
    const more = deferred<AdminPage<string>>();
    await pager.load({
      kind: 'fetch',
      fetchPage: (cursor) =>
        cursor === null ? Promise.resolve(page(['옛1'], 'c1')) : more.promise,
      errLabel: '주문 목록',
    });
    const pendingMore = pager.loadMore();

    await pager.load({
      kind: 'fetch',
      fetchPage: async () => page(['새1'], null),
      errLabel: '주문 목록',
    });
    more.resolve(page(['옛2'], null));
    await pendingMore;

    expect(state.items).toEqual(['새1']);
    expect(state.hasMore).toBe(false);
  });

  it('새 조건의 첫 쪽이 오기 전에는 옛 커서로 더 보기를 보내지 않는다', async () => {
    const { state, pager } = setup();
    await pager.load({
      kind: 'fetch',
      fetchPage: async () => page(['옛1'], 'c1'),
      errLabel: '주문 목록',
    });
    const next = deferred<AdminPage<string>>();
    let moreCalls = 0;
    const loading = pager.load({
      kind: 'fetch',
      fetchPage: (cursor) => {
        if (cursor !== null) moreCalls += 1;
        return next.promise;
      },
      errLabel: '주문 목록',
    });

    expect(state.hasMore).toBe(false);
    await pager.loadMore();
    expect(moreCalls).toBe(0);
    next.resolve(page(['새1'], null));
    await loading;
  });

  it('더 보기 실패는 받은 목록과 첫 쪽 상태를 지우지 않고 moreError만 남긴다', async () => {
    const { state, pager } = setup();
    await pager.load({
      kind: 'fetch',
      fetchPage: async (cursor) => {
        if (cursor !== null) throw new Error('network');
        return page(['a'], 'c1');
      },
      errLabel: '기사 목록',
    });

    await expect(pager.loadMore()).resolves.toBe('기사 목록 더 보기 중 오류 발생');
    expect(state.items).toEqual(['a']);
    expect(state.error).toBeNull();
    expect(state.moreError).toBe('기사 목록 더 보기 중 오류 발생');
    expect(state.hasMore).toBe(true);
  });

  it('늦게 도착한 옛 첫 쪽은 최신 결과를 덮지 않는다', async () => {
    const { state, pager } = setup();
    const old = deferred<AdminPage<string>>();
    const first = pager.load({
      kind: 'fetch',
      fetchPage: () => old.promise,
      errLabel: '주문 목록',
    });
    const second = pager.load({
      kind: 'fetch',
      fetchPage: async () => page(['최신'], null),
      errLabel: '주문 목록',
    });
    await second;
    old.resolve(page(['옛'], 'c1'));
    await first;

    expect(state.items).toEqual(['최신']);
    expect(state.hasMore).toBe(false);
  });
});

describe('readAdminPage', () => {
  it('hasMore·nextCursor가 없는 옛 응답은 더 없음으로 본다', () => {
    expect(readAdminPage<string>({ orders: ['a'], total: 1 }, 'orders')).toEqual({
      items: ['a'],
      hasMore: false,
      nextCursor: null,
    });
    expect(
      readAdminPage<string>({ orders: ['a'], hasMore: true, nextCursor: 'a' }, 'orders'),
    ).toEqual({ items: ['a'], hasMore: true, nextCursor: 'a' });
    expect(readAdminPage<string>(null, 'orders').items).toEqual([]);
  });
});
