import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OrdersTable } from './OrdersTable';

type Props = ComponentProps<typeof OrdersTable>;

const FETCH_ERROR_MESSAGE = '주문 목록 조회 중 오류 발생';

const baseProps: Props = {
  orders: [],
  loading: false,
  error: null,
  processingId: null,
  onRefund: () => {},
  onRetry: () => {},
};

function order(
  id: string,
  orderNumber: string,
  status = 'ACCEPTED',
): Props['orders'][number] {
  return {
    id,
    orderNumber,
    storeId: 'store-abcdef12',
    userId: 'user-1',
    status,
    totalAmount: 12000,
    deliveryMethod: 'DIRECT',
    createdAt: '2026-09-01T00:00:00.000Z',
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

describe('Admin OrdersTable read state', () => {
  it('loading → 로딩 UI를 표시한다', () => {
    const tree = OrdersTable({ ...baseProps, loading: true });
    expect(textsOf(tree)).toContain('불러오는 중...');
  });

  it('조회 실패 + 0건 → empty copy 없이 error UI와 retry를 표시한다', () => {
    const tree = OrdersTable({ ...baseProps, error: FETCH_ERROR_MESSAGE });
    const texts = textsOf(tree);
    expect(texts).not.toContain('주문이 없습니다.');
    expect(texts).toContain('주문 목록을 불러오지 못했습니다.');
    expect(texts).toContain(FETCH_ERROR_MESSAGE);
    expect(handlersFor(tree, '다시 조회').length).toBeGreaterThan(0);
  });

  it('성공 + 0건 → 기존 empty copy를 표시하고 retry를 노출하지 않는다', () => {
    const tree = OrdersTable({ ...baseProps });
    expect(textsOf(tree)).toContain('주문이 없습니다.');
    expect(handlersFor(tree, '다시 조회')).toHaveLength(0);
  });

  it('성공 + 결과 → 기존 order rendering을 유지하고 retry를 노출하지 않는다', () => {
    const tree = OrdersTable({ ...baseProps, orders: [order('o1', 'ORD-1')] });
    const texts = textsOf(tree);
    expect(texts).toContain('ORD-1');
    expect(texts).not.toContain('주문이 없습니다.');
    expect(handlersFor(tree, '다시 조회')).toHaveLength(0);
  });

  it('retry 실행 시 onRetry를 호출한다', () => {
    const onRetry = vi.fn();
    const tree = OrdersTable({ ...baseProps, error: FETCH_ERROR_MESSAGE, onRetry });
    const handlers = handlersFor(tree, '다시 조회');
    expect(handlers.length).toBeGreaterThan(0);
    handlers[0]();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('refund behavior를 보존한다(환불가능 상태만 강제환불, 처리중 표시)', () => {
    const tree = OrdersTable({
      ...baseProps,
      orders: [order('o1', 'ORD-1', 'ACCEPTED'), order('o2', 'ORD-2', 'DELIVERED')],
    });
    const texts = textsOf(tree);
    expect(texts).toContain('ORD-1');
    expect(texts).toContain('ORD-2');
    expect(texts).toContain('강제환불');

    const processing = OrdersTable({
      ...baseProps,
      orders: [order('o1', 'ORD-1', 'ACCEPTED')],
      processingId: 'o1',
    });
    expect(textsOf(processing)).toContain('처리중…');
  });
});
