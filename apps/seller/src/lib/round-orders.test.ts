import type { Order, OrderStatus } from '@greenhub/shared';
import { describe, expect, it } from 'vitest';
import {
  type BulkPrepareTarget,
  buildRoundOrderStats,
  canBulkPrepare,
  countRoundOrders,
  filterRoundOrders,
  hasOrdersHiddenFromDriver,
  listBulkPrepareTargets,
  runBulkPrepare,
  showsRoundOrders,
  summarizeBulkPrepare,
} from './round-orders';

function order(id: string, status: OrderStatus, overrides: Partial<Order> = {}): Order {
  return {
    id,
    status,
    roundId: 'round-1',
    orderNumber: `20261101-00000${id.slice(-1)}`,
    buyerName: `손님${id.slice(-1)}`,
    createdAt: `2026-11-0${id.slice(-1)}T01:00:00.000Z`,
    ...overrides,
  } as Order;
}

describe('회차 주문 상태별 건수', () => {
  const orders = [
    order('o1', 'ACCEPTED'),
    order('o2', 'ACCEPTED'),
    order('o3', 'PREPARING'),
    order('o4', 'DELIVERY_HELD'),
    order('o5', 'PENDING'),
    order('o6', 'DELIVERED'),
    order('o7', 'CANCELLED'),
    order('o8', 'ACCEPTED', { roundId: 'round-2' }),
    order('o9', 'ACCEPTED', { roundId: null }),
  ];

  it('이 회차 주문만 골라 상태 칸별로 센다', () => {
    const roundOrders = filterRoundOrders(orders, 'round-1');
    expect(roundOrders.map((o) => o.id)).toEqual(['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7']);

    const counts = countRoundOrders(roundOrders);
    expect(counts.total).toBe(7);
    expect(counts.byBucket).toEqual({
      PAID: 2,
      PREPARING: 1,
      DELIVERING: 0,
      DONE: 1,
      HELD: 1,
      PAYMENT_PENDING: 1,
      CANCELLED: 1,
    });
  });

  it('기본 네 칸은 0건이어도 보이고, 나머지는 건수가 있을 때만 보인다', () => {
    const stats = buildRoundOrderStats(countRoundOrders([order('o1', 'ACCEPTED')]), 'round-1');
    expect(stats.map((s) => [s.label, s.count])).toEqual([
      ['결제 완료', 1],
      ['준비 중', 0],
      ['배송 중', 0],
      ['완료', 0],
    ]);
  });

  it('각 칸은 이 회차·그 상태의 주문 목록으로 링크한다(보류는 배송 보류만)', () => {
    const stats = buildRoundOrderStats(
      countRoundOrders(filterRoundOrders(orders, 'round-1')),
      'round-1',
    );
    const hrefOf = (label: string) => stats.find((s) => s.label === label)?.href;
    expect(hrefOf('결제 완료')).toBe('/orders?tab=ACTION_REQUIRED&round=round-1');
    expect(hrefOf('준비 중')).toBe('/orders?tab=WAITING&round=round-1');
    expect(hrefOf('배송 중')).toBe('/orders?tab=IN_DELIVERY&round=round-1');
    expect(hrefOf('완료')).toBe('/orders?tab=DONE&round=round-1');
    expect(hrefOf('보류')).toBe('/orders?tab=ACTION_REQUIRED&held=1&round=round-1');
    expect(hrefOf('취소')).toBe('/orders?tab=CANCELLED&round=round-1');
  });

  it('칸 이름에 회차 상태 이름이나 "배송 보류"를 그대로 쓰지 않는다(회차 상세 E2E 글자 충돌 방지)', () => {
    const labels = buildRoundOrderStats(
      countRoundOrders(filterRoundOrders(orders, 'round-1')),
      'round-1',
    ).map((s) => s.label);
    for (const label of labels) {
      for (const reserved of ['판매 중', '주문 마감', '배송 완료', '수동 마감', '작성 중']) {
        expect(label).not.toContain(reserved);
      }
      expect(label).not.toBe('배송 보류');
    }
  });
});

