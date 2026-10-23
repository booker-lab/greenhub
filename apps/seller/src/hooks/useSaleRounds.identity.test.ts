import { beforeEach, describe, expect, it, vi } from 'vitest';

// 회차 상세(app/sale-rounds/[id]/page.tsx)는 `[getRound, roundId]`가 바뀔 때마다 상세를 다시 받고,
// 그동안 폼을 내렸다가 새 회차로 편집 초안을 초기화한다. 그래서 토큰만 갱신됐을 때 getRound가
// 같은 함수로 남는지를 실제 훅으로 확인한다. DOM 없이 훅 정체성만 보려고 React 훅을 최소 구현으로 바꾼다.

type Session = {
  data: { user: { storeId?: string; accessToken?: string } } | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
};

const harness = vi.hoisted(() => {
  const slots: unknown[] = [];
  let cursor = 0;
  const state = {
    session: null as unknown,
    // 목록 조회를 보는 테스트만 useEffect를 실제로 돌린다(의존성이 바뀔 때 정리 후 다시 실행).
    runEffects: false,
    reset() {
      slots.length = 0;
      cursor = 0;
      state.runEffects = false;
    },
    beginRender() {
      cursor = 0;
    },
  };
  const sameDeps = (a: readonly unknown[], b: readonly unknown[]) =>
    a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

  const react = {
    useRef<T>(initial: T) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index] as { current: T };
    },
    useState<T>(initial: T | (() => T)) {
      const index = cursor++;
      if (!(index in slots)) {
        const value = typeof initial === 'function' ? (initial as () => T)() : initial;
        const entry: [T, (next: T | ((current: T) => T)) => void] = [
          value,
          (next) => {
            entry[0] = typeof next === 'function' ? (next as (current: T) => T)(entry[0]) : next;
          },
        ];
        slots[index] = entry;
      }
      const entry = slots[index] as [T, (next: T | ((current: T) => T)) => void];
      return [entry[0], entry[1]] as const;
    },
    useCallback<T>(callback: T, deps: readonly unknown[]) {
      const index = cursor++;
      const previous = slots[index] as { callback: T; deps: readonly unknown[] } | undefined;
      if (previous && sameDeps(previous.deps, deps)) return previous.callback;
      slots[index] = { callback, deps };
      return callback;
    },
    useEffect(effect: () => undefined | (() => void), deps: readonly unknown[]) {
      const index = cursor++;
      if (!state.runEffects) return;
      const previous = slots[index] as
        | { deps: readonly unknown[]; cleanup: undefined | (() => void) }
        | undefined;
      if (previous && sameDeps(previous.deps, deps)) return;
      previous?.cleanup?.();
      slots[index] = { deps, cleanup: effect() };
    },
  };

  return { state, react };
});

const apiJson = vi.hoisted(() => vi.fn());

vi.mock('react', () => harness.react);
vi.mock('next-auth/react', () => ({ useSession: () => harness.state.session }));
vi.mock('@/lib/api', () => ({ apiJson }));

const { useSaleRounds } = await import('./useSaleRounds');

function render(session: Session) {
  harness.state.session = session;
  harness.state.beginRender();
  // biome-ignore lint/correctness/useHookAtTopLevel: 위에서 React 훅을 최소 구현으로 바꿔 한 번의 렌더를 흉내 낸다
  return useSaleRounds();
}

function authenticated(storeId: string, accessToken: string): Session {
  return { data: { user: { storeId, accessToken } }, status: 'authenticated' };
}

// 회차 상세 effect의 의존성 배열과 같은 비교 — 하나라도 바뀌면 상세를 다시 받는다.
function detailRefetches(
  previous: readonly [unknown, string],
  next: readonly [unknown, string],
): boolean {
  return previous.some((value, index) => !Object.is(value, next[index]));
}

