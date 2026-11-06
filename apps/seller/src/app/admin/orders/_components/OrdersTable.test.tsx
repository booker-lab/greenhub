import type { OrderStatus } from '@greenhub/shared';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OrdersTable, RequestNote } from './OrdersTable';

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
  extra: Partial<Props['orders'][number]> = {},
): Props['orders'][number] {
  return {
    id,
    orderNumber,
    storeId: 'store-abcdef12',
    status,
    totalAmount: 12000,
    deliveryMethod: 'DIRECT',
    createdAt: '2026-09-01T00:00:00.000Z',
    schemaVersion: 2,
    roundId: 'round-1',
    ...extra,
  };
}

const html = (props: Partial<Props>) =>
  renderToStaticMarkup(<OrdersTable {...baseProps} {...props} />);
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

interface Clickable {
  children?: ReactNode;
  onClick?: unknown;
}

function isElement(node: ReactNode): node is ReactElement<Clickable> {
  return typeof node === 'object' && node !== null && 'props' in node;
}

/** 읽기 상태 화면(호스트 요소만 있는 트리)에서 라벨을 가진 버튼의 onClick을 모은다. */
function handlersFor(tree: ReactNode, label: string): Array<() => void> {
  const handlers: Array<() => void> = [];
  const textOf = (node: ReactNode): string =>
    typeof node === 'string'
      ? node
      : Array.isArray(node)
        ? node.map(textOf).join('')
        : isElement(node)
          ? textOf(node.props.children)
          : '';
  const visit = (current: ReactNode): void => {
    if (Array.isArray(current)) {
      for (const child of current) visit(child);
      return;
    }
    if (!isElement(current)) return;
    if (typeof current.props.onClick === 'function' && textOf(current).includes(label)) {
      handlers.push(current.props.onClick as () => void);
    }
    visit(current.props.children);
  };
  visit(tree);
  return handlers;
}

