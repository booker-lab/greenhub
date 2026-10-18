// orders.helpers.ts — 순수 함수 및 FSM 상수 (NestJS DI 의존 없음)
// orders.service.ts 500라인 초과 분리 (CLAUDE.md Fatal Constraint 준수)

import type { OrderStatus } from './dto/update-status.dto';

const SELLER_CANCELLABLE: OrderStatus[] = ['ACCEPTED', 'CONFIRMED', 'PREPARING'];

// 판매자 허용 상태 전환 — DELIVERING 이후 취소 불가 (소비자 반품 신청 루트)
export const SELLER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  ACCEPTED: ['PREPARING'],
  CONFIRMED: ['PREPARING'],
  // 택배 발송 완료 — parcel 주문만 (deliveryTransitionViolation에서 deliveryMethod 가드, BUG-16 T1)
  PREPARING: ['DELIVERED', 'DELIVERY_HELD'],
  DELIVERING: ['DELIVERY_HELD'],
  DELIVERY_HELD: ['PREPARING', 'CANCELLED'],
};

// 드라이버 허용 상태 전환 — 배송 방법별 제약(거점 도착은 거점 주문만 등)은 deliveryTransitionViolation
export const DRIVER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  PREPARING: ['DELIVERING', 'DELIVERY_HELD'],
  DELIVERING: ['HUB_ARRIVED', 'DELIVERED', 'DELIVERY_HELD'],
  DELIVERY_HELD: ['DELIVERING'],
};

// 소비자 허용 상태 전환
export const CONSUMER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  DELIVERED: ['REVIEWED'],
  PICKED_UP: ['REVIEWED'],
};

// 알림이 필요한 전환과 템플릿 코드 매핑
export const NOTIFICATION_MAP: Partial<Record<OrderStatus, Partial<Record<OrderStatus, string>>>> =
  {
    ACCEPTED: { PREPARING: 'ORDER_PREPARING' },
    CONFIRMED: { PREPARING: 'GROUP_PREPARING' },
    PREPARING: {
      DELIVERING: 'ORDER_DELIVERING',
      DELIVERED: 'ORDER_DELIVERED',
      DELIVERY_HELD: 'ORDER_DELIVERY_HELD',
    },
    DELIVERING: {
      HUB_ARRIVED: 'ORDER_HUB_ARRIVED',
      DELIVERED: 'ORDER_DELIVERED',
      DELIVERY_HELD: 'ORDER_DELIVERY_HELD',
    },
    DELIVERY_HELD: {
      PREPARING: 'ORDER_REDELIVERY_PAYMENT_REQUESTED',
      DELIVERING: 'ORDER_REDELIVERY_SCHEDULED',
    },
  };

export function generatePickupCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function detectMetropolitan(address: string): boolean {
  return /^(서울|경기)/.test(address);
}

export function calcDeliveryFee(
  method: string,
  size: string,
  orderAmount: number,
  config: Record<string, number>,
): number {
  const sizeExtra: Record<string, number> = {
    small: 0,
    medium: 1000,
    large: 3000,
  };
  const baseFeeMap: Record<string, number> = {
    direct: config['directFee'] ?? 3000,
    hub: config['hubFee'] ?? 1000,
    parcel: config['parcelFee'] ?? 4000,
  };
  const freeThresholdMap: Record<string, number> = {
    direct: config['freeThresholdDirect'] ?? 50000,
    hub: config['freeThresholdHub'] ?? 30000,
    parcel: config['freeThresholdParcel'] ?? 50000,
  };

  const base = baseFeeMap[method] ?? 0;
  const extra = sizeExtra[size] ?? 0;
  const threshold = freeThresholdMap[method] ?? 0;

  if (orderAmount >= threshold) return 0;
  return base + extra;
}

/**
 * 역할·상태표로는 허용돼도 주문의 배송 방법으로는 갈 수 없는 전이를 거른다. 위반이면 거절 문구를,
 * 아니면 null을 돌려준다. getAllowedTransitions(역할·상태)를 통과한 전이에 모든 역할 공통으로 적용한다.
 * - 거점 도착(HUB_ARRIVED): 픽업 코드가 있는 예전 거점(hub) 주문만. 회차 주문은 배송 방법과 무관하게
 *   금지한다(픽업 확인 경로가 없어 주문이 그 상태에서 멈춘다).
 * - 배송 완료(DELIVERED): 준비 중에서 바로 완료(택배 발송 완료)는 택배(parcel) 주문만. 거점 주문은 고객
 *   픽업 확인(HUB_ARRIVED → PICKED_UP)으로만 끝나므로 금지한다. 배송 방법을 알 수 없으면 거절한다.
 * - 배송 시작(DELIVERING): 기사가 나르는 직배송(direct)·거점(hub) 주문만.
 */
export function deliveryTransitionViolation(
  current: OrderStatus,
  next: OrderStatus,
  order: Record<string, unknown>,
): string | null {
  const method = order['deliveryMethod'];
  if (next === 'HUB_ARRIVED') {
    if (order['roundId'] || order['schemaVersion'] === 2) {
      return '회차 주문은 거점 도착으로 바꿀 수 없습니다.';
    }
    if (method !== 'hub') return '거점 배송 주문만 거점 도착으로 바꿀 수 있습니다.';
    const pickupCode = order['pickupCode'];
    if (typeof pickupCode !== 'string' || pickupCode.trim().length === 0) {
      return '픽업 코드가 없는 주문은 거점 도착으로 바꿀 수 없습니다.';
    }
    return null;
  }
  if (next === 'DELIVERED') {
    if (current === 'PREPARING') {
      return method === 'parcel' ? null : '택배 발송 완료는 택배 주문에서만 가능합니다.';
    }
    if (method === 'hub') return '거점 배송 주문은 고객 픽업 확인으로만 완료할 수 있습니다.';
    if (method !== 'direct' && method !== 'parcel') {
      return '배송 방법을 확인할 수 없어 배송 완료로 바꿀 수 없습니다.';
    }
    return null;
  }
  if (next === 'DELIVERING' && method !== 'direct' && method !== 'hub') {
    return '기사 배송(직배송·거점) 주문만 배송을 시작할 수 있습니다.';
  }
  return null;
}

/**
 * 역할·상태표만 본 다음 상태 목록(배송 방법과 무관한 상한). 실제 전이 허가는 배송 방법 제약
 * (deliveryTransitionViolation)을 함께 적용해야 한다.
 */
export function getAllowedTransitions(role: string, current: OrderStatus): OrderStatus[] {
  if (role === 'admin') {
    // admin은 seller + driver 전환 모두 허용
    const sellerBase = SELLER_TRANSITIONS[current] ?? [];
    const driverBase = DRIVER_TRANSITIONS[current] ?? [];
    const cancelList: OrderStatus[] = SELLER_CANCELLABLE.includes(current) ? ['CANCELLED'] : [];
    return [...new Set([...sellerBase, ...driverBase, ...cancelList])];
  }
  if (role === 'seller') {
    const base = SELLER_TRANSITIONS[current] ?? [];
    // 판매자 강제 취소는 ACCEPTED·CONFIRMED·PREPARING 상태에서만 허용
    if (SELLER_CANCELLABLE.includes(current)) {
      return [...base, 'CANCELLED'];
    }
    return base;
  }
  if (role === 'driver') return DRIVER_TRANSITIONS[current] ?? [];
  return CONSUMER_TRANSITIONS[current] ?? [];
}
