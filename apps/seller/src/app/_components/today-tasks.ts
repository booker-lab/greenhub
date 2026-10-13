import type { Order } from '@greenhub/shared';
import { isDelayed, todayKey } from '../../lib/prep';
import { PREPARABLE_STATUSES } from '../../lib/round-orders';
import { isRoundOrder } from '../../lib/round-purchase-list';
import { buildOrdersHref } from '../orders/orders-deep-link';

export interface TaskRow {
  key: string;
  /** 줄 앞 점 색 — 할 일=초록, 문제=빨강, 점검=노랑. */
  dot: string;
  label: string;
  href: string;
}

const DOT_TODO = 'var(--color-primary)';
const DOT_PROBLEM = 'var(--color-danger)';
const DOT_CHECK = 'var(--color-status-warning-text)';

/** 회차 주문이 기사에게 넘어간 뒤 배송을 기다리는 상태(보류는 따로 센다). */
const ROUND_DELIVERY_STATUSES: ReadonlyArray<Order['status']> = ['PREPARING', 'DELIVERING'];

function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** 회차 주문 줄이 갈 곳 — 한 회차면 그 회차 상세, 여러 회차면 회차 목록. */
function roundHref(orders: ReadonlyArray<Pick<Order, 'roundId'>>): string {
  const roundIds = new Set(orders.map((order) => order.roundId));
  const [onlyRoundId] = [...roundIds];
  return roundIds.size === 1 && onlyRoundId
    ? `/sale-rounds/${encodeURIComponent(onlyRoundId)}`
    : '/sale-rounds';
}

/**
 * 홈 "오늘 할 일" 줄. 건수가 0인 줄은 만들지 않는다.
 * - 신규 주문: 결제가 끝나 준비 시작을 기다리는 일반 주문만(결제 전 PENDING·보류·회차 주문 제외).
 * - 준비 시작 대기: 결제 완료에 머문 회차 주문 — 준비 시작 전에는 기사 화면에 안 보인다.
 * - 배송할 회차 주문: 준비 중·배송 중 회차 주문 중 배송일이 내일 이전인 것(배송 전날 밤부터 보인다).
 * - 배송 보류: 처리 필요 탭의 배송 보류만 따로.
 * - 발송 지연: 배송일이 지난 미발송 일반 주문(회차 주문은 회차 화면이 맡는다).
 */
export function buildTodayTasks({
  orders,
  openIssueCount = 0,
  inactiveCount = 0,
  today = todayKey(),
}: {
  orders: readonly Order[];
  openIssueCount?: number;
  /** 비활성 상품 수 — 상품 집계를 믿을 수 없으면 0을 넘긴다. */
  inactiveCount?: number;
  today?: string;
}): TaskRow[] {
  const tomorrow = addDays(today, 1);
  const roundAwaitingPrep = orders.filter(
    (order) => isRoundOrder(order) && PREPARABLE_STATUSES.includes(order.status),
  );
  const roundAwaitingDelivery = orders.filter((order) => {
    if (!isRoundOrder(order) || !ROUND_DELIVERY_STATUSES.includes(order.status)) return false;
    const dateKey = order.requestedDeliveryDate?.slice(0, 10);
    return !!dateKey && dateKey <= tomorrow;
  });
  const roundDeliveryOverdue = roundAwaitingDelivery.some(
    (order) => (order.requestedDeliveryDate?.slice(0, 10) ?? '') < today,
  );
  const newOrderCount = orders.filter(
    (order) => !isRoundOrder(order) && PREPARABLE_STATUSES.includes(order.status),
  ).length;
  const heldCount = orders.filter((order) => order.status === 'DELIVERY_HELD').length;
  const delayedCount = orders.filter((order) => isDelayed(order, today)).length;

  const tasks: TaskRow[] = [];
  if (openIssueCount > 0)
    tasks.push({
      key: 'operations',
      dot: DOT_PROBLEM,
      label: `운영 확인 ${openIssueCount}건 보기`,
      href: '/operations',
    });
  if (heldCount > 0)
    tasks.push({
      key: 'held',
      dot: DOT_PROBLEM,
      label: `배송 보류 ${heldCount}건 확인`,
      href: buildOrdersHref({ tab: 'ACTION_REQUIRED', heldOnly: true }),
    });
  if (roundAwaitingPrep.length > 0)
    tasks.push({
      key: 'round-prepare',
      dot: DOT_TODO,
      label: `준비 시작 대기 ${roundAwaitingPrep.length}건`,
      href: roundHref(roundAwaitingPrep),
    });
  if (roundAwaitingDelivery.length > 0)
    tasks.push({
      key: 'round-delivery',
      dot: roundDeliveryOverdue ? DOT_PROBLEM : DOT_TODO,
      label: `배송할 회차 주문 ${roundAwaitingDelivery.length}건`,
      href: roundHref(roundAwaitingDelivery),
    });
  if (newOrderCount > 0)
    tasks.push({
      key: 'new',
      dot: DOT_TODO,
      label: `신규 주문 ${newOrderCount}건 처리하기`,
      href: buildOrdersHref({ tab: 'ACTION_REQUIRED' }),
    });
  if (delayedCount > 0)
    tasks.push({
      key: 'delayed',
      dot: DOT_PROBLEM,
      label: `발송 지연 ${delayedCount}건 확인`,
      href: '/prep',
    });
  if (inactiveCount > 0)
    tasks.push({
      key: 'inactive',
      dot: DOT_CHECK,
      label: `비활성 상품 ${inactiveCount}건 점검`,
      href: '/products',
    });
  return tasks;
}
