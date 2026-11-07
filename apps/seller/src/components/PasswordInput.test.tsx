import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 공용 PasswordInput(판매자·소비자 로그인)의 비밀번호 보기 버튼.
// 예전에는 tabIndex={-1}에 onMouseDown에서만 바꿔 키보드(Tab·Enter·Space)로 비밀번호를 볼 수 없었고
// 이름도 영어("Toggle password visibility")였다. 이 저장소 테스트에는 DOM이 없어 useState를 바꿔 넣고
// 컴포넌트가 돌려준 요소 트리의 핸들러를 직접 부른다. 네이티브 button은 Enter·Space를 click으로 바꾸므로
// "Tab으로 갈 수 있음(tabIndex -1 아님) + click에서 바꿈"이 키보드 동작이다.

const state = vi.hoisted(() => ({ reveal: false, setReveal: vi.fn() }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: () => [state.reveal, state.setReveal],
  };
});

const { PasswordInput } = await import('@greenhub/ui/components/password-input');

type Props = {
  children?: ReactNode;
  type?: string;
  tabIndex?: number;
  className?: string;
  'aria-label'?: string;
  'aria-pressed'?: boolean;
  onClick?: (event: unknown) => void;
  onMouseDown?: (event: { preventDefault: () => void }) => void;
  onKeyDown?: unknown;
};

function collect(node: ReactNode): ReactElement<Props>[] {
  const found: ReactElement<Props>[] = [];
  const visit = (current: ReactNode): void => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (typeof current !== 'object' || current === null || !('props' in current)) return;
    const element = current as ReactElement<Props>;
    found.push(element);
    visit(element.props.children);
  };
  visit(node);
  return found;
}

function toggleButton(size?: 'sm' | 'md') {
  const tree = (PasswordInput as (props: { size?: 'sm' | 'md' }) => ReactNode)({ size });
  const buttons = collect(tree).filter((el) => el.type === 'button');
  expect(buttons).toHaveLength(1);
  return buttons[0] as ReactElement<Props>;
}

function applyUpdate(update: unknown, previous: boolean) {
  return typeof update === 'function' ? (update as (v: boolean) => boolean)(previous) : update;
}

describe('PasswordInput 비밀번호 보기 버튼', () => {
  beforeEach(() => {
    state.reveal = false;
    state.setReveal.mockReset();
  });

  it.each(['md', 'sm'] as const)(
    '%s: Tab으로 갈 수 있는 button이고 한국어 이름과 눌림 상태가 있다',
    (size) => {
      const button = toggleButton(size);
      expect(button.props.type).toBe('button');
      expect(button.props.tabIndex === undefined || button.props.tabIndex >= 0).toBe(true);
      expect(button.props['aria-label']).toBe('비밀번호 보기');
      expect(button.props['aria-pressed']).toBe(false);
    },
  );

  it('보이는 상태면 aria-pressed가 true다(이름은 그대로)', () => {
    state.reveal = true;
    const button = toggleButton();
    expect(button.props['aria-pressed']).toBe(true);
    expect(button.props['aria-label']).toBe('비밀번호 보기');
  });

  it('click(키보드 Enter·Space 포함)에서 보이기·숨기기를 바꾼다', () => {
    const button = toggleButton();
    button.props.onClick?.({});
    expect(state.setReveal).toHaveBeenCalledTimes(1);
    expect(applyUpdate(state.setReveal.mock.calls[0]?.[0], false)).toBe(true);
    expect(applyUpdate(state.setReveal.mock.calls[0]?.[0], true)).toBe(false);
  });

  it('마우스 누름(mousedown)은 입력칸 초점만 지키고 상태는 바꾸지 않는다(click과 두 번 바뀌지 않게)', () => {
    const button = toggleButton();
    const preventDefault = vi.fn();
    button.props.onMouseDown?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(state.setReveal).not.toHaveBeenCalled();
  });

  it('키보드 초점 표시(focus-visible 테두리)가 있다', () => {
    expect(toggleButton().props.className).toMatch(/focus-visible:outline-2/);
  });
});
