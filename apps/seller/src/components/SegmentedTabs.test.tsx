import type React from 'react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { SegmentedTabs } from './SegmentedTabs';

const TABS = [
  { key: 'A', label: '처리 필요', count: 3 },
  { key: 'B', label: '완료' },
] as const;

type GroupProps = { role?: string; 'aria-label'?: string; children?: ReactNode };

function isElement(node: ReactNode): node is ReactElement<{ children?: ReactNode }> {
  return typeof node === 'object' && node !== null && 'props' in node;
}

/** 렌더 트리(DOM 불필요)에서 탭 버튼 목록을 바로 감싼 묶음 요소를 찾는다. */
function findGroup(node: ReactNode): ReactElement<GroupProps> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findGroup(child);
      if (found) return found;
    }
    return null;
  }
  if (!isElement(node)) return null;
  if (Array.isArray(node.props.children)) return node as ReactElement<GroupProps>;
  return findGroup(node.props.children);
}

describe('SegmentedTabs', () => {
  it('ariaLabel을 주면 탭 묶음이 그 이름의 group이 된다', () => {
    const tree = SegmentedTabs({
      tabs: TABS,
      value: 'A',
      onChange: () => {},
      ariaLabel: '주문 상태',
    });
    const group = findGroup(tree);
    expect(group?.props.role).toBe('group');
    expect(group?.props['aria-label']).toBe('주문 상태');
  });

  it('ariaLabel이 없으면 묶음에 역할을 붙이지 않는다', () => {
    const tree = SegmentedTabs({ tabs: TABS, value: 'A', onChange: () => {} });
    const group = findGroup(tree);
    expect(group).not.toBeNull();
    expect(group?.props.role).toBeUndefined();
    expect(group?.props['aria-label']).toBeUndefined();
  });

  it('underline: 선택 탭은 검정 3px 밑줄·굵게·aria-pressed, 건수는 글자(0은 회색)로 붙는다', () => {
    const tabs = [
      { key: 'A', label: '처리 필요', count: 3, badgeColor: 'red' as const },
      { key: 'B', label: '완료', count: 0 },
    ];
    const tree = SegmentedTabs({ tabs, value: 'A', onChange: () => {}, variant: 'underline' });
    const group = findGroup(tree);
    const buttons = (group?.props.children ?? []) as ReactElement<{
      style: React.CSSProperties;
      'aria-pressed'?: boolean;
      children: ReactNode[];
    }>[];
    const [active, idle] = buttons;
    expect(active.props.style.borderBottom).toBe('3px solid var(--color-text)');
    expect(active.props.style.fontWeight).toBe(700);
    expect(active.props['aria-pressed']).toBe(true);
    expect(idle.props.style.borderBottom).toBe('3px solid transparent');
    expect(idle.props['aria-pressed']).toBe(false);

    const count = (button: (typeof buttons)[number]) =>
      button.props.children.find(
        (c): c is ReactElement<{ style: React.CSSProperties; children: number }> =>
          isElement(c) && typeof (c.props as { children?: unknown }).children === 'number',
      );
    expect(count(active)?.props.children).toBe(3);
    expect(count(active)?.props.style.color).toBe('var(--color-text)');
    expect(count(idle)?.props.children).toBe(0);
    expect(count(idle)?.props.style.color).toBe('var(--color-text-secondary)');
  });

  it('variant를 주지 않으면 지금 모양(브랜드 2px 밑줄, 0건은 숨김, aria-pressed 없음)을 유지한다', () => {
    const tree = SegmentedTabs({
      tabs: [{ key: 'A', label: '완료', count: 0 }],
      value: 'A',
      onChange: () => {},
    });
    const group = findGroup(tree);
    const [button] = (group?.props.children ?? []) as ReactElement<{
      style: React.CSSProperties;
      'aria-pressed'?: boolean;
      children: ReactNode[];
    }>[];
    expect(button.props.style.borderBottom).toBe('2px solid var(--color-primary)');
    expect(button.props['aria-pressed']).toBeUndefined();
    expect(button.props.children.filter(Boolean)).toEqual(['완료']);
  });
});
