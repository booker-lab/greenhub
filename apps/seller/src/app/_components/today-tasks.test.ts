import type { Order, OrderStatus } from '@greenhub/shared';
import { describe, expect, it } from 'vitest';
import { buildTodayTasks } from './today-tasks';

let seq = 0;

function order(status: OrderStatus, overrides: Partial<Order> = {}): Order {
  seq += 1;
  return {
    id: `order-${seq}`,
    status,
    saleType: 'normal',
    requestedDeliveryDate: null,
    ...overrides,
  } as Order;
}

function round(status: OrderStatus, overrides: Partial<Order> = {}): Order {
  return order(status, { roundId: 'round-1', requestedDeliveryDate: '2026-11-10', ...overrides });
}

const labels = (tasks: ReturnType<typeof buildTodayTasks>) => tasks.map((task) => task.label);

describe('홈 오늘 할 일', () => {
  it('할 일이 없으면 줄을 만들지 않는다', () => {
    expect(buildTodayTasks({ orders: [], today: '2026-11-01' })).toEqual([]);
  });

  it('신규 주문은 결제가 끝난 일반 주문만 센다(결제 전·보류·모집 중·회차 주문 제외)', () => {
    const tasks = buildTodayTasks({
      orders: [
        order('ACCEPTED'),
        order('CONFIRMED', { saleType: 'group' }),
        order('PENDING'),
        order('RECRUITING', { saleType: 'group' }),
        order('DELIVERY_HELD'),
        round('ACCEPTED'),
      ],
      today: '2026-11-01',
    });
    const newOrders = tasks.find((task) => task.key === 'new');
    expect(newOrders).toEqual({
      key: 'new',
      dot: 'var(--color-primary)',
      label: '신규 주문 2건 처리하기',
      href: '/orders?tab=ACTION_REQUIRED',
    });
  });

  it('배송 보류는 따로 보이고 배송 보류만 걸린 목록으로 간다', () => {
    const tasks = buildTodayTasks({
      orders: [order('DELIVERY_HELD'), round('DELIVERY_HELD')],
      today: '2026-11-10',
    });
    expect(tasks).toEqual([
      {
        key: 'held',
        dot: 'var(--color-danger)',
        label: '배송 보류 2건 확인',
        href: '/orders?tab=ACTION_REQUIRED&held=1',
      },
    ]);
  });

  it('결제 완료에 머문 회차 주문은 "준비 시작 대기"로 보이고 그 회차 상세로 간다', () => {
    const tasks = buildTodayTasks({
      orders: [round('ACCEPTED'), round('ACCEPTED'), round('PENDING')],
      today: '2026-11-02',
    });
    expect(tasks).toEqual([
      {
        key: 'round-prepare',
        dot: 'var(--color-primary)',
        label: '준비 시작 대기 2건',
        href: '/sale-rounds/round-1',
      },
    ]);
  });

  it('여러 회차에 걸치면 회차 목록으로 간다', () => {
    const tasks = buildTodayTasks({
      orders: [round('ACCEPTED'), round('ACCEPTED', { roundId: 'round-2' })],
      today: '2026-11-02',
    });
    expect(tasks.find((task) => task.key === 'round-prepare')?.href).toBe('/sale-rounds');
  });

  it('배송 전날 밤에 모두 준비 중이어도 "모두 마쳤어요" 대신 배송할 회차 주문을 보여 준다', () => {
    const orders = [
      round('PREPARING'),
      round('PREPARING'),
      round('DELIVERING'),
      round('DELIVERED'),
    ];
    // 배송 1주 전에는 아직 띄우지 않는다.
    expect(buildTodayTasks({ orders, today: '2026-11-03' })).toEqual([]);
    // 배송 전날(11/9)과 배송일(11/10)에는 할 일로 보인다.
    for (const today of ['2026-11-09', '2026-11-10']) {
      expect(buildTodayTasks({ orders, today })).toEqual([
        {
          key: 'round-delivery',
          dot: 'var(--color-primary)',
          label: '배송할 회차 주문 3건',
          href: '/sale-rounds/round-1',
        },
      ]);
    }
    // 배송일이 지나도 남아 있으면 빨간 점으로 남는다.
    expect(buildTodayTasks({ orders, today: '2026-11-11' })[0]).toMatchObject({
      key: 'round-delivery',
      dot: 'var(--color-danger)',
    });
  });

  it('배송일이 지난 회차 주문은 발송 지연으로 세지 않는다(준비 화면도 회차 주문을 빼므로)', () => {
    const tasks = buildTodayTasks({
      orders: [round('PREPARING'), order('ACCEPTED', { requestedDeliveryDate: '2026-11-09' })],
      today: '2026-11-11',
    });
    expect(tasks.find((task) => task.key === 'delayed')?.label).toBe('발송 지연 1건 확인');
  });

  it('운영 확인·비활성 상품 줄은 넘겨받은 건수로 만든다', () => {
    expect(
      labels(
        buildTodayTasks({ orders: [], openIssueCount: 2, inactiveCount: 1, today: '2026-11-01' }),
      ),
    ).toEqual(['운영 확인 2건 보기', '비활성 상품 1건 점검']);
  });
});
