// orders.helpers.ts — 순수 함수 및 FSM 상수 (NestJS DI 의존 없음)
// orders.service.ts 500라인 초과 분리 (CLAUDE.md Fatal Constraint 준수)

import type { OrderStatus } from './dto/update-status.dto';

// 판매자 허용 상태 전환 — DELIVERING 이후 취소 불가 (소비자 반품 신청 루트)
export const SELLER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  ACCEPTED: ['PREPARING'],
  CONFIRMED: ['PREPARING'],
};

// 드라이버 허용 상태 전환
export const DRIVER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  PREPARING: ['DELIVERING'],
  DELIVERING: ['HUB_ARRIVED', 'DELIVERED'],
};

// 소비자 허용 상태 전환
export const CONSUMER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  DELIVERED: ['REVIEWED'],
  PICKED_UP: ['REVIEWED'],
};

// 알림이 필요한 전환과 템플릿 코드 매핑
export const NOTIFICATION_MAP: Partial<
  Record<OrderStatus, Partial<Record<OrderStatus, string>>>
> = {
  ACCEPTED: { PREPARING: 'ORDER_PREPARING' },
  CONFIRMED: { PREPARING: 'GROUP_PREPARING' },
  PREPARING: { DELIVERING: 'ORDER_DELIVERING' },
  DELIVERING: {
    HUB_ARRIVED: 'ORDER_HUB_ARRIVED',
    DELIVERED: 'ORDER_DELIVERED',
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

export function getAllowedTransitions(role: string, current: OrderStatus): OrderStatus[] {
  if (role === 'seller' || role === 'admin') {
    const base = SELLER_TRANSITIONS[current] ?? [];
    // 판매자·관리자 강제 취소는 ACCEPTED·CONFIRMED·PREPARING 상태에서만 허용
    const sellerCancellable: OrderStatus[] = ['ACCEPTED', 'CONFIRMED', 'PREPARING'];
    if (sellerCancellable.includes(current)) {
      return [...base, 'CANCELLED'];
    }
    return base;
  }
  if (role === 'driver') return DRIVER_TRANSITIONS[current] ?? [];
  return CONSUMER_TRANSITIONS[current] ?? [];
}
