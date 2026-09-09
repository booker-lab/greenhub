import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DriverList } from './DriverList';

type Props = ComponentProps<typeof DriverList>;

const FETCH_ERROR_MESSAGE = '드라이버 목록 조회 중 오류 발생';

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
    name: `드라이버 ${id}`,
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
}

function isElement(node: ReactNode): node is ReactElement<Clickable> {
  return typeof node === 'object' && node !== null && 'props' in node;
}

/** 렌더 트리(DOM 불필요)에 포함된 모든 텍스트 리프를 수집한다. */
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
    if (isElement(current)) visit(current.props.children);
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
    visit(current.props.children);
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
    expect(texts).not.toContain('드라이버가 없습니다.');
    expect(texts).toContain('드라이버 목록을 불러오지 못했습니다.');
    expect(texts).toContain(FETCH_ERROR_MESSAGE);
    expect(handlersFor(tree, '다시 조회').length).toBeGreaterThan(0);
  });

  it('성공 + 0건 → 기존 empty copy를 표시하고 retry를 노출하지 않는다', () => {
    const tree = DriverList({ ...baseProps });
    expect(textsOf(tree)).toContain('드라이버가 없습니다.');
    expect(handlersFor(tree, '다시 조회')).toHaveLength(0);
  });

  it('성공 + 결과 → 기존 driver rendering을 유지하고 retry를 노출하지 않는다', () => {
    const tree = DriverList({ ...baseProps, drivers: [driver('d1')] });
    const texts = textsOf(tree);
    expect(texts).toContain('드라이버 d1');
    expect(texts).not.toContain('드라이버가 없습니다.');
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

  it('approve/suspend wiring을 보존한다(대기=승인+정지, 정지됨=정지 해제, 처리중 표시)', () => {
    const pendingTree = DriverList({ ...baseProps, drivers: [driver('p1')] });
    const pendingTexts = textsOf(pendingTree);
    expect(pendingTexts).toContain('승인');
    expect(pendingTexts).toContain('정지');

    const suspendedTree = DriverList({
      ...baseProps,
      drivers: [driver('s1', { driverApproved: true, suspended: true })],
    });
    expect(textsOf(suspendedTree)).toContain('정지 해제');

    const processingTree = DriverList({
      ...baseProps,
      drivers: [driver('p1')],
      processingId: 'p1',
    });
    expect(textsOf(processingTree)).toContain('처리중…');
  });
});
