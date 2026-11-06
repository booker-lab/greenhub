import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AdminRowMenu, type AdminRowMenuItem } from '../../_components/adminList';
import { DriverList } from './DriverList';
import { PendingDrivers } from './PendingDrivers';

type Props = ComponentProps<typeof DriverList>;

const FETCH_ERROR_MESSAGE = '기사 목록 조회 중 오류 발생';

const baseProps: Props = {
  drivers: [],
  loading: false,
  error: null,
  processingId: null,
  onAction: () => {},
  onRetry: () => {},
};

function driver(
  id: string,
  overrides: Partial<Props['drivers'][number]> = {},
): Props['drivers'][number] {
  return {
    id,
    name: `기사 ${id}`,
    email: `${id}@example.com`,
    driverApproved: false,
    suspended: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

interface Clickable {
  children?: ReactNode;
  onClick?: unknown;
  items?: AdminRowMenuItem[];
}

type AnyElement = ReactElement<Clickable> & { type: unknown };

function isElement(node: ReactNode): node is AnyElement {
  return typeof node === 'object' && node !== null && 'props' in node;
}

/**
 * 요소 하나를 한 단계 펼친다(DOM 불필요). 함수 컴포넌트는 호출해 그린 결과를 보고,
 * 행 끝 ⋮ 메뉴(AdminRowMenu)는 드롭다운을 그리지 않고 항목 목록(props.items)을 그대로 쓴다.
 */
function expand(element: AnyElement): ReactNode {
  if (element.type === AdminRowMenu) return null;
  if (typeof element.type === 'function') {
    return (element.type as (props: Clickable) => ReactNode)(element.props);
  }
  return element.props.children;
}

/** ⋮ 메뉴 항목을 모두 수집한다. */
function menuItemsOf(node: ReactNode): AdminRowMenuItem[] {
  const out: AdminRowMenuItem[] = [];
  const visit = (current: ReactNode): void => {
    if (Array.isArray(current)) {
      for (const child of current) visit(child);
      return;
    }
    if (!isElement(current)) return;
    if (current.type === AdminRowMenu) out.push(...(current.props.items ?? []));
    visit(expand(current));
  };
  visit(node);
  return out;
}

/** 렌더 트리에 포함된 모든 텍스트 리프(⋮ 메뉴 항목 이름 포함)를 수집한다. */
function textsOf(node: ReactNode): string[] {
  const out: string[] = [];
  const visit = (current: ReactNode): void => {
    if (typeof current === 'string') {
      out.push(current);
      return;
    }
    if (Array.isArray(current)) {
      for (const child of current) visit(child);
      return;
    }
    if (!isElement(current)) return;
    if (current.type === AdminRowMenu) {
      for (const item of current.props.items ?? []) out.push(item.label);
    }
    visit(expand(current));
  };
  visit(node);
  return out;
}

/** 주어진 라벨을 포함한 버튼의 onClick 핸들러를 수집한다. */
function handlersFor(tree: ReactNode, label: string): Array<() => void> {
  const handlers: Array<() => void> = [];
  const visit = (current: ReactNode): void => {
    if (Array.isArray(current)) {
      for (const child of current) visit(child);
      return;
    }
    if (!isElement(current)) return;
    if (typeof current.props.onClick === 'function' && textsOf(current).includes(label)) {
      handlers.push(current.props.onClick as () => void);
    }
    visit(expand(current));
  };
  visit(tree);
  return handlers;
}

describe('Admin DriverList read state', () => {
  it('loading → 로딩 UI를 표시한다', () => {
    const tree = DriverList({ ...baseProps, loading: true });
    expect(textsOf(tree)).toContain('불러오는 중...');
  });

  it('조회 실패 + 0건 → empty copy 없이 error UI와 retry를 표시한다', () => {
    const tree = DriverList({ ...baseProps, error: FETCH_ERROR_MESSAGE });
    const texts = textsOf(tree);
    expect(texts).not.toContain('기사가 없습니다.');
    expect(texts).toContain('기사 목록을 불러오지 못했습니다.');
    expect(texts).toContain(FETCH_ERROR_MESSAGE);
    expect(handlersFor(tree, '다시 조회').length).toBeGreaterThan(0);
  });

  it('성공 + 0건 → 기존 empty copy를 표시하고 retry를 노출하지 않는다', () => {
    const tree = DriverList({ ...baseProps });
    expect(textsOf(tree)).toContain('기사가 없습니다.');
    expect(handlersFor(tree, '다시 조회')).toHaveLength(0);
  });

  it('성공 + 결과 → 기존 driver rendering을 유지하고 retry를 노출하지 않는다', () => {
    const tree = DriverList({ ...baseProps, drivers: [driver('d1')] });
    const texts = textsOf(tree);
    expect(texts).toContain('기사 d1');
    expect(texts).not.toContain('기사가 없습니다.');
    expect(handlersFor(tree, '다시 조회')).toHaveLength(0);
  });

  it('retry 실행 시 onRetry를 호출한다', () => {
    const onRetry = vi.fn();
    const tree = DriverList({ ...baseProps, error: FETCH_ERROR_MESSAGE, onRetry });
    const handlers = handlersFor(tree, '다시 조회');
    expect(handlers.length).toBeGreaterThan(0);
    handlers[0]();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('suspend wiring을 보존한다(⋮ 메뉴: 활동 중=정지…, 정지됨=정지 풀기…, 처리중 표시)', () => {
    const onAction = vi.fn();
    const activeTree = DriverList({
      ...baseProps,
      drivers: [driver('a1', { driverApproved: true })],
      onAction,
    });
    const activeItems = menuItemsOf(activeTree);
    expect(activeItems.map((item) => item.label)).toContain('정지…');
    expect(activeItems.map((item) => item.label)).not.toContain('정지 풀기…');
    // 승인은 표가 아니라 승인 대기 상자(PendingDrivers)가 소유한다.
    expect(textsOf(activeTree)).not.toContain('승인…');
    activeItems.find((item) => item.label === '정지…')?.onSelect();
    expect(onAction).toHaveBeenCalledWith('a1', 'suspend');

    const suspendedTree = DriverList({
      ...baseProps,
      drivers: [driver('s1', { driverApproved: true, suspended: true })],
      onAction,
    });
    const suspendedItems = menuItemsOf(suspendedTree);
    expect(suspendedItems.map((item) => item.label)).toContain('정지 풀기…');
    suspendedItems.find((item) => item.label === '정지 풀기…')?.onSelect();
    expect(onAction).toHaveBeenCalledWith('s1', 'unsuspend');

    const processingTree = DriverList({
      ...baseProps,
      drivers: [driver('a1', { driverApproved: true })],
      processingId: 'a1',
    });
    expect(textsOf(processingTree)).toContain('처리 중…');
    expect(menuItemsOf(processingTree)).toHaveLength(0);
  });
});

describe('Admin PendingDrivers 승인 대기 상자', () => {
  const pendingProps = {
    drivers: [driver('p1', { phone: '010-1111-2222' })],
    count: 1,
    more: false,
    processingId: null,
    onApprove: () => {},
  };

  it('승인 대기가 없으면 상자를 그리지 않는다', () => {
    expect(PendingDrivers({ ...pendingProps, drivers: [], count: 0 })).toBeNull();
  });

  it('approve wiring을 보존한다(승인… 버튼 → 해당 기사 id로 onApprove, 정지는 노출하지 않음)', () => {
    const onApprove = vi.fn();
    const tree = PendingDrivers({ ...pendingProps, onApprove });
    const texts = textsOf(tree);
    expect(texts).toContain('기사 p1');
    expect(texts).toContain('010-1111-2222');
    expect(texts).not.toContain('정지…');
    const handlers = handlersFor(tree, '승인…');
    expect(handlers.length).toBeGreaterThan(0);
    handlers[0]();
    expect(onApprove).toHaveBeenCalledWith('p1');
  });

  it('처리 중인 기사는 승인 버튼 대신 처리 중 표시를 한다', () => {
    const tree = PendingDrivers({ ...pendingProps, processingId: 'p1' });
    const texts = textsOf(tree);
    expect(texts).toContain('처리 중…');
    expect(texts).not.toContain('승인…');
  });
});

describe('Admin DriverList 연락처·가입일', () => {
  it('전화번호와 가입일(KST)을 보여 주고, 전화가 없으면 자리표시자', () => {
    const tree = DriverList({
      ...baseProps,
      drivers: [
        driver('d1', { phone: '010-1234-5678', createdAt: '2026-09-30T16:00:00.000Z' }),
        driver('d2', { phone: null }),
      ],
    });
    const texts = textsOf(tree);
    expect(texts).toContain('010-1234-5678');
    expect(texts).toContain('2026-10-01');
    expect(texts).toContain('연락처 미등록');
  });
});
