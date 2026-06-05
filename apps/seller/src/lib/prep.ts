import type { Order, Product } from '@greenhub/shared';

export type PrepGroupConfigMap = Record<string, { groupDeliveryDate: string }>;

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
export function deliveryDateKey(
  order: Order,
  groupConfigMap: PrepGroupConfigMap = {},
): string | null {
  const raw =
    order.saleType === 'group'
      ? groupConfigMap[order.productId]?.groupDeliveryDate
      : order.requestedDeliveryDate;
  return raw ? raw.slice(0, 10) : null;
}

/** 미발송 상태인지. */
export function isUnshipped(order: Order): boolean {
  return UNSHIPPED_STATUSES.includes(order.status);
}

/** 미발송 상태이며 배송예정일이 오늘 이전(경과)인 주문 — 발송 지연. */
export function isDelayed(
  order: Order,
  today: string = todayKey(),
  groupConfigMap: PrepGroupConfigMap = {},
): boolean {
  if (!isUnshipped(order)) return false;
  const key = deliveryDateKey(order, groupConfigMap);
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

export interface AggregatePrepOptions {
  today?: string;
  groupConfigMap?: PrepGroupConfigMap;
}

function selectionLabel(product: Product | undefined): string | null {
  const colors = product?.selection?.colors;
  return colors && colors.length > 0 ? colors.join('·') : null;
}

/**
 * 미발송 주문을 productId별로 quantity 합산.
 * 배송예정일 = 오늘 → today, < 오늘 → delayed, > 오늘·미지정 → 제외.
 * 공동구매 주문은 groupProductConfig 조인 결과의 groupDeliveryDate를 사용한다.
 */
export function aggregatePrep(
  orders: Order[],
  products: Product[],
  options: AggregatePrepOptions = {},
): PrepBuckets {
  const today = options.today ?? todayKey();
  const groupConfigMap = options.groupConfigMap ?? {};
  const productMap = new Map(products.map((p) => [p.id, p]));
  const fallbackNameMap = new Map<string, string>();
  const todayAgg = new Map<string, { quantity: number; fallbackName: string | null }>();
  const delayedAgg = new Map<string, { quantity: number; fallbackName: string | null }>();

  const addLine = (
    agg: Map<string, { quantity: number; fallbackName: string | null }>,
    order: Order,
  ) => {
    const current = agg.get(order.productId);
    const fallbackName = productMap.get(order.productId)?.name ?? order.productName ?? null;
    if (fallbackName) fallbackNameMap.set(order.productId, fallbackName);
    agg.set(order.productId, {
      quantity: (current?.quantity ?? 0) + order.quantity,
      fallbackName: current?.fallbackName ?? fallbackName,
    });
  };

  for (const o of orders) {
    if (!isUnshipped(o)) continue;
    const key = deliveryDateKey(o, groupConfigMap);
    if (key === null) continue;
    if (key === today) {
      addLine(todayAgg, o);
    } else if (key < today) {
      addLine(delayedAgg, o);
    }
  }

  const toLines = (
    agg: Map<string, { quantity: number; fallbackName: string | null }>,
  ): PrepLine[] =>
    [...agg.entries()]
      .map(([productId, entry]) => {
        const product = productMap.get(productId);
        return {
          productId,
          productName:
            product?.name ??
            entry.fallbackName ??
            fallbackNameMap.get(productId) ??
            '(상품 정보 없음)',
          selectionLabel: selectionLabel(product),
          quantity: entry.quantity,
        };
      })
      .sort((a, b) => b.quantity - a.quantity);

  return { today: toLines(todayAgg), delayed: toLines(delayedAgg) };
}
