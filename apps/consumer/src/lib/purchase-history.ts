import type { OrderStatus } from '@greenhub/shared';

// MY "구매한 꽃"(purchase-history, 벤치마킹 비교 기능) 집계.
// 소비자 주문 목록(GET /orders, useOrders)을 받아 상품별로 모은다. 새 API를 쓰지 않는다.
//
// 구매로 세는 주문 상태(허용 목록): 결제가 끝난 뒤의 상태만 센다.
// - PENDING: 결제 확인 전. 결제 실패·시간 초과면 API가 CANCELLED로 바꾼다(payment-finalization.service cancelPendingOrder).
// - CANCELLED: 주문 취소. 환불된 주문도 주문 상태는 CANCELLED다(결제 문서만 CANCELLED + refundedAt).
// - RECRUITING: 공동구매 결제 완료 뒤 모집 중(결제 확정 시 group이면 RECRUITING). 구매로 센다.
// 모르는 상태 값은 세지 않는다(허용 목록이라 새 상태가 생겨도 조용히 섞이지 않는다).
export const PURCHASED_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'RECRUITING',
  'CONFIRMED',
  'ACCEPTED',
  'PREPARING',
  'DELIVERING',
  'DELIVERY_HELD',
  'HUB_ARRIVED',
  'PICKED_UP',
  'DELIVERED',
  'REVIEWED',
]);

export interface PurchaseHistoryEntry {
  productId: string;
  /** 가장 최근 주문에 적힌 상품 이름 */
  productName: string;
  /** 가장 최근 주문에 적힌 상품 사진. 없으면 null */
  productImageUrl: string | null;
  /** 마지막 구매 시각(ms). 주문 시각을 읽을 수 없으면 null */
  lastPurchasedAt: number | null;
  /** 이 상품이 들어 있는 주문 건수(수량 합이 아니다) */
  orderCount: number;
}

interface PurchaseLine {
  productId: string;
  productName: string;
  productImageUrl: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// 회차 주문은 orderItems에 상품이 여럿 있고, 옛 주문(schemaVersion 1)은 최상위 productId·productName 하나다.
function readLines(order: Record<string, unknown>): PurchaseLine[] {
  const lines: PurchaseLine[] = [];
  if (Array.isArray(order.orderItems) && order.orderItems.length > 0) {
    for (const item of order.orderItems) {
      if (!isRecord(item)) continue;
      const productId = nonEmpty(item.productId);
      const productName = nonEmpty(item.productName);
      if (!productId || !productName) continue;
      lines.push({ productId, productName, productImageUrl: nonEmpty(item.productImageUrl) });
    }
    return lines;
  }
  const productId = nonEmpty(order.productId);
  const productName = nonEmpty(order.productName);
  if (productId && productName) lines.push({ productId, productName, productImageUrl: null });
  return lines;
}

/**
 * 주문 목록을 상품별로 모은다. 마지막 구매일이 최근인 상품이 먼저 온다.
 * readTime은 주문 createdAt을 ms로 읽는다(읽을 수 없으면 NaN). useOrders의 readCreatedAtMillis를 넘긴다.
 */
export function collectPurchaseHistory(
  orders: readonly unknown[],
  readTime: (value: unknown) => number,
): PurchaseHistoryEntry[] {
  const byProduct = new Map<string, PurchaseHistoryEntry & { order: number; nameTime: number }>();

  orders.forEach((order, orderIndex) => {
    if (!isRecord(order) || typeof order.status !== 'string') return;
    if (!PURCHASED_ORDER_STATUSES.has(order.status as OrderStatus)) return;
    const time = readTime(order.createdAt);
    const validTime = Number.isNaN(time) ? null : time;
    // 한 주문에 같은 상품이 두 줄(다른 회차 상품 등)이어도 주문 건수는 한 번만 센다.
    const seen = new Set<string>();

    for (const line of readLines(order)) {
      if (seen.has(line.productId)) continue;
      seen.add(line.productId);
      const current = byProduct.get(line.productId);
      if (!current) {
        byProduct.set(line.productId, {
          ...line,
          lastPurchasedAt: validTime,
          orderCount: 1,
          order: orderIndex,
          nameTime: validTime ?? Number.NEGATIVE_INFINITY,
        });
        continue;
      }
      current.orderCount += 1;
      if (
        validTime !== null &&
        (current.lastPurchasedAt === null || validTime > current.lastPurchasedAt)
      ) {
        current.lastPurchasedAt = validTime;
      }
      // 이름·사진은 가장 최근 주문 것을 쓴다(같은 시각이면 먼저 본 주문 것을 둔다).
      if ((validTime ?? Number.NEGATIVE_INFINITY) > current.nameTime) {
        current.productName = line.productName;
        current.productImageUrl = line.productImageUrl;
        current.nameTime = validTime ?? Number.NEGATIVE_INFINITY;
      }
    }
  });

  return [...byProduct.values()]
    .sort((a, b) => {
      const aTime = a.lastPurchasedAt;
      const bTime = b.lastPurchasedAt;
      if (aTime !== null && bTime !== null && aTime !== bTime) return bTime - aTime;
      if ((aTime === null) !== (bTime === null)) return aTime === null ? 1 : -1;
      return a.order - b.order;
    })
    .map(({ productId, productName, productImageUrl, lastPurchasedAt, orderCount }) => ({
      productId,
      productName,
      productImageUrl,
      lastPurchasedAt,
      orderCount,
    }));
}