describe('Admin OrdersTable read state', () => {
  it('loading → 로딩 UI를 표시한다', () => {
    expect(html({ loading: true })).toContain('불러오는 중...');
  });

  it('조회 실패 + 0건 → empty copy 없이 error UI와 retry를 표시한다', () => {
    const out = html({ error: FETCH_ERROR_MESSAGE });
    expect(out).not.toContain('주문이 없습니다.');
    expect(out).toContain('주문 목록을 불러오지 못했습니다.');
    expect(out).toContain(FETCH_ERROR_MESSAGE);
    expect(out).toContain('다시 조회');
  });

  it('성공 + 0건 → 기존 empty copy를 표시하고 retry를 노출하지 않는다', () => {
    const out = html({});
    expect(out).toContain('주문이 없습니다.');
    expect(out).not.toContain('다시 조회');
  });

  it('성공 + 결과 → 주문 행을 그리고 retry를 노출하지 않는다', () => {
    const out = html({ orders: [order('o1', 'ORD-1')] });
    expect(out).toContain('ORD-1');
    expect(out).not.toContain('주문이 없습니다.');
    expect(out).not.toContain('다시 조회');
  });

  it('retry 실행 시 onRetry를 호출한다', () => {
    const onRetry = vi.fn();
    const tree = OrdersTable({ ...baseProps, error: FETCH_ERROR_MESSAGE, onRetry });
    const handlers = handlersFor(tree, '다시 조회');
    expect(handlers.length).toBeGreaterThan(0);
    handlers[0]();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('Admin OrdersTable 행 동작(D7)', () => {
  it('배송 보류 행에만 보이는 글자 버튼 "환불"을 두고, 그 밖의 환불은 ⋮ 메뉴로 넣는다', () => {
    const out = html({
      orders: [order('held', 'ORD-HELD', 'DELIVERY_HELD'), order('acc', 'ORD-ACC', 'ACCEPTED')],
    });
    // 휴대폰 행 + 표 행 = 2번씩
    expect(count(out, 'aria-label="주문 ORD-HELD 환불"')).toBe(2);
    expect(out).not.toContain('aria-label="주문 ORD-ACC 환불"');
    expect(count(out, 'aria-label="주문 ORD-ACC 동작 더 보기"')).toBe(2);
    // 빨간·채운 "강제환불" 버튼은 행에 없다.
    expect(out).not.toContain('강제환불');
  });

  it('환불할 수 없는 행은 동작 없이 자리만 둔다', () => {
    const out = html({ orders: [order('dlv', 'ORD-DLV', 'DELIVERING')] });
    expect(out).not.toContain('동작 더 보기');
    expect(out).not.toContain('ORD-DLV 환불');
  });

  it('처리 중 표시는 주문마다 따로 유지된다(한 건이 끝나도 다른 건은 잠김)', () => {
    const out = html({
      orders: [order('a', 'ORD-A', 'DELIVERY_HELD'), order('b', 'ORD-B', 'DELIVERY_HELD')],
      processingIds: new Set(['a']),
    });
    expect(count(out, '처리 중…')).toBe(2); // 휴대폰 행 + 표 행
    expect(out).not.toContain('주문 ORD-A 환불');
    expect(count(out, 'aria-label="주문 ORD-B 환불"')).toBe(2);
  });

  it('배송 후 환불 처리기가 없으면 배송 완료 회차 주문에 ⋮을 두지 않는다', () => {
    const delivered = order('d', 'ORD-D', 'DELIVERED');
    expect(html({ orders: [delivered] })).not.toContain('동작 더 보기');
    expect(html({ orders: [delivered], onPostDeliveryRefund: () => {} })).toContain(
      'aria-label="주문 ORD-D 동작 더 보기"',
    );
  });
});

describe('Admin OrdersTable 요청사항', () => {
  it('요청사항이 있는 주문은 휴대폰 행과 표 행 모두에 보여 준다', () => {
    const out = html({
      orders: [order('o1', 'ORD-1', 'ACCEPTED', { requestNote: '문구: 개업 축하' })],
    });
    expect(count(out, 'title="문구: 개업 축하"')).toBe(2);
  });

  it('요청사항 문구를 보여주고 없거나 공백뿐이면 그리지 않는다', () => {
    expect(renderToStaticMarkup(<RequestNote note=" 문구: 개업 축하 " />)).toContain(
      '문구: 개업 축하',
    );
    expect(RequestNote({ note: '   ' })).toBeNull();
    expect(RequestNote({ note: null })).toBeNull();
    expect(RequestNote({})).toBeNull();
  });
});

describe('Admin OrdersTable 주문 칸', () => {
  it('주문 시각·가린 주문자·상품 요약·가게 이름·금액을 휴대폰 행과 표 모두에 보여 준다', () => {
    const out = html({
      orders: [
        order('o1', 'ORD-1', 'ACCEPTED', {
          createdAt: '2026-10-20T15:05:00.000Z',
          buyerName: '김손님',
          productSummary: '호접란 외 1개',
          storeName: '난플렉스',
        }),
      ],
    });
    expect(count(out, '2026-10-21 00:05')).toBe(2);
    expect(count(out, '김*님')).toBe(2);
    expect(out).not.toContain('김손님');
    expect(count(out, '호접란 외 1개')).toBe(2);
    expect(count(out, '난플렉스')).toBeGreaterThanOrEqual(2);
    expect(count(out, '12,000원')).toBe(2);
  });

  it('상태는 점 + 글자이고 환불 실패는 빨강(문제)으로 더한다', () => {
    const out = html({
      orders: [order('o1', 'ORD-1', 'CANCELLED', { cancellationStatus: 'REFUND_FAILED' })],
    });
    expect(count(out, 'data-tone="problem"')).toBe(2);
    expect(count(out, '환불 실패')).toBe(2);
    expect(count(out, 'data-tone="done"')).toBe(2); // 취소는 끝난 상태(회색)
  });

  it('가게 이름·주문번호가 없어도 잘린 시스템 id를 보여 주지 않는다', () => {
    const out = html({ orders: [{ ...order('abcdef1234567890', 'X'), orderNumber: null }] });
    expect(out).not.toContain('store-ab');
    expect(out).not.toContain('abcdef123456');
    expect(out).toContain('이름 없는 가게');
    expect(out).toContain('주문번호 없음');
  });
});
