import type { Order, OrderStatus, SaleRoundStatus } from '@greenhub/shared';
import type { OrderGroup } from '../app/orders/_constants';
import { buildOrdersHref } from '../app/orders/orders-deep-link';

// 회차 상세 "이 회차 주문" — 판매자 주문 목록 API 결과를 회차 id로 걸러 상태별로 센다.
// 기사 화면은 PREPARING·DELIVERING·DELIVERY_HELD 주문만 보여 주므로, 결제 완료(ACCEPTED)에
// 머문 주문은 준비 시작을 해야 기사에게 넘어간다.

export type RoundOrderBucket =
  | 'PAID'
  | 'PREPARING'
  | 'DELIVERING'
  | 'DONE'
  | 'HELD'
  | 'PAYMENT_PENDING'
  | 'CANCELLED';

interface RoundOrderBucketMeta {
  key: RoundOrderBucket;
  label: string;
  /** 눌렀을 때 갈 주문 목록 탭 */
  tab: OrderGroup;
  heldOnly?: boolean;
  /** 0건이어도 보여 줄 칸 */
  alwaysShow: boolean;
}

// 칸 이름에 회차 상태 이름("판매 중"·"주문 마감"·"배송 완료")이나 "배송 보류"를 그대로 쓰지 않는다 —
// 회차 상세 E2E가 그 글자를 한 곳에서만 찾는다.
export const ROUND_ORDER_BUCKETS: readonly RoundOrderBucketMeta[] = [
  { key: 'PAID', label: '결제 완료', tab: 'ACTION_REQUIRED', alwaysShow: true },
  { key: 'PREPARING', label: '준비 중', tab: 'WAITING', alwaysShow: true },
  { key: 'DELIVERING', label: '배송 중', tab: 'IN_DELIVERY', alwaysShow: true },
  { key: 'DONE', label: '완료', tab: 'DONE', alwaysShow: true },
  { key: 'HELD', label: '보류', tab: 'ACTION_REQUIRED', heldOnly: true, alwaysShow: false },
  { key: 'PAYMENT_PENDING', label: '결제 대기', tab: 'ACTION_REQUIRED', alwaysShow: false },
  { key: 'CANCELLED', label: '취소', tab: 'CANCELLED', alwaysShow: false },
];

const BUCKET_OF_STATUS: Record<OrderStatus, RoundOrderBucket> = {
  PENDING: 'PAYMENT_PENDING',
  // 공동구매 전용 상태라 회차 주문에는 없다. 결제가 끝난 상태라 결제 완료 칸에 둔다.
  RECRUITING: 'PAID',
  ACCEPTED: 'PAID',
  CONFIRMED: 'PAID',
  PREPARING: 'PREPARING',
  DELIVERING: 'DELIVERING',
  HUB_ARRIVED: 'DELIVERING',
  DELIVERY_HELD: 'HELD',
  DELIVERED: 'DONE',
  PICKED_UP: 'DONE',
  REVIEWED: 'DONE',
  CANCELLED: 'CANCELLED',
};

/** 서버가 판매자에게 허용하는 준비 시작 전이(ACCEPTED·CONFIRMED → PREPARING)의 시작 상태. */
export const PREPARABLE_STATUSES: ReadonlyArray<OrderStatus> = ['ACCEPTED', 'CONFIRMED'];

export function filterRoundOrders<T extends Pick<Order, 'roundId'>>(
  orders: readonly T[],
  roundId: string,
): T[] {
  return orders.filter((order) => order.roundId === roundId);
}

export interface RoundOrderCounts {
  total: number;
  byBucket: Record<RoundOrderBucket, number>;
}

export function countRoundOrders(orders: ReadonlyArray<Pick<Order, 'status'>>): RoundOrderCounts {
  const byBucket: Record<RoundOrderBucket, number> = {
    PAID: 0,
    PREPARING: 0,
    DELIVERING: 0,
    DONE: 0,
    HELD: 0,
    PAYMENT_PENDING: 0,
    CANCELLED: 0,
  };
  let total = 0;
  for (const order of orders) {
    const bucket = BUCKET_OF_STATUS[order.status];
    if (!bucket) continue;
    byBucket[bucket] += 1;
    total += 1;
  }
  return { total, byBucket };
}

