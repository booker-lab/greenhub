import type { OrderStatus } from '@greenhub/shared';
import { formatOrderDeliveryDate } from '@/lib/order-delivery-date';

// MY 주문 카드의 글자 줄을 고른다(design-standard.md §5 "소비자 마이페이지", 2026-11-13 사용자 결정 Q4-A).
// 카드는 "언제 오는지"를 굵은 첫 줄에 쓰고, 오른쪽 위 날짜에는 무엇의 날짜인지("주문")를 붙인다.

type ArrivalPhase = 'upcoming' | 'arrived' | 'hidden';

// 상태 묶음은 카드의 상태 점(mypage/_client.tsx STATUS_TONES)과 같이 주문 상태(order.status) 하나로 정한다.
// - upcoming: 아직 도착 전(결제 확인 중·결제 완료·준비·배송 중·배송 보류) → "도착 예정"
// - arrived: 도착함(배송 완료·구매 확정) → "도착"
// - hidden: 취소된 주문은 오지 않으므로 줄을 숨긴다.
// 표에 없는 상태(배송 종결, 공동구매·거점 전용 상태, 모르는 값)는 도착을 약속하지 않고 수령 방식을 쓴다.
const ARRIVAL_PHASES: Partial<Record<OrderStatus, ArrivalPhase>> = {
  PENDING: 'upcoming',
  ACCEPTED: 'upcoming',
  PREPARING: 'upcoming',
  DELIVERING: 'upcoming',
  DELIVERY_HELD: 'upcoming',
  DELIVERED: 'arrived',
  REVIEWED: 'arrived',
  CANCELLED: 'hidden',
};

export interface OrderCardLineSource {
  status?: unknown;
  saleType?: unknown;
  deliveryMethod?: unknown;
  requestedDeliveryDate?: unknown;
}

function arrivalPhase(status: unknown): ArrivalPhase | null {
  if (typeof status !== 'string' || !Object.hasOwn(ARRIVAL_PHASES, status)) return null;
  return ARRIVAL_PHASES[status as OrderStatus] ?? null;
}

/** 수령 방식 줄: "직배송"·"택배"·"거점 픽업", 공동구매는 앞에 "[공동구매] "를 붙인다. */
export function orderCardMethodLine(order: OrderCardLineSource): string {
  const method =
    order.deliveryMethod === 'hub'
      ? '거점 픽업'
      : order.deliveryMethod === 'parcel'
        ? '택배'
        : '직배송';
  return `${order.saleType === 'group' ? '[공동구매] ' : ''}${method}`;
}

/**
 * 카드의 굵은 첫 줄. null이면 줄을 그리지 않는다.
 * - 직배송이고 도착일을 읽을 수 있는 주문(공동구매 제외): "11월 10일(화) 도착 예정" / "11월 10일(화) 도착" / 취소는 숨김
 * - 택배·거점 픽업·공동구매, 도착일을 읽지 못한 주문, 표에 없는 상태: 수령 방식
 */
export function orderCardHeadline(order: OrderCardLineSource): string | null {
  if (order.saleType !== 'group' && order.deliveryMethod === 'direct') {
    const phase = arrivalPhase(order.status);
    const date = phase ? formatOrderDeliveryDate(order.requestedDeliveryDate) : null;
    if (phase && date) {
      if (phase === 'hidden') return null;
      return phase === 'arrived' ? `${date} 도착` : `${date} 도착 예정`;
    }
  }
  return orderCardMethodLine(order);
}

/** 오른쪽 위 주문한 날: "11월 6일 주문". 날짜를 읽을 수 없으면 null(라벨만 남기지 않는다). */
export function orderCardOrderedLabel(createdAt: unknown): string | null {
  if (typeof createdAt !== 'string' || !createdAt.trim()) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getMonth() + 1}월 ${date.getDate()}일 주문`;
}
