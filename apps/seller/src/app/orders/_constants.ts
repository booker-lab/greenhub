import type { OrderStatus } from '@greenhub/shared';

// ─── OrderGroup 레이어 ───────────────────────────────────────────────────────

export type OrderGroup =
  | 'ACTION_REQUIRED'
  | 'WAITING'
  | 'IN_DELIVERY'
  | 'DONE'
  | 'CANCELLED';

export const STATUS_GROUP_MAP: Record<OrderStatus, OrderGroup> = {
  PENDING:     'ACTION_REQUIRED',
  RECRUITING:  'ACTION_REQUIRED',
  ACCEPTED:    'ACTION_REQUIRED',
  CONFIRMED:   'ACTION_REQUIRED',
  PREPARING:   'WAITING',
  DELIVERING:  'IN_DELIVERY',
  HUB_ARRIVED: 'IN_DELIVERY',
  DELIVERED:   'DONE',
  PICKED_UP:   'DONE',
  REVIEWED:    'DONE',
  CANCELLED:   'CANCELLED',
};

export const GROUP_TABS: { key: OrderGroup; label: string }[] = [
  { key: 'ACTION_REQUIRED', label: '처리 필요' },
  { key: 'WAITING',         label: '대기 중' },
  { key: 'IN_DELIVERY',     label: '배송 중' },
  { key: 'DONE',            label: '완료' },
  { key: 'CANCELLED',       label: '취소' },
];

export const IN_DELIVERY_SUBFILTERS: { key: 'ALL' | 'DELIVERING' | 'HUB_ARRIVED'; label: string }[] = [
  { key: 'ALL',         label: '전체' },
  { key: 'DELIVERING',  label: '배송 중' },
  { key: 'HUB_ARRIVED', label: '거점 도착' },
];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: '대기',
  RECRUITING: '모집 중',
  CONFIRMED: '주문 확정',
  ACCEPTED: '결제 완료',
  PREPARING: '준비 중',
  DELIVERING: '배송 중',
  HUB_ARRIVED: '거점 도착',
  PICKED_UP: '픽업 완료',
  DELIVERED: '배송 완료',
  CANCELLED: '취소',
  REVIEWED: '구매 확정',
};

export const STATUS_COLOR: Record<OrderStatus, string> = {
  ACCEPTED: 'orange',
  CONFIRMED: 'orange',
  RECRUITING: 'orange',
  PREPARING: 'blue',
  DELIVERING: 'violet',
  HUB_ARRIVED: 'violet',
  CANCELLED: 'red',
  PENDING: 'gray',
  DELIVERED: 'green',
  PICKED_UP: 'green',
  REVIEWED: 'green',
};

export const ACCENT_BORDER: Record<OrderStatus, string> = {
  ACCEPTED: 'var(--color-status-warning-text)',
  CONFIRMED: 'var(--color-status-warning-text)',
  RECRUITING: 'var(--color-status-warning-text)',
  PREPARING: 'var(--color-status-info-text)',
  DELIVERING: '#7048e8',
  HUB_ARRIVED: '#7048e8',
  CANCELLED: 'var(--color-danger)',
  PENDING: 'var(--color-text-disabled)',
  DELIVERED: 'var(--color-primary)',
  PICKED_UP: 'var(--color-primary)',
  REVIEWED: 'var(--color-text-disabled)',
};

export const DELIVERY_LABEL: Record<string, string> = {
  direct: '꽃차 직배송',
  hub: '거점 픽업',
  parcel: '택배',
};

export function formatRelativeTime(iso: unknown): string {
  const date =
    iso && typeof iso === 'object' && 'toDate' in iso
      ? (iso as { toDate(): Date }).toDate()
      : new Date(iso as string);
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}