describe('모두 준비 시작 대상', () => {
  it('결제 완료(ACCEPTED·CONFIRMED) 주문만 먼저 들어온 순서로 고르고 주문번호·주문자로 이름 붙인다', () => {
    const targets = listBulkPrepareTargets([
      order('o3', 'ACCEPTED'),
      order('o1', 'CONFIRMED', { buyerName: '  ' }),
      order('o2', 'PREPARING'),
      order('o4', 'PENDING'),
      order('o5', 'DELIVERY_HELD'),
      order('o6', 'ACCEPTED', { orderNumber: undefined, id: 'abcdefgh-order-6' }),
    ]);
    expect(targets).toEqual([
      { id: 'o1', label: '주문 20261101-000001' },
      { id: 'o3', label: '주문 20261101-000003 · 손님3' },
      { id: 'abcdefgh-order-6', label: '주문 #-ORDER-6 · 손님6' },
    ]);
  });

  it('버튼은 판매 중·마감 회차에 대상이 있을 때만, 기사 화면 경고는 마감 회차에서만', () => {
    expect(canBulkPrepare('OPEN', 2)).toBe(true);
    expect(canBulkPrepare('CLOSED', 2)).toBe(true);
    expect(canBulkPrepare('CLOSED', 0)).toBe(false);
    expect(canBulkPrepare('COMPLETED', 2)).toBe(false);
    expect(canBulkPrepare('SCHEDULED', 2)).toBe(false);

    expect(hasOrdersHiddenFromDriver('CLOSED', 1)).toBe(true);
    expect(hasOrdersHiddenFromDriver('CLOSED', 0)).toBe(false);
    expect(hasOrdersHiddenFromDriver('OPEN', 3)).toBe(false);
  });

  it('주문이 들어올 수 있거나 들어온 회차에서만 "이 회차 주문"을 보여 준다', () => {
    expect(showsRoundOrders('DRAFT')).toBe(false);
    expect(showsRoundOrders('SCHEDULED')).toBe(false);
    expect(showsRoundOrders('OPEN')).toBe(true);
    expect(showsRoundOrders('CLOSED')).toBe(true);
    expect(showsRoundOrders('COMPLETED')).toBe(true);
    expect(showsRoundOrders('CANCELLED')).toBe(true);
  });
});

describe('runBulkPrepare', () => {
  const targets: BulkPrepareTarget[] = [
    { id: 'o1', label: '주문 1' },
    { id: 'o2', label: '주문 2' },
    { id: 'o3', label: '주문 3' },
  ];

  it('한 건씩 차례로 보내고(동시에 보내지 않음) 진행 상황을 알린다', async () => {
    const calls: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const progress: Array<[number, number]> = [];

    const outcomes = await runBulkPrepare(
      targets,
      async (orderId) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        calls.push(orderId);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
      },
      { onProgress: (done, total) => progress.push([done, total]) },
    );

    expect(calls).toEqual(['o1', 'o2', 'o3']);
    expect(maxInFlight).toBe(1);
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
  });

  it('실패한 주문이 있어도 끝까지 보내고 주문별 성공·실패를 돌려준다', async () => {
    const outcomes = await runBulkPrepare(targets, async (orderId) => {
      if (orderId === 'o2') throw new Error('CANCELLED → PREPARING 전환은 허용되지 않습니다.');
      if (orderId === 'o3') throw 'network';
    });

    expect(outcomes).toEqual([
      { id: 'o1', label: '주문 1', ok: true, error: null },
      {
        id: 'o2',
        label: '주문 2',
        ok: false,
        error: 'CANCELLED → PREPARING 전환은 허용되지 않습니다.',
      },
      { id: 'o3', label: '주문 3', ok: false, error: '준비 시작을 하지 못했어요.' },
    ]);
    const summary = summarizeBulkPrepare(outcomes);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed.map((outcome) => outcome.id)).toEqual(['o2', 'o3']);
  });

  it('요청 함수가 바로 예외를 던져도(로그인 정보 없음) 그 주문만 실패로 남긴다', async () => {
    const outcomes = await runBulkPrepare(targets.slice(0, 2), (orderId) => {
      if (orderId === 'o1') throw new Error('로그인 정보를 확인할 수 없어요.');
      return Promise.resolve();
    });
    expect(outcomes.map((outcome) => [outcome.id, outcome.ok])).toEqual([
      ['o1', false],
      ['o2', true],
    ]);
  });

  it('화면을 떠나면(shouldContinue=false) 남은 주문은 보내지 않는다', async () => {
    const calls: string[] = [];
    let keepGoing = true;
    const outcomes = await runBulkPrepare(
      targets,
      async (orderId) => {
        calls.push(orderId);
        keepGoing = false;
      },
      { shouldContinue: () => keepGoing },
    );
    expect(calls).toEqual(['o1']);
    expect(outcomes).toHaveLength(1);
  });
});
