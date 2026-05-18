import type { Order, Product } from '@greenhub/shared';

/** 셀러가 아직 발송 처리하지 않은 주문 상태 — 준비 물량 집계 대상. */
export const UNSHIPPED_STATUSES: ReadonlyArray<Order['status']> = [
  'ACCEPTED',
  'CONFIRMED',
  'PREPARING',
];

/** 로컬 기준 오늘 날짜 키 'YYYY-MM-DD'. */
export function todayKey(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 주문 배송예정일의 날짜 부분 'YYYY-MM-DD'. 없으면 null. (ISO8601·날짜문자열 모두 대응) */
export function deliveryDateKey(order: Order): string | null {
  return order.requestedDeliveryDate ? order.requestedDeliveryDate.slice(0, 10) : null;
}

/** 미발송 상태인지. */
export function isUnshipped(order: Order): boolean {
  return UNSHIPPED_STATUSES.includes(order.status);
}

/** 미발송 상태이며 배송예정일이 오늘 이전(경과)인 주문 — 발송 지연. */
export function isDelayed(order: Order, today: string = todayKey()): boolean {
  if (!isUnshipped(order)) return false;
  const key = deliveryDateKey(order);
  return key !== null && key < today;
}

// ─── 준비 물량 집계 ──────────────────────────────────────────────

/** productId별 합산된 준비 물량 한 줄. */
export interface PrepLine {
  productId: string;
  productName: string;
  /** 동명 상품 구분용 색상 표기 (없으면 null). */
  selectionLabel: string | null;
  quantity: number;
}

/** 오늘분/지연분으로 분리된 준비 물량. */
export interface PrepBuckets {
  today: PrepLine[];
  delayed: PrepLine[];
}

function selectionLabel(product: Product | undefined): string | null {
  const colors = product?.selection?.colors;
  return colors && colors.length > 0 ? colors.join('·') : null;
}

/**
 * 미발송·일반 주문을 productId별로 quantity 합산.
 * 배송예정일 = 오늘 → today, < 오늘 → delayed, > 오늘·미지정 → 제외.
 * 공동구매 주문은 배송일이 별도 문서라 1차 범위에서 제외(saleType='group').
 */
export function aggregatePrep(
  orders: Order[],
  products: Product[],
  today: string = todayKey(),
): PrepBuckets {
  const productMap = new Map(products.map((p) => [p.id, p]));
  const todayAgg = new Map<string, number>();
  const delayedAgg = new Map<string, number>();

  for (const o of orders) {
    if (o.saleType === 'group') continue;
    if (!isUnshipped(o)) continue;
    const key = deliveryDateKey(o);
    if (key === null) continue;
    if (key === today) {
      todayAgg.set(o.productId, (todayAgg.get(o.productId) ?? 0) + o.quantity);
    } else if (key < today) {
      delayedAgg.set(o.productId, (delayedAgg.get(o.productId) ?? 0) + o.quantity);
    }
  }

  const toLines = (agg: Map<string, number>): PrepLine[] =>
    [...agg.entries()]
      .map(([productId, quantity]) => {
        const product = productMap.get(productId);
        return {
          productId,
          productName: product?.name ?? '(상품 정보 없음)',
          selectionLabel: selectionLabel(product),
          quantity,
        };
      })
      .sort((a, b) => b.quantity - a.quantity);

  return { today: toLines(todayAgg), delayed: toLines(delayedAgg) };
}
