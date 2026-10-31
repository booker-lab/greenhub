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
});