describe('useSaleRounds — 토큰 갱신과 요청 함수 정체성', () => {
  beforeEach(() => {
    harness.state.reset();
    apiJson.mockReset();
  });

  it('토큰만 바뀌면 getRound와 저장·상태 변경 함수가 그대로라 회차 상세를 다시 받지 않는다', () => {
    const before = render(authenticated('store-a', 'token-1'));
    const after = render(authenticated('store-a', 'token-2'));

    expect(after.getRound).toBe(before.getRound);
    expect(after.saveRound).toBe(before.saveRound);
    expect(after.changeStatus).toBe(before.changeStatus);
    expect(after.completeRound).toBe(before.completeRound);
    expect(detailRefetches([before.getRound, 'round-a'], [after.getRound, 'round-a'])).toBe(false);
  });

  it('토큰 갱신 중 세션이 잠깐 loading이 돼도 getRound는 그대로다', () => {
    const before = render(authenticated('store-a', 'token-1'));
    const during = render({ ...authenticated('store-a', 'token-1'), status: 'loading' });
    const after = render(authenticated('store-a', 'token-2'));

    expect(during.getRound).toBe(before.getRound);
    expect(after.getRound).toBe(before.getRound);
  });

  it('같은 getRound라도 호출 시점의 최신 토큰으로 요청한다', async () => {
    const before = render(authenticated('store-a', 'token-1'));
    render(authenticated('store-a', 'token-2'));
    apiJson.mockRejectedValueOnce(new Error('응답 형식 확인 생략'));

    await expect(before.getRound('round-a')).rejects.toThrow('응답 형식 확인 생략');
    expect(apiJson).toHaveBeenCalledWith('/stores/store-a/sale-rounds/round-a', 'token-2');
  });

  it('roundId가 바뀌면 회차 상세를 다시 받는다', () => {
    const current = render(authenticated('store-a', 'token-1'));

    expect(detailRefetches([current.getRound, 'round-a'], [current.getRound, 'round-b'])).toBe(
      true,
    );
  });

  it('스토어가 바뀌면 getRound가 새 함수가 돼 다시 받는다', () => {
    const before = render(authenticated('store-a', 'token-1'));
    const after = render(authenticated('store-b', 'token-1'));

    expect(after.getRound).not.toBe(before.getRound);
  });

  it('세션을 불러오는 중이라 토큰이 없다가 생기면 getRound가 새 함수가 돼 첫 조회를 다시 한다', () => {
    const loading = render({ data: null, status: 'loading' });
    const ready = render(authenticated('store-a', 'token-1'));

    expect(ready.getRound).not.toBe(loading.getRound);
  });

  it('토큰이 사라지면 인증 오류로 닫는다', async () => {
    render(authenticated('store-a', 'token-1'));
    const signedOut = render({ data: { user: { storeId: 'store-a' } }, status: 'authenticated' });

    await expect(signedOut.getRound('round-a')).rejects.toThrow(
      '셀러 스토어 인증 정보를 확인할 수 없습니다.',
    );
    expect(apiJson).not.toHaveBeenCalled();
  });
});

describe('useSaleRounds — 토큰 갱신과 회차 목록 재조회', () => {
  const listPath = (storeId: string) => `/stores/${storeId}/sale-rounds`;
  const listCalls = () => apiJson.mock.calls.filter(([path]) => path === listPath('store-a'));

  beforeEach(() => {
    harness.state.reset();
    harness.state.runEffects = true;
    apiJson.mockReset();
    apiJson.mockResolvedValue({ items: [] });
  });

  it('토큰만 바뀌면 회차 목록을 다시 받지 않는다', () => {
    render(authenticated('store-a', 'token-1'));
    render(authenticated('store-a', 'token-2'));
    render(authenticated('store-a', 'token-3'));

    expect(listCalls()).toEqual([[listPath('store-a'), 'token-1']]);
  });

  it('토큰 갱신 중 세션이 잠깐 loading이 돼도 회차 목록을 다시 받지 않는다', () => {
    render(authenticated('store-a', 'token-1'));
    render({ ...authenticated('store-a', 'token-1'), status: 'loading' });
    render(authenticated('store-a', 'token-2'));

    expect(apiJson).toHaveBeenCalledTimes(1);
  });

  it('토큰만 바뀐 뒤 refetch는 최신 토큰으로 목록을 받는다', async () => {
    render(authenticated('store-a', 'token-1'));
    const after = render(authenticated('store-a', 'token-2'));

    await after.refetch();
    expect(apiJson).toHaveBeenLastCalledWith(listPath('store-a'), 'token-2');
  });

  it('스토어가 바뀌면 새 스토어 목록을 받는다', () => {
    render(authenticated('store-a', 'token-1'));
    render(authenticated('store-b', 'token-1'));

    expect(apiJson.mock.calls).toEqual([
      [listPath('store-a'), 'token-1'],
      [listPath('store-b'), 'token-1'],
    ]);
  });

  it('세션을 불러오는 중이라 토큰이 없다가 생기면 첫 목록을 받는다', () => {
    const loading = render({ data: null, status: 'loading' });
    expect(apiJson).not.toHaveBeenCalled();
    expect(loading.loading).toBe(true);

    render(authenticated('store-a', 'token-1'));
    expect(listCalls()).toEqual([[listPath('store-a'), 'token-1']]);
  });

  it('토큰이 사라지면 목록을 비우고 인증 오류로 닫는다', () => {
    render(authenticated('store-a', 'token-1'));
    render({ data: { user: { storeId: 'store-a' } }, status: 'authenticated' });
    const signedOut = render({ data: { user: { storeId: 'store-a' } }, status: 'authenticated' });

    expect(apiJson).toHaveBeenCalledTimes(1);
    expect(signedOut.rounds).toEqual([]);
    expect(signedOut.error).toBe('셀러 스토어 인증 정보를 확인할 수 없습니다.');
  });
});
