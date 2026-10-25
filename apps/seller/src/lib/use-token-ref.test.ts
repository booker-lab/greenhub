import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// DOM 없이 hook 동작만 보려고 useRef·useEffect를 최소 구현으로 바꾼다.
// effect는 의존성이 바뀐 render에서만 선언 순서대로 실행된다(React와 같은 규칙).
const harness = vi.hoisted(() => {
  const slots: unknown[] = [];
  let cursor = 0;
  let pending: Array<() => void> = [];
  const sameDeps = (a: readonly unknown[], b: readonly unknown[]) =>
    a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  return {
    reset() {
      slots.length = 0;
    },
    render<T>(fn: () => T): T {
      cursor = 0;
      pending = [];
      const result = fn();
      for (const run of pending) run();
      return result;
    },
    react: {
      useRef<T>(initial: T) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index] as { current: T };
      },
      useEffect(effect: () => void, deps: readonly unknown[]) {
        const index = cursor++;
        const previous = slots[index] as readonly unknown[] | undefined;
        if (previous && sameDeps(previous, deps)) return;
        slots[index] = deps;
        pending.push(effect);
      },
    },
  };
});

vi.mock('react', () => harness.react);

const { useTokenRef } = await import('./use-token-ref');

describe('useTokenRef', () => {
  beforeEach(() => harness.reset());

  // 화면이 쓰는 방식 그대로: 토큰 ref hook 다음에 [storeId, hasToken]에 묶인 조회 effect를 둔다.
  function renderScreen(token: string | null | undefined, fetches: string[]) {
    return harness.render(() => {
      const { tokenRef, hasToken } = useTokenRef(token);
      harness.react.useEffect(() => {
        if (hasToken) fetches.push(tokenRef.current);
      }, ['store-1', hasToken, tokenRef]);
      return { tokenRef, hasToken };
    });
  }

  it('첫 토큰이 생기면 그 토큰으로 한 번 조회한다', () => {
    const fetches: string[] = [];
    renderScreen(undefined, fetches);
    expect(fetches).toEqual([]);
    renderScreen('token-1', fetches);
    expect(fetches).toEqual(['token-1']);
  });

  it('토큰 문자열만 바뀌면 조회를 다시 돌리지 않고 이후 요청은 새 토큰을 읽는다', () => {
    const fetches: string[] = [];
    renderScreen('token-1', fetches);
    const { tokenRef } = renderScreen('token-2', fetches);
    expect(fetches).toEqual(['token-1']);
    expect(tokenRef.current).toBe('token-2');
  });

  it('토큰이 사라졌다 다시 생기면(재로그인) 다시 조회한다', () => {
    const fetches: string[] = [];
    renderScreen('token-1', fetches);
    renderScreen(null, fetches);
    renderScreen('token-3', fetches);
    expect(fetches).toEqual(['token-1', 'token-3']);
  });
});

// 토큰 갱신 때 서버 값으로 폼을 다시 채우던 화면이 토큰 문자열에 다시 묶이지 않게 배선을 고정한다.
describe('입력 화면 조회 effect 배선', () => {
  const root = join(__dirname, '..');
  const screens = [
    'app/products/[id]/edit/page.tsx',
    'app/products/_components/useProductForm.ts',
    'app/settings/payout-account/page.tsx',
    'app/settings/store-profile/page.tsx',
    'app/onboarding/page.tsx',
  ];

  it.each(screens)('%s는 useTokenRef를 쓰고 effect 의존성에 토큰 문자열을 넣지 않는다', (file) => {
    const source = readFileSync(join(root, file), 'utf8');
    expect(source).toContain('useTokenRef(');
    const depsLists = [...source.matchAll(/\}, \[([^\]]*)\]\);/g)].map((match) => match[1]);
    for (const deps of depsLists) {
      expect(deps).not.toMatch(/(^|[\s,])token([\s,]|$)/);
      expect(deps).not.toMatch(/accessToken/);
    }
  });
});
