import type { OrderStatus } from '@greenhub/shared';

// 주문 상태 라벨/색 — orders 탭 표현 SSOT(테이블·카드·필터 공용).
export const STATUS_LABEL = {
  PENDING: '결제대기',
  RECRUITING: '모집중',
  ACCEPTED: '접수됨',
  CONFIRMED: '확정',
  PREPARING: '준비중',
  DELIVERING: '배달중',
  HUB_ARRIVED: '거점도착',
  PICKED_UP: '픽업완료',
  DELIVERED: '배달완료',
  REVIEWED: '리뷰완료',
  CANCELLED: '취소됨',
} satisfies Record<OrderStatus, string>;

export function getStatusColor(status: OrderStatus): string {
  if (status === 'CANCELLED') return 'red';
  if (status === 'DELIVERED' || status === 'REVIEWED') return 'green';
  return 'yellow';
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