export interface RoundOrderStat {
  key: RoundOrderBucket;
  label: string;
  count: number;
  /** 이 회차·이 상태의 주문 목록 */
  href: string;
}

/** 보여 줄 칸(기본 네 칸 + 건수가 있는 칸)과 각 칸의 주문 목록 링크. */
export function buildRoundOrderStats(counts: RoundOrderCounts, roundId: string): RoundOrderStat[] {
  return ROUND_ORDER_BUCKETS.filter(
    (bucket) => bucket.alwaysShow || counts.byBucket[bucket.key] > 0,
  ).map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: counts.byBucket[bucket.key],
    href: buildOrdersHref({ tab: bucket.tab, heldOnly: bucket.heldOnly, roundId }),
  }));
}

/** "이 회차 주문"을 보여 줄 회차 — 주문이 들어올 수 있거나 들어온 회차. */
export function showsRoundOrders(status: SaleRoundStatus): boolean {
  return (
    status === 'OPEN' || status === 'CLOSED' || status === 'COMPLETED' || status === 'CANCELLED'
  );
}

export interface BulkPrepareTarget {
  id: string;
  /** 결과에 보일 이름 — 주문번호·주문자 */
  label: string;
}

/** 준비 시작을 보낼 주문 — 결제 완료 상태만, 먼저 들어온 주문부터. */
export function listBulkPrepareTargets(
  orders: ReadonlyArray<Pick<Order, 'id' | 'status' | 'orderNumber' | 'buyerName' | 'createdAt'>>,
): BulkPrepareTarget[] {
  return orders
    .filter((order) => PREPARABLE_STATUSES.includes(order.status))
    .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))
    .map((order) => {
      const number = order.orderNumber ?? `#${order.id.slice(-8).toUpperCase()}`;
      const buyer = order.buyerName?.trim();
      return { id: order.id, label: buyer ? `주문 ${number} · ${buyer}` : `주문 ${number}` };
    });
}

/** "모두 준비 시작" 버튼: 판매 중이거나 마감된 회차에 준비 시작 대상이 있을 때. */
export function canBulkPrepare(status: SaleRoundStatus, targetCount: number): boolean {
  return (status === 'OPEN' || status === 'CLOSED') && targetCount > 0;
}

/** 마감 회차에 준비 시작 전 주문이 남았다 — 기사 화면에 안 보인다. */
export function hasOrdersHiddenFromDriver(status: SaleRoundStatus, targetCount: number): boolean {
  return status === 'CLOSED' && targetCount > 0;
}

export interface BulkPrepareOutcome extends BulkPrepareTarget {
  ok: boolean;
  error: string | null;
}

/**
 * 주문마다 기존 단건 준비 시작 요청을 차례로 보낸다(한꺼번에 바꾸는 API는 없다).
 * 한 건이 실패해도 멈추지 않고 다음 주문으로 넘어가며, 주문별 결과를 돌려준다.
 * `shouldContinue`가 false를 주면(화면을 떠남 등) 남은 주문은 보내지 않는다.
 */
export async function runBulkPrepare(
  targets: readonly BulkPrepareTarget[],
  prepareOne: (orderId: string) => Promise<unknown>,
  options: {
    onProgress?: (done: number, total: number) => void;
    shouldContinue?: () => boolean;
  } = {},
): Promise<BulkPrepareOutcome[]> {
  const outcomes: BulkPrepareOutcome[] = [];
  for (const target of targets) {
    if (options.shouldContinue && !options.shouldContinue()) break;
    try {
      await prepareOne(target.id);
      outcomes.push({ ...target, ok: true, error: null });
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : null;
      outcomes.push({ ...target, ok: false, error: message ?? '준비 시작을 하지 못했어요.' });
    }
    options.onProgress?.(outcomes.length, targets.length);
  }
  return outcomes;
}

export function summarizeBulkPrepare(outcomes: readonly BulkPrepareOutcome[]): {
  succeeded: number;
  failed: BulkPrepareOutcome[];
} {
  const failed = outcomes.filter((outcome) => !outcome.ok);
  return { succeeded: outcomes.length - failed.length, failed };
}
