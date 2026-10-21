import type { OrderStatus } from '@greenhub/shared';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BuyerAndProduct, OrdersTable, RequestNote, StatusBadges } from './OrdersTable';

type Props = ComponentProps<typeof OrdersTable>;

const FETCH_ERROR_MESSAGE = '주문 목록 조회 중 오류 발생';

const baseProps: Props = {
  orders: [],
  loading: false,
  error: null,
  processingIds: new Set<string>(),
  onRefund: () => {},
  onRetry: () => {},
};

function order(
  id: string,
  orderNumber: string,
  status: OrderStatus = 'ACCEPTED',
): Props['orders'][number] {
  return {
    id,
    orderNumber,
    storeId: 'store-abcdef12',
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
      processingIds: new Set(['o1']),
    });
    expect(textsOf(processing)).toContain('처리중…');
  });

  it('강제환불 버튼은 확인창용으로 주문 객체 전체를 넘긴다', () => {
    const onRefund = vi.fn();
    const target = order('o1', 'ORD-1', 'ACCEPTED');
    const tree = OrdersTable({ ...baseProps, orders: [target], onRefund });
    const handlers = handlersFor(tree, '강제환불');
    expect(handlers.length).toBeGreaterThan(0);
    handlers[0]();
    expect(onRefund).toHaveBeenCalledWith(target);
  });

  it('처리 중 표시는 주문마다 따로 유지된다(한 건이 끝나도 다른 건은 잠김)', () => {
    const tree = OrdersTable({
      ...baseProps,
      orders: [order('o1', 'ORD-1', 'ACCEPTED'), order('o2', 'ORD-2', 'ACCEPTED')],
      processingIds: new Set(['o2']),
    });
    const texts = textsOf(tree);
    expect(texts.filter((t) => t === '처리중…')).toHaveLength(2); // 카드 + 표 각 1
    expect(texts.filter((t) => t === '강제환불')).toHaveLength(2);
  });
});

/** 렌더 트리에서 주어진 컴포넌트 요소의 props를 수집한다. */
function propsOf<P>(tree: ReactNode, type: unknown): P[] {
  const out: P[] = [];
  const visit = (current: ReactNode): void => {
    if (Array.isArray(current)) {
      for (const child of current) visit(child);
      return;
    }
    if (!isElement(current)) return;
    if ((current as ReactElement).type === type) out.push(current.props as P);
    visit(current.props.children);
  };
  visit(tree);
  return out;
}

describe('Admin OrdersTable 요청사항', () => {
  it('요청사항이 있는 주문은 모바일 카드와 데스크톱 행 모두에 넘긴다', () => {
    const tree = OrdersTable({
      ...baseProps,
      orders: [{ ...order('o1', 'ORD-1'), requestNote: '문구: 개업 축하' }],
    });
    const notes = propsOf<{ note?: string | null }>(tree, RequestNote).map((props) => props.note);
    expect(notes).toEqual(['문구: 개업 축하', '문구: 개업 축하']);
  });

  it('요청사항 문구를 보여주고 없거나 공백뿐이면 그리지 않는다', () => {
    expect(textsOf(RequestNote({ note: ' 문구: 개업 축하 ' }))).toContain('문구: 개업 축하');
    expect(RequestNote({ note: '   ' })).toBeNull();
    expect(RequestNote({ note: null })).toBeNull();
    expect(RequestNote({})).toBeNull();
  });
});

describe('Admin OrdersTable 주문 칸', () => {
  // 함수 컴포넌트는 렌더하지 않고 props로 받은 주문을 직접 그려 텍스트를 모은다.
  function renderedTexts(tree: ReactNode): string[] {
    const nested = [
      ...propsOf<{ order: Props['orders'][number] }>(tree, StatusBadges).map((p) =>
        StatusBadges(p),
      ),
      ...propsOf<{ order: Props['orders'][number] }>(tree, BuyerAndProduct).map((p) =>
        BuyerAndProduct(p),
      ),
    ];
    return [...textsOf(tree), ...nested.flatMap((node) => textsOf(node))];
  }

  it('주문일시·고객 이름·상품 요약·가게 이름을 카드와 표 모두에 보여 준다', () => {
    const tree = OrdersTable({
      ...baseProps,
      orders: [
        {
          ...order('o1', 'ORD-1'),
          createdAt: '2026-10-20T15:05:00.000Z',
          buyerName: '김손님',
          productSummary: '호접란 외 1개',
          storeName: '난플렉스',
        },
      ],
    });
    const texts = renderedTexts(tree);
    expect(texts.filter((t) => t === '2026-10-21 00:05')).toHaveLength(2);
    expect(texts.filter((t) => t === '김손님')).toHaveLength(2);
    expect(texts.filter((t) => t === '호접란 외 1개')).toHaveLength(2);
    expect(texts.filter((t) => t === '난플렉스')).toHaveLength(2);
  });

  it('환불 진행 중·실패는 상태 옆 배지로 보여 준다', () => {
    const tree = OrdersTable({
      ...baseProps,
      orders: [
        { ...order('o1', 'ORD-1', 'CANCELLED'), cancellationStatus: 'REFUND_FAILED' },
        { ...order('o2', 'ORD-2', 'CANCELLED'), cancellationStatus: 'COMPLETED' },
      ],
    });
    const texts = renderedTexts(tree);
    expect(texts.filter((t) => t === '환불 실패')).toHaveLength(2);
    expect(texts).not.toContain('환불 진행 중');
  });
});
