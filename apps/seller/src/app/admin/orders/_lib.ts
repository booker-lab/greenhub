import { ORDER_STATUS_COLOR, ORDER_STATUS_LABEL, type OrderStatus } from '@greenhub/shared';

export const STATUS_LABEL = ORDER_STATUS_LABEL;

export function getStatusColor(status: OrderStatus): string {
  return ORDER_STATUS_COLOR[status] ?? 'gray';
}

// 강제환불 일반 단계 — 사유는 선택 입력.
export const REFUNDABLE_NORMAL: OrderStatus[] = [
  'ACCEPTED',
  'RECRUITING',
  'CONFIRMED',
  'PREPARING',
];

// 강제환불 위험 단계 — 배달 진행 후 환불이므로 사유 5자 이상 필수.
export const REFUNDABLE_RISK: OrderStatus[] = [
  'DELIVERING',
  'HUB_ARRIVED',
  'PICKED_UP',
  'DELIVERED',
  'REVIEWED',
];

export const REFUNDABLE: OrderStatus[] = [...REFUNDABLE_NORMAL, ...REFUNDABLE_RISK];

// 상태 필터 Select 옵션 — '전체' + 전 상태.
export function buildStatusOptions(): { value: string; label: string }[] {
  return [
    { value: '', label: '전체 상태' },
    ...Object.entries(STATUS_LABEL).map(([k, v]) => ({ value: k, label: v })),
  ];
}
